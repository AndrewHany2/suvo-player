# Email-only login + username→name label — design

**Date:** 2026-07-17
**Branch:** `feat/reseller-dashboard`
**Status:** design (awaiting spec review → plan)

## Summary

Two coupled changes to the reseller/auth surface:

1. **Login becomes email-only.** The `login` Edge Function stops resolving a
   username→email lookup against `profiles`; it signs in with the given email +
   password and applies the reseller account-status gate. This closes the
   security-review finding that username-based login was not tenant-scoped
   (two providers could pick the same customer username, breaking the
   `profiles.username` lookup / enabling a cross-tenant DoS).
2. **The reseller "username" becomes a freeform "name" label.** It is a
   human-readable label a provider gives an account (e.g. "John — living room"),
   NOT a login credential and NOT unique. Customers log in with an
   **auto-generated login email** (`acc-<token>@<provider-slug>.accounts.local`),
   which the dashboard displays for the provider to hand to the customer.

**Storage decision (Approach B, chosen):** the name reuses the existing
`profiles.username` column — no new column. Because a freeform label cannot be
unique and email-only login no longer needs it to be, a migration frees
`profiles.username` of any UNIQUE / NOT NULL constraint. The physical column
keeps its legacy name `username` (renaming a Studio-managed column that the RN
app also reads is out of scope); every layer above raw table access speaks
`name`.

## Motivation

- **Security:** `functions/login` did `profiles.select("email").eq("username").maybeSingle()`.
  In the multi-tenant reseller model, username was not provider-scoped, so a
  duplicate username produced a multi-row `.maybeSingle()` error (→ both users
  lockable out) or a cross-tenant "username taken" leak. Email-only login
  removes the lookup entirely, so the vector no longer exists by construction.
- **Product:** IPTV resellers hand out credentials; they do not collect customer
  emails. Auto-generating the login email keeps account creation frictionless
  while giving each customer a real, unique login.

## Non-goals / out of scope

- The **IPTV line username** in `src/services/iptvApi.js` and `AccountsScreen`
  (the upstream Xtream credential `host/username/password`). Untouched.
- Renaming the physical `profiles.username` **column** to `name` (Studio-managed,
  read by the RN app — high risk, no benefit once the API speaks `name`).
- Phase-2 self-serve signup / plans / payment (schema hooks stay reserved).
- Data migration of existing accounts: the reseller branch is **pre-launch /
  unmerged**, and no production users log in by username (confirmed). Existing
  test accounts keep whatever `profiles.username` they have; nothing is backfilled.

## Trust boundary / who sets what

| Field | Set by | Used for | Unique? |
|---|---|---|---|
| **name** (`profiles.username` column) | provider (create/edit) | display label in dashboard + RN "logged in as" | no |
| **login email** (`auth.users.email`, mirrored to `profiles.email`) | auto-generated or provider-supplied | the login credential | yes (GoTrue-enforced) |
| password | provider | login | — |

## Design by layer

### 1. Database migration

`supabase/migrations/20260717000001_profiles_username_freeform_name.sql`
(idempotent, re-runnable via `db push`):

- Drop NOT NULL on `profiles.username` (`alter table ... alter column username drop not null;` — no-op if already nullable).
- Drop any UNIQUE constraint AND any UNIQUE index that covers only `profiles(username)`, via a `DO $$ … $$` block that reads `pg_constraint` (contype `u`) and `pg_indexes` and `execute`s the drops by discovered name (names are unknown because the table is Studio-managed).
- Header comment: username is now a freeform display **name**; uniqueness is
  removed because email-only login no longer reads it and duplicate names must
  be allowed.

RLS/grants unchanged. This migration only relaxes constraints — safe to apply
before the client ships (it does not break the current username-login path,
which is being removed in the same release).

### 2. `login` Edge Function → email-only

`supabase/functions/login/index.ts`:
- Request body becomes `{ email, password }` (accept legacy `usernameOrEmail`
  as an alias for one release for safety, treated verbatim as the email).
- Remove the `profiles` lookup branch entirely. `email = normalizeIdentifier(input)` (trim + lowercase only).
- Sign in with GoTrue (`signInWithPassword`) — already anti-enumeration for
  email. On success, `loadAccountStatus` → if inactive return the specific
  status (`ACCOUNT_EXPIRED` / `ACCOUNT_SUSPENDED` / `PROVIDER_SUSPENDED`), else
  return tokens.
- Keeps `verify_jwt = false` (still pre-auth).

`supabase/functions/_shared/loginLogic.js`:
- `normalizeIdentifier(input)` → returns the trimmed/lowercased string (drop the
  `isEmail` branch / username concept).
- `INVALID_CREDENTIALS` copy → `"Invalid email or password."`
- `mapSignInError` unchanged (still surfaces `email_not_confirmed`).

### 3. `admin` Edge Function + `adminLogic`

`supabase/functions/_shared/adminLogic.js`:
- `validateNewAccount`: replace the `username` field/regex with **`name`** —
  `String(input?.name ?? "").trim()`, valid when 1–60 chars and non-empty. Keep
  password (≥6), deviceLimit (int ≥1), line, expiry validation. Return
  `value.name`.
- `resolveEmail(slug, email, token)`: if `email` contains `@`, return it
  lowercased; else return `acc-${token}@${slug}.accounts.local`. The random
  `token` is generated in the impure layer and passed in, so the pure function
  stays deterministic/testable. `providerSlug` unchanged.

`supabase/functions/admin/index.ts`:
- `accounts.create`: use `v.value.name`; `token = crypto.randomUUID().replace(/-/g,"").slice(0,8)`;
  `email = resolveEmail(slug, payload.email, token)`. `profiles.upsert({ user_id, username: name, email }, { onConflict: "user_id" })` (the column stays `username`, now holding the name — safe now that uniqueness is dropped). If `createUser` fails on an email collision, retry once with a fresh token, then `CREATE_FAILED`. Audit meta `{ name, deviceLimit, expiresAt, lineType }` (no creds).
- `accounts.list` / `accounts.get`: keep reading `profiles.username`, but return
  the field as **`name`** (rename the response key). `accounts.list` search
  matches the name. `accounts.get` still returns `email` (the login email) and
  omits the line password.
- `accounts.update`: accept an optional `name` (1–60 chars) and, when present,
  write it to `profiles.username` (upsert on `user_id`). Existing expiresAt /
  suspended / note / deviceLimit handling unchanged. Error-check the writes
  (see security-review item; return `SERVER_ERROR` on failure rather than a
  silent `{ok:true}`).

### 4. `data` Edge Function — hardening (low-risk now)

`supabase/functions/data/index.ts` `profiles.upsert`: validate `username`
(now = name; 1–60 chars) and `email`, and error-check the write instead of
returning `{ok:true}` unconditionally. This is defense-in-depth — login no
longer reads `profiles.username`, so the former cross-tenant risk is already
gone. `profiles.fetch` unchanged.

### 5. Dashboard (`dashboard/`)

- **CreateAccount.tsx:** "Username" field → **"Name"** (freeform text, 1–60
  chars, `required`, drop the handle-regex hint). Email field keeps its
  "optional — auto-generated if left blank" helper. Payload sends `name`.
- **AccountDetail.tsx:** `AccountDetailData.username` → `name`. Header shows the
  name. Add an editable **Name** field in the Subscription card (saves via
  `accounts.update { name }`). Add a **Login email** row that shows `data.email`
  prominently with a copy-to-clipboard button (it is the credential to hand the
  customer). Delete-confirm types the **name**.
- **Accounts.tsx:** list column + search use `name`.
- **api.ts:** update the `CREATE_FAILED` copy if needed; no structural change.
- **Types/tests:** `username` → `name` in the screen types; update any vitest
  that references the field. `lib/format.ts`, `lib/linePayload.ts` unchanged.

### 6. RN app (`src/`)

- **services/supabase.js:** `signIn(email, password)` → invoke `login` with
  `{ email, password }`. `signUp(email, password)` drops the username metadata
  (registration is disabled in demo/reseller builds; kept email-only for a
  future Phase-2). `upsertProfile` retained (unused in shipped builds).
- **screens/AuthScreen.jsx:** rename the misleading `username` state → `email`;
  login mode already labels the field "Email". Register mode simplified to
  email + password (drop the username field + its regex). Error copy
  "Invalid username/email or password." → "Invalid email or password."
- **services/loginResult.logic.js** + **utils/authError.js** (if it carries the
  copy): update the credential error string to match.
- **context/AppContext.jsx:** the `meta?.username` branch (line ~473) becomes a
  no-op path; `fetchProfile` still populates `profile` (now `profile.username`
  holds the name). The lone display `profile?.username ?? authUser.email` shows
  the name for reseller accounts, else the email — no visible regression.

## Data flow (customer login, after change)

```
RN AuthScreen ("Email" + password)
  → supabase.signIn(email, password)
    → functions/login { email, password }
       → GoTrue signInWithPassword(email, password)   (anti-enumeration)
       → loadAccountStatus(user.id)                    (reseller gate)
         → inactive? return {ok:false, error: STATUS}
         → active?   return {ok:true, tokens}
    → auth.setSession(tokens)
  → claim-device (device gate) → data (device + status gate)
```

## Error handling

- Wrong email/password or unknown email → generic `"Invalid email or password."`
- Inactive reseller account → specific status string mapped to the locked screen.
- `accounts.create` email collision → retry once, then `CREATE_FAILED`.
- Admin write failures → `SERVER_ERROR` (no silent success).

## Testing

- **adminLogic.test.js:** `validateNewAccount` accepts/rejects names (empty, >60,
  whitespace-only); `resolveEmail` returns supplied email vs
  `acc-<token>@<slug>.accounts.local` for a given token.
- **loginLogic.test.js:** `normalizeIdentifier` trims/lowercases; error copy.
- **loginResult.test.js:** credential-error copy.
- **dashboard vitest:** name field validation / payload shape; format tests
  unaffected.
- **Migration:** SQL verified by review + owner `db push` (no Postgres in this
  env to execute). `node --test` + `vitest` must pass; `npm run lint` clean.

## Rollout / owner actions

1. `supabase db push` — applies the constraint-freeing migration.
2. Redeploy Edge Functions: `login`, `admin`, `data`.
3. Ship the RN client (all platforms) with email-only `signIn`.
4. Verify in Studio that `profiles.username` has no residual UNIQUE index after
   the migration (the `DO` block should have dropped it; confirm).
5. (Unchanged) the pending `revoke_table_grants.sql` sequence is independent of
   this change.

## Open items folded into the plan

- Exact `DO`-block SQL to discover + drop the unknown-named unique
  constraint/index on `profiles(username)`.
- Whether to keep the `usernameOrEmail` request alias for one release
  (recommended: yes, harmless, avoids a client/function deploy-order race).

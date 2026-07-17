# Email-only Login + Username→Name Label — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make app login email-only and turn the reseller "username" into a freeform, non-unique "name" label, with an auto-generated login email per customer.

**Architecture:** The `login` Edge Function drops the `profiles` username→email lookup and signs in by email (GoTrue is already anti-enumeration), keeping the reseller status gate. The reseller's label reuses the existing `profiles.username` column (Approach B) — a migration frees that column of UNIQUE/NOT-NULL so duplicate names are allowed. The `admin` function auto-generates `acc-<8hex>@<provider-slug>.accounts.local` when no email is supplied. Every layer above raw table access speaks `name`; the physical column keeps its legacy name `username`.

**Tech Stack:** Supabase Edge Functions (Deno + `esm.sh` supabase-js), pure `_shared/*.js` logic (runs under Deno and `node:test`), Postgres migrations, standalone Vite + React + TS dashboard (vitest), Expo/React Native app (JS, `node:test`).

## Global Constraints

- **Credential error copy (verbatim):** `Invalid email or password.`
- **Name field:** freeform, trimmed, length **1–60**, non-empty. No charset restriction.
- **Auto-generated login email format (verbatim):** `acc-<token>@<provider-slug>.accounts.local`, where `<token>` = `crypto.randomUUID().replace(/-/g, "").slice(0, 8)`.
- **Physical DB column stays `username`** — do NOT rename the column. It now holds the name. The low-level `data` fn keeps the `username` payload key.
- **Do NOT touch the IPTV line username** (`src/services/iptvApi.js`, `AccountsScreen*`, `line.username`) — it's the upstream Xtream credential.
- **Pure `_shared/*.js` modules:** no imports, no I/O (must load under both Deno and `node:test`). Randomness/time is passed in, never generated inside pure functions.
- **JS only** in `src/` (`.js`/`.jsx`), TS in `dashboard/`.
- **Before each commit:** root `npm test` + `npm run lint` must pass (warnings OK, errors not). Dashboard changes also run `cd dashboard && npm test && npm run build`.
- Test files sit next to source as `*.test.js`; `node:test`, not Jest.

---

### Task 1: Migration — free `profiles.username` of UNIQUE / NOT NULL

**Files:**
- Create: `supabase/migrations/20260717000001_profiles_username_freeform_name.sql`

**Interfaces:**
- Produces: a `profiles.username` column that is nullable and carries no single-column UNIQUE constraint/index — the precondition for storing duplicate freeform names.

- [ ] **Step 1: Write the migration**

```sql
-- profiles.username is now a freeform display NAME, not a login key. Email-only
-- login (the `login` Edge Function) no longer reads it, so its uniqueness is both
-- unnecessary AND harmful: duplicate names must be allowed. Free the column by
-- dropping any single-column UNIQUE constraint / UNIQUE index on `username` and
-- its NOT NULL. Idempotent + re-runnable (catalog-driven, drop-if-exists).
-- The table is Studio-managed, so constraint/index names are unknown here.
begin;

-- 1. Drop UNIQUE *constraints* whose single key column is `username`.
do $$
declare
  c record;
  uname_attnum smallint;
begin
  select attnum into uname_attnum
  from pg_attribute
  where attrelid = 'public.profiles'::regclass
    and attname = 'username' and not attisdropped;

  if uname_attnum is not null then
    for c in
      select conname
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'u'
        and conkey = array[uname_attnum]
    loop
      execute format('alter table public.profiles drop constraint %I', c.conname);
    end loop;
  end if;
end $$;

-- 2. Drop single-column UNIQUE *indexes* on `username` not backed by a constraint.
do $$
declare i record;
begin
  for i in
    select pg_index.indexrelid::regclass::text as idx
    from pg_index
    where pg_index.indrelid = 'public.profiles'::regclass
      and pg_index.indisunique
      and pg_index.indnatts = 1
      and not pg_index.indisprimary
      and pg_index.indkey[0] = (
        select attnum from pg_attribute
        where attrelid = 'public.profiles'::regclass
          and attname = 'username' and not attisdropped
      )
  loop
    execute format('drop index if exists %s', i.idx);
  end loop;
end $$;

-- 3. Allow NULL (no-op if already nullable).
alter table public.profiles alter column username drop not null;

commit;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `grep -c "do \$\$" supabase/migrations/20260717000001_profiles_username_freeform_name.sql`
Expected: `2` (two DO blocks). (No local Postgres in this env; the owner applies via `supabase db push` at rollout — Task 12.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260717000001_profiles_username_freeform_name.sql
git commit -m "feat(db): free profiles.username of unique/not-null (freeform name)"
```

---

### Task 2: `loginLogic.js` — email-only normalize + credential copy

**Files:**
- Modify: `supabase/functions/_shared/loginLogic.js`
- Test: `supabase/functions/_shared/loginLogic.test.js`

**Interfaces:**
- Produces: `INVALID_CREDENTIALS` (string `"Invalid email or password."`), `normalizeEmail(input) → string`, `mapSignInError(error) → string|null`. **Removes** `normalizeIdentifier`.

- [ ] **Step 1: Replace the test file contents** (mirror the ESM `import` style already used by the sibling `accountStatus.test.js`/`adminLogic.test.js`)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { INVALID_CREDENTIALS, normalizeEmail, mapSignInError } from "./loginLogic.js";

test("INVALID_CREDENTIALS is the generic email/password message", () => {
  assert.equal(INVALID_CREDENTIALS, "Invalid email or password.");
});

test("normalizeEmail trims and lowercases; tolerates nullish", () => {
  assert.equal(normalizeEmail("  John@Example.COM "), "john@example.com");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(null), "");
});

test("mapSignInError: null passthrough, email_not_confirmed surfaced, else generic", () => {
  assert.equal(mapSignInError(null), null);
  assert.match(mapSignInError({ code: "email_not_confirmed" }), /not confirmed/i);
  assert.equal(mapSignInError({ code: "invalid_grant" }), INVALID_CREDENTIALS);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/functions/_shared/loginLogic.test.js`
Expected: FAIL — `normalizeEmail` is not exported yet / copy mismatch.

- [ ] **Step 3: Rewrite `loginLogic.js`**

```js
// Pure helpers for the `login` Edge Function. No I/O and no imports, so they run
// under both the Deno edge runtime and node:test.

// Single generic credential error, used for BOTH "no such email" and "wrong
// password" so the endpoint never reveals which accounts exist (anti-enumeration).
export const INVALID_CREDENTIALS = "Invalid email or password.";

// Trim + lowercase the login email. Login is email-only; there is no
// username→email resolution anymore.
export function normalizeEmail(input) {
  return String(input ?? "").trim().toLowerCase();
}

// Map a GoTrue signInWithPassword error to a client-safe message. Only
// "email_not_confirmed" is surfaced distinctly (it helps a legitimate user and
// leaks nothing an attacker can act on); every other failure collapses to the
// generic INVALID_CREDENTIALS.
export function mapSignInError(error) {
  if (!error) return null;
  if (error.code === "email_not_confirmed") {
    return "Your email is not confirmed. Please check your inbox and confirm your account.";
  }
  return INVALID_CREDENTIALS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/functions/_shared/loginLogic.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/loginLogic.js supabase/functions/_shared/loginLogic.test.js
git commit -m "feat(login): email-only normalize + 'Invalid email or password.' copy"
```

---

### Task 3: `login/index.ts` — sign in by email, drop profiles lookup

**Files:**
- Modify: `supabase/functions/login/index.ts`

**Interfaces:**
- Consumes: `normalizeEmail`, `INVALID_CREDENTIALS`, `mapSignInError` (Task 2); `adminClient`, `json`, `corsPreflight`, `loadAccountStatus` (deviceGate); `isActive` (accountStatus).
- Produces: `POST` accepting `{ email, password }` (or legacy `{ usernameOrEmail, password }` alias); returns `{ ok:true, access_token, refresh_token }` or `{ ok:false, error }`.

- [ ] **Step 1: Rewrite the handler**

```ts
// login: sign in by EMAIL (email-only) and apply the reseller account-status
// gate. The client never reads the profiles table; there is no username→email
// resolution — login is email + password. GoTrue is already anti-enumeration for
// email login, so an unknown email is indistinguishable from a wrong password.
//
// verify_jwt = false (see supabase/config.toml) — the caller is not yet
// authenticated. Expected auth OUTCOMES return HTTP 200 with an { ok } body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { isActive } from "../_shared/accountStatus.js";
import { INVALID_CREDENTIALS, normalizeEmail, mapSignInError } from "../_shared/loginLogic.js";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    // Accept { email } (new) or { usernameOrEmail } (legacy alias — treated
    // verbatim as the email) so a client/function deploy-order skew can't break login.
    const rawEmail = body.email ?? body.usernameOrEmail;
    const password = body.password;
    if (!rawEmail || !password) {
      return json({ ok: false, error: INVALID_CREDENTIALS });
    }
    const email = normalizeEmail(rawEmail);

    // A fresh anon client (no Authorization header) runs the password check
    // against GoTrue. Never use the service-role key to sign in.
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: signIn, error: signInError } =
      await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      return json({ ok: false, error: mapSignInError(signInError) ?? INVALID_CREDENTIALS });
    }

    // Reseller gate: the password is correct, so the account provably exists —
    // safe to return a SPECIFIC status (no enumeration leak).
    const status = await loadAccountStatus(adminClient(), signIn.session.user.id);
    if (!isActive(status)) {
      return json({ ok: false, error: status }); // ACCOUNT_EXPIRED | ACCOUNT_SUSPENDED | PROVIDER_SUSPENDED
    }

    return json({
      ok: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (_e) {
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Verify no lingering username-lookup references**

Run: `grep -nE "profiles|username|isEmail|normalizeIdentifier" supabase/functions/login/index.ts`
Expected: no matches (empty output).

- [ ] **Step 3: Verify the whole edge test suite still loads/passes**

Run: `node --test supabase`
Expected: PASS (no regressions; Deno `index.ts` isn't unit-run here — the pure logic it imports is covered by Task 2).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/login/index.ts
git commit -m "feat(login): sign in by email; remove profiles username lookup"
```

---

### Task 4: `adminLogic.js` — `name` validation + `resolveEmail(slug, email, token)`

**Files:**
- Modify: `supabase/functions/_shared/adminLogic.js`
- Test: `supabase/functions/_shared/adminLogic.test.js`

**Interfaces:**
- Produces: `validateNewAccount(input)` now validates/returns `name` (1–60, trimmed) instead of `username`; `value = { name, password, deviceLimit, expiresAt, line }`. `resolveEmail(slug, email, token)` → supplied email lowercased if it contains `@`, else `acc-${token}@${slug}.accounts.local`. `providerSlug`, `validateLine`, role/quota exports unchanged.

- [ ] **Step 1: Add/replace tests** (append these; delete any existing `username`-based `validateNewAccount` cases and the old 3-arg `resolveEmail` cases)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateNewAccount, resolveEmail } from "./adminLogic.js";

test("validateNewAccount accepts a freeform 1–60 char name", () => {
  const r = validateNewAccount({
    name: "  John — living room  ",
    password: "secret6",
    deviceLimit: 2,
    line: { type: "m3u", url: "http://x/y.m3u" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, "John — living room");
});

test("validateNewAccount rejects empty / >60 char name", () => {
  assert.deepEqual(validateNewAccount({ name: "   ", password: "secret6", deviceLimit: 1, line: { type: "m3u", url: "http://x" } }).errors.includes("name"), true);
  assert.deepEqual(validateNewAccount({ name: "x".repeat(61), password: "secret6", deviceLimit: 1, line: { type: "m3u", url: "http://x" } }).errors.includes("name"), true);
});

test("resolveEmail uses a supplied email (lowercased) when it has @", () => {
  assert.equal(resolveEmail("acme", "Me@Example.com", "deadbeef"), "me@example.com");
});

test("resolveEmail auto-generates acc-<token>@<slug>.accounts.local otherwise", () => {
  assert.equal(resolveEmail("acme", "", "deadbeef"), "acc-deadbeef@acme.accounts.local");
  assert.equal(resolveEmail("acme", undefined, "deadbeef"), "acc-deadbeef@acme.accounts.local");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: FAIL — `name`/token behavior not implemented.

- [ ] **Step 3: Edit `validateNewAccount` and `resolveEmail`**

Replace the `validateNewAccount` body's username block and the `resolveEmail` function with:

```js
export function validateNewAccount(input) {
  const errors = [];
  const name = String(input?.name ?? "").trim();
  const password = String(input?.password ?? "");
  const deviceLimit = Number(input?.deviceLimit);
  if (name.length < 1 || name.length > 60) errors.push("name");
  // Mirrors supabase/config.toml's minimum_password_length = 6.
  if (password.length < 6) errors.push("password");
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) errors.push("deviceLimit");

  const line = validateLine(input?.line);
  if (!line.ok) errors.push("line");

  let expiresAt = null;
  if (input?.expiresAt != null && input.expiresAt !== "") {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) errors.push("expiresAt");
    else expiresAt = new Date(t).toISOString();
  }

  return {
    ok: errors.length === 0,
    errors,
    value: { name, password, deviceLimit, expiresAt, line: line.value },
  };
}
```

```js
// Resolve the login email. A provider-supplied email (with @) wins; otherwise
// auto-generate acc-<token>@<slug>.accounts.local. `token` is generated by the
// caller (impure layer) so this stays pure/deterministic. The name is NOT used
// as a localpart — it is a freeform label that may contain spaces/punctuation.
export function resolveEmail(slug, email, token) {
  const e = String(email ?? "").trim().toLowerCase();
  if (e.includes("@")) return e;
  return `acc-${token}@${slug}.accounts.local`;
}
```

(`providerSlug` is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/adminLogic.js supabase/functions/_shared/adminLogic.test.js
git commit -m "feat(admin): validate freeform name; resolveEmail auto-gens acc-<token>@slug"
```

---

### Task 5: `admin/index.ts` — create/list/get/update speak `name` + auto-email + error-checks

**Files:**
- Modify: `supabase/functions/admin/index.ts`

**Interfaces:**
- Consumes: `validateNewAccount` (returns `value.name`), `resolveEmail(slug, email, token)`, `providerSlug` (Task 4).
- Produces: `accounts.create` accepts `{ name, ... }`; `accounts.list`/`accounts.get` return the field as `name`; `accounts.update` accepts optional `name`; `accounts.list` search matches name.

- [ ] **Step 1: `accounts.create` — use name, auto-email with one retry, store name in profiles.username**

Replace the create block (from `const v = validateNewAccount(payload);` through the auth-user creation) so the email is generated and `createUser` retries once on collision:

```ts
      case "accounts.create": {
        const v = validateNewAccount(payload);
        if (!v.ok) return json({ error: "INVALID_INPUT", fields: v.errors }, 400);

        // Quota (super-admin exempt). used = ALL of the provider's accounts.
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", userId);
        if (!withinQuota(count ?? 0, row.max_accounts, row.role)) {
          return json({ error: "QUOTA_EXCEEDED" }, 409);
        }

        const slug = providerSlug(row.name, userId);
        const genToken = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
        const suppliedEmail = String(payload.email ?? "").trim().toLowerCase();

        // 1. auth user. Auto-generated emails can (astronomically rarely) collide;
        // retry once with a fresh token. A provider-supplied email does not retry
        // (a real dup should surface as CREATE_FAILED).
        let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | null = null;
        let email = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          email = resolveEmail(slug, suppliedEmail, genToken());
          const res = await admin.auth.admin.createUser({
            email,
            password: v.value.password,
            email_confirm: true,
            user_metadata: { name: v.value.name },
          });
          if (!res.error && res.data.user) { created = res.data; break; }
          if (suppliedEmail.includes("@")) break; // don't retry a real supplied email
        }
        if (!created?.user) return json({ error: "CREATE_FAILED" }, 400);
        const newId = created.user.id;
```

Then in the same block, update the `profiles.upsert` to store the name in the `username` column (physical column unchanged):

```ts
          // 2. profiles (holds the display NAME in the legacy `username` column + email)
          const { error: profErr } = await admin.from("profiles").upsert(
            { user_id: newId, username: v.value.name, email },
            { onConflict: "user_id" },
          );
          if (profErr) throw profErr;
```

And update the audit call to log `name` (never creds):

```ts
        await audit(admin, userId, "account.create", newId, {
          name: v.value.name,
          deviceLimit: v.value.deviceLimit,
          expiresAt: v.value.expiresAt,
          lineType: v.value.line.type,
        });
        return json({ userId: newId });
```

- [ ] **Step 2: `accounts.list` — return `name`, search by name**

Replace the per-row username handling:

```ts
        const out = [];
        for (const a of accts ?? []) {
          const { data: prof } = await admin
            .from("profiles").select("username").eq("user_id", a.user_id).maybeSingle();
          const name = prof?.username ?? "";
          if (search && !name.toLowerCase().includes(search)) continue;
          const { count: devicesUsed } = await admin
            .from("device_bindings")
            .select("device_id", { count: "exact", head: true })
            .eq("user_id", a.user_id);
          const { data: lim } = await admin
            .from("device_limits").select("device_limit").eq("user_id", a.user_id).maybeSingle();
          const status = await loadAccountStatus(admin, a.user_id);
          out.push({
            userId: a.user_id,
            name,
            status,
            expiresAt: a.expires_at,
            suspended: a.suspended,
            devicesUsed: devicesUsed ?? 0,
            deviceLimit: lim?.device_limit ?? null,
            note: a.note,
          });
        }
        return json(out);
```

- [ ] **Step 3: `accounts.get` — return `name` (was `username`)**

Change the returned object key:

```ts
        return json({
          userId: target,
          name: prof?.username ?? "",
          email: prof?.email ?? "",
          status,
          expiresAt: acct?.expires_at ?? null,
          suspended: acct?.suspended ?? false,
          note: acct?.note ?? null,
          deviceLimit: lim?.device_limit ?? null,
          line: line ?? null, // password intentionally omitted from reads
        });
```

- [ ] **Step 4: `accounts.update` — accept optional `name`, error-check writes**

Insert name handling and add error checks in the update block:

```ts
        // name (display label) → stored in the legacy profiles.username column
        if (payload.name !== undefined) {
          const nm = String(payload.name).trim();
          if (nm.length < 1 || nm.length > 60) return json({ error: "INVALID_INPUT" }, 400);
          const { error: nErr } = await admin.from("profiles").update({ username: nm }).eq("user_id", target);
          if (nErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        if (Object.keys(acctPatch).length > 0) {
          const { error: uErr } = await admin.from("customer_accounts").update(acctPatch).eq("user_id", target);
          if (uErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        if (dl !== undefined) {
          const { error: dErr } = await admin.from("device_limits").upsert({ user_id: target, device_limit: dl }, { onConflict: "user_id" });
          if (dErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        await audit(admin, userId, "account.update", target, { ...acctPatch, name: payload.name, deviceLimit: payload.deviceLimit });
        return json({ ok: true });
```

- [ ] **Step 5: Verify no `username` key remains in admin responses/logic**

Run: `grep -nE "\busername\b" supabase/functions/admin/index.ts`
Expected: only the physical-column references (`.select("username")`, `.update({ username: nm })`, `username: v.value.name`); NO response keys named `username` and NO `v.value.username`.

- [ ] **Step 6: Run edge suite + commit**

Run: `node --test supabase`
Expected: PASS.

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(admin): name label + auto-gen login email; error-check writes"
```

---

### Task 6: `data/index.ts` — harden `profiles.upsert`

**Files:**
- Modify: `supabase/functions/data/index.ts:38-43`

**Interfaces:**
- Produces: `profiles.upsert` validates the name (1–60) and error-checks the write.

- [ ] **Step 1: Replace the `profiles.upsert` case**

```ts
      case "profiles.upsert": {
        // `username` is the legacy physical column that now holds the display name.
        const name = String(payload.username ?? "").trim();
        if (name.length < 1 || name.length > 60) return json({ error: "INVALID_INPUT" }, 400);
        const { error } = await db("profiles").upsert(
          { user_id: userId, username: name, email: payload.email },
          { onConflict: "user_id" },
        );
        if (error) return json({ error: "SERVER_ERROR" }, 500);
        return json({ ok: true });
      }
```

- [ ] **Step 2: Run edge suite + commit**

Run: `node --test supabase`
Expected: PASS.

```bash
git add supabase/functions/data/index.ts
git commit -m "fix(data): validate + error-check profiles.upsert (name)"
```

---

### Task 7: Dashboard — CreateAccount "Username" → "Name"

**Files:**
- Modify: `dashboard/src/screens/CreateAccount.tsx`

**Interfaces:**
- Produces: create form posts `{ name, ... }` (was `username`).

- [ ] **Step 1: Rename the field and its state/validation**

- Rename state: `const [username, setUsername] = useState("")` → `const [name, setName] = useState("")`.
- In `handleSubmit`, change the payload key `username: username.trim()` → `name: name.trim()`.
- Replace the field block:

```tsx
        <Field label="Name" error={fieldError("name", "Name is required (max 60 characters).")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            required
            maxLength={60}
          />
        </Field>
```

- Update the Email field helper to make clear it becomes the login: label `"Email (optional — a login email is auto-generated if left blank)"`.

- [ ] **Step 2: Build + test**

Run: `cd dashboard && npm run build && npm test`
Expected: PASS (tsc clean, vitest green).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/screens/CreateAccount.tsx
git commit -m "feat(dashboard): CreateAccount uses freeform Name field"
```

---

### Task 8: Dashboard — AccountDetail name + login-email copy + delete-by-name

**Files:**
- Modify: `dashboard/src/screens/AccountDetail.tsx`

**Interfaces:**
- Consumes: `accounts.get` now returns `name` (Task 5).
- Produces: editable name (via `accounts.update { name }`), a prominent copyable login email, delete-confirm typed against the name.

- [ ] **Step 1: Update the type + header**

- In `AccountDetailData`, rename `username: string` → `name: string`.
- Header: `<h1>{data.username}</h1>` → `<h1>{data.name}</h1>`.

- [ ] **Step 2: Add a Login-email row with copy, and a Name editor, to `SubscriptionCard`**

Add near the top of the `SubscriptionCard` return (below `<h2>Subscription</h2>`):

```tsx
      <div className="card-row">
        <Field label="Login email">
          <input value={data.email} readOnly onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(data.email)}>
          Copy
        </Button>
      </div>

      <div className="card-row">
        <Field label="Name">
          <input value={nameDraft} maxLength={60} onChange={(e) => setNameDraft(e.target.value)} />
        </Field>
        <Button
          disabled={savingName || nameDraft.trim().length < 1}
          onClick={() => run(setSavingName, { name: nameDraft.trim() })}
        >
          {savingName ? "Saving…" : "Save name"}
        </Button>
      </div>
```

Add the supporting state + effect in `SubscriptionCard` (alongside the existing drafts):

```tsx
  const [nameDraft, setNameDraft] = useState(data.name ?? "");
  const [savingName, setSavingName] = useState(false);
```

And extend the existing sync `useEffect` deps/body to reset `nameDraft`:

```tsx
  useEffect(() => {
    setDeviceLimitDraft(data.deviceLimit != null ? String(data.deviceLimit) : "");
    setNoteDraft(data.note ?? "");
    setNameDraft(data.name ?? "");
  }, [data.deviceLimit, data.note, data.name]);
```

- [ ] **Step 3: Delete-confirm against the name**

In `DangerZone`, replace the two `data.username` references (the `<strong>` and the disabled-check) with `data.name`, and update the prompt/field label text from "username" to "name":

```tsx
          <p>
            This permanently deletes <strong>{data.name}</strong> and all of its devices and history. Type the
            name to confirm.
          </p>
          <Field label="Name">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
```
```tsx
            <Button variant="danger" disabled={deleting || confirmText !== data.name} onClick={handleDelete}>
```

- [ ] **Step 4: Build + test**

Run: `cd dashboard && npm run build && npm test`
Expected: PASS (tsc will flag any missed `data.username` — fix until clean).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/screens/AccountDetail.tsx
git commit -m "feat(dashboard): AccountDetail name label + copyable login email"
```

---

### Task 9: Dashboard — Accounts list column + search use `name`

**Files:**
- Modify: `dashboard/src/screens/Accounts.tsx`

- [ ] **Step 1: Rename the type field, column, and search copy**

- `type Account`: rename `username: string` → `name: string`.
- First column: `{ key: "username", header: "Username" }` → `{ key: "name", header: "Name" }`.
- Search input `placeholder="Search by username…"` → `placeholder="Search by name…"`.

- [ ] **Step 2: Build + test**

Run: `cd dashboard && npm run build && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/screens/Accounts.tsx
git commit -m "feat(dashboard): Accounts list shows Name column + search-by-name"
```

---

### Task 10: RN app — email-only client (`supabase.js`, `loginResult.logic.js`)

**Files:**
- Modify: `src/services/supabase.js`
- Modify: `src/services/loginResult.logic.js`
- Test: `src/services/loginResult.test.js`

**Interfaces:**
- Produces: `signIn(email, password)` invokes `login` with `{ email, password }`; `signUp(email, password)` (no username metadata); credential error copy `"Invalid email or password."`.

- [ ] **Step 1: Update `loginResult.test.js` copy expectations**

Change the two regexes `/invalid username\/email or password/i` → `/invalid email or password/i` (and any literal `"Invalid username/email or password."` → `"Invalid email or password."`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/loginResult.test.js`
Expected: FAIL — copy mismatch.

- [ ] **Step 3: Update `loginResult.logic.js` copy**

Replace both occurrences of `"Invalid username/email or password."` with `"Invalid email or password."`.

- [ ] **Step 4: Update `supabase.js` `signIn`/`signUp`**

```js
export async function signUp(email, password) {
  const { data, error } = await client().auth.signUp({
    email: email.toLowerCase(),
    password,
  });
  if (error) {
    if (error.message?.toLowerCase().includes("rate limit"))
      throw new Error("Too many sign-up attempts. Please wait a few minutes and try again.");
    throw new Error(error.message);
  }
  return data.user;
}

export async function signIn(email, password) {
  if (!client()) throw new Error("Supabase not configured");
  // Email-only login. The password check + reseller status gate run server-side
  // in the `login` Edge Function (verify_jwt=false); the client never reads profiles.
  const res = await client().functions.invoke("login", {
    body: { email, password },
  });
  const { access_token, refresh_token } = mapLoginResult(res);
  const { data, error } = await client().auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(error.message);
  return data.user;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test src/services/loginResult.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/supabase.js src/services/loginResult.logic.js src/services/loginResult.test.js
git commit -m "feat(app): email-only signIn/signUp; 'Invalid email or password.' copy"
```

---

### Task 11: RN app — AuthScreen email-only + AppContext cleanup

**Files:**
- Modify: `src/screens/AuthScreen.jsx`
- Modify: `src/context/AppContext.jsx:470-482`

**Interfaces:**
- Consumes: `signIn(email, password)`, `signUp(email, password)` (Task 10).

- [ ] **Step 1: AuthScreen — rename state, email-only register, fix copy**

- Rename state `const [username, setUsername] = useState("")` → `const [email, setEmail] = useState("")`; drop the separate `const [email, setEmail]` for register (login and register now both use `email`) — keep a single `email` field. Remove the `username` field block and its regex validation.
- Field label is always "Email"; placeholder `"you@example.com"`. Remove the `mode === "register"` "Username" label branch.
- `handleSubmit`: guard `if (!email.trim() || !password)` with message `"Email and password are required."`; register calls `await signUp(email.trim(), password); await signIn(email.trim(), password);`; login calls `await signIn(email.trim(), password)`.
- Error mapping: change the `invalid login credentials` branch message to `"Invalid email or password."`.
- Update the `useEffect` key handler deps: replace `username` with `email` (remove the now-unused second email var from deps).

- [ ] **Step 2: AppContext — drop the username-metadata branch**

Replace the `meta?.username` block (~lines 471-481) so it always fetches the profile (no username from signup metadata):

```jsx
      const authUser = user;
      if (authUser) {
        fetchProfile(authUser.id).then((p) => { if (p) setProfile(p); }).catch(() => {});
      }
```

(Keep whatever surrounding structure exists; only remove the `if (meta?.username) { setProfile(...); upsertProfile(...) } else { ... }` split — read lines 465-485 first and preserve the outer logic.)

- [ ] **Step 3: Full app test + lint**

Run: `npm test && npm run lint`
Expected: PASS (lint errors = 0; warnings OK).

- [ ] **Step 4: Verify no account-username left in the login/register UI**

Run: `grep -nE "your_username|Username|username" src/screens/AuthScreen.jsx`
Expected: no matches (the IPTV-line username lives in `AccountsScreen`, not here).

- [ ] **Step 5: Commit**

```bash
git add src/screens/AuthScreen.jsx src/context/AppContext.jsx
git commit -m "feat(app): email-only AuthScreen; drop signup username metadata"
```

---

### Task 12: Rollout notes + owner checklist

**Files:**
- Modify: `supabase/README.md` (append a short "Email-only login / name label" rollout note)

- [ ] **Step 1: Document the rollout sequence**

Append to `supabase/README.md`:

```markdown
## Email-only login + name label (2026-07-17)

1. `supabase db push` — applies `20260717000001_profiles_username_freeform_name.sql`
   (frees `profiles.username` of UNIQUE/NOT NULL; it now holds a freeform name).
2. Redeploy Edge Functions: `login`, `admin`, `data`.
3. Ship the client (all platforms) with email-only `signIn`.
4. Verify in Studio: `profiles.username` has no residual single-column UNIQUE index.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/README.md
git commit -m "docs(supabase): rollout notes for email-only login + name label"
```

---

## Self-Review

**Spec coverage:**
- Migration freeing `profiles.username` → Task 1 ✅
- Login email-only + copy → Tasks 2, 3, 10 ✅
- `name` validation + auto-gen email → Task 4 ✅
- admin create/list/get/update speak `name` + error-checks → Task 5 ✅
- `data.profiles.upsert` hardening → Task 6 ✅
- Dashboard Create/Detail/List + login-email copy → Tasks 7, 8, 9 ✅
- RN client + AuthScreen + AppContext → Tasks 10, 11 ✅
- Rollout/owner actions → Task 12 ✅
- Out of scope (IPTV line username, physical column rename, Phase 2) — untouched ✅

**Type consistency:** `name` is the response/UI field everywhere (admin responses, dashboard types, create payload); the physical column + low-level `data` payload key stay `username` by design (documented). `validateNewAccount().value.name`, `resolveEmail(slug, email, token)` signatures match every call site.

**Placeholder scan:** none — every code step carries full content; Task 11 Step 2 instructs reading `AppContext.jsx:465-485` before editing because the exact surrounding lines weren't quoted (structural, not a placeholder).

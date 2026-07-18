# Dashboard multi-line per customer + self-add toggle — Design

**Date:** 2026-07-18
**Status:** Approved (design)
**Branch:** `feat/dashboard-multi-line-self-add`

## Problem

Two related gaps in the reseller/admin dashboard:

1. **One line per customer.** The dashboard treats every customer account as
   having exactly one IPTV line. `accounts.create` inserts a single line
   (`admin/index.ts:228-238`), `accounts.get` reads only the first line
   (`admin/index.ts:357-360`, `limit(1)`), and `accounts.updateLine` edits only
   that first line (`admin/index.ts:435-447`). A provider cannot give a customer
   more than one line from the dashboard, even though the underlying
   `iptv_accounts` table is keyed by `user_id` and already supports many rows
   per user.

2. **No control over customer self-add.** A logged-in customer can add their own
   IPTV line in the app (AccountsScreen "Add account" → `addUser` →
   `insertIptvAccount` → `data`/`iptv.insert`, `AppContext.jsx:199-211`,
   `supabase.js:145-148`). There is no per-customer switch to allow or forbid
   this. A reseller who wants customers locked to the lines they were given has
   no way to enforce it.

**Goal:** let a provider (a) attach multiple IPTV lines to one customer login
from the dashboard — in both the create form and the account detail page — and
(b) control per-customer whether that customer may add their own lines in the
app.

## Product decisions (from brainstorming)

1. **Scope of "multiple accounts":** multiple **IPTV lines per one customer
   login** — not more customer logins (that already works).
2. **Self-add control:** a **per-customer** toggle, **default OFF**.
3. **Backfill rule for the new toggle at ship time:**
   - All **existing** customers (any origin) → **allowed** (`true`) — today
     there is no gate, so this preserves current behavior for anyone already
     relying on self-add.
   - Future **self-signup** customers → **allowed** (`true`) — self-service is
     their whole model.
   - Future **provider-created** customers → **not allowed** (`false`).
4. **Line editor placement:** full multi-line editor in **both** the create form
   and the account detail page.

## Key architectural facts this design relies on

- `iptv_accounts` is keyed by `user_id` (+ `profile_id`); **many rows per user
  already work**. The app's local `users` array already renders and syncs a list
  (AccountsScreen FlatList; `iptv.list`/`insert`/`update`/`delete` in
  `data/index.ts:103-165`). No new table is needed.
- The app **never writes `iptv_accounts` directly** — it calls the **`data`**
  Edge Function, which runs service-role after JWT + device + entitlement gates
  (`data/index.ts:29-47`). So the self-add path is gateable server-side.
- Provider-created accounts go through the **`admin`** Edge Function
  (`accounts.create`), which already inserts a `customer_accounts` row
  (`origin='provider'`). The app path (`data`) and provider path (`admin`) never
  collide.
- Entitlements (`entitlements`), device limits (`device_limits`), and device
  bindings are **per auth-user**, not per line. Therefore **all lines under one
  customer share one login, one expiry, and one device pool.** Lines are not
  independently billable — this is a deliberate, stated consequence.
- The dashboard is the **only** consumer of the `admin` function; it is shipped
  in lockstep, so response-shape changes (`line` → `lines`) are safe as long as
  both move together. We still keep `accounts.create` accepting a legacy single
  `line` by normalizing it into a one-element `lines` array (cheap
  defensiveness).

## Data model

One new column (migration `20260718000006_customer_account_allow_self_lines.sql`):

```sql
alter table public.customer_accounts
  add column if not exists allow_self_lines boolean not null default false;

-- Backfill: existing customers keep the ability they have today.
update public.customer_accounts set allow_self_lines = true;
```

- **Column default `false`** is the new-provider-customer default.
- `adopt_self_signup_account(uuid)` (migration `20260718000003`) is updated via
  `create or replace` in the same migration to set `allow_self_lines = true` on
  the `customer_accounts` row it upserts, so **future self-signups** can self-add.
- `accounts.create` inserts `allow_self_lines: false` explicitly (documents
  intent even though the column default already gives `false`).

Migration is idempotent (`add column if not exists`; the backfill `UPDATE` is
safe to re-run because the create/adopt paths set the correct value going
forward, and re-running only re-sets existing rows to `true` — see Rollback).
Ships with a JS guardrail test in the migrations dir, matching
`20260718000002/3/4`.

> **Backfill re-run caveat (documented, accepted):** the blanket
> `update … set allow_self_lines = true` sets *every* existing row to `true`,
> so a second `db push` after providers have manually turned some customers OFF
> would re-enable them. The migration is one-shot by convention (same as the
> `000002` backfill); the header notes "run once — do not re-apply after
> go-live edits." Not guarded in-SQL to keep it simple.

## Feature 1 — Multiple lines per customer

### `admin` Edge Function (`supabase/functions/admin/index.ts`)

- **`accounts.create`** — accept `lines: LineInput[]` (≥1). Loop-insert each
  line under the customer's default `app_profile`. `validateNewAccount`
  (pure, `_shared/adminLogic.js`) validates the array and normalizes a legacy
  single `line` → `[line]`. Rollback-on-failure behavior is unchanged (any line
  insert error still deletes the just-created auth user).
- **`accounts.get`** — return `lines: [...]` (all rows for the user, ordered by
  `created_at`, **passwords omitted** as today) instead of a single `line`.
  Also return `allowSelfLines: boolean`.
- **`accounts.addLine`** (new) — validate a single line, insert it under the
  target user's default `app_profile`. Provider-isolation check
  (`canActOnAccount`) as every other account action. Audit `account.addLine`
  (line type only, never creds).
- **`accounts.updateLine`** (generalized) — now takes a line **`id`** and
  updates that specific row (`.eq("id", id).eq("user_id", target)`), instead of
  "the first line by created_at". Audit `account.updateLine`.
- **`accounts.deleteLine`** (new) — delete a specific line by `id` scoped to the
  target user. Audit `account.deleteLine`.
  - **Minimum-lines rule:** deleting is always allowed, including the last line.
    A customer with zero lines simply has nothing to stream until one is added;
    the entitlement/status gates are independent of line count. (Chosen for
    simplicity; no "can't delete last line" guard.)

### Dashboard (`dashboard/`)

- **`CreateAccount.tsx`** — replace the single line section with a repeatable
  list of line blocks (each: Xtream/M3U toggle, Host, Line username, Line
  password, Nickname), plus "Add another line" and per-block remove (min 1).
  Submit sends `lines: [...]`.
- **`AccountDetail.tsx`** — replace the single-line editor with an "IPTV lines"
  section: list each line (masked), per-line **Edit** / **Delete**, and an
  **Add line** button. Wire to `accounts.addLine` / `accounts.updateLine(id)` /
  `accounts.deleteLine` and re-fetch via `accounts.get`.
- **`lib/linePayload.ts`** — extend/keep the line-normalization helper for an
  array of lines; unit-tested.

### Quota

Unchanged. Provider `max_accounts` counts **customer accounts**
(`customer_accounts` rows), not lines. Multiple lines do not consume quota.

## Feature 2 — Self-add toggle + enforcement

### Server gate (authoritative)

In `data`/`iptv.insert` (`data/index.ts:121`), **before** inserting:

1. Load the caller's `customer_accounts.allow_self_lines`.
2. If a row exists **and** `allow_self_lines = false` → return
   `{ error: "SELF_ADD_DISABLED" }` with HTTP **403**; do **not** insert and do
   **not** run adoption (the row already exists — it's a locked provider
   customer).
3. If **no row** (legacy / edge; public signup is off so this is rare) **or**
   `allow_self_lines = true` → proceed with insert + the existing best-effort
   `adopt_self_signup_account` call (unchanged).

This fails closed against a patched client: even if the app hides the button, a
direct `iptv.insert` call for a locked customer gets the 403.

`iptv.update` / `iptv.delete` are **not** gated by this flag — the toggle governs
*adding* lines, not editing/removing ones the customer already has. (Editing a
locked provider line is a separate concern; out of scope here.)

### Client mirror (UX only)

- `entitlement.fetch` (`entitlementSnapshot`, `_shared/`) gains
  `allowSelfLines: boolean` (true when no `customer_accounts` row, mirroring the
  server rule). AppContext exposes it; `AccountsScreen` hides the "Add account"
  button (and its empty-state CTA) when `allowSelfLines` is false. Purely
  advisory — the server gate is the real boundary, consistent with the existing
  `entitlementGate.logic.js` "advisory client-side mirror — UX only" pattern.

### Dashboard toggle

- **`CreateAccount.tsx`** — an "Allow customer to add their own lines" switch
  near the top (default **off**). Submit sends `allowSelfLines`.
- **`AccountDetail.tsx`** — the same switch, wired to `accounts.update`.
- **`accounts.create`** / **`accounts.update`** — accept and persist
  `allowSelfLines` (validated as a strict boolean in `adminLogic.js`;
  `accounts.update` adds it to `acctPatch`). Audit metadata includes the boolean.

## Testing

- **Pure logic** (`_shared/adminLogic.js` + tests, `node:test`): `lines` array
  validation (≥1, each line valid, legacy single-`line` normalization),
  `allowSelfLines` strict-boolean validation, per-line-`id` update shape.
- **Migration guardrail** (`20260718000006_*.test.js`): asserts column add +
  backfill semantics + the `adopt` fn sets `true` (static SQL assertions, same
  style as `000002/3/4`).
- **`data` gate** (`data/*` test): `iptv.insert` returns 403 when row exists and
  `allow_self_lines=false`; allows when `true` or no row; adoption still fires on
  the allowed path.
- **Dashboard** (vitest): CreateAccount multi-line add/remove + submit payload;
  AccountDetail lines list add/edit/delete + toggle; `api.ts` new actions.
- **RN** (`node:test`): AccountsScreen "Add account" hidden when
  `allowSelfLines=false`, shown when true.

## Deploy order (owner actions — not run by Claude)

1. `supabase db push` — migration `20260718000006` (adds column, backfills
   existing → true, updates `adopt_self_signup_account`).
2. Redeploy Edge Functions **`admin`** and **`data`**.
3. Build + host the updated **dashboard**.
4. Ship the updated **RN/Expo** client (button gating + `allowSelfLines` from
   entitlement fetch).

Order matters only in that the migration must precede the function redeploys
(the functions read/write the new column). The RN client tolerates a missing
`allowSelfLines` (treats absent as allowed) so it can ship independently, but the
server gate is live as soon as `data` is redeployed regardless of client version.

## Rollback

- Migration header documents: `alter table public.customer_accounts drop column
  if exists allow_self_lines;` (the gate in `data` treats a missing column read
  as an error — so drop the column only *after* reverting the `data`/`admin`
  functions to versions that don't reference it).
- Reverting the functions alone (without dropping the column) is a safe partial
  rollback: the flag simply stops being enforced/edited.

## Out of scope / deferred

- Multi-line at *creation* beyond a flat array (per-line expiry, per-line device
  limits) — expiry/devices remain per customer login.
- Per-line "allow self-add" (the flag is per customer).
- Gating `iptv.update`/`iptv.delete` on the flag.
- Per-provider default for the toggle (rejected during brainstorming in favor of
  per-customer default OFF).

# Obfuscation Phase D — Server-Side Entitlements Implementation Plan

> **For agentic workers:** This phase touches the database (a migration) and Deno Edge Functions that must be **deployed to Supabase to verify**. Pure logic modules are unit-testable here; the DB + function wiring is verified against the live project. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Make demo/trial and license enforcement a **real server-side boundary** — a value the client cannot freely choose — instead of client-side code an attacker can patch. This is the only layer of the program that is an actual security boundary; L1–L3 (Phases A–C) merely raise effort.

**Why now:** The client-side demo lockout was just removed from `main` (commits `17d1c5c` / `7e90cd9`). Until this phase lands, there is **no** trial/entitlement enforcement at all. This is the highest-priority remaining security work (audit item **P0-4**, attacker goals **G1** bypass demo / **G2** account-sharing).

**Architecture:** A new `entitlements` table (service-role-written, owner-readable) holds each user's plan/trial window/status. A pure `evaluateEntitlement()` computes allow/deny from a row + the **server** clock; an `assertEntitled()` wrapper runs inside the `data` and `claim-device` Edge Functions before any content access. Trial start/expiry is stamped server-side on first device claim. The client reads an entitlement snapshot and gates playback, but treats the server as authoritative.

**Tech Stack:** Postgres + RLS (Supabase migration), Deno Edge Functions, `@supabase/supabase-js` service role, node:test for pure logic.

## Global Constraints

- Pure logic in `supabase/functions/_shared/*.js` (CommonJS-style, matches `entryLimits.js`, `loginLogic.js`, `accountStatus.js`) with `*.test.js` beside it; run via `npm test`. The Deno `index.ts` wrappers import the pure `.js`.
- **Expiry is computed with the DB/server clock (`now()`), NEVER a client-supplied timestamp.** That is the entire point — a frozen client clock or blocked network must not extend a trial.
- `entitlements` writes are **service-role only**; clients may read only their own row (RLS `auth.uid() = user_id`). Follow the RLS style in `supabase/migrations/20260716000001_rls_close_public_read.sql`.
- New migration filename continues the sequence: `supabase/migrations/20260717000004_entitlements.sql`.
- Enforcement must **fail closed** on the content path: if there is no active, unexpired, unrevoked entitlement, deny. (Contrast with the device-integrity heuristic, which fails open — this is the opposite because the server is authoritative and can't false-positive a user's own row.)
- `npm test` + `npm run lint` green before each commit.
- Deploy ordering mirrors the audit's rule: deploy functions to ALL clients before tightening, so you don't lock out live users mid-rollout. Ship the table + read path first; flip enforcement to fail-closed only once clients send what they need.

---

### Task D1: `entitlements` table + RLS migration

**Files:**
- Create: `supabase/migrations/20260717000004_entitlements.sql`

- [ ] **Step 1: Write the migration.**

```sql
-- Server-authoritative entitlements: the real boundary for demo/trial + license.
-- Service-role writes only; each user reads only their own row.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial',                    -- 'trial' | 'active' | 'expired' | 'blocked'
  status text not null default 'active',                 -- 'active' | 'suspended'
  trial_started_at timestamptz,
  expires_at timestamptz,                                -- null = no expiry (paid/active)
  revoked_at timestamptz,                                -- kill-switch, mirrors device_bindings
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Owner may read only their own row. No client INSERT/UPDATE/DELETE policy →
-- writes are service-role only (service role bypasses RLS).
drop policy if exists "own entitlement select" on public.entitlements;
create policy "own entitlement select" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply.** `supabase db push --project-ref <ref>` (or run in the SQL editor, then keep the migration file re-runnable via drop-if-exists as above).

- [ ] **Step 3: Verify** in the dashboard: RLS is ON; the only policy is the owner SELECT; a direct anon/authenticated PostgREST read returns only the caller's row (or none).

- [ ] **Step 4: Commit** the migration.

---

### Task D2: pure `evaluateEntitlement()`

**Files:**
- Create: `supabase/functions/_shared/entitlement.js`
- Create: `supabase/functions/_shared/entitlement.test.js`

**Interfaces:**
- Produces: `evaluateEntitlement(row, nowMs)` → `{ entitled: boolean, reason: string }`. `row` is the entitlements row (or null); `nowMs` is the server clock in ms. Pure — no DB, no Date.now() inside.

- [ ] **Step 1: Write the failing test** `entitlement.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const { evaluateEntitlement } = require("./entitlement.js");

const NOW = Date.parse("2026-07-17T00:00:00Z");
const future = new Date(NOW + 86400000).toISOString();
const past = new Date(NOW - 1000).toISOString();

test("no row → not entitled (fail closed)", () => {
  assert.deepStrictEqual(evaluateEntitlement(null, NOW), { entitled: false, reason: "no-entitlement" });
});
test("suspended status → denied", () => {
  assert.strictEqual(evaluateEntitlement({ status: "suspended", expires_at: future }, NOW).entitled, false);
});
test("revoked → denied even if unexpired", () => {
  assert.strictEqual(evaluateEntitlement({ status: "active", revoked_at: past, expires_at: future }, NOW).entitled, false);
});
test("expired trial → denied", () => {
  const r = evaluateEntitlement({ status: "active", expires_at: past }, NOW);
  assert.deepStrictEqual(r, { entitled: false, reason: "expired" });
});
test("active within trial window → entitled", () => {
  assert.deepStrictEqual(evaluateEntitlement({ status: "active", expires_at: future }, NOW), { entitled: true, reason: "ok" });
});
test("active with null expiry (paid) → entitled", () => {
  assert.strictEqual(evaluateEntitlement({ status: "active", expires_at: null }, NOW).entitled, true);
});
```

- [ ] **Step 2: RED.** `node --test supabase/functions/_shared/entitlement.test.js` → fails (module missing).

- [ ] **Step 3: Implement `entitlement.js`:**

```js
// Pure entitlement decision. nowMs is the SERVER clock (ms) — never client-supplied.
// Fails closed: anything not clearly active+unexpired+unrevoked is denied.
function evaluateEntitlement(row, nowMs) {
  if (!row) return { entitled: false, reason: "no-entitlement" };
  if (row.status && row.status !== "active") return { entitled: false, reason: "suspended" };
  if (row.revoked_at && Date.parse(row.revoked_at) <= nowMs) return { entitled: false, reason: "revoked" };
  if (row.expires_at != null) {
    const exp = Date.parse(row.expires_at);
    if (!Number.isFinite(exp) || exp <= nowMs) return { entitled: false, reason: "expired" };
  }
  return { entitled: true, reason: "ok" };
}

module.exports = { evaluateEntitlement };
```

- [ ] **Step 4: GREEN.** `node --test supabase/functions/_shared/entitlement.test.js` → 6/6.

- [ ] **Step 5: Commit** `entitlement.js(+test)`.

---

### Task D3: `assertEntitled()` + trial bootstrap, wired into the Edge Functions

**Files:**
- Create: `supabase/functions/_shared/assertEntitled.ts` (thin DB wrapper around `evaluateEntitlement`)
- Modify: `supabase/functions/claim-device/index.ts` (bootstrap trial on first claim)
- Modify: `supabase/functions/data/index.ts` (assert before content actions)

**Context:** mirror the existing `_shared/deviceGate.ts` pattern (service-role query + a pure `.js` decision). The content actions in `data/index.ts` (history/favorites/iptv/etc.) already run behind the device gate — add the entitlement assert alongside it.

- [ ] **Step 1: `assertEntitled.ts`** — query the caller's row with the service-role client, evaluate with the SERVER clock, throw/deny if not entitled:

```ts
import { evaluateEntitlement } from "./entitlement.js";

export async function assertEntitled(admin, userId) {
  const { data } = await admin.from("entitlements").select("*").eq("user_id", userId).maybeSingle();
  const verdict = evaluateEntitlement(data ?? null, Date.now()); // Date.now() here = server clock (Edge runtime)
  if (!verdict.entitled) {
    const e = new Error(verdict.reason);
    e.code = "NOT_ENTITLED";
    throw e;
  }
}
```

- [ ] **Step 2: Trial bootstrap in `claim-device/index.ts`.** When a user first claims a device and has no entitlements row, insert one server-side with a server-computed window (choose N — e.g. 7 days — and put it in one named constant):

```ts
const TRIAL_DAYS = 7;
// after the device is successfully bound, upsert-if-absent the trial:
await admin.from("entitlements").upsert({
  user_id: userId,
  plan: "trial",
  status: "active",
  trial_started_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
}, { onConflict: "user_id", ignoreDuplicates: true });
```

(`ignoreDuplicates` so re-claims never reset/extend an existing trial — the anti-abuse point.)

- [ ] **Step 3: Enforce in `data/index.ts`.** After the existing device-gate check and before dispatching content actions (history/favorites/iptv/appProfiles/profiles), call `await assertEntitled(admin, userId)`. Map the `NOT_ENTITLED` error to a clear response (e.g. `{ ok: false, code: "NOT_ENTITLED", reason }`, HTTP 402/403). **Rollout:** first deploy returning the entitlement verdict WITHOUT hard-denying (log-only), confirm real users have rows, THEN switch to deny — so the trial bootstrap has populated rows before enforcement bites.

- [ ] **Step 4: Return an entitlement snapshot** the client can show — either have `login`/`claim-device` include `{ entitled, reason, expires_at }`, or add a `data` action `entitlement.fetch` → `evaluateEntitlement(row, Date.now())` + `expires_at`.

- [ ] **Step 5: config.toml** — no `verify_jwt` change needed (`data`/`claim-device` stay `verify_jwt = true`; the caller is authenticated). Confirm.

- [ ] **Step 6: Deploy + verify.** `supabase functions deploy data claim-device --project-ref <ref>`. Test with a real account: (a) fresh user → claim device → gets a 7-day trial row → content works; (b) manually set `expires_at` to the past in the dashboard → content calls now return `NOT_ENTITLED` (server denies regardless of client clock); (c) set `revoked_at` → denied (kill-switch). **This (b)/(c) is the boundary proof: the client cannot re-enable itself.**

- [ ] **Step 7: Commit** the shared wrapper + the two function edits with the deploy/verify results noted.

---

### Task D4: client entitlement gate (UX, not the boundary)

**Files:**
- Create: `src/services/entitlementGate.logic.js` + `.test.js`
- Modify: the playback entry / app gate to consult it (e.g. where the removed demo lockout used to gate — search for the old `useDemoLockout`/`appGate` call sites).
- Modify: `src/services/supabase.js` (expose `fetchEntitlement()` if D3 Step 4 added the action).

**Interfaces:** `evaluateClientEntitlement(snapshot, nowMs)` → `{ canPlay, reason }` — a thin mirror of the server verdict for fast/offline UX. **Never the boundary** — the server already denies; this only avoids a confusing "play then fail" UX.

- [ ] **Step 1: Pure gate + test** (mirror `evaluateEntitlement`'s shape; deny-closed on a missing snapshot). Full code + a handful of node:test cases like D2.

- [ ] **Step 2: Wire** the gate where the ex-demo-lockout gated the tree; show an "unavailable/expired" panel on deny. Keep it advisory — the server is authoritative.

- [ ] **Step 3:** `npm test && npm run lint` green.

- [ ] **Step 4: Verify** (app): expired entitlement → app shows the expired state and content calls fail server-side; active → normal.

- [ ] **Step 5: Commit.**

---

## Verification summary (the boundary proof)

| Task | Acceptance |
|---|---|
| D1 table/RLS | direct PostgREST read returns only the caller's row; writes rejected for clients |
| D2 pure logic | 6/6 tests; fail-closed on null/expired/revoked/suspended |
| D3 enforcement | server denies content when `expires_at` past / `revoked_at` set, **even with a patched client / frozen clock** — the whole point |
| D4 client gate | expired → UX shows it; never the security boundary |

## Sequencing / safety
- Ship D1 → D2 → D3 (log-only) → confirm rows populate → D3 (enforce) → D4.
- This is audit item **P0-4** and closes **G1** (demo bypass) + strengthens **G2** (sharing) once combined with the existing device gate. Pairs with the direct-PostgREST grant-revoke sequence already tracked in the security audit.

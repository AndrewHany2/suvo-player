# Accounts provider visibility + confirmed suspend — design

**Date:** 2026-07-18
**Status:** Approved (pending spec review)
**Area:** `dashboard/` reseller admin app + `supabase/functions/admin`

## Motivation

The reseller dashboard already lists customer accounts scoped by role (a provider
sees only their own accounts; a super-admin sees all) and can suspend an account
from the detail page. Two gaps remain against the desired workflow — *"list all
users, which provider each belongs to, and suspend them"*:

1. When a **super-admin lists all users, there is no way to see which provider
   each account belongs to.** `accounts.list` selects `provider_id` but drops it
   from the response, and the table has no Provider column. The only way to scope
   to one provider today is a drill-in link from the Providers screen.
2. **Suspend lives only on the account detail page**, and it toggles with no
   confirmation. The owner wants suspend reachable from the list *and* guarded by
   a confirmation everywhere it can happen.

This is an enhancement to existing surfaces — no new subsystem, no schema change.

## Current state (verified)

- `accounts.list` ([supabase/functions/admin/index.ts:275](../../../supabase/functions/admin/index.ts))
  returns per account: `userId, name, status, expiresAt, suspended, devicesUsed,
  deviceLimit, note`. It already fetches provider rows (`user_id, suspended`) to
  roll a provider-level suspend into each account's computed `status`, but does
  **not** return the provider identity.
- Role scoping is enforced server-side in code (not overridable by the client):
  a provider is pinned to `provider_id = userId`; a super-admin may pass an
  optional `providerId` filter ([index.ts:282](../../../supabase/functions/admin/index.ts)).
  `canInvoke` / `canActOnAccount` in
  [`_shared/adminLogic.js`](../../../supabase/functions/_shared/adminLogic.js)
  are the authorization source of truth.
- `Accounts.tsx` already honors a `?providerId=` URL param for the super-admin
  drill-in. `Providers.tsx` links `name → /accounts?providerId=<id>`.
- Suspend is `accounts.update { suspended }` (per-account,
  [AccountDetail.tsx:253](../../../dashboard/src/screens/AccountDetail.tsx)) and
  `providers.update { suspended }` (per-provider, currently a toggle inside
  `EditProviderModal`). Both are super-admin/owner-gated server-side.
- The caller's role is available on the client via `useAuth().me.role`
  (`"provider" | "super_admin"`). `dashboard/src/authGate.ts` is the repo's home
  for pure, unit-tested role decisions.
- Tests: this repo unit-tests **pure logic only** — `_shared/*.js` under
  `node --test`, and `dashboard/src/{authGate,api,lib/*}` under vitest. There is
  **no React component-test harness** (no @testing-library), by deliberate
  convention.

## Requirements

- R1. A super-admin's account list shows a **Provider** column (which provider
  owns each account). Providers do not see this column (every row is theirs).
- R2. A super-admin can **filter the account list by provider** via a dropdown,
  in addition to the existing drill-in link. Selecting "All providers" clears it.
- R3. Suspend/unsuspend is reachable **inline from the accounts list** row.
- R4. **Every** suspend and unsuspend action requires an explicit confirmation
  dialog, across all three surfaces: inline list, account detail, and provider.
- R5. Provider-level suspend is confirmed and warns that it cascades to **all**
  of that provider's customer accounts.
- R6. No change to server-side authorization, provider isolation, or the public
  signup lock. Additive response fields only.

## Design

### 1. Shared `ConfirmDialog` primitive — `dashboard/src/ui.tsx`

Add a presentational component wrapping the existing `Modal`:

```
ConfirmDialog({
  title: string,
  message: React.ReactNode,
  confirmLabel: string,
  confirmVariant?: "danger" | "primary" | "secondary",  // default "danger"
  busy?: boolean,
  error?: string | null,
  onConfirm: () => void,
  onCancel: () => void,
})
```

Renders the message, an optional error line, and a `btn-row` with the confirm
button (label + variant + `busy` disable) and a Cancel button. The **caller owns**
the async call and the `busy`/`error` state — `ConfirmDialog` is pure UI. This
replaces the repeated confirm-modal boilerplate (delete confirmations in
`AccountDetail`/`Providers`) and backs every suspend confirmation. Existing delete
modals may be refactored onto it opportunistically but that is not required by
this spec.

### 2. `isSuperAdmin` role helper — `dashboard/src/authGate.ts`

Add a pure `export function isSuperAdmin(role: string): boolean` returning
`role === "super_admin"`, alongside the existing `isAllowedRole`. Screens call
this instead of inlining the string — it gives one unit-testable seam and matches
the file's stated purpose.

### 3. Backend — `accounts.list` returns provider identity

In [supabase/functions/admin/index.ts:275](../../../supabase/functions/admin/index.ts):

- Extend the existing provider fetch from `select("user_id, suspended")` →
  `select("user_id, suspended, name")` (the query is already there for the
  suspend roll-up — **no new round-trip**).
- Build a `provNameById` map alongside the existing `provSuspended` map.
- Add two fields to each output row:
  - `providerId: a.provider_id`
  - `providerName: a.provider_id ? (provNameById.get(a.provider_id) ?? null) : null`

Additive only — existing consumers (`Overview` counts, `Accounts` table) keep
working. **No leak:** a provider caller only ever receives their own accounts, so
`providerName` is only ever their own provider name.

### 4. Accounts list — `dashboard/src/screens/Accounts.tsx`

- Add `providerId`/`providerName` to the local `Account` type.
- Read `useAuth()`; compute `isSuperAdmin(me?.role ?? "")`.
- **Provider column (R1):** when `isSuperAdmin`, append a column
  `{ key: "provider", header: "Provider", render: a => a.providerName ?? "—" }`.
- **Provider filter dropdown (R2):** when `isSuperAdmin`, render a `<select>`
  above the search box. On mount (super-admin only) fetch `providers.list`
  (already a super-admin-only action) for `{ user_id, name }`, filtered to
  `role === "provider"` (matching `Providers.tsx`). Options = "All providers"
  (value `""`) + one per provider. The current value comes from the `providerId`
  URL param; changing it calls `setSearchParams` to set/clear `providerId`, which
  the existing data effect already depends on. This preserves the drill-in link
  and the "Clear filter" line. A provider caller never renders the dropdown and
  never calls `providers.list`.
- **Inline suspend (R3/R4):** add an actions column with a
  Suspend/Unsuspend button (label from `a.suspended`). Clicking it
  `e.stopPropagation()`s (so the row's navigate-to-detail does not fire) and opens
  a `ConfirmDialog`. Component holds `confirming: Account | null` and `busy`
  state. Confirm → `accounts.update { userId, suspended: !a.suspended }` →
  on success close the dialog and **refetch** the list (via a `reloadNonce` added
  to the data effect's deps) so the server-computed `status` badge updates.
  Errors surface in the dialog's `error` line; the row is not mutated on failure.

### 5. Account detail — `dashboard/src/screens/AccountDetail.tsx`

In `SubscriptionCard`, the existing Suspend/Unsuspend button
([AccountDetail.tsx:253](../../../dashboard/src/screens/AccountDetail.tsx)) no
longer calls `run(...)` directly. Instead it opens a `ConfirmDialog`; confirm runs
the existing `run(setSavingSuspend, { suspended: !data.suspended })`. Applies to
both suspend and unsuspend (R4). All other cards (device limit, expiry, note,
name, password, line, delete) are unchanged.

### 6. Provider suspend — `dashboard/src/screens/Providers.tsx` (approach P1)

- Add a **Suspend/Unsuspend row action** to the providers table actions column
  (beside Edit/Delete), label from `p.suspended`. Clicking opens a `ConfirmDialog`
  whose message warns the suspend blocks the provider **and all their customer
  accounts**. Confirm → `providers.update { userId: p.user_id, suspended:
  !p.suspended }` → `afterSave(p.user_id)` (reload; refresh `me` if it were self,
  though the table already filters to `role === "provider"` so self never appears).
- **Remove the suspend toggle from `EditProviderModal`** — it becomes name +
  maxAccounts only. This keeps suspend an immediate, confirmed action consistent
  with the accounts table and avoids a `ConfirmDialog` nested inside the edit
  modal. `providers.update` already ignores unrelated fields, so sending only
  `{ userId, name, maxAccounts }` from the edit form is fine.

*Alternative rejected (P2):* keep the toggle in `EditProviderModal` and nest the
confirm over it. Less churn but nested modals + "toggle stages, Save persists"
semantics are muddy. P1 chosen for consistency and clarity.

## Data flow

```
super-admin opens Accounts
  → providers.list (dropdown options)      [super-admin only]
  → accounts.list { search?, providerId? } → rows incl. providerId/providerName
row Suspend click
  → ConfirmDialog → accounts.update { userId, suspended } → refetch accounts.list
provider opens Accounts
  → accounts.list { search? }  (server pins provider_id = self; no dropdown/column)
```

## Error handling

- List load failure: existing behavior (clear rows, show error) is unchanged.
- Suspend/update failure: message shown inside the `ConfirmDialog` `error` line;
  dialog stays open; no optimistic mutation, so a failed call leaves the row as-is.
- `providers.list` failure (dropdown): degrade to search + column only; log/show a
  non-fatal inline note rather than blocking the accounts table.
- Authorization is server-enforced regardless of UI — a provider hitting
  `providers.*` or another provider's account still gets `FORBIDDEN`.

## Testing

- **`authGate.isSuperAdmin`** — vitest cases: `"super_admin"` → true;
  `"provider"`, `""`, arbitrary string → false. (New pure seam.)
- **No component tests** — `ConfirmDialog` and the screen wiring are presentational
  and this repo has no component-test harness by convention; adding one is out of
  scope. Behavior is verified by building the dashboard (`npm run build`) and a
  manual/browser click-through of: super-admin sees Provider column + dropdown;
  provider sees neither and only their own rows; suspend/unsuspend from list,
  detail, and provider row each require confirmation and reflect after refetch.
- The Deno `admin/index.ts` change has no unit harness (only `_shared/*.js` pure
  modules are tested) — consistent with the project's existing deferred
  "Deno-layer integration smoke tests." The change is additive fields from an
  in-hand map.
- `dashboard` lint + existing vitest (`npm test`) must stay green.

## Non-goals

- No schema, migration, RLS, or grant change.
- No change to provider isolation, quota, or the public-signup lock.
- No bulk-suspend, no list pagination work, no changes to device/line/expiry flows.
- No new backend action or endpoint.

## Deploy notes

- Backend: redeploy the `admin` Edge Function (additive response fields; no
  migration). Old dashboard builds keep working (they ignore the new fields);
  the new dashboard degrades gracefully if the function is briefly old
  (Provider column simply renders "—").
- Web: rebuild + host the `dashboard/` bundle as usual.

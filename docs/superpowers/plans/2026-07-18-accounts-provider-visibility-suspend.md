# Accounts provider visibility + confirmed suspend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super-admin see (and filter by) which provider owns each account, and make suspend reachable from the accounts list — with a confirmation dialog on every suspend/unsuspend across list, detail, and provider.

**Architecture:** Small enhancement to the existing `dashboard/` reseller admin app plus one additive change to the `admin` Edge Function's `accounts.list`. A new presentational `ConfirmDialog` (over the existing `Modal`) and a pure `isSuperAdmin` helper back the changes. No schema, RLS, grant, or server-authorization changes.

**Tech Stack:** Vite + React 19 + TypeScript (the standalone `dashboard/` package, NOT the RN/Expo workspace), vitest for unit tests; Supabase Edge Function (Deno/TypeScript) for `admin`.

## Global Constraints

- Dashboard is a **standalone package** at `dashboard/` — it never imports the RN app. Run its commands from inside `dashboard/`.
- **JavaScript-only rule does NOT apply to `dashboard/`** — it is `.ts`/`.tsx` (the RN app is JS-only; the dashboard is a separate TS project).
- **No component-test harness exists** (no @testing-library) and none is added here. Only pure `lib/`/`authGate` logic is unit-tested; screens/components are verified via `npm run build` (tsc typecheck) + browser QA.
- **Server authorization is unchanged.** Provider isolation, quota, and the public-signup lock are out of scope. Backend change is **additive response fields only**.
- Frontend role value is the string `"super_admin"` (from `useAuth().me.role`).
- Dashboard verify commands: `cd dashboard && npm run build && npm test`. Backend verify: from repo root `npm test` (runs `node --test … supabase`) and `npm run lint`.
- Provider "name" is the reseller display name from the `providers` table.

---

### Task 1: `isSuperAdmin` role helper (pure, unit-tested)

**Files:**
- Modify: `dashboard/src/authGate.ts`
- Test: `dashboard/src/authGate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isSuperAdmin(role: string): boolean` — `true` iff `role === "super_admin"`.

- [ ] **Step 1: Write the failing test**

Add to `dashboard/src/authGate.test.ts` — update the import line and append a new `describe`:

```ts
import { shouldRejectSession, isAllowedRole, isSuperAdmin } from "./authGate";
```

```ts
describe("isSuperAdmin", () => {
  test("super_admin → true", () => {
    expect(isSuperAdmin("super_admin")).toBe(true);
  });
  test("provider → false", () => {
    expect(isSuperAdmin("provider")).toBe(false);
  });
  test("empty role → false", () => {
    expect(isSuperAdmin("")).toBe(false);
  });
  test("arbitrary role → false", () => {
    expect(isSuperAdmin("customer")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/authGate.test.ts`
Expected: FAIL — `isSuperAdmin is not a function` / import has no such export.

- [ ] **Step 3: Write minimal implementation**

Append to `dashboard/src/authGate.ts`:

```ts
// True for the super-admin role, which alone may see every provider's accounts
// and manage providers. auth.tsx already restricts the dashboard to
// provider/super_admin via isAllowedRole; this narrows within that set.
export function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/authGate.test.ts`
Expected: PASS (all `isSuperAdmin` + existing cases green).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/authGate.ts dashboard/src/authGate.test.ts
git commit -m "feat(dashboard): add isSuperAdmin role helper"
```

---

### Task 2: `ConfirmDialog` shared component

**Files:**
- Modify: `dashboard/src/ui.tsx`

**Interfaces:**
- Consumes: existing `Modal`, `Button`, and the file-local `ButtonVariant` type.
- Produces:
  ```ts
  export function ConfirmDialog(props: {
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    confirmVariant?: "primary" | "secondary" | "danger" | "ghost"; // default "danger"
    busy?: boolean;      // default false
    error?: string | null; // default null
    onConfirm: () => void;
    onCancel: () => void;
  }): JSX.Element
  ```
  The caller owns the async work and the `busy`/`error` state; `ConfirmDialog` is pure UI.

- [ ] **Step 1: Add the component**

Append to `dashboard/src/ui.tsx` (after the `Modal` function):

```tsx
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmVariant = "danger",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      {error && <p className="field-error">{error}</p>}
      <p>{message}</p>
      <div className="btn-row">
        <Button variant={confirmVariant} disabled={busy} onClick={onConfirm}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify it typechecks and existing tests still pass**

Run: `cd dashboard && npm run build && npm test`
Expected: build succeeds (tsc + vite), vitest green. (No component test — `ConfirmDialog` is presentational; it is exercised by Tasks 4–6 and browser QA.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/ui.tsx
git commit -m "feat(dashboard): add reusable ConfirmDialog over Modal"
```

---

### Task 3: Backend — `accounts.list` returns provider identity

**Files:**
- Modify: `supabase/functions/admin/index.ts` (the `accounts.list` case, around lines 318–339)

**Interfaces:**
- Consumes: the existing `accts`, `nameById`, `deviceCount`, `limitById` locals in `accounts.list`.
- Produces: two ADDED fields on each returned account object — `providerId: string | null`, `providerName: string | null`. All existing fields (`userId, name, status, expiresAt, suspended, devicesUsed, deviceLimit, note`) are unchanged.

- [ ] **Step 1: Extend the provider fetch to include the name**

In `supabase/functions/admin/index.ts`, find (in the `accounts.list` case):

```ts
        const provRows = providerIds.length
          ? (await admin.from("providers").select("user_id, suspended").in("user_id", providerIds)).data ?? []
          : [];
        const provSuspended = new Map<string, boolean>(provRows.map((p: any) => [p.user_id, !!p.suspended]));
```

Replace with:

```ts
        const provRows = providerIds.length
          ? (await admin.from("providers").select("user_id, suspended, name").in("user_id", providerIds)).data ?? []
          : [];
        const provSuspended = new Map<string, boolean>(provRows.map((p: any) => [p.user_id, !!p.suspended]));
        const provNameById = new Map<string, string>(provRows.map((p: any) => [p.user_id, p.name ?? ""]));
```

- [ ] **Step 2: Add the two fields to each output row**

Find the `out` mapping in the same case:

```ts
          devicesUsed: deviceCount.get(a.user_id) ?? 0,
          deviceLimit: limitById.get(a.user_id) ?? null,
          note: a.note,
        }));
        return json(out);
```

Replace with:

```ts
          devicesUsed: deviceCount.get(a.user_id) ?? 0,
          deviceLimit: limitById.get(a.user_id) ?? null,
          note: a.note,
          providerId: a.provider_id ?? null,
          providerName: a.provider_id ? (provNameById.get(a.provider_id) ?? null) : null,
        }));
        return json(out);
```

- [ ] **Step 3: Verify nothing else broke**

Run: `npm test` (repo root — runs `node --test src scripts supabase electron`)
Expected: PASS (the `supabase` suite exercises the pure `_shared/*.js` modules; this change is in the Deno router `index.ts` which has no unit test, so the counts are unchanged and green).

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(admin): accounts.list returns providerId + providerName"
```

> Note: behavioral verification of these fields happens in Task 7 (browser QA against a running dashboard). Deploy the `admin` function (additive; no migration) before shipping the new dashboard.

---

### Task 4: Accounts list — Provider column, provider filter, inline confirmed suspend

**Files:**
- Modify (full rewrite): `dashboard/src/screens/Accounts.tsx`

**Interfaces:**
- Consumes: `isSuperAdmin` (Task 1); `ConfirmDialog` (Task 2); `accounts.list` fields incl. `providerId`/`providerName` (Task 3); existing `providers.list` action (returns rows with `user_id, role, name, …`); `useAuth().me.role`.
- Produces: the finished Accounts screen. No exports consumed by other tasks.

- [ ] **Step 1: Replace the file contents**

Overwrite `dashboard/src/screens/Accounts.tsx` with:

```tsx
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { call, apiErrorMessage } from "../api";
import { useAuth } from "../auth";
import { isSuperAdmin } from "../authGate";
import { statusLabel, fmtDate } from "../lib/format";
import { Badge, Button, ConfirmDialog, Table, type Column } from "../ui";

type Account = {
  userId: string;
  name: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  devicesUsed: number;
  deviceLimit: number | null;
  note: string | null;
  providerId: string | null;
  providerName: string | null;
};

type ProviderOption = { user_id: string; name: string; role: string };

const SEARCH_DEBOUNCE_MS = 300;

export default function Accounts() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const superAdmin = isSuperAdmin(me?.role ?? "");
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the super-admin Providers drill-in (/accounts?providerId=…) or by the
  // provider dropdown below. Ignored server-side for a provider caller — they
  // only ever see their own accounts regardless.
  const providerId = searchParams.get("providerId") || undefined;
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Super-admin only: provider options for the filter dropdown.
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    call<ProviderOption[]>("providers.list").then(
      (rows) => {
        if (!cancelled) setProviders(rows.filter((p) => p.role === "provider"));
      },
      () => {
        // Non-fatal: without options the dropdown is hidden but the list still works.
        if (!cancelled) setProviders([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [superAdmin]);

  // Suspend/unsuspend confirmation target + its own busy/error state.
  const [confirming, setConfirming] = useState<Account | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const payload = { ...(search ? { search } : {}), ...(providerId ? { providerId } : {}) };
      call<Account[]>("accounts.list", payload).then(
        (rows) => {
          if (cancelled) return;
          setAccounts(rows);
          setLoading(false);
        },
        (e) => {
          if (cancelled) return;
          // Clear any previously-loaded rows so a failed search/reload shows
          // the error alone, never the stale (non-matching) table beneath it.
          setAccounts(null);
          setError(apiErrorMessage((e as Error).message));
          setLoading(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, providerId, reloadNonce]);

  function setProviderFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("providerId", value);
    else next.delete("providerId");
    setSearchParams(next);
  }

  async function confirmSuspendToggle() {
    if (!confirming) return;
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      await call("accounts.update", { userId: confirming.userId, suspended: !confirming.suspended });
      setConfirming(null);
      setReloadNonce((n) => n + 1); // refetch so the server-computed status badge updates
    } catch (e) {
      setSuspendError(apiErrorMessage((e as Error).message));
    } finally {
      setSuspendBusy(false);
    }
  }

  const columns: Column<Account>[] = [
    { key: "name", header: "Name" },
    ...(superAdmin
      ? ([{ key: "provider", header: "Provider", render: (a: Account) => a.providerName ?? "—" }] as Column<Account>[])
      : []),
    {
      key: "status",
      header: "Status",
      render: (a) => {
        const { text, tone } = statusLabel(a.status);
        return <Badge tone={tone}>{text}</Badge>;
      },
    },
    { key: "expiresAt", header: "Expiry", render: (a) => fmtDate(a.expiresAt) },
    { key: "devices", header: "Devices", render: (a) => `${a.devicesUsed}/${a.deviceLimit ?? "default"}` },
    {
      key: "actions",
      header: "",
      render: (a) => (
        <Button
          variant={a.suspended ? "secondary" : "danger"}
          onClick={(e) => {
            e.stopPropagation(); // don't trigger the row's navigate-to-detail
            setSuspendError(null);
            setConfirming(a);
          }}
        >
          {a.suspended ? "Unsuspend" : "Suspend"}
        </Button>
      ),
    },
  ];

  return (
    <div className="container">
      <div className="page-header">
        <h1>Accounts</h1>
        <Link to="/accounts/new" className="btn btn-primary">
          + New account
        </Link>
      </div>
      {superAdmin && providers.length > 0 && (
        <select
          className="search-input"
          value={providerId ?? ""}
          onChange={(e) => setProviderFilter(e.target.value)}
          aria-label="Filter by provider"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {providerId && (
        <p className="muted">
          Filtered to one provider's accounts. <Link to="/accounts">Clear filter</Link>
        </p>
      )}
      <input
        type="search"
        className="search-input"
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search accounts"
      />
      {error && <p className="field-error">{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && !error && accounts !== null && accounts.length === 0 && (
        <p>{search ? "No accounts match your search." : "No accounts yet."}</p>
      )}
      {!loading && !error && accounts !== null && accounts.length > 0 && (
        <Table
          columns={columns}
          rows={accounts}
          rowKey={(a) => a.userId}
          onRowClick={(a) => navigate(`/accounts/${a.userId}`)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={confirming.suspended ? "Unsuspend account" : "Suspend account"}
          message={
            confirming.suspended ? (
              <>
                Re-enable <strong>{confirming.name}</strong>? They will be able to sign in and play again.
              </>
            ) : (
              <>
                Suspend <strong>{confirming.name}</strong>? They will be signed out and blocked from playback until
                unsuspended.
              </>
            )
          }
          confirmLabel={confirming.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={confirming.suspended ? "primary" : "danger"}
          busy={suspendBusy}
          error={suspendError}
          onConfirm={confirmSuspendToggle}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build + existing tests**

Run: `cd dashboard && npm run build && npm test`
Expected: build succeeds (tsc typecheck clean, incl. the conditional column spread and `stopPropagation` on the row button), vitest green.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/screens/Accounts.tsx
git commit -m "feat(dashboard): provider column, filter dropdown, and inline confirmed suspend on accounts list"
```

---

### Task 5: Account detail — confirm the existing suspend

**Files:**
- Modify: `dashboard/src/screens/AccountDetail.tsx` (import line ~6; the `SubscriptionCard` component ~113–273)

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 2); existing `call`, `apiErrorMessage`, `data`, `userId`, `onSaved`, and `SubscriptionCard`'s `savingSuspend`/`error` state.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Import `ConfirmDialog`**

Change the ui import at the top of `dashboard/src/screens/AccountDetail.tsx` from:

```tsx
import { Badge, Button, Field, Modal, Table, type Column } from "../ui";
```

to:

```tsx
import { Badge, Button, ConfirmDialog, Field, Modal, Table, type Column } from "../ui";
```

(`Modal` stays — it's still used by `SecurityCard`, `DevicesCard`, and `DangerZone`.)

- [ ] **Step 2: Add confirm state + handler to `SubscriptionCard`**

Inside `SubscriptionCard`, add next to the other `useState` hooks (after `const [error, setError] = useState<string | null>(null);`):

```tsx
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  async function doSuspendToggle() {
    setSavingSuspend(true);
    setError(null);
    try {
      await call("accounts.update", { userId, suspended: !data.suspended });
      setConfirmSuspend(false);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSavingSuspend(false);
    }
  }
```

- [ ] **Step 3: Route the suspend button through the confirm dialog**

Replace the existing suspend `card-row` block:

```tsx
      <div className="card-row">
        <Button
          variant={data.suspended ? "secondary" : "danger"}
          disabled={savingSuspend}
          onClick={() => run(setSavingSuspend, { suspended: !data.suspended })}
        >
          {savingSuspend ? "Saving…" : data.suspended ? "Unsuspend account" : "Suspend account"}
        </Button>
      </div>
```

with:

```tsx
      <div className="card-row">
        <Button
          variant={data.suspended ? "secondary" : "danger"}
          disabled={savingSuspend}
          onClick={() => {
            setError(null);
            setConfirmSuspend(true);
          }}
        >
          {data.suspended ? "Unsuspend account" : "Suspend account"}
        </Button>
      </div>

      {confirmSuspend && (
        <ConfirmDialog
          title={data.suspended ? "Unsuspend account" : "Suspend account"}
          message={
            data.suspended ? (
              <>
                Re-enable <strong>{data.name}</strong>? They will be able to sign in and play again.
              </>
            ) : (
              <>
                Suspend <strong>{data.name}</strong>? They will be signed out and blocked from playback until
                unsuspended.
              </>
            )
          }
          confirmLabel={data.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={data.suspended ? "primary" : "danger"}
          busy={savingSuspend}
          error={error}
          onConfirm={doSuspendToggle}
          onCancel={() => setConfirmSuspend(false)}
        />
      )}
```

- [ ] **Step 4: Verify build + tests**

Run: `cd dashboard && npm run build && npm test`
Expected: build succeeds, vitest green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/screens/AccountDetail.tsx
git commit -m "feat(dashboard): confirm suspend/unsuspend on account detail"
```

---

### Task 6: Provider suspend — confirmed row action; drop the modal toggle

**Files:**
- Modify: `dashboard/src/screens/Providers.tsx` (import ~7; `Providers` component ~19–120; `EditProviderModal` ~186–250)

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 2); existing `call`, `apiErrorMessage`, `afterSave(targetUserId: string)`, the `Provider` type, and `providers.update` (accepts a partial patch — `{ userId, suspended }` alone is valid server-side).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Import `ConfirmDialog`**

Change the ui import from:

```tsx
import { Badge, Button, Field, Modal, Table, type Column } from "../ui";
```

to:

```tsx
import { Badge, Button, ConfirmDialog, Field, Modal, Table, type Column } from "../ui";
```

- [ ] **Step 2: Add suspend state + handler to the `Providers` component**

Inside `Providers()`, add after the existing `const [deleting, setDeleting] = useState<Provider | null>(null);`:

```tsx
  const [suspending, setSuspending] = useState<Provider | null>(null);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  async function confirmProviderSuspend() {
    if (!suspending) return;
    setSuspendBusy(true);
    setSuspendError(null);
    try {
      const id = suspending.user_id;
      await call("providers.update", { userId: id, suspended: !suspending.suspended });
      setSuspending(null);
      await afterSave(id);
    } catch (e) {
      setSuspendError(apiErrorMessage((e as Error).message));
    } finally {
      setSuspendBusy(false);
    }
  }
```

- [ ] **Step 3: Add the Suspend/Unsuspend button to the actions column**

Replace the actions column render:

```tsx
      render: (p) => (
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setDeleting(p)}>
            Delete
          </Button>
        </div>
      ),
```

with:

```tsx
      render: (p) => (
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button
            variant={p.suspended ? "secondary" : "danger"}
            onClick={() => {
              setSuspendError(null);
              setSuspending(p);
            }}
          >
            {p.suspended ? "Unsuspend" : "Suspend"}
          </Button>
          <Button variant="danger" onClick={() => setDeleting(p)}>
            Delete
          </Button>
        </div>
      ),
```

- [ ] **Step 4: Render the confirm dialog**

In the `Providers` component's returned JSX, add after the `{deleting && (…)}` block:

```tsx
      {suspending && (
        <ConfirmDialog
          title={suspending.suspended ? "Unsuspend provider" : "Suspend provider"}
          message={
            suspending.suspended ? (
              <>
                Re-enable <strong>{suspending.name}</strong>? The provider and all of their customer accounts regain
                access.
              </>
            ) : (
              <>
                Suspend <strong>{suspending.name}</strong>? This blocks the provider <em>and all of their customer
                accounts</em> from signing in and playing until unsuspended.
              </>
            )
          }
          confirmLabel={suspending.suspended ? "Unsuspend" : "Suspend"}
          confirmVariant={suspending.suspended ? "primary" : "danger"}
          busy={suspendBusy}
          error={suspendError}
          onConfirm={confirmProviderSuspend}
          onCancel={() => setSuspending(null)}
        />
      )}
```

- [ ] **Step 5: Remove the now-redundant suspend toggle from `EditProviderModal`**

In `EditProviderModal`, delete the suspended state:

```tsx
  const [suspended, setSuspended] = useState(provider.suspended);
```

Remove `suspended` from the update payload — change:

```tsx
      await call("providers.update", {
        userId: provider.user_id,
        name: name.trim(),
        maxAccounts: Number(maxAccounts),
        suspended,
      });
```

to:

```tsx
      await call("providers.update", {
        userId: provider.user_id,
        name: name.trim(),
        maxAccounts: Number(maxAccounts),
      });
```

And delete the suspend toggle block from the modal's JSX:

```tsx
        <div className="card-row">
          <Button
            type="button"
            variant={suspended ? "secondary" : "danger"}
            onClick={() => setSuspended((s) => !s)}
          >
            {suspended ? "Unsuspend" : "Suspend"}
          </Button>
        </div>
```

- [ ] **Step 6: Verify build + tests**

Run: `cd dashboard && npm run build && npm test`
Expected: build succeeds (no unused `suspended`/`setSuspended` — tsc under `noUnusedLocals` if enabled would otherwise flag it), vitest green.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/screens/Providers.tsx
git commit -m "feat(dashboard): confirmed provider suspend as row action; drop modal toggle"
```

---

### Task 7: Integration verification (build + browser QA)

**Files:** none (verification only).

- [ ] **Step 1: Full dashboard build + unit tests**

Run: `cd dashboard && npm run build && npm test`
Expected: build clean; vitest green (incl. the new `isSuperAdmin` cases).

- [ ] **Step 2: Backend suite + lint (repo root)**

Run: `npm test && npm run lint`
Expected: both green.

- [ ] **Step 3: Browser QA against a running dashboard**

Start the dev server (`cd dashboard && npm run dev`) pointed at an environment where the updated `admin` function is deployed, then verify:

- [ ] **Super-admin, no filter:** Accounts list shows a **Provider** column with each account's owning provider name (or "—" if none).
- [ ] **Super-admin, dropdown:** the provider dropdown lists providers; selecting one filters the list and sets `?providerId=` in the URL; "All providers" clears it; the Providers-screen name drill-in still lands here filtered.
- [ ] **Provider login:** no Provider column, no dropdown; only that provider's own accounts appear.
- [ ] **Inline suspend:** clicking Suspend on a row opens a confirmation; confirming suspends and the Status badge updates after refetch; clicking the row's Suspend button does NOT navigate to the detail page. Unsuspend path works the same.
- [ ] **Account detail suspend:** the detail-page Suspend/Unsuspend button now asks for confirmation before applying.
- [ ] **Provider suspend:** the Providers table has a Suspend/Unsuspend row action that confirms (warning it cascades to all the provider's customers) and updates the provider's Status; the Edit Provider modal no longer shows a suspend toggle.

- [ ] **Step 4: (Post-merge, owner) update project memory**

Note in the `reseller-dashboard` memory that the super-admin account list now shows provider ownership + filter and that suspend is confirmed on all surfaces. (Not a code step — do after merge.)

---

## Self-Review

**Spec coverage:**
- R1 Provider column (super-admin) → Task 4 (column) + Task 3 (data).
- R2 Provider filter dropdown → Task 4.
- R3 Inline suspend from list → Task 4.
- R4 Confirmation on every suspend + unsuspend → Task 4 (list), Task 5 (detail), Task 6 (provider); both directions in each.
- R5 Provider suspend confirmed + cascade warning → Task 6 (Step 4 message).
- R6 No auth/schema change; additive backend fields → Task 3 (additive), no RLS/authorization edits anywhere.
- Shared `ConfirmDialog` → Task 2; `isSuperAdmin` seam → Task 1.

**Placeholder scan:** none — every code step shows complete content; no "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `Account` gains `providerId`/`providerName` (Task 4) matching Task 3's additive fields; `ConfirmDialog` props (`title, message, confirmLabel, confirmVariant, busy, error, onConfirm, onCancel`) are used identically in Tasks 4, 5, 6; `isSuperAdmin(role: string): boolean` (Task 1) is called as `isSuperAdmin(me?.role ?? "")` in Task 4; `providers.update` partial-patch usage in Task 6 matches the backend's existing patch builder.

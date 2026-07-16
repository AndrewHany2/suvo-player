# Reseller Dashboard — Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **PREREQUISITE:** the backend plan (`2026-07-16-reseller-dashboard-backend.md`) must be implemented and deployed — this app calls the `admin` Edge Function it defines.

**Goal:** A standalone Vite + React + TypeScript web app in `dashboard/` where the super-admin manages providers and each provider manages only their own customer accounts (create with a provisioned IPTV line, set device count + expiry, suspend, reset password, edit line, and revoke devices).

**Architecture:** Thin client. `@supabase/supabase-js` is used ONLY for `signInWithPassword` / session (GoTrue is unaffected by the table-grant revokes). Every data call goes through one `call(action, payload)` helper that POSTs to the `admin` function with the caller's Bearer JWT. No direct table access. On login the app calls `me`; a user with no provider row is rejected — customers cannot enter.

**Tech Stack:** Vite, React 19, TypeScript, react-router-dom, `@supabase/supabase-js`, Vitest (unit tests for the app's own package). Deployed as a static site, separate from the player bundle.

## Global Constraints

- Node ≥ 20.
- The `dashboard/` package is standalone (its own `package.json` + `node_modules`); it is NOT part of the Expo/RN workspace and must not import from the RN app. Root `npm test` is unchanged; the dashboard has its own `npm test` (Vitest).
- Admin action names + payload/response shapes are the contract from the backend plan — use them verbatim (see the API reference below).
- No secrets in the repo: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` come from `dashboard/.env` (gitignored); commit `dashboard/.env.example`.
- The client never stores customer passwords; it only sends them to `accounts.create` / `accounts.setPassword`.
- Before committing: `cd dashboard && npm test && npm run build` must pass.

### Admin API reference (from the backend plan)

`call(action, payload)` → the `admin` function. Errors: `{error, ...}` with HTTP 4xx/5xx.

| action | payload | returns |
|---|---|---|
| `me` | — | `{role, name, quota:{used,max}}` |
| `providers.list` | — | `[{user_id, role, name, max_accounts, suspended, created_at, accounts_used}]` |
| `providers.create` | `{email, password, name, maxAccounts}` | `{userId}` |
| `providers.update` | `{userId, name?, maxAccounts?, suspended?}` | `{ok}` |
| `providers.delete` | `{userId}` | `{ok}` \| `{error:"PROVIDER_HAS_ACCOUNTS"}` |
| `accounts.list` | `{search?, providerId?}` | `[{userId, username, status, expiresAt, suspended, devicesUsed, deviceLimit, note}]` |
| `accounts.create` | `{username, password, deviceLimit, expiresAt, note?, email?, line:{type,host,username,password,url,nickname}}` | `{userId}` \| `{error:"QUOTA_EXCEEDED"}` \| `{error:"INVALID_INPUT",fields}` |
| `accounts.get` | `{userId}` | `{userId, username, email, status, expiresAt, suspended, note, deviceLimit, line:{id,type,nickname,host,username,url}}` |
| `accounts.update` | `{userId, deviceLimit?, expiresAt?, suspended?, note?}` | `{ok}` |
| `accounts.setPassword` | `{userId, password}` | `{ok}` |
| `accounts.updateLine` | `{userId, line}` | `{ok}` |
| `accounts.delete` | `{userId}` | `{ok}` |
| `devices.list` | `{userId}` | `[{device_id, platform, label, bound_at, last_seen_at, revoked_at}]` |
| `devices.revoke` / `devices.unrevoke` / `devices.remove` | `{userId, deviceId}` | `{ok}` |

`status` ∈ `ACTIVE` \| `ACCOUNT_SUSPENDED` \| `ACCOUNT_EXPIRED` \| `PROVIDER_SUSPENDED`.

---

## File Structure

**Create (all under `dashboard/`):**
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`, `.gitignore`
- `src/main.tsx` — bootstrap + router
- `src/supabase.ts` — the supabase-js client (auth only)
- `src/api.ts` — `call()`, `signIn`, `signOut`, `getSession`, error mapping
- `src/api.test.ts` — Vitest for error mapping (pure part)
- `src/auth.tsx` — `AuthProvider` + `useAuth` (session + `me`, role gate)
- `src/App.tsx` — shell, nav, role-based routes
- `src/lib/format.ts` — status label/badge + expiry presets (pure)
- `src/lib/format.test.ts` — Vitest
- `src/screens/Login.tsx`, `Overview.tsx`, `Accounts.tsx`, `CreateAccount.tsx`, `AccountDetail.tsx`, `Providers.tsx`
- `src/ui.tsx` — tiny local components (Button, Table, Badge, Modal, Field)
- `src/styles.css`

**Modify:**
- Root `.gitignore` — add `dashboard/node_modules`, `dashboard/dist`, `dashboard/.env`.

---

## Task 1: Scaffold the app + Supabase client

**Files:** create `dashboard/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`, `.gitignore`, `src/main.tsx`, `src/supabase.ts`, `src/styles.css`; modify root `.gitignore`.

- [ ] **Step 1: `dashboard/package.json`**

```json
{
  "name": "suvo-dashboard",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: config files**

`dashboard/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
```

`dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "strict": true, "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"], "noEmit": true
  },
  "include": ["src"]
}
```

`dashboard/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Suvo — Reseller Dashboard</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`dashboard/.env.example`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`dashboard/.gitignore`:
```
node_modules
dist
.env
```

- [ ] **Step 3: `dashboard/src/supabase.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);
```

- [ ] **Step 4: `dashboard/src/main.tsx` (temporary smoke content) + `src/styles.css`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<h1>Suvo Dashboard</h1>);
```

`src/styles.css`: minimal reset + a `.container{max-width:1100px;margin:0 auto;padding:24px;font-family:system-ui}` (fill with basic table/badge styles).

- [ ] **Step 5: Root `.gitignore`** — append:
```
dashboard/node_modules
dashboard/dist
dashboard/.env
```

- [ ] **Step 6: Install + smoke test**

Run: `cd dashboard && npm install && npm run dev`
Expected: dev server serves "Suvo Dashboard" at the printed URL.

- [ ] **Step 7: Commit**
```bash
git add dashboard/package.json dashboard/vite.config.ts dashboard/tsconfig.json dashboard/index.html dashboard/.env.example dashboard/.gitignore dashboard/src/main.tsx dashboard/src/supabase.ts dashboard/src/styles.css .gitignore
git commit -m "feat(dashboard): scaffold Vite+React+TS app + supabase client"
```

---

## Task 2: API client + error mapping (TDD for the pure part)

**Files:** create `dashboard/src/api.ts`, `dashboard/src/api.test.ts`.

**Interfaces:**
- Produces: `call(action, payload?) → Promise<any>` (throws `Error` with a code on failure); `signIn(email,password)`, `signOut()`, `getAccessToken()`; `apiErrorMessage(code) → string` (pure).

- [ ] **Step 1: Failing test for `apiErrorMessage`**

```ts
// dashboard/src/api.test.ts
import { describe, test, expect } from "vitest";
import { apiErrorMessage } from "./api";

describe("apiErrorMessage", () => {
  test("maps known codes to friendly copy", () => {
    expect(apiErrorMessage("QUOTA_EXCEEDED")).toMatch(/quota/i);
    expect(apiErrorMessage("PROVIDER_HAS_ACCOUNTS")).toMatch(/accounts/i);
    expect(apiErrorMessage("FORBIDDEN")).toMatch(/permission/i);
  });
  test("falls back to the raw code when unknown", () => {
    expect(apiErrorMessage("WAT")).toBe("WAT");
  });
});
```

- [ ] **Step 2: Run — FAIL** (`cd dashboard && npx vitest run src/api.test.ts`) — module/function missing.

- [ ] **Step 3: Implement `dashboard/src/api.ts`**

```ts
import { supabase } from "./supabase";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin`;

const MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED: "Account quota reached — raise the provider's limit to add more.",
  PROVIDER_HAS_ACCOUNTS: "Delete or reassign this provider's accounts first.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID_INPUT: "Some fields are invalid — check and try again.",
  CREATE_FAILED: "Could not create — the username/email may already exist.",
  Unauthorized: "Your session expired — please sign in again.",
};
export function apiErrorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function call<T = any>(action: string, payload: unknown = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Unauthorized");
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP_${res.status}`);
  return body as T;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}
export async function signOut() { await supabase.auth.signOut(); }
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git add dashboard/src/api.ts dashboard/src/api.test.ts && git commit -m "feat(dashboard): admin API client + error mapping"`

---

## Task 3: `lib/format.ts` — status + expiry presets (TDD)

**Files:** create `dashboard/src/lib/format.ts`, `dashboard/src/lib/format.test.ts`.

**Interfaces:** `statusLabel(status)→{text,tone}`; `expiryPreset(months, fromISO?)→ISOstring`; `fmtDate(iso)→string`.

- [ ] **Step 1: Failing test**

```ts
import { describe, test, expect } from "vitest";
import { statusLabel, expiryPreset } from "./format";
describe("format", () => {
  test("status labels", () => {
    expect(statusLabel("ACTIVE").tone).toBe("ok");
    expect(statusLabel("ACCOUNT_EXPIRED").text).toMatch(/expired/i);
    expect(statusLabel("ACCOUNT_SUSPENDED").tone).toBe("bad");
  });
  test("expiryPreset adds N months to a fixed base", () => {
    const iso = expiryPreset(1, "2026-01-15T00:00:00.000Z");
    expect(iso.startsWith("2026-02-15")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```ts
export function statusLabel(status: string): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (status) {
    case "ACTIVE": return { text: "Active", tone: "ok" };
    case "ACCOUNT_EXPIRED": return { text: "Expired", tone: "bad" };
    case "ACCOUNT_SUSPENDED": return { text: "Suspended", tone: "bad" };
    case "PROVIDER_SUSPENDED": return { text: "Provider suspended", tone: "bad" };
    default: return { text: status, tone: "warn" };
  }
}
export function expiryPreset(months: number, fromISO?: string): string {
  const base = fromISO ? new Date(fromISO) : new Date();
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}
export function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): pure status label + expiry preset helpers"`

---

## Task 4: Auth context + role gate + UI primitives

**Files:** create `dashboard/src/auth.tsx`, `dashboard/src/ui.tsx`.

**Interfaces:** `AuthProvider`, `useAuth()→{me:{role,name,quota}|null, loading, error, refresh, logout}`. `ui.tsx` exports `Button`, `Badge`, `Table`, `Modal`, `Field`.

- [ ] **Step 1: `auth.tsx`** — on mount, if a session exists, `call("me")`; store result. If `me` throws `FORBIDDEN`/`Unauthorized`, sign out and expose `error` (so a non-provider is rejected). Expose `refresh()` (re-call `me`, used after quota changes) and `logout()`.

```tsx
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { call, signOut } from "./api";
import { supabase } from "./supabase";

type Me = { role: string; name: string; quota: { used: number; max: number } };
const Ctx = createContext<{ me: Me | null; loading: boolean; error: string | null; refresh: () => void; logout: () => void }>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setMe(null); setLoading(false); return; }
    try { setMe(await call<Me>("me")); }
    catch (e) { await signOut(); setMe(null); setError("This login is not a provider account."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => load());
    return () => data.subscription.unsubscribe();
  }, [load]);

  const logout = useCallback(() => { signOut(); setMe(null); }, []);
  return <Ctx.Provider value={{ me, loading, error, refresh: load, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
```

- [ ] **Step 2: `ui.tsx`** — small presentational components. `Badge` colors by `tone` (ok=green, warn=amber, bad=red). `Table` renders `columns` + `rows`. `Modal` is a fixed overlay with children + close. `Field` is label + input. Keep them ~10-20 lines each, styled via `styles.css` classes.

- [ ] **Step 3: Verify build** — `cd dashboard && npm run build` → succeeds (types OK).
- [ ] **Step 4: Commit** — `git add dashboard/src/auth.tsx dashboard/src/ui.tsx && git commit -m "feat(dashboard): auth context with provider role gate + UI primitives"`

---

## Task 5: App shell, routing, Login screen

**Files:** create `dashboard/src/App.tsx`, `dashboard/src/screens/Login.tsx`; rewrite `dashboard/src/main.tsx`.

- [ ] **Step 1: `Login.tsx`** — email + password form → `signIn()`; on error show message; on success `onAuthStateChange` triggers `me` load. If `useAuth().error` is set, show it above the form.

- [ ] **Step 2: `App.tsx`** — `BrowserRouter`. If `loading` → spinner. If no `me` → `<Login/>`. Else render the shell: a top bar (`me.name`, role, `Logout`) + `<Routes>`:
  - `provider` role routes: `/` → `Overview`, `/accounts` → `Accounts`, `/accounts/new` → `CreateAccount`, `/accounts/:id` → `AccountDetail`.
  - `super_admin` role: the above **plus** `/providers` → `Providers`. Nav shows the Providers link only for super-admin.

- [ ] **Step 3: `main.tsx`** — wrap `<App/>` in `<AuthProvider>`.

- [ ] **Step 4: Verify** — `npm run dev`; visiting the app shows Login; a customer login is rejected with the error banner; a provider login lands on Overview.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): app shell, role-based routing, login screen"`

---

## Task 6: Overview + Accounts list

**Files:** create `dashboard/src/screens/Overview.tsx`, `dashboard/src/screens/Accounts.tsx`.

- [ ] **Step 1: `Overview.tsx`** — show `me.quota.used / me.quota.max`; fetch `accounts.list` once to compute "expiring within 7 days" (count where `expiresAt` within 7d and status ACTIVE) and total active-device count (sum `devicesUsed`). Three stat cards.

- [ ] **Step 2: `Accounts.tsx`** — a search box (debounced → `accounts.list {search}`), a `+ New account` link to `/accounts/new`, and a `Table`: columns `Username`, `Status` (`Badge` via `statusLabel`), `Expiry` (`fmtDate`), `Devices` (`devicesUsed/deviceLimit`), row click → `/accounts/:userId`. Handle empty + loading + error (via `apiErrorMessage`).

- [ ] **Step 3: Verify** — with a provider that has ≥1 account, the table lists it with the right status badge; search filters by username.
- [ ] **Step 4: Commit** — `git commit -am "feat(dashboard): overview stats + accounts list with search"`

---

## Task 7: Create account form

**Files:** create `dashboard/src/screens/CreateAccount.tsx`.

- [ ] **Step 1:** A form with fields: `username`, `password` (min 6), `deviceLimit` (number, min 1, default 1), `expiresAt` (preset buttons 1/3/6/12 mo via `expiryPreset`, plus a date input and a "No expiry" option), optional `note`, optional `email`; a `type` toggle (Xtream / M3U): Xtream → `host`, `username`, `password`, optional `nickname`; M3U → `url`, optional `nickname`.

- [ ] **Step 2:** On submit build the `line` object per `type` and `call("accounts.create", {...})`. On `{userId}` → navigate to `/accounts/:userId`. On `{error:"QUOTA_EXCEEDED"}` or `INVALID_INPUT` (with `fields`) show `apiErrorMessage` + highlight the returned `fields`.

- [ ] **Step 3: Verify** — creating an account succeeds and lands on its detail; exceeding quota shows the quota message; a 3-char username shows the invalid-field hint.
- [ ] **Step 4: Commit** — `git commit -am "feat(dashboard): create-account form with line provisioning + expiry presets"`

---

## Task 8: Account detail + devices

**Files:** create `dashboard/src/screens/AccountDetail.tsx`.

- [ ] **Step 1:** On mount `call("accounts.get",{userId})`. Render:
  - Header: username, `Badge` status, created/expiry.
  - **Subscription card:** device limit (editable → `accounts.update {deviceLimit}`); expiry with renew presets + date + clear (`accounts.update {expiresAt}`); a **Suspend/Unsuspend** toggle (`accounts.update {suspended}`); note field.
  - **Security card:** reset password (`accounts.setPassword {password}`), confirm dialog.
  - **IPTV line card:** editable line (type toggle + fields; password blank means "unchanged" — only send `password` when non-empty) → `accounts.updateLine {line}`.
  - **Devices card:** `call("devices.list",{userId})` → `Table` (`platform`, `label`, `last_seen_at` via `fmtDate`, `bound_at`, revoked badge). Per row: `Revoke`/`Re-enable` (`devices.revoke`/`unrevoke`) and `Remove` (`devices.remove`, frees a slot). Refresh the list after each action.
  - **Danger:** `Delete account` (`accounts.delete`) behind a typed-confirm dialog → navigate to `/accounts`.

- [ ] **Step 2:** After any mutation, re-`get` (and re-`devices.list`) so the UI reflects server truth.

- [ ] **Step 3: Verify** — set expiry to the past → status flips to Expired and the customer's app `data` call 403s; suspend → same; revoke a device → the device shows revoked and the customer is locked; remove frees a slot (device count drops).
- [ ] **Step 4: Commit** — `git commit -am "feat(dashboard): account detail — subscription, line, password, device revoke"`

---

## Task 9: Super-admin — Providers screen

**Files:** create `dashboard/src/screens/Providers.tsx`.

- [ ] **Step 1:** (super-admin only route) `call("providers.list")` → `Table`: `name`, `accounts_used/max_accounts`, `suspended` badge, actions. `+ New provider` modal (`providers.create {email,password,name,maxAccounts}`). Row edit modal: `name`, `maxAccounts`, `Suspend` toggle (`providers.update`). `Delete` (`providers.delete`) → on `{error:"PROVIDER_HAS_ACCOUNTS"}` show the friendly message. After create/edit call `useAuth().refresh()` if the edited provider is the caller.

- [ ] **Step 2:** Optional read-only drill-in: clicking a provider sets a `providerId` filter and links to `/accounts?providerId=…`; `Accounts` passes `providerId` to `accounts.list`. (Read-mostly per spec — no create/edit from the super-admin drill-in in v1.)

- [ ] **Step 3: Verify** — super-admin creates a provider; that provider can log in and manage accounts; provider role never sees the Providers link and gets `FORBIDDEN` if it calls `providers.*`.
- [ ] **Step 4: Commit** — `git commit -am "feat(dashboard): super-admin providers management screen"`

---

## Task 10: Build, deploy notes, final gate

**Files:** create `dashboard/README.md`.

- [ ] **Step 1:** `dashboard/README.md` — how to run (`npm install`, copy `.env.example`→`.env`, `npm run dev`), how to build (`npm run build` → `dist/`), and deploy (any static host; set the two `VITE_` env vars at build time). Note the one-time super-admin bootstrap SQL lives in `supabase/README.md`.

- [ ] **Step 2: Final gate** — `cd dashboard && npm test && npm run build`
Expected: Vitest green; `dist/` produced.

- [ ] **Step 3: Commit** — `git add dashboard/README.md && git commit -m "docs(dashboard): run/build/deploy notes"`

---

## Self-Review (completed by plan author)

- **Spec coverage:** separate Vite+React+TS app ✓ (T1); auth via signInWithPassword + `me` role gate rejecting customers ✓ (T4-T5); overview quota/expiring/devices ✓ (T6); accounts list+search ✓ (T6); create with full line + expiry presets ✓ (T7); detail edit limit/expiry/suspend/password/line + device revoke/unrevoke/remove ✓ (T8); super-admin providers CRUD + read-mostly drill-in ✓ (T9); deploy separate from player ✓ (T1, T10).
- **Placeholder scan:** UI screens (T5-T9) specify exact fields, actions, and payloads against the API reference; the contract-critical `api.ts`/`auth.tsx`/`format.ts` have full code + tests. Presentational `ui.tsx` and screen JSX are specified by behavior + exact API calls (mechanical rendering), not left as "TODO".
- **Type consistency:** `call(action,payload)` return shapes match the API reference table (which mirrors the backend plan); `status` constants match `accountStatus.js`; `line` object shape matches `validateLine`.
- **Note:** component-level rendering is verified via manual click-through (documented per task), per the spec's "component tests deferred; v1 focuses on backend correctness"; the app's own pure logic (`api`, `format`) is unit-tested with Vitest.

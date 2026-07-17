# Connectivity & provider error handling — design

**Date:** 2026-07-17
**Status:** Approved, pending implementation plan

## Problem

Two symptoms, one root cause.

1. **Login.** When the connection is down (e.g. ISP quota exhausted → the ISP's
   fair-usage gateway returns a Cloudflare-style `521`, or a reset / timeout),
   `signIn` fails but the app shows a *generic* "Could not sign in right now.
   Please try again." — which reads like a credentials/service problem, not a
   connection problem, and offers no retry affordance.

2. **Content screens (Live / Movies / Series).** On a connection failure the app
   shows the **cached** category list (categories are persisted to disk), then
   each category shelf spins and eventually **silently empties** — and *no*
   "check your connection" state is ever shown.

### Root cause

Connectivity errors are **misclassified as "transient"** and swallowed. Only
**auth** errors (HTTP 401/403) are ever surfaced:

- `isAuthError()` matches only 401/403 (`src/utils/authError.js`). A
  network / timeout / 5xx / 521 is explicitly *not* an auth error.
- The content "if one fails, all fail" circuit breaker trips **only** on auth
  errors (`useLiveTV.js`, `useCatalog.js`), so a connectivity error never calls
  `setError(true)`; the shelf fetch just retries (`SHELF_FETCH_RETRIES`) then
  marks the shelf `[]` (hidden).
- `authErrorMessage()` returns `null` for network/timeout/5xx, so even when an
  error panel *does* show (categories uncached), the real reason is discarded in
  favor of generic copy.
- On login, `mapLoginResult()` (`loginResult.logic.js`) collapses every
  transport fault into one generic string, losing the connectivity signal.

The fetch engine's bounded retry + 15s timeout (`iptvApi.js`) is **correct and
stays** — the bug is purely in classification and surfacing.

## Goals

- Distinguish "**couldn't connect**" (reachability) failures from real errors.
- On content screens, **surface the real provider error message + HTTP/status
  code** instead of generic copy or a silent empty shelf.
- Give the user a **Retry** affordance on both login and content screens.
- Cover Live / Movies / Series across web, native, and TV via the shared hooks.

## Non-goals (scope guardrails)

- No changes to the `iptvApi.js` fetch/retry engine.
- No global connectivity layer / offline banner / auto-retry-on-reconnect (the
  "app-wide layer" option was declined).
- Login stays Supabase-friendly — it must **not** leak Supabase internals (e.g.
  "Edge Function returned a non-2xx status code"); it may show `(HTTP <status>)`
  when a gateway status is present.

## Design

### 1. New pure module `src/utils/networkError.logic.js` (CommonJS)

Mirrors the existing `*.logic.js` convention (`loginResult.logic.js` is CommonJS
and already imported by ESM `supabase.js`, so interop is proven). Unit-testable
without the client.

- `CONNECTIVITY_MESSAGE` — `"Can't reach the server. Check your internet connection and try again."`
- `errorStatus(err)` → number | null — reads `err.status`, then
  `err.context?.status` (Supabase `FunctionsHttpError` carries the `Response` in
  `.context`), then parses the `"status: N"` text the fetch layer throws.
- `isConnectivityError(err)` → boolean. **True** for:
  - Supabase `FunctionsFetchError` / `FunctionsRelayError` (by `err.name`)
  - gateway status **520–524** (incl. 521) and **502 / 503 / 504**
  - raw fetch failures: `failed to fetch`, `network request failed`,
    `networkerror`, `load failed`, `fetch failed`
  - `AbortError` / timeouts: `timed out`, `timeout`, `etimedout`, `econnrefused`,
    `econnreset`, `enotfound`
  - **False** when `err.providerError` is set (a provider error envelope means
    the server *was* reachable — that's a provider/account problem, not
    connectivity).

### 2. `src/utils/authError.js` — add `describeError(err)` (ESM)

Single entry point for "what message do we show?". Always returns a real,
non-empty, user-facing string, choosing by error kind and **folding the real
status + provider message into the copy**:

| Error kind | Message shown |
|---|---|
| Pure network / timeout (no status) | `CONNECTIVITY_MESSAGE` |
| Gateway 5xx incl. 521 | `Can't reach the server. … (HTTP <status>)` |
| Provider envelope (expired/blocked) | provider's own `userMessage` + `(status: N)` |
| Auth 401/403 | account-expired copy + status |
| Other HTTP / non-JSON body | `The provider returned an error (HTTP <status>)` + real snippet |

`errorStatus` / `isConnectivityError` are imported from
`networkError.logic.js`. Existing `isAuthError` / `authErrorMessage` remain (the
latter reused internally by `describeError` for the auth case).

### 3. Content hooks — `useLiveTV.js` + `useCatalog.js`

These back Live / Movies / Series on every platform, so the fix lands once.

- **Generalize the auth-only circuit breaker into a fatal-error breaker** that
  trips on `isAuthError(err) || isConnectivityError(err)`. On a connectivity
  error the shelf-fetch catch now calls `setError(true)` +
  `setErrorMessage(describeError(err))` — replacing the spinning/silent-empty
  shelves with the shared error panel showing the real reason.
- Swap `authErrorMessage(err)` → `describeError(err)` at the **category-load**
  catch too, so an uncached-category connectivity failure shows the real reason.
- **Reset the breaker at the start of `reload()`** so the Retry button actually
  re-attempts (verify current reset behavior during implementation).

### 4. Screens — wire Retry

`StatePanel` already renders a Retry button when passed `onRetry`
(`src/ui/StatePanel.jsx`). Ensure the content error panels (Live / Movies /
Series — web, native, tv) pass `onRetry={reload}`. Audit each variant during
implementation; only add where missing.

### 5. Login — `loginResult.logic.js` + `AuthScreen.jsx`

- `loginResult.logic.js` (CommonJS): `require` `networkError.logic.js`; in the
  `if (error)` branch, when `isConnectivityError(error)` throw
  `new Error(CONNECTIVITY_MESSAGE)` tagged `.kind = "network"` (optionally
  appending `(HTTP <status>)` when present); otherwise keep today's generic
  message unchanged.
- `AuthScreen.jsx`: in `catch`, add a branch for `err.kind === "network"` that
  sets the connectivity message and a `canRetry` flag; render a **Retry** button
  in the existing error panel (only when `canRetry`) that re-calls
  `handleSubmit`. Email/password persist in state, so retry is one tap.

### 6. Tests (`node:test`, `*.test.js` beside source)

- `networkError.logic.test.js` — each shape (FunctionsFetchError, status
  521/523/503, "Failed to fetch", AbortError, timeout) is `true`; a real
  400/invalid-credentials, a provider envelope, and `null` are `false`.
  `errorStatus` extraction from `.status`, `.context.status`, and message text.
- `authError` tests — `describeError` returns the table's copy incl. status for
  each kind.
- `loginResult.test.js` — connectivity error → throws `CONNECTIVITY_MESSAGE`
  with `kind:"network"`; a non-connectivity transport error → still generic.
- `useLiveTV` / `useCatalog` — a connectivity error during shelf load trips
  `error` (not silent-empty) and sets a message via `describeError`.

## Files touched

**New:** `src/utils/networkError.logic.js`, `src/utils/networkError.logic.test.js`

**Edited:** `src/utils/authError.js` (+ tests), `src/services/loginResult.logic.js`
(+ tests), `src/screens/AuthScreen.jsx`, `src/domain/hooks/useLiveTV.js`,
`src/domain/hooks/useCatalog.js`, and the content screen variants that need
`onRetry` wired.

## Verification

- `npm test` and `npm run lint` pass.
- Manual: simulate a dead connection (airplane mode / blocked host) →
  - Login shows the connectivity message + Retry (not "Could not sign in").
  - Live/Movies/Series show the error panel with the real reason + status +
    Retry, instead of spinning shelves that silently empty.
  - A genuine 401/403 (expired account) still shows the account message.
  - A healthy connection is unaffected.

# Connectivity & Provider Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect "can't reach the server" failures (network down / timeout / gateway 521) and surface honest copy — the real provider message + HTTP status on content screens, a clear connectivity message + Retry on login — instead of a raw/generic error, a silent-empty shelf, or a spinner that never resolves.

**Architecture:** One pure classifier module (`networkError.logic.js`) is the single source of truth for "is this a reachability fault?" and "what status does this error carry?". A new `describeError()` in `authError.js` turns any load error into honest, non-empty user copy (folding in the real provider message + status). The login path tags connectivity faults so the login screen can show a friendly message; the two shared content hooks (`useLiveTV`, `useCatalog`) already own an auth-only circuit breaker + error panel — we broaden the trip condition to also fire on connectivity faults. The content screens already pass `onRetry={reload}`, so no screen wiring is needed there.

**Tech Stack:** Expo/React Native 0.81 + react-native-web, React 19, JavaScript only. Tests: `node:test` (`npm test`), no Jest. Lint: eslint flat config (`npm run lint`).

## Global Constraints

- JavaScript only — `.js` / `.jsx`, never TypeScript.
- Pure logic lives in `*.logic.js` using CommonJS (`module.exports`); everything else is ESM (`import`/`export`). ESM files may import a `.logic.js` via named import — proven in-repo (`supabase.js` imports `loginResult.logic.js`).
- Tests sit beside source as `*.test.js`, run via `node --test`. The repo unit-tests **pure logic only** — it does NOT render React hooks/components. Do not add a hook/component test harness (no react-test-renderer / RTL).
- Do NOT modify the fetch/retry engine in `src/services/iptvApi.js` — its bounded retry + 15s timeout stay as-is.
- Login must NOT leak Supabase internals (e.g. "Edge Function returned a non-2xx status code"). It may show `(HTTP <status>)` when a gateway status is present.
- `npm test` and `npm run lint` must both pass (eslint warnings OK, errors not).
- Match the surrounding code's comment density and naming.

---

### Task 1: `networkError.logic.js` — the pure connectivity classifier

**Files:**
- Create: `src/utils/networkError.logic.js`
- Test: `src/utils/networkError.logic.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONNECTIVITY_MESSAGE: string`
  - `errorStatus(err): number | null` — status from `.status`, `.context.status`, or `"status: N"` message text.
  - `isConnectivityError(err): boolean` — true for reachability faults; false for provider-envelope errors and normal 4xx.

- [ ] **Step 1: Write the failing test**

Create `src/utils/networkError.logic.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const {
  CONNECTIVITY_MESSAGE,
  errorStatus,
  isConnectivityError,
} = require("./networkError.logic.js");

test("CONNECTIVITY_MESSAGE is a non-empty string", () => {
  assert.equal(typeof CONNECTIVITY_MESSAGE, "string");
  assert.ok(CONNECTIVITY_MESSAGE.length > 0);
});

test("errorStatus reads .status, .context.status, and 'status: N' text", () => {
  assert.equal(errorStatus(Object.assign(new Error("x"), { status: 401 })), 401);
  assert.equal(errorStatus({ context: { status: 521 } }), 521);
  assert.equal(errorStatus(new Error("HTTP error! status: 503")), 503);
  assert.equal(errorStatus(new Error("no status here")), null);
  assert.equal(errorStatus(null), null);
});

test("isConnectivityError is true for supabase transport error names", () => {
  assert.equal(isConnectivityError({ name: "FunctionsFetchError", message: "" }), true);
  assert.equal(isConnectivityError({ name: "FunctionsRelayError", message: "" }), true);
});

test("isConnectivityError is true for gateway statuses (incl. 521)", () => {
  assert.equal(isConnectivityError({ context: { status: 521 } }), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 523")), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 503")), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 502")), true);
});

test("isConnectivityError is true for raw fetch/network and timeout errors", () => {
  assert.equal(isConnectivityError(new TypeError("Failed to fetch")), true);
  assert.equal(isConnectivityError(new Error("Network request failed")), true);
  assert.equal(isConnectivityError({ name: "AbortError", message: "" }), true);
  assert.equal(isConnectivityError(new Error("Request timed out after 15000ms")), true);
  assert.equal(isConnectivityError(new Error("connect ECONNRESET 1.2.3.4:443")), true);
});

test("isConnectivityError is false for auth, normal 4xx, provider envelope, and nullish", () => {
  assert.equal(isConnectivityError(new Error("HTTP error! status: 401")), false);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 404")), false);
  assert.equal(isConnectivityError(Object.assign(new Error("expired"), { providerError: true, status: 512 })), false);
  assert.equal(isConnectivityError(null), false);
  assert.equal(isConnectivityError({}), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/utils/networkError.logic.test.js`
Expected: FAIL — `Cannot find module './networkError.logic.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/networkError.logic.js`:

```js
// Pure, client-free classification for "can't reach the server" failures, so the
// login path and every content screen can tell a reachability fault apart from a
// real error (auth / provider) and show honest copy. Kept as a .logic.js
// (CommonJS) so it's unit-testable under `node --test` and requireable from
// loginResult.logic.js (which is also CommonJS).

// Shown when the failure is pure connectivity (no useful provider detail).
const CONNECTIVITY_MESSAGE =
  "Can't reach the server. Check your internet connection and try again.";

// Cloudflare origin-unreachable family (520–524, incl. the 521 that started this)
// plus the classic gateway 5xx set. A response in this range means the edge
// couldn't reach the origin — i.e. a reachability problem, not a real answer.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

// Extract a numeric HTTP/provider status from the shapes errors take here:
//  - `.status`         — provider error-envelope rejections set this
//  - `.context.status` — supabase FunctionsHttpError carries the Response here
//  - "status: N" text  — what iptvApi throws ("HTTP error! status: 521")
function errorStatus(err) {
  if (!err) return null;
  if (Number.isFinite(err.status)) return err.status;
  const ctx = err.context && err.context.status;
  if (Number.isFinite(ctx)) return ctx;
  const m = /status:\s*(\d+)/i.exec(err.message || "");
  return m ? Number(m[1]) : null;
}

// True when the failure means the server was unreachable (network down, DNS,
// timeout, connection reset, or a gateway 5xx like 521) rather than a response
// the server chose to send. A provider error-envelope (a 200 whose body is an
// error) means the server WAS reachable, so it is never connectivity.
function isConnectivityError(err) {
  if (!err || err.providerError) return false;
  const name = err.name || "";
  if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return true;
  const status = errorStatus(err);
  if (status && GATEWAY_STATUSES.has(status)) return true;
  const msg = (err.message || "").toLowerCase();
  if (/failed to fetch|network request failed|networkerror|load failed|fetch failed/.test(msg)) return true;
  if (name === "AbortError") return true;
  if (/timed out|timeout|etimedout|econnrefused|econnreset|enotfound|network error/.test(msg)) return true;
  return false;
}

module.exports = { CONNECTIVITY_MESSAGE, GATEWAY_STATUSES, errorStatus, isConnectivityError };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/utils/networkError.logic.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/networkError.logic.js src/utils/networkError.logic.test.js
git commit -m "feat(errors): add pure connectivity-error classifier"
```

---

### Task 2: `describeError()` in `authError.js` — honest copy with real message + status

**Files:**
- Modify: `src/utils/authError.js` (add import + `describeError`)
- Test: `src/utils/authError.test.js` (append cases)

**Interfaces:**
- Consumes: `CONNECTIVITY_MESSAGE`, `errorStatus`, `isConnectivityError` from Task 1; existing `isAuthError` (same file).
- Produces: `describeError(err): string` — always non-empty.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/authError.test.js` (and add `describeError` to the import on line 3 so it reads `import { isAuthError, authErrorMessage, describeError } from "./authError.js";`):

```js
test("describeError shows the connectivity message (+ status) for reachability faults", () => {
  assert.match(describeError(new TypeError("Failed to fetch")), /can't reach the server/i);
  assert.match(describeError({ context: { status: 521 } }), /can't reach the server/i);
  assert.match(describeError({ context: { status: 521 } }), /\(HTTP 521\)/);
  assert.match(describeError(new Error("Request timed out after 15000ms")), /can't reach the server/i);
});

test("describeError prefers the provider's own message + status", () => {
  const err = Object.assign(new Error("Provider error: USER_EXPIRED"), { status: 401, userMessage: "Your subscription has expired" });
  assert.match(describeError(err), /Your subscription has expired/);
  assert.match(describeError(err), /status 401/);
});

test("describeError gives account copy for a bare 401/403", () => {
  assert.match(describeError(new Error("HTTP error! status: 401")), /expired or been disabled/);
});

test("describeError surfaces a real HTTP status for other provider errors", () => {
  assert.match(describeError(new Error("HTTP error! status: 404")), /provider returned an error \(HTTP 404\)/i);
});

test("describeError is always a non-empty string, even for nullish input", () => {
  assert.equal(typeof describeError(null), "string");
  assert.ok(describeError(null).length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/utils/authError.test.js`
Expected: FAIL — `describeError is not a function` (or import undefined).

- [ ] **Step 3: Write the implementation**

In `src/utils/authError.js`, add the import at the top (below the file's opening comment, before `export function isAuthError`):

```js
import { CONNECTIVITY_MESSAGE, errorStatus, isConnectivityError } from "./networkError.logic.js";
```

Then append this function to the end of the file:

```js
/**
 * A user-facing reason for ANY load failure — always a non-empty string.
 *
 * Unlike authErrorMessage (which returns null for non-auth errors so the screen
 * shows generic copy), this folds the REAL provider message and HTTP/status code
 * into the text so failures are diagnosable: a connection problem reads as a
 * connection problem, and a provider/account problem shows what the provider
 * actually said. Used by the content hooks' error panels.
 */
export function describeError(err) {
  const status = errorStatus(err);
  const httpSuffix = status ? ` (HTTP ${status})` : "";
  const statusSuffix = status ? ` (status ${status})` : "";

  // Provider error-envelope (a 200 whose body was { error, status }): the server
  // was reachable and told us something — prefer its own words.
  const provider = err?.userMessage;
  if (typeof provider === "string" && provider.trim()) {
    return `${provider.trim()}${statusSuffix}`;
  }

  // Auth / expired account.
  if (isAuthError(err)) {
    return `This account may have expired or been disabled. Please check with your provider.${statusSuffix}`;
  }

  // Reachability: network down / timeout / gateway 5xx (521, etc).
  if (isConnectivityError(err)) {
    return `${CONNECTIVITY_MESSAGE}${httpSuffix}`;
  }

  // Anything else the provider returned — surface the real detail. Collapse
  // iptvApi's own "HTTP error! status: N" string into clean copy; keep other
  // provider text (e.g. a "Non-JSON response…: Blocked" snippet) verbatim.
  const raw = (err?.message || "").trim();
  if (!raw || /^HTTP error! status:/i.test(raw)) return `The provider returned an error${httpSuffix || "."}`;
  return `The provider returned an error${httpSuffix}: ${raw}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/utils/authError.test.js`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/authError.js src/utils/authError.test.js
git commit -m "feat(errors): add describeError for honest provider/connectivity copy"
```

---

### Task 3: Login path — tag connectivity faults in `loginResult.logic.js`

**Files:**
- Modify: `src/services/loginResult.logic.js`
- Test: `src/services/loginResult.test.js` (append cases)

**Interfaces:**
- Consumes: `CONNECTIVITY_MESSAGE`, `isConnectivityError` from Task 1.
- Produces: `mapLoginResult` now throws an `Error` with `.kind === "network"` and `message === CONNECTIVITY_MESSAGE` on a connectivity fault; other transport faults still throw the generic message.

- [ ] **Step 1: Write the failing test**

Append to `src/services/loginResult.test.js`:

```js
test("throws the connectivity message + kind on a network transport fault", () => {
  try {
    mapLoginResult({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } });
    assert.fail("expected throw");
  } catch (e) {
    assert.match(e.message, /can't reach the server/i);
    assert.equal(e.kind, "network");
  }
});

test("treats a gateway 521 from the edge as connectivity", () => {
  try {
    mapLoginResult({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 521 } } });
    assert.fail("expected throw");
  } catch (e) {
    assert.match(e.message, /can't reach the server/i);
    assert.equal(e.kind, "network");
  }
});
```

Note: the existing test "throws a generic message on a transport error" (error message `"Edge Function returned a non-2xx status code"` with no status) still passes — that shape is not a connectivity error, so it keeps the generic copy.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/services/loginResult.test.js`
Expected: FAIL — the network cases hit the generic message / have no `.kind`.

- [ ] **Step 3: Write the implementation**

In `src/services/loginResult.logic.js`, add the require at the top (after the opening comment, before `function mapLoginResult`):

```js
const { CONNECTIVITY_MESSAGE, isConnectivityError } = require("../utils/networkError.logic.js");
```

Replace the `if (error) { ... }` block with:

```js
  if (error) {
    // A connectivity fault (network down / timeout / gateway 521) is worth telling
    // the user plainly, and it's retryable — distinct from a real sign-in failure.
    // Tag it so AuthScreen can show the connection message + a Retry affordance.
    if (isConnectivityError(error)) {
      const e = new Error(CONNECTIVITY_MESSAGE);
      e.kind = "network";
      throw e;
    }
    // Other transport faults: keep generic and opaque — its message leaks
    // internals ("Edge Function returned a non-2xx status code"). Keep generic.
    throw new Error("Could not sign in right now. Please try again.");
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/services/loginResult.test.js`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/loginResult.logic.js src/services/loginResult.test.js
git commit -m "feat(auth): tag login connectivity faults with a friendly retryable message"
```

---

### Task 4: `AuthScreen.jsx` — show the connectivity message + Retry

**Files:**
- Modify: `src/screens/AuthScreen.jsx`

**Interfaces:**
- Consumes: the thrown error's `.kind === "network"` from Task 3.
- Produces: no exports; behavior only.

No unit test — the repo does not render components in tests. Verified by lint + full suite + manual smoke.

- [ ] **Step 1: Add a `retryable` state flag**

In `src/screens/AuthScreen.jsx`, after `const [loading, setLoading] = useState(false);` (line ~29) add:

```js
  const [retryable, setRetryable] = useState(false);
```

- [ ] **Step 2: Handle the network kind in `handleSubmit`**

At the top of `handleSubmit`, alongside `setError("")`, add `setRetryable(false);`. Then in the `catch (err)` block, add a `kind` branch as the FIRST condition:

```js
    } catch (err) {
      const msg = err.message || "";
      if (err.kind === "network") {
        setError(msg || "Can't reach the server. Check your internet connection and try again.");
        setRetryable(true);
      } else if (
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("email rate limit")
      ) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError(
          "Please check your email and confirm your account before signing in.",
        );
      } else if (
        msg.toLowerCase().includes("invalid login credentials") ||
        msg.toLowerCase().includes("invalid email or password")
      ) {
        setError("Invalid email or password.");
      } else {
        setError(msg);
      }
    } finally {
```

- [ ] **Step 3: Render a Retry button for network errors**

Immediately after the closing `)}` of the `{!!error && ( ... )}` error panel (line ~218) and before the `<Button variant="primary" ...>Sign In</Button>`, add:

```jsx
          {retryable && (
            <Button
              variant="secondary"
              size="md"
              onPress={handleSubmit}
              disabled={loading}
              style={{ marginTop: ss(12), width: "100%" }}
            >
              Retry
            </Button>
          )}
```

(If `Button` has no `"secondary"` variant, use the same variant the app uses for secondary actions — check `src/ui/Button.jsx` for the available `variant` values and pick the non-primary one.)

- [ ] **Step 4: Lint + full suite**

Run: `npm run lint && npm test`
Expected: no eslint errors; all tests pass.

- [ ] **Step 5: Manual smoke (web)**

Start the app (`npm run web` or the project's run skill), turn off networking (or block the Supabase host), attempt login. Expect: the connectivity message + a Retry button, NOT "Could not sign in right now". Re-enable networking, tap Retry → login proceeds.

- [ ] **Step 6: Commit**

```bash
git add src/screens/AuthScreen.jsx
git commit -m "feat(auth): show connectivity message + Retry on login network failure"
```

---

### Task 5: `useLiveTV.js` — trip the error panel on connectivity faults

**Files:**
- Modify: `src/domain/hooks/useLiveTV.js`

**Interfaces:**
- Consumes: `isConnectivityError` (Task 1), `describeError` (Task 2), existing `isAuthError`.
- Produces: no new exports; on a connectivity fault during channel load, sets `error=true` + `errorMessage=describeError(err)` and trips the breaker (fast-fails remaining shelves).

No unit test (hooks are not rendered in tests) — verified by lint + suite + manual smoke.

- [ ] **Step 1: Update imports**

Find the authError import (currently `import { isAuthError, authErrorMessage } from "../../utils/authError";`) and change it to:

```js
import { isAuthError, describeError } from "../../utils/authError";
import { isConnectivityError } from "../../utils/networkError.logic.js";
```

- [ ] **Step 2: Broaden the channel-fetch catch (breaker)**

In `getChannels`, replace the `catch (err) { ... }` block (the one containing `if (isAuthError(err)) { authFailedRef.current = true; ... }`) with:

```js
    } catch (err) {
      // Auth (401/403) OR a connectivity fault (network / timeout / gateway 521)
      // both mean every remaining category fails the same way — trip the breaker
      // and surface the error panel once, instead of letting shelves spin then
      // silently empty (which read as "categories keep loading" on a dead link).
      if (isAuthError(err) || isConnectivityError(err)) {
        authFailedRef.current = true;
        setError(true);
        setErrorMessage(describeError(err));
      }
      throw err;
    }
```

- [ ] **Step 3: Use describeError for the category-load failure**

In `loadCategories`, change `setErrorMessage(authErrorMessage(err));` to:

```js
      setErrorMessage(describeError(err));
```

- [ ] **Step 4: Lint + full suite**

Run: `npm run lint && npm test`
Expected: no eslint errors (no unused `authErrorMessage` import remaining); all tests pass.

- [ ] **Step 5: Manual smoke (Live TV)**

Open Live TV on a dead/blocked connection with categories already cached from a prior session. Expect: the error panel with the connectivity message + status + Retry, NOT category rows whose shelves spin then vanish. Tap Retry on a restored connection → channels load.

- [ ] **Step 6: Commit**

```bash
git add src/domain/hooks/useLiveTV.js
git commit -m "fix(livetv): surface connectivity errors instead of silently empty shelves"
```

---

### Task 6: `useCatalog.js` — trip the error panel on connectivity faults (Movies/Series)

**Files:**
- Modify: `src/domain/hooks/useCatalog.js`

**Interfaces:**
- Consumes: `isConnectivityError` (Task 1), `describeError` (Task 2), existing `isAuthError`.
- Produces: same behavior as Task 5 for the Movies/Series shelves.

No unit test (hooks are not rendered) — verified by lint + suite + manual smoke.

- [ ] **Step 1: Update imports**

Change `import { isAuthError, authErrorMessage } from "../../utils/authError";` (line 7) to:

```js
import { isAuthError, describeError } from "../../utils/authError";
import { isConnectivityError } from "../../utils/networkError.logic.js";
```

- [ ] **Step 2: Broaden the shelf-fetch catch (breaker)**

In `handleShelfVisible`, replace the `catch (err) { ... }` block (lines ~197–214) with:

```js
    } catch (err) {
      // A provider auth error (401/403) OR a connectivity fault (network / timeout
      // / gateway 521) means every category fails the same way — trip the breaker
      // and surface the full error panel ("if one fails, all fail") instead of
      // hiding this shelf and letting the rest spin then silently empty.
      if (isAuthError(err) || isConnectivityError(err)) {
        authFailedRef.current = true;
        console.warn(`${logName}: access denied / unreachable loading shelf "${catId}" — stopping`, err);
        setError(true);
        setErrorMessage(describeError(err));
        return;
      }
      // Isolated (non-auth, non-connectivity) failure: hide just this shelf
      // (items:[] → ContentShelf renders null). loadedRef still holds catId, so it
      // won't retry — no loop. Log it so a broken rail isn't a silent mystery.
      console.warn(`${logName}: shelf "${catId}" failed to load`, err);
      setShelves((prev) => prev.map((s) =>
        s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s));
    }
```

- [ ] **Step 3: Use describeError for the category-load failure**

In `load`, change `setErrorMessage(authErrorMessage(err));` (line ~155) to:

```js
      setErrorMessage(describeError(err));
```

- [ ] **Step 4: Lint + full suite**

Run: `npm run lint && npm test`
Expected: no eslint errors (no unused `authErrorMessage`); all tests pass.

- [ ] **Step 5: Manual smoke (Movies + Series)**

Open Movies and Series on a dead/blocked connection with categories cached. Expect: the error panel with the real reason + status + Retry, NOT shelves that spin then silently empty. Tap Retry on a restored connection → catalog loads.

- [ ] **Step 6: Commit**

```bash
git add src/domain/hooks/useCatalog.js
git commit -m "fix(catalog): surface connectivity errors instead of silently empty shelves"
```

---

### Task 7: Full verification + close-out

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass, including the new `networkError.logic`, `authError`, and `loginResult` cases.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (warnings OK).

- [ ] **Step 3: Regression smoke — a real account (healthy connection)**

Log in and open Live/Movies/Series on a working connection. Expect: normal behavior, no error panels.

- [ ] **Step 4: Regression smoke — expired/blocked account (401/403)**

With an expired account (or forced 403), open a content screen. Expect: the account message ("expired or been disabled") still shows — connectivity handling did not regress auth handling.

- [ ] **Step 5: Update the spec's testing note**

In `docs/superpowers/specs/2026-07-17-connectivity-error-handling-design.md`, update the §6 bullet about a `useLiveTV`/`useCatalog` hook test to reflect that the repo unit-tests pure logic only, so hook wiring is covered by the pure-logic tests + manual smoke (no hook-render test added). Commit:

```bash
git add docs/superpowers/specs/2026-07-17-connectivity-error-handling-design.md
git commit -m "docs: align connectivity spec testing note with repo's pure-logic test policy"
```

---

## Self-Review

**Spec coverage:**
- §1 `networkError.logic.js` (CONNECTIVITY_MESSAGE, errorStatus, isConnectivityError) → Task 1. ✓
- §2 `describeError` table (network / gateway+status / provider envelope / auth / other HTTP) → Task 2. ✓
- §3 content hooks fatal-error breaker + describeError at category-load → Tasks 5, 6. ✓
- §4 wire Retry → already wired on all content screens (verified in research); login Retry → Task 4. ✓
- §5 login classification + AuthScreen message/Retry → Tasks 3, 4. ✓
- §6 tests → Tasks 1–3 (pure-logic TDD); hook/screen wiring verified by suite+lint+manual (Task 7), spec note corrected in Task 7 Step 5. ✓
- Non-goals (no iptvApi engine change, no global layer) respected. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one conditional ("if Button has no secondary variant") names the exact file to check and the rule to apply — not a placeholder.

**Type consistency:** `errorStatus`/`isConnectivityError`/`CONNECTIVITY_MESSAGE` (Task 1) are consumed with the same names in Tasks 2, 3, 5, 6. `describeError` (Task 2) is consumed with the same signature in Tasks 5, 6. `.kind === "network"` set in Task 3 is read in Task 4. `authFailedRef` reused (not renamed) in Tasks 5, 6 — matches the existing code.

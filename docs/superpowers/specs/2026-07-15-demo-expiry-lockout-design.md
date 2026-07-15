# Time-limited demo build — auto-expiry + server kill

**Date:** 2026-07-15
**Status:** Design approved, pending implementation plan
**Author:** Andrew Hany (with Claude)

## Problem

We want to hand a prospective client an Android APK for a demo, but ensure they
cannot keep using the app after the demo period ends. The client connects their
**own** IPTV subscription, so we cannot revoke content — the lockout must live in
our app.

The app already requires a Supabase login (`auth` gate) and already binds one
device per account (`claim-device` → `device-locked` gate). We exploit both.

## Goals

- A demo APK stops being usable after a **fixed, per-build deadline**.
- The deadline is **automatic** (no manual step) and works **offline**.
- It **resists a device-clock rollback** without adding any native module.
- We retain a **manual, tamper-proof kill switch** for the case where the client
  is technical enough to bypass the client-side gate or reinstalls the app.
- Zero impact on normal iOS / web / Electron / TV / production builds.

## Non-goals

- Bulletproof anti-tamper against a determined reverse-engineer on the client
  side. The client-side gate is a convenience/soft layer; the server kill is the
  real lock (and requires the device to come online once).
- First-launch-relative trials, per-user remote deadlines, or a licensing
  server. Out of scope — the deadline is a build-time constant.

## Approach (two independent layers)

| Layer | Trigger | Works offline? | Bypassable? | Manual step? |
|-------|---------|----------------|-------------|--------------|
| **A. Client auto-expiry** | Baked-in date, checked against trusted network time | Yes (fail-open) | Yes, by a determined reverse-engineer; resets on reinstall | No |
| **B. Server kill** | You flip a DB flag | No (needs device online) | No | Yes |

Together: the demo expires automatically at the baked date; if the client tries
to evade it (reinstall, clock games, patching), you flip the server flag and the
app locks the next time it touches the network.

---

## Layer A — client-side automatic expiry

### A1. Build-time deadline (demo-build-only)

New pure module **`src/config/demoExpiry.js`**:

```js
// Literal read so babel-preset-expo's expoInlineEnvVars plugin inlines it into
// the Hermes bundle at build time. Do NOT destructure/alias process.env or the
// inline won't happen. Unset/invalid => not a demo build => never locks.
const RAW = process.env.EXPO_PUBLIC_DEMO_EXPIRES_AT || "";
export function demoExpiryMs() {
  const t = Date.parse(RAW);
  return Number.isFinite(t) ? t : null; // null => feature off
}
```

- Same `EXPO_PUBLIC_*` convention as `EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_TMDB_API_KEY`.
- **Naming hygiene:** the *value* (an ISO date) is what gets inlined; keep it
  generic. Storage keys and internal identifiers avoid the words
  `demo`/`trial`/`expired` (Hermes preserves the string table in cleartext).

New npm script in **`package.json`** (confirmed: the local `apk` script runs
`gradlew assembleRelease`, which bundles via `bundleCommand = "export:embed"` →
the same Metro + babel pipeline as `expo export`, so `EXPO_PUBLIC_*` IS inlined
for the bare gradle build):

```jsonc
// Metro's transform cache does NOT key on EXPO_PUBLIC values, so clear it when
// toggling demo/non-demo builds or a stale inlined date can be served.
"apk:demo": "rm -rf \"$TMPDIR\"/metro-* node_modules/.cache && cd android && ./gradlew clean assembleRelease && echo \"\\nDEMO APK → android/app/build/outputs/apk/release/app-release.apk\""
```

Usage: `EXPO_PUBLIC_DEMO_EXPIRES_AT=2026-07-22T00:00:00Z npm run apk:demo`

Optional `demo` profile in **`eas.json`** (cloud builds) with an `env` block —
scoped so it never extends a profile used for production.

**Hard rule:** the demo var must **never** be committed to `.env`, `.env.local`,
or `.env.production`. A release build sets `NODE_ENV=production` and `@expo/env`
loads those into *every* native build — that would leak demo mode into
production. The value lives **only** inline in the `apk:demo` invocation and the
EAS `demo` profile.

### A2. Trusted-time module (clock-rollback resistant, no native module)

Mirrors the existing `security/` three-part shape
(`integrityPolicy.js` → `deviceIntegrity.js` → `useDeviceIntegrity.js`).
Reuses `src/utils/storage.js` (the AsyncStorage default export; works on native
**and** web/Electron/TV). **No `expo-secure-store`** — it is not a dependency and
would force a prebuild.

**`src/security/trustedTimePolicy.js`** — pure, `node:test`-able, no I/O:

- `parseHttpDate(headerValue) → number | null` — `Date.parse` handles the
  RFC 9110 IMF-fixdate the `Date` header always uses (always GMT); validate with
  `isPlausibleEpochMs`.
- `parseCloudflareTraceTs(bodyText) → number | null` — regex `ts=` (unix seconds,
  fractional) → ms.
- `isPlausibleEpochMs(ms) → boolean` — require
  `Date.UTC(2020,0,1) < ms < Date.UTC(2100,0,1)`.
- `evaluateExpiry({ nowMs, networkMs, hwmMs, expiryMs, offlinePolicy, skewToleranceMs }) → { expired, trusted, rollbackDetected, effectiveMs, monotonicMs, newHwmMs, reason }`
  — the whole decision (algorithm below).

**`src/security/trustedTime.js`** — async wrapper:

- `fetchNetworkTimeMs({ timeoutMs = 4000, signal }) → Promise<number|null>` —
  try providers in order, return first valid ms, `null` if all fail (= offline).
  Copy the timeout pattern from `src/services/iptvApi.js` `_fetchOnce`
  (~lines 300–376): `AbortController` + a `setTimeout` that both aborts **and**
  rejects, `Promise.race([request, deadline])` (some RN fetch engines don't
  reject a hung request on abort alone). Each request uses
  `cache: 'no-store'` + a cache-bust query param.
- `isDemoExpired({ offlinePolicy = 'open', ... }) → Promise<{expired, trusted, rollbackDetected, reason}>`
  — reads HWM from storage, calls `fetchNetworkTimeMs`, runs `evaluateExpiry`,
  persists the advanced HWM.

**`src/security/useDemoLockout.js`** — React hook:

- Returns `{ status: 'checking' | 'ok' | 'expired', recheck }`.
- Runs `isDemoExpired()` on mount and on `AppState` → `'active'` (reusing the
  `AppState.addEventListener` pattern already in `AppContext.jsx` ~lines 582–587;
  react-native-web maps it to visibility so it works on Electron/web).
- If `demoExpiryMs()` is `null` (not a demo build), short-circuits to `'ok'` and
  makes no network call.
- Starts optimistic (`'checking'` = not blocking) so cold start isn't delayed —
  matches the lazy-Supabase init decision.

**Endpoints (verified reachable with readable `Date`/body on all platforms):**

- **Primary — TMDB:** `GET ${TMDB_BASE}/configuration?api_key=${API_KEY}&_cb=${nonce}`,
  read `res.headers.get('date')`. Already integrated
  (`src/services/tmdbApi.js`); TMDB sets `access-control-expose-headers: *` so the
  header is readable on web/Electron/TV.
- **Fallback — Cloudflare:** `GET https://cloudflare.com/cdn-cgi/trace`, parse
  `ts=` from the body (`access-control-allow-origin: *`). Independent operator,
  key-free.

**Decision algorithm (`evaluateExpiry`):**

```
effectiveMs   = isFinite(networkMs) ? networkMs : nowMs
trusted       = networkMs != null
monotonicMs   = max(effectiveMs, hwmMs ?? -Infinity)   // high-water-mark floor
rollbackDetected = hwmMs != null && effectiveMs < hwmMs - skewToleranceMs

expired = monotonicMs >= expiryMs

if !trusted (offline):
    if rollbackDetected: expired = true              // fail CLOSED on tamper evidence
    else: honor offlinePolicy = 'open'               // fail OPEN on benign offline
                                                     // (still expired if floor >= expiry)

// advance HWM ONLY from a trusted reading — never from the device clock,
// so an accidentally-future device clock can't poison it permanently
newHwmMs = trusted ? max(hwmMs ?? 0, networkMs) : (hwmMs ?? 0)
```

- `skewToleranceMs` = 5 min (absorbs NTP jitter / a slightly stale HWM).
- Storage keys (generic names): `iptv_t_hwm` (high-water-mark epoch ms as string),
  `iptv_t_seen` (first trusted observation, diagnostics).

### A3. Gate wiring

- **`src/navigation/appGate.js`**: add `"expired"` to the `Gate` typedef; add
  `demoExpired` to the destructure; insert `if (demoExpired) return "expired";`
  as the **first** branch (wins over `config-error` and `loading`). Keep
  `resolveGate` pure — never call `Date.now()`/the time module inside it.
- **`src/navigation/useAppGate.js`**: call `useDemoLockout()` and pass
  `demoExpired: status === 'expired'` into `resolveGate(...)`. No `AppContext`
  change needed.
- **`src/screens/DemoExpiredScreen.jsx`** (new, single unsuffixed file — shared
  across web/TV/native like `ConfigErrorScreen.jsx` / `DeviceLockedScreen.jsx`):
  terminal screen, **no user action**, **generic copy** ("This account is
  currently unavailable." — reusing the tone of `src/utils/authError.js:34`), no
  `demo`/`expired`-flavored wording. Built only from `./ui/primitives` + tokens.
- **`src/navigation/AppNavigator.jsx`** and **`AppNavigator.web.jsx`**: import the
  screen and add `if (gate === "expired") return <DemoExpiredScreen />;` as the
  first gate check. No `metro.config.js` change (its variant-swap regex only
  covers LiveTV/Movies/Series/History/Accounts/VideoPlayer, not gate screens).

### A4. Hardening (deliberately modest — Layer B is the real lock)

- Rely on **Hermes bytecode** (already on: `android/gradle.properties`
  `hermesEnabled=true`) — the release APK ships compiled bytecode, not readable
  JS. No custom APK obfuscation; `scripts/obfuscate.js` plays **no role** in the
  APK path (web/TV only). R8/ProGuard is irrelevant to a JS-in-Hermes check.
- **String hygiene:** no `demo`/`trial`/`expired`/`license` literals in shipped
  code or storage/env names, and generic user-facing copy, so
  `strings index.android.bundle | grep -i demo` finds nothing to anchor on.

---

## Layer B — server-side manual kill (existing infra)

New migration **`supabase/migrations/20260715000001_device_revoke.sql`** (additive
& idempotent, matching the existing device migrations' style):

- `alter table public.device_bindings add column if not exists revoked_at timestamptz;`
- Update `public.claim_device(...)` so the **known-device** branch returns
  `'denied'` when `revoked_at is not null` (instead of `'ok'`):

```sql
-- known device: deny if revoked, else refresh last_seen and allow
if exists (select 1 from public.device_bindings
           where user_id = p_user_id and device_id = p_device_id) then
  if exists (select 1 from public.device_bindings
             where user_id = p_user_id and device_id = p_device_id
               and revoked_at is not null) then
    return 'denied';
  end if;
  update public.device_bindings set last_seen_at = now()
    where user_id = p_user_id and device_id = p_device_id;
  return 'ok';
end if;
```

- **To end a demo:** run in the Supabase SQL editor —
  `update public.device_bindings set revoked_at = now() where user_id = '<client-uuid>';`
  On the device's next launch/resume, `claim-device` returns `'denied'` →
  existing `device-locked` screen. No client change, no redeploy of the app.
- **Zero-deploy fallback:** ban or delete the auth user in the Supabase dashboard
  (the app can't get past the `auth` gate once the JWT can't refresh).

No client-side code change is required for Layer B — it reuses the existing
`deviceStatus === "denied"` → `device-locked` path.

---

## Single-device / one-time use

Enforces "this demo is usable one time, on one device" — a stronger property than
the fixed-expiry date alone, and built entirely on existing infrastructure (no new
client code beyond Layer B's migration).

**Why it works — the Android device anchor.** On Android the device id is
`Application.getAndroidId()` (the SSAID, `src/security/deviceSignature.js:18`),
which is:

- **stable per (device + app signing key)** — the same phone always yields the
  same id for this APK;
- **persistent across uninstall/reinstall and "clear app data"** (it is a system
  value keyed to the signing key, not stored in app storage);
- **distinct per physical device**; resets only on a **factory reset**.

**Enforcement recipe:**

1. **Create the client's Supabase account yourself** and hand over the
   credentials — do not let the client self-register. This account is the anchor
   for the device binding and the server kill.
2. Leave the device limit at the **default of 1** (`DEVICE_LIMIT_DEFAULT` in the
   `claim-device` function; per-account overrides live in `device_limits`). First
   login binds the account to that phone's SSAID; any second device using the same
   account is over-limit → `denied` → `device-locked`. **One device.**
3. Because the SSAID survives reinstall/data-clear, reinstalling the same APK on
   the same phone re-matches the existing binding (`claim_device` → `ok`) rather
   than minting a new one — so **reinstalling cannot reset the enforcement**; the
   server identity is unchanged.
4. Setting `revoked_at` (Layer B) on that binding then makes the known device
   `denied` on next launch, and it **stays denied through reinstalls** on the same
   device. **Once killed, killed for good on that device.**

Net: one account → one physical device → survives reinstall / clear-data →
permanently revocable.

**Preconditions & caveats:**

- **Public sign-up must be closed for the demo** (or accepted as a hole): if the
  client can register their own Supabase account, they get a fresh, unbound
  account that only the build's expiry (Layer A) bounds. To cap at true one-time
  use, disable public sign-up, or knowingly rely on Layer A for self-made
  accounts.
- **Factory reset** yields a new SSAID (a new "device") — an extreme, unlikely
  step for a demo, but not blocked.
- **Rooted / Xposed devices** can spoof the SSAID — determined-attacker territory,
  same as the Layer A reverse-engineering caveat.
- **Android-only property:** iOS uses `identifierForVendor`, which is wiped when
  all of a vendor's apps are uninstalled, so the reinstall-persistence above does
  not hold on iOS. This demo targets the Android APK, so that is fine.

---

## File inventory

**New:**
- `src/config/demoExpiry.js`
- `src/security/trustedTimePolicy.js` + `src/security/trustedTimePolicy.test.js`
- `src/security/trustedTime.js`
- `src/security/useDemoLockout.js`
- `src/screens/DemoExpiredScreen.jsx`
- `supabase/migrations/20260715000001_device_revoke.sql`

**Modified:**
- `package.json` (add `apk:demo` script)
- `eas.json` (optional `demo` profile)
- `src/navigation/appGate.js` (+ `appGate.test.js` cases)
- `src/navigation/useAppGate.js`
- `src/navigation/AppNavigator.jsx`
- `src/navigation/AppNavigator.web.jsx`
- `supabase/functions/claim-device` migration path (SQL only; no TS change — the
  handler already forwards `claim_device`'s result)

## Testing

- **Unit (`node:test`, `npm test`):**
  - `trustedTimePolicy.test.js` — table-driven `evaluateExpiry`: before/after
    expiry; offline fail-open; rollback → fail-closed; HWM only advances from
    trusted time; future device clock doesn't poison HWM. Plus `parseHttpDate`,
    `parseCloudflareTraceTs`, `isPlausibleEpochMs`.
  - `appGate.test.js` — `"expired"` wins over app / config-error / loading /
    device-locked; absent `demoExpired` stays falsy (no regression).
  - Supabase SQL test (the runner includes `supabase/`) — `claim_device` returns
    `'denied'` for a revoked known device, `'ok'` for a non-revoked one.
- **Manual on-device (Android):**
  1. Build `EXPO_PUBLIC_DEMO_EXPIRES_AT=<~2 min out> npm run apk:demo`, install,
     confirm it locks at the deadline (foreground + on resume).
  2. Set the device clock back → still locked (HWM/rollback).
  3. Airplane mode before deadline → still usable (fail-open); after HWM has
     crossed expiry → locked.
  4. `update device_bindings set revoked_at = now()` → device shows
     `device-locked` on next launch.
  5. Build a normal `npm run apk` (var unset) → never locks.

## Honest limitations

- **Client layer resets on reinstall / "clear app data"** — AsyncStorage is
  wiped, so the HWM resets. A backendless client gate fundamentally can't stop
  this. → **Layer B** covers it: the device binding persists server-side, and on
  Android the SSAID anchor survives reinstall/data-clear (see *Single-device /
  one-time use*), so a revoked device stays revoked once it comes online once.
- **AsyncStorage is plaintext** — a rooted device / DevTools user can edit the
  HWM. Acceptable for a demo; `expo-secure-store` would harden it but is a
  forbidden native module.
- **Frida / bundle patching** bypasses any static client-side check. → Layer B.
- **`EXPO_PUBLIC_*` ships in cleartext** in the bundle (same as today's Supabase
  anon key) — the baked date is discoverable. It's a soft gate by design.
- **Web/Electron/TV demo builds** (if ever made) get weaker protection
  (`javascript-obfuscator` instead of Hermes) — out of scope here; this spec
  targets the Android APK.

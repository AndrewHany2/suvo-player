# Production Security Hardening — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorming complete) → implementation plan next
**Scope:** Force Supabase auth, one-account-one-device lock (server-enforced), functions-only data API, native hardware attestation, client obfuscation, jailbreak/root detection.

---

## 1. Goals & threat model

Chosen threats to defend against (in priority order):

1. **Account sharing** — one paid account must be usable on exactly **one device**. Permanent bind; **admin-only unbind**.
2. **Code cloning / IP theft** — raise the bar against reading/rebuilding the client, and make a cloned client useless against the backend (native).
3. **Casual tampering** — non-experts must not be able to flip a flag to bypass auth or the device lock.

**Explicitly out of scope:** stream/credential proxying (raw IPTV URLs/credentials remaining extractable is accepted).

**Hardening level chosen:** *maximal* — functions-only API on all platforms + hardware attestation on native.

## 2. Non-goals / accepted ceiling

- **True client secrecy is impossible.** The JS bundle and the Supabase anon key are extractable; obfuscation is bar-raising only.
- **TV (webOS/Tizen) and Electron have no hardware root of trust.** Device identity there is a stable-but-spoofable value. A determined reverse-engineer can copy a bound device's identity + JWT and impersonate it. This is documented and accepted; it is mitigated by store distribution, the functions-only API, and manual admin unbind — not eliminated.
- **MAC / CPU / RAM are not used as identity.** MAC is blocked/randomized on iOS, Android, webOS, Tizen and is messy/spoofable on Electron. CPU/RAM identify a *model*, not a *unit* (low entropy → collisions), and drift over time. They appear only in the informational secondary fingerprint (§7), never in the access decision.

## 3. Decisions summary

| Decision | Choice |
|---|---|
| Threat model | account sharing · code cloning · casual tampering |
| Device policy | 1 device/account, **permanent**, **admin-only unbind** |
| Launch targets | webOS TV, Samsung Tizen, iOS, Android, Electron |
| Auth | Force Supabase; **remove local fallback**; config mandatory |
| Data API | **Edge-Functions-only**; revoke direct table access |
| Device identity (native) | **App Attest (iOS) / Play Integrity (Android)** — hardware-backed, unforgeable |
| Device identity (TV/Electron) | stable persisted UUID (webOS/Tizen) / `node-machine-id` (Electron) |
| Secondary fingerprint | composite hardware/software hints, **informational only** |
| Obfuscation | web exports: `javascript-obfuscator` (light–medium); native: Hermes; Electron: asar + fuses |
| Jailbreak/root | `jail-monkey` **soft-block** (warn) as cheap first gate; attestation is the real check |

## 4. Architecture overview

```
Client (RN / web export)
  ├─ Auth: supabase-js GoTrue directly (signIn/signUp/signOut/session)
  ├─ Device signature module (primary anchor + secondary composite)
  └─ Data access: functions.invoke(...) ONLY  ── no .from() on protected tables
                         │
                         ▼
Supabase Edge Functions (Deno, service_role)
  ├─ claim-device      → atomic bind-or-verify (+ attestation verify on native)
  ├─ data-* functions  → verify JWT → verify device binding → op via service role
  └─ (admin) unbind    → service_role only
                         │
                         ▼
Postgres
  ├─ device_bindings (user_id PK)  ← the one-device hard constraint
  └─ profiles / app_profiles / iptv_accounts / watch_history / favorites
       (RLS ON as defense-in-depth; NOT exposed to anon/authenticated via PostgREST)
```

**Enforcement principle:** authentication (getting a JWT) is decoupled from access. The device lock is a separate server-side gate between "authenticated" and "can read/write data."

## 5. Component specs

### A. Forced auth (remove local fallback)
- Supabase config becomes **mandatory**: missing `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` → hard error screen at startup + a build-time guard so production builds fail fast.
- Remove every `if (!isSupabaseConfigured())` / local-storage-as-source-of-truth branch in `src/context/AppContext.jsx`.
- `src/navigation/AppNavigator.jsx` always requires `authUser` (drop the `isSupabaseConfigured() &&` guard).
- AsyncStorage retained **only as a post-login cache** of remote data (offline resilience), never as identity/authority.

### B. Functions-only data API
- **Revoke** `select/insert/update/delete` grants from `anon` and `authenticated` roles on `profiles`, `app_profiles`, `iptv_accounts`, `watch_history`, `favorites`; keep RLS enabled as defense-in-depth. Exclude these from the exposed PostgREST schema where practical.
- Rewrite `src/services/supabase.js`: every data function currently using `.from(...)` becomes a `client.functions.invoke('<fn>', { body, headers })` call. Auth functions stay on `client.auth.*`.
- Edge Functions grouped by domain (e.g. `data-profiles`, `data-accounts`, `data-history`, `data-favorites`) or a single `data` function with an action router — decided in the plan. Each function:
  1. Verify JWT (`auth.uid()` from the caller's bearer token).
  2. Verify device binding (§C) — deny with `DEVICE_MISMATCH` if the caller's primary device id ≠ the bound one.
  3. Perform the operation with the **service_role** client.

### C. Device binding + attestation
- Table `device_bindings` (§6). `user_id` PRIMARY KEY → DB physically holds ≤1 device per account.
- **`claim-device`** Edge Function, called after login before any data loads:
  ```
  verify JWT → user = auth.uid()
  if native: verify App Attest (iOS) / Play Integrity (Android) token with Apple/Google
             → derive trusted primary device_id from the attestation key
             → persist attest_key_id / pubkey
  else (TV/Electron): primary device_id = client-provided stable anchor

  INSERT INTO device_bindings (user_id, device_id, platform, secondary_fp)
  VALUES (...) ON CONFLICT (user_id) DO NOTHING
  RETURNING device_id;

  if row returned            → ALLOW ("bound")   -- this login claimed the device
  else SELECT existing device_id:
       == caller device_id   → ALLOW ("ok")
       != caller device_id    → DENY  ("DEVICE_MISMATCH")
  ```
  Atomic `ON CONFLICT DO NOTHING` makes concurrent first-logins race-safe: exactly one binds.
- **Attestation cadence:** attest on `claim-device` + on cold start / token refresh (not every request). Per-request gate = JWT + binding-row check. (Per-request App Attest assertions are the gold standard but deferred as heavier; revisit if needed.)
- **Admin unbind:** delete the `device_bindings` row (Supabase dashboard SQL or a service_role-only `admin-unbind` function). Next login rebinds.

### D. Obfuscation
- **Web exports (webOS/Tizen/Electron):** post-export `javascript-obfuscator` pass at **light–medium** preset (control-flow flattening off/low — heavy presets break/crawl on weak TV engines). Wire into `build:tv`, `build:web`, `build:electron`.
- **Native (iOS/Android):** rely on **Hermes bytecode** (already non-readable). No extra JS obfuscation.
- **Electron:** package with `asar` + enable integrity fuses.

### E. Jailbreak / root detection (native only)
- Add `jail-monkey` (works with the existing prebuild/dev-client setup). On rooted/jailbroken device: **soft-block** — warn + refuse playback — not a hard crash (false positives). N/A on TV/Electron. Server-side Play Integrity / App Attest is the authoritative integrity signal.

### F. Locked-device UX
- New `DeviceLockedScreen`: shown when `claim-device` (or any data function) returns `DEVICE_MISMATCH`. Copy: "This account is active on another device. Contact support to switch devices." + sign-out button.

## 6. Data model

```sql
create table device_bindings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  device_id     text not null,          -- primary anchor (attestation-derived | UUID | machine-id)
  platform      text,                   -- ios | android | webos | tizen | electron
  label         text,                   -- human label for admin view
  secondary_fp  jsonb,                  -- informational composite hints (never gates access)
  attest_key_id text,                   -- native: App Attest / Play Integrity key ref
  attest_pubkey text,                   -- native: verified public key
  bound_at      timestamptz default now(),
  last_seen_at  timestamptz
);
alter table device_bindings enable row level security;
-- No anon/authenticated policies: access only via service_role Edge Functions.
```

## 7. Layered device signature

Two layers with different jobs — **combine everything, but only the primary decides access:**

- **PRIMARY (stable; drives allow/deny):**
  - native → App Attest / Play Integrity hardware key (unforgeable)
  - webOS/Tizen → platform device-id API if reliably available, else persisted UUID (localStorage)
  - Electron → `node-machine-id` (OS machine GUID)
- **SECONDARY (composite hints; informational/risk-scoring only, stored in `secondary_fp`):**
  - hash/bundle of: CPU model, core count (`navigator.hardwareConcurrency`), RAM bucket (`navigator.deviceMemory` / `os.totalmem()`), MAC(s) (Electron only), screen, OS version, UA/model, Tizen `duid`.
  - Used to flag anomalies in the admin view (e.g. same UUID, wholly different hardware profile → possible clone). **Never** causes a lockout (avoids drift-induced false lockouts under the permanent-lock policy).

Client module: `src/security/deviceId.js` with platform files (`.native.js`, `.web.js`, plus webOS/Tizen/Electron branches). Returns `{ primary, secondary }`; both are sent to `claim-device` and data functions; only `primary` is compared for access.

## 8. Residual risk (honest)

- **Closed on all platforms:** anon-key/direct-table dumping (no exposed tables); casual tampering of client gates (server decides); trivial account sharing (2nd device refused server-side).
- **Closed on native:** device-identity spoofing and cloned-app access (hardware attestation is unforgeable and app-genuine).
- **Still open on TV/Electron:** a determined reverse-engineer can spoof the primary anchor + replay a JWT to impersonate the bound device. No hardware attestation exists there. Mitigated (store distribution, functions-only protocol, manual unbind), not eliminated.
- Obfuscation and `jail-monkey` are evadable by design.

## 9. Workstreams & effort

1. **Supabase backend** (device_bindings, `claim-device`, data-* functions, grant revocation, admin unbind) — *highest value*, medium effort.
2. **Client data-layer rewrite** (`supabase.js` → functions.invoke; AppContext fallback removal) — medium.
3. **Device signature module** (primary + secondary, per platform) — low–medium.
4. **Native attestation** (App Attest + Play Integrity libs/config plugins + Edge-side verification) — highest effort.
5. **Obfuscation pipeline** (build-script changes) — low.
6. **Jailbreak detection + DeviceLockedScreen** — low.

## 10. Dependencies / open items for the plan

- Libraries to evaluate: `expo-application`, `expo-device`, `jail-monkey`, an App Attest lib (e.g. `react-native-ios-appattest` / config plugin), a Play Integrity lib, `node-machine-id` (Electron), `javascript-obfuscator`.
- Edge-side attestation verification: Apple App Attest (CBOR/X.509 chain) and Google Play Integrity token decode in Deno.
- EAS/prebuild config for the native modules (App Store & Play policy review).
- Tizen packaging is not yet in the repo (separate effort) — this design covers it as a web-export target.

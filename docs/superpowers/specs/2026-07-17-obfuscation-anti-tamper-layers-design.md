# 3-Layer Obfuscation & Anti-Tamper Program — Design

**Date:** 2026-07-17
**Status:** Design (approved shape, pending spec review)
**Goal:** Maximize the cost/effort to reverse-engineer, patch, and repackage Suvo
across **all** platforms (iOS, Android, Web, Electron, webOS, Tizen), structured
as **three distinct defense types** plus a server-side enforcement track.

---

## 0. Honest framing (non-negotiable, restated from the security audit)

Nothing in this document is a real security boundary on its own. Everything
shipped to the client — JS, Hermes bytecode, `asar`, `.ipk`, `.wgt` — can be
read and patched given enough effort. Layers 1–3 **raise attacker cost and
time**; they do not make cracking impossible.

The **only** true boundary is server-side enforcement of a value the client
cannot freely choose. That is why **Phase D (server entitlements)** is included
in scope here, at the user's explicit request — it is the piece that converts
demo/license enforcement from a speed-bump into an actual boundary.

Attacker goals this program targets (from the audit): **G1** bypass time-limited
demo · **G2** defeat one-device license (sharing) · **G3** extract
secrets/IPTV creds · **G4** repackage + redistribute.

---

## 1. Current state (what we extend, not duplicate)

| Concern | Today | Gap this program closes |
|---|---|---|
| L1 static obfuscation | `scripts/obfuscate.js` + one **shared TV-safe** config (`scripts/obfuscateConfig.js`); mangle + stringArray only. Runs on `build:web`, `build:tv`, `build:electron`. Native = Hermes bytecode. | No per-target aggression; strong transforms globally off because of TV. |
| L2 runtime anti-tamper | Electron: `afterPack.js` fuses (RunAsNode off, inspect off, OPTIONS off, OnlyLoadAppFromAsar on). Native: `jail-monkey` via `src/security/deviceIntegrity.js` + `integrityPolicy.js` (fail-open soft-block). | No asar-integrity fuse; no renderer hardening; R8 minify **off** (`android.enableMinifyInReleaseBuilds=false`); no `FLAG_SECURE`; no web/TV self-defending. |
| L3 secrets | Supabase publishable key extractable (acknowledged). Session + IPTV creds in **plaintext AsyncStorage** (`src/services/supabase.js`). | No build-time secret encryption; no SecureStore migration. |
| L3 server | Functions-only API is the real boundary (partial). Demo lockout 100% client-side (`src/config/demoExpiry.js`, `src/security/trustedTime*.js`, `appGate.js`). | **No `entitlements` table (P0-4)** → G1 is client-side only; trial expiry is a build-time constant recoverable from the bundle. |

---

## 2. The three layers (+ server track)

Each layer defeats a **different** attack. This is defense-in-depth, not three
passes of the same transform (stacking static passes gives diminishing returns
and can make tools fight each other).

### Layer 1 — Static obfuscation · "hard to read"
Replace the single shared config with **per-target configs** driven by a
`profile` argument so `obfuscate.js` selects the right preset.

- **Web / Electron (balanced-aggressive):** `controlFlowFlattening` (moderate
  threshold ~0.5), `stringArray` + `stringArrayEncoding: ['rc4']`, `splitStrings`,
  `transformObjectKeys`, keep `simplify`, `compact`, mangled identifiers.
  Deliberately **not** at "maximum": no high-threshold `deadCodeInjection` /
  `numbersToExpressions` (bundle/runtime cost outweighs benefit here).
- **TV (webOS + Tizen) — the "harden TV too" work:** start from today's safe
  preset, then enable strong flags **one at a time**, validating each on the
  webOS 26 and Tizen sims (and ideally real hardware) for boot, whitescreen, and
  perf. Keep only flags that run acceptably. This is empirical; the TV config is
  whatever survives testing, documented flag-by-flag in `OBFUSCATION.md`.
- **Native:** Hermes bytecode already covers "hard to read"; no pre-Hermes JS
  obfuscation pass (low marginal value). Main native lever is R8 (Layer 2).

### Layer 2 — Runtime anti-tamper · "hard to patch / dynamically analyze"
- **Web / Electron / TV:** add `selfDefending` (resists beautify + patch), and
  `debugProtection` **only where the engine tolerates it** — gated by the same
  per-target TV testing as Layer 1. If TV chokes, TV keeps selfDefending off.
- **Electron:** add `EnableEmbeddedAsarIntegrityValidation` fuse in
  `afterPack.js`; renderer hardening — devTools disabled in production, a CSP on
  the app window.
- **Native (Android):** enable **R8 + `shrinkResources`**
  (`android.enableMinifyInReleaseBuilds=true`) with `proguard-rules.pro` kept
  minimal and validated by an APK smoke test; add `FLAG_SECURE` (blocks
  screen-capture/recording of the app); strengthen the integrity path (see §4).
- **Native (iOS):** confirm release build symbol stripping / bitcode posture;
  `jail-monkey` jailbreak signal already present.

### Layer 3 — Secret-hardening · "nothing juicy to find" (client)
- Build-time encryption of sensitive embedded constants (endpoints, table
  names, any tokens that must ship) so a plain `grep` of the bundle yields
  nothing; decrypt at runtime behind the obfuscated code.
- Migrate the Supabase session + IPTV creds off plaintext AsyncStorage to
  `expo-secure-store` on native (Keychain / Keystore), with a migration path for
  existing installs and handling of the 2KB SecureStore value limit vs JWT size.

### Server track — Phase D — enforcement · "the real boundary" (P0-4)
- New `entitlements` table: `(user_id, plan, trial_started_at, expires_at,
  status, revoked_at, updated_at)`. RLS: owner-scoped SELECT, **service-role-only
  write**. Migration in `supabase/migrations/`.
- `supabase/functions/_shared/entitlement.ts::assertEntitled()` — checks
  `status = active`, `revoked_at IS NULL`, and **server-computed** expiry using
  the DB clock (`now()`), never a client-supplied time.
- **Server-computed trial expiry:** trial start recorded server-side on first
  device claim; expiry = `trial_started_at + N days` computed server-side. This
  kills the "freeze the clock / block the network to extend the trial" bypass.
- Wire `assertEntitled()` into the `data` and `claim-device` Edge Functions;
  `login` returns an entitlement snapshot.
- **Client:** treats the server entitlement as authoritative and gates playback
  on it. The existing client-side demo lockout is kept only as fast-path/offline
  UX — no longer the boundary.

---

## 3. Phasing (each phase independently mergeable)

| Phase | Deliverable | Ships value alone? |
|---|---|---|
| **A** | Layer 1: per-target obfuscation configs; web/Electron balanced-aggressive live; TV configs validated flag-by-flag on sims. | ✅ harder-to-read web/Electron/TV bundles |
| **B** | Layer 2: Electron asar-integrity fuse + renderer hardening; Android R8 + FLAG_SECURE + integrity hardening; web/TV selfDefending (+ debugProtection where tolerated). | ✅ harder-to-patch runtime |
| **C** | Layer 3 client: build-time secret encryption; SecureStore migration for session + IPTV creds. | ✅ fewer plaintext secrets at rest |
| **D** | Server entitlements: `entitlements` table + `assertEntitled()` + server trial expiry + client wiring. | ✅ real boundary for G1/G2 |

Phases A→B→C→D is the recommended order (cheapest/safest → largest). D is the
highest-value but the largest; it can proceed in parallel with A–C since it's
backend + a thin client change.

---

## 4. Component boundaries & design-for-isolation

- **`scripts/obfuscateConfig.js`** → export **named presets** (`webPreset`,
  `tvPreset`) instead of one `OBFUSCATE_OPTIONS`. Pure data; unit-testable that
  each preset is a valid options object and that TV excludes the known-breaking
  flags.
- **`scripts/obfuscate.js`** → accept a `profile` arg (`web` | `tv`), select the
  preset, otherwise unchanged (still fails loud). `build:web`/`build:electron`
  pass `web`; `build:tv` passes `tv`.
- **Integrity policy** (`src/security/integrityPolicy.js`) stays pure and
  fail-open by default; any hardening (e.g. debugger/hook detection) is added as
  new pure inputs to `evaluateIntegrity`, tested in isolation, so the enforcement
  decision remains one testable function.
- **`_shared/entitlement.ts`** → pure expiry/status computation in a `.js`
  sibling (mirrors the existing `_shared/*.js` + `.test.js` pattern, e.g.
  `loginLogic.js`, `entryLimits.js`), with the thin Deno/DB wrapper on top.
- **Client entitlement gate** → a pure selector that maps a server entitlement
  snapshot → `{ canPlay, reason }`, tested independently of React.

---

## 5. Testing & verification

- **Pure logic (node:test):** obfuscator preset validity; TV preset excludes
  breaking flags; `assertEntitled`/expiry computation; client entitlement-gate
  selector. Follows the repo's pure-logic test policy.
- **TV (mandatory, manual):** for every strong flag toggled in Phase A/B, run
  `npm run sim:lg` and `npm run sim:tizen`, verify boot + no whitescreen +
  acceptable nav perf; document per-flag results in `OBFUSCATION.md`. Ideally
  confirm on real webOS/Tizen hardware before shipping.
- **Electron (manual):** packaged build launches; asar-integrity fuse doesn't
  brick the app; devTools disabled in prod; RunAsNode still blocked.
- **Android (manual):** R8 release APK smoke test (`npm run apk`), app launches,
  playback works, no ProGuard-stripped crash; verify FLAG_SECURE (screenshot
  blocked).
- **Server (Phase D):** entitlement pure-logic tests; live Edge Function check
  that expired/revoked entitlements are refused server-side; optional pgTAP for
  `claim_device`.
- Repo gate before each phase merge: `npm test` + `npm run lint` green.

---

## 6. Risks & mitigations

- **TV breakage (highest):** strong transforms crawl/whitescreen webOS/Tizen.
  → Per-target config + mandatory per-flag sim testing; TV keeps only what runs.
- **R8 strips something RN/Expo needs:** → keep `proguard-rules.pro` minimal,
  APK smoke test before merge, easy revert (flag flip).
- **selfDefending/debugProtection false-positives or perf hit:** → enable per
  target, off on TV if it misbehaves; measure startup.
- **SecureStore migration data loss / 2KB limit:** → explicit migration path,
  size check for JWT, fall back gracefully; verify existing-session upgrade.
- **Bundle size / startup regression from L1:** → "balanced-aggressive" chosen
  over "maximum" precisely to bound this; measure web/Electron bundle + cold
  start before/after.
- **Scope (multi-subsystem):** → strict phase isolation; each phase mergeable
  and independently valuable, so partial delivery still improves posture.

---

## 7. Out of scope

- Native (pre-Hermes) JS obfuscation pass — low marginal value over Hermes.
- Third-party commercial packers / DRM.
- App Attest / Play Integrity server attestation (a separate, larger track than
  the entitlements enforcement in Phase D).

---

## 8. Open items to confirm during planning

- Exact `N` for trial length and where it's configured (server-side).
- Which embedded constants qualify as "sensitive" for Phase C encryption.
- Whether iOS needs any change in Phase B beyond confirming current posture.

# Obfuscation Phase B — Runtime Anti-Tamper Implementation Plan

> **For agentic workers:** This plan's remaining tasks require Electron packaging and Android SDK builds that were NOT available in the authoring environment. Each task is code-complete in its edits but its **verification must run on a machine with the Electron/Android toolchain**. Do not mark a task done on unit tests alone — the acceptance check is the real build.

**Goal:** Add Layer-2 runtime anti-tamper across the JS/Electron/Android targets: self-defending bundle (done), Electron asar-integrity + devTools lockdown, Android R8 + FLAG_SECURE + integrity enforcement.

**Architecture:** Extends the per-target obfuscation from Phase A. `selfDefending` (obfuscator) resists patching the shipped JS; Electron fuses + renderer config resist tampering with the desktop shell; Android R8 shrinks/renames the native-side and FLAG_SECURE blocks screen capture.

**Tech Stack:** javascript-obfuscator, @electron/fuses, electron-builder, Android Gradle/R8, Expo config plugins.

## Global Constraints

- JavaScript only (.js/.jsx), Node 20; node:test beside source as *.test.js; `npm test` + `npm run lint` green before each commit.
- Every native/Electron change is **unverifiable by unit tests alone** — the acceptance criterion is a real packaged build (Electron) or release APK (Android) that launches and plays.
- Do not add an Electron CSP or flip `webSecurity` on — [electron/main.js:53-72](../../../electron/main.js#L53-L72) documents why it's deferred (cross-origin IPTV streams + TMDB + YouTube embeds + hls.js blob workers): any omission white-screens the app or kills playback, and it can't be validated without a packaged build against real streams. Leave it deferred.
- Bar-raising only — none of this is a security boundary (that's Phase D). See `docs/superpowers/specs/2026-07-17-obfuscation-anti-tamper-layers-design.md`.

## Status

- **DONE + committed (`6768e6f`, branch `feat/obfuscation-phase-b`):** `selfDefending: true` on the web preset. Boot-smoked — login renders, zero console errors. This is the one Layer-2 item verifiable without a native/desktop build.
- **Remaining tasks below need your toolchain.**

---

### Task E1: Electron asar-integrity fuse

**Files:**
- Modify: `electron/afterPack.js` (the `flipFuses(electronBinary, { version: FuseVersion.V1, … })` call)
- Modify: `electron/afterPack.test.js`

**Interfaces:** none new — extends the existing fuse set.

- [ ] **Step 1: Add the fuse.** In `electron/afterPack.js`, inside the `flipFuses(...)` V1 options object (which already sets `RunAsNode: false`, `EnableNodeCliInspectArguments: false`, `EnableNodeOptionsEnvironmentVariable: false`, `OnlyLoadAppFromAsar: true`), add:

```js
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
```

- [ ] **Step 2: Update `afterPack.test.js`** to assert the new option is present in the flipped fuse set (match the file's existing assertion style — it already checks the other four options).

- [ ] **Step 3: Unit test.** Run `node --test electron/afterPack.test.js` → PASS.

- [ ] **Step 4: THE REAL CHECK — packaged build.** Run `npm run build:electron`, then launch the packaged app. It MUST open to the login screen.
  - **If it fails to launch / shows an integrity error:** electron-builder is not embedding the asar integrity header for your version. Either (a) upgrade electron-builder to a version that embeds `asarIntegrity` and re-test, or (b) revert this fuse (`EnableEmbeddedAsarIntegrityValidation: false`) and record that it's blocked on tooling. **Do not ship a bricking fuse.**

- [ ] **Step 5: Commit** `electron/afterPack.js electron/afterPack.test.js` with the packaged-launch result noted in the message.

---

### Task E2: Disable Electron devTools in production

**Files:**
- Modify: `electron/main.js` (`createWindow`, `webPreferences`)

- [ ] **Step 1: Gate devTools on dev.** In `createWindow`, `const isDev = !app.isPackaged;` already exists. In the `webPreferences` object add:

```js
      devTools: isDev,
```

This disables the devtools entirely in packaged builds (Cmd+Opt+I / Ctrl+Shift+I / right-click Inspect become no-ops), while leaving them in `npm run dev:electron`.

- [ ] **Step 2: THE REAL CHECK.** `npm run build:electron`, launch packaged app: confirm devtools cannot be opened and the app works normally; then `npm run dev:electron` and confirm devtools still open in dev.

- [ ] **Step 3: Commit** `electron/main.js`.

---

### Task A1: Android R8 minify + resource shrink

**Files:**
- Modify: `android/gradle.properties`
- Possibly modify: `android/app/proguard-rules.pro` (only if the smoke test crashes)

**Context:** `android/app/build.gradle` already wires `minifyEnabled enableMinifyInReleaseBuilds` and `shrinkResources enableShrinkResources` with `proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"`. Both flags default false.

- [ ] **Step 1: Enable the flags.** In `android/gradle.properties`, set (add if absent):

```properties
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResources=true
```

- [ ] **Step 2: THE REAL CHECK — release APK.** `npm run apk`, install (`adb install -r android/app/build/outputs/apk/release/app-release.apk`), launch. Exercise: login, browse Live/Movies/Series, **play a stream**, open a downloaded item.
  - **If it crashes** (`ClassNotFoundException` / `NoSuchMethodError` / reflection failures — common R8 casualties are Hermes, react-native-vlc-media-player, @kesha-antonov background-downloader, expo modules): add targeted `-keep` rules to `android/app/proguard-rules.pro` for the offending package, rebuild, re-test. Repeat until clean. Record which keeps were needed.

- [ ] **Step 3: Commit** `android/gradle.properties` (+ `proguard-rules.pro` if edited) with the APK smoke result + any keep rules noted.

---

### Task A2: Android FLAG_SECURE (block screen capture)

**Files:**
- Create: `plugins/withAndroidFlagSecure.js` (mirror the existing `plugins/withAndroidNetworkSecurity.js` config-plugin pattern)
- Modify: `app.json` (register the plugin in the `plugins` array, next to `withAndroidNetworkSecurity`)
- (Prebuild regenerates the native side; if you build committed-native, also apply to `MainActivity`.)

**Decision to confirm first:** `FLAG_SECURE` blocks screenshots, screen recording, **and screen-mirroring/casting of the app UI**, and shows a blank thumbnail in Recents. For an IPTV app this is usually desirable (anti-capture) — but confirm you don't rely on casting the app UI. (Casting the video stream itself via a media route is unaffected; FLAG_SECURE only blocks OS-level surface capture.)

- [ ] **Step 1: Write the config plugin** `plugins/withAndroidFlagSecure.js` using `withMainActivity` from `@expo/config-plugins` to insert, into `MainActivity.onCreate` (after `super.onCreate`), the Kotlin/Java line:

```
getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
```

(and ensure `import android.view.WindowManager` is present). Follow the exact structure of `plugins/withAndroidNetworkSecurity.js` — read it first and match its style, idempotency guard, and export shape.

- [ ] **Step 2: Register in `app.json`** `expo.plugins`, alongside `./plugins/withAndroidNetworkSecurity.js`.

- [ ] **Step 3: THE REAL CHECK.** `npx expo prebuild --platform android --clean` (or your APK flow), build, install, launch. Try to screenshot (should be blocked / black) and check the Recents thumbnail is blank. Confirm playback still works.

- [ ] **Step 4: Commit** `plugins/withAndroidFlagSecure.js app.json`.

---

### Task A3 (optional, low value): audit the device-integrity soft-block

**Files:** read `src/security/deviceIntegrity.js`, `src/security/integrityPolicy.js`, and grep for `evaluateIntegrity(` to find the consumer.

- [ ] **Step 1:** Confirm whether `evaluateIntegrity`'s `{ compromised: true }` result is actually acted on (warn + refuse playback) anywhere. If it's computed but never consumed, that's dead defense — wire it to a soft warning at the playback gate. **Keep it fail-open** (the module comment is explicit: false positives must not lock out legitimate users; the authoritative check is server attestation, which is out of scope here).
- [ ] **Step 2:** Pure-logic tests only if you add logic. Commit.

> Note: the real integrity boundary is server attestation (App Attest / Play Integrity) — deliberately out of Phase B scope (it's larger than this whole phase). A3 only ensures the existing local heuristic isn't dead code.

---

### Optional: debugProtection experiment (web/Electron)

`debugProtection: true` (+ `debugProtectionInterval: 4000`) in the web preset inserts anti-debugger traps. It's aggressive: it can interfere with legitimate debugging and has a small runtime cost, and **must be boot-smoked** (serve the obfuscated `dist`, load it, confirm the app still runs with devtools *closed*). Only add it if you want the extra anti-analysis layer and it passes the smoke. Leave OFF on the `tv` preset unless it survives `sim:lg` + `sim:tizen`.

---

## Verification summary (what "done" means per task)

| Task | Acceptance check |
|---|---|
| selfDefending (done) | ✅ boot smoke passed |
| E1 asar fuse | packaged app launches (else revert — brick risk) |
| E2 devTools off | devtools dead in prod, alive in dev |
| A1 R8 | release APK launches + plays; keep-rules added as needed |
| A2 FLAG_SECURE | screenshot blocked, playback still works |
| A3 integrity | soft-block wired (fail-open) or confirmed already wired |

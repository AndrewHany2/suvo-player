# Publishing Lumen IPTV Player to Every Store

One Expo/react-native-web codebase ships to six targets (iOS, Android, Web,
Electron desktop, LG webOS TV, Samsung Tizen TV). Today the release pipeline
(`.github/workflows/release.yml`) produces **downloadable artifacts only** —
unsigned desktop binaries, an unsigned iOS simulator build, a debug-signed
Android APK, a sideload `.ipk`, and a zipped web bundle — all pushed to a GitHub
Release. This doc takes each target from "artifact" to "published in its store."

Identity is already consistent everywhere (**Lumen IPTV Player**, bundle/package
`com.andrew1h1.iptvplayer`, v1.0.0, EAS project `c07f74d9-…`, Apple Team
`3S4ND6Q8K2`). No developer accounts exist yet, so account signup is part of
this plan. Desktop ships as **direct signed downloads** (Developer ID +
notarization on macOS, Authenticode on Windows) — not via Mac App Store /
Microsoft Store.

> ⚠️ **Policy risk (read first):** IPTV players are high-rejection-risk on the
> Apple App Store and Google Play. Reviewers reject apps that could surface
> unlicensed content or that ship *no* content of their own. Since this app is a
> BYO-playlist player (user supplies their own Xtream/M3U credentials), the
> listing must be framed as a **generic media player** — no channel logos, no
> "watch free TV," no bundled playlists in screenshots. Have a demo
> account/sample stream ready for reviewers. Budget for 1–2 rejection rounds on
> iOS/Android. TV stores (LG/Samsung) and direct desktop/web distribution do not
> carry this risk.

---

## Phase 0 — Shared prerequisites (do once, before any target)

### 0a. Create developer accounts
| Store | Account | Cost | Notes |
|---|---|---|---|
| Apple App Store + macOS notarization | Apple Developer Program | $99/yr | Same account covers iOS submission *and* Developer ID desktop signing. Enroll as individual or org; org needs D-U-N-S. |
| Google Play | Google Play Console | $25 once | Identity verification now required; can take days. |
| LG Content Store | LG Seller Lounge (seller.lgappstv.com) | Free | Business/seller verification. |
| Samsung Apps TV | Samsung Seller Portal (seller.samsungapps.com) | Free | Needed to obtain a **Samsung distributor certificate** (the current self-signed cert is sideload-only). |
| Windows code signing | An Authenticode cert (e.g. via a CA like SSL.com/DigiCert, or an EV/OV cert) | ~$100–400/yr | Not a store — needed so Windows SmartScreen doesn't block the `.exe`. |

Start the Apple, Google, and Windows-cert applications **first** — they have the
longest lead times (verification + cert issuance).

### 0b. Store-listing assets (needed by all app/TV stores)
Produce once, reuse: app description (framed as generic player, see risk note),
keywords, support URL + privacy-policy URL (host a simple page), age rating
answers, and screenshots per target:
- iOS: 6.7" + 6.5" iPhone and 12.9" iPad sets.
- Android: phone + 7"/10" tablet + feature graphic (1024×500).
- LG: Content Store screenshots + large icon (already have 130×130; store wants more).
- Samsung: larger store icons/screenshots (only an 80×80 icon exists today).

### 0c. Version bump discipline
`app.json`, `android/app/build.gradle`, `tv/packaging/lg/appinfo.json`,
`tv/packaging/samsung/config.xml`, and `electron/builder.json` all read v1.0.0.
Keep them in lockstep. iOS/Android build numbers auto-increment via EAS
(`eas.json` → `appVersionSource: remote`, `production.autoIncrement`). Optimize
the oversized `assets/icon.png` (~987 KB) and `assets/splash-icon.png` (~3.3 MB)
before store builds.

---

## Phase 1 — iOS App Store (EAS)

Uses Expo Application Services end-to-end; `ios/` is gitignored and regenerated
by prebuild, so all signing is EAS-managed — no local Xcode signing needed.

1. In App Store Connect, **create the app record** for
   `com.andrew1h1.iptvplayer`, note its `ascAppId`.
2. Generate an **App Store Connect API key** (`.p8` + key ID + issuer ID) for
   non-interactive submits. Store as EAS secret / `EXPO_TOKEN`-adjacent; never commit.
3. Wire `eas.json` → `submit.production` with `ascAppId` + `ascApiKeyPath`/key
   env. Add npm scripts: `submit:ios` → `eas submit -p ios --profile production`.
4. Build signed: `eas build -p ios --profile production` (EAS auto-manages the
   distribution cert + provisioning profile under Team `3S4ND6Q8K2`).
5. `eas submit -p ios` → TestFlight → fill listing (privacy manifest already
   present in `PrivacyInfo.xcprivacy`; `ITSAppUsesNonExemptEncryption: false`
   already set) → submit for review.

**Files:** `eas.json` (submit block + production build already exists),
`package.json` (add `submit:ios`).

---

## Phase 2 — Google Play (EAS)

1. Generate a **production upload keystore** (`keytool`), or let EAS manage
   Android credentials (`eas credentials`). Do **not** ship the committed
   `android/app/debug.keystore` — Play will permanently bind the first key.
   Update `android/app/build.gradle` release `signingConfig` to the real key
   (or rely on EAS-managed signing and stop using the debug config for release).
2. Switch the production build to **AAB** (Play requires `.aab`; the current
   `preview` profile emits APK). The `production` profile in `eas.json` defaults
   to app-bundle — verify, and add `submit:android` → `eas submit -p android
   --profile production`.
3. In Play Console, create the app, complete the content/data-safety
   questionnaire, upload to the **internal testing** track first.
4. Create a **Google Play service-account JSON**, grant it Play Console access,
   reference it from `eas.json` `submit.production.android.serviceAccountKeyPath`.
5. `eas build -p android --profile production` → `eas submit -p android` →
   promote internal → closed → production.

**Files:** `eas.json`, `android/app/build.gradle` (release signing),
`package.json` (add `submit:android`, `build:android:prod`).

---

## Phase 3 — Web hosting

No hosting config exists; `build:web` (`web.output: single`, SPA) just gets
zipped today. Pick a static host — recommend **Vercel** or **Cloudflare Pages**
(both trivially serve an SPA).

1. Add host config: `vercel.json` (or Cloudflare Pages project) with an SPA
   fallback rewrite (all routes → `/index.html`) and `dist/` as the output dir.
   Build command `npm run build:web`.
2. Point a custom domain; this same URL becomes the app's support/marketing site.
3. Optionally add a deploy step to CI on tag push.

**Files:** new `vercel.json` (or Pages config), optional CI job.

---

## Phase 4 — Desktop direct signed download (macOS + Windows + Linux)

Keep electron-builder + GitHub Releases distribution; add **real signing** so
Gatekeeper/SmartScreen stop blocking. No store submission.

1. **macOS**: add to `electron/builder.json` `mac`: `hardenedRuntime: true`,
   entitlements (`com.apple.security.cs.allow-jit` etc.), and set
   `mac.notarize`. Provide `CSC_LINK` (Developer ID Application cert `.p12`) +
   `CSC_KEY_PASSWORD` and Apple API-key env in CI. Build **universal** (add
   `mac.target` with `arch: [x64, arm64]` — currently host-arch only).
2. **Windows**: provide `CSC_LINK`/`CSC_KEY_PASSWORD` for the Authenticode cert
   so the NSIS `.exe` is signed. (EV cert avoids SmartScreen reputation warm-up.)
3. **Linux**: AppImage needs no signing — unchanged.
4. In `release.yml` **desktop** job, remove `CSC_IDENTITY_AUTO_DISCOVERY: false`
   and inject the signing secrets per-OS; add the macOS notarize creds.
5. Optional: add `electron-updater` + a `publish` provider (GitHub) for
   auto-updates — currently `--publish never`.
6. Cleanup: hardcoded window title `"IPTV Player"` in `electron/main.js` and
   stale `electron/release/IPTV Player-*.dmg` artifacts predate the rename to
   "Lumen IPTV Player" — fix/remove.

**Files:** `electron/builder.json`, `electron/main.js`, new
`electron/entitlements.mac.plist`, `.github/workflows/release.yml` (desktop job).

---

## Phase 5 — LG Content Store (webOS)

Build path already works (`ares-package` → `.ipk`, produced in CI).

1. In **LG Seller Lounge**, register as a seller, create the app for
   `com.andrew1h1.iptvplayer`.
2. Prepare store metadata + screenshots + icons (have 80×80/130×130; add store
   sizes) + age rating + supported countries.
3. Produce the release `.ipk` (CI `tv` job already does; or `npm run deploy:lg`
   path minus install). Upload via Seller Lounge, pass LG's app QA/checklist,
   submit for review.
4. No code changes required — `appinfo.json` (id/version/vendor/permissions) is
   store-valid. Just listing + submission.

**Files:** none (metadata lives in Seller Lounge). Reuse existing `.ipk`.

---

## Phase 6 — Samsung Apps TV (Tizen)

The current `.wgt` is signed with a **self-serve/public distributor cert
(sideload only)**. Store submission needs a **Samsung-issued distributor
certificate**.

1. In **Samsung Seller Portal**, enroll and request a **Samsung distributor
   certificate**; create an author + distributor certificate **profile** in
   Tizen Studio (`profiles.xml`) using it.
2. Re-package the `.wgt` signed with the Samsung distributor profile:
   `tizen package -t wgt` under the new profile (keep `package="IptvPlayer"` /
   app id `IptvPlayer.Lumen` stable so in-place updates work — noted in
   `config.xml`).
3. Add larger store icons (only 80×80 exists) + screenshots + metadata.
4. Upload the `.wgt` to Seller Portal, pass Samsung TV app verification, submit.
5. Optional: add a Tizen job to CI (needs Tizen Studio CLI — not on stock
   GitHub runners; likely a self-hosted runner or keep Tizen packaging local).

**Files:** Tizen signing profile (local, not committed);
`tv/packaging/samsung/config.xml` (verify `required_version` vs target TV
years). Store cert/`.p12` must stay gitignored.

---

## Phase 7 — CI wiring (optional but recommended)

Extend `release.yml` so a `v*` tag can *submit*, not just build:
- iOS/Android: add `eas submit` steps gated behind a manual-dispatch input or a
  separate `submit.yml` (keep automatic submits opt-in to avoid accidental
  store pushes).
- Desktop: signing secrets (above) turn existing artifacts into shippable ones.
- Store secrets needed in GitHub Actions: `EXPO_TOKEN` (exists),
  `APPLE_API_KEY_*`, `GOOGLE_PLAY_SA_JSON`, `CSC_LINK`/`CSC_KEY_PASSWORD`
  (mac + win), Apple notarize creds.

---

## Suggested sequencing

1. **Phase 0** (accounts + assets) — start Apple/Google/Windows-cert now (long lead).
2. **Web** (Phase 3) — fastest, no review, gives you the required support/privacy URL.
3. **Desktop** (Phase 4) — signing only, no store review.
4. **iOS + Android** (Phases 1–2) — parallel; longest/riskiest (policy).
5. **LG + Samsung** (Phases 5–6) — parallel; mostly listing + Samsung cert.

---

## Verification

- **iOS/Android**: build succeeds signed (`eas build … --profile production`),
  `eas submit` uploads, build appears in TestFlight / Play internal track,
  installs on a real device.
- **Web**: deployed URL loads, deep links fall back to `index.html`, playback works.
- **Desktop**: on a clean mac, the notarized `.dmg` opens **without** the
  "unidentified developer" Gatekeeper block (`spctl -a -vvv` passes); Windows
  `.exe` installs without a SmartScreen block; verify window title reads "Lumen
  IPTV Player".
- **LG**: `.ipk` passes Seller Lounge upload validation; sideload-installs and
  launches on a real webOS TV (`npm run deploy:lg`).
- **Samsung**: `.wgt` signed with the Samsung distributor profile installs on a
  real Tizen TV and passes Seller Portal verification.
- Repo gate before any submission: `npm test` + `npm run lint` (both green).

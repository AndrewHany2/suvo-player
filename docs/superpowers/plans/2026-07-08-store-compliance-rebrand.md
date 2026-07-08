# Store-Compliance Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand "Lumen IPTV Player" to "Lumen Player" and scrub every reviewer-visible "IPTV/Live TV" signal so the app passes Apple App Store / Google Play review as a generic media player.

**Architecture:** Pure naming/copy/identifier pass — no functional change. Edits touch platform manifests, in-app UI strings, identifiers (bundle/package/slug/scheme), the README, and add a store-listing collateral doc. Internal source symbols and the Android Java namespace are deliberately left untouched.

**Tech Stack:** Expo ~54 / React Native 0.81 / react-native-web / Electron / webOS + Tizen packaging. JavaScript only. Tests via `node --test` (`npm test`); lint via `eslint` (`npm run lint`).

## Global Constraints

- Display name is exactly **`Lumen Player`** everywhere reviewer-visible.
- Tab label: **`Live TV` → `Live`**; `Movies` / `Series` unchanged.
- Vendor prefix **`com.andrew1h1`** is preserved; only the app segment changes to **`lumenplayer`**.
- Slug / scheme / executable / package-name → **`lumen-player`**.
- Samsung Tizen `package` must be **exactly 10 alphanumeric chars** → **`LumenPlayr`**; app id → **`LumenPlayr.Lumen`**.
- **Do NOT** rename internal source symbols/files (`LiveTVScreen`, `MoviesScreen`, `SeriesScreen`, `HistoryScreen`, `iptvApi.js`, `useLiveTV`, `liveExtras`) — they are wired into the `metro.config.js` variant regex and invisible to reviewers.
- **Do NOT** change the Android Kotlin `namespace` or `.../java/com/andrew1h1/iptvplayer/` dir — only the store-visible `applicationId`.
- **Do NOT** change the Electron `IPTVSmartersPro/1.1.1` User-Agent header (stream-compatibility, not user-visible).
- After every task: `npm run lint` (no new errors; warnings OK) and `npm test` (green) must pass before commit.
- Reference spec: `docs/superpowers/specs/2026-07-08-store-compliance-rebrand-design.md`.

---

### Task 1: In-app UI copy — remove "IPTV" from all user-facing strings + tab label

**Files:**
- Modify: `src/screens/AuthScreen.jsx` (heading `IPTV Player`)
- Modify: `src/navigation/AppNavigator.jsx` (Accounts screen title + `Live TV` tab title)
- Modify: `src/navigation/AppNavigator.web.jsx` (`Live TV` tab label)
- Modify: `src/screens/AccountsScreen.jsx`
- Modify: `src/screens/AccountsScreen.tv.jsx`
- Modify: `src/screens/LiveTVScreen.web.jsx`, `src/screens/LiveTVScreen.native.jsx`, `src/screens/LiveTVScreen.tv.jsx`
- Modify: `src/screens/MoviesScreen.web.jsx`, `src/screens/MoviesScreen.native.jsx`, `src/screens/MoviesScreen.tv.jsx`
- Modify: `src/screens/SeriesScreen.web.jsx`, `src/screens/SeriesScreen.native.jsx`, `src/screens/SeriesScreen.tv.jsx`
- Modify: `src/screens/HistoryScreen.tv.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: no code symbols change; only string literals. Route keys (`name="LiveTV"`, `id: "live"`) and component names stay identical, so no other task depends on this one.

- [ ] **Step 1: Apply the exact string replacements**

Apply this find → replace table verbatim (string literals, case-sensitive). Some strings appear in multiple files — replace every occurrence.

| Find (exact) | Replace with |
|---|---|
| `IPTV Player` (AuthScreen heading `<Text>` at ~line 191) | `Lumen Player` |
| `title: "IPTV Accounts"` (AppNavigator.jsx) | `title: "Accounts"` |
| `title: "Live TV"` (AppNavigator.jsx tab) | `title: "Live"` |
| `label: "Live TV"` (AppNavigator.web.jsx) | `label: "Live"` |
| `No IPTV Account` | `No account` |
| `No IPTV Accounts` | `No accounts` |
| `Open "Accounts" to add your IPTV service` | `Open "Accounts" to add your media service` |
| `Tap "Accounts" to add your IPTV service` | `Tap "Accounts" to add your media service` |
| `Add your IPTV service from Settings` | `Add your media service from Settings` |
| `Check your connection or IPTV account and try again` | `Check your connection or account and try again` |
| `Tap "Add IPTV Account" to add your first IPTV service` | `Tap "Add account" to add your first media service` |
| `Add IPTV Account` | `Add account` |
| `e.g., My IPTV Service` | `e.g., My account` |
| `My IPTV` (placeholder in AccountsScreen.tv.jsx) | `My account` |

- [ ] **Step 2: Catch any missed user-facing occurrences**

Run:
```bash
grep -rniE "iptv" src/screens src/navigation
```
Expected: **no matches** except internal symbols/comments that are NOT user-facing strings (e.g. the `// ─── IPTV account operations` comment lives in `src/context/AppContext.jsx`, not these files, so this grep should return nothing). If any user-visible string remains, fix it using the same neutral wording.

- [ ] **Step 3: Lint and test**

Run:
```bash
npm run lint && npm test
```
Expected: lint has no new errors; tests green.

- [ ] **Step 4: Commit**

```bash
git add src/screens src/navigation
git commit -m "refactor: remove IPTV wording from in-app copy; Live TV tab -> Live"
```

---

### Task 2: Display name in platform manifests

**Files:**
- Modify: `app.json` (`expo.name`)
- Modify: `electron/builder.json` (`productName`)
- Modify: `electron/main.js` (window `title`, ~line 44)
- Modify: `android/app/src/main/res/values/strings.xml` (`app_name`)
- Modify: `tv/packaging/lg/appinfo.json` (`title`)
- Modify: `tv/packaging/samsung/config.xml` (`<name>`)

**Interfaces:**
- Consumes: nothing.
- Produces: the display name `Lumen Player`; no code symbols.

- [ ] **Step 1: Apply name replacements**

| File | Find | Replace |
|---|---|---|
| `app.json` | `"name": "Lumen IPTV Player"` | `"name": "Lumen Player"` |
| `electron/builder.json` | `"productName": "Lumen IPTV Player"` | `"productName": "Lumen Player"` |
| `electron/main.js` | `title: "IPTV Player"` | `title: "Lumen Player"` |
| `android/app/src/main/res/values/strings.xml` | `<string name="app_name">Lumen IPTV Player</string>` | `<string name="app_name">Lumen Player</string>` |
| `tv/packaging/lg/appinfo.json` | `"title": "Lumen IPTV"` | `"title": "Lumen Player"` |
| `tv/packaging/samsung/config.xml` | `<name>Lumen IPTV</name>` | `<name>Lumen Player</name>` |

- [ ] **Step 2: Verify**

Run:
```bash
grep -rniE "lumen iptv|iptv player" app.json electron/builder.json electron/main.js android/app/src/main/res/values/strings.xml tv/packaging
```
Expected: **no matches**.

- [ ] **Step 3: Lint and test**

Run:
```bash
npm run lint && npm test
```
Expected: no new lint errors; tests green.

- [ ] **Step 4: Commit**

```bash
git add app.json electron/builder.json electron/main.js android/app/src/main/res/values/strings.xml tv/packaging/lg/appinfo.json tv/packaging/samsung/config.xml
git commit -m "refactor: rename display name to 'Lumen Player' across platform manifests"
```

---

### Task 3: Identifier rename (bundle / package / slug / scheme / executable)

**Files:**
- Modify: `app.json` (`ios.bundleIdentifier`, `android.package`, `slug`, `scheme`)
- Modify: `electron/builder.json` (`appId`, `executableName`)
- Modify: `android/app/build.gradle` (`applicationId` only — **NOT** `namespace`)
- Modify: `tv/packaging/lg/appinfo.json` (`id`)
- Modify: `tv/packaging/samsung/config.xml` (widget `id`, `tizen:application id`, `package`, and the header comment)
- Modify: `supabase/config.toml` (project id/name referencing `iptv-player`)
- Modify: `.github/workflows/release.yml` (artifact names/paths referencing `iptv-player`)
- Modify: `.gitignore` (paths referencing `iptv-player`)
- Modify: `package.json` (`name`)

**Interfaces:**
- Consumes: nothing.
- Produces: new identifiers used by build/release tooling — no runtime code symbols.

- [ ] **Step 1: Apply identifier replacements**

| File | Find | Replace |
|---|---|---|
| `app.json` | `"slug": "iptv-player"` | `"slug": "lumen-player"` |
| `app.json` | `"scheme": "iptv-player"` | `"scheme": "lumen-player"` |
| `app.json` | `"bundleIdentifier": "com.andrew1h1.lumenplayer"` | `"bundleIdentifier": "com.andrew1h1.lumenplayer"` |
| `app.json` | `"package": "com.andrew1h1.lumenplayer"` | `"package": "com.andrew1h1.lumenplayer"` |
| `electron/builder.json` | `"appId": "com.andrew1h1.lumenplayer"` | `"appId": "com.andrew1h1.lumenplayer"` |
| `electron/builder.json` | `"executableName": "iptv-player"` | `"executableName": "lumen-player"` |
| `android/app/build.gradle` | `applicationId 'com.andrew1h1.lumenplayer'` | `applicationId 'com.andrew1h1.lumenplayer'` |
| `tv/packaging/lg/appinfo.json` | `"id": "com.andrew1h1.lumenplayer"` | `"id": "com.andrew1h1.lumenplayer"` |
| `tv/packaging/samsung/config.xml` | `id="http://andrew1h1.com/iptvplayer"` | `id="http://andrew1h1.com/lumenplayer"` |
| `tv/packaging/samsung/config.xml` | `id="IptvPlayer.Lumen"` | `id="LumenPlayr.Lumen"` |
| `tv/packaging/samsung/config.xml` | `package="IptvPlayer"` | `package="LumenPlayr"` |
| `tv/packaging/samsung/config.xml` header comment | `The package id (IptvPlayer, 10 alphanumeric chars)` | `The package id (LumenPlayr, 10 alphanumeric chars)` |
| `package.json` | `"name": "iptv-player"` | `"name": "lumen-player"` |

**IMPORTANT — do NOT touch** in `android/app/build.gradle`: the `namespace 'com.andrew1h1.lumenplayer'` line stays as-is. Gradle allows `applicationId` ≠ `namespace`.

- [ ] **Step 2: Update supabase, CI, and gitignore references**

Run to locate them:
```bash
grep -rniE "iptv-player|iptvplayer" supabase/config.toml .github/workflows/release.yml .gitignore
```
For each hit that is a project name / artifact filename / ignore path (NOT the `com.andrew1h1.lumenplayer` Java package or a URL you already changed), replace `iptv-player` → `lumen-player` and `iptvplayer` → `lumenplayer`. In `release.yml`, ensure artifact upload/download names stay consistent with each other after the edit (search the whole file for the old string).

- [ ] **Step 3: Verify Samsung 10-char rule + no stray store-visible IDs**

Run:
```bash
grep -oE 'package="[^"]+"' tv/packaging/samsung/config.xml
```
Expected: `package="LumenPlayr"` — confirm `LumenPlayr` is exactly 10 characters (`echo -n LumenPlayr | wc -c` → `10`).

Run:
```bash
grep -rniE "com\.andrew1h1\.iptvplayer" app.json electron/builder.json tv/packaging
```
Expected: **no matches** (the only remaining `com.andrew1h1.lumenplayer` occurrences are the intentionally-kept Android Java `namespace`/package in `android/`).

- [ ] **Step 4: Lint and test**

Run:
```bash
npm run lint && npm test
```
Expected: no new lint errors; tests green.

- [ ] **Step 5: Commit**

```bash
git add app.json electron/builder.json android/app/build.gradle tv/packaging supabase/config.toml .github/workflows/release.yml .gitignore package.json
git commit -m "refactor: rename identifiers to lumen-player / com.andrew1h1.lumenplayer (pre-submission)"
```

---

### Task 4: README rewording

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing (docs only).

- [ ] **Step 1: Retitle and reframe the intro**

Replace the title and opening paragraph:

Find:
```markdown
# IPTV Player

A cross-platform IPTV player built with Expo and React Native. One codebase
targets iOS, Android, desktop (Electron), the web, and TV (LG webOS + Samsung
Tizen). It connects to any Xtream Codes provider for Live TV, Movies, and
Series, enriches VOD with TMDB metadata, and syncs profiles / accounts / watch
history / favorites through Supabase.
```

Replace with:
```markdown
# Lumen Player

A cross-platform media player built with Expo and React Native. One codebase
targets iOS, Android, desktop (Electron), the web, and TV (LG webOS + Samsung
Tizen). It plays media from a user-supplied playlist (Xtream Codes or M3U),
organizing it into Live, Movies, and Series, enriches VOD with TMDB metadata,
and syncs profiles / accounts / watch history / favorites through Supabase. It
ships with no content of its own.
```

- [ ] **Step 2: Soften the Tech Stack line**

Find: `- **Xtream Codes API** — IPTV content source`
Replace: `- **Xtream Codes API** — user-supplied playlist source`

- [ ] **Step 3: Verify**

Run:
```bash
grep -niE "iptv" README.md
```
Expected: **no matches**.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: reframe README as generic media player (Lumen Player)"
```

---

### Task 5: Store-listing collateral doc

**Files:**
- Create: `docs/STORE_LISTING.md`

**Interfaces:**
- Consumes: nothing. Produces: reference doc only.

- [ ] **Step 1: Create `docs/STORE_LISTING.md` with this content**

````markdown
# Lumen Player — Store Listing Copy

Reference for filling out App Store Connect / Google Play Console / LG Seller
Lounge / Samsung Seller Portal. The app is a **generic media player** that plays
a playlist the user supplies. It bundles **no content**. Keep every listing
framed that way — see the policy note in `docs/PUBLISHING.md`.

## Name & subtitle
- **Name:** Lumen Player
- **Subtitle / short description:** "Play your own media playlists"

## Description (paste-ready)
> Lumen Player is a fast, resilient media player for the playlists you already
> own. Point it at your own Xtream Codes or M3U playlist and Lumen organizes
> your media into Live, Movies, and Series, remembers where you left off, and
> keeps your favorites and history in sync across your devices.
>
> Lumen Player includes no content and provides no channels, streams, or media
> of its own — you bring your own playlist. Features: resilient playback that
> recovers from network hiccups, resume/watch-history, favorites, artwork and
> metadata for movies and series, and a 10-foot TV interface for LG webOS and
> Samsung Tizen.

## Keywords (safe set)
media player, video player, playlist player, m3u player, xtream, vod, resume
playback, favorites, tv interface

**Avoid** (rejection triggers): "free TV", "live TV channels", "IPTV", "watch
free", any broadcaster/channel names.

## Screenshots — rules
- No channel logos, no recognizable broadcaster branding, no EPG grids that look
  like a TV guide.
- No "watch free TV" / "thousands of channels" marketing text.
- Show the app playing generic or sample media; show the Movies/Series artwork
  UI and the player controls.
- Use the demo account (below) so screenshots contain only sample content.

## Reviewer notes (App Review / Play Console)
> Lumen Player is a media player. It ships with no content. To review playback,
> use this demo account / sample playlist: <ADD DEMO CREDENTIALS OR SAMPLE M3U
> URL BEFORE SUBMITTING>. The user supplies their own playlist; the app neither
> hosts nor provides any media.

## Age rating
- Answer questionnaires honestly for a **generic player**. Because the app has no
  bundled content and cannot itself surface objectionable material, the base
  rating is low; note that user-supplied content is outside the app's control.

## Required URLs (host before submitting)
- **Support URL** and **Privacy Policy URL** — reuse the web build's domain
  (see `docs/PUBLISHING.md` Phase 3). Both are mandatory for iOS and Android.
````

- [ ] **Step 2: Commit**

```bash
git add docs/STORE_LISTING.md
git commit -m "docs: add store-listing copy framed as generic media player"
```

---

### Task 6: Full verification sweep

**Files:** none (verification only).

**Interfaces:** Consumes all prior tasks. Produces: confidence + a final audit commit if any stragglers found.

- [ ] **Step 1: Repo-wide IPTV audit**

Run:
```bash
grep -rniE "iptv" . 2>/dev/null | grep -vE "node_modules|/dist/|/tv/dist/|package-lock|electron/release|docs/superpowers"
```
Expected — **only** these intentionally-kept categories remain:
- Internal source symbols/files: `LiveTVScreen`, `MoviesScreen`, `SeriesScreen`, `HistoryScreen`, `iptvApi.js`, `useLiveTV`, `liveExtras`, the `metro.config.js` regex, the `// IPTV account operations` comment in `src/context/AppContext.jsx`.
- Android Java namespace/package: `android/app/build.gradle` `namespace`, `android/app/src/main/AndroidManifest.xml`, `.../java/com/andrew1h1/iptvplayer/…`, `MainActivity.kt`, `MainApplication.kt`.
- The Electron `IPTVSmartersPro` UA header in `electron/main.js` + its explanatory comment.
- `docs/PUBLISHING.md` policy discussion.

If anything *else* (a user-facing string, a store-visible identifier) appears, fix it and re-run.

- [ ] **Step 2: Confirm no store-visible identifier leaks**

Run:
```bash
grep -rniE "com\.andrew1h1\.iptvplayer" . 2>/dev/null | grep -vE "node_modules|/dist/|/tv/dist/|package-lock|docs/superpowers"
```
Expected: matches **only** under `android/` (the kept Java namespace/package + manifest). No hits in `app.json`, `electron/`, `tv/packaging/`.

- [ ] **Step 3: Final lint + test**

Run:
```bash
npm run lint && npm test
```
Expected: no new lint errors; all tests green.

- [ ] **Step 4: Commit any stragglers (only if Step 1/2 required fixes)**

```bash
git add -A
git commit -m "chore: final IPTV-scrub stragglers for store compliance"
```

---

## Notes for the implementer

- This is a rename/copy pass; there are no new unit tests to write (no new behavior). The "test" for each task is: neutral wording applied, targeted grep clean, and `npm test` + `npm run lint` still green.
- If `expo prebuild` is ever run after this, it regenerates `android/` native files from `app.json` `android.package` (`com.andrew1h1.lumenplayer`) — that is self-consistent and fine. We are hand-editing the committed `android/` for now.
- Do not "helpfully" rename source files or the Android Java package — the plan deliberately excludes those (see Global Constraints).

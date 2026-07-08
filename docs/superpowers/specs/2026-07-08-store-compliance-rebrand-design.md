# Store-Compliance Rebrand — "Lumen IPTV Player" → "Lumen Player" — Design

**Date:** 2026-07-08
**Status:** Approved for planning

## Goal

Make the app pass Apple App Store and Google Play review by removing every
reviewer-visible signal that reads as an "IPTV" / "watch free TV" product, and
reframing it as a **generic media player** that plays a user-supplied playlist.
Nothing about the actual functionality changes — this is a naming, copy, and
identifier pass plus store-listing collateral.

### Why this is needed

IPTV players are high-rejection-risk: reviewers reject apps that could surface
unlicensed content or that ship no content of their own. This app is a
BYO-playlist player (the user supplies their own Xtream/M3U credentials), which
is acceptable **only if the listing and UI are framed as a plain media player** —
no "IPTV" in the name, no "watch free TV," no "Live TV," no bundled playlists.
See `docs/PUBLISHING.md` policy note.

### Timing advantage

The app has **not been submitted to any store** and no developer accounts exist
yet (`docs/PUBLISHING.md`). Store binding of bundle IDs / package names and
TV in-place-update compatibility only lock in on *first submission*. Therefore
identifiers can be changed now at essentially zero risk — this is the correct
moment to do it.

## Non-goals

- No functional/behavioral change to playback, auth, sync, or navigation.
- No rename of internal source filenames or domain symbols (`LiveTVScreen`,
  `iptvApi.js`, `useLiveTV`, `liveExtras`). These are invisible to reviewers and
  `LiveTVScreen`/`MoviesScreen`/`SeriesScreen`/`HistoryScreen` are wired into the
  `metro.config.js` `.web`→`.tv` variant regex (CLAUDE.md warns about this).
  Renaming them is pure churn with zero compliance benefit.
- No change to the Android Java/Kotlin `namespace` or the
  `android/app/src/main/java/com/andrew1h1/iptvplayer/` source directory (see
  §3 — `applicationId`-only decision).
- No change to the Electron outbound `IPTVSmartersPro/1.1.1` User-Agent header
  (`electron/main.js`) — it is a network compatibility header, not user-visible,
  and some providers gate streams on it.

## Decisions (locked)

- **Display name:** `Lumen Player` (everywhere reviewers see it).
- **Tab label:** `Live TV` → `Live`. `Movies` / `Series` unchanged.
- **Identifiers:** deep rename, preserving the `com.andrew1h1` vendor prefix.
- **Android:** change store-visible `applicationId` only; keep the Java
  `namespace` and source package dir as-is (Gradle supports them differing).
- **Store-listing copy:** include a new `docs/STORE_LISTING.md` deliverable.

## Section 1 — Display name & in-app copy (reviewer-visible)

### 1a. App name across platform manifests

| File | Field | From → To |
|---|---|---|
| `app.json` | `expo.name` | `Lumen IPTV Player` → `Lumen Player` |
| `electron/builder.json` | `productName` | `Lumen IPTV Player` → `Lumen Player` |
| `electron/main.js` | window `title` | `IPTV Player` → `Lumen Player` |
| `android/app/src/main/res/values/strings.xml` | `app_name` | `Lumen IPTV Player` → `Lumen Player` |
| `tv/packaging/lg/appinfo.json` | `title` | `Lumen IPTV` → `Lumen Player` |
| `tv/packaging/samsung/config.xml` | `<name>` | `Lumen IPTV` → `Lumen Player` |

### 1b. In-app UI strings

All matched semantically (line numbers drift during edits). Replace every
user-facing occurrence of the word "IPTV":

- **Auth heading** (`src/screens/AuthScreen.jsx`): `IPTV Player` → `Lumen Player`.
- **Accounts screen title** (`src/navigation/AppNavigator.jsx`): `IPTV Accounts`
  → `Accounts`.
- **Empty-state titles**: `No IPTV Account` / `No IPTV Accounts` → `No account` /
  `No accounts`. Files: `LiveTVScreen.{tv,web,native}.jsx`,
  `MoviesScreen.{tv,web,native}.jsx`, `SeriesScreen.{tv,web,native}.jsx`,
  `HistoryScreen.tv.jsx`, `AccountsScreen.jsx`.
- **Empty-state messages**: `...add your IPTV service` → `...add your media
  service`; `Add your IPTV service from Settings` → `Add your media service from
  Settings`; `Tap "Add IPTV Account" to add your first IPTV service` → `Tap "Add
  account" to add your first media service`.
- **Error messages**: `Check your connection or IPTV account and try again` →
  `Check your connection or account and try again`
  (`LiveTVScreen.web.jsx`, `SeriesScreen.web.jsx`).
- **CTAs / buttons**: `Add IPTV Account` → `Add account`
  (`AccountsScreen.jsx`, `AccountsScreen.tv.jsx`).
- **Placeholders**: `My IPTV` / `e.g., My IPTV Service` → `My account` /
  `e.g., My account` (`AccountsScreen.tv.jsx`, `AccountsScreen.jsx`).

### 1c. Tab label

- `src/navigation/AppNavigator.jsx`: tab `title` `Live TV` → `Live`.
- `src/navigation/AppNavigator.web.jsx`: tab `label` `Live TV` → `Live`.
  (Internal `id: "live"` and `name="LiveTV"` route keys stay — not visible.)

## Section 2 — Identifiers (pre-submission, low risk)

| Field / File | From → To |
|---|---|
| `app.json` `ios.bundleIdentifier` | `com.andrew1h1.lumenplayer` → `com.andrew1h1.lumenplayer` |
| `app.json` `android.package` | `com.andrew1h1.lumenplayer` → `com.andrew1h1.lumenplayer` |
| `app.json` `slug` + `scheme` | `iptv-player` → `lumen-player` |
| `electron/builder.json` `appId` | `com.andrew1h1.lumenplayer` → `com.andrew1h1.lumenplayer` |
| `electron/builder.json` `executableName` | `iptv-player` → `lumen-player` |
| `tv/packaging/lg/appinfo.json` `id` | `com.andrew1h1.lumenplayer` → `com.andrew1h1.lumenplayer` |
| `tv/packaging/samsung/config.xml` `id` (widget) | `http://andrew1h1.com/iptvplayer` → `http://andrew1h1.com/lumenplayer` |
| `tv/packaging/samsung/config.xml` `tizen:application id` | `IptvPlayer.Lumen` → `LumenPlayr.Lumen` |
| `tv/packaging/samsung/config.xml` `package` | `IptvPlayer` → `LumenPlayr` (must stay exactly 10 alphanumeric; `LumenPlayr` = 10) |
| `android/app/build.gradle` `applicationId` | `com.andrew1h1.lumenplayer` → `com.andrew1h1.lumenplayer` |
| `supabase/config.toml` project id/name | `iptv-player` → `lumen-player` |
| `.github/workflows/release.yml` artifact names/paths referencing `iptv-player` | → `lumen-player` |
| `.gitignore` paths referencing `iptv-player` | → `lumen-player` (verify no stale ignore breaks) |
| `package.json` `name` | `iptv-player` → `lumen-player` (private pkg; cosmetic) |

**Comment upkeep:** the `config.xml` header comment references the `IptvPlayer`
package id — update it to match `LumenPlayr`.

## Section 3 — Android package (applicationId-only)

- Change `applicationId` (build.gradle) and `app.json` `android.package` to
  `com.andrew1h1.lumenplayer` — this is the store-visible ID (Play Console URL).
- **Keep** the Kotlin `namespace` (`build.gradle`), the `package` declarations in
  `MainActivity.kt` / `MainApplication.kt`, and the
  `.../java/com/andrew1h1/iptvplayer/` directory unchanged. Gradle supports
  `applicationId` ≠ `namespace`; the namespace is never surfaced to reviewers.
- **Caveat:** `app.json` `android.package` is what Expo prebuild uses to
  generate native code. Since `android/` is committed and not regenerated in the
  current workflow, hand-edit `build.gradle`. If a future `expo prebuild --clean`
  runs, it will regenerate the native package from `android.package` — acceptable
  and self-consistent. Document this in the plan.

## Section 4 — README

- Retitle `README.md` from `# IPTV Player` to `# Lumen Player`.
- Reword the opening to describe a **cross-platform media player** that plays a
  user-supplied playlist. Keep the technical accuracy (Xtream Codes / M3U as a
  *user-provided* source, Supabase sync, TMDB metadata) but drop "IPTV" framing
  from headings/prose. Keep the Tech Stack / Platform Matrix tables (developer
  docs, not store-facing) — only soften the "IPTV content source" wording to
  "user-supplied playlist source."

## Section 5 — Store-listing collateral (new `docs/STORE_LISTING.md`)

A single reference doc for filling out the App Store / Play / LG / Samsung
consoles. Contents:

- **App name / subtitle** framed as a media player (e.g. subtitle "Play your own
  media playlists").
- **Description** — generic media player: plays video from a playlist the user
  provides; organizes it into Live / Movies / Series; resilient playback; syncs
  favorites and history. Explicitly ships with **no content**.
- **Keywords** — safe set (media player, video player, playlist, m3u player, VOD,
  streaming player) avoiding "free TV / channels / IPTV / live TV."
- **Screenshot checklist** — no channel logos, no recognizable broadcaster
  branding, no "watch free TV" text; show the app playing generic/sample media;
  use a demo account.
- **Reviewer notes** — provide a demo account + sample stream URL; state clearly
  the app is a player and bundles no content.
- **Age rating** guidance and privacy/support URL reminders.

This doc is collateral only; store metadata itself lives in the vendor consoles.

## Verification

1. `npm test` — green (`node --test src scripts supabase electron`).
2. `npm run lint` — no new errors.
3. `grep -rniE "iptv" .` (excluding `node_modules`, `dist`, `tv/dist`,
   `package-lock`, `docs/superpowers`) returns **only**:
   - internal source symbols/filenames intentionally kept (§ non-goals:
     `LiveTVScreen`, `iptvApi.js`, `useLiveTV`, `liveExtras`, the
     `// IPTV account operations` code comment, the `IPTVSmartersPro` UA header),
   - the Android Java `namespace`/package dir (§3),
   - `docs/PUBLISHING.md` policy discussion (may keep, or add a note that the app
     is now named "Lumen Player").
4. Manual: launch web/Electron and native — the tab reads "Live", the auth
   heading reads "Lumen Player", empty states say "No account", the Accounts
   screen title reads "Accounts". Electron window title reads "Lumen Player".
5. TV packaging: `tv/packaging/samsung/config.xml` `package` is exactly 10
   alphanumeric chars.

## Risk / rollback

- All changes are string/config edits on a git branch; rollback = revert branch.
- Highest-churn file is `.github/workflows/release.yml` (artifact paths) — verify
  the workflow still references consistent names end-to-end after edit.
- Samsung 10-char package constraint is the one hard formatting rule — enforced
  in verification step 5.

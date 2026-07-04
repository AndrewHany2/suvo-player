# Architecture

One Expo / React Native codebase ships to six targets. This document covers how
each target is bundled and run, the per-platform source-variant convention, and
the playback driver model.

## Platform → bundler / build / runtime

| Platform           | Bundler / Build command                                  | Runtime engine        |
| ------------------ | -------------------------------------------------------- | --------------------- |
| iOS                | native — `expo run:ios`                                  | expo-video            |
| Android            | native — `expo run:android`                              | expo-video            |
| Web                | Metro web export — `expo export --platform web` (`web.output: single`) | hls.js  |
| Electron desktop   | the web build, wrapped by `electron/main.js`             | hls.js (opt. external VLC) |
| TV — LG webOS      | web build + `EXPO_PUBLIC_TV=1` + `tv/patch-index.js`     | hls.js                |
| TV — Samsung Tizen | web build + `EXPO_PUBLIC_TV=1` + `tv/patch-index.js`     | hls.js                |

The web, Electron, and both TV targets are all the **same** react-native-web
Metro export (`app.json` sets `web.bundler: "metro"`, `web.output: "single"`).
Native (iOS/Android) is a separate RN build using expo-video. `index.js` is the
shared entry (`registerRootComponent(App)`).

## Source-variant convention (`.tv` / `.web` / `.native`)

Screens and some components have platform-specific implementations selected by
file suffix:

- `*.native.jsx` — iOS/Android (expo-video player, native navigation).
- `*.web.jsx` — the web/Electron build.
- `*.tv.jsx` (+ `*.tv.css`) — the 10-foot TV UI (D-pad focus, upward menus).

Metro resolves `.native` automatically via its platform extension on native
builds. **But TV and web are both `expo export --platform web`**, so Metro
cannot distinguish them by platform extension. Instead:

- `metro.config.js` installs a `resolveRequest` hook. When `EXPO_PUBLIC_TV=1`
  (set by `build:tv`), it rewrites each screen's `.web` specifier
  (`LiveTVScreen`, `MoviesScreen`, `SeriesScreen`, `HistoryScreen`, and
  `AccountsScreen`) to its `.tv` sibling, so only the TV screen tree is
  resolved — and therefore bundled.
- The web/Electron build leaves the flag unset and keeps `.web`, so the `.tv`
  screens are never resolved and drop out of that bundle.

This static swap is required because under `web.output: single` there is no
code-splitting — a runtime `import()` could not trim the unused screen tree.
`metro.config.js` also forces the Supabase CJS bundle and stubs
`@opentelemetry/api` for the same single-bundle reasons.

## TV `patch-index.js` rationale

TV web engines are older Chromium. `tv/patch-index.js` post-processes the
exported `index.html` / main bundle after `build:tv`:

- **Transpiles** the main JS bundle down (template literals → ES5 concat,
  optional chaining, nullish coalescing, logical-assignment operators) via
  Babel plugins, for older webOS/Tizen JS engines.
- **Rewrites asset paths** from root-relative (`/_expo/...`, `/favicon.ico`) to
  relative (`./_expo/...`) because TV apps load over `file://`, where
  root-relative paths resolve against the filesystem root, not the app dir.
- **Strips redundant CSS preload hints** — on `file://` a `<link rel=preload
  as=style>` buys no parallelism over the stylesheet link; it's pure overhead.
- **Injects a neutral boot splash** inside `#root` so a spinner paints during
  bundle parse and clears when React first renders (deliberately auth-agnostic).

## Playback driver model

Playback lives in `src/playback/` and is engine-agnostic by design.

- **`recoveryMachine.js`** — a pure reducer, `reduce(state, event) -> { state,
  effects }`. No timers, no I/O, no React/hls/expo imports. It runs the state
  machine `idle → loading → playing ↔ buffering → recovering → (playing |
  fatal)`, classifying errors (via `errorClassifier.js`) into GONE (fatal),
  AUTH_EXPIRED (refresh then retry, fatal on repeat), OFFLINE (suppress retries
  until ONLINE), and transient/stall/decode (backoff retry). It emits abstract
  `effects` (schedule retry, reload, refresh credentials, set quality cap).

- **`drivers/types.js`** — the `PlayerDriver` contract (JSDoc typedefs +
  `NormalizedError`, `MediaTrack`, `QualityLevel`). The recovery brain only ever
  speaks to a `PlayerDriver` and consumes `NormalizedError`s; it never imports an
  engine.

- **`drivers/expoVideoDriver.js`** — native adapter around an expo-video player.
- **`drivers/hlsDriver.js`** — web/TV adapter around an hls.js instance + a
  `<video>` element (with a Safari native-HLS fallback where quality control
  degrades to a no-op).

- **`useResilientPlayback.js`** — the React host hook. It owns what the pure
  reducer cannot: React state, retry timers (`SCHEDULE_RETRY` → `setTimeout` →
  dispatch `RETRY`), executing effects against the handed driver, online/offline
  detection (lazy, optional `@react-native-community/netinfo`), and subscribing
  to driver events. It must never import expo-video or hls.js directly — only the
  driver it is given.

Each engine's quirks stay isolated in its driver; the reducer and host hook are
shared across all platforms.

## Backend

- **Supabase** — auth plus a device-gated Edge Function (`supabase/functions/data`)
  that verifies the JWT and bound device, then routes all table access
  (profiles, IPTV accounts, watch history, favorites) through the service role.
- **Xtream Codes** — IPTV content, via `src/services/iptvApi.js`.
- **TMDB** — artwork/metadata, via `src/services/tmdbApi.js` (skipped when no key).

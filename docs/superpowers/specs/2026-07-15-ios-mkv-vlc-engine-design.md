# iOS MKV Playback via a VLC Engine — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**Scope:** Native iOS only. Route AVPlayer-unsupported VOD containers to a libVLC-backed player behind the existing `PlayerDriver` contract.

## Problem

Series episodes (and any VOD) whose `container_extension` is `mkv` fail to play on iOS
with `expo-video` (AVPlayer):

```
expoVideoDriver.js ERROR msg="Failed to load the player item: Cannot Open"
uri=http://mvo25.in/series/.../401998.mkv
```

Root cause is a hard platform limitation: **iOS AVFoundation/AVPlayer cannot demux the
Matroska (MKV) container** (nor AVI/FLV/WMV/WebM). `"Cannot Open"` is AVFoundation's
signature error for an unsupported container. It is *not* an HTTP, header, URL, or
continue-watching bug:

- ATS is fully open — [app.json](../../../app.json) sets `NSAllowsArbitraryLoads: true`
  and `usesCleartextTraffic: true`; `.mp4` movies stream fine over the same `http://` host.
- The resume path replays the exact captured URL; playing the same episode from the detail
  screen builds the identical `.mkv` URL ([SeriesDetail.jsx:96](../../../src/components/SeriesDetail.jsx#L96)),
  so it fails there too.
- The codecs inside (typically H.264/AAC) are fine — only the *container* is rejected.

## Goals

- Play `.mkv` (and other AVPlayer-unsupported VOD containers) on iOS.
- Reuse the existing resilient-playback architecture: the recovery machine keeps talking
  only to a `PlayerDriver`; the new engine is another driver behind that contract.
- Keep the working `expo-video` path (mp4/HLS — ~99% of content) untouched and low-risk.
- Preserve resume position, watch-history recording, and next-episode auto-advance on the
  new path.

## Non-goals

- **Android.** `expo-video` on Android uses ExoPlayer/media3, which includes a Matroska
  extractor, so Android is expected to play MKV already. Routing is iOS-only. (If on-device
  testing shows Android also fails, the platform check is a one-line widening — deferred,
  not designed-in.)
- **Full control parity** on the VLC path. Gestures, Picture-in-Picture, the stats overlay,
  and the sleep timer are omitted from the VLC screen on day one — MKV VOD is a rare path,
  and these are not required to watch content.
- **Live streams.** Live keeps its existing HLS/MPEG-TS routing. VLC handles VOD
  unsupported containers only.
- **Transcoding / provider-side remux.** Out of scope; we play the file as delivered.

## Decisions (locked with the user)

1. **Build the full driver now** (do not spike-first). New-Architecture compatibility of the
   VLC library is unverified and is validated as an on-device step at the end, not as a gate
   before building.
2. **Route only iOS + unsupported containers** through VLC. `expo-video` stays the default
   engine for everything it can play.

## Environment constraints

- Expo ~54 / React Native 0.81 / React 19. JavaScript only (`.js`/`.jsx`).
- **New Architecture (Bridgeless)** is enabled (Expo 54 default; confirmed by the runtime
  log `iOS Bridgeless (RCTHost)`).
- Chosen library: **`react-native-vlc-media-player`** (latest v1.0.98). Plays MKV + multiple
  audio/subtitle tracks; ships an Expo config plugin; requires a dev/prebuild (not Expo Go).
  It declares **no `codegenConfig`** → it is a legacy-architecture (Paper) native component
  that renders on New Arch only through RN's legacy interop shim (enabled by default in Expo
  54). This is the primary risk (see Risks).

## Architecture

### Chosen approach — Isolated VLC screen + dispatcher

The existing [VideoPlayerScreen.native.jsx](../../../src/screens/VideoPlayerScreen.native.jsx)
(~955 lines) is written directly against `expo-video`'s imperative `player` object
(`player.currentTime`, `player.volume`, `player.audioTrack`,
`player.addListener("statusChange")`, `<VideoView player={player}>`, PiP via a ref, …). The
`PlayerDriver` is used only by `useResilientPlayback` for load/recovery.

- Move the current screen body **verbatim** to `ExpoVideoPlayerScreen.native.jsx`.
- Rewrite `VideoPlayerScreen.native.jsx` as a thin **dispatcher**: read `currentVideo`, and
  render either `ExpoVideoPlayerScreen` or the new `VlcPlayerScreen`. Each child owns its own
  hooks, so there is no conditional-hook hazard.
- Add `VlcPlayerScreen.native.jsx` that hosts `<VLCPlayer>` and drives it through a new
  `createVlcDriver` + `useResilientPlayback`.

### Alternatives considered (rejected)

- **B. Unify the screen behind one player facade.** Refactor all 955 lines to an abstraction
  implemented by both engines. Single UI, but massive regression risk on the working path for
  a rare container. Rejected (YAGNI + risk).
- **C. Fake an `expo-video` `player` shim over VLC.** Feed the existing screen an object
  mimicking `.currentTime`/`.addListener`/track objects/`videoTrack.size`/`playToEnd`. Large
  hidden surface to emulate faithfully; fragile. Rejected.

## Components

All paths are new files unless marked *(modified)* / *(moved)*.

### `src/playback/nativeEngine.js` (pure, unit-tested)

```
containerExtension(uri: string): string   // lowercased ext after last '.', query/hash stripped; '' if none
needsVlcEngine(uri: string, platform: string): boolean
```

- `UNSUPPORTED_IOS_CONTAINERS = new Set(['mkv', 'avi', 'flv', 'wmv', 'webm'])`.
- `needsVlcEngine` returns `true` only when `platform === 'ios'` **and**
  `UNSUPPORTED_IOS_CONTAINERS.has(containerExtension(uri))`.
- Works for remote `http(s)://…/id.mkv` and downloaded `file://…/id.mkv` alike (extension
  routing, source-agnostic).

### `src/playback/drivers/vlcInitOptions.js` (pure, unit-tested)

```
vlcInitOptions({ userAgent?: string, referer?: string }): string[]
```

- Produces libVLC per-input options carrying the same gating headers the expo driver sends:
  `:http-user-agent=<ua>` and `:http-referrer=<referer>` (only for provided values).
- The `mvo25.in` server is UA/Referer-gated; without this the stream 404s.
- The reuse source for the UA is `STREAM_USER_AGENT` and the referer helper `refererForUri`
  from [expoVideoDriver.js](../../../src/playback/drivers/expoVideoDriver.js) (export/lift as
  needed so both drivers share one definition).

### `src/playback/drivers/vlcDriver.js` (+ `classifyVlcError`, unit-tested)

`createVlcDriver(handle) → PlayerDriver`, where `handle` bridges to the React host:

```
handle = {
  setSource(sourceProp | null),   // pushes VLC `source` prop into host state; null clears
  getRef(): VLCPlayerRef | null,  // for imperative seek
  // host calls the driver's internal event intake from VLCPlayer callbacks
}
```

`PlayerDriver` contract mapping ([types.js](../../../src/playback/drivers/types.js)):

| Contract member        | VLC implementation |
|------------------------|--------------------|
| `load(source, opts)`   | build `{ uri, initOptions: vlcInitOptions(headers), initType, autoplay }`, call `handle.setSource(...)`; remember `opts.startTime` and seek on first `onPlaying` |
| `play()` / `pause()`   | flip host `paused` prop (via a setter on `handle`) |
| `destroy()`            | `handle.setSource(null)` |
| `currentTime()`        | last `onProgress.currentTime` (ms → s) |
| `duration()`           | last `onProgress.duration` (ms → s) |
| `buffered()`           | `0` (VLC RN gives no reliable buffered-ahead; safe default) |
| `isLive()`             | `false` (VLC path is VOD-only) |
| `setQualityCap(cap)`   | no-op (progressive file, no ABR) |
| `onStatus/onProgress/onStall/onError` | fan-out from VLC callbacks: `onPlaying/onPaused/onBuffering/onEnded → onStatus`; `onProgress → onProgress`; `onError → classifyVlcError → onError` |

`classifyVlcError(event) → NormalizedError`: map VLC error payloads into the shape
[errorClassifier.js](../../../src/playback/errorClassifier.js) expects (default coarse
`kind: 'media'` for a generic VLC failure; `offline` when the message indicates no network).
Exact VLC event field names are pinned against v1.0.98 during implementation; the mapping
intent is fixed here.

### `src/screens/VlcPlayerScreen.native.jsx`

Self-contained VLC host with a **reduced control set**. Renders `<VLCPlayer>`; owns
`createVlcDriver` + `useResilientPlayback`. Reuses existing shared hooks/modules:
`useResumePosition`, `useWatchHistory` (progress + history), `usePlayerPreferences`,
`episodeNav` (`findNextEpisode`/`buildNextEpisodeVideo`), `useResilientPlayback`, tokens/UI
primitives.

Controls included: play/pause, VOD seek bar (position/duration from `onProgress`, seek via
ref), resume prompt (`ResumePrompt`), audio-track and subtitle-track selection (VLC track
props/callbacks), aspect/resize toggle, close, next-episode. Watch progress recorded on the
same cadence and lifecycle as the expo path (interval + on background + on close), so history
and continue-watching stay consistent across engines.

Controls omitted day one: touch gestures (volume/brightness/seek), PiP, stats overlay, sleep
timer.

### `src/screens/ExpoVideoPlayerScreen.native.jsx` *(moved)*

The current `VideoPlayerScreen.native.jsx` body, moved verbatim (imports/paths adjusted).

### `src/screens/VideoPlayerScreen.native.jsx` *(rewritten, small)*

```jsx
export default function VideoPlayerScreen(props) {
  const { currentVideo } = usePlayback();
  if (currentVideo && needsVlcEngine(currentVideo.url, Platform.OS)) {
    return <VlcPlayerScreen {...props} />;
  }
  return <ExpoVideoPlayerScreen {...props} />;
}
```

### Config *(modified)*

- [package.json](../../../package.json): add `react-native-vlc-media-player`.
- [app.json](../../../app.json): add `"react-native-vlc-media-player"` to `expo.plugins`.
  Requires prebuild (already done for downloads); **not** Expo Go.

## Data flow

```
playVideo(video)
  → VideoPlayerScreen.native (dispatcher) reads currentVideo.url
    → needsVlcEngine(url, 'ios')?
        yes → VlcPlayerScreen → useResilientPlayback(driver = createVlcDriver(handle))
                → driver.load({ uri, headers }) → handle.setSource({ uri, initOptions })
                  → <VLCPlayer source=… /> plays
                  → onProgress/onError/onEnded → driver subscribers
                      → recovery machine (reload/refresh-creds/offline)
                      → progress polling → updateWatchProgress / addToWatchHistory
                      → onEnded + next episode → playVideo(next)
        no  → ExpoVideoPlayerScreen (unchanged)
```

Both remote `.mkv` and downloaded local `.mkv` route to VLC (extension-based).

## Testing

### Unit (node:test, no RN — runs in `npm test`)

- `nativeEngine.test.js`: mkv/avi/flv/wmv/webm on ios → true; mp4/m3u8/mov on ios → false;
  mkv on android → false; uppercase ext, query string (`?token=…`), hash, no extension,
  `file://` local path.
- `vlcInitOptions.test.js`: UA only, referer only, both, neither (empty array); correct
  `:http-user-agent=`/`:http-referrer=` prefixes.
- `vlcDriver`/`classifyVlcError`: generic VLC error → `kind: 'media'`; offline-ish message →
  `offline: true`; ms→s conversion for currentTime/duration.

### On-device (the New-Architecture gate — per "verify at end")

1. Prebuild with the VLC config plugin; launch a dev build on iOS.
2. Play the reported `http://mvo25.in/series/.../401998.mkv` — confirm it **plays** under
   Bridgeless (no "Cannot Open").
3. Confirm the `expo-video` path (an `.mp4` movie, an HLS/live channel) is unaffected.
4. Confirm resume position, watch-history/continue-watching, and next-episode auto-advance on
   the VLC path.
5. Prefer a **real device** if the arm64 Simulator + VLCKit combination misbehaves (see
   Risks).

`npm test` and `npm run lint` must pass before commit (per CLAUDE.md).

## Risks & mitigations

1. **New-Arch interop for the legacy VLC component** — primary unknown. The component is
   Paper-era; it renders on Bridgeless only via RN's legacy interop shim. *Mitigation:*
   isolated screen (approach A) contains the blast radius; on-device step 2 proves it early in
   implementation. If interop fails outright, fallback is the graceful "format not supported
   on this device" message (the previously-discussed option 3) — noted, not designed here.
2. **iOS Simulator + VLCKit** has historically been unreliable on arm64 simulators.
   *Mitigation:* verify on a real device.
3. **Build size** — VLCKit adds tens of MB to the iOS binary; transitive
   `react-native-slider` + `react-native-vector-icons` are linked (we use `<VLCPlayer>`
   headless with our own UI, so their components are unused but still built). Accepted.
4. **Reduced control parity** on the VLC path may surprise users who expect gestures/PiP.
   *Mitigation:* rare path; parity can be added later if MKV volume warrants it.

## Acceptance criteria

- A `.mkv` iOS VOD that previously errored `"Cannot Open"` now plays via VLC.
- `mp4`/HLS/live on iOS still play via `expo-video`, unchanged.
- Resume, watch-history/continue-watching, and next-episode work on the VLC path.
- New unit tests pass; `npm test` + `npm run lint` green.

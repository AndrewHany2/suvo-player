# Raw MPEG-TS live playback on web/TV

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

Some Xtream providers serve live channels as a **raw MPEG-TS HTTP stream**, not
HLS. Requesting `…/live/user/pass/<id>.m3u8` 302-redirects to a backend that
responds `200 Content-Type: video/mp2t` with a continuous MPEG-TS body (no
`#EXTM3U` playlist). Confirmed against `mvo25.in`:

```
GET …/372341.m3u8 → 302 → 302 → 200 Content-Type: video/mp2t  (raw TS bytes, 0x47 sync)
```

`hls.js` — the only live engine on web/TV — plays **HLS only** (an `.m3u8`
playlist + segments). Given raw TS it misparses the binary and never renders,
so the channel hangs on a black screen / spinner. Symptoms observed: bogus
`file://` loader requests, no fatal error. Native (expo-video) already decodes
raw MPEG-TS, so **phones work**; providers that serve genuine HLS work on TV.
This account never played on TV.

Scope of the fix: **web + TV live playback only.** VOD (movies/series) plays as
direct files via the native `<video>` path and is untouched. Native platforms
are untouched.

## Approach

Add `mpegts.js` (v1.8.0) as a second live engine on web/TV, selected per-channel
by **probing the stream** to tell HLS from raw MPEG-TS (both arrive as `.m3u8`
URLs, so the URL alone can't distinguish them).

## Components

### 1. `src/playback/liveStreamProbe.js` — engine classifier
Pure/leaf module (no engine imports) so the classification is unit-testable
under `node --test`.

- `classifyLiveStream({ contentType, firstBytes })` → `'hls' | 'mpegts'`:
  - `#EXTM3U` as the first non-whitespace text, or a `*mpegurl`/`vnd.apple.mpegurl`
    content-type → `'hls'`.
  - `0x47` TS sync byte (optionally repeating at 188-byte stride) or a
    `video/mp2t` / `video/mpeg` content-type → `'mpegts'`.
  - Ambiguous → default `'hls'` (preserves today's behavior for real-HLS panels).
- `probeLiveStream(url, { fetchImpl, signal })` → `Promise<{ engine, url }>`:
  one `fetch` following redirects; read `Content-Type` and a small first chunk,
  then **abort the body** (never download the live stream during a probe).
  On probe failure (network/abort) default to `'hls'` and let the recovery
  machine surface the real error. Results are cached by the caller per channel
  so a recovery-reload does not re-probe.

### 2. `src/playback/drivers/mpegtsDriver.js` — mpegts.js engine adapter
Implements the existing `PlayerDriver` contract; `mpegts.js` is imported only
here (mirrors the "never import hls.js/expo-video outside their driver" rule).

- Wraps `mpegts.createPlayer({ type:'mpegts', isLive:true, url }, mediaDataSource
  config)`; attaches to the shared `<video>` element.
- `load` / `play` / `pause` / `destroy`; `currentTime` / `duration` (Infinity for
  live) / `buffered` / `isLive` → true.
- `setQualityCap`: no-op (raw TS has no ABR levels — same as the native driver).
- Events → `NormalizedError` and `PlayerStatus` via `onError` / `onStatus` /
  `onProgress` / `onStall`, so the shared `recoveryMachine` drives retries and a
  RELOAD tears down + recreates the player unchanged.
- TV: small buffer config; disable mpegts.js worker if it breaks under webOS
  `file://` (mirrors the existing hls worker caveat).

### 3. Routing in `src/playback/usePlayer.js`
`usePlayer` still hands `useResilientPlayback` a single, session-stable driver,
but that driver becomes a thin **router**:

- Non-live source → existing hls/native path (no probe, no behavior change).
- Live source → `await probeLiveStream(uri)` (cached), then delegate `load` and
  all getters/subscriptions to the hls sub-driver (`.m3u8`) or the mpegts
  sub-driver (`.ts`). The router forwards the `PlayerDriver` surface to whichever
  sub-driver is active; `useResilientPlayback` and `recoveryMachine` stay unaware
  of the split.

## Data flow

`playChannel(TV)` → `currentVideo.url` (`.m3u8`/`.ts`) → router `load` → probe →
`hlsDriver` or `mpegtsDriver` → `<video>` → status/error events → recovery
machine → (RELOAD re-delegates to the same engine via the cached probe result).

## Error handling

All engine faults normalize to `NormalizedError`; the existing classifier +
recovery ladder apply. A failed probe degrades to `'hls'` (today's behavior).
mpegts fatal errors escalate to recovery exactly like hls fatal errors.

## Testing

- Unit: `classifyLiveStream` truth table (EXTM3U / mpegurl / 0x47 / video/mp2t /
  ambiguous) and `probeLiveStream` with a fake fetch (redirect, content-type,
  abort-after-first-chunk, failure→default).
- Smoke: mpegtsDriver constructs and implements the contract.
- Manual: webOS simulator **and** real LG TV with the `mvo25.in` account (raw TS)
  and a known real-HLS account (regression) both play.

## Out of scope

VOD/movies/series playback, native platforms, DVR/timeshift, audio/subtitle
track menus for raw TS (mpegts single program), and changing the existing
`FileSafeLoader` hardening (kept as-is).

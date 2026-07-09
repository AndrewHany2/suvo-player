# Offline Downloads — Design (mobile v1)

**Date:** 2026-07-09
**Status:** Approved design → implementation planning
**Scope:** iOS + Android only for v1 (designed to expand to Electron/web later).

## Goal

Let users download VOD content (movies and individual series episodes) to the
device and watch it later with no internet connection.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Platforms | Mobile only (iOS + Android) for v1; abstraction leaves room to add Electron/web. |
| Content | Movies + individual series episodes. No batch "download whole season" in v1. Live TV excluded (continuous stream). |
| Management UI | Inline — download control on titles, a "Downloaded" filter chip, no new nav destination. |
| Offline access | Offline banner + "Downloaded" filter: when offline, screens read from the local metadata store instead of the Xtream API. |
| Background | True background downloads — survive app backgrounding/close and resume on relaunch. |
| Engine | Approach A: `react-native-background-downloader` for transfers + `expo-file-system` for files/space + AsyncStorage metadata store. |

## Non-goals (v1)

- No batch season downloads / download queue manager UI.
- No live-TV recording.
- No download on web, Electron, or TV (later, behind the same interface).
- No DRM/encryption of downloaded files beyond the OS app sandbox.

## Architecture

A `DownloadManager` abstraction mirrors the existing engine-agnostic
`PlayerDriver` model in `src/playback/`. The rest of the app talks only to a
React hook and a pure metadata store; the background-download library never
leaks past the native manager.

```
src/downloads/
  DownloadManager.js        # interface/contract (JSDoc typedefs). Future web/electron impls slot in here.
  nativeDownloadManager.js  # RN impl: react-native-background-downloader + expo-file-system
  downloadStore.js          # pure: metadata CRUD + state transitions over AsyncStorage (source of truth)
  downloadStore.test.js
  useDownloads.js           # React hook + context: subscribes to progress, exposes start/pause/resume/cancel/delete
  downloadUri.js            # builds Xtream remote file URL + local target path from a content item
  downloadUri.test.js
  DownloadButton.jsx        # reusable inline control (idle → progress → done → delete)
```

## Data model

One record per download, persisted as a JSON collection in AsyncStorage
(via `src/utils/storage.js`). At v1 scale (tens–hundreds of items) a single
keyed blob is sufficient.

```js
{
  id,             // stable key: `movie:<streamId>` or `ep:<seriesId>:<s>:<e>`
  kind,           // 'movie' | 'episode'
  title,          // display title
  poster,         // artwork url (cached separately, best-effort)
  seriesId, season, episode,   // episodes only
  remoteUrl,      // Xtream file URL captured at download start
  localPath,      // documentDirectory/downloads/<id>.<ext>
  ext,            // container extension (mp4/mkv/...)
  bytesTotal,     // from Content-Length (0 if unknown)
  bytesDone,      // progress
  status,         // 'queued' | 'downloading' | 'paused' | 'done' | 'error'
  error,          // message when status === 'error'
  createdAt, updatedAt,
}
```

Files live in `${documentDirectory}downloads/`.

## Data flow

- **Start:** title screen → `useDownloads().start(item)` → `downloadUri` builds
  the remote URL (via `iptvApi.buildStreamUrl`) and a local target path →
  `downloadStore` writes a `queued` record → `nativeDownloadManager` hands the
  task to `react-native-background-downloader`. Progress callbacks update
  `bytesDone`/`status`.
- **Resume on relaunch:** on app start `nativeDownloadManager` calls the
  library's `checkForExistingDownloads()` and re-attaches to any in-flight
  background tasks, reconciling their state back into `downloadStore`.
- **Play offline:** a `done` record's `localPath` is passed as the source URI to
  the existing `expoVideoDriver`. No network is touched, so the recovery
  machine's OFFLINE path never triggers.
- **Delete:** remove the file (`expo-file-system`) and the record.

## UI surface (inline)

- **`DownloadButton`** on movie & episode rows/detail: idle → progress ring →
  ✓ downloaded → delete/remove.
- **"Downloaded" filter chip** on Movies/Series screens: reads from
  `downloadStore` instead of the Xtream API.
- **Offline banner:** reuses the online/offline detection already present in
  `useResilientPlayback` (lazy `@react-native-community/netinfo`). When offline,
  screens fall back to local metadata and auto-apply the "Downloaded" filter.
- **Storage used** line surfaced in the Account/settings area.

## Error handling & edge cases

- **Free-space pre-flight:** compare `getFreeDiskStorageAsync()` against
  `Content-Length` before starting; refuse with a clear message when
  insufficient.
- **Interrupted / failed download:** move to `error` status with a retry action;
  partial file cleaned up or resumed by the library.
- **Cancel mid-download:** remove the partial file and the record.
- **Xtream credential/URL change:** the download uses the URL captured at start;
  playback of a `done` file is credential-independent (it's a local file).
- **Duplicate download:** `start()` is idempotent on `id` — re-tapping a
  downloading/done item is a no-op or opens it.

## Native configuration

- Add `react-native-background-downloader` and its Expo config plugin to
  `app.json`; requires `expo prebuild` (native builds already used via
  `expo run:ios` / `expo run:android`).
- iOS: background `URLSession`. Android: foreground service + notification.

## Testing

`node:test` (no Jest), test files beside source:

- `downloadStore.test.js` — CRUD, id generation, state transitions, storage
  round-trip (AsyncStorage mocked).
- `downloadUri.test.js` — remote URL + local path building for movie/episode.
- `useDownloads` logic — driven against a fake `DownloadManager` implementing the
  contract, asserting progress/state reducers. The native library boundary is
  thin and mocked.

## Risks

- **Store / legal:** downloading provider content for offline playback attracts
  app-store review and copyright scrutiny (related to the existing no-"IPTV"
  wording store-compliance constraint). Product decision; noted here explicitly.
- **Large files:** multi-GB movies stress storage and battery; free-space
  pre-flight and clear progress mitigate but don't eliminate this.
- **Provider variance:** some Xtream providers serve VOD without a reliable
  `Content-Length`; handle `bytesTotal === 0` gracefully (indeterminate
  progress).

## Future expansion (out of scope now)

- Electron/web `DownloadManager` implementations behind the same contract.
- Batch "download whole season" with a queue/manager screen.
- Optional at-rest encryption.

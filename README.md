# IPTV Player

A cross-platform IPTV player built with Expo and React Native. One codebase
targets iOS, Android, desktop (Electron), the web, and TV (LG webOS + Samsung
Tizen). It connects to any Xtream Codes provider for Live TV, Movies, and
Series, enriches VOD with TMDB metadata, and syncs profiles / accounts / watch
history / favorites through Supabase.

## Tech Stack

- **Expo ~54 / React Native 0.81 / React 19** — the single app codebase
- **react-native-web** — powers the web, Electron, and TV builds via a Metro web export
- **expo-video + hls.js** — playback engines (expo-video on native, hls.js on web/TV)
- **React Navigation** — native-stack + bottom-tabs
- **Supabase** — auth + Edge Functions + Postgres for cloud sync
- **Xtream Codes API** — IPTV content source
- **TMDB** — movie/series artwork and metadata
- **Electron** — desktop shell around the web build (with an optional external-VLC handoff)

## Platform Matrix

| Platform          | Bundler / Build                     | Runtime engine        |
| ----------------- | ----------------------------------- | --------------------- |
| iOS               | `expo run:ios` (native)             | expo-video            |
| Android           | `expo run:android` (native)         | expo-video            |
| Web               | `expo export --platform web` (Metro, `output: single`) | hls.js |
| Electron desktop  | web build wrapped by Electron       | hls.js (opt. VLC)     |
| TV — LG webOS     | web build + `tv/patch-index.js`     | hls.js                |
| TV — Samsung Tizen| web build + `tv/patch-index.js`     | hls.js                |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture,
the `.tv` / `.web` / `.native` Metro variant convention, and the playback
driver model.

## Prerequisites

- **Node.js 20** (see `.nvmrc`; `npm install` requires `node >=20`)
- A **Supabase project** for cloud sync — copy `.env.example` to `.env` and
  fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
  Without these the app silently falls back to device-local storage.
- A **TMDB API key** (`EXPO_PUBLIC_TMDB_API_KEY`) for artwork/metadata.
- For native builds: Xcode (iOS) / Android Studio (Android).
- For TV builds: **LG webOS `ares-cli`** and/or the **Samsung Tizen CLI**
  (`tizen`, `sdb`, and an emulator via `em-cli`).

## Setup

```bash
nvm use            # Node 20 (per .nvmrc)
npm install
cp .env.example .env   # then fill in Supabase + TMDB values
```

## Development

```bash
npm start            # Expo dev server (choose a target)
npm run dev:ios      # build & run on iOS simulator (expo run:ios)
npm run dev:android  # build & run on Android (expo run:android)
npm run web          # web dev server on http://localhost:3001
npm run dev:electron # web dev server + Electron shell (concurrently)
```

## Building

```bash
npm run build:web       # export web bundle to dist/ (+ obfuscate)
npm run build:electron  # web build packaged as an Electron app (electron-builder)
npm run build:tv        # TV web build to tv/dist/ (EXPO_PUBLIC_TV=1 + patch-index + obfuscate)
```

### TV deploy / simulate

```bash
npm run sim:lg      # build TV bundle and launch in the webOS 26 simulator (ares-launch)
npm run deploy:lg   # package + install + launch on a connected LG TV (ares-*)
npm run sim:tizen   # build + package + launch in a Tizen emulator
npm run deploy:tizen # TIZEN_TV_IP=<ip> npm run deploy:tizen  — install + run on a Tizen TV
```

## Testing & Linting

```bash
npm test        # node --test src scripts supabase electron
npm run lint    # eslint . (react-hooks rules; warnings OK, errors fail)
```

Run both before committing.

## License

This repository is private (`"private": true` in `package.json`) and is not
published under an open-source license.

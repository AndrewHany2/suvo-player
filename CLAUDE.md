# CLAUDE.md

Guidance for working in this repo. See `docs/ARCHITECTURE.md` for the full picture.

## Stack

Expo ~54 / React Native 0.81 / react-native-web / React 19. JavaScript only
(`.js` / `.jsx`, not TS). Node 20 (`.nvmrc`). One codebase → iOS, Android, web,
Electron, and TV (LG webOS + Samsung Tizen).

## `.tv` / `.web` / `.native` variant convention

Screens/components are split by file suffix:

- `*.native.jsx` — iOS/Android (expo-video).
- `*.web.jsx` — web/Electron.
- `*.tv.jsx` (+ `*.tv.css`) — the 10-foot TV UI.

Native selects `.native` by Metro's platform extension. **TV and web are both
`expo export --platform web`**, so they can't be told apart that way — instead
`metro.config.js` swaps `.web` screens to `.tv` when `EXPO_PUBLIC_TV=1` (set by
`build:tv`). When you add or rename a screen variant, update the regex in
`metro.config.js` too, or the `.tv` variant won't be bundled.

## Playback

Engine-agnostic. The pure `recoveryMachine.js` reducer talks only to a
`PlayerDriver` (`drivers/types.js`); engines live behind `hlsDriver.js` (web/TV)
and `expoVideoDriver.js` (native). `useResilientPlayback.js` is the React host.
Never import hls.js or expo-video outside their driver.

## webOS / `file://` gotchas

TV builds run over `file://`. `tv/patch-index.js` rewrites root-relative asset
paths (`/_expo/…` → `./_expo/…`), transpiles the bundle down for older TV JS
engines, and strips redundant CSS preloads. Keep asset references relative and
avoid syntax the transpile step doesn't cover. Don't `crossorigin`-preload local
fonts on `file://`.

## Tests

`node:test`, run via `npm test` (`node --test src scripts supabase electron`).
Test files sit next to source as `*.test.js`. No Jest.

## Before committing

Run `npm test` and `npm run lint` (eslint flat config, react-hooks rules —
warnings are OK, errors are not). Both must pass.

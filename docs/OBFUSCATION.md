# Code Obfuscation

Post-build code protection for the JS-based targets. **Bar-raising only** — the
bundle and the Supabase publishable key remain extractable. The real security
boundary is the functions-only API + (on native) hardware attestation. See
`docs/superpowers/specs/2026-07-02-production-security-hardening-design.md` §2/§8.

## What is obfuscated

| Target | Bundle | Obfuscated? | How |
|--------|--------|-------------|-----|
| Web (browser) | `dist/` | ✅ | `scripts/obfuscate.js` post-export |
| webOS / Tizen TV | `tv/dist/` | ✅ | same, after `tv/patch-index.js` |
| Electron | `dist/` (via `build:web`) | ✅ | same + asar + `@electron/fuses` |
| iOS / Android | Hermes bytecode | n/a | already non-readable, no JS pass |

Wired into `build:web`, `build:tv`, `build:electron`. Runs on build **output**
only — never on `src/`.

## Presets (per-target)

`scripts/obfuscateConfig.js` exports a preset per target profile, selected via
`getPreset(profile)`:

- **`web`** — balanced-aggressive. Control-flow flattening, RC4-encoded string
  array, string splitting. Used by `build:web` and `build:electron` (which calls
  `build:web`). No engine constraints, so this is the stronger of the two
  presets — deliberately not "maximum" though: no `deadCodeInjection` /
  `numbersToExpressions` (bundle + runtime cost outweighs benefit).
  `transformObjectKeys` is **off**: it renames object-literal keys and
  white-screens the React-Native-Web bundle (verified 2026-07-17 boot smoke —
  `Cannot read properties of undefined (reading 'focusBracket')`). Don't
  re-enable without a passing boot smoke of the obfuscated `dist`.
- **`tv`** — TV-safe, light–medium. Deliberately **off**:
  `controlFlowFlattening`, `deadCodeInjection`, `stringArrayEncoding`,
  `selfDefending`. These crawl or break on weak TV engines (webOS/Tizen).
  Kept: identifier mangling (locals), string-array extraction, compaction.
  Used by `build:tv`.

If a build stalls/whitescreens on TV after an obfuscation change, the `tv`
preset is too heavy — revert the flags above to off. Only add a stronger flag
back after validating on `npm run sim:lg` **and** `npm run sim:tizen`.

## TV flag hardening (Task 3, 2026-07-17)

Per-flag decisions for the `tv` preset. Verified here only that the real
`build:tv` bundle obfuscates to valid JS (`node --check`) — **boot-time/perf on
a real TV engine is UNCONFIRMED** (the webOS simulator isn't installed on the
dev machine and the Tizen x86_64 emulator can't HW-virtualize on Apple Silicon).

| Flag | Status | Reason |
|------|--------|--------|
| `stringArrayThreshold: 1` | **applied** (pending on-TV confirm) | pure string extraction, no runtime decode — strictly milder than web |
| `splitStrings` (+`splitStringsChunkLength: 8`) | **applied** (pending on-TV confirm) | plain string concatenation; web preset already ships it |
| `stringArrayEncoding: ['base64']` | deferred | runtime `atob` decode per string = classic weak-engine crawl |
| `stringArrayEncoding: ['rc4']` | deferred | heavier decode than base64 |
| `controlFlowFlattening` | deferred | biggest TV hang/crawl risk |
| `transformObjectKeys` | rejected | white-screens RN-web even on V8 (see web note above) |
| `selfDefending` | deferred | self-check overhead unproven on weak TV engines |

### Confirm on a real TV engine, then push further

1. Baseline is the current `tv` preset. Deploy it and confirm the app boots to
   the login screen with acceptable menu/scroll perf:
   - webOS: `npm run deploy:lg` (real TV) or `npm run sim:lg` (needs the webOS
     TV Simulator 26 installed).
   - Tizen: `npm run sim:tizen` (needs a virtualization-capable host) or
     `TIZEN_TV_IP=<ip> npm run deploy:tizen`.
2. To try a deferred flag, enable exactly one in `tvPreset`
   (`scripts/obfuscateConfig.js`), rebuild+deploy, and check both engines for
   whitescreen and crawl. Keep it only if both boot acceptably; revert otherwise.
   Recommended order (least→most risky): `stringArrayEncoding: ['base64']` →
   `['rc4']` → `controlFlowFlattening` (start `controlFlowFlatteningThreshold`
   low, e.g. `0.2`).
3. Record each flag's webOS/Tizen verdict in the table above, and add an
   assertion in `scripts/obfuscateConfig.test.js` for any flag confirmed safe so
   it can't silently regress.

## Electron fuses

`electron/afterPack.js` flips (V1): `RunAsNode` off, Node CLI inspect off, Node
`OPTIONS` env off, `OnlyLoadAppFromAsar` on. Blocks relaunching the packaged
binary as a raw Node REPL. Does not change app behavior.

## Run manually

```bash
node scripts/obfuscate.js <dir> [web|tv]   # obfuscates every .js in place; profile defaults to web
```

Fails loud (non-zero exit) if any file can't be obfuscated — never ships
un-obfuscated silently.

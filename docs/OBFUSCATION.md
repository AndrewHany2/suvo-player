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

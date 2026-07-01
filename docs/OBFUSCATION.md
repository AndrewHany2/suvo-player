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

## Preset (TV-safe)

`scripts/obfuscateConfig.js` — light–medium. Deliberately **off**:
`controlFlowFlattening`, `deadCodeInjection`, `stringArrayEncoding`,
`selfDefending`. These crawl or break on weak TV engines (webOS/Tizen). Kept:
identifier mangling (locals), string-array extraction, compaction.

If a build stalls/whitescreens on TV after an obfuscation change, the preset is
too heavy — revert the flags above to off.

## Electron fuses

`electron/afterPack.js` flips (V1): `RunAsNode` off, Node CLI inspect off, Node
`OPTIONS` env off, `OnlyLoadAppFromAsar` on. Blocks relaunching the packaged
binary as a raw Node REPL. Does not change app behavior.

## Run manually

```bash
node scripts/obfuscate.js <build-output-dir>   # obfuscates every .js in place
```

Fails loud (non-zero exit) if any file can't be obfuscated — never ships
un-obfuscated silently.

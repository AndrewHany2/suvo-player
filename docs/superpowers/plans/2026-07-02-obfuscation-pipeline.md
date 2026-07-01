# Obfuscation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-export code-obfuscation pass to the web/TV/Electron bundles and harden the Electron package (asar + fuses), raising the bar against casual code cloning/IP theft.

**Architecture:** A single Node script (`scripts/obfuscate.js`) walks a build-output directory, obfuscates every `.js` in place with a **light–medium** `javascript-obfuscator` preset tuned for weak TV engines (no control-flow flattening, no string-array encoding), and is wired into `build:web`, `build:tv`, and `build:electron` as a post-export step. Electron additionally gets `@electron/fuses` flipped via an `afterPack` hook; asar is already produced by electron-builder. Native (iOS/Android) relies on Hermes bytecode — no JS obfuscation added there.

**Tech Stack:** Node, `javascript-obfuscator`, `@electron/fuses`, existing Expo export + electron-builder toolchain.

## Global Constraints

- **Obfuscation is bar-raising only** — the JS bundle and the Supabase publishable key remain extractable. Never rely on it for secrecy (spec §2, §8).
- **TV engines are weak** — the preset MUST keep `controlFlowFlattening: false` and `stringArrayEncoding: []`; heavy transforms crawl/break on webOS/Tizen (spec §D, line 104).
- **Idempotent & non-destructive to source** — obfuscation runs only on build *output* dirs (`dist/`, `tv/dist/`), never on `src/`.
- **Fail loud** — if obfuscation errors on any file, the build must fail (non-zero exit), not ship un-obfuscated silently.
- Node test runner: `node --test` on co-located `*.test.js`. Keep the existing suite green (currently 210 tests).

---

### Task 1: Obfuscation config (light–medium TV-safe preset)

**Files:**
- Create: `scripts/obfuscateConfig.js`
- Test: `scripts/obfuscateConfig.test.js`

**Interfaces:**
- Produces: `const OBFUSCATE_OPTIONS = { ... }` (plain object consumed by `javascript-obfuscator`), exported via `module.exports = { OBFUSCATE_OPTIONS }`.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert");
const { OBFUSCATE_OPTIONS } = require("./obfuscateConfig.js");

test("preset is TV-safe: no control-flow flattening, no string-array encoding", () => {
  assert.strictEqual(OBFUSCATE_OPTIONS.controlFlowFlattening, false);
  assert.strictEqual(OBFUSCATE_OPTIONS.deadCodeInjection, false);
  assert.strictEqual(OBFUSCATE_OPTIONS.selfDefending, false);
  assert.deepStrictEqual(OBFUSCATE_OPTIONS.stringArrayEncoding, []);
});

test("preset still mangles identifiers and uses a string array", () => {
  assert.strictEqual(OBFUSCATE_OPTIONS.identifierNamesGenerator, "mangled");
  assert.strictEqual(OBFUSCATE_OPTIONS.stringArray, true);
  assert.strictEqual(OBFUSCATE_OPTIONS.compact, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/obfuscateConfig.test.js`
Expected: FAIL — `Cannot find module './obfuscateConfig.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// Light–medium obfuscation preset. Tuned for weak TV engines (webOS/Tizen):
// control-flow flattening and string-array encoding are OFF — they crawl or
// break there. This mangles names + hides string literals only. Bar-raising,
// not real secrecy (see spec §2/§8).
const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  stringArrayEncoding: [],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
  target: "browser",
};

module.exports = { OBFUSCATE_OPTIONS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/obfuscateConfig.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/obfuscateConfig.js scripts/obfuscateConfig.test.js
git commit -m "feat(build): add TV-safe obfuscation preset"
```

---

### Task 2: JS file discovery over a build dir

**Files:**
- Create: `scripts/collectJsFiles.js`
- Test: `scripts/collectJsFiles.test.js`

**Interfaces:**
- Consumes: a Node `fs`-like object `{ readdirSync(dir,{withFileTypes:true}), }` (injected for testability).
- Produces: `collectJsFiles(rootDir, fs) -> string[]` — recursive list of absolute-ish `.js` paths, excluding `.map`, `.json`, and non-`.js` files.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { collectJsFiles } = require("./collectJsFiles.js");

function ent(name, isDir) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

// Fake tree:
//  root/a.js  root/b.js.map  root/c.css  root/sub/d.js  root/sub/e.txt
const tree = {
  root: [ent("a.js", false), ent("b.js.map", false), ent("c.css", false), ent("sub", true)],
  [path.join("root", "sub")]: [ent("d.js", false), ent("e.txt", false)],
};
const fakeFs = { readdirSync: (dir) => tree[dir] ?? [] };

test("collects .js recursively, skips .map/.css/.txt", () => {
  const found = collectJsFiles("root", fakeFs).sort();
  assert.deepStrictEqual(found, [path.join("root", "a.js"), path.join("root", "sub", "d.js")]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/collectJsFiles.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
const path = require("node:path");

// Recursively collect .js files under rootDir. `.js.map` is excluded because
// name ends with ".map", not ".js". fs is injected for testing; defaults to
// the real module.
function collectJsFiles(rootDir, fs = require("node:fs")) {
  const out = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full, fs));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

module.exports = { collectJsFiles };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/collectJsFiles.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add scripts/collectJsFiles.js scripts/collectJsFiles.test.js
git commit -m "feat(build): recursive .js discovery for obfuscation"
```

---

### Task 3: Obfuscation transform + behavior-preserving smoke test

**Files:**
- Create: `scripts/obfuscate.js` (CLI entry + testable core)
- Test: `scripts/obfuscate.test.js`
- Modify: `package.json` (add `javascript-obfuscator` devDependency)

**Interfaces:**
- Consumes: `OBFUSCATE_OPTIONS` (Task 1), `collectJsFiles` (Task 2).
- Produces: `obfuscateCode(source) -> string` (pure wrapper over the library); `run(dir, deps)` (reads each file, writes obfuscated back, returns count). CLI: `node scripts/obfuscate.js <dir>`.

- [ ] **Step 1: Install the library**

Run: `npm install --save-dev javascript-obfuscator`
Expected: adds `javascript-obfuscator` to devDependencies.

- [ ] **Step 2: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert");
const { obfuscateCode } = require("./obfuscate.js");

test("obfuscated output differs from source but preserves behavior", () => {
  const src = "function add(a,b){return a+b;} globalThis.__r = add(2,3);";
  const out = obfuscateCode(src);
  assert.notStrictEqual(out, src);            // actually transformed
  assert.ok(!out.includes("function add"));   // identifier mangled
  const sandbox = {};
  new Function("globalThis", out).call(sandbox, sandbox); // eval in a fake global
  assert.strictEqual(sandbox.__r, 5);         // behavior intact
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/obfuscate.test.js`
Expected: FAIL — module not found / `obfuscateCode` undefined.

- [ ] **Step 4: Write minimal implementation**

```js
const fs = require("node:fs");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { OBFUSCATE_OPTIONS } = require("./obfuscateConfig.js");
const { collectJsFiles } = require("./collectJsFiles.js");

function obfuscateCode(source) {
  return JavaScriptObfuscator.obfuscate(source, OBFUSCATE_OPTIONS).getObfuscatedCode();
}

// Obfuscate every .js under `dir` in place. Throws (fails the build) on the
// first file that cannot be obfuscated — never ships un-obfuscated silently.
function run(dir, deps = {}) {
  const _fs = deps.fs ?? fs;
  const _collect = deps.collect ?? collectJsFiles;
  const _obf = deps.obfuscateCode ?? obfuscateCode;
  const files = _collect(dir, _fs);
  for (const file of files) {
    const src = _fs.readFileSync(file, "utf8");
    _fs.writeFileSync(file, _obf(src));
  }
  return files.length;
}

module.exports = { obfuscateCode, run };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/obfuscate.js <build-output-dir>");
    process.exit(1);
  }
  try {
    const n = run(dir);
    console.log(`obfuscated ${n} .js file(s) in ${dir}`);
  } catch (e) {
    console.error(`obfuscation failed: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/obfuscate.test.js`
Expected: PASS (1 test)

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npm test`
Expected: all green (213 tests: prior 210 + Task 1's 2 + Task 2's 1 + this 1 = 214; confirm count grows, 0 fail).

- [ ] **Step 7: Commit**

```bash
git add scripts/obfuscate.js scripts/obfuscate.test.js package.json package-lock.json
git commit -m "feat(build): in-place obfuscation pass with behavior smoke test"
```

---

### Task 4: Wire obfuscation into web + TV builds

**Files:**
- Modify: `package.json` (`build:web`, `build:tv` scripts)

**Interfaces:**
- Consumes: `scripts/obfuscate.js` CLI from Task 3.

- [ ] **Step 1: Update the scripts**

Change in `package.json`:

```json
"build:web": "expo export --platform web --clear && node scripts/obfuscate.js dist",
"build:tv": "EXPO_PUBLIC_TV=1 expo export --platform web --output-dir tv/dist --clear && node tv/patch-index.js && node scripts/obfuscate.js tv/dist"
```

(Obfuscate AFTER `patch-index.js` so the patcher operates on readable output; the final shipped JS is obfuscated.)

- [ ] **Step 2: Run the web build end-to-end**

Run: `npm run build:web`
Expected: export completes, then `obfuscated N .js file(s) in dist` with N ≥ 1, exit 0.

- [ ] **Step 3: Spot-check output is obfuscated**

Run: `grep -rl "function " dist/_expo 2>/dev/null | head` then open one bundle.
Expected: identifiers mangled, string array present. (Manual eyeball — no assertion.)

- [ ] **Step 4: Run the TV build**

Run: `npm run build:tv`
Expected: export + patch-index + `obfuscated N .js file(s) in tv/dist`, exit 0.

- [ ] **Step 5: TV smoke on simulator (manual — TV engine is the risk)**

Run: `npm run sim:lg`
Expected: app boots and navigates on the webOS simulator with the obfuscated bundle. **This is the critical check** — if it stalls/whitescreens, the preset is too heavy; revisit Task 1 (should not happen with flattening/encoding off). Note the result.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat(build): obfuscate web and TV exports post-export"
```

---

### Task 5: Electron hardening — asar + @electron/fuses

**Files:**
- Modify: `package.json` (`build:electron` already runs `build:web`, which now obfuscates)
- Create: `electron/afterPack.js`
- Modify: `electron/builder.json` (register `afterPack`, ensure `asar: true`)
- Modify: `package.json` (add `@electron/fuses` devDependency)

**Interfaces:**
- Consumes: electron-builder's `afterPack` context (`{ appOutDir, electronPlatformName, packager }`).
- Produces: an `afterPack.js` default export that flips runtime fuses on the packaged binary.

- [ ] **Step 1: Install fuses**

Run: `npm install --save-dev @electron/fuses`
Expected: adds `@electron/fuses`.

- [ ] **Step 2: Write the afterPack hook**

Create `electron/afterPack.js`:

```js
// electron-builder afterPack: flip security fuses on the packaged Electron
// binary. Disables run-as-node / inspector so the app can't be trivially
// relaunched as a raw Node REPL with your code. asar integrity + onlyLoadAppFromAsar
// bind the runtime to the packaged asar.
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

module.exports = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const exeName = packager.appInfo.productFilename;
  const app = {
    darwin: `${exeName}.app`,
    win32: `${exeName}.exe`,
    linux: exeName,
  }[electronPlatformName];
  const electronBinary = path.join(appOutDir, app);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
```

- [ ] **Step 3: Register in builder.json**

In `electron/builder.json`, ensure these keys exist:

```json
{
  "asar": true,
  "afterPack": "electron/afterPack.js"
}
```

- [ ] **Step 4: Build the Electron app**

Run: `npm run build:electron`
Expected: web export obfuscated → electron-builder packages → afterPack runs with no error → artifact produced.

- [ ] **Step 5: Smoke-launch the packaged app (manual)**

Launch the produced binary from `dist/`.
Expected: app opens and works normally (fuses don't affect app behavior, only the raw-Node escape hatch). Note the result.

- [ ] **Step 6: Commit**

```bash
git add electron/afterPack.js electron/builder.json package.json package-lock.json
git commit -m "feat(electron): asar + security fuses on packaged app"
```

---

### Task 6: Document the pipeline & residual limits

**Files:**
- Modify: `docs/superpowers/specs/2026-07-02-production-security-hardening-design.md` (mark §D done, cross-link this plan)
- Create: `docs/OBFUSCATION.md`

- [ ] **Step 1: Write the doc**

Create `docs/OBFUSCATION.md` covering: which builds are obfuscated (web/TV/Electron) vs not (native→Hermes); the TV-safe preset rationale (why flattening/encoding are off); how to run manually (`node scripts/obfuscate.js <dir>`); and the honest ceiling — obfuscation + fuses are evadable, the real boundary is the functions-only API + native attestation (link spec §8).

- [ ] **Step 2: Update the spec status line**

In the spec, annotate §D (Obfuscation) and the §9 workstream as implemented, referencing `docs/superpowers/plans/2026-07-02-obfuscation-pipeline.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/OBFUSCATION.md docs/superpowers/specs/2026-07-02-production-security-hardening-design.md
git commit -m "docs(security): obfuscation pipeline + residual limits"
```

---

## Self-Review

**Spec coverage (§D, §9 item 2):** web/TV `javascript-obfuscator` light–medium (Tasks 1–4) ✓; native = Hermes, no extra pass (documented, Task 6) ✓; Electron asar + fuses (Task 5) ✓. Covered.

**Placeholder scan:** none — every code step has complete content.

**Type consistency:** `OBFUSCATE_OPTIONS` (Task 1) consumed by `obfuscate.js` (Task 3); `collectJsFiles(dir, fs)` signature identical in Tasks 2 & 3; `obfuscateCode`/`run` names match between impl and CLI. Consistent.

**Note on test counts:** the "213/214" figure in Task 3 Step 6 is indicative; assert the count grew from 210 and 0 failures rather than an exact number.

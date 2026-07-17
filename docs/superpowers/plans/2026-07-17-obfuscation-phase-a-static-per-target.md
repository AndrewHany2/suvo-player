# Obfuscation Phase A — Per-Target Static Obfuscation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single shared obfuscator config into per-target presets so web/Electron get balanced-aggressive read-hardening (control-flow flattening + RC4 string encoding + string splitting + object-key transforms) while TV keeps the safe preset — then empirically harden the TV preset flag-by-flag against the webOS/Tizen simulators.

**Architecture:** `scripts/obfuscateConfig.js` becomes a preset registry (`getPreset(profile)`); `scripts/obfuscate.js` takes a `profile` argument and threads it through `obfuscateCode`/`run`; `package.json` build scripts pass `web` or `tv`. TV gains flags only after per-flag simulator validation.

**Tech Stack:** Node 20, `javascript-obfuscator` (already a devDependency), `node:test`, `eslint` flat config.

**Scope note:** This is Phase A of the 3-layer program in [2026-07-17-obfuscation-anti-tamper-layers-design.md](../specs/2026-07-17-obfuscation-anti-tamper-layers-design.md). Phase A is **read-hardening only** — runtime anti-tamper flags (`selfDefending`, `debugProtection`) stay **off** here and are turned on in the Phase B plan. Phases B (runtime anti-tamper), C (client secret-hardening), and D (server entitlements) get their own plans.

## Global Constraints

- JavaScript only (`.js`/`.jsx`), Node 20 (`.nvmrc`). No TypeScript in scripts.
- Tests use `node:test` + `node:assert`, run via `npm test`. Test files sit next to source as `*.test.js`.
- Before every commit: `npm test` and `npm run lint` must pass (eslint warnings OK, errors not).
- Obfuscation runs on **build output only**, never on `src/`. It must **fail loud** (non-zero exit) — never ship un-obfuscated silently.
- TV (webOS/Tizen) runs the bundle over `file://` on weak JS engines. `controlFlowFlattening`, `deadCodeInjection`, `stringArrayEncoding`, `selfDefending` are known to crawl or break there — never enable a strong flag on the `tv` preset without validating on `npm run sim:lg` **and** `npm run sim:tizen`.
- `build:electron` reuses `build:web`, so the `web` preset also governs Electron.

---

### Task 1: Per-target preset registry in `obfuscateConfig.js`

**Files:**
- Modify: `scripts/obfuscateConfig.js` (currently exports `OBFUSCATE_OPTIONS`)
- Test: `scripts/obfuscateConfig.test.js` (currently asserts against `OBFUSCATE_OPTIONS`)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `getPreset(profile)` → returns the options object for `profile`, which is `"web"` or `"tv"`. Throws `Error` on any other value.
  - `PRESETS` → `{ web: <object>, tv: <object> }`.
  - `webPreset`, `tvPreset` → the two objects (named exports for direct testing).

- [ ] **Step 1: Rewrite the config test to assert both presets**

Replace the entire contents of `scripts/obfuscateConfig.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert");
const { getPreset, webPreset, tvPreset } = require("./obfuscateConfig.js");

test("tv preset stays TV-safe: no CFF, no string-array encoding, no self-defending", () => {
  assert.strictEqual(tvPreset.controlFlowFlattening, false);
  assert.strictEqual(tvPreset.deadCodeInjection, false);
  assert.strictEqual(tvPreset.selfDefending, false);
  assert.deepStrictEqual(tvPreset.stringArrayEncoding, []);
});

test("tv preset still mangles identifiers and uses a string array", () => {
  assert.strictEqual(tvPreset.identifierNamesGenerator, "mangled");
  assert.strictEqual(tvPreset.stringArray, true);
  assert.strictEqual(tvPreset.compact, true);
});

test("web preset is balanced-aggressive: CFF + RC4 string encoding + splitting + object keys", () => {
  assert.strictEqual(webPreset.controlFlowFlattening, true);
  assert.deepStrictEqual(webPreset.stringArrayEncoding, ["rc4"]);
  assert.strictEqual(webPreset.splitStrings, true);
  assert.strictEqual(webPreset.transformObjectKeys, true);
});

test("web preset keeps runtime anti-tamper OFF (that is Phase B)", () => {
  assert.strictEqual(webPreset.selfDefending, false);
  assert.strictEqual(webPreset.debugProtection ?? false, false);
});

test("getPreset returns the matching preset", () => {
  assert.strictEqual(getPreset("web"), webPreset);
  assert.strictEqual(getPreset("tv"), tvPreset);
});

test("getPreset throws loudly on an unknown profile", () => {
  assert.throws(() => getPreset("desktop"), /unknown obfuscation profile/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/obfuscateConfig.test.js`
Expected: FAIL — `getPreset`/`webPreset`/`tvPreset` are not exported yet (`undefined is not a function` / assertion failures).

- [ ] **Step 3: Rewrite `scripts/obfuscateConfig.js` with both presets + `getPreset`**

Replace the entire contents of `scripts/obfuscateConfig.js` with:

```js
// Per-target obfuscation presets. Read-hardening only (Phase A): runtime
// anti-tamper flags (selfDefending / debugProtection) stay OFF here and are
// turned on in Phase B. Bar-raising, not real secrecy — see
// docs/superpowers/specs/2026-07-17-obfuscation-anti-tamper-layers-design.md.

// TV (webOS/Tizen) — weak engines over file://. controlFlowFlattening,
// deadCodeInjection, stringArrayEncoding, selfDefending crawl or break there.
// Kept: identifier mangling, string-array extraction, compaction. Only add a
// strong flag after validating on `npm run sim:lg` AND `npm run sim:tizen`.
const tvPreset = {
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

// Web / Electron — no engine constraints. Balanced-aggressive: control-flow
// flattening at a moderate threshold, RC4-encoded string array, string
// splitting, object-key transforms. Deliberately NOT "maximum": no
// deadCodeInjection / numbersToExpressions (bundle + runtime cost outweighs
// benefit). selfDefending/debugProtection remain OFF until Phase B.
const webPreset = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["rc4"],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
  target: "browser",
};

const PRESETS = { web: webPreset, tv: tvPreset };

// Fail loud on an unknown profile — never silently fall back to a weaker (or
// wrong) preset.
function getPreset(profile) {
  const preset = PRESETS[profile];
  if (!preset) {
    throw new Error(
      `unknown obfuscation profile: ${profile} (expected one of: ${Object.keys(PRESETS).join(", ")})`,
    );
  }
  return preset;
}

module.exports = { getPreset, PRESETS, webPreset, tvPreset };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/obfuscateConfig.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/obfuscateConfig.js scripts/obfuscateConfig.test.js
git commit -m "feat(obfuscation): split config into per-target web/tv presets"
```

---

### Task 2: Thread `profile` through `obfuscate.js`, the CLI, and build scripts

**Files:**
- Modify: `scripts/obfuscate.js`
- Modify: `scripts/obfuscate.test.js`
- Modify: `package.json` (`build:web`, `build:tv` scripts)
- Modify: `docs/OBFUSCATION.md` (document the per-target presets)

**Interfaces:**
- Consumes: `getPreset(profile)` from Task 1.
- Produces:
  - `obfuscateCode(source, profile = "web")` → obfuscated string using the profile's preset.
  - `run(dir, profile = "web", deps = {})` → obfuscates every `.js` under `dir` in place using the profile; returns the file count. `deps.obfuscateCode`, if provided, is called as `(source, profile)`.
  - CLI: `node scripts/obfuscate.js <build-output-dir> [web|tv]` (profile defaults to `web`).

- [ ] **Step 1: Update the obfuscate test for per-profile behavior**

Replace the entire contents of `scripts/obfuscate.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert");
const { obfuscateCode, run } = require("./obfuscate.js");

test("web profile encodes string literals but preserves behavior", () => {
  const src =
    'function greet(n){var msg="hello "+n;return msg;} globalThis.__r = greet("world");';
  const out = obfuscateCode(src, "web");
  assert.notStrictEqual(out, src);
  assert.ok(!out.includes("hello ")); // RC4 string array hides the literal
  const sandbox = {};
  new Function("globalThis", out).call(sandbox, sandbox);
  assert.strictEqual(sandbox.__r, "hello world"); // behavior intact
});

test("default profile is web (mangles locals, preserves behavior)", () => {
  const src =
    "function add(a,b){var localSum=a+b;return localSum;} globalThis.__r = add(2,3);";
  const out = obfuscateCode(src); // no profile → web
  assert.ok(!out.includes("localSum")); // local identifier mangled away
  const sandbox = {};
  new Function("globalThis", out).call(sandbox, sandbox);
  assert.strictEqual(sandbox.__r, 5);
});

test("tv profile preserves behavior with the TV-safe preset", () => {
  const src =
    "function add(a,b){var localSum=a+b;return localSum;} globalThis.__r = add(4,5);";
  const out = obfuscateCode(src, "tv");
  assert.ok(!out.includes("localSum"));
  const sandbox = {};
  new Function("globalThis", out).call(sandbox, sandbox);
  assert.strictEqual(sandbox.__r, 9);
});

test("run threads the profile to the obfuscator for each file", () => {
  const seen = [];
  const fakeFs = {
    readFileSync: () => "var x = 1;",
    writeFileSync: (file, out) => seen.push(out),
  };
  const n = run("build", "tv", {
    fs: fakeFs,
    collect: () => ["build/a.js", "build/b.js"],
    obfuscateCode: (src, profile) => `/*${profile}*/${src}`,
  });
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(seen, ["/*tv*/var x = 1;", "/*tv*/var x = 1;"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/obfuscate.test.js`
Expected: FAIL — `obfuscateCode` ignores the `profile` arg today and `run` has no `profile` parameter, so the `tv` marker assertions fail (or the RC4 assertion fails because the old single preset has no encoding).

- [ ] **Step 3: Update `scripts/obfuscate.js` to accept a profile**

Replace the entire contents of `scripts/obfuscate.js` with:

```js
const fs = require("node:fs");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { getPreset } = require("./obfuscateConfig.js");
const { collectJsFiles } = require("./collectJsFiles.js");

// Obfuscate a source string using the named target profile ("web" | "tv").
function obfuscateCode(source, profile = "web") {
  return JavaScriptObfuscator.obfuscate(source, getPreset(profile)).getObfuscatedCode();
}

// Obfuscate every .js under `dir` in place using `profile`. Throws (fails the
// build) on the first file that cannot be obfuscated — never ships
// un-obfuscated silently.
function run(dir, profile = "web", deps = {}) {
  const _fs = deps.fs ?? fs;
  const _collect = deps.collect ?? collectJsFiles;
  const _obf = deps.obfuscateCode ?? obfuscateCode;
  const files = _collect(dir, _fs);
  for (const file of files) {
    const src = _fs.readFileSync(file, "utf8");
    _fs.writeFileSync(file, _obf(src, profile));
  }
  return files.length;
}

module.exports = { obfuscateCode, run };

if (require.main === module) {
  const dir = process.argv[2];
  const profile = process.argv[3] || "web";
  if (!dir) {
    console.error("usage: node scripts/obfuscate.js <build-output-dir> [web|tv]");
    process.exit(1);
  }
  try {
    const n = run(dir, profile);
    console.log(`obfuscated ${n} .js file(s) in ${dir} [profile: ${profile}]`);
  } catch (e) {
    console.error(`obfuscation failed: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/obfuscate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Pass the profile in the build scripts**

In `package.json`, change the two obfuscate invocations:

- `build:web`: change `node scripts/obfuscate.js dist` → `node scripts/obfuscate.js dist web`
- `build:tv`: change `node scripts/obfuscate.js tv/dist` → `node scripts/obfuscate.js tv/dist tv`

(`build:electron` calls `build:web`, so it inherits the `web` profile — no change needed.)

- [ ] **Step 6: Update `docs/OBFUSCATION.md` for per-target presets**

In `docs/OBFUSCATION.md`, replace the "## Preset (TV-safe)" section with a "## Presets (per-target)" section documenting: `web` (balanced-aggressive — CFF, RC4 string encoding, splitStrings, transformObjectKeys; used by `build:web` + `build:electron`) and `tv` (TV-safe — CFF/encoding/selfDefending off; used by `build:tv`). Update the "Run manually" example to `node scripts/obfuscate.js <dir> [web|tv]`. Keep the "fails loud" and "bar-raising only" notes.

- [ ] **Step 7: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: all tests pass; lint reports no errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/obfuscate.js scripts/obfuscate.test.js package.json docs/OBFUSCATION.md
git commit -m "feat(obfuscation): select web/tv preset by profile arg in build pipeline"
```

---

### Task 3: Validate web/Electron output, then empirically harden the TV preset on simulators

**Files:**
- Modify (only for flags that survive testing): `scripts/obfuscateConfig.js` (`tvPreset`)
- Modify (only if a preset changes): `scripts/obfuscateConfig.test.js`
- Modify: `docs/OBFUSCATION.md` (per-flag TV results table)

**Interfaces:**
- Consumes: the presets + build scripts from Tasks 1–2.
- Produces: a documented, simulator-validated `tvPreset` and a confirmed-working web/Electron build.

This task is **empirical**, not TDD — its "tests" are real builds on real engines. Do NOT enable any strong TV flag that whitescreens or crawls.

- [ ] **Step 1: Build + smoke-test the web/Electron output**

Run: `npm run build:web`
Expected: build completes; console prints `obfuscated N .js file(s) in dist [profile: web]`.
Then serve `dist/` (e.g. `npx serve dist`) and confirm the app boots, login screen renders, and navigation works. Note the bundle size delta vs. before (record it for Step 5's doc update). If the app breaks, the balanced-aggressive `web` preset is at fault — bisect by turning off `transformObjectKeys`, then `splitStrings`, then `controlFlowFlattening`, in that order, and record which flag was responsible.

- [ ] **Step 2: Baseline the TV build with today's safe preset**

Run: `npm run sim:lg`
Expected: webOS 26 simulator launches the app; it boots without a whitescreen and navigates. This is the known-good baseline (the `tv` preset is unchanged from before this plan). If it fails here, the problem is pre-existing — stop and investigate separately.
Then run: `npm run sim:tizen` and confirm the same on Tizen.

- [ ] **Step 3: Enable ONE strong TV flag and re-test both simulators**

In `scripts/obfuscateConfig.js`, in `tvPreset`, enable the next candidate flag (test them one at a time, in this order — least to most likely to break):
1. `stringArrayThreshold: 1` (extract all strings — cheap, usually safe)
2. `splitStrings: true, splitStringsChunkLength: 8`
3. `transformObjectKeys: true`
4. `stringArrayEncoding: ["base64"]` (lighter than rc4)
5. `stringArrayEncoding: ["rc4"]`
6. `controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.3`

After changing the one flag:
Run: `npm run sim:lg` — confirm boot, no whitescreen, acceptable menu/scroll perf.
Run: `npm run sim:tizen` — same.
If **either** engine breaks or crawls: revert that one flag and mark it "rejected". If both pass: keep it and proceed to the next candidate. Record the pass/reject verdict for every flag tried.

- [ ] **Step 4: Lock the surviving TV flags into the test**

For each flag that survived Step 3, add an assertion to `scripts/obfuscateConfig.test.js` so a future edit can't silently regress it, e.g. if `splitStrings` survived:

```js
test("tv preset keeps simulator-validated flags", () => {
  assert.strictEqual(tvPreset.splitStrings, true); // validated webOS26 + Tizen on 2026-07-17
});
```

(Add one assertion per surviving flag. If **no** strong flag survived, skip this step — `tvPreset` is unchanged and Task 1's TV-safe assertions already cover it.)

- [ ] **Step 5: Document the per-flag TV results**

In `docs/OBFUSCATION.md`, add a "## TV per-flag validation (2026-07-17)" table: one row per flag tried in Step 3 with columns `flag | webOS26 | Tizen | verdict`. Record the web/Electron bundle-size delta from Step 1. State that on-device (real hardware) confirmation is still recommended before shipping the heavier TV flags.

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: all pass (including any new `tvPreset` assertions from Step 4).

- [ ] **Step 7: Commit**

```bash
git add scripts/obfuscateConfig.js scripts/obfuscateConfig.test.js docs/OBFUSCATION.md
git commit -m "test(obfuscation): harden tv preset with simulator-validated flags"
```

---

## Self-Review

**Spec coverage (Phase A rows of the design doc):**
- Per-target configs driven by a `profile` arg → Tasks 1–2. ✅
- Web/Electron balanced-aggressive (CFF + RC4 stringArray + splitStrings + transformObjectKeys, no max-tier deadCode/numbersToExpressions) → Task 1 `webPreset` + Task 2 wiring. ✅
- TV incremental per-flag validation on webOS + Tizen sims, keeping only what runs → Task 3. ✅
- Native = Hermes, no pre-Hermes JS pass → correctly out of scope (spec §7); not a task. ✅
- selfDefending/debugProtection deferred to Phase B → `webPreset.selfDefending: false` asserted in Task 1 Step 1. ✅
- "Fail loud, never ship un-obfuscated silently" → preserved in `obfuscate.js`; `getPreset` throws on bad profile (Task 1). ✅
- `component boundaries` §4: named presets, pure data, `obfuscate.js` unchanged except profile threading → matches. ✅

**Placeholder scan:** No TBD/TODO/"add error handling" left. Task 3 is intentionally empirical (real builds), but every step states the exact command, the exact flag order, and the exact pass/reject rule — no vague "test it" steps.

**Type consistency:** `getPreset(profile)` (Task 1) is consumed with the same signature in Task 2's `obfuscateCode`. `obfuscateCode(source, profile)` and `run(dir, profile, deps)` signatures match between the Task 2 test's `deps.obfuscateCode: (src, profile) => ...` and the implementation. Preset names `webPreset`/`tvPreset`/`PRESETS` are identical across config module, its test, and the wiring task.

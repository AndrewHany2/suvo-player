// Verifies locale pruning across both packaged layouts:
//  - mac:       <code>.lproj/locale.pak  (nested dirs)
//  - win/linux: <code>.pak              (flat files)
// English variants (en, en_US, en-US, en_GB, en_NEUTER, ...) must survive.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pruneLocales, KEEP_LOCALE } = require("./afterPack.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "afterpack-"));
}

test("KEEP_LOCALE matches English variants, rejects others", () => {
  for (const keep of ["en", "en_US", "en-US", "en_GB", "en_NEUTER", "en-GB"]) {
    assert.ok(KEEP_LOCALE.test(keep), `should keep ${keep}`);
  }
  for (const drop of ["de", "fr", "zh_TW", " endonesian", "fen", "es-419"]) {
    assert.ok(!KEEP_LOCALE.test(drop), `should drop ${drop}`);
  }
});

test("prunes flat <code>.pak files (win/linux layout), keeps English", () => {
  const dir = tmpDir();
  for (const code of ["en-US", "de", "fr", "zh-CN", "es-419"]) {
    fs.writeFileSync(path.join(dir, `${code}.pak`), "x".repeat(1000));
  }
  const freed = pruneLocales(dir);
  const left = fs.readdirSync(dir).sort();
  assert.deepStrictEqual(left, ["en-US.pak"]);
  assert.strictEqual(freed, 4000);
});

test("prunes <code>.lproj/locale.pak dirs (mac layout), keeps English", () => {
  const dir = tmpDir();
  for (const code of ["en", "en_GB", "de", "zh_TW", "ru_NEUTER"]) {
    const lproj = path.join(dir, `${code}.lproj`);
    fs.mkdirSync(lproj);
    fs.writeFileSync(path.join(lproj, "locale.pak"), "x".repeat(500));
  }
  const freed = pruneLocales(dir);
  const left = fs.readdirSync(dir).sort();
  assert.deepStrictEqual(left, ["en.lproj", "en_GB.lproj"]);
  assert.strictEqual(freed, 1500);
});

test("missing dir is a no-op (platform without that layout)", () => {
  assert.strictEqual(pruneLocales(path.join(tmpDir(), "nope")), 0);
});

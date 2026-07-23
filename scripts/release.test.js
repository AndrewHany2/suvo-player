const test = require("node:test");
const assert = require("node:assert");
const {
  parseVersion,
  formatVersion,
  bumpVersion,
  computeVersionCode,
  isNewer,
  nextVersionFromArg,
  withVersion,
  withAppVersion,
} = require("./release.js");

test("parseVersion accepts X.Y.Z and rejects junk", () => {
  assert.deepStrictEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.deepStrictEqual(parseVersion(" 10.0.0 "), { major: 10, minor: 0, patch: 0 });
  assert.throws(() => parseVersion("1.2"));
  assert.throws(() => parseVersion("v1.2.3"));
  assert.throws(() => parseVersion("1.2.3-beta"));
});

test("bumpVersion resets lower components", () => {
  assert.strictEqual(formatVersion(bumpVersion("1.2.3", "patch")), "1.2.4");
  assert.strictEqual(formatVersion(bumpVersion("1.2.3", "minor")), "1.3.0");
  assert.strictEqual(formatVersion(bumpVersion("1.2.3", "major")), "2.0.0");
});

test("computeVersionCode uses major*10000+minor*100+patch", () => {
  assert.strictEqual(computeVersionCode(parseVersion("1.2.3")), 10203);
  assert.strictEqual(computeVersionCode(parseVersion("1.2.2")), 10202);
  assert.strictEqual(computeVersionCode(parseVersion("2.0.0")), 20000);
  assert.throws(() => computeVersionCode(parseVersion("1.100.0")));
  assert.throws(() => computeVersionCode(parseVersion("1.0.100")));
});

test("isNewer orders by major, then minor, then patch", () => {
  assert.ok(isNewer("1.2.4", "1.2.3"));
  assert.ok(isNewer("1.3.0", "1.2.9"));
  assert.ok(isNewer("2.0.0", "1.9.9"));
  assert.ok(!isNewer("1.2.3", "1.2.3"));
  assert.ok(!isNewer("1.2.2", "1.2.3"));
});

test("nextVersionFromArg handles keywords and explicit versions", () => {
  assert.strictEqual(nextVersionFromArg("patch", "1.2.3"), "1.2.4");
  assert.strictEqual(nextVersionFromArg("major", "1.2.3"), "2.0.0");
  assert.strictEqual(nextVersionFromArg("1.5.0", "1.2.3"), "1.5.0");
  assert.throws(() => nextVersionFromArg("nonsense", "1.2.3"));
});

test("withVersion rewrites only version and preserves formatting", () => {
  const input = '{\n  "name": "x",\n  "version": "1.2.3"\n}\n';
  const out = withVersion(input, "1.2.4");
  assert.strictEqual(out, '{\n  "name": "x",\n  "version": "1.2.4"\n}\n');
});

test("withAppVersion rewrites expo.version and android.versionCode", () => {
  const input = JSON.stringify({ expo: { version: "1.2.3", android: { versionCode: 10202 } } }, null, 2) + "\n";
  const out = withAppVersion(input, "1.2.4", 10204);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.expo.version, "1.2.4");
  assert.strictEqual(parsed.expo.android.versionCode, 10204);
  assert.ok(out.endsWith("\n"));
});

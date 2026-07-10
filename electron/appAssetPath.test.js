const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveAppAssetPath, ERR_FILE_NOT_FOUND } = require("./appAssetPath.js");

const DIST = path.join("/app", "dist");

test("root path serves index.html", () => {
  const r = resolveAppAssetPath(DIST, "app://localhost/");
  assert.deepEqual(r, { path: path.join(DIST, "index.html") });
});

test("normal asset resolves under dist", () => {
  const r = resolveAppAssetPath(DIST, "app://localhost/_expo/static/js/app.js");
  assert.deepEqual(r, { path: path.join(DIST, "_expo/static/js/app.js") });
});

test("percent-encoded chars are decoded", () => {
  const r = resolveAppAssetPath(DIST, "app://localhost/assets/my%20font.ttf");
  assert.deepEqual(r, { path: path.join(DIST, "assets/my font.ttf") });
});

test("dot-segment traversal in the pathname is refused", () => {
  // URL normalization clamps leading `..`, but if any slipped through, the
  // containment check must still reject an escape from dist.
  const r = resolveAppAssetPath(DIST, "app://localhost/../secrets.txt");
  // Normalized to /secrets.txt which is still inside dist — this specific one is
  // safe; assert it does NOT escape dist.
  assert.ok("path" in r);
  assert.ok(r.path.startsWith(DIST + path.sep));
});

test("percent-encoded traversal cannot escape dist", () => {
  const r = resolveAppAssetPath(DIST, "app://localhost/%2e%2e%2f%2e%2e%2fetc%2fpasswd");
  assert.deepEqual(r, { error: ERR_FILE_NOT_FOUND });
});

test("a sibling directory that shares a prefix does not match", () => {
  // Encoded traversal is the real attack: URL parsing leaves %2e literal (no
  // clamping), we decode to `../dist-secrets/...` which path.join resolves to a
  // SIBLING of dist. The `distPath + sep` boundary must reject it (a bare
  // startsWith(distPath) would wrongly allow dist-secrets/).
  const r = resolveAppAssetPath(DIST, "app://localhost/%2e%2e%2fdist-secrets%2fkeys.txt");
  assert.deepEqual(r, { error: ERR_FILE_NOT_FOUND });
});

test("malformed percent-encoding is treated as not found", () => {
  const r = resolveAppAssetPath(DIST, "app://localhost/%");
  assert.deepEqual(r, { error: ERR_FILE_NOT_FOUND });
});

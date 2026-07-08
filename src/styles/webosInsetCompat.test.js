// webOS/Tizen TV compat guard.
//
// The TV build runs on an older Chromium (< 87) that does not know the CSS
// `inset` shorthand. When it sees `inset: 0` it drops the whole declaration,
// so a `position: fixed/absolute` full-bleed container ends up with no offsets,
// collapses to its content size at the origin, and renders in the top-left —
// taking every popup modal, overlay, and the video loading spinner with it.
// (Same reason tv/patch-index.js's boot splash uses explicit top/left/right/
// bottom, not `inset`.)
//
// Elements that also set width/height:100% survive, which is why the general
// UI looked fine but the modals/spinner didn't — a trap that's easy to
// re-introduce. So: ban the `inset` positioning property in src; use explicit
// top/right/bottom/left instead. (The `--a-inset` design token is a custom
// property name, not the `inset` property, so it's allowed.)

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..");
const EXTS = new Set([".js", ".jsx", ".css"]);
// The `inset` CSS property, not preceded by `-` (so `--a-inset:` is exempt).
const INSET_RE = /(?<!-)\binset\s*:/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name)) && !entry.name.endsWith(".test.js"))
      out.push(full);
  }
  return out;
}

test("no CSS `inset` shorthand in src (unsupported on webOS <87)", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (INSET_RE.test(line)) {
        offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `Use explicit top/right/bottom/left instead of the \`inset\` shorthand ` +
      `(dropped by webOS Chromium <87):\n${offenders.join("\n")}`,
  );
});

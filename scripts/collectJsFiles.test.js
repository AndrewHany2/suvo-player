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
  assert.deepStrictEqual(found, [
    path.join("root", "a.js"),
    path.join("root", "sub", "d.js"),
  ]);
});

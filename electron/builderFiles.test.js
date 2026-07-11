'use strict';

// Guards the `files` allow-list in electron/builder.json: every local module that the
// packaged main/preload process require()s must be bundled, or the installed desktop app
// crashes at launch with "cannot find module './X.js'". Walks the relative-require graph
// from the entry points and asserts each reached file is listed in builder.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = __dirname;
const builder = JSON.parse(fs.readFileSync(path.join(electronDir, 'builder.json'), 'utf8'));
const packaged = new Set(builder.files || []);

// Electron loads main.js (build.extraMetadata.main); main.js loads preload.js at runtime.
const ENTRY_POINTS = ['main.js', 'preload.js'];

function relativeRequires(file) {
  const src = fs.readFileSync(path.join(electronDir, file), 'utf8');
  const re = /require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    let target = m[1].replace(/^\.\//, '');
    if (!target.endsWith('.js')) target += '.js';
    out.push(target);
  }
  return out;
}

function reachableModules() {
  const seen = new Set();
  const queue = [...ENTRY_POINTS];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of relativeRequires(file)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

test('every local module reachable from the electron entry points is packaged', () => {
  for (const file of reachableModules()) {
    assert.ok(
      packaged.has(`electron/${file}`),
      `electron/${file} is require()d at runtime but missing from builder.json "files" ` +
        `— the installed app would fail with "cannot find module ./${file}"`
    );
  }
});

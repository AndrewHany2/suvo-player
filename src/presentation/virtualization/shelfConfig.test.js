// src/presentation/virtualization/shelfConfig.test.js
const test = require("node:test");
const assert = require("node:assert");
const { getShelfConfig } = require("./shelfConfig.js");

test("every platform exposes the full config shape", () => {
  for (const p of ["web", "native", "tv"]) {
    const c = getShelfConfig(p);
    for (const k of ["hOverscan", "vOverscan", "posterWidth", "posterGap", "rowHeight"]) {
      assert.strictEqual(typeof c[k], "number", `${p}.${k} is a number`);
    }
  }
});

test("baseline overscan is ~4 and TV overscans more than web", () => {
  assert.ok(getShelfConfig("web").hOverscan >= 3 && getShelfConfig("web").hOverscan <= 5);
  assert.ok(getShelfConfig("tv").hOverscan > getShelfConfig("web").hOverscan);
});

test("unknown platform falls back to web config", () => {
  assert.deepStrictEqual(getShelfConfig("nope"), getShelfConfig("web"));
});

test("detectPlatform vocabulary maps onto renderer keys", () => {
  // detectPlatform returns "mobile"/"desktop", not "native"/"web".
  assert.deepStrictEqual(getShelfConfig("mobile"), getShelfConfig("native"));
  assert.deepStrictEqual(getShelfConfig("desktop"), getShelfConfig("web"));
});

const test = require("node:test");
const assert = require("node:assert");
const { getDeviceIntegrity } = require("./deviceIntegrity.web.js");

test("web integrity probe is never compromised", async () => {
  const r = await getDeviceIntegrity();
  assert.strictEqual(r.compromised, false);
});

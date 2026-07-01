const test = require("node:test");
const assert = require("node:assert");
const { obfuscateCode } = require("./obfuscate.js");

test("obfuscated output differs from source but preserves behavior", () => {
  const src = "function add(a,b){var localSum=a+b;return localSum;} globalThis.__r = add(2,3);";
  const out = obfuscateCode(src);
  assert.notStrictEqual(out, src); // actually transformed
  assert.ok(!out.includes("localSum")); // local identifier mangled away
  const sandbox = {};
  new Function("globalThis", out).call(sandbox, sandbox); // eval against a fake global
  assert.strictEqual(sandbox.__r, 5); // behavior intact
});

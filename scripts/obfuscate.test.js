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

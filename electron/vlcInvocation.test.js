const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { buildVlcInvocation } = require("./vlcInvocation.js");

// The VLC launch must never build a shell string from untrusted stream URLs /
// names. buildVlcInvocation returns { file, args } for execFile (no shell), or
// null when the URL is unsafe — this is what closes the RCE.
describe("buildVlcInvocation", () => {
  test("http url on darwin builds a shell-free `open` invocation", () => {
    const inv = buildVlcInvocation("http://host/live/1.ts", { startTime: 0, name: "Ch 1" }, "darwin");
    assert.deepEqual(inv, {
      file: "open",
      args: ["-a", "VLC", "http://host/live/1.ts", "--args", "--meta-title=Ch 1"],
    });
  });

  test("darwin with no extra args omits `--args`", () => {
    const inv = buildVlcInvocation("http://h/s", { startTime: 0, name: "" }, "darwin");
    assert.deepEqual(inv, { file: "open", args: ["-a", "VLC", "http://h/s"] });
  });

  test("startTime adds a floored --start-time; url goes last on linux", () => {
    const inv = buildVlcInvocation("http://h/s", { startTime: 42.9, name: "" }, "linux");
    assert.deepEqual(inv, { file: "vlc", args: ["--start-time=42", "http://h/s"] });
  });

  test("shell metacharacters in name stay ONE argv element (no injection)", () => {
    const inv = buildVlcInvocation("https://h/s", { name: '"; rm -rf ~ #' }, "win32");
    assert.equal(inv.file, "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe");
    assert.deepEqual(inv.args, ['--meta-title="; rm -rf ~ #', "https://h/s"]);
  });

  test("rejects a non-http(s) scheme", () => {
    assert.equal(buildVlcInvocation("file:///etc/passwd", {}, "darwin"), null);
  });

  test("rejects a value that would inject a VLC flag (leading dash / no scheme)", () => {
    assert.equal(buildVlcInvocation("--vlc-flag", {}, "darwin"), null);
  });

  test("rejects a malformed url", () => {
    assert.equal(buildVlcInvocation("not a url", {}, "linux"), null);
  });

  test("coerces a non-numeric startTime to no --start-time", () => {
    const inv = buildVlcInvocation("http://h/s", { startTime: "5; evil", name: "" }, "linux");
    assert.deepEqual(inv.args, ["http://h/s"]);
  });
});

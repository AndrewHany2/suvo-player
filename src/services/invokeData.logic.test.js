const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapInvokeResult, isForcedLogoutError, functionErrorCode } = require("./invokeData.logic.js");

test("mapInvokeResult returns data on success", () => {
  assert.deepEqual(mapInvokeResult({ data: { ok: true, items: [1] }, error: null }), {
    ok: true,
    items: [1],
  });
});

test("mapInvokeResult throws the transport error message", () => {
  assert.throws(() => mapInvokeResult({ data: null, error: { message: "boom" } }), /boom/);
});

test("mapInvokeResult throws the body error code (e.g. ACCOUNT_INACTIVE)", () => {
  assert.throws(() => mapInvokeResult({ data: { error: "ACCOUNT_INACTIVE" }, error: null }), /ACCOUNT_INACTIVE/);
  assert.throws(() => mapInvokeResult({ data: { error: "DEVICE_MISMATCH" }, error: null }), /DEVICE_MISMATCH/);
});

test("isForcedLogoutError fires for account-inactive states (current + legacy shapes)", () => {
  assert.equal(isForcedLogoutError("ACCOUNT_INACTIVE"), true);
  assert.equal(isForcedLogoutError("ACCOUNT_SUSPENDED"), true);
  assert.equal(isForcedLogoutError("ACCOUNT_EXPIRED"), true);
  assert.equal(isForcedLogoutError("PROVIDER_SUSPENDED"), true);
});

test("isForcedLogoutError does not fire for device-lock / entitlement / other errors", () => {
  // Device-lock has its own screen; entitlement/other errors must not sign out.
  assert.equal(isForcedLogoutError("DEVICE_MISMATCH"), false);
  assert.equal(isForcedLogoutError("NOT_ENTITLED"), false);
  assert.equal(isForcedLogoutError("REQUEST_FAILED"), false);
  assert.equal(isForcedLogoutError(undefined), false);
});

test("functionErrorCode prefers the structured body error (the real 403 code)", () => {
  // This is the crux: supabase-js hands us a generic transport message, but the
  // real code is in the parsed body — force-logout must key off THIS, not the message.
  assert.equal(
    functionErrorCode({ error: "ACCOUNT_INACTIVE" }, "Edge Function returned a non-2xx status code"),
    "ACCOUNT_INACTIVE",
  );
  assert.equal(functionErrorCode({ error: "DEVICE_MISMATCH" }, "whatever"), "DEVICE_MISMATCH");
});

test("functionErrorCode falls back to the transport message when the body is unreadable", () => {
  assert.equal(functionErrorCode(null, "boom"), "boom");
  assert.equal(functionErrorCode({}, "boom"), "boom");
  assert.equal(functionErrorCode({ error: "" }, "boom"), "boom");
  assert.equal(functionErrorCode(null, ""), "REQUEST_FAILED");
});

test("functionErrorCode output flows into isForcedLogoutError end-to-end", () => {
  // The two helpers compose: a 403 ACCOUNT_INACTIVE body => force logout;
  // a 403 DEVICE_MISMATCH body => no logout (device-lock screen handles it).
  assert.equal(isForcedLogoutError(functionErrorCode({ error: "ACCOUNT_INACTIVE" }, "x")), true);
  assert.equal(isForcedLogoutError(functionErrorCode({ error: "DEVICE_MISMATCH" }, "x")), false);
});

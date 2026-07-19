// Pure result-mapper for calls to the device-gated `data` Edge Function.
// Kept separate from supabase.js so it can be unit-tested without the client.
function mapInvokeResult({ data, error }) {
  if (error) throw new Error(error.message || "REQUEST_FAILED");
  if (data && data.error === "DEVICE_MISMATCH") throw new Error("DEVICE_MISMATCH");
  if (data && data.error) throw new Error(data.error);
  return data;
}

// The device-gated `data` function returns 403 { error: "ACCOUNT_INACTIVE" }
// when the caller's account is suspended/expired (or its provider is suspended).
// The stock client only re-checks account status at login and device-claim, so
// an already-signed-in session would otherwise keep using the app indefinitely
// after a suspend. Callers use this to force a sign-out on that error, dropping
// the user to the login screen where the reseller gate surfaces the reason.
// The current `data` function collapses these to "ACCOUNT_INACTIVE", but an
// older deployed build may still surface the raw status constant — match both
// so force-logout works regardless of which version is live. DEVICE_MISMATCH is
// deliberately excluded: it has its own device-locked screen, not a sign-out.
function isForcedLogoutError(message) {
  return (
    message === "ACCOUNT_INACTIVE" ||
    message === "ACCOUNT_SUSPENDED" ||
    message === "ACCOUNT_EXPIRED" ||
    message === "PROVIDER_SUSPENDED"
  );
}

// Resolve the code the client should act on for a FAILED `data` call. supabase-js
// reports any non-2xx (the data fn's 403s) as a FunctionsHttpError whose generic
// message is "Edge Function returned a non-2xx status code" — the real code lives
// in the JSON body ({ "error": "ACCOUNT_INACTIVE" }), read from error.context.
// Given that parsed body (or null if unreadable) plus the transport error's
// fallback message, prefer the structured `error` so account-status gating and
// force-logout see the true code instead of the opaque transport message.
function functionErrorCode(parsedBody, fallbackMessage) {
  if (parsedBody && typeof parsedBody.error === "string" && parsedBody.error) {
    return parsedBody.error;
  }
  return fallbackMessage || "REQUEST_FAILED";
}

module.exports = { mapInvokeResult, isForcedLogoutError, functionErrorCode };

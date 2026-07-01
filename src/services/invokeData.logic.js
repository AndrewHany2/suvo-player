// Pure result-mapper for calls to the device-gated `data` Edge Function.
// Kept separate from supabase.js so it can be unit-tested without the client.
function mapInvokeResult({ data, error }) {
  if (error) throw new Error(error.message || "REQUEST_FAILED");
  if (data && data.error === "DEVICE_MISMATCH") throw new Error("DEVICE_MISMATCH");
  if (data && data.error) throw new Error(data.error);
  return data;
}

module.exports = { mapInvokeResult };

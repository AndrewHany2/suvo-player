const { CONNECTIVITY_MESSAGE, isConnectivityError } = require("../utils/networkError.logic.js");

// Pure result-mapper for calls to the `login` Edge Function. Kept separate from
// supabase.js so it can be unit-tested without the client. The function returns
// HTTP 200 with an { ok } body for every expected outcome, so a transport
// `error` only appears on a network fault or 5xx.
function mapLoginResult({ data, error }) {
  if (error) {
    // A connectivity fault (network down / timeout / gateway 521) is worth telling
    // the user plainly, and it's retryable — distinct from a real sign-in failure.
    // Tag it so AuthScreen can show the connection message + a Retry affordance.
    if (isConnectivityError(error)) {
      const e = new Error(CONNECTIVITY_MESSAGE);
      e.kind = "network";
      throw e;
    }
    // Other transport faults: keep generic and opaque — its message leaks
    // internals ("Edge Function returned a non-2xx status code"). Keep generic.
    throw new Error("Could not sign in right now. Please try again.");
  }
  if (!data || data.ok !== true) {
    throw new Error(
      (data && data.error) || "Invalid email or password.",
    );
  }
  const { access_token, refresh_token } = data;
  if (!access_token || !refresh_token) {
    throw new Error("Invalid email or password.");
  }
  return { access_token, refresh_token };
}

module.exports = { mapLoginResult };

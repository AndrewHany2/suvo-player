// Pure helpers for the `login` Edge Function. No I/O and no imports, so they run
// under both the Deno edge runtime and node:test.

// Single generic credential error, used for BOTH "no such email" and "wrong
// password" so the endpoint never reveals which accounts exist (anti-enumeration).
export const INVALID_CREDENTIALS = "Invalid email or password.";

// Trim + lowercase the login email. Login is email-only; there is no
// username→email resolution anymore.
export function normalizeEmail(input) {
  return String(input ?? "").trim().toLowerCase();
}

// Map a GoTrue signInWithPassword error to a client-safe message. Only
// "email_not_confirmed" is surfaced distinctly (it helps a legitimate user and
// leaks nothing an attacker can act on); every other failure collapses to the
// generic INVALID_CREDENTIALS.
export function mapSignInError(error) {
  if (!error) return null;
  if (error.code === "email_not_confirmed") {
    return "Your email is not confirmed. Please check your inbox and confirm your account.";
  }
  return INVALID_CREDENTIALS;
}

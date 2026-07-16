// Pure helpers for the `login` Edge Function. No I/O and no imports, so they run
// under both the Deno edge runtime and node:test.

// Single generic credential error, used for BOTH "no such username/email" and
// "wrong password" so the endpoint never reveals which accounts exist
// (anti-enumeration). Keep this byte-identical across every failing branch.
export const INVALID_CREDENTIALS = "Invalid username/email or password.";

// Trim + lowercase the identifier and classify it. An "@" means treat it as an
// email; otherwise it is a username to resolve against the profiles table.
export function normalizeIdentifier(input) {
  const value = String(input ?? "").trim().toLowerCase();
  return { value, isEmail: value.includes("@") };
}

// Map a GoTrue signInWithPassword error to a client-safe message. Only
// "email_not_confirmed" is surfaced distinctly (it helps a legitimate user and
// leaks nothing an attacker can act on); every other failure — including an
// unknown account — collapses to the generic INVALID_CREDENTIALS.
export function mapSignInError(error) {
  if (!error) return null;
  if (error.code === "email_not_confirmed") {
    return "Your email is not confirmed. Please check your inbox and confirm your account.";
  }
  return INVALID_CREDENTIALS;
}

// login: sign in by EMAIL (email-only) and apply the reseller account-status
// gate. The client never reads the profiles table; there is no username→email
// resolution — login is email + password. GoTrue is already anti-enumeration for
// email login, so an unknown email is indistinguishable from a wrong password.
//
// verify_jwt = false (see supabase/config.toml) — the caller is not yet
// authenticated. Expected auth OUTCOMES return HTTP 200 with an { ok } body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { isActive } from "../_shared/accountStatus.js";
import { INVALID_CREDENTIALS, normalizeEmail, mapSignInError } from "../_shared/loginLogic.js";
import { clientIpFromHeaders, loginRateLimitKeys, RATE_LIMITED_MESSAGE } from "../_shared/loginRateLimit.js";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    // Accept { email } (new) or { usernameOrEmail } (legacy alias — treated
    // verbatim as the email) so a client/function deploy-order skew can't break login.
    const rawEmail = body.email ?? body.usernameOrEmail;
    const password = body.password;
    if (!rawEmail || !password) {
      return json({ ok: false, error: INVALID_CREDENTIALS });
    }
    const email = normalizeEmail(rawEmail);
    const admin = adminClient();

    // Brute-force throttle. The password check below runs server-side, so GoTrue
    // sees THIS function's egress IP, not the caller's — its per-IP limit can't
    // protect an account. Re-establish throttling here, keyed on the real client
    // IP AND the target email (the email key survives IP rotation). FAIL OPEN: a
    // limiter fault (e.g. RPC not yet deployed) must never take down login, so we
    // only block on an explicit `allowed === false`.
    const ip = clientIpFromHeaders(req.headers);
    for (const { key, max, windowSeconds } of loginRateLimitKeys(ip, email)) {
      try {
        const { data: allowed, error } = await admin.rpc("hit_login_rate_limit", {
          p_key: key,
          p_max: max,
          p_window_seconds: windowSeconds,
        });
        if (!error && allowed === false) {
          return json({ ok: false, error: RATE_LIMITED_MESSAGE });
        }
      } catch (_e) {
        // fail open
      }
    }

    // A fresh anon client (no Authorization header) runs the password check
    // against GoTrue. Never use the service-role key to sign in.
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: signIn, error: signInError } =
      await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      return json({ ok: false, error: mapSignInError(signInError) ?? INVALID_CREDENTIALS });
    }

    // Reseller gate: the password is correct, so the account provably exists —
    // safe to return a SPECIFIC status (no enumeration leak).
    const status = await loadAccountStatus(admin, signIn.session.user.id);
    if (!isActive(status)) {
      return json({ ok: false, error: status }); // ACCOUNT_EXPIRED | ACCOUNT_SUSPENDED | PROVIDER_SUSPENDED
    }

    return json({
      ok: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (_e) {
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
});

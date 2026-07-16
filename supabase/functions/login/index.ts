// login: resolve a username→email lookup with the service role and perform the
// password check server-side, so the client NEVER reads the profiles table
// directly. This is the last remaining direct client table read — removing it
// unblocks the anon/authenticated grant-revoke (supabase/sql/revoke_table_grants.sql).
//
// On success the caller receives session tokens and installs them with
// auth.setSession(); the email is never returned, and an unknown username is
// indistinguishable from a wrong password (anti-enumeration).
//
// verify_jwt = false (see supabase/config.toml) — the caller is not yet
// authenticated. Expected auth OUTCOMES return HTTP 200 with an { ok } body so
// supabase-js surfaces them as `data`; a non-2xx would arrive as an opaque
// FunctionsHttpError. Only genuine server faults use 5xx.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { isActive } from "../_shared/accountStatus.js";
import {
  INVALID_CREDENTIALS,
  normalizeIdentifier,
  mapSignInError,
} from "../_shared/loginLogic.js";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const { usernameOrEmail, password } = await req.json().catch(() => ({}));
    if (!usernameOrEmail || !password) {
      return json({ ok: false, error: INVALID_CREDENTIALS });
    }

    const { value, isEmail } = normalizeIdentifier(usernameOrEmail);
    let email = value;
    if (!isEmail) {
      // Service-role read — bypasses RLS and, crucially, survives the
      // anon/authenticated grant-revoke. This is the whole reason the lookup
      // moved server-side.
      const admin = adminClient();
      const { data, error } = await admin
        .from("profiles")
        .select("email")
        .eq("username", value)
        .maybeSingle();
      if (error) return json({ ok: false, error: "SERVER_ERROR" }, 500);
      // Unknown username → same generic error AND response shape as a bad
      // password, so the two cases can't be told apart.
      if (!data?.email) return json({ ok: false, error: INVALID_CREDENTIALS });
      email = data.email;
    }

    // A fresh anon client (no Authorization header) runs the actual password
    // check against GoTrue. Never use the service-role key to sign in.
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: signIn, error: signInError } =
      await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      return json({
        ok: false,
        error: mapSignInError(signInError) ?? INVALID_CREDENTIALS,
      });
    }
    // Reseller gate: the password is correct, so the account provably exists —
    // safe to return a SPECIFIC status (no enumeration leak).
    const status = await loadAccountStatus(adminClient(), signIn.session.user.id);
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

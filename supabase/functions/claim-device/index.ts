// claim-device: bind-or-verify against an admin-configurable device limit.
// Called after login, before any data loads. The count-then-insert decision is
// made race-safely inside the claim_device SQL function (per-account advisory
// lock); this handler just resolves the caller and the global default limit.
import { getUserId, adminClient, json, corsPreflight, assertAccountActive } from "../_shared/deviceGate.ts";

// Global default device count. Per-account overrides live in device_limits.
// Editable in the dashboard without a redeploy.
function defaultLimit(): number {
  const n = Number(Deno.env.get("DEVICE_LIMIT_DEFAULT") ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const { deviceId, platform, secondary, label } = await req.json();
    if (!deviceId) return json({ status: "denied" }, 403);
    const admin = adminClient();

    // Reseller gate: a suspended/expired account (or one under a suspended
    // provider) is denied the claim, routing the client to the locked screen.
    try {
      await assertAccountActive(admin, userId);
    } catch (e) {
      if ((e as Error).message === "SERVER_ERROR") return json({ error: "SERVER_ERROR" }, 500);
      return json({ status: "denied" }, 403);
    }

    const { data: status, error } = await admin.rpc("claim_device", {
      p_user_id: userId,
      p_device_id: deviceId,
      p_platform: platform ?? null,
      p_secondary: secondary ?? null,
      p_label: label ?? null,
      p_default_limit: defaultLimit(),
    });

    if (error) return json({ error: "SERVER_ERROR" }, 500);
    if (status === "denied") return json({ status: "denied" }, 403);

    // Provision the caller's entitlement on first claim. Idempotent:
    // ignoreDuplicates never overwrites an existing row, so a re-claim can't
    // reset/extend it, and grandfathered/pre-provisioned rows are left intact.
    //
    // Provider-provisioned customers (they have a customer_accounts row) get NO
    // entitlement expiry — their subscription TERM is governed by
    // customer_accounts / assertAccountActive (kept in sync by admin
    // accounts.update). The entitlements row exists only so the fail-closed
    // content gate passes and to carry the per-user revoked_at kill switch; do
    // NOT mirror the reseller term here (that would duplicate it and drift on
    // renewal, locking out paying customers).
    //
    // The 7-day trial window applies ONLY to self-signup accounts (no
    // customer_accounts row) — future work once signup/billing lands; today it
    // also bounds any stray account rather than granting access forever. Expiry
    // is stamped from the SERVER clock so a frozen client clock can't lengthen it.
    //
    // Best-effort: a failure here must NOT fail a claim whose device bind already
    // succeeded — the gate fails closed anyway and the next boot re-provisions.
    try {
      const { data: acct } = await admin
        .from("customer_accounts")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      const TRIAL_DAYS = 7;
      const entitlement = acct
        ? { user_id: userId, plan: "active", status: "active", expires_at: null }
        : {
            user_id: userId,
            plan: "trial",
            status: "active",
            trial_started_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
          };
      await admin
        .from("entitlements")
        .upsert(entitlement, { onConflict: "user_id", ignoreDuplicates: true });
    } catch (bootErr) {
      console.error("entitlement bootstrap failed (non-fatal):", (bootErr as Error).message);
    }

    return json({ status }); // "bound" | "ok"
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

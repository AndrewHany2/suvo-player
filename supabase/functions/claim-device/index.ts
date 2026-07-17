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

    // First successful claim bootstraps a server-computed trial window. Absent
    // rows only — ignoreDuplicates means a re-claim can never reset or extend an
    // existing trial (the anti-abuse point), and expiry is stamped from the
    // SERVER clock so a frozen client clock can't lengthen it. Existing users
    // were grandfathered by the entitlements migration, so this only mints a
    // trial for genuinely new accounts. Best-effort: a failure here must NOT
    // fail a claim whose device bind already succeeded — the entitlement gate
    // fails closed anyway, and the next boot's claim retries the bootstrap.
    const TRIAL_DAYS = 7;
    try {
      await admin.from("entitlements").upsert(
        {
          user_id: userId,
          plan: "trial",
          status: "active",
          trial_started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    } catch (bootErr) {
      console.error("trial bootstrap failed (non-fatal):", (bootErr as Error).message);
    }

    return json({ status }); // "bound" | "ok"
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

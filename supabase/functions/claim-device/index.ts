// claim-device: bind-or-verify against an admin-configurable device limit.
// Called after login, before any data loads. The count-then-insert decision is
// made race-safely inside the claim_device SQL function (per-account advisory
// lock); this handler just resolves the caller and the global default limit.
import { getUserId, adminClient, json, corsPreflight } from "../_shared/deviceGate.ts";

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
    return json({ status }); // "bound" | "ok"
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

// claim-device: atomic bind-or-verify. Called after login, before any data
// loads. Binds on first login; refuses any other device thereafter.
import { getUserId, adminClient, json, corsPreflight } from "../_shared/deviceGate.ts";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const { deviceId, platform, secondary, label } = await req.json();
    if (!deviceId) return json({ status: "denied" }, 403);
    const admin = adminClient();

    // Atomic bind-or-nothing: only the first login inserts a row.
    const { data: inserted } = await admin
      .from("device_bindings")
      .upsert(
        {
          user_id: userId,
          device_id: deviceId,
          platform,
          secondary_fp: secondary ?? null,
          label: label ?? null,
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      )
      .select("device_id")
      .maybeSingle();

    if (inserted) return json({ status: "bound" });

    const { data: existing } = await admin
      .from("device_bindings")
      .select("device_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing && existing.device_id === deviceId) return json({ status: "ok" });
    return json({ status: "denied" }, 403);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

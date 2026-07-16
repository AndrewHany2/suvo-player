// admin: reseller management router. Verifies the JWT, loads the caller's
// providers row (must exist and not be suspended), enforces role/scope/quota via
// the pure adminLogic module, then performs writes with the service role.
// verify_jwt defaults to true (config.toml) — only authenticated callers reach here.
import { getUserId, adminClient, json, corsPreflight } from "../_shared/deviceGate.ts";
import {
  canInvoke,
  canActOnAccount,
  withinQuota,
  validateNewAccount,
  providerSlug,
  resolveEmail,
  ROLE_SUPER_ADMIN,
} from "../_shared/adminLogic.js";

type Admin = ReturnType<typeof adminClient>;

async function audit(admin: Admin, actorId: string, action: string, target: string | null, meta: unknown) {
  await admin.from("admin_audit").insert({ actor_id: actorId, action, target, meta: meta ?? null });
}

// Load the caller's providers row → the `caller` shape adminLogic expects.
async function loadCaller(admin: Admin, userId: string) {
  const { data } = await admin
    .from("providers")
    .select("user_id, role, name, max_accounts, suspended")
    .eq("user_id", userId)
    .maybeSingle();
  return data; // null if not a provider/super-admin
}

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const admin = adminClient();
    const row = await loadCaller(admin, userId);
    const caller = row
      ? { userId: row.user_id, role: row.role, suspended: row.suspended }
      : null;

    const { action, payload = {} } = await req.json();
    if (!canInvoke(caller, action)) return json({ error: "FORBIDDEN" }, 403);

    switch (action) {
      case "me": {
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", userId);
        return json({
          role: row.role,
          name: row.name,
          quota: { used: count ?? 0, max: row.max_accounts },
        });
      }
      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

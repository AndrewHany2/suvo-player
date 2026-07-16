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
      case "providers.list": {
        const { data } = await admin
          .from("providers")
          .select("user_id, role, name, max_accounts, suspended, created_at")
          .order("created_at", { ascending: true });
        // annotate each with its live account count
        const out = [];
        for (const p of data ?? []) {
          const { count } = await admin
            .from("customer_accounts")
            .select("user_id", { count: "exact", head: true })
            .eq("provider_id", p.user_id);
          out.push({ ...p, accounts_used: count ?? 0 });
        }
        return json(out);
      }

      case "providers.create": {
        const email = String(payload.email ?? "").trim().toLowerCase();
        const password = String(payload.password ?? "");
        const name = String(payload.name ?? "").trim();
        const maxAccounts = Number(payload.maxAccounts);
        if (!email.includes("@") || password.length < 6 || !name || !Number.isInteger(maxAccounts) || maxAccounts < 0) {
          return json({ error: "INVALID_INPUT" }, 400);
        }
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (cErr || !created.user) return json({ error: "CREATE_FAILED" }, 400);
        const { error: pErr } = await admin.from("providers").insert({
          user_id: created.user.id,
          role: "provider",
          name,
          max_accounts: maxAccounts,
        });
        if (pErr) {
          await admin.auth.admin.deleteUser(created.user.id); // rollback
          return json({ error: "CREATE_FAILED" }, 400);
        }
        await audit(admin, userId, "provider.create", created.user.id, { name, maxAccounts });
        return json({ userId: created.user.id });
      }

      case "providers.update": {
        const target = String(payload.userId ?? "");
        const patch: Record<string, unknown> = {};
        if (payload.name != null) patch.name = String(payload.name).trim();
        if (payload.maxAccounts != null) {
          const m = Number(payload.maxAccounts);
          if (!Number.isInteger(m) || m < 0) return json({ error: "INVALID_INPUT" }, 400);
          patch.max_accounts = m;
        }
        if (payload.suspended != null) patch.suspended = !!payload.suspended;
        if (!target || Object.keys(patch).length === 0) return json({ error: "INVALID_INPUT" }, 400);
        await admin.from("providers").update(patch).eq("user_id", target).eq("role", "provider");
        await audit(admin, userId, "provider.update", target, patch);
        return json({ ok: true });
      }

      case "providers.delete": {
        const target = String(payload.userId ?? "");
        if (!target) return json({ error: "INVALID_INPUT" }, 400);
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", target);
        if ((count ?? 0) > 0) return json({ error: "PROVIDER_HAS_ACCOUNTS" }, 409);
        // Delete the auth user; the providers row is removed by the FK
        // `on delete cascade` (migration 20260716000002). One error-checked op
        // — no window where a login outlives its providers row (which would
        // otherwise leave an orphaned, ungated customer-app login on a failure).
        const { error: delErr } = await admin.auth.admin.deleteUser(target);
        if (delErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "provider.delete", target, null);
        return json({ ok: true });
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

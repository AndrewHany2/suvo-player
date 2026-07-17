// admin: reseller management router. Verifies the JWT, loads the caller's
// providers row (must exist and not be suspended), enforces role/scope/quota via
// the pure adminLogic module, then performs writes with the service role.
// verify_jwt defaults to true (config.toml) — only authenticated callers reach here.
import { getUserId, adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { scrubAuditMeta } from "../_shared/auditMeta.js";
import {
  canInvoke,
  canActOnAccount,
  withinQuota,
  validateNewAccount,
  validateLine,
  providerSlug,
  resolveEmail,
  ROLE_SUPER_ADMIN,
} from "../_shared/adminLogic.js";

type Admin = ReturnType<typeof adminClient>;

async function audit(admin: Admin, actorId: string, action: string, target: string | null, meta: unknown) {
  // scrubAuditMeta strips any password/token/credential key defensively, so a
  // future call site mistake can never leak a secret into admin_audit.
  await admin.from("admin_audit").insert({ actor_id: actorId, action, target, meta: scrubAuditMeta(meta) ?? null });
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

// Resolve the provider a given target account belongs to (for the isolation check).
async function accountProviderId(admin: Admin, targetUserId: string): Promise<string | null | undefined> {
  const { data } = await admin
    .from("customer_accounts")
    .select("provider_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  return data ? data.provider_id : undefined; // undefined = no such account
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
        if (payload.suspended != null) patch.suspended = payload.suspended === true;
        if (!target || Object.keys(patch).length === 0) return json({ error: "INVALID_INPUT" }, 400);
        await admin.from("providers").update(patch).eq("user_id", target).eq("role", "provider");
        await audit(admin, userId, "provider.update", target, patch);
        return json({ ok: true });
      }

      case "providers.delete": {
        const target = String(payload.userId ?? "");
        if (!target) return json({ error: "INVALID_INPUT" }, 400);
        if (target === userId) return json({ error: "CANNOT_DELETE_SELF" }, 400);
        // Only providers are deletable here: a super-admin's row has zero
        // customer_accounts, so the count guard below would otherwise let this
        // action delete a super-admin (or another super_admin) auth account.
        const { data: targetRow, error: tErr } = await admin
          .from("providers").select("role").eq("user_id", target).maybeSingle();
        if (tErr) return json({ error: "SERVER_ERROR" }, 500);
        if (!targetRow || targetRow.role !== "provider") return json({ error: "NOT_A_PROVIDER" }, 400);
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

      case "accounts.create": {
        const v = validateNewAccount(payload);
        if (!v.ok) return json({ error: "INVALID_INPUT", fields: v.errors }, 400);

        // Quota (super-admin exempt). used = ALL of the provider's accounts.
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", userId);
        if (!withinQuota(count ?? 0, row.max_accounts, row.role)) {
          return json({ error: "QUOTA_EXCEEDED" }, 409);
        }

        const slug = providerSlug(row.name, userId);
        const genToken = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
        const suppliedEmail = String(payload.email ?? "").trim().toLowerCase();

        // 1. auth user. Auto-generated emails can (astronomically rarely) collide;
        // retry once with a fresh token. A provider-supplied email does not retry
        // (a real dup should surface as CREATE_FAILED).
        let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | null = null;
        let email = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          email = resolveEmail(slug, suppliedEmail, genToken());
          const res = await admin.auth.admin.createUser({
            email,
            password: v.value.password,
            email_confirm: true,
            user_metadata: { name: v.value.name },
          });
          if (!res.error && res.data.user) { created = res.data; break; }
          if (suppliedEmail.includes("@")) break; // don't retry a real supplied email
        }
        if (!created?.user) return json({ error: "CREATE_FAILED" }, 400);
        const newId = created.user.id;

        // supabase-js returns errors as VALUES (it does not throw), so each
        // write must be error-checked explicitly. On ANY failure we delete the
        // just-created auth user before returning — otherwise we'd leave an
        // ungated ACTIVE orphan login with no customer_accounts row. A try/catch
        // backstop also deletes the user for network-level exceptions.
        try {
          // 2. profiles (holds the display NAME in the legacy `username` column + email)
          const { error: profErr } = await admin.from("profiles").upsert(
            { user_id: newId, username: v.value.name, email },
            { onConflict: "user_id" },
          );
          if (profErr) throw profErr;
          // 3. default app_profile
          const { data: prof, error: apErr } = await admin
            .from("app_profiles")
            .insert({ user_id: newId, name: "Default", avatar: "👤" })
            .select("id")
            .single();
          if (apErr || !prof) throw apErr ?? new Error("app_profile insert returned no row");
          // 4. iptv line under that profile
          const { error: lineErr } = await admin.from("iptv_accounts").insert({
            user_id: newId,
            profile_id: prof.id,
            type: v.value.line.type,
            nickname: v.value.line.nickname,
            host: v.value.line.host,
            username: v.value.line.username,
            password: v.value.line.password,
            url: v.value.line.url,
          });
          if (lineErr) throw lineErr;
          // 5. device limit
          const { error: dlErr } = await admin.from("device_limits").upsert(
            { user_id: newId, device_limit: v.value.deviceLimit },
            { onConflict: "user_id" },
          );
          if (dlErr) throw dlErr;
          // 6. subscription record
          const { error: caErr } = await admin.from("customer_accounts").insert({
            user_id: newId,
            origin: "provider",
            provider_id: userId,
            expires_at: v.value.expiresAt,
            note: payload.note ? String(payload.note) : null,
          });
          if (caErr) throw caErr;
        } catch (_e) {
          const { error: rbErr } = await admin.auth.admin.deleteUser(newId); // atomic: undo on any failure
          if (rbErr) {
            console.error(
              `admin.accounts.create rollback FAILED — orphaned auth user ${newId} needs manual deletion`,
              rbErr,
            );
          }
          return json({ error: "CREATE_FAILED" }, 400);
        }

        // meta MUST NOT include the password or line credentials
        await audit(admin, userId, "account.create", newId, {
          name: v.value.name,
          deviceLimit: v.value.deviceLimit,
          expiresAt: v.value.expiresAt,
          lineType: v.value.line.type,
        });
        return json({ userId: newId });
      }

      case "accounts.list": {
        const search = String(payload.search ?? "").trim().toLowerCase();
        // Provider sees only their own; super-admin may pass providerId to scope.
        let q = admin
          .from("customer_accounts")
          .select("user_id, provider_id, expires_at, suspended, created_at, note")
          .order("created_at", { ascending: false });
        if (row.role === ROLE_SUPER_ADMIN) {
          if (payload.providerId) q = q.eq("provider_id", String(payload.providerId));
        } else {
          q = q.eq("provider_id", userId);
        }
        const { data: accts } = await q;

        const out = [];
        for (const a of accts ?? []) {
          const { data: prof } = await admin
            .from("profiles").select("username").eq("user_id", a.user_id).maybeSingle();
          const name = prof?.username ?? "";
          if (search && !name.toLowerCase().includes(search)) continue;
          const { count: devicesUsed } = await admin
            .from("device_bindings")
            .select("device_id", { count: "exact", head: true })
            .eq("user_id", a.user_id);
          const { data: lim } = await admin
            .from("device_limits").select("device_limit").eq("user_id", a.user_id).maybeSingle();
          const status = await loadAccountStatus(admin, a.user_id);
          out.push({
            userId: a.user_id,
            name,
            status,
            expiresAt: a.expires_at,
            suspended: a.suspended,
            devicesUsed: devicesUsed ?? 0,
            deviceLimit: lim?.device_limit ?? null,
            note: a.note,
          });
        }
        return json(out);
      }

      case "accounts.get": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const { data: prof } = await admin
          .from("profiles").select("username, email").eq("user_id", target).maybeSingle();
        const { data: acct } = await admin
          .from("customer_accounts")
          .select("provider_id, expires_at, suspended, note, origin")
          .eq("user_id", target).maybeSingle();
        const { data: lim } = await admin
          .from("device_limits").select("device_limit").eq("user_id", target).maybeSingle();
        const { data: line } = await admin
          .from("iptv_accounts")
          .select("id, type, nickname, host, username, url")
          .eq("user_id", target).order("created_at", { ascending: true }).limit(1).maybeSingle();
        const status = await loadAccountStatus(admin, target);
        return json({
          userId: target,
          name: prof?.username ?? "",
          email: prof?.email ?? "",
          status,
          expiresAt: acct?.expires_at ?? null,
          suspended: acct?.suspended ?? false,
          note: acct?.note ?? null,
          deviceLimit: lim?.device_limit ?? null,
          line: line ?? null, // password intentionally omitted from reads
        });
      }

      case "accounts.update": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);

        // Validate ALL inputs before any write, so an invalid deviceLimit can't
        // leave a partial expires_at/suspended/note update behind.
        const acctPatch: Record<string, unknown> = {};
        if (payload.expiresAt !== undefined) {
          if (payload.expiresAt === null || payload.expiresAt === "") acctPatch.expires_at = null;
          else {
            const t = Date.parse(payload.expiresAt);
            if (!Number.isFinite(t)) return json({ error: "INVALID_INPUT" }, 400);
            acctPatch.expires_at = new Date(t).toISOString();
          }
        }
        if (payload.suspended !== undefined) acctPatch.suspended = payload.suspended === true;
        if (payload.note !== undefined) acctPatch.note = payload.note ? String(payload.note) : null;
        let dl: number | undefined;
        if (payload.deviceLimit !== undefined) {
          dl = Number(payload.deviceLimit);
          if (!Number.isInteger(dl) || dl < 1) return json({ error: "INVALID_INPUT" }, 400);
        }
        // name (display label) → stored in the legacy profiles.username column
        if (payload.name !== undefined) {
          const nm = String(payload.name).trim();
          if (nm.length < 1 || nm.length > 60) return json({ error: "INVALID_INPUT" }, 400);
          const { error: nErr } = await admin.from("profiles").update({ username: nm }).eq("user_id", target);
          if (nErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        if (Object.keys(acctPatch).length > 0) {
          const { error: uErr } = await admin.from("customer_accounts").update(acctPatch).eq("user_id", target);
          if (uErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        if (dl !== undefined) {
          const { error: dErr } = await admin.from("device_limits").upsert({ user_id: target, device_limit: dl }, { onConflict: "user_id" });
          if (dErr) return json({ error: "SERVER_ERROR" }, 500);
        }
        await audit(admin, userId, "account.update", target, { ...acctPatch, name: payload.name, deviceLimit: payload.deviceLimit });
        return json({ ok: true });
      }

      case "accounts.setPassword": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const password = String(payload.password ?? "");
        if (password.length < 6) return json({ error: "INVALID_INPUT" }, 400);
        const { error } = await admin.auth.admin.updateUserById(target, { password });
        if (error) return json({ error: "UPDATE_FAILED" }, 400);
        await audit(admin, userId, "account.setPassword", target, null); // never log the password
        return json({ ok: true });
      }

      case "accounts.updateLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const line = validateLine(payload.line);
        if (!line.ok) return json({ error: "INVALID_INPUT", fields: ["line"] }, 400);
        const { data: existing } = await admin
          .from("iptv_accounts").select("id").eq("user_id", target)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        const fields = {
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        };
        if (existing?.id) {
          await admin.from("iptv_accounts").update(fields).eq("id", existing.id).eq("user_id", target);
        } else {
          const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
          await admin.from("iptv_accounts").insert({ user_id: target, profile_id: prof?.id ?? null, ...fields });
        }
        await audit(admin, userId, "account.updateLine", target, { lineType: line.value.type }); // no creds
        return json({ ok: true });
      }

      case "accounts.delete": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        // Delete the auth user; cascades customer_accounts, device_bindings, etc.
        // Error-checked so we never audit/return ok on a failed delete.
        const { error: delErr } = await admin.auth.admin.deleteUser(target);
        if (delErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "account.delete", target, null);
        return json({ ok: true });
      }

      case "devices.list": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const { data } = await admin
          .from("device_bindings")
          .select("device_id, platform, label, bound_at, last_seen_at, revoked_at")
          .eq("user_id", target)
          .order("last_seen_at", { ascending: false, nullsFirst: false });
        return json(data ?? []);
      }

      case "devices.revoke":
      case "devices.unrevoke": {
        const target = String(payload.userId ?? "");
        const deviceId = String(payload.deviceId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner) || !deviceId) return json({ error: "FORBIDDEN" }, 403);
        const revoked_at = action === "devices.revoke" ? new Date().toISOString() : null;
        await admin.from("device_bindings").update({ revoked_at })
          .eq("user_id", target).eq("device_id", deviceId);
        await audit(admin, userId, action, target, { deviceId });
        return json({ ok: true });
      }

      case "devices.remove": {
        const target = String(payload.userId ?? "");
        const deviceId = String(payload.deviceId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner) || !deviceId) return json({ error: "FORBIDDEN" }, 403);
        await admin.from("device_bindings").delete().eq("user_id", target).eq("device_id", deviceId);
        await audit(admin, userId, "devices.remove", target, { deviceId });
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

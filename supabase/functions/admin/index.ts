// admin: reseller management router. Verifies the JWT, loads the caller's
// providers row (must exist and not be suspended), enforces role/scope/quota via
// the pure adminLogic module, then performs writes with the service role.
// verify_jwt defaults to true (config.toml) — only authenticated callers reach here.
import { getUserId, adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { scrubAuditMeta } from "../_shared/auditMeta.js";
import { accountStatus } from "../_shared/accountStatus.js";
import { chunk } from "../_shared/chunk.js";
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

// Batched `.in("user_id", …)` select, chunked to keep the id list under
// practical request-URL length limits. Returns the concatenated rows. Lets the
// list actions do a CONSTANT number of queries instead of one-per-account.
async function selectByUserIds(admin: Admin, table: string, columns: string, ids: string[]) {
  const out: any[] = [];
  for (const part of chunk(ids, 150)) {
    const { data } = await admin.from(table).select(columns).in("user_id", part);
    if (data) out.push(...data);
  }
  return out;
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
        // One grouped read for every provider's live account count (was an
        // N+1 count-per-provider loop). If the RPC isn't deployed yet, counts
        // fall back to 0 rather than failing the whole list.
        const { data: counts } = await admin.rpc("provider_account_counts");
        const usedBy = new Map<string, number>(
          (counts ?? []).map((c: any) => [c.provider_id, Number(c.cnt)]),
        );
        const out = (data ?? []).map((p: any) => ({ ...p, accounts_used: usedBy.get(p.user_id) ?? 0 }));
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
          // 2. profiles (holds the display NAME in the `name` column + email)
          const { error: profErr } = await admin.from("profiles").upsert(
            { user_id: newId, name: v.value.name, email },
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
          // 4. iptv line(s) under that profile
          for (const ln of v.value.lines) {
            const { error: lineErr } = await admin.from("iptv_accounts").insert({
              user_id: newId,
              profile_id: prof.id,
              type: ln.type,
              nickname: ln.nickname,
              host: ln.host,
              username: ln.username,
              password: ln.password,
              url: ln.url,
            });
            if (lineErr) throw lineErr;
          }
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
            allow_self_lines: v.value.allowSelfLines,
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
          lineCount: v.value.lines.length,
          allowSelfLines: v.value.allowSelfLines,
        });
        // Return the resolved login email too: when the provider left it blank
        // it was auto-generated (acc-<token>@<slug>.accounts.local) and the
        // client shows it so they can hand it to the customer to sign in.
        return json({ userId: newId, email });
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
        // Optional server-side pagination (client may pass limit/offset). Default
        // is unchanged (all rows) — but the N+1 that previously made this O(5N)
        // SERIAL round-trips is gone regardless: the per-account lookups below
        // are batched into a CONSTANT number of `.in(...)` queries.
        const limit = Number(payload.limit);
        if (Number.isInteger(limit) && limit > 0) {
          const off = Number(payload.offset);
          const offset = Number.isInteger(off) && off > 0 ? off : 0;
          q = q.range(offset, offset + Math.min(limit, 500) - 1);
        }
        const { data: acctsRaw } = await q;
        let accts = acctsRaw ?? [];

        // Names first, so the search filter runs BEFORE the remaining lookups
        // (only fetch device/limit rows for accounts we'll actually return).
        const nameById = new Map<string, string>(
          (await selectByUserIds(admin, "profiles", "user_id, name", accts.map((a: any) => a.user_id)))
            .map((p) => [p.user_id, p.name ?? ""]),
        );
        if (search) {
          accts = accts.filter((a: any) => (nameById.get(a.user_id) ?? "").toLowerCase().includes(search));
        }

        const keptIds = accts.map((a: any) => a.user_id);
        const bindings = await selectByUserIds(admin, "device_bindings", "user_id", keptIds);
        const deviceCount = new Map<string, number>();
        for (const b of bindings) deviceCount.set(b.user_id, (deviceCount.get(b.user_id) ?? 0) + 1);
        const limitById = new Map<string, number>(
          (await selectByUserIds(admin, "device_limits", "user_id, device_limit", keptIds))
            .map((l) => [l.user_id, l.device_limit]),
        );
        const providerIds = [...new Set(accts.map((a: any) => a.provider_id).filter(Boolean))] as string[];
        const provRows = providerIds.length
          ? (await admin.from("providers").select("user_id, suspended, name").in("user_id", providerIds)).data ?? []
          : [];
        const provSuspended = new Map<string, boolean>(provRows.map((p: any) => [p.user_id, !!p.suspended]));
        const provNameById = new Map<string, string>(provRows.map((p: any) => [p.user_id, p.name ?? ""]));

        const now = Date.now();
        const out = accts.map((a: any) => ({
          userId: a.user_id,
          name: nameById.get(a.user_id) ?? "",
          status: accountStatus(
            { suspended: a.suspended, expires_at: a.expires_at },
            a.provider_id ? (provSuspended.get(a.provider_id) ?? false) : false,
            now,
          ),
          expiresAt: a.expires_at,
          suspended: a.suspended,
          devicesUsed: deviceCount.get(a.user_id) ?? 0,
          deviceLimit: limitById.get(a.user_id) ?? null,
          note: a.note,
          providerId: a.provider_id ?? null,
          providerName: a.provider_id ? (provNameById.get(a.provider_id) ?? null) : null,
        }));
        return json(out);
      }

      case "accounts.get": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const { data: prof } = await admin
          .from("profiles").select("name, email").eq("user_id", target).maybeSingle();
        const { data: acct } = await admin
          .from("customer_accounts")
          .select("provider_id, expires_at, suspended, note, origin, allow_self_lines")
          .eq("user_id", target).maybeSingle();
        const { data: lim } = await admin
          .from("device_limits").select("device_limit").eq("user_id", target).maybeSingle();
        const { data: lines } = await admin
          .from("iptv_accounts")
          .select("id, type, nickname, host, username, url")
          .eq("user_id", target).order("created_at", { ascending: true });
        const status = await loadAccountStatus(admin, target);
        return json({
          userId: target,
          name: prof?.name ?? "",
          email: prof?.email ?? "",
          status,
          expiresAt: acct?.expires_at ?? null,
          suspended: acct?.suspended ?? false,
          note: acct?.note ?? null,
          deviceLimit: lim?.device_limit ?? null,
          allowSelfLines: acct?.allow_self_lines ?? false,
          lines: lines ?? [], // passwords intentionally omitted from reads
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
        if (payload.allowSelfLines !== undefined) acctPatch.allow_self_lines = payload.allowSelfLines === true;
        if (payload.note !== undefined) acctPatch.note = payload.note ? String(payload.note) : null;
        let dl: number | undefined;
        if (payload.deviceLimit !== undefined) {
          dl = Number(payload.deviceLimit);
          if (!Number.isInteger(dl) || dl < 1) return json({ error: "INVALID_INPUT" }, 400);
        }
        // name (display label) → stored in the profiles.name column
        if (payload.name !== undefined) {
          const nm = String(payload.name).trim();
          if (nm.length < 1 || nm.length > 60) return json({ error: "INVALID_INPUT" }, 400);
          const { error: nErr } = await admin.from("profiles").update({ name: nm }).eq("user_id", target);
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
        const fields = {
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        };
        const lineId = String(payload.lineId ?? "");
        if (lineId) {
          const { error: uErr } = await admin.from("iptv_accounts").update(fields).eq("id", lineId).eq("user_id", target);
          if (uErr) return json({ error: "SERVER_ERROR" }, 500);
        } else {
          const { data: existing } = await admin
            .from("iptv_accounts").select("id").eq("user_id", target)
            .order("created_at", { ascending: true }).limit(1).maybeSingle();
          if (existing?.id) {
            await admin.from("iptv_accounts").update(fields).eq("id", existing.id).eq("user_id", target);
          } else {
            const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
            await admin.from("iptv_accounts").insert({ user_id: target, profile_id: prof?.id ?? null, ...fields });
          }
        }
        await audit(admin, userId, "account.updateLine", target, { lineType: line.value.type }); // no creds
        return json({ ok: true });
      }

      case "accounts.addLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const line = validateLine(payload.line);
        if (!line.ok) return json({ error: "INVALID_INPUT", fields: ["line"] }, 400);
        const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
        const { error: insErr } = await admin.from("iptv_accounts").insert({
          user_id: target, profile_id: prof?.id ?? null,
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        });
        if (insErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "account.addLine", target, { lineType: line.value.type }); // no creds
        return json({ ok: true });
      }

      case "accounts.deleteLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const lineId = String(payload.lineId ?? "");
        if (!lineId) return json({ error: "INVALID_INPUT", fields: ["lineId"] }, 400);
        const { error: delErr } = await admin.from("iptv_accounts").delete().eq("id", lineId).eq("user_id", target);
        if (delErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "account.deleteLine", target, null);
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

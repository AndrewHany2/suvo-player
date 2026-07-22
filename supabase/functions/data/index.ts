// data: single device-gated action router for all table access. Verifies the
// JWT and the bound device, then performs the op with the service role.
import {
  getUserId,
  adminClient,
  assertBoundDevice,
  assertAccountActive,
  assertOwnsUserKey,
  assertOwnsProfile,
  assertEntitled,
  entitlementSnapshot,
  loadSelfLinesAllowed,
  json,
  corsPreflight,
  ACCOUNT_SUSPENDED,
  ACCOUNT_EXPIRED,
  PROVIDER_SUSPENDED,
  NOT_ENTITLED,
} from "../_shared/deviceGate.ts";
import { validateEntry } from "../_shared/entryLimits.js";

const MAX_HISTORY = 20;

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const admin = adminClient();
    await assertBoundDevice(admin, userId, req.headers.get("x-device-id") ?? "");
    await assertAccountActive(admin, userId);
    const { action, payload = {} } = await req.json();

    // Entitlement snapshot for the client UX. Allowed even when NOT entitled,
    // so an expired user can still fetch the reason to render the expired panel.
    // Exposes only the caller's own verdict.
    if (action === "entitlement.fetch") {
      return json(await entitlementSnapshot(admin, userId));
    }
    // The real demo/trial + license boundary: every content action requires an
    // active entitlement, judged on the SERVER clock. Fails closed regardless of
    // a patched client or frozen clock. See _shared/entitlement.js.
    // Known ceiling (accepted 2026-07-18): this gates metadata + IPTV credential
    // delivery, not the stream itself — a client with already-cached credentials
    // streams direct from the third-party IPTV provider, so revocation/expiry
    // bites on the next credential re-fetch, not mid-playback. Suvo does not proxy
    // the stream bytes, so this is inherent, not a bug to fix here.
    await assertEntitled(admin, userId);

    const db = admin.from.bind(admin);

    switch (action) {
      case "profiles.fetch": {
        const { data } = await db("profiles")
          .select("name, email")
          .eq("user_id", userId)
          .maybeSingle();
        // Keep a `username` alias for already-installed app clients that still
        // read profile.username; new clients read profile.name.
        return json(data ? { name: data.name, username: data.name, email: data.email } : null);
      }
      case "profiles.upsert": {
        // Accept `name` (new) or `username` (legacy client alias) → profiles.name.
        const name = String(payload.name ?? payload.username ?? "").trim();
        if (name.length < 1 || name.length > 60) return json({ error: "INVALID_INPUT" }, 400);
        // profiles.email is display-only now (login uses the GoTrue email). Only
        // write it when a well-formed value is supplied, and never null an
        // existing value — so a client can't corrupt the reseller's login-email view.
        const patch: Record<string, unknown> = { user_id: userId, name };
        if (payload.email != null && payload.email !== "") {
          const email = String(payload.email).trim().toLowerCase();
          if (!email.includes("@")) return json({ error: "INVALID_INPUT" }, 400);
          patch.email = email;
        }
        const { error } = await db("profiles").upsert(patch, { onConflict: "user_id" });
        if (error) return json({ error: "SERVER_ERROR" }, 500);
        return json({ ok: true });
      }
      case "appProfiles.list": {
        const { data } = await db("app_profiles")
          .select("id, name, avatar, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true });
        return json(data ?? []);
      }
      case "appProfiles.insert": {
        const { data } = await db("app_profiles")
          .insert({ user_id: userId, name: payload.name, avatar: payload.avatar ?? "👤" })
          .select()
          .single();
        return json(data);
      }
      case "appProfiles.update": {
        await db("app_profiles")
          .update({ name: payload.name, avatar: payload.avatar })
          .eq("id", payload.id)
          .eq("user_id", userId);
        return json({ ok: true });
      }
      case "appProfiles.delete": {
        await db("app_profiles").delete().eq("id", payload.id).eq("user_id", userId);
        return json({ ok: true });
      }
      case "iptv.list": {
        const { data } = await db("iptv_accounts")
          .select("*")
          .eq("user_id", userId)
          .eq("profile_id", payload.profileId)
          .order("created_at", { ascending: true });
        return json(
          (data ?? []).map((r: any) => ({
            id: r.id,
            type: r.type || "xtream",
            nickname: r.nickname || "",
            host: r.host,
            username: r.username,
            password: r.password,
            url: r.url || "",
          })),
        );
      }
      case "iptv.insert": {
        await assertOwnsProfile(admin, userId, payload.profileId);
        // Per-customer self-add gate. A provider can lock a customer to the
        // lines they were given (allow_self_lines=false). No customer_accounts
        // row (legacy / pre-adoption self-signup) is allowed — the first
        // self-add is what triggers adoption below. Server-authoritative: the
        // app also hides the button, but a patched client hitting this path
        // still gets the 403.
        if (!(await loadSelfLinesAllowed(admin, userId))) {
          return json({ error: "SELF_ADD_DISABLED" }, 403);
        }
        const { data } = await db("iptv_accounts")
          .insert({
            user_id: userId,
            profile_id: payload.profileId,
            type: payload.type || "xtream",
            nickname: payload.nickname || null,
            host: payload.host || null,
            username: payload.username || null,
            password: payload.password || null,
            url: payload.url || null,
          })
          .select("id")
          .single();
        // Best-effort: adopt a self-signup customer into the reseller dashboard
        // (active, no-expiry customer_accounts row + entitlement reconcile).
        // Non-fatal — the line is already saved; a failure here only delays
        // dashboard visibility. Mirrors claim-device's non-fatal bootstrap.
        const { error: adoptErr } = await admin.rpc("adopt_self_signup_account", {
          p_user_id: userId,
        });
        if (adoptErr) {
          console.error("self-signup adoption failed (non-fatal):", adoptErr.message);
        }
        return json({ id: data?.id ?? null });
      }
      case "iptv.update": {
        await db("iptv_accounts")
          .update({
            type: payload.type || "xtream",
            nickname: payload.nickname || null,
            host: payload.host || null,
            username: payload.username || null,
            password: payload.password || null,
            url: payload.url || null,
          })
          .eq("id", payload.id)
          .eq("user_id", userId);
        return json({ ok: true });
      }
      case "iptv.delete": {
        await db("iptv_accounts").delete().eq("id", payload.id).eq("user_id", userId);
        return json({ ok: true });
      }
      case "history.fetch": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        const { data } = await db("watch_history")
          .select("entry")
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .order("watched_at", { ascending: false })
          .limit(MAX_HISTORY);
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "history.upsert": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        if (!validateEntry(payload.entry).ok) return json({ error: "INVALID_INPUT" }, 400);
        await db("watch_history").upsert(
          {
            user_key: payload.userKey,
            account_key: payload.accountKey ?? "",
            entry_id: payload.entry.id,
            entry: payload.entry,
            watched_at: payload.entry.watchedAt,
          },
          { onConflict: "user_key,account_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "history.delete": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("watch_history")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
      case "favorites.fetch": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        const { data } = await db("favorites")
          .select("entry")
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .order("added_at", { ascending: false });
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "favorites.upsert": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        if (!validateEntry(payload.entry).ok) return json({ error: "INVALID_INPUT" }, 400);
        await db("favorites").upsert(
          {
            user_key: payload.userKey,
            account_key: payload.accountKey ?? "",
            entry_id: payload.entry.id,
            entry: payload.entry,
            added_at: payload.entry.addedAt,
          },
          { onConflict: "user_key,account_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "favorites.delete": {
        await assertOwnsUserKey(admin, userId, payload.userKey);
        await db("favorites")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("account_key", payload.accountKey ?? "")
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
      // ─── Batched reads ───────────────────────────────────────────────────
      // Both actions below sit AFTER the full request preamble
      // (assertBoundDevice → assertAccountActive → assertEntitled), exactly like
      // the individual actions they replace. A suspended / expired / unentitled
      // caller is denied at the preamble and never reaches this code, so batching
      // reduces round-trips WITHOUT relaxing the gate. Note: entitlement.fetch is
      // deliberately NOT folded in here — it must stay a separate action allowed
      // past assertEntitled so a trial-expired user can still read their reason.
      case "bootstrap.fetch": {
        // Cold-start identity load: profiles.fetch + appProfiles.list in one call.
        const [profileRes, appProfilesRes] = await Promise.all([
          db("profiles").select("name, email").eq("user_id", userId).maybeSingle(),
          db("app_profiles")
            .select("id, name, avatar, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: true }),
        ]);
        const p = profileRes.data;
        return json({
          // Keep the `username` alias for older clients (see profiles.fetch).
          profile: p ? { name: p.name, username: p.name, email: p.email } : null,
          appProfiles: appProfilesRes.data ?? [],
        });
      }
      case "library.fetch": {
        // Per-account library load: history.fetch + favorites.fetch in one call.
        // Same ownership check as the individual actions.
        await assertOwnsUserKey(admin, userId, payload.userKey);
        const accountKey = payload.accountKey ?? "";
        const [historyRes, favoritesRes] = await Promise.all([
          db("watch_history")
            .select("entry")
            .eq("user_key", payload.userKey)
            .eq("account_key", accountKey)
            .order("watched_at", { ascending: false })
            .limit(MAX_HISTORY),
          db("favorites")
            .select("entry")
            .eq("user_key", payload.userKey)
            .eq("account_key", accountKey)
            .order("added_at", { ascending: false }),
        ]);
        return json({
          history: (historyRes.data ?? []).map((r: any) => r.entry),
          favorites: (favoritesRes.data ?? []).map((r: any) => r.entry),
        });
      }
      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    if (msg === "DEVICE_MISMATCH") return json({ error: "DEVICE_MISMATCH" }, 403);
    if (msg === ACCOUNT_SUSPENDED || msg === ACCOUNT_EXPIRED || msg === PROVIDER_SUSPENDED) {
      return json({ error: "ACCOUNT_INACTIVE", reason: msg }, 403);
    }
    if (msg === NOT_ENTITLED) {
      return json({ error: NOT_ENTITLED, reason: (e as { reason?: string }).reason }, 403);
    }
    if (msg === "FORBIDDEN") return json({ error: "FORBIDDEN" }, 403);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

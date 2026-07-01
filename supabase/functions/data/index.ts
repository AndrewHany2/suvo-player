// data: single device-gated action router for all table access. Verifies the
// JWT and the bound device, then performs the op with the service role.
import {
  getUserId,
  adminClient,
  assertBoundDevice,
  json,
  corsPreflight,
} from "../_shared/deviceGate.ts";

const MAX_HISTORY = 20;

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const admin = adminClient();
    await assertBoundDevice(admin, userId, req.headers.get("x-device-id") ?? "");
    const { action, payload = {} } = await req.json();
    const db = admin.from.bind(admin);

    switch (action) {
      case "profiles.fetch": {
        const { data } = await db("profiles")
          .select("username, email")
          .eq("user_id", userId)
          .maybeSingle();
        return json(data ?? null);
      }
      case "profiles.upsert": {
        await db("profiles").upsert(
          { user_id: userId, username: payload.username, email: payload.email },
          { onConflict: "user_id" },
        );
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
          .eq("profile_id", payload.profileId)
          .order("created_at", { ascending: true });
        return json(
          (data ?? []).map((r: any) => ({
            id: r.id,
            nickname: r.nickname || "",
            host: r.host,
            username: r.username,
            password: r.password,
          })),
        );
      }
      case "iptv.insert": {
        const { data } = await db("iptv_accounts")
          .insert({
            user_id: userId,
            profile_id: payload.profileId,
            nickname: payload.nickname || null,
            host: payload.host,
            username: payload.username,
            password: payload.password,
          })
          .select("id")
          .single();
        return json({ id: data?.id ?? null });
      }
      case "iptv.update": {
        await db("iptv_accounts")
          .update({
            nickname: payload.nickname || null,
            host: payload.host,
            username: payload.username,
            password: payload.password,
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
        const { data } = await db("watch_history")
          .select("entry")
          .eq("user_key", payload.userKey)
          .order("watched_at", { ascending: false })
          .limit(MAX_HISTORY);
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "history.upsert": {
        await db("watch_history").upsert(
          {
            user_key: payload.userKey,
            entry_id: payload.entry.id,
            entry: payload.entry,
            watched_at: payload.entry.watchedAt,
          },
          { onConflict: "user_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "history.delete": {
        await db("watch_history")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
      case "favorites.fetch": {
        const { data } = await db("favorites")
          .select("entry")
          .eq("user_key", payload.userKey)
          .order("added_at", { ascending: false });
        return json((data ?? []).map((r: any) => r.entry));
      }
      case "favorites.upsert": {
        await db("favorites").upsert(
          {
            user_key: payload.userKey,
            entry_id: payload.entry.id,
            entry: payload.entry,
            added_at: payload.entry.addedAt,
          },
          { onConflict: "user_key,entry_id" },
        );
        return json({ ok: true });
      }
      case "favorites.delete": {
        await db("favorites")
          .delete()
          .eq("user_key", payload.userKey)
          .eq("entry_id", payload.entryId);
        return json({ ok: true });
      }
      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    if (msg === "DEVICE_MISMATCH") return json({ error: "DEVICE_MISMATCH" }, 403);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});

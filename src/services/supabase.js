import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mapInvokeResult } from "./invokeData.logic.js";
import { mapLoginResult } from "./loginResult.logic.js";
import { getDeviceId } from "./deviceHeader.js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const authConfig =
  Platform.OS !== "web"
    ? {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }
    : {};

// Lazily create the Supabase client on FIRST use rather than at module import,
// so createClient() runs off the synchronous cold-start path. The null result
// is memoized too, so an unconfigured app never re-checks.
let _client;
let _clientInit = false;
function client() {
  if (!_clientInit) {
    _clientInit = true;
    _client =
      SUPABASE_URL && SUPABASE_ANON_KEY
        ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, authConfig)
        : null;
  }
  return _client;
}

export const isSupabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ─── Device-gated data access ──────────────────────────────────────────────
// All table access flows through the `data` Edge Function, which verifies the
// JWT and the bound device before touching Postgres with the service role.
async function invokeData(action, payload = {}) {
  if (!client()) throw new Error("Supabase not configured");
  const res = await client().functions.invoke("data", {
    body: { action, payload },
    headers: { "x-device-id": getDeviceId() },
  });
  return mapInvokeResult(res);
}

// Bind-or-verify this device for the authed user. Returns 'bound' | 'ok' | 'denied'.
export async function claimDevice({ deviceId, platform, secondary }) {
  if (!client()) throw new Error("Supabase not configured");
  const res = await client().functions.invoke("claim-device", {
    body: { deviceId, platform, secondary },
    headers: { "x-device-id": deviceId },
  });
  if (res.error) throw new Error(res.error.message || "CLAIM_FAILED");
  return res.data?.status ?? "denied";
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function getSession() {
  if (!client()) return null;
  const { data } = await client().auth.getSession();
  return data.session;
}

export async function signUp(email, password) {
  const { data, error } = await client().auth.signUp({
    email: email.toLowerCase(),
    password,
  });
  if (error) {
    if (error.message?.toLowerCase().includes("rate limit"))
      throw new Error("Too many sign-up attempts. Please wait a few minutes and try again.");
    throw new Error(error.message);
  }
  return data.user;
}

export async function signIn(email, password) {
  if (!client()) throw new Error("Supabase not configured");
  // Email-only login. The password check + reseller status gate run server-side
  // in the `login` Edge Function (verify_jwt=false); the client never reads profiles.
  const res = await client().functions.invoke("login", {
    body: { email, password },
  });
  const { access_token, refresh_token } = mapLoginResult(res);
  const { data, error } = await client().auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(error.message);
  return data.user;
}

export async function signOut() {
  const { error } = await client().auth.signOut();
  if (error) throw new Error(error.message);
}

export function onAuthStateChange(callback) {
  if (!client()) return () => {};
  const { data } = client().auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

// ─── Profiles ──────────────────────────────────────────────────────────────

export async function fetchProfile(_userId) {
  return invokeData("profiles.fetch");
}

export async function upsertProfile(_userId, name, email) {
  return invokeData("profiles.upsert", { name, email });
}

// ─── App Profiles ────────────────────────────────────────────────────────────

export async function fetchAppProfiles(_userId) {
  return invokeData("appProfiles.list");
}

export async function insertAppProfile(_userId, { name, avatar = "👤" }) {
  return invokeData("appProfiles.insert", { name, avatar });
}

export async function updateAppProfile(profileId, { name, avatar }) {
  return invokeData("appProfiles.update", { id: profileId, name, avatar });
}

export async function deleteAppProfile(profileId) {
  return invokeData("appProfiles.delete", { id: profileId });
}

// ─── IPTV Accounts ───────────────────────────────────────────────────────────

export async function fetchIptvAccounts(profileId) {
  return invokeData("iptv.list", { profileId });
}

export async function insertIptvAccount(_userId, profileId, account) {
  const r = await invokeData("iptv.insert", { profileId, ...account });
  return r?.id ?? null;
}

export async function updateIptvAccount(accountId, account) {
  return invokeData("iptv.update", { id: accountId, ...account });
}

export async function deleteIptvAccount(accountId) {
  return invokeData("iptv.delete", { id: accountId });
}

// ─── Entitlement ─────────────────────────────────────────────────────────────

export async function fetchEntitlement() {
  return invokeData("entitlement.fetch", {});
}

// ─── Watch History ────────────────────────────────────────────────────────────

// Max number of history entries + the local+remote merge live in the pure
// historyProgress module; re-export so existing importers keep working.
export { MAX_HISTORY, mergeHistories } from "../context/historyProgress.js";

export async function fetchRemoteHistory(userKey, accountKey) {
  return invokeData("history.fetch", { userKey, accountKey });
}

export async function upsertHistoryEntry(userKey, accountKey, entry) {
  try {
    await invokeData("history.upsert", { userKey, accountKey, entry });
    return { ok: true };
  } catch (error) {
    // Best-effort remote sync — local history is the source of truth. Warn
    // (don't surface the red error overlay) and let the caller carry on.
    console.warn("[Supabase] upsertHistoryEntry:", error.message);
    return { ok: false, error };
  }
}

export async function deleteHistoryEntry(userKey, accountKey, entryId) {
  try {
    await invokeData("history.delete", { userKey, accountKey, entryId });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] deleteHistoryEntry:", error.message);
    return { ok: false, error };
  }
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function fetchFavorites(userKey, accountKey) {
  return invokeData("favorites.fetch", { userKey, accountKey });
}

export async function upsertFavorite(userKey, accountKey, entry) {
  try {
    await invokeData("favorites.upsert", { userKey, accountKey, entry });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] upsertFavorite:", error.message);
    return { ok: false, error };
  }
}

export async function deleteFavorite(userKey, accountKey, entryId) {
  try {
    await invokeData("favorites.delete", { userKey, accountKey, entryId });
    return { ok: true };
  } catch (error) {
    console.error("[Supabase] deleteFavorite:", error.message);
    return { ok: false, error };
  }
}


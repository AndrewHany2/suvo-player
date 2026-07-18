// Shared helpers for the device-gated Edge Functions.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically into deployed functions — no manual secrets needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { userKeyIsAuthorized } from "./authz.js";
import { accountStatus, isActive, selfLinesAllowed } from "./accountStatus.js";
import { evaluateEntitlement } from "./entitlement.js";
export { ACCOUNT_SUSPENDED, ACCOUNT_EXPIRED, PROVIDER_SUSPENDED } from "./accountStatus.js";

// Thrown by assertEntitled when the caller has no active entitlement. The
// thrown Error also carries a `.reason` (from evaluateEntitlement) so the
// handler can surface which reason (expired / revoked / suspended / …).
export const NOT_ENTITLED = "NOT_ENTITLED";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-device-id, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return null;
}

// Resolve the caller's user id from their bearer token (RLS-scoped anon client).
export async function getUserId(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") ?? "";
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user.id;
}

// Service-role client — bypasses RLS. Never expose this key to the client.
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Throws DEVICE_MISMATCH unless this exact (user_id, device_id) has a binding
// row — i.e. the caller's device is one of the account's claimed devices. No
// matching row (unbound / evicted / over-limit) throws — data access requires a
// prior successful claim-device. Access decision compares the PRIMARY anchor only.
export async function assertBoundDevice(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  deviceId: string,
) {
  if (!deviceId) throw new Error("DEVICE_MISMATCH");
  // `.is("revoked_at", null)` makes the server-side kill switch bite on EVERY
  // data op, not just re-claim: a revoked binding matches no row here and so
  // throws DEVICE_MISMATCH (routing the client to the device-locked screen).
  // claim_device already denies revoked devices, but the stock client only
  // claims once at boot — without this filter a revoked device that never
  // relaunches (or any direct call with a still-valid JWT) kept full access.
  const { data, error } = await admin
    .from("device_bindings")
    .select("device_id")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  if (!data) throw new Error("DEVICE_MISMATCH");
  await admin
    .from("device_bindings")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId);
}

// Throws FORBIDDEN if a non-null app_profile `profileId` is not owned by the
// caller. Used by iptv.insert so a caller can't attach an account row to a
// profile that isn't theirs. A null/empty profileId (or one equal to the user's
// own auth id — the "default" profile) is self-scoped and allowed.
export async function assertOwnsProfile(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  profileId: string | null | undefined,
) {
  if (!profileId || profileId === userId) return;
  const { data, error } = await admin
    .from("app_profiles")
    .select("user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  if (data?.user_id !== userId) throw new Error("FORBIDDEN");
}

// Throws FORBIDDEN unless the client-supplied library `userKey` belongs to the
// authenticated user — i.e. it is their own auth id, or an app_profile they
// own. Without this, a bound caller could read/write another account's watch
// history or favorites by passing a foreign userKey (service role bypasses RLS).
export async function assertOwnsUserKey(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  userKey: string,
) {
  if (!userKey) throw new Error("FORBIDDEN");
  let appProfileOwnerId: string | null = null;
  if (userKey !== userId) {
    const { data, error } = await admin
      .from("app_profiles")
      .select("user_id")
      .eq("id", userKey)
      .maybeSingle();
    if (error) throw new Error("SERVER_ERROR");
    appProfileOwnerId = data?.user_id ?? null;
  }
  if (!userKeyIsAuthorized(userKey, userId, appProfileOwnerId)) {
    throw new Error("FORBIDDEN");
  }
}

// Reads the caller's customer_accounts row + owning provider's suspended flag
// and returns an accountStatus() constant. A caller with no customer_accounts
// row (legacy / self / a provider login) is ACTIVE — not gated here.
export async function loadAccountStatus(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<string> {
  const { data: acct, error } = await admin
    .from("customer_accounts")
    .select("suspended, expires_at, provider_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  if (!acct) return accountStatus(null, false, Date.now());

  let providerSuspended = false;
  if (acct.provider_id) {
    const { data: prov, error: pErr } = await admin
      .from("providers")
      .select("suspended")
      .eq("user_id", acct.provider_id)
      .maybeSingle();
    if (pErr) throw new Error("SERVER_ERROR");
    providerSuspended = !!prov?.suspended;
  }
  return accountStatus(acct, providerSuspended, Date.now());
}

// Whether the caller may add their own IPTV lines in the app. Reads the flag
// off the caller's customer_accounts row; a missing row is the legacy/ungated
// case (allowed). A DB error throws SERVER_ERROR (retryable), never a denial.
export async function loadSelfLinesAllowed(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<boolean> {
  const { data: acct, error } = await admin
    .from("customer_accounts")
    .select("allow_self_lines")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  return selfLinesAllowed(acct);
}

// Throws the specific status string when the account is inactive; the caller
// maps it to a client-facing message / HTTP code.
export async function assertAccountActive(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<void> {
  const status = await loadAccountStatus(admin, userId);
  if (!isActive(status)) throw new Error(status);
}

// Reads the caller's entitlements row (only the columns the decision needs). A
// DB error throws SERVER_ERROR (retryable 500) — NOT a denial — so a transient
// outage doesn't route users to a terminal "expired" state. A genuinely absent
// row is returned as null, which evaluateEntitlement fails closed on.
export async function loadEntitlement(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ status?: string; revoked_at?: string | null; expires_at?: string | null } | null> {
  const { data, error } = await admin
    .from("entitlements")
    .select("status, revoked_at, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  return data ?? null;
}

// Content gate: throws NOT_ENTITLED (with `.reason`) unless the caller has an
// active, unexpired, unrevoked entitlement, judged against the SERVER clock.
// This is the real demo/trial + license boundary — see entitlement.js.
export async function assertEntitled(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<void> {
  const row = await loadEntitlement(admin, userId);
  const verdict = evaluateEntitlement(row, Date.now());
  if (!verdict.entitled) {
    const e = new Error(NOT_ENTITLED) as Error & { reason?: string };
    e.reason = verdict.reason;
    throw e;
  }
}

// Advisory snapshot for the client UX (the "entitlement.fetch" action). Returns
// the verdict plus expires_at so the app can show a countdown / expired panel.
// Never the boundary — assertEntitled already denies content server-side.
export async function entitlementSnapshot(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ entitled: boolean; reason: string; expires_at: string | null; allowSelfLines: boolean }> {
  const row = await loadEntitlement(admin, userId);
  const verdict = evaluateEntitlement(row, Date.now());
  const allowSelfLines = await loadSelfLinesAllowed(admin, userId);
  return { entitled: verdict.entitled, reason: verdict.reason, expires_at: row?.expires_at ?? null, allowSelfLines };
}

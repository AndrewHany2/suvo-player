// Shared helpers for the device-gated Edge Functions.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically into deployed functions — no manual secrets needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const { data, error } = await admin
    .from("device_bindings")
    .select("device_id")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  if (!data) throw new Error("DEVICE_MISMATCH");
  await admin
    .from("device_bindings")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId);
}

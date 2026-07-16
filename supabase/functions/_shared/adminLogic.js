// Pure authorization + validation decisions for the `admin` Edge Function. No
// I/O and no imports, so it runs under BOTH the Deno edge runtime and node:test.

export const ROLE_SUPER_ADMIN = "super_admin";
export const ROLE_PROVIDER = "provider";

// Actions only a super-admin may call.
const SUPER_ADMIN_ACTIONS = new Set([
  "providers.list",
  "providers.create",
  "providers.update",
  "providers.delete",
]);

// caller: { userId, role, suspended } | null
export function canInvoke(caller, action) {
  if (!caller || caller.suspended) return false;
  if (caller.role === ROLE_SUPER_ADMIN) return true;
  if (SUPER_ADMIN_ACTIONS.has(action)) return false;
  return caller.role === ROLE_PROVIDER;
}

// The provider-isolation invariant: a provider may act only on accounts they
// own; a super-admin may act on any.
export function canActOnAccount(caller, targetProviderId) {
  if (!caller || caller.suspended) return false;
  if (caller.role === ROLE_SUPER_ADMIN) return true;
  return caller.role === ROLE_PROVIDER && targetProviderId === caller.userId;
}

export function withinQuota(used, max, role) {
  if (role === ROLE_SUPER_ADMIN) return true;
  return Number(used) < Number(max);
}

export function validateLine(line) {
  const type = String(line?.type ?? "xtream").toLowerCase();
  const nickname = line?.nickname ? String(line.nickname) : null;
  if (type === "m3u") {
    const url = String(line?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, value: null };
    return { ok: true, value: { type: "m3u", host: null, username: null, password: null, url, nickname } };
  }
  const host = String(line?.host ?? "").trim();
  const username = String(line?.username ?? "").trim();
  const password = String(line?.password ?? "");
  if (!host || !username || !password) return { ok: false, value: null };
  return { ok: true, value: { type: "xtream", host, username, password, url: null, nickname } };
}

export function validateNewAccount(input) {
  const errors = [];
  const username = String(input?.username ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  const deviceLimit = Number(input?.deviceLimit);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.push("username");
  // Mirrors supabase/config.toml's minimum_password_length = 6.
  if (password.length < 6) errors.push("password");
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) errors.push("deviceLimit");

  const line = validateLine(input?.line);
  if (!line.ok) errors.push("line");

  let expiresAt = null;
  if (input?.expiresAt != null && input.expiresAt !== "") {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) errors.push("expiresAt");
    else expiresAt = new Date(t).toISOString();
  }

  return {
    ok: errors.length === 0,
    errors,
    value: { username, password, deviceLimit, expiresAt, line: line.value },
  };
}

export function providerSlug(name, userId) {
  const base = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || String(userId ?? "").slice(0, 8) || "provider";
}

export function resolveEmail(username, slug, email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (e.includes("@")) return e;
  return `${username}@${slug}.accounts.local`;
}

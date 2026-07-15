// PURE interpretation of an Xtream `user_info` envelope into a connect verdict.
// Split into its own leaf module (no service imports) so the auth/status/expiry
// rules are unit-testable under `node --test` without pulling in ContentService's
// Metro-resolved import graph.

// A "status" that still allows playback. Xtream panels report "Active"; some
// omit status entirely (treated as active). Anything else (Expired, Banned,
// Disabled, …) blocks the connect.
const ACTIVE_STATUS = /active/i;

/**
 * @param {{ user_info?: { auth?: any, status?: any, exp_date?: any } } | null | undefined} info
 * @returns {{ ok: boolean, status?: string, message: string, expiresAt?: number }}
 */
export function interpretUserInfo(info) {
  const u = info?.user_info;
  const authed = !!u && (u.auth === 1 || u.auth === "1" || u.auth === true);
  if (!authed) return { ok: false, message: "Invalid username or password." };
  const status = (u.status ?? "").toString().trim();
  if (status && !ACTIVE_STATUS.test(status)) {
    return { ok: false, status, message: `This account is ${status}.` };
  }
  const exp = Number(u.exp_date);
  return {
    ok: true,
    status: status || "Active",
    message: "Connected.",
    ...(Number.isFinite(exp) && exp > 0 ? { expiresAt: exp } : {}),
  };
}

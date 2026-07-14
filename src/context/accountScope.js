// @ts-check
// PURE helpers for identifying the IPTV account a library entry belongs to.
//
// The library (watch history + favorites) is stored per profile (`userKey`) but
// partitioned per IPTV account via `account_key = accountKeyOf(activeAccount)`
// (see the data Edge Function). These helpers derive that key and a display
// label; all scoping/filtering now happens server-side.

/**
 * PURE: stable per-account id string. Prefers the account's own id (remote UUID
 * or local id); falls back to host+username so anonymous/unsynced accounts still
 * get a distinct, deterministic key. Returns null when the account can't be keyed.
 * @param {{ id?: any, host?: string, username?: string } | null | undefined} account
 * @returns {string|null}
 */
export function accountKeyOf(account) {
  if (!account) return null;
  if (account.id != null && account.id !== "") return String(account.id);
  if (account.host || account.username) return `${account.host || ""}_${account.username || ""}`;
  return null;
}

/**
 * PURE: human label for an account, used in the "connect an account" empty state.
 * @param {{ nickname?: string, username?: string } | null | undefined} account
 * @returns {string}
 */
export function accountLabelOf(account) {
  if (!account) return "this account";
  return account.nickname || account.username || "this account";
}

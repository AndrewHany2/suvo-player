// Pure account-status decision for the reseller gates. No I/O and no imports, so
// it runs under BOTH the Deno edge runtime and node:test.

export const ACCOUNT_ACTIVE = "ACTIVE";
export const ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED";
export const ACCOUNT_EXPIRED = "ACCOUNT_EXPIRED";
export const PROVIDER_SUSPENDED = "PROVIDER_SUSPENDED";

/**
 * Decide a customer account's status. Priority: account-suspended >
 * provider-suspended > expired > active. A null account (no customer_accounts
 * row — e.g. a legacy/self/provider login) is NOT gated here => ACTIVE.
 *
 * @param {{suspended:boolean, expires_at:string|null}|null} account
 * @param {boolean} providerSuspended - owning provider's suspended flag
 * @param {number} nowMs - server epoch ms (Date.now())
 * @returns {string} one of the ACCOUNT_* / PROVIDER_* constants
 */
export function accountStatus(account, providerSuspended, nowMs) {
  if (!account) return ACCOUNT_ACTIVE;
  if (account.suspended) return ACCOUNT_SUSPENDED;
  if (providerSuspended) return PROVIDER_SUSPENDED;
  if (account.expires_at != null) {
    const exp = Date.parse(account.expires_at);
    if (Number.isFinite(exp) && exp < nowMs) return ACCOUNT_EXPIRED;
  }
  return ACCOUNT_ACTIVE;
}

export function isActive(status) {
  return status === ACCOUNT_ACTIVE;
}

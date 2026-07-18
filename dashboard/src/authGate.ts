// Pure decision helpers for the dashboard's login role gate. No I/O and no
// imports so they can be unit-tested without a React/jsdom harness (the
// dashboard has no @testing-library). auth.tsx wires these into the live
// `me` flow; the rules themselves live here so they can be tested directly.

// Roles allowed into the reseller dashboard. A customer (or any absent/other
// role) must be kept out — customers manage nothing here.
const ALLOWED_ROLES = new Set(["provider", "super_admin"]);

// Error CODES (the `.message` of the Error thrown by api.ts's `call`) that mean
// "this login is not allowed in" — the session should be torn down and the
// gate-rejection message shown. Every OTHER code (SERVER_ERROR, HTTP_*, a
// network failure, etc.) is transient/retryable: keep the session and surface a
// retry error instead of falsely branding a legitimate provider a non-provider.
const REJECT_CODES = new Set(["FORBIDDEN", "Unauthorized"]);

export function shouldRejectSession(errorCode: string): boolean {
  return REJECT_CODES.has(errorCode);
}

export function isAllowedRole(role: string): boolean {
  return ALLOWED_ROLES.has(role);
}

// True for the super-admin role, which alone may see every provider's accounts
// and manage providers. auth.tsx already restricts the dashboard to
// provider/super_admin via isAllowedRole; this narrows within that set.
export function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

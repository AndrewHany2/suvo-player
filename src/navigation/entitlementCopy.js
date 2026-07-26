// Pure reason→copy map for the entitlement-locked screen. Leaf module (no React
// / context / service imports) so it stays unit-testable in isolation, mirroring
// userInfo.js's interpretUserInfo.
//
// The reason strings come straight from the server's evaluateEntitlement
// (supabase/functions/_shared/entitlement.js): "no-entitlement" | "suspended" |
// "revoked" | "expired" | "ok". Any other/unknown value falls back to a generic
// inactive message — the screen must always render *something* actionable.

const COPY = {
  expired: {
    title: "Subscription expired",
    message:
      "Your subscription has expired. Contact your provider to renew and restore access.",
  },
  revoked: {
    title: "Access revoked",
    message:
      "Your access has been revoked. Contact your provider if you think this is a mistake.",
  },
  suspended: {
    title: "Account suspended",
    message:
      "Your account is currently suspended. Contact your provider to reactivate it.",
  },
  "no-entitlement": {
    title: "No active subscription",
    message:
      "We couldn't find an active subscription for this account. Contact your provider to get set up.",
  },
};

const FALLBACK = {
  title: "Subscription inactive",
  message:
    "Your subscription isn't active right now. Contact your provider for help.",
};

/**
 * Map a server entitlement `reason` to the title/message shown on the
 * entitlement-locked screen. Unknown/empty reasons (and "ok", which should never
 * reach this screen) fall back to a generic inactive message.
 *
 * @param {string|null|undefined} reason
 * @returns {{ title: string, message: string }}
 */
export function interpretEntitlement(reason) {
  return COPY[reason] ?? FALLBACK;
}

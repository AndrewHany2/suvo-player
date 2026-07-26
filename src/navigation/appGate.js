/**
 * Screen-gating decision for the app root — the single source of truth for which
 * top-level screen to render given the auth / device / profile / config state.
 * Both AppNavigator.jsx (native) and AppNavigator.web.jsx render from this (via
 * the useAppGate hook) so the boot-flow decision can't silently diverge between
 * platforms; only the chrome around the chosen screen (native tabs vs web
 * TopNav, webOS Back handling) differs per navigator.
 *
 * Kept framework-free (no React/context imports) so the precedence stays
 * unit-testable in isolation, mirroring tabHistory.js. useAppGate.js is the thin
 * hook that feeds this the live context state.
 */

/**
 * Gate values, highest-precedence first — the order below IS the decision order.
 * @typedef {"config-error" | "loading" | "auth" | "device-locked" | "entitlement-locked" | "profiles" | "app"} Gate
 */

/**
 * Pick the top-level screen from the boot-flow state. Precedence (first match
 * wins): a missing Supabase config short-circuits to the config-error screen;
 * then the neutral loading splash while the session resolves; then the auth
 * screen when signed out; then the loading splash again while the device claim
 * is pending; then the device-locked screen when the claim was denied; then the
 * entitlement-locked screen when the server says the subscription is inactive;
 * then the profile picker until a profile is active; and finally the main app.
 *
 * `entitled` FAILS OPEN: only an explicit `false` locks. undefined (not yet
 * fetched, or a network error the caller swallowed) passes through, so a
 * transient failure never flashes the locked screen at a paying user — the
 * server still hard-blocks content, so this gate is UX, not the boundary.
 *
 * @param {{ supabaseConfigured?: boolean, authLoading?: boolean,
 *           authUser?: unknown, deviceStatus?: string,
 *           entitled?: boolean, activeProfileId?: unknown }} state
 * @returns {Gate}
 */
export function resolveGate(state) {
  const { supabaseConfigured, authLoading, authUser, deviceStatus, entitled, activeProfileId } =
    state || {};
  if (!supabaseConfigured) return "config-error";
  if (authLoading) return "loading";
  if (!authUser) return "auth";
  if (deviceStatus === "pending") return "loading";
  if (deviceStatus === "denied") return "device-locked";
  if (entitled === false) return "entitlement-locked";
  if (!activeProfileId) return "profiles";
  return "app";
}

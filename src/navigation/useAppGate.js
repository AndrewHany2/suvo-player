/**
 * useAppGate — thin hook that reads the live app state and resolves the current
 * screen gate via the pure resolveGate() decision (see appGate.js). Both
 * AppNavigator.jsx and AppNavigator.web.jsx render from this so the boot-flow
 * gating decision has one source of truth.
 */
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../services/supabase";
import useDemoLockout from "../security/useDemoLockout";
import { resolveGate } from "./appGate";

export { resolveGate };

/** Read the live app state and resolve the current gate. */
export function useAppGate() {
  const { authUser, authLoading, deviceStatus, activeProfileId } = useApp();
  // Build-time deadline check (no-op on a normal build; see useDemoLockout).
  // Called unconditionally to satisfy rules-of-hooks; 'checking' is non-blocking.
  const { status: lockoutStatus } = useDemoLockout();
  return resolveGate({
    demoExpired: lockoutStatus === "expired",
    supabaseConfigured: isSupabaseConfigured(),
    authLoading,
    authUser,
    deviceStatus,
    activeProfileId,
  });
}

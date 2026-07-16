import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { demoExpiryMs } from "../config/demoExpiry";
import { isDemoExpired } from "./trustedTime";

const INTERVAL_MS = 5 * 60 * 1000; // re-check cadence while foregrounded
const MAX_ONESHOT_MS = 6 * 60 * 60 * 1000; // horizon for an exact-deadline timer

// Gates the app when a build-time deadline has passed. Returns
// { status: 'checking' | 'ok' | 'expired', recheck }. The gate treats
// 'checking' as non-blocking, so we start optimistic and never delay cold
// start (matches the lazy-Supabase init decision).
//
// A build without a baked deadline is not a limited build: the feature is off,
// so we stay 'ok' forever and never touch the network. The deadline is a
// build-time constant, so demoExpiryMs() is evaluated once per mount.
export default function useDemoLockout() {
  const enabled = demoExpiryMs() != null;

  const [status, setStatus] = useState(enabled ? "checking" : "ok");

  // aliveRef guards setState against a probe that resolves after unmount.
  // statusRef mirrors the latest status so recheck/listeners never downgrade a
  // lock back to 'ok' (once 'expired', always 'expired').
  const aliveRef = useRef(true);
  const statusRef = useRef(status);
  statusRef.current = status;

  const recheck = useCallback(() => {
    if (!enabled || statusRef.current === "expired") return;
    isDemoExpired()
      .then((r) => {
        if (!aliveRef.current || statusRef.current === "expired") return;
        setStatus(r.expired ? "expired" : "ok");
      })
      .catch(() => {}); // fail-open: a probe error leaves the current status
  }, [enabled]);

  // Check on mount and whenever the app returns to the foreground. On
  // web/Electron react-native-web maps AppState to document visibility, so
  // this one place covers every platform (same pattern as AppContext).
  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return undefined;

    recheck();

    let prev = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      const wasHidden = prev === "background" || prev === "inactive";
      prev = next;
      if (wasHidden && next === "active") recheck();
    });

    // Wall-clock re-evaluation. The mount/foreground checks alone let a session
    // that's simply left open stream past the deadline. A periodic backstop
    // re-checks while foregrounded; a one-shot timer fires right at the deadline
    // when it's near (setTimeout is unreliable for multi-day delays, so only arm
    // it within a bounded horizon — the interval covers longer waits).
    const interval = setInterval(recheck, INTERVAL_MS);
    const remaining = demoExpiryMs() - Date.now();
    let oneShot;
    if (remaining >= 0 && remaining <= MAX_ONESHOT_MS) {
      oneShot = setTimeout(recheck, remaining + 1000);
    }

    return () => {
      aliveRef.current = false;
      sub.remove();
      clearInterval(interval);
      if (oneShot) clearTimeout(oneShot);
    };
  }, [enabled, recheck]);

  return { status, recheck };
}

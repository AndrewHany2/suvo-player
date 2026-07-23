import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Honors the OS "Reduce Motion" (iOS) / "Remove animations" (Android) setting.
 *
 * docs/PRODUCT.md / docs/DESIGN.md mandate honoring reduced-motion across the whole app.
 * Web/TV already do this via a `prefers-reduced-motion` CSS media query; native
 * has no CSS layer, so components read this hook and gate their animations
 * (shimmer loops, image crossfades, Modal `animationType`) on it — mirroring the
 * existing low-end-device gating pattern.
 *
 * Returns `true` when the user has asked the OS to minimize motion.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      if (mounted) setReduced(!!value);
    });
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (value) => setReduced(!!value),
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}

export default useReducedMotion;

// src/presentation/virtualization/useShelfWindow.js
import { useMemo } from "react";
import { computeWindow } from "./windowMath.js";

// Thin memoized wrapper: turns window slot counts into px pad sizes for the
// spacer divs. `stride` is item extent + gap on this axis.
export function useShelfWindow({ anchor, total, viewportCount, overscan, stride }) {
  return useMemo(() => {
    const w = computeWindow({ anchor, total, viewportCount, overscan });
    return {
      start: w.start,
      end: w.end,
      leadingPad: w.leadingCount * stride,
      trailingPad: w.trailingCount * stride,
    };
  }, [anchor, total, viewportCount, overscan, stride]);
}

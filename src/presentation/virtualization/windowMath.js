// src/presentation/virtualization/windowMath.js
// Pure, axis-agnostic mount-window math shared by the web horizontal rail,
// the web vertical shelf list, and the TV 2-D shelf browser. No React, no DOM.
//
// `anchor` is the index of the first visible slot on this axis (poster column
// or shelf row). The window is [start, end): the visible page plus `overscan`
// slots kept mounted on each side. Clamped to [0, total]; always contains the
// anchor. `leadingCount`/`trailingCount` size the spacer stand-ins for the
// unmounted slots so scroll geometry is preserved.
export function computeWindow({ anchor, total, viewportCount, overscan = 4 }) {
  const t = Math.max(0, Math.trunc(total));
  if (t === 0) return { start: 0, end: 0, leadingCount: 0, trailingCount: 0 };
  const a = Math.min(Math.max(0, Math.trunc(anchor)), t - 1);
  const start = Math.max(0, a - overscan);
  const end = Math.min(t, a + Math.max(1, viewportCount) + overscan);
  return { start, end, leadingCount: start, trailingCount: t - end };
}

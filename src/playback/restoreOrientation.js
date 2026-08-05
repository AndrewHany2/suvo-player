// Restore the device to portrait when a native player screen unmounts.
//
// The player locks LANDSCAPE for fullscreen. On close we want to snap back to
// portrait but NOT pin the app there (the app policy is "default"/all
// orientations, so it must be free to rotate again afterward).
//
// The obvious `lockAsync(PORTRAIT_UP).then(() => unlockAsync())` is racy:
// `lockAsync` resolves when the orientation *request* is registered, not when the
// device has physically rotated. Unlocking in the next microtask reverts control
// to the "default" policy before portrait is applied — Android coalesces the two
// back-to-back requests (PORTRAIT then UNSPECIFIED) so only UNSPECIFIED sticks,
// and the device stays in the landscape the user was holding. With the system
// auto-rotate setting off it can never rotate back on its own, so closing a
// fullscreen video left the whole app stuck sideways.
//
// Instead: lock PORTRAIT_UP, wait until the device actually REPORTS portrait
// (orientation-change event, with a safety cap so the lock never outlives the
// player), THEN unlock so the app can rotate freely again.

/** True for a portrait orientation. `O` is expo's `ScreenOrientation.Orientation`. */
export function isPortrait(orientation, O) {
  return orientation === O.PORTRAIT_UP || orientation === O.PORTRAIT_DOWN;
}

/**
 * Snap to portrait, then release the orientation lock once portrait is applied.
 *
 * @param ScreenOrientation the expo-screen-orientation module (injected so this
 *   is testable in plain Node).
 * @param opts.timeoutMs safety cap after which we unlock even if no portrait
 *   event arrived (default 1500ms).
 * @param opts.setTimeoutFn / opts.clearTimeoutFn injectable timers (default global).
 */
export async function restorePortrait(
  ScreenOrientation,
  { timeoutMs = 1500, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {},
) {
  const O = ScreenOrientation.Orientation;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

    const current = await ScreenOrientation.getOrientationAsync();
    if (!isPortrait(current, O)) {
      // Not portrait yet — wait for the applied-portrait event (or the safety cap).
      await new Promise((resolve) => {
        let settled = false;
        let sub = null;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer != null) clearTimeoutFn(timer);
          if (sub) ScreenOrientation.removeOrientationChangeListener(sub);
          resolve();
        };
        sub = ScreenOrientation.addOrientationChangeListener((e) => {
          if (isPortrait(e?.orientationInfo?.orientation, O)) finish();
        });
        timer = setTimeoutFn(finish, timeoutMs);
      });
    }

    await ScreenOrientation.unlockAsync();
  } catch {
    // Best-effort: orientation control must never throw from an unmount cleanup.
  }
}

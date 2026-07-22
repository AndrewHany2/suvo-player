import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

// Reference design resolution — all sizes in the app are authored at this.
const DESIGN_WIDTH  = 1920;
const DESIGN_HEIGHT = 1080;

// Web — INCLUDING webOS TV — recomputes the scale when the window size changes.
// webOS must NOT be excluded here: it can report a 0×0 window at module-load time
// (the app window is sized AFTER the deferred bundle starts executing). Freezing
// that snapshot collapses every ss()-scaled size to 0px permanently — a blank UI.
// TVs don't drag-resize, so the listener fires ~once at startup: no per-frame
// churn, just the one correction that turns the frozen 0 into the real scale.
//
// Native also listens (see the Dimensions 'change' handler below) so useScale()
// consumers reflow on rotation / iPad Split View / Android multi-window — but it
// only re-reads on discrete change events, never per-frame.
const IS_REACTIVE = Platform.OS === 'web';

// Uniform scale factor: whichever axis is the tighter fit governs.
// Do NOT divide by PixelRatio — Dimensions already returns CSS logical pixels
// on web (DPR is handled by the browser). On LG TV (DPR=1, viewport=1280)
// and on native (where PixelRatio may vary), this gives the right result.
// Native phones/tablets are NOT 1920-wide: scaling the 1920×1080 design against
// a ~390pt phone yields ~0.2×, which shrinks every ss()-sized shared screen
// (Auth, Profiles, Accounts, detail overlays) to an unreadable ~20%. So on
// native we scale against a mobile reference width instead, clamped to a sane
// band so the design-time pixel sizes render ~1× on a typical phone and adapt
// gently for small (SE) / large (Pro Max / tablet) screens. Web + webOS TV keep
// the 1920×1080 reference (large-screen UIs authored at that resolution).
const MOBILE_REF_WIDTH = 420;

// Read the window size, falling back to live DOM measurements when RN-Web's
// Dimensions cache is still 0. On webOS the cache can be stale (0×0) at the
// instant the bundle evaluates; window.innerWidth / clientWidth are usually
// populated by then, so try them before giving up.
function readWindow() {
  let { width, height } = Dimensions.get('window');
  if ((!width || !height) && typeof window !== 'undefined') {
    width = width || window.innerWidth || 0;
    height = height || window.innerHeight || 0;
  }
  if ((!width || !height) && typeof document !== 'undefined' && document.documentElement) {
    width = width || document.documentElement.clientWidth || 0;
    height = height || document.documentElement.clientHeight || 0;
  }
  return { width, height };
}

function computeScale() {
  const { width, height } = readWindow();
  if (Platform.OS !== 'web') {
    const s = width / MOBILE_REF_WIDTH;
    return Math.min(Math.max(s, 0.85), 1.3);
  }
  // Dimensions not ready yet (webOS cold start, before the window is sized):
  // render at design size rather than collapsing every size to 0 — the resize
  // listener / kicks below recompute the moment real dimensions arrive.
  if (!width || !height) return 1;
  // WIDTH-DRIVEN. The old formula took min(width/1920, height/1080), which meant
  // shrinking an Electron window's HEIGHT (or any short/narrow viewport, incl.
  // browser zoom that reduces innerWidth) miniaturised the whole horizontal
  // layout + text into illegibility. Scale off width alone and clamp to a sane
  // band so the UI stays legible on small viewports and never balloons on huge
  // ones.
  //
  // LEGIBILITY FLOOR. Because ss() scales EVERYTHING uniformly (fonts, padding,
  // cards, gaps) by this one factor, the design's proportions hold at any factor
  // and the flex layout (centered maxWidth, reflowing grids, ScrollView) absorbs
  // a larger factor gracefully — so raising the floor only makes small windows
  // more readable, it can't clip. The old 0.5 floor rendered 16px body text at
  // ~8px on a half-screen ~960px window and ~10px in the DEFAULT 1200px Electron
  // window — sub-legible for a lean-back player. Floor at 0.65 so nothing drops
  // below ~65% of its authored size. webOS TV is UNAFFECTED: its viewport is
  // pinned to width=1280 → 1280/1920 ≈ 0.667, which is above the floor and
  // returned unchanged. (Full relief on very narrow windows still wants real
  // reflow breakpoints; this floor is the proportional, no-regression step.)
  // No height guard: keeping one would re-introduce the height-shrink bug.
  const base = width / DESIGN_WIDTH;
  return Math.min(Math.max(base, 0.65), 1.5);
}

// Live scale. Seeded at module load and updated by the listeners/kicks wired
// below — on web (incl. webOS TV) via resize, on native via Dimensions 'change'.
// `ss(n)` always reads the latest.
let SCALE = computeScale();

// Subscribers re-rendered when SCALE changes (web/desktop/TV). Kept in a Set so
// useScale() instances can register/unregister cleanly.
const subscribers = new Set();

function recompute() {
  const next = computeScale();
  if (next === SCALE) return;
  SCALE = next;
  for (const notify of subscribers) notify(SCALE);
}

if (IS_REACTIVE && typeof window !== 'undefined') {
  // RN-Web maps Dimensions 'change' onto window resize, but we also listen on
  // window directly as a belt-and-braces guard for environments (Electron) where
  // the RN shim's debounce can lag.
  Dimensions.addEventListener('change', recompute);
  if (window.addEventListener) window.addEventListener('resize', recompute);

  // Cold-start safety net: if the window was 0×0 at module load (webOS sizes its
  // app window AFTER the deferred bundle runs) a resize event may never follow, so
  // actively re-check once layout settles. recompute() is a no-op when unchanged,
  // and on the correcting tick it notifies subscribers so the tree reflows off 0.
  if (window.requestAnimationFrame) window.requestAnimationFrame(recompute);
  if (window.addEventListener) window.addEventListener('load', recompute);
  setTimeout(recompute, 0);
  setTimeout(recompute, 300);
} else if (Platform.OS !== 'web') {
  // Native: SCALE is seeded at module load, but the window CAN change size after
  // launch — device rotation, iPad Split View, Android multi-window/freeform. The
  // grid columns already reflow (they read useWindowDimensions), so ss()-sized
  // chrome must follow or it desyncs from the new layout. Recompute off discrete
  // Dimensions 'change' events (never per-frame) and notify useScale() consumers.
  Dimensions.addEventListener('change', recompute);
}

/**
 * Scale a design-time measurement to the current screen.
 *
 * Usage:
 *   fontSize={ss(28)}   // 28pt at 1080p → correct physical px on any TV
 *   padding={ss(48)}
 *
 * Reads the live SCALE, so on web it reflects the latest window size. Call sites
 * that want to RE-RENDER on resize should also subscribe via useScale().
 *
 * @param {number} size  Size at 1920×1080 reference resolution.
 * @returns {number}     CSS pixel value for the current screen.
 */
export const ss = (size) => Math.round(size * SCALE);

// Verbose alias for readability in non-UI contexts.
export const scaleSize = ss;

/**
 * React hook returning the current scale factor and re-rendering the consumer
 * when the window resizes (web/desktop) or the native window changes size
 * (rotation, iPad Split View, Android multi-window). `ss()` call sites that are
 * NOT wrapped in useScale() read the same live SCALE but won't re-render on their
 * own — adopt useScale() where a live reflow matters.
 *
 * Usage:
 *   const scale = useScale();          // re-renders on resize
 *   const pad = ss(48);                // reads the same live SCALE
 *
 * @returns {number} The current uniform scale factor.
 */
export function useScale() {
  const [scale, setScale] = useState(SCALE);

  useEffect(() => {
    // Sync immediately in case SCALE changed between initial render and effect.
    setScale(SCALE);
    subscribers.add(setScale);
    return () => {
      subscribers.delete(setScale);
    };
  }, []);

  return scale;
}

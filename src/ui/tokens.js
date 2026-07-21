/**
 * Aurora design tokens — the single source of truth for the app's visual identity.
 *
 * Authored once here and consumed by JS (the cross-platform primitives, native
 * StyleSheet, and any new component). The heavily-shared legacy CSS uses the
 * same values as LITERAL hex (not CSS `var()`) so old webOS Chromium — which
 * can't be assumed to support custom properties — renders correctly at zero
 * runtime cost. Keep CSS literals in sync with the values below.
 */
import { Platform } from "react-native";

export const colors = {
  bg: "#0A0E1A",        // midnight — app background
  surface: "#141A2E",   // slate — cards, bars
  surface2: "#1B2236",  // elevated — modals, inputs, chips
  border: "#28324E",    // hairlines / card borders
  accent: "#6C5CE7",    // indigo — primary actions, active state
  accentText: "#A99BF5",// lighter indigo — small text on dark (AA >=4.5:1 on bg/surface/surface2)
  accent2: "#22D3EE",   // cyan — focus ring, gradient end
  text: "#EAF0FF",      // ice — primary text
  textStrong: "#FFFFFF",// pure-white emphasis tier (titles, hero, crew labels)
  textDim: "#B8C0DA",   // dimmed ice — secondary titles/labels (mirrors CSS --a-text-dim)
  muted: "#7A86A8",     // steel — secondary text
  faint: "#4A5575",     // dimmer steel — placeholders, disabled text
  danger: "#E5484D",    // red — destructive actions, errors
  success: "#6ABF69",   // green — confirmations, online state
  rating: "#FFD700",    // gold — star ratings
};

/** Accent (indigo) at a given alpha — focus glows, hover washes, scrims.
 *  e.g. accentAlpha(0.18) → 'rgba(108,92,231,0.18)'. Keep in sync with accent. */
export const accentAlpha = (a) => "rgba(108,92,231," + a + ")";

/** Accent2 (cyan #22D3EE → rgb 34,211,238) at a given alpha — focus ring glow.
 *  Mirrors accentAlpha; keep in sync with accent2. */
export const accent2Alpha = (a) => "rgba(34,211,238," + a + ")";

/** Static gradient — used for the nav band and active/selected states.
 *  Never animated (TV strips animations and would jank). */
export const gradient = {
  css: "linear-gradient(100deg, #6C5CE7, #22D3EE)",
  from: "#6C5CE7",
  to: "#22D3EE",
  angle: 100,
};

export const radii = { sm: 8, md: 14, lg: 20, card: 10, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const fonts = {
  // Display (titles, eyebrows) → Space Grotesk; body → Inter. System fallback
  // keeps the UI legible if a webfont fails to load on TV.
  display: 'SpaceGrotesk, "Space Grotesk", -apple-system, "Segoe UI", Roboto, sans-serif',
  body: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif',
};

// Type ramp, authored at the 1920×1080 reference — pass through ss() at call
// sites that need to scale on TV/web (see src/utils/scaleSize.js).
export const fontSizes = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 40 };

// String weights so they drop straight into both CSS and RN style (RN wants
// strings; CSS accepts them).
export const fontWeights = { regular: "400", medium: "600", bold: "700" };

export const lineHeights = { tight: 1.2, normal: 1.4, relaxed: 1.6 };

// Stacking order for layered surfaces. Keep gaps so ad-hoc values can slot
// between tiers without renumbering.
export const zIndex = { base: 0, dropdown: 100, overlay: 1000, modal: 1100, toast: 1200 };

/** Elevation presets. Platform-aware: native uses iOS shadow* + Android
 *  elevation; web/TV return an empty object because the legacy CSS owns box-shadow
 *  there (and TV strips shadows for perf), so spreading these is a safe no-op. */
export const shadows = {
  card: Platform.select({
    native: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    },
    default: {},
  }),
  modal: Platform.select({
    native: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 12,
    },
    default: {},
  }),
};

/** Hero gradient scrim — left→transparent wash so backdrop art stays legible
 *  under the hero title. Web/TV consume the literal `css` linear-gradient
 *  (opaque bg on the left → transparent on the right, ~100deg to echo `gradient`).
 *  Native consumes `stops` with expo-linear-gradient (the only gradient dep
 *  available — react-native-svg is NOT installed): same opaque-bg→transparent
 *  ramp expressed as a colors[] + locations[] pair, with start/end coords for a
 *  left→right sweep. Inline rgba literals (bg #0A0E1A → 10,14,26) so old webOS
 *  Chromium needs no var(). */
export const scrim = {
  css: "linear-gradient(100deg, rgba(10,14,26,0.95) 0%, rgba(10,14,26,0.7) 40%, rgba(10,14,26,0) 100%)",
  native: {
    colors: ["rgba(10,14,26,0.95)", "rgba(10,14,26,0.7)", "rgba(10,14,26,0)"],
    locations: [0, 0.4, 1],
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
  },
};

/** Focus-glow elevation preset — the cyan (accent2) "interaction" glow used on
 *  focus/hover only (never resting). Native gets a real shadow object; web/TV
 *  return {} because CSS owns box-shadow there (and TV strips shadows for perf),
 *  so spreading is a safe no-op. Web components apply GLOW_WEB inline instead. */
export const glow = Platform.select({
  native: {
    shadowColor: colors.accent2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  default: {},
});

/** Inline box-shadow string for web focus/hover glow (accent2 cyan). A crisp
 *  1px inner ring + a broad soft halo so the interaction reads clearly at a
 *  glance (the bare 16px halo was too faint over dark posters).
 *  TV strips this — gate callers on isTV(). */
export const GLOW_WEB =
  "0 0 0 1px " + accent2Alpha(0.6) + ", 0 0 24px 2px " + accent2Alpha(0.55);
// → 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55)

/** Focus ring — cyan (accent2) outline for keyboard/remote focus. `offset` is
 *  the gap between element edge and ring (CSS outline-offset / RN inset). */
export const focusRing = { color: colors.accent2, width: 2, offset: 2 };

/** Motion timings (ms) + standard easing for web/native transitions.
 *  TV ignores motion entirely (no animations on old webOS Chromium). */
export const motion = { fast: 120, base: 200, slow: 320 };
export const easing = "cubic-bezier(0.4,0,0.2,1)";

/** Reference hero heights (pre-ss) — pass through ss()/useScale at call sites
 *  to scale on TV/web. TV runs tallest for 10-foot viewing. */
export const heroHeights = { web: 420, native: 340, tv: 480 };

/** Line-icon glyph box sizes (pre-ss) for the inline-SVG / RN Icon set. */
export const iconSizes = { sm: 16, md: 20, lg: 28 };

/** Translucent dark wash for scrims/badges over art (bg #0A0E1A → 10,14,26). */
export const overlay = "rgba(10,14,26,0.72)";

export default {
  colors, gradient, radii, space, fonts,
  fontSizes, fontWeights, lineHeights, zIndex, shadows, accentAlpha,
  accent2Alpha, scrim, glow, GLOW_WEB, focusRing, motion, easing,
  heroHeights, iconSizes, overlay,
};

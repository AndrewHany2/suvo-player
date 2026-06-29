// @ts-check
/**
 * Subtitle styling + delay-offset helpers.
 *
 * PURE module: no React, no DOM, no engine imports. Produces plain values the
 * web <video> path (::cue / VTT styling) and the native subtitle path can each
 * consume. Persistence of the live preferences is owned by S1's
 * usePlayerPreferences — this module only describes the *shape* and the maths.
 */

/**
 * @typedef {Object} SubtitleStyle
 * @property {number} fontSize        - Subtitle font size in px (reference, pre-scale).
 * @property {string} color           - Text colour (hex/rgb string).
 * @property {string} backgroundColor - Cue background colour (hex/rgb string).
 * @property {number} opacity         - Cue background opacity, 0..1.
 * @property {'bottom'|'middle'} position - Vertical placement of the cue block.
 * @property {'none'|'outline'|'drop-shadow'} edgeStyle - Text edge treatment for legibility.
 */

/** Default subtitle appearance — Aurora-flavoured, high-legibility defaults.
 *  @type {SubtitleStyle} */
export const DEFAULT_SUBTITLE_STYLE = {
  fontSize: 22,
  color: "#EAF0FF",          // ice — matches tokens.colors.text
  backgroundColor: "#0A0E1A", // midnight — matches tokens.colors.bg
  opacity: 0.6,
  position: "bottom",
  edgeStyle: "outline",
};

/** Delay-offset bounds (ms). Offsets outside this range are almost certainly a
 *  mistake and the players can't usefully act on them. */
export const OFFSET_MIN_MS = -10000;
export const OFFSET_MAX_MS = 10000;

/** Allowed values, exported so settings UIs can build their controls without
 *  hard-coding strings that must stay in sync with the typedef. */
export const SUBTITLE_POSITIONS = /** @type {const} */ (["bottom", "middle"]);
export const SUBTITLE_EDGE_STYLES = /** @type {const} */ (["none", "outline", "drop-shadow"]);

/**
 * Clamp a delay offset (ms) into the supported range.
 * Non-finite input clamps to 0 so a bad value never propagates to the engine.
 *
 * @param {number} ms
 * @returns {number} Offset in [OFFSET_MIN_MS, OFFSET_MAX_MS].
 */
export function clampOffset(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return 0;
  if (ms < OFFSET_MIN_MS) return OFFSET_MIN_MS;
  if (ms > OFFSET_MAX_MS) return OFFSET_MAX_MS;
  return ms;
}

/**
 * Format a delay offset (ms) as a signed seconds label, e.g. '+1.5s', '0s',
 * '-2.25s'. Trailing zeros are trimmed (1500ms -> '+1.5s', 1000ms -> '+1s').
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatOffset(ms) {
  const n = typeof ms === "number" && !Number.isNaN(ms) ? ms : 0;
  if (n === 0) return "0s";
  const sign = n > 0 ? "+" : "-";
  const secs = Math.abs(n) / 1000;
  // Up to 3 decimals (ms precision), trimmed of trailing zeros / dot.
  const text = secs.toFixed(3).replace(/\.?0+$/, "");
  return `${sign}${text}s`;
}

/** Edge treatments expressed as a CSS text-shadow value (web ::cue). */
function edgeToTextShadow(edgeStyle) {
  switch (edgeStyle) {
    case "outline":
      // Faux outline via four offset black shadows — works on ::cue where
      // -webkit-text-stroke is unreliable.
      return "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000";
    case "drop-shadow":
      return "0 2px 4px rgba(0,0,0,0.8)";
    case "none":
    default:
      return "none";
  }
}

/** Convert a hex/rgb colour + opacity into an rgba() string for the cue bg.
 *  Falls back gracefully if the input isn't a 6-digit hex. */
function withAlpha(color, opacity) {
  const a = typeof opacity === "number" ? Math.min(1, Math.max(0, opacity)) : 1;
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(color));
  if (m) {
    const int = parseInt(m[1], 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r},${g},${b},${a})`;
  }
  // Non-hex (already rgb()/named): return as-is; opacity handled by caller's CSS.
  return color;
}

/**
 * Build a CSS object for styling web text tracks (applied to a generated
 * `::cue` rule, or inline to a custom cue renderer). Returns plain CSS values
 * (strings) so the caller can serialise to a stylesheet or a style attribute.
 *
 * @param {Partial<SubtitleStyle>} [style]
 * @returns {{
 *   fontSize: string,
 *   color: string,
 *   backgroundColor: string,
 *   textShadow: string,
 *   lineAlign: 'start'|'center',
 * }}
 */
export function toCssTextTrackStyle(style = {}) {
  const s = { ...DEFAULT_SUBTITLE_STYLE, ...style };
  return {
    fontSize: `${s.fontSize}px`,
    color: s.color,
    backgroundColor: withAlpha(s.backgroundColor, s.opacity),
    textShadow: edgeToTextShadow(s.edgeStyle),
    // 'center' lifts cues toward the middle; 'start' keeps the default bottom.
    lineAlign: s.position === "middle" ? "center" : "start",
  };
}

/**
 * Build a props bag for native subtitle rendering. RN video libraries vary, so
 * this returns a neutral descriptor the native player can map onto whichever
 * subtitle API is available (react-native-video textTracks style, a custom
 * overlay, etc.). Numeric where the native side wants numbers.
 *
 * @param {Partial<SubtitleStyle>} [style]
 * @returns {{
 *   fontSize: number,
 *   color: string,
 *   backgroundColor: string,
 *   opacity: number,
 *   position: 'bottom'|'middle',
 *   edgeStyle: 'none'|'outline'|'drop-shadow',
 * }}
 */
export function toNativeSubtitleProps(style = {}) {
  const s = { ...DEFAULT_SUBTITLE_STYLE, ...style };
  return {
    fontSize: s.fontSize,
    color: s.color,
    backgroundColor: s.backgroundColor,
    opacity: typeof s.opacity === "number" ? Math.min(1, Math.max(0, s.opacity)) : 1,
    position: s.position === "middle" ? "middle" : "bottom",
    edgeStyle: SUBTITLE_EDGE_STYLES.includes(s.edgeStyle) ? s.edgeStyle : "outline",
  };
}

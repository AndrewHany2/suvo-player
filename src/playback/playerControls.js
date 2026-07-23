/**
 * Shared player-control vocabulary — one source of truth for the icon glyph and
 * the human wording of every playback control, so the SAME function reads
 * identically on every surface (web/Electron, TV, expo-native, VLC-native).
 *
 * The four players can't share components (web uses DOM + CSS menus, native uses
 * react-native primitives + Modal sheets, TV uses a custom D-pad-driven row), but
 * they CAN share the two things a non-technical viewer actually perceives: which
 * glyph a control shows, and what it's called. Centralising those here is what
 * makes the controls feel like one product instead of four look-alikes.
 *
 * Design intent (see docs/DESIGN.md — "consumer-simple, never power-user"):
 *   - Primary row is ruthlessly small on every surface: Play · Subtitles ·
 *     Fullscreen · More. Everything else (speed, audio, fit, sleep, stats, PiP,
 *     quality, cast, picture) lives behind the single `more` (tune) affordance.
 *   - Wording is plain, not jargon: "Fit to screen" not "Aspect ratio",
 *     "Video stats" not "Stats for nerds", "More" not "Settings".
 *   - `label` is the accessible name AND the desktop tooltip AND the on-screen
 *     text where a surface shows one (TV row, native "More" sheet rows).
 *
 * Icon names map to the shared Icon component (Icon.web.jsx / Icon.native.jsx);
 * both sides implement the same name set, so a name chosen here renders on all
 * targets. Keep this list and the Icon components in lockstep.
 */

/** Canonical icon glyph per control. */
export const controlIcon = {
  close: "close",
  play: "play",
  pause: "pause",
  prevChannel: "back",
  nextChannel: "chevron-right",
  nextEpisode: "play",
  startOver: "back",
  subtitles: "cc",
  audio: "audio",
  speed: "speed",
  fit: "aspect",
  quality: "settings",
  fullscreen: "fullscreen",
  more: "tune",
  sleep: "timer",
  stats: "signal",
  pip: "pip",
  cast: "cast",
  mute: "mute",
  volume: "audio",
};

/**
 * Canonical human label per control — accessible name, tooltip, and any visible
 * text. Deliberately plain so a non-technical viewer knows what each does.
 */
export const controlLabel = {
  close: "Close",
  play: "Play",
  pause: "Pause",
  prevChannel: "Previous channel",
  nextChannel: "Next channel",
  nextEpisode: "Next episode",
  startOver: "Start over",
  subtitles: "Subtitles",
  audio: "Audio",
  speed: "Playback speed",
  fit: "Fit to screen",
  quality: "Quality",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  more: "More",
  sleep: "Sleep timer",
  stats: "Video stats",
  pip: "Picture-in-picture",
  cast: "Cast / AirPlay",
  mute: "Mute",
  unmute: "Unmute",
  volume: "Volume",
};

/**
 * "More" sheet section order — the single, identical grouping every surface uses
 * for its secondary controls. A surface renders only the rows it actually
 * supports (e.g. VLC-native has no PiP/stats/cast), but never in a different
 * order, so muscle memory carries across devices.
 */
export const MORE_ORDER = ["speed", "audio", "fit", "quality", "sleep", "pip", "cast", "stats"];

/**
 * Plain-language name for a video fit/resize mode. The engines all cycle the same
 * three modes (contain / cover / fill); a non-technical viewer reads "Fit / Zoom /
 * Stretch" far more readily than the raw CSS-ish values. Shared so the trailing
 * value on the "Fit to screen" control is worded identically on every surface.
 * @param {string} mode - "contain" | "cover" | "fill"
 * @returns {string}
 */
export function fitLabel(mode) {
  if (mode === "cover") return "Zoom";
  if (mode === "fill") return "Stretch";
  return "Fit";
}

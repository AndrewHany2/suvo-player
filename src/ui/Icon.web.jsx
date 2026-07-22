/**
 * Icon — inline-SVG line-icon set (web/desktop AND webOS TV).
 *
 * Renders a raw inline <svg>, which old webOS Chromium handles fine. We
 * deliberately avoid anything the TV bundle can't do: NO CSS custom properties
 * (var()), NO animations, NO box-shadow. Colour is driven by the `color` prop
 * applied directly as the stroke (we set `stroke="currentColor"` on the paths
 * and `color` on the <svg>), so a single prop recolours every stroke.
 *
 * Same contract as Icon.native.jsx: <Icon name size color ...rest />. Sizing is
 * a plain px number (already scaled by the caller via ss() where needed); the
 * 24×24 viewBox scales to whatever `size` is. Unknown names render nothing
 * (null) rather than throwing, so a typo degrades gracefully on a TV grid.
 */
import { memo } from "react";
import { colors } from "./tokens";

// Each entry is the inner markup of a 24×24, stroke-based line icon. Paths use
// currentColor so the <svg color> prop recolours them; no fills except where a
// shape reads better filled (play triangle, star) — those use currentColor too.
// Keep these minimal and geometrically correct.
const PATHS = {
  // Right-pointing filled triangle.
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  // Plus / add.
  plus: <path d="M12 5v14M5 12h14" />,
  // Download: down-arrow into a tray/baseline.
  download: <path d="M12 3v11M8 10l4 4 4-4M5 20h14" />,
  // Back / arrow-left.
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  // Chevron pointing right.
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  // House: roof peak + body — the Home tab glyph.
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
    </>
  ),
  // Five-point star (filled with currentColor so ratings read as a solid glyph).
  star: (
    <path
      d="M12 3l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.72.99-5.8-4.21-4.1 5.82-.85z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // Film strip: frame + sprocket-hole columns.
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  // TV / monitor: screen + stand.
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  // Warning triangle with exclamation.
  warning: (
    <>
      <path d="M12 4L3 19h18z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  // Search / magnifier.
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  // Eye (password reveal): almond outline + iris.
  eye: (
    <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Eye-off (password hide): eye with a diagonal slash.
  "eye-off": (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </>
  ),
  // Settings gear: ring + eight teeth (approximated as spokes for a clean line look).
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  // Audio / speaker with one sound wave.
  audio: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </>
  ),
  // Closed-caption: rounded frame with two "c" arcs.
  cc: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3" />
    </>
  ),
  // Speed: gauge arc with a needle.
  speed: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 14l4-3" />
    </>
  ),
  // Aspect: expand-frame corner brackets.
  aspect: (
    <path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3" />
  ),
  // Cast: screen outline + broadcast waves.
  cast: (
    <>
      <path d="M4 6h16v12h-5" />
      <path d="M4 12a5 5 0 0 1 5 5M4 16a2 2 0 0 1 2 2" />
      <path d="M4 20h.01" />
    </>
  ),
  // Picture-in-picture: outer screen + inner window.
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Info: circle with an "i".
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  // Sleep timer: crescent moon.
  timer: <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5z" />,
  // Tune: three slider rows with knobs.
  tune: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h6M14 18h6" />
      <circle cx="15" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // Brightness: sun — centre disc + eight rays.
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  // Contrast: circle with one half filled.
  contrast: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
  // Pause: two vertical bars.
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Fullscreen (enter): diagonal expand arrows to the four corners.
  fullscreen: <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />,
  // Fullscreen exit: arrows drawn inward.
  "fullscreen-exit": <path d="M20 8h-6V2M14 8l7-7M4 16h6v6M10 16l-7 7" />,
  // Muted speaker: cone + an "x".
  mute: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </>
  ),
  // Checkmark.
  check: <path d="M5 13l4 4L19 7" />,
  // Close / X.
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Series / stacked collection: two offset rounded rectangles.
  series: (
    <>
      <rect x="7" y="3" width="14" height="14" rx="2" />
      <path d="M3 7v12a2 2 0 0 0 2 2h12" />
    </>
  ),
  // History / clock: ring + hands.
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // User / person: head + shoulders.
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  // Signal / broadcast: center dot + two arcs.
  signal: (
    <>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9" />
    </>
  ),
};

function Icon({ name, size = 20, color = colors.text, ...rest }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // `color` sets currentColor for every stroke/fill in the paths above; the
      // group below carries the shared stroke styling so each path stays terse.
      style={{ color, display: "inline-block", flexShrink: 0 }}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {body}
      </g>
    </svg>
  );
}

export default memo(Icon);

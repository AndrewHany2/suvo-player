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
  // Back / arrow-left.
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  // Chevron pointing right.
  "chevron-right": <path d="M9 6l6 6-6 6" />,
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
  // Settings gear: ring + eight teeth (approximated as spokes for a clean line look).
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  // Checkmark.
  check: <path d="M5 13l4 4L19 7" />,
  // Close / X.
  close: <path d="M6 6l12 12M18 6L6 18" />,
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

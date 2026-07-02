import { memo, useState } from "react";
import { colors, focusRing, GLOW_WEB, motion, easing, overlay, radii, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import Icon from "../../ui/Icon";

import { isTV } from "../../utils/isTV";

/**
 * Poster card — web/TV (raw DOM, no Tamagui). Shared across Movies/Series/LiveTV.
 *
 * Uses an EXPLICIT poster height (width × 3/2) rather than `aspect-ratio`, which
 * isn't supported on older webOS Chromium and collapsed the box there.
 *
 * Aurora interaction language: the cyan (accent2) ring + soft glow are shown
 * ONLY on focus/hover, never at rest — resting state is a subtle 1px border.
 *  - Focus (isFocused, TV/keyboard): instant cyan ring. On web it also gets the
 *    GLOW_WEB box-shadow; on TV there is NO shadow (old Chromium strips it).
 *  - Hover (web only): the cyan ring comes from the global `.lumen-poster-card`
 *    :hover rule in AppNavigator; the matching soft glow is injected once below
 *    (web-only, gated on !isTV()) so it can't shift layout like a transform.
 */
const tv = isTV();

// One-time inject the hover glow (web only). The hover RING already lives in the
// global `.lumen-poster-card:hover` rule (AppNavigator); this adds the matching
// soft cyan box-shadow on the inner poster box. TV strips shadows, so skip it.
let hoverGlowInjected = false;
function ensureHoverGlowRule() {
  if (hoverGlowInjected || tv || typeof document === "undefined") return;
  hoverGlowInjected = true;
  const el = document.createElement("style");
  // Hover = same weight as focus: a clear 2px cyan border + soft glow on the
  // poster image (box-sizing:border-box, so the 2px border doesn't shift layout).
  el.textContent =
    "body:not(.keyboard-nav) .lumen-poster-card:hover .lumen-poster-box{box-shadow:" +
    GLOW_WEB +
    ";border-color:" +
    focusRing.color +
    ";border-width:" +
    focusRing.width +
    "px}";
  document.head.appendChild(el);
}

function PosterCardWeb({ item, onPress, isFocused, width = 200 }) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  if (!tv) ensureHoverGlowRule();
  const posterH = Math.round(width * 1.5);
  const poster = item.stream_icon || item.cover || item.movie_image || item.backdrop_path || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ""
    ? (typeof ratingValue === "number" ? ratingValue.toFixed(1) : ratingValue)
    : null;
  // Hold the badges back until there's something behind them: either the poster
  // has decoded, or there's no poster to wait for. Otherwise, on first paint the
  // dark loading box reads as the page background and the badges appear to float.
  const showBadges = !poster || imageError || imageLoaded;

  return (
    <div
      className="lumen-poster-card"
      onClick={() => onPress?.(item)}
      data-tv-focused={isFocused ? "true" : undefined}
      style={{
        width,
        cursor: "pointer",
        borderRadius: radii.md,
        // No OUTER ring. Focus/hover is shown ONLY by the inner poster-box border
        // + glow below. The old outer outline (outline-offset:3) wrapped the whole
        // card incl. the title and got cropped by the shelf rail's overflow:hidden.
      }}
    >
      <div
        className="lumen-poster-box"
        style={{
          width,
          height: posterH,
          borderRadius: radii.card,
          backgroundColor: colors.surface,
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
          // Resting: subtle hairline border, NO glow/ring. Focus: cyan ring +
          // (web only) soft glow. Hover glow is injected via CSS above.
          border: `1px solid ${isFocused ? focusRing.color : colors.border}`,
          boxShadow: isFocused && !tv ? GLOW_WEB : "none",
          transition: tv ? undefined : `box-shadow ${motion.base}ms ${easing}, border-color ${motion.fast}ms ${easing}`,
        }}
      >
        {/* Always-present placeholder so a loading/empty card reads as a card,
            not a floating badge. The poster fades in over it once decoded. */}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
          <Icon name="film" color={colors.muted} size={ss(32)} />
        </div>
        {poster && !imageError && (
          <img src={poster} alt={item.name} loading="lazy" draggable={false}
            onLoad={() => setImageLoaded(true)} onError={() => setImageError(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: imageLoaded ? 1 : 0, transition: "opacity 0.2s ease", WebkitUserDrag: "none", userSelect: "none" }} />
        )}
        {showBadges && (
          <div style={{ position: "absolute", top: 8, right: 8, backgroundColor: overlay, borderRadius: radii.sm / 2, padding: "2px 5px" }}>
            <span style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 9, fontWeight: fontWeights.bold, letterSpacing: 0.5 }}>HD</span>
          </div>
        )}
        {showBadges && ratingLabel && (
          <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 3, backgroundColor: overlay, borderRadius: radii.sm / 2, padding: "2px 5px" }}>
            <Icon name="star" color={colors.rating} size={ss(10)} />
            <span style={{ color: colors.rating, fontFamily: fonts.body, fontSize: 9, fontWeight: fontWeights.bold }}>{ratingLabel}</span>
          </div>
        )}
      </div>
      <div style={{
        width, color: colors.text, fontFamily: fonts.body, fontSize: 13, fontWeight: fontWeights.medium, marginTop: 8, lineHeight: "17px", height: 34,
        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>{item.name}</div>
    </div>
  );
}

export default memo(PosterCardWeb);

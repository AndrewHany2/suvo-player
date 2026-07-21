import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

/**
 * Thin TV hero billboard. Renders exactly ONE backdrop <img> for the currently
 * focused item so it costs a single slot against the poster image budget. The
 * parent (VirtualShelves.tv) debounces which item is passed here on fast D-pad
 * travel, so this stays intentionally dumb.
 */
export default function HeroTV({ item, height = 300 }) {
  const backdrop = item?.backdrop_path?.[0] || item?.cover || item?.stream_icon || null;
  return (
    <div
      className="tvl-hero"
      style={{
        position: "relative",
        height: ss(height),
        overflow: "hidden",
        background: colors.bg,
        contain: "layout style paint",
      }}
    >
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }}
        />
      )}
      {/* Netflix-style scrim: fade the bottom into the page bg so the title reads
          cleanly and the billboard blends into the shelves below it. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: `linear-gradient(to top, ${colors.bg} 2%, rgba(10,14,26,0.35) 40%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: ss(48),
          bottom: ss(56),
          right: ss(48),
          color: colors.text,
          fontFamily: fonts.display,
          fontWeight: fontWeights.bold,
          fontSize: ss(64),
          lineHeight: 1.05,
          letterSpacing: -1,
        }}
      >
        {item?.name || ""}
      </div>
    </div>
  );
}

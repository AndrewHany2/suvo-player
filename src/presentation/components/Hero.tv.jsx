import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

/**
 * Thin TV hero billboard. Renders exactly ONE backdrop <img> for the currently
 * focused item so it costs a single slot against the poster image budget. The
 * parent (VirtualShelves.tv) debounces which item is passed here on fast D-pad
 * travel, so this stays intentionally dumb.
 */
export default function HeroTV({ item }) {
  const backdrop = item?.backdrop_path?.[0] || item?.cover || item?.stream_icon || null;
  return (
    <div
      className="tvl-hero"
      style={{
        position: "relative",
        height: ss(300),
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
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: ss(48),
          bottom: ss(32),
          right: ss(48),
          color: colors.text,
          fontFamily: fonts.display,
          fontWeight: fontWeights.bold,
          fontSize: ss(40),
          letterSpacing: -0.5,
          textShadow: "none",
        }}
      >
        {item?.name || ""}
      </div>
    </div>
  );
}

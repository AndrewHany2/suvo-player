import { colors, radii } from "../../ui/tokens";

/**
 * Poster-shaped loading placeholder — web/TV (raw DOM, no Tamagui).
 *
 * Mirrors PosterCard.web's box (an explicit width × 1.5 poster + a title line)
 * so a loading rail reserves the exact footprint the real posters will occupy —
 * the swap to real cards then happens with no layout shift.
 *
 * A single soft highlight sweeps across the poster box. The sweep is a
 * translateX animation promoted to its own compositor layer (translateZ(0) in
 * both keyframes + will-change), so it keeps animating on the GPU/compositor
 * thread even while the main thread is blocked parsing the incoming catalog —
 * the same technique that keeps the boot spinner spinning on old webOS.
 */
let skelKeyframesInjected = false;
export function ensureSkeletonKeyframes() {
  if (skelKeyframesInjected || typeof document === "undefined") return;
  skelKeyframesInjected = true;
  const el = document.createElement("style");
  el.textContent =
    "@keyframes _skel_sweep{from{transform:translateZ(0) translateX(-100%)}to{transform:translateZ(0) translateX(100%)}}";
  document.head.appendChild(el);
}

/**
 * A skeleton grid — a flex-wrap of SkeletonPoster laid out in the same geometry
 * as the real poster grid, so a full-screen/category grid load shows the same
 * loading vocabulary as the shelf rails (instead of a lone centered spinner).
 */
export function SkeletonPosterGrid({ width = 200, count = 18, gap = 16, paddingH = 96, paddingV = 32 }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap,
        paddingLeft: paddingH,
        paddingRight: paddingH,
        paddingTop: paddingV,
        paddingBottom: paddingV,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonPoster key={i} width={width} />
      ))}
    </div>
  );
}

export default function SkeletonPoster({ width = 200 }) {
  ensureSkeletonKeyframes();
  const posterH = Math.round(width * 1.5);
  return (
    <div style={{ width }} aria-hidden="true">
      <div
        style={{
          width,
          height: posterH,
          borderRadius: radii.card,
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `linear-gradient(100deg, transparent 20%, ${colors.surface2} 50%, transparent 80%)`,
            animation: "_skel_sweep 1.4s ease-in-out infinite",
            willChange: "transform",
          }}
        />
      </div>
      {/* Stand-in for the 2-line title block so the row height matches a real card. */}
      <div
        style={{
          width: Math.round(width * 0.8),
          height: 12,
          marginTop: 10,
          borderRadius: radii.sm / 2,
          backgroundColor: colors.surface,
        }}
      />
    </div>
  );
}

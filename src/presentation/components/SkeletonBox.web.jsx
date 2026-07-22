import { colors, radii } from "../../ui/tokens";
import { ensureSkeletonKeyframes } from "./SkeletonPoster.web";

/**
 * SkeletonBox — a single rounded loading placeholder of arbitrary size (web/TV).
 *
 * The poster/live skeletons cover content rails; this is the general-purpose
 * primitive for everything else that loads (profile avatars, chips, thumbnails).
 * It shares the exact sweep vocabulary as SkeletonPoster.web — a soft highlight
 * promoted to its own compositor layer (translateZ(0) + will-change) so it keeps
 * animating on the GPU thread even while the main thread parses incoming data,
 * and drops to a static box under prefers-reduced-motion (see the injected
 * keyframes' media query). Sizes are raw px; callers pass ss()-scaled values.
 */
export default function SkeletonBox({ width, height, radius = radii.card, style }) {
  ensureSkeletonKeyframes();
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.border}`,
        overflow: "hidden",
        position: "relative",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div
        className="_skel_sweep_el"
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
  );
}

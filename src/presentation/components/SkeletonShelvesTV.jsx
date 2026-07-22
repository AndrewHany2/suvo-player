import { colors, radii } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

/**
 * SkeletonShelvesTV — the 10-foot initial-load placeholder for the TV browse
 * screens (Movies / Series / Live), replacing the lone centered spinner.
 *
 * Renders a few title-line + poster-rail rows in the same geometry as the real
 * VirtualShelvesTV rails (INSET inset, POSTER_W cards) so the swap to real
 * content lands with no layout jump. Poster cells reuse the shared `.tvl-skel`
 * class from tvl.css, which already carries the compositor-thread sweep, the
 * prefers-reduced-motion off-switch, and the webOS/Tizen aspect-ratio fallback —
 * so nothing here needs a JS animation or a value that the file:// bundle can't
 * render. Purely presentational: no focusable targets (the real D-pad grid
 * mounts when data arrives), so it's safe to drop in ahead of the focus system.
 *
 * Kept as a plain (suffix-less) module imported only by the `.tv` screens, so it
 * never reaches the web or native bundles.
 */
const INSET = 96; // design px — matches VirtualShelvesTV's rail inset
const POSTER_W = 340; // design px — matches VirtualShelvesTV's card width
const GAP = 12;
const ROWS = 3;
const CARDS_PER_ROW = 6;

function SkeletonRailTV({ wide }) {
  // Live channels are 16:9 cards (fewer, wider per row); Movies/Series are 2:3
  // posters. The .tvl-skel--wide modifier switches the cell aspect ratio.
  const cardW = wide ? POSTER_W * 1.1 : POSTER_W;
  const count = wide ? CARDS_PER_ROW - 1 : CARDS_PER_ROW;
  return (
    <div style={{ paddingTop: ss(28), paddingBottom: ss(4) }}>
      <div
        aria-hidden="true"
        style={{
          width: ss(POSTER_W * 0.7),
          height: ss(26),
          margin: `0 ${ss(INSET)}px ${ss(16)}px`,
          borderRadius: radii.sm,
          backgroundColor: colors.surface,
        }}
      />
      <div
        style={{
          display: "flex",
          gap: ss(GAP),
          paddingLeft: ss(INSET),
          paddingRight: ss(INSET),
          overflow: "hidden",
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={`sk${i}`} style={{ flex: `0 0 ${ss(cardW)}px` }}>
            <div className={wide ? "tvl-skel tvl-skel--wide" : "tvl-skel"} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SkeletonShelvesTV({ wide = false }) {
  return (
    <div aria-hidden="true" style={{ paddingTop: ss(36) }}>
      {Array.from({ length: ROWS }).map((_, i) => (
        <SkeletonRailTV key={`row${i}`} wide={wide} />
      ))}
    </div>
  );
}

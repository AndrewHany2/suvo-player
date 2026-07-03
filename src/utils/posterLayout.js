// Responsive poster sizing shared by the native Movies/Series screens.
//
// Mirrors the web/Electron VirtualGrid density model: instead of a hardcoded
// column count, the number of posters is DERIVED from a target poster width, so
// the layout adapts per device — a phone lands ~3 across, a tablet more — and
// posters resize to fill. Target widths are raw device px (NOT ss()-scaled) so
// larger screens genuinely gain columns rather than just inflating a fixed
// count the way an ss()-scaled target would.

// Target poster widths (raw px). Grid posters sit a touch smaller than shelf
// posters, matching the web grid (itemWidth ss(240)) vs shelf (ss(290)) ratio.
export const GRID_TARGET_W = 104;
export const SHELF_TARGET_W = 150;

/**
 * Category grid: derive the column count from a target width, then size each
 * card to fill the row exactly (like the web grid's justify-fill).
 *
 * @param {number} availWidth  Row width already minus outer padding.
 * @param {object} opts
 * @param {number} opts.target Target/ideal poster width.
 * @param {number} opts.gap    Gap between columns.
 * @param {number} [opts.min]  Minimum column count (default 2).
 * @returns {{ cols: number, cardW: number }}
 */
export function posterGrid(availWidth, { target, gap, min = 2 }) {
  const cols = Math.max(min, Math.floor((availWidth + gap) / (target + gap)));
  const cardW = Math.floor((availWidth - gap * (cols - 1)) / cols);
  return { cols, cardW };
}

/**
 * Horizontal shelf: size posters so a whole number fit the width with ~a third
 * of a poster peeking past the edge as a scroll affordance. Bigger screens get
 * both more and larger posters.
 *
 * @param {number} availWidth  Shelf width already minus outer padding.
 * @param {object} opts
 * @param {number} opts.target Target/ideal poster width.
 * @param {number} opts.gap    Gap between posters.
 * @param {number} [opts.min]  Minimum visible count (default 2).
 * @returns {number} Poster width in px.
 */
export function posterShelfWidth(availWidth, { target, gap, min = 2 }) {
  const count = Math.max(min, Math.floor((availWidth + gap) / (target + gap)));
  // Divide by count + 0.33 so ~a third of the next poster peeks into view.
  return Math.floor((availWidth - gap * count) / (count + 0.33));
}

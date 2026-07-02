# Render from the called API — drop virtualization windowing (TV)

**Date:** 2026-07-02
**Status:** Approved (pending spec review)
**Branch:** chore/ponytail-audit-deadcode

## Problem

The TV shelf/grid rendering has a windowing layer on top of the API's own
pagination. On webOS/Tizen (`npm run sim:lg`) the **horizontal rail windowing**
in `VirtualShelves.tv.jsx` intermittently mounts blank posters — the mount
window slides ahead of the real scroll and unmounts still-visible cards. The
windowing math (`shelfWindow.js` + `railFirst`/`railEdge` scroll reads + spacer
padding) is complex and the source of repeated debugging pain.

The API already hands the UI a small, bounded slice:

- **Shelves:** `handleShelfVisible(catId)` loads the first page of a rail;
  `handleLoadMore(catId)` appends the next page. Rails hold ~8–16 items.
- **Grids:** the drilled-in category page holds the full category list, but the
  screen state already carries a dormant `display` cap (`MOV_PAGE`/`SER_PAGE`=24,
  `CH_PAGE`=40) that predates the switch to `VirtualGridTV`.

**Goal:** render straight from what the API/pagination has loaded, deleting the
extra windowing math, while keeping the webOS 3–4 / Tizen 2016 memory floor safe.

## Constraints

- Mounted decoded-image count must stay bounded on the low-memory TV floor.
- Big providers can expose 100+ categories → mounting every rail eagerly (and
  firing 100 concurrent category fetches) is not acceptable.
- Behaviour (D-pad focus, hero, lazy-load, load-more, focus scroll-into-view)
  must be preserved.

## Design

### 1. Shelf rails — de-virtualize the horizontal axis (`VirtualShelves.tv.jsx`)

**Remove:**
- `railFirst` / `railFirstRef` state and its `onRailScroll` update.
- `focusedRailWindow(...)` usage and the horizontal `windowFromAnchor(...)` for
  idle rails.
- The left/right spacer `<div style={{ flex: '0 0 Npx' }} />` padding.

**Change:** each rail renders **all loaded items** directly — `items.map(...)`
(keyed by absolute column index, as today, to survive duplicate stream_ids).
Bounded because the API pages rails to ~8–16 items.

**Keep:**
- Vertical row-windowing (`vWin` via `scrollAnchor` + `windowFromAnchor`), which
  drives `onShelfVisible` lazy-load and bounds mounted rails.
- D-pad focus, focused-card `scrollIntoView`, hero debounce swap, poster
  prefetch, `handleLoadMore` trigger (`nearRailEnd`).
- Scroll-hint chevrons: a **minimal** `onScroll` that computes only `railEdges`
  for the visible rail's fade hints. This is a UI read, not virtualization.

### 2. Category / channel grids — grow-on-scroll (`PagedGridTV`)

Replace `VirtualGridTV` with a new `PagedGridTV` (`src/presentation/components/
PagedGrid.tv.jsx`), used by **Movies, Series, and Live TV** grids.

- Renders `items.slice(0, display)` in a plain CSS grid
  (`grid-template-columns: repeat(cols, 1fr)`, `gap`).
- `display` starts at `pageSize` and an effect grows it by one page when
  `focusIndex >= display - cols` (focus nearing the rendered end),
  clamped to `items.length`.
- Focused-cell `scrollIntoView({ block: "nearest" })` on `focusIndex` change,
  via a ref on the focused cell — replaces the manual row/scrollTop math (every
  rendered cell is real DOM).

**Props:** `{ items, cols, gap, focusIndex, pageSize, renderItem, className }`.
Dropped vs `VirtualGridTV`: `rowHeight`, `onEndReached`, and all virtualization
internals (`BUFFER_ROWS`, `range`, `recalc`, padding rows).

**Call-site wiring:** the three screens already store `display` in page/grid
state and reset it in their filter handlers (`onFilterEnter` sets
`display: Math.min(PAGE, filtered.length)`). Grow-on-scroll revives that field:
pass `display` as `pageSize`/initial and let `PagedGridTV` own the growth, OR
keep `display` in screen state and have the grid report growth back. **Chosen:**
`PagedGridTV` owns `display` internally, seeded by `pageSize`, and resets when
`items` identity changes (new category/filter). Screen `display` state is
removed to avoid two owners. Focus bounds continue to use full `filtered.length`
(focus may roam the whole list; only rendering is capped).

`VirtualGrid.tv.jsx` is deleted after the three swaps.

### 3. `shelfWindow.js` cleanup

- **Delete** `focusedRailWindow` (now dead) and its unit tests in
  `shelfWindow.test.js`.
- **Keep:** `windowFromAnchor` (vertical vWin), `scrollAnchor`, `railEdges`
  (chevrons), `clampCol`, `nearRailEnd`.

## Components / boundaries

- `PagedGridTV` — one purpose: render a growing page of a flat item list with
  D-pad focus scroll-into-view. No API knowledge. Testable via focusIndex →
  rendered count.
- `VirtualShelves.tv.jsx` — unchanged responsibility (2-D shelf browser) minus
  the horizontal window internals.
- `shelfWindow.js` — pure windowing/focus math for the vertical axis + chevrons.

## Data flow (unchanged)

`useMovies`/`useSeries`/`useLiveTV` → screen state → `VirtualShelvesTV`
(rails, lazy-load via `onShelfVisible`, append via `onLoadMore`) and
`PagedGridTV` (drilled-in category, grows `display` on focus).

## Error handling

No new error paths. Empty/loading/failed states already handled by each screen
(`items: []`, spinner, empty message) upstream of these components.

## Testing

- Unit: `shelfWindow.test.js` updated (drop `focusedRailWindow`).
- Unit: `PagedGrid.tv` — focusIndex near the end grows the rendered slice by a
  page; changing `items` resets `display` to `pageSize`; slice never exceeds
  `items.length`.
- Manual: `npm run sim:lg` — Movies/Series shelves scroll with no blank posters;
  drilled-in grids scroll and load more; Live TV channel grid scrolls; Home
  (History) shelf + hero unaffected.

## Tradeoff accepted

Grow-on-scroll keeps scrolled-past posters mounted (bounded by scroll depth, not
total list length). It resets on every category/letter/text-filter change, and
deep D-pad scrolling through thousands of items is rare. On the oldest webOS
Chromium (no native `loading="lazy"`), a very deep scroll into one huge category
can mount more `<img>` than `VirtualGridTV` would have. Accepted per product
decision; letter/text filters and the reset-on-filter behaviour keep typical
lists small.

## Out of scope

- `VirtualGrid.web.jsx` (web build) — untouched.
- Detail / player views, non-TV surfaces.
- Changing API page sizes or lazy-load semantics in the `useMovies`/`useSeries`/
  `useLiveTV` hooks.

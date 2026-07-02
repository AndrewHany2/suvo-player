# Render all shelf rows — drop vertical shelf windowing (TV)

**Date:** 2026-07-02
**Status:** Approved (pending spec review)
**Branch:** feat/tv-render-all-shelf-rows

## Problem

`VirtualShelves.tv.jsx` still windows the **vertical axis**: only the shelf rows
near the scroll position are mounted (`vWin = windowFromAnchor(...)`), with
`paddingTop`/`paddingBottom` spacers standing in for the off-window rows. This is
the last true virtualization on TV, after the horizontal-rail and grid
(`VirtualGridTV`) windowing were removed and merged to `main`.

The vertical window does **two jobs at once**:

1. **Render gating** — mount/unmount shelf rows as they enter/leave the window.
2. **Fetch gating** — the lazy-load effect fires `onShelfVisible(catId)` only for
   rows inside `[vWin.start, vWin.end)`, so a category's first page loads just
   before its row scrolls into view.

We want to stop windowing the **render** (all rows mount, rows never unmount, no
blank-rail symptom) while keeping fetch bounded. Eager-loading every category is
not acceptable: `shelves = cats.map(...)` in `useMovies.js` means one shelf per
category, and big IPTV providers expose 100+ movie categories — mounting every
rail fully would fire 100+ concurrent fetches and mount ~800–1600 `<img>` on the
low-memory webOS floor.

## Constraints

- Target floor: webOS 3–4 / Tizen 2016. webOS 3.x is Chromium 38 — **no
  `IntersectionObserver`** — so IO is not an available substitute for the window
  as a visibility detector. (The current window logic already exists specifically
  because it "replaces IntersectionObserver", per the file comment.)
- Behaviour must be preserved: D-pad focus, focused-card horizontal
  scroll-into-view, hero debounce swap, poster prefetch, chevron hints,
  `handleLoadMore`/`nearRailEnd` horizontal load-more, idle-rail scroll restore.
- Per-category fetching must stay scroll-gated (no fetch storm on 100+ categories).

## Key insight

On TV there is **no free scrolling** — the vertical `scrollTop` is *derived* from
focus (`scrollTop = ss(heroH) + focus.shelfAnchor * ROW_HEIGHT`, line 138). So the
existing `vWin` computation, which is a function of `focus.shelfAnchor`, already
tracks exactly "where the user is". Render gating and fetch gating are only
coupled because the same value drives both. Decoupling them is a matter of
feeding `vWin` to the fetch/prefetch effects only, and rendering the full list.

## Design

Single-file change: `src/presentation/components/VirtualShelves.tv.jsx`.

### Render — mount all rows

Replace the windowed render:

```jsx
<div style={{ paddingTop, paddingBottom }}>
  {shelves.slice(vWin.start, vWin.end).map((shelf, i) => {
    const shelfIdx = vWin.start + i;
    ...
```

with a full map (no padding spacers):

```jsx
<div>
  {shelves.map((shelf, shelfIdx) => {
    ...
```

Each row keeps its fixed `height: ROW_HEIGHT` and `contain: layout style paint`
wrapper. Because every row is present and fixed-height, row *i* naturally sits at
`heroH + i * ROW_HEIGHT`, so the vertical `scrollTop` formula (line 138) stays
correct unchanged. Delete the now-unused `paddingTop`/`paddingBottom`
declarations (lines 208–209).

### Fetch — keep `windowFromAnchor` as a pure fetch-gate

Keep the `windowFromAnchor(...)` computation and the lazy-load effect (lines
98–103) exactly as-is; it now gates **fetching**, not mounting. Rename the local
`vWin` → `fetchWin` (and its `.start`/`.end` uses in the lazy-load and prefetch
effects) so the name reflects that it no longer describes a render window. No
change to `shelfWindow.js` — `windowFromAnchor` and its unit tests are untouched.

### Prefetch — unchanged

The poster-prefetch effect (lines 110–123) continues to warm posters for rows in
`[fetchWin.start, fetchWin.end)` ahead of the cursor. No change.

### Unfetched rows

A category whose row has not yet been scrolled near (`items: null`) renders as its
title over an empty `ROW_HEIGHT` rail — the same visual as a not-yet-loaded
windowed row today. No skeleton shimmer is added (YAGNI): `SHELF_OVERSCAN = 1`
means the fetch fires one row ahead, so a row fills before it reaches the
viewport, exactly as now.

### Unchanged

D-pad (`move`), chevron hint edges (`railEdge`/`onRailScroll`), hero debounce
swap, `nearRailEnd` horizontal load-more, the "Apply scroll" effect's focused-rail
scroll-into-view and idle-rail `scrollLeft` restore, and all constants
(`SHELF_OVERSCAN`, `H_OVERSCAN`, `ROW_HEIGHT`, `CARD_W`, `STRIDE`, etc.).

## Components / boundaries

- `VirtualShelvesTV` — same responsibility (2-D shelf browser) and same prop
  signature. Internally: render is de-windowed; `windowFromAnchor` is demoted to a
  fetch/prefetch visibility gate.
- `shelfWindow.js` — untouched. `windowFromAnchor` keeps its meaning (a range
  around an anchor); only its call site's *purpose* narrows.
- `useMovies`/`useSeries`/`useLiveTV` + `HistoryScreen` — untouched.

## Data flow (unchanged)

`useMovies`/`useSeries` → screen state → `VirtualShelvesTV`. Lazy-load
(`onShelfVisible`) and horizontal append (`onLoadMore`) fire on the same triggers;
only the set of *mounted* rows changes (now: all of them).

## Error handling

No new error paths. Empty/loading/failed states are handled upstream per screen
(`items: []`, spinner, empty message) and per row (`items: null` → empty rail).

## Testing

- Unit: none added — no pure-logic change. `shelfWindow.test.js` still covers
  `windowFromAnchor` (now the fetch-gate math).
- Manual (`npm run sim:lg`):
  - Movies/Series shelf browse: vertical D-pad scroll through many categories with
    **no blank rails**; each category still fetches its posters just-in-time as its
    row nears the viewport (no up-front fetch storm).
  - Focused-card horizontal scroll-into-view, chevrons, hero swap, and horizontal
    load-more still work.
  - Home (History) shelf + hero unaffected (few shelves; renders identically).

## Tradeoff accepted

Rows never unmount, so posters for every rail scrolled *past* stay mounted —
bounded by vertical scroll depth, not total category count. Deep scrolling through
a 100+ category browse accumulates `<img>`; this is the same tradeoff the
`PagedGrid` grow-on-scroll migration already accepted for grids, and it resets on
leaving the screen. Categories never scrolled to cost only a title + empty flex
container (no posters, no fetch).

## Out of scope

- `PagedGrid.tv.jsx` grow-on-scroll grids (Movies/Series/Live TV drilled-in) —
  already de-virtualized; unchanged here.
- `shelfWindow.js`, the paging hooks, detail/player views, web/native surfaces.
- Any skeleton/shimmer loading treatment for unfetched rows.

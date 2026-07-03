# Unified shelf virtualization + lazy fetch (Movies, all platforms)

**Date:** 2026-07-03
**Status:** Approved (pending spec review)
**Branch:** feat/tv-electron-parity

## Problem

Content shelves render inconsistently across platforms, and the request is to
render only what is visible plus a small lookahead, sliding the mounted window
as the user moves right (posters) and down (shelves).

Current state (Movies):

| Axis | Web | Native | TV |
|---|---|---|---|
| Vertical shelves | `map()`, not windowed | `FlatList` windowed | all rows mount, **not windowed** |
| Horizontal posters | windowed slice + spacers | nested `FlatList` windowed | all mount, **hard-capped at 8** |

**Hard backend fact:** the Xtream Codes API has **no** `limit`/`offset`/`page`.
`get_vod_streams&category_id=…` returns the **entire** category in one request.
So there is no per-shelf network "load more" to make — "scroll right to load
more" means *sliding a render window over the already-fetched array*, not a new
API call. The only network fetch is the existing **lazy per-shelf fetch** on
first vertical visibility, which we keep.

## Prior-decision reversal (must read)

Two specs dated 2026-07-02 **deliberately removed** TV virtualization:

- `2026-07-02-render-called-api-drop-virtualization-design.md` — removed TV
  horizontal rail windowing because on webOS/Tizen *"the mount window slides
  ahead of the real scroll and unmounts still-visible cards"* → **blank
  posters**; called the windowing math *"the source of repeated debugging pain."*
- `2026-07-02-render-all-shelf-rows-drop-vertical-windowing-design.md` — removed
  TV vertical shelf windowing; all rows now mount and never unmount.

This spec **reverses that TV decision**, chosen explicitly by the product owner
with full knowledge of the history. It is a deliberate re-introduction, not an
oversight. Web and native were **not** part of the July-2 reversal, so no
reversal applies there.

### Why this attempt is different (the mitigation the old code lacked)

The July-2 spec records the key insight: *"On TV there is no free scrolling —
the vertical `scrollTop` is derived from focus (`scrollTop = heroH +
focus.shelfAnchor * ROW_HEIGHT`)."* The old blank-poster bug came from windowing
driven by **asynchronous scroll-position reads** (`railFirst`/`railFirstRef`
updated in `onRailScroll`) that lagged/led the real scroll.

The new TV window is anchored **only on the deterministic D-pad focus index**
(`focus.shelf`, `focus.col`), never on async scroll reads. Because focus is the
single source of truth from which scroll position is *derived*, the window
cannot slide ahead of the real scroll. Additional mitigations:

- **The focused card is always mounted** (it is inside `[start, end)` by
  construction, and asserted).
- **Generous TV overscan** (larger than web/native) to mask D-pad latency.
- **Zero `IntersectionObserver`** dependency (webOS 3.x = Chromium 38 lacks it).
- Off-window rows/cards are replaced by **fixed-size spacers**, so the
  focus→scrollTop formula and rail geometry stay exact.

## Goals

- One shared, pure, unit-tested windowing core used by all platforms.
- True windowing on **both** axes: mount only visible + lookahead, unmount the
  rest, spacers preserve scroll geometry.
- Per-platform-tuned lookahead (overscan), ~4 baseline.
- Keep the existing lazy per-shelf fetch; unify its trigger to fire from the
  vertical window's leading edge + overscan.
- Movies only, all three platforms. Series/Live TV are out of scope (follow-up).

## Approach

**Approach A — shared core, platform-native renderers.** Unify the *math and
fetch semantics*, not the rendering substrate:

- **Web + TV** use DOM windowing (spacer divs on both sides) driven by the
  shared core. Web's anchor is `scrollLeft`/`scrollTop`; TV's anchor is the
  focus index. Same math, different anchor input.
- **Native keeps `FlatList`** (vertical) and nested horizontal `FlatList`.
  FlatList is the idiomatic native virtualizer; its window props are derived
  from the shared config so overscan semantics match. No hand-rolled windowing
  on native.

## Components / boundaries

### 1. `src/presentation/virtualization/windowMath.js` (new, pure)

Generalizes the existing `shelfWindow.js` `windowFromAnchor`. Axis-agnostic:

```
computeWindow({ anchor, total, viewportCount, overscan })
  → { start, end, leadingCount, trailingCount }
```

- `anchor` = index of the first visible item (poster col, or shelf row).
- `start = clamp(anchor - overscan, 0, total)`,
  `end = clamp(anchor + viewportCount + overscan, 0, total)`.
- `leadingCount = start`, `trailingCount = total - end` (spacer sizing input).
- No React, no DOM, no scroll reads. Pure → fully unit-testable.

`shelfWindow.js` keeps `scrollAnchor`, `railEdges`, `clampCol`, `nearRailEnd`;
`windowFromAnchor` becomes a thin re-export of `computeWindow` (or its call
sites move directly). No behavioral change to the kept helpers.

### 2. `src/presentation/virtualization/shelfConfig.js` (new)

Per-platform tuning resolved via `detectPlatform()`:

```
{ posterWidth, posterGap, rowHeight, hOverscan, vOverscan }
```

- Baseline `hOverscan`/`vOverscan` ≈ 4.
- **TV** gets larger overscan (e.g. `hOverscan: 6`, `vOverscan: 2`) to mask
  D-pad latency and guarantee the focused card is comfortably inside the window.
- Single home for the "keep ~4 ahead" knob.

### 3. `useShelfWindow(anchor, total, cfg)` (new hook)

Thin memoized React wrapper over `computeWindow`; returns
`{ start, end, leadingPad, trailingPad }` (pads in px, from counts × stride).
Shared by web + TV renderers. Native does not use it (FlatList owns its window).

### 4. Per-platform renderers

- **Web horizontal** — `ContentShelf.web.jsx` refactored to consume
  `useShelfWindow` (anchor = `floor(scrollLeft / stride)`); already close to
  this, so mostly a consolidation onto the shared core.
- **Web vertical** — `MoviesScreen.web.jsx` shelf list changes from `map()` to a
  windowed list (anchor = `floor(scrollTop / rowHeight)`) with top/bottom spacer
  divs. This is the new part on web.
- **TV both axes** — `VirtualShelves.tv.jsx`:
  - Horizontal: window each rail off the **full** loaded array (drop
    `MAX_PER_SHELF=8`), anchor = focused col for the focused rail / remembered
    col for idle rails; spacers both sides; focused card ref always inside window.
  - Vertical: window shelves (reverse July-2), anchor = `focus.shelfAnchor`;
    fixed `ROW_HEIGHT` rows → spacers keep the derived-scrollTop formula exact.
  - No scroll-read-driven window state (`railFirst`/`onRailScroll` window path
    removed); chevron edge hints may keep a minimal `onScroll` read (UI only,
    not virtualization).
- **Native** — `ContentShelf.native.jsx` + `MoviesScreen.native.jsx` keep
  `FlatList`; `windowSize`/`initialNumToRender`/`maxToRenderPerBatch` derived
  from `shelfConfig` so lookahead matches. `removeClippedSubviews` stays off on
  the horizontal rail (avoids blank flashes, as today).

### 5. Fetch orchestration — `useMovies.js`

- Keep `shelves`, `handleShelfVisible`, item cache, and the credential wiring.
- **Drop the client-side `SHELF_PAGE` growth slice** for horizontal reveal — the
  window now slides over the full fetched array, so `handleLoadMore`'s
  re-slice-of-cached-array role goes away for windowed platforms. `items`
  becomes the full array once fetched; `totalCount = items.length`.
- `onShelfVisible` fires from the **vertical window's leading edge + vOverscan**
  (fetch gate), preserving the "no fetch storm on 100+ categories" constraint.
- TMDB Top-Rated remote paging (`handleTopRatedMore`) is unchanged — it is a
  real remote cursor and orthogonal to this work.

## Data flow

```
useMovies (categories eager, items lazy per shelf, full array cached)
  → shelves[] { id, name, items|null, totalCount, ... }
  → screen
      web:    windowed vertical list  → ContentShelf.web (windowed horizontal)
      native: FlatList vertical        → ContentShelf.native (FlatList horizontal)
      tv:     VirtualShelvesTV (focus-anchored window both axes)
  windowMath.computeWindow feeds web + tv; shelfConfig feeds all three.
  onShelfVisible (vertical leading edge + overscan) → useMovies.handleShelfVisible → API (once per category).
```

## Error handling

No new error paths. Existing states preserved: whole-screen loading/error/no-
account `StatePanel`; per-shelf `items === null` → spinner (web/native) or empty
`ROW_HEIGHT` rail (TV); failed fetch leaves `items: []`. Windowing operates only
over already-resolved arrays, so it introduces no async failure surface.

## Testing

- **Unit (`node --test`)** — `windowMath.test.js`: `computeWindow` clamps at 0
  and `total`, includes the anchor, honors overscan on both sides, and (TV
  invariant) the window always contains the focused index for representative
  focus/overscan combinations. Update/retarget `shelfWindow.test.js` for helpers
  that move.
- **Web** — verify vertical shelf list mounts only visible + lookahead
  (spacer heights correct), horizontal window slides on scroll, no gaps.
- **Native** — verify FlatList lookahead matches config; scroll both axes.
- **TV (`npm run sim:lg`) — the risk surface.** Vertical D-pad scroll through
  many categories: **no blank rails**; horizontal D-pad along a long rail past
  the old 8-cap: **no blank posters**, focused card always present, focus
  scroll-into-view correct, chevrons/hero/lazy-fetch intact, no fetch storm.

## Tradeoffs accepted

- Reintroducing TV unmount-windowing carries the known blank-poster risk; the
  focus-index anchor (vs. scroll reads) is the structural mitigation, but this
  must be validated on `sim:lg` before merge.
- Native diverges in *code* (FlatList) while matching in *behavior*; "unified"
  means unified math + fetch semantics, not identical render code.

## Out of scope

- Series and Live TV (follow-up once the Movies model is proven).
- Detail/player views.
- Changing Xtream API paging (it has none) or the TMDB Top-Rated cursor.
- Web `VirtualGrid.web.jsx` and TV `PagedGrid.tv.jsx` drill-in grids (already
  have their own paging model; untouched).

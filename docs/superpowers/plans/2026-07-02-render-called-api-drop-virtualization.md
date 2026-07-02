# Render from the called API — drop virtualization windowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render TV shelf rails and category/channel grids straight from the API-loaded items, deleting the extra virtualization windowing that caused blank posters on webOS.

**Architecture:** Rails render all loaded (API-paged) items directly; the vertical shelf-row window and lazy-load stay. Grids render a growing `items.slice(0, display)` where the screen owns `display` and grows it via a pure `nextDisplay` helper as D-pad focus nears the rendered end. `VirtualGridTV` and the dead `focusedRailWindow` are removed.

**Tech Stack:** React (JSX), plain CSS grid/flex, `node --test` for pure-function unit tests.

## Global Constraints

- Target floor: webOS 3–4 / Tizen 2016 (old Chromium). No reliance on native `loading="lazy"` for memory bounding.
- Mounted decoded-image count must stay bounded: rails bounded by API paging (~8–16/rail); grids bounded by scroll depth (grow-on-scroll), reset on every filter/category/query change.
- Preserve behaviour: D-pad focus, focused-item scroll-into-view, hero swap, `onShelfVisible` lazy-load, `handleLoadMore`/`nearRailEnd` load-more, scroll-hint chevrons.
- Pure logic lives in its own module and is unit-tested (`shelfWindow.js`, `gridPage.js`); React components are verified manually via `npm run sim:lg`.
- Test command: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')` (the `test` npm script).

---

## File Structure

- `src/presentation/components/VirtualShelves.tv.jsx` — MODIFY: drop horizontal rail windowing, render all loaded items, keep vertical window + chevrons.
- `src/presentation/components/gridPage.js` — CREATE: pure `nextDisplay` grow helper.
- `src/presentation/components/gridPage.test.js` — CREATE: unit tests for `nextDisplay`.
- `src/presentation/components/PagedGrid.tv.jsx` — CREATE: presentational grow-on-scroll grid.
- `src/screens/MoviesScreen.tv.jsx` — MODIFY: swap `VirtualGridTV` → `PagedGridTV`, wire `display`/`onGrow`, reset `display` at focus-reset points.
- `src/screens/SeriesScreen.tv.jsx` — MODIFY: same swap + wiring for the series grid.
- `src/screens/LiveTVScreen.tv.jsx` — MODIFY: same swap + wiring for the channel grid.
- `src/presentation/components/shelfWindow.js` — MODIFY: delete dead `focusedRailWindow`.
- `src/presentation/components/shelfWindow.test.js` — MODIFY: delete `focusedRailWindow` tests.
- `src/presentation/components/VirtualGrid.tv.jsx` — DELETE after all three swaps.

---

### Task 1: De-virtualize the shelf rails (horizontal axis)

**Files:**
- Modify: `src/presentation/components/VirtualShelves.tv.jsx`

**Interfaces:**
- Consumes: `shelves` prop items already paged by the hooks (`handleShelfVisible`/`handleLoadMore`); `windowFromAnchor`, `scrollAnchor`, `railEdges`, `clampCol`, `nearRailEnd` from `shelfWindow.js`.
- Produces: no exported-signature change — `VirtualShelvesTV` keeps the same props (`shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard, showHero, onUpAtTop, onBack`).

- [ ] **Step 1: Remove the horizontal-window state and its scroll reader**

In `VirtualShelves.tv.jsx`, delete the `railFirst`/`railFirstRef` state and replace the rail-scroll handler so it only tracks chevron edges + raw scroll position (no window anchor).

Remove these lines (currently ~52–55):

```jsx
  // shelfId -> index of the first poster currently visible in that rail, read
  // back from the rail's real scrollLeft. Drives the horizontal mount window.
  const [railFirst, setRailFirst] = useState({});
  const railFirstRef = useRef(railFirst);
  railFirstRef.current = railFirst;
```

Add a raw-scroll memory ref next to the remaining refs (near `colMemory`):

```jsx
  const railScrollLeft = useRef({}); // shelfId -> last scrollLeft, restored when an idle rail remounts
```

Replace `onRailScroll` (currently ~170–176) with a chevron-only reader:

```jsx
  // Track chevron hint edges + raw scrollLeft from a rail's real geometry. No
  // window anchoring — rails mount all their loaded items now.
  const onRailScroll = useCallback((id) => (e) => {
    const t = e.currentTarget;
    railScrollLeft.current[id] = t.scrollLeft;
    const edges = railEdges({ scrollLeft: t.scrollLeft, clientWidth: t.clientWidth, scrollWidth: t.scrollWidth });
    setRailEdge((m) => (m[id] && m[id].left === edges.left && m[id].right === edges.right ? m : { ...m, [id]: edges }));
  }, []);
```

- [ ] **Step 2: Drop `focusedRailWindow` import**

Change the import on line 2 from:

```jsx
import { scrollAnchor, windowFromAnchor, focusedRailWindow, clampCol, nearRailEnd, railEdges } from "./shelfWindow.js";
```

to:

```jsx
import { scrollAnchor, windowFromAnchor, clampCol, nearRailEnd, railEdges } from "./shelfWindow.js";
```

- [ ] **Step 3: Restore idle-rail scroll from raw px (not railFirst)**

In the "Apply scroll" effect, replace the idle-rail restore loop (currently ~162–165):

```jsx
    for (const [id, node] of Object.entries(railRefs.current)) {
      if (!node || id === focusedId) continue;
      node.scrollLeft = (railFirstRef.current[id] ?? 0) * STRIDE;
    }
```

with:

```jsx
    for (const [id, node] of Object.entries(railRefs.current)) {
      if (!node || id === focusedId) continue;
      node.scrollLeft = railScrollLeft.current[id] ?? 0;
    }
```

- [ ] **Step 4: Render all loaded items per rail (remove window + spacers)**

In the rail render block (currently ~228–275), remove the per-rail window computation and spacers. Replace this section:

```jsx
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          const first = railFirst[shelf.id] ?? 0;
          const rw = isFocusedShelf
            ? focusedRailWindow(first, focus.col, items.length, dims.cols, H_OVERSCAN)
            : windowFromAnchor(first, items.length, dims.cols, IDLE_OVERSCAN);
          const leftPad = rw.start * STRIDE;
          const rightPad = Math.max(0, (items.length - rw.end)) * STRIDE;
          // Scroll-hint chevrons: driven by the rail's REAL scroll geometry once
          // it has scrolled (railEdge), so the right fade clears exactly at the
          // end instead of lingering over the last poster. Before the first
          // scroll event, fall back to a coarse estimate (at start; overflow if
          // there are more items than visibly fit).
          const edge = railEdge[shelf.id];
          const moreLeft = edge ? edge.left : first > 0;
          const moreRight = edge ? edge.right : items.length > dims.cols;
```

with:

```jsx
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          // Scroll-hint chevrons: driven by the rail's REAL scroll geometry once
          // it has scrolled (railEdge). Before the first scroll event, fall back
          // to a coarse estimate (at start; overflow if more items than fit).
          const edge = railEdge[shelf.id];
          const moreLeft = edge ? edge.left : false;
          const moreRight = edge ? edge.right : items.length > dims.cols;
```

Then replace the rail's inner content (the `leftPad` spacer, the `items.slice(rw.start, rw.end).map(...)`, and the `rightPad` spacer, currently ~258–274) with a direct map over all loaded items:

```jsx
                {items.map((item, col) => {
                  const isFocused = isFocusedShelf && col === focus.col;
                  // Key by absolute column, NOT by stream_id/id: IPTV catalogs can
                  // carry duplicate stream_ids, and a duplicate key makes React drop
                  // one card. Column index is unique within a rail and stable
                  // (items only ever append).
                  return (
                    <div key={col}
                      ref={isFocused ? focusedCardRef : null}
                      style={{ flex: `0 0 ${CARD_W}px` }}>
                      {renderCard(item, isFocused)}
                    </div>
                  );
                })}
```

- [ ] **Step 5: Remove now-unused constants**

`IDLE_OVERSCAN` is no longer referenced. Delete its declaration (currently ~12):

```jsx
const IDLE_OVERSCAN = 3;     // keep the same lead in idle rails so no shelf blanks at its edge
```

Leave `H_OVERSCAN` (still used by the prefetch effect), `STRIDE`, `CARD_W`, `CARD_GAP`.

- [ ] **Step 6: Run the test suite (nothing should break)**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS (this task changes no pure logic; `shelfWindow.test.js` still imports `focusedRailWindow`, which still exists until Task 2).

- [ ] **Step 7: Manual verify on the TV sim**

Run: `npm run sim:lg`
Expected: Movies (and Series) shelf browse view scrolls left/right with NO blank posters; the last poster of a rail sits flush; chevron hints appear/clear correctly; scrolling right past the loaded end triggers load-more (more posters appear).

- [ ] **Step 8: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "refactor(tv): render all loaded rail items, drop horizontal virtualization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Delete the now-dead `focusedRailWindow`

**Files:**
- Modify: `src/presentation/components/shelfWindow.js`
- Modify: `src/presentation/components/shelfWindow.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `shelfWindow.js` exports shrink to `{ scrollAnchor, windowFromAnchor, railEdges, clampCol, nearRailEnd }`. No other module imports `focusedRailWindow` after Task 1.

- [ ] **Step 1: Delete the `focusedRailWindow` test block**

In `shelfWindow.test.js`, remove the entire `describe("focusedRailWindow", ...)` block (currently lines 59–84) and remove `focusedRailWindow` from the import on line 3:

```js
import { scrollAnchor, windowFromAnchor, clampCol, nearRailEnd, railEdges } from "./shelfWindow.js";
```

- [ ] **Step 2: Run tests to confirm the removed block is gone and the rest pass**

Run: `node --test src/presentation/components/shelfWindow.test.js`
Expected: PASS, with no `focusedRailWindow` tests listed.

- [ ] **Step 3: Delete the `focusedRailWindow` function**

In `shelfWindow.js`, remove the JSDoc + function (currently lines 37–50):

```js
export function focusedRailWindow(first, focusCol, count, visible, overscan = 3) {
  const lo = Math.min(first, focusCol);
  const hi = Math.max(first + visible, focusCol + 1);
  return { start: Math.max(0, lo - overscan), end: Math.min(count, hi + overscan) };
}
```

- [ ] **Step 4: Confirm no stragglers import it**

Run: `grep -rn "focusedRailWindow" src`
Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/components/shelfWindow.js src/presentation/components/shelfWindow.test.js
git commit -m "refactor(tv): remove dead focusedRailWindow helper + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pure `nextDisplay` grow helper + tests

**Files:**
- Create: `src/presentation/components/gridPage.js`
- Create: `src/presentation/components/gridPage.test.js`

**Interfaces:**
- Produces: `export function nextDisplay(focusIndex, display, cols, pageSize, total)` → returns the next display cap (>= `display`, <= `total`). Grows by `pageSize` when `focusIndex >= display - cols`; otherwise returns `display` unchanged. Consumed by `PagedGridTV` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/gridPage.test.js`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextDisplay } from "./gridPage.js";

describe("nextDisplay", () => {
  test("stays put while focus is comfortably inside the rendered slice", () => {
    assert.equal(nextDisplay(0, 24, 5, 24, 1000), 24);
    assert.equal(nextDisplay(10, 24, 5, 24, 1000), 24);
  });
  test("grows by one page when focus is within `cols` of the rendered end", () => {
    // display 24, cols 5 -> threshold at index 19
    assert.equal(nextDisplay(19, 24, 5, 24, 1000), 48);
    assert.equal(nextDisplay(23, 24, 5, 24, 1000), 48);
  });
  test("clamps growth at total", () => {
    assert.equal(nextDisplay(29, 30, 5, 24, 40), 40); // 30+24=54 -> clamp 40
  });
  test("never shrinks and never exceeds total", () => {
    assert.equal(nextDisplay(0, 100, 5, 24, 40), 40); // already past total -> clamp down to total
    assert.equal(nextDisplay(0, 30, 5, 24, 1000), 30);
  });
  test("handles the very first page (display == pageSize)", () => {
    assert.equal(nextDisplay(0, 24, 5, 24, 10), 10); // total < display -> clamp to total
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/presentation/components/gridPage.test.js`
Expected: FAIL — cannot find module `./gridPage.js` / `nextDisplay is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/presentation/components/gridPage.js`:

```js
// Pure grow-on-scroll math for the paged TV grids (PagedGrid.tv). No DOM, no
// React — unit-tested in isolation, mirroring shelfWindow.js.
//
// The grid renders items.slice(0, display). As D-pad focus nears the rendered
// end, `display` grows by one page so the next rows exist before the user
// reaches them. Bounded by how far the user actually scrolls, never the full
// list; the screen resets `display` to `pageSize` on every filter/category
// change.

/**
 * Next display cap given the focused index. Grows by `pageSize` when `focusIndex`
 * is within `cols` of the current `display` (i.e. focus reached the last rendered
 * row), clamped to `total`. Otherwise returns `display` unchanged. Result is
 * always in [0, total] and never below `min(display, total)`.
 */
export function nextDisplay(focusIndex, display, cols, pageSize, total) {
  const capped = Math.min(display, total);
  if (focusIndex >= display - cols) return Math.min(display + pageSize, total);
  return capped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/presentation/components/gridPage.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/gridPage.js src/presentation/components/gridPage.test.js
git commit -m "feat(tv): add nextDisplay grow-on-scroll helper for paged grids

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `PagedGridTV` component + Movies grid swap

**Files:**
- Create: `src/presentation/components/PagedGrid.tv.jsx`
- Modify: `src/screens/MoviesScreen.tv.jsx`

**Interfaces:**
- Consumes: `nextDisplay` from `gridPage.js`.
- Produces: `export function PagedGridTV({ items, cols, gap = 8, focusIndex = 0, pageSize, display, onGrow, renderItem, className = "" })`. Renders `items.slice(0, display)` in a CSS grid; scrolls the focused cell into view on `focusIndex` change; calls `onGrow(next)` when `nextDisplay` returns a larger cap. `renderItem(item, absoluteIndex)` — same contract as `VirtualGridTV` so callers keep their `i === focus` styling.

- [ ] **Step 1: Create the `PagedGridTV` component**

Create `src/presentation/components/PagedGrid.tv.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { nextDisplay } from "./gridPage.js";

/**
 * Grow-on-scroll TV grid. Renders items.slice(0, display) in a plain CSS grid —
 * no virtualization windowing. The SCREEN owns `display` (its filtered arrays
 * are recomputed each render, so the cap can't live here); this component grows
 * it via onGrow as D-pad focus nears the rendered end and scrolls the focused
 * cell into view. `renderItem` gets the ABSOLUTE index, matching VirtualGridTV.
 */
export function PagedGridTV({
  items,
  cols,
  gap = 8,
  focusIndex = 0,
  pageSize,
  display,
  onGrow,
  renderItem,
  className = "",
}) {
  const focusedRef = useRef(null);

  // Grow the rendered slice when focus reaches its end.
  useEffect(() => {
    const next = nextDisplay(focusIndex, display, cols, pageSize, items.length);
    if (next !== display) onGrow?.(next);
  }, [focusIndex, display, cols, pageSize, items.length, onGrow]);

  // Bring the focused cell into view (native — every rendered cell is real DOM).
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const shown = items.slice(0, display);

  return (
    <div
      className={`tv-paged-grid${className ? ` ${className}` : ""}`}
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
        {shown.map((item, i) => (
          <div key={i} ref={i === focusIndex ? focusedRef : null}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Swap the import in MoviesScreen**

In `src/screens/MoviesScreen.tv.jsx` line 7, replace:

```jsx
import { VirtualGridTV } from "../presentation/components/VirtualGrid.tv";
```

with:

```jsx
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
```

- [ ] **Step 3: Add a `display` grow handler and reset points**

In `MoviesScreen.tv.jsx`, the grid state field `page.display` already exists (set to `MOV_PAGE` in `openCat`, reset in `onFilterEnter`). Add a grow setter near `movMovFocus` (~189):

```jsx
  const growMovDisplay = (next) => { const pg = pageRef.current; if (pg) { const n = { ...pg, display: next }; pageRef.current = n; setPage(n); } };
```

In `onGridQueryChange` (~136–141), also reset `display` to `MOV_PAGE` when the query changes. Replace:

```jsx
    if (pg) { const n = { ...pg, focus: 0 }; pageRef.current = n; setPage(n); }
```

with:

```jsx
    if (pg) { const n = { ...pg, focus: 0, display: MOV_PAGE }; pageRef.current = n; setPage(n); }
```

(`openCat` already seeds `display: MOV_PAGE`; `onFilterEnter` already resets it.)

- [ ] **Step 4: Wire the grid render to `PagedGridTV`**

Replace the grid render block (currently ~529–540) inside `if (page) { ... }`:

```jsx
          <div className="tvl-mov-grid-window">
            <VirtualGridTV
              items={filteredItems}
              cols={MOV_COLS}
              rowHeight={MOV_ROW_H}
              gap={MOV_GAP}
              focusIndex={page.focus}
              className="tvl-mov-vgrid"
              renderItem={(item, i) => (
                <MovieCard key={String(item.stream_id)} item={item} isFocused={filterZone === "grid" && !navActive && i === page.focus} />
              )}
            />
          </div>
```

with:

```jsx
          <div className="tvl-mov-grid-window">
            <PagedGridTV
              items={filteredItems}
              cols={MOV_COLS}
              gap={MOV_GAP}
              focusIndex={page.focus}
              pageSize={MOV_PAGE}
              display={page.display}
              onGrow={growMovDisplay}
              className="tvl-mov-vgrid"
              renderItem={(item, i) => (
                <MovieCard key={String(item.stream_id)} item={item} isFocused={filterZone === "grid" && !navActive && i === page.focus} />
              )}
            />
          </div>
```

- [ ] **Step 5: Run the full test suite**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS.

- [ ] **Step 6: Manual verify on the TV sim**

Run: `npm run sim:lg`
Expected: Open a Movies category → grid shows first `MOV_PAGE` posters; D-pad down/right scrolls smoothly and more posters appear as you near the end; focused card stays in view; alpha-filter / search reset the grid to the top with a fresh first page; no blank posters.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/PagedGrid.tv.jsx src/screens/MoviesScreen.tv.jsx
git commit -m "feat(tv): grow-on-scroll PagedGrid for the Movies grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Series grid swap

**Files:**
- Modify: `src/screens/SeriesScreen.tv.jsx`

**Interfaces:**
- Consumes: `PagedGridTV` from Task 4.
- Produces: none.

- [ ] **Step 1: Swap the import**

In `SeriesScreen.tv.jsx` line 6, replace:

```jsx
import { VirtualGridTV } from "../presentation/components/VirtualGrid.tv";
```

with:

```jsx
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
```

- [ ] **Step 2: Add a `display` grow handler and query reset**

The series grid state (`grid`) already carries `display: SER_PAGE` (set at ~173, reset in `onFilterEnter` ~564). Add a grow setter near `movGrid` (~473):

```jsx
  const growGridDisplay = (next) => { const g = gridRef.current; if (g) { const n = { ...g, display: next }; gridRef.current = n; setGrid(n); } };
```

In `onGridQueryChange` (~251–254), also reset `display`. Replace:

```jsx
    if (g) { const n = { ...g, focus: 0 }; gridRef.current = n; setGrid(n); }
```

with:

```jsx
    if (g) { const n = { ...g, focus: 0, display: SER_PAGE }; gridRef.current = n; setGrid(n); }
```

- [ ] **Step 3: Wire the grid render**

Replace the grid render block (currently ~1034–1050):

```jsx
            <VirtualGridTV
              items={filteredItems}
              cols={SER_COLS}
              rowHeight={SER_ROW_H}
              gap={SER_GAP}
              focusIndex={grid.focus}
              className="tvl-ser-vgrid"
              renderItem={(item, i) => (
                <PosterCard
                  key={String(item.series_id)}
                  item={item}
                  isFocused={filterZone === "grid" && !navActive && i === grid.focus}
                />
              )}
            />
```

with:

```jsx
            <PagedGridTV
              items={filteredItems}
              cols={SER_COLS}
              gap={SER_GAP}
              focusIndex={grid.focus}
              pageSize={SER_PAGE}
              display={grid.display}
              onGrow={growGridDisplay}
              className="tvl-ser-vgrid"
              renderItem={(item, i) => (
                <PosterCard
                  key={String(item.series_id)}
                  item={item}
                  isFocused={filterZone === "grid" && !navActive && i === grid.focus}
                />
              )}
            />
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS.

- [ ] **Step 5: Manual verify on the TV sim**

Run: `npm run sim:lg`
Expected: Series category grid behaves like Movies — first `SER_PAGE` posters, grows on scroll, focus stays in view, filters reset to top, no blanks.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SeriesScreen.tv.jsx
git commit -m "feat(tv): grow-on-scroll PagedGrid for the Series grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live TV channel grid swap

**Files:**
- Modify: `src/screens/LiveTVScreen.tv.jsx`

**Interfaces:**
- Consumes: `PagedGridTV` from Task 4.
- Produces: none.

- [ ] **Step 1: Swap the import**

In `LiveTVScreen.tv.jsx` line 4, replace:

```jsx
import { VirtualGridTV } from "../presentation/components/VirtualGrid.tv";
```

with:

```jsx
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
```

- [ ] **Step 2: Add a `display` grow handler**

The channel grid state (`page`) already carries `display: CH_PAGE` (set at ~125). Add a grow setter near `movCh` (~261):

```jsx
  const growChDisplay = (next) => { const pg = pageRef.current; if (pg) { const n = { ...pg, display: next }; pageRef.current = n; setPage(n); } };
```

The channel grid resets focus to top via the effect at ~92–97 (`movCh(pg, 0)` when the filtered set changes). Extend that reset to also restore `display`. Replace:

```jsx
    if (pg) movCh(pg, 0);
```

with:

```jsx
    if (pg) { const n = { ...pg, focus: 0, display: CH_PAGE }; pageRef.current = n; setPage(n); }
```

> Note: confirm `pageRef` is the ref name used by `movCh`/`setPage` in this file (it is — see `movCh` at ~261). If the file names the ref differently, use that name; do not introduce a new ref.

- [ ] **Step 3: Wire the grid render**

Replace the grid render block (currently ~422–436):

```jsx
            <VirtualGridTV
              items={filteredItems}
              cols={CH_COLS}
              rowHeight={CH_ROW_H}
              gap={CH_GAP}
              focusIndex={page.focus}
              className="tvl-ch-vgrid"
              renderItem={(item, i) => (
                <ChannelCard
                  key={String(item.stream_id)}
                  item={item}
                  isFocused={i === page.focus}
                />
              )}
```

with:

```jsx
            <PagedGridTV
              items={filteredItems}
              cols={CH_COLS}
              gap={CH_GAP}
              focusIndex={page.focus}
              pageSize={CH_PAGE}
              display={page.display}
              onGrow={growChDisplay}
              className="tvl-ch-vgrid"
              renderItem={(item, i) => (
                <ChannelCard
                  key={String(item.stream_id)}
                  item={item}
                  isFocused={i === page.focus}
                />
              )}
```

(Leave the closing `/>` and `</div>` that follow the block unchanged.)

- [ ] **Step 4: Run the full test suite**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS.

- [ ] **Step 5: Manual verify on the TV sim**

Run: `npm run sim:lg`
Expected: Open a Live TV category → channel grid shows first `CH_PAGE` channels, grows on scroll, focus stays in view, search resets to top, no blank tiles.

- [ ] **Step 6: Commit**

```bash
git add src/screens/LiveTVScreen.tv.jsx
git commit -m "feat(tv): grow-on-scroll PagedGrid for the Live TV channel grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Delete `VirtualGrid.tv.jsx`

**Files:**
- Delete: `src/presentation/components/VirtualGrid.tv.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `VirtualGrid.web.jsx` is a SEPARATE file for the web build and is NOT touched.

- [ ] **Step 1: Confirm no remaining importers of the TV grid**

Run: `grep -rn "VirtualGrid.tv\|VirtualGridTV" src`
Expected: no output (all three screens now import `PagedGridTV`).

- [ ] **Step 2: Delete the file**

Run: `git rm src/presentation/components/VirtualGrid.tv.jsx`
Expected: file removed from the working tree and staged.

- [ ] **Step 3: Run the full test suite**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS.

- [ ] **Step 4: Build sanity check (imports resolve)**

Run: `npm run sim:lg`
Expected: app builds and all three grid screens (Movies, Series, Live TV) render — no "module not found" for `VirtualGrid.tv`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(tv): remove dead VirtualGrid.tv after PagedGrid migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- Line numbers are from the working tree at plan time and may drift; anchor on the surrounding code shown in each step, not the number.
- `VirtualShelves.tv.jsx` also has an "Apply scroll" effect that references `dims` and `STRIDE` for the vertical axis — leave that intact. Only the idle-rail horizontal restore loop changes (Task 1, Step 3).
- Do NOT touch `VirtualGrid.web.jsx`, the detail/player views, or the hooks' paging (`useMovies`/`useSeries`/`useLiveTV`).
- CSS is safe to leave alone. The scroll/height styling comes from INLINE styles on the grid component (`overflowY:auto; height:100%; contain:strict`), which `PagedGridTV` reproduces. The class names `.tv-virtual-grid`, `.tv-paged-grid`, and the passed `*-vgrid` classes have NO matching CSS rules (verified) — they are inert. Layout comes from the `.tvl-*-grid-window` wrapper (`flex:1; min-height:0; padding`), which is unchanged. No CSS edits are required.
```

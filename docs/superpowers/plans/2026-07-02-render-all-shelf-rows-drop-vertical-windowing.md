# Render all TV shelf rows — drop vertical windowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every TV shelf row directly (no mount/unmount windowing) while keeping per-category fetching scroll-gated, by demoting the vertical window computation to a pure fetch/prefetch gate.

**Architecture:** `VirtualShelves.tv.jsx` currently uses `windowFromAnchor(...)` for two jobs — deciding which rows *mount* and which categories *fetch*. On TV the vertical scroll is derived from focus, so the window already tracks "where the user is". We stop using it to gate rendering (map over all `shelves`, drop the spacer padding) and keep using it only to gate `onShelfVisible` lazy-load and poster prefetch. The local `vWin` is renamed `fetchWin` to reflect its narrowed purpose.

**Tech Stack:** React (JSX), plain CSS flex, `node --test` for the existing pure-function suite. Manual TV verification via `npm run sim:lg`.

## Global Constraints

- Target floor: webOS 3–4 / Tizen 2016 (Chromium 38 on webOS 3.x — **no `IntersectionObserver`**). Do not introduce an IO-based visibility detector.
- Per-category fetching must stay scroll-gated — never fetch all categories up front (providers can expose 100+ categories, one shelf each).
- Preserve behaviour: D-pad focus, focused-card horizontal scroll-into-view, hero debounce swap, poster prefetch, chevron hints, `nearRailEnd` horizontal load-more, idle-rail `scrollLeft` restore.
- No pure-logic change → no new unit tests. `shelfWindow.js` and its tests are untouched.
- Test command: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')` (the `test` npm script).

---

## File Structure

- `src/presentation/components/VirtualShelves.tv.jsx` — MODIFY (only file changed): de-window the render, rename `vWin` → `fetchWin`, delete the padding spacers.

No files created or deleted. `shelfWindow.js`, the paging hooks, and the `PagedGrid` grids are out of scope.

---

### Task 1: De-window the shelf render; keep `windowFromAnchor` as a fetch-gate

**Files:**
- Modify: `src/presentation/components/VirtualShelves.tv.jsx`

**Interfaces:**
- Consumes: `windowFromAnchor`, `scrollAnchor`, `clampCol`, `nearRailEnd`, `railEdges` from `shelfWindow.js` (unchanged imports).
- Produces: no exported-signature change. `VirtualShelvesTV` keeps the same props (`shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard, showHero, onUpAtTop, onBack`).

- [ ] **Step 1: Baseline — run the test suite before touching anything**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS. (Confirms a green starting point; this task changes no pure logic, so it must still be green at the end.)

- [ ] **Step 2: Rename the window local to `fetchWin` at its declaration**

In `VirtualShelves.tv.jsx`, the declaration currently reads (around line 95):

```jsx
  const vWin = windowFromAnchor(focus.shelfAnchor, shelfCount, dims.windowRows, SHELF_OVERSCAN);
```

Replace with:

```jsx
  // Visible-row range around the current focus. On TV the vertical scroll is
  // derived from focus (see the Apply-scroll effect), so this tracks where the
  // user is. It now gates ONLY fetching + prefetch — the render below mounts all
  // rows. Renamed from vWin: it is no longer a render window.
  const fetchWin = windowFromAnchor(focus.shelfAnchor, shelfCount, dims.windowRows, SHELF_OVERSCAN);
```

- [ ] **Step 3: Point the lazy-load effect at `fetchWin`**

The lazy-load effect currently reads (around lines 98–103):

```jsx
  useEffect(() => {
    for (let i = vWin.start; i < vWin.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [vWin.start, vWin.end, shelves, onShelfVisible]);
```

Replace with:

```jsx
  useEffect(() => {
    for (let i = fetchWin.start; i < fetchWin.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [fetchWin.start, fetchWin.end, shelves, onShelfVisible]);
```

- [ ] **Step 4: Point the prefetch effect at `fetchWin`**

In the poster-prefetch effect, the row loop currently reads (around line 117):

```jsx
    for (let r = vWin.start; r < vWin.end; r++) {
```

Replace with:

```jsx
    for (let r = fetchWin.start; r < fetchWin.end; r++) {
```

(Leave the rest of that effect — the focused-rail `ahead` prefetch and the `dims.cols + H_OVERSCAN` bound — unchanged.)

- [ ] **Step 5: Delete the padding-spacer computation**

These two lines currently sit just before the `return` (around lines 208–209):

```jsx
  const paddingTop = vWin.start * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (shelfCount - vWin.end)) * ROW_HEIGHT;
```

Delete both lines. (`ROW_HEIGHT` stays — it is still used by the fixed row height and the scroll formula.)

- [ ] **Step 6: Render all rows — drop the spacer wrapper and the slice**

The render currently opens the row list like this (around lines 215–217):

```jsx
      <div style={{ paddingTop, paddingBottom }}>
        {shelves.slice(vWin.start, vWin.end).map((shelf, i) => {
          const shelfIdx = vWin.start + i;
```

Replace those three lines with:

```jsx
      <div>
        {shelves.map((shelf, shelfIdx) => {
```

`shelfIdx` now comes straight from the `map` index, so the deleted `const shelfIdx = vWin.start + i;` line is no longer needed. Everything below inside the map body — `isFocusedShelf`, `items`, chevron `edge`/`moreLeft`/`moreRight`, the rail render, the `key={shelf.id}` wrapper — stays exactly as-is. The vertical `scrollTop` formula in the Apply-scroll effect (`ss(heroH) + focus.shelfAnchor * ROW_HEIGHT`) stays correct because every fixed-`ROW_HEIGHT` row is now present, so row *i* sits at that offset with no padding needed.

- [ ] **Step 7: Confirm no `vWin` / padding references remain**

Run: `grep -n "vWin\|paddingTop\|paddingBottom" src/presentation/components/VirtualShelves.tv.jsx`
Expected: no output. (All `vWin` uses are now `fetchWin`; both padding locals are deleted.)

- [ ] **Step 8: Run the full test suite (must still be green)**

Run: `node --test $(find src scripts -name '*.test.js' | tr '\n' ' ')`
Expected: PASS — same as the Step 1 baseline. This task changed no pure logic; `shelfWindow.test.js` still covers `windowFromAnchor`.

- [ ] **Step 9: Manual verify on the TV sim**

Run: `npm run sim:lg`
Expected:
- Movies (and Series) shelf browse: D-pad **down** through many categories scrolls smoothly with **no blank rails**; each category's posters appear just before/as its row reaches the viewport (fetch is still just-in-time — no up-front burst).
- Focused-card left/right scroll-into-view still works; chevron hints appear/clear; hero swaps on focus change; scrolling a rail right past its loaded end still triggers horizontal load-more.
- Home (History) shelf + hero look and behave exactly as before.

- [ ] **Step 10: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "refactor(tv): render all shelf rows, keep windowFromAnchor as a fetch-gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- Line numbers are from the working tree at plan time and may drift; anchor on the surrounding code shown in each step, not the number.
- Only the render's use of the window changes. The Apply-scroll effect (vertical `scrollTop`, focused-rail horizontal scroll-into-view, idle-rail `scrollLeft` restore), `onRailScroll`, the `move` D-pad handler, chevrons, and all constants are unchanged.
- Do NOT touch `shelfWindow.js`, `PagedGrid.tv.jsx`, the `useMovies`/`useSeries`/`useLiveTV` hooks, or any web/native surface.
- No CSS change: rows keep their `height: ROW_HEIGHT` + `contain: layout style paint` wrapper; the outer scroll box styling is unchanged. Removing the padding only removes empty leading/trailing space that off-window rows used to occupy — those rows are now real.

# TV Shelf UI (Electron-parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Electron "shelves" experience (hero + category rails) to the TV Movies/Series screens with a 2-D virtualized, D-pad-driven component whose mounted-image count is hard-capped for the oldest TV hardware, behind an in-UI toggle; plus two small independent shelf optimizations for Electron and mobile.

**Architecture:** One new DOM component `VirtualShelves.tv.jsx` owns 2-D windowing (vertical shelf window + per-rail horizontal window), D-pad focus with per-shelf column memory, lazy shelf fetch, and an image budget. It consumes the existing `useMovies`/`useSeries` hooks unchanged. A persisted `tvUseShelves` preference (default off) selects shelves vs. today's `VirtualGridTV`. Windowing math lives in a pure helper module so it is unit-testable without a DOM. Two unrelated tweaks add horizontal windowing to `ContentShelf.web` and swap the mobile shelf's `ScrollView` for a `FlatList`.

**Tech Stack:** React (function components, hooks), React Native Web / raw DOM for `.tv`/`.web`, React Native for `.native`, `node:test` + `node:assert/strict` for unit tests, existing `storage` abstraction for persistence.

## Global Constraints

- Minimum hardware floor: webOS 3–4 / Tizen 2016–18 (Chromium ~38–53). No `content-visibility`, no `IntersectionObserver`-gated correctness, no optional-chaining-only APIs assumed present in tooling output; runtime code targets that Chromium.
- Hard image budget: `MAX_MOUNTED_POSTERS = 45`. Enforced structurally by window sizes; must not grow with catalog size or scroll depth.
- No changes to `useMovies` / `useSeries` / `ContentService` or any data fetching.
- Grid path (`VirtualGridTV`) stays live and unchanged; it is both the "see all" drill-in and the toggle-off fallback.
- Toggle `tvUseShelves` defaults to `false` (grid). Persisted via the existing `storage` abstraction, key `iptv_tv_shelves`.
- Tests are pure-function unit tests via `node:test`; run with `npm test`. Component behavior is verified manually/on-device.
- Follow existing file conventions: ESM with explicit `.js`/`.jsx` intent, colocated `*.test.js`, tokens from `src/ui/tokens`, `useTVInput` for remote keys.

---

### Task 1: Windowing + focus math (pure helper)

**Files:**
- Create: `src/presentation/components/shelfWindow.js`
- Test: `src/presentation/components/shelfWindow.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shelfWindow(focusShelf: number, shelfCount: number, buffer = 1) => { start: number, end: number }` — half-open `[start, end)` range of shelf indices to mount.
  - `railWindow(focusCol: number, loadedCount: number, visibleCols: number, hBuffer = 2, isFocused = false) => { start: number, end: number }` — half-open `[start, end)` range of poster indices to mount in one rail.
  - `clampCol(col: number, loadedCount: number) => number` — clamp a (possibly remembered) column into `[0, loadedCount-1]`, or `0` when empty.
  - `nearRailEnd(focusCol: number, loadedCount: number, threshold = 3) => boolean` — true when focus is within `threshold` of the loaded end (trigger load-more).

- [ ] **Step 1: Write the failing test**

```javascript
// src/presentation/components/shelfWindow.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shelfWindow, railWindow, clampCol, nearRailEnd } from "./shelfWindow.js";

describe("shelfWindow", () => {
  test("mounts focus +/- buffer, half-open", () => {
    assert.deepEqual(shelfWindow(5, 20, 1), { start: 4, end: 7 });
  });
  test("clamps at the top", () => {
    assert.deepEqual(shelfWindow(0, 20, 1), { start: 0, end: 2 });
  });
  test("clamps at the bottom", () => {
    assert.deepEqual(shelfWindow(19, 20, 1), { start: 18, end: 20 });
  });
  test("never exceeds shelfCount and never negative", () => {
    const w = shelfWindow(0, 1, 1);
    assert.ok(w.start >= 0 && w.end <= 1);
  });
});

describe("railWindow", () => {
  test("non-focused rail mounts only first visibleCols", () => {
    assert.deepEqual(railWindow(0, 100, 6, 2, false), { start: 0, end: 6 });
  });
  test("focused rail windows around focusCol with hBuffer", () => {
    // start = focusCol - hBuffer, end = focusCol + visibleCols + hBuffer
    assert.deepEqual(railWindow(20, 100, 6, 2, true), { start: 18, end: 28 });
  });
  test("focused rail clamps to loaded range", () => {
    assert.deepEqual(railWindow(0, 4, 6, 2, true), { start: 0, end: 4 });
  });
  test("mounted count stays bounded regardless of loadedCount", () => {
    const w = railWindow(9999, 100000, 6, 2, true);
    assert.ok(w.end - w.start <= 6 + 2 * 2);
  });
});

describe("clampCol", () => {
  test("clamps into range", () => {
    assert.equal(clampCol(50, 10), 9);
  });
  test("empty rail -> 0", () => {
    assert.equal(clampCol(3, 0), 0);
  });
  test("negative -> 0", () => {
    assert.equal(clampCol(-2, 10), 0);
  });
});

describe("nearRailEnd", () => {
  test("true within threshold of loaded end", () => {
    assert.equal(nearRailEnd(8, 10, 3), true);
  });
  test("false when far from end", () => {
    assert.equal(nearRailEnd(2, 100, 3), false);
  });
  test("false for empty rail", () => {
    assert.equal(nearRailEnd(0, 0, 3), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/presentation/components/shelfWindow.test.js`
Expected: FAIL — `Cannot find module './shelfWindow.js'` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/presentation/components/shelfWindow.js
// Pure windowing + focus math for VirtualShelves.tv (and ContentShelf.web
// horizontal virtualization). No DOM, no React — unit-tested in isolation.

/** Half-open [start,end) range of shelf indices to mount. */
export function shelfWindow(focusShelf, shelfCount, buffer = 1) {
  const start = Math.max(0, focusShelf - buffer);
  const end = Math.min(shelfCount, focusShelf + buffer + 1);
  return { start, end };
}

/** Half-open [start,end) range of poster indices to mount in one rail. */
export function railWindow(focusCol, loadedCount, visibleCols, hBuffer = 2, isFocused = false) {
  if (!isFocused) {
    return { start: 0, end: Math.min(loadedCount, visibleCols) };
  }
  const start = Math.max(0, focusCol - hBuffer);
  const end = Math.min(loadedCount, focusCol + visibleCols + hBuffer);
  return { start, end };
}

/** Clamp a (possibly remembered) column into the loaded range. */
export function clampCol(col, loadedCount) {
  if (loadedCount <= 0) return 0;
  if (col < 0) return 0;
  if (col > loadedCount - 1) return loadedCount - 1;
  return col;
}

/** True when focus is within threshold of the loaded end (trigger load-more). */
export function nearRailEnd(focusCol, loadedCount, threshold = 3) {
  if (loadedCount <= 0) return false;
  return focusCol >= loadedCount - threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/presentation/components/shelfWindow.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/shelfWindow.js src/presentation/components/shelfWindow.test.js
git commit -m "feat(tv): pure windowing/focus math for shelf virtualization"
```

---

### Task 2: `Hero.tv` component

**Files:**
- Create: `src/presentation/components/Hero.tv.jsx`

**Interfaces:**
- Consumes: `colors`, `fonts`, `fontWeights` from `src/ui/tokens`; `ss` from `src/utils/scaleSize`.
- Produces: `export default function HeroTV({ item })` — renders one backdrop image + title for the given item, or an empty placeholder when `item` is null. Renders exactly one `<img>`.

- [ ] **Step 1: Implement the component** (no unit test — DOM/visual, verified on-device per spec)

```jsx
// src/presentation/components/Hero.tv.jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/components/Hero.tv.jsx
git commit -m "feat(tv): thin Hero.tv billboard for shelf screens"
```

---

### Task 3: `VirtualShelves.tv` component

**Files:**
- Create: `src/presentation/components/VirtualShelves.tv.jsx`

**Interfaces:**
- Consumes: `shelfWindow`, `railWindow`, `clampCol`, `nearRailEnd` from `./shelfWindow.js`; `HeroTV` from `./Hero.tv.jsx`; `useTVInput` from `src/hooks/useTVInput`; `colors`, `fonts`, `fontWeights` from `src/ui/tokens`; `Icon` from `src/ui/Icon`; `ss` from `src/utils/scaleSize`.
- Produces: `export function VirtualShelvesTV({ shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard })`
  - `shelves`: array of `{ id, name, items, totalCount, hasMore, loadingMore }` (items === null means not yet loaded).
  - `onShelfVisible(id)`, `onLoadMore(id)`, `onSelect(item)`, `onSeeAll(id, name)`.
  - `renderCard(item, isFocused)` — returns a poster node (screens pass their `TVPosterCard` wrapper).

- [ ] **Step 1: Implement the component**

```jsx
// src/presentation/components/VirtualShelves.tv.jsx
import { useState, useRef, useEffect, useCallback } from "react";
import { shelfWindow, railWindow, clampCol, nearRailEnd } from "./shelfWindow.js";
import HeroTV from "./Hero.tv.jsx";
import { useTVInput } from "../../hooks/useTVInput";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

const SHELF_BUFFER = 1;      // rails above/below focus kept mounted
const VISIBLE_COLS = 6;      // posters visible per rail
const H_BUFFER = 2;          // posters left/right of focus kept mounted
const ROW_HEIGHT = 320;      // px per shelf row (title + poster + padding)
const CARD_W = 200;          // px poster width (matches tvConfig.ui.cardWidth)
const CARD_GAP = 8;
const HERO_DEBOUNCE_MS = 150;

const loadedLen = (s) => (Array.isArray(s?.items) ? s.items.length : 0);

export function VirtualShelvesTV({ shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard }) {
  const containerRef = useRef(null);
  const railRefs = useRef({}); // shelfId -> rail DOM node
  const colMemory = useRef({}); // shelfId -> remembered column
  const [focus, setFocus] = useState({ shelf: 0, col: 0 });
  const [heroItem, setHeroItem] = useState(null);

  const shelfCount = shelves.length;
  const win = shelfWindow(focus.shelf, shelfCount, SHELF_BUFFER);

  // ── Lazy-load shelves entering the vertical window (replaces IntersectionObserver) ──
  useEffect(() => {
    for (let i = win.start; i < win.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [win.start, win.end, shelves, onShelfVisible]);

  // ── Debounced hero swap on focus change ──
  useEffect(() => {
    const s = shelves[focus.shelf];
    const item = s && Array.isArray(s.items) ? s.items[clampCol(focus.col, loadedLen(s))] : null;
    const t = setTimeout(() => setHeroItem(item || null), HERO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [focus.shelf, focus.col, shelves]);

  // ── Scroll focused row into view (vertical) + focused card into view (horizontal) ──
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      const rowTop = focus.shelf * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < el.scrollTop) el.scrollTop = rowTop;
      else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;
    }
    const rail = railRefs.current[shelves[focus.shelf]?.id];
    if (rail) {
      const cardLeft = focus.col * (CARD_W + CARD_GAP);
      const cardRight = cardLeft + CARD_W;
      if (cardLeft < rail.scrollLeft) rail.scrollLeft = cardLeft;
      else if (cardRight > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = cardRight - rail.clientWidth;
    }
  }, [focus, shelves]);

  // ── D-pad ──
  const move = useCallback((dShelf, dCol) => {
    setFocus((prev) => {
      const cur = shelves[prev.shelf];
      if (dCol !== 0) {
        const len = loadedLen(cur);
        const nextCol = clampCol(prev.col + dCol, len);
        colMemory.current[cur?.id] = nextCol;
        if (dCol > 0 && cur?.hasMore && nearRailEnd(nextCol, len)) onLoadMore?.(cur.id);
        return { shelf: prev.shelf, col: nextCol };
      }
      // vertical move: remember current col, restore destination's remembered col
      if (cur) colMemory.current[cur.id] = prev.col;
      const nextShelf = Math.max(0, Math.min(shelfCount - 1, prev.shelf + dShelf));
      const dest = shelves[nextShelf];
      const remembered = colMemory.current[dest?.id] ?? 0;
      return { shelf: nextShelf, col: clampCol(remembered, loadedLen(dest)) };
    });
  }, [shelves, shelfCount, onLoadMore]);

  const { register } = useTVInput();
  useEffect(() => register({
    left: () => move(0, -1),
    right: () => move(0, 1),
    up: () => move(-1, 0),
    down: () => move(1, 0),
    enter: () => {
      const s = shelves[focus.shelf];
      const item = s && Array.isArray(s.items) ? s.items[clampCol(focus.col, loadedLen(s))] : null;
      if (item) onSelect?.(item);
    },
  }, { yieldToNav: true }), [register, move, shelves, focus, onSelect]);

  const paddingTop = win.start * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (shelfCount - win.end)) * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="tvl-shelves-screen"
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}>
      <HeroTV item={heroItem} />
      <div style={{ paddingTop, paddingBottom }}>
        {shelves.slice(win.start, win.end).map((shelf, i) => {
          const shelfIdx = win.start + i;
          const isFocusedShelf = shelfIdx === focus.shelf;
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          const rw = railWindow(focus.col, items.length, VISIBLE_COLS, H_BUFFER, isFocusedShelf);
          const leftPad = rw.start * (CARD_W + CARD_GAP);
          const rightPad = Math.max(0, (items.length - rw.end)) * (CARD_W + CARD_GAP);
          return (
            <div key={shelf.id} style={{ height: ROW_HEIGHT, contain: "layout style paint" }}>
              <div className="tvl-shelf-title-btn"
                onClick={() => onSeeAll?.(shelf.id, shelf.name)}
                style={{ display: "flex", alignItems: "center", gap: ss(4),
                  padding: `${ss(10)}px ${ss(48)}px`, color: colors.text,
                  fontFamily: fonts.display, fontWeight: fontWeights.bold, fontSize: ss(22) }}>
                {shelf.name}
              </div>
              <div ref={(n) => { railRefs.current[shelf.id] = n; }} className="tv-shelf-rail"
                style={{ display: "flex", overflowX: "hidden", gap: CARD_GAP,
                  paddingLeft: ss(48), paddingRight: ss(48) }}>
                <div style={{ flex: `0 0 ${leftPad}px` }} />
                {items.slice(rw.start, rw.end).map((item, j) => {
                  const col = rw.start + j;
                  const isFocused = isFocusedShelf && col === focus.col;
                  return (
                    <div key={String(item.stream_id ?? item.id ?? col)} style={{ flex: `0 0 ${CARD_W}px` }}>
                      {renderCard(item, isFocused)}
                    </div>
                  );
                })}
                <div style={{ flex: `0 0 ${rightPad}px` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "feat(tv): 2-D virtualized VirtualShelves.tv with D-pad + image budget"
```

---

### Task 4: `tvUseShelves` persisted preference in AppContext

**Files:**
- Modify: `src/context/AppContext.jsx`

**Interfaces:**
- Consumes: existing `storage` abstraction (already imported in AppContext), React `useState`/`useEffect`.
- Produces: `useApp()` returns `tvUseShelves: boolean` and `setTvUseShelves(next: boolean) => void`. Persisted at key `iptv_tv_shelves` ("1"/"0"), default `false`.

- [ ] **Step 1: Add state + hydrate on boot**

Add near the other preference state declarations in the provider:

```javascript
const [tvUseShelves, setTvUseShelvesState] = useState(false);

useEffect(() => {
  storage.getItem("iptv_tv_shelves").then((v) => {
    if (v === "1") setTvUseShelvesState(true);
  });
}, []);

const setTvUseShelves = useCallback((next) => {
  setTvUseShelvesState(next);
  storage.setItem("iptv_tv_shelves", next ? "1" : "0");
}, []);
```

- [ ] **Step 2: Expose on the context value**

In the object passed to the provider's `value=`, add:

```javascript
    tvUseShelves,
    setTvUseShelves,
```

- [ ] **Step 3: Verify it wires up**

Run: `npm test`
Expected: PASS (no regressions; no new test — pref is exercised by the screens/toggle).

- [ ] **Step 4: Commit**

```bash
git add src/context/AppContext.jsx
git commit -m "feat(tv): persisted tvUseShelves preference"
```

---

### Task 5: Toggle row in TV Account/Settings

**Files:**
- Modify: `src/screens/AccountsScreen.tv.jsx`

**Interfaces:**
- Consumes: `tvUseShelves`, `setTvUseShelves` from `useApp()`; existing D-pad focus/field pattern in this screen.
- Produces: a focusable settings row that flips `tvUseShelves` on Enter, showing current state ("Shelves" / "Grid").

- [ ] **Step 1: Read the current focus/field pattern**

Run: `node --test 2>/dev/null; grep -nE "focusIdx|fields|register|enter:" src/screens/AccountsScreen.tv.jsx | head`
Expected: shows how rows/fields are indexed and how Enter is dispatched. Match that pattern exactly for the new row (append one entry to the field list, handle its Enter to call `setTvUseShelves(!tvUseShelves)`).

- [ ] **Step 2: Add the toggle row**

Destructure from `useApp()`:

```javascript
const { tvUseShelves, setTvUseShelves } = useApp();
```

Render a row consistent with the screen's existing rows (adapt class names/markup to the file's convention):

```jsx
<div
  className={`tvl-acc-row${focusIdx === SHELVES_ROW_INDEX ? " tv-focused" : ""}`}
  onClick={() => setTvUseShelves(!tvUseShelves)}
>
  <span>TV Layout</span>
  <span>{tvUseShelves ? "Shelves" : "Grid"}</span>
</div>
```

Wire its Enter into the screen's existing key handling so pressing Enter while focused calls `setTvUseShelves(!tvUseShelves)`, and include the new row in the focusable count/index.

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/screens/AccountsScreen.tv.jsx
git commit -m "feat(tv): Account settings toggle for shelves vs grid layout"
```

---

### Task 6: Wire shelves into Movies + Series TV screens

**Files:**
- Modify: `src/screens/MoviesScreen.tv.jsx`
- Modify: `src/screens/SeriesScreen.tv.jsx`

**Interfaces:**
- Consumes: `tvUseShelves` from `useApp()`; `VirtualShelvesTV` from `../presentation/components/VirtualShelves.tv`; existing hook output (`shelves`, `handleShelfVisible`, `handleLoadMore`, `openCategory`, `selectMovie`/`selectSeries`); existing `VirtualGridTV` path; existing `TVPosterCard` render used by the current grid.
- Produces: each screen renders `<VirtualShelvesTV>` when `tvUseShelves` is true, else the existing grid. Detail/drill-in behavior unchanged.

- [ ] **Step 1: Import + read the pref (Movies)**

```javascript
import { VirtualShelvesTV } from "../presentation/components/VirtualShelves.tv";
// ...
const { tvUseShelves } = useApp();
const { shelves, handleShelfVisible, handleLoadMore, openCategory, selectMovie /* existing */ } = useMovies({ navigation });
```

- [ ] **Step 2: Branch the main content render (Movies)**

Where the screen currently renders `<VirtualGridTV .../>` for the browse view, wrap in a branch. Reuse the SAME card renderer the grid already uses (the `TVPosterCard`-based node with its `loading="lazy" decoding="async"` `<img>`), passed via `renderCard`:

```jsx
{tvUseShelves ? (
  <VirtualShelvesTV
    shelves={shelves}
    onShelfVisible={handleShelfVisible}
    onLoadMore={handleLoadMore}
    onSelect={(item) => selectMovie(item)}
    onSeeAll={(id, name) => openCategory(id, name)}
    renderCard={(item, isFocused) => (
      /* the existing TVPosterCard node this screen already renders per grid cell,
         with isFocused driving the same focus styling the grid used */
      <TVPosterCard item={item} focused={isFocused} onPress={() => selectMovie(item)} />
    )}
  />
) : (
  /* existing VirtualGridTV block, unchanged */
)}
```

Note: only the browse/grid view is branched. The detail view, "see all" `CategoryPage` (which uses `VirtualGridTV`), and Back handling are untouched — `onSeeAll` calls the same `openCategory` the grid already uses.

- [ ] **Step 3: Repeat Steps 1–2 for Series**

Apply the identical change to `SeriesScreen.tv.jsx` using `useSeries`, `selectSeries` (its actual selector name in that file), and its existing card renderer.

- [ ] **Step 4: Verify build + tests**

Run: `npm test`
Expected: PASS. Then manually confirm with the toggle OFF both screens render exactly as before (regression gate).

- [ ] **Step 5: Commit**

```bash
git add src/screens/MoviesScreen.tv.jsx src/screens/SeriesScreen.tv.jsx
git commit -m "feat(tv): render VirtualShelves on Movies/Series when tvUseShelves is on"
```

- [ ] **Step 6: On-device verification (manual, per spec)**

On webOS emulator + a low-end box, toggle Shelves on, D-pad deep into a rail and across many shelves. In DevTools confirm: mounted `<img>` count stays ≤ ~45; JS/GPU memory does not climb with scroll depth; posters do not blank/re-decode; per-shelf column is remembered on vertical moves; Back yields to navbar.

---

### Task 7: Horizontal virtualization in `ContentShelf.web` (Electron optimization)

**Files:**
- Modify: `src/presentation/components/ContentShelf.web.jsx`

**Interfaces:**
- Consumes: `railWindow` from `./shelfWindow.js`.
- Produces: same public props and visual/behavioral output as today; internally mounts only a horizontal window of cards with left/right spacer widths preserving `scrollLeft`.

- [ ] **Step 1: Track a scroll-derived visible window**

Import the helper and add state driven by the rail's existing `onScroll`:

```javascript
import { railWindow } from "./shelfWindow.js";
// inside component:
const CARD_W = ss(200), CARD_GAP = ss(8), VISIBLE = 12, BUF = 6;
const [firstVisible, setFirstVisible] = useState(0);
```

In the existing `handleScroll(e)`, after the load-more check, derive the first visible index:

```javascript
const first = Math.floor(e.target.scrollLeft / (CARD_W + CARD_GAP));
setFirstVisible(first);
```

- [ ] **Step 2: Window the rendered items with spacers**

Replace the `items.map(...)` body with a windowed slice using `railWindow(firstVisible + Math.floor(VISIBLE/2), items.length, VISIBLE, BUF, true)`, rendering a left spacer `div` of width `start*(CARD_W+CARD_GAP)` and a right spacer of `(items.length-end)*(CARD_W+CARD_GAP)` around the mapped slice. Keep `renderItem`/`PosterCard`, `key`, and the `loadingMore` spinner exactly as-is.

- [ ] **Step 3: Verify no visual/behavior regression**

Run: `npm test`
Expected: PASS. Then in Electron scroll a long rail: cards appear/disappear seamlessly, scroll position and prev/next buttons behave as before, load-more still fires near the end.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/components/ContentShelf.web.jsx
git commit -m "perf(web): horizontal virtualization for deep shelf rails"
```

---

### Task 8: Mobile shelf `ScrollView` → horizontal `FlatList`

**Files:**
- Modify: `src/presentation/components/ContentShelf.native.jsx`

**Interfaces:**
- Consumes: `FlatList` from `react-native`.
- Produces: same props/output; the horizontal rail uses a `FlatList` with true windowing. `onVisible`/`onLoadMore` semantics identical.

- [ ] **Step 1: Replace the horizontal ScrollView**

Swap the horizontal `<ScrollView removeClippedSubviews>` for:

```jsx
<FlatList
  horizontal
  data={items}
  keyExtractor={(item, i) => String(item.stream_id ?? item.id ?? i)}
  renderItem={({ item }) => (renderItem ? renderItem(item) : <PosterCard item={item} onPress={onPress} />)}
  showsHorizontalScrollIndicator={false}
  initialNumToRender={6}
  windowSize={5}
  maxToRenderPerBatch={6}
  removeClippedSubviews
  onEndReachedThreshold={0.5}
  onEndReached={() => { if (hasMore && !loadingMore) onLoadMore?.(); }}
  ListFooterComponent={loadingMore ? <ActivityIndicator /> : null}
/>
```

Keep the existing title/`onVisible` wrapper around it unchanged.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS. Then on a device/emulator scroll a long rail: smooth, load-more fires near the end, no visual change vs. before.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/components/ContentShelf.native.jsx
git commit -m "perf(mobile): horizontal FlatList windowing for shelf rails"
```

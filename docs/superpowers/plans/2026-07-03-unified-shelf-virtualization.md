# Unified Shelf Virtualization + Lazy Fetch (Movies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only visible shelves/posters plus a small tuned lookahead across web/native/tv for the Movies surface, sliding a true mount window over already-fetched arrays, while keeping per-shelf fetch lazy.

**Architecture:** One pure, unit-tested windowing core (`windowMath.js`) + a per-platform config table (`shelfConfig.js`) + a thin React hook (`useShelfWindow`). Web and TV render DOM windows with spacer divs on both sides; native keeps `FlatList` with window props derived from the shared config. TV anchors its window on the deterministic D-pad focus index via the existing edge-based `scrollAnchor()` (never on async scroll reads), which structurally avoids the prior webOS blank-poster bug.

**Tech Stack:** React / React Native / Expo (web export for TV/webOS), plain `node --test` for unit tests, `detectPlatform()` for platform branching.

## Global Constraints

- **Movies only.** Series and Live TV are out of scope for this plan.
- **Xtream API has no paging** — `get_vod_streams&category_id=` returns the whole category. There is no per-shelf network "load more"; the window slides over the already-fetched full array.
- **webOS 3.x / Tizen 2016 floor:** Chromium 38. **No `IntersectionObserver`** may be used as a visibility primitive on the TV path.
- **TV window must be anchored on focus via `scrollAnchor()`**, never on async scroll-position reads (`railFirst`/`onRailScroll` window state). Scroll reads are allowed only for chevron edge hints (UI, not virtualization).
- **The focused card/row must always be inside the mounted window** on TV (invariant).
- **Lookahead ≈ 4 baseline, tuned per platform**, lives only in `shelfConfig.js`.
- **Tests run with:** `npm run test` (which runs `node --test` over `*.test.js` under `src/` and `scripts/`).
- Native horizontal rail keeps `removeClippedSubviews={false}` (avoids blank flashes).
- Preserve existing behavior: D-pad focus, focused-card scroll-into-view, hero debounce swap, poster prefetch, chevron hints, lazy per-shelf fetch (no fetch storm on 100+ categories), TMDB Top-Rated cursor.

---

## File Structure

- **Create:** `src/presentation/virtualization/windowMath.js` — pure axis-agnostic window math.
- **Create:** `src/presentation/virtualization/windowMath.test.js` — unit tests.
- **Create:** `src/presentation/virtualization/shelfConfig.js` — per-platform tuning table.
- **Create:** `src/presentation/virtualization/shelfConfig.test.js` — unit tests.
- **Create:** `src/presentation/virtualization/useShelfWindow.js` — memoized React hook over `computeWindow`.
- **Modify:** `src/presentation/components/shelfWindow.js` — re-export `computeWindow`; keep `scrollAnchor`/`railEdges`/`clampCol`/`nearRailEnd`.
- **Modify:** `src/presentation/components/ContentShelf.web.jsx` — consume `useShelfWindow` for the horizontal rail.
- **Modify:** `src/screens/MoviesScreen.web.jsx` — window the vertical shelf list (was `map()`).
- **Modify:** `src/presentation/components/VirtualShelves.tv.jsx` — window both axes, focus-anchored; drop `MAX_PER_SHELF=8`.
- **Modify:** `src/presentation/components/ContentShelf.native.jsx` + `src/screens/MoviesScreen.native.jsx` — derive `FlatList` window props from `shelfConfig`.
- **Modify:** `src/domain/hooks/useMovies.js` — `items` becomes the full fetched array; window replaces the `SHELF_PAGE` growth slice; `onShelfVisible` fires from the vertical leading edge + overscan.

---

## Task 1: Pure window math core

**Files:**
- Create: `src/presentation/virtualization/windowMath.js`
- Test: `src/presentation/virtualization/windowMath.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeWindow({ anchor, total, viewportCount, overscan }) → { start, end, leadingCount, trailingCount }`. `start`/`end` are a half-open slot range to mount; `leadingCount = start`; `trailingCount = total - end`. Clamped to `[0, total]`; always includes `anchor` when `0 ≤ anchor < total`.

- [ ] **Step 1: Write the failing test**

```js
// src/presentation/virtualization/windowMath.test.js
const test = require("node:test");
const assert = require("node:assert");
const { computeWindow } = require("./windowMath.js");

test("windows around the anchor with overscan on both sides", () => {
  const w = computeWindow({ anchor: 10, total: 100, viewportCount: 5, overscan: 4 });
  assert.deepStrictEqual(w, { start: 6, end: 19, leadingCount: 6, trailingCount: 81 });
});

test("clamps start at 0 near the head", () => {
  const w = computeWindow({ anchor: 1, total: 100, viewportCount: 5, overscan: 4 });
  assert.strictEqual(w.start, 0);
  assert.strictEqual(w.leadingCount, 0);
});

test("clamps end at total near the tail", () => {
  const w = computeWindow({ anchor: 98, total: 100, viewportCount: 5, overscan: 4 });
  assert.strictEqual(w.end, 100);
  assert.strictEqual(w.trailingCount, 0);
});

test("always includes the anchor slot", () => {
  for (const anchor of [0, 3, 50, 99]) {
    const w = computeWindow({ anchor, total: 100, viewportCount: 5, overscan: 4 });
    assert.ok(anchor >= w.start && anchor < w.end, `anchor ${anchor} inside [${w.start},${w.end})`);
  }
});

test("empty list yields an empty window", () => {
  const w = computeWindow({ anchor: 0, total: 0, viewportCount: 5, overscan: 4 });
  assert.deepStrictEqual(w, { start: 0, end: 0, leadingCount: 0, trailingCount: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/presentation/virtualization/windowMath.test.js`
Expected: FAIL — `Cannot find module './windowMath.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/presentation/virtualization/windowMath.js
// Pure, axis-agnostic mount-window math shared by the web horizontal rail,
// the web vertical shelf list, and the TV 2-D shelf browser. No React, no DOM.
//
// `anchor` is the index of the first visible slot on this axis (poster column
// or shelf row). The window is [start, end): the visible page plus `overscan`
// slots kept mounted on each side. Clamped to [0, total]; always contains the
// anchor. `leadingCount`/`trailingCount` size the spacer stand-ins for the
// unmounted slots so scroll geometry is preserved.
export function computeWindow({ anchor, total, viewportCount, overscan = 4 }) {
  const t = Math.max(0, Math.trunc(total));
  if (t === 0) return { start: 0, end: 0, leadingCount: 0, trailingCount: 0 };
  const a = Math.min(Math.max(0, Math.trunc(anchor)), t - 1);
  const start = Math.max(0, a - overscan);
  const end = Math.min(t, a + Math.max(1, viewportCount) + overscan);
  return { start, end, leadingCount: start, trailingCount: t - end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/presentation/virtualization/windowMath.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/virtualization/windowMath.js src/presentation/virtualization/windowMath.test.js
git commit -m "feat(virtualization): pure computeWindow core with unit tests"
```

---

## Task 2: Per-platform shelf config

**Files:**
- Create: `src/presentation/virtualization/shelfConfig.js`
- Test: `src/presentation/virtualization/shelfConfig.test.js`

**Interfaces:**
- Consumes: `detectPlatform()` from `src/platform/configs/detectPlatform.js` (returns one of `"web" | "native" | "tv"` — confirm exact return values by reading that file before implementing; branch on its actual values).
- Produces: `getShelfConfig(platform?) → { hOverscan, vOverscan, posterWidth, posterGap, rowHeight }`. `platform` optional; defaults to `detectPlatform()`. TV has the largest overscan.

- [ ] **Step 1: Write the failing test**

```js
// src/presentation/virtualization/shelfConfig.test.js
const test = require("node:test");
const assert = require("node:assert");
const { getShelfConfig } = require("./shelfConfig.js");

test("every platform exposes the full config shape", () => {
  for (const p of ["web", "native", "tv"]) {
    const c = getShelfConfig(p);
    for (const k of ["hOverscan", "vOverscan", "posterWidth", "posterGap", "rowHeight"]) {
      assert.strictEqual(typeof c[k], "number", `${p}.${k} is a number`);
    }
  }
});

test("baseline overscan is ~4 and TV overscans more than web", () => {
  assert.ok(getShelfConfig("web").hOverscan >= 3 && getShelfConfig("web").hOverscan <= 5);
  assert.ok(getShelfConfig("tv").hOverscan > getShelfConfig("web").hOverscan);
});

test("unknown platform falls back to web config", () => {
  assert.deepStrictEqual(getShelfConfig("nope"), getShelfConfig("web"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/presentation/virtualization/shelfConfig.test.js`
Expected: FAIL — `Cannot find module './shelfConfig.js'`.

- [ ] **Step 3: Write minimal implementation**

Read `src/platform/configs/detectPlatform.js` first and match its exact return values in the default branch.

```js
// src/presentation/virtualization/shelfConfig.js
// Single home for the "keep ~4 ahead" lookahead knob and poster/row geometry,
// tuned per platform. TV overscans more to mask D-pad latency and guarantee the
// focused card sits comfortably inside the mounted window.
import { detectPlatform } from "../../platform/configs/detectPlatform.js";

const CONFIG = {
  web:    { hOverscan: 4, vOverscan: 2, posterWidth: 290, posterGap: 8,  rowHeight: 360 },
  native: { hOverscan: 4, vOverscan: 2, posterWidth: 150, posterGap: 10, rowHeight: 240 },
  tv:     { hOverscan: 6, vOverscan: 2, posterWidth: 340, posterGap: 12, rowHeight: 520 },
};

export function getShelfConfig(platform) {
  const p = platform || detectPlatform();
  return CONFIG[p] || CONFIG.web;
}
```

Note: `posterWidth`/`rowHeight` here are logical baselines; renderers that already scale via `ss()` should keep scaling — this table exists to co-locate overscan and give windowing a stride reference. Adjust the numeric values to match each renderer's existing measured card/row sizes when wiring Tasks 4–6 (keep them consistent, don't invent new sizes).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/presentation/virtualization/shelfConfig.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/virtualization/shelfConfig.js src/presentation/virtualization/shelfConfig.test.js
git commit -m "feat(virtualization): per-platform shelf config (tuned overscan)"
```

---

## Task 3: useShelfWindow hook + shelfWindow re-export

**Files:**
- Create: `src/presentation/virtualization/useShelfWindow.js`
- Modify: `src/presentation/components/shelfWindow.js`
- Test: reuse `src/presentation/virtualization/windowMath.test.js` (hook is a thin wrapper; no separate render test needed — it is exercised by the renderer manual checks).

**Interfaces:**
- Consumes: `computeWindow` (Task 1).
- Produces:
  - `useShelfWindow({ anchor, total, viewportCount, overscan, stride }) → { start, end, leadingPad, trailingPad }` — memoized; `leadingPad = leadingCount * stride`, `trailingPad = trailingCount * stride` (px).
  - `shelfWindow.js` re-exports `computeWindow` so existing importers can migrate incrementally; `windowFromAnchor` stays as a compatibility wrapper delegating to `computeWindow`.

- [ ] **Step 1: Write the hook**

```js
// src/presentation/virtualization/useShelfWindow.js
import { useMemo } from "react";
import { computeWindow } from "./windowMath.js";

// Thin memoized wrapper: turns window slot counts into px pad sizes for the
// spacer divs. `stride` is item extent + gap on this axis.
export function useShelfWindow({ anchor, total, viewportCount, overscan, stride }) {
  return useMemo(() => {
    const w = computeWindow({ anchor, total, viewportCount, overscan });
    return {
      start: w.start,
      end: w.end,
      leadingPad: w.leadingCount * stride,
      trailingPad: w.trailingCount * stride,
    };
  }, [anchor, total, viewportCount, overscan, stride]);
}
```

- [ ] **Step 2: Wire the re-export in shelfWindow.js**

Add to the top of `src/presentation/components/shelfWindow.js` (keep all existing exports — `scrollAnchor`, `windowFromAnchor`, `railEdges`, `clampCol`, `nearRailEnd` — intact):

```js
export { computeWindow } from "../virtualization/windowMath.js";
```

Leave `windowFromAnchor` as-is; it is still used by the TV vertical fetch-gate. Do not delete anything in this task.

- [ ] **Step 3: Run the full unit suite to confirm nothing broke**

Run: `npm run test`
Expected: PASS, including existing `shelfWindow.test.js`.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/virtualization/useShelfWindow.js src/presentation/components/shelfWindow.js
git commit -m "feat(virtualization): useShelfWindow hook + shelfWindow re-export"
```

---

## Task 4: useMovies — full array + leading-edge fetch

**Files:**
- Modify: `src/domain/hooks/useMovies.js`

**Interfaces:**
- Consumes: existing `shelves` state, `handleShelfVisible(catId)`, item cache.
- Produces: shelves where `items` is the **full** fetched array (not a `SHELF_PAGE` slice) once loaded; `totalCount = items.length`; `hasMore = false` for windowed platforms (window replaces client reveal). `handleLoadMore` becomes a no-op for windowed platforms (kept as an exported stub so screen props don't break). This is what Tasks 5–7 render against.

- [ ] **Step 1: Read the current slice logic**

Read `src/domain/hooks/useMovies.js` lines ~25 (`SHELF_PAGE`), ~140–183 (`handleShelfVisible`, `handleLoadMore`). Confirm exact variable names before editing.

- [ ] **Step 2: Change `handleShelfVisible` to store the full array**

In `handleShelfVisible`, replace the `all.slice(0, SHELF_PAGE)` assignment so the shelf's `items` receives the full `all` array. Set `totalCount: all.length` and `hasMore: false`. Keep the fetch, cache write, and the loaded-set dedupe exactly as they are. Example shape (adapt to the real surrounding code):

```js
// was: items: all.slice(0, SHELF_PAGE), hasMore: all.length > SHELF_PAGE
setShelves(prev => prev.map(s =>
  s.id === catId ? { ...s, items: all, totalCount: all.length, hasMore: false } : s
));
```

- [ ] **Step 3: Neutralize `handleLoadMore` for windowed platforms**

`handleLoadMore` no longer grows a slice (the window handles reveal). Keep it exported to preserve the screen prop contract, but make it a no-op (early `return`) so no re-slice happens. Leave the TMDB `handleTopRatedMore` path untouched — that is real remote paging and must keep working.

- [ ] **Step 4: Run the app on web to confirm shelves still populate**

Run: `npm run web` then load the Movies tab.
Expected: shelves fetch on scroll and show their posters (now backed by the full array; horizontal windowing in Task 5 keeps mounts bounded).

- [ ] **Step 5: Commit**

```bash
git add src/domain/hooks/useMovies.js
git commit -m "feat(movies): store full category array; window replaces slice reveal"
```

---

## Task 5: Web — horizontal rail on shared core + vertical shelf window

**Files:**
- Modify: `src/presentation/components/ContentShelf.web.jsx`
- Modify: `src/screens/MoviesScreen.web.jsx`

**Interfaces:**
- Consumes: `useShelfWindow` (Task 3), `getShelfConfig` (Task 2), full-array shelves (Task 4).
- Produces: web Movies renders only visible + lookahead posters (horizontal) and only visible + lookahead shelves (vertical), with spacer divs both sides.

- [ ] **Step 1: Refactor the horizontal rail (`ContentShelf.web.jsx`)**

Read the current windowing block (`CARD_W`, `CARD_GAP`, `H_VISIBLE`, `H_OVERSCAN`, `handleScroll`, `windowFromAnchor`, spacer divs). Replace the ad-hoc constants + `windowFromAnchor` call with:

```js
import { useShelfWindow } from "../virtualization/useShelfWindow.js";
import { getShelfConfig } from "../virtualization/shelfConfig.js";

const cfg = getShelfConfig("web");
const stride = ss(cfg.posterWidth) + ss(cfg.posterGap);
const viewportCount = Math.max(1, Math.round(containerWidth / stride));
const anchor = Math.floor(scrollLeft / stride);
const { start, end, leadingPad, trailingPad } = useShelfWindow({
  anchor, total: items.length, viewportCount, overscan: cfg.hOverscan, stride,
});
```

Render `items.slice(start, end)` between a left spacer `<div style={{ width: leadingPad, flex: "0 0 auto" }} />` and a right spacer `<div style={{ width: trailingPad, flex: "0 0 auto" }} />`. Keep the existing `overflowX:auto` container, drag-scroll, and chevron buttons. Remove the now-dead `onLoadMore`-near-end call (window covers the whole array; `hasMore` is false).

- [ ] **Step 2: Add the vertical shelf window (`MoviesScreen.web.jsx`)**

Read the current `shelves.map(...)` block inside the `<ScrollView>`. Add a scroll handler on the scroll container that records `scrollTop`, compute the vertical window:

```js
import { useShelfWindow } from "../presentation/virtualization/useShelfWindow.js";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

const cfg = getShelfConfig("web");
const rowStride = ss(cfg.rowHeight);
const rowsVisible = Math.max(1, Math.ceil(viewportHeight / rowStride));
const vAnchor = Math.floor(scrollTop / rowStride);
const vWin = useShelfWindow({
  anchor: vAnchor, total: shelves.length, viewportCount: rowsVisible,
  overscan: cfg.vOverscan, stride: rowStride,
});
```

Render a top spacer `<div style={{ height: vWin.leadingPad }} />`, then `shelves.slice(vWin.start, vWin.end).map(...)` (each shelf wrapper fixed to `height: rowStride` so geometry is exact), then a bottom spacer `<div style={{ height: vWin.trailingPad }} />`. Keep passing `onVisible` per shelf; a shelf now becomes "visible" simply by entering the window (call `onVisible` in a per-shelf mount effect instead of the removed IntersectionObserver, OR keep IO on web only — web has IO; the TV path must not).

- [ ] **Step 3: Verify on web**

Run: `npm run web`, open Movies. Scroll vertically: only near-viewport shelves are in the DOM (check devtools — spacer divs hold height). Scroll a shelf horizontally past ~20 items: posters mount/unmount, no gaps, no blank cards. Categories still fetch as their row nears the viewport.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/components/ContentShelf.web.jsx src/screens/MoviesScreen.web.jsx
git commit -m "feat(movies/web): shared-core horizontal rail + windowed vertical shelves"
```

---

## Task 6: TV — focus-anchored window on both axes (drop 8-cap)

**Files:**
- Modify: `src/presentation/components/VirtualShelves.tv.jsx`

**Interfaces:**
- Consumes: `computeWindow` (Task 1) via `shelfWindow.js` re-export, `scrollAnchor`/`clampCol`/`nearRailEnd`/`railEdges` (existing), `getShelfConfig` (Task 2), full-array shelves (Task 4).
- Produces: TV Movies renders only visible + lookahead shelves (vertical) and only visible + lookahead posters per rail (horizontal), both anchored on the **focus index** through `scrollAnchor`, with spacer divs. `MAX_PER_SHELF` removed. Focused card/row always mounted.

This is the risk surface (reverses the 2026-07-02 de-virtualization). Follow the mitigations in the Global Constraints exactly.

- [ ] **Step 1: Remove the 8-cap and the hard slice**

Read `VirtualShelves.tv.jsx`. Delete `MAX_PER_SHELF = 8` (line ~22) and the `shelf.items.slice(0, MAX_PER_SHELF)` (lines ~476–479). Rails now consider `shelf.items` in full.

- [ ] **Step 2: Vertical shelf window (render gate, focus-anchored)**

The file already computes a vertical `fetchWin`/`vWin` from `focus.shelfAnchor` via `windowFromAnchor` and uses it only as a fetch gate (per the 2026-07-02 change). Re-promote it to also gate **render**: keep the fetch use, and additionally render only `shelves.slice(vWin.start, vWin.end)` inside top/bottom spacer divs sized `vWin.leadingCount * ROW_HEIGHT` / `vWin.trailingCount * ROW_HEIGHT`. Derive the vertical anchor from focus via `scrollAnchor(prevShelfAnchor, focus.shelf, rowsVisible, shelves.length)` (edge-based), NOT directly from `focus.shelf`. Because each row is fixed `ROW_HEIGHT` and spacers stand in for off-window rows, the existing `scrollTop = railsTop + focus.shelfAnchor * ROW_HEIGHT` formula stays exact.

- [ ] **Step 3: Horizontal rail window (focus-anchored)**

For each rendered rail, compute a per-rail anchor from the *column focus* through `scrollAnchor`:

```js
import { getShelfConfig } from "../virtualization/shelfConfig.js";
import { scrollAnchor, computeWindow, clampCol } from "./shelfWindow.js";

const cfg = getShelfConfig("tv");
const stride = CARD_W + CARD_GAP; // existing measured stride
const colsVisible = dims.cols;    // existing measured visible columns
// focused rail uses live focus.col; idle rails use their remembered column
const railFocusCol = isFocusedShelf ? focus.col : (colMemory[shelf.id] ?? 0);
const railAnchor = scrollAnchor(prevRailAnchor[shelf.id] ?? 0, clampCol(railFocusCol, items.length), colsVisible, items.length);
const w = computeWindow({ anchor: railAnchor, total: items.length, viewportCount: colsVisible, overscan: cfg.hOverscan });
```

Render `items.slice(w.start, w.end)` between left/right spacer divs (`flex: 0 0 <leadingCount*stride>px` / `trailingCount*stride`). Keep the absolute-column key (`key={w.start + i}` mapped to real column index) so duplicate `stream_id`s stay safe. Keep tagging `focusedCardRef` on the card where `isFocusedShelf && realCol === focus.col`. **Assert the invariant**: `focus.col` must be within `[w.start, w.end)` for the focused rail — because `scrollAnchor` moves the anchor to keep focus in the visible page and `computeWindow` adds overscan around it, this holds; if a future change breaks it, the focused card unmounts (the old bug). Add a dev-only console.warn guard.

- [ ] **Step 4: Purge scroll-read window state; keep chevrons only**

Ensure there is no window state driven by `onRailScroll`/`scrollLeft` reads. The horizontal `onScroll` handler may remain **only** to compute `railEdges` for chevron fade hints (UI). The mount window comes exclusively from focus via `scrollAnchor`. Keep the "Apply scroll" effect that sets `focusedCardRef` into view (`offsetLeft`/`offsetWidth`) and restores idle-rail `scrollLeft`.

- [ ] **Step 5: Keep `handleLoadMore`/`nearRailEnd` inert but harmless**

Since `items` is the full array (Task 4) and `hasMore` is false, `nearRailEnd` won't trigger a fetch. Leave the wiring; do not fetch. Poster prefetch (warming images ahead of the cursor) stays.

- [ ] **Step 6: Build and validate on the webOS simulator (mandatory gate)**

Run: `npm run sim:lg`
Verify on-device:
- Vertical D-pad through many categories: **no blank rails**; each fetches just-in-time as its row nears the viewport; no fetch storm on a 100+ category account.
- Horizontal D-pad along a long rail **well past 8 posters**: **no blank posters**, focused card always present and ringed, focus scroll-into-view correct.
- Chevrons, hero debounce swap, idle-rail scroll restore all intact.
- Return to a shelf: remembered column restored, window correct.

If blank posters reappear, do NOT paper over with larger overscan alone — confirm the anchor is coming from `scrollAnchor(focus)` and not any scroll read, and that the focused index is inside `[start, end)`.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "feat(movies/tv): focus-anchored window on both axes; drop 8-poster cap"
```

---

## Task 7: Native — FlatList window props from shared config

**Files:**
- Modify: `src/presentation/components/ContentShelf.native.jsx`
- Modify: `src/screens/MoviesScreen.native.jsx`

**Interfaces:**
- Consumes: `getShelfConfig("native")` (Task 2), full-array shelves (Task 4).
- Produces: native `FlatList` lookahead derived from the shared config; behavior matches web/tv lookahead semantics. No hand-rolled windowing (FlatList owns it).

- [ ] **Step 1: Derive horizontal FlatList props (`ContentShelf.native.jsx`)**

Read the current horizontal `FlatList` props (`initialNumToRender={9}`, `windowSize={7}`, `maxToRenderPerBatch={6}`, `removeClippedSubviews={false}`). Replace the magic numbers with values derived from config so the "~4 ahead" knob is centralized:

```js
import { getShelfConfig } from "../virtualization/shelfConfig.js";
const cfg = getShelfConfig("native");
// visibleCols computed from measured row width / stride (existing posterShelfWidth logic)
const initialNumToRender = visibleCols + cfg.hOverscan;
```

Set `initialNumToRender={initialNumToRender}`, keep `windowSize` (a viewport multiple, e.g. 3–5) and `removeClippedSubviews={false}` on the horizontal rail. `data` stays the full `items` array.

- [ ] **Step 2: Derive vertical FlatList props (`MoviesScreen.native.jsx`)**

Read the vertical `FlatList` (`windowSize={5}`, `maxToRenderPerBatch={3}`, `initialNumToRender={3}`, `removeClippedSubviews`). Set `initialNumToRender` from `cfg.vOverscan` + a small visible-rows base (e.g. `2 + cfg.vOverscan`). Keep `removeClippedSubviews` on for the vertical list.

- [ ] **Step 3: Verify on a device/simulator**

Run: `npm run ios` (or `npm run android`). Scroll Movies vertically and a rail horizontally: smooth, lookahead present, no blank flashes on the horizontal rail.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/components/ContentShelf.native.jsx src/screens/MoviesScreen.native.jsx
git commit -m "feat(movies/native): FlatList lookahead from shared shelf config"
```

---

## Task 8: Full-suite regression + cleanup

**Files:**
- Modify (only if needed): `src/presentation/components/shelfWindow.test.js`

- [ ] **Step 1: Run the entire unit suite**

Run: `npm run test`
Expected: PASS, including `windowMath.test.js`, `shelfConfig.test.js`, and existing `shelfWindow.test.js`.

- [ ] **Step 2: Confirm no dead constants remain**

Grep for removed symbols to ensure nothing dangles:

```bash
grep -rn "MAX_PER_SHELF\|SHELF_PAGE" src/ || echo "clean"
```

Expected: no references in the Movies path (Series/Live TV may still use `SHELF_PAGE` — leave those; they are out of scope).

- [ ] **Step 3: Final commit if any cleanup was made**

```bash
git add -A && git commit -m "chore(virtualization): regression pass + dead-constant cleanup"
```

---

## Self-Review

**Spec coverage:**
- Pure core (`computeWindow`) → Task 1. ✅
- Per-platform tuned overscan (`shelfConfig`) → Task 2. ✅
- `useShelfWindow` + `shelfWindow` re-export → Task 3. ✅
- Full-array + leading-edge lazy fetch (`useMovies`) → Task 4. ✅
- Web horizontal shared core + vertical window → Task 5. ✅
- TV both-axes focus-anchored window, drop 8-cap, mitigations → Task 6. ✅
- Native FlatList props from config → Task 7. ✅
- Regression/cleanup → Task 8. ✅
- Out-of-scope (Series, Live TV, grids, TMDB cursor, API paging) explicitly excluded in Global Constraints and Task 4/6/8 notes. ✅

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Modification tasks reference exact files, current symbols to read, and show the new code. Where existing measured values (`CARD_W`, `dims.cols`, `posterShelfWidth`) must be reused, they are named explicitly rather than re-invented. ✅

**Type consistency:** `computeWindow` returns `{start,end,leadingCount,trailingCount}` (Task 1) consumed as such in Tasks 3/6; `useShelfWindow` returns `{start,end,leadingPad,trailingPad}` (Task 3) consumed in Task 5; `getShelfConfig` shape (Task 2) consumed in Tasks 5/6/7. Consistent. ✅

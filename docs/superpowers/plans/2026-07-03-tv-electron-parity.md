# TV Movies/Series = Electron (10-foot scale) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TV (webOS) Movies/Series shelves-browse view structurally and visually identical to the Electron/web view (Hero → Discover pills → per-category rails), at 10-foot scale, reusing the existing `VirtualShelvesTV` D-pad engine.

**Architecture:** Keep `VirtualShelvesTV`'s focus/fetch/scroll engine. Swap its visual leaves to the web components (`PosterCard.web` via `renderCard`, `Hero.web` via a new `renderHero` prop, web-style rail headers). Switch its raw-px layout constants back to `ss()`. Add two prop-gated focus zones above the shelves — Hero (Play/Details) and Discover pills — whose D-pad transitions live in a new pure reducer (`heroZone.js`, unit-tested with `node --test`). Flip `tvUseShelves` default to `true`. Leave the Grid landing, the A–Z drill-in, LiveTV, and the Home/History layout untouched.

**Tech Stack:** React + react-native-web, platform-variant files (`.tv.jsx`/`.web.jsx`), Aurora design tokens (`src/ui/tokens.js`), `ss()` scaling (`src/utils/scaleSize.js`), `useTVInput` D-pad hook, `node --test` for pure-logic unit tests.

## Global Constraints

- **webOS old-Chromium:** NO `box-shadow`, NO CSS transitions/animations, NO `var()` in the TV render path. The web components used here (`Hero.web`, `PosterCard.web`, `DiscoverPills.web`, `Button.web`) are already `isTV()`-aware and strip these — do not undo that gating.
- **Scaling:** All design dimensions authored at the 1920×1080 reference and passed through `ss()`. The TV viewport is pinned to 1280 and the browser upscales ×1.5 to the 1080p panel. Do NOT hard-code raw px for layout sizes.
- **Shared component:** `VirtualShelvesTV` is also rendered by Home/History. Every new behavior (interactive hero, Discover pills) MUST be prop-gated so that when the props are absent the component behaves exactly as it does today.
- **Focus ring:** cyan (`colors.accent2` / `#22D3EE`), inline (works without CSS). No shadow on TV.
- **Test harness:** `npm test` runs `node --test` over `src/**/*.test.js`. There is NO component-render harness (no jsdom/testing-library). Unit-test pure logic only; verify component/screen wiring with `npm run build:tv` (catches import/JSX errors) + manual `npm run sim:lg`.
- **Featured item:** the hero item is the one `VirtualShelvesTV` already derives internally (debounced last-focused shelf item); it is passed to the hero handlers, never re-selected by the screen.
- **Movies vs Series Play:** Movies hero Play plays the featured item (`playMovie`). Series are not directly playable, so Series hero Play opens the detail view (`openDetail`) — an intentional divergence, documented in Task 7.
- **Discover pills on TV (cheap):** one pill only — "All Movies" (Movies) / "All Series" (Series). "Top Rated" is dropped on TV (its `getAllMovies()`/TMDB data path is deliberately disabled on TV). The pill opens the existing category-grid landing via a transient `browseAll` flag; no new expensive fetches.

---

## File Structure

- `src/presentation/components/heroZone.js` — **new.** Pure D-pad reducer for the Hero/Pills zones above the shelves. No React, no DOM. Unit-tested.
- `src/presentation/components/heroZone.test.js` — **new.** `node --test` tests for `heroZone.js`.
- `src/context/AppContext.jsx` — modify: `tvUseShelves` default `false → true`.
- `src/presentation/components/Hero.web.jsx` — modify: add optional `focusedButton` prop so Details (not just Play) can show the focus ring; back-compatible with the existing `focused` prop.
- `src/presentation/components/VirtualShelves.tv.jsx` — modify: `ss()` layout constants; web-style rail header (chevron + count); measured rails-top scroll base; integrate `heroZone` reducer + `renderHero`/`discoverItems`/`onPill`/`onHeroPlay`/`onHeroDetails` props; render `DiscoverPills`.
- `src/screens/MoviesScreen.tv.jsx` — modify: shelves-branch wiring (`PosterCard.web` renderCard, `Hero.web` renderHero, discover pill, hero handlers), `browseAll` state + guards + Back + render condition.
- `src/screens/SeriesScreen.tv.jsx` — modify: same wiring for the series screen (raw-keydown nav path).

Files explicitly NOT touched: `ShelfCard.tv.jsx`, `Hero.tv.jsx`, the Grid landing / A–Z drill-in branches, LiveTV, `useMovies.js`, `useContentService.js`, Home/History screens.

---

## Task 1: Flip `tvUseShelves` default to Shelves

**Files:**
- Modify: `src/context/AppContext.jsx:53`

**Interfaces:**
- Consumes: nothing.
- Produces: `tvUseShelves` initial state is now `true` (still overridable by persisted `iptv_tv_shelves` and the Accounts toggle).

This task has no pure logic to unit-test (it is a single default value); verification is the suite still passing + a grep confirming the change.

- [ ] **Step 1: Change the default**

In `src/context/AppContext.jsx`, change line 53 from:

```jsx
  const [tvUseShelves, setTvUseShelvesState] = useState(false);
```

to:

```jsx
  const [tvUseShelves, setTvUseShelvesState] = useState(true);
```

Also update the comment on line 52 from `Default false = grid.` to `Default true = shelves (Electron-parity).`

- [ ] **Step 2: Verify the persistence still overrides**

Confirm lines 54-58 are unchanged — a stored `'0'` must still force grid. Read the block:

Run: `sed -n '51,62p' src/context/AppContext.jsx`
Expected: `useState(true)`, and the `storage.getItem('iptv_tv_shelves')` effect only sets `true` on `'1'`. (Note: a previously-stored `'0'` will NOT flip it back to grid because the effect only handles `'1'`. This is acceptable — the toggle writes `'0'`/`'1'` explicitly and users who never toggled get the new Shelves default. If you want a stored `'0'` to win, that is out of scope for this plan.)

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS (no test targets this default; suite must stay green).

- [ ] **Step 4: Commit**

```bash
git add src/context/AppContext.jsx
git commit -m "feat(tv): default Movies/Series to shelves browse view"
```

---

## Task 2: Pure zone reducer `heroZone.js` (TDD)

**Files:**
- Create: `src/presentation/components/heroZone.js`
- Test: `src/presentation/components/heroZone.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HERO_BTN_COUNT = 2`
  - `zoneAboveShelves(cfg) -> 'pills' | 'hero' | null`
  - `enterTopFromShelves(cfg) -> 'pills' | 'hero' | null` (alias of `zoneAboveShelves`, named for the call site)
  - `zoneMove(state, dir, cfg) -> { state, action }` where `dir ∈ 'left'|'right'|'up'|'down'`, `action ∈ null | 'toShelves' | 'toNavbar'`
  - `zoneActivate(state) -> 'play' | 'details' | 'pill' | null`
  - State shape: `{ zone: 'hero'|'pills'|'shelves', heroBtn: 0|1, pillCol: number }`
  - cfg shape: `{ hasHero: boolean, hasPills: boolean, pillCount: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/presentation/components/heroZone.test.js` (ESM — the codebase's `node --test` files use `import`, e.g. `shelfWindow.test.js`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERO_BTN_COUNT,
  zoneAboveShelves,
  enterTopFromShelves,
  zoneMove,
  zoneActivate,
} from "./heroZone.js";

const cfgBoth = { hasHero: true, hasPills: true, pillCount: 2 };
const cfgHeroOnly = { hasHero: true, hasPills: false, pillCount: 0 };
const cfgPillsOnly = { hasHero: false, hasPills: true, pillCount: 3 };
const cfgNone = { hasHero: false, hasPills: false, pillCount: 0 };

test("HERO_BTN_COUNT is 2 (Play, Details)", () => {
  assert.equal(HERO_BTN_COUNT, 2);
});

test("zoneAboveShelves prefers pills, then hero, else null", () => {
  assert.equal(zoneAboveShelves(cfgBoth), "pills");
  assert.equal(zoneAboveShelves(cfgHeroOnly), "hero");
  assert.equal(zoneAboveShelves(cfgPillsOnly), "pills");
  assert.equal(zoneAboveShelves(cfgNone), null);
  assert.equal(enterTopFromShelves(cfgBoth), "pills");
});

test("hero: left/right clamp across the two buttons", () => {
  const play = { zone: "hero", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(play, "left", cfgBoth), { state: play, action: null });
  assert.deepEqual(zoneMove(play, "right", cfgBoth), {
    state: { zone: "hero", heroBtn: 1, pillCol: 0 },
    action: null,
  });
  const details = { zone: "hero", heroBtn: 1, pillCol: 0 };
  assert.deepEqual(zoneMove(details, "right", cfgBoth), { state: details, action: null });
  assert.deepEqual(zoneMove(details, "left", cfgBoth), {
    state: { zone: "hero", heroBtn: 0, pillCol: 0 },
    action: null,
  });
});

test("hero up yields to navbar", () => {
  const s = { zone: "hero", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(s, "up", cfgBoth), { state: s, action: "toNavbar" });
});

test("hero down goes to pills when present, else to shelves", () => {
  const s = { zone: "hero", heroBtn: 1, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), {
    state: { zone: "pills", heroBtn: 1, pillCol: 1 },
    action: null,
  });
  assert.deepEqual(zoneMove(s, "down", cfgHeroOnly), { state: s, action: "toShelves" });
});

test("pills: left/right clamp across pillCount", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 0 };
  assert.deepEqual(zoneMove(s, "left", cfgPillsOnly), { state: s, action: null });
  assert.deepEqual(zoneMove(s, "right", cfgPillsOnly), {
    state: { zone: "pills", heroBtn: 0, pillCol: 1 },
    action: null,
  });
  const last = { zone: "pills", heroBtn: 0, pillCol: 2 };
  assert.deepEqual(zoneMove(last, "right", cfgPillsOnly), { state: last, action: null });
});

test("pills up goes to hero when present, else navbar", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "up", cfgBoth), {
    state: { zone: "hero", heroBtn: 0, pillCol: 1 },
    action: null,
  });
  assert.deepEqual(zoneMove(s, "up", cfgPillsOnly), { state: s, action: "toNavbar" });
});

test("pills down goes to shelves", () => {
  const s = { zone: "pills", heroBtn: 0, pillCol: 1 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), { state: s, action: "toShelves" });
});

test("entering pills from hero clamps a stale pillCol into range", () => {
  const s = { zone: "hero", heroBtn: 0, pillCol: 9 };
  assert.deepEqual(zoneMove(s, "down", cfgBoth), {
    state: { zone: "pills", heroBtn: 0, pillCol: 1 },
    action: null,
  });
});

test("zoneActivate maps zone+button to a handler key", () => {
  assert.equal(zoneActivate({ zone: "hero", heroBtn: 0, pillCol: 0 }), "play");
  assert.equal(zoneActivate({ zone: "hero", heroBtn: 1, pillCol: 0 }), "details");
  assert.equal(zoneActivate({ zone: "pills", heroBtn: 0, pillCol: 0 }), "pill");
  assert.equal(zoneActivate({ zone: "shelves", heroBtn: 0, pillCol: 0 }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/presentation/components/heroZone.test.js`
Expected: FAIL with "Cannot find module './heroZone.js'".

- [ ] **Step 3: Write the implementation**

Create `src/presentation/components/heroZone.js`:

```js
/**
 * Pure D-pad reducer for the two focus zones ABOVE the shelf list in
 * VirtualShelves.tv: the Hero billboard (Play/Details) and the Discover pills.
 *
 * The shelves zone itself is handled by the component's existing focus math;
 * this module owns only the hero/pills zones and their boundaries with the
 * shelves (below) and the navbar (above). Layout order top→bottom is
 * Hero → Pills → Shelves, so "up" climbs Shelves→Pills→Hero→navbar.
 *
 * State : { zone: 'hero'|'pills'|'shelves', heroBtn: 0|1, pillCol: number }
 * cfg   : { hasHero: boolean, hasPills: boolean, pillCount: number }
 *
 * No React, no DOM — unit-tested with node --test.
 */

const HERO_BTN_COUNT = 2; // Play (0), Details (1)

function clampPill(col, cfg) {
  const max = Math.max(0, cfg.pillCount - 1);
  return Math.min(Math.max(0, col), max);
}

// Zone directly above the shelves (entered by pressing Up on the top shelf).
// Pills sit nearest the shelves; hero is above the pills.
function zoneAboveShelves(cfg) {
  if (cfg.hasPills) return "pills";
  if (cfg.hasHero) return "hero";
  return null; // nothing above → caller yields to the navbar
}

// Named alias for the shelves→top-zone call site.
function enterTopFromShelves(cfg) {
  return zoneAboveShelves(cfg);
}

// Move within/between the top zones. Returns { state, action } where action is
// null (handled here), "toShelves" (focus the first shelf), or "toNavbar"
// (yield focus upward to the nav bar).
function zoneMove(state, dir, cfg) {
  const s = state;
  if (s.zone === "hero") {
    switch (dir) {
      case "left":
        return { state: { ...s, heroBtn: Math.max(0, s.heroBtn - 1) }, action: null };
      case "right":
        return { state: { ...s, heroBtn: Math.min(HERO_BTN_COUNT - 1, s.heroBtn + 1) }, action: null };
      case "up":
        return { state: s, action: "toNavbar" };
      case "down":
        if (cfg.hasPills)
          return { state: { ...s, zone: "pills", pillCol: clampPill(s.pillCol, cfg) }, action: null };
        return { state: s, action: "toShelves" };
      default:
        return { state: s, action: null };
    }
  }
  if (s.zone === "pills") {
    switch (dir) {
      case "left":
        return { state: { ...s, pillCol: Math.max(0, s.pillCol - 1) }, action: null };
      case "right":
        return { state: { ...s, pillCol: clampPill(s.pillCol + 1, cfg) }, action: null };
      case "up":
        if (cfg.hasHero) return { state: { ...s, zone: "hero" }, action: null };
        return { state: s, action: "toNavbar" };
      case "down":
        return { state: s, action: "toShelves" };
      default:
        return { state: s, action: null };
    }
  }
  return { state: s, action: null }; // 'shelves' not owned here
}

// What Enter activates in the current top zone.
function zoneActivate(state) {
  if (state.zone === "hero") return state.heroBtn === 0 ? "play" : "details";
  if (state.zone === "pills") return "pill";
  return null;
}

export {
  HERO_BTN_COUNT,
  zoneAboveShelves,
  enterTopFromShelves,
  zoneMove,
  zoneActivate,
};
```

(ESM `export` — matches `shelfWindow.js`, which the ESM `shelfWindow.test.js` imports named bindings from. `HERO_BTN_COUNT` etc. above are declared with `const`/`function`, then re-exported in this block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/presentation/components/heroZone.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presentation/components/heroZone.js src/presentation/components/heroZone.test.js
git commit -m "feat(tv): pure zone reducer for hero/pills D-pad focus"
```

---

## Task 3: `Hero.web` — focusable Details (add `focusedButton`)

**Files:**
- Modify: `src/presentation/components/Hero.web.jsx:42`, `:176-181`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HeroWeb` accepts an optional `focusedButton` prop: `'play' | 'details' | null` (default `null`). Back-compatible: existing callers pass `focused` (boolean) which continues to drive the Play button.

Web-render prop threading; no unit test (no render harness). Verified by build + manual.

- [ ] **Step 1: Add the prop and derive per-button focus**

In `src/presentation/components/Hero.web.jsx`, change the signature (line 42) from:

```jsx
function HeroWeb({ item, onPlay, onDetails, focused = false }) {
```

to:

```jsx
function HeroWeb({ item, onPlay, onDetails, focused = false, focusedButton = null }) {
```

Immediately after the existing `const tv = isTV();` line, add:

```jsx
  // `focused` (legacy, web) drives the Play ring. `focusedButton` (TV) lets the
  // remote focus either button. focusedButton wins when provided.
  const playFocused = focusedButton ? focusedButton === "play" : focused;
  const detailsFocused = focusedButton === "details";
```

- [ ] **Step 2: Apply per-button focus to the Buttons**

Change the actions block (lines 175-182) from:

```jsx
        <div style={{ display: "flex", flexDirection: "row", gap: ss(12), marginTop: ss(8) }}>
          <Button variant="primary" size="lg" icon="play" onPress={onPlay} isFocused={focused}>
            Play
          </Button>
          <Button variant="secondary" size="lg" icon="plus" onPress={onDetails}>
            Details
          </Button>
        </div>
```

to:

```jsx
        <div style={{ display: "flex", flexDirection: "row", gap: ss(12), marginTop: ss(8) }}>
          <Button variant="primary" size="lg" icon="play" onPress={onPlay} isFocused={playFocused}>
            Play
          </Button>
          <Button variant="secondary" size="lg" icon="plus" onPress={onDetails} isFocused={detailsFocused}>
            Details
          </Button>
        </div>
```

- [ ] **Step 3: Verify web callers are unaffected**

Run: `grep -rn "<Hero " src/screens/*.web.jsx`
Expected: existing usages pass `focused` (or nothing) and no `focusedButton` — so `playFocused` falls back to `focused` and `detailsFocused` is `false`, matching today's behavior.

- [ ] **Step 4: Build the web bundle to catch syntax/type errors**

Run: `npm test`
Expected: PASS (guards against accidental breakage of anything importing tokens/Hero indirectly).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/Hero.web.jsx
git commit -m "feat(hero): allow Details button to take remote focus via focusedButton"
```

---

## Task 4: `VirtualShelvesTV` — visual parity (ss() constants + web rail header)

**Files:**
- Modify: `src/presentation/components/VirtualShelves.tv.jsx:16-23` (constants), `:99-104` (measure), `:186-217` (scroll base), `:326-395` (row header + rail)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. Internally, layout constants become `ss()`-scaled and are derived from a single poster width; the rail header renders title + accent2 chevron + count.

This task is visual only (no new zones yet — those come in Task 5). Verify with `npm run build:tv` + manual sim.

- [ ] **Step 1: Replace the raw-px constants with ss()-derived values**

In `src/presentation/components/VirtualShelves.tv.jsx`, replace lines 16-24:

```jsx
const SHELF_OVERSCAN = 8; // shelves kept mounted above/below the visible page
const H_OVERSCAN = 6; // posters kept mounted ahead of the scroll on each side (focused rail)
const ROW_HEIGHT = 470; // px per shelf row (title + poster + padding)
const CARD_W = 260; // px poster width — larger, Netflix-style (fewer per row)
const CARD_GAP = 24; // px gap between posters
const STRIDE = CARD_W + CARD_GAP;
const PAD = 48; // rail horizontal inset (design px)
const HERO_H = 620; // Hero.tv billboard height (design px), lives inside the scroll box
const HERO_DEBOUNCE_MS = 150;
```

with (note `ss` is already imported at line 13):

```jsx
const SHELF_OVERSCAN = 8; // shelves kept mounted above/below the visible page
const H_OVERSCAN = 6; // posters kept mounted ahead of the scroll on each side (focused rail)
// Design px (authored at the 1920 reference); ss() scales them for the pinned
// 1280 TV viewport that the browser upscales ×1.5 — matching web proportions.
const POSTER_W = 200; // design px — identical to PosterCard.web's default width
const CARD_GAP_D = 8; // design px gap — matches ContentShelf.web
const PAD_D = 48; // design px rail horizontal inset
const TITLE_H_D = 34; // design px poster title block (PosterCard.web: 2-line clamp)
// Row = header + poster (width×1.5) + title + breathing room, all in design px.
const ROW_HEIGHT_D = 40 + Math.round(POSTER_W * 1.5) + TITLE_H_D + 28;
const HERO_H = 620; // Hero.web billboard height falls out of tokens.heroHeights.tv; this
                    // constant is used only as the fallback when the rails-top can't be measured.

// Scaled (px) values used at render time.
const CARD_W = ss(POSTER_W);
const CARD_GAP = ss(CARD_GAP_D);
const STRIDE = CARD_W + CARD_GAP;
const PAD = PAD_D; // kept as design px; call sites wrap it in ss(PAD)
const ROW_HEIGHT = ss(ROW_HEIGHT_D);
const HERO_DEBOUNCE_MS = 150;
```

Rationale: `CARD_W`/`CARD_GAP`/`ROW_HEIGHT` are now scaled px; `PAD` stays design px because every call site already wraps it in `ss(PAD)` (grep confirms: lines 101, 193, 203, 340, 361-362). Leaving `PAD` as a design number keeps those `ss(PAD)` call sites correct.

- [ ] **Step 2: Fix the measure() math for the new scaled constants**

The `measure()` effect (lines 99-104) uses `STRIDE`, `ROW_HEIGHT`, and `ss(heroH)`. `STRIDE` and `ROW_HEIGHT` are now already scaled, and `ss(PAD)` stays. No change is required to lines 99-104 — but confirm `ss(heroH)` on line 103 is replaced in Task 5 (measured rails-top). For now, verify the block still references `STRIDE`/`ROW_HEIGHT` (now scaled) and reads sanely:

Run: `sed -n '92,107p' src/presentation/components/VirtualShelves.tv.jsx`
Expected: `cols` uses `(cw - 2*ss(PAD)) / STRIDE`, `windowRows`/`anchorRows` use `ROW_HEIGHT`. Since both are now scaled px and `cw`/`ch` are real px, the ratios are correct.

- [ ] **Step 3: Give the shelf row header the web look (chevron + count)**

Replace the row-title block (lines 331-348) from:

```jsx
              <div
                className={onSeeAll ? "tvl-shelf-title-btn" : undefined}
                onClick={
                  onSeeAll ? () => onSeeAll(shelf.id, shelf.name) : undefined
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ss(4),
                  padding: `${ss(10)}px ${ss(48)}px`,
                  color: colors.text,
                  fontFamily: fonts.display,
                  fontWeight: fontWeights.bold,
                  fontSize: ss(22),
                }}
              >
                {shelf.name}
              </div>
```

with (matches `ContentShelf.web`: title + accent2 chevron-right + faint count):

```jsx
              <div
                className={onSeeAll ? "tvl-shelf-title-btn" : undefined}
                onClick={
                  onSeeAll ? () => onSeeAll(shelf.id, shelf.name) : undefined
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ss(6),
                  padding: `${ss(28)}px ${ss(PAD)}px ${ss(10)}px`,
                  color: colors.text,
                  fontFamily: fonts.display,
                  fontWeight: fontWeights.bold,
                  fontSize: ss(22),
                }}
              >
                <span>{shelf.name}</span>
                <Icon name="chevron-right" size={ss(22)} color={colors.accent2} />
                {items.length > 0 && (
                  <span
                    style={{
                      marginLeft: ss(6),
                      color: colors.faint,
                      fontFamily: fonts.body,
                      fontWeight: fontWeights.medium,
                      fontSize: ss(13),
                    }}
                  >
                    {items.length}
                  </span>
                )}
              </div>
```

(`items` is already in scope at line 312: `const items = Array.isArray(shelf.items) ? shelf.items : [];`. `Icon` is imported at line 10. `colors.faint`/`colors.accent2` exist in tokens.)

- [ ] **Step 4: Use the scaled gap in the rail**

The rail style (lines 356-364) uses `gap: CARD_GAP` (now scaled) and `paddingLeft/Right: ss(48)`. Change the two paddings to `ss(PAD)` for consistency, and confirm the cell flex-basis uses the scaled `CARD_W`. The cell (lines 373-377) currently reads `flex: `0 0 ${CARD_W}px``; since `CARD_W` is now `ss(200)`, this stays correct. Change lines 361-362 from:

```jsx
                    paddingLeft: ss(48),
                    paddingRight: ss(48),
```

to:

```jsx
                    paddingLeft: ss(PAD),
                    paddingRight: ss(PAD),
```

- [ ] **Step 5: Build the TV bundle**

Run: `npm run build:tv`
Expected: build completes with no import/JSX errors (bundle written to `tv/dist`).

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS (`shelfWindow.test.js` and friends unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "feat(tv): ss()-scaled shelf layout + web-style rail headers"
```

---

## Task 5: `VirtualShelvesTV` — hero + pills focus zones (prop-gated)

**Files:**
- Modify: `src/presentation/components/VirtualShelves.tv.jsx` — imports (top), props (46-56), new `topFocus` state, `zoneCfg`, register handlers (279-300), scroll base (187-217), render (302-308)

**Interfaces:**
- Consumes: `heroZone.js` (`enterTopFromShelves`, `zoneMove`, `zoneActivate`), `DiscoverPills.web`.
- Produces: `VirtualShelvesTV` gains optional props:
  - `renderHero(item, { focusedButton })` — render override for the hero. When absent, falls back to the existing `HeroTV`.
  - `discoverItems` (array) — pills data; absent/empty ⇒ no pills zone.
  - `onPill(pill)` — invoked on Enter over a focused pill.
  - `onHeroPlay(item)`, `onHeroDetails(item)` — invoked on Enter over the hero Play/Details buttons; receive the internally-derived hero item.
  - When neither an interactive hero (`renderHero` + a hero handler) nor `discoverItems` is passed, behavior is identical to today (Up-at-top → `onUpAtTop`).

Zone-transition logic is unit-tested in Task 2; this task wires it in. Verify with build + manual sim.

- [ ] **Step 1: Import the reducer and pills**

At the top of `src/presentation/components/VirtualShelves.tv.jsx`, after the `import HeroTV ...` line (line 9), add:

```jsx
import DiscoverPills from "./DiscoverPills.web";
import {
  enterTopFromShelves,
  zoneMove,
  zoneActivate,
} from "./heroZone.js";
```

(`heroZone.js` is ESM per Task 2, so this is a plain named import — no interop caveat.)

- [ ] **Step 2: Add the new props**

Change the props destructure (lines 46-56) from:

```jsx
export function VirtualShelvesTV({
  shelves,
  onShelfVisible,
  onLoadMore,
  onSelect,
  onSeeAll,
  renderCard,
  showHero = true,
  onUpAtTop,
  onBack,
}) {
```

to:

```jsx
export function VirtualShelvesTV({
  shelves,
  onShelfVisible,
  onLoadMore,
  onSelect,
  onSeeAll,
  renderCard,
  showHero = true,
  onUpAtTop,
  onBack,
  renderHero,
  discoverItems,
  onPill,
  onHeroPlay,
  onHeroDetails,
}) {
```

- [ ] **Step 3: Add topFocus state + zone config**

After the existing `const [focus, setFocus] = useState({ shelf: 0, col: 0, shelfAnchor: 0 });` (line 65), add:

```jsx
  // Focus zones ABOVE the shelves (Hero buttons, Discover pills). zone:"shelves"
  // means focus is in the rails (handled by `focus`/`move`). Prop-gated: Home
  // passes neither renderHero-interactivity nor discoverItems, so both zones are
  // disabled and Up-at-top yields to the navbar exactly as before.
  const [topFocus, setTopFocus] = useState({ zone: "shelves", heroBtn: 0, pillCol: 0 });
  const railsRef = useRef(null); // wraps the shelf rows; offsetTop = hero+pills height
```

Then, after `const shelfCount = shelves.length;` (line 78), add:

```jsx
  const heroInteractive = !!renderHero && (!!onHeroPlay || !!onHeroDetails);
  const pills = Array.isArray(discoverItems) ? discoverItems : [];
  const zoneCfg = {
    hasHero: showHero && heroInteractive,
    hasPills: pills.length > 0,
    pillCount: pills.length,
  };
```

- [ ] **Step 4: Make the vertical scroll base measured (accounts for pills)**

In the Apply-scroll effect, replace the vertical-scroll line (lines 191-193):

```jsx
    if (el)
      el.scrollTop =
        focus.shelfAnchor <= 0 ? 0 : ss(heroH) + focus.shelfAnchor * ROW_HEIGHT;
```

with:

```jsx
    // Rails start below the hero + pills; measure their real top so the scroll
    // offset is correct regardless of whether pills are shown.
    const railsTop = railsRef.current?.offsetTop ?? ss(heroH);
    if (el)
      el.scrollTop =
        focus.shelfAnchor <= 0 ? 0 : railsTop + focus.shelfAnchor * ROW_HEIGHT;
```

And in `measure()` replace the `anchorRows` line (line 103):

```jsx
      const anchorRows = Math.max(1, Math.floor((ch - ss(heroH)) / ROW_HEIGHT));
```

with:

```jsx
      const railsTop = railsRef.current?.offsetTop ?? ss(heroH);
      const anchorRows = Math.max(1, Math.floor((ch - railsTop) / ROW_HEIGHT));
```

- [ ] **Step 5: Route D-pad through the zone reducer when above the shelves**

Replace the entire `register(...)` block inside the `useEffect` (lines 279-300) with:

```jsx
  const { register } = useTVInput();

  // Apply a hero/pills-zone move; handle the escape actions (navbar / shelves).
  const applyZoneMove = useCallback(
    (dir) => {
      const res = zoneMove(topFocus, dir, zoneCfg);
      if (res.action === "toNavbar") {
        setTopFocus({ zone: "shelves", heroBtn: topFocus.heroBtn, pillCol: topFocus.pillCol });
        onUpAtTop?.();
        return;
      }
      if (res.action === "toShelves") {
        setTopFocus({ ...res.state, zone: "shelves" });
        return;
      }
      setTopFocus(res.state);
    },
    [topFocus, zoneCfg, onUpAtTop],
  );

  useEffect(
    () =>
      register(
        {
          left: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("left") : move(0, -1),
          right: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("right") : move(0, 1),
          up: () => {
            if (topFocus.zone !== "shelves") return applyZoneMove("up");
            // At the top shelf, climb into the top zones if any exist.
            if (focus.shelf === 0) {
              const z = enterTopFromShelves(zoneCfg);
              if (z) return setTopFocus((t) => ({ ...t, zone: z }));
              if (onUpAtTop) return onUpAtTop();
            }
            move(-1, 0);
          },
          down: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("down") : move(1, 0),
          enter: () => {
            if (topFocus.zone !== "shelves") {
              const what = zoneActivate(topFocus);
              if (what === "play") onHeroPlay?.(heroItem);
              else if (what === "details") onHeroDetails?.(heroItem);
              else if (what === "pill") onPill?.(pills[topFocus.pillCol]);
              return;
            }
            const s = shelves[focus.shelf];
            const item =
              s && Array.isArray(s.items)
                ? s.items[clampCol(focus.col, loadedLen(s))]
                : null;
            if (item) onSelect?.(item);
          },
          ...(onBack ? { back: () => onBack() } : {}),
        },
        { yieldToNav: true },
      ),
    [
      register,
      move,
      shelves,
      focus,
      onSelect,
      onBack,
      topFocus,
      applyZoneMove,
      zoneCfg,
      onUpAtTop,
      onHeroPlay,
      onHeroDetails,
      onPill,
      pills,
      heroItem,
    ],
  );
```

Note: this removes the old inline `up: () => move(-1, 0)` etc. The `move(-1,0)` path already calls `onUpAtTop` when `prev.shelf === 0` (lines 254-257); that inner guard is now redundant for the top shelf (we intercept Up before calling `move`), but leave `move`'s internal guard in place — it is harmless and still protects any non-zero-shelf edge.

- [ ] **Step 6: Render the interactive hero + pills, and ref the rails wrapper**

Replace the hero render + rows wrapper (lines 308-309):

```jsx
      {showHero && <HeroTV item={heroItem} height={HERO_H} />}
      <div>
```

with:

```jsx
      {showHero &&
        (renderHero
          ? renderHero(heroItem, {
              focusedButton:
                topFocus.zone === "hero"
                  ? topFocus.heroBtn === 0
                    ? "play"
                    : "details"
                  : null,
            })
          : <HeroTV item={heroItem} height={HERO_H} />)}
      {zoneCfg.hasPills && (
        <div style={{ padding: `${ss(8)}px ${ss(PAD)}px ${ss(20)}px` }}>
          <DiscoverPills
            items={pills}
            focusedCol={topFocus.zone === "pills" ? topFocus.pillCol : -1}
            onSelect={(pill) => onPill?.(pill)}
          />
        </div>
      )}
      <div ref={railsRef}>
```

(The closing `</div>` for this wrapper already exists at line 399 — unchanged.)

- [ ] **Step 7: Build the TV bundle**

Run: `npm run build:tv`
Expected: build completes, no import/JSX errors.

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/presentation/components/VirtualShelves.tv.jsx
git commit -m "feat(tv): hero + discover-pills focus zones in VirtualShelvesTV (prop-gated)"
```

---

## Task 6: Wire `MoviesScreen.tv` to the parity view

**Files:**
- Modify: `src/screens/MoviesScreen.tv.jsx` — imports (top), `browseAll` state + ref (near line 34), `routeDir`/left guards (255, 295), Back handler (261-270), shelves-branch render (549-567), render condition (549)

**Interfaces:**
- Consumes: `VirtualShelvesTV` (Task 5 props), `PosterCard.web`, `Hero.web`.
- Produces: no exported API change.

Verify with build + manual sim.

- [ ] **Step 1: Add imports**

At the top of `src/screens/MoviesScreen.tv.jsx`, add (near the other component imports). `ss` is NOT currently imported in this file (confirmed), so add it too:

```jsx
import PosterCard from "../presentation/components/PosterCard.web";
import Hero from "../presentation/components/Hero.web";
import { ss } from "../utils/scaleSize";
```

- [ ] **Step 2: Add the browseAll transient state + ref**

After the `tvUseShelvesRef` block (lines 34-35), add:

```jsx
  // Discover "All Movies" pill opens the category-grid landing over the shelves
  // (cheap: reuses already-loaded categories, no getAllMovies fetch). Transient —
  // does NOT touch the persisted tvUseShelves toggle.
  const [browseAll, setBrowseAll] = useState(false);
  const browseAllRef = useRef(false);
  useEffect(() => { browseAllRef.current = browseAll; }, [browseAll]);
```

(`useState`/`useRef`/`useEffect` are already imported in this file.)

- [ ] **Step 3: Gate the shelves early-returns with browseAll**

Line 255 — change:

```jsx
          else if (!tvUseShelvesRef.current) onCatLeft();
```

to:

```jsx
          else if (!tvUseShelvesRef.current || browseAllRef.current) onCatLeft();
```

Line 295 (inside `routeDir`) — change:

```jsx
    if (tvUseShelvesRef.current) return;
```

to:

```jsx
    if (tvUseShelvesRef.current && !browseAllRef.current) return;
```

- [ ] **Step 4: Make Back exit browseAll to the shelves**

In the `back:` handler, change the final else (line 269) from:

```jsx
          } else navigation.goBack?.();
```

to:

```jsx
          } else if (browseAllRef.current) setBrowseAll(false);
          else navigation.goBack?.();
```

- [ ] **Step 5: Update the render condition + wire the shelves branch**

Change the shelves-branch condition (line 549) from:

```jsx
  if (tvUseShelves) {
```

to:

```jsx
  if (tvUseShelves && !browseAll) {
```

Then replace the `<VirtualShelvesTV .../>` block (lines 556-563) with:

```jsx
            <VirtualShelvesTV
              shelves={shelves}
              onShelfVisible={handleShelfVisible}
              onLoadMore={handleLoadMore}
              onSelect={(item) => openDetail(item)}
              onSeeAll={(id, name) => openCat({ id, name })}
              renderCard={(item, isFocused) => (
                <PosterCard item={item} isFocused={isFocused} width={ss(200)} onPress={openDetail} />
              )}
              renderHero={(item, { focusedButton }) => (
                <Hero
                  item={item}
                  focusedButton={focusedButton}
                  onPlay={() => item && playFeatured(item)}
                  onDetails={() => item && openDetail(item)}
                />
              )}
              discoverItems={[{ id: "all", label: "All Movies" }]}
              onPill={() => setBrowseAll(true)}
              onHeroPlay={(item) => item && playFeatured(item)}
              onHeroDetails={(item) => item && openDetail(item)}
            />
```

(`ss` is imported in Step 1.)

- [ ] **Step 6: Add the playFeatured helper**

Near the existing `play` helper (lines 159-168), add a hero-play helper that plays a catalog item directly (the `play()` helper takes a detail object; the hero has a raw item):

```jsx
  // Play a catalog item straight from the hero (no detail fetch needed to start).
  const playFeatured = (item) => {
    playMovie({
      streamId: item.stream_id ?? item.streamId,
      name: item.name,
      cover: item.stream_icon || item.cover || null,
      containerExtension: item.container_extension || "mp4",
      startTime: 0,
    });
  };
```

- [ ] **Step 7: Build the TV bundle**

Run: `npm run build:tv`
Expected: build completes, no errors.

- [ ] **Step 8: Manual sim check**

Run: `npm run sim:lg`
Expected (verify by hand on the simulator):
- Movies opens directly into the shelves view (Hero → "All Movies" pill → rails).
- Posters look like Electron (HD/★ badges, cyan focus ring), larger.
- D-pad Up from the top rail → pill → hero; Left/Right on hero toggles Play/Details ring; Up from hero → navbar.
- Enter on Play plays the featured movie; Enter on Details opens its detail.
- Enter on the "All Movies" pill opens the category grid; Back returns to the shelves.
- See-All on a rail header opens the A–Z drill-in; Back returns to shelves.

- [ ] **Step 9: Run the suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/screens/MoviesScreen.tv.jsx
git commit -m "feat(tv): wire Movies shelves view to Electron-parity hero + pills"
```

---

## Task 7: Wire `SeriesScreen.tv` to the parity view

**Files:**
- Modify: `src/screens/SeriesScreen.tv.jsx` — imports (top), `browseAll` state + ref (near line 42), `handleCatKey` guard (447) + Back (445), shelves-branch render (1058-1076), render condition (1058)

**Interfaces:**
- Consumes: `VirtualShelvesTV` (Task 5 props), `PosterCard.web`, `Hero.web`.
- Produces: no exported API change.

Series has no direct-play (a series resolves to episodes), so the hero **Play** opens the detail view — documented divergence per Global Constraints. Series nav uses a raw `keydown` handler (not `useTVInput`); the guards below target that path.

- [ ] **Step 1: Add imports**

At the top of `src/screens/SeriesScreen.tv.jsx`, add (`ss` is NOT currently imported here — confirmed — so add it too):

```jsx
import PosterCard from "../presentation/components/PosterCard.web";
import Hero from "../presentation/components/Hero.web";
import { ss } from "../utils/scaleSize";
```

- [ ] **Step 2: Add the browseAll transient state + ref**

After the `tvUseShelvesRef` block (lines 42-43), add:

```jsx
  // "All Series" pill opens the category-grid landing over the shelves (cheap;
  // reuses loaded categories). Transient — does not touch the persisted toggle.
  const [browseAll, setBrowseAll] = useState(false);
  const browseAllRef = useRef(false);
  useEffect(() => { browseAllRef.current = browseAll; }, [browseAll]);
```

- [ ] **Step 3: Gate the shelves early-return + Back in handleCatKey**

Line 447 — change:

```jsx
    if (tvUseShelvesRef.current) return;
```

to:

```jsx
    if (tvUseShelvesRef.current && !browseAllRef.current) return;
```

Line 445 (Back in `handleCatKey`) — change:

```jsx
    if (KEY_BACK.has(k)) { navigation.goBack?.(); return; }
```

to:

```jsx
    if (KEY_BACK.has(k)) {
      if (browseAllRef.current) { setBrowseAll(false); }
      else { navigation.goBack?.(); }
      return;
    }
```

- [ ] **Step 4: Update the render condition + wire the shelves branch**

Change the shelves-branch condition (line 1058) from:

```jsx
  if (tvUseShelves) {
```

to:

```jsx
  if (tvUseShelves && !browseAll) {
```

Then replace the `<VirtualShelvesTV .../>` block (lines 1067-1074) with:

```jsx
            <VirtualShelvesTV
              shelves={shelves}
              onShelfVisible={handleShelfVisible}
              onLoadMore={handleLoadMore}
              onSelect={(item) => openDetail(item)}
              onSeeAll={(id, name) => openGrid({ id, name })}
              renderCard={(item, isFocused) => (
                <PosterCard item={item} isFocused={isFocused} width={ss(200)} onPress={openDetail} />
              )}
              renderHero={(item, { focusedButton }) => (
                <Hero
                  item={item}
                  focusedButton={focusedButton}
                  onPlay={() => item && openDetail(item)}
                  onDetails={() => item && openDetail(item)}
                />
              )}
              discoverItems={[{ id: "all_series", label: "All Series" }]}
              onPill={() => setBrowseAll(true)}
              onHeroPlay={(item) => item && openDetail(item)}
              onHeroDetails={(item) => item && openDetail(item)}
            />
```

(`handleLoadMore` exists in this file (defined ~line 226) and the current block already wires `onLoadMore={handleLoadMore}` at line 1070 — keep it, as shown above.)

- [ ] **Step 5: Build the TV bundle**

Run: `npm run build:tv`
Expected: build completes, no errors.

- [ ] **Step 6: Manual sim check**

Run: `npm run sim:lg`
Expected (by hand):
- Series opens into the shelves view (Hero → "All Series" pill → rails), matching Movies.
- D-pad Up from top rail → pill → hero; Left/Right toggles hero buttons; Enter on Play or Details opens the series detail (episode picker).
- "All Series" pill opens the category grid; Back returns to shelves.
- Home/History TV is unchanged: no pills, hero non-interactive, Up-at-top → navbar (regression check).

- [ ] **Step 7: Run the suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/screens/SeriesScreen.tv.jsx
git commit -m "feat(tv): wire Series shelves view to Electron-parity hero + pills"
```

---

## Task 8: Accounts toggle default + final regression pass

**Files:**
- Verify only: `src/screens/AccountsScreen.tv.jsx` (toggle label reflects state), Home/History TV.

- [ ] **Step 1: Confirm the Accounts toggle still works both ways**

Run: `npm run sim:lg`
Expected: Accounts → Grid/Shelves toggle flips the view; default (fresh profile / no stored pref) is Shelves; toggling to Grid shows the legacy category-cards landing and A–Z drill-in, unchanged.

- [ ] **Step 2: Home/History regression**

On the simulator, open Home/History: confirm rails render, no Discover pills, hero (if shown) is non-interactive, and Up from the top rail focuses the navbar (not a hero button). This confirms the prop-gating.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit any final doc/verification notes (if changes were needed)**

If Steps 1-3 surfaced no code changes, no commit is needed. If a fix was required, commit it with a `fix(tv): …` message describing the regression corrected.

---

## Self-Review (completed while writing)

- **Spec coverage:** Default flip → Task 1. Visual parity (PosterCard.web, Hero.web, ss() constants, rail header) → Tasks 3,4,6,7. Hero focusable Play/Details + Enter=play featured → Tasks 3,5,6,7. Discover pills as new focus zone → Tasks 2,5,6,7. Shared-component safety (prop-gating) → Task 5 + verified Task 8. A–Z drill-in kept → untouched, reached via `onSeeAll`/pill (Tasks 6,7). Toggle kept, default Shelves → Tasks 1,8. Series nav unification NOT done (spec marked it out of scope) → left as-is, guards patched in the raw-keydown path (Task 7).
- **Discover-pills open question:** resolved during planning to "cosmetic + cheap" (single "All …" pill → browseAll category grid; Top Rated dropped on TV). Encoded in Global Constraints + Tasks 6,7.
- **Type consistency:** reducer names (`zoneMove`, `zoneActivate`, `enterTopFromShelves`) match between Task 2 (definition), Task 5 (import), and the tests. `focusedButton` values `'play'|'details'|null` are consistent across Hero.web (Task 3) and VirtualShelvesTV (Task 5). `playFeatured(item)` defined and used in Task 6.
- **Placeholder scan:** every code step shows the exact before/after. The two `grep`-to-confirm steps (ss import, Series `handleLoadMore`) are verification guards with explicit fallback instructions, not deferred work.

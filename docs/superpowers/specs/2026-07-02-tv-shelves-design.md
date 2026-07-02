# TV Shelf UI (Electron-parity) for Minimum Hardware — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm) — pending spec review → writing-plans
**Scope:** Movies + Series TV shelf port (primary) + two small independent
cross-platform optimizations (Electron horizontal virtualization; mobile
`ScrollView`→`FlatList`). Live TV explicitly excluded.

## Problem

The TV Movies/Series screens use a flat virtualized grid (`VirtualGridTV`). We want
the Electron "shelves" experience (hero + category rails, Netflix-style) on TV **without
regressing performance on the oldest realistically-shipping TV hardware** (webOS 3–4 /
Tizen 2016–18: ~1–1.5 GB RAM, weak GPU, slow JPEG decoder, Chromium ~38–53).

The bottleneck on that hardware is **concurrent decoded poster images / GPU texture
memory**, not API calls. The shelf data (categories, lazy per-shelf pagination, hero
selection) already exists in the shared `useMovies` / `useSeries` hooks and already works
on TV; today's `.tv` screens simply render a grid instead of consuming it as shelves.
Therefore this is a **presentational + D-pad** effort with **no data-layer changes**.

## Non-goals (YAGNI)

- No Live TV shelves (highest image-count risk; separate future effort).
- No changes to `useMovies` / `useSeries` / `ContentService` / any data fetching.
- No adaptive device detection (unreliable on TVs).
- No `content-visibility: auto` reliance (needs Chromium 85+; absent on the webOS 3–4 floor).
- No drag-to-scroll / prev-next buttons (mouse affordances, irrelevant on TV).

## Chosen approach: A — Full 2-D virtualization

Bound mounted posters on **both axes** so worst-case memory is independent of catalog
size and scroll depth. This is the only approach whose memory ceiling holds on the
oldest floor. (Approach B — vertical windowing + pagination-capped rails — reintroduces
the deep-rail image growth risk; Approach C — CSS content-visibility — is a no-op on old
Chromium. Both rejected.)

## Architecture

```
MoviesScreen.tv ─┐
                 ├─ VirtualShelves.tv   (NEW: 2-D window + D-pad focus + image cap + hero)
SeriesScreen.tv ─┘        │
                         ├─ Hero.tv          (NEW, thin: one backdrop for focused item)
                         ├─ TVShelfRow        (internal to VirtualShelves: one windowed rail)
                         └─ TVPosterCard      (EXISTS, reused unchanged)
   "See all" ──────────▶ VirtualGridTV       (EXISTS, unchanged — the drill-in grid)
```

Both screens keep consuming their existing hook (`useMovies` / `useSeries`) and pass
`shelves`, `handleShelfVisible`, `handleLoadMore`, `openCategory`, `selectMovie` straight
through. The grid path and the shelf path both stay live, selected by the UI toggle
(below).

## Component: `VirtualShelves.tv.jsx` (the core)

**Props** (mirrors what the hook already exposes):
`shelves` (array of `{ id, name, items, totalCount, hasMore, loadingMore }`),
`onShelfVisible(id)`, `onLoadMore(id)`, `onSelect(item)`, `onSeeAll(id, name)`,
`renderHero?`.

**Vertical windowing (shelves):** mount only shelves with index ∈
`[focusShelf − BUFFER, focusShelf + BUFFER + 1]` (BUFFER = 1 → ≤ ~3–4 mounted rails).
Off-window shelves are replaced by fixed-height spacer divs; total scroll height uses the
same `paddingTop` / `paddingBottom` accounting as `VirtualGridTV` so scroll geometry is
stable.

**Horizontal windowing (posters within a mounted rail):** the focused rail mounts posters
in `[focusCol − 2, focusCol + H_BUFFER]`; non-focused mounted rails mount only their first
`visibleCols` posters. Left/right spacer widths preserve each rail's scroll width so
`scrollLeft` math stays correct.

**Image budget (the guarantee):** `MAX_MOUNTED_POSTERS ≈ 45`, enforced structurally by the
window sizes (≤ 4 rails × ≤ ~10–12 posters) + 1 hero. This ceiling does not grow with
catalog size or scroll depth — the core requirement for the webOS 3–4 floor.

**Lazy shelf fetch:** when a shelf enters the vertical window, call `onShelfVisible(id)`
(imperative window check — replaces the web `IntersectionObserver`, which is unreliable on
old webOS). When `focusCol` nears a rail's loaded end, call `onLoadMore(id)`.

**Rendering hygiene:** rows carry `contain: layout style paint`; reuse existing
`.tv-shelf-rail` optimizations from `TVOptimizations.js`. Layer promotion
(`will-change: transform`) applies to the **actively scrolling rail only**, not all rails,
to avoid multiplying GPU layers.

## D-pad focus model

Single state `focus = { shelf, col }`, driven via `useTVInput().register`:

- **Left / Right** → `col ∓ 1`, clamped to the rail's currently-loaded length; hitting the
  right edge triggers `onLoadMore(id)`.
- **Up / Down** → `shelf ∓ 1`; **per-shelf column memory**: store `colMemory[shelfId]` on
  leave and restore (clamped to the destination rail's loaded length) on enter. This is the
  expected Netflix behavior and prevents losing horizontal position.
- **Enter** → `onSelect(item)` (opens the existing TV detail view).
- **Back** → handled by existing navbar yield (`useTVInput` `{ yieldToNav: true }`);
  existing Back-key handling is untouched.

Focus changes imperatively set container `scrollTop` (vertical) and the focused rail's
`scrollLeft` (horizontal), reusing the scroll-into-view approach already in
`VirtualGridTV`.

## Hero: `Hero.tv.jsx` (thin)

Shows the focused item's backdrop + title, reusing `selectHeroItem` (already used by the
web screen). **Exactly one hero image mounted at a time**, swapped on focus change and
**debounced (~150 ms)** so fast D-pad travel doesn't thrash the decoder. Counts as 1
against the image budget. Behind the same UI toggle, so it can be dropped trivially if it
proves heavy on the oldest boxes.

## Feature flag: in-UI toggle (persisted)

A user-facing preference, not a hardcoded constant, so on-device A/B needs no rebuild:

- **Storage:** persisted via the existing `storage` abstraction used throughout
  `AppContext.jsx` (proposed key `iptv_tv_shelves`, boolean, default **false** = current
  grid).
- **State:** exposed on `useApp()` (e.g. `tvUseShelves` + `setTvUseShelves`), loaded on
  boot alongside other prefs and written on change (same pattern as existing
  `storage.setItem` prefs).
- **Toggle UI:** a row in the TV **Account/Settings** screen (`AccountsScreen.tv.jsx`),
  D-pad focusable, matching that screen's existing field/focus pattern.
- **Consumption:** `MoviesScreen.tv` / `SeriesScreen.tv` branch on `tvUseShelves`:
  `true` → `<VirtualShelves>`, `false` → `<VirtualGridTV>` (today's behavior). Both paths
  remain compiled and shippable.

## Cross-platform optimizations (independent of the TV component)

Electron and mobile already have the shelf UX; the TV work brings TV to parity. These two
tweaks share no code with `VirtualShelves.tv` and can land/ship independently. They are
optimizations only — no visual or behavioral change intended.

1. **Electron — horizontal virtualization in `ContentShelf.web.jsx`.** Today the rail
   renders every loaded item (`items.map`). On a low-end laptop a deeply-scrolled rail can
   mount hundreds of posters. Add a horizontal window (mount only visible ± buffer cards,
   left/right spacer widths preserve `scrollLeft`), reusing the same windowing helper as the
   TV component where practical. Desktop has headroom, so this is a safety optimization, not
   a correctness fix. Mouse/drag/prev-next behavior unchanged.

2. **Mobile — `ScrollView` → horizontal `FlatList` in `ContentShelf.native.jsx`.**
   `removeClippedSubviews` only detaches off-screen children; it still measures all of them.
   A horizontal `FlatList` (`initialNumToRender`, `windowSize`, `maxToRenderPerBatch`) gives
   true windowing. Keep `onVisible` / `onLoadMore` (`onEndReached`) semantics identical.

## Testing & verification

- **Unit (pure functions, no DOM):**
  - windowing math — given `focus` + shelf/rail counts, the set of mounted shelf indices
    and per-rail poster indices never exceeds the configured caps;
  - column-memory clamping — restoring a remembered column into a shorter rail clamps to
    that rail's loaded length.
- **On-device / emulator (webOS + a real low-end box):** open DevTools; D-pad deep into a
  rail and across many shelves; confirm mounted `<img>` count and JS/GPU memory stay
  bounded (≤ cap) and posters don't blank/re-decode.
- **Regression:** with the toggle off, Movies/Series render the existing grid unchanged.

## Files

- **New:** `src/presentation/components/VirtualShelves.tv.jsx`,
  `src/presentation/components/Hero.tv.jsx`, unit test file for the windowing/clamp helpers.
- **Modified:** `src/screens/MoviesScreen.tv.jsx`, `src/screens/SeriesScreen.tv.jsx`
  (branch on `tvUseShelves`), `src/screens/AccountsScreen.tv.jsx` (toggle row),
  `src/context/AppContext.jsx` (persisted `tvUseShelves` pref).
- **Modified (cross-platform tweaks):** `src/presentation/components/ContentShelf.web.jsx`
  (horizontal virtualization), `src/presentation/components/ContentShelf.native.jsx`
  (`ScrollView`→`FlatList`).
- **Unchanged:** `useMovies` / `useSeries` / `ContentService`, `VirtualGridTV`,
  `TVPosterCard`.

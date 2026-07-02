# TV Movies/Series = Electron, at 10-foot scale

**Date:** 2026-07-03
**Status:** Design — awaiting review
**Author:** brainstorming session

## Goal

Make the TV (webOS) Movies and Series browse experience structurally and
visually identical to the Electron/web experience — Hero billboard → Discover
pills → per-category rails — differing only in scale (authored at the 1920
reference, rendered on the 1280-pinned TV viewport that the browser upscales
×1.5 to the 1080p panel).

This supersedes the earlier "do not chase pixel-parity; TV is authored one step
larger" decision (memory `tv-electron-design-reconciliation`). The user has
explicitly asked for a full structural + visual match. Scale divergence is now
achieved by `ss()` doing the upscaling, not by a separate larger type ramp.

## Non-goals

- No changes to LiveTV.
- No changes to the Home/History screen's layout (it reuses `VirtualShelvesTV`;
  see "Shared-component safety").
- No deletion of the legacy Grid landing or the A–Z drill-in grid — both stay.
- No refactor of the Series TV raw-`keydown` navigation for its Grid/Detail
  branches (out of scope; only the shelves path changes, and there
  `VirtualShelvesTV` owns the D-pad).

## User decisions (locked)

1. **Scope:** Full structural match — TV shelves view mirrors web IA.
2. **Hero:** Focusable Play/Details, identical to web. D-pad Up from the top
   shelf moves focus into the hero; Enter on Play plays the featured item.
3. **Drill-in:** Keep the existing A–Z letter-bar grid as the drill-in target
   (reached via See-All on a rail header, or a Discover pill). Unchanged.
4. **Grid toggle:** Keep the Accounts Grid/Shelves toggle, but flip the default
   to **Shelves**.

## Current state (what exists today)

- `tvUseShelves` (AppContext, default `false`) gates Movies/Series TV between the
  legacy cat-cards Grid landing and the shelves browse view.
- When on, `MoviesScreen.tv` / `SeriesScreen.tv` render `VirtualShelvesTV` with a
  `HeroTV` billboard (title-only, non-interactive) and `ShelfCard.tv` posters.
- `VirtualShelvesTV` owns a mature D-pad engine: focus `{shelf, col, shelfAnchor}`,
  lazy per-rail fetch (`fetchWin`), poster prefetch, focus-driven vertical +
  horizontal scroll, chevron edge hints. Layout constants (`CARD_W=260`,
  `CARD_GAP=24`, `ROW_HEIGHT=470`, `HERO_H=620`, `PAD=48`) are **raw px** — an
  inconsistency introduced this session; the rest of the app uses `ss()`.
- Web equivalents already exist and are already `isTV()`-aware: `Hero.web`
  (eyebrow + title + meta + Play/Details buttons), `PosterCard.web` (HD/★ badges,
  cyan focus ring, no shadow on TV), `ContentShelf.web` (rail header = title +
  accent2 chevron + count), `DiscoverPills.web` (synthetic discover categories,
  cyan focus border).

## Design

The strategy is **keep `VirtualShelvesTV`'s D-pad/fetch engine; swap its visual
leaves for the web components; add two new focus zones above the shelves.** No
new navigation engine is written.

### 1. Default flip

`AppContext`: `tvUseShelves` initial state `false → true`. The Accounts toggle,
the legacy Grid landing branch, and the A–Z drill-in all remain in place and
functional.

### 2. Visual parity inside `VirtualShelvesTV`

| Element | Today (TV) | Target |
|---|---|---|
| Poster card | `ShelfCard.tv` (`.tvl-card`) | `PosterCard.web` via `renderCard`, `width={ss(200)}` |
| Hero | `Hero.tv` (title only) | `Hero.web` (eyebrow, title, meta, Play/Details) |
| Rail header | title only | title + `accent2` chevron-right + count, matching `ContentShelf.web` |
| Layout constants | raw px | `ss()`-scaled (`CARD_W=ss(200)`, `CARD_GAP=ss(8)`, `PAD=ss(48)`, `ROW_HEIGHT`/`HERO_H` derived) |

- `renderCard` in both screens becomes
  `(item, isFocused) => <PosterCard item={item} isFocused={isFocused} width={ss(200)} onPress={openDetail} />`.
  `VirtualShelvesTV` already holds the focus ref on the wrapping cell, so
  `PosterCard.web` needs no `elRef`. Its cyan ring is inline (works without CSS);
  it correctly drops `box-shadow` on TV.
- The rail header gains the chevron + count to match `ContentShelf.web`. The
  existing See-All click behavior (`onSeeAll`) is preserved.
- Switching the constants to `ss()` reverts this session's raw-px tweaks. Because
  the TV viewport is pinned to 1280 and the browser upscales ×1.5, `ss(200)`
  posters render at the same *proportion* as web, then scale up — the intended
  "identical, larger" result. `ROW_HEIGHT` and `HERO_H` are recomputed from the
  `ss()` poster height + title + padding rather than hand-tuned raw values.
- `ShelfCard.tv` stays in the repo (still used by Home/History rail). `Hero.tv`
  is no longer used by the shelves view; leave the file (Home may still use it)
  but it is superseded here. This retires this session's `Hero.tv` restyle for
  the Movies/Series path.

### 3. Two new focus zones above the shelves

Focus order (top → bottom): **Hero buttons ↔ Discover pills ↔ shelf rows**, and
Up from the hero yields to the navbar (existing `onUpAtTop`). This mirrors the
web order Hero → Discover → shelves.

`VirtualShelvesTV` gains a small `zone` state layered above shelf 0:

- `zone: "shelves"` (default) — current behavior.
- `zone: "pills"` — Left/Right move `pillCol` across the Discover pills; Down
  enters shelf 0; Up enters the hero; Enter fires `onPill(pill)`.
- `zone: "hero"` — Left/Right move between Play and Details; Down enters the
  pills row; Up fires `onUpAtTop` (navbar); Enter fires `onHeroPlay` (Play) or
  `onHeroDetails` (Details).

Transition wiring: today Up on shelf 0 calls `onUpAtTop`. New behavior — Up on
shelf 0 moves to `zone:"pills"` (if pills provided), else to `zone:"hero"` (if
hero interactive), else `onUpAtTop`. The hero's `focused`/button-focus props are
driven by `zone === "hero"` + which button is selected; `DiscoverPills`
`focusedCol` is `zone === "pills" ? pillCol : -1`.

### 4. Shared-component safety (the key subtlety)

`VirtualShelvesTV` is also rendered by Home/History. All new behavior is
**prop-gated** so Home is untouched:

- Discover pills render **only** when a `discoverItems` prop (non-empty array) is
  passed. Home passes none → no pills, no `pills` zone.
- Hero interactivity (focusable Play/Details, the `hero` zone) is enabled **only**
  when `onHeroPlay` (and/or `onHeroDetails`) props are passed. Home passes none →
  hero stays non-interactive exactly as today (or keeps its current `HeroTV`
  usage via `showHero`; Home's hero path is unchanged).
- When neither is passed, `move()` falls back to the current `onUpAtTop`
  behavior, so Home's Up-at-top → navbar still works.

New `VirtualShelvesTV` props (all optional, additive):

- `discoverItems` — pills data; absent ⇒ no pills zone (Home case).
- `onPill(pill)` — pill Enter handler.
- `onHeroPlay()`, `onHeroDetails()` — hero button handlers; absent ⇒ hero is
  non-interactive and the `hero` zone is skipped (Home case).
- `renderHero(item, { focused, button })` — optional render override. **This is
  the single mechanism for the Hero swap.** Home passes nothing → `VirtualShelvesTV`
  falls back to its current `HeroTV` default, so Home is byte-for-byte unchanged.
  Movies/Series pass `renderHero` returning `<HeroWeb item={item} focused={focused}
  onPlay onDetails />`, so `VirtualShelvesTV` never imports `Hero.web` itself.

The hero **item** is the one `VirtualShelvesTV` already derives internally (the
debounced last-focused shelf item, defaulting to `shelves[0].items[0]`); it is
not passed as a prop. When focus moves into the `hero`/`pills` zones the derived
item is held (not cleared), so the billboard stays stable.

### 5. Screen wiring

**MoviesScreen.tv** (shelves branch): pass `discoverItems` (from
`useMovies.discoverItems`, currently defined but unused on TV), `onPill` →
`openCat`/top-rated handler mirroring web, `renderCard` → `PosterCard.web`,
`onHeroPlay` → `playMovie(featured)`, `onHeroDetails` → `openDetail(featured)`.
The featured item is the hero item `VirtualShelvesTV` already derives.

**SeriesScreen.tv** (shelves branch): same wiring. Series uses `useContentService`
inline, not `useMovies`, so it needs an equivalent `discoverItems` list (All
Series + Top Rated) constructed locally to match web. Its Grid/Detail branches
keep their existing raw-`keydown` handler untouched; only the shelves branch
changes, and there `VirtualShelvesTV`'s `useTVInput` owns the D-pad.

### 6. webOS constraints (already satisfied)

`PosterCard.web`, `Hero.web`, `DiscoverPills.web` are all `isTV()`-aware and
drop `box-shadow`/CSS transitions/animations on TV. No `var()`, no transforms in
the hot path. The cyan focus ring is inline. Nothing new violates the old
Chromium constraints.

## Data flow

```
Screen (Movies/Series .tv)
  ├─ shelves, discoverItems, handlers ──▶ VirtualShelvesTV
  │                                         ├─ zone state {hero|pills|shelves}
  │                                         ├─ Hero.web (focused = zone==="hero")
  │                                         ├─ DiscoverPills (focusedCol = pills)
  │                                         └─ rails → renderCard → PosterCard.web
  └─ onSeeAll / onPill ──▶ openCat ──▶ existing A–Z drill-in grid (unchanged)
```

## Error / edge handling

- Empty `shelves`: existing spinner branch unchanged.
- No hero item yet (nothing focused): hero renders its empty state; `hero` zone
  is still enterable but Play/Details no-op until an item resolves (guard in
  `onHeroPlay`).
- `discoverItems` empty/absent: pills zone is skipped entirely (Home case).
- Focus clamping on shelf mutation (Home rails shrinking) unchanged.

## Testing / verification

- Manual on-device (or `sim:lg`) D-pad walk: navbar ↔ hero (Play/Details) ↔
  pills ↔ shelves; Enter on Play plays featured; Enter on a pill opens the A–Z
  drill-in; See-All opens drill-in.
- Home/History TV: confirm hero non-interactive, no pills, Up-at-top → navbar
  (regression guard for the shared component).
- Accounts toggle still flips Grid ↔ Shelves; default is Shelves.
- Visual: posters, gaps, hero, headers read the same as Electron, larger.

## Files touched

- `src/context/AppContext.jsx` — default flip.
- `src/presentation/components/VirtualShelves.tv.jsx` — zones, prop-gated hero
  interactivity + pills, `ss()` constants, web rail header, `PosterCard.web`.
- `src/screens/MoviesScreen.tv.jsx` — shelves-branch wiring.
- `src/screens/SeriesScreen.tv.jsx` — shelves-branch wiring + local
  `discoverItems`.
- (No changes to `ShelfCard.tv`, `Hero.tv`, Grid/A–Z branches, LiveTV, Home
  layout.)

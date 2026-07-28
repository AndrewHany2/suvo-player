# TV Performance Plan — "Very Smooth" on webOS / Tizen

> **Status (2026-07-28):** Tiers 1, 2.1, 2.2, 2.4, **3.1**, 3.2, 3.3 and the
> Tier-4 O(history×episodes) fix are **implemented** (working tree; `npm test`
> 899 pass, lint clean, `npm run build:tv` succeeds). **3.1 verified at build
> level:** TV main bundle dropped ~3.19MB → 1.70MB (post-transpile), hls.js
> internals no longer in the bundle (grep=0), engines vendored to
> `tv/dist/vendor/` and skipped by the obfuscator; web/Electron keep the engines
> bundled (guarded by `EXPO_PUBLIC_TV`). **Tier 2.3 now implemented** as well:
> `myList`/`isSyncing` moved to a dedicated `LibraryContext` + `useLibrary()`,
> all ~13 consumers updated (899 tests pass, lint clean). **Tier-4 done too:** the
> episode lists (SeriesScreen + HistoryScreen series detail) now render a
> `memo`+`forwardRef` `EpisodeRowTV` — an epIdx D-pad move re-renders only the two
> affected rows instead of reconciling all 200+ (a real per-frame win, not just
> mount), on top of the O(history×episodes)→Map fix. Category-grid *windowing*
> was assessed and consciously skipped: `CatButton` is already memoized + focus is
> frame-throttled (Tier 1.1), and mounting ~200 single-`<button>` tiles is
> negligible even on old Chromium — windowing there would add risk for no gain.
> **The full plan is now implemented.**
> **Still needs an on-device `sim:lg` / `sim:tizen` pass** — the `file://` /
> old-Chromium paths (Tier 1.3, 3.2, and especially 3.1's vendored-script load +
> first-play) can only be confirmed on a real TV, not the JS test suite.
>
> New shared primitive: `src/utils/frameThrottle.js` (+ tests) — leading-edge +
> coalesce-to-latest per animation frame, used via the ref-flush pattern so held
> D-pad repeats advance a position ref synchronously but only re-render once per
> frame. Applied in useTVNavigation, VirtualShelves, and the Movies/Series/LiveTV
> grid focus setters.

Goal: make the 10-foot TV UI feel instant under a remote. On a TV, "smooth" is
dominated by **D-pad input latency** (does focus track the remote 1:1, or lag
and overshoot?), then by **not stealing CPU from the video decoder**, then by
**time-to-first-screen** at cold start. The visual layer is already lean (TV
strips shadows/transforms/gradients, cards are `memo`'d, the big grids are
windowed) — so this plan does not touch visuals.

All findings below were located statically in the current code. The *ranking*
should be confirmed on a physical device via the `sim:lg` path + the webOS Web
Inspector Performance panel; a real TV CPU is the only representative measure.

---

## How to measure (do this first, and again after each tier)

Optimizing without a baseline wastes effort. Before touching code:

1. **On-device profile.** Deploy to a real LG/Samsung unit (`sim:lg` is the
   documented path), open the webOS Web Inspector → Performance, and record
   while (a) holding a D-pad direction across a full grid, (b) scrubbing the
   Movies shelf, (c) playing a video for ~30s with a browse screen behind it.
2. **Capture three numbers per scenario:** average frame time during a held
   arrow (target ≤16ms; anything >33ms is visible jank), scripting-vs-layout
   split per keypress, and long-task count during playback.
3. **Cheap proxy without hardware:** Chrome with `EXPO_PUBLIC_TV=1` build +
   6× CPU throttle in DevTools. Not representative of the oldest engines, but it
   surfaces the re-render/layout-thrash regressions this plan targets.

Keep the before/after traces. "It feels faster" is not a result.

---

## Tier 1 — The per-keypress path (highest felt impact, most contained)

Every D-pad press today runs: full-screen re-render → `scrollIntoView` /
`offsetLeft` read (forced sync layout) → scroll write → (on old Chromium) the
flex-gap MutationObserver with `getComputedStyle` per mutated node. Three
compounding costs, once per press, worst on the oldest TVs.

### 1.1 Coalesce D-pad key-repeats into `requestAnimationFrame`
- **Where:** `src/hooks/useTVInput.js:53-65`, `src/hooks/useTVNavigation.js:63-118`,
  and the hand-rolled `keydown` handlers in `src/screens/LiveTVScreen.tv.jsx:184`,
  `src/screens/SeriesScreen.tv.jsx`, `src/screens/HistoryScreen.tv.jsx:289`.
- **Problem:** No `e.repeat` handling and no throttle. OS auto-repeat (~30ms)
  fires a `setState` + re-render + scroll effect per event, flooding the render
  loop faster than a slow TV paints → focus overshoots after key release.
- **Change:** Gate focus-move dispatch to at most one per animation frame.
  Collapse a burst of same-direction repeats to a single pending move that is
  applied in a `requestAnimationFrame` callback; drop intermediate repeats.
  Keep discrete presses (OK/Back) unthrottled. Prefer a single shared helper so
  all four handlers behave identically.
- **Effect:** Focus tracks the remote 1:1 instead of queuing; eliminates
  overshoot. Largest single smoothness win.
- **Risk:** Must not drop the *final* press of a burst (the one that lands
  focus). Verify held-arrow-to-edge stops exactly at the edge, no drift.

### 1.2 Move scroll-follow off the read-after-write layout thrash
- **Where:** `src/presentation/components/VirtualShelves.tv.jsx:365-424`
  (the `card.offsetLeft` read at `:402`, the idle-rail `scrollLeft` write loop
  at `:411-415`), `src/presentation/components/PagedGrid.tv.jsx:97`
  (`scrollIntoView({block:"nearest"})`), and the `scrollIntoView` calls in
  `MoviesScreen.tv.jsx:451,453`, `HistoryScreen.tv.jsx:125,129,133`.
- **Problem:** These read layout (`offsetLeft` / `scrollIntoView`) immediately
  after the render dirtied the DOM, forcing a synchronous layout flush every
  press. The idle-rail loop is O(mounted shelves) writes per press.
- **Change:** Drive scroll from precomputed geometry, not DOM reads. Rows
  already have `rowOffsets` (`VirtualShelves.tv.jsx:123-128`) and fixed strides;
  compute the focused card's x-offset from `col * cardStride` instead of reading
  `offsetLeft`, and apply all `scrollTop`/`scrollLeft` writes inside one
  `requestAnimationFrame` (write-only, no interleaved reads). Replace
  `scrollIntoView` in the grids with the same computed-offset write. Skip the
  idle-rail reassert loop unless a rail's target actually changed.
- **Effect:** Turns "layout + paint per press" into "paint per press."
- **Risk:** Off-by-one on card stride vs. gap → focused card partially clipped.
  Verify against the current pixel-exact scroll position on each screen.

### 1.3 Tame the flex-gap MutationObserver (old Chromium only)
- **Where:** `tv/patch-index.js:259-282` (runs only when native flex-gap is
  absent, i.e. Chromium <84 / older webOS).
- **Problem:** Observes `{childList, subtree, attributes:['style','open']}` on
  the whole body. Every focus-ring style/class change from a re-render fires it;
  the callback runs `getComputedStyle()` per mutated node and
  `getElementsByTagName('*')` full-subtree walks on `childList` adds. This piles
  onto every keypress on exactly the TVs that can least afford it.
- **Change (pick the cheapest that holds):**
  - Mark processed nodes with a data-attribute and skip re-processing on repeat
    `style` mutations (focus rings toggle the same nodes over and over).
  - Debounce the observer callback to a microtask/rAF and dedupe targets so a
    burst of mutations from one re-render is handled once.
  - Ignore `attributes` mutations whose element is not a flex container (most
    focus-ring changes are on leaf cards, not flex parents).
  - Ideally: since the gap set is known at build, lean harder on the existing
    `insertRule` gap→`column-gap/row-gap` rewrite (`patch-index.js`, the
    `</head>` intercept) so the runtime DOM sweep is only needed for
    dynamically-inserted flex containers, not every style change.
- **Effect:** Removes a full `getComputedStyle`/tree-walk pass from each
  keypress on the oldest fleet.
- **Risk:** Under-sweeping re-introduces the collapsed-spacing bug this polyfill
  fixed. Verify margins/gaps on a genuinely old unit (the blind spot documented
  in the flex-gap memory), not just the sim.

---

## Tier 2 — Stop wasted re-renders stealing CPU from the decoder

These don't block input directly but burn main-thread time, which on a weak TV
CPU competes with video decode and with Tier 1's render loop.

### 2.1 Keep the 1 Hz progress write off browse screens
- **Where:** `src/hooks/usePlayer.js:583-595` (the `setInterval` →
  `updateWatchProgress`), `src/context/AppContext.jsx:315-325`
  (`setWatchHistory`), consumers `MoviesScreen.tv.jsx:37`,
  `SeriesScreen.tv.jsx:49`, `HistoryScreen.tv.jsx:58`, and the per-tick Map
  rebuild in `HistoryScreen.tv.jsx:76` (`episodeHistoryById`).
- **Problem:** Progress is written once/sec into `WatchHistoryContext`. On TV
  the player overlays the browse screens but they stay mounted, so all three
  re-render every second while a video plays; `HistoryScreen` also rebuilds its
  whole history Map each tick.
- **Change:** Don't route the high-frequency progress write through the array
  that idle browse screens subscribe to. Options: (a) write live progress to a
  ref / dedicated low-churn store and only fold it into `watchHistory` on
  pause/stop/seek; (b) unmount (or `display:none` + bail-out) hidden TV screens
  while the full-screen player is up. (a) is lower-risk.
- **Effect:** Zero browse-screen work during playback; frees the main thread
  for decode + recovery machine.
- **Risk:** Resume position must still be accurate after a crash mid-playback —
  keep a periodic flush (e.g. every 10–15s) to storage even if context isn't
  updated each second.

### 2.2 Batch per-category shelf loads
- **Where:** `src/hooks/useCatalog.js:199-218` (`setShelves(prev => prev.map(...))`).
- **Problem:** Each category's items arrive separately and replace the whole
  `shelves` array, re-rendering `VirtualShelvesTV` 50+ times during initial
  browse (each with a fresh `{...s, items}` object, so no reference stability).
- **Change:** Coalesce shelf-load results within a short window (rAF or ~100ms)
  into a single `setShelves`, and preserve object identity for unchanged
  shelves so `memo`'d rows bail out.
- **Effect:** Initial browse settles in a few renders instead of dozens.
- **Risk:** Perceived "pop-in" cadence changes slightly; keep skeletons visible
  until the batch lands.

### 2.3 Split `myList` and `isSyncing` out of the mega-context
- **Where:** `src/context/AppContext.jsx:652-674` (28-dep `useMemo`; `myList`
  and `isSyncing` in the value at `:659`). Consumers: all TV screens via
  `useApp()`, plus `AppNavigator.web.jsx:504-509`.
- **Problem:** Toggling a favorite or any library sync recreates the whole
  `AppContext` value and re-renders every `useApp()` consumer + the navigator.
- **Change:** Move `myList` (+ its callbacks) and `isSyncing` into their own
  narrow contexts, mirroring the existing `Playback`/`WatchHistory` split
  (`:679-707`). Screens subscribe only to what they read.
- **Effect:** Favorite toggles and background sync stop re-rendering unrelated
  screens.
- **Risk:** Mechanical but wide edit; touch every `useApp()` destructure that
  pulls `myList`/`isSyncing`. Lint + tests must stay green.

### 2.4 Hoist `PosterCard.web` inline styles
- **Where:** `src/presentation/components/PosterCard.web.jsx:98-165` (fresh
  `style={{}}` objects every render; `fmtDur` redefined at `:74-77`).
- **Problem:** New style-object identities defeat the component's own `memo`, so
  every card in the horizontal window re-renders on each shelf re-render.
- **Change:** Hoist static style objects to module scope; `useMemo` the few that
  depend on `width`/`isFocused`; lift `fmtDur` out of the component.
- **Effect:** Card re-renders drop to the 1–2 that actually changed focus.
- **Risk:** Low. Verify focus ring + progress bar still update.

---

## Tier 3 — Cold start (time-to-first-screen)

### 3.1 Get hls.js + mpegts.js out of the boot parse
- **Where:** single bundle (`app.json` `web.output:"single"`), engines pulled in
  via `require()` inside `loadHls()` (`src/playback/drivers/hlsDriver.js:40-48`)
  and `loadMpegts()` (`mpegtsDriver.js:42-50`). hls.js ≈543KB, mpegts.js ≈273KB.
- **Problem:** `require()`-in-function defers *evaluation* but the ~816KB still
  lives in the 3.19MB single bundle that Chromium 38 tokenizes/compiles at
  launch — before the user ever presses play.
- **Change:** Ship hls.js and mpegts.js as separate assets loaded via injected
  `<script>` tags on first playback (not through the Metro graph), and have the
  drivers await that load. Keeps them out of the cold-start parse entirely.
- **Effect:** ~816KB less to parse/compile at boot — the single biggest
  cold-start lever given `output:"single"` can't code-split.
- **Risk:** `file://` script loading + global exposure must work on webOS; test
  both engines actually initialize on first play. Coordinate with the obfuscator
  step so the external scripts are handled/loaded correctly.

#### 3.1 — execution-ready spec (traced 2026-07-28)

Why it's not landed here: `loadHls()` (`hlsDriver.js:40`) and `loadMpegts()`
(`mpegtsDriver.js:42`) are called **synchronously** at 6+ sites
(`hlsDriver.js:64,124,245,299,578,729`, `mpegtsDriver.js:58,115`), several inside
driver methods on the hot playback/recovery path. The `require('hls.js')` literal
is what Metro collects into the single bundle, so the ~816KB is parsed at cold
start even though evaluation is deferred. Removing it from the parse means the
engine must be fetched on first play → **`loadHls`/`loadMpegts` must become
async**. The driver tests inject `opts.getHls`/`getMpegts`, so they pass without
touching the async path — green tests here would NOT prove playback works. This
needs `sim:lg` + `sim:tizen` + a web smoke.

Steps:
1. **Vendor the UMD builds as static assets** (not through Metro): copy
   `node_modules/hls.js/dist/hls.min.js` and `node_modules/mpegts.js/dist/mpegts.js`
   into the output as `vendor/hls.min.js` / `vendor/mpegts.js`. On TV, do the copy
   in `tv/patch-index.js` (into `tv/dist/vendor/`, relative paths, and make sure
   the obfuscator step skips `vendor/`). On web, place under `public/vendor/` so
   Expo/Vercel serves them.
2. **Mark the packages external to Metro** so the literal `require('hls.js')` is
   no longer bundled: add a `resolveRequest` shim in `metro.config.js` that maps
   `hls.js`/`mpegts.js` to an empty/stub module for the app bundle (keep the real
   resolution for the Node test runtime, which imports the real package directly).
3. **Async loader that injects a `<script>` once and resolves the global:**
   ```js
   let _p = null;
   function ensureHls() {
     if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
     if (_p) return _p;
     _p = new Promise((res, rej) => {
       const s = document.createElement('script');
       s.src = (globalThis.__TV__ ? './' : '/') + 'vendor/hls.min.js';
       s.onload = () => res(globalThis.Hls);
       s.onerror = rej;
       document.head.appendChild(s);
     });
     return _p;
   }
   ```
   Keep `opts.getHls` as the sync test/injection path; `loadHls` becomes
   `await ensureHls()` (or `opts.getHls?.()`).
4. **Await at the call sites.** `createHlsInstance` and the driver's `load()` are
   the real acquisition points — make them async and await the engine before
   constructing `new Hls(...)`. The `FileSafeLoader` subclass (built from
   `Hls.DefaultConfig.loader`) must be created lazily *after* the engine resolves,
   not at module scope. Quality-control methods that call `loadHls()` only run
   after a successful load, so the engine is already cached by then — guard with
   `if (!_hlsModule) return;` for safety.
5. **Recovery machine timing:** first-play now has a one-time script-fetch before
   the engine exists. Surface it as the existing "loading" state (not an error);
   make sure a load failure of the vendor script maps to a real NormalizedError
   with a Reload path, not a silent hang.
6. **Verify:** `sim:lg` + `sim:tizen` cold start (confirm ~816KB smaller main
   bundle parse), first-play on HLS **and** raw-MPEG-TS accounts, recovery after a
   network drop, and a web/Electron playback smoke. Only ship after all pass.

### 3.2 Turn off `splitStrings` for the TV obfuscator preset
- **Where:** `scripts/obfuscate.js` (`tvPreset`), run after `patch-index.js`.
- **Problem:** `splitStrings chunkLength:8` rewrites every string literal in the
  3.19MB bundle into 8-char concatenation chains → extra work at first eval on a
  slow engine.
- **Change:** Drop `splitStrings` from `tvPreset` (identifier mangling / string
  array without per-char splitting is plenty for the TV threat model).
- **Effect:** Lower eval-time overhead at startup.
- **Risk:** Slightly less string obfuscation; acceptable per the existing TV
  preset rationale (already no controlFlowFlattening/stringArrayEncoding on TV).

### 3.3 Trim the auth-gate ceiling
- **Where:** `src/context/AppContext.jsx:487` (8s `setAuthLoading(false)` ceiling).
- **Problem:** Cold device with slow/absent network can hold the boot splash up
  to 8s before any UI.
- **Change:** Lower the ceiling (e.g. 3–4s) and/or render the shell behind the
  gate sooner, reconciling auth in the background.
- **Effect:** Faster perceived launch on flaky networks.
- **Risk:** Ensure a late-arriving session still routes correctly (don't strand
  a logged-in user on the auth screen).

---

## Tier 4 — Bound the unbounded lists

Lower priority (only bites large providers), but real.

### 4.1 Window the category grids
- **Where:** `MoviesScreen.tv.jsx:715-725`, `SeriesScreen.tv.jsx:1167-1178`,
  `LiveTVScreen.tv.jsx:526-538` — plain `.map()` over all categories (can be
  100–200+ tiles mounted at once).
- **Change:** Apply the same focus-anchored windowing as `PagedGrid.tv.jsx`.

### 4.2 Window / cap the season episode list
- **Where:** `SeriesScreen.tv.jsx:964-1001` — full `episodes.map()`; heavily
  dubbed series can exceed 200 episodes. Also fix the per-render
  `watchHistory.find()` inside the loop (`:965-968`, O(N×E)) by prebuilding a
  lookup Map once.

---

## Suggested sequencing

1. **Baseline profile** (measure section) — no code.
2. **Tier 1** (1.1 → 1.2 → 1.3) — the felt-smoothness core. Ship + re-profile
   held-arrow frame time on device.
3. **Tier 2.1** (progress write off browse screens) — biggest playback-CPU win.
4. **Tier 3.1** (engines out of boot parse) — biggest cold-start win.
5. Remaining Tier 2 / Tier 3 / Tier 4 as capacity allows, re-profiling between.

Each item is independently shippable. Run `npm test` + `npm run lint` before
every commit (both must pass), and re-verify on `sim:lg` after Tiers 1 and 3
specifically — those touch the `file://` / old-Chromium paths where the sim and
a physical unit diverge.

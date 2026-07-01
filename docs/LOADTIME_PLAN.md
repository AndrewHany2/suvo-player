# Load-time optimization plan (all platforms)

Status: APPROVED scope = "Everything incl. output:static". Created 2026-06-30.
Source: verified multi-agent audit (35 findings → synthesized → adversarially verified).

## Controlling constraint (read first)

`web.output: "single"` (app.json:17) emits ONE ~1.6 MB JS bundle for web/electron/TV.
Under this setting **`dynamic import()` does NOT create a separate network chunk** — Metro
inlines every module into the one file. Therefore "lazy-load hls.js / Supabase" gives
**near-zero** download/parse savings until we switch to `output: "static"`. So the plan is
sequenced: do the high-value, low-risk startup + build-trim work first; tackle `output:static`
last, gated behind on-device webOS validation.

webOS hard constraints (do not regress — see memory webos-font-loading, tv-back-key-handling):
- Loads from `file://` on old Chromium. No CORS-mode font preloads. Absolute `/` paths break.
- `tv/patch-index.js` transpiles the single bundle + rewrites asset paths + inlines CSS vars +
  warms fonts + patches insertRule. If we emit MULTIPLE chunks (output:static), patch-index.js
  MUST transpile + asset-rewrite EVERY chunk, not just `index-*.js`. This is the crux risk.
- Two `@font-face` declarations (App.js runtime + patch-index.js static) must stay byte-identical.

---

## TIER 1 — Startup data waterfall (HIGH impact, small effort, all platforms, low risk)

All in `src/context/AppContext.jsx`. This is the real time-to-usable-screen bottleneck.

1. **Remove eager full channel fetch at boot.** Delete the `getLiveStreams()` block
   (AppContext.jsx:483-490) and its `setIsLoading(true/false)` wrapper (482,491). It pulls the
   *unfiltered* all-channels endpoint and JSON-parses tens of thousands of rows on the JS thread
   before any navigation. LiveTV (TV) loads per-category anyway (LiveTVScreen.tv.jsx:103/127).
   Keep the connection-test `getLiveStreams()` in AccountsScreen.jsx:80 / AccountsScreen.tv.jsx:191.
   Move the speculative `getVODCategories()`/`getSeriesCategories()` (493-494) onto the Movies/Series
   tab hooks (useMovies/useContentService), triggered on tab mount. If a global channel list is
   truly needed, fetch lazily on first LiveTV visit.

2. **Hydrate IPTV account from AsyncStorage first.** AppContext.jsx:457-497 awaits
   `fetchIptvAccounts()` (network) BEFORE reading credentials/fetching channels, and reads
   `iptv_users_${activeProfileId}` twice (464 and 473). Read it ONCE, set credentials from the
   cached account immediately, reconcile when `fetchIptvAccounts` resolves (don't await it first).

3. **Drop the upsertProfile→fetchProfile serial round-trip** (AppContext.jsx:447-449). Two serial
   Supabase calls to re-read a username already in `authUser.user_metadata`. Set profile
   optimistically from metadata; let `upsertProfile` run fire-and-forget. Keep `fetchAppProfiles`
   (453) running in parallel.

4. **Remove/debounce the full-channel-list persistence effect** (AppContext.jsx:510). Large
   `JSON.stringify` + storage write on the critical path for data re-fetched every cold start.
   Becomes moot once #1 lands. If kept, debounce + key by userKey/account (401,408) so a profile
   switch can't flash the wrong list.

## TIER 2 — Medium wins (medium impact, small effort)

5. **Defer Top-Rated TMDB prefetch** out of `useMovies.load` (src/hooks/useMovies.js:113). It fires
   `contentService.getAllMovies()` (whole VOD catalog) + 5 concurrent TMDB calls (tmdbApi.js:102-126)
   the instant the Movies tab mounts, competing with visible shelves. Trigger from
   `handleShelfVisible` (125-149) when the Top Rated shelf nears viewport, or wrap in
   requestIdleCallback/setTimeout. (Already correctly skipped on TV; affects web/electron/mobile.)

6. **Cache normalized results in ContentService** (src/services/ContentService.js:35-39,57-64,94-96).
   Every cache hit re-runs `.map(normalizeX)` allocating an object per row. Cache normalized arrays
   via a WeakMap keyed by the raw array reference (mirror tmdbApi._streamMapCache pattern,
   tmdbApi.js:18,69-80). normalize is pure + raw array is cache-stable → reuse-by-identity is safe.

7. **`decoding="async"` on grid card <img>** (LiveTVScreen.tv.jsx:486-493, MoviesScreen.tv.jsx:587-588)
   alongside existing `loading="lazy"`; confirm CH_PAGE=40 / MOV_PAGE=24 windowing aligns with
   VirtualGridTV BUFFER_ROWS=2 so off-screen images don't download.

## TIER 3 — TV build trims (low-ish impact, small effort, TV only) — all in tv/patch-index.js

8. **Gate the insertRule regex monkey-patch** (patch-index.js:175-183) behind a SYNCHRONOUS
   `CSS.supports(':focus-visible')` + flex-gap check at script-eval time (NOT the deferred 'load'
   probe). Currently runs two regex `.replace` passes on EVERY inserted CSS rule (react-native-web
   inserts hundreds at mount). Keep try/catch + unconditional fallback.

9. **Strip redundant `<link rel=preload as=style>` lines** for the 8 CSS files (index.html:26 /
   patch-index.js). On file:// preload gives zero parallelism over the stylesheet link. Optionally
   inline the ~18 KB CSS into one `<style>` to remove 8 file:// fetches. Verify no FOUC.

10. **Neutral splash inside `<div id="root">`** in patch-index.js — centered logo/spinner on
    #0A0E1A. Fixes perceived blank screen during bundle parse. MUST be auth-agnostic (neutral
    logo only — never an optimistic main-nav skeleton) so it can't flash the wrong screen.

## TIER 4 — Decouple first paint from auth (bigger, medium impact)

11. With Supabase configured, `authLoading` inits true (AppContext.jsx:27) and AppNavigator returns
    `null` (AppNavigator.jsx:85 / AppNavigator.web.jsx:623) until `getSession()` resolves — app
    paints NOTHING until a network round-trip, 8000ms blank ceiling (AppContext.jsx:433). Render a
    NEUTRAL splash while `authLoading` (pairs with #10), keep the 8s timeout. Do NOT render an
    optimistic main-nav skeleton (would flash AuthScreen / wrong state). Verify with a real
    webOS trace (DCL → first meaningful paint) before/after — getSession is not strictly on the
    bundle-parse critical path, so don't claim a win without measurement.

## TIER 5 — Per-platform variant resolution (real bundle win, works under output:single)

12. AppNavigator.web.jsx:13-22 statically imports BOTH `.web` AND `.tv` variants of every screen
    (LiveTV/Movies/Series/History/Accounts/...). Each build ships the other platform's screens.
    Resolve to only the active platform's variant (e.g. a single `.web.jsx`/`.tv.jsx` entry chosen
    by metro platform resolution or a runtime `__TV__` switch that imports one set). This is the one
    genuine code-trim that helps even under output:single. Verify both web and TV builds still mount
    their correct screens.

## TIER 6 — output:single → output:static (LARGEST, RISKIEST — do last, gate on validation)

> **BLOCKED / NOT VIABLE (verified 2026-07-01).** Flipping `web.output: "static"` and
> building fails immediately: `Static rendering is enabled … Unable to resolve module
> expo-router/node/render.js`. In Expo, `output: "static"` is **static-site generation and
> hard-requires expo-router**; it is NOT a code-splitting toggle. This app uses a custom
> `AppNavigator` (expo-router is not a dependency), so true web code-splitting would require
> replacing the entire navigator with expo-router file-based routing — a major architectural
> rewrite well outside load-time work, and high-risk for the webOS `file://` target.
> **Consequence:** the only Tier 6 win achievable under `output:single` is the lazy Supabase
> client init (DONE, commit d5f60c6). Lazy hls.js / per-screen splitting give no download
> savings while `output:single` inlines every module. Recommend keeping `output:single`.

13. Switching to `output:"static"` enables true code-splitting (real network-chunk savings for
    lazy hls.js/Supabase/per-screen). Prerequisites BEFORE claiming any win:
    - Extend tv/patch-index.js to transpile + asset-rewrite + CSS-var-inline EVERY emitted chunk
      (it currently only handles `index-*.js`). Dynamic-import syntax must be validated on the
      webOS Chromium target (patch-index does not transform import()).
    - Re-validate the metro CJS workaround for @supabase (metro.config.js:6-13) — output:static +
      dynamic import could reintroduce the `.mjs` dynamic-import(variable) path that config avoids.
    - Validate file:// chunk loading works on-device (relative paths, no CORS).
    - Measure cold file:// load on simulator/device before vs after. If it doesn't beat the
      single-bundle baseline on TV, keep output:single for TV and only adopt static for web/electron.
    Only after this: lazy-load VideoPlayerScreen + dynamic-import hls.js (532 KB, AppNavigator.web.jsx:23,
      VideoPlayerScreen.web.jsx:2, hlsDriver.js:26) and defer Supabase createClient.
    Cheap intermediate even without static: make supabase client lazy-but-sync-API — keep
      `isSupabaseConfigured()` sync (env-only), defer `createClient()` behind a memoized getter
      (`let _c; const client = () => (_c ??= createClient(...))`) in src/services/supabase.js to
      drop the eager top-level init without changing any call site's sync/async contract.

## REFUTED / not worth it (do NOT implement)
- Lazy hls.js / Supabase as a standalone fix → no saving under output:single; risky. (See Tier 6.)
- woff2/subset fonts → ~225 KB package shrink but NOT a load-time win (file://, already
  non-blocking font-display:optional); risky (two @font-face must agree; subsetting drops
  non-Latin IPTV title glyphs).
- Flex-gap MutationObserver gating → already implemented behind a runtime probe (patch-index.js:228-248).
- Shrinking 3.1 MB splash / 968 KB icon → don't ship to web/TV; only native app size.

## Validation per tier
- Tiers 1-2: `npm test`; manually verify first screen still loads correct data after profile switch.
- Tier 3,5,6: `npm run build:tv` then `npm run sim:lg` (webOS simulator), check console for the
  intervention/font warnings the memories document, confirm screens mount.
- Web/electron: `npm run build:web` / `build:electron`, confirm bundle still boots.

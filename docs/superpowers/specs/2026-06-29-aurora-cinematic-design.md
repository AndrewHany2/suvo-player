# Aurora Cinematic — Cross-Platform Design Evolution

**Date:** 2026-06-29
**Status:** Approved (brainstorming) → pending implementation plan
**Scope:** Evolve the visual direction across **all platforms** (web/desktop, native iOS/Android, webOS TV), fully **remove Tamagui**, and tokenize the codebase. Single spec; implementation plan will phase it.

---

## 1. Goal & decisions

Evolve the existing **"Aurora"** design language (midnight + indigo→cyan) from a flat dark dashboard into a **cinematic streaming** experience, applied with parity across web, native, and TV.

Locked decisions (from brainstorming):

| Decision | Choice |
|---|---|
| Direction | **Aurora Cinematic** — keep indigo→cyan identity, go cinematic (hero, glow, depth). Evolution, not reinvention. |
| Platforms | **All three equally** (web/desktop, native, TV). |
| Refactor | **Remove Tamagui entirely** + tokenize hardcoded hex. |
| Iconography | **Custom inline-SVG line-icon set** (no new dependency). Replace all emoji. |
| Hero | **Static art + gradient scrim** (no autoplay, no rotation). |
| Rollout | One spec; plan phased Foundation → Components → per-screen. |

### Non-goals (YAGNI)
- No auto-rotating hero carousel.
- No new animation library; web uses CSS transitions, native uses RN `Animated`/layout, TV stays static.
- No palette reinvention (true-black / warm-spotlight directions were rejected).
- No new runtime dependencies.
- No backend/data-shape changes.

---

## 2. Architecture context (current state)

Three render paths share one prop API:

- **Web/Desktop** — `*.web.jsx`, raw DOM via `src/ui/primitives.web.jsx`. Global CSS injected once from `src/navigation/AppNavigator.web.jsx` (`#lumen-global` style block) + `lumen-*` hover/focus rules.
- **Native (iOS/Android)** — `*.native.jsx`, React Native via `src/ui/primitives.native.jsx`.
- **TV (webOS)** — `*.tv.jsx` + `*.tv.css`, raw DOM grids; remote focus via `FocusManager` toggling `.tv-focus`; `src/styles/tvRemoteFocus.css`. Old Chromium: **no CSS custom properties assumed, no animations/shadows, literal hex only**.

Shared design layer: `src/ui/tokens.js` (source of truth), `src/ui/styleProps.js` (RN-style-prop → CSS bridge), `src/ui/primitives.{web,native}.jsx`. Scaling: `src/utils/scaleSize.js` (`ss()`, `useScale()`).

**Key problems this spec fixes:**
1. Tokens exist but screens **bypass them** — literal hex (`#0A0E1A`, `#6C5CE7`, `#28324E`, `#EAF0FF`, `#7A86A8`, `#22D3EE`) is scattered across nearly every screen, blocking systematic visual change.
2. **17 files + `tamagui.config.js` still import Tamagui** (mostly `YStack/XStack/Text`), including `AppNavigator` (web + native).
3. **No featured/hero treatment** — Movies/Series are just pills + shelves.
4. **Emoji iconography** reads templated and renders inconsistently.
5. **Per-screen reimplemented loading/error/empty states** — duplicated in every screen.
6. **Ad-hoc buttons** — `<YStack onPress>` repeated everywhere instead of a `Button` primitive.
7. `PosterCard.web` currently renders an **always-on** cyan ring+glow on every card (in-flight working-tree change) — should be focus/hover only.

---

## 3. Design language

Identity unchanged: `bg #0A0E1A`, `surface #141A2E`, `surface2 #1B2236`, `border #28324E`, `accent #6C5CE7` (indigo), `accent2 #22D3EE` (cyan), `text #EAF0FF`, `muted #7A86A8`. Display = Space Grotesk, body = Inter.

Five signature moves:

1. **Featured Hero** — full-bleed backdrop art with a left→right gradient **scrim** (`bg` → transparent) so title text stays legible. Display-font title, meta line (year · genre · rating), primary `▶ Play` + secondary action (Details/Add). Static.
2. **Focus/hover glow** — cyan ring (`accent2`) + soft glow as the *interaction* language, **only on focus/hover**, never resting state. (Fixes the always-on glow.)
3. **Type hierarchy** — display reserved for hero + section titles (negative tracking); body for all else. Ramp: `eyebrow` (caps, tracked, muted) / `label` / `title` / `hero`.
4. **Layered depth** — `surface`/`surface2` tints + documented `glow`/elevation tokens replace ad-hoc `boxShadow` strings (web/native only; TV flat).
5. **Line-icon set** — inline-SVG `Icon` components replace all emoji.

---

## 4. Foundation — tokens & de-hardcoding

### 4.1 Extend `src/ui/tokens.js`
Add (additive — do not break existing keys):
- `scrim`: hero gradient overlay descriptor (`css` string for web/TV + RN gradient stops for `expo-linear-gradient` on native).
- `glow`: focus-glow shadow preset (web boxShadow string / native shadow object / TV no-op via `Platform.select` + an exported web string constant).
- `focusRing`: `{ color: accent2, width, offset }`.
- `motion`: `{ fast: 120, base: 200, slow: 320 }` ms + standard easing string (web/native only; TV ignores).
- `heroHeights`: reference heights for web/native/tv (pre-`ss()`).
- `iconSizes`: `{ sm, md, lg }`.
- Optional extra surface tint(s) if hero/overlays need them (e.g. `overlay` rgba).

### 4.2 Tokenize screens/components
Replace literal hex in **all `*.jsx` screens and `src/presentation/components/*` and `src/ui/primitives.web.jsx`** with `colors.*` / token imports.

**Preserved exception (by design):** legacy CSS strings keep literal hex because old webOS Chromium can't be assumed to support `var()`:
- `src/styles/*.css` and `*.tv.css`
- the injected `#lumen-global` block + `lumen-*` rules in `AppNavigator.web.jsx`

These literals are consolidated into one clearly-labeled "**token mirror**" section with a comment pinning each value to its `tokens.js` key, so drift is auditable.

---

## 5. Tamagui removal

For each of the 17 files importing `tamagui` + `tamagui.config.js`:
1. Audit which components/props each uses (`YStack/XStack/Text/Input/Stack`, style props).
2. Swap import source to `src/ui/primitives` (correct relative path per file).
3. Confirm every used prop is covered by `styleProps.STYLE_KEYS` / primitives; extend primitives where a gap exists.

Files (from `grep -rln tamagui src`):
`components/MovieDetail.jsx`, `components/MovieDetail.web.jsx`, `components/SeriesDetail.jsx`, `components/SeriesDetail.web.jsx`, `navigation/AppNavigator.jsx`, `navigation/AppNavigator.web.jsx`, `screens/AccountsScreen.jsx`, `screens/AuthScreen.jsx`, `screens/HistoryScreen.native.jsx`, `screens/HistoryScreen.web.jsx`, `screens/LiveTVScreen.native.jsx`, `screens/LiveTVScreen.web.jsx`, `screens/ProfilesScreen.jsx`, `screens/SeriesScreen.native.jsx`, `screens/SeriesScreen.web.jsx`, `screens/SettingsScreen.web.jsx`, `screens/VideoPlayerScreen.native.jsx`, + delete `src/tamagui.config.js`.

Then:
- Remove `tamagui`, `@tamagui/config`, `@tamagui/babel-plugin` from `package.json`.
- Remove the Tamagui babel plugin from `babel.config.js`.
- Verify `metro.config.js` has no Tamagui-specific config left dangling.
- Verify: `npm run build:web` exits 0; metro bundles native; `npm run build:tv` patches cleanly.

---

## 6. New shared components

Each ships `.web.jsx`, `.native.jsx`, and (where it renders on TV) a `.tv` path or `__TV__`-aware branch. All built on `src/ui/primitives` + tokens.

### 6.1 `Icon` (inline SVG)
- Minimal set covering current usage: `play`, `plus`, `back/arrow-left`, `chevron-right`, `star`, `film`, `tv`, `warning`, `search`, `settings`, plus any found during audit.
- `<Icon name size color />`, platform-split:
  - **Web/TV:** inline `<svg>` (safe on old webOS Chromium).
  - **Native:** `react-native-svg` is **not installed** and **no new dependency** is allowed, so native renders icons from RN primitives — geometric icons (`play`, `plus`, `back`, `chevron-right`) built from `View` + borders/rotation; the remaining content icons use clean **non-emoji Unicode symbols** (e.g. `★`, `⚙`) styled via `Text`. Per-icon native mechanics are an implementation detail; the contract (`name`/`size`/`color`, zero dependencies, no color/emoji glyphs) is fixed here.
- Replaces every emoji literal across all platforms.

### 6.2 `StatePanel`
- One component, three modes: `loading` (spinner + label), `error` (icon + title + message + Retry), `empty` (icon + title + message + optional CTA).
- Replaces the duplicated loading/error/empty blocks in Movies, Series, LiveTV, History, Accounts, Settings, Auth.

### 6.3 `Button` primitive
- Variants: `primary` (accent fill), `secondary` (surface2 + border), `ghost`. Sizes via `ss()`. Focus/hover glow built in. TV-focusable.
- Replaces ad-hoc `<YStack onPress>` buttons across screens.

### 6.4 `Hero`
- Props: `item` (backdrop/title/meta), `onPlay`, `onDetails`.
- Web/native: backdrop `<img>`/`Image` + scrim gradient + content. Native scrim via `expo-linear-gradient` (already a dependency). TV: static, flat scrim, focusable Play button, no parallax/crossfade.
- Hero item selection = a small **pure helper** (e.g. first trending / top-rated with a backdrop) — unit-testable.

### 6.5 `PosterCard` polish (web/native/tv)
- Glow/ring **only** on `isFocused` (TV) or `:hover`/`:focus` (web). Resting state: subtle border only.
- Gradient title overlay option; refined HD + rating badges using `Icon` + tokens.
- Keep explicit width×1.5 height (no `aspect-ratio` on webOS).

### 6.6 `ContentShelf` / `DiscoverPills` polish
- Tokenize, use `Icon` for chevrons/nav arrows, consistent title treatment (display font), refined rail nav buttons + edge fades.

---

## 7. Per-screen application

| Screen | Web | Native | TV |
|---|---|---|---|
| **Movies** | Hero + Discover pills + polished shelves | Hero + FlatList grids | Hero (static) + grid, focus ring |
| **Series** | same as Movies | same | same |
| **LiveTV** | now/next spotlight hero + polished channel cards | spotlight + list | spotlight + grid, focus |
| **History** | polished progress cards + `StatePanel` empty | same | same |
| **Settings** | form/input/`Button` consistency, tokenized | same | focusable rows |
| **Accounts** | tokenized + `StatePanel` + `Button` | same | `.tv` focus rows |
| **Profiles** | avatar grid polish, tokenized | same | focus |
| **Auth** | input/button consistency, tokenized | same | n/a / focus |
| **VideoPlayer** | control/overlay polish, tokenize | same | focus on controls |

Player sub-components (`ResumePrompt`, `StatsOverlay`, `SubtitleSettings`) are already on primitives — tokenize colors + apply `Icon`/`Button`.

---

## 8. Per-platform strategy

- **Web/Desktop:** CSS transitions for hero/card/focus glow; honor `prefers-reduced-motion`; existing ultrawide `MAX_W` wrapper retained. Hover states gated by `body:not(.keyboard-nav)` (existing pattern).
- **Native:** transitions via RN `Animated`/layout animations; safe-area aware (existing); ≥44px touch targets; shadow/glow via `Platform.select`; `expo-linear-gradient` for scrims.
- **TV (webOS):** **no animation, no shadow** (preserve existing constraint); instant cyan focus ring (2px, 3px on webOS/tizen); 10-foot type via `ss()`; literal-hex CSS; grid model unchanged; hero static.

---

## 9. Testing & verification

- **All 34 existing tests pass** (`npm test`).
- Add unit tests for new **pure helpers** (hero-item selection; any icon-name/size mapping logic).
- `npm run build:web` exits 0.
- Native bundles (metro) without Tamagui.
- `npm run build:tv` patches cleanly.
- **No Tamagui references remain:** `grep -rln tamagui src` returns nothing; `tamagui`/`@tamagui/*` absent from `package.json` + `babel.config.js`.
- **No emoji remain** in app UI (`grep` audit for the replaced glyphs).
- Visual/device/TV verification is **manual by the user** (project norm) — implementation provides a per-platform visual checklist.

---

## 10. Implementation phasing (for the plan)

1. **Foundation** — extend tokens; `Icon`, `StatePanel`, `Button` primitives; tokenize the token-mirror CSS blocks. (No visible regression.)
2. **Tamagui removal** — migrate 17 files + delete config + strip deps/babel; green build on all targets.
3. **De-hardcode** — replace literal hex in screens with tokens.
4. **Components** — `Hero`; `PosterCard`/`ContentShelf`/`DiscoverPills` polish.
5. **Per-screen rollout** — Movies → Series → LiveTV → History → Settings/Accounts/Profiles/Auth → VideoPlayer, web+native+TV each.
6. **Verify** — tests, builds, grep audits, manual checklist.

Phases 2 and 3 can interleave per file (migrate a file off Tamagui and tokenize it in the same pass).

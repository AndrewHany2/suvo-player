# Tamagui Migration Plan — IPTV Player

## Context

Only `ProfilesScreen.jsx` is currently migrated to Tamagui. All other screens use React Native primitives (`View`, `Text`, `TouchableOpacity`, `StyleSheet`, etc.) and raw HTML in web variants. This migration replaces RN primitives with Tamagui across all screens/components/navigation, adds TV remote navigation via `useTVNavigation`, and standardises the codebase on the ProfilesScreen pattern.

---

## Guiding Principles (from ProfilesScreen)

- `YStack` = column flex container (replaces `View` with column direction)
- `XStack` = row flex container (replaces `View` with `flexDirection: 'row'`)
- `Text`, `Input`, `ScrollView`, `Spinner` from `tamagui`
- Pressable areas: `YStack`/`XStack` with `onPress`, `pressStyle={{ opacity: 0.8 }}`, `hoverStyle={{ scale: 1.05 }}`, `animation="quick"`, `cursor="pointer"`
- No `StyleSheet.create()` — all styles as inline Tamagui props
- `useTVNavigation({ rows, active })` → `{ focusedRow, focusedCol }` for D-pad navigation
- Colors used literally (no custom tokens): `#0f0f23` bg, `#1a1a2e` card, `#16213e` dark, `#2a2a4e` border, `#e94560` accent, `#4caf50` success

## What Is NOT Modified

- `VideoPlayerScreen.jsx` / `VideoPlayerScreen.web.jsx` — complex video/HLS integration
- `AppContext.jsx`, `storage.js`, `useTVNavigation.js` — no UI
- `tamagui.config.js` — v3 preset is sufficient as-is
- `Loader.jsx` — already uses Tamagui

## Keep from react-native (no Tamagui equivalent)

- `Image` — Tamagui has no Image primitive
- `FlatList` / `SectionList` — keep for large virtualized lists; replace with `ScrollView + map` only for small lists
- `KeyboardAvoidingView` — no Tamagui equivalent
- `Modal` — keep for complex overlays (LiveTV add-channel, detail modals)
- `Alert` — keep for OS-level alerts
- `LinearGradient` — keep from expo-linear-gradient
- `StyleSheet` — only if needed for `absoluteFillObject` on Image; prefer plain const `const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }`

---

## Migration Order

### Wave 1 — Forms (no dependencies)

**Step 1: `src/screens/AuthScreen.jsx`**  
Remove: `View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator` from react-native  
Keep: `KeyboardAvoidingView, Platform`  
Add: `YStack, XStack, Text, Input, ScrollView, Spinner` from tamagui  
TV nav: simple `useEffect` keydown listening for `Enter` → submit

**Step 2: `src/screens/AccountsScreen.jsx`**  
Remove: `View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView` from react-native  
Keep: `FlatList, Alert, KeyboardAvoidingView, Platform, Image`  
Add: `YStack, XStack, Text, Input, ScrollView, Spinner`  
Keep `FlatList` for account list. Replace `Modal` content interior with Tamagui but keep `Modal` shell.  
TV nav: Enter-to-submit on form view

### Wave 2 — Components (unblock screens)

**Step 3: `src/components/MovieDetail.jsx`**  
Remove: `View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator` from react-native  
Keep: `Image, Linking`; replace `StyleSheet.absoluteFillObject` with `const FILL = { position:'absolute', top:0, left:0, right:0, bottom:0 }`  
Add: `YStack, XStack, Text, ScrollView, Spinner`  
TV nav: `Escape` → `onBack()`, `Enter` → primary play action

**Step 4: `src/components/MovieDetail.web.jsx`**  
Same as Step 3. Keep CSS `background:` gradient overlay as raw RN `View` (Tamagui doesn't forward the CSS `background` prop). Keep `<iframe>` for trailers.

**Step 5: `src/components/SeriesDetail.jsx`**  
Remove same as Step 3. Keep `SectionList` (episodes), `Image`, `Linking`.  
Add: `YStack, XStack, Text, ScrollView, Spinner`  
TV nav: `Escape` → close episodes or `onBack()`

**Step 6: `src/components/SeriesDetail.web.jsx`**  
Same as Steps 4+5 combined. Keep CSS gradient View; keep `SectionList`; keep `<iframe>`.

### Wave 3 — Content Screens

**Step 7: `src/screens/HistoryScreen.jsx`**  
Remove: `View, Text, ScrollView, TouchableOpacity, StyleSheet` from react-native  
Keep: `Image, Alert, LinearGradient`  
Add: `YStack, XStack, Text, ScrollView`  
Progress bar `width: \`${p}%\`` → test `width={\`${p}%\`}` on YStack; fallback to RN View if native fails.  
TV nav:

```js
useTVNavigation({
  active: !currentDetail,
  rows: [
    { items: myList, onSelect: (i) => openDetail(myList[i]) },
    { items: history, onSelect: (i) => openDetail(history[i]) },
  ].filter((r) => r.items.length > 0),
});
```

**Step 8: `src/screens/HistoryScreen.web.jsx`**  
Same as Step 7. Keep `useDragScroll` hook and all `<div>/<button>` elements. Keep CSS `background:` gradient View. Migrate outer View wrappers and card sub-components.

**Step 9: `src/screens/MoviesScreen.jsx`**  
Remove: `View, Text, TextInput, ScrollView, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator` from react-native  
Keep: `FlatList` (shelves list + category grid), `Image`, `memo`  
Add: `YStack, XStack, Text, Input, ScrollView, Spinner`  
Sub-components: `PosterCard`, `Shelf`, `CategoryPage` — all get Tamagui treatment.  
Replace `StyleSheet.absoluteFillObject` with `FILL` constant on Image.  
TV nav (discover pills only — shelf cards are too numerous):

```js
useTVNavigation({
  active: !currentCategory && !currentMovieDetail,
  rows: [
    { items: discoverItems, onSelect: (i) => handleDiscover(discoverItems[i]) },
  ],
});
```

**Step 10: `src/screens/MoviesScreen.web.jsx`**  
Keep all `<div>/<button>` drag-scroll and IntersectionObserver elements. Keep `className` spreads on YStack (renders as `div` on web — spread works). Migrate outer Views and sub-component interiors same as Step 9.

**Step 11: `src/screens/SeriesScreen.jsx`**  
Identical to Step 9. Swap `MovieDetail` → `SeriesDetail`, VOD API calls → series API calls, `stream_id` → `series_id`.

**Step 12: `src/screens/SeriesScreen.web.jsx`**  
Identical to Step 10 with series-specific field names.

**Step 13: `src/screens/LiveTVScreen.jsx`**  
Remove: `View, Text, TextInput, FlatList, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator` from react-native  
Keep: `FlatList` (shelves), `Modal` (add-channel), `Alert` (validation), `Image`, `memo`  
Add: `YStack, XStack, Text, Input, ScrollView, Spinner`  
Memo'd `ChannelCard`: outer `YStack`, inner `XStack` for head, LIVE badge as `XStack/YStack`, fav toggle as Tamagui `Text` with `onPress`.  
`LiveShelf`: outer `YStack`, title `XStack`, Tamagui horizontal `ScrollView`.  
Keep `Modal` shell; migrate Modal interior to Tamagui.  
TV nav: single row over `categories` array; Enter scrolls `FlatList` to that category index.

**Step 14: `src/screens/LiveTVScreen.web.jsx`**  
Keep all drag-scroll `<div>`, IntersectionObserver, and `<span className="lumen-live-dot">` (uses CSS `lumen-blink` animation). Migrate outer `View` wrappers. `LiveCard` interior: outer `YStack`, head `XStack`, keep `<span>` for LIVE dot. Keep RN Views for progress bar % width.

### Wave 4 — Navigation

**Step 15: `src/navigation/AppNavigator.jsx`**  
Remove: `View, Text, TouchableOpacity, StyleSheet` from react-native (nothing from react-native needed).  
Add: `YStack, XStack, Text`  
Migrate `HeaderRight` component only — React Navigation container/tabs/stack untouched.

**Step 16: `src/navigation/AppNavigator.web.jsx`**  
Remove: `View, Text, TouchableOpacity, StyleSheet, TextInput` from react-native  
Add: `YStack, XStack, Text, Input`  
Keep global CSS injection (the `<style>` tag injection for scrollbars, hover, animations).  
Migrate: `BrandGlyph`, `NavLink`, `TopNav`, root layout `View` → `YStack`.  
Keep HTML nav structure; `className` spreads work on Tamagui YStack (renders as `div`).  
`Input` for search: `backgroundColor="transparent" borderWidth={0}` to avoid default Tamagui Input chrome conflicting with global CSS.

---

## Key Tricky Parts

| Issue                                    | Solution                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `StyleSheet.absoluteFillObject` on Image | `const FILL = { position:'absolute', top:0, left:0, right:0, bottom:0 }` — eliminates StyleSheet |
| Progress bar `width: \`${n}%\``          | Try YStack `width={\`${n}%\`}` — fallback to RN View if native crashes                           |
| CSS `background: linear-gradient(...)`   | Keep those specific elements as RN `View` (Tamagui doesn't forward CSS `background`)             |
| `className` spreads on web               | Spread `{...({ className: 'lumen-xxx' })}` onto YStack — renders as div on web, accepted         |
| Tamagui Input default chrome             | Add `backgroundColor="transparent" borderWidth={0}` when embedding in custom containers          |
| `FlatList` renderItem with Tamagui       | Keep `memo()` on card components to offset Tamagui's extra render overhead                       |
| TV nav for vertical shelves (LiveTV)     | useTVNavigation row over categories array; Enter → `FlatList.scrollToIndex`                      |

---

## TV Navigation per Screen

| Screen         | Rows                                            |
| -------------- | ----------------------------------------------- |
| AuthScreen     | Manual Enter-to-submit `useEffect`              |
| AccountsScreen | Manual Enter-to-submit `useEffect`              |
| HistoryScreen  | Row 0: myList items, Row 1: watch history items |
| MoviesScreen   | Row 0: discover pills                           |
| SeriesScreen   | Row 0: discover pills                           |
| LiveTVScreen   | Row 0: categories array                         |
| MovieDetail    | Escape=back, Enter=play (no rows needed)        |
| SeriesDetail   | Escape=close, Enter=play (no rows needed)       |

---

## Verification

After each wave, verify:

1. **Web**: `npm run web` — screens render, interactions work, hover/press animations active
2. **TV build**: `npm run build:tv && node tv/patch-index.js` — syntax errors absent (`node --check`)
3. **Deploy**: `npm run deploy:lg` — arrow keys navigate, Enter selects, visual focus indicators visible
4. **Native** (if available): `expo start` on iOS/Android simulator

Critical checks per wave:

- Wave 1: Login/register/CRUD form flows + Enter-to-submit
- Wave 2: Detail modals open/close + Escape key + trailer iframe (web)
- Wave 3: Shelf lazy-loading, drag-scroll (web), FlatList virtualization, TV D-pad navigation
- Wave 4: Nav header badges, web sticky nav, tab switching, accounts drawer

---
target: tv and native (post-fix re-critique)
total_score: 31
p0_count: 0
p1_count: 0
timestamp: 2026-07-22T09-07-41Z
slug: all-platforms-native
---
# Cross-Platform Consistency Re-Critique — Native (post-fix)

Method: dual-agent (A: a1d19465 · B: a6cca2df). Lens: cross-platform parity vs web reference.

## Design Health — 31/40 (Good) — up from 25/40
Consistency #4: 1 → 3. Match-real-world #2 and User-control #3 now 4/4.
Heuristics: 1:3 2:4 3:4 4:3 5:3 6:3 7:3 8:3 9:3 10:2

## Verified fixes (Assessment B confirmed all in source)
- LABELS.js frozen + applied: native says "My List"/"Continue Watching"; first tab "Home". Old "Favorites"/"Watch History" gone.
- Hero.native mirrors Hero.web prop API + copy byte-for-byte (Resume/Play + Browse library via shared Button).
- Tabs reordered Home→Live→Movies→Series; nav chrome uses fonts.display/body (no more SF/Roboto fallback).
- My List renders through shared PosterCard.native (radii.card, onRemove overlay); CWCard aligned; useTVNavigation removed.
- Blocking Alert.alert replaced by shared useDeferredRemove + undo snackbar (shared with web).

## Remaining issues
- **[P2] Native MovieDetail diverges from MovieDetail.web** — flat black scrim rgba(0,0,0,0.82) vs web's midnight gradient; bespoke YStack My-List pill instead of shared Button; hardcoded height 420 / title 26 instead of ss(). The detail page still breaks the single-design rule the Home surface now honors. Fix: port the web hero (midnight LinearGradient + shared Button + ss()).
- [P3] Native trailer = external Linking.openURL "Trailer" vs web inline iframe "Watch Trailer".
- [P3] Hero.native ignores heroHeights.native (340) — renders default 300; pass height={heroHeights.native}.
- [P3] Hero + snackbar copy ("Synced across your devices", "Browse library", "Removed"/"Undo") inlined, not in LABELS — re-drift risk.
- [P3] PosterCard remove a11y label hardcoded vs LABELS.removeFromMyList.

## Persona
- Casey (web↔phone): Home transfers cleanly now; the movie DETAIL page still "feels different" on phone (the P2).
- Jordan: strong first run (empty CTA, no-account CTA, Browse-library discovery path).

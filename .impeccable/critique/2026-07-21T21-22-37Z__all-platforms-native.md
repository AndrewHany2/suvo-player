---
target: tv and native (cross-platform consistency)
total_score: 25
p0_count: 2
p1_count: 2
timestamp: 2026-07-21T21-22-37Z
slug: all-platforms-native
---
# Cross-Platform Consistency Critique — Native (iOS/Android)

Method: dual-agent (A: a3835a05 review · consistency: a108ea1a · B: a99ab5f4). Lens: cross-platform design parity vs the web/Electron reference (user goal: same layout/theme/styles/buttons everywhere).

## Design Health — 25/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of status | 3 | Progress bar uses accent(indigo) — verify vs web |
| 2 | Match real world | 3 | Labels reasonable individually, incoherent across platforms |
| 3 | User control | 3 | Remove = always-on × overlay; Live uses star toggle (two models) |
| 4 | Consistency | **1** | 3-way label drift; hand-rolled cards (radius 8 vs 14, 2px vs 1px border); no ss() scaling; header 22 vs ss(20) |
| 5 | Error prevention | 3 | Confirm dialogs solid |
| 6 | Recognition | 2 | web "My List" → native "Favorites" forces translation |
| 7 | Flexibility | 2 | Dead useTVNavigation on touch; no search/filter |
| 8 | Aesthetic/minimal | 3 | Persistent × adds noise vs web |
| 9 | Error recovery | 3 | No error mode on History (only empty/no-account) |
| 10 | Help/docs | 2 | Empty-state copy only explains Favorites, not Watch History |

## Anti-patterns verdict
Not AI slop — fully tokenized, disciplined StatePanel usage. The failure is genuine cross-platform DRIFT: the History surface reimplements poster cards and section labels by hand instead of reusing PosterCard.native/ContentShelf.native.

## Priority issues
- **[P0] Same two concepts wear three different names.** Native "Favorites"/"Watch History"; web "My List"/"Continue Watching"; TV "Favorites"/"Continue Watching". Copy-only, highest-impact. Fix: adopt web canonical ("My List"/"Continue Watching") in HistoryScreen.native.jsx headers (L173/196), remove dialogs (L120/126), a11y labels (L46/78), empty copy (L145-166). Source from a shared strings module.
- **[P0] History reimplements poster cards.** MyListCard/CWCard (L36-104) differ from PosterCard.native: radius radii.sm(8) vs radii.md(14), permanent 2px border vs 1px resting, no HD/rating badge, no shimmer, fixed 130px with no ss(). A movie poster looks different depending on the tab. Fix: render My List through ContentShelf.native + PosterCard.native; extract a shared ProgressCard for Continue Watching.
- **[P1] Bypasses the ss() density ramp.** Fixed 130/260/148/22px — History posters stay phone-sized on tablets while Movies scale. Fix: wrap widths/heights/fonts/paddings in ss(); set section title to ss(20).
- **[P1] Dead TV-focus nav grafted onto touch.** useTVNavigation (L133-140) drives borderColor off focusedRow/Col that never matches on touch → cards stuck at 2px resting border. Fix: remove it from the native screen.
- **[P2] Tiny low-contrast labels.** epLabel 9px in muted #7A86A8 (L51) below comfortable reading floor. Fix: raise to ss(11-12), use textDim.
- **[P2] Remove affordance expressed two ways** (× overlay in History, star toggle in Live). Standardize.

## Persona red flags
- **Casey (web↔phone):** curated "My List" on web, sees "Favorites" on phone; History posters have squarer corners/thicker borders than identical Movies posters; don't scale up on tablet.
- **Jordan (first-timer):** tab says "History" but screen opens on "Favorites"; empty state only explains half the screen; persistent × looks like tapping deletes.
- **Sam (low-vision):** 9px steel labels; fixed sizing ignores device scaling.

## Minor
No error mode (no Retry); tracking drift (-0.3 vs -0.4); one-off radius 12 on × badge; "Connect account" vs "Add Account" verb drift.

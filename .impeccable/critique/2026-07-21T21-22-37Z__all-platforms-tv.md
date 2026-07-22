---
target: tv and native (cross-platform consistency)
total_score: 25
p0_count: 2
p1_count: 2
timestamp: 2026-07-21T21-22-37Z
slug: all-platforms-tv
---
# Cross-Platform Consistency Critique — TV (webOS/Tizen)

Method: dual-agent (A: ac5f00ca review · consistency: a108ea1a · B: a99ab5f4). Lens: cross-platform design parity vs the web/Electron reference (user goal: same layout/theme/styles/buttons everywhere).

## Design Health — 25/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of status | 3 | No hero → no "what you were watching" anchor like web |
| 2 | Match real world | 3 | Same list called three things on one screen |
| 3 | User control | 3 | Empty state has no CTA (dead-end) |
| 4 | Consistency | **1** | Home is heroless + titled "My List & History"; 3 names for one list; two poster focus treatments |
| 5 | Error prevention | 3 | Low-stakes; fav toggle reversible |
| 6 | Recognition | 2 | Dead cyan see-all chevron+count on Home headers |
| 7 | Flexibility | 2 | Inert chevron; no jump-to-source from saved poster |
| 8 | Aesthetic/minimal | 2 | 1 Favorites poster in empty rail + no hero reads as broken |
| 9 | Error recovery | 3 | StatePanel clean |
| 10 | Help/docs | 3 | Instructive empty copy |

## Anti-patterns verdict
Not AI slop — exemplary file:// / old-Chromium discipline (no decorative transitions/shadows, aspect-ratio @supports fallback, inlined tokens). The failure is over-fitted bespoke per-screen code that drifted from the web reference and from itself. Detector: 17 CSS advisories in tvl.css (off-ramp font sizes 13/15/17/18/24px, radii 4/5px, raw white-alpha washes).

## Priority issues
- **[P0] TV "Home" diverges from web Home: heroless + titled "My List & History".** Same nav tab (home→HistoryScreen), structurally different top-of-screen. Fix: pass a resume hero into VirtualShelvesTV (already supports it — Home is the only caller with showHero={false}, L758) and set topbar title to "Home".
- **[P0] One saved list has three names on TV** — shelf "Favorites" (L86), buttons "My List"/"In My List" (L519/617), topbar "My List & History" (L740/755). TV uses both web and native vocabulary at once. Fix: adopt "My List" everywhere; retitle topbar "Home".
- **[P1] Two poster focus treatments.** Movies/Series grid = .tvl-card--on (4px cyan outline + offset + fill); Home Favorites (PosterCard.web) = 3px inner border only. Fix: route Home Favorites through ShelfCard.tv (carries .tvl-card--on).
- **[P1] Dead see-all chevron + count on Home headers.** VirtualShelves.tv always renders the cyan chevron (L658-676); Home passes no onSeeAll → false affordance, points at an empty rail on a 1-item shelf. Fix: gate the chevron on onSeeAll.
- **[P2] Single Favorites poster in empty rail reads as broken** at 10ft. Adding the hero (P0) fixes the top; ensure hero renders when only Favorites has content.
- **[P3] Sub-legible Continue-card text** (title ss(13), meta ss(12)) at 10ft; no large-text scaling path. Raise title ≥16px design, meta ≥14px.

## Persona red flags
- **Alex (remote power user):** focus strength changes between Home (3px border) and grid posters (4px outline); chevron invites a press that does nothing; no jump from saved poster to source grid.
- **Sam (a11y/large-text):** ss(12-13) card text below comfortable floor; dual naming; empty-state dead-end.
- **10-foot viewer:** heroless top + lone poster reads as failed load; nav says "Home" while header says "My List & History".

## Minor
No-account state omits topbar (header flickers between states); empty vs no-account use different icons (film vs tv); ContinueCard.tv '.suvo-poster-card' class has no matching CSS rules; inert chevron shares cyan hue with focus ring.

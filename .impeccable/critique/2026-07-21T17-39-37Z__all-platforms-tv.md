---
target: all platforms (tv)
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-07-21T17-39-37Z
slug: all-platforms-tv
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Focus ring, counts, active badge and 'Reconnecting…' are strong; loading vocabulary is mixed (skeletons vs ad-hoc spinners). |
| 2 | Match Between System and Real World | 3 | Movies/Series/Live/Continue Watching read naturally; icon-only player settings and M3U/Xtream jargon leak through. |
| 3 | User Control and Freedom | 3 | Back/Cancel/close everywhere, delete confirm and zone escapes; no undo on favorite-remove (low stakes). |
| 4 | Consistency and Standards | 2 | History detail uses unicode glyphs vs Movies/Series' shared <Icon>; white Play button vs indigo system; raw-indigo vs indigo-text token. |
| 5 | Error Prevention | 3 | Delete confirm, required-field validation with clear copy, focus clamped into a valid model. |
| 6 | Recognition Rather Than Recall | 2 | Player settings row is icon-only and unlabeled; category search bar is hidden above the grid with no affordance to find it. |
| 7 | Flexibility and Efficiency | 3 | A–Z filter + search + dedicated transport keys + speed shortcuts; Live grid has no A–Z index and no jump-to-top. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, content-forward midnight; white button + unicode glyphs + indigo-at-rest overuse add avoidable noise. |
| 9 | Help Users Recover From Errors | 3 | StatePanel + retry + describeError; reconnect preserves last frame — genuinely good; some generic copy. |
| 10 | Help and Documentation | 2 | Inline seek hints on the player are excellent, but nothing teaches the hidden zone/search navigation elsewhere. |
| **Total** | | **27/40** | **Acceptable (top edge, borderline Good)** |

# Anti-Patterns Verdict

Credible and mostly on-brand — the midnight field, tonal ladder, cyan focus ring and single gradient hairline give it real identity — but a Netflix-white primary Play button and hand-typed unicode glyph buttons (▶/↺/♥/♡) in History betray the "not a generic streaming clone" thesis on the most-repeated controls. Verdict: NOT-SLOP-BUT-LEAKY.

**Detector:** The CLI detector returned 11 findings (2 broken-image warnings, 9 design-system-color advisories, exit 2), but after the four project exemptions ZERO are real: both broken-image hits land on JSDoc/comment lines that merely contain the token <img> (Hero.tv.jsx:5, VirtualShelves.tv.jsx:295), and all 9 color advisories are legitimate translucent scrims/gradients/tints confined to VideoPlayerScreen.tv.jsx — exactly the player overlays Assessment A had already sanctioned. B caught no issue A missed and contributed no counter-evidence to A's scores; the two assessments agree, and the entire real-issue set comes from A's design review (browser evidence was correctly skipped for the file:// TV surface).

# Cognitive Load

Moderate — 2 of 8 principles fail. Chunking/minimal-choices: the video player renders up to 8 controls in one row (VideoPlayerScreen.tv.jsx:488–551), 7 of them icon-only, at/over the working-memory ceiling. Working memory: the category/grid search bar is off-screen above the grid and only reachable by pressing Up into an invisible zone, so users must remember it exists. The 27-button A–Z bar is scored germane (a well-understood scannable index), not a failure. Passes: single focus, grouping, visual hierarchy, one-thing-at-a-time, progressive disclosure.

# What's Working

- Resilient playback presentation — on a network drop the busy overlay retains the last decoded frame and shows 'Reconnecting…' instead of a dead black spinner (VideoPlayerScreen.tv.jsx:444–480), with a StatePanel+retry fatal path (689–703). The product thesis made visible, and well-executed for a file:// TV engine.
- Disciplined single-focus model — every screen clears its poster ring the instant the navbar takes the remote via navActive gating (MoviesScreen.tv.jsx:580, SeriesScreen.tv.jsx:1036, VirtualShelves.tv.jsx:719–721) and applies the canonical focus treatment (tvl.css:564–586) consistently, reading cleanly at 10 feet.
- Windowed grids/shelves tuned for the real engine — PagedGrid.tv.jsx and VirtualShelves.tv.jsx anchor virtualization on deterministic D-pad focus (never async scroll reads), with skeleton posters and prefetch; platform-honest engineering that keeps the couch experience smooth.
- Detector corroboration — B's scan of the 11 TV files surfaced zero genuine design-system-color or broken-image issues after exemptions, confirming the palette discipline A observed: the 9 rgba flags all land on legitimate player scrims/gradients/tints that A had already sanctioned.

# Priority Issues

**[P1] White Play button breaks the Aurora token and reads as a streaming clone: .tvl-det-hero-btn--play is #fff / #000 (tvl.css:505–509), used as the primary action on Movies and History detail screens.**
- Why: DESIGN.md button-primary is Aurora Indigo (#6C5CE7) and the Single-Light rule reserves saturation for the two accents; a white primary on the most prominent, most-repeated CTA is off-system and directly hits the forbidden 'generic streaming clone' anti-reference. It is the single biggest identity leak and the exact control Morgan reaches for on every device.
- Fix: Repaint play/continue to Aurora Indigo fill (or the sanctioned indigo→cyan gradient for highest emphasis) with Ice text; keep the cyan ring for focus.
- Command: $impeccable colorize — src/styles/tvl.css:505

**[P2] History detail is a divergent re-implementation using unicode glyph buttons '▶/↺/♥/♡' (HistoryScreen.tv.jsx:516–519, 614–617) instead of the shared <Icon> used by MoviesScreen (494–497) and SeriesScreen (864–867).**
- Why: The same detail experience ships two icon systems and two code paths — the 'save' button literally looks different in two places, the exact consistency failure the product register bans, and divergence guarantees future drift.
- Fix: Extract a shared TV detail component (or at minimum swap glyphs for <Icon>) so History drills into the canonical Movies/Series detail.
- Command: $impeccable distill — src/screens/HistoryScreen.tv.jsx:504–731

**[P2] Video player settings are up to 8 unlabeled icons in one row (speed, audio, cc, aspect, brightness, contrast, quality, stats — VideoPlayerScreen.tv.jsx:488–551, 633–655); only speed carries a text label.**
- Why: Icon-only aspect/brightness/contrast/cc/quality fails Recognition-over-Recall for Jordan/Sam and sits over the working-memory ceiling; on a 10-foot screen with a remote, guessing a glyph's meaning is costly.
- Fix: Add short text labels under each icon (the TV type ramp runs larger), or collapse into a single labeled 'Settings' menu with named rows; cap the always-visible row at ~4.
- Command: $impeccable clarify — src/screens/VideoPlayerScreen.tv.jsx:633

**[P2] Small raw-indigo 'Continue from m:ss' text fails WCAG AA: fontSize 11 with color colors.accent (#6C5CE7) at SeriesScreen.tv.jsx:934 and HistoryScreen.tv.jsx:715.**
- Why: #6C5CE7 on #0A0E1A is ≈3.7:1, below the 4.5:1 the app itself treats as a hard bar for text this small; the codebase already has a text-safe --a-indigo-text (#A99BF5) used by .tvl-hist-type but not here, and the size isn't run through ss().
- Fix: Switch to the --a-indigo-text / indigoText token and bump to the TV meta size (≥ ss(13)).
- Command: $impeccable harden — src/screens/SeriesScreen.tv.jsx:934; src/screens/HistoryScreen.tv.jsx:715

**[P2] Indigo at rest dilutes the Single-Light 'active' signal: Aurora Indigo fills resting decorations — LIVE badge (LiveTVScreen.tv.css:83), episode E## badge and play glyph (SeriesScreen.tv.css:134,173), Continue-Watching progress bar (ContinueCard.tv.jsx:132).**
- Why: DESIGN's Single-Light rule says indigo marks the active path; when it appears on hundreds of resting elements, 'which one is active?' is no longer signaled by color.
- Fix: Move at-rest badges/glyphs onto the steel/slate ladder (--a-muted / --a-surface-2) and reserve indigo for the genuinely active/selected state; progress bars can stay as progress is arguably 'active'.
- Command: $impeccable colorize — src/screens/LiveTVScreen.tv.css:83; src/screens/SeriesScreen.tv.css:134,173

**[P3] Loading vocabulary is inconsistent and contradicts the StatePanel-only principle: shelves use SkeletonPoster but grid/detail drill-ins use ad-hoc <div className='tvl-spinner'/> + 'Loading movies…' (MoviesScreen.tv.jsx:558, SeriesScreen.tv.jsx:1003, LiveTVScreen.tv.jsx:409).**
- Why: DESIGN says every loading/error/empty state routes through StatePanel with no ad-hoc spinner elsewhere; two loading languages on one surface, and the register prefers skeletons over mid-content spinners.
- Fix: Route grid loads through StatePanel mode='loading' or a skeleton grid; retire the inline spinners.
- Command: $impeccable polish — src/screens/MoviesScreen.tv.jsx:558

# Persona Red Flags

- **Sam (accessibility / focus-dependent):** Sharpest failures here: 'Continue from' resume text is 11px raw indigo at ≈3.7:1, failing AA (SeriesScreen.tv.jsx:934, HistoryScreen.tv.jsx:715); player transport/settings meaning is conveyed by icon + color alone (cyan ring + unlabeled aspect/brightness/contrast) with no text or announced state; and the player's inline spin keyframe (VideoPlayerScreen.tv.jsx:707) has no prefers-reduced-motion guard, unlike .tvl-spin (tvl.css:190) which does — reduced-motion honored inconsistently.
- **Alex (power user / remote efficiency):** Live TV grid (potentially thousands of channels) has search only, no A–Z index and no jump-to-top, unlike Movies/Series — long D-pad journeys; the category/grid search is hidden above the grid with no hint that Up reveals it, so the fast path is undiscoverable; no favorite/bulk shortcuts, every add-to-list is a drill-in.
- **Morgan (cross-device continuity viewer):** Continuity signals are good (Continue Watching shelf, 'Continue S2E05', 'Xm left') but nothing reassures the state came from another device — the headline 'pick up where you left off from your phone' promise is delivered silently; and the white Play/Continue button (P1) is the most visible place the TV drifts off the phone/desktop indigo system, quietly undermining the 'same experience everywhere' claim.

# Minor Observations

- The 'TV Layout: Shelves/Grid' toggle is buried as a synthetic row inside the Accounts list (AccountsScreen.tv.jsx:460–481) — a display setting living in account management is a mild match-real-world mismatch.
- Empty search results are bare ('No results', MoviesScreen.tv.jsx:567); the register prefers empty states that teach the next action.
- The .tvl-shelf-* classes in HistoryScreen.tv.css:124–150 appear dead now that Home renders through VirtualShelvesTV — stale CSS.
- tvl.css relies on var() throughout but claims to be 'var()-free-at-build' via patch-index inlining (comment at line 30); this build-time dependency deserves a test guard — if inlining regresses, the whole TV palette silently falls back to the Chromium floor.
- Hero.tv title uses a raw letterSpacing:-1 and ss(64) outside the tokenized ramp — visually fine but drifts from the --a-fs-hero token.
- Detector cross-check: B flagged Hero.tv.jsx:5 and VirtualShelves.tv.jsx:295 as broken-image, but both are JSDoc/comment lines mentioning the word <img>, not real elements — confirmed false positives, no action.

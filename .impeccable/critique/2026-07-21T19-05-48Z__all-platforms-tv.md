---
target: all platforms (tv)
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-07-21T19-05-48Z
slug: all-platforms-tv
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | StatePanel + spinner + Reconnecting overlay + topbar counts + focus ring are strong; a brief unlabeled state while detail info loads |
| 2 | Match System / Real World | 3 | Natural copy (Continue Watching, My List); the TV Layout Shelves/Grid toggle reads slightly techy |
| 3 | User Control & Freedom | 3 | Careful Back-levels and Cancel/Escape everywhere; no undo for My-List removal (low stakes) |
| 4 | Consistency & Standards | 2 | History detail action-row navigated vertically vs Movies horizontally; two D-pad wirings; dead .tv-* focus sheet alongside live .tvl-* |
| 5 | Error Prevention | 2 | Delete-account confirm dialog defaults focus to the destructive Delete button |
| 6 | Recognition Rather Than Recall | 3 | Icons labeled, search/filter visible; the multi-zone browse model leans on the moving ring to answer where am I |
| 7 | Flexibility & Efficiency | 3 | Search + alpha jump + resume + channel-zap, but the 27-key letter bar does not wrap or page-jump |
| 8 | Aesthetic & Minimalist | 3 | Content-first and cohesive; the 900-weight detail title overshoots the Aurora 700 ramp |
| 9 | Help Users Recover from Errors | 3 | Real describeError messages + onRetry + fatal-with-Close; a few generic fallbacks remain |
| 10 | Help & Documentation | 2 | Inline seek hints on the player are good; no first-run or zone-model guidance elsewhere |
| **Total** | | **27/40** | **Acceptable (upper edge, borderline Good — consistency and error-prevention are the drag)** |

# Anti-Patterns Verdict

Not slop. A canonical `.tvl-*` vocabulary, one reused focus treatment, StatePanel as the sole state surface, and load-bearing constraint comments show the design was reasoned, not generated. The detector independently confirms this: after exemptions, zero real drift. Verdict: genuine product-register work.

**Detector:** The CLI detector returned 11 findings on 11 TV .jsx files (2 broken-image warnings, 9 design-system-color advisories); after applying documented exemptions, 0 are real — both warnings hit the string <img> inside JSDoc/comment prose (Hero.tv.jsx:5, VirtualShelves.tv.jsx:295), and all 9 advisories are legitimate translucent player scrims/overlays in VideoPlayerScreen.tv.jsx. B independently corroborates A's not-slop verdict and adds no actionable signal; every P1-P3 issue below comes from A's source-read review, which the detector's file-level color scan could not see.

# Cognitive Load

Moderate: two-to-three failures concentrated in two spots. The player settings row places up to 8 equal-weight icon controls in one horizontal D-pad traverse (Stats is 7 Right-presses away), sitting at the overload boundary. The browse surface stacks 4 D-pad zones (back to search to filter to grid) whose only signal is the moving ring, and the same-looking detail action row is driven by different axes depending on entry screen — a working-memory tax. Single-focus, chunking, grouping, visual hierarchy, and progressive disclosure all pass; the shelf/grid/detail decomposition is clean and content-led. The detector found no cognitive-load-relevant defects, so this is A's signal alone.

# What's Working

- Silent, felt playback recovery (VideoPlayerScreen.tv.jsx:439-482): a light scrim + Reconnecting over the retained last frame on the hardware overlay plane instead of blanking to a spinner — a textbook execution of the product's resilience promise and the best moment in the surface.
- One canonical focus treatment, focus-not-hover (tvl.css:564-586 + tvResponsiveScaling.css:48-64): a 4-5px cyan ring + tonal fill, width tracking scale, applied instantly, with Single-Light discipline (indigo = active/primary, cyan = focus only).
- StatePanel everywhere with tailored real messages (LiveTVScreen.tv.jsx:411-426): distinguishes failed (retry) vs empty-category vs no-search-results with different icons/copy via describeError — no ad-hoc spinners or dead ends.
- Detector corroboration: across 11 scanned TV .jsx files the CLI surfaced 0 actionable findings after exemptions, and the 9 rgba advisories were all legitimate player scrims/overlays — evidence the color discipline holds even where the linter cannot see the intent.

# Priority Issues

**[P1] History-opened movie/series detail navigates its horizontal .tvl-det-hero-btns row with Up/Down, with Left=close and Right=no-op (HistoryScreen.tv.jsx:303-312); the identical row opened from Movies uses Left/Right (MoviesScreen.tv.jsx:366-379).**
- Why: The buttons render in a visual horizontal flex row, so Up/Down contradicts the layout and a user who learned Movies presses Right on History and nothing happens — reads as broken. Morgan (cross-device) hits this exact screen resuming from history.
- Fix: Make History's movie/series detail use the same Left/Right horizontal model as Movies; ideally extract one shared detail component so the two axes cannot diverge by entry point.
- Command: $impeccable harden — src/screens/HistoryScreen.tv.jsx:274-334

**[P2] Delete-account confirm dialog defaults focus to the destructive Delete button: confirmFocus initializes to 1 and the view-change effect re-sets it to 1 (AccountsScreen.tv.jsx:46, 238-242).**
- Why: On a remote, Enter is the most-pressed key; a reflexive Enter deletes the account. The safe default must be Cancel.
- Fix: Default confirmFocus to 0 (Cancel).
- Command: $impeccable harden — src/screens/AccountsScreen.tv.jsx:46

**[P2] Player settings row lays up to 8 equal-weight icon-menus (Speed, Audio, Subtitles, Aspect, Brightness, Contrast, Quality, Stats) in a single Left/Right traverse; Stats is 7 presses away (VideoPlayerScreen.tv.jsx:490-561).**
- Why: Cognitive-load ceiling and slow for the D-pad power user (Alex); all controls read as equally important.
- Fix: Lead with the two most-used for the context (Subtitles, Quality) and fold Brightness/Contrast/Stats into a More sub-menu, or split into two rows.
- Command: $impeccable layout — src/screens/VideoPlayerScreen.tv.jsx:642-666

**[P2] Dead/duplicate focus stylesheet shipped to every screen: tvRemoteFocus.css styles .tv-focus/.tv-focused on components (.tv-history-item, .tv-episode, .tv-pill, .tv-season-btn) the reviewed screens never render — they use .tvl-*--on.**
- Why: Two focus vocabularies confuse maintainers and ship inert !important rules; a future dev may fix focus in the wrong file.
- Fix: Confirm no live FocusManager still emits .tv-focus, then delete the sheet (or dead selectors), or migrate real components onto it — pick one system.
- Command: $impeccable distill — src/styles/tvRemoteFocus.css:1-61

**[P3] Detail/hero title weight overshoots the type ramp: .tvl-det-hero-title { font-weight: 900 } vs Aurora Display Space Grotesk 700 (Hero.tv.jsx uses fontWeights.bold).**
- Why: Faux-bold if the 900 cut is not in the loaded face — a subtle quality tell on the most prominent text. This is the one genuine slop tell A found; the detector did not fire on it (no font-slop hit in the scanned set).
- Fix: Set to 700 and rely on size for hierarchy.
- Command: $impeccable typeset — src/styles/tvl.css:459-465

# Persona Red Flags

- **Alex (power / D-pad efficiency):** Toggling Stats needs 7 Right presses across the player settings row (VideoPlayerScreen.tv.jsx:490), no remote shortcut (only keyboard i). On History movie detail, the Movies-reflex Right does nothing and Left unexpectedly closes the detail (HistoryScreen.tv.jsx:303). The alpha filter does not wrap — ALL to T is ~20 Right presses, clamped at both ends (MoviesScreen.tv.jsx:219).
- **Sam (focus visibility / AA):** Focus ring is excellent, but .tvl-det-hero-btn--on overwrites the indigo Play fill with translucent cyan focus-fill (tvl.css:582-585), so the primary action loses its color identity exactly when selected. Custom role=button divs (ShelfCard.tv.jsx, episode/season rows) are not natively focusable — they rely on the global keydown router, so a screen-reader/linear-tab user gets non-operable widgets (low priority on TV, real gap for Sam).
- **Morgan (cross-device continuity):** Continuity is largely delivered (Continue-Watching shelf, resume position, Start over, My-List sync). Red flag: History filters out live items (histItems = watchHistory.filter(h => h.type !== 'live'), HistoryScreen.tv.jsx:82), so a live channel left playing on phone never surfaces to resume on TV; combined with cross-account gating, synced My-List items may refuse to play with no on-screen explanation.

# Minor Observations

- DESIGN.md's Literal-Hex Sync Rule forbids var() in shared TV CSS, yet tvl.css and screen sheets use var() throughout — reconciled by comments (patch-index inlines; real Chromium floor is 71+ which supports custom properties). Not a defect, but DESIGN.md is now stale/self-contradictory and should be updated so a future dev does not fix working CSS.
- Same drift for the No transforms/gradients rule: spinner keyframes, .tvl-shelf-chev--left scaleX(-1), ContinueCard.tv.jsx translate glyph, and inline scrim gradients all use them. All safe on the 71+ floor — just rule-vs-reality drift.
- Two D-pad architectures: Movies uses useTVInput().register; History/Series/LiveTV/Accounts hand-roll a raw keydown listener with literal keyCodes. Not user-facing, but the likely root of the P1 detail-nav divergence and a standing maintenance tax.
- Empty-state copy names two locations for one action: LiveTVScreen says Open Accounts to add your media service vs Movies/Series Add your media service from Settings. Pick one.
- .tvl-letter-btn carries transition: none explicitly (MoviesScreen.tv.css:143) — harmless leftover that signals a copied web rule.
- Detector's 9 design-system-color advisories were all translucent rgba(0,0,0,x)/rgba(255,255,255,x) in VideoPlayerScreen overlay/scrim code — correctly exempt as player chrome, not palette drift; noted here only so a future contributor does not chase them.

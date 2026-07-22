---
target: video player (all platforms)
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-07-22T11-37-17Z
slug: video-player-all-platforms
---
# Suvo Video Player — Cross-Platform Design Critique

Method: workflow, 10 isolated agents (4 design reviews + consistency + ban scan), all priority findings adversarially re-verified against source. No findings refuted; 4 severity-corrected.

## Scores
- Web/Electron 33/40 (Good) · Native-expo 27/40 · Native-VLC 27/40 · TV 27/40 (Acceptable) · Cross-platform parity 6/10 (Diverging)
- Web is the reference implementation; the three lean-back/touch surfaces trail it, each differently.

## Anti-patterns
- Not AI-generated (all 4 reviewers agree). Hand-built, domain-dense, honest engine-limit comments, calm failure copy.
- Detector: 7 advisory undocumented-color hits only (HTML detector near-blind to RN StyleSheet). Real hits: zIndex:9999 on web:30 + tv:32 (bypass semantic scale); 6 idiomatic exhaustive-deps suppressions.
- Register tell: uppercase tracked eyebrow repeats on every web settings-popover section (web:276-284).

## Priority issues
- [P1 parity] Fatal-error copy calm only on web; TV(741)/expo(811)/VLC(569) headline terse "Failed to load stream". Lift shared FATAL_HEADLINE.
- [P1 parity] Two native engines (expo vs VLC) offer different feature sets (VLC lacks stats/PiP/subtitle-tuning/live-EPG/buffered-bar); engine choice invisible. Factor a shared native surface.
- [P1 TV] "Start over" (tv:635) unreachable by D-pad (tabIndex=-1, onClick only, outside tvNavReduce). "Next SxxExx" (tv:645) dead same way (P2).
- [P2 expo] Icon-soup control row (expo:886) — up to 9 unlabeled glyphs, cog-load high; PiP orphans to 2nd line. Split into primary + labeled "More" sheet.
- [P2 web] Esc exits whole player instead of closing open menu (web:571); no keyboard menu-dismiss.
- [P2 web+native] Contrast: muted #7A86A8 on surface2 #1B2236 = 4.36:1 (<4.5); native muted timestamps ~2.4:1 over bright frames. Swap to textDim #B8C0DA.
- [P2 web] Spinner no prefers-reduced-motion (web:709); raw menu buttons no focus ring (946/862/1146).
- [P2 parity] Brightness = CSS filter on web/TV vs device backlight on native; contrast absent on native; aspect labeled-menu vs unlabeled 3-cycle; sleep timer missing on TV; live channel-change no pointer affordance on web.

## Persona red flags
- Sam: TV Start-over inoperable by remote; TV reconnect not announced; web menu no focus ring; native controls unmount on 4s timer destroying SR focus.
- Casey: VLC no center transport (pause buried); native swipes no affordance; 9-glyph row.
- Riley: VLC play/pause bypasses driver (606) — reconnect can un-pause; genuine reconnect blanks to black.
- Alex: all gesture efficiencies undiscoverable (native Help/docs 1/40).

## Minor
- zIndex 9999 (web/tv) should use token scale; duplicate "Ch" buttons; brightness note misfiled in sleep modal; TV close=back-arrow vs X elsewhere; spinner indigo(native) vs cyan(web/tv); TV double-Up-to-settings + live hint mismatch.

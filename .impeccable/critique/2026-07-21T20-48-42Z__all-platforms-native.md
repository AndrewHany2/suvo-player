---
target: all platforms native
total_score: 26
p0_count: 0
p1_count: 1
timestamp: 2026-07-21T20-48-42Z
slug: all-platforms-native
---
Method: dual-agent (A: adbc8781 design-review · B: ab6ff540 detector)

## Design Health Score — native (iOS/Android)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | StatePanel + reconnect scrim + progress; no live buffering/bitrate feedback |
| 2 | Match System / Real World | 3 | Clear vocabulary, no jargon |
| 3 | User Control and Freedom | 3 | Back/Cancel/Resume-vs-Start everywhere, double-confirm delete |
| 4 | Consistency and Standards | 2 | Cyan (focus-only) at rest on ContentShelf icon/chevron, Auth logo, Accounts icons; hover color inconsistent (pills cyan vs favorite indigo); hero 420 vs token |
| 5 | Error Prevention | 3 | Field validation, verifyCredentials before switch, delete confirm |
| 6 | Recognition Rather Than Recall | 2 | Player bottom bar 9+ icon-only buttons in horizontal scroll; gesture layer invisible |
| 7 | Flexibility and Efficiency | 3 | Deep: speed, tracks, aspect, PiP, sleep, zap, offline |
| 8 | Aesthetic and Minimalist | 3 | Clean, but player strip cluttered + Movies≈Series + hard black hero band |
| 9 | Error Recovery | 3 | GONE/AUTH_EXPIRED humanized + Retry; auth errors differentiated |
| 10 | Help and Documentation | 1 | None — gesture language + off-screen controls unexplained |
| **Total** | | **26/40** | **Acceptable–Good (converging)** |

## Anti-Patterns Verdict
**Not AI slop.** The resilient player (gesture axes, resume gating, adjustable seek bar, reduced-motion, translucent busy scrim) is unmistakably hand-built. Detector: exit 2, 57 findings — 34 design-system-color (bulk are legit rgba scrims over player controls/backdrops + literal-hex TV CSS that got swept in), 12 font-size + 9 radius (advisory, mostly .tv.css), 2 broken-image = FALSE POSITIVES (regex matched `<img>` inside JSDoc). Real signal near-zero. No browser (source+CLI only).

## What's Working
- The resilient player is the standout — gesture axes, resume gating, sleep timer, PiP, zap, and a real a11y story (`accessibilityRole="adjustable"` seek + increment/decrement actions), reduced-motion honored, busy scrim preserves last frame.
- Token + a11y discipline across shared components: StatePanel unifies states with role=status/alert, near-zero hardcoded hex, 44px targets, accessibilityRole/label/state on essentially every Pressable.
- Offline handling: Movies/Series auto-surface downloads with an explanatory banner when the device goes offline.

## Priority Issues
- **[P1] TV D-pad focus bleeds onto touch** — useTVNavigation defaults focusedRow/Col=0, so HistoryScreen.native + ProfilesScreen paint a permanent cyan ring on the first card at rest (reads as "selected", violates Single-Light). Fix: initialize focus to -1 when !isWeb, or gate the `focused` prop on isWeb/isTV. Files: src/hooks/useTVNavigation.js, HistoryScreen.native.jsx, ProfilesScreen.jsx.
- **[P2] Cyan at rest (Single-Light violation)** — ContentShelf.native leadingIcon+chevron (L83,87), AuthScreen logo (L151), AccountsScreen settings icon (L263). Move to muted (steel) or accent for genuinely-active; reserve cyan for focus/hover.
- **[P2] Player control strip density** — 9+ equal-weight icon-only secondary buttons in a horizontal ScrollView; controls past the edge are hidden with no affordance. Keep 3-4 primary visible, collapse rest into a "More" sheet. File: ExpoVideoPlayerScreen.native.jsx L876-895.
- **[P2] No help/onboarding/gesture discoverability** — swipe-vol/brightness, double-tap seek, long-press 2x are invisible; Nielsen #10 = 1. Add a one-time dismissible gesture hint + a "?" affordance.
- **[P3] Movies≈Series near-duplicate** — ~95% identical, drift already started (Downloaded pill pressStyle in Series not Movies). Extract shared shell + a per-tab differentiator.
- **[P3] Detail hero hard black band** — GradientOverlay is a solid rgba(0,0,0,0.82) block from 45% (not a gradient); scrim.native + heroHeights.native exist unused.

## Persona Red Flags
- **Sam (a11y):** entire gesture layer invisible/unreachable via VoiceOver/TalkBack; no assistive way to change volume/brightness; emoji-avatar buttons announce "Avatar 🎬".
- **Jordan (first-timer):** Movies/Series indistinguishable; player gives no cue gestures or off-screen controls exist.
- **Casey (distracted mobile):** controls auto-hide after 4s, essentials hide off the scroll edge, permanent cyan ring reads as accidental selection.

## Minor Observations
- Movies/Series map `idx` unused; LiveTV LIVE badge is indigo dot + accentText at rest (borderline); MovieDetail age badge indigo border+text at rest (L115); PosterCard.native isFocused prop never passed by ContentShelf (dead on touch); player close button is the only always-on indigo; Accounts "Connect" uses a play glyph (odd metaphor).

## Questions
- Should Movies and Series be one parameterized component — and does a user perceive them as two places?
- Is anyone finding PiP/stats/sleep behind the horizontal scroll + hidden gesture layer on a 5-inch screen?
- Is the permanent cyan ring on the first History/Profiles card shipping to real touch devices today?
- If cyan is the single focus signal, why spend it on resting chevrons/logo/settings icons?

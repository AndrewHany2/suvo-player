---
target: all platforms tv
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-07-21T20-48-42Z
slug: all-platforms-tv
---
Method: dual-agent (A: aa9e468c design-review · B: a7027c86 detector)

## Design Health Score — TV (webOS/Tizen)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons, spinner, busy overlay, progress, badges; no buffering %, no detail-zone breadcrumb |
| 2 | Match System / Real World | 3 | Netflix-style shelves; terminology drift: "IPTV account" / "media service" / Settings-vs-Accounts across 3 empty states |
| 3 | User Control and Freedom | 3 | Auto-resume + Start-over, safe sleep timer, single-level Back; detail Left-on-first-action no-op inconsistency |
| 4 | Consistency and Standards | 2 | Player uses INDIGO focus fill while every other screen uses CYAN; LiveTV back = rotated chevron vs "back" glyph; player progress cyan vs card resume indigo |
| 5 | Error Prevention | 2 | Delete-confirm dialog DEFAULTS focus to destructive "Delete" (confirmFocus=1) — reflexive OK = data loss |
| 6 | Recognition Rather Than Recall | 3 | Search + A–Z jump + icon+label chips; advanced player keys ([ ] speed, i stats) invisible |
| 7 | Flexibility and Efficiency | 3 | Zap on Up/Down, quality/audio/subs/aspect/brightness/contrast, layout toggle, composed filters |
| 8 | Aesthetic and Minimalist | 3 | Clean poster-forward theater; 8-chip settings row verbose + dense detail stack |
| 9 | Error Recovery | 3 | describeError() + Retry, fetch-fail vs empty distinguished; generic-fallback-heavy |
| 10 | Help and Documentation | 1 | None — no onboarding, no account-field guidance; hardest task (URL via on-screen keyboard) least supported |
| **Total** | | **26/40** | **Acceptable–Good (converging)** |

## Anti-Patterns Verdict
**Not AI slop.** Unmistakable hardware-aware engineering: `@supports not (aspect-ratio)` ratio-box fallback for the 38–53 Chromium floor, focus-anchored windowing vs webOS scroll-freeze, literal-hex + build-time var() inlining, one canonical 4px cyan ring focus (no shadow/transform). Bans respected (player menu is near-opaque, not glass; no EPG grid; no tracked eyebrow). Detector: exit 2, 71 findings — 35 color (legit scrims + intentional literal-hex #fff/#000), 22 font-size + 11 radius (advisory, hand-tuned 10-foot ramp), 2 broken-image + 1 overused-font (Inter) = FALSE POSITIVES. Many findings are non-TV variants swept in under src/screens. No browser (static analyzer).

## What's Working
- Rigorous single-source focus system: one canonical 4px cyan ring + tinted fill, scale-tracked, zero shadow/transform to protect old webOS, literal-hex inlined at build so the ~71 Chromium floor never hits an unsupported var() in a shorthand.
- Hardware-aware engineering a template never produces: the aspect-ratio fallback, focus-anchored windowing vs the documented scroll-freeze, poster prefetch + fade-in, skeleton posters.
- Content-first 10-foot register that avoids the anti-references: poster shelves + hero billboard (no EPG grid), success-green LIVE badges, no ad/power-user density.

## Priority Issues
- **[P1] Player settings strip over-dense** — up to 8 chips each rendering name + current value ("Speed · 1x", "Brightness · 100%") wrapping in one row, traversed one D-pad hop at a time. Drop inline value from resting chip (show in open menu), group (one "Audio & Subtitles", one "Picture"), cap resting row to ~4. File: VideoPlayerScreen.tv.jsx L141-561, L643-666.
- **[P1] Player focus fill is INDIGO, not cyan** — settings icons use accentAlpha(0.25) / open-menu accentAlpha(0.3) while every other screen uses cyan rgba(34,211,238,0.20). Focus is spoken in two colors across one product. Switch to accent2Alpha. File: VideoPlayerScreen.tv.jsx L149-187.
- **[P2] Cyan leaks into resting active/selected** — "Active" account badge (tvl-acc-badge), settings-menu selected text+check, watched-episode check, player NOW/NEXT are all cyan at rest. Recolor to indigo/accentText; reserve cyan for focus. Files: AccountsScreen.tv.css L50-58, VideoPlayerScreen.tv.jsx, SeriesScreen/HistoryScreen.tv.jsx.
- **[P2] No help/onboarding on account flow** — Host*/Username*/Playlist URL* with placeholders but no explanation or support link; the hardest interaction (URL via remote keyboard) is least supported. Add per-field helper + "Need help?" footer; unify empty-state terms. File: AccountsScreen.tv.jsx L328-417.
- **[P2] Delete-confirm defaults to destructive** — confirmFocus initial = 1 = "Delete". On a remote, OK is reflexive → data loss. Initialize to 0 (Cancel). File: AccountsScreen.tv.jsx L45/L71/L240.
- **[P3] Player transport lacks assistive semantics** — seek is a plain `<div>` onClick (no role=slider/aria-value*), close button tabIndex=-1. webOS/Tizen ship Voice Guidance — this is cheap to unlock. File: VideoPlayerScreen.tv.jsx L123-135, L594, L668-687.

## Persona Red Flags
- **Jordan (first-timer):** faces the hardest task (Host/URL/creds via on-screen keyboard) with zero help + three different names for "the account", high odds of stalling.
- **Sam (a11y):** custom-div transport, no slider role/aria-value, tabIndex=-1 close → Voice Guidance announces nothing; focus/active distinction carried purely by cyan-vs-indigo hue; muted #7A86A8 on surface #141A2E ~4.3:1, under AA for <18px.
- **Remote / lean-back viewer:** D-pad through 8 verbose chips to reach Quality/Stats, hold a multi-zone detail state machine with no breadcrumb, risks deleting an account via the pre-selected Delete.

## Minor Observations
- Movies/Series browse grids visually identical (flirts with identical-grid ban — a series episode-count chip would help wayfinding); seek hint crams 3 affordances into one line + omits advanced keys; player progress cyan vs card resume indigo; ghost hero buttons a hair low-contrast over backdrop bleed; generic error fallbacks repeat; floating poster thumb margin-top:-70px — verify no topbar collision at smallest panel height.

## Questions
- Must all engine capabilities be one D-pad hop away, or can they nest behind grouped entry points? That decides whether player density is fixable or intrinsic.
- Cyan appears at rest in ≥4 places — is the team treating cyan as a de-facto "selected" accent? If so, amend the Single-Light Rule rather than the code, so intent and implementation agree.
- Given webOS/Tizen ship screen readers, is a11y in scope for TV, or is D-pad-only the accepted contract? (Decides whether transport-semantics is P2 or out-of-scope.)
- Is there any first-run path on TV today, or does every new user land in an empty screen and discover Accounts unaided?
- Delete-confirm defaulting to Delete — deliberate power-user speed, or oversight?

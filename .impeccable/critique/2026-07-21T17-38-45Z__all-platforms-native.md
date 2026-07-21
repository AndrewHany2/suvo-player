---
target: all platforms (native)
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-07-21T17-38-45Z
slug: all-platforms-native
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Strong StatePanel/reconnecting scrim/sync spinner, but fake HD badge + static live progress bar misrepresent real status |
| 2 | Match Between System and Real World | 3 | Natural copy ("Who's watching?", "Continue") but player toolbar is icon-only jargon (tune/aspect/cc/pip) |
| 3 | User Control and Freedom | 3 | Back/Cancel/Retry, resume-vs-start-over, sleep cancel, two-tap delete undo all present |
| 4 | Consistency and Standards | 2 | Two player engines diverge; white CTA vs indigo Button; unicode glyphs mixed with Icon set; detector confirms hardcoded #fff/#000 breaking the token system |
| 5 | Error Prevention | 3 | Field validation, confirm dialogs, resume gating, inline two-tap delete confirm |
| 6 | Recognition Rather Than Recall | 2 | 9 icon-only player buttons with no labels; seek/volume/brightness/2x are gesture-only and undiscoverable |
| 7 | Flexibility and Efficiency of Use | 3 | Rich: gestures, per-stream prefs, sleep timer, PiP, downloads — strong for the medium |
| 8 | Aesthetic and Minimalist Design | 2 | Fake decorative progress/HD/'now playing', 9-icon toolbar, resting indigo-tinted discover pills |
| 9 | Help Users Recognize/Recover From Errors | 3 | Auth errors plain+specific+retry, fatal playback distinguishes GONE/AUTH_EXPIRED; VLC omits AUTH_EXPIRED copy, success uses OS Alert |
| 10 | Help and Documentation | 1 | No onboarding, no gesture hints, no tooltips, no help entry anywhere |
| **Total** | | **25/40** | **Acceptable** |

# Anti-Patterns Verdict

Mixed. The task chrome (Auth, Accounts, Profiles, StatePanel routing) is genuinely on-brand and trustworthy, but the content Detail hero — the exact press-play moment — renders the primary CTA as a generic white Netflix button, and this is the one place both the design review and the color detector land on the same defect independently. Verdict: on-brand everywhere except the emotional peak, which reads as streaming-clone slop.

**Detector:** The CLI detector returned 17 findings (exit 2), all advisory design-system-color hits and zero warnings/structural/typographic/spacing issues; after exempting 15 legitimate translucent scrim/overlay colors (player rgba(0,0,0,0.6) controls, unfilled-scrubber whites, and the hero GradientOverlay rgba(0,0,0,0.82)), only 2 are real drift — the hardcoded #fff/#000 primary CTA in MovieDetail.jsx:124/135, which independently confirms design review A's loudest slop signal. The detector is color-only, so it is silent on every accessibility, fake-data, cognitive-overload, and touch-target issue A raised.

# Cognitive Load

Moderate overall (~2-3 of 8 checklist items fail), spiking to high inside the player. Failures: minimal-choices (up to 9 icon-only actions in one horizontal scroll at ExpoVideoPlayerScreen.native.jsx:861-877, well past the ~4-item working-memory limit) and recognition-over-recall (seek/volume/brightness/2x boost exist only as undiscoverable gestures). Partial fail on visual hierarchy: the white Detail button out-shouts everything but in the wrong color, and fake live progress bars compete with real channel names. Passing: single focus per screen, shelf chunking, tokenized-card grouping, episodes behind progressive disclosure.

# What's Working

- StatePanel is honored as the single state surface — every browse screen routes loading/empty/error through it with teaching copy (MoviesScreen:37-64, HistoryScreen:136-161), no ad-hoc spinners. The detector corroborates this discipline: HistoryScreen, MoviesScreen, SeriesScreen, and 10 other files returned ZERO color findings.
- Error copy is best-in-class for the register (AuthScreen.jsx:52-71): distinguishes network / rate-limit / unconfirmed / bad-credentials into calm, actionable sentences — exactly the reassuring voice PRODUCT.md asks for.
- Playback recovery UX (ExpoVideoPlayerScreen.native.jsx:764-804): translucent 'Reconnecting…' scrim over the retained last frame plus cause-specific fatal messaging delivers 'resilience is felt, not announced' concretely.
- Color hygiene is broadly clean — after exempting legitimate scrims, the detector found only ONE genuinely drifting color pattern across 18 files, confirming the token system is applied nearly everywhere the review praised it.

# Priority Issues

**[P1] Primary Play/Continue CTA is white (#fff fill, #000 text), not Aurora Indigo — the single strongest slop signal, and the ONLY defect both assessments independently flag.**
- Why: Violates the Single-Light Rule and the 'no generic streaming clone' anti-reference on the one screen a viewer sees before every play. Design review A calls it the loudest AI-slop tell; detector B, after exempting 15 scrim colors, reports this exact hardcoded #fff/#000 as its only real residual signal — a rare cross-method agreement.
- Fix: Make primary = Aurora Indigo #6C5CE7 fill (or the #6C5CE7→#22D3EE accent gradient) with Ice text; secondary/From-Start on an elevated surface with a hairline. Reuse the shared Button variant="primary" and pull the color from tokens (the same component already reads colors.text/border/muted), not a literal.
- Command: $impeccable colorize → $impeccable polish — /Users/andrewhany/personal/iptv-player/src/components/MovieDetail.jsx (buttons at :121/:129, literals at :124/:135), /Users/andrewhany/personal/iptv-player/src/components/SeriesDetail.jsx (:205/:213)

**[P1] No accessibility roles/labels on any custom Pressable — play, favorite, remove-X, poster cards, and all 9 player controls are bare onPress with no accessibilityRole/accessibilityLabel.**
- Why: Sam (screen reader) cannot identify or operate the app; icon-only player buttons announce nothing. Fails WCAG 2.1 AA operability, a hard bar in PRODUCT.md. Detector B is color-only and structurally blind to this — a clear case where the design review caught what the detector cannot see.
- Fix: Add accessibilityRole="button" + descriptive labels to every onPress surface; label the icon-only player buttons ('Audio track', 'Subtitles', 'Aspect ratio'…). AccountsScreen already models this (aria-label at :302/:304).
- Command: $impeccable harden — /Users/andrewhany/personal/iptv-player/src/components/MovieDetail.jsx:121, /Users/andrewhany/personal/iptv-player/src/screens/HistoryScreen.native.jsx:40/48, /Users/andrewhany/personal/iptv-player/src/screens/ExpoVideoPlayerScreen.native.jsx:811/821/863-877

**[P1] Player control bar is a 9-icon wall with invisible gestures — up to 9 unlabeled icon buttons in one horizontal scroll; all transport nuance (seek/volume/brightness/2x) is gesture-only.**
- Why: Jordan and Sam cannot parse it and Casey mis-taps tiny targets; recognition-vs-recall plus cognitive-overload failure. Detector B did not surface this (not a color issue) — design-review-only signal.
- Fix: Group secondary controls under one 'More' sheet (keep play/pause, seek, cc, fullscreen primary); add a first-run gesture hint; add labels.
- Command: $impeccable distill → $impeccable clarify — /Users/andrewhany/personal/iptv-player/src/screens/ExpoVideoPlayerScreen.native.jsx:861-877

**[P2] Fake/decorative data undermines trust — always-on 'HD' badge on every My-List poster, static 35% progress bar + 'Live · now playing' on every live card, 15% phantom progress when duration is unknown.**
- Why: Riley immediately spots UI that 'appears to work but is fake'; it cheapens the premium promise and confuses real resume state, eroding Morgan's continuity trust. Detector B is blind to fabricated data (values are on-palette) — review-only signal.
- Fix: Drop the badges/bars unless backed by real stream/EPG data.
- Command: $impeccable distill — /Users/andrewhany/personal/iptv-player/src/screens/HistoryScreen.native.jsx:46/60, /Users/andrewhany/personal/iptv-player/src/screens/LiveTVScreen.native.jsx:72-75

**[P2] The two player engines are visibly different products — VlcPlayerScreen lacks the center transport, stats overlay, subtitle-tuning panel, PiP, fullscreen nav-hide, EPG now/next, live zap, and AUTH_EXPIRED fatal copy that ExpoVideoPlayerScreen has.**
- Why: Whether a viewer gets the full control set depends on the file's codec (mkv/avi → VLC), an invisible arbitrary inconsistency (Heuristic 4). Detector B lightly corroborates the divergence: rgba(0,0,0,0.6) scrims appear in BOTH player files (exempt) but the AUTH_EXPIRED copy gap is structural, not color.
- Fix: Extract a shared controls layer both engines render; at minimum unify transport button placement and fatal-error copy.
- Command: $impeccable shape → $impeccable polish — /Users/andrewhany/personal/iptv-player/src/screens/VlcPlayerScreen.native.jsx, /Users/andrewhany/personal/iptv-player/src/screens/ExpoVideoPlayerScreen.native.jsx

**[P2] Faint Steel (#4A5575) used for meaningful text — 'Live · now playing' at 10px and 'No channels found' at 15px, both content the user needs.**
- Why: Fails WCAG AA body contrast; DESIGN.md restricts Faint Steel to placeholder/disabled only. Detector B did NOT flag these (the value #4A5575 is a legitimate token, so no color-drift violation) — a case where the review's semantic-misuse judgment goes beyond the detector's is-it-in-the-palette check.
- Fix: Move to colors.muted (#7A86A8) or route the empty case through StatePanel.
- Command: $impeccable colorize / $impeccable harden — /Users/andrewhany/personal/iptv-player/src/screens/LiveTVScreen.native.jsx:75/257

**[P3] Sub-44px touch targets — Detail CTAs minHeight 36, player close 34×34, live-card favorite ~32px effective (16px glyph + hitSlop 8).**
- Why: Casey mis-taps one-handed; violates the ≥44×44 bar. Not a color issue, so detector-invisible.
- Fix: Raise to 44 min height / expand hitSlop.
- Command: $impeccable harden — /Users/andrewhany/personal/iptv-player/src/components/MovieDetail.jsx:121/124/129, /Users/andrewhany/personal/iptv-player/src/screens/ExpoVideoPlayerScreen.native.jsx:821, /Users/andrewhany/personal/iptv-player/src/screens/LiveTVScreen.native.jsx:61

# Persona Red Flags

- **Casey (distracted mobile):** Primary CTAs are 36px tall and the live-card heart has a ~32px effective target — thumb mis-taps. The player's most-used actions sit in a cramped 9-icon horizontal scroll of tiny unlabeled targets. Broken: MovieDetail.jsx:121 play-button height, LiveTVScreen.native.jsx:61 fav hitSlop.
- **Sam (screen reader / low vision):** Cannot operate the app — no accessibilityRole/Label on play, favorite, remove, poster cards, or any of the 9 player icons; controls auto-hide after 4s (ExpoVideoPlayerScreen.native.jsx:169) with no persistent alternative; gesture-only seek/volume have no announced equivalent; Faint Steel text fails contrast. The detector, being color-only, gives Sam zero coverage — this persona is entirely design-review territory.
- **Riley (edge/stress):** Instantly flags fake data — the always-on 'HD' badge (HistoryScreen.native.jsx:46), the frozen 35% live progress bar (LiveTVScreen.native.jsx:73), the 15% phantom progress when duration is missing (:60), and the same file playing in two different-looking players by codec.
- **Morgan (cross-device continuity):** Well served in substance (Continue-vs-From-Start from synced history at MovieDetail.jsx:119-127, offline auto-surfaces downloads) but the phantom progress bars and always-on HD badge erode confidence that 'where I left off' is truthful — the whole continuity promise. Broken: trust, via HistoryScreen.native.jsx:60/73.

# Minor Observations

- Unicode glyphs ▶ ↺ ☰ ♥ ♡ ⬇ ↻ (MovieDetail.jsx:122/125/130, SeriesDetail.jsx:207/227, MoviesScreen:89, AppNavigator.jsx:39) should be the Icon set — one vocabulary.
- Discover pills rest with accentAlpha(0.08) fill + accentAlpha(0.28) border (MoviesScreen:74-77, SeriesScreen:79-81) — a resting indigo wash, soft Single-Light violation; move inactive chips onto the steel/slate ladder.
- SeriesScreen.native.jsx:79 hardcodes 'rgba(108, 92, 231,0.08)' as a literal while MoviesScreen uses accentAlpha() — literal-hex drift risk; pick one.
- AccountsScreen fires an OS Alert.alert('Connected!', …) success dialog (:141) — heavy for a positive confirmation; an inline toast fits the calm register better.
- ProfilesScreen 'Sign Out' footer sits in cyan accent2 at rest (:577) — cyan is reserved for focus only.
- SeriesDetail.jsx:178 hardcodes back-button top=50 while MovieDetail.jsx:97 uses insets.top+8 — notch-safe on one, not the other.
- Parity gap to fix: A reports SeriesDetail.jsx:205/213 also uses the white CTA, but detector B only flagged #fff in MovieDetail.jsx:124/135 and explicitly noted SeriesDetail was NOT flagged — cross-check SeriesDetail so the indigo fix lands on both.

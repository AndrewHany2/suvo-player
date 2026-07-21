---
target: all platforms (native)
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-07-21T19-05-48Z
slug: all-platforms-native
---
# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Loading/Reconnecting/connect-banner/Saving all present; but isSyncing shows an unlabeled history icon (AppNavigator.jsx:38) and no toast on list add/remove. |
| 2 | Match System / Real World | 3 | Mostly natural, but jargon leaks (HLS/.m3u8, DASH/.mpd at LiveTVScreen:265; Xtream/M3U) and a play icon means Connect (AccountsScreen:320). |
| 3 | User Control & Freedom | 3 | Back/Cancel/Escape/scrim-dismiss everywhere, but no undo on instant My-List removal (HistoryScreen:174). |
| 4 | Consistency & Standards | 2 | Discover heading is Inter on Movies, Space Grotesk on Series; three destructive-confirm patterns; ad-hoc error screens bypass StatePanel. |
| 5 | Error Prevention | 3 | Delete confirms, resume prompt, disabled-while-saving, but weak add-channel URL validation. |
| 6 | Recognition Rather Than Recall | 2 | 9 icon-only player controls in a scroll row; icon-only Connect/Delete; double-tap/long-press/swipe gestures all undiscoverable. |
| 7 | Flexibility & Efficiency | 3 | Rich (gestures, resume, next-episode, sleep timer, PiP, zap, downloads) but subtitle/audio offset is a persisted no-op on native (ExpoVideoPlayerScreen:526). |
| 8 | Aesthetic & Minimalist | 3 | Clean midnight theater and content-hero, undermined by 9-control player overload and LIVE-badge tint noise. |
| 9 | Help Users Recover from Errors | 4 | Best-in-class: silent resilient reconnect, plain-language fatal copy with Retry+Close, app-level ErrorBoundary. |
| 10 | Help & Documentation | 1 | Effectively none — one Supported-formats hint line. |
| **Total** | | **27/40** | **Acceptable (upper edge, approaching Good)** |

# Anti-Patterns Verdict

Not slop — the Midnight Theater identity is real, tokenized, and content-first, and would earn a Netflix/Plex/Infuse viewer's trust — but it carries a few register slips (an emoji poster placeholder, a resting-cyan "Active" badge, a permanently indigo-tinted LIVE chip, and a VLC-dense player control strip). Verdict: Trustworthy.

**Detector:** The CLI detector returned 16 advisory findings (0 warnings, 0 errors), all of antipattern design-system-color — undocumented literal rgba() values. After the project's scrim/overlay exemption, all 16 are legitimate player control-track/scrim tints and hero gradient-overlay fades (verified in source at MovieDetail.jsx:20 and SeriesDetail.jsx:19), leaving 0 real signal — the native detector surface is effectively clean, corroborating A's discipline read. The two review-level color issues (indigo-as-small-text failing AA, and the resting cyan/indigo Single-Light inversions) are invisible to the detector because they use documented tokens; A's manual review caught them, and A also flagged a hardcoded #141A2E in ProxiedImage that the detector did not surface.

# Cognitive Load

Moderate — 3 of 8 checklist items fail. Chunking fails and minimal-choices fails on the same offender: the ExpoVideoPlayer bottom row renders up to 9 identical-weight, icon-only, horizontally-scrollable controls (ExpoVideoPlayerScreen.native.jsx:861-877), so overflow controls scroll off-screen into hidden affordances. Visual hierarchy within the player is weak/fail — every control is the same secondary icon chip with no primary/secondary split. Working memory is borderline: double-tap-seek, long-press-2x, and swipe volume/brightness carry zero on-screen affordance. Single-focus, grouping, one-thing-at-a-time, and progressive disclosure pass.

# What's Working

- Failure-state design is best-in-class for the category: translucent scrim over the retained last frame (not an opaque panel), reason-specific fatal copy, Retry+Close (ExpoVideoPlayerScreen.native.jsx:764-804 / VlcPlayerScreen.native.jsx:546-571), backed by ErrorBoundary.jsx so a render throw no longer white-screens — resilience is felt, not announced.
- Empty states teach the next action instead of dead-ending: HistoryScreen:151-160 (Open a movie and add it to Favorites to save it here) and the provider-aware Accounts empty state (AccountsScreen:293-299, which changes copy when allowSelfLines is false).
- Disciplined token usage and 44x44 targets: detail buttons carry explicit minHeight:44 (MovieDetail:122-130), favorite toggles use generous hitSlop (LiveTVScreen:60), and surfaces step the tonal ladder correctly.
- Detector corroborates the discipline: across 18 native files the CLI found zero warning/error findings and zero genuine palette drift after scrim exemptions — the color system is being followed, not decorated over.

# Priority Issues

**[P1] colors.accent (#6C5CE7) is used for small body text: 14px Back labels (MovieDetail:101, SeriesDetail:127,182), 9px LIVE text (LiveTVScreen:70), and the 10px channel abbreviation (LiveTVScreen:52) — indigo-on-midnight lands ~3.9:1, under the 4.5:1 AA bar.**
- Why: PRODUCT.md sets WCAG 2.1 AA as a hard bar, and tokens.js:18 already documents accentText #A99BF5 as existing for small text on dark (AA >=4.5:1) — the correct token is in the system and unused here. Note: the detector (B) did NOT catch this because accent is a documented token, so palette-drift scanning passes it — a contrast failure only A's review surfaced.
- Fix: Swap colors.accent -> colors.accentText for any accent-colored text below ~18px; keep pure accent for fills/icons.
- Command: $impeccable harden — src/components/MovieDetail.jsx:101; src/components/SeriesDetail.jsx:127,182; src/screens/LiveTVScreen.native.jsx:52,70

**[P1] The player bottom control row packs speed/audio/cc/tune/aspect/fullscreen/stats/sleep/pip into one horizontal scroll strip — up to 9 icon-only controls of identical weight, with overflow scrolled off-screen (ExpoVideoPlayerScreen.native.jsx:861-877).**
- Why: Fails chunking + recognition; a one-handed viewer cannot parse tune vs cc vs aspect, and discoverability of scrolled-off controls is near zero. This is the VLC/Kodi density the brand explicitly rejects.
- Fix: Collapse to <=4 primary controls (play/pause is already gesture-driven — surface speed, cc, fullscreen, plus one More... sheet for the rest); give the overflow sheet text labels.
- Command: $impeccable distill — src/screens/ExpoVideoPlayerScreen.native.jsx:861

**[P2] Single-Light Rule inversions: Active account/profile badges use colors.accent2 (cyan) at rest (AccountsScreen:313-315, ProfilesScreen:406-407), and the LIVE chip is permanently indigo-tinted at rest (LiveTVScreen:68-71: accentAlpha(0.15) bg + accent border + accent dot + accent text).**
- Why: DESIGN.md is explicit that cyan appears only on focus/hover, never at rest, and indigo marks the active path not decorative status. A resting Active state should be indigo; the LIVE chip should sit on the steel/slate ladder with an accent dot only.
- Fix: Recolor resting Active badges to colors.accent; move the LIVE chip to a neutral surface with an accent dot only.
- Command: $impeccable colorize — src/screens/AccountsScreen.jsx:313; src/screens/ProfilesScreen.jsx:406; src/screens/LiveTVScreen.native.jsx:68

**[P2] Three destructive patterns and one silent data-loss path: Watch-History removal confirms via Alert (HistoryScreen:118-123), Accounts deletes via modal dialog, Profiles deletes via two-step tap-again-to-confirm (ProfilesScreen:178), but My-List removal fires removeFromMyList instantly with no confirm and no undo (HistoryScreen:174).**
- Why: A thumb resting on the small top-left poster x deletes with no recovery, and three inconsistent confirm models also violate Consistency & Standards.
- Fix: Standardize one destructive pattern; add an undo toast for list removals (or bring confirm parity with History).
- Command: $impeccable polish — src/screens/HistoryScreen.native.jsx:174

**[P2] Five bespoke loading/error surfaces bypass the single StatePanel contract: ConfigErrorScreen.jsx, DeviceLockedScreen.jsx, the jailbreak block (ExpoVideoPlayerScreen:689-705), the boot splash (AppNavigator:110, raw ActivityIndicator), and ErrorBoundary.jsx.**
- Why: DESIGN.md section 5 states every loading/error/empty state routes through StatePanel with no ad-hoc spinner or error screen elsewhere; these five drift in spacing/typography.
- Fix: Route the static error/locked/config screens through StatePanel mode=error; keep only ErrorBoundary bespoke (it cannot import hooks safely).
- Command: $impeccable polish — src/screens/ConfigErrorScreen.jsx:6; src/screens/DeviceLockedScreen.jsx; src/navigation/AppNavigator.jsx:110

**[P3] The Discover heading uses a different font on two sibling screens: MoviesScreen:69 sets it with fontWeight 700 and no fontFamily (renders Inter), while SeriesScreen:73 sets the identical title with fontFamily={fonts.display}.**
- Why: Same component, same word, two fonts — a small consistency crack a discerning eye catches.
- Fix: Both use fonts.display.
- Command: $impeccable typeset — src/screens/MoviesScreen.native.jsx:69; src/screens/SeriesScreen.native.jsx:73

# Persona Red Flags

- **Casey (distracted mobile, thumb zone, interruption):** Player close button sits top-left (ExpoVideoPlayerScreen:821) — the hardest corner for a one-handed thumb — and exit + channel-zap are all top-of-screen. The My-List remove x is a 22x22 target at the poster top-left with only hitSlop 11 (HistoryScreen:45), right where a scrolling thumb rests, and it deletes with no undo. Win: AppState background flush saves watch progress on interruption (ExpoVideoPlayerScreen:230-242).
- **Sam (screen reader / keyboard):** The seek bar declares accessibilityRole=adjustable (ExpoVideoPlayerScreen:889, VlcPlayerScreen:606) but exposes no accessibilityValue and no onAccessibilityAction — VoiceOver announces an adjustable with nothing to adjust, so scrubbing is non-functional for AT. Menu selected-state is carried by color alone (accent vs muted) with no accessibilityState={{selected}} on speed/subtitle rows. isSyncing and the header settings gear communicate via icon only.
- **Morgan (cross-device continuity — the core promise):** Continuity is felt in the data layer (useResumePosition, watch history, My List all sync; MovieDetail:37-40 surfaces Continue from historyEntry) but is invisible in the UI — no Continue on this device, no last-watched/device indicator, no badge that this resume point came from another screen. For positioning built entirely on one account, every screen, the library silently followed them but never shows it.

# Minor Observations

- LiveTVScreen:126 fires a blocking Alert.alert(Channel Added) success dialog on native — heavier than the calm inline banner Accounts deliberately adopted (AccountsScreen:143). Inconsistent success feedback.
- Subtitle/audio offset in the tuning panel is persisted but documented as a no-op on native (ExpoVideoPlayerScreen:526-534) — a control that looks functional and silently does nothing (Riley red flag). Consider hiding it on native.
- ProxiedImage.jsx:34 falls back to a literal movie-clapper emoji glyph on a hardcoded #141A2E (not colors.surface) — the clearest slop tell in the set. Notably this hardcoded hex is a color-system violation the detector (B) did not surface, so A's read caught a palette break B missed. ProxiedImage may be a legacy shim (TVPosterCard re-exports the Aurora PosterCard) so the path could be dead, but it still ships.
- MoviesScreen/SeriesScreen initial catalog load uses a full-screen spinner StatePanel; product register prefers skeleton shelves over a centered spinner for browse content — a cheap premium upgrade.
- Live Now/Next strip (ExpoVideoPlayerScreen:840-853) only appears when EPG resolves, with no placeholder, so its presence flickers per channel.

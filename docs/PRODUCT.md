# Product

## Register

product

## Platform

web

Suvo ships one codebase to six targets — iOS, Android, web, Electron (macOS/Windows/Linux), and TV (LG webOS + Samsung Tizen) — but renders a single custom "Aurora" design language identically on all of them. There is no per-OS native chrome (no Cupertino-on-iOS / Material-on-Android); `Platform.OS` is used only for behavioral concerns (keyboard avoidance, safe-area padding, shadow implementation), never to switch visual language. The design is authored DOM-first and rendered everywhere through react-native-web, so `web` is the truest single value. No native rulebook (HIG / Material 3) is imposed on the custom system.

The hard cross-target constraint: every shared visual must survive webOS Chromium on `file://`. The TV build strips all transitions, transforms, gradients, hovers, and shadows, and shared CSS duplicates token values as literal hex (no CSS `var()`). Design once; degrade gracefully.

## Users

The primary user is an end viewer who already owns a media playlist (an Xtream Codes account or an M3U URL) and wants a polished player for it across every screen they own. They move between a phone on the go, a desktop, and a 10-foot living-room TV driven by a remote — on the same account, and they expect continuity: watch history, My List, favorites, and resume positions should follow them from one device to the next with zero re-setup. Their network is often unreliable (start on the couch, finish on the train), and they are privacy-conscious — the library is theirs, and they don't expect to be tracked or advertised to.

A reseller/provider audience exists behind the scenes (a separate dashboard provisions customer "lines"), but that is a B2B2C distribution channel and a separate surface, not the primary user of the app UI this document governs.

## Product Purpose

Suvo is a cross-platform media player for playlists the user already owns. It ships with no content of its own: the user supplies a playlist, Suvo auto-organizes it into Live / Movies / Series, enriches VOD with artwork and metadata, and plays it back with an engine-agnostic, self-healing recovery machine that reconnects and resumes on network drops rather than failing to a dead spinner. Accounts, profiles, and watch state sync across devices.

The app is doing its job when a viewer opens it and is watching something they want within seconds, playback starts and keeps playing across flaky networks and providers without black screens or manual restarts, the same experience follows them across phone, desktop, and TV with no re-setup, and they come back day after day. Those outcomes reinforce each other: fast time-to-play, reliable playback, effortless cross-device continuity, and daily retention are one goal, not four.

## Positioning

One account, every screen: your channels, history, and where you left off follow you seamlessly from phone to desktop to the big screen. Every screen should make the viewer feel that their library is continuous and portable — the same library, the same state, wherever they open it.

## Brand Personality

Cinematic and premium. Content is the hero and the chrome recedes into a deep, dark, immersive surface; focus states glow, hero treatments carry depth, and the interface feels like a considered piece of home-theater hardware rather than a utility. Dark-only is permanent — it matches both the token system and the lean-back viewing context.

Underneath the cinematic surface, the established voice (documented in the marketing site and store copy) is calm, reassuring, benefit-first, and privacy-minded — short declarative sentences, gentle anti-buffering promises, "your library is yours." Confidence is shown through restraint, not spectacle: the product is premium because it gets out of the way and simply works, not because it shouts.

## Anti-references

Suvo should explicitly NOT look or feel like:

- **Spec-heavy EPG / TV-guide grids.** No dense "thousands of channels" listings, tiny text, or broadcaster-logo walls. This is both an aesthetic anti-pattern and a store-rejection risk.
- **Cluttered, ad-laden UIs.** No promo banners, upsell nags, or tracking-heavy surfaces. Suvo is zero ads and zero trackers, and the interface should read that way.
- **A generic streaming clone.** Not a Netflix/Disney+ knockoff with no identity of its own; the Aurora system is the point of difference.
- **A techy, power-user tool.** Not settings-first, skin-heavy, or engineer-facing like Kodi or VLC. It should feel consumer-simple: press play fast, complexity hidden.

## Design Principles

- **Content is the hero; chrome recedes.** Cinematic immersion over UI ornament. The interface exists to get the viewer to playback and then disappear.
- **Resilience is felt, not announced.** Playback recovers silently and resumes; the viewer should rarely see a failure state, and never a dead spinner they have to fix by hand.
- **Continuity across screens.** One account, the same state everywhere — history, My List, favorites, resume position — with zero re-setup when a viewer switches device.
- **Consumer-simple, never power-user.** Optimize for the fastest path from launch to press-play. Hide configuration; don't lead with settings.
- **Design to the lowest common denominator.** Every shared visual must survive webOS Chromium on `file://` (no transitions/transforms/gradients/shadows in shared TV CSS, literal-hex token duplication). Author once and let each target degrade gracefully rather than adding effects the TV can't render.

## Accessibility & Inclusion

- **WCAG 2.1 AA contrast** as a hard bar across the dark theme: ≥4.5:1 for body text, ≥3:1 for large text.
- **TV D-pad focus order.** First-class, predictable remote/D-pad focus traversal with a clearly visible focus state for the 10-foot TV UI (webOS / Tizen).
- **Reduced motion everywhere.** Honor `prefers-reduced-motion` across the entire app, not only the marketing site.
- **Touch targets ≥ 44×44px** on mobile.

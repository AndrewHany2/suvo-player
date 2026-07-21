---
name: Suvo
description: A fast, resilient media player for the playlists you already own — one account, every screen.
colors:
  midnight-bg: "#0A0E1A"
  slate-surface: "#141A2E"
  elevated-surface: "#1B2236"
  border-hairline: "#28324E"
  aurora-indigo: "#6C5CE7"
  signal-cyan: "#22D3EE"
  ice-text: "#EAF0FF"
  steel-muted: "#7A86A8"
  faint-steel: "#4A5575"
  danger: "#E5484D"
  success: "#6ABF69"
  rating-gold: "#FFD700"
typography:
  display:
    fontFamily: "SpaceGrotesk, 'Space Grotesk', -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "SpaceGrotesk, 'Space Grotesk', -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "SpaceGrotesk, 'Space Grotesk', -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "8px"
  card: "10px"
  md: "14px"
  lg: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.aurora-indigo}"
    textColor: "{colors.ice-text}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "{colors.elevated-surface}"
    textColor: "{colors.ice-text}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ice-text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  poster-card:
    backgroundColor: "{colors.slate-surface}"
    rounded: "{rounded.card}"
  input-field:
    backgroundColor: "{colors.elevated-surface}"
    textColor: "{colors.ice-text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  chip:
    backgroundColor: "{colors.elevated-surface}"
    textColor: "{colors.ice-text}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
---

# Design System: Suvo

## 1. Overview

**Creative North Star: "The Midnight Theater"**

Suvo is a dark, hushed room where the screen is the only light. The interface is midnight — a near-black indigo-tinted field (`#0A0E1A`) — and everything on it is furniture in a home theater: present, precise, and silent until you reach for it. Content is the light source. Posters, backdrops, and playback carry the color; the chrome recedes into the dark so the viewer's eye lands on what they came to watch. When attention moves, a single beam follows it: **Aurora Indigo** marks the active path, **Signal Cyan** marks focus. Nothing else in the room earns saturation.

This is a *cinematic and premium* system, but premium through restraint, not spectacle. Depth is built from tonal layering — background to surface to elevated surface — not from drop shadows or glass. Motion is quiet: short, eased state changes on phone and desktop, and on the 10-foot TV the surface is deliberately still — focus and selection snap in with no `transition`, and the only thing that moves is the loading spinner (composited via `transform`, gated on `prefers-reduced-motion`). webOS/Tizen Chromium on `file://` gets no `box-shadow` and no eased transitions; `transform` and `linear-gradient` are used only where the Chromium-71 floor renders them cheaply (compositor promotion, legibility scrims over imagery, the hairline). The same tokens render identically across iOS, Android, web, Electron, and TV; the identity does not change per platform, only the form factor and the rendering engine do.

The system explicitly rejects the look of the category it belongs to: no dense **spec-heavy EPG / TV-guide grids** with tiny text and broadcaster-logo walls; no **cluttered, ad-laden** promo surfaces (Suvo carries zero ads and zero trackers, and must read that way); no **generic streaming-clone** anonymity that could be any service; and no **techy, power-user** settings-first density in the mold of Kodi or VLC. Suvo is consumer-simple: press play fast, complexity hidden.

**Key Characteristics:**
- Dark-only, permanent. Midnight field with tonal depth, never a light theme.
- Content is the hero; chrome is furniture-grade and recessive.
- Two accents, used as light: Aurora Indigo (active) and Signal Cyan (focus).
- Flat by default; the only "elevation" is a focus glow, and only while focused.
- One identity across six targets, authored to the webOS-`file://` lowest common denominator.

## 2. Colors

A near-black indigo-tinted theater lit by two cool accents; everything between is a tonal ladder of steel and slate.

### Primary
- **Aurora Indigo** (`#6C5CE7`): The active-state and primary-action color. It fills the primary button (as the left stop of the nav/active gradient), marks the selected tab or row, and anchors the `linear-gradient(100deg, #6C5CE7, #22D3EE)` used on the nav band and active/selected states. Never animated — the gradient is static because TV strips animation and would jank.
- **Signal Cyan** (`#22D3EE`): The interaction color. It is the focus ring (`width 2, offset 2`), the focus/hover glow on posters and buttons, and the right stop of the accent gradient. It appears only on focus or hover, never at rest. Its name is the promise: the signal that guides the eye — and the signal that never drops.

### Neutral
- **Midnight** (`#0A0E1A`): The app background. The theater itself.
- **Slate Surface** (`#141A2E`): Cards, bars, rails — the first tonal step up from midnight.
- **Elevated Surface** (`#1B2236`): Modals, inputs, chips — the second step up. Depth is expressed by moving up this ladder, not by shadow.
- **Border Hairline** (`#28324E`): Card borders and dividers. Thin, low-contrast, structural only.
- **Ice** (`#EAF0FF`): Primary text. High-contrast, faintly cool white.
- **Steel** (`#7A86A8`): Secondary text and metadata.
- **Faint Steel** (`#4A5575`): Placeholders and disabled text only. Never body copy — it fails contrast.

### Tertiary (semantic)
- **Danger** (`#E5484D`): Destructive actions and errors.
- **Success** (`#6ABF69`): Confirmations and online state.
- **Rating Gold** (`#FFD700`): Star ratings exclusively. It is the one warm note in the room; do not repurpose it as a general accent.

### Named Rules
**The Single-Light Rule.** Color is light in a dark theater. Aurora Indigo marks the active path and Signal Cyan marks focus — and that is the entire budget for saturation in the chrome. If a resting, unfocused control is tinted, it's wrong; move it back onto the steel/slate ladder.

**The Literal-Hex Sync Rule.** The palette lives twice — in `src/ui/tokens.js` and in the shared TV CSS — and the two must stay in lockstep: change a token, change every hex that echoes it. The TV sheets author the palette once as `--a-*` custom properties in a single `:root` block (`src/styles/tvl.css`) and consume them via `var()`; `tv/patch-index.js` then inlines every `var(--a-*)` to its literal value at build, so the shipped `file://` artifact carries only literal hex. The inlining is a shorthand-safety measure, not a support workaround — webOS/Tizen Chromium (floor 71+) supports custom properties fine and honours a standalone `var()`, but it drops the whole declaration when a `var()` sits inside a multi-value shorthand (e.g. `padding: 24px var(--a-inset)`), so those must resolve to literals before shipping. A few values are still written as literal hex inline rather than via a token (e.g. the play-button fill `#6C5CE7`/`#EAF0FF` and the `--a-hairline` gradient stops) — those track `tokens.js` by hand.

## 3. Typography

**Display Font:** Space Grotesk (with `-apple-system, "Segoe UI", Roboto, sans-serif` fallback)
**Body Font:** Inter (with `-apple-system, "Segoe UI", Roboto, sans-serif` fallback)

**Character:** A geometric grotesk display paired with a neutral humanist workhorse — Space Grotesk gives titles and eyebrows a slightly mechanical, contemporary edge (fitting a device-grade product), while Inter keeps long metadata and body copy quiet and legible at small sizes. The pairing contrasts on personality, not just weight, so the two never blur together.

Sizes are authored at a 1920×1080 reference and scaled at call sites through `ss()` (`src/utils/scaleSize.js`); the TV type ramp runs one step larger for 10-foot lean-back viewing.

### Hierarchy
- **Display** (Space Grotesk, 700, 40px, line-height 1.2): Hero titles and the largest screen headings. Tighten tracking slightly (`-0.02em`); never below `-0.04em`.
- **Headline** (Space Grotesk, 700, 28px, line-height 1.2): Section and shelf headings.
- **Title** (Space Grotesk, 600, 20px, line-height 1.4): Card titles, dialog titles, settings section headers.
- **Body** (Inter, 400, 16px, line-height 1.6): Descriptions, synopsis, prose. Cap measured text at 65–75ch.
- **Label** (Inter, 600, 14px, line-height 1.4): Buttons, metadata, chips, form labels. Eyebrows and kickers, when used, take the **display** font (Space Grotesk), not Inter.

### Named Rules
**The Display-for-Signage Rule.** Space Grotesk is for titles, headings, and eyebrows only. Body copy, metadata, and anything a viewer reads in quantity is always Inter. Don't set paragraphs in the display face.

## 4. Elevation

This system is **flat by default and lifts only in response to state.** Depth at rest is tonal, not cast: the eye reads layers by the step from Midnight (`#0A0E1A`) to Slate Surface (`#141A2E`) to Elevated Surface (`#1B2236`), reinforced by a `#28324E` hairline border where separation matters. Web and TV render **no `box-shadow` at rest** — the legacy CSS owns shadows on web and TV strips them entirely for performance — so the `shadows.card` / `shadows.modal` presets resolve to `{}` on those targets and apply real shadow objects only on native (iOS `shadow*` + Android `elevation`).

The one interactive "elevation" is the **cyan focus glow**, present on focus/hover and never at rest.

### Shadow Vocabulary
- **Focus Glow — web** (`box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55)`): A crisp 1px cyan inner ring plus a broad soft halo, applied to focused/hovered buttons and posters. Gate every caller on `isTV()` — TV must not receive it.
- **Focus Glow — native** (`shadowColor #22D3EE, radius 16, opacity 0.45, elevation 8`): The same interaction cue expressed as a real native shadow.
- **Card / Modal — native only** (`card`: 0/2/6 @ 0.25, elevation 4 · `modal`: 0/8/16 @ 0.4, elevation 12): Ambient lift for stacked surfaces on iOS/Android. Web and TV get nothing here by design.

### Named Rules
**The Flat-Theater Rule.** Surfaces are flat at rest. The only shadow is the cyan focus glow, and it exists only while an element is focused or hovered. On TV, even that is gone — depth there is purely tonal. If a resting card has a drop shadow on web or TV, delete it.

## 5. Components

All components are hand-rolled, zero-dependency primitives (Tamagui was removed; it survives only in code comments). The feel across the set is **refined and cinematic**: understated, precise, low-ornament, with depth coming from the dark tonal surfaces and a single cyan focus cue rather than borders or shadows.

### Buttons
- **Shape:** Gently rounded (14px / `rounded.md`). Icon-only and pill actions may go full pill (999px).
- **Primary:** Aurora Indigo fill (`#6C5CE7`), Ice text (`#EAF0FF`); the accent gradient (`#6C5CE7 → #22D3EE`) may carry the highest-emphasis action. Padding ~`12px 24px` (md); sm and lg step the padding down/up.
- **Secondary:** Elevated Surface fill (`#1B2236`), Ice text, hairline border.
- **Ghost:** Transparent, Ice text, no border; used for low-emphasis and inline actions.
- **Hover / Focus:** Signal Cyan glow (`GLOW_WEB` on web, `glow` preset on native) plus the focus ring. Transitions use `200ms cubic-bezier(0.4,0,0.2,1)` on web/native; **no transition on TV.** The TV remote focus state (`isFocused`) applies the ring/fill treatment instantly.

### Chips
- **Style:** Elevated Surface background (`#1B2236`), Ice text, pill radius (999px).
- **State:** Selected chips take Aurora Indigo (or the accent gradient) fill; unselected stay on the elevated surface. Used for genre/category filters.

### Cards / Containers
- **Corner Style:** 10px (`rounded.card`) for poster cards and content tiles; 14px for larger panels.
- **Background:** Slate Surface (`#141A2E`) on the midnight field.
- **Shadow Strategy:** None at rest (see Elevation). Focus/hover applies the cyan glow on web/native; TV uses a stronger fill (`--a-focus-fill rgba(34,211,238,0.20)`) since it has no halo.
- **Border:** Optional `#28324E` hairline for separation.
- **Internal Padding:** From the space scale (`md` 12px / `lg` 16px).

### Inputs / Fields
- **Style:** Elevated Surface background (`#1B2236`), Ice text, 14px radius, hairline border.
- **Focus:** Signal Cyan ring/glow, matching buttons.
- **Placeholder / Disabled:** Faint Steel (`#4A5575`) — the only correct use of that token.
- **Error:** Danger (`#E5484D`) border and message.

### Navigation
- **Style:** Dark bar on the midnight field; the active tab/route carries the Aurora Indigo→Signal Cyan gradient or Aurora Indigo fill. Inactive items are Steel (`#7A86A8`); active is Ice.
- **TV:** D-pad focus order is first-class — every focusable item has a clearly visible focus state, and traversal is predictable. Focus, not hover, is the primary model.

### PosterCard & ContentShelf (signature)
- **PosterCard:** The core content tile — poster-ratio image (`width × 1.5`), Signal Cyan focus ring/glow on focus *and* hover only. The unit the whole browse experience is built from.
- **ContentShelf:** A Netflix-style horizontal rail with lazy-loaded posters (IntersectionObserver), drag-scroll, and pagination — the home/browse model on web and native. Drill-in views switch to windowed grids (`VirtualGrid.web` / `PagedGrid.tv`) tuned to survive webOS scroll-freeze.
- **StatePanel:** The single shared loading / error / empty surface (`modes: loading | error | empty`). All three states route through it — there is no ad-hoc spinner or error screen elsewhere.

## 6. Do's and Don'ts

### Do:
- **Do** keep the surface midnight and let content be the light. Build depth by stepping the tonal ladder (`#0A0E1A → #141A2E → #1B2236`), not by adding shadows.
- **Do** reserve Aurora Indigo for active/primary and Signal Cyan for focus/interaction — the Single-Light Rule. Everything else lives on the steel/slate neutrals.
- **Do** hit **WCAG 2.1 AA** contrast: ≥4.5:1 body, ≥3:1 large text. Body copy is Ice (`#EAF0FF`) or Steel (`#7A86A8`) on dark — never Faint Steel (`#4A5575`), which is placeholder/disabled only.
- **Do** give the 10-foot TV UI a clearly visible, predictable D-pad focus order, and honor `prefers-reduced-motion` across the whole app, not just the marketing site.
- **Do** use ≥44×44px touch targets on mobile.
- **Do** duplicate token values as **literal hex** in shared CSS (no `var()`), and keep them in sync with `src/ui/tokens.js`.
- **Do** channel every loading/error/empty state through **StatePanel**; resilience is felt, not announced — recover silently, never strand the viewer on a dead spinner.

### Don't:
- **Don't** build **spec-heavy EPG / TV-guide grids** with tiny text or broadcaster-logo walls. It's both off-brand and a store-rejection risk.
- **Don't** add **cluttered, ad-laden** chrome — promo banners, upsell nags, tracking. Suvo is zero ads and zero trackers; the UI must read that way.
- **Don't** let Suvo become a **generic streaming clone** with no identity — the Midnight Theater and its two accents are the point of difference.
- **Don't** build **techy, power-user** density (Kodi/VLC): settings-first layouts, skin sprawl, engineer-facing controls. Stay consumer-simple.
- **Don't** put a `box-shadow` or a CSS `transition` in **shared TV CSS**, and don't reach for `transform`, `linear-gradient`, or a `var()` fill as decoration. TV drops the cyan `GLOW_WEB` halo (focus is the 4px ring + `--a-focus-fill`, never a shadow), depth stays purely tonal, and focus/selection applies instantly — nothing eases. `transform` and `linear-gradient` ARE allowed where they earn the Chromium-71 floor: `transform` for compositor-layer promotion (the spinner's `translateZ(0) rotate`) and simple mirroring (the scroll-hint chevron's `scaleX(-1)`), and `linear-gradient` for legibility scrims over imagery plus the single 2px Aurora hairline — not decorative motion, hover effects, or gradient fills. And `var()` is the intended authoring layer for the `--a-*` tokens (inlined to literals at build — see the Literal-Hex Sync Rule), not a banned construct. The only animation in the shared TV layer is the loading spinner, gated on `prefers-reduced-motion`.
- **Don't** put a drop shadow on a resting card or surface (web/TV). The only shadow is the cyan focus glow, on focus/hover only.
- **Don't** animate the accent gradient, and **don't** set body copy in Space Grotesk.
- **Don't** use `border-left`/`border-right` greater than 1px as a colored accent stripe, gradient-filled text, or decorative glassmorphism anywhere.

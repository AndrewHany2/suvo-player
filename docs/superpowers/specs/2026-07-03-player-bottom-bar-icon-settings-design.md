# Player bottom-bar icon settings

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Move the player's settings controls (speed, audio track, subtitles, aspect
ratio, quality, PiP, cast, stats, sleep/tune) out of their current top-header
location and into the player's **bottom control bar**, rendered as **icon
buttons** instead of text labels. The controls must be *integrated into the
existing control overlay* — they live in the same fading bottom bar as the
progress row, share the same visibility timer and menu state, and are not a
separate/detached surface.

Applies to all three render paths:

- **Web / desktop** — `VideoPlayerScreen.web.jsx`, non-TV render.
- **TV (webOS)** — `VideoPlayerScreen.web.jsx`, `isTV` render.
- **Native mobile** — `VideoPlayerScreen.native.jsx`.

## Approach

In-place edits per render path (no shared component). Each render is already
self-contained; a shared abstraction would leak platform differences (DOM
popovers vs RN modals vs TV D-pad focus). Add the missing icons to the shared
`Icon` set once, then rework each render's control layout individually.

## 1. New icons

Added to **both** `src/ui/Icon.web.jsx` and `src/ui/Icon.native.jsx`, matching
the existing 24×24 stroke-based line style (no CSS vars / animations, webOS
safe). `settings` already exists on web but is **missing on native** — add it
there too.

| name | glyph |
|---|---|
| `audio` | speaker / volume |
| `cc` | rounded rect with "cc" strokes (subtitle) |
| `speed` | gauge / speedometer |
| `aspect` | expand frame (corners) |
| `cast` | cast screen + waves |
| `pip` | picture-in-picture (rect within rect) |
| `info` | circle + i (stats) |
| `timer` | clock/moon (sleep) |
| `tune` | horizontal sliders |
| `settings` | gear (native only — web already has it) |

## 2. Icon mapping

| Control | Icon | Web | TV | Native |
|---|---|---|---|---|
| Playback speed | `speed` + "1x" text | ✓ | ✓ | ✓ |
| Audio track (if >1) | `audio` | ✓ | ✓ | ✓ |
| Subtitles (if tracks) | `cc` | ✓ | ✓ | ✓ |
| Aspect ratio | `aspect` | ✓ | ✓ | — |
| Quality (if >1 level) | `settings` | ✓ | ✓ | — |
| PiP (if supported) | `pip` | ✓ | — | — |
| Cast (if supported) | `cast` | ✓ | — | — |
| Stats | `info` | ✓ | ✓ | ✓ |
| Sleep / tune | `tune` | ✓ | — | ✓ |

Each icon button keeps `title`/`aria-label` for tooltip + accessibility. The
speed button keeps its "1x" text next to the icon so the current rate is
visible at a glance.

## 3. Per-player layout

### Web / desktop
- Top header keeps **only** close button + title (+ live now/next strip, next
  episode button as today).
- Settings controls move into a **right-aligned icon row inside the bottom
  bar** (`S.bottomBar`), on the same row as / adjacent to the progress + time.
- Dropdown menus become popovers that open **upward** (anchored above the
  icon) since the bar is now at the bottom. Reuse existing `openMenu` state,
  `S.dropdown`/`S.menu` styles adjusted for upward placement.
- Icon-only buttons; `S.btn` restyled for square icon hit targets.

### Native
- Move Audio / CC / Tune / speed / stats buttons out of the top control row.
- New **icon row** sits just above the existing bottom seek bar, inside the
  same fading control overlay (`showControls`).
- Existing modal menus (`showSpeedMenu`, `showAudioMenu`, `showSubtitleMenu`,
  `showSubtitleSettings`) are unchanged — just triggered from the new icons.
- Top row keeps close + title (+ channel zap for live, next episode).

### TV (webOS) — net-new menus
- New **horizontal icon row** in `TV.bottomBar`, above the progress track,
  inside the existing `TV.controls` overlay (shares `tvControlsVisible` +
  `showTvControls` timer).
- Icons: speed, audio (if >1), subtitles (if tracks), aspect, quality (if >1),
  stats.
- Menus are net-new for TV (the TV render currently exposes none). They open
  **upward** as a list. They are wired to the **existing hls refs / state**
  already present in the file (`hlsRef`, `qualityLevels`, `audioTracks`,
  `subtitleTracks`, `applySpeed`, `applyAspect`, `handleSelectLevel`,
  `applyAudio`, `applySubtitle`) — no new playback plumbing.

#### TV D-pad focus model
- `tvSettingsFocus` (int, -1 = not in row) — index of focused icon in the row.
- `tvMenuOpen` (string|null) — which menu is open (`"speed"`, `"audio"`, …).
- `tvMenuIndex` (int) — highlighted item in the open menu.
- Key handling (extends the existing TV key handler):
  - When controls visible and no menu open: Left/Right move `tvSettingsFocus`
    across the icon row; OK opens the focused icon's menu (`tvMenuOpen`,
    `tvMenuIndex = current selection).
  - When a menu is open: Up/Down move `tvMenuIndex`; OK applies the item and
    closes the menu; Back closes the menu (returns focus to the row).
  - Back with a menu closed returns to normal (existing close/exit behavior).
- Focus is drawn with a visible ring/highlight (bg + border), no reliance on
  native DOM focus (webOS spatial nav is unreliable here — drive it manually,
  consistent with existing TV key handling in this file).
- Entering/leaving the settings row must not fight the existing seek/OK
  play-pause handling: when `tvSettingsFocus >= 0` or a menu is open, arrow/OK
  keys route to the settings row, **not** to seek/play-pause.

## 4. Non-goals / constraints

- No change to playback engine, recovery machine, or preferences plumbing.
  Selections continue to persist via the existing `setPref`/prefs flow.
- No new shared component; edits stay within the three files + `Icon.*`.
- Menu *contents* (available speeds, tracks, aspect ratios, quality levels)
  are unchanged — only their trigger UI and placement change.
- Keyboard shortcuts on web (p, i, etc.) remain.

## 5. Testing / verification

- Web: launch Electron/web, open a stream, confirm the icon row renders in the
  bottom bar, each menu opens upward, selections apply and persist, tooltips
  show, top header is just close + title.
- Native: confirm icon row above seek bar, modals open from icons, auto-hide
  works.
- TV: run on-device or TV emulation; D-pad across the icon row, open each menu,
  navigate + select with Up/Down/OK, Back closes menu then row; confirm
  play/pause and seek still work when not in the settings row.

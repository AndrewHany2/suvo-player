# Player Bottom-Bar Icon Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each player's settings controls out of the top header into the player's own bottom control overlay, rendered as icon buttons, for web/desktop, native mobile, and TV (webOS).

**Architecture:** In-place edits per render path — no shared component. Add the missing icons to the shared `Icon` set (`Icon.web.jsx` covers web + TV; `Icon.native.jsx` covers mobile), then rework each render's control layout individually. The only extracted unit is a pure D-pad navigation reducer for the TV settings row (`src/playback/tvSettingsNav.js`), unit-tested with `node --test`; everything else is JSX/layout verified by build + manual runtime checks (this repo has no React render-test harness — see Global Constraints).

**Tech Stack:** React (JSX), React Native, expo-video, hls.js, Electron, inline-SVG icons (web/TV), View-composition icons (native), `node --test` for pure logic.

## Global Constraints

- **No new dependencies.** `react-native-svg` is NOT installed; native icons must be built from `<View>`/`<Text>` (borders, rotation, non-emoji glyphs), matching the existing `Icon.native.jsx` pattern.
- **webOS-safe styling** in `Icon.web.jsx` and the TV render: NO CSS custom properties (`var()`), NO CSS animations on icons, NO `box-shadow`. Colour flows through `currentColor` driven by the `color` prop.
- **Icon contract (both platforms):** `<Icon name size color ...rest />`; unknown names render `null` (never throw). Web icons use a 24×24 viewBox, `fill="none" stroke="currentColor" strokeWidth="2"`.
- **No test harness for UI.** The repo's tests are `node --test` over pure `*.test.js` logic modules only (no jsdom / testing-library). Do NOT fabricate render tests. Only Task 3 (the TV nav reducer) gets automated tests; UI tasks are verified by `npm run build:web` (compiles the web+TV bundle) and manual runtime checks documented in each task.
- **No change to playback engine, recovery machine, or preferences plumbing.** Reuse existing handlers (`applySpeed`, `applyAudio`, `applySubtitle`, `applyAspect`, `handleSelectLevel`, `cycleContentFit`, `handleSpeedChange`, `handleAudioChange`, `handleSubtitleChange`, `handlePip`, `toggleFullscreen`, `sleep`, `setShowStats`) and existing menu/modal state. Menu *contents* are unchanged.
- **Preserve every existing control.** Relocating must not drop functionality (e.g. native PiP, fullscreen, aspect, sleep, stats, tune all remain — as icons).
- **Web keyboard shortcuts remain** (`space`/`k`, `f`, `[`/`]`, `p`, `i`, arrows, `Esc`).
- **Commit** after each task with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- `src/ui/Icon.web.jsx` — add 9 icons (`audio`, `cc`, `speed`, `aspect`, `cast`, `pip`, `info`, `timer`, `tune`); `settings` already exists. Consumed by web + TV.
- `src/ui/Icon.native.jsx` — add 9 icons (`audio`, `cc`, `speed`, `aspect`, `tune`, `info`, `timer`, `pip`, `fullscreen`). `settings` already resolves via the `⚙` glyph. No `cast` (native has no cast control).
- `src/playback/tvSettingsNav.js` — NEW pure reducer for TV settings-row / menu D-pad navigation.
- `src/playback/tvSettingsNav.test.js` — NEW `node --test` unit tests for the reducer.
- `src/screens/VideoPlayerScreen.web.jsx` — web render (relocate settings to a new bottom icon bar, menus open upward) AND TV render (new settings icon row + upward menus wired to the reducer).
- `src/screens/VideoPlayerScreen.native.jsx` — relocate settings into an icon row above the seek bar in the existing `showControls` overlay.

## Decisions filling a spec gap (flag for review)

The approved spec defines the TV focus model (`tvSettingsFocus`, menu open, menu index, and Left/Right/Up/Down/OK/Back behavior *while in the settings surface*) but does not state how the user first **enters** the row. This plan decides:

- **Enter the row with Up** (D-pad Up / ArrowUp) whenever controls are visible and no menu is open. **Down** or **Back** (when a menu is not open) leaves the row (focus → not-in-row).
- Legacy transport keys are unchanged **while not in the row and no menu open**: Left/Right seek ±10s (VOD), OK toggles play/pause, FF/REW (417/412) seek ±30s.
- **Live tradeoff:** entering the row with Up drops the ArrowUp channel-zap for live. Channel-zap-down stays on ArrowDown (when not in the row); the dedicated channel remote keys (427/428) continue to zap both directions. If you prefer a different entry key for live, raise it at plan review.
- State refinement vs the spec: the open-menu identity is derived from the focused icon (`tvSettingsItems[focus].key`) rather than a separate `tvMenuOpen` string — a single source of truth. State is `{ focus, inMenu, menuIndex }`.

---

### Task 1: Add web/TV icons

**Files:**
- Modify: `src/ui/Icon.web.jsx` — add entries to the `PATHS` object (after the existing `settings` entry, `src/ui/Icon.web.jsx:87`).

**Interfaces:**
- Produces: icon names `audio`, `cc`, `speed`, `aspect`, `cast`, `pip`, `info`, `timer`, `tune` renderable via `<Icon name="…" />` in the web + TV bundle.

- [ ] **Step 1: Add the nine icon paths**

In `src/ui/Icon.web.jsx`, inside the `PATHS` object, add these entries (place them right after the `settings` entry at line 87, before the closing `}` of `PATHS`):

```jsx
  // Audio / speaker with one sound wave.
  audio: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </>
  ),
  // Closed-caption: rounded frame with two "c" arcs.
  cc: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3" />
    </>
  ),
  // Speed: gauge arc with a needle.
  speed: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 14l4-3" />
    </>
  ),
  // Aspect: expand-frame corner brackets.
  aspect: (
    <path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3" />
  ),
  // Cast: screen outline + broadcast waves.
  cast: (
    <>
      <path d="M4 6h16v12h-5" />
      <path d="M4 12a5 5 0 0 1 5 5M4 16a2 2 0 0 1 2 2" />
      <path d="M4 20h.01" />
    </>
  ),
  // Picture-in-picture: outer screen + inner window.
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Info: circle with an "i".
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  // Sleep timer: crescent moon.
  timer: <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5z" />,
  // Tune: three slider rows with knobs.
  tune: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h6M14 18h6" />
      <circle cx="15" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="2" fill="currentColor" stroke="none" />
    </>
  ),
```

- [ ] **Step 2: Compile the web/TV bundle to verify the JSX**

Run: `npm run build:web`
Expected: build completes without a syntax/JSX error (a full export; watch for `Icon.web.jsx` parse errors specifically).

- [ ] **Step 3: Manual visual check (optional but recommended)**

Run: `npm run web`, then in the browser console evaluate a quick render harness is not necessary — instead confirm during Task 4/6 runtime that each new icon draws. No automated assertion (no render harness in repo).

- [ ] **Step 4: Commit**

```bash
git add src/ui/Icon.web.jsx
git commit -m "feat(player): add web/TV settings icons (audio, cc, speed, aspect, cast, pip, info, timer, tune)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add native icons

**Files:**
- Modify: `src/ui/Icon.native.jsx` — add shape components and `switch` cases.

**Interfaces:**
- Produces: icon names `audio`, `cc`, `speed`, `aspect`, `tune`, `info`, `timer`, `pip`, `fullscreen` renderable via `<Icon name="…" />` on native.

- [ ] **Step 1: Add the shape components**

In `src/ui/Icon.native.jsx`, add these functions just before `function Glyph(` (currently `src/ui/Icon.native.jsx:269`):

```jsx
// Audio / speaker: cone (square + right triangle) with one sound arc.
function AudioShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const boxH = size * 0.32;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ width: size * 0.16, height: boxH, backgroundColor: color, borderRadius: 1 }} />
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: boxH,
            borderBottomWidth: boxH,
            borderRightWidth: size * 0.24,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            borderRightColor: color,
          }}
        />
        <View
          style={{
            width: size * 0.2,
            height: size * 0.2,
            borderWidth: t,
            borderColor: color,
            borderRadius: size * 0.2,
            borderLeftColor: "transparent",
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            marginLeft: size * 0.04,
          }}
        />
      </View>
    </View>
  );
}

// Closed-caption: rounded frame with "CC" text inside.
function CcShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.86,
          height: size * 0.6,
          borderWidth: t,
          borderColor: color,
          borderRadius: Math.max(2, size * 0.14),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text allowFontScaling={false} style={{ color, fontSize: size * 0.32, fontWeight: "700", lineHeight: size * 0.4 }}>
          CC
        </Text>
      </View>
    </View>
  );
}

// Speed: two chevrons pointing right (fast-forward reads as speed).
function SpeedShape({ size, color }) {
  const s = size * 0.4;
  const t = Math.max(2, size / 11);
  const chev = {
    width: s,
    height: s,
    borderRightWidth: t,
    borderTopWidth: t,
    borderColor: color,
    transform: [{ rotate: "45deg" }],
  };
  return (
    <View style={{ width: size, height: size, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
      <View style={chev} />
      <View style={[chev, { marginLeft: -s * 0.35 }]} />
    </View>
  );
}

// Aspect: a rounded rectangle frame outline.
function AspectShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: size * 0.82, height: size * 0.58, borderWidth: t, borderColor: color, borderRadius: Math.max(2, size * 0.12) }} />
    </View>
  );
}

// Tune: three horizontal slider lines with offset knobs.
function TuneShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const knob = size * 0.16;
  const row = (top, knobLeft) => (
    <View style={{ position: "absolute", top, left: 0, right: 0, height: knob, justifyContent: "center" }}>
      <View style={{ height: t, backgroundColor: color, borderRadius: t / 2 }} />
      <View style={{ position: "absolute", left: knobLeft, width: knob, height: knob, borderRadius: knob / 2, backgroundColor: color }} />
    </View>
  );
  return (
    <View style={{ width: size * 0.82, height: size * 0.82, alignSelf: "center", justifyContent: "space-between" }}>
      {row(0, size * 0.5)}
      {row(size * 0.33, size * 0.15)}
      {row(size * 0.66, size * 0.35)}
    </View>
  );
}

// Info: circle outline with an "i".
function InfoShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const d = Math.round(size * 0.86);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: t, borderColor: color, alignItems: "center", justifyContent: "center" }}>
        <Text allowFontScaling={false} style={{ color, fontSize: size * 0.5, fontWeight: "700", lineHeight: size * 0.56 }}>
          i
        </Text>
      </View>
    </View>
  );
}

// Sleep timer: a clock ring with two hands (reads as a timer).
function TimerShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  const d = Math.round(size * 0.82);
  const inn = d - 2 * t;
  const c = inn / 2;
  const minH = c * 0.72;
  const hourW = c * 0.56;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: t, borderColor: color }}>
        <View style={{ position: "absolute", width: t, height: minH, backgroundColor: color, borderRadius: t / 2, left: c - t / 2, top: c - minH }} />
        <View style={{ position: "absolute", width: hourW, height: t, backgroundColor: color, borderRadius: t / 2, left: c, top: c - t / 2 }} />
      </View>
    </View>
  );
}

// Picture-in-picture: outer screen outline + filled inner window (bottom-right).
function PipShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 12));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: size * 0.86, height: size * 0.62, borderWidth: t, borderColor: color, borderRadius: Math.max(2, size * 0.1), justifyContent: "flex-end", alignItems: "flex-end", padding: t }}>
        <View style={{ width: size * 0.34, height: size * 0.24, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

// Fullscreen: four corner brackets.
function FullscreenShape({ size, color }) {
  const t = Math.max(2, Math.round(size / 11));
  const arm = size * 0.22;
  const inset = size * 0.14;
  const corner = (pos) => (
    <View
      style={{
        position: "absolute",
        width: arm,
        height: arm,
        borderColor: color,
        ...pos,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }}>
      {corner({ top: inset, left: inset, borderLeftWidth: t, borderTopWidth: t })}
      {corner({ top: inset, right: inset, borderRightWidth: t, borderTopWidth: t })}
      {corner({ bottom: inset, left: inset, borderLeftWidth: t, borderBottomWidth: t })}
      {corner({ bottom: inset, right: inset, borderRightWidth: t, borderBottomWidth: t })}
    </View>
  );
}
```

- [ ] **Step 2: Wire the cases into the `Icon` switch**

In `src/ui/Icon.native.jsx`, in the `switch (name)` block, add these cases before the `default:` case (currently `src/ui/Icon.native.jsx:321`):

```jsx
    case "audio":
      return <View {...rest}><AudioShape size={size} color={color} /></View>;
    case "cc":
      return <View {...rest}><CcShape size={size} color={color} /></View>;
    case "speed":
      return <View {...rest}><SpeedShape size={size} color={color} /></View>;
    case "aspect":
      return <View {...rest}><AspectShape size={size} color={color} /></View>;
    case "tune":
      return <View {...rest}><TuneShape size={size} color={color} /></View>;
    case "info":
      return <View {...rest}><InfoShape size={size} color={color} /></View>;
    case "timer":
      return <View {...rest}><TimerShape size={size} color={color} /></View>;
    case "pip":
      return <View {...rest}><PipShape size={size} color={color} /></View>;
    case "fullscreen":
      return <View {...rest}><FullscreenShape size={size} color={color} /></View>;
```

- [ ] **Step 3: Type/lint sanity (no render harness on native)**

Run: `node --check src/ui/Icon.native.jsx`
Expected: no output (file parses). Full visual verification happens on-device in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/ui/Icon.native.jsx
git commit -m "feat(player): add native settings icons (audio, cc, speed, aspect, tune, info, timer, pip, fullscreen)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: TV settings-row navigation reducer (pure, unit-tested)

**Files:**
- Create: `src/playback/tvSettingsNav.js`
- Test: `src/playback/tvSettingsNav.test.js`

**Interfaces:**
- Produces:
  - `INITIAL_TV_NAV = { focus: -1, inMenu: false, menuIndex: 0 }`
  - `tvNavReduce(state, key, ctx) → { state, effect }`
    - `state`: `{ focus:number, inMenu:boolean, menuIndex:number }`
    - `key`: one of `'left' | 'right' | 'up' | 'down' | 'ok' | 'back'`
    - `ctx`: `{ iconCount:number, menuLen:number, initialMenuIndex:number }`
    - `effect`: `null | { type:'apply', index:number }`
  - Contract: the reducer is only invoked while in the settings surface (`focus >= 0` or `inMenu === true`). It never emits an `exit` effect; leaving the row is expressed as `focus: -1` and the component handles Back-when-not-in-row via its legacy path. Opening a menu (`ok` while `!inMenu`) is only invoked by the component for icons that HAVE a menu.

- [ ] **Step 1: Write the failing test**

Create `src/playback/tvSettingsNav.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { INITIAL_TV_NAV, tvNavReduce } = require("./tvSettingsNav.js");

const ctx = (o = {}) => ({ iconCount: 6, menuLen: 4, initialMenuIndex: 0, ...o });

test("INITIAL_TV_NAV is not-in-row", () => {
  assert.deepEqual(INITIAL_TV_NAV, { focus: -1, inMenu: false, menuIndex: 0 });
});

test("right moves focus and clamps at last icon", () => {
  let s = { focus: 0, inMenu: false, menuIndex: 0 };
  s = tvNavReduce(s, "right", ctx({ iconCount: 3 })).state;
  assert.equal(s.focus, 1);
  s = tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "right", ctx({ iconCount: 3 })).state;
  assert.equal(s.focus, 2); // clamped
});

test("left moves focus and clamps at 0", () => {
  const s = tvNavReduce({ focus: 0, inMenu: false, menuIndex: 0 }, "left", ctx()).state;
  assert.equal(s.focus, 0);
});

test("down and back leave the row when no menu open", () => {
  assert.equal(tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "down", ctx()).state.focus, -1);
  assert.equal(tvNavReduce({ focus: 2, inMenu: false, menuIndex: 0 }, "back", ctx()).state.focus, -1);
});

test("ok in row opens the menu at the initial selection index", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: false, menuIndex: 0 }, "ok", ctx({ initialMenuIndex: 2 }));
  assert.equal(state.inMenu, true);
  assert.equal(state.menuIndex, 2);
  assert.equal(state.focus, 1);
  assert.equal(effect, null);
});

test("up/down move the menu index and clamp", () => {
  let s = { focus: 1, inMenu: true, menuIndex: 0 };
  s = tvNavReduce(s, "down", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 1);
  s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 0 }, "up", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 0); // clamped
  s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "down", ctx({ menuLen: 3 })).state;
  assert.equal(s.menuIndex, 2); // clamped at menuLen-1
});

test("ok in menu emits apply with the current index and closes the menu", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "ok", ctx());
  assert.deepEqual(effect, { type: "apply", index: 2 });
  assert.equal(state.inMenu, false);
  assert.equal(state.focus, 1); // focus retained
});

test("back in menu closes the menu without applying, keeping focus", () => {
  const { state, effect } = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 2 }, "back", ctx());
  assert.equal(effect, null);
  assert.equal(state.inMenu, false);
  assert.equal(state.focus, 1);
});

test("left/right are no-ops inside an open menu", () => {
  const s = tvNavReduce({ focus: 1, inMenu: true, menuIndex: 1 }, "right", ctx()).state;
  assert.deepEqual(s, { focus: 1, inMenu: true, menuIndex: 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/playback/tvSettingsNav.test.js`
Expected: FAIL — `Cannot find module './tvSettingsNav.js'`.

- [ ] **Step 3: Write the reducer**

Create `src/playback/tvSettingsNav.js`:

```js
/**
 * Pure D-pad navigation reducer for the TV player's settings row + menus.
 *
 * The component owns which icons are present and what each menu contains; this
 * module only moves a focus index across the row, an item index within an open
 * menu, and signals when to apply a selection.
 *
 * State: { focus, inMenu, menuIndex }
 *   focus     -1 = not in the settings row; >=0 = index into the visible icon row
 *   inMenu    true when a menu is open for the focused icon
 *   menuIndex highlighted item index within the open menu
 *
 * Only consulted while IN the settings surface (focus >= 0 or inMenu). Entering
 * the row (focus -1 -> 0) and all legacy transport keys stay in the component.
 */

const INITIAL_TV_NAV = { focus: -1, inMenu: false, menuIndex: 0 };

/**
 * @param {{focus:number, inMenu:boolean, menuIndex:number}} state
 * @param {'left'|'right'|'up'|'down'|'ok'|'back'} key
 * @param {{iconCount:number, menuLen:number, initialMenuIndex:number}} ctx
 * @returns {{ state: {focus:number,inMenu:boolean,menuIndex:number}, effect: null | {type:'apply', index:number} }}
 */
function tvNavReduce(state, key, ctx) {
  const { focus, inMenu, menuIndex } = state;
  const iconCount = Math.max(0, (ctx && ctx.iconCount) || 0);
  const menuLen = Math.max(0, (ctx && ctx.menuLen) || 0);

  if (inMenu) {
    switch (key) {
      case "up":
        return { state: { ...state, menuIndex: Math.max(0, menuIndex - 1) }, effect: null };
      case "down":
        return { state: { ...state, menuIndex: Math.min(menuLen - 1, menuIndex + 1) }, effect: null };
      case "ok":
        return { state: { ...state, inMenu: false }, effect: { type: "apply", index: menuIndex } };
      case "back":
        return { state: { ...state, inMenu: false }, effect: null };
      default:
        return { state, effect: null };
    }
  }

  // In the row (focus >= 0), no menu open.
  switch (key) {
    case "left":
      return { state: { ...state, focus: Math.max(0, focus - 1) }, effect: null };
    case "right":
      return { state: { ...state, focus: Math.min(iconCount - 1, focus + 1) }, effect: null };
    case "ok":
      return {
        state: { ...state, inMenu: true, menuIndex: Math.max(0, (ctx && ctx.initialMenuIndex) || 0) },
        effect: null,
      };
    case "down":
    case "back":
      return { state: { ...state, focus: -1 }, effect: null };
    default:
      return { state, effect: null };
  }
}

module.exports = { INITIAL_TV_NAV, tvNavReduce };
```

Note: the ES-module screens will `import { INITIAL_TV_NAV, tvNavReduce } from "../playback/tvSettingsNav"`. The repo's Metro/webpack config interops CommonJS `module.exports` with `import` (same as the existing `src/playback/*.js` logic modules consumed by the screens); `node --test` requires the CJS form. Keep `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/playback/tvSettingsNav.test.js`
Expected: PASS — all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/playback/tvSettingsNav.js src/playback/tvSettingsNav.test.js
git commit -m "feat(player/tv): pure D-pad reducer for settings-row navigation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Web/desktop — relocate settings to a bottom icon bar

**Files:**
- Modify: `src/screens/VideoPlayerScreen.web.jsx` — remove the settings controls from `S.header`; add a bottom icon bar with upward-opening menus; add styles.

**Interfaces:**
- Consumes: existing state/handlers (`openMenu`/`setOpenMenu`, `playbackRate`/`applySpeed`, `audioTracks`/`selectedAudio`/`applyAudio`, `subtitleTracks`/`selectedSubtitle`/`applySubtitle`, `aspectRatio`/`applyAspect`, `qualityLevels`/`selectedLevel`/`handleSelectLevel`/`getLevelLabel`, `pipSupported`/`pipActive`/`handleTogglePip`, `castSupported`/`handleCast`, `showStats`/`setShowStats`, `sleep`/`SLEEP_PRESETS`/`formatRemaining`, `subtitleStyle`/`subtitleOffsetMs`/`audioOffsetMs`/`handleSubtitleSettingsChange`, the menu refs, `SPEEDS`, `ASPECT_RATIOS`, `currentQualityLabel`, `SubtitleSettings`).
- No new state. Menus keep the same `openMenu` values (`"speed" | "audio" | "subtitle" | "aspect" | "quality" | "more"`).

- [ ] **Step 1: Add web bottom-bar + icon-button + upward-menu styles**

In `src/screens/VideoPlayerScreen.web.jsx`, inside the `S = { … }` object, add these style entries (e.g. after the `menuItem` entry, `src/screens/VideoPlayerScreen.web.jsx:224`):

```js
  bottomBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "wrap",
    padding: "8px 12px",
    backgroundColor: "rgba(0,0,0,0.85)",
    flexShrink: 0,
  },
  iconBtn: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: active ? accentAlpha(0.2) : "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: active ? colors.accent2 : colors.text,
    borderRadius: radii.sm,
    minWidth: 40,
    height: 40,
    padding: "0 10px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    cursor: "pointer",
    justifyContent: "center",
    whiteSpace: "nowrap",
    transition: `box-shadow ${motion.base}ms ${easing}, outline-color ${motion.fast}ms ${easing}`,
  }),
  menuUp: {
    position: "absolute",
    bottom: "115%",
    right: 0,
    backgroundColor: colors.surface2,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 4,
    minWidth: 130,
    zIndex: 100,
    maxHeight: 320,
    overflowY: "auto",
  },
```

- [ ] **Step 2: Strip the settings controls out of the header**

In `src/screens/VideoPlayerScreen.web.jsx`, in the web render's `<div style={S.header}>` (starts `src/screens/VideoPlayerScreen.web.jsx:1734`), DELETE the speed dropdown, audio dropdown, subtitle dropdown, aspect dropdown, quality dropdown, PiP button, cast button, stats button, and the "More" dropdown — i.e. everything from the `<div style={S.dropdown} ref={speedRef}>` block (line 1740) through the end of the "More" dropdown block (the `</div>` closing the `moreRef` dropdown at line 1951).

Keep in the header: the close button, the title, and the `nextEpisode` button. After the edit, the header body is exactly:

```jsx
      <div style={S.header}>
        <button style={S.closeBtn} onClick={handleClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={16} color={colors.text} />
        </button>
        <span style={S.title}>{currentVideo.name}</span>

        {nextEpisode && (
          <button
            style={S.nextBtn}
            onClick={handleNextEpisode}
            title={`Next: S${String(nextEpisode.seasonNum).padStart(2, "0")}E${String(nextEpisode.episode.episode_num).padStart(2, "0")}`}
          >
            Next <Icon name="play" size={13} color={colors.text} />
          </button>
        )}
      </div>
```

- [ ] **Step 3: Add the bottom icon bar before the footer**

In `src/screens/VideoPlayerScreen.web.jsx`, insert this block immediately AFTER the `</div>` that closes `<div style={S.videoWrapper}>` (line 2035) and BEFORE `<div style={S.footer}>` (line 2037). Every control below reuses the exact menu bodies that previously lived in the header, only re-anchored with `S.menuUp` and `S.iconBtn`:

```jsx
      {/* Bottom settings bar — icon controls, menus open upward. */}
      <div style={S.bottomBar}>
        <div style={S.dropdown} ref={speedRef}>
          <button style={S.iconBtn(openMenu === "speed")} onClick={() => setOpenMenu((m) => (m === "speed" ? null : "speed"))} title="Playback speed" aria-label="Playback speed">
            <Icon name="speed" size={18} color="currentColor" /> {playbackRate}x
          </button>
          {openMenu === "speed" && (
            <div style={S.menuUp}>
              {SPEEDS.map((r) => (
                <button key={r} style={S.menuItem(playbackRate === r)} onClick={() => { applySpeed(r); setOpenMenu(null); }}>
                  {r}x{r === 1 ? " (Normal)" : ""}
                </button>
              ))}
            </div>
          )}
        </div>

        {audioTracks.length > 1 && (
          <div style={S.dropdown} ref={audioRef}>
            <button style={S.iconBtn(openMenu === "audio")} onClick={() => setOpenMenu((m) => (m === "audio" ? null : "audio"))} title="Audio track" aria-label="Audio track">
              <Icon name="audio" size={18} color="currentColor" />
            </button>
            {openMenu === "audio" && (
              <div style={S.menuUp}>
                {audioTracks.map((t, i) => (
                  <div key={t.id ?? i} style={S.menuItem(selectedAudio === i)} onClick={() => { applyAudio(i); setOpenMenu(null); }}>
                    {t.name || `Track ${i + 1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subtitleTracks.length > 0 && (
          <div style={S.dropdown} ref={subtitleRef}>
            <button style={S.iconBtn(openMenu === "subtitle")} onClick={() => setOpenMenu((m) => (m === "subtitle" ? null : "subtitle"))} title="Subtitles" aria-label="Subtitles">
              <Icon name="cc" size={18} color="currentColor" />
            </button>
            {openMenu === "subtitle" && (
              <div style={S.menuUp}>
                <button style={S.menuItem(selectedSubtitle === -1)} onClick={() => { applySubtitle(-1); setOpenMenu(null); }}>
                  Off
                </button>
                {subtitleTracks.map((t, i) => (
                  <button key={t.id ?? i} style={S.menuItem(selectedSubtitle === i)} onClick={() => { applySubtitle(i); setOpenMenu(null); }}>
                    {t.name || `Track ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={S.dropdown} ref={aspectRef}>
          <button style={S.iconBtn(openMenu === "aspect")} onClick={() => setOpenMenu((m) => (m === "aspect" ? null : "aspect"))} title="Aspect ratio" aria-label="Aspect ratio">
            <Icon name="aspect" size={18} color="currentColor" />
          </button>
          {openMenu === "aspect" && (
            <div style={S.menuUp}>
              {ASPECT_RATIOS.map(({ value, label }) => (
                <button key={value} style={S.menuItem(aspectRatio === value)} onClick={() => { applyAspect(value); setOpenMenu(null); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {qualityLevels.length > 1 && (
          <div style={S.dropdown} ref={qualityRef}>
            <button style={S.iconBtn(openMenu === "quality")} onClick={() => setOpenMenu((m) => (m === "quality" ? null : "quality"))} title="Quality" aria-label="Quality">
              <Icon name="settings" size={18} color="currentColor" /> {currentQualityLabel}
            </button>
            {openMenu === "quality" && (
              <div style={S.menuUp}>
                <button style={S.menuItem(selectedLevel === -1)} onClick={() => handleSelectLevel(-1)}>
                  Auto
                </button>
                {[...qualityLevels]
                  .map((l, i) => ({ l, i }))
                  .sort((a, b) => (b.l.height || 0) - (a.l.height || 0))
                  .map(({ l, i }) => (
                    <button key={`${l.height}-${l.bitrate}`} style={S.menuItem(selectedLevel === i)} onClick={() => handleSelectLevel(i)}>
                      {getLevelLabel(l, qualityLevels)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {pipSupported && (
          <button style={S.iconBtn(pipActive)} onClick={handleTogglePip} title="Picture-in-Picture (p)" aria-label="Picture-in-Picture">
            <Icon name="pip" size={18} color="currentColor" />
          </button>
        )}

        {castSupported && (
          <button style={S.iconBtn(false)} onClick={handleCast} title="Cast / AirPlay" aria-label="Cast">
            <Icon name="cast" size={18} color="currentColor" />
          </button>
        )}

        <button style={S.iconBtn(showStats)} onClick={() => setShowStats((v) => !v)} title="Stats for nerds (i)" aria-label="Stats">
          <Icon name="info" size={18} color="currentColor" />
        </button>

        <div style={S.dropdown} ref={moreRef}>
          <button style={S.iconBtn(openMenu === "more" || sleep.active)} onClick={() => setOpenMenu((m) => (m === "more" ? null : "more"))} title="Subtitle tuning & sleep timer" aria-label="More settings">
            <Icon name="tune" size={18} color="currentColor" />
            {sleep.active ? ` ${formatRemaining(sleep.secondsLeft)}` : ""}
          </button>
          {openMenu === "more" && (
            <div style={{ ...S.menuUp, minWidth: 300, padding: 0, maxHeight: 520 }}>
              <SubtitleSettings
                style={subtitleStyle}
                subtitleOffsetMs={subtitleOffsetMs}
                audioOffsetMs={audioOffsetMs}
                onChange={handleSubtitleSettingsChange}
              />
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${colors.border}` }}>
                <div style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginBottom: 8 }}>
                  Sleep timer
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SLEEP_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      style={S.menuItem(false)}
                      onClick={() => {
                        if (p.kind === "end-of-episode") {
                          sleep.cancel();
                        } else if (p.minutes) {
                          sleep.start(p.minutes);
                        }
                        setOpenMenu(null);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  {sleep.active && (
                    <button style={{ ...S.menuItem(false), color: colors.danger }} onClick={() => { sleep.cancel(); setOpenMenu(null); }}>
                      Cancel timer
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
```

Note: the outside-click dismissal effect (`src/screens/VideoPlayerScreen.web.jsx:996`) already references all six refs (`qualityRef, speedRef, audioRef, subtitleRef, aspectRef, moreRef`) — no change needed; the refs simply moved with their dropdowns.

- [ ] **Step 4: Compile the web/TV bundle**

Run: `npm run build:web`
Expected: build succeeds, no unused-variable errors for the moved refs/handlers (all remain used).

- [ ] **Step 5: Manual runtime check**

Run: `npm run web`. Open a VOD stream. Confirm: top header shows only close + title (+ Next when applicable); the bottom bar shows the settings icons right-aligned; each menu opens upward; speed shows "1x"; selections apply and the menu closes; clicking outside closes the menu; `p`/`i` shortcuts still work.

- [ ] **Step 6: Commit**

```bash
git add src/screens/VideoPlayerScreen.web.jsx
git commit -m "feat(player/web): move settings into a bottom icon bar with upward menus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Native — relocate settings into an icon row above the seek bar

**Files:**
- Modify: `src/screens/VideoPlayerScreen.native.jsx` — remove the settings buttons from the top control row; add a bottom control container (icon row + existing seek bar) inside `showControls`.

**Interfaces:**
- Consumes: existing handlers/state (`speed`, `setShowSpeedMenu`, `setShowAudioMenu`, `setShowSubtitleMenu`, `audioTracks`, `subtitleTracks`, `setShowSubtitleSettings`, `cycleContentFit`, `contentFit`, `toggleFullscreen`, `isFullscreen`, `showStats`, `setShowStats`, `sleep`, `setShowSleepMenu`, `handlePip`, `nextEpisode`, `handleNextEpisode`, `progress`, `scrubSec`, `scrubToX`, `commitScrub`, `seekTrackWidth`, `insets`, `isLive`). All four `<Modal>` menus stay exactly as-is.
- No new state.

- [ ] **Step 1: Strip settings buttons from the top control row**

In `src/screens/VideoPlayerScreen.native.jsx`, in the top-controls `<XStack …>` (starts `src/screens/VideoPlayerScreen.native.jsx:746`), DELETE the following buttons: speed (line 761-763), audio (765-767), subtitle (769-771), Tune (774), aspect cycle (777), fullscreen (780), stats (783), sleep (786), PiP (789). KEEP: the close `YStack`, the title `Text`, the live channel-zap buttons, and the `nextEpisode` button.

After the edit the top `XStack` inner content is exactly:

```jsx
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" flexWrap="wrap" gap={8}>
            <YStack width={34} height={34} backgroundColor={accentAlpha(0.9)} borderRadius={17} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Icon name="close" size={16} color={colors.text} />
            </YStack>

            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>

            {isLive && channels.length > 1 && (
              <>
                <Button variant="secondary" size="sm" icon="back" onPress={() => zapChannel("prev")}>Ch</Button>
                <Button variant="secondary" size="sm" icon="chevron-right" onPress={() => zapChannel("next")}>Ch</Button>
              </>
            )}

            {nextEpisode && (
              <Button variant="primary" size="sm" icon="play" onPress={handleNextEpisode}>Next</Button>
            )}
          </XStack>
```

- [ ] **Step 2: Replace the bottom seek-bar block with a bottom container (icon row + seek bar)**

In `src/screens/VideoPlayerScreen.native.jsx`, REPLACE the entire "Bottom seek bar (VOD only)" block (the IIFE starting `{showControls && !isLive && progress.duration > 0 && (() => {` at line 815 through its closing `})()}` at line 842) with the following. This introduces a single bottom container that always shows the icon row while controls are visible, and shows the seek bar below it for VOD:

```jsx
      {/* Bottom control container — settings icon row + (VOD) seek bar */}
      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} backgroundColor="rgba(0,0,0,0.7)" zIndex={20}>
          {/* Settings icon row (horizontally scrollable so it never overflows). */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            {!isLive && (
              <Button variant="secondary" size="sm" icon="speed" onPress={() => { setShowSpeedMenu(true); setShowAudioMenu(false); setShowSubtitleMenu(false); }}>{`${speed}x`}</Button>
            )}
            {audioTracks.length > 1 && (
              <Button variant="secondary" size="sm" icon="audio" onPress={() => { setShowAudioMenu(true); setShowSpeedMenu(false); setShowSubtitleMenu(false); }} />
            )}
            {subtitleTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon="cc" onPress={() => { setShowSubtitleMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); }} />
            )}
            <Button variant="secondary" size="sm" icon="tune" onPress={() => setShowSubtitleSettings(true)} />
            <Button variant="secondary" size="sm" icon="aspect" onPress={cycleContentFit} />
            <Button variant={isFullscreen ? "primary" : "secondary"} size="sm" icon="fullscreen" onPress={toggleFullscreen} />
            <Button variant={showStats ? "primary" : "secondary"} size="sm" icon="info" onPress={() => setShowStats((s) => !s)} />
            <Button variant={sleep.active ? "primary" : "secondary"} size="sm" icon="timer" onPress={() => setShowSleepMenu(true)}>{sleep.active ? formatRemaining(sleep.secondsLeft) : undefined}</Button>
            <Button variant="secondary" size="sm" icon="pip" onPress={handlePip} />
          </ScrollView>

          {/* Seek bar (VOD only) */}
          {!isLive && progress.duration > 0 && (() => {
            const shown = scrubSec != null ? scrubSec : progress.position;
            const playedPct = Math.max(0, Math.min(100, (shown / progress.duration) * 100));
            const bufferedPct = Math.max(0, Math.min(100, (progress.buffered / progress.duration) * 100));
            return (
              <YStack paddingHorizontal={16} paddingTop={4}>
                <View
                  style={{ height: 26, justifyContent: "center" }}
                  onLayout={(e) => { seekTrackWidth.current = e.nativeEvent.layout.width; }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderRelease={commitScrub}
                  onResponderTerminate={commitScrub}
                >
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${bufferedPct}%`, backgroundColor: "rgba(255,255,255,0.4)" }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                  <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
                </View>
                <XStack justifyContent="space-between" marginTop={4}>
                  <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shown)}</Text>
                  <Text color={colors.muted} fontSize={12}>{formatTime(progress.duration)}</Text>
                </XStack>
              </YStack>
            );
          })()}
        </YStack>
      )}
```

Notes:
- `ScrollView` is already imported from `../ui/primitives` (`src/screens/VideoPlayerScreen.native.jsx:7`). `formatRemaining` is already imported (line 22). `formatTime` and all handlers referenced are already in scope.
- The sleep button passes `undefined` children when inactive so the icon-only Button renders just the `timer` icon (Button renders children only when `!= null`, `src/ui/Button.native.jsx:77`).
- The standalone sleep countdown badge at `src/screens/VideoPlayerScreen.native.jsx:716` (the `sleep.active` `XStack` bottom-left) now overlaps the new bottom bar's remaining-time label. DELETE that badge block (lines 715-720) to avoid duplication — the timer button now shows the remaining time.

- [ ] **Step 3: Parse check**

Run: `node --check src/screens/VideoPlayerScreen.native.jsx`
Expected: no output (file parses). Full verification is on-device (Step 4).

- [ ] **Step 4: Manual runtime check (device/simulator)**

Run: `npm run dev:ios` (or `dev:android`). Open a VOD stream: confirm the top bar shows only close + title (+ Next); a horizontally-scrollable icon row sits above the seek bar; each icon opens its existing modal (speed/audio/CC/tune/sleep) or toggles its action (aspect/fullscreen/stats/PiP); the seek bar still scrubs; controls still auto-hide after 4s. Open a live stream: confirm the icon row shows without a seek bar and channel-zap stays in the top bar.

- [ ] **Step 5: Commit**

```bash
git add src/screens/VideoPlayerScreen.native.jsx
git commit -m "feat(player/native): move settings into an icon row above the seek bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: TV — settings icon row + D-pad menus

**Files:**
- Modify: `src/screens/VideoPlayerScreen.web.jsx` — TV render (`if (isTV)` block, `src/screens/VideoPlayerScreen.web.jsx:1602`) and its keydown handler (`src/screens/VideoPlayerScreen.web.jsx:1190`); add TV settings styles and state; import the reducer.

**Interfaces:**
- Consumes: `INITIAL_TV_NAV`, `tvNavReduce` (Task 3); existing `playbackRate`/`applySpeed`, `audioTracks`/`selectedAudio`/`applyAudio`, `subtitleTracks`/`selectedSubtitle`/`applySubtitle`, `aspectRatio`/`applyAspect`, `ASPECT_RATIOS`, `qualityLevels`/`selectedLevel`/`handleSelectLevel`/`getLevelLabel`, `SPEEDS`, `showStats`/`setShowStats`, `tvControlsVisible`/`setTvControlsVisible`/`showTvControls`, `controlsTimerRef`, `isLive`.
- Produces: new state `tvNav` (`{ focus, inMenu, menuIndex }`); a memoized `tvSettingsItems` descriptor array.

- [ ] **Step 1: Import the reducer**

In `src/screens/VideoPlayerScreen.web.jsx`, add near the other playback imports (e.g. after line 16):

```js
import { INITIAL_TV_NAV, tvNavReduce } from "../playback/tvSettingsNav";
```

- [ ] **Step 2: Add TV settings styles**

In `src/screens/VideoPlayerScreen.web.jsx`, inside the `TV = { … }` object, add after the `seekHint` entry (`src/screens/VideoPlayerScreen.web.jsx:356`):

```js
  settingsRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 6,
  },
  settingsIcon: (focused) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 56,
    minWidth: 56,
    padding: "0 16px",
    borderRadius: radii.sm,
    background: focused ? accentAlpha(0.25) : "rgba(255,255,255,0.12)",
    border: focused ? `3px solid ${colors.accent2}` : "3px solid transparent",
    color: colors.text,
    fontSize: 20,
    fontWeight: 700,
  }),
  settingsMenu: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: 12,
    minWidth: 260,
    maxHeight: 380,
    overflowY: "auto",
    background: "rgba(20,20,24,0.98)",
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 6,
  },
  settingsMenuItem: (highlighted, active) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: radii.sm,
    fontSize: 20,
    fontWeight: active ? 700 : 500,
    color: active ? colors.accent2 : colors.text,
    background: highlighted ? accentAlpha(0.3) : "transparent",
  }),
```

- [ ] **Step 3: Add TV nav state + the settings descriptor**

In `src/screens/VideoPlayerScreen.web.jsx`, add state next to the other TV-specific state (`src/screens/VideoPlayerScreen.web.jsx:393`):

```js
  const [tvNav, setTvNav] = useState(INITIAL_TV_NAV);
```

Then, immediately BEFORE the `if (isTV) {` return (i.e. right after the `busyOverlay`/`fatalMessage` consts around `src/screens/VideoPlayerScreen.web.jsx:1600`), add the descriptor + refs used by the keydown handler:

```js
  // TV settings descriptor: the ordered, currently-available icons and, for
  // menu icons, their items + current selection. Rebuilt each render (cheap).
  // `action` icons (stats) have no items — OK toggles them directly.
  const tvSortedLevels = [...qualityLevels]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (b.l.height || 0) - (a.l.height || 0));
  const tvSettingsItems = [
    {
      key: "speed",
      icon: "speed",
      label: `${playbackRate}x`,
      items: SPEEDS.map((r) => ({ label: `${r}x${r === 1 ? " (Normal)" : ""}`, active: playbackRate === r, run: () => applySpeed(r) })),
      selected: Math.max(0, SPEEDS.indexOf(playbackRate)),
    },
    audioTracks.length > 1 && {
      key: "audio",
      icon: "audio",
      items: audioTracks.map((t, i) => ({ label: t.name || `Track ${i + 1}`, active: selectedAudio === i, run: () => applyAudio(i) })),
      selected: Math.max(0, selectedAudio),
    },
    subtitleTracks.length > 0 && {
      key: "subtitle",
      icon: "cc",
      items: [
        { label: "Off", active: selectedSubtitle === -1, run: () => applySubtitle(-1) },
        ...subtitleTracks.map((t, i) => ({ label: t.name || `Track ${i + 1}`, active: selectedSubtitle === i, run: () => applySubtitle(i) })),
      ],
      selected: selectedSubtitle === -1 ? 0 : selectedSubtitle + 1,
    },
    {
      key: "aspect",
      icon: "aspect",
      items: ASPECT_RATIOS.map(({ value, label }) => ({ label, active: aspectRatio === value, run: () => applyAspect(value) })),
      selected: Math.max(0, ASPECT_RATIOS.findIndex(({ value }) => value === aspectRatio)),
    },
    qualityLevels.length > 1 && {
      key: "quality",
      icon: "settings",
      items: [
        { label: "Auto", active: selectedLevel === -1, run: () => handleSelectLevel(-1) },
        ...tvSortedLevels.map(({ l, i }) => ({ label: getLevelLabel(l, qualityLevels), active: selectedLevel === i, run: () => handleSelectLevel(i) })),
      ],
      selected: selectedLevel === -1 ? 0 : (tvSortedLevels.findIndex(({ i }) => i === selectedLevel) + 1),
    },
    {
      key: "stats",
      icon: "info",
      action: () => setShowStats((v) => !v),
    },
  ].filter(Boolean);

  // Mirror nav state + the descriptor into refs so the global keydown listener
  // (registered once, in capture phase) always reads the latest without needing
  // to re-subscribe each render.
  tvNavRef.current = tvNav;
  tvSettingsItemsRef.current = tvSettingsItems;
```

And declare those two refs near the other TV refs (`src/screens/VideoPlayerScreen.web.jsx:393`, alongside `tvNav`):

```js
  const tvNavRef = useRef(INITIAL_TV_NAV);
  const tvSettingsItemsRef = useRef([]);
```

- [ ] **Step 4: Route D-pad keys to the settings reducer in the keydown handler**

In `src/screens/VideoPlayerScreen.web.jsx`, in the keydown `onKey` handler, insert the settings-routing block immediately AFTER `if (isTV) showTvControls();` (line 1196) and BEFORE the `if (isTV && (k === 38 || k === 40))` channel block (line 1200):

```jsx
      // ── TV settings-row routing ──────────────────────────────────────────
      // While in the settings surface (row focused or a menu open), D-pad keys
      // drive the reducer instead of transport. Entry: Up when controls are
      // visible and not yet in the row.
      if (isTV) {
        const nav = tvNavRef.current;
        const items = tvSettingsItemsRef.current;
        const inSettings = nav.focus >= 0 || nav.inMenu;

        // Normalise this key to a nav verb (null if not a nav key).
        const norm =
          e.key === "ArrowLeft" || k === 37 ? "left"
          : e.key === "ArrowRight" || k === 39 ? "right"
          : e.key === "ArrowUp" || k === 38 ? "up"
          : e.key === "ArrowDown" || k === 40 ? "down"
          : e.key === "Enter" || k === 13 ? "ok"
          : TV_KEYS.BACK.has(k) ? "back"
          : null;

        if (!inSettings && norm === "up" && tvControlsVisible) {
          // Enter the row. (Overrides live channel-up; see plan decisions.)
          e.preventDefault();
          setTvControlsVisible(true);
          clearTimeout(controlsTimerRef.current);
          setTvNav((n) => ({ ...n, focus: 0 }));
          return;
        }

        if (inSettings && norm) {
          e.preventDefault();
          // Keep controls pinned while navigating settings.
          setTvControlsVisible(true);
          clearTimeout(controlsTimerRef.current);

          const focusItem = items[nav.focus];
          // OK on an action icon (no menu) toggles it directly.
          if (norm === "ok" && !nav.inMenu && focusItem && !focusItem.items) {
            focusItem.action?.();
            return;
          }
          const ctx = {
            iconCount: items.length,
            menuLen: focusItem && focusItem.items ? focusItem.items.length : 0,
            initialMenuIndex: focusItem ? focusItem.selected || 0 : 0,
          };
          const { state: ns, effect } = tvNavReduce(nav, norm, ctx);
          setTvNav(ns);
          if (effect && effect.type === "apply" && focusItem && focusItem.items) {
            focusItem.items[effect.index]?.run?.();
          }
          // Leaving the row (focus back to -1): resume the normal hide timer.
          if (ns.focus < 0 && !ns.inMenu) {
            controlsTimerRef.current = setTimeout(() => setTvControlsVisible(false), 4000);
          }
          return;
        }
      }
```

Note: the keydown effect's dependency array (`src/screens/VideoPlayerScreen.web.jsx:1311`) does NOT need new entries — the handler reads nav state and items via refs, and `setTvNav`/`setTvControlsVisible`/`clearTimeout`/`controlsTimerRef`/`TV_KEYS`/`tvNavReduce` are stable or module-level. `tvControlsVisible` is read fresh via closure only in the entry guard; if lint flags it, add `tvControlsVisible` to the dep array (it already re-subscribes on many deps, so this is harmless).

- [ ] **Step 5: Render the settings row + menu in the TV bottom bar**

In `src/screens/VideoPlayerScreen.web.jsx`, in the TV render's `<div style={TV.bottomBar}>` (line 1670), insert the settings row as the FIRST child, before the `{currentVideo.type !== "live" ? (` progress block:

```jsx
          <div style={TV.bottomBar}>
            {/* Settings icon row + upward menu */}
            <div style={TV.settingsRow}>
              {tvSettingsItems.map((item, idx) => {
                const focused = !tvNav.inMenu && tvNav.focus === idx;
                const menuOpen = tvNav.inMenu && tvNav.focus === idx;
                return (
                  <div key={item.key} style={{ position: "relative" }}>
                    <div style={TV.settingsIcon(focused || menuOpen)}>
                      <Icon name={item.icon} size={26} color="currentColor" />
                      {item.label ? <span>{item.label}</span> : null}
                    </div>
                    {menuOpen && item.items && (
                      <div style={TV.settingsMenu}>
                        {item.items.map((mi, mIdx) => (
                          <div key={mi.label} style={TV.settingsMenuItem(tvNav.menuIndex === mIdx, mi.active)}>
                            <span>{mi.label}</span>
                            {mi.active ? <Icon name="check" size={20} color={colors.accent2} /> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {currentVideo.type !== "live" ? (
```

(The existing progress/time and live-hint content that follows is unchanged; only the settings row was prepended and the `<div style={TV.bottomBar}>` opening tag now has the row before the ternary.)

- [ ] **Step 6: Reset nav state on source change**

In `src/screens/VideoPlayerScreen.web.jsx`, in the per-source reset effect (the one that resets UI state on `currentVideo?.url`, around `src/screens/VideoPlayerScreen.web.jsx:654-672`), add:

```js
    setTvNav(INITIAL_TV_NAV);
```

(place it alongside the other `setX(...)` resets, e.g. after `setOpenMenu(null);`).

- [ ] **Step 7: Compile the web/TV bundle**

Run: `npm run build:web`
Expected: build succeeds; no unused-import/variable errors.

- [ ] **Step 8: TV runtime check (simulator)**

Run: `npm run sim:lg` (LG webOS simulator). Open a VOD stream, reveal controls (any key), press **Up** to focus the settings row (first icon shows the focus ring); **Left/Right** move across icons; **OK** opens a menu opening upward with the current selection highlighted; **Up/Down** move within the menu; **OK** applies + closes; **Back** closes the menu (focus stays on the row); **Down/Back** from the row exits back to transport; confirm **Left/Right seek** and **OK play/pause** still work when NOT in the row; confirm **stats (info)** toggles on OK. Repeat for a live stream (no progress bar; audio/CC/aspect/stats reachable).

- [ ] **Step 9: Run the full logic test suite (regression)**

Run: `npm test`
Expected: all `node --test` suites pass (including the new `tvSettingsNav.test.js`).

- [ ] **Step 10: Commit**

```bash
git add src/screens/VideoPlayerScreen.web.jsx
git commit -m "feat(player/tv): D-pad settings icon row + upward menus in the bottom bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- New icons (spec §1) → Task 1 (web/TV) + Task 2 (native). `settings` already exists on web and resolves via glyph on native; native uses `tune` for the tune button, so `settings` is not needed in the native row (noted). `cast`/`pip` web-only, added in Task 1; native keeps its own PiP + fullscreen (Task 2 adds `pip`, `fullscreen`).
- Icon mapping (spec §2) → Tasks 4/5/6 use exactly the mapped glyphs; speed keeps its "1x" label on all three; quality uses `settings`; stats uses `info`; sleep/tune uses `tune` (web) / `timer` + `tune` (native).
- Web layout (spec §3) → Task 4 (header trimmed to close+title+Next; right-aligned bottom icon bar; upward menus reusing `openMenu`).
- Native layout (spec §3) → Task 5 (icon row above seek bar inside `showControls`; existing modals unchanged).
- TV net-new menus + focus model (spec §3 + focus model) → Task 3 (reducer) + Task 6 (row, upward menus, key routing, wired to existing hls handlers). Entry/exit gap resolved in "Decisions" (Up to enter; Down/Back to leave).
- Non-goals (spec §4) → no engine/prefs/recovery changes; no shared component; menu contents unchanged; web shortcuts retained (the keydown handler's `p`/`i`/`[`/`]`/arrows paths are untouched except the added early settings-routing return, which only fires when in the settings surface).
- Testing (spec §5) → each render task has a build + manual runtime step; reducer has automated tests; `npm test` regression in Task 6.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; no "add error handling" hand-waves.

**Type consistency:** Reducer signature `tvNavReduce(state, key, ctx) → { state, effect }` and `INITIAL_TV_NAV` are used identically in Task 3 (definition/tests) and Task 6 (consumer). `tvSettingsItems` item shape (`{ key, icon, label?, items?, selected?, action? }`) is consistent between the descriptor (Step 3), the key handler (Step 4: reads `.items`, `.selected`, `.action`), and the render (Step 5: reads `.icon`, `.label`, `.items[].label/.active/.run`). `effect.index` from the reducer indexes `focusItem.items` in the handler — consistent.

**Known cosmetic risk to verify at runtime (not a blocker):** the native `timer` button showing `formatRemaining(...)` text only when active changes that button's width when the sleep timer starts; the horizontal `ScrollView` absorbs it. Confirm during Task 5 Step 4.

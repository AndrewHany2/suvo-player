import { useState, useEffect, useRef } from "react";
import { YStack, XStack, Text } from "../ui/primitives";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import { colors, accentAlpha, fonts } from "../ui/tokens";
import { useApp, usePlayback, useSearch } from "../context/AppContext";
import { useAppGate } from "./useAppGate";
import { ss } from "../utils/scaleSize";
import { isMacCommand } from "../platform/adapters/input/keys";

import AuthScreen from "../screens/AuthScreen";
import ConfigErrorScreen from "../screens/ConfigErrorScreen";
import DeviceLockedScreen from "../screens/DeviceLockedScreen";
import ProfilesScreen from "../screens/ProfilesScreen";
// Per-platform screen variants are resolved at BUILD time. Both web/electron
// and webOS-TV build with `expo export --platform web`, so Metro can't pick the
// .tv variant by platform extension. The TV build sets EXPO_PUBLIC_TV=1
// (package.json build:tv) and the metro.config.js resolver swaps these .web
// specifiers to their .tv siblings — so each bundle ships ONLY its own screen
// tree (the other variant is never resolved, hence never bundled, even under
// web.output:single). Authoring stays on the .web path; runtime
// globalThis.__TV__ (set by patch-index) still gates non-import TV behavior.
import LiveTVScreen from "../screens/LiveTVScreen.web";
import MoviesScreen from "../screens/MoviesScreen.web";
import SeriesScreen from "../screens/SeriesScreen.web";
import HistoryScreen from "../screens/HistoryScreen.web";
import AccountsScreen from "../screens/AccountsScreen";
import VideoPlayerScreen from "../screens/VideoPlayerScreen";
import SettingsScreen from "../screens/SettingsScreen.web";
import { usePlatform } from "../platform/PlatformProvider";
import { go as historyGo, resolveBack } from "./tabHistory";


// ── Global CSS injected once ──────────────────────────────────────────────────
// token-mirror block: the hex literals inside the CSS template string below
// intentionally duplicate the values in src/ui/tokens.js. They are kept literal
// (not var()) because old webOS Chromium can't be assumed to support custom
// properties — kept in sync manually with tokens.js.
if (typeof document !== "undefined") {
  let style = document.getElementById("suvo-global");
  if (!style) {
    style = document.createElement("style");
    style.id = "suvo-global";
    document.head.appendChild(style);
  }
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    /* Respect the OS "reduce motion" setting: near-zero (not none, so end
       states still apply) durations + a single iteration kill the infinite
       spinner/blink and all hover transitions for motion-sensitive users. */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
    }
    html, body { margin: 0; padding: 0; height: 100%; background: #0A0E1A; color: #EAF0FF; font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; }
    /* translateZ(0) in both frames GPU-composites the rotation so it keeps
       spinning smoothly on webOS even while the main thread is busy (e.g. big
       catalog parse) instead of freezing. */
    @keyframes suvo-spin { from { transform: translateZ(0) rotate(0deg); } to { transform: translateZ(0) rotate(360deg); } }
    #root, #app, [data-reactroot] { height: 100%; }
    .aurora-grad-bg { background: linear-gradient(100deg, #6C5CE7, #22D3EE) !important; }
    * { scrollbar-width: thin; scrollbar-color: #28324E transparent; }
    ::-webkit-scrollbar { width: ${ss(8)}px; height: ${ss(8)}px; }
    ::-webkit-scrollbar-thumb { background: #28324E; border-radius: ${ss(4)}px; }
    ::-webkit-scrollbar-track { background: transparent; }
    input:focus, textarea:focus {
      outline: none !important;
      border-color: #22D3EE !important;
      box-shadow: 0 0 0 ${ss(3)}px rgba(34,211,238,0.18) !important;
    }
    .suvo-topnav { position: sticky !important; top: 0 !important; z-index: 30 !important; }
    /* Dim + shield behind showModal() dialogs (Accounts / Settings). The native
       ::backdrop is transparent by default; this restores the dark scrim the old
       hand-rolled backdrop div carried. Plain rgba — TV-safe (no gradient). */
    dialog::backdrop { background: rgba(0,0,0,0.7); }
    .suvo-poster {
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
      cursor: pointer !important;
    }
    /* Unified Aurora hover language (matches PosterCard.web): cyan ring + soft
       glow on the inner .suvo-poster-box ONLY (the image, never the title), no
       scale. The outer card must NOT clip overflow or the glow gets cropped. */
    body:not(.keyboard-nav) .suvo-poster:hover .suvo-poster-box,
    body:not(.keyboard-nav) .suvo-cw-card:hover .suvo-poster-box {
      box-shadow: 0 0 0 2px #22D3EE, 0 0 24px 2px rgba(34,211,238,0.55);
      border-color: #22D3EE; z-index: 2;
    }
    .suvo-live-card { transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.2s ease; cursor: pointer !important; }
    /* Same Aurora hover language as posters: cyan ring + soft glow. The ring is
       the element's own BORDER (border-box → no layout shift, never clipped by a
       scroll rail's overflow), NOT an outset box-shadow, which would get cropped
       top/bottom. The box-shadow is only the soft ambient glow. !important beats
       the card's inline Tamagui border/background. */
    body:not(.keyboard-nav) .suvo-live-card:hover { border-color: #22D3EE !important; border-width: 2px !important; box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55) !important; }
    /* Discover category pills — cyan ring + glow on hover, matching posters.
       !important overrides the pill's inline box-shadow:none / border resting style. */
    .suvo-discover-pill { transition: border-color 0.15s ease, box-shadow 0.2s ease; cursor: pointer !important; }
    body:not(.keyboard-nav) .suvo-discover-pill:hover { border-color: #22D3EE !important; box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55) !important; }
    body:not(.keyboard-nav) .suvo-icon-btn:hover { background: rgba(255,255,255,0.10) !important; }
    body:not(.keyboard-nav) .suvo-avatar:hover { border-color: #6C5CE7 !important; }
    .suvo-shelf-nav {
      opacity: 0; transition: opacity 0.15s;
      position: absolute; top: 0; bottom: 0; z-index: 4;
      display: flex; align-items: center;
      background: linear-gradient(to right, rgba(10, 14, 26,0.95), rgba(10, 14, 26,0));
      border: none; cursor: pointer; color: #EAF0FF; font-size: ${ss(28)}px; padding: 0 ${ss(14)}px; width: ${ss(56)}px;
    }
    .suvo-shelf-nav.right { background: linear-gradient(to left, rgba(10, 14, 26,0.95), rgba(10, 14, 26,0)); right: 0; left: auto; justify-content: flex-end; }
    body:not(.keyboard-nav) .suvo-shelf-rail:hover .suvo-shelf-nav { opacity: 1; }
    /* Keyboard reveal: hover alone hides these arrows from Tab users (they'd
       focus an invisible control). Reveal on focus (own :focus-visible, and
       :focus-within so a focused arrow keeps its pair visible). Not gated by
       keyboard-nav — this must fire precisely during keyboard navigation. */
    .suvo-shelf-nav:focus-visible,
    .suvo-shelf-rail:focus-within .suvo-shelf-nav { opacity: 1; }
    .suvo-live-dot {
      display: inline-flex; align-items: center; gap: ${ss(5)}px;
      font-size: ${ss(10)}px; font-weight: 700; color: #7A86A8; letter-spacing: 0.08em;
    }
    .suvo-live-dot::before {
      content: ''; width: ${ss(6)}px; height: ${ss(6)}px; border-radius: 50%;
      background: #6ABF69; flex-shrink: 0;
    }
    .suvo-cw-card {
      border-radius: ${ss(8)}px; transition: box-shadow 0.2s ease, border-color 0.2s ease;
      cursor: pointer !important; position: relative !important;
    }
    .suvo-cw-play {
      position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.15s ease;
      font-size: ${ss(38)}px; color: #EAF0FF; pointer-events: none; z-index: 5;
    }
    body:not(.keyboard-nav) .suvo-cw-card:hover .suvo-cw-play { opacity: 1; }
    .suvo-shelf-title-btn { cursor: pointer !important; }
    body:not(.keyboard-nav) .suvo-shelf-title-btn:hover span, body:not(.keyboard-nav) .suvo-shelf-title-btn:hover div { opacity: 0.8; }
    .suvo-load-cta { cursor: pointer !important; transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease; }
    body:not(.keyboard-nav) .suvo-load-cta:hover { background: rgba(108, 92, 231,0.12) !important; border-color: rgba(108, 92, 231,0.45) !important; transform: translateY(-1px); }
    /* Keyboard focus for the top-nav items + icon actions (WCAG 2.1.1 / 2.4.7):
       cyan (accent2) ring, offset 2. The remote-driven index ring (isFocused)
       still paints its own cyan affordance separately; this only fires for real
       keyboard/DOM :focus-visible on desktop. */
    .suvo-navlink:focus-visible, .suvo-navicon:focus-visible {
      outline: 2px solid #22D3EE; outline-offset: 2px; border-radius: 6px;
    }
    /* Keyboard focus (:focus-visible) on interactive cards/pills — mirrors the
       Aurora hover ring so Tab users get the same cyan affordance the mouse does,
       independent of the keyboard-nav hover suppression above. */
    .suvo-poster-card:focus-visible, .suvo-poster:focus-visible, .suvo-cw-card:focus-visible,
    .suvo-live-card:focus-visible, .suvo-discover-pill:focus-visible,
    .suvo-episode-row:focus-visible { outline: none; }
    .suvo-poster-card:focus-visible .suvo-poster-box {
      box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55) !important;
      border-color: #22D3EE !important; border-width: 2px !important; z-index: 2;
    }
    .suvo-poster:focus-visible .suvo-poster-box,
    .suvo-cw-card:focus-visible .suvo-poster-box {
      box-shadow: 0 0 0 2px #22D3EE, 0 0 24px 2px rgba(34,211,238,0.55); border-color: #22D3EE; z-index: 2;
    }
    .suvo-live-card:focus-visible { border-color: #22D3EE !important; border-width: 2px !important; box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55) !important; }
    .suvo-discover-pill:focus-visible { border-color: #22D3EE !important; box-shadow: 0 0 0 1px rgba(34,211,238,0.6), 0 0 24px 2px rgba(34,211,238,0.55) !important; }
    /* Episode-list rows (SeriesDetail): web primitives drop hoverStyle, so the
       hover/focus border is drawn here — cyan (accent2), honoring Single-Light. */
    .suvo-episode-row { transition: border-color 0.15s ease; }
    body:not(.keyboard-nav) .suvo-episode-row:hover { border-color: #22D3EE !important; }
    .suvo-episode-row:focus-visible { outline: none; border-color: #22D3EE !important; }
    ${
      globalThis.__TV__
        ? `
      *, *::before, *::after { transition: none !important; animation: none !important; will-change: auto !important; }
      .suvo-poster:hover .suvo-poster-box, .suvo-cw-card:hover .suvo-poster-box { box-shadow: none !important; border-color: #28324E !important; }
      .suvo-live-card:hover { border-color: #28324E !important; background-color: #1B2236 !important; box-shadow: none !important; }
      .suvo-discover-pill:hover { box-shadow: none !important; border-color: #28324E !important; }
      .suvo-load-cta:hover { transform: none !important; }
      .suvo-shelf-rail { contain: layout style; }
    `
        : ""
    }
  `;
}

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "live", label: "Live" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Series" },
];

const CONTENT_MAP = {
  live: LiveTVScreen,
  movies: MoviesScreen,
  series: SeriesScreen,
  home: HistoryScreen,
};

// Promote a <dialog> to a true modal the instant it mounts: showModal() gives a
// native focus trap, an inert (background-shielding) ::backdrop, and restores
// focus to the opener on close — none of which plain `<dialog open>` provides.
// Guard on !open so a re-render (which re-runs the ref callback) doesn't call
// showModal() on an already-open dialog, which throws.
const openAsModal = (el) => {
  if (el && !el.open) el.showModal();
};

function BrandGlyph() {
  const bars = [
    { h: ss(7), o: 1.0 },
    { h: ss(12), o: 1.0 },
    { h: ss(18), o: 1.0 },
    { h: ss(12), o: 0.6 },
    { h: ss(7), o: 0.35 },
  ];
  return (
    <XStack alignItems="flex-end" gap={ss(2)} height={ss(18)}>
      {bars.map((b, i) => (
        <YStack
          key={i}
          width={ss(3)}
          height={b.h}
          borderRadius={1}
          opacity={b.o}
          {...{ className: "aurora-grad-bg" }}
        />
      ))}
    </XStack>
  );
}

function NavLink({ item, isActive, isFocused, onPress, fontSize, isTV }) {
  // Desktop keyboard access (WCAG 2.1.1): render as a real focusable control
  // with Enter/Space activation + a :focus-visible ring. TV keeps its own
  // index-based remote ring (isFocused), so it doesn't take DOM focus.
  const kbd = isTV
    ? {}
    : {
        role: "button",
        tabIndex: 0,
        "aria-label": item.label,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            onPress?.();
          }
        },
        className: "suvo-navlink",
      };
  return (
    <YStack alignItems="center">
      <YStack
        paddingVertical={ss(4)}
        paddingHorizontal={ss(2)}
        cursor="pointer"
        onPress={onPress}
        pressStyle={{ opacity: 0.7 }}
        {...kbd}
      >
        <Text
          color={isFocused || isActive ? colors.text : colors.muted}
          fontSize={fontSize ?? ss(14)}
          fontWeight={isFocused || isActive ? "700" : "500"}
        >
          {item.label}
        </Text>
      </YStack>
      {(isActive || isFocused) && (
        <YStack
          height={ss(3)}
          width="100%"
          borderRadius={2}
          marginTop={ss(6)}
          {...(isFocused
            ? { backgroundColor: colors.accent2 } // cyan keyboard-focus ring
            : { className: "aurora-grad-bg" })}
        />
      )}
    </YStack>
  );
}

function TopNav({
  active,
  onSelect,
  activeProfile,
  onAccounts,
  onSettings,
  onSwitchProfile,
  navFocused,
  focusedNavIdx,
  idxAccounts,
  idxSettings,
  idxProfile,
}) {
  const { isTV } = usePlatform();
  const accountsFocused = navFocused && focusedNavIdx === idxAccounts;
  const settingsFocused = navFocused && focusedNavIdx === idxSettings;
  const profileFocused = navFocused && focusedNavIdx === idxProfile;

  // Desktop keyboard access for the icon-only actions (WCAG 2.1.1): Tab-focusable
  // with Enter/Space activation + a :focus-visible ring. TV keeps its remote ring.
  const kbdIcon = (fn) =>
    isTV
      ? {}
      : {
          tabIndex: 0,
          className: "suvo-navicon",
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
              e.preventDefault();
              fn();
            }
          },
        };

  const S = isTV
    ? {
        h: ss(96),
        px: ss(60),
        gap: ss(44),
        brand: ss(30),
        navFont: ss(20),
        navGap: ss(32),
        icon: ss(44),
        iconR: ss(22),
        iconFont: ss(22),
        avatar: ss(48),
        avatarFont: ss(22),
        avatarR: ss(10),
        capFont: ss(14),
        capGap: ss(5),
      }
    : {
        h: ss(64),
        px: ss(48),
        gap: ss(32),
        brand: ss(22),
        navFont: ss(14),
        navGap: ss(22),
        icon: ss(30),
        iconR: ss(15),
        iconFont: ss(16),
        avatar: ss(32),
        avatarFont: ss(16),
        avatarR: ss(8),
        capFont: ss(11),
        capGap: ss(4),
      };

  return (
    <XStack
      alignItems="center"
      paddingHorizontal={S.px}
      height={S.h}
      gap={S.gap}
      backgroundColor="rgba(10, 14, 26,0.97)"
      borderBottomWidth={1}
      borderBottomColor={colors.border}
      {...{ className: "suvo-topnav" }}
    >
      <XStack
        alignItems="center"
        gap={ss(10)}
        cursor="pointer"
        onPress={() => onSelect("live")}
        pressStyle={{ opacity: 0.8 }}
      >
        <BrandGlyph />
        <Text
          color={colors.accent}
          fontSize={S.brand}
          fontWeight="700"
          letterSpacing={-0.5}
        >
          Suvo
        </Text>
      </XStack>

      <XStack gap={S.navGap} flex={1}>
        {NAV_ITEMS.map((item, idx) => (
          <NavLink
            key={item.id}
            item={item}
            isActive={active === item.id}
            isFocused={navFocused && focusedNavIdx === idx}
            onPress={() => onSelect(item.id)}
            fontSize={S.navFont}
            isTV={isTV}
          />
        ))}
      </XStack>

      <XStack alignItems="flex-start" gap={ss(16)}>
        {/* Icon-only actions carry a visible caption + native title + aria-label
            so first-timers (and 10-foot TV viewers, where there's no hover) can
            recognise them without guessing at the glyph. */}
        <YStack
          alignItems="center"
          justifyContent="center"
          minWidth={ss(44)}
          minHeight={ss(44)}
          gap={S.capGap}
          cursor="pointer"
          onPress={onAccounts}
          pressStyle={{ opacity: 0.7 }}
          {...{ role: "button", "aria-label": "Accounts", title: "Accounts" }}
          {...kbdIcon(onAccounts)}
        >
          <YStack
            width={S.icon}
            height={S.icon}
            borderRadius={S.iconR}
            justifyContent="center"
            alignItems="center"
            backgroundColor={accountsFocused ? accentAlpha(0.18) : "transparent"}
            borderWidth={2}
            borderColor={accountsFocused ? colors.accent2 : "transparent"}
            {...{ className: "suvo-icon-btn" }}
          >
            <Icon name="user" size={S.iconFont} color={colors.text} />
          </YStack>
          <Text color={colors.muted} fontSize={S.capFont} fontWeight="600">
            Accounts
          </Text>
        </YStack>
        <YStack
          alignItems="center"
          justifyContent="center"
          minWidth={ss(44)}
          minHeight={ss(44)}
          gap={S.capGap}
          cursor="pointer"
          onPress={onSettings}
          pressStyle={{ opacity: 0.7 }}
          {...{ role: "button", "aria-label": "Settings", title: "Settings" }}
          {...kbdIcon(onSettings)}
        >
          <YStack
            width={S.icon}
            height={S.icon}
            borderRadius={S.iconR}
            justifyContent="center"
            alignItems="center"
            backgroundColor={settingsFocused ? accentAlpha(0.18) : "transparent"}
            borderWidth={2}
            borderColor={settingsFocused ? colors.accent2 : "transparent"}
            {...{ className: "suvo-icon-btn" }}
          >
            <Icon name="settings" size={S.iconFont} color={colors.text} />
          </YStack>
          <Text color={colors.muted} fontSize={S.capFont} fontWeight="600">
            Settings
          </Text>
        </YStack>
        <YStack
          alignItems="center"
          justifyContent="center"
          minWidth={ss(44)}
          minHeight={ss(44)}
          gap={S.capGap}
          cursor="pointer"
          onPress={onSwitchProfile}
          pressStyle={{ opacity: 0.8 }}
          {...{ role: "button", "aria-label": "Switch profile", title: "Switch profile" }}
          {...kbdIcon(onSwitchProfile)}
        >
          <YStack
            width={S.avatar}
            height={S.avatar}
            borderRadius={S.avatarR}
            backgroundColor={profileFocused ? colors.accent : colors.surface2}
            borderWidth={profileFocused ? 3 : 2}
            borderColor={profileFocused ? colors.accent2 : colors.border}
            justifyContent="center"
            alignItems="center"
            {...{ className: "suvo-avatar" }}
          >
            <Text fontSize={S.avatarFont}>{activeProfile?.avatar || "👤"}</Text>
          </YStack>
          <Text color={colors.muted} fontSize={S.capFont} fontWeight="600">
            Profile
          </Text>
        </YStack>
      </XStack>
    </XStack>
  );
}

export default function AppNavigator() {
  const { isTV } = usePlatform();
  const {
    activeProfile,
    switchProfile,
    refetchLibrary,
  } = useApp();
  const { setSearchQuery } = useSearch();
  const { currentVideo } = usePlayback();
  const gate = useAppGate();
  const [activeTab, setActiveTab] = useState("home");
  const [showAccounts, setShowAccounts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [exitFocus, setExitFocus] = useState("cancel"); // "cancel" | "exit"
  const [navFocused, setNavFocused] = useState(false);
  const [focusedNavIdx, setFocusedNavIdx] = useState(0);
  const navIdxRef = useRef(0);
  // Tab navigation history so the remote Back key can go "history -1" (return
  // to the previously-viewed tab) once the active screen is at its root.
  const tabHistoryRef = useRef([]);

  // Mirror the modal/tab state into refs so `goBack` (captured once by each
  // screen's keydown effect at mount) always reads the latest values.
  const activeTabRef = useRef(activeTab);
  const showAccountsRef = useRef(showAccounts);
  const showSettingsRef = useRef(showSettings);
  const showExitPromptRef = useRef(showExitPrompt);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { showAccountsRef.current = showAccounts; }, [showAccounts]);
  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
  useEffect(() => { showExitPromptRef.current = showExitPrompt; }, [showExitPrompt]);

  // Set true while we're deliberately exiting so the popstate guard below stops
  // re-pushing the sentinel and lets webOS unwind history → close the app.
  const exitingRef = useRef(false);

  // Drop nav focus AND notify screens. Screens reset their per-screen
  // navActiveRef/navHasFocus flag on `tv-nav-blur`; clearing focus without
  // dispatching it would leave them stuck and bailing on every key (incl. Back).
  const clearNavFocus = () => {
    setNavFocused(false);
    globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
  };

  // Exit the app (TV). webOS closes the app when history underflows on Back; the
  // popstate guard normally prevents that, so we lift the guard first.
  const exitApp = () => {
    exitingRef.current = true;
    try { window.close(); } catch { /* no-op */ }
    // Fallback for runtimes where window.close() is a no-op: underflow history.
    try { window.history.back(); } catch { /* no-op */ }
  };

  const goToTab = (tab) => {
    // Landing on any tab refetches the library so history/favorites stay fresh
    // regardless of which page the user opens (web/TV screens remount per tab,
    // but the library only reloads on account/device change without this).
    // refetchLibrary no-ops until a loadable, device-gated context exists.
    refetchLibrary();
    setActiveTab((prev) => {
      const next = historyGo({ activeTab: prev, stack: tabHistoryRef.current }, tab);
      tabHistoryRef.current = next.stack;
      return next.activeTab;
    });
  };
  // Suppress hover effects while the user is navigating with the keyboard.
  // Any keydown adds .keyboard-nav to <body>; mousemove removes it.
  useEffect(() => {
    const onKey = () => document.body.classList.add("keyboard-nav");
    const onMouse = () => document.body.classList.remove("keyboard-nav");
    document.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("mousemove", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("mousemove", onMouse);
    };
  }, []);

  // Capture-phase handler: preventDefault on LG back key so webOS doesn't
  // exit the app or navigate browser history. Bubble-phase handlers in each
  // screen and in the nav/accounts effects below handle the actual action.
  //
  // preventDefault alone isn't enough on-device: webOS closes the app when the
  // browser history underflows on Back. So we also keep a sentinel history
  // entry and re-push it on every popstate — Back can never empty the history
  // stack, which is what triggers the platform exit. Our in-app handlers still
  // own the actual navigation (the keydown is consumed before any popstate).
  useEffect(() => {
    if (!isTV) return;
    const onBack = (e) => {
      if (isMacCommand(e)) return; // Mac ⌘ shares keyCode 91 — ignore in the simulator
      if (e.keyCode === 461 || e.keyCode === 10009 || e.keyCode === 91) e.preventDefault();
    };
    const onPop = () => {
      // While exiting we WANT history to underflow so webOS closes the app.
      if (exitingRef.current) return;
      window.history.pushState(null, "", window.location.href);
    };
    document.addEventListener("keydown", onBack, true);
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onBack, true);
      window.removeEventListener("popstate", onPop);
    };
  // Mount-once webOS Back/history handler; isTV is a stable platform constant.
  // Re-binding here would disturb the pushState trap, so deps stay empty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Content signals "go to nav" by dispatching this custom event
  useEffect(() => {
    const activate = () => {
      const idx = NAV_ITEMS.findIndex((item) => item.id === activeTab);
      const startIdx = Math.max(idx, 0);
      navIdxRef.current = startIdx;
      setFocusedNavIdx(startIdx);
      setNavFocused(true);
    };
    globalThis.addEventListener("tv-nav-focus", activate);
    return () => globalThis.removeEventListener("tv-nav-focus", activate);
  }, [activeTab]);

  // Nav keyboard handler — only active when navFocused
  // Nav items + accounts icon + settings icon + profile avatar
  const IDX_ACCOUNTS = NAV_ITEMS.length;
  const IDX_SETTINGS = NAV_ITEMS.length + 1;
  const IDX_PROFILE = NAV_ITEMS.length + 2;
  const NAV_TOTAL = NAV_ITEMS.length + 3;

  useEffect(() => {
    if (!navFocused) return;
    const blurNav = () => {
      setNavFocused(false);
      globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
    };
    const handler = (e) => {
      if (isMacCommand(e)) return; // Mac ⌘ shares keyCode 91 — ignore in the simulator
      // The focused navbar owns the remote exclusively. Enter/Down/Back blur the
      // nav, which synchronously clears useTVInput's yieldToNav flag (via
      // tv-nav-blur) — so without stopImmediatePropagation the SAME keydown then
      // reaches the screen's (later-registered) keydown listener unsuppressed and
      // gets double-handled: Down would blur the nav AND move the screen's focus
      // down onto the first poster. Stop every key the nav acts on so it never
      // leaks to the screen in the same tick.
      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const next = Math.min(navIdxRef.current + 1, NAV_TOTAL - 1);
        navIdxRef.current = next;
        setFocusedNavIdx(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const prev = Math.max(navIdxRef.current - 1, 0);
        navIdxRef.current = prev;
        setFocusedNavIdx(prev);
      } else if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = navIdxRef.current;
        if (idx < NAV_ITEMS.length) {
          goToTab(NAV_ITEMS[idx].id);
        } else if (idx === IDX_ACCOUNTS) {
          setShowAccounts(true);
        } else if (idx === IDX_SETTINGS) {
          setShowSettings(true);
        } else if (idx === IDX_PROFILE) {
          switchProfile(null);
        }
        blurNav();
      } else if (
        e.key === "ArrowDown" ||
        e.keyCode === 40 ||
        e.key === "Escape" ||
        e.keyCode === 27 ||
        e.keyCode === 461 ||
        e.keyCode === 10009 ||
        e.keyCode === 91
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        blurNav();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  // Re-bound on navFocused; the IDX_*/NAV_TOTAL layout constants are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navFocused]);

  // Accounts and Settings own the remote themselves while open (each drives its
  // own focus ring in a capture-phase keydown listener that shields the screen
  // behind it — see AccountsScreen.tv / SettingsScreen.web). AppNavigator only
  // needs to tell them how to close; no external trap here.

  // Exit-confirm prompt owns all keys while open (capture phase + stop
  // propagation) so arrows/Enter never leak to the screen behind it.
  useEffect(() => {
    if (!showExitPrompt) return;
    const handler = (e) => {
      if (isMacCommand(e)) return; // Mac ⌘ shares keyCode 91 — ignore in the simulator
      if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      const k = e.keyCode;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || k === 37 || k === 39) {
        e.preventDefault(); e.stopImmediatePropagation();
        setExitFocus((f) => (f === "cancel" ? "exit" : "cancel"));
      } else if (e.key === "Enter" || k === 13) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (exitFocus === "exit") exitApp();
        else setShowExitPrompt(false);
      } else if (e.key === "Escape" || k === 27 || k === 461 || k === 10009 || k === 91 || k === 8) {
        e.preventDefault(); e.stopImmediatePropagation();
        setShowExitPrompt(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [showExitPrompt, exitFocus]);

  const [routeParams, setRouteParams] = useState({});

  const webNavigation = {
    setOptions: () => {},
    navigate: (screen, params) => {
      if (screen === "Accounts") {
        setShowAccounts(true);
        return;
      }
      if (screen === "Movies" || screen === "movies") {
        goToTab("movies");
        if (params) setRouteParams({ movies: params });
        return;
      }
      if (screen === "Series" || screen === "series") {
        goToTab("series");
        if (params) setRouteParams({ series: params });
        return;
      }
      if (CONTENT_MAP[screen]) {
        goToTab(screen);
        if (params) setRouteParams({ [screen]: params });
      }
    },
    goBack: () => {
      // Single source of truth for what Back does — never a silent no-op.
      // Reads refs (not render-scope state) because each screen captures this
      // closure once at mount. See resolveBack() in tabHistory.js.
      const action = resolveBack({
        showExitPrompt: showExitPromptRef.current,
        showSettings: showSettingsRef.current,
        showAccounts: showAccountsRef.current,
        stack: tabHistoryRef.current,
        activeTab: activeTabRef.current,
      });
      switch (action.type) {
        case "closeExit": setShowExitPrompt(false); return;
        case "closeSettings": setShowSettings(false); return;
        case "closeAccounts": setShowAccounts(false); return;
        case "popTab":
          tabHistoryRef.current = action.stack;
          setActiveTab(action.activeTab);
          clearNavFocus();
          return;
        case "exitPrompt":
          // True root: confirm before exiting (the prompt owns its own keys).
          setExitFocus("cancel");
          setShowExitPrompt(true);
          return;
        default: return;
      }
    },
    getParent: () => webNavigation,
    setParams: (params) => {
      setRouteParams((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], ...params },
      }));
    },
  };

  // Neutral boot splash while the session resolves (paired with the TV
  // patch-index #root splash so there's no visual jump). Auth-agnostic spinner
  // only — never an optimistic main-nav skeleton that could flash the wrong
  // screen. The 8s authLoading ceiling lives in AppContext.
  const splash = (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0E1A" }}>
      <div style={{ width: 48, height: 48, border: "4px solid #28324E", borderTopColor: "#6C5CE7", borderRadius: "50%", animation: "suvo-spin 0.8s linear infinite", willChange: "transform" }} />
    </div>
  );
  if (gate === "config-error") return <ConfigErrorScreen />;
  if (gate === "loading") return splash;
  if (gate === "auth") return <AuthScreen />;
  if (gate === "device-locked") return <DeviceLockedScreen />;
  if (gate === "profiles") return <ProfilesScreen />;

  const ContentComponent = CONTENT_MAP[activeTab] || LiveTVScreen;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <TopNav
        active={activeTab}
        onSelect={(tab) => {
          if (tab !== activeTab) setSearchQuery("");
          goToTab(tab);
          clearNavFocus();
        }}
        activeProfile={activeProfile}
        onAccounts={() => setShowAccounts(true)}
        onSettings={() => setShowSettings(true)}
        onSwitchProfile={() => switchProfile(null)}
        navFocused={navFocused}
        focusedNavIdx={focusedNavIdx}
        idxAccounts={IDX_ACCOUNTS}
        idxSettings={IDX_SETTINGS}
        idxProfile={IDX_PROFILE}
      />
      <YStack flex={1} minHeight={0} overflow="hidden" {...{ className: "tvl-content-host" }}>
        <ContentComponent
          navigation={webNavigation}
          route={{ params: routeParams[activeTab] || {} }}
        />
      </YStack>

      {currentVideo && <VideoPlayerScreen />}

      {showAccounts && (
        <dialog
          ref={openAsModal}
          // Escape fires the dialog's native close → sync React state. Backdrop
          // clicks land on the dialog element itself (target === currentTarget).
          onClose={() => setShowAccounts(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAccounts(false);
          }}
          style={{
            padding: 0,
            border: "none",
            width: ss(600),
            maxWidth: "90vw",
            backgroundColor: colors.surface2,
            borderRadius: ss(16),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${ss(16)}px ${ss(20)}px`,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <span
              style={{ color: colors.text, fontSize: ss(18), fontWeight: 700 }}
            >
              Accounts
            </span>
            <button
              onClick={() => setShowAccounts(false)}
              style={{
                background: "none",
                border: "none",
                color: colors.muted,
                fontSize: ss(22),
                cursor: "pointer",
                lineHeight: 1,
                padding: `0 ${ss(4)}px`,
              }}
              aria-label="Close"
            >
              <Icon name="close" size={ss(16)} color={colors.text} />
            </button>
          </div>
          <AccountsScreen navigation={webNavigation} />
        </dialog>
      )}

      {showSettings && (
        <dialog
          ref={openAsModal}
          onClose={() => setShowSettings(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
          style={{
            padding: 0,
            border: "none",
            width: ss(560),
            maxWidth: "90vw",
            backgroundColor: colors.surface2,
            borderRadius: ss(16),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${ss(16)}px ${ss(20)}px`,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <span
              style={{ color: colors.text, fontSize: ss(18), fontWeight: 700 }}
            >
              Settings
            </span>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                background: "none",
                border: "none",
                color: colors.muted,
                fontSize: ss(22),
                cursor: "pointer",
                lineHeight: 1,
                padding: `0 ${ss(4)}px`,
              }}
              aria-label="Close"
            >
              <Icon name="close" size={ss(16)} color={colors.text} />
            </button>
          </div>
          <SettingsScreen onClose={() => setShowSettings(false)} />
        </dialog>
      )}

      {showExitPrompt && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: ss(440),
              maxWidth: "90vw",
              backgroundColor: colors.surface2,
              borderRadius: ss(16),
              padding: `${ss(28)}px ${ss(28)}px ${ss(24)}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: ss(8),
            }}
          >
            <span style={{ color: colors.text, fontFamily: fonts.display, fontSize: ss(22), fontWeight: 700 }}>
              Exit app?
            </span>
            <span style={{ color: colors.muted, fontFamily: fonts.body, fontSize: ss(15), textAlign: "center" }}>
              You’ll leave the app and return to the home screen.
            </span>
            <XStack gap={ss(12)} marginTop={ss(20)}>
              <Button
                variant="ghost"
                size="md"
                isFocused={exitFocus === "cancel"}
                onPress={() => setShowExitPrompt(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                isFocused={exitFocus === "exit"}
                onPress={exitApp}
              >
                Exit
              </Button>
            </XStack>
          </div>
        </div>
      )}
    </YStack>
  );
}

import { useState, useEffect, useRef } from "react";
import { YStack, XStack, Text } from "../ui/primitives";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import { colors, accentAlpha, fonts } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../services/supabase";
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
  let style = document.getElementById("lumen-global");
  if (!style) {
    style = document.createElement("style");
    style.id = "lumen-global";
    document.head.appendChild(style);
  }
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: #0A0E1A; color: #EAF0FF; font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; }
    @keyframes lumen-spin { to { transform: rotate(360deg); } }
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
    .lumen-topnav { position: sticky !important; top: 0 !important; z-index: 30 !important; }
    .lumen-poster {
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
      cursor: pointer !important;
    }
    /* Unified Aurora hover language (matches PosterCard.web): cyan ring + soft
       glow on the inner .lumen-poster-box ONLY (the image, never the title), no
       scale. The outer card must NOT clip overflow or the glow gets cropped. */
    body:not(.keyboard-nav) .lumen-poster:hover .lumen-poster-box,
    body:not(.keyboard-nav) .lumen-cw-card:hover .lumen-poster-box {
      box-shadow: 0 0 0 2px #22D3EE, 0 0 24px 2px rgba(34,211,238,0.55);
      border-color: #22D3EE; z-index: 2;
    }
    .lumen-live-card { transition: border-color 0.15s ease, background-color 0.15s ease; cursor: pointer !important; }
    body:not(.keyboard-nav) .lumen-live-card:hover { border-color: #6C5CE7 !important; background-color: #1B2236 !important; }
    body:not(.keyboard-nav) .lumen-icon-btn:hover { background: rgba(255,255,255,0.10) !important; }
    body:not(.keyboard-nav) .lumen-avatar:hover { border-color: #6C5CE7 !important; }
    .lumen-shelf-nav {
      opacity: 0; transition: opacity 0.15s;
      position: absolute; top: 0; bottom: 0; z-index: 4;
      display: flex; align-items: center;
      background: linear-gradient(to right, rgba(10, 14, 26,0.95), rgba(10, 14, 26,0));
      border: none; cursor: pointer; color: #fff; font-size: ${ss(28)}px; padding: 0 ${ss(14)}px; width: ${ss(56)}px;
    }
    .lumen-shelf-nav.right { background: linear-gradient(to left, rgba(10, 14, 26,0.95), rgba(10, 14, 26,0)); right: 0; left: auto; justify-content: flex-end; }
    body:not(.keyboard-nav) .lumen-shelf-rail:hover .lumen-shelf-nav { opacity: 1; }
    @keyframes lumen-blink { 50% { opacity: 0.25; } }
    .lumen-live-dot {
      display: inline-flex; align-items: center; gap: ${ss(5)}px;
      font-size: ${ss(10)}px; font-weight: 700; color: #6C5CE7; letter-spacing: 0.08em;
    }
    .lumen-live-dot::before {
      content: ''; width: ${ss(6)}px; height: ${ss(6)}px; border-radius: 50%;
      background: #6C5CE7; animation: lumen-blink 1.6s ease-in-out infinite; flex-shrink: 0;
    }
    .lumen-cw-card {
      border-radius: ${ss(8)}px; transition: box-shadow 0.2s ease, border-color 0.2s ease;
      cursor: pointer !important; position: relative !important;
    }
    .lumen-cw-play {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.15s ease;
      font-size: ${ss(38)}px; color: #fff; pointer-events: none; z-index: 5;
    }
    body:not(.keyboard-nav) .lumen-cw-card:hover .lumen-cw-play { opacity: 1; }
    .lumen-shelf-title-btn { cursor: pointer !important; }
    body:not(.keyboard-nav) .lumen-shelf-title-btn:hover span, body:not(.keyboard-nav) .lumen-shelf-title-btn:hover div { opacity: 0.8; }
    .lumen-load-cta { cursor: pointer !important; transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease; }
    body:not(.keyboard-nav) .lumen-load-cta:hover { background: rgba(108, 92, 231,0.12) !important; border-color: rgba(108, 92, 231,0.45) !important; transform: translateY(-1px); }
    ${
      globalThis.__TV__
        ? `
      *, *::before, *::after { transition: none !important; animation: none !important; will-change: auto !important; }
      .lumen-poster:hover .lumen-poster-box, .lumen-cw-card:hover .lumen-poster-box { box-shadow: none !important; border-color: #28324E !important; }
      .lumen-live-card:hover { border-color: #28324E !important; background-color: #1B2236 !important; }
      .lumen-load-cta:hover { transform: none !important; }
      .lumen-shelf-rail { contain: layout style; }
      .lumen-live-dot::before { animation: none !important; opacity: 1; }
    `
        : ""
    }
  `;
}

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "live", label: "Live TV" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Series" },
];

const CONTENT_MAP = {
  live: LiveTVScreen,
  movies: MoviesScreen,
  series: SeriesScreen,
  home: HistoryScreen,
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

function NavLink({ item, isActive, isFocused, onPress, fontSize }) {
  return (
    <YStack alignItems="center">
      <YStack
        paddingVertical={ss(4)}
        paddingHorizontal={ss(2)}
        cursor="pointer"
        onPress={onPress}
        pressStyle={{ opacity: 0.7 }}
      >
        <Text
          color={isFocused || isActive ? colors.text : "#ccc"}
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
      {...{ className: "lumen-topnav" }}
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
          Lumen
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
          />
        ))}
      </XStack>

      <XStack alignItems="center" gap={ss(16)}>
        <YStack
          width={S.icon}
          height={S.icon}
          borderRadius={S.iconR}
          justifyContent="center"
          alignItems="center"
          cursor="pointer"
          onPress={onAccounts}
          pressStyle={{ opacity: 0.7 }}
          backgroundColor={accountsFocused ? accentAlpha(0.18) : "transparent"}
          borderWidth={2}
          borderColor={accountsFocused ? colors.accent2 : "transparent"}
          {...{ className: "lumen-icon-btn" }}
        >
          <Icon name="signal" size={S.iconFont} color={colors.text} />
        </YStack>
        <YStack
          width={S.icon}
          height={S.icon}
          borderRadius={S.iconR}
          justifyContent="center"
          alignItems="center"
          cursor="pointer"
          onPress={onSettings}
          pressStyle={{ opacity: 0.7 }}
          backgroundColor={settingsFocused ? accentAlpha(0.18) : "transparent"}
          borderWidth={2}
          borderColor={settingsFocused ? colors.accent2 : "transparent"}
          {...{ className: "lumen-icon-btn" }}
        >
          <Icon name="settings" size={S.iconFont} color={colors.text} />
        </YStack>
        <YStack
          width={S.avatar}
          height={S.avatar}
          borderRadius={S.avatarR}
          backgroundColor={profileFocused ? colors.accent : colors.surface2}
          borderWidth={profileFocused ? 3 : 2}
          borderColor={profileFocused ? colors.accent2 : colors.border}
          justifyContent="center"
          alignItems="center"
          cursor="pointer"
          onPress={onSwitchProfile}
          pressStyle={{ opacity: 0.8 }}
          {...{ className: "lumen-avatar" }}
        >
          <Text fontSize={S.avatarFont}>{activeProfile?.avatar || "👤"}</Text>
        </YStack>
      </XStack>
    </XStack>
  );
}

export default function AppNavigator() {
  const { isTV } = usePlatform();
  const {
    authUser,
    authLoading,
    deviceStatus,
    activeProfileId,
    activeProfile,
    currentVideo,
    switchProfile,
    setSearchQuery,
  } = useApp();
  const [activeTab, setActiveTab] = useState("live");
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
      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault();
        const next = Math.min(navIdxRef.current + 1, NAV_TOTAL - 1);
        navIdxRef.current = next;
        setFocusedNavIdx(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault();
        const prev = Math.max(navIdxRef.current - 1, 0);
        navIdxRef.current = prev;
        setFocusedNavIdx(prev);
      } else if (e.key === "Enter" || e.keyCode === 13) {
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
        blurNav();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
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
      <div style={{ width: 48, height: 48, border: "4px solid #28324E", borderTopColor: "#6C5CE7", borderRadius: "50%", animation: "lumen-spin 0.8s linear infinite" }} />
    </div>
  );
  if (!isSupabaseConfigured()) return <ConfigErrorScreen />;
  if (authLoading) return splash;
  if (!authUser) return <AuthScreen />;
  if (deviceStatus === "pending") return splash;
  if (deviceStatus === "denied") return <DeviceLockedScreen />;
  if (!activeProfileId) return <ProfilesScreen />;

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
      <YStack flex={1} minHeight={0} overflow="hidden">
        <ContentComponent
          navigation={webNavigation}
          route={{ params: routeParams[activeTab] || {} }}
        />
      </YStack>

      {currentVideo && <VideoPlayerScreen />}

      {showAccounts && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAccounts(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowAccounts(false);
          }}
        >
          <dialog
            open
            style={{
              position: "static",
              margin: 0,
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
                  color: "#aaa",
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
        </div>
      )}

      {showSettings && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowSettings(false);
          }}
        >
          <dialog
            open
            style={{
              position: "static",
              margin: 0,
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
                  color: "#aaa",
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
        </div>
      )}

      {showExitPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
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
            <span style={{ color: "#aaa", fontFamily: fonts.body, fontSize: ss(15), textAlign: "center" }}>
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

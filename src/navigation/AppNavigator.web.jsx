import { useState, useEffect, useRef } from "react";
import { YStack, XStack, Text } from "../ui/primitives";
import Icon from "../ui/Icon";
import { colors, accentAlpha } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../services/supabase";
import { ss } from "../utils/scaleSize";

import AuthScreen from "../screens/AuthScreen";
import ProfilesScreen from "../screens/ProfilesScreen";
import LiveTVScreenWeb from "../screens/LiveTVScreen.web";
import LiveTVScreenTV from "../screens/LiveTVScreen.tv";
import MoviesScreenWeb from "../screens/MoviesScreen.web";
import MoviesScreenTV from "../screens/MoviesScreen.tv";
import SeriesScreenWeb from "../screens/SeriesScreen.web";
import SeriesScreenTV from "../screens/SeriesScreen.tv";
import HistoryScreenWeb from "../screens/HistoryScreen.web";
import HistoryScreenTV from "../screens/HistoryScreen.tv";
import AccountsScreenWeb from "../screens/AccountsScreen";
import AccountsScreenTV from "../screens/AccountsScreen.tv";
import VideoPlayerScreen from "../screens/VideoPlayerScreen";
import SettingsScreen from "../screens/SettingsScreen.web";
import { usePlatform } from "../platform/PlatformProvider";
import { go as historyGo, back as historyBack } from "./tabHistory";

// Use TV-optimized screens on TV platforms (resolved at module load from build flag)
const _isTV = !!globalThis.__TV__;
const LiveTVScreen = _isTV ? LiveTVScreenTV : LiveTVScreenWeb;
const MoviesScreen = _isTV ? MoviesScreenTV : MoviesScreenWeb;
const SeriesScreen = _isTV ? SeriesScreenTV : SeriesScreenWeb;
const HistoryScreen = _isTV ? HistoryScreenTV : HistoryScreenWeb;
const AccountsScreen = _isTV ? AccountsScreenTV : AccountsScreenWeb;

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
    activeProfileId,
    activeProfile,
    currentVideo,
    switchProfile,
    setSearchQuery,
  } = useApp();
  const [activeTab, setActiveTab] = useState("live");
  const [showAccounts, setShowAccounts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [navFocused, setNavFocused] = useState(false);
  const [focusedNavIdx, setFocusedNavIdx] = useState(0);
  const navIdxRef = useRef(0);
  // Tab navigation history so the remote Back key can go "history -1" (return
  // to the previously-viewed tab) once the active screen is at its root.
  const tabHistoryRef = useRef([]);
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
      if (e.keyCode === 461 || e.keyCode === 10009 || e.keyCode === 91) e.preventDefault();
    };
    const onPop = () => {
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

  useEffect(() => {
    if (!showAccounts) return;
    const handler = (e) => {
      if (e.key === "Escape" || e.keyCode === 461 || e.keyCode === 10009 || e.keyCode === 91) {
        e.preventDefault();
        setShowAccounts(false);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [showAccounts]);

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e) => {
      if (e.key === "Escape" || e.keyCode === 461 || e.keyCode === 10009 || e.keyCode === 91) {
        e.preventDefault();
        setShowSettings(false);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [showSettings]);

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
      // TEMP DIAGNOSTIC
      console.log("[goBack]", "stack=", JSON.stringify(tabHistoryRef.current), "showAccounts=", showAccounts, "showSettings=", showSettings);
      // Modals first (their own key handlers also close them, but content
      // screens funnel here too).
      if (showSettings) { setShowSettings(false); return; }
      if (showAccounts) { setShowAccounts(false); return; }
      // History -1: return to the previously-viewed tab.
      if (tabHistoryRef.current.length) {
        const next = historyBack({ activeTab, stack: tabHistoryRef.current });
        tabHistoryRef.current = next.stack;
        setActiveTab(next.activeTab);
        setNavFocused(false);
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

  if (authLoading) return null;
  if (isSupabaseConfigured() && !authUser) return <AuthScreen />;
  if (!activeProfileId) return <ProfilesScreen />;

  const ContentComponent = CONTENT_MAP[activeTab] || LiveTVScreen;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <TopNav
        active={activeTab}
        onSelect={(tab) => {
          if (tab !== activeTab) setSearchQuery("");
          goToTab(tab);
          setNavFocused(false);
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
            <SettingsScreen />
          </dialog>
        </div>
      )}
    </YStack>
  );
}

import { useState, useEffect, useRef } from "react";
import { YStack, XStack, Text, Input } from "tamagui";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../services/supabase";
import { ss } from "../utils/scaleSize";

import AuthScreen from "../screens/AuthScreen";
import ProfilesScreen from "../screens/ProfilesScreen";
import LiveTVScreen from "../screens/LiveTVScreen";
import MoviesScreen from "../screens/MoviesScreen";
import SeriesScreen from "../screens/SeriesScreen";
import HistoryScreen from "../screens/HistoryScreen";
import AccountsScreen from "../screens/AccountsScreen";
import VideoPlayerScreen from "../screens/VideoPlayerScreen";

// ── Global CSS injected once ──────────────────────────────────────────────────
if (typeof document !== "undefined") {
  let style = document.getElementById("lumen-global");
  if (!style) { style = document.createElement("style"); style.id = "lumen-global"; document.head.appendChild(style); }
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: #0f0f23; }
    #root, #app, [data-reactroot] { height: 100%; }
    * { scrollbar-width: thin; scrollbar-color: #2a2a4e transparent; }
    ::-webkit-scrollbar { width: ${ss(8)}px; height: ${ss(8)}px; }
    ::-webkit-scrollbar-thumb { background: #2a2a4e; border-radius: ${ss(4)}px; }
    ::-webkit-scrollbar-track { background: transparent; }
    input:focus, textarea:focus {
      outline: none !important;
      border-color: #e94560 !important;
      box-shadow: 0 0 0 ${ss(3)}px rgba(233,69,96,0.15) !important;
    }
    .lumen-topnav { position: sticky !important; top: 0 !important; z-index: 30 !important; }
    .lumen-poster {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer !important; overflow: hidden !important;
    }
    .lumen-poster:hover { transform: scale(1.05); z-index: 2; box-shadow: 0 ${ss(8)}px ${ss(28)}px rgba(0,0,0,0.6), 0 0 0 1.5px #e94560; }
    .lumen-live-card { transition: border-color 0.15s ease, background-color 0.15s ease; cursor: pointer !important; }
    .lumen-live-card:hover { border-color: #e94560 !important; background-color: #20203a !important; }
    .lumen-icon-btn:hover { background: rgba(255,255,255,0.10) !important; }
    .lumen-avatar:hover { border-color: #e94560 !important; }
    .lumen-shelf-nav {
      opacity: 0; transition: opacity 0.15s;
      position: absolute; top: 0; bottom: 0; z-index: 4;
      display: flex; align-items: center;
      background: linear-gradient(to right, rgba(15,15,35,0.95), rgba(15,15,35,0));
      border: none; cursor: pointer; color: #fff; font-size: ${ss(28)}px; padding: 0 ${ss(14)}px; width: ${ss(56)}px;
    }
    .lumen-shelf-nav.right { background: linear-gradient(to left, rgba(15,15,35,0.95), rgba(15,15,35,0)); right: 0; left: auto; justify-content: flex-end; }
    .lumen-shelf-rail:hover .lumen-shelf-nav { opacity: 1; }
    @keyframes lumen-blink { 50% { opacity: 0.25; } }
    .lumen-live-dot {
      display: inline-flex; align-items: center; gap: ${ss(5)}px;
      font-size: ${ss(10)}px; font-weight: 700; color: #e94560; letter-spacing: 0.08em;
    }
    .lumen-live-dot::before {
      content: ''; width: ${ss(6)}px; height: ${ss(6)}px; border-radius: 50%;
      background: #e94560; animation: lumen-blink 1.6s ease-in-out infinite; flex-shrink: 0;
    }
    .lumen-cw-card {
      border-radius: ${ss(8)}px; transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer !important; overflow: hidden !important; position: relative !important;
    }
    .lumen-cw-card:hover { transform: scale(1.04); z-index: 2; box-shadow: 0 ${ss(8)}px ${ss(24)}px rgba(0,0,0,0.5); }
    .lumen-cw-play {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.15s ease;
      font-size: ${ss(38)}px; color: #fff; pointer-events: none; z-index: 5;
    }
    .lumen-cw-card:hover .lumen-cw-play { opacity: 1; }
    .lumen-shelf-title-btn { cursor: pointer !important; }
    .lumen-shelf-title-btn:hover span, .lumen-shelf-title-btn:hover div { opacity: 0.8; }
    .lumen-load-cta { cursor: pointer !important; transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease; }
    .lumen-load-cta:hover { background: rgba(233,69,96,0.12) !important; border-color: rgba(233,69,96,0.45) !important; transform: translateY(-1px); }
    ${globalThis.__TV__ ? `
      *, *::before, *::after { transition: none !important; animation: none !important; will-change: auto !important; }
      .lumen-poster:hover { transform: none !important; box-shadow: none !important; }
      .lumen-cw-card:hover { transform: none !important; box-shadow: none !important; }
      .lumen-live-card:hover { border-color: #2a2a4e !important; background-color: #1a1a2e !important; }
      .lumen-load-cta:hover { transform: none !important; }
      .lumen-shelf-rail { contain: layout style; }
      .lumen-live-dot::before { animation: none !important; opacity: 1; }
    ` : ""}
  `;
}

const NAV_ITEMS = [
  { id: "live",   label: "Live TV" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "mylist", label: "My List" },
];

const CONTENT_MAP = {
  live:   LiveTVScreen,
  movies: MoviesScreen,
  series: SeriesScreen,
  mylist: HistoryScreen,
};

function BrandGlyph() {
  const bars = [{ h: ss(7), o: 1.0 }, { h: ss(12), o: 1.0 }, { h: ss(18), o: 1.0 }, { h: ss(12), o: 0.6 }, { h: ss(7), o: 0.35 }];
  return (
    <XStack alignItems="flex-end" gap={ss(2)} height={ss(18)}>
      {bars.map((b, i) => (
        <YStack key={i} width={ss(3)} height={b.h} backgroundColor="#e94560" borderRadius={1} opacity={b.o} />
      ))}
    </XStack>
  );
}

function NavLink({ item, isActive, isFocused, onPress }) {
  return (
    <YStack alignItems="center">
      <YStack paddingVertical={ss(4)} paddingHorizontal={ss(2)} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.7 }}>
        <Text
          color={isFocused || isActive ? "#fff" : "#ccc"}
          fontSize={ss(14)}
          fontWeight={isFocused || isActive ? "700" : "500"}
        >
          {item.label}
        </Text>
      </YStack>
      {(isActive || isFocused) && (
        <YStack height={ss(2)} width="100%" backgroundColor={isFocused ? "#fff" : "#e94560"} borderRadius={1} marginTop={ss(6)} />
      )}
    </YStack>
  );
}

function TopNav({ active, onSelect, activeProfile, onAccounts, onSwitchProfile, navFocused, focusedNavIdx }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <XStack
      alignItems="center" paddingHorizontal={ss(48)} height={ss(64)} gap={ss(32)}
      backgroundColor="rgba(15,15,35,0.97)" borderBottomWidth={1} borderBottomColor="#2a2a4e"
      {...({ className: "lumen-topnav" })}
    >
      <XStack alignItems="center" gap={ss(10)} cursor="pointer" onPress={() => onSelect("live")} pressStyle={{ opacity: 0.8 }}>
        <BrandGlyph />
        <Text color="#e94560" fontSize={ss(22)} fontWeight="700" letterSpacing={-0.5}>Lumen</Text>
      </XStack>

      <XStack gap={ss(22)} flex={1}>
        {NAV_ITEMS.map((item, idx) => (
          <NavLink
            key={item.id}
            item={item}
            isActive={active === item.id}
            isFocused={navFocused && focusedNavIdx === idx}
            onPress={() => onSelect(item.id)}
          />
        ))}
      </XStack>

      <XStack alignItems="center" gap={ss(16)}>
        {searchOpen ? (
          <XStack alignItems="center" gap={ss(6)} backgroundColor="rgba(0,0,0,0.7)" borderWidth={1} borderColor="#2a2a4e" borderRadius={ss(8)} paddingHorizontal={ss(12)} paddingVertical={ss(6)} width={ss(220)}>
            <Text color="#888" fontSize={ss(13)} marginRight={ss(6)}>🔍</Text>
            <Input
              autoFocus
              flex={1}
              placeholder="Titles, channels, people"
              placeholderTextColor="#666"
              value={search}
              onChangeText={setSearch}
              onBlur={() => { if (!search) setSearchOpen(false); }}
              color="#fff"
              fontSize={ss(13)}
              backgroundColor="transparent"
              borderWidth={0}
              padding={0}
            />
          </XStack>
        ) : (
          <YStack width={ss(30)} height={ss(30)} borderRadius={ss(15)} justifyContent="center" alignItems="center" cursor="pointer" onPress={() => setSearchOpen(true)} pressStyle={{ opacity: 0.7 }} {...({ className: "lumen-icon-btn" })}>
            <Text fontSize={ss(16)}>🔍</Text>
          </YStack>
        )}
        <YStack width={ss(30)} height={ss(30)} borderRadius={ss(15)} justifyContent="center" alignItems="center" cursor="pointer" pressStyle={{ opacity: 0.7 }} {...({ className: "lumen-icon-btn" })}>
          <Text fontSize={ss(16)}>🔔</Text>
        </YStack>
        <YStack width={ss(30)} height={ss(30)} borderRadius={ss(15)} justifyContent="center" alignItems="center" cursor="pointer" onPress={onAccounts} pressStyle={{ opacity: 0.7 }} {...({ className: "lumen-icon-btn" })}>
          <Text fontSize={ss(16)}>📡</Text>
        </YStack>
        <YStack width={ss(32)} height={ss(32)} borderRadius={ss(8)} backgroundColor="#1a1a2e" borderWidth={2} borderColor="#2a2a4e" justifyContent="center" alignItems="center" cursor="pointer" onPress={onSwitchProfile} pressStyle={{ opacity: 0.8 }} {...({ className: "lumen-avatar" })}>
          <Text fontSize={ss(16)}>{activeProfile?.avatar || "👤"}</Text>
        </YStack>
      </XStack>
    </XStack>
  );
}

export default function AppNavigator() {
  const { authUser, authLoading, activeProfileId, activeProfile, currentVideo, switchProfile } = useApp();
  const [activeTab, setActiveTab] = useState("live");
  const [showAccounts, setShowAccounts] = useState(false);
  const [navFocused, setNavFocused] = useState(false);
  const [focusedNavIdx, setFocusedNavIdx] = useState(0);
  const navIdxRef = useRef(0);

  // Content signals "go to nav" by dispatching this custom event
  useEffect(() => {
    const activate = () => setNavFocused(true);
    globalThis.addEventListener("tv-nav-focus", activate);
    return () => globalThis.removeEventListener("tv-nav-focus", activate);
  }, []);

  // Nav keyboard handler — only active when navFocused
  useEffect(() => {
    if (!navFocused) return;
    const handler = (e) => {
      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault();
        const next = Math.min(navIdxRef.current + 1, NAV_ITEMS.length - 1);
        navIdxRef.current = next;
        setFocusedNavIdx(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault();
        const prev = Math.max(navIdxRef.current - 1, 0);
        navIdxRef.current = prev;
        setFocusedNavIdx(prev);
      } else if (e.key === "Enter" || e.keyCode === 13) {
        setActiveTab(NAV_ITEMS[navIdxRef.current].id);
        setNavFocused(false);
        globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
      } else if (e.key === "ArrowDown" || e.keyCode === 40) {
        e.preventDefault();
        setNavFocused(false);
        globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
      } else if (e.key === "Escape" || e.keyCode === 27) {
        setNavFocused(false);
        globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [navFocused]);

  const webNavigation = {
    setOptions: () => {},
    navigate: (screen) => {
      if (screen === "Accounts") { setShowAccounts(true); return; }
      if (CONTENT_MAP[screen]) { setActiveTab(screen); }
    },
    goBack: () => setShowAccounts(false),
  };

  if (authLoading) return null;
  if (isSupabaseConfigured() && !authUser) return <AuthScreen />;
  if (!activeProfileId) return <ProfilesScreen />;

  const ContentComponent = CONTENT_MAP[activeTab] || LiveTVScreen;

  return (
    <YStack flex={1} backgroundColor="#0f0f23" position="relative">
      <TopNav
        active={activeTab}
        onSelect={(tab) => { setActiveTab(tab); setNavFocused(false); }}
        activeProfile={activeProfile}
        onAccounts={() => setShowAccounts(true)}
        onSwitchProfile={() => switchProfile(null)}
        navFocused={navFocused}
        focusedNavIdx={focusedNavIdx}
      />
      <YStack flex={1} minHeight={0} overflow="hidden">
        <ContentComponent navigation={webNavigation} />
      </YStack>

      {currentVideo && <VideoPlayerScreen />}

      {showAccounts && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAccounts(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowAccounts(false); }}
        >
          <dialog
            open
            style={{ position: "static", margin: 0, padding: 0, border: "none", width: ss(600), maxWidth: "90vw", backgroundColor: "#1a1a2e", borderRadius: ss(16), overflow: "hidden" }}
          >
            <AccountsScreen navigation={webNavigation} />
          </dialog>
        </div>
      )}
    </YStack>
  );
}

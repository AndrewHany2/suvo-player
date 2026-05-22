import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { YStack } from 'tamagui';
import { useApp } from '../context/AppContext';
import { isSupabaseConfigured } from '../services/supabase';

import AuthScreen from '../screens/AuthScreen';
import ProfilesScreen from '../screens/ProfilesScreen';
import LiveTVScreen from '../screens/LiveTVScreen';
import MoviesScreen from '../screens/MoviesScreen';
import SeriesScreen from '../screens/SeriesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import AccountsScreen from '../screens/AccountsScreen';
import VideoPlayerScreen from '../screens/VideoPlayerScreen';

if (typeof document !== 'undefined' && !document.getElementById('lumen-global')) {
  const style = document.createElement('style');
  style.id = 'lumen-global';
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #0f0f23; }
    * { scrollbar-width: thin; scrollbar-color: #2a2a4e transparent; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-thumb { background: #2a2a4e; border-radius: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    input:focus, textarea:focus {
      outline: none !important;
      border-color: #e94560 !important;
      box-shadow: 0 0 0 3px rgba(233,69,96,0.15) !important;
    }
    .lumen-topnav {
      position: sticky !important;
      top: 0 !important;
      z-index: 30 !important;
    }
    .lumen-poster {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer !important;
      position: relative !important;
      overflow: hidden !important;
    }
    .lumen-poster:hover {
      transform: scale(1.05);
      z-index: 2;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px #e94560;
    }
    .lumen-poster-overlay {
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .lumen-poster:hover .lumen-poster-overlay {
      opacity: 1;
    }
    .lumen-live-card {
      transition: border-color 0.15s ease, background-color 0.15s ease;
      cursor: pointer !important;
    }
    .lumen-live-card:hover {
      border-color: #e94560 !important;
      background-color: #20203a !important;
    }
    .lumen-icon-btn:hover { background: rgba(255,255,255,0.10) !important; }
    .lumen-avatar:hover { border-color: #e94560 !important; }
    .lumen-shelf-nav {
      opacity: 0;
      transition: opacity 0.15s;
      position: absolute;
      top: 0; bottom: 0;
      z-index: 4;
      display: flex;
      align-items: center;
      background: linear-gradient(to right, rgba(15,15,35,0.95), rgba(15,15,35,0));
      border: none;
      cursor: pointer;
      color: #fff;
      font-size: 28px;
      padding: 0 14px;
      width: 56px;
    }
    .lumen-shelf-nav.right {
      background: linear-gradient(to left, rgba(15,15,35,0.95), rgba(15,15,35,0));
      right: 0;
      left: auto;
      justify-content: flex-end;
    }
    .lumen-shelf-rail:hover .lumen-shelf-nav { opacity: 1; }
    @keyframes lumen-blink { 50% { opacity: 0.25; } }
    .lumen-live-dot {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 10px; font-weight: 700; color: #e94560; letter-spacing: 0.08em;
    }
    .lumen-live-dot::before {
      content: '';
      width: 6px; height: 6px; border-radius: 50%;
      background: #e94560;
      animation: lumen-blink 1.6s ease-in-out infinite;
      flex-shrink: 0;
    }
    .lumen-hero-overlay {
      background:
        linear-gradient(to right, #0f0f23 0%, rgba(15,15,35,0.92) 38%, rgba(15,15,35,0.35) 65%, transparent 100%),
        linear-gradient(to top, #0f0f23 0%, rgba(15,15,35,0.2) 45%, transparent 85%);
    }
    .lumen-hero {
      height: 78vh !important;
      min-height: 560px !important;
      max-height: 820px !important;
    }
    .lumen-poster-gradient {
      background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 38%, rgba(0,0,0,0) 68%);
    }
    .lumen-poster {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer !important;
      overflow: hidden !important;
    }
    .lumen-poster:hover {
      transform: scale(1.05);
      z-index: 2;
      box-shadow: 0 8px 28px rgba(0,0,0,0.6), 0 0 0 1.5px #e94560;
    }
    /* Hero button hovers */
    .lumen-btn-play { transition: opacity 0.12s ease; }
    .lumen-btn-play:hover { opacity: 0.85 !important; }
    .lumen-btn-info { transition: background 0.12s ease; }
    .lumen-btn-info:hover { background: rgba(60,60,80,0.9) !important; }
    .lumen-btn-add { transition: border-color 0.12s ease; }
    .lumen-btn-add:hover { border-color: #fff !important; }
    /* Continue Watching card */
    .lumen-cw-card {
      border-radius: 8px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer !important;
      overflow: hidden !important;
      position: relative !important;
    }
    .lumen-cw-card:hover {
      transform: scale(1.04);
      z-index: 2;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .lumen-cw-play {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4);
      opacity: 0; transition: opacity 0.15s ease;
      font-size: 38px; color: #fff;
      pointer-events: none;
      z-index: 5;
    }
    .lumen-cw-card:hover .lumen-cw-play { opacity: 1; }
    .lumen-shelf-title-btn { cursor: pointer !important; }
    .lumen-shelf-title-btn:hover span, .lumen-shelf-title-btn:hover div { opacity: 0.8; }
  `;
  document.head.appendChild(style);
}

const NAV_ITEMS = [
  { id: 'live',   label: 'Live TV' },
  { id: 'movies', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'mylist', label: 'My List' },
];

const CONTENT_MAP = {
  live:   LiveTVScreen,
  movies: MoviesScreen,
  series: SeriesScreen,
  mylist: HistoryScreen,
};

function BrandGlyph() {
  const bars = [
    { h: 7, o: 1.0 }, { h: 12, o: 1.0 }, { h: 18, o: 1.0 },
    { h: 12, o: 0.6 }, { h: 7, o: 0.35 },
  ];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {bars.map((b, i) => (
        <View key={i} style={{ width: 3, height: b.h, backgroundColor: '#e94560', borderRadius: 1, opacity: b.o }} />
      ))}
    </View>
  );
}

function NavLink({ item, isActive, onPress }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <TouchableOpacity onPress={onPress} style={{ paddingVertical: 4, paddingHorizontal: 2 }}>
        <Text style={[nav.linkText, isActive && nav.linkTextActive]}>{item.label}</Text>
      </TouchableOpacity>
      {isActive && <View style={nav.underline} />}
    </View>
  );
}

function TopNav({ active, onSelect, activeProfile, onAccounts, onSwitchProfile }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  return (
    <View style={nav.bar} {...({ className: 'lumen-topnav' })}>
      <TouchableOpacity style={nav.brand} onPress={() => onSelect('live')}>
        <BrandGlyph />
        <Text style={nav.brandName}>Lumen</Text>
      </TouchableOpacity>

      <View style={nav.links}>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.id} item={item} isActive={active === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </View>

      <View style={nav.right}>
        {searchOpen ? (
          <View style={nav.searchBox}>
            <Text style={{ color: '#888', fontSize: 13, marginRight: 6 }}>🔍</Text>
            <TextInput
              autoFocus
              style={nav.searchInput}
              placeholder="Titles, channels, people"
              placeholderTextColor="#666"
              value={search}
              onChangeText={setSearch}
              onBlur={() => { if (!search) setSearchOpen(false); }}
            />
          </View>
        ) : (
          <TouchableOpacity style={nav.icon} onPress={() => setSearchOpen(true)} {...({ className: 'lumen-icon-btn' })}>
            <Text style={{ fontSize: 16 }}>🔍</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={nav.icon} {...({ className: 'lumen-icon-btn' })}>
          <Text style={{ fontSize: 16 }}>🔔</Text>
        </TouchableOpacity>
        <TouchableOpacity style={nav.icon} onPress={onAccounts} {...({ className: 'lumen-icon-btn' })}>
          <Text style={{ fontSize: 16 }}>📡</Text>
        </TouchableOpacity>
        <TouchableOpacity style={nav.avatar} onPress={onSwitchProfile} {...({ className: 'lumen-avatar' })}>
          <Text style={{ fontSize: 16 }}>{activeProfile?.avatar || '👤'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AppNavigator() {
  const { authUser, authLoading, profile, signOut, currentVideo, activeProfileId, activeProfile, switchProfile } = useApp();
  const [activeTab, setActiveTab] = useState('live');
  const [showAccounts, setShowAccounts] = useState(false);

  const webNavigation = {
    setOptions: () => {},
    navigate: (screen) => { if (screen === 'Accounts') setShowAccounts(true); },
    goBack: () => setShowAccounts(false),
  };

  if (authLoading) return null;
  if (isSupabaseConfigured() && !authUser) return <AuthScreen />;
  if (!activeProfileId) return <ProfilesScreen />;

  const ContentComponent = CONTENT_MAP[activeTab] || LiveTVScreen;

  return (
    <View style={root.container}>
      <TopNav
        active={activeTab}
        onSelect={setActiveTab}
        activeProfile={activeProfile}
        onAccounts={() => setShowAccounts(true)}
        onSwitchProfile={() => switchProfile(null)}
      />
      <View style={root.content}>
        <ContentComponent navigation={webNavigation} />
      </View>

      {currentVideo && <VideoPlayerScreen />}

      {showAccounts && (
        <View style={root.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setShowAccounts(false)} />
          <View style={root.accountsBox}>
            <AccountsScreen navigation={webNavigation} />
          </View>
        </View>
      )}
    </View>
  );
}

const nav = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 48,
    height: 64,
    gap: 32,
    backgroundColor: 'rgba(15,15,35,0.97)',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4e',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { color: '#e94560', fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  links: { flexDirection: 'row', gap: 22, flex: 1 },
  linkText: { color: '#ccc', fontSize: 14, fontWeight: '500' },
  linkTextActive: { color: '#fff', fontWeight: '700' },
  underline: { height: 2, width: '100%', backgroundColor: '#e94560', borderRadius: 1, marginTop: 6 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  icon: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  avatar: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#1a1a2e', borderWidth: 2, borderColor: '#2a2a4e',
    justifyContent: 'center', alignItems: 'center',
  },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1, borderColor: '#2a2a4e',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, width: 220,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
});

const root = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { flex: 1, overflow: 'hidden' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100,
    alignItems: 'center', justifyContent: 'center',
  },
  accountsBox: {
    width: 600, maxWidth: '90%',
    backgroundColor: '#1a1a2e', borderRadius: 16, overflow: 'hidden',
  },
});

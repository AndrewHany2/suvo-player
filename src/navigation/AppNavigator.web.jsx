import { useState, useEffect, useRef } from 'react';
import { XStack, YStack, Text } from 'tamagui';
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

const NAV_ITEMS = [
  { id: 'live',    label: 'Live TV',  icon: '📺' },
  { id: 'movies',  label: 'Movies',   icon: '🎬' },
  { id: 'series',  label: 'Series',   icon: '🎭' },
  { id: 'history', label: 'History',  icon: '🕘' },
];

const CONTENT_MAP = {
  live:    LiveTVScreen,
  movies:  MoviesScreen,
  series:  SeriesScreen,
  history: HistoryScreen,
};

function Sidebar({ active, focusedIdx, itemRefs, onSelect, onKeyDown, profile, activeProfile, onSwitchProfile, signOut, signOutRef }) {
  return (
    <YStack
      width={200}
      backgroundColor="#1a1a2e"
      paddingVertical="$4"
      paddingHorizontal="$3"
      gap="$2"
      borderRightWidth={1}
      borderRightColor="#2a2a4e"
    >
      <Text color="#e94560" fontSize="$6" fontWeight="bold" paddingBottom="$4" paddingLeft="$2">
        📡 IPTV
      </Text>

      {NAV_ITEMS.map((item, idx) => (
        <YStack
          key={item.id}
          ref={(el) => { itemRefs.current[idx] = el; }}
          tabIndex={0}
          focusable
          paddingVertical="$3"
          paddingHorizontal="$3"
          borderRadius="$3"
          backgroundColor={active === item.id ? '#e94560' : 'transparent'}
          hoverStyle={{ backgroundColor: active === item.id ? '#e94560' : '#2a2a4e' }}
          focusStyle={{ backgroundColor: active === item.id ? '#e94560' : '#2a2a4e', outlineWidth: 0 }}
          cursor="pointer"
          onPress={() => onSelect(item.id)}
          onKeyDown={(e) => onKeyDown(e, idx)}
        >
          <Text color={active === item.id ? 'white' : '#aaa'} fontSize="$4">
            {item.icon}  {item.label}
          </Text>
        </YStack>
      ))}

      <YStack flex={1} />

      {activeProfile && (
        <YStack paddingVertical="$2" paddingHorizontal="$3">
          <Text color="#aaa" fontSize="$2">{activeProfile.avatar} {activeProfile.name}</Text>
        </YStack>
      )}

      {profile?.username && (
        <YStack paddingVertical="$2" paddingHorizontal="$3">
          <Text color="#6abf69" fontSize="$2">👤 {profile.username}</Text>
        </YStack>
      )}

      <YStack
        tabIndex={0}
        focusable
        paddingVertical="$3"
        paddingHorizontal="$3"
        borderRadius="$3"
        hoverStyle={{ backgroundColor: '#2a2a4e' }}
        focusStyle={{ backgroundColor: '#2a2a4e', outlineWidth: 0 }}
        cursor="pointer"
        onPress={onSwitchProfile}
      >
        <Text color="#888" fontSize="$4">🔀  Switch Profile</Text>
      </YStack>

      <YStack
        ref={signOutRef}
        tabIndex={0}
        focusable
        paddingVertical="$3"
        paddingHorizontal="$3"
        borderRadius="$3"
        hoverStyle={{ backgroundColor: '#2a2a4e' }}
        focusStyle={{ backgroundColor: '#2a2a4e', outlineWidth: 0 }}
        cursor="pointer"
        onPress={signOut}
        onKeyDown={(e) => onKeyDown(e, NAV_ITEMS.length)}
      >
        <Text color="#888" fontSize="$4">🚪  Sign Out</Text>
      </YStack>
    </YStack>
  );
}

export default function AppNavigator() {
  const { authUser, authLoading, profile, signOut, currentVideo, activeProfileId, activeProfile, switchProfile } = useApp();
  const [activeTab, setActiveTab] = useState('live');
  const [showAccounts, setShowAccounts] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const itemRefs = useRef([]);
  const signOutRef = useRef(null);

  const webNavigation = {
    setOptions: () => {},
    navigate: (screen) => {
      if (screen === 'Accounts') setShowAccounts(true);
    },
    goBack: () => {},
  };

  const TOTAL = NAV_ITEMS.length + 1; // +1 for sign-out

  useEffect(() => {
    if (authUser && !authLoading) itemRefs.current[0]?.focus();
  }, [authUser, authLoading]);

  const handleKeyDown = (e, idx) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(idx + 1, TOTAL - 1);
        setFocusedIdx(next);
        if (next < NAV_ITEMS.length) itemRefs.current[next]?.focus();
        else signOutRef.current?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        setFocusedIdx(prev);
        if (prev < NAV_ITEMS.length) itemRefs.current[prev]?.focus();
        else signOutRef.current?.focus();
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (idx < NAV_ITEMS.length) setActiveTab(NAV_ITEMS[idx].id);
        else signOut();
        break;
      }
    }
  };

  if (authLoading) return null;

  if (isSupabaseConfigured() && !authUser) return <AuthScreen />;

  if (!activeProfileId) return <ProfilesScreen />;

  const ContentComponent = CONTENT_MAP[activeTab] || LiveTVScreen;

  return (
    <XStack flex={1} backgroundColor="#0f0f23">
      <Sidebar
        active={activeTab}
        focusedIdx={focusedIdx}
        itemRefs={itemRefs}
        signOutRef={signOutRef}
        onSelect={setActiveTab}
        onKeyDown={handleKeyDown}
        profile={profile}
        activeProfile={activeProfile}
        onSwitchProfile={() => switchProfile(null)}
        signOut={signOut}
      />

      <YStack flex={1} overflow="hidden">
        <ContentComponent navigation={webNavigation} />
      </YStack>

      {currentVideo && <VideoPlayerScreen />}

      {showAccounts && (
        <YStack
          position="absolute" top={0} left={0} right={0} bottom={0}
          backgroundColor="rgba(0,0,0,0.7)" zIndex={100}
          alignItems="center" justifyContent="center"
        >
          <YStack width={600} maxWidth="90%" backgroundColor="#1a1a2e" borderRadius="$4" overflow="hidden">
            <AccountsScreen onClose={() => setShowAccounts(false)} />
          </YStack>
        </YStack>
      )}
    </XStack>
  );
}

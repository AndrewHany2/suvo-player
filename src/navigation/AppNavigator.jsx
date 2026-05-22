import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { isSupabaseConfigured } from '../services/supabase';

import AuthScreen from '../screens/AuthScreen';
import ProfilesScreen from '../screens/ProfilesScreen';
import LiveTVScreen from '../screens/LiveTVScreen';
import MoviesScreen from '../screens/MoviesScreen';
import SeriesScreen from '../screens/SeriesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import VideoPlayerScreen from '../screens/VideoPlayerScreen';
import AccountsScreen from '../screens/AccountsScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function HeaderRight() {
  const { users, activeUserId, profile, authUser, isSyncing } = useApp();
  const navigation = useNavigation();
  const activeUser = users.find((u) => u.id === activeUserId);

  return (
    <View style={styles.headerRight}>
      {isSyncing && <View style={styles.syncBadge}><Text style={styles.syncText}>↻ Syncing</Text></View>}
      {activeUser && <View style={styles.userBadge}><Text style={styles.userBadgeText}>📡 {activeUser.nickname || activeUser.username}</Text></View>}
      {authUser && profile?.username && <View style={styles.profileBadge}><Text style={styles.profileText}>👤 {profile.username}</Text></View>}
      <TouchableOpacity onPress={() => navigation.navigate('Accounts')}>
        <Text style={styles.accountsBtn}>⚙️</Text>
      </TouchableOpacity>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarStyle: { backgroundColor: '#1a1a2e' },
      tabBarActiveTintColor: '#e94560',
      tabBarInactiveTintColor: '#888',
      headerStyle: { backgroundColor: '#1a1a2e' },
      headerTintColor: '#fff',
      headerRight: () => <HeaderRight />,
    }}>
      <Tab.Screen name="LiveTV"   component={LiveTVScreen}   options={{ title: 'Live TV',  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📺</Text> }} />
      <Tab.Screen name="Movies"   component={MoviesScreen}   options={{ title: 'Movies',   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🎬</Text> }} />
      <Tab.Screen name="Series"   component={SeriesScreen}   options={{ title: 'Series',   tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🎭</Text> }} />
      <Tab.Screen name="History"  component={HistoryScreen}  options={{ title: 'History',  tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🕘</Text> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { authUser, authLoading, activeProfileId } = useApp();
  if (authLoading) return null;

  if (!activeProfileId) return <ProfilesScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff', contentStyle: { backgroundColor: '#0f0f23' } }}>
        {isSupabaseConfigured() && !authUser ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main"        component={MainTabs}        options={{ headerShown: false }} />
            <Stack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ headerShown: false, presentation: 'fullScreenModal' }} />
            <Stack.Screen name="Accounts"    component={AccountsScreen}   options={{ title: 'IPTV Accounts', presentation: 'modal', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 12 },
  syncBadge:   { backgroundColor: 'rgba(233,69,96,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)' },
  syncText:    { color: '#e94560', fontSize: 11, fontWeight: '600' },
  userBadge:   { backgroundColor: '#2a2a4e', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  userBadgeText: { color: '#aaa', fontSize: 11 },
  profileBadge: { backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  profileText:  { color: '#6abf69', fontSize: 11 },
  accountsBtn:  { fontSize: 20, paddingHorizontal: 2 },
});

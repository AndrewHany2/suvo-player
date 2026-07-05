import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator } from "react-native";
import { YStack, XStack, Text } from "../ui/primitives";
import Icon from "../ui/Icon";
import { colors, accentAlpha } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { useAppGate } from "./useAppGate";

import AuthScreen from "../screens/AuthScreen";
import ConfigErrorScreen from "../screens/ConfigErrorScreen";
import DeviceLockedScreen from "../screens/DeviceLockedScreen";
import ProfilesScreen from "../screens/ProfilesScreen";
import LiveTVScreen from "../screens/LiveTVScreen";
import MoviesScreen from "../screens/MoviesScreen";
import SeriesScreen from "../screens/SeriesScreen";
import HistoryScreen from "../screens/HistoryScreen";
import VideoPlayerScreen from "../screens/VideoPlayerScreen";
import AccountsScreen from "../screens/AccountsScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HeaderRight() {
  const { users, activeUserId, activeProfile, switchProfile, isSyncing } = useApp();
  const navigation = useNavigation();
  const activeUser = users.find((u) => u.id === activeUserId);
  const playlistName = activeUser?.nickname || activeUser?.username;

  return (
    <XStack alignItems="center" gap={8} marginRight={12} flexShrink={1}>
      {isSyncing && (
        <Text color={colors.accent} fontSize={14} fontWeight="700">↻</Text>
      )}
      {playlistName && (
        <XStack
          alignItems="center" gap={6}
          backgroundColor={accentAlpha(0.1)} borderWidth={1} borderColor={accentAlpha(0.3)}
          borderRadius={999} paddingHorizontal={10} paddingVertical={5} flexShrink={1}
          cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.7 }}
        >
          <Icon name="signal" size={12} color={colors.accent2} />
          <Text color={colors.text} fontSize={12} fontWeight="600" numberOfLines={1} maxWidth={120}>{playlistName}</Text>
        </XStack>
      )}
      {activeProfile && (
        // Tap the profile avatar to switch profiles: clearing the active id drops
        // the app back through the gate to the "Who's watching?" picker (mirrors
        // the web/TV TopNav avatar button).
        <YStack
          width={32} height={32} borderRadius={999} backgroundColor={colors.accent}
          alignItems="center" justifyContent="center" flexShrink={0}
          cursor="pointer" onPress={() => switchProfile(null)} pressStyle={{ opacity: 0.7 }}
          hitSlop={8}
        >
          <Text fontSize={18}>{activeProfile.avatar || "👤"}</Text>
        </YStack>
      )}
      <YStack cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.7 }} flexShrink={0} minWidth={44} minHeight={44} alignItems="center" justifyContent="center" hitSlop={8}>
        <Icon name="settings" size={20} color={colors.text} />
      </YStack>
    </XStack>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{
      // Suspend (freeze) a tab's render tree while it's not focused, so the
      // inactive Movies/Series/LiveTV/History screens don't re-render in the
      // background. Backed by react-native-screens + react-freeze.
      freezeOnBlur: true,
      tabBarStyle: { backgroundColor: colors.surface2, borderTopColor: colors.border },
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      headerStyle: { backgroundColor: colors.bg },
      headerShadowVisible: false,
      headerTintColor: colors.text,
      headerTitleAlign: "left",
      headerTitleStyle: { fontWeight: "700", fontSize: 22, letterSpacing: -0.4 },
      headerRight: () => <HeaderRight />,
    }}>
      <Tab.Screen name="LiveTV"  component={LiveTVScreen}  options={{ title: "Live TV", tabBarIcon: ({ color }) => <Icon name="tv" size={20} color={color} /> }} />
      <Tab.Screen name="Movies"  component={MoviesScreen}  options={{ title: "Movies",  tabBarIcon: ({ color }) => <Icon name="film" size={20} color={color} /> }} />
      <Tab.Screen name="Series"  component={SeriesScreen}  options={{ title: "Series",  tabBarIcon: ({ color }) => <Icon name="series" size={20} color={color} /> }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: "History", tabBarIcon: ({ color }) => <Icon name="history" size={20} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const gate = useAppGate();
  // Neutral boot splash while the session/device resolves — auth-agnostic spinner
  // only, never an optimistic skeleton. The 8s authLoading ceiling lives in AppContext.
  const splash = (
    <YStack flex={1} alignItems="center" justifyContent="center" backgroundColor={colors.bg}>
      <ActivityIndicator size="large" color={colors.accent} />
    </YStack>
  );
  if (gate === "config-error") return <ConfigErrorScreen />;
  if (gate === "loading") return splash;
  if (gate === "auth") return <AuthScreen />;
  if (gate === "device-locked") return <DeviceLockedScreen />;
  if (gate === "profiles") return <ProfilesScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ freezeOnBlur: true, headerStyle: { backgroundColor: colors.surface2 }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="Main"        component={MainTabs}         options={{ headerShown: false }} />
        <Stack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="Accounts"    component={AccountsScreen}   options={{ title: "IPTV Accounts", presentation: "modal", headerStyle: { backgroundColor: colors.surface2 }, headerTintColor: colors.text }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

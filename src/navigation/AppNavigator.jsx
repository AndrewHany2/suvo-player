import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useWindowDimensions } from "react-native";
import { YStack, XStack, Text } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { isSupabaseConfigured } from "../services/supabase";

import AuthScreen from "../screens/AuthScreen";
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
  const { users, activeUserId, profile, authUser, isSyncing } = useApp();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const compact = width < 400;
  const nameMax = compact ? 72 : 140;
  const activeUser = users.find((u) => u.id === activeUserId);

  return (
    <XStack alignItems="center" gap={6} marginRight={12} flexShrink={1}>
      {isSyncing && (
        <YStack backgroundColor="rgba(108, 92, 231,0.2)" borderRadius={8} paddingHorizontal={8} paddingVertical={3} borderWidth={1} borderColor="rgba(108, 92, 231,0.4)">
          <Text color={colors.accent} fontSize={11} fontWeight="600">{compact ? "↻" : "↻ Syncing"}</Text>
        </YStack>
      )}
      {activeUser && (
        <YStack backgroundColor={colors.border} borderRadius={8} paddingHorizontal={8} paddingVertical={3} flexShrink={1}>
          <Text color="#aaa" fontSize={11} numberOfLines={1} maxWidth={nameMax}>📡 {activeUser.nickname || activeUser.username}</Text>
        </YStack>
      )}
      {authUser && profile?.username && (
        <YStack backgroundColor="#1a2a1a" borderRadius={8} paddingHorizontal={8} paddingVertical={3} flexShrink={1}>
          <Text color={colors.success} fontSize={11} numberOfLines={1} maxWidth={nameMax}>👤 {profile.username}</Text>
        </YStack>
      )}
      <YStack cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.7 }} flexShrink={0} minWidth={44} minHeight={44} alignItems="center" justifyContent="center" hitSlop={8}>
        <Text fontSize={20} paddingHorizontal={2}>⚙️</Text>
      </YStack>
    </XStack>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarStyle: { backgroundColor: colors.surface2 },
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: "#888",
      headerStyle: { backgroundColor: colors.surface2 },
      headerTintColor: colors.text,
      headerRight: () => <HeaderRight />,
    }}>
      <Tab.Screen name="LiveTV"  component={LiveTVScreen}  options={{ title: "Live TV", tabBarIcon: ({ color }) => <Text color={color} fontSize={18}>📺</Text> }} />
      <Tab.Screen name="Movies"  component={MoviesScreen}  options={{ title: "Movies",  tabBarIcon: ({ color }) => <Text color={color} fontSize={18}>🎬</Text> }} />
      <Tab.Screen name="Series"  component={SeriesScreen}  options={{ title: "Series",  tabBarIcon: ({ color }) => <Text color={color} fontSize={18}>🎭</Text> }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: "History", tabBarIcon: ({ color }) => <Text color={color} fontSize={18}>🕘</Text> }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { authUser, authLoading, activeProfileId } = useApp();
  if (authLoading) return null;
  if (isSupabaseConfigured() && !authUser) return <AuthScreen />;
  if (!activeProfileId) return <ProfilesScreen />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.surface2 }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="Main"        component={MainTabs}         options={{ headerShown: false }} />
        <Stack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="Accounts"    component={AccountsScreen}   options={{ title: "IPTV Accounts", presentation: "modal", headerStyle: { backgroundColor: colors.surface2 }, headerTintColor: colors.text }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

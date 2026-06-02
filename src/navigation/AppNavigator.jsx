import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { YStack, XStack, Text } from "tamagui";
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
  const activeUser = users.find((u) => u.id === activeUserId);

  return (
    <XStack alignItems="center" gap={6} marginRight={12}>
      {isSyncing && (
        <YStack backgroundColor="rgba(233,69,96,0.2)" borderRadius={8} paddingHorizontal={8} paddingVertical={3} borderWidth={1} borderColor="rgba(233,69,96,0.4)">
          <Text color="#e94560" fontSize={11} fontWeight="600">↻ Syncing</Text>
        </YStack>
      )}
      {activeUser && (
        <YStack backgroundColor="#2a2a4e" borderRadius={8} paddingHorizontal={8} paddingVertical={3}>
          <Text color="#aaa" fontSize={11}>📡 {activeUser.nickname || activeUser.username}</Text>
        </YStack>
      )}
      {authUser && profile?.username && (
        <YStack backgroundColor="#1a2a1a" borderRadius={8} paddingHorizontal={8} paddingVertical={3}>
          <Text color="#6abf69" fontSize={11}>👤 {profile.username}</Text>
        </YStack>
      )}
      <YStack cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.7 }}>
        <Text fontSize={20} paddingHorizontal={2}>⚙️</Text>
      </YStack>
    </XStack>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarStyle: { backgroundColor: "#1a1a2e" },
      tabBarActiveTintColor: "#e94560",
      tabBarInactiveTintColor: "#888",
      headerStyle: { backgroundColor: "#1a1a2e" },
      headerTintColor: "#fff",
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
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#1a1a2e" }, headerTintColor: "#fff", contentStyle: { backgroundColor: "#0f0f23" } }}>
        <Stack.Screen name="Main"        component={MainTabs}         options={{ headerShown: false }} />
        <Stack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="Accounts"    component={AccountsScreen}   options={{ title: "IPTV Accounts", presentation: "modal", headerStyle: { backgroundColor: "#1a1a2e" }, headerTintColor: "#fff" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

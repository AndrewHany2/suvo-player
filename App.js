import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { colors } from './src/ui/tokens';
import { AppProvider } from './src/context/AppContext';
import { PlatformProvider } from './src/platform/PlatformProvider';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  // Aurora typeface: Space Grotesk (display) + Inter (body), registered under
  // clean family names so tokens/CSS can reference "SpaceGrotesk" / "Inter".
  // Not gated on load — the UI renders immediately with the system fallback and
  // swaps in the webfonts when ready (so TV never shows a blank screen).
  useFonts({
    SpaceGrotesk: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
    Inter: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  });

  // Phones run portrait everywhere except the video player (which locks to
  // landscape and restores portrait on exit). Lock at launch so the browse UI
  // never starts sideways. Skipped on web and TV, which manage their own layout.
  useEffect(() => {
    const isPhone = (Platform.OS === 'ios' || Platform.OS === 'android') && !Platform.isTV;
    if (!isPhone) return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={colors.bg} />
      <PlatformProvider>
        <AppProvider>
          <AppNavigator />
        </AppProvider>
      </PlatformProvider>
    </SafeAreaProvider>
  );
}

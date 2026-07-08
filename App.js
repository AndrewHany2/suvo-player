import { useEffect } from 'react';
import { Platform, LogBox } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, FontDisplay } from 'expo-font';
import { colors } from './src/ui/tokens';
import { AppProvider } from './src/context/AppContext';
import { PlatformProvider } from './src/platform/PlatformProvider';
import AppNavigator from './src/navigation/AppNavigator';

// Supabase's GoTrueClient logs a bare console.error when a stored refresh token
// is rejected on startup ("Invalid Refresh Token: Refresh Token Not Found").
// This is benign and self-healed: the library removes the stale session
// immediately after (auth-js GoTrueClient._recoverAndRefresh). We can't stop it
// logging without patching the dep, so silence just that known message from the
// native LogBox overlay. No-op on web/TV where LogBox.ignoreLogs is a shim.
LogBox.ignoreLogs([/Invalid Refresh Token: Refresh Token Not Found/]);

export default function App() {
  // Aurora typeface: Space Grotesk (display) + Inter (body), registered under
  // clean family names so tokens/CSS can reference "SpaceGrotesk" / "Inter".
  // Not gated on load — the UI renders immediately with the system fallback and
  // swaps in the webfonts when ready (so TV never shows a blank screen).
  //
  // On the webOS TV build the page loads from file:// and Chromium's slow-network
  // font intervention forces a fallback-first repaint with the default
  // font-display:auto. The TV build (tv/patch-index.js) preloads these fonts and
  // declares them statically in <head> with font-display:optional; we mirror
  // optional here so expo-font's runtime @font-face matches that static rule
  // instead of re-introducing `auto`. __TV__ is set synchronously in the patched
  // index.html <head>, before this component mounts. Other platforms keep the
  // default (display omitted → auto on web, ignored on native).
  const isTV = typeof globalThis !== 'undefined' && globalThis.__TV__ === true;
  const tvFontDisplay = isTV ? FontDisplay.OPTIONAL : undefined;
  useFonts({
    SpaceGrotesk: {
      uri: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
      display: tvFontDisplay,
    },
    Inter: {
      uri: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
      display: tvFontDisplay,
    },
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

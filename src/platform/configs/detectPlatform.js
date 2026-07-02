import { Platform } from "react-native";

export function detectPlatform() {
  // Mobile (iOS/Android via RN)
  if (Platform.OS === "ios" || Platform.OS === "android") return "mobile";

  if (typeof window === "undefined") return "web";

  // Explicit TV flag set by the build's index.html (takes priority over UA)
  if (globalThis.__TV__) return "tv";

  const ua = window.navigator.userAgent;
  if (/webOS|Web0S|Tizen|SmartTV/i.test(ua)) return "tv";
  if (/Electron/i.test(ua)) return "desktop";
  return "web";
}

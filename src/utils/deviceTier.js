// Coarse device capability tier for native (iOS/Android), used to degrade
// gracefully on budget hardware: fewer mounted list cells, no image crossfade,
// simpler cards. Dependency-free (no expo-device / native module, so it needs no
// native rebuild) — a heuristic from signals available synchronously in JS.
//
// Accuracy note: the accurate signal is total RAM, which core RN doesn't expose.
// If expo-device is ever added, swap computeTier() to key off Device.totalMemory
// (e.g. < ~3 GB → "low"); the rest of the app only reads getDeviceTier().
import { Platform, PixelRatio, Dimensions } from "react-native";

// Conservative: only flag clearly weak/old hardware as "low". Consequences of a
// wrong guess are mild (a mid device mounting a couple fewer cards, no fade), so
// we bias toward "normal" and reserve "low" for strong signals.
function computeTier() {
  if (Platform.OS === "android") {
    // Platform.Version is the Android API level (number). <= 24 == Android 7 and
    // older, i.e. hardware from ~2016 or a very low-end current device.
    const api = typeof Platform.Version === "number" ? Platform.Version : 99;
    if (api <= 24) return "low";
  }
  const { width, height } = Dimensions.get("window");
  const minDim = Math.min(width, height);
  // ldpi/mdpi screens and very small logical widths correlate with budget/old
  // devices (a modern phone is >= 2x density and >= ~360pt wide).
  if (PixelRatio.get() < 2 || minDim < 340) return "low";
  return "normal";
}

// Frozen at first read (like scaleSize's SCALE): tier can't change at runtime.
let TIER = null;
export function getDeviceTier() {
  if (TIER === null) TIER = computeTier();
  return TIER;
}

export function isLowEndDevice() {
  return getDeviceTier() === "low";
}

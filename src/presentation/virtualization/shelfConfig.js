// src/presentation/virtualization/shelfConfig.js
// Single home for the "keep ~4 ahead" lookahead knob and poster/row geometry,
// tuned per platform. TV overscans more to mask D-pad latency and guarantee the
// focused card sits comfortably inside the mounted window.

const CONFIG = {
  web:    { hOverscan: 4, vOverscan: 2, posterWidth: 290, posterGap: 8,  rowHeight: 360 },
  native: { hOverscan: 4, vOverscan: 2, posterWidth: 150, posterGap: 10, rowHeight: 240 },
  tv:     { hOverscan: 6, vOverscan: 2, posterWidth: 340, posterGap: 12, rowHeight: 520 },
};

// detectPlatform()'s vocabulary differs from these config keys: it returns
// "mobile" | "tv" | "desktop" | "web". The config is keyed by renderer, not by
// device, so we normalize: React Native mobile uses the "native" renderer, and
// Electron ("desktop") runs the web build, so both collapse onto "web"/"native".
// Explicit callers (getShelfConfig("web"|"native"|"tv")) pass through untouched.
const PLATFORM_TO_KEY = {
  web: "web",
  native: "native",
  tv: "tv",
  mobile: "native",
  desktop: "web",
};

export function getShelfConfig(platform) {
  // Resolve detectPlatform lazily: it imports react-native, which the pure
  // `node --test` runner can't parse. Explicit-string callers (the common case,
  // and every unit test) never touch it; only the no-arg runtime path does.
  let raw = platform;
  if (!raw) {
    const { detectPlatform } = require("../../platform/configs/detectPlatform.js");
    raw = detectPlatform();
  }
  const key = PLATFORM_TO_KEY[raw] || "web";
  return CONFIG[key];
}

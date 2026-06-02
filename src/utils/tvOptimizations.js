/**
 * TV Performance Optimizations
 * Detects TV platform and provides optimized settings
 */

export const isTV =
  typeof window !== "undefined" &&
  (window.navigator.userAgent.includes("Web0S") ||
    window.navigator.userAgent.includes("webOS") ||
    window.navigator.userAgent.includes("SmartTV"));

// TV-optimized settings
export const TV_CONFIG = {
  // Disable heavy features on TV
  disableTMDB: true, // Don't fetch TMDB data (slow API calls)
  disableAnimations: true, // Disable Tamagui animations
  reducedItemsPerPage: true, // Show fewer items per page
  disablePrefetch: true, // Don't prefetch data
  simplifiedUI: true, // Use simpler UI components

  // Optimized pagination
  shelfPageSize: 8, // Fewer items per shelf
  gridPageSize: 20, // Fewer items in grid view

  // Performance settings
  removeClippedSubviews: true, // Remove off-screen views
  maxToRenderPerBatch: 5, // Render fewer items at once
  windowSize: 3, // Smaller render window
};

// Desktop/Electron settings (full features)
export const DESKTOP_CONFIG = {
  disableTMDB: false,
  disableAnimations: false,
  reducedItemsPerPage: false,
  disablePrefetch: false,
  simplifiedUI: false,

  shelfPageSize: 12,
  gridPageSize: 40,

  removeClippedSubviews: false,
  maxToRenderPerBatch: 10,
  windowSize: 5,
};

// Get config based on platform
export const getConfig = () => (isTV ? TV_CONFIG : DESKTOP_CONFIG);

// Check if feature should be enabled
export const shouldUseTMDB = () => !isTV || !TV_CONFIG.disableTMDB;
export const shouldAnimate = () => !isTV || !TV_CONFIG.disableAnimations;
export const shouldPrefetch = () => !isTV || !TV_CONFIG.disablePrefetch;

// Made with Bob

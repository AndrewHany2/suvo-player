import { Dimensions } from 'react-native';

// Reference design resolution — all sizes in the app are authored at this.
const DESIGN_WIDTH  = 1920;
const DESIGN_HEIGHT = 1080;

// Snapshot on startup. TVs never resize; browser dev tools should be set to
// the correct viewport (1280px with our viewport meta, or 1920px native).
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Uniform scale factor: whichever axis is the tighter fit governs.
// Do NOT divide by PixelRatio — Dimensions already returns CSS logical pixels
// on web (DPR is handled by the browser). On LG TV (DPR=1, viewport=1280)
// and on native (where PixelRatio may vary), this gives the right result.
const SCALE = Math.min(SCREEN_WIDTH / DESIGN_WIDTH, SCREEN_HEIGHT / DESIGN_HEIGHT);

/**
 * Scale a design-time measurement to the current screen.
 *
 * Usage:
 *   fontSize={ss(28)}   // 28pt at 1080p → correct physical px on any TV
 *   padding={ss(48)}
 *
 * @param {number} size  Size at 1920×1080 reference resolution.
 * @returns {number}     CSS pixel value for the current screen.
 */
export const ss = (size) => Math.round(size * SCALE);

// Verbose alias for readability in non-UI contexts.
export const scaleSize = ss;

// Pure geometry for ProgressRing.jsx, split out so it can be unit-tested without
// importing react-native (node:test can't load .jsx / RN modules).
//
// Given a 0..100 percent, returns the end-angle (deg) of each of the two 180°
// semicircle disks and whether the second disk is a real fill or a track-coloured
// mask. See ProgressRing.jsx for how these drive the painter's-algorithm ring.
export function computeHalfCircleDegrees(percent) {
  const p = Math.max(0, Math.min(100, percent));
  const needSecond = p > 50;
  return {
    first: needSecond ? 180 : p * 3.6,
    second: needSecond ? p * 3.6 : 0,
    secondIsFill: needSecond,
  };
}

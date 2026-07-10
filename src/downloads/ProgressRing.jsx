// Determinate circular progress ring built from plain <View>s — react-native-svg
// is NOT installed and adding a dependency is forbidden (see Icon.native.jsx).
//
// Technique (painter's algorithm, no overflow clipping): the track is a full disk
// in `trackColor`. Two 180° semicircle disks are drawn on top and rotated about the
// circle's centre. For fill ≤ 50% one accent disk covers a 180° wedge and the second
// disk — painted in trackColor — masks the half that should stay unfilled. For fill
// > 50% both disks are accent. An opaque inner circle (`maskColor`) punches out the
// middle to leave a ring, and any children (e.g. an icon) sit centred inside it.
//
// Ported from the battle-tested react-native-progress-circle geometry. Native-only —
// only DownloadButton (itself native-only) imports this.
import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { computeHalfCircleDegrees } from './progressMath.js';

function ProgressRing({
  radius = 15,
  borderWidth = 3,
  percent = 0,
  color,
  trackColor,
  maskColor,
  children,
}) {
  const { first, second, secondIsFill } = computeHalfCircleDegrees(percent);
  const inner = radius - borderWidth;

  const halfCircle = (deg, fill) => (
    <View style={[styles.wrap, { width: radius, height: radius * 2 }]}>
      <View
        style={[
          styles.half,
          {
            width: radius,
            height: radius * 2,
            borderRadius: radius,
            backgroundColor: fill ? color : trackColor,
            transform: [
              { translateX: radius / 2 },
              { rotate: `${deg}deg` },
              { translateX: -radius / 2 },
            ],
          },
        ]}
      />
    </View>
  );

  return (
    <View
      style={[
        styles.outer,
        { width: radius * 2, height: radius * 2, borderRadius: radius, backgroundColor: trackColor },
      ]}
    >
      {halfCircle(first, true)}
      {halfCircle(second, secondIsFill)}
      <View
        style={[
          styles.inner,
          { width: inner * 2, height: inner * 2, borderRadius: inner, backgroundColor: maskColor },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { justifyContent: 'center', alignItems: 'center' },
  inner: { overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  wrap: { position: 'absolute', top: 0, left: 0 },
  half: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
});

export default memo(ProgressRing);

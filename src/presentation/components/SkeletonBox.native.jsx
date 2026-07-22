import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { colors, radii } from "../../ui/tokens";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { isLowEndDevice } from "../../utils/deviceTier";

const LOW_END = isLowEndDevice();

/**
 * SkeletonBox — a single rounded loading placeholder of arbitrary size (native).
 *
 * The native counterpart to SkeletonBox.web: instead of a sweeping highlight it
 * pulses opacity via the native driver, so the loop runs on the UI thread and
 * stays smooth while JS parses incoming data (mirrors SkeletonPoster.native).
 * Honors reduced-motion / low-end by settling to a static box — "reduced motion
 * everywhere" is a hard product bar. Sizes are raw px; ss() is caller-applied.
 */
export default function SkeletonBox({ width, height, radius = radii.card, style }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (LOW_END || reducedMotion) {
      opacity.setValue(0.6);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.surface,
        opacity,
        ...style,
      }}
    />
  );
}

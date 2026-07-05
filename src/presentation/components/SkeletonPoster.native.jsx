import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { colors, radii } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

/**
 * Poster-shaped loading placeholder — native.
 *
 * Mirrors PosterCard.native's box (width × 1.5 poster + a title line) so a
 * loading rail reserves the real posters' footprint and swaps in with no layout
 * shift. Pulses opacity via the native driver, so the animation runs on the UI
 * thread and stays smooth while JS parses the incoming catalog.
 */
export default function SkeletonPoster({ width = 120 }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  const posterH = Math.round(width * 1.5);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ width, opacity }}>
      <Animated.View
        style={{
          width,
          height: posterH,
          borderRadius: radii.card,
          backgroundColor: colors.surface,
        }}
      />
      <Animated.View
        style={{
          width: Math.round(width * 0.8),
          height: ss(12),
          marginTop: ss(10),
          borderRadius: radii.sm / 2,
          backgroundColor: colors.surface,
        }}
      />
    </Animated.View>
  );
}

import { memo, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { Image } from "expo-image";
import { colors, radii, fonts, fontWeights, glow, focusRing, overlay } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import { isLowEndDevice } from "../../utils/deviceTier";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import Icon from "../../ui/Icon";

// Device tier is frozen at first read, so resolve it once at module scope.
// Low-end: no image crossfade, static (non-pulsing) placeholder, no HD badge.
const LOW_END = isLowEndDevice();

/**
 * Poster card — native. Shared across Movies/Series/LiveTV grids and shelves.
 * Accepts the raw IPTV item; reads the same fields the old inline cards did.
 *
 * Aurora interaction language: resting state is a subtle hairline border only.
 * Focus (remote/keyboard `isFocused`) or press promotes to the cyan accent2
 * border + native glow shadow — never a resting glow. Sizing flows through ss()
 * so it tracks the type/spacing ramp; all colours come from tokens. The film and
 * star glyphs are the shared Icon set, not emoji.
 */
function PosterCardNative({ item, onPress, isFocused = false, width = 130 }) {
  // Movies/Live resolve stream_icon/cover first; series carry no stream_icon so
  // they fall through to cover, with backdrop_path as the cover-absent fallback.
  const poster = item.stream_icon || item.cover || item.movie_image || item.backdrop_path || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ""
    ? (typeof ratingValue === "number" ? ratingValue.toFixed(1) : ratingValue)
    : null;
  const height = (width * 3) / 2;

  // Skeleton shimmer while THIS poster's image decodes: a native-driver opacity
  // pulse (UI thread, so it stays smooth while JS parses the catalog), hidden
  // once the image loads. expo-image auto-downscales the remote poster to the
  // cell size, so no full-res decode into a small card on low-end devices.
  const [loaded, setLoaded] = useState(false);
  const reducedMotion = useReducedMotion();
  const shimmer = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    // Skip the pulse on low-end or when reduced-motion is on: a static
    // placeholder block avoids running one native-driver loop per mounted card
    // on weak hardware, and honors the OS "Reduce Motion" setting.
    if (!poster || loaded || LOW_END || reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [poster, loaded, shimmer, reducedMotion]);

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.85 }]}
    >
      {({ pressed }) => {
        const active = isFocused || pressed;
        return (
          <>
            <View
              style={[
                styles.poster,
                { width, height },
                active ? styles.posterActive : null,
              ]}
            >
              {poster ? (
                <>
                  {!loaded && <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, { opacity: shimmer }]} />}
                  <Image
                    source={poster}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={poster}
                    transition={(LOW_END || reducedMotion) ? 0 : 150}
                    onLoad={() => setLoaded(true)}
                  />
                </>
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
                  <Icon name="film" size={ss(34)} color={colors.faint} />
                </View>
              )}
              {!LOW_END && (
                <View style={[styles.badge, styles.hdBadge]}>
                  <Text style={styles.badgeText}>HD</Text>
                </View>
              )}
              {ratingLabel && (
                <View style={[styles.badge, styles.ratingBadge]}>
                  <Icon name="star" size={ss(11)} color={colors.rating} />
                  <Text style={styles.ratingText}>{ratingLabel}</Text>
                </View>
              )}
            </View>
            <Text numberOfLines={2} style={styles.title}>{item.name}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Focus/press only: cyan ring + native glow shadow. Never shown at rest.
  posterActive: {
    borderWidth: 2,
    borderColor: focusRing.color,
    ...glow,
  },
  placeholder: {
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  shimmer: {
    backgroundColor: colors.surface2,
  },
  badge: {
    position: "absolute",
    top: ss(8),
    zIndex: 4,
    backgroundColor: overlay,
    borderRadius: radii.sm / 2,
    paddingHorizontal: ss(5),
    paddingVertical: ss(2),
    flexDirection: "row",
    alignItems: "center",
  },
  hdBadge: { right: ss(8) },
  ratingBadge: { left: ss(8), gap: ss(3) },
  badgeText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: ss(9),
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
  },
  ratingText: {
    color: colors.rating,
    fontFamily: fonts.body,
    fontSize: ss(9),
    fontWeight: fontWeights.bold,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: ss(12),
    fontWeight: fontWeights.medium,
    marginTop: ss(8),
    lineHeight: ss(16),
  },
});

export default memo(PosterCardNative);

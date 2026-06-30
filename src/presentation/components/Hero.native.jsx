/**
 * Hero — cinematic featured banner, native (iOS/Android).
 *
 * Same prop API + look as Hero.web: full-bleed backdrop Image under a
 * left→transparent gradient scrim, with a bottom-left content block (eyebrow /
 * title / meta / actions). The scrim uses expo-linear-gradient (the only
 * gradient dep available — react-native-svg is NOT installed), fed the
 * tokenized scrim.native colors/locations/start/end.
 *
 * Sizing flows through ss() so the hero matches the web ramp.
 */
import { memo } from "react";
import { View, Text, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  colors, scrim, radii, fonts, fontWeights, heroHeights, iconSizes,
} from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import Icon from "../../ui/Icon";
import Button from "../../ui/Button";

function resolveBackdrop(item) {
  if (!item) return null;
  const src = item.backdrop_path || item.cover || item.movie_image || item.stream_icon;
  return typeof src === "string" && src.trim() !== "" ? src : null;
}

function metaParts(item) {
  if (!item) return [];
  const parts = [];
  const year = item.year || item.releaseDate || item.release_date;
  if (year) parts.push(String(year).slice(0, 4));
  const genre = item.genre || item.category_name;
  if (genre) parts.push(String(genre));
  return parts;
}

function HeroNative({ item, onPlay, onDetails, focused = false }) {
  const backdrop = resolveBackdrop(item);
  const title = item?.name || item?.title || "";
  const parts = metaParts(item);
  const ratingValue = item?.tmdb_rating ?? item?.rating;
  const ratingLabel =
    ratingValue != null && ratingValue !== ""
      ? typeof ratingValue === "number"
        ? ratingValue.toFixed(1)
        : ratingValue
      : null;

  const height = ss(heroHeights.native);
  const pad = ss(24);

  return (
    <View
      style={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
      }}
    >
      {backdrop ? (
        <Image
          source={{ uri: backdrop }}
          resizeMode="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
        />
      ) : null}

      {/* Left→transparent scrim so the content stays legible over art. */}
      <LinearGradient
        colors={scrim.native.colors}
        locations={scrim.native.locations}
        start={scrim.native.start}
        end={scrim.native.end}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Bottom-left content block. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: pad,
          flexDirection: "column",
          gap: ss(10),
        }}
      >
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: ss(12),
            fontWeight: fontWeights.medium,
            letterSpacing: ss(2),
            color: colors.muted,
          }}
        >
          FEATURED
        </Text>

        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.display,
            fontWeight: fontWeights.bold,
            fontSize: ss(26),
            lineHeight: ss(30),
            color: colors.text,
          }}
        >
          {title}
        </Text>

        {(parts.length > 0 || ratingLabel) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: ss(8) }}>
            {parts.map((p, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: ss(8) }}>
                {i > 0 ? <Text style={{ color: colors.faint }}>·</Text> : null}
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: ss(14) }}>{p}</Text>
              </View>
            ))}
            {ratingLabel ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: ss(4) }}>
                {parts.length > 0 ? <Text style={{ color: colors.faint }}>·</Text> : null}
                <Icon name="star" size={ss(iconSizes.sm)} color={colors.rating} />
                <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: ss(14) }}>{ratingLabel}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={{ flexDirection: "row", gap: ss(12), marginTop: ss(6) }}>
          <Button variant="primary" size="md" icon="play" onPress={onPlay} isFocused={focused}>
            Play
          </Button>
          <Button variant="secondary" size="md" icon="plus" onPress={onDetails}>
            Details
          </Button>
        </View>
      </View>
    </View>
  );
}

export default memo(HeroNative);

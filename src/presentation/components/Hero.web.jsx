import { Image, View } from "react-native";
import { YStack, XStack, Text } from "../../ui/primitives";
import Button from "../../ui/Button";
import Icon from "../../ui/Icon";
import {
  colors,
  fonts,
  fontWeights,
  radii,
  scrim,
  motion,
  easing,
} from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

/**
 * Web Home hero — the cinematic entry point to the Home surface.
 *
 * A single featured title (the most recent Continue-Watching item, or the first
 * My-List item) rendered as a full-bleed billboard: backdrop art, a display-font
 * title, honest resume metadata, and a Play/Resume + secondary action pair. This
 * is the "content is the hero" moment the browse rails build up from.
 *
 * Presentational only — the screen passes display-ready strings + callbacks so
 * this file never reaches into the history hooks or URL builders.
 *
 * Web-only affordances (gradients, transitions, soft shadows) are fine here: the
 * webOS `file://` constraints that flatten Hero.tv.jsx do NOT apply to the .web
 * variant. Motion is still gentle, and the app-wide `prefers-reduced-motion`
 * rule (AppNavigator.web) neutralises the fade for motion-sensitive users.
 */
export default function HeroWeb({
  backdrop,
  title,
  meta,
  continuityLabel,
  primaryLabel = "Play",
  onPrimary,
  secondaryLabel,
  onSecondary,
  height = 420,
}) {
  return (
    <View
      style={{
        position: "relative",
        height: ss(height),
        marginLeft: ss(48),
        marginRight: ss(48),
        marginBottom: ss(48),
        borderRadius: radii.lg,
        overflow: "hidden",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {backdrop ? (
        <Image
          source={{ uri: backdrop }}
          style={[
            FILL,
            {
              // Gentle fade-in so the billboard settles rather than snaps.
              // The global prefers-reduced-motion rule zeroes this out.
              transition: `opacity ${motion.slow}ms ${easing}`,
            },
          ]}
          resizeMode="cover"
        />
      ) : (
        <View style={[FILL, { backgroundColor: colors.surface }]} />
      )}

      {/* Left→right wash keeps the title legible over busy art (tokens.scrim). */}
      <View
        aria-hidden
        style={[FILL, { background: scrim.css }]}
      />
      {/* Bottom fade blends the billboard into the midnight rails below it. */}
      <View
        aria-hidden
        style={[
          FILL,
          {
            background:
              "linear-gradient(to top, #0A0E1A 0%, rgba(10,14,26,0.35) 30%, rgba(10,14,26,0) 60%)",
          },
        ]}
      />

      <YStack
        position="absolute"
        left={ss(48)}
        right={ss(48)}
        bottom={ss(44)}
        zIndex={2}
        maxWidth={ss(640)}
      >
        {continuityLabel ? (
          <XStack alignItems="center" gap={ss(6)} marginBottom={ss(12)}>
            <Icon name="signal" size={ss(14)} color={colors.muted} />
            <Text
              color={colors.muted}
              fontFamily={fonts.display}
              fontWeight={fontWeights.medium}
              fontSize={ss(13)}
              letterSpacing={0.3}
            >
              {continuityLabel}
            </Text>
          </XStack>
        ) : null}

        <Text
          color={colors.textStrong}
          fontFamily={fonts.display}
          fontWeight={fontWeights.bold}
          fontSize={ss(40)}
          lineHeight={ss(44)}
          letterSpacing={-0.8}
          numberOfLines={2}
        >
          {title}
        </Text>

        {meta ? (
          <Text
            color={colors.text}
            fontFamily={fonts.body}
            fontSize={ss(15)}
            marginTop={ss(10)}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}

        <XStack gap={ss(12)} marginTop={ss(20)} alignItems="center">
          <Button variant="primary" size="lg" icon="play" onPress={onPrimary}>
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button variant="secondary" size="lg" onPress={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
        </XStack>
      </YStack>
    </View>
  );
}

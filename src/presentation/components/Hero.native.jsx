import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { YStack, XStack, Text } from "../../ui/primitives";
import Button from "../../ui/Button";
import Icon from "../../ui/Icon";
import { colors, fonts, fontWeights, radii } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

/**
 * Native (iOS/Android) Home hero — the native twin of Hero.web.
 *
 * Same prop API and layout as the web hero (backdrop, display title, resume
 * meta, continuity label, Play/Resume + secondary Button pair) so the Home
 * surface reads identically across phone, desktop, and TV. The only difference
 * is the rendering substrate: expo-image for the cached backdrop and
 * expo-linear-gradient for the legibility scrims (RN has no CSS `background`
 * gradients), and no `transition` (native honors reduced-motion elsewhere).
 *
 * Presentational only — the screen passes display-ready strings + callbacks.
 */
export default function HeroNative({
  backdrop,
  title,
  meta,
  continuityLabel,
  primaryLabel = "Play",
  onPrimary,
  secondaryLabel,
  onSecondary,
  height = 300,
}) {
  return (
    <View
      style={{
        position: "relative",
        height: ss(height),
        marginLeft: ss(16),
        marginRight: ss(16),
        marginBottom: ss(24),
        borderRadius: radii.lg,
        overflow: "hidden",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {backdrop ? (
        <Image
          source={backdrop}
          style={FILL}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={backdrop}
          transition={200}
        />
      ) : (
        <View style={[FILL, { backgroundColor: colors.surface }]} />
      )}

      {/* Left→right wash keeps the title legible over busy art. */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(10,14,26,0.9)", "rgba(10,14,26,0.25)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={FILL}
      />
      {/* Bottom fade blends the billboard into the midnight rails below it. */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(10,14,26,0)", "rgba(10,14,26,0.35)", "#0A0E1A"]}
        locations={[0.4, 0.7, 1]}
        style={FILL}
      />

      <YStack
        position="absolute"
        left={ss(16)}
        right={ss(16)}
        bottom={ss(20)}
        zIndex={2}
      >
        {continuityLabel ? (
          <XStack alignItems="center" gap={ss(6)} marginBottom={ss(10)}>
            <Icon name="signal" size={ss(13)} color={colors.muted} />
            <Text
              color={colors.muted}
              fontFamily={fonts.display}
              fontWeight={fontWeights.medium}
              fontSize={ss(12)}
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
          fontSize={ss(28)}
          lineHeight={ss(32)}
          letterSpacing={-0.5}
          numberOfLines={2}
        >
          {title}
        </Text>

        {meta ? (
          <Text
            color={colors.text}
            fontFamily={fonts.body}
            fontSize={ss(13)}
            marginTop={ss(8)}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}

        <XStack gap={ss(10)} marginTop={ss(16)} alignItems="center">
          <Button variant="primary" size="md" icon="play" onPress={onPrimary}>
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button variant="secondary" size="md" onPress={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
        </XStack>
      </YStack>
    </View>
  );
}

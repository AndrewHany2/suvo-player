// @ts-check
/**
 * ResumePrompt — presentational cross-platform overlay offering "resume" vs
 * "start over" for VOD playback.
 *
 * Purely presentational: it owns no state and reads nothing from context. The
 * player decides visibility (via useResumePosition) and wires the callbacks.
 *
 * Built on the shared primitives (../../ui/primitives) so it renders on web,
 * TV and native with one code path. Aurora palette per the design tokens.
 */
import { YStack, XStack, Text } from "../../ui/primitives";
import { colors, radii, space, fonts, fontSizes, fontWeights, zIndex, overlay } from "../../ui/tokens";
import Button from "../../ui/Button";

import { formatDuration as formatTime } from "../../utils/formatDuration";

/**
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {number} props.resumeTime - Saved position, seconds.
 * @param {number} [props.percent]  - Fraction watched [0,1], for the progress bar.
 * @param {() => void} props.onResume
 * @param {() => void} props.onStartOver
 */
export default function ResumePrompt({ visible, resumeTime, percent = 0, onResume, onStartOver }) {
  if (!visible) return null;

  const pct = Math.max(0, Math.min(1, Number(percent) || 0));

  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      alignItems="center"
      justifyContent="center"
      backgroundColor={overlay}
      zIndex={zIndex.modal}
    >
      <YStack
        backgroundColor={colors.surface2}
        borderColor={colors.border}
        borderWidth={1}
        borderRadius={radii.lg}
        padding={space.xl}
        minWidth={300}
        maxWidth={420}
        gap={space.lg}
      >
        <Text
          fontFamily={fonts.display}
          color={colors.text}
          fontSize={fontSizes.lg}
          fontWeight={fontWeights.bold}
        >
          Resume playback?
        </Text>

        <Text fontFamily={fonts.body} color={colors.muted} fontSize={fontSizes.sm}>
          {`You stopped at ${formatTime(resumeTime)}.`}
        </Text>

        {/* Progress track */}
        <YStack
          height={4}
          borderRadius={radii.pill}
          backgroundColor={colors.surface2}
          overflow="hidden"
        >
          <YStack
            height={4}
            width={`${Math.round(pct * 100)}%`}
            borderRadius={radii.pill}
            backgroundColor={colors.accent2}
          />
        </YStack>

        <XStack gap={space.md} marginTop={space.xs}>
          <Button
            variant="primary"
            icon="play"
            onPress={onResume}
            style={{ flex: 1 }}
          >
            {`Resume from ${formatTime(resumeTime)}`}
          </Button>

          <Button variant="secondary" icon="back" onPress={onStartOver}>
            Start over
          </Button>
        </XStack>
      </YStack>
    </YStack>
  );
}

export { formatTime };

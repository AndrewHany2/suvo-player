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
import { colors, radii, space } from "../../ui/tokens";

/** Format seconds as M:SS or H:MM:SS. */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

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
      backgroundColor="rgba(10,14,26,0.82)"
      zIndex={1100}
    >
      <YStack
        backgroundColor={colors.surface}
        borderColor={colors.border}
        borderWidth={1}
        borderRadius={radii.lg}
        padding={space.xl}
        minWidth={300}
        maxWidth={420}
        gap={space.lg}
      >
        <Text color={colors.text} fontSize={20} fontWeight="700">
          Resume playback?
        </Text>

        <Text color={colors.muted} fontSize={14}>
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
          <YStack
            flex={1}
            onPress={onResume}
            backgroundColor={colors.accent}
            borderRadius={radii.md}
            paddingVertical={space.md}
            paddingHorizontal={space.lg}
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.85 }}
            hoverStyle={{ opacity: 0.9 }}
            cursor="pointer"
          >
            <Text color="#FFFFFF" fontSize={15} fontWeight="600">
              {`Resume from ${formatTime(resumeTime)}`}
            </Text>
          </YStack>

          <YStack
            onPress={onStartOver}
            backgroundColor={colors.surface2}
            borderColor={colors.border}
            borderWidth={1}
            borderRadius={radii.md}
            paddingVertical={space.md}
            paddingHorizontal={space.lg}
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.85 }}
            hoverStyle={{ opacity: 0.9 }}
            cursor="pointer"
          >
            <Text color={colors.text} fontSize={15} fontWeight="600">
              Start over
            </Text>
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  );
}

export { formatTime };

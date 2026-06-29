// @ts-check
/**
 * StatsOverlay — "stats for nerds" panel.
 *
 * PRESENTATIONAL only: renders whatever `stats` it is handed. The parent owns
 * gathering the numbers (from the driver / video element) and toggling
 * visibility — this component is mounted only when it should be visible.
 *
 * Renders a compact monospace panel pinned top-left. Cross-platform via the
 * shared src/ui/primitives surface. Every field tolerates undefined/null and
 * shows an em-dash placeholder.
 */
import { YStack, XStack, Text } from "../../ui/primitives";
import { colors, radii, space, zIndex } from "../../ui/tokens";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';
const DASH = "—";

/** Format a value with an optional unit, or the placeholder when absent. */
function fmt(value, unit = "") {
  if (value === null || value === undefined || value === "") return DASH;
  if (typeof value === "number" && Number.isNaN(value)) return DASH;
  return unit ? `${value}${unit}` : String(value);
}

/**
 * @param {object} props
 * @param {object} [props.stats]
 * @param {string} [props.stats.resolution]      - e.g. '1920x1080'.
 * @param {number} [props.stats.bitrateKbps]     - Current bitrate in kbps.
 * @param {number} [props.stats.bufferSec]       - Buffered ahead, seconds.
 * @param {number} [props.stats.droppedFrames]   - Dropped frame count.
 * @param {string} [props.stats.levelLabel]      - Active quality level label, e.g. '720p'.
 * @param {string} [props.stats.connectionType]  - e.g. 'wifi', '4g'.
 * @param {number} [props.stats.fps]             - Frames per second.
 */
export default function StatsOverlay({ stats = {} }) {
  const buffer =
    typeof stats.bufferSec === "number" ? `${stats.bufferSec.toFixed(1)}s` : DASH;

  const rows = [
    ["resolution", fmt(stats.resolution)],
    ["level", fmt(stats.levelLabel)],
    ["bitrate", fmt(stats.bitrateKbps, " kbps")],
    ["fps", fmt(stats.fps)],
    ["buffer", buffer],
    ["dropped", fmt(stats.droppedFrames)],
    ["network", fmt(stats.connectionType)],
  ];

  return (
    <YStack
      position="absolute"
      top={space.md}
      left={space.md}
      zIndex={zIndex.overlay}
      gap={2}
      paddingVertical={space.sm}
      paddingHorizontal={space.md}
      borderRadius={radii.sm}
      borderWidth={1}
      borderColor={colors.border}
      backgroundColor="rgba(10,14,26,0.82)"
      minWidth={210}
    >
      <Text
        fontFamily={MONO}
        fontSize={11}
        fontWeight="700"
        color={colors.accent2}
        marginBottom={2}
      >
        STATS
      </Text>
      {rows.map(([label, value]) => (
        <StatRow key={label} label={label} value={value} />
      ))}
    </YStack>
  );
}

function StatRow({ label, value }) {
  return (
    <XStack gap={space.md} justifyContent="space-between">
      <Text fontFamily={MONO} fontSize={11} color={colors.muted}>
        {label}
      </Text>
      <Text fontFamily={MONO} fontSize={11} color={colors.text} textAlign="right">
        {value}
      </Text>
    </XStack>
  );
}

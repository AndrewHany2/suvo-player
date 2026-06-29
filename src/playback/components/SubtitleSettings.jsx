// @ts-check
/**
 * SubtitleSettings — cross-platform subtitle/audio tuning panel.
 *
 * PRESENTATIONAL only: holds no state and persists nothing. The integrator
 * supplies the current values and an `onChange(partial)` callback; persistence
 * is owned by S1's usePlayerPreferences. Renders against the shared
 * src/ui/primitives surface, so it works on web/TV and native unchanged.
 *
 * Controls:
 *   - subtitle font size (-/+ stepping)
 *   - text colour (swatch picker)
 *   - background on/off (toggle)
 *   - position (bottom / middle)
 *   - subtitle delay offset (+/- 250ms)
 *   - audio delay offset (+/- 250ms)
 */
import { YStack, XStack, Text } from "../../ui/primitives";
import { colors, radii, space, fonts, fontSizes, accentAlpha } from "../../ui/tokens";
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_POSITIONS,
  clampOffset,
  formatOffset,
} from "../subtitleStyle.js";

const OFFSET_STEP_MS = 250;
const FONT_MIN = 12;
const FONT_MAX = 48;
const FONT_STEP = 2;

// A small, legible palette for subtitle text. Aurora ice + a few high-contrast
// alternatives users reach for (white, yellow, black).
const COLOR_SWATCHES = [
  colors.text, // ice
  "#FFFFFF",
  "#FFD700", // gold
  "#000000",
];

/**
 * @param {object} props
 * @param {import("../subtitleStyle.js").SubtitleStyle} [props.style] - Current subtitle style.
 * @param {number} [props.subtitleOffsetMs] - Current subtitle delay offset (ms).
 * @param {number} [props.audioOffsetMs] - Current audio delay offset (ms).
 * @param {(partial: object) => void} props.onChange - Emits a partial update. Subtitle-style
 *   fields are emitted under `style` (a partial SubtitleStyle); offsets as
 *   `subtitleOffsetMs` / `audioOffsetMs`.
 */
export default function SubtitleSettings({
  style = DEFAULT_SUBTITLE_STYLE,
  subtitleOffsetMs = 0,
  audioOffsetMs = 0,
  onChange,
}) {
  const s = { ...DEFAULT_SUBTITLE_STYLE, ...style };
  const emit = typeof onChange === "function" ? onChange : () => {};
  const patchStyle = (partial) => emit({ style: partial });

  const setFontSize = (delta) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + delta));
    if (next !== s.fontSize) patchStyle({ fontSize: next });
  };

  return (
    <YStack
      gap={space.lg}
      padding={space.lg}
      backgroundColor={colors.surface}
      borderRadius={radii.md}
      borderWidth={1}
      borderColor={colors.border}
      minWidth={300}
    >
      <Text
        fontFamily={fonts.display}
        fontSize={fontSizes.md}
        fontWeight="700"
        color={colors.text}
      >
        Subtitles & Audio
      </Text>

      {/* Font size */}
      <Row label="Text size">
        <Stepper
          onDec={() => setFontSize(-FONT_STEP)}
          onInc={() => setFontSize(FONT_STEP)}
          value={`${s.fontSize}px`}
          decDisabled={s.fontSize <= FONT_MIN}
          incDisabled={s.fontSize >= FONT_MAX}
        />
      </Row>

      {/* Text colour */}
      <Row label="Text colour">
        <XStack gap={space.sm} alignItems="center">
          {COLOR_SWATCHES.map((c) => (
            <Swatch
              key={c}
              color={c}
              selected={String(c).toLowerCase() === String(s.color).toLowerCase()}
              onPress={() => patchStyle({ color: c })}
            />
          ))}
        </XStack>
      </Row>

      {/* Background on/off */}
      <Row label="Background">
        <Toggle
          on={s.opacity > 0}
          onToggle={() =>
            patchStyle({ opacity: s.opacity > 0 ? 0 : DEFAULT_SUBTITLE_STYLE.opacity })
          }
        />
      </Row>

      {/* Position */}
      <Row label="Position">
        <XStack gap={space.sm}>
          {SUBTITLE_POSITIONS.map((pos) => (
            <Chip
              key={pos}
              label={pos === "middle" ? "Middle" : "Bottom"}
              selected={s.position === pos}
              onPress={() => patchStyle({ position: pos })}
            />
          ))}
        </XStack>
      </Row>

      {/* Subtitle delay */}
      <Row label="Subtitle delay">
        <Stepper
          onDec={() => emit({ subtitleOffsetMs: clampOffset(subtitleOffsetMs - OFFSET_STEP_MS) })}
          onInc={() => emit({ subtitleOffsetMs: clampOffset(subtitleOffsetMs + OFFSET_STEP_MS) })}
          value={formatOffset(subtitleOffsetMs)}
        />
      </Row>

      {/* Audio delay */}
      <Row label="Audio delay">
        <Stepper
          onDec={() => emit({ audioOffsetMs: clampOffset(audioOffsetMs - OFFSET_STEP_MS) })}
          onInc={() => emit({ audioOffsetMs: clampOffset(audioOffsetMs + OFFSET_STEP_MS) })}
          value={formatOffset(audioOffsetMs)}
        />
      </Row>
    </YStack>
  );
}

/** A labelled settings row: caption on the left, control on the right. */
function Row({ label, children }) {
  return (
    <XStack alignItems="center" justifyContent="space-between" gap={space.md}>
      <Text fontFamily={fonts.body} fontSize={fontSizes.sm} color={colors.muted}>
        {label}
      </Text>
      {children}
    </XStack>
  );
}

/** -/+ stepper with a centred read-out. */
function Stepper({ onDec, onInc, value, decDisabled = false, incDisabled = false }) {
  return (
    <XStack alignItems="center" gap={space.sm}>
      <StepButton label="−" onPress={onDec} disabled={decDisabled} />
      <Text
        fontFamily={fonts.body}
        fontSize={fontSizes.sm}
        color={colors.text}
        minWidth={56}
        textAlign="center"
      >
        {value}
      </Text>
      <StepButton label="+" onPress={onInc} disabled={incDisabled} />
    </XStack>
  );
}

function StepButton({ label, onPress, disabled }) {
  return (
    <Text
      onPress={disabled ? undefined : onPress}
      fontFamily={fonts.display}
      fontSize={fontSizes.md}
      fontWeight="700"
      color={disabled ? colors.faint : colors.text}
      backgroundColor={colors.surface2}
      borderRadius={radii.sm}
      borderWidth={1}
      borderColor={colors.border}
      width={34}
      height={34}
      textAlign="center"
      lineHeight={32}
      opacity={disabled ? 0.5 : 1}
    >
      {label}
    </Text>
  );
}

function Swatch({ color, selected, onPress }) {
  return (
    <YStack
      onPress={onPress}
      width={28}
      height={28}
      borderRadius={radii.pill}
      backgroundColor={color}
      borderWidth={selected ? 2 : 1}
      borderColor={selected ? colors.accent2 : colors.border}
    />
  );
}

function Chip({ label, selected, onPress }) {
  return (
    <Text
      onPress={onPress}
      fontFamily={fonts.body}
      fontSize={fontSizes.sm}
      fontWeight={selected ? "600" : "400"}
      color={selected ? colors.text : colors.muted}
      backgroundColor={selected ? accentAlpha(0.25) : colors.surface2}
      borderWidth={1}
      borderColor={selected ? colors.accent : colors.border}
      borderRadius={radii.pill}
      paddingHorizontal={space.md}
      paddingVertical={space.xs}
    >
      {label}
    </Text>
  );
}

function Toggle({ on, onToggle }) {
  return (
    <XStack
      onPress={onToggle}
      width={48}
      height={28}
      borderRadius={radii.pill}
      backgroundColor={on ? colors.accent : colors.surface2}
      borderWidth={1}
      borderColor={on ? colors.accent : colors.border}
      padding={2}
      justifyContent={on ? "flex-end" : "flex-start"}
      alignItems="center"
    >
      <YStack width={22} height={22} borderRadius={radii.pill} backgroundColor={colors.text} />
    </XStack>
  );
}

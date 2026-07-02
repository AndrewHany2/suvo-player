import { useState, useRef } from "react";
import { YStack, XStack, Text } from "../ui/primitives";
import { colors, fonts, fontWeights, radii, accentAlpha } from "../ui/tokens";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { useSettings } from "../hooks/useSettings";
import { useModalKeyTrap } from "../hooks/useModalKeyTrap";
import { ss } from "../utils/scaleSize";

import { isTV } from "../utils/isTV";

const ASPECT_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
];

function SectionTitle({ children }) {
  return (
    <Text
      color={colors.muted}
      fontFamily={fonts.display}
      fontSize={ss(11)}
      fontWeight={fontWeights.bold}
      letterSpacing={1}
      textTransform="uppercase"
      marginBottom={ss(12)}
    >
      {children}
    </Text>
  );
}

function ToggleRow({ label, value, onChange, focused = false }) {
  const tv = isTV();
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
      paddingVertical={ss(14)}
      borderBottomWidth={1}
      borderBottomColor={colors.border}
    >
      <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(14)}>
        {label}
      </Text>
      <div
        role="switch"
        tabIndex={0}
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!value);
          }
        }}
        style={{
          width: ss(44),
          height: ss(24),
          borderRadius: radii.pill,
          backgroundColor: value ? colors.accent : colors.border,
          position: "relative",
          cursor: "pointer",
          transition: tv ? undefined : "background 0.2s",
          flexShrink: 0,
          // Remote focus ring (TV) — matches the cyan accent2 ring used elsewhere.
          ...(focused
            ? { boxShadow: `0 0 0 ${ss(3)}px ${colors.accent2}` }
            : null),
        }}
      >
        <div
          style={{
            position: "absolute",
            top: ss(3),
            left: value ? ss(23) : ss(3),
            width: ss(18),
            height: ss(18),
            borderRadius: "50%",
            backgroundColor: colors.text,
            transition: tv ? undefined : "left 0.2s",
          }}
        />
      </div>
    </XStack>
  );
}

function ChipRow({ label, options, value, onChange, focusedValue = null }) {
  return (
    <YStack paddingVertical={ss(14)} borderBottomWidth={1} borderBottomColor={colors.border}>
      <Text color={colors.muted} fontFamily={fonts.body} fontSize={ss(13)} marginBottom={ss(10)}>
        {label}
      </Text>
      <XStack gap={ss(8)} flexWrap="wrap">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <Button
              key={opt.value}
              size="sm"
              variant={selected ? "secondary" : "ghost"}
              onPress={() => onChange(opt.value)}
              isFocused={focusedValue === opt.value}
              aria-pressed={selected}
              style={{
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? accentAlpha(0.12) : "transparent",
                color: selected ? colors.accent : colors.muted,
                fontWeight: selected ? fontWeights.bold : fontWeights.regular,
              }}
            >
              {opt.label}
            </Button>
          );
        })}
      </XStack>
    </YStack>
  );
}

export default function SettingsScreen({ onClose }) {
  const { settings, update } = useSettings();
  const tv = isTV();

  // TV remote focus ring. Index 0 = autoplay toggle; 1..N = aspect chips.
  // The whole app navigates with an index-based ring (no native DOM focus), so
  // the modal drives its own here and useModalKeyTrap shields the screen behind.
  const CHIP_COUNT = ASPECT_OPTIONS.length;
  const [focusIdx, setFocusIdx] = useState(0);
  const focusRef = useRef(0);
  const setF = (i) => { focusRef.current = i; setFocusIdx(i); };

  useModalKeyTrap(tv, {
    onBack: () => onClose?.(),
    onUp: () => { if (focusRef.current >= 1) setF(0); },
    onDown: () => { if (focusRef.current === 0) setF(1); },
    onLeft: () => { if (focusRef.current >= 2) setF(focusRef.current - 1); },
    onRight: () => {
      if (focusRef.current >= 1 && focusRef.current < CHIP_COUNT) setF(focusRef.current + 1);
    },
    onEnter: () => {
      const i = focusRef.current;
      if (i === 0) update({ autoplay: !settings.autoplay });
      else update({ defaultAspect: ASPECT_OPTIONS[i - 1].value });
    },
  });

  return (
    <YStack
      flex={1}
      backgroundColor={colors.bg}
      padding={ss(24)}
      maxWidth={ss(520)}
      alignSelf="center"
      width="100%"
    >
      <XStack alignItems="center" gap={ss(10)} marginBottom={ss(24)}>
        <Icon name="settings" size={ss(24)} color={colors.accent} />
        <Text
          color={colors.text}
          fontFamily={fonts.display}
          fontWeight={fontWeights.bold}
          fontSize={ss(24)}
        >
          Settings
        </Text>
      </XStack>

      <YStack marginBottom={ss(32)}>
        <SectionTitle>Playback</SectionTitle>
        <ToggleRow
          label="Autoplay next episode"
          value={settings.autoplay}
          onChange={(v) => update({ autoplay: v })}
          focused={tv && focusIdx === 0}
        />
        <ChipRow
          label="Default aspect ratio"
          options={ASPECT_OPTIONS}
          value={settings.defaultAspect}
          onChange={(v) => update({ defaultAspect: v })}
          focusedValue={tv && focusIdx >= 1 ? ASPECT_OPTIONS[focusIdx - 1].value : null}
        />
      </YStack>
    </YStack>
  );
}

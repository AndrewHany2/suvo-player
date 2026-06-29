import { YStack, XStack, Text } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useSettings } from "../hooks/useSettings";
import { ss } from "../utils/scaleSize";

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
      fontSize={ss(11)}
      fontWeight="700"
      letterSpacing={1}
      textTransform="uppercase"
      marginBottom={ss(12)}
    >
      {children}
    </Text>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
      paddingVertical={ss(14)}
      borderBottomWidth={1}
      borderBottomColor={colors.border}
    >
      <Text color={colors.text} fontSize={ss(14)}>
        {label}
      </Text>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: ss(44),
          height: ss(24),
          borderRadius: ss(12),
          backgroundColor: value ? colors.accent : colors.border,
          position: "relative",
          cursor: "pointer",
          transition: "background 0.2s",
          flexShrink: 0,
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
            backgroundColor: "#fff",
            transition: "left 0.2s",
          }}
        />
      </div>
    </XStack>
  );
}

function ChipRow({ label, options, value, onChange }) {
  return (
    <YStack paddingVertical={ss(14)} borderBottomWidth={1} borderBottomColor={colors.border}>
      <Text color={colors.muted} fontSize={ss(13)} marginBottom={ss(10)}>
        {label}
      </Text>
      <XStack gap={ss(8)} flexWrap="wrap">
        {options.map((opt) => (
          <div
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: `${ss(6)}px ${ss(14)}px`,
              borderRadius: ss(6),
              border: `1.5px solid ${value === opt.value ? colors.accent : colors.border}`,
              backgroundColor: value === opt.value ? "rgba(108, 92, 231,0.12)" : "transparent",
              color: value === opt.value ? colors.accent : colors.muted,
              fontSize: ss(13),
              cursor: "pointer",
              fontWeight: value === opt.value ? "700" : "400",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </div>
        ))}
      </XStack>
    </YStack>
  );
}

export default function SettingsScreen() {
  const { settings, update } = useSettings();

  return (
    <YStack
      flex={1}
      backgroundColor={colors.bg}
      padding={ss(24)}
      maxWidth={ss(520)}
      alignSelf="center"
      width="100%"
    >
      <YStack marginBottom={ss(32)}>
        <SectionTitle>Playback</SectionTitle>
        <ToggleRow
          label="Autoplay next episode"
          value={settings.autoplay}
          onChange={(v) => update({ autoplay: v })}
        />
        <ChipRow
          label="Default aspect ratio"
          options={ASPECT_OPTIONS}
          value={settings.defaultAspect}
          onChange={(v) => update({ defaultAspect: v })}
        />
      </YStack>
    </YStack>
  );
}

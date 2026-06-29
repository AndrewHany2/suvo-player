import { XStack, Text } from "../../ui/primitives";
import { ss } from "../../utils/scaleSize";

/**
 * Discover category pills — web/TV. Shared by Movies & Series so the two
 * Discover rows can't drift apart again.
 *
 * Outline style: dark pill, cyan border on the focused item, purple arrow.
 * Each item carries its own `icon` (🎬 / 📺 / ⭐) and `label`; `focusedCol`
 * is the index of the focused pill (or -1 when the focus is elsewhere).
 */
export default function DiscoverPills({ items, focusedCol = -1, onSelect }) {
  return (
    <XStack gap={ss(10)} flexWrap="wrap">
      {items.map((pill, idx) => (
        <XStack
          key={pill.id}
          alignItems="center" gap={ss(10)} paddingHorizontal={ss(18)} paddingVertical={ss(11)}
          backgroundColor="rgba(108, 92, 231,0.08)" borderWidth={1}
          borderColor={focusedCol === idx ? "#22D3EE" : "rgba(108, 92, 231,0.28)"}
          borderRadius={999} cursor="pointer"
          onPress={() => onSelect?.(pill)}
          pressStyle={{ opacity: 0.75 }}
          hoverStyle={{ borderColor: "#22D3EE" }}
          {...{ className: "lumen-load-cta" }}
        >
          <Text fontSize={ss(16)}>{pill.icon ?? (pill.id === "all" ? "🎬" : "⭐")}</Text>
          <Text color="#fff" fontSize={ss(13)} fontWeight="600" letterSpacing={0.1}>{pill.label}</Text>
          <Text color="#6C5CE7" fontSize={ss(16)} fontWeight="700">→</Text>
        </XStack>
      ))}
    </XStack>
  );
}

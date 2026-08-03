import { YStack } from "./primitives";
import Icon from "./Icon";
import { colors } from "./tokens";

/**
 * Floating "back to top" button for the long browse lists. Suffix-less so it
 * renders on both web (react-native-web) and native from the one file — it's
 * only mounted by the `.web`/`.native` screens (TV uses a remote-key jump, so it
 * never imports this). Pinned bottom-right, above the content, and shown only
 * once the list is scrolled far enough (the parent gates `visible`).
 *
 * @param {{ visible: boolean, onPress: () => void, bottom?: number, right?: number, label?: string }} props
 */
export default function BackToTopButton({ visible, onPress, bottom = 24, right = 20, label = "Back to top" }) {
  if (!visible) return null;
  return (
    <YStack
      position="absolute"
      bottom={bottom}
      right={right}
      width={48}
      height={48}
      borderRadius={24}
      backgroundColor={colors.surface2}
      borderWidth={1}
      borderColor={colors.border}
      justifyContent="center"
      alignItems="center"
      cursor="pointer"
      onPress={onPress}
      pressStyle={{ opacity: 0.85 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      zIndex={50}
    >
      <Icon name="chevron-up" size={22} color={colors.text} />
    </YStack>
  );
}

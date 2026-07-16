import { YStack, Text } from "../ui/primitives";
import { colors } from "../ui/tokens";

// Terminal gate screen with no user action — once shown, the app stays here.
// Copy is deliberately generic (no reason, no next step) so it reveals nothing
// about why access ended; matches the account-level tone of authError.js.
export default function DemoExpiredScreen() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      padding={24}
      backgroundColor={colors.bg}
    >
      <Text color={colors.text} fontSize={18} fontWeight="700" textAlign="center">
        Account unavailable
      </Text>
      <Text color={colors.muted} fontSize={14} textAlign="center" marginTop={8}>
        This account is currently unavailable.
      </Text>
    </YStack>
  );
}

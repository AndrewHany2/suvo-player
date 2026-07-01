import { YStack, Text } from "../ui/primitives";
import { colors } from "../ui/tokens";

// Shown when Supabase is not configured. Config is mandatory in production —
// there is no local-only fallback — so this indicates a broken build.
export default function ConfigErrorScreen() {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      padding={24}
      backgroundColor={colors.bg}
    >
      <Text color={colors.danger} fontSize={18} fontWeight="700" textAlign="center">
        Configuration error
      </Text>
      <Text color={colors.muted} fontSize={14} textAlign="center" marginTop={8}>
        This build is missing its backend configuration. Please reinstall from
        the official store.
      </Text>
    </YStack>
  );
}

import { YStack, Text } from "../ui/primitives";
import Button from "../ui/Button";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { interpretEntitlement } from "../navigation/entitlementCopy";

// Shown when the server's entitlement verdict is not-entitled (expired /
// revoked / suspended / no-entitlement — see appGate.js). Content is already
// hard-blocked server-side; this screen exists so the user learns WHY instead
// of landing on an empty profile picker. Mirrors DeviceLockedScreen: the only
// in-app action is to sign out (renewal is handled by the provider).
export default function EntitlementLockedScreen() {
  const { signOut, entitlement } = useApp();
  const { title, message } = interpretEntitlement(entitlement?.reason);
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      padding={24}
      gap={16}
      backgroundColor={colors.bg}
    >
      <Text color={colors.text} fontSize={20} fontWeight="700" textAlign="center">
        {title}
      </Text>
      <Text color={colors.muted} fontSize={14} textAlign="center">
        {message}
      </Text>
      <Button variant="primary" size="lg" onPress={signOut}>
        Sign out
      </Button>
    </YStack>
  );
}

import { YStack, Text } from "../ui/primitives";
import Button from "../ui/Button";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";

// Shown when claim-device returns 'denied' — this account is already bound to a
// different device. Unbinding is admin-only, so the only user action is to sign
// out (and contact support to move devices).
export default function DeviceLockedScreen() {
  const { signOut } = useApp();
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
        Device locked
      </Text>
      <Text color={colors.muted} fontSize={14} textAlign="center">
        This account is already active on another device. Contact support to
        switch devices.
      </Text>
      <Button variant="primary" size="lg" onPress={signOut}>
        Sign out
      </Button>
    </YStack>
  );
}

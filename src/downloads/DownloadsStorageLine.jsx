import { XStack, YStack, Text } from "../ui/primitives";
import { colors, fonts, fontWeights, radii } from "../ui/tokens";
import { formatBytes } from "../utils/formatBytes.js";
import { useDownloads } from "./useDownloads.jsx";

// Downloads summary for the Account screen: how many titles are stored on this
// device and how much space they use. Native-only — mount it inside the
// DownloadsProvider tree (it calls useDownloads()).
export default function DownloadsStorageLine() {
  const { items } = useDownloads();
  const done = items.filter((r) => r.status === "done");
  const total = done.reduce((sum, r) => sum + (r.bytesDone || 0), 0);

  if (done.length === 0) return null;

  return (
    <XStack
      alignItems="center" backgroundColor={colors.surface2}
      marginHorizontal={16} marginBottom={12} borderRadius={radii.md}
      padding={14} borderWidth={1} borderColor={colors.border}
    >
      <YStack flex={1}>
        <Text color={colors.text} fontFamily={fonts.body} fontSize={14} fontWeight={fontWeights.medium}>
          Downloads
        </Text>
        <Text color={colors.muted} fontFamily={fonts.body} fontSize={12} marginTop={1}>
          {done.length} {done.length === 1 ? "title" : "titles"} on this device
        </Text>
      </YStack>
      <Text color={colors.accent2} fontFamily={fonts.body} fontSize={13} fontWeight={fontWeights.bold}>
        {formatBytes(total)}
      </Text>
    </XStack>
  );
}

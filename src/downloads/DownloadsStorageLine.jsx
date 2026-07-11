import { useEffect, useState } from "react";
import { XStack, YStack, Text } from "../ui/primitives";
import { colors, fonts, fontWeights, radii } from "../ui/tokens";
import { formatBytes } from "../utils/formatBytes.js";
import { useDownloads } from "./useDownloads.jsx";

// Downloads summary for the Account screen: how many titles are stored on this
// device and how much space they use. Native-only — mount it inside the
// DownloadsProvider tree (it calls useDownloads()).
export default function DownloadsStorageLine() {
  const { items, freeBytes } = useDownloads();
  const done = items.filter((r) => r.status === "done");
  const total = done.reduce((sum, r) => sum + (r.bytesDone || 0), 0);

  // Free device space, if the platform can report it (null on web/Electron).
  const [free, setFree] = useState(null);
  useEffect(() => {
    let alive = true;
    freeBytes?.().then((b) => { if (alive) setFree(b); }).catch(() => {});
    return () => { alive = false; };
  }, [freeBytes, done.length]);

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
          {typeof free === "number" ? ` · ${formatBytes(free)} free` : ""}
        </Text>
      </YStack>
      <Text color={colors.accent2} fontFamily={fonts.body} fontSize={13} fontWeight={fontWeights.bold}>
        {formatBytes(total)}
      </Text>
    </XStack>
  );
}

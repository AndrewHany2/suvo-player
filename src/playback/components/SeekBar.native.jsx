import { memo, useRef, useState } from "react";
import { View } from "react-native";
import { YStack, XStack, Text } from "../../ui/primitives";
import { colors, seekTrack } from "../../ui/tokens";
import { formatDuration as fmt } from "../../utils/formatDuration";

const SEEK_STEP = 10; // ±seconds for the screen-reader increment/decrement

/**
 * Native VOD seek bar — a memoized leaf that owns its in-drag scrub state
 * LOCALLY. Dragging updates only this component, not the ~900-line player, so a
 * ~60 Hz scrub no longer re-renders the whole screen. That whole-screen churn
 * was the cause of two reported bugs: the bar stuttering while dragging, and —
 * on the VLC engine — the stream reloading (each parent re-render re-fed
 * <VLCPlayer> a fresh source, rebuilding the native player and restarting from
 * the start). Mirrors the imperative volume gesture's fix.
 *
 * Works in SECONDS. `bufferedSec` is optional (VLC has no buffered value → 0,
 * so the buffered segment simply has zero width). The parent commits the seek
 * only on release via `onSeek`, and is told when a drag starts/ends via
 * `onScrubbingChange` so it can pause its position poll (another re-render
 * source) and keep the controls visible.
 *
 * @param {{ positionSec: number, durationSec: number, bufferedSec?: number,
 *   onSeek: (sec: number) => void, onScrubbingChange?: (active: boolean) => void }} props
 */
export default memo(function SeekBar({ positionSec, durationSec, bufferedSec = 0, onSeek, onScrubbingChange }) {
  const [scrubSec, setScrubSec] = useState(null);
  const widthRef = useRef(0);

  if (!(durationSec > 0)) return null;

  const shown = scrubSec != null ? scrubSec : positionSec;
  const playedPct = Math.max(0, Math.min(100, (shown / durationSec) * 100));
  const bufferedPct = Math.max(0, Math.min(100, (bufferedSec / durationSec) * 100));

  const scrubToX = (x) => {
    const w = widthRef.current;
    if (!w) return;
    const frac = Math.max(0, Math.min(1, x / w));
    setScrubSec(frac * durationSec);
  };
  const begin = (e) => {
    onScrubbingChange?.(true);
    scrubToX(e.nativeEvent.locationX);
  };
  const commit = () => {
    setScrubSec((sec) => {
      if (sec != null) onSeek(sec);
      return null;
    });
    onScrubbingChange?.(false);
  };

  return (
    <YStack paddingHorizontal={16} paddingTop={4}>
      <View
        style={{ height: 44, justifyContent: "center" }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Seek bar"
        accessibilityValue={{
          min: 0,
          max: Math.round(durationSec),
          now: Math.round(shown),
          text: `${fmt(shown)} of ${fmt(durationSec)}`,
        }}
        accessibilityActions={[
          { name: "increment", label: "Forward 10 seconds" },
          { name: "decrement", label: "Back 10 seconds" },
        ]}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          const base = positionSec || 0;
          onSeek(Math.max(0, Math.min(durationSec, base + (name === "increment" ? SEEK_STEP : -SEEK_STEP))));
        }}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={begin}
        onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
        onResponderRelease={commit}
        onResponderTerminate={commit}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: seekTrack.track }} />
        <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${bufferedPct}%`, backgroundColor: seekTrack.buffered }} />
        <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
        <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
      </View>
      <XStack justifyContent="space-between" marginTop={4}>
        <Text color={colors.text} fontSize={12} fontWeight="600">{fmt(shown)}</Text>
        <Text color={colors.textDim} fontSize={12}>{fmt(durationSec)}</Text>
      </XStack>
    </YStack>
  );
});

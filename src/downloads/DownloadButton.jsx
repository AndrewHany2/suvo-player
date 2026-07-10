// Reusable inline download control for native screens. Renders
// idle/queued/downloading(progress)/paused/done/error states and wires tap
// actions to the DownloadsProvider (see ./useDownloads.jsx). Native-only —
// nothing here should be imported by web/TV code.
import React, { useCallback } from 'react';
import { Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import Icon from '../ui/Icon';
import { colors } from '../ui/tokens';
import { useDownloads } from './useDownloads.jsx';
import { makeId } from './downloadStore.js';
import ProgressRing from './ProgressRing.jsx';

export default function DownloadButton({ item }) {
  const { byId, start, pause, resume, remove } = useDownloads();
  const id = makeId(item);
  const rec = byId[id];
  const status = rec?.status;

  const pct = rec?.bytesTotal ? Math.round((rec.bytesDone / rec.bytesTotal) * 100) : null;

  const onPress = useCallback(() => {
    if (!status || status === 'error') return start(item);
    if (status === 'downloading' || status === 'queued') return pause(id);
    if (status === 'paused') return resume(id);
    if (status === 'done') {
      return Alert.alert('Remove download', `Delete "${item.title}" from this device?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
      ]);
    }
    return undefined;
  }, [status, id, item, start, pause, resume, remove]);

  // Icon + a11y label per state. queued has no distinct icon → spinner below.
  let icon = 'download';
  let color = colors.text;
  let label = 'Download';
  if (status === 'queued') { label = 'Queued, tap to pause'; }
  else if (status === 'downloading') { icon = 'pause'; color = colors.accent; label = pct != null ? `Downloading ${pct}%, tap to pause` : 'Downloading, tap to pause'; }
  else if (status === 'paused') { icon = 'play'; color = colors.accent; label = pct != null ? `Paused ${pct}%, tap to resume` : 'Paused, tap to resume'; }
  else if (status === 'done') { icon = 'check'; color = colors.success; label = 'Downloaded, tap to remove'; }
  else if (status === 'error') { color = colors.danger; label = 'Download failed, tap to retry'; }

  let control;
  if ((status === 'downloading' || status === 'paused') && pct != null) {
    // Downloading shows a pause affordance; paused freezes the ring with a resume
    // (play) affordance inside.
    control = (
      <ProgressRing radius={15} borderWidth={3} percent={pct} color={colors.accent} trackColor={colors.border} maskColor={colors.bg}>
        <Icon name={status === 'paused' ? 'play' : 'pause'} size={14} color={colors.accent} />
      </ProgressRing>
    );
  } else if (status === 'queued' || status === 'downloading') {
    control = <ActivityIndicator size="small" color={colors.accent} />;
  } else {
    control = <Icon name={icon} size={22} color={color} />;
  }

  return (
    <Pressable onPress={onPress} style={styles.btn} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      {control}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 6, alignItems: 'center', justifyContent: 'center' },
});

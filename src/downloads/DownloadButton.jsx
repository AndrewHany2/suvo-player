// Reusable inline download control for native screens. Renders
// idle/queued/downloading(progress)/paused/done/error states and wires tap
// actions to the DownloadsProvider (see ./useDownloads.jsx). Native-only —
// nothing here should be imported by web/TV code.
import React, { useCallback } from 'react';
import { Pressable, Text, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useDownloads } from './useDownloads.jsx';
import { makeId } from './downloadStore.js';

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

  let label = 'Download';
  if (status === 'queued') label = 'Queued…';
  else if (status === 'downloading') label = pct != null ? `${pct}%` : 'Downloading…';
  else if (status === 'paused') label = 'Resume';
  else if (status === 'done') label = 'Downloaded ✓';
  else if (status === 'error') label = 'Retry';

  return (
    <Pressable onPress={onPress} style={styles.btn} accessibilityRole="button" accessibilityLabel={label}>
      {status === 'downloading' && pct == null ? <ActivityIndicator /> : <Text style={styles.txt}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  txt: { color: '#fff', fontWeight: '600' },
});

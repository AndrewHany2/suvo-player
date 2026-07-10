/**
 * Pure reducer over the id→record map. No React, no I/O — exported for tests
 * and consumed by the provider in useDownloads.jsx.
 * @param {Record<string, any>} records
 * @param {import('./DownloadManager.js').DownloadEvent} event
 */
export function applyEvent(records, event) {
  const cur = records[event.id];
  if (!cur) return records;
  let updated;
  if (event.type === 'progress') {
    updated = {
      // A trailing progress event after a pause must not flip the record back
      // to downloading — keep the paused status, just record the latest bytes.
      ...cur,
      status: cur.status === 'paused' ? 'paused' : 'downloading',
      bytesDone: event.bytesDone ?? cur.bytesDone,
      bytesTotal: event.bytesTotal ?? cur.bytesTotal,
    };
  } else if (event.type === 'paused') {
    if (cur.status !== 'downloading' && cur.status !== 'queued') return records;
    updated = { ...cur, status: 'paused' };
  } else if (event.type === 'resumed') {
    if (cur.status !== 'paused') return records;
    updated = { ...cur, status: 'downloading' };
  } else if (event.type === 'done') {
    updated = { ...cur, status: 'done', bytesDone: cur.bytesTotal || cur.bytesDone };
  } else if (event.type === 'error') {
    updated = { ...cur, status: 'error', error: event.error || 'download failed' };
  } else {
    return records;
  }
  return { ...records, [event.id]: updated };
}

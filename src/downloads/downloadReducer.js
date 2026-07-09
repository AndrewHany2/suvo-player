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
      ...cur,
      status: 'downloading',
      bytesDone: event.bytesDone ?? cur.bytesDone,
      bytesTotal: event.bytesTotal ?? cur.bytesTotal,
    };
  } else if (event.type === 'done') {
    updated = { ...cur, status: 'done', bytesDone: cur.bytesTotal || cur.bytesDone };
  } else if (event.type === 'error') {
    updated = { ...cur, status: 'error', error: event.error || 'download failed' };
  } else {
    return records;
  }
  return { ...records, [event.id]: updated };
}

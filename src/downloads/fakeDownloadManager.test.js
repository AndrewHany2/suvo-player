import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDownloadManager } from './fakeDownloadManager.js';

test('fake records starts and forwards emitted events to subscribers', () => {
  const mgr = createFakeDownloadManager();
  const events = [];
  const unsub = mgr.subscribe((e) => events.push(e));
  mgr.start({ id: 'movie:1', url: 'http://x/1.mp4', localPath: '/d/1.mp4' });
  assert.deepEqual(mgr.started, ['movie:1']);
  mgr.emit({ id: 'movie:1', type: 'progress', bytesDone: 5, bytesTotal: 10 });
  mgr.emit({ id: 'movie:1', type: 'done' });
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'done');
  unsub();
  mgr.emit({ id: 'movie:1', type: 'progress' });
  assert.equal(events.length, 2); // no delivery after unsubscribe
});

test('fake freeBytes resolves a large number', async () => {
  const mgr = createFakeDownloadManager();
  assert.ok((await mgr.freeBytes()) > 1e9);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeId, createDownloadStore } from './downloadStore.js';

// In-memory AsyncStorage fake (same 3-method surface downloadStore uses).
function memStorage() {
  const mem = new Map();
  return {
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => { mem.set(k, v); },
    removeItem: async (k) => { mem.delete(k); },
  };
}

test('makeId builds stable movie and episode ids', () => {
  assert.equal(makeId({ kind: 'movie', streamId: 42 }), 'movie:42');
  assert.equal(makeId({ kind: 'episode', seriesId: 7, season: 2, episode: 5 }), 'ep:7:2:5');
});

test('put then get round-trips and stamps updatedAt', async () => {
  const store = createDownloadStore(memStorage());
  const rec = await store.put({ id: 'movie:1', kind: 'movie', title: 'A', status: 'queued', createdAt: 1 });
  assert.equal(rec.id, 'movie:1');
  assert.equal(typeof rec.updatedAt, 'number');
  const got = await store.get('movie:1');
  assert.equal(got.title, 'A');
});

test('patch shallow-merges existing record', async () => {
  const store = createDownloadStore(memStorage());
  await store.put({ id: 'movie:1', kind: 'movie', title: 'A', status: 'queued', createdAt: 1 });
  const patched = await store.patch('movie:1', { status: 'downloading', bytesDone: 10 });
  assert.equal(patched.status, 'downloading');
  assert.equal(patched.bytesDone, 10);
  assert.equal(patched.title, 'A');
});

test('patch returns null for missing id', async () => {
  const store = createDownloadStore(memStorage());
  assert.equal(await store.patch('nope', { status: 'done' }), null);
});

test('getAll returns array ordered by createdAt; remove deletes', async () => {
  const store = createDownloadStore(memStorage());
  await store.put({ id: 'b', kind: 'movie', title: 'B', createdAt: 2 });
  await store.put({ id: 'a', kind: 'movie', title: 'A', createdAt: 1 });
  const all = await store.getAll();
  assert.deepEqual(all.map((r) => r.id), ['a', 'b']);
  await store.remove('a');
  assert.equal((await store.getAll()).length, 1);
});

# Offline Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mobile users (iOS + Android) download movies and series episodes and watch them with no internet connection.

**Architecture:** A `DownloadManager` abstraction mirrors the engine-agnostic `PlayerDriver` model in `src/playback/`. A pure `downloadStore` (AsyncStorage) is the source of truth for what's downloaded; a `nativeDownloadManager` wraps `react-native-background-downloader` + `expo-file-system` for true background transfers; a `useDownloads` hook/context exposes actions and progress; inline UI (a `DownloadButton`, a "Downloaded" filter, an offline banner) surfaces it. Downloaded files play through the existing `expoVideoDriver` by feeding it the local `file://` URI.

**Tech Stack:** Expo ~54 / React Native 0.81 / react-native-web / React 19, JavaScript (`.js`/`.jsx`). `react-native-background-downloader`, `expo-file-system`, `@react-native-community/netinfo`. Tests: `node:test` (no Jest), files beside source as `*.test.js`.

## Global Constraints

- JavaScript only — `.js` / `.jsx`, never TypeScript.
- Tests use `node:test`, run via `npm test`; test files sit beside source as `*.test.js`.
- Before committing: `npm test` and `npm run lint` must pass (eslint warnings OK, errors not).
- Mobile only (iOS + Android) for v1. Do **not** touch `.web`/`.tv` screen variants. New download code must never be imported by the web/TV bundle.
- The `DownloadManager` interface must not leak `react-native-background-downloader` types/objects to callers — same isolation rule the playback drivers follow.
- Store-compliance: no user-facing copy uses the word "IPTV".

---

### Task 1: Metadata store (`downloadStore`)

Pure CRUD + state transitions over AsyncStorage. The single source of truth for what's downloaded. No library, no React, no file I/O.

**Files:**
- Create: `src/downloads/downloadStore.js`
- Test: `src/downloads/downloadStore.test.js`

**Interfaces:**
- Consumes: `src/utils/storage.js` (default export = AsyncStorage).
- Produces:
  - `makeId(item)` → string. `item` = `{ kind:'movie'|'episode', streamId?, seriesId?, season?, episode? }`. Returns `movie:<streamId>` or `ep:<seriesId>:<season>:<episode>`.
  - `async loadAll()` → `Record<string, DownloadRecord>` (empty object if none).
  - `async getAll()` → `DownloadRecord[]` (array form, stable order by `createdAt`).
  - `async get(id)` → `DownloadRecord | null`.
  - `async put(record)` → `DownloadRecord` (writes/overwrites, stamps `updatedAt`).
  - `async patch(id, fields)` → `DownloadRecord | null` (shallow-merge, stamps `updatedAt`).
  - `async remove(id)` → `void`.
  - `DownloadRecord` shape: `{ id, kind, title, poster, seriesId, season, episode, remoteUrl, localPath, ext, bytesTotal, bytesDone, status, error, createdAt, updatedAt }`. `status` ∈ `'queued'|'downloading'|'paused'|'done'|'error'`.
- Storage key constant: `STORAGE_KEY = 'suvo.downloads.v1'` (whole collection stored as one JSON blob).

- [ ] **Step 1: Write the failing test**

```js
// src/downloads/downloadStore.test.js
const test = require('node:test');
const assert = require('node:assert');

// In-memory AsyncStorage mock installed before requiring the module under test.
const mem = new Map();
require.cache[require.resolve('../utils/storage.js')] = {
  id: require.resolve('../utils/storage.js'),
  loaded: true,
  exports: {
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => { mem.set(k, v); },
    removeItem: async (k) => { mem.delete(k); },
  },
};

const store = require('./downloadStore.js');

test.beforeEach(() => mem.clear());

test('makeId builds stable movie and episode ids', () => {
  assert.strictEqual(store.makeId({ kind: 'movie', streamId: 42 }), 'movie:42');
  assert.strictEqual(
    store.makeId({ kind: 'episode', seriesId: 7, season: 2, episode: 5 }),
    'ep:7:2:5',
  );
});

test('put then get round-trips and stamps updatedAt', async () => {
  const rec = await store.put({ id: 'movie:1', kind: 'movie', title: 'A', status: 'queued', createdAt: 1 });
  assert.strictEqual(rec.id, 'movie:1');
  assert.ok(typeof rec.updatedAt === 'number');
  const got = await store.get('movie:1');
  assert.strictEqual(got.title, 'A');
});

test('patch shallow-merges existing record', async () => {
  await store.put({ id: 'movie:1', kind: 'movie', title: 'A', status: 'queued', createdAt: 1 });
  const patched = await store.patch('movie:1', { status: 'downloading', bytesDone: 10 });
  assert.strictEqual(patched.status, 'downloading');
  assert.strictEqual(patched.bytesDone, 10);
  assert.strictEqual(patched.title, 'A');
});

test('patch returns null for missing id', async () => {
  assert.strictEqual(await store.patch('nope', { status: 'done' }), null);
});

test('getAll returns array ordered by createdAt; remove deletes', async () => {
  await store.put({ id: 'b', kind: 'movie', title: 'B', createdAt: 2 });
  await store.put({ id: 'a', kind: 'movie', title: 'A', createdAt: 1 });
  const all = await store.getAll();
  assert.deepStrictEqual(all.map((r) => r.id), ['a', 'b']);
  await store.remove('a');
  assert.strictEqual((await store.getAll()).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/downloads/downloadStore.test.js`
Expected: FAIL — `Cannot find module './downloadStore.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/downloads/downloadStore.js
import AsyncStorage from '../utils/storage.js';

export const STORAGE_KEY = 'suvo.downloads.v1';

export function makeId(item) {
  if (item.kind === 'movie') return `movie:${item.streamId}`;
  return `ep:${item.seriesId}:${item.season}:${item.episode}`;
}

export async function loadAll() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveAll(map) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export async function getAll() {
  const map = await loadAll();
  return Object.values(map).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function get(id) {
  const map = await loadAll();
  return map[id] || null;
}

export async function put(record) {
  const map = await loadAll();
  const now = Date.now();
  const next = { createdAt: now, ...map[record.id], ...record, updatedAt: now };
  map[record.id] = next;
  await saveAll(map);
  return next;
}

export async function patch(id, fields) {
  const map = await loadAll();
  if (!map[id]) return null;
  const next = { ...map[id], ...fields, updatedAt: Date.now() };
  map[id] = next;
  await saveAll(map);
  return next;
}

export async function remove(id) {
  const map = await loadAll();
  delete map[id];
  await saveAll(map);
}
```

Note: `put` uses `Date.now()`; the test passes explicit `createdAt` and only asserts `updatedAt` is a number, so this is deterministic enough. Keep `createdAt` spread-precedence so an existing record's `createdAt` is preserved on overwrite.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/downloads/downloadStore.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/downloads/downloadStore.js src/downloads/downloadStore.test.js
git commit -m "feat(downloads): pure metadata store over AsyncStorage"
```

---

### Task 2: URL & path builder (`downloadUri`)

Builds the Xtream remote file URL and the local target path for a content item. Pure, no I/O.

**Files:**
- Create: `src/downloads/downloadUri.js`
- Test: `src/downloads/downloadUri.test.js`

**Interfaces:**
- Consumes: an `api` object exposing `buildStreamUrl(type, streamId, ext)` (this is the `IptvApi` instance from `src/services/iptvApi.js`, method at `iptvApi.js:490`).
- Produces:
  - `remoteUrlFor(api, item)` → string. `item.kind==='movie'` → `api.buildStreamUrl('movie', item.streamId, item.ext)`; `item.kind==='episode'` → `api.buildStreamUrl('series', item.episodeStreamId, item.ext)`.
  - `localPathFor(id, ext, dir)` → string = `` `${dir}downloads/${safe(id)}.${ext}` `` where `safe` replaces `:` with `_`. `dir` is the caller-supplied documentDirectory (kept as a param so the module stays pure/testable).
  - `DEFAULT_EXT = 'mp4'`.

- [ ] **Step 1: Write the failing test**

```js
// src/downloads/downloadUri.test.js
const test = require('node:test');
const assert = require('node:assert');
const { remoteUrlFor, localPathFor, DEFAULT_EXT } = require('./downloadUri.js');

const api = {
  buildStreamUrl: (type, id, ext) => `http://host/${type}/u/p/${id}.${ext}`,
};

test('remoteUrlFor builds movie url', () => {
  assert.strictEqual(
    remoteUrlFor(api, { kind: 'movie', streamId: 42, ext: 'mkv' }),
    'http://host/movie/u/p/42.mkv',
  );
});

test('remoteUrlFor builds episode url from episodeStreamId', () => {
  assert.strictEqual(
    remoteUrlFor(api, { kind: 'episode', episodeStreamId: 99, ext: 'mp4' }),
    'http://host/series/u/p/99.mp4',
  );
});

test('localPathFor sanitizes id and joins under downloads dir', () => {
  assert.strictEqual(
    localPathFor('ep:7:2:5', 'mp4', 'file:///docs/'),
    'file:///docs/downloads/ep_7_2_5.mp4',
  );
});

test('DEFAULT_EXT is mp4', () => {
  assert.strictEqual(DEFAULT_EXT, 'mp4');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/downloads/downloadUri.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// src/downloads/downloadUri.js
export const DEFAULT_EXT = 'mp4';

export function remoteUrlFor(api, item) {
  const ext = item.ext || DEFAULT_EXT;
  if (item.kind === 'movie') return api.buildStreamUrl('movie', item.streamId, ext);
  return api.buildStreamUrl('series', item.episodeStreamId, ext);
}

export function localPathFor(id, ext, dir) {
  const safe = String(id).replace(/:/g, '_');
  return `${dir}downloads/${safe}.${ext || DEFAULT_EXT}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/downloads/downloadUri.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/downloads/downloadUri.js src/downloads/downloadUri.test.js
git commit -m "feat(downloads): remote-url and local-path builders"
```

---

### Task 3: `DownloadManager` contract + fake

Define the engine-agnostic contract (JSDoc typedefs) all callers use, plus a fake implementation used by later tests. No library import here.

**Files:**
- Create: `src/downloads/DownloadManager.js`
- Create: `src/downloads/fakeDownloadManager.js`
- Test: `src/downloads/fakeDownloadManager.test.js`

**Interfaces:**
- Produces — the `DownloadManager` contract (every implementation, native or fake, satisfies this):
  - `start({ id, url, localPath })` → `void` — begins/queues a transfer.
  - `pause(id)` / `resume(id)` / `cancel(id)` → `void`.
  - `subscribe(handler)` → `unsubscribe()` — `handler(event)` where `event` = `{ id, type:'progress'|'done'|'error', bytesDone?, bytesTotal?, error? }`.
  - `reattach()` → `Promise<void>` — re-attach to background tasks after relaunch (no-op in fake).
  - `freeBytes()` → `Promise<number>` — free disk space (fake returns a large constant).
- `fakeDownloadManager.js` exports `createFakeDownloadManager()` → an object satisfying the contract, plus test helpers `emit(event)` and `started` (array of started ids).

- [ ] **Step 1: Write the failing test**

```js
// src/downloads/fakeDownloadManager.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createFakeDownloadManager } = require('./fakeDownloadManager.js');

test('fake records starts and forwards emitted events to subscribers', () => {
  const mgr = createFakeDownloadManager();
  const events = [];
  const unsub = mgr.subscribe((e) => events.push(e));
  mgr.start({ id: 'movie:1', url: 'http://x/1.mp4', localPath: '/d/1.mp4' });
  assert.deepStrictEqual(mgr.started, ['movie:1']);
  mgr.emit({ id: 'movie:1', type: 'progress', bytesDone: 5, bytesTotal: 10 });
  mgr.emit({ id: 'movie:1', type: 'done' });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].type, 'done');
  unsub();
  mgr.emit({ id: 'movie:1', type: 'progress' });
  assert.strictEqual(events.length, 2); // no delivery after unsubscribe
});

test('fake freeBytes resolves a large number', async () => {
  const mgr = createFakeDownloadManager();
  assert.ok((await mgr.freeBytes()) > 1e9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/downloads/fakeDownloadManager.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// src/downloads/DownloadManager.js
/**
 * @typedef {Object} DownloadEvent
 * @property {string} id
 * @property {'progress'|'done'|'error'} type
 * @property {number} [bytesDone]
 * @property {number} [bytesTotal]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DownloadManager
 * @property {(task:{id:string,url:string,localPath:string})=>void} start
 * @property {(id:string)=>void} pause
 * @property {(id:string)=>void} resume
 * @property {(id:string)=>void} cancel
 * @property {(handler:(e:DownloadEvent)=>void)=>()=>void} subscribe
 * @property {()=>Promise<void>} reattach
 * @property {()=>Promise<number>} freeBytes
 */
export {};
```

```js
// src/downloads/fakeDownloadManager.js
export function createFakeDownloadManager() {
  const handlers = new Set();
  const started = [];
  return {
    started,
    start(task) { started.push(task.id); },
    pause() {},
    resume() {},
    cancel() {},
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async reattach() {},
    async freeBytes() { return 64 * 1e9; },
    // test helper
    emit(event) { handlers.forEach((h) => h(event)); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/downloads/fakeDownloadManager.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/downloads/DownloadManager.js src/downloads/fakeDownloadManager.js src/downloads/fakeDownloadManager.test.js
git commit -m "feat(downloads): DownloadManager contract + test fake"
```

---

### Task 4: `useDownloads` hook + context

React host that binds a `DownloadManager` to `downloadStore`: reduces manager events into persisted records and exposes actions. Its state logic is what the tests exercise (against the fake); the native manager is injected.

**Files:**
- Create: `src/downloads/useDownloads.js`
- Test: `src/downloads/useDownloads.test.js`

**Interfaces:**
- Consumes: `downloadStore` (Task 1: `makeId,get,getAll,put,patch,remove`), `downloadUri` (Task 2: `remoteUrlFor,localPathFor`), a `DownloadManager` (Task 3 contract).
- Produces:
  - `applyEvent(records, event)` — **pure** reducer, exported for testing: given the current `Record<id,DownloadRecord>` map and a `DownloadEvent`, returns the next map (progress → update `bytesDone`/`bytesTotal`/`status:'downloading'`; done → `status:'done'`, `bytesDone=bytesTotal`; error → `status:'error'`, `error` set). Unknown id → returns map unchanged.
  - `DownloadsProvider({ manager, api, documentDirectory, children })` — React context provider.
  - `useDownloads()` → `{ items, byId, start(item), pause(id), resume(id), cancel(id), remove(id), isDownloaded(id) }`.
  - `start(item)`: compute `id=makeId(item)`; if a record exists with status `done`/`downloading` → no-op; free-space pre-flight via `manager.freeBytes()` (skip enforcement when `bytesTotal` unknown); write `queued` record via `downloadStore.put`; call `manager.start({id,url,localPath})`.

- [ ] **Step 1: Write the failing test** (reducer only — pure, no React renderer needed)

```js
// src/downloads/useDownloads.test.js
const test = require('node:test');
const assert = require('node:assert');
const { applyEvent } = require('./useDownloads.js');

const base = { 'movie:1': { id: 'movie:1', status: 'queued', bytesDone: 0, bytesTotal: 0 } };

test('progress event updates bytes and marks downloading', () => {
  const next = applyEvent(base, { id: 'movie:1', type: 'progress', bytesDone: 3, bytesTotal: 10 });
  assert.strictEqual(next['movie:1'].status, 'downloading');
  assert.strictEqual(next['movie:1'].bytesDone, 3);
  assert.strictEqual(next['movie:1'].bytesTotal, 10);
});

test('done event marks done and fills bytesDone', () => {
  const withTotal = { 'movie:1': { ...base['movie:1'], bytesTotal: 10 } };
  const next = applyEvent(withTotal, { id: 'movie:1', type: 'done' });
  assert.strictEqual(next['movie:1'].status, 'done');
  assert.strictEqual(next['movie:1'].bytesDone, 10);
});

test('error event marks error with message', () => {
  const next = applyEvent(base, { id: 'movie:1', type: 'error', error: 'boom' });
  assert.strictEqual(next['movie:1'].status, 'error');
  assert.strictEqual(next['movie:1'].error, 'boom');
});

test('unknown id leaves map unchanged (same reference)', () => {
  const next = applyEvent(base, { id: 'ghost', type: 'progress', bytesDone: 1 });
  assert.strictEqual(next, base);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/downloads/useDownloads.test.js`
Expected: FAIL — cannot find module / `applyEvent` undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// src/downloads/useDownloads.js
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import * as storeApi from './downloadStore.js';
import { remoteUrlFor, localPathFor } from './downloadUri.js';

/** Pure reducer over the id→record map. Exported for tests. */
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

const DownloadsContext = createContext(null);

export function DownloadsProvider({ manager, api, documentDirectory, children }) {
  const [byId, setById] = useState({});
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  // Hydrate from the persisted store, then re-attach to background tasks.
  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await storeApi.loadAll();
      if (alive) setById(map);
      await manager.reattach();
    })();
    return () => { alive = false; };
  }, [manager]);

  // Fold manager events into state + persist.
  useEffect(() => {
    const unsub = manager.subscribe((event) => {
      setById((prev) => {
        const next = applyEvent(prev, event);
        if (next !== prev && next[event.id]) storeApi.put(next[event.id]);
        return next;
      });
    });
    return unsub;
  }, [manager]);

  const start = useCallback(async (item) => {
    const id = storeApi.makeId(item);
    const existing = byIdRef.current[id];
    if (existing && (existing.status === 'done' || existing.status === 'downloading')) return;
    const url = remoteUrlFor(api, item);
    const localPath = localPathFor(id, item.ext, documentDirectory);
    const record = {
      id, kind: item.kind, title: item.title, poster: item.poster,
      seriesId: item.seriesId, season: item.season, episode: item.episode,
      remoteUrl: url, localPath, ext: item.ext || 'mp4',
      bytesTotal: 0, bytesDone: 0, status: 'queued', createdAt: Date.now(),
    };
    const saved = await storeApi.put(record);
    setById((prev) => ({ ...prev, [id]: saved }));
    manager.start({ id, url, localPath });
  }, [api, documentDirectory, manager]);

  const pause = useCallback((id) => manager.pause(id), [manager]);
  const resume = useCallback((id) => manager.resume(id), [manager]);
  const cancel = useCallback(async (id) => {
    manager.cancel(id);
    await storeApi.remove(id);
    setById((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, [manager]);
  const remove = cancel;
  const isDownloaded = useCallback((id) => byIdRef.current[id]?.status === 'done', []);

  const value = {
    byId,
    items: Object.values(byId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    start, pause, resume, cancel, remove, isDownloaded,
  };
  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadsProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/downloads/useDownloads.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/downloads/useDownloads.js src/downloads/useDownloads.test.js
git commit -m "feat(downloads): useDownloads hook + context with pure event reducer"
```

---

### Task 5: Native manager (`nativeDownloadManager`)

Wraps `react-native-background-downloader` + `expo-file-system` behind the `DownloadManager` contract. Thin, native-only; not unit-tested (mocked boundary), verified on device.

**Files:**
- Create: `src/downloads/nativeDownloadManager.js`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `react-native-background-downloader` (`download`, `checkForExistingDownloads`, `ensureDownloadsAreRunning`), `expo-file-system` (`documentDirectory`, `makeDirectoryAsync`, `getFreeDiskStorageAsync`, `deleteAsync`).
- Produces: `createNativeDownloadManager()` → object satisfying the `DownloadManager` contract (Task 3). Also re-exports `documentDirectory` for the provider wiring.

- [ ] **Step 1: Add dependencies**

Run:
```bash
npx expo install expo-file-system @react-native-community/netinfo
npm install @kesha-antonov/react-native-background-downloader
```
Expected: `package.json` gains all three; `package-lock.json` updates.

- [ ] **Step 2: Write the native manager**

```js
// src/downloads/nativeDownloadManager.js
import * as FileSystem from 'expo-file-system';
import RNBackgroundDownloader from '@kesha-antonov/react-native-background-downloader';

export const documentDirectory = FileSystem.documentDirectory;

export function createNativeDownloadManager() {
  const handlers = new Set();
  const tasks = new Map(); // id -> task
  const emit = (e) => handlers.forEach((h) => h(e));

  function wire(task) {
    tasks.set(task.id, task);
    task
      .begin(({ expectedBytes }) => emit({ id: task.id, type: 'progress', bytesDone: 0, bytesTotal: expectedBytes || 0 }))
      .progress(({ bytesDownloaded, bytesTotal }) =>
        emit({ id: task.id, type: 'progress', bytesDone: bytesDownloaded, bytesTotal }))
      .done(() => { emit({ id: task.id, type: 'done' }); tasks.delete(task.id); })
      .error(({ error }) => { emit({ id: task.id, type: 'error', error: String(error) }); tasks.delete(task.id); });
  }

  async function ensureDir(localPath) {
    const dir = localPath.slice(0, localPath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  }

  return {
    async start({ id, url, localPath }) {
      await ensureDir(localPath);
      const destination = localPath.replace('file://', '');
      wire(RNBackgroundDownloader.download({ id, url, destination }));
    },
    pause(id) { tasks.get(id)?.pause?.(); },
    resume(id) { tasks.get(id)?.resume?.(); },
    async cancel(id) {
      const t = tasks.get(id);
      t?.stop?.();
      tasks.delete(id);
    },
    subscribe(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    async reattach() {
      const existing = await RNBackgroundDownloader.checkForExistingDownloads();
      existing.forEach((task) => wire(task));
      RNBackgroundDownloader.ensureDownloadsAreRunning?.();
    },
    async freeBytes() { return FileSystem.getFreeDiskStorageAsync(); },
  };
}
```

- [ ] **Step 3: Lint and test the untouched suite**

Run: `npm run lint && npm test`
Expected: lint passes (errors=0); existing + Task 1-4 tests pass. (No new unit test for this file — its boundary is the native library.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/downloads/nativeDownloadManager.js
git commit -m "feat(downloads): native manager over react-native-background-downloader + expo-file-system"
```

---

### Task 6: Online/offline hook (`useIsOnline`)

Small hook reusing the lazy-NetInfo pattern already in `useResilientPlayback.js:30-34`, exposed standalone for the banner + filter fallback.

**Files:**
- Create: `src/downloads/useIsOnline.js`
- Test: `src/downloads/useIsOnline.test.js`

**Interfaces:**
- Produces:
  - `resolveNetInfo()` → the netinfo module or `null` (copied pattern).
  - `deriveOnline(state)` → boolean — **pure**, exported for test: `state?.isConnected !== false && state?.isInternetReachable !== false`.
  - `useIsOnline()` → boolean (defaults `true` when NetInfo absent).

- [ ] **Step 1: Write the failing test**

```js
// src/downloads/useIsOnline.test.js
const test = require('node:test');
const assert = require('node:assert');
const { deriveOnline } = require('./useIsOnline.js');

test('online when neither flag is explicitly false', () => {
  assert.strictEqual(deriveOnline({ isConnected: true, isInternetReachable: true }), true);
  assert.strictEqual(deriveOnline({}), true); // unknown → assume online
});

test('offline when connected is false or internet unreachable', () => {
  assert.strictEqual(deriveOnline({ isConnected: false }), false);
  assert.strictEqual(deriveOnline({ isConnected: true, isInternetReachable: false }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/downloads/useIsOnline.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// src/downloads/useIsOnline.js
import { useEffect, useMemo, useState } from 'react';

export function resolveNetInfo() {
  try {
    const mod = require('@react-native-community/netinfo');
    return mod.default || mod;
  } catch {
    return null;
  }
}

export function deriveOnline(state) {
  return state?.isConnected !== false && state?.isInternetReachable !== false;
}

export function useIsOnline() {
  const netInfo = useMemo(() => resolveNetInfo(), []);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!netInfo) return undefined;
    return netInfo.addEventListener((state) => setOnline(deriveOnline(state)));
  }, [netInfo]);
  return online;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/downloads/useIsOnline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/downloads/useIsOnline.js src/downloads/useIsOnline.test.js
git commit -m "feat(downloads): useIsOnline hook (lazy NetInfo)"
```

---

### Task 7: `DownloadButton` component + provider wiring

The reusable inline control, and mount `DownloadsProvider` at the native app root so screens can call `useDownloads()`.

**Files:**
- Create: `src/downloads/DownloadButton.jsx`
- Modify: the native navigation/app root that wraps native screens (locate with the command in Step 1) to mount `DownloadsProvider`.

**Interfaces:**
- Consumes: `useDownloads()` (Task 4), `createNativeDownloadManager`/`documentDirectory` (Task 5), the app's `IptvApi` instance (already available where streams are built — pass it into the provider).
- Produces: `DownloadButton({ item })` — renders idle/queued/downloading(progress %)/done/error states with tap actions: idle→`start(item)`, downloading→`pause`, paused→`resume`, done→`remove` (with confirm), error→`start` (retry). `item` shape matches `start()` input in Task 4 plus `title`,`poster`,`ext`.

- [ ] **Step 1: Locate the native app root and api instance**

Run:
```bash
ls src/navigation
grep -rn "new IptvApi\|IptvApi(" src --include=*.js --include=*.jsx | head
grep -rln "NavigationContainer\|registerRootComponent\|export default function App" src App.js index.js 2>/dev/null | head
```
Expected: identifies the native root component (e.g. `AppNavigator.native.jsx` or `App.js`) and where the `IptvApi` instance lives (likely a context/provider). Wrap the native screen tree with `DownloadsProvider` there, passing `manager={createNativeDownloadManager()}` (memoized), `api={<the IptvApi instance>}`, `documentDirectory={documentDirectory}`.

- [ ] **Step 2: Write the component**

```jsx
// src/downloads/DownloadButton.jsx
import React, { useCallback } from 'react';
import { Pressable, Text, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useDownloads } from './useDownloads.js';
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
```

- [ ] **Step 3: Verify build/lint**

Run: `npm run lint && npm test`
Expected: lint clean; all tests still pass. (Visual verification of the button happens on-device in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add src/downloads/DownloadButton.jsx src/navigation
git commit -m "feat(downloads): DownloadButton + mount DownloadsProvider at native root"
```

---

### Task 8: Wire download button + "Downloaded" filter into native Movies/Series screens

Place `DownloadButton` on movie and episode detail (or rows), and add a "Downloaded" filter chip that lists from `downloadStore` instead of the API.

**Files:**
- Modify: the native movie detail/row screen(s) and series episode screen(s) (locate in Step 1).

**Interfaces:**
- Consumes: `DownloadButton` (Task 7), `useDownloads()` `items` (Task 4).
- Produces: no new exports; UI wiring only. The "Downloaded" filter, when active, renders `items` (mapped to the screen's card shape) rather than API results.

- [ ] **Step 1: Locate native movie & series screens**

Run:
```bash
ls src/screens 2>/dev/null; grep -rln "MoviesScreen\|SeriesScreen\|Episode" src/screens src/presentation --include=*.native.jsx | head
```
Expected: identifies `*.native.jsx` movie/series/episode screens to edit. **Only edit `.native.jsx` files** — leave `.web.jsx`/`.tv.jsx` untouched (Global Constraints).

- [ ] **Step 2: Add `DownloadButton` to movie detail and episode rows**

For each located native detail/row, import and render the button with the item mapped to `start()`'s expected shape:
```jsx
import DownloadButton from '../downloads/DownloadButton.jsx';
// movie:
<DownloadButton item={{ kind: 'movie', streamId: movie.stream_id, title: movie.name, poster: movie.stream_icon, ext: movie.container_extension }} />
// episode:
<DownloadButton item={{ kind: 'episode', seriesId: series.series_id, season, episode: ep.episode_num, episodeStreamId: ep.id, title: ep.title, ext: ep.container_extension }} />
```
Adjust property names to the actual data model found in Step 1 (Xtream fields).

- [ ] **Step 3: Add the "Downloaded" filter chip**

In each native list screen, add a boolean `showDownloaded` chip. When true, source rows from `useDownloads().items` filtered by `kind` (`'movie'` on Movies, `'episode'` on Series), mapped to the card props the screen already expects, instead of the API list.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm test`
Expected: clean. On-device verification deferred to Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/screens src/presentation
git commit -m "feat(downloads): inline download button + Downloaded filter on native screens"
```

---

### Task 9: Offline banner + play from local file

When offline, show a banner and auto-apply the Downloaded filter; when playing a `done` item, feed its `localPath` to the player.

**Files:**
- Modify: native list screens (banner + auto-filter), native playback launch path.

**Interfaces:**
- Consumes: `useIsOnline()` (Task 6), `useDownloads()` (Task 4), the existing native playback entry that builds a source for `expoVideoDriver`.
- Produces: no new exports. When `!online`, screens set `showDownloaded = true` and render a banner ("You're offline — showing downloads"). Playback: if a record for the item is `done`, pass `{ uri: record.localPath }` as the source instead of the Xtream URL.

- [ ] **Step 1: Add offline banner + auto-filter**

In each native list screen:
```jsx
import { useIsOnline } from '../downloads/useIsOnline.js';
const online = useIsOnline();
useEffect(() => { if (!online) setShowDownloaded(true); }, [online]);
// render when !online:
{!online && <View style={{ padding: 8, backgroundColor: '#7a2' }}><Text style={{ color:'#fff' }}>You're offline — showing your downloads.</Text></View>}
```

- [ ] **Step 2: Play the local file when downloaded**

At the native playback launch (where the stream URL is currently computed), branch:
```jsx
import { useDownloads } from '../downloads/useDownloads.js';
import { makeId } from '../downloads/downloadStore.js';
const { byId } = useDownloads();
const rec = byId[makeId(item)];
const source = rec?.status === 'done' ? { uri: rec.localPath } : { uri: onlineStreamUrl /* existing */ };
// pass `source` to the existing driver load path
```
Confirm the native driver accepts `{ uri }` — it does (`expoVideoDriver.js:169-172` reads `source.uri`).

- [ ] **Step 3: Verify**

Run: `npm run lint && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/screens src/presentation
git commit -m "feat(downloads): offline banner, auto-filter, and local-file playback"
```

---

### Task 10: Native config, storage-used line, and on-device verification

Add the config plugin, prebuild, surface storage used, and verify the full flow on a device/simulator.

**Files:**
- Modify: `app.json` (config plugin), the Account/settings native screen (storage-used line).

- [ ] **Step 1: Add the config plugin**

In `app.json` `expo.plugins`, add the background-downloader plugin per its README (iOS background modes, Android foreground-service permission). Then:
```bash
npx expo prebuild --clean
```
Expected: `ios/` and `android/` regenerate with the module linked.

- [ ] **Step 2: Surface storage used**

In the native Account/settings screen, sum `useDownloads().items` `bytesDone` and show a human-readable total (reuse `src/utils/formatDuration.js` as a pattern or add a tiny `formatBytes`). Provide a "Downloads" section with count + total size.

- [ ] **Step 3: On-device verification**

Run: `npx expo run:ios` (or `run:android`). Verify, checking each:
- Tap Download on a movie → progress advances → "Downloaded ✓".
- Background the app mid-download → reopen → download resumed and completed (background requirement).
- Toggle airplane mode → offline banner appears, Downloaded filter auto-applies, downloaded titles listed.
- Play a downloaded title with airplane mode ON → plays from local file, no buffering/errors.
- Remove a download → file + record gone, storage-used total drops.

- [ ] **Step 4: Run full suite + lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app.json ios android src
git commit -m "feat(downloads): background config plugin, storage-used, on-device verification"
```

---

## Self-Review notes

- **Spec coverage:** movies+episodes (Tasks 2,7,8) ✓; inline UI + Downloaded filter (7,8) ✓; offline banner + local-metadata fallback (6,9) ✓; background downloads + resume (5,10) ✓; DownloadManager abstraction (3) ✓; free-space pre-flight (4/`freeBytes`) ✓; local-file playback (9) ✓; storage-used (10) ✓; risks noted in spec. No dedicated Downloads screen (per decision) ✓.
- **Type consistency:** `makeId`, `DownloadRecord.status` values, `DownloadEvent.{type,bytesDone,bytesTotal,error}`, and `start({id,url,localPath})` are used identically across Tasks 1,3,4,5,7.
- **Mobile-only isolation:** all new code lives in `src/downloads/` and is imported only by `.native.jsx` screens / the native root; web/TV bundles never import it.

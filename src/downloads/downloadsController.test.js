/**
 * Integration test for useDownloadsController — the headless engine behind
 * DownloadsProvider. The individual pieces (downloadReducer, downloadUri,
 * downloadStore) have their own unit tests; this drives the REAL controller so
 * the seams are covered:
 *   - hydration normalizes stale localPaths and prunes done-but-missing files,
 *   - start() builds a record from the active api + documentDirectory, persists
 *     it, and hands the manager an {id,url,localPath} task,
 *   - a manager event folds through commit() into both state and the store,
 *   - cancel() removes from state and store.
 *
 * As in useResilientPlayback.test.js there is no React renderer in this repo, so
 * we drive the real hook through a minimal hooks host that supplies React 19's
 * internal dispatcher. Only render scheduling is stubbed; the controller code is
 * the shipped code. The store is a real createDownloadStore over an in-memory
 * backend (injected via the `store` param), so persistence is exercised for real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { useDownloadsController } from "./downloadsController.js";
import { createDownloadStore } from "./downloadStore.js";

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function depsEqual(a, b) {
  return !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
}

/** In-memory AsyncStorage-shaped backend (same 3 methods downloadStore uses). */
function memStorage(seed) {
  const mem = new Map();
  if (seed) mem.set("suvo.downloads.v1", JSON.stringify(seed));
  return {
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => { mem.set(k, v); },
    removeItem: async (k) => { mem.delete(k); },
  };
}

/** Manager test double: records tasks + control over exists()/events. */
function makeManager({ exists = async () => true } = {}) {
  const handlers = new Set();
  const m = {
    started: [],
    reattached: 0,
    start(task) { m.started.push(task); },
    pause() {},
    resume() {},
    cancel() {},
    exists,
    subscribe(h) { handlers.add(h); return () => handlers.delete(h); },
    async reattach() { m.reattached++; },
    emit(event) { handlers.forEach((h) => h(event)); },
  };
  return m;
}

/** Drive useDownloadsController in a minimal hooks host. */
function renderController(props) {
  const hooks = [];
  let idx = 0;
  let pendingEffects = [];
  let scheduled = false;
  let value = null;

  const dispatcher = {
    useState(init) {
      const i = idx++;
      if (hooks[i] === undefined) hooks[i] = { state: typeof init === "function" ? init() : init };
      const h = hooks[i];
      return [h.state, (v) => { h.state = typeof v === "function" ? v(h.state) : v; scheduled = true; }];
    },
    useRef(v) {
      const i = idx++;
      if (hooks[i] === undefined) hooks[i] = { current: v };
      return hooks[i];
    },
    useMemo(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[i] = { value: fn(), deps };
      return hooks[i].value;
    },
    useCallback(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[i] = { value: fn, deps };
      return hooks[i].value;
    },
    useEffect(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) {
        pendingEffects.push({ i, fn });
        hooks[i] = { deps, cleanup: prev?.cleanup };
      }
    },
  };

  function renderOnce() {
    idx = 0;
    const prev = internals.H;
    internals.H = dispatcher;
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      value = useDownloadsController(props);
    } finally {
      internals.H = prev;
    }
  }

  function runEffects() {
    const toRun = pendingEffects;
    pendingEffects = [];
    for (const e of toRun) {
      if (hooks[e.i]?.cleanup) { try { hooks[e.i].cleanup(); } catch { /* noop */ } }
      const cleanup = e.fn();
      if (hooks[e.i]) hooks[e.i].cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  function flushSync() {
    let guard = 0;
    do {
      scheduled = false;
      renderOnce();
      runEffects();
      if (++guard > 50) throw new Error("render loop did not settle");
    } while (scheduled);
  }

  // Effect bodies are async (await store.loadAll(), store.put(), etc), so after
  // the sync flush we drain microtasks and re-flush until state stops changing.
  async function settle() {
    flushSync();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      if (scheduled) flushSync();
    }
  }

  return {
    get value() { return value; },
    settle,
    async act(fn) { await fn?.(); await settle(); },
  };
}

const DIR = "file:///new-container/Documents/";
const api = { buildStreamUrl: (type, id, ext) => `http://host/${type}/${id}.${ext}` };

test("hydration normalizes stale localPaths and prunes done-but-missing files", async () => {
  const seed = {
    "movie:1": { id: "movie:1", kind: "movie", status: "done", ext: "mp4", localPath: "file:///OLD-container/Documents/downloads/movie_1.mp4" },
    "movie:2": { id: "movie:2", kind: "movie", status: "done", ext: "mkv", localPath: "file:///OLD/downloads/movie_2.mkv" },
  };
  const store = createDownloadStore(memStorage(seed));
  // movie:1's file is gone; movie:2's is present.
  const manager = makeManager({ exists: async (p) => p.includes("movie_2") });
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();

  assert.equal(h.value.byId["movie:1"], undefined, "missing-file record pruned");
  assert.ok(h.value.byId["movie:2"], "present-file record kept");
  // localPath re-derived against the CURRENT documentDirectory, not the stored prefix.
  assert.equal(h.value.byId["movie:2"].localPath, `${DIR}downloads/movie_2.mkv`);
  assert.equal(manager.reattached, 1, "reattached to background tasks after hydration");
  // The pruned record is gone from the store too.
  assert.equal(await store.get("movie:1"), null);
});

test("start() builds a record from the active api, persists it, and tasks the manager", async () => {
  const store = createDownloadStore(memStorage());
  const manager = makeManager();
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();

  await h.act(() => h.value.start({ kind: "movie", streamId: 42, title: "Film", ext: "mp4" }));

  const rec = h.value.byId["movie:42"];
  assert.ok(rec, "record added to state");
  assert.equal(rec.status, "queued");
  // The credentialed remote URL must NOT be persisted at rest (only handed to
  // the manager below).
  assert.equal(rec.remoteUrl, undefined);
  assert.equal(rec.localPath, `${DIR}downloads/movie_42.mp4`);
  // Manager received a task with the same id/url/localPath.
  assert.deepEqual(manager.started, [{ id: "movie:42", url: "http://host/movie/42.mp4", localPath: `${DIR}downloads/movie_42.mp4` }]);
  // Persisted.
  assert.equal((await store.get("movie:42")).status, "queued");
});

test("start() is a no-op for an already-downloading item (no duplicate task)", async () => {
  const seed = { "movie:42": { id: "movie:42", kind: "movie", status: "downloading", ext: "mp4" } };
  const store = createDownloadStore(memStorage(seed));
  const manager = makeManager();
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();

  await h.act(() => h.value.start({ kind: "movie", streamId: 42, title: "Film", ext: "mp4" }));
  assert.deepEqual(manager.started, [], "no new task started");
});

test("a manager progress+done event folds through commit into state and store", async () => {
  const store = createDownloadStore(memStorage());
  const manager = makeManager();
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();
  await h.act(() => h.value.start({ kind: "movie", streamId: 7, title: "X", ext: "mp4" }));

  await h.act(() => manager.emit({ id: "movie:7", type: "progress", bytesDone: 500, bytesTotal: 1000 }));
  assert.equal(h.value.byId["movie:7"].bytesDone, 500);

  await h.act(() => manager.emit({ id: "movie:7", type: "done" }));
  assert.equal(h.value.byId["movie:7"].status, "done");
  assert.equal(h.value.isDownloaded("movie:7"), true);
  assert.equal((await store.get("movie:7")).status, "done", "done state persisted");
});

test("freeBytes() passes through to the manager", async () => {
  const store = createDownloadStore(memStorage());
  const manager = makeManager();
  manager.freeBytes = async () => 12345;
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();
  assert.equal(await h.value.freeBytes(), 12345);
});

test("freeBytes() resolves null when the manager can't report it", async () => {
  const store = createDownloadStore(memStorage());
  const manager = makeManager();
  delete manager.freeBytes;
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();
  assert.equal(await h.value.freeBytes(), null);
});

test("cancel() removes the record from state and store", async () => {
  const store = createDownloadStore(memStorage());
  const manager = makeManager();
  const h = renderController({ manager, api, documentDirectory: DIR, store });
  await h.settle();
  await h.act(() => h.value.start({ kind: "movie", streamId: 9, title: "Y", ext: "mp4" }));
  assert.ok(h.value.byId["movie:9"]);

  await h.act(() => h.value.cancel("movie:9"));
  assert.equal(h.value.byId["movie:9"], undefined);
  assert.equal(await store.get("movie:9"), null);
});

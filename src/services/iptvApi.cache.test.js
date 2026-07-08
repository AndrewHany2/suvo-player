import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { IPTVApi, __setStorageBackend } from "./iptvApi.js";

// Flush pending microtasks so fire-and-forget background work (revalidate)
// settles before we assert on it.
const flush = () => new Promise((r) => setImmediate(r));

// Minimal in-memory AsyncStorage stand-in for hydrate/persist tests.
function makeStorage() {
  const store = new Map();
  return {
    store,
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
  };
}

describe("IPTVApi cache — stale-while-revalidate", () => {
  let api;
  beforeEach(() => { api = new IPTVApi(); });

  test("miss fetches once; subsequent fresh hit does not refetch", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return `v${calls}`; };
    const a = await api._cached("k", 10_000, fetcher);
    const b = await api._cached("k", 10_000, fetcher);
    assert.equal(a, "v1");
    assert.equal(b, "v1");
    assert.equal(calls, 1);
  });

  test("stale hit returns stale immediately then refreshes in the background", async () => {
    // Seed an already-expired entry (negative ttl → expiresAt in the past).
    api._cacheSet("k", "stale", -1);
    let calls = 0;
    const fetcher = async () => { calls++; return "fresh"; };
    const returned = await api._cached("k", 10_000, fetcher);
    assert.equal(returned, "stale", "returns the stale value without waiting");
    await flush();
    assert.equal(calls, 1, "one background refresh fired");
    assert.equal(api._cache.get("k").data, "fresh", "cache updated for next read");
    assert.equal(await api._cached("k", 10_000, fetcher), "fresh");
    assert.equal(calls, 1, "now-fresh read does not refetch");
  });

  test("concurrent misses on the same key fire a single fetch", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; await flush(); return "v"; };
    const [a, b, c] = await Promise.all([
      api._cached("k", 10_000, fetcher),
      api._cached("k", 10_000, fetcher),
      api._cached("k", 10_000, fetcher),
    ]);
    assert.deepEqual([a, b, c], ["v", "v", "v"]);
    assert.equal(calls, 1);
  });

  test("a rejected background refresh keeps the stale value", async () => {
    api._cacheSet("k", "stale", -1);
    const fetcher = async () => { throw new Error("network down"); };
    const returned = await api._cached("k", 10_000, fetcher);
    assert.equal(returned, "stale");
    await flush();
    assert.equal(api._cache.get("k").data, "stale", "stale value survives a failed refresh");
  });

  test("eviction cap keeps the Map bounded", async () => {
    for (let i = 0; i < 250; i++) api._cacheSet(`k${i}`, i, 10_000);
    assert.ok(api._cache.size <= 200, `size ${api._cache.size} exceeds cap`);
  });
});

describe("IPTVApi cache — persistence", () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); __setStorageBackend(storage); });
  afterEach(() => { __setStorageBackend(undefined); });

  test("category keys persist to disk; stream keys do not", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    await api._hydratePromise;
    api._cacheSet("vod_categories", [{ id: 1 }], 10_000);
    api._cacheSet("vod_streams_42", [{ stream_id: 9 }], 10_000); // NOT whitelisted
    clearTimeout(api._persistTimer);                              // skip the debounce
    await api._persist();

    const raw = storage.store.get(`iptvcache_${api._ns}`);
    assert.ok(raw, "disk blob written");
    const blob = JSON.parse(raw);
    assert.deepEqual(blob.vod_categories.data, [{ id: 1 }]);
    assert.equal(blob.vod_streams_42, undefined, "stream list not persisted (quota safety)");
  });

  test("hydrate loads a prior account's persisted categories into the cache", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    const ns = api._ns;
    storage.store.set(
      `iptvcache_${ns}`,
      JSON.stringify({ series_categories: { data: [{ id: "s1" }], expiresAt: Date.now() + 10_000 } }),
    );
    await api._hydrate();
    assert.deepEqual(api._cache.get("series_categories").data, [{ id: "s1" }]);
  });

  test("switching credentials swaps the namespace (no cross-account bleed)", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    const nsA = api._ns;
    api._cacheSet("vod_categories", ["A"], 10_000);
    api.setCredentials("http://box.example:8080", "bob", "pw");
    const nsB = api._ns;
    assert.notEqual(nsA, nsB, "different username → different namespace");
    assert.equal(api._cache.size, 0, "cache cleared on credential change");
  });

  test("whole-catalog keys persist to their own storage entry (not the shared blob)", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    await api._hydratePromise;
    api._cacheSet("vod_categories", [{ id: 1 }], 10_000);
    api._cacheSet("vod_streams_robust", [{ stream_id: 9 }], 10_000); // whitelisted bulk key
    clearTimeout(api._persistTimer);
    await api._persist();

    const blob = JSON.parse(storage.store.get(`iptvcache_${api._ns}`));
    assert.equal(blob.vod_streams_robust, undefined, "catalog kept out of the shared blob");
    const bulk = JSON.parse(storage.store.get(`iptvcache_${api._ns}_vod_streams_robust`));
    assert.deepEqual(bulk.data, [{ stream_id: 9 }], "catalog written under its own key");
  });

  test("a warm launch serves the persisted catalog without a network fetch", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    await api._hydratePromise;
    // Prior run left a still-fresh catalog on disk under its own key.
    storage.store.set(
      `iptvcache_${api._ns}_vod_streams_robust`,
      JSON.stringify({ data: [{ stream_id: 1 }], expiresAt: Date.now() + 10_000 }),
    );
    let calls = 0;
    const fetcher = async () => { calls++; return [{ stream_id: 2 }]; };
    const out = await api._cached("vod_streams_robust", 10_000, fetcher);
    assert.deepEqual(out, [{ stream_id: 1 }], "disk copy served");
    await flush();
    assert.equal(calls, 0, "fresh disk copy → no network fetch");
  });

  test("an expired persisted catalog serves stale then revalidates", async () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    await api._hydratePromise;
    storage.store.set(
      `iptvcache_${api._ns}_series_robust`,
      JSON.stringify({ data: [{ series_id: 1 }], expiresAt: Date.now() - 1 }), // expired
    );
    let calls = 0;
    const fetcher = async () => { calls++; return [{ series_id: 2 }]; };
    const out = await api._cached("series_robust", 10_000, fetcher);
    assert.deepEqual(out, [{ series_id: 1 }], "stale disk copy served immediately");
    await flush();
    assert.equal(calls, 1, "one background revalidate fired");
    assert.deepEqual(api._cache.get("series_robust").data, [{ series_id: 2 }], "cache refreshed");
  });
});

describe("IPTVApi fetch wrapper", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("returns parsed JSON on a 200 response", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ hello: "world" }) });
    const api = new IPTVApi();
    assert.deepEqual(await api.fetch("http://x/api"), { hello: "world" });
  });

  test("throws on a non-ok response", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const api = new IPTVApi();
    await assert.rejects(() => api.fetch("http://x/api"), /status: 403/);
  });

  test("a caller-aborted signal aborts the request", async () => {
    // The wrapper forwards its own AbortController.signal; when the caller's
    // signal aborts, so does the request's.
    globalThis.fetch = (url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    const api = new IPTVApi();
    const ctrl = new AbortController();
    const p = api.fetch("http://x/api", { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(() => p, /aborted/);
  });
});

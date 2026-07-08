import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { IPTVApi } from "./iptvApi.js";

describe("IPTVApi setCredentials — scheme preservation", () => {
  test("preserves an explicit https scheme (no downgrade to http)", () => {
    const api = new IPTVApi();
    api.setCredentials("https://box.example:8080", "alice", "pw");
    assert.equal(api.baseUrl, "https://box.example:8080");
  });

  test("adds http when the host is bare (no scheme given)", () => {
    const api = new IPTVApi();
    api.setCredentials("box.example:8080", "alice", "pw");
    assert.equal(api.baseUrl, "http://box.example:8080");
  });

  test("keeps an explicit http scheme", () => {
    const api = new IPTVApi();
    api.setCredentials("http://box.example:8080", "alice", "pw");
    assert.equal(api.baseUrl, "http://box.example:8080");
  });

  test("strips a trailing slash while preserving https", () => {
    const api = new IPTVApi();
    api.setCredentials("https://box.example:8080/", "alice", "pw");
    assert.equal(api.baseUrl, "https://box.example:8080");
  });

  test("buildStreamUrl uses the preserved https scheme", () => {
    const api = new IPTVApi();
    api.setCredentials("https://box.example:8080", "alice", "pw");
    assert.equal(
      api.buildStreamUrl("live", 42, "ts"),
      "https://box.example:8080/live/alice/pw/42.ts",
    );
  });

  test("buildStreamUrl defaults to http for a bare host", () => {
    const api = new IPTVApi();
    api.setCredentials("box.example:8080", "alice", "pw");
    assert.equal(
      api.buildStreamUrl("movie", 7, "mp4"),
      "http://box.example:8080/movie/alice/pw/7.mp4",
    );
  });
});

describe("IPTVApi fetch — bounded retry on transient failure", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("retries a 5xx then succeeds on the retry", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, text: async () => "{}" };
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: 1 }) };
    };
    const api = new IPTVApi();
    assert.deepEqual(await api.fetch("http://x/api"), { ok: 1 });
    assert.equal(calls, 2, "one retry fired after the 5xx");
  });

  test("does not retry a 4xx client error", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 404, text: async () => "{}" };
    };
    const api = new IPTVApi();
    await assert.rejects(() => api.fetch("http://x/api"), /status: 404/);
    assert.equal(calls, 1, "no retry for a client error");
  });

  test("a caller-aborted request does NOT retry", async () => {
    let calls = 0;
    globalThis.fetch = (url, { signal }) => {
      calls++;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const api = new IPTVApi();
    const ctrl = new AbortController();
    const p = api.fetch("http://x/api", { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(() => p, /aborted/);
    assert.equal(calls, 1, "aborted request is not retried");
  });

  test("gives up after the retry budget and throws the last error", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: false, status: 500, text: async () => "{}" };
    };
    const api = new IPTVApi();
    await assert.rejects(() => api.fetch("http://x/api"), /status: 500/);
    assert.ok(calls >= 2, `retried at least once (calls=${calls})`);
  });
});

describe("IPTVApi fetch — non-JSON provider body", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  // Regression: a 200 response whose body is NOT JSON (an upstream error page, a
  // block notice, an HTML challenge) must reject with an error that carries a
  // snippet of the actual body — not an opaque "Unexpected character: B".
  test("surfaces a snippet of the body when it is not JSON", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "Blocked by upstream firewall" });
    const api = new IPTVApi();
    await assert.rejects(
      () => api.fetch("http://x/api"),
      /Non-JSON response from provider: Blocked by upstream firewall/,
    );
  });

  test("reports an empty body distinctly", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "   " });
    const api = new IPTVApi();
    await assert.rejects(() => api.fetch("http://x/api"), /\(empty body\)/);
  });
});

describe("IPTVApi fetch — hard timeout when the platform ignores abort", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  // Regression: some React Native engines don't reject a hung request when its
  // AbortController fires, so a stalled provider would never settle and the
  // loading state (e.g. the Live TV spinner) would stay open forever. The
  // deadline must reject on its own, independent of the abort signal.
  test("rejects at the deadline even when the underlying fetch never settles", async () => {
    globalThis.fetch = () => new Promise(() => {}); // hangs; ignores abort
    const api = new IPTVApi();
    await assert.rejects(
      () => api.fetch("http://x/api", { timeout: 50 }),
      /timed out/,
    );
  });
});

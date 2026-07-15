// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLiveStream, probeLiveStream } from './liveStreamProbe.js';

// ── classifyLiveStream (pure) ────────────────────────────────────────────────

test('EXTM3U body → hls', () => {
  assert.equal(classifyLiveStream({ firstBytes: strBytes('#EXTM3U\n#EXT-X-VERSION:3') }), 'hls');
});

test('leading whitespace before EXTM3U → hls', () => {
  assert.equal(classifyLiveStream({ firstBytes: strBytes('\n  #EXTM3U') }), 'hls');
});

test('mpegurl content-type → hls', () => {
  assert.equal(classifyLiveStream({ contentType: 'application/vnd.apple.mpegurl' }), 'hls');
  assert.equal(classifyLiveStream({ contentType: 'application/x-mpegURL' }), 'hls');
});

test('0x47 TS sync byte → mpegts', () => {
  // TS packets are 188 bytes each, starting with 0x47.
  const b = new Uint8Array(376);
  b[0] = 0x47;
  b[188] = 0x47;
  assert.equal(classifyLiveStream({ firstBytes: b }), 'mpegts');
});

test('video/mp2t content-type → mpegts', () => {
  assert.equal(classifyLiveStream({ contentType: 'video/mp2t' }), 'mpegts');
  assert.equal(classifyLiveStream({ contentType: 'video/MP2T; charset=binary' }), 'mpegts');
});

test('body signature wins over a misleading content-type', () => {
  // Panels frequently mislabel; the actual bytes are authoritative.
  assert.equal(
    classifyLiveStream({ contentType: 'application/octet-stream', firstBytes: strBytes('#EXTM3U') }),
    'hls',
  );
  const ts = new Uint8Array([0x47, 0, 0, 0]);
  assert.equal(classifyLiveStream({ contentType: 'text/html', firstBytes: ts }), 'mpegts');
});

test('ambiguous input → hls (preserve existing behavior)', () => {
  assert.equal(classifyLiveStream({}), 'hls');
  assert.equal(classifyLiveStream({ contentType: 'text/html', firstBytes: strBytes('<html>') }), 'hls');
});

// ── probeLiveStream (fetch + abort + fallback) ───────────────────────────────

test('probe reads content-type + first chunk, returns engine and url', async () => {
  const fetchImpl = fakeFetch({
    finalUrl: 'http://cdn/stream.ts',
    contentType: 'video/mp2t',
    chunk: new Uint8Array([0x47, 0, 0, 0]),
  });
  const out = await probeLiveStream('http://host/live/u/p/1.m3u8', { fetchImpl });
  assert.equal(out.engine, 'mpegts');
});

test('probe classifies a real HLS playlist as hls', async () => {
  const fetchImpl = fakeFetch({
    finalUrl: 'http://host/live/u/p/1.m3u8',
    contentType: 'application/vnd.apple.mpegurl',
    chunk: strBytes('#EXTM3U\n#EXTINF:2,\nseg.ts'),
  });
  const out = await probeLiveStream('http://host/live/u/p/1.m3u8', { fetchImpl });
  assert.equal(out.engine, 'hls');
});

test('probe aborts the body after reading the first chunk', async () => {
  let aborted = false;
  const fetchImpl = fakeFetch({
    contentType: 'video/mp2t',
    chunk: new Uint8Array([0x47]),
    onCancel: () => { aborted = true; },
  });
  await probeLiveStream('http://host/x.m3u8', { fetchImpl });
  assert.equal(aborted, true, 'reader/body should be cancelled after first read');
});

test('probe failure defaults to hls', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const out = await probeLiveStream('http://host/x.m3u8', { fetchImpl });
  assert.equal(out.engine, 'hls');
});

// ── helpers ──────────────────────────────────────────────────────────────────

function strBytes(s) {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

/** Minimal fetch stub returning a Response-like with a cancelable stream body. */
function fakeFetch({ finalUrl, contentType, chunk, onCancel } = {}) {
  return async (_url, _opts) => ({
    url: finalUrl ?? _url,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType ?? null : null) },
    body: {
      getReader() {
        let done = false;
        return {
          read: async () => (done ? { done: true } : ((done = true), { done: false, value: chunk })),
          cancel: async () => { onCancel?.(); },
          releaseLock() {},
        };
      },
    },
  });
}

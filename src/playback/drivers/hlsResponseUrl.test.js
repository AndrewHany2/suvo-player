// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveResponseUrl } from './hlsResponseUrl.js';

const REQ = 'http://host:8080/live/user/pass/372341.m3u8';

test('empty response URL (webOS after redirect) falls back to the request URL', () => {
  // The core bug: hls.js keeps "" as the base and resolves relative segments
  // against the file:// page. We must return the http request URL instead.
  assert.equal(effectiveResponseUrl('', REQ), REQ);
});

test('undefined response URL falls back to the request URL', () => {
  assert.equal(effectiveResponseUrl(undefined, REQ), REQ);
});

test('a scheme-less / relative response URL is not used as a base', () => {
  // Anything that isn't absolute would resolve against the document (file://),
  // so we prefer the absolute request URL.
  assert.equal(effectiveResponseUrl('724614_2234.ts', REQ), REQ);
  assert.equal(effectiveResponseUrl('/live/724614_2234.ts', REQ), REQ);
});

test('an absolute redirected response URL is preserved (desktop path)', () => {
  const redirected = 'http://cdn.example.net/hls/724614/index.m3u8';
  assert.equal(effectiveResponseUrl(redirected, REQ), redirected);
});

test('https response URL is preserved', () => {
  const redirected = 'https://cdn.example.net/hls/724614/index.m3u8';
  assert.equal(effectiveResponseUrl(redirected, REQ), redirected);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent } from './downloadReducer.js';

const base = { 'movie:1': { id: 'movie:1', status: 'queued', bytesDone: 0, bytesTotal: 0 } };

test('progress event updates bytes and marks downloading', () => {
  const next = applyEvent(base, { id: 'movie:1', type: 'progress', bytesDone: 3, bytesTotal: 10 });
  assert.equal(next['movie:1'].status, 'downloading');
  assert.equal(next['movie:1'].bytesDone, 3);
  assert.equal(next['movie:1'].bytesTotal, 10);
});

test('done event marks done and fills bytesDone', () => {
  const withTotal = { 'movie:1': { ...base['movie:1'], bytesTotal: 10 } };
  const next = applyEvent(withTotal, { id: 'movie:1', type: 'done' });
  assert.equal(next['movie:1'].status, 'done');
  assert.equal(next['movie:1'].bytesDone, 10);
});

test('error event marks error with message', () => {
  const next = applyEvent(base, { id: 'movie:1', type: 'error', error: 'boom' });
  assert.equal(next['movie:1'].status, 'error');
  assert.equal(next['movie:1'].error, 'boom');
});

test('unknown id leaves map unchanged (same reference)', () => {
  const next = applyEvent(base, { id: 'ghost', type: 'progress', bytesDone: 1 });
  assert.equal(next, base);
});

test('paused event marks a downloading record paused', () => {
  const downloading = { 'movie:1': { ...base['movie:1'], status: 'downloading', bytesDone: 4, bytesTotal: 10 } };
  const next = applyEvent(downloading, { id: 'movie:1', type: 'paused' });
  assert.equal(next['movie:1'].status, 'paused');
  assert.equal(next['movie:1'].bytesDone, 4);
});

test('paused event marks a queued record paused', () => {
  const next = applyEvent(base, { id: 'movie:1', type: 'paused' });
  assert.equal(next['movie:1'].status, 'paused');
});

test('paused event is a no-op for a done record (same reference)', () => {
  const done = { 'movie:1': { ...base['movie:1'], status: 'done' } };
  const next = applyEvent(done, { id: 'movie:1', type: 'paused' });
  assert.equal(next, done);
});

test('resumed event flips a paused record back to downloading', () => {
  const paused = { 'movie:1': { ...base['movie:1'], status: 'paused', bytesDone: 4, bytesTotal: 10 } };
  const next = applyEvent(paused, { id: 'movie:1', type: 'resumed' });
  assert.equal(next['movie:1'].status, 'downloading');
  assert.equal(next['movie:1'].bytesDone, 4);
});

test('resumed event is a no-op unless paused (same reference)', () => {
  const downloading = { 'movie:1': { ...base['movie:1'], status: 'downloading' } };
  const next = applyEvent(downloading, { id: 'movie:1', type: 'resumed' });
  assert.equal(next, downloading);
});

test('a trailing progress event does not un-pause a paused record', () => {
  const paused = { 'movie:1': { ...base['movie:1'], status: 'paused', bytesDone: 4, bytesTotal: 10 } };
  const next = applyEvent(paused, { id: 'movie:1', type: 'progress', bytesDone: 5, bytesTotal: 10 });
  assert.equal(next['movie:1'].status, 'paused');
  assert.equal(next['movie:1'].bytesDone, 5);
});

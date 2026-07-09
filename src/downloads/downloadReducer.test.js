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

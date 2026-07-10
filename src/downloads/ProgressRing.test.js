import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHalfCircleDegrees } from './progressMath.js';

test('0% — nothing filled, second disk is a track-coloured mask', () => {
  assert.deepEqual(computeHalfCircleDegrees(0), { first: 0, second: 0, secondIsFill: false });
});

test('25% — first disk sweeps to 90°, second masks', () => {
  assert.deepEqual(computeHalfCircleDegrees(25), { first: 90, second: 0, secondIsFill: false });
});

test('50% — first disk exactly the right half, still masked', () => {
  assert.deepEqual(computeHalfCircleDegrees(50), { first: 180, second: 0, secondIsFill: false });
});

test('75% — first pinned at 180°, second disk fills to 270°', () => {
  assert.deepEqual(computeHalfCircleDegrees(75), { first: 180, second: 270, secondIsFill: true });
});

test('100% — both disks fill the full circle', () => {
  assert.deepEqual(computeHalfCircleDegrees(100), { first: 180, second: 360, secondIsFill: true });
});

test('clamps out-of-range input', () => {
  assert.deepEqual(computeHalfCircleDegrees(-10), { first: 0, second: 0, secondIsFill: false });
  assert.deepEqual(computeHalfCircleDegrees(150), { first: 180, second: 360, secondIsFill: true });
});

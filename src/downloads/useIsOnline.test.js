import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnline } from './useIsOnline.js';

test('online when neither flag is explicitly false', () => {
  assert.equal(deriveOnline({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(deriveOnline({}), true); // unknown → assume online
});

test('offline when connected is false or internet unreachable', () => {
  assert.equal(deriveOnline({ isConnected: false }), false);
  assert.equal(deriveOnline({ isConnected: true, isInternetReachable: false }), false);
});

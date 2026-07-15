// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { vlcInitOptions } from './vlcInitOptions.js';

test('both userAgent and referer', () => {
  assert.deepEqual(
    vlcInitOptions({ userAgent: 'UA/1.0', referer: 'http://h/' }),
    [':http-user-agent=UA/1.0', ':http-referrer=http://h/'],
  );
});

test('userAgent only', () => {
  assert.deepEqual(vlcInitOptions({ userAgent: 'UA/1.0' }), [':http-user-agent=UA/1.0']);
});

test('referer only', () => {
  assert.deepEqual(vlcInitOptions({ referer: 'http://h/' }), [':http-referrer=http://h/']);
});

test('neither → empty array', () => {
  assert.deepEqual(vlcInitOptions({}), []);
  assert.deepEqual(vlcInitOptions(), []);
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { containerExtension, needsVlcEngine, UNSUPPORTED_IOS_CONTAINERS } from './nativeEngine.js';

test('containerExtension: basic and edge cases', () => {
  assert.equal(containerExtension('http://h/series/1/2/401998.mkv'), 'mkv');
  assert.equal(containerExtension('http://h/a.MKV'), 'mkv'); // lowercased
  assert.equal(containerExtension('http://h/a.mkv?token=abc'), 'mkv'); // query stripped
  assert.equal(containerExtension('http://h/a.mkv#frag'), 'mkv'); // hash stripped
  assert.equal(containerExtension('file:///var/media/x.avi'), 'avi'); // local file
  assert.equal(containerExtension('http://h/noext'), ''); // no extension
  assert.equal(containerExtension('http://h/dir.with.dots/name'), ''); // dot in path, not filename
  assert.equal(containerExtension(''), '');
  assert.equal(containerExtension(null), '');
});

test('needsVlcEngine: iOS unsupported containers only', () => {
  for (const ext of ['mkv', 'avi', 'flv', 'wmv', 'webm']) {
    assert.equal(needsVlcEngine(`http://h/x.${ext}`, 'ios'), true, `${ext} on ios`);
  }
  assert.equal(needsVlcEngine('http://h/x.mp4', 'ios'), false);
  assert.equal(needsVlcEngine('http://h/x.m3u8', 'ios'), false);
  assert.equal(needsVlcEngine('http://h/x.mov', 'ios'), false);
});

test('needsVlcEngine: never routes off iOS', () => {
  assert.equal(needsVlcEngine('http://h/x.mkv', 'android'), false);
  assert.equal(needsVlcEngine('http://h/x.mkv', 'web'), false);
  assert.equal(needsVlcEngine('file:///x.mkv', 'ios'), true); // local mkv still routes on ios
});

test('UNSUPPORTED_IOS_CONTAINERS is the agreed set', () => {
  assert.deepEqual([...UNSUPPORTED_IOS_CONTAINERS].sort(), ['avi', 'flv', 'mkv', 'webm', 'wmv']);
});

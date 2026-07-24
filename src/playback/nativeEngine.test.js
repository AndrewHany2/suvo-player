// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { containerExtension, needsVlcEngine, VLC_CONTAINERS } from './nativeEngine.js';

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

test('needsVlcEngine: VLC containers route on iOS AND Android', () => {
  for (const ext of ['mkv', 'avi', 'flv', 'wmv', 'webm']) {
    assert.equal(needsVlcEngine(`http://h/x.${ext}`, 'ios'), true, `${ext} on ios`);
    assert.equal(needsVlcEngine(`http://h/x.${ext}`, 'android'), true, `${ext} on android`);
  }
  for (const p of ['ios', 'android']) {
    assert.equal(needsVlcEngine('http://h/x.mp4', p), false, `mp4 on ${p}`);
    assert.equal(needsVlcEngine('http://h/x.m3u8', p), false, `m3u8 on ${p}`);
    assert.equal(needsVlcEngine('http://h/x.mov', p), false, `mov on ${p}`);
  }
});

test('needsVlcEngine: never routes on web, routes local files on native', () => {
  assert.equal(needsVlcEngine('http://h/x.mkv', 'web'), false);
  assert.equal(needsVlcEngine('file:///x.mkv', 'ios'), true); // local mkv still routes on ios
  assert.equal(needsVlcEngine('file:///x.mkv', 'android'), true); // and on android
});

test('VLC_CONTAINERS is the agreed set', () => {
  assert.deepEqual([...VLC_CONTAINERS].sort(), ['avi', 'flv', 'mkv', 'webm', 'wmv']);
});

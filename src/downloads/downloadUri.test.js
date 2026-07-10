import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remoteUrlFor,
  localPathFor,
  currentLocalUri,
  normalizeLocalPaths,
  DEFAULT_EXT,
} from './downloadUri.js';

const api = {
  buildStreamUrl: (type, id, ext) => `http://host/${type}/u/p/${id}.${ext}`,
};

test('remoteUrlFor builds movie url', () => {
  assert.equal(
    remoteUrlFor(api, { kind: 'movie', streamId: 42, ext: 'mkv' }),
    'http://host/movie/u/p/42.mkv',
  );
});

test('remoteUrlFor builds episode url from episodeStreamId', () => {
  assert.equal(
    remoteUrlFor(api, { kind: 'episode', episodeStreamId: 99, ext: 'mp4' }),
    'http://host/series/u/p/99.mp4',
  );
});

test('localPathFor sanitizes id and joins under downloads dir', () => {
  assert.equal(
    localPathFor('ep:7:2:5', 'mp4', 'file:///docs/'),
    'file:///docs/downloads/ep_7_2_5.mp4',
  );
});

test('DEFAULT_EXT is mp4', () => {
  assert.equal(DEFAULT_EXT, 'mp4');
});

test('currentLocalUri re-derives against the current documentDirectory, ignoring the stored prefix', () => {
  // A record whose stored localPath points into a now-dead iOS container.
  const rec = {
    id: 'movie:42',
    ext: 'mkv',
    localPath: 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/downloads/movie_42.mkv',
  };
  assert.equal(
    currentLocalUri(rec, 'file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/'),
    'file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/downloads/movie_42.mkv',
  );
});

test('currentLocalUri sanitizes ids and falls back to mp4 when ext missing', () => {
  assert.equal(
    currentLocalUri({ id: 'ep:7:2:5' }, 'file:///docs/'),
    'file:///docs/downloads/ep_7_2_5.mp4',
  );
});

test('currentLocalUri returns null when documentDirectory is falsy (e.g. web)', () => {
  assert.equal(currentLocalUri({ id: 'movie:1', ext: 'mp4' }, undefined), null);
});

test('normalizeLocalPaths rewrites every record localPath to the current container', () => {
  const map = {
    'movie:1': { id: 'movie:1', ext: 'mp4', status: 'done', localPath: 'file:///OLD/downloads/movie_1.mp4' },
    'ep:7:2:5': { id: 'ep:7:2:5', ext: 'mkv', status: 'done', localPath: 'file:///OLD/downloads/ep_7_2_5.mkv' },
  };
  const out = normalizeLocalPaths(map, 'file:///NEW/');
  assert.equal(out['movie:1'].localPath, 'file:///NEW/downloads/movie_1.mp4');
  assert.equal(out['ep:7:2:5'].localPath, 'file:///NEW/downloads/ep_7_2_5.mkv');
  // Other fields are preserved; input is not mutated.
  assert.equal(out['movie:1'].status, 'done');
  assert.equal(map['movie:1'].localPath, 'file:///OLD/downloads/movie_1.mp4');
});

test('normalizeLocalPaths is a no-op when documentDirectory is falsy', () => {
  const map = { 'movie:1': { id: 'movie:1', ext: 'mp4', localPath: 'file:///OLD/downloads/movie_1.mp4' } };
  assert.equal(normalizeLocalPaths(map, undefined), map);
});

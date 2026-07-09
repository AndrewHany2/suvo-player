import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteUrlFor, localPathFor, DEFAULT_EXT } from './downloadUri.js';

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

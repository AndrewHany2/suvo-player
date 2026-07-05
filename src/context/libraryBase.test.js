import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLibraryBase } from './libraryBase.js';

test('same key: prefers in-memory when it is richer than disk', () => {
  const inMemory = [{ id: 'a' }, { id: 'b' }];
  const onDisk = [{ id: 'a' }];
  assert.equal(pickLibraryBase({ sameKey: true, inMemory, onDisk }), inMemory);
});

test('same key: prefers disk when it is richer than in-memory', () => {
  const inMemory = [{ id: 'a' }];
  const onDisk = [{ id: 'a' }, { id: 'b' }];
  assert.equal(pickLibraryBase({ sameKey: true, inMemory, onDisk }), onDisk);
});

test('different key: ignores in-memory (belongs to another profile) and uses disk', () => {
  // Previous profile has a rich list in memory; new profile has a smaller list
  // on disk. The old list must NOT bleed into the new profile.
  const inMemory = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const onDisk = [{ id: 'x' }];
  assert.equal(pickLibraryBase({ sameKey: false, inMemory, onDisk }), onDisk);
});

test('different key: uses disk even when new profile has an empty list', () => {
  const inMemory = [{ id: 'a' }, { id: 'b' }];
  const onDisk = [];
  assert.equal(pickLibraryBase({ sameKey: false, inMemory, onDisk }), onDisk);
});

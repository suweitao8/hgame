import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore, createVersionedStore } from '../assets/runtime/platform/storage.js';

test('versioned saves checksum the persisted JSON representation', () => {
  const cases = [
    { score: 42, optional: undefined },
    { savedAt: new Date('2026-11-17T00:00:00Z') },
    { values: [NaN, Infinity, -Infinity, undefined, , 7] },
    { bytes: new Uint8Array([1, 2, 255]) },
    { toJSON(key) { return { key, score: 42 }; } },
    null,
  ];
  for (const value of cases) {
    const backing = createSaveStore({ gameId: 'json-roundtrip', storage: null });
    const writer = createVersionedStore({ store: backing, salt: 'roundtrip' });
    assert.equal(writer.save('progress', value), value);
    const reader = createVersionedStore({ store: backing, salt: 'roundtrip' });
    assert.equal(reader.verify('progress'), true);
    const result = reader.load('progress');
    assert.equal(result.ok, true);
    assert.equal(result.recovered, false);
    assert.deepEqual(result.value, JSON.parse(JSON.stringify({ data: value })).data);
  }
});

test('serialization failure preserves both the primary save and previous backup', () => {
  for (const checksum of [true, false]) {
    const backing = createSaveStore({ gameId: 'failed-save', storage: null });
    const store = createVersionedStore({ store: backing, checksum });
    store.save('progress', { score: 1 });
    store.save('progress', { score: 2 });
    const primary = backing.get('progress');
    const backup = backing.get('progress.bak');
    const cyclic = {};
    cyclic.self = cyclic;
    const invalid = [cyclic, { score: 1n }, undefined, () => 1,
      { toJSON() { throw new Error('serialization interrupted'); } }];
    for (const value of invalid) {
      assert.throws(() => store.save('progress', value));
      assert.deepEqual(backing.get('progress'), primary);
      assert.deepEqual(backing.get('progress.bak'), backup);
    }
    const corrupted = backing.get('progress');
    if (checksum) {
      corrupted.data.score = 999;
      backing.set('progress', corrupted);
      assert.deepEqual(store.load('progress').value, { score: 1 });
    }
  }
});

test('migrated JSON values remain verifiable on the next load', () => {
  const backing = createSaveStore({ gameId: 'migrated-json', storage: null });
  backing.set('progress', { score: 5 });
  const store = createVersionedStore({
    store: backing,
    schemaVersion: 2,
    migrations: { 1: old => ({ ...old, optional: undefined, savedAt: new Date('2026-11-17T00:00:00Z') }) },
  });
  assert.equal(store.load('progress').ok, true);
  assert.equal(store.verify('progress'), true);
  assert.deepEqual(store.load('progress').value, { score: 5, savedAt: '2026-11-17T00:00:00.000Z' });
});

test('serialization snapshots user data once without changing the caller value', () => {
  let calls = 0;
  const value = { toJSON(key) { return { key, revision: ++calls }; } };
  const store = createVersionedStore({ gameId: 'json-once', storage: null });
  assert.equal(store.save('progress', value), value);
  assert.equal(calls, 1);
  assert.equal(typeof value.toJSON, 'function');
  assert.deepEqual(store.load('progress').value, { key: 'data', revision: 1 });
  assert.equal(calls, 1);
});

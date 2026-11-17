import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore, createVersionedStore } from '../assets/runtime/platform/storage.js';

function storageFixture() {
  const values = new Map();
  const quotaError = new DOMException('Storage is full', 'QuotaExceededError');
  let full = false;
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (full) throw quotaError;
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
  return { storage, quotaError, fill() { full = true; }, free() { full = false; } };
}

test('readable full storage preserves existing saves and reports failed writes', () => {
  const fixture = storageFixture();
  const writer = createSaveStore({ gameId: 'full-storage', storage: fixture.storage });
  writer.set('progress/1', { score: 42 });
  fixture.fill();
  const reader = createSaveStore({ gameId: 'full-storage', storage: fixture.storage });
  assert.deepEqual(reader.get('progress/1'), { score: 42 });
  assert.deepEqual(reader.keys(), ['progress/1']);
  assert.throws(() => reader.set('progress/1', { score: 43 }), error => error === fixture.quotaError);
  assert.deepEqual(reader.get('progress/1'), { score: 42 });
  fixture.free();
  reader.set('progress/1', { score: 43 });
  assert.deepEqual(writer.get('progress/1'), { score: 43 });
});

test('storage availability checks do not modify an existing probe key', () => {
  const { storage } = storageFixture();
  storage.setItem('custom.__probe__', 'foreign data');
  createSaveStore({ gameId: 'probe-safe', storage, prefix: 'custom' });
  assert.equal(storage.getItem('custom.__probe__'), 'foreign data');
});

test('backup recovery returns valid data and reports a failed automatic writeback', () => {
  const fixture = storageFixture();
  const store = createVersionedStore({ gameId: 'backup-quota', storage: fixture.storage });
  store.save('progress', { score: 1 });
  store.save('progress', { score: 2 });
  const damaged = store.store.get('progress');
  damaged.data.score = 999;
  store.store.set('progress', damaged);
  const previousBackup = store.store.get('progress.bak');
  fixture.fill();
  let result;
  assert.doesNotThrow(() => { result = store.load('progress'); });
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.deepEqual(result.value, { score: 1 });
  assert.equal(result.writebackError, fixture.quotaError);
  assert.deepEqual(store.get('progress'), { score: 1 });
  assert.deepEqual(store.store.get('progress'), damaged);
  assert.deepEqual(store.store.get('progress.bak'), previousBackup);
  assert.throws(() => store.save('progress', { score: 3 }), error => error === fixture.quotaError);
  fixture.free();
  const retry = store.load('progress');
  assert.equal(retry.ok, true);
  assert.equal(Object.hasOwn(retry, 'writebackError'), false);
  assert.equal(store.verify('progress'), true);
  assert.equal(store.load('progress').recovered, false);
});

test('migration remains readable when automatic writeback fails and retries after capacity returns', () => {
  const fixture = storageFixture();
  const backing = createSaveStore({ gameId: 'migration-quota', storage: fixture.storage });
  backing.set('progress', { coins: 3 });
  const store = createVersionedStore({
    store: backing, schemaVersion: 2,
    migrations: { 1: old => ({ gold: old.coins * 10 }) },
  });
  fixture.fill();
  let result;
  assert.doesNotThrow(() => { result = store.load('progress'); });
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.deepEqual(result.value, { gold: 30 });
  assert.equal(result.writebackError, fixture.quotaError);
  assert.deepEqual(backing.get('progress'), { coins: 3 });
  fixture.free();
  assert.equal(Object.hasOwn(store.load('progress'), 'writebackError'), false);
  assert.equal(store.load('progress').migrated, false);
});

test('unreadable storage still falls back to memory and explicit memory stores remain isolated', () => {
  const denied = { ...storageFixture().storage,
    getItem() { throw new DOMException('Access denied', 'SecurityError'); },
    setItem() { throw new DOMException('Access denied', 'SecurityError'); },
  };
  for (const storage of [denied, null]) {
    const store = createSaveStore({ gameId: 'fallback', storage });
    store.set('progress', { score: 5 });
    assert.deepEqual(store.get('progress'), { score: 5 });
    assert.equal(createSaveStore({ gameId: 'fallback', storage }).get('progress'), undefined);
  }
});

test('disabled writeback and invalid migration output keep their existing behavior', () => {
  const fixture = storageFixture();
  const backing = createSaveStore({ gameId: 'migration-options', storage: fixture.storage });
  backing.set('progress', { score: 1 });
  const migrationError = new Error('bad migration');
  const throwing = createVersionedStore({ store: backing, schemaVersion: 2,
    migrations: { 1() { throw migrationError; } } });
  assert.throws(() => throwing.load('progress'), error => error === migrationError);
  const invalid = createVersionedStore({ store: backing, schemaVersion: 2,
    migrations: { 1: () => 1n } });
  assert.throws(() => invalid.load('progress'), TypeError);
  fixture.fill();
  const disabled = createVersionedStore({ store: backing, schemaVersion: 2,
    autoPersistMigrated: false, migrations: { 1: old => ({ ...old, migrated: true }) } });
  const result = disabled.load('progress');
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'writebackError'), false);
  assert.deepEqual(result.value, { score: 1, migrated: true });
  assert.deepEqual(backing.get('progress'), { score: 1 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore, createVersionedStore } from '../assets/runtime/platform/storage.js';
import { parsePlaytestActions, summarizeFrameDeltas } from '../scripts/playtest.mjs';

test('createVersionedStore migrates legacy & multi-step schemas, detects tampering, and recovers from backup', () => {
  const backing = createSaveStore({ gameId: 'rpg-quest', schemaVersion: 1 });

  // Simulate a legacy v1 unstructured save written directly into backing store
  backing.set('slot1', { hp: 80, coins: 25 });

  const v3Store = createVersionedStore({
    store: backing,
    schemaVersion: 3,
    salt: 'secret-pepper',
    migrations: {
      1: old => ({ ...old, maxHp: 100, inventory: [] }),
      2: v2 => ({ ...v2, gold: v2.coins * 10, versionTag: 'r3' }),
    },
  });

  const firstLoad = v3Store.load('slot1');
  assert.equal(firstLoad.ok, true);
  assert.equal(firstLoad.migrated, true);
  assert.equal(firstLoad.fromVersion, 1);
  assert.equal(firstLoad.version, 3);
  assert.equal(firstLoad.value.gold, 250);
  assert.equal(firstLoad.value.maxHp, 100);
  assert.equal(firstLoad.value.versionTag, 'r3');

  // Verify persistence works and creates backup on subsequent save
  v3Store.save('slot1', { hp: 95, maxHp: 120, coins: 40, gold: 400, inventory: ['sword'], versionTag: 'r3' });
  assert.equal(v3Store.verify('slot1'), true);

  // Tamper directly with primary key data without touching checksum or backup
  const corrupted = backing.get('slot1');
  corrupted.data.gold = 999999;
  backing.set('slot1', corrupted);

  assert.equal(v3Store.verify('slot1'), false);
  const recoveredLoad = v3Store.load('slot1', null);
  assert.equal(recoveredLoad.ok, true);
  assert.equal(recoveredLoad.recovered, true);
  assert.equal(recoveredLoad.value.gold, 250);

  // Future schema version fails safely with fallback
  const oldReader = createVersionedStore({ store: backing, schemaVersion: 1, salt: 'secret-pepper' });
  const futureRes = oldReader.load('slot1', { safe: true });
  assert.equal(futureRes.ok, false);
  assert.equal(futureRes.reason, 'future-version');
  assert.deepEqual(futureRes.value, { safe: true });
});

test('playtest script action parser & frame telemetry summarizer produce accurate metrics', () => {
  const actions = parsePlaytestActions('d:350, space:120, wait:200, click');
  assert.deepEqual(actions, [
    { type: 'key', key: 'd', ms: 350 },
    { type: 'key', key: ' ', ms: 120 },
    { type: 'wait', ms: 200 },
    { type: 'click', ms: 180 },
  ]);

  const stats = summarizeFrameDeltas([16.5, 16.7, 16.6, 55.0, 16.8, 16.6]);
  assert.equal(stats.frames, 6);
  assert.equal(stats.longFrames, 1);
  assert.ok(stats.fps > 40 && stats.fps < 60);
  assert.equal(stats.maxMs, 55);
  assert.equal(summarizeFrameDeltas([]).fps, 0);
});

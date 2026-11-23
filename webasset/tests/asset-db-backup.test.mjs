import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssetBackup, listBackups, pruneAssetBackups, restoreAssetBackup, verifyBackupSnapshot } from '../lib/asset-backup.mjs';
import { openAssetDb } from '../lib/asset-db.mjs';
import { createWebAssetServer } from '../server.mjs';
import { sampleGlb } from './fixtures/sample-glb.mjs';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl+6gAAAABJRU5ErkJggg==', 'base64');

test('SQLite art asset DB indexes, searches, verifies, backs up (deduplicated CAS), and restores cleanly', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-asset-db-backup-'));
  const webassetRoot = path.join(tmp, 'webasset');
  const backupDir = path.join(tmp, 'backups');
  const dbPath = path.join(webassetRoot, 'data', 'assets.db');

  try {
    await mkdir(path.join(webassetRoot, 'assets', 'characters', 'hero', 'images'), { recursive: true });
    await mkdir(path.join(webassetRoot, 'assets', 'characters', 'hero', 'models'), { recursive: true });
    await mkdir(path.join(webassetRoot, 'public', 'assets', 'pbr', 'stone'), { recursive: true });
    await mkdir(path.join(webassetRoot, 'hgame-assets-cn', 'built', 'models'), { recursive: true });

    const refPngPath = path.join(webassetRoot, 'assets', 'characters', 'hero', 'images', 'ref.png');
    const modelGlbPath = path.join(webassetRoot, 'assets', 'characters', 'hero', 'models', 'high-test.glb');
    const pbrPngPath = path.join(webassetRoot, 'public', 'assets', 'pbr', 'stone', 'albedo.png');
    const cnGlbPath = path.join(webassetRoot, 'hgame-assets-cn', 'built', 'models', 'bench.glb');

    const glb = sampleGlb();
    await writeFile(refPngPath, tinyPng);
    await writeFile(modelGlbPath, glb);
    await writeFile(pbrPngPath, tinyPng);
    await writeFile(cnGlbPath, glb);

    const db = openAssetDb(dbPath);
    try {
      const imported = db.importCharacterCatalogIfEmpty({
        schemaVersion: 3,
        characters: [{
          id: 'hero',
          name: 'Hero',
          props: ['剑'],
          personality: ['勇敢'],
          assets: [{ name: 'ref.png', path: 'characters/hero/images/ref.png', kind: 'reference' }],
          generatedAssets: [],
          models: {
            high: { name: 'high.glb', path: 'characters/hero/models/high-test.glb', bytes: glb.length, updatedAt: new Date().toISOString() },
          },
        }],
      }, path.join(webassetRoot, 'assets'));
      assert.equal(imported, 1);

      const sync1 = await db.syncArtCatalog({ webassetRoot });
      assert.equal(sync1.totalScanned, 4);
      assert.equal(sync1.added, 4);
      assert.equal(sync1.unchanged, 0);

      const sync2 = await db.syncArtCatalog({ webassetRoot });
      assert.equal(sync2.unchanged, 4);
      assert.equal(sync2.added, 0);

      const searchGlb = db.searchArtAssets({ ext: 'glb' });
      assert.equal(searchGlb.total, 2);
      const searchChar = db.searchArtAssets({ domain: 'character', query: 'hero' });
      assert.equal(searchChar.total, 2);

      const verifyOk = await db.verifyArtCatalog({ webassetRoot, deep: true });
      assert.equal(verifyOk.ok, true);
      assert.equal(verifyOk.checked, 4);

      const snap1 = await createAssetBackup({
        webassetRoot,
        assetDb: db,
        backupDir,
        notes: 'initial-snapshot',
      });
      assert.equal(snap1.ok, true);
      assert.equal(snap1.verified, true);
      assert.equal(snap1.filesTotal, 4);
      // tinyPng and glb each have identical content across two paths -> 2 unique CAS blobs!
      assert.equal(snap1.filesCopied, 2);
      assert.equal(snap1.filesReused, 2);

      // Second backup reuses all existing CAS blobs.
      await new Promise(resolve => setTimeout(resolve, 10));
      const snap2 = await createAssetBackup({
        webassetRoot,
        assetDb: db,
        backupDir,
        notes: 'incremental-snapshot',
      });
      assert.equal(snap2.filesCopied, 0);
      assert.equal(snap2.filesReused, 4);

      const listed = await listBackups({ backupDir });
      assert.equal(listed.snapshots.length, 2);
      assert.equal(listed.latest.snapshotName, snap2.snapshotName);

      const deepVerify = await verifyBackupSnapshot({ backupDir, deep: true });
      assert.equal(deepVerify.ok, true);
      assert.equal(deepVerify.sqliteIntegrity, 'ok');
      assert.equal(deepVerify.checkedBlobs, 4);

      // Prune dry-run and apply keeping only latest 1 snapshot.
      const dryPrune = await pruneAssetBackups({ backupDir, keep: 1, dryRun: true });
      assert.equal(dryPrune.removedSnapshots.length, 1);
      const realPrune = await pruneAssetBackups({ backupDir, keep: 1, dryRun: false });
      assert.equal(realPrune.keptSnapshots, 1);
      assert.equal((await listBackups({ backupDir })).snapshots.length, 1);
    } finally {
      db.close();
    }

    // Wipe local webasset assets + DB completely and restore from backup!
    await rm(path.join(webassetRoot, 'assets'), { recursive: true, force: true });
    await rm(path.join(webassetRoot, 'public'), { recursive: true, force: true });
    await rm(path.join(webassetRoot, 'hgame-assets-cn'), { recursive: true, force: true });
    await rm(path.join(webassetRoot, 'data'), { recursive: true, force: true });
    assert.equal(existsSync(dbPath), false);
    assert.equal(existsSync(refPngPath), false);

    const restored = await restoreAssetBackup({
      backupDir,
      webassetRoot,
      dbPath,
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.restored, 4);
    assert.equal(existsSync(dbPath), true);
    assert.deepEqual(await readFile(refPngPath), tinyPng);
    assert.deepEqual(await readFile(modelGlbPath), glb);
    assert.deepEqual(await readFile(pbrPngPath), tinyPng);
    assert.deepEqual(await readFile(cnGlbPath), glb);

    const restoredDb = openAssetDb(dbPath);
    try {
      assert.equal(restoredDb.countCharacters(), 1);
      assert.equal(restoredDb.getCharacter('hero')?.name, 'Hero');
      assert.equal((await restoredDb.verifyArtCatalog({ webassetRoot, deep: true })).ok, true);
    } finally {
      restoredDb.close();
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('WebAsset server exposes SQLite DB summary, search, sync, and backup endpoints', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-webasset-db-api-'));
  const siteRoot = path.join(tmp, 'webasset');
  const backupDir = path.join(tmp, 'backups');
  const assetsRoot = path.join(siteRoot, 'assets');
  const catalogPath = path.join(assetsRoot, 'characters', 'index.json');

  try {
    await mkdir(path.join(assetsRoot, 'characters', 'demo', 'images'), { recursive: true });
    await mkdir(path.join(siteRoot, 'public'), { recursive: true });
    await writeFile(path.join(siteRoot, 'public', 'index.html'), '<!doctype html><title>test</title>');
    await writeFile(path.join(assetsRoot, 'characters', 'demo', 'images', 'ref.png'), tinyPng);
    await writeFile(catalogPath, JSON.stringify({
      schemaVersion: 3,
      characters: [{
        id: 'demo',
        name: 'Demo',
        assets: [{ name: 'ref.png', path: 'characters/demo/images/ref.png', kind: 'reference' }],
        generatedAssets: [],
      }],
    }));

    const server = createWebAssetServer({
      siteRoot,
      imageRoot: assetsRoot,
      characterCatalog: catalogPath,
      gamesRoot: path.join(tmp, 'games'),
      htmlGamesRoot: path.join(tmp, 'html-games'),
      dbPath: path.join(siteRoot, 'data', 'assets.db'),
      backupDir,
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const summary = await (await fetch(`${base}/api/assets/db/summary`)).json();
      assert.equal(summary.characters, 1);

      const syncRes = await (await fetch(`${base}/api/assets/db/sync`, { method: 'POST' })).json();
      assert.equal(syncRes.ok, true);
      assert.equal(syncRes.added, 2); // ref.png + index.json

      const searchRes = await (await fetch(`${base}/api/assets/db/search?domain=character&ext=png`)).json();
      assert.equal(searchRes.total, 1);

      const backupRes = await fetch(`${base}/api/assets/db/backup?notes=api-test`, { method: 'POST' });
      assert.equal(backupRes.status, 201);
      const backupJson = await backupRes.json();
      assert.equal(backupJson.ok, true);
      assert.equal(backupJson.verified, true);

      const backupsList = await (await fetch(`${base}/api/assets/db/backups`)).json();
      assert.equal(backupsList.snapshots.length, 1);
      assert.equal(backupsList.dbSnapshots.length, 1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  casObjectPath,
  inspectAssetStatus,
  pruneAssetStore,
  pullAssets,
  pushAssets,
  readAssetManifest,
  removeManifestAssets,
} from '../scripts/assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const packageGame = path.join(root, 'scripts', 'package-game.mjs');

test('pushAssets deduplicates CAS objects, skips vendor/raw, and keeps timestamps stable across no-op pushes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-asset-push-'));
  const storeDir = path.join(tmp, 'store');
  const gameA = path.join(tmp, 'game-a');
  const gameB = path.join(tmp, 'game-b');
  try {
    await mkdir(path.join(gameA, 'assets', 'actors'), { recursive: true });
    await mkdir(path.join(gameA, 'assets', 'raw'), { recursive: true });
    await mkdir(path.join(gameA, 'assets', 'vendor', 'three'), { recursive: true });
    await mkdir(path.join(gameB, 'assets', 'actors'), { recursive: true });

    const heroBytes = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
    await writeFile(path.join(gameA, 'assets', 'actors', 'hero.png'), heroBytes);
    await writeFile(path.join(gameA, 'assets', 'raw', 'hero.psd'), 'psd-source');
    await writeFile(path.join(gameA, 'assets', 'vendor', 'three', 'three.module.js'), 'export {};');
    await writeFile(path.join(gameB, 'assets', 'actors', 'hero_copy.png'), heroBytes);

    const first = await pushAssets(gameA, { storeDir });
    assert.equal(first.totalAssets, 1);
    assert.equal(first.uploadedObjects, 1);
    assert.equal(first.updatedEntries, 1);

    const manifestA = await readAssetManifest(gameA);
    assert.equal(Object.keys(manifestA.assets).length, 1);
    assert.equal(manifestA.assets['actors/hero.png'].kind, 'image');
    const ts1 = manifestA.assets['actors/hero.png'].updatedAt;

    // Re-pushing identical assets causes zero object writes or updatedAt churn
    const second = await pushAssets(gameA, { storeDir });
    assert.equal(second.uploadedObjects, 0);
    assert.equal(second.reusedObjects, 1);
    assert.equal(second.updatedEntries, 0);
    assert.equal((await readAssetManifest(gameA)).assets['actors/hero.png'].updatedAt, ts1);

    // Second project with identical bytes reuses existing CAS blob
    const pushB = await pushAssets(gameB, { storeDir });
    assert.equal(pushB.uploadedObjects, 0);
    assert.equal(pushB.reusedObjects, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('pullAssets, inspectAssetStatus, removeManifestAssets and pruneAssetStore round-trip cleanly', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-asset-pull-'));
  const storeDir = path.join(tmp, 'store');
  const game = path.join(tmp, 'game');
  try {
    await mkdir(path.join(game, 'assets', 'audio'), { recursive: true });
    await mkdir(path.join(game, 'assets', 'models'), { recursive: true });
    const sfx = Buffer.from('ID3-mock-mp3-data');
    const glb = Buffer.from('glTF-mock-binary-data');
    await writeFile(path.join(game, 'assets', 'audio', 'hit.mp3'), sfx);
    await writeFile(path.join(game, 'assets', 'models', 'knight.glb'), glb);

    await pushAssets(game, { storeDir });
    let status = await inspectAssetStatus(game, { storeDir });
    assert.equal(status.ok, true);
    assert.deepEqual(status.inSync, ['audio/hit.mp3', 'models/knight.glb']);

    // Delete local audio, corrupt local glb, add untracked image
    await unlink(path.join(game, 'assets', 'audio', 'hit.mp3'));
    await writeFile(path.join(game, 'assets', 'models', 'knight.glb'), 'corrupted');
    await writeFile(path.join(game, 'assets', 'extra.png'), Buffer.from([1, 2, 3]));

    status = await inspectAssetStatus(game, { storeDir });
    assert.equal(status.ok, false);
    assert.deepEqual(status.missingLocal, ['audio/hit.mp3']);
    assert.deepEqual(status.modified, ['models/knight.glb']);
    assert.deepEqual(status.untracked, ['extra.png']);

    // Pull restores missing + modified files from CAS store
    const pulled = await pullAssets(game, { storeDir });
    assert.equal(pulled.ok, true);
    assert.equal(pulled.pulled, 2);
    assert.deepEqual(await readFile(path.join(game, 'assets', 'audio', 'hit.mp3')), sfx);
    assert.deepEqual(await readFile(path.join(game, 'assets', 'models', 'knight.glb')), glb);

    // Second pull skips already matching files
    const noopPull = await pullAssets(game, { storeDir });
    assert.equal(noopPull.pulled, 0);
    assert.equal(noopPull.skipped, 2);

    // Remove audio entry and prune orphaned CAS blob
    const removed = await removeManifestAssets(game, ['audio/hit.mp3'], { deleteLocal: true });
    assert.deepEqual(removed.removed, ['audio/hit.mp3']);
    const dryPrune = await pruneAssetStore(storeDir, [game], { dryRun: true });
    assert.equal(dryPrune.prunedCount, 1);
    const livePrune = await pruneAssetStore(storeDir, [game], { dryRun: false });
    assert.equal(livePrune.prunedCount, 1);
    assert.equal((await pruneAssetStore(storeDir, [game], { dryRun: true })).prunedCount, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('pullAssets fetches missing blobs from HTTP remote and verifies integrity', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-asset-remote-'));
  const remoteStore = path.join(tmp, 'remote-store');
  const clientStore = path.join(tmp, 'client-store');
  const srcGame = path.join(tmp, 'src-game');
  const dstGame = path.join(tmp, 'dst-game');

  const payload = Buffer.from('HVAT-mock-binary-crowd-animation');
  let server = null;
  try {
    await mkdir(path.join(srcGame, 'assets', 'vat'), { recursive: true });
    await writeFile(path.join(srcGame, 'assets', 'vat', 'orc.vat.bin'), payload);
    await pushAssets(srcGame, { storeDir: remoteStore });
    const manifest = await readAssetManifest(srcGame);
    assert.equal(manifest.assets['vat/orc.vat.bin'].kind, 'vat');

    await mkdir(dstGame, { recursive: true });
    await writeFile(
      path.join(dstGame, 'assets.manifest.json'),
      await readFile(path.join(srcGame, 'assets.manifest.json')),
    );

    let corruptMode = false;
    server = createServer(async (req, res) => {
      const m = /^\/objects\/([a-f0-9]{2})\/([a-f0-9]{64})$/.exec(req.url || '');
      if (!m) { res.writeHead(404).end(); return; }
      const p = casObjectPath(remoteStore, m[2]);
      const data = await readFile(p);
      res.writeHead(200);
      res.end(corruptMode ? Buffer.from('tampered') : data);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const remoteUrl = `http://127.0.0.1:${port}`;

    corruptMode = true;
    await assert.rejects(
      () => pullAssets(dstGame, { storeDir: clientStore, remote: remoteUrl }),
      /Integrity mismatch/,
    );

    corruptMode = false;
    const okPull = await pullAssets(dstGame, { storeDir: clientStore, remote: remoteUrl });
    assert.equal(okPull.ok, true);
    assert.equal(okPull.fetchedRemote, 1);
    assert.equal(okPull.pulled, 1);
    assert.deepEqual(await readFile(path.join(dstGame, 'assets', 'vat', 'orc.vat.bin')), payload);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
});

test('create-game scaffolds .gitignore and assets.manifest.json; git ignores art binaries while package-game resolves from store', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-asset-e2e-'));
  const storeDir = path.join(tmp, 'shared-store');
  const game = path.join(tmp, 'knight');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--profile', '2d', '--with', 'audio'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    // Add large/binary art & audio files and raw PSD inside assets/
    await mkdir(path.join(game, 'assets', 'actors'), { recursive: true });
    await mkdir(path.join(game, 'assets', 'audio'), { recursive: true });
    await mkdir(path.join(game, 'assets', 'raw'), { recursive: true });
    const spritePng = Buffer.from([137, 80, 78, 71, 9, 8, 7, 6]);
    const bgmMp3 = Buffer.from('MP3-mock-bgm');
    await writeFile(path.join(game, 'assets', 'actors', 'hero.png'), spritePng);
    await writeFile(path.join(game, 'assets', 'audio', 'bgm.mp3'), bgmMp3);
    await writeFile(path.join(game, 'assets', 'raw', 'hero.psd'), 'psd-raw');

    // Sync runtime art into unified store & update assets.manifest.json
    const pushed = await pushAssets(game, { storeDir });
    assert.equal(pushed.totalAssets, 2);

    // Verify git status tracks code + configs + assets.manifest.json and IGNORES binary art/audio/PSD
    const st = spawnSync('git', ['status', '--short', '--untracked-files=all'], { cwd: game, encoding: 'utf8' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /assets\.manifest\.json/);
    assert.match(st.stdout, /\.gitignore/);
    assert.doesNotMatch(st.stdout, /hero\.png/);
    assert.doesNotMatch(st.stdout, /bgm\.mp3/);
    assert.doesNotMatch(st.stdout, /hero\.psd/);

    // Simulate clean Git checkout: delete binary art files locally, keeping only assets.manifest.json
    await unlink(path.join(game, 'assets', 'actors', 'hero.png'));
    await unlink(path.join(game, 'assets', 'audio', 'bgm.mp3'));

    // Packaging resolves missing manifest assets directly from shared store
    const pack = spawnSync(
      process.execPath,
      [packageGame, game, '--version', '1.2', '--asset-store', storeDir],
      { encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const summary = JSON.parse(pack.stdout);
    assert.equal(summary.resolvedFromStore, 2);
    const outDir = path.join(game, 'build', 'knight_1_2');
    assert.deepEqual(await readFile(path.join(outDir, 'assets', 'actors', 'hero.png')), spritePng);
    assert.deepEqual(await readFile(path.join(outDir, 'assets', 'audio', 'bgm.mp3')), bgmMp3);

    // Packaging fails clearly when store does not have the declared asset either
    const failPack = spawnSync(
      process.execPath,
      [packageGame, game, '--version', '1.3', '--asset-store', path.join(tmp, 'empty-store')],
      { encoding: 'utf8' },
    );
    assert.notEqual(failPack.status, 0);
    assert.match(failPack.stderr, /assets\.manifest\.json/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

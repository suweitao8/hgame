import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  BILIBILI_TOY_RATE_LIMIT_CODE,
  createToyBridge,
  createToyCloudSaveAdapter,
  isBilibiliToyEnvironment,
  isToyRateLimitError,
} from '../assets/runtime/integrations/bilibili-toy.js';
import { packageGameRelease } from '../scripts/package-game.mjs';
import { parseZipEntries, runToyPreflight } from '../scripts/toy-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(root, 'scripts', 'create-game.mjs');

function makePngHeader(width, height) {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('createToyBridge handles local fallback, validation, 307044 backoff, and checkpoint cloud saves', async () => {
  assert.equal(isBilibiliToyEnvironment(), false);
  assert.equal(isToyRateLimitError({ type: 'http_error', code: BILIBILI_TOY_RATE_LIMIT_CODE }), true);
  assert.equal(isToyRateLimitError({ type: 'http_error', code: 307000 }), false);

  // 1. Offline/local preview fallback
  const localBridge = createToyBridge({ fallbackStorage: null, gameId: 'toy-test' });
  assert.equal(localBridge.isAvailable, false);
  assert.equal(await localBridge.isSupport('share'), false);
  await localBridge.setCloudStorage({ coins: '42', stage: '3' });
  assert.deepEqual(await localBridge.getCloudStorage(['coins']), { coins: '42' });
  await localBridge.removeCloudStorage(['stage']);
  assert.deepEqual(await localBridge.getCloudStorage(), { coins: '42' });
  assert.deepEqual(await localBridge.submitScore({ score: 0 }), { score: 0 });
  assert.deepEqual(await localBridge.getMyRank(), { ranked: true, rank: 1, score: 0 });

  // 2. Mocked window.toy with 307044 rate limit retry & batching
  let cloudWrites = 0;
  let attempts = 0;
  const store = new Map();
  const mockSdk = {
    async isSupport(name) { return name === 'checkInputSafety'; },
    async getCloudStorage(keys) {
      if (!keys?.length) return Object.fromEntries(store.entries());
      const out = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async setCloudStorage(items) {
      attempts++;
      if (attempts === 1) {
        throw { type: 'http_error', code: 307044, message: 'rate limited' };
      }
      cloudWrites++;
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    async removeCloudStorage(keys) {
      for (const k of keys) store.delete(k);
    },
    async checkInputSafety({ text }) {
      return text === 'bad'
        ? { status: 'unavailable', passed: true } // unavailable must NOT pass even if passed were true
        : { status: 'ok', passed: true };
    },
    async getChargeUnlock({ minPrice }) {
      return { status: 'ok', data: { unlocked: minPrice <= 1200 } };
    },
  };

  const bridge = createToyBridge({
    sdk: mockSdk,
    baseDelayMs: 5,
    maxRetries: 2,
    random: () => 0.5,
  });

  await assert.rejects(() => bridge.setCloudStorage({ __reserved: '1' }), /Invalid Toy cloud storage key/);
  await assert.rejects(() => bridge.setCloudStorage({ big: 'a'.repeat(1025) }), /1024 UTF-8 bytes/);
  await assert.rejects(() => bridge.submitScore({ board: 6, score: 10 }), /1\.\.5/);
  await assert.rejects(() => bridge.submitScore({ score: 16777216 }), /16777215/);

  const adapter = createToyCloudSaveAdapter({ bridge, bindPageHide: false });
  adapter.set('hp', 100);
  adapter.set('lv', 5);
  assert.equal(cloudWrites, 0);
  assert.equal(adapter.dirtyCount, 2);
  await adapter.flush();
  assert.equal(cloudWrites, 1); // Single batched write after 307044 backoff retry
  assert.equal(adapter.dirtyCount, 0);
  assert.deepEqual(await bridge.getCloudStorage(), { hp: '100', lv: '5' });

  const safetyBad = await bridge.checkInputSafety({ text: 'bad', scene: 'nick_1' });
  assert.equal(safetyBad.passed, false);
  const safetyOk = await bridge.checkInputSafety({ text: 'hello', scene: 'nick_1' });
  assert.equal(safetyOk.passed, true);

  const charge = await bridge.getChargeUnlock({ minPrice: 1200 });
  assert.equal(charge.data.unlocked, true);
});

test('package-game --target toy produces flat content-hashed zip, injects toy-sdk.js, and passes preflight', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-pkg-'));
  const game = path.join(tmp, 'toy-sample');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--renderer', 'canvas2d', '--name', '测试Toy', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    // Reference bilibili-toy.js in src/main.js so auto-injection triggers
    const mainPath = path.join(game, 'src', 'main.js');
    const origMain = await readFile(mainPath, 'utf8');
    await writeFile(
      mainPath,
      `import { createToyBridge } from '../vendor/hgame/integrations/bilibili-toy.js';\n${origMain}\nconst __toy = createToyBridge();\n`,
    );

    // Leave legacy toy.yaml in source tree to verify it gets excluded cleanly
    await writeFile(path.join(game, 'toy.yaml'), 'id: 123\nslug: old\n');

    const posterPath = path.join(tmp, 'cover.png');
    const iconPath = path.join(tmp, 'icon.png');
    await writeFile(posterPath, makePngHeader(1200, 900));
    await writeFile(iconPath, makePngHeader(256, 256));

    const summary = await packageGameRelease({
      projectDir: game,
      version: '1.0',
      target: 'toy',
      slug: 'my-test-toy',
      poster: posterPath,
      icon: iconPath,
    });

    assert.equal(summary.target, 'toy');
    assert.equal(summary.toySdkInjected, true);
    assert.equal(summary.toyPreflight.ok, true);
    assert.equal(summary.toyPreflight.errorCount, 0);
    assert.equal(
      summary.toyPreflight.findings.some(f => f.rule === 'missing-contenthash'),
      false,
      'Toy package must satisfy contenthash rule',
    );

    const zipEntries = parseZipEntries(await readFile(summary.zipPath));
    assert.equal(zipEntries.has('index.html'), true, 'ZIP must have flat root index.html');
    assert.equal(zipEntries.has('toy.yaml'), false, 'toy.yaml must be excluded');
    const html = zipEntries.get('index.html').toString('utf8');
    assert.match(html, /\/\/s1\.hdslb\.com\/bfs\/seed\/toy\/app\/sdk\/toy-sdk\.js/);
    assert.match(html, /href="\.\/style-[a-f0-9]{8}\.css"/);
    assert.match(html, /src="\.\/src\/main-[a-f0-9]{8}\.js"/);

    // Verify preflight directly on the generated ZIP
    const zipReport = await runToyPreflight({
      targetPath: summary.zipPath,
      slug: 'my-test-toy',
      poster: posterPath,
      icon: iconPath,
      requireRootIndex: true,
    });
    assert.equal(zipReport.ok, true);
    assert.equal(zipReport.errorCount, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('toy-preflight distinguishes external URLs from shader separators', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-shader-'));
  try {
    await writeFile(path.join(dir, 'index.html'), '<script type="module" src="./app.js"></script>');
    await writeFile(path.join(dir, 'app.js'), 'export const shader = "//----";\nfetch("https://api.example.com/data");\n');
    const report = await runToyPreflight({ targetPath: dir });
    assert.deepEqual(report.externalDomains, ['api.example.com']);
    assert.equal(report.requiredCapabilities.includes('EXTERNAL_SERVICE_ACCESS'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('toy-preflight blocks >1MB index.html, root-relative paths, >=10000px images, oversized icons, and flags capabilities', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-bad-'));
  try {
    const dir = path.join(tmp, 'bad-pkg');
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'assets', 'huge.png'), makePngHeader(10000, 64));
    await writeFile(path.join(dir, 'assets', 'bgm.mp3'), Buffer.from('ID3'));
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html><html><head><title>Bad</title><link rel="stylesheet" href="/assets/app.css"></head>` +
      `<body><img src="./assets/missing.png"><script>setInterval(() => window.toy.setCloudStorage({ a: '1' }), 1000);</script>` +
      `<!-- ${'x'.repeat(1050000)} --></body></html>`,
    );

    const badIcon = path.join(tmp, 'big-icon.png');
    await writeFile(badIcon, makePngHeader(1025, 512));

    const report = await runToyPreflight({
      targetPath: dir,
      slug: 'bad slug!',
      icon: badIcon,
      requireRootIndex: true,
    });

    assert.equal(report.ok, false);
    const rules = new Set(report.findings.map(f => f.rule));
    assert.equal(rules.has('invalid-slug'), true);
    assert.equal(rules.has('icon-edge-limit'), true);
    assert.equal(rules.has('entry-index-over-1mb'), true);
    assert.equal(rules.has('root-relative-path'), true);
    assert.equal(rules.has('missing-local-ref'), true);
    assert.equal(rules.has('image-edge-limit'), true);
    assert.equal(rules.has('rate-limit-poll'), true);
    assert.equal(rules.has('missing-307044-handling'), true);
    assert.equal(report.requiredCapabilities.includes('AUDIO_VIDEO_UPLOAD'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

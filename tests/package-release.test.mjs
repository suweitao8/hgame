import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const packageGame = path.join(root, 'scripts', 'package-game.mjs');
const previewScript = path.join(root, 'scripts', 'preview.mjs');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function readZipEntries(zipBuffer) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65558); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End of Central Directory signature not found');
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let ptr = centralOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    assert.equal(zipBuffer.readUInt32LE(ptr), 0x02014b50, 'Central directory signature');
    const method = zipBuffer.readUInt16LE(ptr + 10);
    const compSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompSize = zipBuffer.readUInt32LE(ptr + 24);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localOffset = zipBuffer.readUInt32LE(ptr + 42);
    const name = zipBuffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    assert.equal(zipBuffer.readUInt32LE(localOffset), 0x04034b50, 'Local header signature');
    const lNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const lExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = zipBuffer.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    assert.equal(data.length, uncompSize, `ZIP entry byte length matches for ${name}`);
    entries.set(name, data);
  }
  return entries;
}

test('package-game outputs lean build/lol_1_1 + .zip excluding tests/scripts/git/raw art/unused 3D/WASM and boots over preview', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-2d-'));
  const game = path.join(tmp, 'lol');
  let child = null;
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--name', '英雄试炼', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    // Simulate dev/authoring clutter inside the project that must NOT enter the release archive
    await mkdir(path.join(game, '.git'), { recursive: true });
    await writeFile(path.join(game, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await mkdir(path.join(game, 'assets', 'raw'), { recursive: true });
    await writeFile(path.join(game, 'assets', 'raw', 'hero.psd'), 'raw-authoring-psd');
    await mkdir(path.join(game, 'assets', 'sprites'), { recursive: true });
    await writeFile(path.join(game, 'assets', 'sprites', 'hero.png'), Buffer.from([137, 80, 78, 71]));

    const pack = spawnSync(
      process.execPath,
      [packageGame, game, '--version', '1.1'],
      { encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const summary = JSON.parse(pack.stdout);
    assert.equal(summary.releaseTag, 'lol_1_1');
    assert.equal(summary.wasm, null);

    const outDir = path.join(game, 'build', 'lol_1_1');
    const zipFile = path.join(game, 'build', 'lol_1_1.zip');
    assert.equal(await exists(outDir), true);
    assert.equal(await exists(zipFile), true);

    const releaseCfg = JSON.parse(await readFile(path.join(outDir, 'game.config.json'), 'utf8'));
    assert.equal(releaseCfg.version, '1.1');

    // Present runtime files & runtime media
    for (const rel of [
      'index.html',
      'style.css',
      'src/main.js',
      'assets/sprites/hero.png',
      'vendor/hgame/index.js',
      'vendor/hgame/integrations/canvas2d.js',
    ]) {
      assert.equal(await exists(path.join(outDir, rel)), true, `Expected ${rel} in release output`);
    }

    // Pruned redundant / dev / unused 3D / WASM files
    for (const forbiddenRel of [
      '.git',
      'tests',
      'scripts',
      'AGENTS.md',
      'package.json',
      'README.md',
      'assets/raw',
      'assets/vendor/three',
      'vendor/hgame/vendor/rapier2d/rapier2d.wasm',
      'vendor/hgame/vendor/rapier3d/rapier3d.wasm',
      'vendor/hgame/integrations/three.js',
      'vendor/hgame/integrations/post3d.js',
      'vendor/hgame/integrations/lighting3d.js',
    ]) {
      assert.equal(await exists(path.join(outDir, forbiddenRel)), false, `Expected ${forbiddenRel} to be excluded`);
    }

    // Verify ZIP entries inflate cleanly with lol_1_1/ prefix and exact byte parity
    const zipEntries = readZipEntries(await readFile(zipFile));
    assert.equal(zipEntries.has('lol_1_1/index.html'), true);
    assert.equal(zipEntries.has('lol_1_1/src/main.js'), true);
    assert.equal(zipEntries.has('lol_1_1/vendor/hgame/integrations/canvas2d.js'), true);
    assert.deepEqual(
      zipEntries.get('lol_1_1/assets/sprites/hero.png'),
      await readFile(path.join(outDir, 'assets', 'sprites', 'hero.png')),
    );
    assert.deepEqual(
      zipEntries.get('lol_1_1/vendor/hgame/index.js'),
      await readFile(path.join(outDir, 'vendor', 'hgame', 'index.js')),
    );

    // Packaged build directory itself must serve over HTTP cleanly
    const port = await freePort();
    child = spawn(process.execPath, [previewScript, outDir, '--port', String(port)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 80; i++) {
      try {
        const res = await fetch(baseUrl + '/');
        if (res.status === 200) { up = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(up, true, 'Preview server started on packaged build/lol_1_1');
    for (const route of ['/', '/src/main.js', '/vendor/hgame/index.js', '/vendor/hgame/integrations/canvas2d.js']) {
      const res = await fetch(baseUrl + route);
      assert.equal(res.status, 200, route);
    }
  } finally {
    if (child && !child.killed) child.kill();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package-game auto-provisions verified Rapier2D WASM when enabled post-creation and excludes Rapier3D', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-wasm-'));
  const game = path.join(tmp, 'arena');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    // Project was created without physics; enable deterministic rapier2d afterward
    const engineCfg = JSON.parse(await readFile(path.join(game, 'engine.config.json'), 'utf8'));
    engineCfg.physics = 'rapier2d';
    engineCfg.features = [...new Set([...engineCfg.features, 'physics2d'])];
    await writeFile(path.join(game, 'engine.config.json'), JSON.stringify(engineCfg, null, 2) + '\n');

    const pack = spawnSync(
      process.execPath,
      [packageGame, game, '--version', '1.2.0'],
      { encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const summary = JSON.parse(pack.stdout);
    assert.equal(summary.releaseTag, 'arena_1_2');
    assert.equal(summary.wasm, 'vendor/hgame/vendor/rapier2d/rapier2d.wasm');

    const outDir = path.join(game, 'build', 'arena_1_2');
    const wasmBytes = await readFile(path.join(outDir, 'vendor', 'hgame', 'vendor', 'rapier2d', 'rapier2d.wasm'));
    assert.deepEqual(wasmBytes.subarray(0, 4), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vendor', 'LICENSE-rapier.txt')), true);
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'physics', 'rapier2d.js')), true);

    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vendor', 'rapier3d')), false);
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'physics', 'rapier3d.js')), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('standalone 3D project release traces Three.js transitive modules while pruning unused Three helpers, 2D modules, and WASM', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-3d-'));
  const game = path.join(tmp, 'quest');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--profile', '3d', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    // Add an unreferenced helper under assets/vendor/three to prove selective Three tracing
    await writeFile(
      path.join(game, 'assets', 'vendor', 'three', 'jsm', 'utils', 'UnusedHelper.js'),
      'export const unusedHelper = 42;\n',
    );

    // Run using the copied standalone scripts/package-game.mjs from inside game directory
    const pack = spawnSync(
      process.execPath,
      ['scripts/package-game.mjs', '--version', '1.0.3'],
      { cwd: game, encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const summary = JSON.parse(pack.stdout);
    assert.equal(summary.releaseTag, 'quest_1_0_3');

    const outDir = path.join(game, 'build', 'quest_1_0_3');
    assert.equal(await exists(path.join(game, 'build', 'quest_1_0_3.zip')), true);

    for (const requiredRel of [
      'assets/vendor/three/three.module.js',
      'assets/vendor/three/three.core.js',
      'assets/vendor/three/jsm/loaders/GLTFLoader.js',
      'assets/vendor/three/jsm/utils/BufferGeometryUtils.js',
      'assets/vendor/three/jsm/utils/SkeletonUtils.js',
      'assets/vendor/three/LICENSE',
      'vendor/hgame/integrations/three.js',
      'vendor/hgame/integrations/world-aligned-material.js',
      'vendor/hgame/integrations/procedural-models.js',
      'vendor/hgame/integrations/modular-level.js',
    ]) {
      assert.equal(await exists(path.join(outDir, requiredRel)), true, `Expected ${requiredRel} in 3D release`);
    }

    for (const prunedRel of [
      'assets/vendor/three/jsm/utils/UnusedHelper.js',
      'vendor/hgame/integrations/canvas2d.js',
      'vendor/hgame/integrations/lighting3d.js',
      'vendor/hgame/integrations/sky3d.js',
      'vendor/hgame/vendor/rapier2d/rapier2d.wasm',
      'vendor/hgame/vendor/rapier3d/rapier3d.wasm',
    ]) {
      assert.equal(await exists(path.join(outDir, prunedRel)), false, `Expected ${prunedRel} to be pruned`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('3D release minifies the Three.js runtime and preserves its exports, license, and source fallback', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-three-minify-'));
  const game = path.join(tmp, 'arena');
  const threeDir = path.join('assets', 'vendor', 'three');
  try {
    const generated = spawnSync(process.execPath, [createGame, game, '--profile', '3d', '--bare', '--no-git'],
      { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    function build(tag, options = []) {
      const result = spawnSync(process.execPath, [packageGame, game, '--version', '1.0', '--tag', tag, ...options],
        { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    }

    const compact = build('compact');
    const raw = build('raw', ['--no-minify']);
    assert.equal(compact.minified, true);
    assert.equal(raw.minified, false);

    for (const file of ['three.module.js', 'three.core.js', 'LICENSE']) {
      const source = await readFile(path.join(game, threeDir, file));
      const original = await readFile(path.join(raw.outputDir, threeDir, file));
      const minified = await readFile(path.join(compact.outputDir, threeDir, file));
      assert.deepEqual(original, source, `${file} is preserved with --no-minify`);
      if (file === 'LICENSE') {
        assert.deepEqual(minified, source, 'the MIT notice is included verbatim');
      } else {
        assert.ok(minified.length < source.length * 0.8, `${file} must shrink in the standard release`);
      }
    }

    const [original, minified] = await Promise.all([raw, compact].map(({ outputDir }) =>
      import(pathToFileURL(path.join(outputDir, threeDir, 'three.module.js')).href)));
    assert.deepEqual(Object.keys(minified), Object.keys(original));
    assert.equal(minified.REVISION, original.REVISION);
    assert.equal(minified.WebGLRenderer.name, original.WebGLRenderer.name);
    assert.equal(minified.Vector3.name, original.Vector3.name);
    assert.equal(new minified.Vector3(3, 4, 0).length(), 5);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package-game --engine outputs complete SDK build with workspace skill, user guide, verified WASM, and excludes planning docs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-sdk-'));
  try {
    const pack = spawnSync(
      process.execPath,
      [packageGame, '--engine', '--out-dir', tmp],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const summary = JSON.parse(pack.stdout);
    assert.equal(summary.mode, 'engine');
    assert.equal(summary.releaseTag, 'hgame_1_0');

    const sdkDir = path.join(tmp, 'hgame_1_0');
    const sdkZip = path.join(tmp, 'hgame_1_0.zip');
    assert.equal(await exists(sdkDir), true);
    assert.equal(await exists(sdkZip), true);

    for (const requiredRel of [
      '.agents/skills/hgame/SKILL.md',
      '.agents/skills/hgame-vfx-juice/SKILL.md',
      '.agents/skills/hgame-balance-sim/SKILL.md',
      '.agents/skills/hgame-balance-sim/scripts/sim-balance.mjs',
      '.agents/skills/hgame-level-architect/SKILL.md',
      '.agents/skills/hgame-level-architect/scripts/check-level.mjs',
      '.agents/skills/hgame-narrative-branch/SKILL.md',
      '.agents/skills/hgame-narrative-branch/scripts/check-story-graph.mjs',
      '.agents/skills/hgame-ui-ux/SKILL.md',
      '.agents/skills/hgame-ui-ux/scripts/check-ui.mjs',
      'docs/guides/USER-AND-AGENT-GUIDE.md',
      'AGENTS.md',
      'README.md',
      'LICENSE',
      'assets/runtime/VERSION',
      'assets/runtime/vendor/rapier2d/rapier2d.wasm',
      'assets/runtime/vendor/rapier3d/rapier3d.wasm',
      'assets/template/AGENTS.md',
    ]) {
      assert.equal(await exists(path.join(sdkDir, requiredRel)), true, `Expected ${requiredRel} in SDK release`);
    }

    assert.equal(
      await exists(path.join(sdkDir, 'docs', 'superpowers')),
      false,
      'Expected docs/superpowers/ to be excluded from SDK release',
    );

    const zipEntries = readZipEntries(await readFile(sdkZip));
    assert.equal(zipEntries.has('hgame_1_0/.agents/skills/hgame/SKILL.md'), true);
    assert.equal(zipEntries.has('hgame_1_0/.agents/skills/hgame-vfx-juice/SKILL.md'), true);
    assert.equal(zipEntries.has('hgame_1_0/docs/guides/USER-AND-AGENT-GUIDE.md'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package-game omits Rapier WASM when physics3d is declared but src never uses scene.physics, and honors physics.bundleWasm', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-lazy-wasm-'));
  const game = path.join(tmp, 'sim');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--profile', '3d', '--bare', '--with', 'physics3d', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    const pack = (...extra) => spawnSync(process.execPath, [packageGame, game, '--version', '1.0.0', ...extra], { encoding: 'utf8' });

    // Declared but unused -> no WASM, physics feature stripped from release config, note printed
    let run = pack();
    assert.equal(run.status, 0, run.stderr || run.stdout);
    let summary = JSON.parse(run.stdout);
    assert.equal(summary.wasm, null);
    assert.ok(summary.wasmSkipped);
    assert.match(run.stderr, /Rapier WASM omitted/);
    const outDir = path.join(game, 'build', 'sim_1_0');
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vendor', 'rapier3d')), false);
    const releaseEngine = JSON.parse(await readFile(path.join(outDir, 'engine.config.json'), 'utf8'));
    assert.equal(releaseEngine.physics, 'none');
    assert.equal(releaseEngine.features.includes('physics3d'), false);

    // Explicit override forces the bundle
    const gameCfgPath = path.join(game, 'game.config.json');
    const gameCfg = JSON.parse(await readFile(gameCfgPath, 'utf8'));
    gameCfg.physics = { bundleWasm: true };
    await writeFile(gameCfgPath, JSON.stringify(gameCfg, null, 2) + '\n');
    run = pack();
    assert.equal(run.status, 0, run.stderr || run.stdout);
    summary = JSON.parse(run.stdout);
    assert.equal(summary.wasm, 'vendor/hgame/vendor/rapier3d/rapier3d.wasm');
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vendor', 'rapier3d', 'rapier3d.wasm')), true);

    // Actual usage bundles by default (override removed)
    delete gameCfg.physics;
    await writeFile(gameCfgPath, JSON.stringify(gameCfg, null, 2) + '\n');
    await writeFile(path.join(game, 'src', 'gameplay.js'), 'export const add = (scene, e) => scene.physics.add(e, { static: true });\n');
    run = pack();
    summary = JSON.parse(run.stdout);
    assert.equal(summary.wasm, 'vendor/hgame/vendor/rapier3d/rapier3d.wasm');

    // bundleWasm:false overrides detected usage
    gameCfg.physics = { bundleWasm: false };
    await writeFile(gameCfgPath, JSON.stringify(gameCfg, null, 2) + '\n');
    summary = JSON.parse(pack().stdout);
    assert.equal(summary.wasm, null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('package-game retains vfx/ and sim/ runtime subpaths when referenced from game src', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-pkg-vfx-sim-'));
  const game = path.join(tmp, 'subpaths');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--bare', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    const srcMain = path.join(game, 'src', 'main.js');
    const prev = await readFile(srcMain, 'utf8');
    await writeFile(
      srcMain,
      `import { createVfxSystem } from '../vendor/hgame/vfx/index.js';\nimport { createRng } from '../vendor/hgame/sim/rng.js';\n${prev}\nvoid createVfxSystem; void createRng;\n`,
    );

    const pack = spawnSync(process.execPath, [packageGame, game, '--version', '1.0.0'], { encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const outDir = path.join(game, 'build', 'subpaths_1_0');
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vfx', 'index.js')), true);
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'vfx', 'vfx-core.js')), true);
    assert.equal(await exists(path.join(outDir, 'vendor', 'hgame', 'sim', 'rng.js')), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

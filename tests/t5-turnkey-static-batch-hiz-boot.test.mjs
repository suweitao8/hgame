import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  mergeStaticMeshesByMaterial3D,
  GPU_HIZ_OCCLUSION_WGSL,
  createHiZOcclusionCuller3D,
  createProgressiveBootLoader,
} from '../assets/runtime/index.js';
import { analyzeBundleBudget } from '../scripts/package-game.mjs';

test('Phase T5-B: mergeStaticMeshesByMaterial3D merges world-transformed meshes by shared material cleanly', () => {
  const geoA = new THREE.BoxGeometry(1, 1, 1);
  const geoB = new THREE.BoxGeometry(2, 1, 2);
  const mat1 = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
  const mat2 = new THREE.MeshStandardMaterial({ color: 0xf97316 });

  const meshes = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(i % 2 === 0 ? geoA : geoB, i < 12 ? mat1 : mat2);
    m.position.set(i * 2.5, 0.5, -4);
    m.castShadow = i === 0;
    m.receiveShadow = true;
    meshes.push(m);
  }

  const res = mergeStaticMeshesByMaterial3D(THREE, meshes, { disposeSources: false });
  assert.equal(res.meshes.length, 2);
  assert.equal(res.stats.inputMeshes, 16);
  assert.equal(res.stats.outputBatches, 2);
  assert.equal(res.stats.drawCallReductionRatio, 0.875);
  assert.ok(res.meshes[0].userData.hgameStaticBatch);
  assert.equal(res.meshes[0].castShadow, true);
  assert.equal(res.meshes[1].castShadow, false);
  assert.ok(res.stats.totalVertices === 16 * 24);
  assert.ok(res.stats.totalTriangles === 16 * 12);

  // Spatial chunk splitting by XZ grid cell
  const chunked = mergeStaticMeshesByMaterial3D(THREE, meshes, { chunkSize: 10 });
  assert.ok(chunked.meshes.length >= 4);

  geoA.dispose();
  geoB.dispose();
  mat1.dispose();
  mat2.dispose();
  for (const b of res.meshes) b.geometry.dispose();
  for (const b of chunked.meshes) b.geometry.dispose();
});

test('Phase T5-C: analyzeBundleBudget reports category bytes, 50MB utilization, and KTX2 potential savings', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hgame-budget-'));
  try {
    await fs.writeFile(path.join(tmpDir, 'main.js'), Buffer.alloc(40 * 1024, 65));
    await fs.writeFile(path.join(tmpDir, 'albedo.png'), Buffer.alloc(200 * 1024, 128));
    await fs.writeFile(path.join(tmpDir, 'hero.glb'), Buffer.alloc(120 * 1024, 9));
    await fs.writeFile(path.join(tmpDir, 'bgm.ogg'), Buffer.alloc(80 * 1024, 7));

    const report = await analyzeBundleBudget(tmpDir, { limitBytes: 50 * 1024 * 1024 });
    assert.equal(report.withinLimit, true);
    assert.equal(report.categories.code, 40 * 1024);
    assert.equal(report.categories.textures, 200 * 1024);
    assert.equal(report.categories.models3d, 120 * 1024);
    assert.equal(report.categories.audio, 80 * 1024);
    assert.equal(report.ktx2PotentialSavingsBytes, Math.round(200 * 1024 * 0.65));
    assert.equal(report.topFiles[0].path, 'albedo.png');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Phase T5-D: createHiZOcclusionCuller3D culls occluded objects behind walls & WGSL source valid', () => {
  assert.match(GPU_HIZ_OCCLUSION_WGSL, /@compute @workgroup_size\(64\)/);
  assert.match(GPU_HIZ_OCCLUSION_WGSL, /textureLoad\(tHiZ/);

  const hiz = createHiZOcclusionCuller3D({ width: 64, height: 64 });
  const depth = new Float32Array(64 * 64).fill(0.95);
  // Paint a near wall occupying [0.2..0.6] x [0.2..0.8] at depth 0.25
  for (let y = 13; y <= 51; y++) {
    for (let x = 13; x <= 38; x++) {
      depth[y * 64 + x] = 0.25;
    }
  }
  const mips = hiz.buildPyramid(depth);
  assert.equal(mips, 7); // 64 -> 32 -> 16 -> 8 -> 4 -> 2 -> 1

  // Enemy fully behind wall at depth 0.55 must be culled
  assert.equal(hiz.testScreenBounds(0.3, 0.35, 0.45, 0.65, 0.55), false);
  // Enemy peeking outside wall at x=0.75 (background depth 0.95) must stay visible
  assert.equal(hiz.testScreenBounds(0.7, 0.35, 0.85, 0.6, 0.55), true);
  // Object in front of wall (depth 0.15) must stay visible
  assert.equal(hiz.testScreenBounds(0.3, 0.35, 0.45, 0.65, 0.15), true);
  assert.equal(hiz.getStats().tested, 3);
  assert.equal(hiz.getStats().occluded, 1);
});

test('Phase T5-D: createProgressiveBootLoader unblocks P0 interactive boot immediately while streaming P1/P2', async () => {
  const loaded = [];
  const stages = [];
  const loader = createProgressiveBootLoader({
    p0: ['core.js', 'ui.png'],
    p1: ['arena.glb'],
    p2: ['boss.glb', 'bgm.ogg'],
    async loadAsset(id) {
      loaded.push(id);
    },
    onStageComplete(stage) {
      stages.push(stage);
    },
  });

  const boot = await loader.start();
  assert.equal(boot.interactiveReady, true);
  assert.equal(boot.p0Count, 2);
  assert.ok(loaded.includes('core.js') && loaded.includes('ui.png'));

  const done = await loader.whenAllReady();
  assert.equal(done.aborted, false);
  assert.deepEqual(stages, ['p0', 'p1', 'p2']);
  assert.equal(loaded.length, 5);
});

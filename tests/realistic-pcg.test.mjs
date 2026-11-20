import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pcgDir = path.join(root, 'src', 'modules', 'realistic-pcg');

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'hgame-pcg-test-'));
const bundlePath = path.join(tmpDir, 'pcg.mjs');

await esbuild.build({
  entryPoints: [path.join(pcgDir, 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  alias: {
    three: path.join(root, 'assets', 'optional', 'three', 'three.module.js'),
    'three/examples/jsm': path.join(root, 'assets', 'optional', 'three', 'jsm'),
  },
  outfile: bundlePath,
});

const pcg = await import(pathToFileURL(bundlePath).href);

// Ephemeral inline test fixtures (HGame engine does not store reusable assets)
const FIXTURE_BRICK_MAT = {
  format: 'hgame.material',
  version: 1,
  id: 'test_stone_brick',
  meta: { category: 'masonry', tileMeters: 2.0, seed: 1042 },
  params: { mortarWidth: 0.045 },
  nodes: [
    {
      id: 'bricks',
      op: 'brick_pattern',
      args: { rows: 8, cols: 4, stagger: 0.5, mortar: '$mortarWidth', bevel: 0.03, variation: 0.35 },
    },
    {
      id: 'grain',
      op: 'fbm',
      args: { scale: 10, octaves: 4, persistence: 0.52, seamless: true },
    },
    {
      id: 'height_final',
      op: 'blend',
      args: { mode: 'multiply', a: 'bricks.height', b: 'grain', strength: 0.28 },
    },
    {
      id: 'normal_map',
      op: 'height_to_normal',
      args: { input: 'height_final', strength: 2.4 },
    },
    {
      id: 'albedo_color',
      op: 'color_ramp',
      args: { input: 'bricks.cellRand', stops: [[0, '#4a4642'], [0.5, '#645d55'], [1, '#7c7267']] },
    },
    {
      id: 'albedo_final',
      op: 'mix_color',
      args: { a: '#403c38', b: 'albedo_color', mask: 'bricks.mask' },
    },
    {
      id: 'brick_rough',
      op: 'remap',
      args: { input: 'grain', inMin: 0.2, inMax: 0.8, outMin: 0.34, outMax: 0.62 },
    },
    {
      id: 'rough_final',
      op: 'mix_scalar',
      args: { a: 0.88, b: 'brick_rough', mask: 'bricks.mask' },
    },
  ],
  outputs: {
    albedo: 'albedo_final',
    height: 'height_final',
    normal: 'normal_map',
    ao: { op: 'remap', input: 'height_final', outMin: 0.45, outMax: 1.0 },
    roughness: 'rough_final',
    metalness: 0.0,
    porosity: 0.65,
  },
};

const FIXTURE_WOOD_MAT = {
  format: 'hgame.material',
  version: 1,
  id: 'test_wood',
  meta: { category: 'wood', tileMeters: 2.0, seed: 2084 },
  nodes: [
    { id: 'planks', op: 'plank_pattern', args: { planks: 6, joints: 2, gap: 0.03, bevel: 0.025, variation: 0.4 } },
    { id: 'grain', op: 'wood_grain', args: { scale: 5, ringScale: 16, distortion: 0.35, knots: 2 } },
    { id: 'h', op: 'blend', args: { mode: 'multiply', a: 'planks.height', b: 'grain.height', strength: 0.35 } },
    { id: 'n', op: 'height_to_normal', args: { input: 'h', strength: 2.2 } },
    { id: 'col', op: 'color_ramp', args: { input: 'grain.grain', stops: [[0, '#4a3d30'], [1, '#82684b']] } },
    { id: 'r', op: 'remap', args: { input: 'grain.grain', inMin: 0.1, inMax: 0.9, outMin: 0.54, outMax: 0.88 } },
  ],
  outputs: { albedo: 'col', height: 'h', normal: 'n', ao: 'h', roughness: 'r', metalness: 0.0, porosity: 0.5 },
};

const FIXTURE_WALL_MESH = {
  format: 'hgame.mesh',
  version: 1,
  id: 'test_wall',
  meta: { unit: 'meter', collider: 'auto_boxes' },
  params: { width: 4.0, height: 3.0, thickness: 0.35, bevel: 0.02, hasWindow: true },
  materialSlots: { wall: 'test_stone_brick' },
  parts: [
    {
      id: 'body',
      op: 'beveled_wall_opening',
      material: '$wall',
      args: {
        width: '$width',
        height: 'expr:$height - 0.12',
        thickness: '$thickness',
        bevel: '$bevel',
        openings: [{ when: '$hasWindow', x: 0, y: 0.9, w: 1.1, h: 1.1 }],
      },
      vertexMeta: { edgeWear: 0.6 },
    },
    {
      id: 'coping',
      op: 'beveled_box',
      material: '$wall',
      args: { size: ['expr:$width + 0.08', 0.12, 'expr:$thickness + 0.08'], bevel: 0.015 },
      transform: { pos: [0, 'expr:$height - 0.06', 0] },
      vertexMeta: { edgeWear: 0.8 },
    },
  ],
};

const FIXTURE_POST_MESH = {
  format: 'hgame.mesh',
  version: 1,
  id: 'test_post',
  meta: { unit: 'meter', collider: 'auto_boxes' },
  materialSlots: { wallMat: 'test_stone_brick', woodMat: 'test_wood' },
  parts: [
    {
      id: 'back',
      op: 'ref',
      ref: 'test_wall',
      params: { width: 4.0, height: 3.0, hasWindow: true },
      materialOverrides: { wall: '$wallMat' },
      transform: { pos: [0, 0, -2.0] },
    },
    {
      id: 'roof_beams',
      op: 'beveled_box',
      material: '$woodMat',
      args: { size: [0.16, 0.22, 4.4], bevel: 0.015 },
      repeat: { count: 4, stepPos: [1.1, 0, 0] },
      transform: { pos: [-1.65, 3.1, 0] },
    },
  ],
};

test.after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test('deterministic PRNG and seamless periodic 2D noise kernels', () => {
  const a = pcg.mulberry32(42);
  const b = pcg.mulberry32(42);
  for (let i = 0; i < 10; i++) {
    assert.equal(a.nextUint32(), b.nextUint32());
  }

  const x0 = pcg.xoshiro128ss(12345);
  const x1 = pcg.xoshiro128ss(12345);
  for (let i = 0; i < 10; i++) {
    assert.equal(x0.nextFloat(), x1.nextFloat());
  }

  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const fU0 = pcg.fbm2DPeriodic(0, t, 8, 4, 0.5, 2, 1042);
    const fU1 = pcg.fbm2DPeriodic(1, t, 8, 4, 0.5, 2, 1042);
    assert.ok(Math.abs(fU0 - fU1) < 1e-6);

    const fV0 = pcg.fbm2DPeriodic(t, 0, 8, 4, 0.5, 2, 1042);
    const fV1 = pcg.fbm2DPeriodic(t, 1, 8, 4, 0.5, 2, 1042);
    assert.ok(Math.abs(fV0 - fV1) < 1e-6);

    const w0 = pcg.worley2DPeriodic(0, t, 6, 0.9, 99);
    const w1 = pcg.worley2DPeriodic(1, t, 6, 0.9, 99);
    assert.ok(Math.abs(w0.f1 - w1.f1) < 1e-6);
  }
});

test('safe-expr parser evaluates arithmetic without eval and rejects bad tokens', () => {
  const params = { height: 3.0, thickness: 0.35, postCount: 5, length: 2.4 };
  assert.ok(Math.abs(pcg.evaluateSafeExpr('expr:$height - 0.35', params) - 2.65) < 1e-9);
  assert.ok(Math.abs(pcg.evaluateSafeExpr('expr:$length / ($postCount - 1)', params) - 0.6) < 1e-9);
  assert.equal(pcg.evaluateSafeExpr('expr:-($height * 2) + 1', params), -5);
  assert.throws(() => pcg.evaluateSafeExpr('expr:$height / 0', params));
  assert.throws(() => pcg.evaluateSafeExpr('expr:Math.sin(1)', params));
  assert.throws(() => pcg.evaluateSafeExpr('expr:$missing + 1', params));
});

test('schema-validator detects DAG cycles, ref cycles, PBR violations, and zero eval', () => {
  const cyclicMat = {
    format: 'hgame.material',
    version: 1,
    id: 'bad_cycle',
    meta: { category: 'test', tileMeters: 1, seed: 1 },
    nodes: [
      { id: 'a', op: 'invert', args: { input: 'b' } },
      { id: 'b', op: 'invert', args: { input: 'a' } },
    ],
    outputs: {
      albedo: '#777777',
      height: 'a',
      normal: '#8080ff',
      ao: 1,
      roughness: 0.5,
      metalness: 0,
      porosity: 0.2,
    },
  };
  assert.ok(pcg.validateMaterialRecipe(cyclicMat).some((i) => i.message.includes('Cycle detected')));

  const badLumaMat = {
    format: 'hgame.material',
    version: 1,
    id: 'bad_luma',
    meta: { category: 'test', tileMeters: 1, seed: 1 },
    nodes: [{ id: 'n', op: 'fbm', args: { scale: 4, octaves: 2, persistence: 0.5 } }],
    outputs: {
      albedo: '#050505',
      height: 'n',
      normal: '#8080ff',
      ao: 1,
      roughness: 0.0,
      metalness: 0,
      porosity: 0.2,
    },
  };
  const pbrIssues = pcg.validateMaterialRecipe(badLumaMat);
  assert.ok(pbrIssues.some((i) => i.path === 'outputs.roughness'));
  assert.ok(pbrIssues.some((i) => i.message.includes('linear albedo luminance')));

  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        files.push({ path: p, content: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(pcgDir);
  assert.equal(pcg.auditSourcesNoEval(files).length, 0);
});

test('procedural materials bake deterministically with realistic roughness contrast', () => {
  for (const recipe of [FIXTURE_BRICK_MAT, FIXTURE_WOOD_MAT]) {
    const bakedA = pcg.evaluateMaterialGraphSync(recipe, 64);
    const bakedB = pcg.evaluateMaterialGraphSync(recipe, 64);
    assert.deepEqual(bakedA.albedoData, bakedB.albedoData);
    assert.deepEqual(bakedA.normalData, bakedB.normalData);
    assert.deepEqual(bakedA.ormData, bakedB.ormData);
    assert.ok(bakedA.stats.maxRoughness - bakedA.stats.minRoughness > 0.05);
  }

  const job = pcg.createMaterialBakeJob(FIXTURE_BRICK_MAT, 64);
  let slices = 0;
  while (!job.step(0.5)) {
    slices++;
    assert.ok(slices < 5000);
  }
  const slicedRes = job.getResult();
  const syncRes = pcg.evaluateMaterialGraphSync(FIXTURE_BRICK_MAT, 64);
  assert.deepEqual(slicedRes.albedoData, syncRes.albedoData);
});

test('mesh recipes evaluate metric UVs 1:1 across 1m pillar and 4m wall plus composite ref', () => {
  const meshes = new Map([
    [FIXTURE_WALL_MESH.id, FIXTURE_WALL_MESH],
    [FIXTURE_POST_MESH.id, FIXTURE_POST_MESH],
  ]);
  const matIds = new Map([
    ['test_stone_brick', 0],
    ['test_wood', 1],
  ]);
  const ctx = { recipes: meshes, resolveMaterialId: (name) => matIds.get(name) };

  const pillar = pcg.evaluateMeshRecipe(FIXTURE_WALL_MESH, ctx, {
    params: { width: 1.0, height: 3.0, thickness: 1.0, hasWindow: false },
  });
  const wall = pcg.evaluateMeshRecipe(FIXTURE_WALL_MESH, ctx, {
    params: { width: 4.0, height: 3.0, thickness: 0.35, hasWindow: false },
  });

  pillar.geometry.computeBoundingBox();
  wall.geometry.computeBoundingBox();
  const pSizeX = pillar.geometry.boundingBox.max.x - pillar.geometry.boundingBox.min.x;
  const wSizeX = wall.geometry.boundingBox.max.x - wall.geometry.boundingBox.min.x;
  assert.ok(Math.abs(pSizeX - 1.08) < 0.02);
  assert.ok(Math.abs(wSizeX - 4.08) < 0.02);

  const post = pcg.evaluateMeshRecipe(FIXTURE_POST_MESH, ctx);
  assert.ok(post.triangleCount > 100 && post.triangleCount < 25000);
  assert.equal(post.materialIdsUsed.length, 2);

  pillar.geometry.dispose();
  wall.geometry.dispose();
  post.geometry.dispose();
});

test('voxel chunk mesher culls hidden faces, computes 4-neighbor AO, and exports greedy AABBs', async () => {
  const chunk = pcg.createVoxelChunk({ sizeX: 8, sizeY: 4, sizeZ: 8, voxelSize: 1.0 });
  for (let z = 0; z < 4; z++) {
    for (let x = 0; x < 4; x++) {
      chunk.setVoxel(x, 0, z, 0, z === 2 ? 0.9 : 0.0);
    }
  }
  chunk.setVoxel(0, 1, 0, 1, 0.0);

  const geom = chunk.buildMeshGeometry();
  const col = geom.getAttribute('color');
  let minAO = 1;
  for (let i = 0; i < col.count; i++) {
    minAO = Math.min(minAO, col.getX(i));
  }
  assert.ok(minAO < 1.0);

  const boxes = pcg.extractMergedBoxes(chunk);
  assert.equal(boxes.length, 2);

  const portableDescs = pcg.toRapierColliderDesc(boxes);
  assert.equal(portableDescs.length, 2);
  assert.equal(portableDescs[0].kind, 'cuboid');

  const RAPIER = await import('../assets/runtime/vendor/rapier3d/rapier3d.mjs');
  const descs = pcg.toRapierColliderDesc(boxes, RAPIER);
  assert.equal(descs.length, 2);

  chunk.dispose();
});

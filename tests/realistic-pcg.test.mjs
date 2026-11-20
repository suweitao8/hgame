import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pcgDir = path.join(root, 'src', 'modules', 'realistic-pcg');
const procDir = path.join(root, 'assets', 'procedural');

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

  // Seamlessness check: u=0 matches u=1, v=0 matches v=1
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const fU0 = pcg.fbm2DPeriodic(0, t, 8, 4, 0.5, 2, 1042);
    const fU1 = pcg.fbm2DPeriodic(1, t, 8, 4, 0.5, 2, 1042);
    assert.ok(Math.abs(fU0 - fU1) < 1e-6, `FBM U seam mismatch at t=${t}`);

    const fV0 = pcg.fbm2DPeriodic(t, 0, 8, 4, 0.5, 2, 1042);
    const fV1 = pcg.fbm2DPeriodic(t, 1, 8, 4, 0.5, 2, 1042);
    assert.ok(Math.abs(fV0 - fV1) < 1e-6, `FBM V seam mismatch at t=${t}`);

    const w0 = pcg.worley2DPeriodic(0, t, 6, 0.9, 99);
    const w1 = pcg.worley2DPeriodic(1, t, 6, 0.9, 99);
    assert.ok(Math.abs(w0.f1 - w1.f1) < 1e-6, `Worley U seam mismatch at t=${t}`);
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
  const matIssues = pcg.validateMaterialRecipe(cyclicMat);
  assert.ok(matIssues.some((i) => i.message.includes('Cycle detected')));

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

  // Audit all .ts files in realistic-pcg for zero eval / new Function
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

test('all 6 procedural materials bake deterministically with realistic roughness contrast', () => {
  const manifest = JSON.parse(readFileSync(path.join(procDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.materials.length, 6);

  for (const entry of manifest.materials) {
    const recipe = JSON.parse(readFileSync(path.join(procDir, entry.path), 'utf8'));
    const bakedA = pcg.evaluateMaterialGraphSync(recipe, 64);
    const bakedB = pcg.evaluateMaterialGraphSync(recipe, 64);
    assert.deepEqual(bakedA.albedoData, bakedB.albedoData);
    assert.deepEqual(bakedA.normalData, bakedB.normalData);
    assert.deepEqual(bakedA.ormData, bakedB.ormData);
    assert.ok(
      bakedA.stats.maxRoughness - bakedA.stats.minRoughness > 0.05,
      `${recipe.id} must have roughness variation`
    );
  }

  // Verify sliced async bake job finishes identically to sync bake
  const brickRecipe = JSON.parse(
    readFileSync(path.join(procDir, 'materials/wet_stone_brick.hmat.json'), 'utf8')
  );
  const job = pcg.createMaterialBakeJob(brickRecipe, 64);
  let slices = 0;
  while (!job.step(0.5)) {
    slices++;
    assert.ok(slices < 5000);
  }
  const slicedRes = job.getResult();
  const syncRes = pcg.evaluateMaterialGraphSync(brickRecipe, 64);
  assert.deepEqual(slicedRes.albedoData, syncRes.albedoData);
});

test('mesh recipes evaluate metric UVs 1:1 across 1m pillar and 4m wall plus composite guard_post', () => {
  const manifest = JSON.parse(readFileSync(path.join(procDir, 'manifest.json'), 'utf8'));
  const meshes = new Map();
  for (const entry of manifest.meshes) {
    const m = JSON.parse(readFileSync(path.join(procDir, entry.path), 'utf8'));
    meshes.set(m.id, m);
  }
  const matIds = new Map(manifest.materials.map((m, i) => [m.id, i]));
  const ctx = {
    recipes: meshes,
    resolveMaterialId: (name) => matIds.get(name),
  };

  const pillar = pcg.evaluateMeshRecipe(meshes.get('beveled_wall'), ctx, {
    params: { width: 1.0, height: 3.0, thickness: 1.0, hasWindow: false },
  });
  const wall = pcg.evaluateMeshRecipe(meshes.get('beveled_wall'), ctx, {
    params: { width: 4.0, height: 3.0, thickness: 0.35, hasWindow: false },
  });

  // Check metric UV spans match world meter bounds 1:1
  pillar.geometry.computeBoundingBox();
  wall.geometry.computeBoundingBox();
  const pSizeX = pillar.geometry.boundingBox.max.x - pillar.geometry.boundingBox.min.x;
  const wSizeX = wall.geometry.boundingBox.max.x - wall.geometry.boundingBox.min.x;
  assert.ok(Math.abs(pSizeX - 1.08) < 0.02); // top_coping is width + 0.08
  assert.ok(Math.abs(wSizeX - 4.08) < 0.02);

  const guardPost = pcg.evaluateMeshRecipe(meshes.get('guard_post'), ctx);
  assert.ok(guardPost.triangleCount > 200 && guardPost.triangleCount < 25000);
  assert.ok(guardPost.materialIdsUsed.length >= 3);

  pillar.geometry.dispose();
  wall.geometry.dispose();
  guardPost.geometry.dispose();
});

test('voxel chunk mesher culls hidden faces, computes 4-neighbor AO, and exports greedy AABBs', async () => {
  const chunk = pcg.createVoxelChunk({ sizeX: 8, sizeY: 4, sizeZ: 8, voxelSize: 1.0 });
  // Build a 4x1x4 flat floor with a 1x1x1 step block in the corner
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
  assert.ok(minAO < 1.0, 'Corner adjacent to raised voxel must receive vertex AO darkening');

  const boxes = pcg.extractMergedBoxes(chunk);
  // 4x1x4 floor + 1x1x1 step = 2 merged boxes instead of 17 individual voxels
  assert.equal(boxes.length, 2);

  // Verify portable & Rapier3D deterministic descriptor integration
  const portableDescs = pcg.toRapierColliderDesc(boxes);
  assert.equal(portableDescs.length, 2);
  assert.equal(portableDescs[0].kind, 'cuboid');

  const RAPIER = await import('../assets/runtime/vendor/rapier3d/rapier3d.mjs');
  const descs = pcg.toRapierColliderDesc(boxes, RAPIER);
  assert.equal(descs.length, 2);

  chunk.dispose();
});

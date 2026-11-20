import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  HGame,
  Entity,
  Scene,
  TileMap,
  SWARM_UNIT_FLAGS,
  ECS_SLOT_FLAGS,
  FlatSpatialHash2D,
  createFlatSpatialHash2D,
  FlowField2D,
  createFlowField2D,
  FlatCombatECS,
  createSwarmSimulation,
  createGpuSwarmWebGL2,
} from '../assets/runtime/index.js';
import { SpriteCrowd2D } from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';
import { createSceneCuller3D } from '../assets/runtime/integrations/culling3d.js';
import {
  float32ToFloat16,
  float16ToFloat32,
  bakeBoneVatData,
  encodeBoneVatBinary,
  decodeBoneVatBinary,
  buildSimplifiedLodGeometry,
  createBoneVatCrowd3D,
  cloneObject3DWithSkins,
} from '../assets/runtime/integrations/model3d.js';
import * as models from '../assets/runtime/integrations/model3d.js';
import { createHLODProxyGroup3D } from '../assets/runtime/world/open-world.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function createProceduralSkinnedHero(THREEModule, { nonIdentityBind = true } = {}) {
  const geo = new THREEModule.CylinderGeometry(0.35, 0.35, 1.8, 12, 8, false);
  geo.translate(0, 0.9, 0);
  const posAttr = geo.attributes.position;
  const vCount = posAttr.count;
  const skinIndices = new Float32Array(vCount * 4);
  const skinWeights = new Float32Array(vCount * 4);

  for (let i = 0; i < vCount; i++) {
    const y = posAttr.getY(i);
    const upperW = Math.max(0, Math.min(1, (y - 0.5) / 0.8));
    const lowerW = 1 - upperW;
    skinIndices[i * 4] = 0;
    skinIndices[i * 4 + 1] = 1;
    skinWeights[i * 4] = lowerW;
    skinWeights[i * 4 + 1] = upperW;
  }
  geo.setAttribute('skinIndex', new THREEModule.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREEModule.Float32BufferAttribute(skinWeights, 4));

  const rootBone = new THREEModule.Bone();
  rootBone.name = 'Root';
  const upperBone = new THREEModule.Bone();
  upperBone.name = 'Upper';
  upperBone.position.set(0, 0.9, 0);
  rootBone.add(upperBone);

  const skeleton = new THREEModule.Skeleton([rootBone, upperBone]);
  const mesh = new THREEModule.SkinnedMesh(
    geo,
    new THREEModule.MeshStandardMaterial({ color: 0x66ccaa }),
  );
  mesh.add(rootBone);
  if (nonIdentityBind) {
    mesh.position.set(0.25, 0, -0.15);
    mesh.updateMatrixWorld(true);
  }
  mesh.bind(skeleton, mesh.matrixWorld.clone());
  mesh.updateMatrixWorld(true);

  const root = new THREEModule.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);

  // Keyframes include an intentionally antipodal -q at frame 1 to test hemisphere alignment.
  const q0 = new THREEModule.Quaternion().setFromAxisAngle(new THREEModule.Vector3(0, 0, 1), 0);
  const q1 = new THREEModule.Quaternion().setFromAxisAngle(new THREEModule.Vector3(0, 0, 1), 0.35);
  const q2 = new THREEModule.Quaternion().setFromAxisAngle(new THREEModule.Vector3(0, 0, 1), -0.2);

  const walkClip = new THREEModule.AnimationClip('walk', 0.4, [
    new THREEModule.QuaternionKeyframeTrack(
      'Upper.quaternion',
      [0, 0.2, 0.4],
      [
        q0.x, q0.y, q0.z, q0.w,
        -q1.x, -q1.y, -q1.z, -q1.w,
        q2.x, q2.y, q2.z, q2.w,
      ],
    ),
  ]);

  const idleClip = new THREEModule.AnimationClip('idle', 0.2, [
    new THREEModule.QuaternionKeyframeTrack(
      'Upper.quaternion',
      [0, 0.2],
      [q0.x, q0.y, q0.z, q0.w, q0.x, q0.y, q0.z, q0.w],
    ),
  ]);

  return { mesh, root, clips: [idleClip, walkClip] };
}

function buildMinimalGltfWithSkin() {
  // 2 joints, 1 triangle (3 verts), 2 rotation keyframes + IBM + positions
  const positions = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    0, 1.5, 0,
  ]);
  const joints = new Uint16Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    1, 0, 0, 0,
  ]);
  const weights = new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const ibm0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const ibm1 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.75, 0, 1];
  const ibms = new Float32Array([...ibm0, ...ibm1]);
  const times = new Float32Array([0, 0.5]);
  const rots = new Float32Array([
    0, 0, 0, 1,
    0, 0, Math.sin(0.3), Math.cos(0.3),
  ]);

  const align4 = (n) => (n + 3) & ~3;
  const parts = [positions, joints, weights, indices, ibms, times, rots];
  const offsets = [];
  let cursor = 0;
  for (const arr of parts) {
    offsets.push(cursor);
    cursor = align4(cursor + arr.byteLength);
  }
  const bin = new Uint8Array(cursor);
  parts.forEach((arr, idx) => {
    bin.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), offsets[idx]);
  });

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, skin: 0, name: 'MeshNode' },
      { children: [2], name: 'RootBone' },
      { translation: [0, 0.75, 0], name: 'TipBone' },
    ],
    skins: [{ inverseBindMatrices: 4, joints: [1, 2] }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
        indices: 3,
      }],
    }],
    animations: [{
      name: 'wave',
      channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }],
      samplers: [{ input: 5, interpolation: 'LINEAR', output: 6 }],
    }],
    buffers: [{
      uri: 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64'),
      byteLength: bin.byteLength,
    }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: joints.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: weights.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: indices.byteLength, target: 34963 },
      { buffer: 0, byteOffset: offsets[4], byteLength: ibms.byteLength },
      { buffer: 0, byteOffset: offsets[5], byteLength: times.byteLength },
      { buffer: 0, byteOffset: offsets[6], byteLength: rots.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1.5, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [0.5] },
      { bufferView: 6, componentType: 5126, count: 2, type: 'VEC4' },
    ],
  };

  return JSON.stringify(gltf);
}

test('FlatSpatialHash2D: exact radius queries and head-of-bucket selfId traversal safety (Bug #1 regression)', () => {
  assert.equal(HGame.FlatSpatialHash2D, FlatSpatialHash2D);
  const hash = createFlatSpatialHash2D({ cols: 32, rows: 32, cellSize: 2, originX: -32, originY: -32, capacity: 16 });
  const xs = new Float32Array(16);
  const ys = new Float32Array(16);

  // Place ids 0, 1, 2 in the exact same cell so head[cell] === 2 when selfId === 2.
  xs[0] = 0.2; ys[0] = 0.2;
  xs[1] = 0.6; ys[1] = 0.5;
  xs[2] = 0.4; ys[2] = 0.4;
  xs[3] = 5.0; ys[3] = 5.0; // outside radius 2

  for (let i = 0; i < 4; i++) hash.insert(i, xs[i], ys[i]);

  const out = new Int32Array(16);
  const count = hash.queryRadiusIds(xs[2], ys[2], 2.0, out, 16, xs, ys, 2);
  const found = Array.from(out.subarray(0, count)).sort((a, b) => a - b);
  assert.deepEqual(found, [0, 1], 'excluding head-of-bucket selfId must still visit remaining peers');
});

test('FlowField2D: TileMap wall obstacles, multi-goal Dijkstra detour, and rg8 encoding', () => {
  const tiles = Array.from({ length: 16 }, () => Array(16).fill(0));
  for (let y = 2; y <= 13; y++) tiles[y][8] = 1; // vertical wall at col 8 blocking direct path
  const map = new TileMap({ tiles, tileWidth: 2, tileHeight: 2, solid: [1] });

  const ff = createFlowField2D({ cols: 16, rows: 16, cellSize: 2, originX: 0, originY: 0 });
  ff.setWallsFromTileMap(map);
  assert.equal(ff.cost[5 * 16 + 8], 255);

  ff.compute({ x: 25, y: 15 }); // goal on right side of wall
  assert.equal(ff.dirX[5 * 16 + 8], 0);
  assert.equal(ff.dirY[5 * 16 + 8], 0);

  // Unit behind wall center should have finite path length via top/bottom gap and non-zero sample direction.
  const dir = ff.sample(7, 15);
  const mag = Math.hypot(dir.x, dir.y);
  assert.ok(mag > 0.98 && mag < 1.02, `expected unit flow vector, got ${mag}`);
  // Must steer either north or south around wall rather than blindly right into x=16 wall.
  assert.ok(Math.abs(dir.y) > 0.25, `expected detour y component around wall, got (${dir.x}, ${dir.y})`);
  assert.equal(ff.rg8.length, 16 * 16 * 2);
});

test('SwarmSimulation & FlatCombatECS: 10m/12m hysteresis, freeze/knockback, Bug #2 AOE overflow, Bug #3 ghost prevent, Bug #4b rot preserve, Crowd2D sync', () => {
  const sim = createSwarmSimulation({
    capacity: 1024,
    ecsSlots: 1024,
    maxPatchesPerStep: 256,
    promoteRadius: 10,
    demoteRadius: 12,
    useFlowField: false,
    separationStrength: 0,
  });

  // 1. Hysteresis 10m promote / 12m demote
  const u0 = sim.spawn({ x: 15, y: 0, rot: 1.1, speed: 0, hp: 100, clipId: 2 });
  let stats = sim.step(1 / 60, { heroX: 0, heroY: 0 });
  assert.equal(stats.ecsActiveCount, 0);

  sim.posX[u0] = 9.5; // inside 10m promote ring
  stats = sim.step(1 / 60, { heroX: 0, heroY: 0 });
  assert.equal(stats.ecsActiveCount, 1);
  assert.ok((sim.unitFlags[u0] & SWARM_UNIT_FLAGS.ECS_CLAIMED) !== 0);

  // Move to 11m (inside 10..12m hysteresis deadband) -> remains promoted!
  const slot0 = sim.ecs.getSlotBySwarmId(u0);
  sim.ecs.posX[slot0] = 11.0;
  sim.posX[u0] = 11.0;
  stats = sim.step(1 / 60, { heroX: 0, heroY: 0 });
  assert.equal(stats.ecsActiveCount, 1, 'unit inside 10m..12m hysteresis zone stays promoted');

  // Move to 13.5m (> 12m demote threshold) -> cleanly demoted
  sim.ecs.posX[slot0] = 13.5;
  sim.posX[u0] = 13.5;
  stats = sim.step(1 / 60, { heroX: 0, heroY: 0 });
  assert.equal(stats.ecsActiveCount, 0, 'unit beyond 12m must demote back to autonomous swarm');
  assert.equal(sim.ecs.getSlotBySwarmId(u0), -1);
  assert.equal(sim.animClip[u0], 2);

  // 2. Bug #4b: zero-knockback hit must preserve facing rot and clipId
  const prevRot = sim.rot[u0] = 1.234;
  sim.step(0, { heroX: 0, heroY: 0 }); // rebuild hash with unit at (13.5, 0)
  const hitApplied = sim.applyCircleDamage({ x: 13.5, y: 0, radius: 2, damage: 20, knockback: 0, freezeDuration: 0.2 });
  assert.equal(hitApplied, 1);
  const hitSlot = sim.ecs.getSlotBySwarmId(u0);
  sim.ecs.shield[hitSlot] = 5; // partially absorb 5 damage -> hp 100 - (20 - 5) = 85
  sim.step(0.05, { heroX: 0, heroY: 0 });
  assert.equal(sim.hp[u0], 85);
  assert.ok(Math.abs(sim.rot[u0] - prevRot) < 1e-5, `expected preserved rot ${prevRot}, got ${sim.rot[u0]}`);
  assert.ok((sim.ecs.flags[hitSlot] & ECS_SLOT_FLAGS.FROZEN) !== 0);

  // Clear before Bug #2 overflow test
  sim.clear();
  assert.equal(sim.count, 0);

  // 3. Bug #2 & Bug #3: 600 units killed simultaneously with maxPatchesPerStep=256 -> drains to 0 across 3 steps, 0 zombies, 0 resurrections
  const spawnedIds = [];
  for (let i = 0; i < 600; i++) {
    const a = (i / 600) * Math.PI * 2;
    const r = 1 + (i % 5);
    spawnedIds.push(sim.spawn({ x: Math.cos(a) * r, y: Math.sin(a) * r, speed: 0, hp: 50 }));
  }
  sim.step(0, { heroX: 0, heroY: 0 }); // promote & rebuild spatial hash
  const aoeHits = sim.applyCircleDamage({ x: 0, y: 0, radius: 10, damage: 999, knockback: 0 });
  assert.equal(aoeHits, 600);

  let totalKilledCallbacks = 0;
  const s1 = sim.step(1 / 60, { heroX: 0, heroY: 0, onUnitKilled: () => { totalKilledCallbacks++; } });
  assert.equal(s1.killedThisStep, 256);
  assert.equal(s1.activeCount, 344);
  assert.equal(s1.ecsActiveCount, 344);

  const s2 = sim.step(1 / 60, { heroX: 0, heroY: 0, onUnitKilled: () => { totalKilledCallbacks++; } });
  assert.equal(s2.killedThisStep, 256);
  assert.equal(s2.activeCount, 88);

  const s3 = sim.step(1 / 60, { heroX: 0, heroY: 0, onUnitKilled: () => { totalKilledCallbacks++; } });
  assert.equal(s3.killedThisStep, 88);
  assert.equal(s3.activeCount, 0);
  assert.equal(s3.ecsActiveCount, 0);
  assert.equal(totalKilledCallbacks, 600);

  // Step once more: dead IDs remain dead and never ghost re-promote (Bug #3)
  sim.step(1 / 60, { heroX: 0, heroY: 0 });
  for (const id of spawnedIds) {
    assert.equal(sim.unitFlags[id], 0);
    assert.equal(sim.ecs.getSlotBySwarmId(id), -1);
  }

  // 4. Sync to 2D SpriteCrowd2D
  sim.spawn({ x: -12, y: 4, rot: -0.5, scale: 1.5 });
  sim.spawn({ x: 18, y: -6, rot: 0.7, scale: 0.8 });
  const crowd2d = new SpriteCrowd2D({ capacity: 16, width: 32, height: 32 });
  const synced = sim.syncToSpriteCrowd2D(crowd2d, { syncRotation: true, frameCount: 4 });
  assert.equal(synced, 2);
  assert.equal(crowd2d.count, 2);
});

test('Model LOD keeps the same transform and animation clock across skeletal, Bone-VAT and proxy tiers', () => {
  const { mesh, root, clips } = createProceduralSkinnedHero(THREE);
  const world = new THREE.Group();
  const vatData = bakeBoneVatData(THREE, { root, animations: clips, sampleFps: 15 });
  const crowd = createBoneVatCrowd3D(THREE, { root, vatData, capacity: 2 });
  world.add(crowd.group);
  let skeletal, proxy;
  const lod = models.createModelLod3D({
    crowd, crowdDistance: 10, farDistance: 30, hysteresis: 0.1,
    near() {
      skeletal = cloneObject3DWithSkins(THREE, root);
      const mixer = new THREE.AnimationMixer(skeletal);
      const action = mixer.clipAction(clips.find(clip => clip.name === 'walk')).play();
      return {
        sync({ x, y, z, rotationY, time }) {
          skeletal.position.set(x, y, z);
          skeletal.rotation.y = rotationY;
          action.time = time % action.getClip().duration;
          mixer.update(0);
          if (!skeletal.parent) world.add(skeletal);
        },
        dispose() {
          skeletal.removeFromParent();
          mixer.stopAllAction().uncacheRoot(skeletal);
          skeletal.children[0].skeleton.dispose();
        },
      };
    },
    far() {
      proxy = createHLODProxyGroup3D(THREE, { proxies: [{ sx: 2, sy: 2 }] });
      return {
        sync({ x, y, z, rotationY }) {
          proxy.group.position.set(x, y, z);
          proxy.group.rotation.y = rotationY;
          if (!proxy.group.parent) world.add(proxy.group);
        },
        dispose: proxy.dispose,
      };
    },
  });
  const state = { x: 2, y: 0, z: -5, rotationY: 0.5, clip: 'walk', time: 0.6 };
  lod.update(5, state);
  assert.equal(lod.tier, 'near');
  assert.deepEqual(skeletal.position.toArray(), [2, 0, -5]);
  assert.ok(Math.abs(skeletal.getObjectByName('Upper').quaternion.z) > 0.15);
  lod.update(10.5, state);
  assert.equal(lod.tier, 'near');
  const oldSkeletal = skeletal;
  lod.update(12, state);
  assert.equal(lod.tier, 'crowd');
  assert.equal(oldSkeletal.parent, null);
  assert.equal(crowd.update(0.1).visibleCount, 1);
  const packed = crowd.lodMeshes[0].geometry.getAttribute('aCrowdPacked').array;
  const clip = vatData.clips.find(item => item.name === 'walk');
  assert.deepEqual(Array.from(packed.slice(0, 3)), [2, -5, 0.5]);
  assert.ok(Math.abs(packed[3] - (1 + clip.startFrame + (clip.frames - 1) * 0.5)) < 1e-5);
  const longTime = 1e40;
  lod.update(12, { ...state, time: longTime });
  crowd.update(0);
  const longFrame = 1 + clip.startFrame + (clip.frames - 1) * (longTime % clip.duration) / clip.duration;
  assert.ok(Math.abs(packed[3] - longFrame) < 1e-4);
  lod.update(9.5, state);
  assert.equal(lod.tier, 'crowd');
  lod.update(35, { ...state, x: 4 });
  assert.equal(lod.tier, 'far');
  assert.equal(crowd.update(0).visibleCount, 0);
  assert.deepEqual(proxy.group.position.toArray(), [4, 0, -5]);
  lod.update(4, { ...state, time: 0 });
  assert.equal(lod.tier, 'near');
  assert.equal(proxy.group.parent, null);
  assert.equal(skeletal.getObjectByName('Upper').quaternion.z, 0);
  lod.dispose();
  assert.equal(world.children.length, 1);
  crowd.dispose();
  mesh.skeleton.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('Model LOD preserves the active tier on failure and releases superseded or scene-cancelled tiers', async () => {
  const jobs = [];
  const drawn = new Set();
  const released = [];
  let latest;
  const scene = new AbortController();
  const { mesh, root, clips } = createProceduralSkinnedHero(THREE);
  const crowd = createBoneVatCrowd3D(THREE, { root, animations: clips, capacity: 1 });
  const blocker = crowd.spawn();
  const slot = label => ({
    sync(state) { drawn.add(label); latest = state; },
    dispose() { drawn.delete(label); released.push(label); },
  });
  const lod = models.createModelLod3D({
    crowd, signal: scene.signal, crowdDistance: 10, farDistance: 30, hysteresis: 0,
    near: () => slot('near'),
    far({ signal }) {
      const job = Promise.withResolvers();
      jobs.push({ ...job, signal });
      return job.promise;
    },
  });
  const state = { x: 0, y: 0, z: -5, rotationY: 0, clip: 'walk', time: 0.1 };
  lod.update(1, state);
  lod.update(20, state);
  assert.equal(lod.tier, 'near');
  assert.match(String(lod.error), /capacity/i);
  crowd.kill(blocker);
  lod.retry();
  lod.update(20, state);
  assert.equal(lod.tier, 'crowd');
  assert.deepEqual(released, ['near']);
  lod.update(40, state);
  assert.equal(lod.pendingTier, 'far');
  assert.equal(crowd.count, 1);
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 250;
  camera.updateMatrixWorld();
  assert.equal(crowd.update(0, { camera }).visibleCount, 1);
  const failure = new Error('unavailable proxy');
  jobs[0].reject(failure);
  await Promise.resolve();
  lod.update(40, state);
  assert.equal(lod.tier, 'crowd');
  assert.equal(lod.error, failure);
  assert.equal(jobs.length, 1);
  assert.equal(crowd.update(0, { camera }).visibleCount, 1);
  lod.retry();
  lod.update(40, state);
  lod.update(2, state);
  assert.equal(jobs[1].signal.aborted, true);
  jobs[1].resolve(slot('stale'));
  await Promise.resolve();
  assert.deepEqual([...drawn], ['near']);
  assert.deepEqual(released, ['near', 'stale']);
  lod.update(40, state);
  jobs[2].resolve(slot('ready'));
  await Promise.resolve();
  assert.deepEqual([...drawn], ['near']);
  const nextState = { ...state, x: 5, time: 0.3 };
  lod.update(40, nextState);
  assert.equal(latest, nextState);
  assert.deepEqual([...drawn], ['ready']);
  assert.deepEqual(released, ['near', 'stale', 'near']);
  lod.update(2, state);
  lod.update(40, state);
  scene.abort();
  assert.equal(jobs[3].signal.aborted, true);
  jobs[3].resolve(slot('scene-late'));
  await Promise.resolve();
  assert.equal(drawn.size, 0);
  assert.deepEqual(released, ['near', 'stale', 'near', 'ready', 'near', 'scene-late']);
  assert.equal(lod.tier, null);
  assert.equal(lod.dispose(), false);
  assert.equal(crowd.count, 0);
  crowd.dispose();
  mesh.skeleton.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('HalfFloat IEEE-754 codec, Bake Bone-VAT, HVAT Binary Codec, LOD1 Simplifier & createBoneVatCrowd3D (Bug #4 & #5)', () => {
  // HalfFloat accuracy + clamping
  assert.equal(float32ToFloat16(1e6), 0x7bff);
  assert.equal(float32ToFloat16(-1e6), 0xfbff);
  assert.ok(Math.abs(float16ToFloat32(float32ToFloat16(1.375)) - 1.375) < 1e-3);
  assert.ok(Math.abs(float16ToFloat32(float32ToFloat16(-0.70703125)) + 0.70703125) < 1e-3);

  const { mesh, root, clips } = createProceduralSkinnedHero(THREE, { nonIdentityBind: true });
  const baked = bakeBoneVatData(THREE, { root, animations: clips, sampleFps: 15 });
  assert.equal(baked.boneCount, 2);
  assert.equal(baked.width, 4);
  assert.equal(baked.clips.length, 2);

  // Check antipodal quaternion hemisphere alignment across walk clip frames for bone 1
  const walkMeta = baked.clips[1];
  for (let f = walkMeta.startFrame + 1; f < walkMeta.startFrame + walkMeta.frames; f++) {
    const prevOff = ((f - 1) * baked.width + 1 * 2 + 1) * 4;
    const curOff = (f * baked.width + 1 * 2 + 1) * 4;
    const dot =
      baked.floatData[prevOff] * baked.floatData[curOff] +
      baked.floatData[prevOff + 1] * baked.floatData[curOff + 1] +
      baked.floatData[prevOff + 2] * baked.floatData[curOff + 2] +
      baked.floatData[prevOff + 3] * baked.floatData[curOff + 3];
    assert.ok(dot >= -1e-5, `expected hemisphere-aligned quaternion dot >= 0, got ${dot} at frame ${f}`);
  }

  // HVAT encode / decode roundtrip
  const binBuf = encodeBoneVatBinary(baked);
  const decoded = decodeBoneVatBinary(binBuf);
  assert.equal(decoded.boneCount, baked.boneCount);
  assert.equal(decoded.width, baked.width);
  assert.equal(decoded.height, baked.height);
  assert.deepEqual(decoded.clips, baked.clips);
  assert.deepEqual(Array.from(decoded.data), Array.from(baked.data));
  assert.throws(() => decodeBoneVatBinary(new ArrayBuffer(64)), /bad magic/i);

  // LOD1 spatial simplification + single-bone collapse
  const srcTris = mesh.geometry.index.count / 3;
  const lod1Geo = buildSimplifiedLodGeometry(THREE, mesh.geometry, { gridResolution: 5 });
  const lod1Tris = lod1Geo.index.count / 3;
  assert.ok(lod1Tris < srcTris, `expected reduced triangle count (${lod1Tris} < ${srcTris})`);
  const wArr = lod1Geo.attributes.skinWeight.array;
  for (let i = 0; i < wArr.length; i += 4) {
    assert.equal(wArr[i], 1);
    assert.equal(wArr[i + 1], 0);
    assert.equal(wArr[i + 2], 0);
    assert.equal(wArr[i + 3], 0);
  }

  // createBoneVatCrowd3D 3-LOD bucketing, 16-Byte packed upload, shader hooks, and Swarm sync
  const crowd = createBoneVatCrowd3D(THREE, {
    root,
    vatData: decoded,
    lod1Geometry: lod1Geo,
    capacity: 128,
    lod1Distance: 25,
    lod2Distance: 80,
    maxDistance: 240,
    castShadow: true,
  });

  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld(true);

  crowd.spawn({ x: 0, z: 10, rotationY: 0.4, clip: 'walk' });   // LOD0 (< 25)
  crowd.spawn({ x: 0, z: 45, rotationY: 1.2, clip: 'walk' });   // LOD1 (25..80)
  crowd.spawn({ x: 0, z: 120, rotationY: 2.0, clip: 'idle' });  // LOD2 (80..240)
  crowd.spawn({ x: 0, z: 300, rotationY: 0, clip: 'idle' });    // Culled (> 240)

  const st = crowd.update(1 / 60, { camera: cam });
  assert.equal(st.activeCount, 4);
  assert.equal(st.visibleCount, 3);
  assert.equal(st.culledCount, 1);
  assert.deepEqual(st.lodCounts, [1, 1, 1]);
  assert.equal(st.drawCalls, 3);
  assert.equal(st.uploadedBytes, 48, '3 visible instances * 16 bytes = 48 bytes');

  // Verify patched shaders (no instanceMatrix bloat, normal transformation in LOD0, atan billboard in LOD2)
  const lod0Shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  crowd.lodMeshes[0].material.onBeforeCompile(lod0Shader, null);
  assert.ok(lod0Shader.vertexShader.includes('objectNormal = _hgameVatNorm;'));
  assert.ok(lod0Shader.vertexShader.includes('aCrowdPacked'));
  assert.equal(lod0Shader.vertexShader.includes('instanceMatrix'), false);

  const lod2Shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  crowd.lodMeshes[2].material.onBeforeCompile(lod2Shader, null);
  assert.ok(lod2Shader.vertexShader.includes('atan(_toCamUv.x, _toCamUv.y)'));

  // Sync directly from SwarmSimulation
  const sim = createSwarmSimulation({ capacity: 32, useFlowField: false, separationStrength: 0 });
  sim.spawn({ x: 0, y: 12, rot: 0.5 });
  sim.spawn({ x: 0, y: 110, rot: -1.0 });
  const syncStats = crowd.syncFromSwarm(sim, { camera: cam });
  assert.equal(syncStats.visibleCount, 2);
  assert.deepEqual(syncStats.lodCounts, [1, 0, 1]);

  crowd.dispose();
  assert.equal(crowd.vatTexture, null);
});

test('scripts/bake-bone-vat.mjs: CLI bakes minimal rigged .gltf into valid HVAT .vat.bin', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-vat-cli-'));
  try {
    const gltfPath = path.join(tmp, 'mini.gltf');
    const outPath = path.join(tmp, 'mini.vat.bin');
    const jsonPath = path.join(tmp, 'mini.json');
    writeFileSync(gltfPath, buildMinimalGltfWithSkin(), 'utf8');

    const res = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'bake-bone-vat.mjs'), gltfPath, '--out', outPath, '--fps', '12', '--json', jsonPath],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 0, `bake-bone-vat CLI failed: ${res.stderr || res.stdout}`);

    const decoded = decodeBoneVatBinary(readFileSync(outPath));
    assert.equal(decoded.boneCount, 2);
    assert.equal(decoded.sampleFps, 12);
    assert.equal(decoded.clips.length, 1);
    assert.equal(decoded.clips[0].name, 'wave');

    const summary = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.equal(summary.boneCount, 2);
    assert.equal(summary.clips.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('SwarmSimulation 3-tier distance separation, coarse chunks, AOE chunks, and capacity > 100k', () => {
  const sim = createSwarmSimulation({
    capacity: 110000,
    nearSeparationRadius: 25,
    midSeparationRadius: 65,
    separationStrength: 3.0,
    useFlowField: false,
    ecsSlots: 128,
  });
  assert.equal(sim.capacity, 110000);

  // Near pair (<25m from focus): 60Hz exact spatial-hash push apart
  const nearA = sim.spawn({ x: 10, y: 0, speed: 0 });
  const nearB = sim.spawn({ x: 10.2, y: 0, speed: 0 });
  // Mid pair (25m..65m): staggered 4-frame update (ids 2 and 3 update on tick 2 and 3, reuse sepX/sepY on off-frames)
  const midA = sim.spawn({ x: 40, y: 0, speed: 0 });
  const midB = sim.spawn({ x: 40.2, y: 0, speed: 0 });
  // Far unit (>65m): skips neighbor probing, still records cellDensity
  const farU = sim.spawn({ x: 95, y: 0, speed: 2.0 });

  for (let t = 0; t < 4; t++) {
    sim.step(1 / 60, { heroX: 0, heroY: 0, focusX: 0, focusY: 0 });
  }
  assert.ok(Math.abs(sim.posX[nearB] - sim.posX[nearA]) > 0.2, 'Near pair should separate smoothly every frame');
  assert.ok(Math.abs(sim.posX[midB] - sim.posX[midA]) > 0.2, 'Mid pair should update via staggered 4-frame separation');
  assert.ok(sim.posX[farU] < 95, 'Far unit should advance toward hero without pairwise probing');

  // Coarse 32x32 chunk bounds + chunk-accelerated circle AOE (returns hit count; kills drain on next step)
  sim.ensureChunks();
  assert.equal(sim.chunkCount.reduce((a, b) => a + b, 0), 5);
  const hits = sim.applyCircleDamage({ x: 40, y: 0, radius: 2.0, damage: 250, knockback: 0 });
  assert.equal(hits, 2);
  const res = sim.step(1 / 60, { heroX: 0, heroY: 0, focusX: 0, focusY: 0 });
  assert.equal(res.killedThisStep, 2);
  assert.equal(sim.count, 3);
});

test('SceneCuller3D.classifySphere & BoneVatCrowd3D coarse chunk culling + GPU-Swarm texelFetch sync', () => {
  const culler = createSceneCuller3D();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 300);
  cam.position.set(0, 12, 30);
  cam.lookAt(0, 0, -20);
  cam.updateMatrixWorld();
  culler.beginFrame(cam);

  assert.equal(culler.classifySphere(0, 0, -20, 2), 2, 'Center point inside frustum classifies as strictly inside (2)');
  assert.equal(culler.classifySphere(0, 0, 100, 1), 0, 'Point behind camera classifies as outside (0)');

  const { root, clips } = createProceduralSkinnedHero(THREE);
  const crowd = createBoneVatCrowd3D(THREE, {
    root,
    animations: clips,
    capacity: 110000,
    lod1Distance: 30,
    lod2Distance: 70,
    maxDistance: 240,
  });
  assert.equal(crowd.capacity, 110000);

  const sim = createSwarmSimulation({ capacity: 64, useFlowField: false, separationStrength: 0 });
  sim.spawn({ x: 0, y: 12, rot: 0.4 });   // Near LOD0 (dist ~21.6 from cam z=30,y=12)
  sim.spawn({ x: 0, y: -20, rot: -0.5 }); // Mid LOD1 (dist ~51.4)
  sim.spawn({ x: 0, y: -80, rot: 1.0 });  // Far LOD2 (dist ~110.6)
  sim.spawn({ x: 0, y: 100, rot: 0 });    // Behind camera -> culled by chunk culler

  const stats = crowd.syncFromSwarm(sim, { camera: cam, culler });
  assert.equal(stats.visibleCount, 3);
  assert.equal(stats.culledCount, 1);
  assert.deepEqual(stats.lodCounts, [1, 1, 1]);

  // Pure-GPU Swarm integration + texelFetch shader check
  const gpuSwarm = createGpuSwarmWebGL2({ capacity: 128 });
  const spawned = gpuSwarm.spawnWave(64);
  assert.equal(spawned, 64);
  assert.equal(gpuSwarm.isGpuAccelerated, false);

  const ff = createFlowField2D({ cols: 32, rows: 32, cellSize: 4, originX: -64, originY: -64 });
  ff.compute({ x: 0, y: 0 });
  gpuSwarm.updateFlowField(ff);
  const prevX = gpuSwarm.data[0];
  const stepRes = gpuSwarm.step(1 / 30, { heroX: 0, heroY: 0 });
  assert.equal(stepRes.count, 64);
  assert.notEqual(gpuSwarm.data[0], prevX);

  const gpuStats = crowd.syncFromGpuSwarm(gpuSwarm, { lod0Count: 8, lod1Count: 16 });
  assert.equal(gpuStats.uploadedBytes, 0);
  assert.deepEqual(gpuStats.lodCounts, [8, 16, 40]);

  const lod0Shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  crowd.lodMeshes[0].material.onBeforeCompile(lod0Shader, null);
  assert.ok(lod0Shader.vertexShader.includes('uUseGpuSwarm'));
  assert.ok(lod0Shader.vertexShader.includes('texelFetch(uGpuSwarmTex'));

  gpuSwarm.clear();
  assert.equal(gpuSwarm.count, 0);
  gpuSwarm.dispose();
  crowd.dispose();
});

test('SpriteCrowd2D zero-copy bindSwarm/bindGpuSwarm + WebGL2D 16-Byte compact instancing + chunk culling', () => {
  const drawCalls = [];
  const uploadedSizes = [];
  const gl = {
    TEXTURE0: 33984,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TEXTURE_2D: 3553,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    NEAREST: 9728,
    LINEAR: 9729,
    SCISSOR_TEST: 3089,
    COLOR_BUFFER_BIT: 16384,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    deleteProgram: () => {},
    getUniformLocation: () => ({}),
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    deleteVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: (_t, _off, data) => { uploadedSizes.push(data.byteLength); },
    deleteBuffer: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribDivisor: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    deleteTexture: () => {},
    disable: () => {},
    enable: () => {},
    scissor: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    blendFunc: () => {},
    useProgram: () => {},
    activeTexture: () => {},
    uniform1i: () => {},
    uniform4f: () => {},
    drawArraysInstanced: (mode, first, vertexCount, instCount) => {
      assert.equal(mode, gl.TRIANGLE_STRIP);
      assert.equal(first, 0);
      assert.equal(vertexCount, 4);
      drawCalls.push(instCount);
    },
  };
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: (kind) => (kind === 'webgl2' ? gl : null),
  };

  const adapter = createWebGL2DAdapter({ canvas, width: 800, height: 600, maxBatchInstances: 200000 });
  const scene = new Scene('compact-2d');
  const sim = createSwarmSimulation({ capacity: 120000, useFlowField: false, separationStrength: 0 });
  for (let i = 0; i < 40; i++) {
    sim.spawn({ x: (i % 10) * 10 - 45, y: Math.floor(i / 10) * 10 - 15 });
  }
  // Off-screen unit well outside 800x600 camera bounds -> chunk-culled!
  sim.spawn({ x: 1000, y: 1000 });

  const crowd = new SpriteCrowd2D({ capacity: 120000, width: 12, height: 12, shape: 'circle' });
  const synced = sim.syncToSpriteCrowd2D(crowd);
  assert.equal(synced, 41);
  assert.equal(crowd.count, 41);

  const host = scene.add(new Entity({ name: 'swarm-2d-host' }));
  host.addComponent(crowd);
  scene._setActive(true);
  adapter.render(scene, null);

  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0], 40, 'Off-screen chunk should be culled');
  assert.equal(uploadedSizes[0], 40 * 16, 'Zero-relay compact VBO uploads strictly 16 Bytes per visible unit');

  const gpuSwarm = createGpuSwarmWebGL2({ capacity: 64 });
  gpuSwarm.spawnWave(12);
  crowd.bindGpuSwarm(gpuSwarm);
  assert.equal(crowd.count, 12);
  drawCalls.length = 0;
  adapter.render(scene, null);
  assert.equal(drawCalls[0], 12);

  crowd.unbindSwarm();
  gpuSwarm.dispose();
  adapter.dispose();
});

// Scorecard R5 evidence: LOD hysteresis, Bone-VAT bitfield/float16/binary round-trip,
// static batching, vertex quantization, floating origin rebasing, and frustum/occlusion culling.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createModelLod3D,
  packCrowdInstanceBitfield,
  unpackCrowdInstanceBitfield,
  float32ToFloat16,
  float16ToFloat32,
  encodeBoneVatBinary,
  decodeBoneVatBinary,
} from '../assets/runtime/integrations/model3d.js';
import {
  createFrustumCuller3D,
  createOcclusionCuller3D,
  mergeStaticMeshesByMaterial3D,
  quantizeBufferGeometry3D,
} from '../assets/runtime/integrations/culling3d.js';
import { createFloatingOrigin } from '../assets/runtime/world/open-world.js';

test('R5 LOD hysteresis prevents boundary thrashing and Bone-VAT packing/binary round-trips', () => {
  const events = [];
  const fakeCrowd = {
    nextId: 0,
    spawn() { return this.nextId++; },
    kill(id) { events.push(`kill:${id}`); },
    setPlayback() { return true; },
    setTransform() { return true; },
    setDistanceFallback() {},
  };
  const makeSlot = (name) => () => ({
    sync() { events.push(`sync:${name}`); },
    dispose() { events.push(`dispose:${name}`); },
  });
  const lod = createModelLod3D({
    near: makeSlot('near'),
    crowd: fakeCrowd,
    far: makeSlot('far'),
    crowdDistance: 20,
    farDistance: 80,
    hysteresis: 0.1,
  });
  const state = { x: 0, y: 0, z: 0, rotationY: 0, clip: 'idle', time: 0 };
  lod.update(10, state);
  assert.equal(lod.tier, 'near');

  // Inside hysteresis dead band [18, 22]: stays 'near'
  lod.update(21, state);
  assert.equal(lod.tier, 'near');

  // Crosses enter threshold (22): moves to 'crowd'
  lod.update(23, state);
  lod.update(23, state);
  assert.equal(lod.tier, 'crowd');

  // Back into dead band (19 > 18): stays 'crowd'
  lod.update(19, state);
  assert.equal(lod.tier, 'crowd');

  // Crosses leave threshold (< 18): returns to 'near'
  lod.update(17, state);
  lod.update(17, state);
  assert.equal(lod.tier, 'near');
  lod.dispose();

  // Crowd bitfield 16B packing
  const packed = packCrowdInstanceBitfield(Math.PI * 0.75, 5, 0.5, 0x2a);
  const unpacked = unpackCrowdInstanceBitfield(packed);
  assert.equal(unpacked.animId, 5);
  assert.equal(unpacked.flags, 0x2a);
  assert.ok(Math.abs(unpacked.yawRad - Math.PI * 0.75) < 0.02);
  assert.ok(Math.abs(unpacked.animSeed - 0.5) < 0.005);

  // Float16 + HVAT binary round-trip
  const h = float32ToFloat16(-3.25);
  assert.ok(Math.abs(float16ToFloat32(h) - (-3.25)) < 1e-3);
  const width = 4;
  const height = 2;
  const data = new Uint16Array(width * height * 4);
  data[0] = h;
  data[7] = float32ToFloat16(1.5);
  const bin = encodeBoneVatBinary({ boneCount: 2, width, height, sampleFps: 30, clips: [{ name: 'idle', startRow: 0, frames: 2 }], data });
  const dec = decodeBoneVatBinary(bin);
  assert.equal(dec.boneCount, 2);
  assert.equal(dec.width, width);
  assert.equal(dec.height, height);
  assert.equal(dec.data[0], h);
  assert.equal(dec.clips[0].name, 'idle');
});

test('R5 static batching merges shared materials and quantizeBufferGeometry3D shrinks normals/UVs', () => {
  const matA = new THREE.MeshBasicMaterial();
  const matB = new THREE.MeshBasicMaterial();
  const g1 = new THREE.BoxGeometry(1, 1, 1);
  const g2 = new THREE.BoxGeometry(1, 1, 1);
  const g3 = new THREE.BoxGeometry(1, 1, 1);
  const m1 = new THREE.Mesh(g1, matA); m1.position.set(0, 0, 0);
  const m2 = new THREE.Mesh(g2, matA); m2.position.set(3, 0, 0);
  const m3 = new THREE.Mesh(g3, matB); m3.position.set(6, 0, 0);

  const merged = mergeStaticMeshesByMaterial3D(THREE, [m1, m2, m3]);
  assert.equal(merged.meshes.length, 2, '3 meshes with 2 materials merge into 2 batches');
  assert.equal(merged.stats.totalVertices, g1.attributes.position.count * 3);

  const q = quantizeBufferGeometry3D(THREE, g1);
  assert.ok(q.geometry.attributes.normal.array instanceof Int8Array);
  assert.ok(q.geometry.attributes.uv.array instanceof Uint16Array);
  assert.ok(q.stats.quantizedBytes < q.stats.originalBytes, 'quantization reduces attribute byte footprint');
  assert.equal(q.geometry.attributes.position.count, g1.attributes.position.count);
  assert.equal(q.geometry.index.count, g1.index.count);
});

test('R5 floating origin rebases coordinates and frustum + occlusion culling rejects hidden spheres', () => {
  const origin = createFloatingOrigin({ threshold: 100, snapGrid: 50 });
  const obj = new THREE.Object3D();
  obj.position.set(140, 2, -60);
  origin.registerObject3D(obj);

  const res = origin.update([140, 2, -60]);
  assert.equal(res.shifted, true);
  assert.deepEqual(res.origin, [150, 0, -50]);
  // World coordinate reconstructed from shifted local + origin matches original (140, 2, -60)
  const world = origin.localToWorld(obj.position.x, obj.position.y, obj.position.z);
  assert.deepEqual(world, [140, 2, -60]);

  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  cam.position.set(0, 1, 10);
  cam.lookAt(0, 1, 0);
  cam.updateMatrixWorld(true);

  const frustum = createFrustumCuller3D({ maxDistance: 150 });
  frustum.updateFromCamera(cam);
  assert.equal(frustum.intersectsSphere(0, 1, 0, 1), true);
  assert.equal(frustum.intersectsSphere(0, 1, 50, 1), false, 'behind camera is culled');

  const occ = createOcclusionCuller3D();
  occ.addOccluderAABB({ id: 'wall', min: [-5, -1, 4], max: [5, 6, 5] });
  occ.beginFrame(cam, frustum);
  assert.equal(occ.isSphereOccluded(0, 1, 0, 0.5), true, 'sphere behind tall wall is occluded');
  assert.equal(occ.isSphereOccluded(0, 1, 8, 0.5), false, 'sphere in front of wall is visible');
});

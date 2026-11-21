import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createSpringBoneChain3D,
  createInertialBlend3D,
  createNetworkStateSync,
  createSpatialAoiFilter,
} from '../assets/runtime/index.js';
import {
  createSharedMaterialBlock3D,
  createComposableMaterial3D,
} from '../assets/runtime/integrations/material-graph3d.js';

test('S2 createSpringBoneChain3D simulates hair/cape wind sway with sphere collider pushout', () => {
  const b0 = new THREE.Bone(); b0.position.set(0, 2, 0);
  const b1 = new THREE.Bone(); b1.position.set(0, 0.3, 0); b0.add(b1);
  const b2 = new THREE.Bone(); b2.position.set(0, 0.3, 0); b1.add(b2);

  const spring = createSpringBoneChain3D({
    bones: [b0, b1, b2],
    stiffness: 18,
    drag: 0.2,
    gravity: [0, -9.8, 0],
    wind: [12, 0, 4],
    colliders: [{ center: [0, 2.25, 0], radius: 0.45 }],
    boneLength: 0.3,
    tipRadius: 0.05,
  });

  assert.equal(spring.boneCount, 3);
  const initialTips = spring.getTipPositions();
  for (let i = 0; i < 30; i++) {
    spring.update(1 / 60);
  }
  const settledTips = spring.getTipPositions();
  let moved = false;
  for (let i = 0; i < settledTips.length; i++) {
    const t = settledTips[i];
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z));
    if (Math.hypot(t.x - initialTips[i].x, t.y - initialTips[i].y, t.z - initialTips[i].z) > 0.02) {
      moved = true;
    }
    const distToCol = Math.hypot(t.x - 0, t.y - 2.25, t.z - 0);
    assert.ok(distToCol >= 0.499, `Spring tip ${i} must stay pushed outside collider + tipRadius (${distToCol})`);
  }
  assert.ok(moved, 'Wind/gravity must move SpringBone chain away from rest');
  spring.reset();
});

test('S2 createInertialBlend3D smoothly decays captured pose delta over half-life steps', () => {
  const b0 = new THREE.Bone();
  b0.position.set(0, 0, 0);
  b0.quaternion.set(0, 0, 0, 1);

  const prevPoses = [{ position: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0.70710678, z: 0, w: 0.70710678 } }];
  const blend = createInertialBlend3D({ halfLife: 0.05 });
  assert.equal(blend.capture([b0], prevPoses), 1);
  assert.equal(blend.active, true);

  assert.equal(blend.apply([b0], 0.05), true);
  assert.ok(Math.abs(blend.weight - 0.5) < 1e-6);
  assert.ok(b0.position.x > 0.45 && b0.position.x < 0.55);

  b0.position.set(0, 0, 0);
  b0.quaternion.set(0, 0, 0, 1);
  for (let i = 0; i < 20; i++) blend.apply([b0], 0.05);
  assert.equal(blend.active, false);
  assert.equal(blend.weight, 0);
});

test('R3 createComposableMaterial3D windSway compiles vertex shader module and cache key', () => {
  const shared = createSharedMaterialBlock3D({ uTime: 0 });
  const mat = createComposableMaterial3D(THREE, {
    color: 0x22c55e,
    sharedBlock: shared,
    windSway: { amplitude: 0.18, frequency: 3.0, direction: [1, 0, 0.2], minY: 0, maxY: 2.0 },
  });

  assert.ok(mat.customProgramCacheKey().includes('wind:height'));
  const mockShader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\nvoid main() {}',
    fragmentShader: '#include <color_fragment>\nvoid main() {}',
  };
  mat.onBeforeCompile(mockShader);
  assert.ok(mockShader.vertexShader.includes('uWindDir') && mockShader.vertexShader.includes('_wSway'));
  assert.equal(mockShader.uniforms.uWindTime, shared.uniforms.uTime);
  mat.userData.hgameMaterialGraph.setWindTime(1.5);
  assert.equal(shared.get('uTime'), 1.5);
  mat.dispose();
});

test('N1 createSpatialAoiFilter culls distant entities with hysteresis and slashes binary delta size', () => {
  const aoi = createSpatialAoiFilter({ radius: 20, hysteresis: 5 });
  const room = {};
  for (let i = 0; i < 100; i++) {
    room[`e${i}`] = { x: i * 4, z: 0, hp: 100 };
  }

  const f1 = aoi.filterForViewer('p1', { x: 0, z: 0 }, room);
  assert.equal(f1.stats.total, 100);
  assert.equal(f1.stats.visible, 6); // x = 0, 4, 8, 12, 16, 20
  assert.equal(f1.enteredIds.length, 6);

  // Move e5 from x=20 to x=23 (inside exit radius 25): stays visible via hysteresis
  room.e5.x = 23;
  const f2 = aoi.filterForViewer('p1', { x: 0, z: 0 }, room);
  assert.ok('e5' in f2.visibleState);
  assert.equal(f2.leftIds.length, 0);

  // Move e5 beyond x=26 (past exit radius 25): leaves AOI
  room.e5.x = 26;
  const f3 = aoi.filterForViewer('p1', { x: 0, z: 0 }, room);
  assert.ok(!('e5' in f3.visibleState));
  assert.deepEqual(f3.leftIds, ['e5']);

  const sync = createNetworkStateSync();
  const fullBytes = sync.encodeDeltaBinary({}, room, { tick: 1, timestampMs: 20, isKeyframe: true });
  const aoiBytes = sync.encodeDeltaBinary({}, f1.visibleState, { tick: 1, timestampMs: 20, isKeyframe: true });
  assert.ok(aoiBytes.byteLength < fullBytes.byteLength * 0.25, `AOI must cut packet bytes cleanly (${aoiBytes.byteLength} vs ${fullBytes.byteLength})`);
});

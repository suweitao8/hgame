import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createShadowAtlas3D,
  createSkeleton2D,
} from '../assets/runtime/index.js';

test('Phase T4-C: createShadowAtlas3D allocates packed tiles cleanly and enforces capacity', () => {
  const atlas = createShadowAtlas3D(THREE, { atlasSize: 1024, tileSize: 512 });
  assert.equal(atlas.getStats().capacity, 4);
  assert.equal(atlas.getStats().hasDepthTexture, true);

  const t0 = atlas.allocateTile('torch_left');
  const t1 = atlas.allocateTile('torch_right');
  const t2 = atlas.allocateTile('skill_spot');
  const t3 = atlas.allocateTile('boss_spot');
  assert.deepEqual(t0.uvRect, [0, 0, 0.5, 0.5]);
  assert.deepEqual(t1.uvRect, [0.5, 0, 0.5, 0.5]);
  assert.deepEqual(t2.uvRect, [0, 0.5, 0.5, 0.5]);
  assert.deepEqual(t3.uvRect, [0.5, 0.5, 0.5, 0.5]);
  assert.equal(atlas.allocateTile('overflow'), null);

  assert.equal(atlas.releaseTile('torch_right'), true);
  const reused = atlas.allocateTile('new_spot');
  assert.equal(reused.index, 1);

  atlas.dispose();
});

test('Phase T4-C: createSkeleton2D runs topological FK, pose blending, and analytical 2-bone 2D IK', () => {
  const skel = createSkeleton2D({
    bones: [
      { id: 'hip', x: 100, y: 200, angle: 0, length: 20 },
      { id: 'upperArm', parent: 'hip', x: 10, y: -10, angle: 0, length: 40 },
      { id: 'foreArm', parent: 'upperArm', x: 40, y: 0, angle: 0, length: 30 },
    ],
    slots: [
      { id: 'armTex', bone: 'upperArm', width: 40, height: 10 },
      { id: 'handTex', bone: 'foreArm', width: 30, height: 8 },
    ],
  });

  assert.equal(skel.boneCount, 3);
  const targetX = 145;
  const targetY = 175;
  assert.equal(skel.solveTwoBoneIk2D('upperArm', 'foreArm', targetX, targetY, 1), true);

  const fore = skel.getBoneWorld('foreArm');
  const distErr = Math.hypot(fore.tipX - targetX, fore.tipY - targetY);
  assert.ok(distErr < 0.05, `2-bone 2D IK tip error too high: ${distErr}`);

  skel.applyPose({ upperArm: { angle: 0 }, foreArm: { angle: 0 } }, { upperArm: { angle: 1.0 }, foreArm: { angle: 0.5 } }, 0.5);
  const blended = skel.getBoneWorld('foreArm');
  assert.ok(Math.abs(blended.angle - 0.75) < 1e-6);
  assert.equal(skel.getRenderSlots().length, 2);
});

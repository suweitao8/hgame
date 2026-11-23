import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { HGame, createUpperLowerMasks } from '../assets/runtime/index.js';
import {
  createUpperLowerMasks as createUpperLowerFromModel3D,
  createAnimator3D,
} from '../assets/runtime/integrations/model3d.js';

function buildRig(names) {
  const hips = new THREE.Bone(); hips.name = names.hips;
  const spine = new THREE.Bone(); spine.name = names.spine;
  const chest = new THREE.Bone(); chest.name = names.chest;
  const head = new THREE.Bone(); head.name = names.head;
  const rightArm = new THREE.Bone(); rightArm.name = names.arm;
  const leftLeg = new THREE.Bone(); leftLeg.name = names.leg;
  const rightLeg = new THREE.Bone(); rightLeg.name = names.legR;

  hips.add(spine, leftLeg, rightLeg);
  spine.add(chest);
  chest.add(head, rightArm);

  const root = new THREE.Group();
  root.name = 'Character';
  root.add(hips);
  return { root, hips, spine, chest, head, rightArm, leftLeg, rightLeg };
}

test('createUpperLowerMasks auto-detects Mixamo, UE/Blender spine_01, and generic Spine rigs', () => {
  assert.equal(typeof HGame.createUpperLowerMasks, 'function');
  assert.equal(createUpperLowerMasks, createUpperLowerFromModel3D);

  const mixamo = buildRig({
    hips: 'mixamorig:Hips',
    spine: 'mixamorig:Spine',
    chest: 'mixamorig:Spine2',
    head: 'mixamorig:Head',
    arm: 'mixamorig:RightArm',
    leg: 'mixamorig:LeftUpLeg',
    legR: 'mixamorig:RightUpLeg',
  });
  const mMasks = createUpperLowerMasks(mixamo.root);
  assert.equal(mMasks.spineName, 'mixamorig:Spine');
  assert.equal(mMasks.upperMask.allows('mixamorig:Spine.quaternion'), true);
  assert.equal(mMasks.upperMask.allows('mixamorig:RightArm.quaternion'), true);
  assert.equal(mMasks.upperMask.allows('mixamorig:Head.quaternion'), true);
  assert.equal(mMasks.upperMask.allows('mixamorig:Hips.position'), false);
  assert.equal(mMasks.upperMask.allows('mixamorig:LeftUpLeg.quaternion'), false);
  assert.equal(mMasks.lowerMask.allows('mixamorig:Hips.position'), true);
  assert.equal(mMasks.lowerMask.allows('mixamorig:LeftUpLeg.quaternion'), true);
  assert.equal(mMasks.lowerMask.allows('mixamorig:RightArm.quaternion'), false);

  const ue = buildRig({
    hips: 'pelvis',
    spine: 'spine_01',
    chest: 'spine_02',
    head: 'head',
    arm: 'upperarm_r',
    leg: 'thigh_l',
    legR: 'thigh_r',
  });
  const ueMasks = createUpperLowerMasks(new THREE.Skeleton([ue.hips, ue.spine, ue.chest, ue.head, ue.rightArm, ue.leftLeg, ue.rightLeg]));
  assert.equal(ueMasks.spineName, 'spine_01');
  assert.equal(ueMasks.upperMask.allows('spine_01.quaternion'), true);
  assert.equal(ueMasks.lowerMask.allows('pelvis.quaternion'), true);
  assert.equal(ueMasks.lowerMask.allows('upperarm_r.quaternion'), false);

  const generic = buildRig({
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Chest',
    head: 'Head',
    arm: 'RightArm',
    leg: 'LeftLeg',
    legR: 'RightLeg',
  });
  const noSpineInUpper = createUpperLowerMasks(generic.root, {
    spineBone: 'Spine',
    includeSpineInUpper: false,
  });
  assert.equal(noSpineInUpper.upperMask.allows('Spine.quaternion'), false);
  assert.equal(noSpineInUpper.upperMask.allows('Chest.quaternion'), true);
  assert.equal(noSpineInUpper.lowerMask.allows('Spine.quaternion'), true);
  assert.equal(noSpineInUpper.lowerMask.allows('Chest.quaternion'), false);
});

test('createUpperLowerMasks drives split 2-layer createAnimator3D locomotion + upper attack cleanly', () => {
  const rig = buildRig({
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Chest',
    head: 'Head',
    arm: 'RightArm',
    leg: 'LeftLeg',
    legR: 'RightLeg',
  });

  const makeQuatTrack = (bone, xVal) => new THREE.QuaternionKeyframeTrack(
    `${bone}.quaternion`,
    [0, 1],
    [0, 0, 0, 1, xVal, 0, 0, Math.sqrt(Math.max(0, 1 - xVal * xVal))],
  );

  const runClip = new THREE.AnimationClip('run', 1, [
    makeQuatTrack('Hips', 0.1),
    makeQuatTrack('LeftLeg', 0.4),
    makeQuatTrack('RightLeg', -0.4),
    makeQuatTrack('Spine', 0.15),
    makeQuatTrack('RightArm', 0.35),
  ]);
  const attackClip = new THREE.AnimationClip('attack', 1, [
    makeQuatTrack('LeftLeg', 0.05),
    makeQuatTrack('Spine', 0.25),
    makeQuatTrack('Chest', 0.3),
    makeQuatTrack('RightArm', 0.7),
  ]);

  const { upperMask, lowerMask } = createUpperLowerMasks(rig.root);
  const mixer = new THREE.AnimationMixer(rig.root);
  const animator = createAnimator3D({
    mixer,
    clips: [runClip, attackClip],
    layers: [
      { name: 'lower', mask: lowerMask, initialState: 'run', states: { run: { clip: 'run', loop: true } } },
      { name: 'upper', mask: upperMask, initialState: 'attack', states: { attack: { clip: 'attack', loop: false } } },
    ],
  });

  animator.update(0.5);

  const lowerFiltered = lowerMask.filterClip(runClip).tracks.map(t => t.name);
  const upperFiltered = upperMask.filterClip(attackClip).tracks.map(t => t.name);
  assert.deepEqual(lowerFiltered, ['Hips.quaternion', 'LeftLeg.quaternion', 'RightLeg.quaternion']);
  assert.deepEqual(upperFiltered, ['Spine.quaternion', 'Chest.quaternion', 'RightArm.quaternion']);

  // Lower body leg follows run clip (~0.2), upper body arm follows attack clip (~0.35+) cleanly without bleed
  assert.ok(rig.leftLeg.rotation.x > 0.15);
  assert.ok(rig.rightArm.rotation.x > 0.5);
  animator.dispose();
});

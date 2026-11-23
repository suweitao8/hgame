import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { createBoneMap3D, retargetClip3D } from '../assets/runtime/animation/retarget3d.js';

function buildRig(THREE, { prefix, scale, extraSpine = false, spineTilt = 0, armLocalTwist = 0 }) {
  const root = new THREE.Group();
  root.name = `${prefix}Root`;

  const hips = new THREE.Bone();
  hips.name = prefix === 'mixamorig_' ? 'mixamorig_Hips' : 'DEF-hips';
  hips.position.set(0, 1.0 * scale, 0);

  const spine = new THREE.Bone();
  spine.name = prefix === 'mixamorig_' ? 'mixamorig_Spine' : 'DEF-spine';
  spine.position.set(0, 0.3 * scale, 0);
  spine.rotation.z = spineTilt;

  let upperParent = spine;
  const bones = [hips, spine];

  if (extraSpine) {
    const spine2 = new THREE.Bone();
    spine2.name = 'DEF-chest_extra';
    spine2.position.set(0, 0.2 * scale, 0);
    spine.add(spine2);
    bones.push(spine2);
    upperParent = spine2;
  }

  const upperArm = new THREE.Bone();
  upperArm.name = prefix === 'mixamorig_' ? 'mixamorig_LeftArm' : 'DEF-upper_arm.L';
  upperArm.position.set(0.2 * scale, 0.2 * scale, 0);
  // Cancel parent tilt in world space and twist locally around Y so rest world Y direction is identical
  const qCancel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -spineTilt);
  const qTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), armLocalTwist);
  upperArm.quaternion.copy(qCancel).multiply(qTwist);

  const foreArm = new THREE.Bone();
  foreArm.name = prefix === 'mixamorig_' ? 'mixamorig_LeftForeArm' : 'DEF-forearm.L';
  foreArm.position.set(0, 0.3 * scale, 0);
  foreArm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -armLocalTwist);

  const hand = new THREE.Bone();
  hand.name = prefix === 'mixamorig_' ? 'mixamorig_LeftHand' : 'DEF-hand.L';
  hand.position.set(0, 0.25 * scale, 0);

  root.add(hips);
  hips.add(spine);
  upperParent.add(upperArm);
  upperArm.add(foreArm);
  foreArm.add(hand);
  bones.push(upperArm, foreArm, hand);

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { root, skeleton, hips, spine, upperArm, foreArm, hand };
}

test('createBoneMap3D maps Mixamo and Blender DEF-* bone conventions automatically', () => {
  const src = buildRig(THREE, { prefix: 'mixamorig_', scale: 1.0 });
  const tgt = buildRig(THREE, { prefix: 'DEF-', scale: 1.8, extraSpine: true });

  const map = createBoneMap3D(src.skeleton, tgt.skeleton);
  assert.equal(map['DEF-hips'], 'mixamorig_Hips');
  assert.equal(map['DEF-spine'], 'mixamorig_Spine');
  assert.equal(map['DEF-upper_arm.L'], 'mixamorig_LeftArm');
  assert.equal(map['DEF-forearm.L'], 'mixamorig_LeftForeArm');
  assert.equal(map['DEF-hand.L'], 'mixamorig_LeftHand');
  assert.equal(map['DEF-chest_extra'], undefined);
});

test('retargetClip3D preserves end-effector world orientation (<1e-3 rad) and scales hip height across proportions', () => {
  const src = buildRig(THREE, { prefix: 'mixamorig_', scale: 1.0, spineTilt: 0.25, armLocalTwist: 0.4 });
  const tgt = buildRig(THREE, { prefix: 'DEF-', scale: 1.8, extraSpine: true, spineTilt: -0.3, armLocalTwist: -0.5 });

  const boneMap = createBoneMap3D(src.skeleton, tgt.skeleton);

  const times = new Float32Array([0, 0.5, 1.0]);
  const hipPos = new Float32Array([
    0, 1.0, 0,
    0, 1.2, 0,
    0, 1.0, 0,
  ]);
  const q0 = src.spine.quaternion.clone();
  const q1 = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35));

  const arm0 = src.upperArm.quaternion.clone();
  const arm1 = arm0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.65));

  const fore0 = src.foreArm.quaternion.clone();
  const fore1 = fore0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.55));

  const packQuats = (a, b, c) => new Float32Array([
    a.x, a.y, a.z, a.w,
    b.x, b.y, b.z, b.w,
    c.x, c.y, c.z, c.w,
  ]);

  const srcClip = new THREE.AnimationClip('wave', 1.0, [
    new THREE.VectorKeyframeTrack('mixamorig_Hips.position', times, hipPos),
    new THREE.QuaternionKeyframeTrack('mixamorig_Spine.quaternion', times, packQuats(q0, q1, q0)),
    new THREE.QuaternionKeyframeTrack('mixamorig_LeftArm.quaternion', times, packQuats(arm0, arm1, arm0)),
    new THREE.QuaternionKeyframeTrack('mixamorig_LeftForeArm.quaternion', times, packQuats(fore0, fore1, fore0)),
  ]);

  const restHandYBefore = tgt.hand.getWorldQuaternion(new THREE.Quaternion()).clone();
  const tgtClip = retargetClip3D(THREE, srcClip, {
    source: src.skeleton,
    target: tgt.skeleton,
    boneMap,
    hipBone: 'Hips',
    scalePosition: 'auto',
    fps: 30,
  });

  // Ensure rest pose was restored cleanly
  const restHandAfter = tgt.hand.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(restHandYBefore.angleTo(restHandAfter) < 1e-6);

  const srcMixer = new THREE.AnimationMixer(src.root);
  const tgtMixer = new THREE.AnimationMixer(tgt.root);
  srcMixer.clipAction(srcClip).play();
  tgtMixer.clipAction(tgtClip).play();

  const qS = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const vS = new THREE.Vector3();
  const vT = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const sampleTime of [0, 0.25, 0.5, 0.75, 1.0]) {
    srcMixer.setTime(sampleTime);
    tgtMixer.setTime(sampleTime);
    src.root.updateMatrixWorld(true);
    tgt.root.updateMatrixWorld(true);

    src.hand.getWorldQuaternion(qS);
    tgt.hand.getWorldQuaternion(qT);
    const dirS = up.clone().applyQuaternion(qS);
    const dirT = up.clone().applyQuaternion(qT);
    const dirErr = dirS.angleTo(dirT);
    assert.ok(dirErr < 1e-3, `Expected hand world direction error < 1e-3 rad at t=${sampleTime}, got ${dirErr}`);

    src.hips.getWorldPosition(vS);
    tgt.hips.getWorldPosition(vT);
    const expectedHipsY = 1.8 + (vS.y - 1.0) * 1.8;
    assert.ok(Math.abs(vT.y - expectedHipsY) < 1e-3, `Expected hip height ${expectedHipsY}, got ${vT.y}`);
  }
});

test('createBoneMap3D handles mixamorig: colon prefix and custom aliases', () => {
  const b1 = new THREE.Bone(); b1.name = 'mixamorig:Hips';
  const b2 = new THREE.Bone(); b2.name = 'TorsoCustom';
  const t1 = new THREE.Bone(); t1.name = 'pelvis';
  const t2 = new THREE.Bone(); t2.name = 'Chest';
  const map = createBoneMap3D([b1, b2], [t1, t2], { aliases: { Chest: 'TorsoCustom' } });
  assert.equal(map.pelvis, 'mixamorig:Hips');
  assert.equal(map.Chest, 'TorsoCustom');
});

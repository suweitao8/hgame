// Scorecard S2 evidence: 1D/2D blend trees, animator FSM + events, TwoBone/LookAt/FABRIK IK,
// root motion, morph targets, spring bones, inertialization, and cross-skeleton retargeting.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createBlendTree1D,
  createBlendTree2D,
  createAnimator3D,
  solveTwoBoneIK,
  solveLookAtIK,
  solveFabrikIK,
  extractRootMotion,
  blendMorphTargets,
  createSpringBoneChain3D,
  createInertialBlend3D,
} from '../assets/runtime/animation/animator3d.js';
import { createBoneMap3D, retargetClip3D } from '../assets/runtime/animation/retarget3d.js';

function makeChain(lengths = [1, 1, 1]) {
  const bones = [];
  let prev = null;
  for (let i = 0; i <= lengths.length; i++) {
    const b = new THREE.Bone();
    b.name = `Bone_${i}`;
    if (i > 0) {
      b.position.set(0, lengths[i - 1], 0);
      prev.add(b);
    }
    bones.push(b);
    prev = b;
  }
  bones[0].updateMatrixWorld(true);
  return bones;
}

test('S2 BlendTree 1D/2D and Animator FSM transition + keyframe events', () => {
  const bt1 = createBlendTree1D([
    { clip: 'idle', threshold: 0 },
    { clip: 'walk', threshold: 2 },
    { clip: 'run', threshold: 6 },
  ]);
  const w1 = bt1.evaluate(1);
  assert.ok(Math.abs(w1.reduce((s, e) => s + e.weight, 0) - 1) < 1e-6);

  const bt2 = createBlendTree2D([
    { clip: 'idle', x: 0, y: 0 },
    { clip: 'fwd', x: 0, y: 1 },
    { clip: 'strafe', x: 1, y: 0 },
  ]);
  const w2 = bt2.evaluate(0.4, 0.4);
  assert.ok(w2.every((e) => e.weight >= 0));
  assert.ok(Math.abs(w2.reduce((s, e) => s + e.weight, 0) - 1) < 1e-5);

  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'Hips';
  root.add(hips);
  const mixer = new THREE.AnimationMixer(root);
  const idle = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0.1, 0])]);
  const walk = new THREE.AnimationClip('walk', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 1])]);
  const fired = [];
  const anim = createAnimator3D({
    mixer,
    clips: [idle, walk],
    parameters: { speed: 0 },
    events: { walk: [{ time: 0.2, name: 'step' }] },
    onEvent: (e) => fired.push(e),
    layers: [{
      name: 'base',
      initialState: 'idle',
      states: { idle: { clip: 'idle' }, walk: { clip: 'walk' } },
      transitions: [{ from: 'idle', to: 'walk', conditions: [{ op: '>', param: 'speed', value: 0.5 }], duration: 0.05 }],
    }],
  });
  anim.setParam('speed', 1.2);
  anim.update(0.3);
  assert.equal(anim.getState('base'), 'walk');
  assert.ok(fired.some((e) => e.name === 'step' && e.clipName === 'walk'));
});

test('S2 IK solvers, root motion, morph blend, spring chain, and inertialization', () => {
  // Two-bone IK
  const chain2 = makeChain([1, 1]);
  const target2 = new THREE.Vector3(1.1, 1.2, 0.3);
  assert.equal(solveTwoBoneIK(chain2[0], chain2[1], chain2[2], target2, new THREE.Vector3(0, 1, 1)), true);
  const out2 = new THREE.Vector3();
  chain2[2].getWorldPosition(out2);
  assert.ok(out2.distanceTo(target2) < 1e-2);

  // LookAt IK clamped
  const head = new THREE.Bone();
  head.updateMatrixWorld(true);
  assert.equal(solveLookAtIK(head, new THREE.Vector3(0, 0, -5), { maxAngle: Math.PI / 4, forwardAxis: [0, 0, 1] }), true);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
  assert.ok(Math.abs(Math.acos(Math.max(-1, Math.min(1, fwd.z))) - Math.PI / 4) < 1e-2);

  // FABRIK 3-segment chain
  const chain3 = makeChain([1, 1, 1]);
  const target3 = new THREE.Vector3(1.5, 1.6, 0.5);
  assert.equal(solveFabrikIK(chain3, target3, { iterations: 20, tolerance: 1e-3 }), true);
  const out3 = new THREE.Vector3();
  chain3[3].getWorldPosition(out3);
  assert.ok(out3.distanceTo(target3) < 0.05);

  // Root motion delta
  const rootBone = new THREE.Bone();
  const prev = { x: 0, y: 0, z: 0, yaw: 0, initialized: false };
  assert.deepEqual(extractRootMotion(rootBone, prev), { dx: 0, dy: 0, dz: 0, dyaw: 0 });
  rootBone.position.set(1.5, 0, -0.5);
  const dm = extractRootMotion(rootBone, prev);
  assert.deepEqual(dm, { dx: 1.5, dy: 0, dz: -0.5, dyaw: 0 });

  // Morph targets
  const mesh = { morphTargetDictionary: { smile: 0 }, morphTargetInfluences: [0] };
  assert.equal(blendMorphTargets(mesh, { smile: 0.8 }, 0.5), 1);
  assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.4) < 1e-6);

  // SpringBone chain responds to wind
  const springBones = makeChain([0.5, 0.5]);
  const spring = createSpringBoneChain3D({ bones: springBones, wind: [25, 0, 0], gravity: [0, -9.8, 0] });
  const tips0 = spring.getTipPositions();
  spring.update(0.02);
  spring.update(0.02);
  const tips1 = spring.getTipPositions();
  assert.ok(tips1[1].x > tips0[1].x, 'spring chain deflects along +X wind');

  // Inertialization decays smoothly over time
  const b = new THREE.Bone();
  const prevPose = [{ position: { x: 0, y: 0, z: 0 }, quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.0) }];
  b.quaternion.identity();
  const ib = createInertialBlend3D({ halfLife: 0.1 });
  ib.capture([b], prevPose);
  ib.apply([b], 0.05);
  const midAngle = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w)));
  b.quaternion.identity();
  ib.apply([b], 0.5);
  const lateAngle = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w)));
  assert.ok(midAngle > lateAngle, 'inertial residual decays toward target pose');
});

test('S2 cross-skeleton retargeting maps aliases and scales root translation', () => {
  function buildSkeleton(prefix, hipY) {
    const root = new THREE.Group();
    const hips = new THREE.Bone(); hips.name = `${prefix}Hips`; hips.position.set(0, hipY, 0);
    const spine = new THREE.Bone(); spine.name = `${prefix}Spine`; spine.position.set(0, hipY * 0.5, 0);
    hips.add(spine);
    root.add(hips);
    root.updateMatrixWorld(true);
    return new THREE.Skeleton([hips, spine]);
  }
  const srcSkel = buildSkeleton('mixamorig_', 1.0);
  const tgtSkel = buildSkeleton('', 2.0);
  const map = createBoneMap3D(srcSkel, tgtSkel);
  assert.equal(map.Hips, 'mixamorig_Hips');
  assert.equal(map.Spine, 'mixamorig_Spine');

  const srcClip = new THREE.AnimationClip('step', 1.0, [
    new THREE.VectorKeyframeTrack('mixamorig_Hips.position', [0, 0.5, 1.0], [0, 1, 0, 0, 1.2, 0.4, 0, 1, 0]),
    new THREE.QuaternionKeyframeTrack('mixamorig_Spine.quaternion', [0, 0.5, 1.0], [0, 0, 0, 1, 0.2, 0, 0, 0.98, 0, 0, 0, 1]),
  ]);
  const outClip = retargetClip3D(THREE, srcClip, {
    source: srcSkel,
    target: tgtSkel,
    boneMap: map,
    hipBone: 'Hips',
    fps: 20,
  });
  assert.ok(outClip.tracks.some((t) => t.name === 'Hips.position'));
  assert.ok(outClip.tracks.some((t) => t.name === 'Spine.quaternion'));
  const hipTrack = outClip.tracks.find((t) => t.name === 'Hips.position');
  const maxZ = Math.max(...Array.from(hipTrack.values).filter((_, idx) => idx % 3 === 2));
  assert.ok(maxZ > 0.6, `expected 2x tall skeleton peak hip Z displacement ~0.8, got ${maxZ}`);
});

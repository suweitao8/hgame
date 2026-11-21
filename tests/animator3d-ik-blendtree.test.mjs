import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createAvatarMask,
  createBlendTree1D,
  createBlendTree2D,
  createAnimator3D,
  solveTwoBoneIK,
  solveLookAtIK,
  createModel3DProvider,
} from '../assets/runtime/integrations/model3d.js';

function createRiggedFixture() {
  const root = new THREE.Group();
  root.name = 'CharacterRoot';

  const hips = new THREE.Bone();
  hips.name = 'Hips';
  const spine = new THREE.Bone();
  spine.name = 'Spine';
  const armL = new THREE.Bone();
  armL.name = 'UpperArm_L';
  armL.position.set(-1, 2, 0);
  const foreArmL = new THREE.Bone();
  foreArmL.name = 'ForeArm_L';
  foreArmL.position.set(0, -1, 0);
  const handL = new THREE.Bone();
  handL.name = 'Hand_L';
  handL.position.set(0, -1, 0);

  hips.add(spine);
  spine.add(armL);
  armL.add(foreArmL);
  foreArmL.add(handL);
  root.add(hips);
  root.updateMatrixWorld(true);

  const idleTrack = new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0.1, 0]);
  const spineTrack = new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.2, 0, 0.98]);
  const idleClip = new THREE.AnimationClip('idle', 1, [idleTrack, spineTrack]);
  const walkClip = new THREE.AnimationClip('walk', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 1])]);
  const runClip = new THREE.AnimationClip('run', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 2])]);
  const aimClip = new THREE.AnimationClip('aim', 0.8, [spineTrack, idleTrack]);

  return {
    root,
    bones: { hips, spine, armL, foreArmL, handL },
    clips: [idleClip, walkClip, runClip, aimClip],
  };
}

test('S2: AvatarMask, 1D/2D BlendTrees compute normalized weights and filter skeleton tracks', () => {
  const { bones, clips } = createRiggedFixture();
  const upperMask = createAvatarMask({
    includeBranch: bones.spine,
    exclude: ['Hand_L'],
  });
  assert.equal(upperMask.allows('Spine'), true);
  assert.equal(upperMask.allows('UpperArm_L'), true);
  assert.equal(upperMask.allows('Hand_L'), false);
  assert.equal(upperMask.allows('Hips'), false);

  const filteredAim = upperMask.filterClip(clips[3]);
  assert.equal(filteredAim.tracks.length, 1);
  assert.equal(filteredAim.tracks[0].name, 'Spine.quaternion');

  const tree1D = createBlendTree1D([
    { clip: 'idle', threshold: 0 },
    { clip: 'walk', threshold: 2 },
    { clip: 'run', threshold: 6 },
  ]);
  assert.deepEqual(tree1D.evaluate(0), [{ clip: 'idle', weight: 1, speed: 1 }]);
  const half = tree1D.evaluate(1);
  assert.equal(half.length, 2);
  assert.equal(half[0].clip, 'idle');
  assert.ok(Math.abs(half[0].weight - 0.5) < 1e-6);
  assert.equal(half[1].clip, 'walk');
  assert.ok(Math.abs(half[1].weight - 0.5) < 1e-6);

  const tree2D = createBlendTree2D([
    { clip: 'idle', x: 0, y: 0 },
    { clip: 'walk', x: 0, y: 1 },
    { clip: 'run', x: 1, y: 0 },
  ]);
  const exact = tree2D.evaluate(0, 1);
  assert.deepEqual(exact, [{ clip: 'walk', weight: 1, speed: 1 }]);
  const diag = tree2D.evaluate(0.5, 0.5);
  const weightSum = diag.reduce((s, e) => s + e.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-5);
});

test('S2: createAnimator3D drives multi-layer StateMachine, exit-time transitions, events, and provider integration', () => {
  const { root, bones, clips } = createRiggedFixture();
  const provider = createModel3DProvider({ THREE });
  const comp = provider.createComponent({ root, animations: clips });
  comp.awake();
  const firedEvents = [];

  const locoTree = createBlendTree1D([
    { clip: 'idle', threshold: 0 },
    { clip: 'walk', threshold: 2 },
    { clip: 'run', threshold: 5 },
  ]);
  const upperMask = createAvatarMask({ includeBranch: bones.spine });

  const animator = comp.attachAnimator({
    parameters: { speed: 0 },
    events: {
      walk: [{ time: 0.25, name: 'footstep', data: { foot: 'L' } }],
    },
    onEvent: evt => firedEvents.push(evt),
    layers: [
      {
        name: 'base',
        weight: 1,
        initialState: 'locomotion',
        states: {
          locomotion: { blendTree: locoTree, param: 'speed' },
          jump: { clip: 'run', loop: false },
        },
        transitions: [
          { from: 'locomotion', to: 'jump', conditions: [{ op: 'trigger', param: 'jumpTrig' }], duration: 0.1 },
          { from: 'jump', to: 'locomotion', hasExitTime: true, exitTime: 0.8, duration: 0.1 },
        ],
      },
      {
        name: 'upper',
        weight: 0.75,
        mask: upperMask,
        initialState: 'aiming',
        states: { aiming: { clip: 'aim' } },
      },
    ],
  });

  // Base locomotion blends walk & run at speed=3.5
  animator.setParam('speed', 3.5);
  comp.update(0.3);
  const w = animator.getWeights('base');
  assert.ok(w.walk > 0 && w.run > 0);
  assert.ok(Math.abs((w.walk + w.run) - 1) < 1e-6);
  assert.equal(firedEvents.some(e => e.name === 'footstep' && e.clipName === 'walk'), true);

  // Upper body masked layer active cleanly
  assert.equal(animator.getState('upper'), 'aiming');
  assert.ok(Math.abs(animator.getWeights('upper').aim - 0.75) < 1e-6);

  // Trigger jump -> enters jump -> after exitTime >= 0.8s transitions back to locomotion
  animator.trigger('jumpTrig');
  comp.update(0.05);
  assert.equal(animator.getState('base'), 'jump');
  comp.update(0.85);
  assert.equal(animator.getState('base'), 'locomotion');

  provider.dispose();
});

test('S2: solveTwoBoneIK and solveLookAtIK accurately orient 3D skeletal chains within constraints', () => {
  const shoulder = new THREE.Bone();
  shoulder.position.set(0, 2, 0);
  const elbow = new THREE.Bone();
  elbow.position.set(0, -1, 0); // L1 = 1
  const wrist = new THREE.Bone();
  wrist.position.set(0, -1, 0); // L2 = 1
  shoulder.add(elbow);
  elbow.add(wrist);
  shoulder.updateMatrixWorld(true);

  const target = new THREE.Vector3(1.2, 1.4, 0.4);
  const pole = new THREE.Vector3(0, 1.4, 2);
  const ok = solveTwoBoneIK(shoulder, elbow, wrist, target, pole);
  assert.equal(ok, true);

  const reached = new THREE.Vector3();
  wrist.getWorldPosition(reached);
  const distErr = reached.distanceTo(target);
  assert.ok(distErr < 1e-3, `Two-Bone IK end effector error should be < 1e-3, got ${distErr}`);

  // LookAt IK clamped within maxAngle
  const head = new THREE.Bone();
  head.position.set(0, 1.7, 0);
  head.updateMatrixWorld(true);
  const backTarget = new THREE.Vector3(0, 1.7, -5); // 180 deg behind +Z forward axis
  const maxAngle = Math.PI * 0.25;
  assert.equal(solveLookAtIK(head, backTarget, { maxAngle, forwardAxis: [0, 0, 1] }), true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
  const angleMoved = Math.acos(Math.max(-1, Math.min(1, forward.z)));
  assert.ok(Math.abs(angleMoved - maxAngle) < 1e-3, `expected clamped angle ~${maxAngle}, got ${angleMoved}`);
});

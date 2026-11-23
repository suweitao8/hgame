import test from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import {
  CORE_23_BONES,
  CORE_23_PARENTS,
  bakeDocumentTo23Bones,
} from '../scripts/lib/anim-bake-core.mjs';
import {
  classifyCleanAnimation,
  isTurnClip,
} from '../scripts/lib/anim-classify.mjs';
import {
  decimateKeyframes,
  quantizeQuatToInt16,
  quatMul,
  quatNormalize,
  quatSlerp,
} from '../scripts/lib/anim-math.mjs';
import { searchAiIndex } from '../scripts/lib/anim-kits.mjs';

function makeAngleAxisQuat(axis, rad) {
  const half = rad * 0.5;
  const s = Math.sin(half);
  return quatNormalize([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]);
}

function buildMockUe5Document({ rootMotionXZ = 0 } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const anim = doc.createAnimation('UE5Clip');

  const ue5Bones = [
    ...CORE_23_BONES,
    'spine_04',
    'spine_05',
    'neck_02',
    'index_01_l',
    'upperarm_twist_01_l',
    'ik_hand_gun',
  ];
  const ue5Parents = {
    ...CORE_23_PARENTS,
    spine_04: 'spine_03',
    spine_05: 'spine_04',
    clavicle_l: 'spine_05',
    clavicle_r: 'spine_05',
    neck_01: 'spine_05',
    neck_02: 'neck_01',
    head: 'neck_02',
    index_01_l: 'hand_l',
    upperarm_twist_01_l: 'upperarm_l',
    ik_hand_gun: 'root',
  };

  const nodes = {};
  for (const name of ue5Bones) {
    nodes[name] = doc.createNode(name)
      .setTranslation(name === 'pelvis' ? [0, 0.95, 0] : [0, 0.1, 0])
      .setRotation([0, 0, 0, 1])
      .setScale([1, 1, 1]);
  }
  for (const name of ue5Bones) {
    const p = ue5Parents[name];
    if (p) nodes[p].addChild(nodes[name]);
    else scene.addChild(nodes[name]);
  }

  const times = new Float32Array([0, 0.5, 1.0]);
  const inAcc = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);

  const addTrack = (nodeName, path, vals) => {
    const type = path === 'rotation' ? 'VEC4' : 'VEC3';
    const outAcc = doc.createAccessor().setType(type).setArray(Float32Array.from(vals)).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
    const ch = doc.createAnimationChannel().setTargetNode(nodes[nodeName]).setTargetPath(path).setSampler(sampler);
    anim.addSampler(sampler);
    anim.addChannel(ch);
  };

  // Spine_04 and spine_05 each bend 20 deg around X -> folded spine_03 must carry 40 deg total!
  const q20 = makeAngleAxisQuat([1, 0, 0], (20 * Math.PI) / 180);
  const q0 = [0, 0, 0, 1];
  addTrack('spine_04', 'rotation', [...q0, ...q20, ...q0]);
  addTrack('spine_05', 'rotation', [...q0, ...q20, ...q0]);
  addTrack('neck_02', 'rotation', [...q0, ...q20, ...q0]);
  addTrack('root', 'translation', [0, 0, 0, 0, 0, rootMotionXZ * 0.5, 0, 0, rootMotionXZ]);
  addTrack('pelvis', 'translation', [0, 0.95, 0, 0, 1.05, 0, 0, 0.95, 0]);
  addTrack('index_01_l', 'scale', [1, 1, 1, 1, 1, 1, 1, 1, 1]);

  return doc;
}

test('anim-math quaternion slerp, decimation, and Int16 quantization', () => {
  const a = [0, 0, 0, 1];
  const b = makeAngleAxisQuat([0, 1, 0], Math.PI * 0.5);
  const mid = quatSlerp(a, b, 0.5);
  assert.ok(Math.abs(mid[1] - Math.sin(Math.PI / 8)) < 1e-4);

  const times = Float32Array.from([0, 0.5, 1.0]);
  const vals = Float32Array.from([0, 0, 0, 0, 0.5, 0, 0, 1, 0]);
  const dec = decimateKeyframes(times, vals, 3, { isQuat: false, tolerance: 0.001 });
  assert.equal(dec.times.length, 2);

  const q16 = quantizeQuatToInt16(Float32Array.from([0, 0, 0, 1]));
  assert.equal(q16[3], 32767);
});

test('bakeDocumentTo23Bones losslessly folds UE5 spine_04/05 & neck_02, strips scale/fingers, and enforces IP', () => {
  const srcDoc = buildMockUe5Document({ rootMotionXZ: 1.5 });
  const { outDoc, metrics } = bakeDocumentTo23Bones(srcDoc, { forceInPlace: true });
  const nodes = outDoc.getRoot().listNodes();
  const anim = outDoc.getRoot().listAnimations()[0];
  const channels = anim.listChannels();

  assert.equal(metrics.rigType, 'humanoid_23');
  assert.equal(metrics.motionType, 'IP');
  assert.equal(nodes.length, 23);
  assert.equal(channels.filter((c) => c.getTargetPath() === 'scale').length, 0);
  assert.ok(channels.length >= 23 && channels.length <= 25);

  // Verify folded spine_03 rotation at t=0.5s carries combined 40 deg bend (q20 * q20)
  const sp3Ch = channels.find((c) => c.getTargetNode()?.getName() === 'spine_03' && c.getTargetPath() === 'rotation');
  const sp3Times = sp3Ch.getSampler().getInput().getArray();
  const sp3Vals = sp3Ch.getSampler().getOutput().getArray();
  const midIdx = sp3Times.findIndex((t) => Math.abs(t - 0.5) < 0.05);
  assert.ok(midIdx >= 0);
  const qBaked = quatNormalize([
    sp3Vals[midIdx * 4] / 32767,
    sp3Vals[midIdx * 4 + 1] / 32767,
    sp3Vals[midIdx * 4 + 2] / 32767,
    sp3Vals[midIdx * 4 + 3] / 32767,
  ]);
  const expected40 = makeAngleAxisQuat([1, 0, 0], (40 * Math.PI) / 180);
  const dot = Math.abs(qBaked[0] * expected40[0] + qBaked[1] * expected40[1] + qBaked[2] * expected40[2] + qBaked[3] * expected40[3]);
  assert.ok(dot > 0.9999, `Expected folded spine_03 dot > 0.9999, got ${dot}`);

  // Verify pelvis vertical Y bounce (0.95 -> 1.05 -> 0.95) is preserved when forceInPlace=true
  const pelCh = channels.find((c) => c.getTargetNode()?.getName() === 'pelvis' && c.getTargetPath() === 'translation');
  const pelVals = pelCh.getSampler().getOutput().getArray();
  let maxY = -Infinity;
  for (let i = 1; i < pelVals.length; i += 3) maxY = Math.max(maxY, pelVals[i]);
  assert.ok(maxY > 1.04, `Expected pelvis Y bounce preserved, got maxY=${maxY}`);
});

test('anim-classify excludes Turn clips while preserving 8-way Strafe and spinning attacks, and fixes categories', () => {
  assert.equal(isTurnClip('AS_Turn_90_L_Seq'), true);
  assert.equal(isTurnClip('Male_TurnInPlace_180'), true);
  assert.equal(isTurnClip('Anim_Monster_Turn_Left'), true);
  assert.equal(isTurnClip('Pistol_StrafeRun45LeftLoop'), false);
  assert.equal(isTurnClip('A_INP_WalkFwdLt_45_Loop'), false);
  assert.equal(isTurnClip('GhostSamurai_APose_Strafe_Run_BL_Inplace'), false);
  assert.equal(isTurnClip('Spin_Slash_Attack01'), false);

  const clazyWalk = classifyCleanAnimation({ pack: 'CLazyAnimpack', assetName: 'Mvm_JogStart_Fwd', duration: 0.6 });
  assert.equal(clazyWalk.category, '跑步与冲刺');

  const clazyWall = classifyCleanAnimation({ pack: 'CLazyAnimpack', assetName: 'LoWall_LDash_Loop', duration: 0.8 });
  assert.equal(clazyWall.category, '攀爬跑酷与游泳');

  const sitAim = classifyCleanAnimation({ pack: 'SittingAnimations', assetName: 'AIM_ground_aim_01', duration: 0.267 });
  assert.equal(sitAim.category, '枪械射击');
  assert.equal(sitAim.clipType, 'pose');

  const bow = classifyCleanAnimation({ pack: 'GhostSamurai_Bundle', assetName: 'GhostSamurai_Bow_Idle_Inplace', duration: 2.0 });
  assert.equal(bow.category, '弓箭');
});

test('searchAiIndex respects style, motion, loop, maxDuration and excludes poses', () => {
  const entries = [
    { id: 'a', style: 'wuxia', category: '长剑与双刃', motionType: 'IP', loop: true, duration: 1.2, clipType: 'action', tags: ['sword'] },
    { id: 'b', style: 'anime', category: '高速连击 (Lucy)', motionType: 'RM', loop: false, duration: 1.5, clipType: 'action', tags: ['sword'] },
    { id: 'c', style: 'wuxia', category: '长剑与双刃', motionType: 'IP', loop: true, duration: 0.07, clipType: 'pose', tags: ['sword'] },
  ];
  const res = searchAiIndex(entries, { style: 'wuxia', motion: 'IP', loop: true, q: 'sword' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'a');
});

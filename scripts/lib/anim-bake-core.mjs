/**
 * Core 23-bone glTF animation baker and character root-rig normalizer.
 * Uses @gltf-transform/core to fold UE5 spine/neck chains losslessly, prune non-core
 * bones/channels, detect/strip root motion, decimate redundant frames, and quantize rotations.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import {
  IDENTITY_QUAT,
  ZERO_VEC3,
  decimateKeyframes,
  quantizeQuatToInt16,
  quatDot,
  quatInv,
  quatMul,
  quatNormalize,
  sampleTrackAtTime,
  vec3Add,
  vec3TransformQuat,
} from './anim-math.mjs';

export const CORE_23_BONES = Object.freeze([
  'root',
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
]);

export const CORE_23_PARENTS = Object.freeze({
  root: null,
  pelvis: 'root',
  spine_01: 'pelvis',
  spine_02: 'spine_01',
  spine_03: 'spine_02',
  neck_01: 'spine_03',
  head: 'neck_01',
  clavicle_l: 'spine_03',
  upperarm_l: 'clavicle_l',
  lowerarm_l: 'upperarm_l',
  hand_l: 'lowerarm_l',
  clavicle_r: 'spine_03',
  upperarm_r: 'clavicle_r',
  lowerarm_r: 'upperarm_r',
  hand_r: 'lowerarm_r',
  thigh_l: 'pelvis',
  calf_l: 'thigh_l',
  foot_l: 'calf_l',
  ball_l: 'foot_l',
  thigh_r: 'pelvis',
  calf_r: 'thigh_r',
  foot_r: 'calf_r',
  ball_r: 'foot_r',
});

export const CORE_23_SET = new Set(CORE_23_BONES);

const SRC_ALIASES = Object.freeze({
  hips: 'pelvis',
  hip: 'pelvis',
  spine: 'spine_01',
  spine1: 'spine_02',
  spine2: 'spine_03',
  neck: 'neck_01',
  leftshoulder: 'clavicle_l',
  leftarm: 'upperarm_l',
  leftforearm: 'lowerarm_l',
  lefthand: 'hand_l',
  rightshoulder: 'clavicle_r',
  rightarm: 'upperarm_r',
  rightforearm: 'lowerarm_r',
  righthand: 'hand_r',
  leftupleg: 'thigh_l',
  leftleg: 'calf_l',
  leftfoot: 'foot_l',
  lefttoebase: 'ball_l',
  rightupleg: 'thigh_r',
  rightleg: 'calf_r',
  rightfoot: 'foot_r',
  righttoebase: 'ball_r',
});

const sharedIO = new NodeIO();

function stripNamespaceLower(name) {
  if (!name) return '';
  const stripped = String(name).replace(/^.*[:|]/, '').trim().toLowerCase();
  return SRC_ALIASES[stripped] || stripped;
}

/**
 * Inspect whether a glTF Document maps cleanly to the standard 23-bone humanoid whitelist.
 * Returns { rigType: 'humanoid_23' | 'custom_monster', nodeMap, hasSpine04, hasSpine05, hasNeck02 }.
 */
export function inspectDocumentRig(doc) {
  const nodeMap = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const key = stripNamespaceLower(node.getName());
    if (key && !nodeMap.has(key)) nodeMap.set(key, node);
  }
  const missingCore = CORE_23_BONES.filter((b) => !nodeMap.has(b));
  const isHumanoid = missingCore.length === 0;
  return {
    rigType: isHumanoid ? 'humanoid_23' : 'custom_monster',
    nodeMap,
    missingCore,
    hasSpine04: nodeMap.has('spine_04'),
    hasSpine05: nodeMap.has('spine_05'),
    hasNeck02: nodeMap.has('neck_02'),
  };
}

function buildSamplerIndex(anim) {
  const tracks = new Map();
  if (!anim) return tracks;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const path = ch.getTargetPath();
    if (!node || !path) continue;
    const key = `${stripNamespaceLower(node.getName())}:${path}`;
    const sampler = ch.getSampler();
    if (!sampler) continue;
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;
    tracks.set(key, {
      times: input.getArray(),
      values: output.getArray(),
      interpolation: sampler.getInterpolation() || 'LINEAR',
    });
  }
  return tracks;
}

function getClipDuration(tracks) {
  let maxT = 0;
  for (const tr of tracks.values()) {
    if (tr.times && tr.times.length > 0) {
      const last = tr.times[tr.times.length - 1];
      if (Number.isFinite(last) && last > maxT) maxT = last;
    }
  }
  return maxT;
}

function sampleBoneQuat(nodeMap, tracks, boneName, t) {
  const node = nodeMap.get(boneName);
  const rest = node ? quatNormalize(node.getRotation()) : IDENTITY_QUAT;
  const tr = tracks.get(`${boneName}:rotation`);
  if (!tr) return rest;
  return sampleTrackAtTime(tr.times, tr.values, 4, t, {
    isQuat: true,
    interpolation: tr.interpolation,
    fallback: rest,
  });
}

function sampleBoneVec3(nodeMap, tracks, boneName, pathName, t, defaultFallback) {
  const node = nodeMap.get(boneName);
  const rest = node
    ? (pathName === 'translation' ? node.getTranslation() : node.getScale())
    : defaultFallback;
  const tr = tracks.get(`${boneName}:${pathName}`);
  if (!tr) return [...rest];
  return sampleTrackAtTime(tr.times, tr.values, 3, t, {
    isQuat: false,
    interpolation: tr.interpolation,
    fallback: rest,
  });
}

function addVecChannel(outDoc, outAnim, buffer, targetNode, targetPath, times, flatValues, { isQuat = false, tolerance = 0.001 } = {}) {
  const stride = isQuat ? 4 : 3;
  const decimated = decimateKeyframes(times, flatValues, stride, { isQuat, tolerance });
  const inAcc = outDoc.createAccessor()
    .setType('SCALAR')
    .setArray(decimated.times)
    .setBuffer(buffer);
  const outAcc = outDoc.createAccessor()
    .setType(isQuat ? 'VEC4' : 'VEC3')
    .setBuffer(buffer);
  if (isQuat) {
    outAcc.setArray(quantizeQuatToInt16(decimated.values)).setNormalized(true);
  } else {
    outAcc.setArray(decimated.values);
  }
  const sampler = outDoc.createAnimationSampler()
    .setInput(inAcc)
    .setOutput(outAcc)
    .setInterpolation('LINEAR');
  const ch = outDoc.createAnimationChannel()
    .setTargetNode(targetNode)
    .setTargetPath(targetPath)
    .setSampler(sampler);
  outAnim.addSampler(sampler);
  outAnim.addChannel(ch);
}

/**
 * Compute collapsed rest transforms for the 23-bone target skeleton, preserving exact UE5 world frames.
 */
function computeTargetRestPose(rigInfo) {
  const { nodeMap, hasSpine04, hasSpine05, hasNeck02 } = rigInfo;
  const getT = (name) => (nodeMap.get(name)?.getTranslation() || [0, 0, 0]);
  const getR = (name) => quatNormalize(nodeMap.get(name)?.getRotation() || IDENTITY_QUAT);

  const restT = {};
  const restR = {};
  for (const name of CORE_23_BONES) {
    restT[name] = [...getT(name)];
    restR[name] = [...getR(name)];
  }
  restT.root = [0, 0, 0];
  restR.root = [0, 0, 0, 1];

  if (hasSpine04 && hasSpine05) {
    const r2 = getR('spine_02');
    const r3 = getR('spine_03');
    const r4 = getR('spine_04');
    const r5 = getR('spine_05');
    restR.spine_02 = quatNormalize(quatMul(r2, r3));
    restT.spine_03 = vec3Add(vec3TransformQuat(getT('spine_03'), quatInv(r3)), getT('spine_04'));
    restR.spine_03 = quatNormalize(quatMul(r4, r5));

    const t5Local = vec3TransformQuat(getT('spine_05'), quatInv(r5));
    restT.neck_01 = vec3Add(t5Local, getT('neck_01'));
    restT.clavicle_l = vec3Add(t5Local, getT('clavicle_l'));
    restT.clavicle_r = vec3Add(t5Local, getT('clavicle_r'));
  } else if (hasSpine04) {
    const r3 = getR('spine_03');
    const r4 = getR('spine_04');
    restR.spine_03 = quatNormalize(quatMul(r3, r4));
    const t4Local = vec3TransformQuat(getT('spine_04'), quatInv(r4));
    restT.neck_01 = vec3Add(t4Local, getT('neck_01'));
    restT.clavicle_l = vec3Add(t4Local, getT('clavicle_l'));
    restT.clavicle_r = vec3Add(t4Local, getT('clavicle_r'));
  }

  if (hasNeck02) {
    const rn1 = getR('neck_01');
    const rn2 = getR('neck_02');
    restR.neck_01 = quatNormalize(quatMul(rn1, rn2));
    restT.head = vec3Add(vec3TransformQuat(getT('neck_02'), quatInv(rn2)), getT('head'));
  }

  return { restT, restR };
}

function measureAndNormalizeMotion(rootSamples, pelvisSamples, rootQuatSamples, times, { ueEntry = null, forceInPlace = false } = {}) {
  const n = times.length;
  const worldPelvis = new Array(n);
  for (let i = 0; i < n; i++) {
    worldPelvis[i] = vec3Add(rootSamples[i], vec3TransformQuat(pelvisSamples[i], rootQuatSamples[i]));
  }

  let rootMaxXZ = 0;
  let pelvisMaxXZ = 0;
  let worldMaxXZ = 0;
  for (let i = 0; i < n; i++) {
    rootMaxXZ = Math.max(rootMaxXZ, Math.hypot(rootSamples[i][0] - rootSamples[0][0], rootSamples[i][2] - rootSamples[0][2]));
    pelvisMaxXZ = Math.max(pelvisMaxXZ, Math.hypot(pelvisSamples[i][0] - pelvisSamples[0][0], pelvisSamples[i][2] - pelvisSamples[0][2]));
    worldMaxXZ = Math.max(worldMaxXZ, Math.hypot(worldPelvis[i][0] - worldPelvis[0][0], worldPelvis[i][2] - worldPelvis[0][2]));
  }

  const maxXZ = Math.max(rootMaxXZ, worldMaxXZ);
  const last = n - 1;
  const rawDisp = [
    Number((worldPelvis[last][0] - worldPelvis[0][0]).toFixed(4)),
    Number((worldPelvis[last][1] - worldPelvis[0][1]).toFixed(4)),
    Number((worldPelvis[last][2] - worldPelvis[0][2]).toFixed(4)),
  ];
  const dur = times[last] || 0;
  const avgSpeed = dur > 0.01 ? Number((Math.hypot(rawDisp[0], rawDisp[2]) / dur).toFixed(3)) : 0;

  let motionType = maxXZ >= 0.15 ? 'RM' : 'IP';
  if (ueEntry?.enable_root_motion === true && maxXZ >= 0.05) {
    motionType = 'RM';
  }

  if (forceInPlace) {
    for (let i = 0; i < n; i++) {
      rootSamples[i][0] = 0;
      rootSamples[i][2] = 0;
      if (Math.abs(rootSamples[i][1]) < 0.05) rootSamples[i][1] = 0;
    }
    if (pelvisMaxXZ >= 0.15) {
      // Remove horizontal drift while keeping pelvis Y-axis vertical oscillation intact
      const dx = pelvisSamples[last][0] - pelvisSamples[0][0];
      const dz = pelvisSamples[last][2] - pelvisSamples[0][2];
      let detrendedMax = 0;
      for (let i = 0; i < n; i++) {
        const alpha = dur > 1e-6 ? times[i] / dur : 0;
        const px = pelvisSamples[i][0] - dx * alpha;
        const pz = pelvisSamples[i][2] - dz * alpha;
        detrendedMax = Math.max(detrendedMax, Math.hypot(px - pelvisSamples[0][0], pz - pelvisSamples[0][2]));
      }
      if (detrendedMax < 0.14) {
        for (let i = 0; i < n; i++) {
          const alpha = dur > 1e-6 ? times[i] / dur : 0;
          pelvisSamples[i][0] -= dx * alpha;
          pelvisSamples[i][2] -= dz * alpha;
        }
      } else {
        const x0 = pelvisSamples[0][0];
        const z0 = pelvisSamples[0][2];
        for (let i = 0; i < n; i++) {
          pelvisSamples[i][0] = x0;
          pelvisSamples[i][2] = z0;
        }
      }
    }
    motionType = 'IP';
  }

  return {
    motionType,
    maxXZ: Number(maxXZ.toFixed(4)),
    rootDisplacement: forceInPlace ? [0, rawDisp[1], 0] : rawDisp,
    avgSpeed: forceInPlace ? 0 : avgSpeed,
  };
}

function bakeCustomMonster(srcDoc, { fps = 30, tolerance = 0.001, clipName = 'Clip' } = {}) {
  const srcAnims = srcDoc.getRoot().listAnimations();
  const srcAnim = srcAnims[0];
  const tracks = buildSamplerIndex(srcAnim);
  const dur = Math.max(0.01, getClipDuration(tracks));
  const sampleCount = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    times[i] = sampleCount > 1 ? (dur * i) / (sampleCount - 1) : 0;
  }

  const outDoc = new Document();
  const buffer = outDoc.createBuffer();
  const outScene = outDoc.createScene('Scene');
  const outAnim = outDoc.createAnimation(srcAnim?.getName() || clipName);

  const srcNodes = srcDoc.getRoot().listNodes();
  const nodeCopyMap = new Map();
  const outNodes = [];
  for (const sn of srcNodes) {
    if (!sn.getName()) continue;
    const dn = outDoc.createNode(sn.getName())
      .setTranslation(sn.getTranslation())
      .setRotation(quatNormalize(sn.getRotation()))
      .setScale([1, 1, 1]);
    nodeCopyMap.set(sn, dn);
    outNodes.push({ src: sn, dst: dn });
  }
  for (const { src, dst } of outNodes) {
    const parent = src.getParentNode();
    if (parent && nodeCopyMap.has(parent)) {
      nodeCopyMap.get(parent).addChild(dst);
    } else {
      outScene.addChild(dst);
    }
  }

  for (const { src, dst } of outNodes) {
    const keyBase = stripNamespaceLower(src.getName());
    const rotTr = tracks.get(`${keyBase}:rotation`);
    if (rotTr) {
      const flat = new Float32Array(sampleCount * 4);
      let prevQ = null;
      for (let i = 0; i < sampleCount; i++) {
        let q = sampleTrackAtTime(rotTr.times, rotTr.values, 4, times[i], {
          isQuat: true,
          interpolation: rotTr.interpolation,
          fallback: src.getRotation(),
        });
        if (prevQ && quatDot(q, prevQ) < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        prevQ = q;
        flat.set(q, i * 4);
      }
      addVecChannel(outDoc, outAnim, buffer, dst, 'rotation', times, flat, { isQuat: true, tolerance });
    }
    const transTr = tracks.get(`${keyBase}:translation`);
    if (transTr) {
      const flat = new Float32Array(sampleCount * 3);
      for (let i = 0; i < sampleCount; i++) {
        const v = sampleTrackAtTime(transTr.times, transTr.values, 3, times[i], {
          isQuat: false,
          interpolation: transTr.interpolation,
          fallback: src.getTranslation(),
        });
        flat.set(v, i * 3);
      }
      addVecChannel(outDoc, outAnim, buffer, dst, 'translation', times, flat, { isQuat: false, tolerance });
    }
  }

  return {
    outDoc,
    metrics: {
      rigType: 'custom_monster',
      duration: Number(dur.toFixed(3)),
      channelCount: outAnim.listChannels().length,
      nodeCount: outDoc.getRoot().listNodes().length,
      motionType: 'IP',
      maxXZ: 0,
      rootDisplacement: [0, 0, 0],
      avgSpeed: 0,
    },
  };
}

/**
 * Bake a raw Unreal/Mixamo animation Document into a clean 23-bone (or preserved custom_monster) Document.
 */
export function bakeDocumentTo23Bones(srcDoc, {
  fps = 30,
  tolerance = 0.001,
  clipName = 'Clip',
  ueEntry = null,
  forceInPlace = false,
} = {}) {
  const rigInfo = inspectDocumentRig(srcDoc);
  if (rigInfo.rigType !== 'humanoid_23') {
    return bakeCustomMonster(srcDoc, { fps, tolerance, clipName });
  }

  const srcAnim = srcDoc.getRoot().listAnimations()[0];
  const tracks = buildSamplerIndex(srcAnim);
  const dur = Math.max(0.01, getClipDuration(tracks));
  const sampleCount = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    times[i] = sampleCount > 1 ? (dur * i) / (sampleCount - 1) : 0;
  }

  const { nodeMap, hasSpine04, hasSpine05, hasNeck02 } = rigInfo;
  const { restT, restR } = computeTargetRestPose(rigInfo);

  // Sample root & pelvis translation + root rotation for motion classification & IP stripping
  const rootSamples = new Array(sampleCount);
  const pelvisSamples = new Array(sampleCount);
  const rootQuatSamples = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = times[i];
    rootSamples[i] = sampleBoneVec3(nodeMap, tracks, 'root', 'translation', t, ZERO_VEC3);
    pelvisSamples[i] = sampleBoneVec3(nodeMap, tracks, 'pelvis', 'translation', t, restT.pelvis);
    rootQuatSamples[i] = sampleBoneQuat(nodeMap, tracks, 'root', t);
  }

  const motion = measureAndNormalizeMotion(rootSamples, pelvisSamples, rootQuatSamples, times, {
    ueEntry,
    forceInPlace,
  });

  // Create pruned 23-bone output Document
  const outDoc = new Document();
  const buffer = outDoc.createBuffer();
  const outScene = outDoc.createScene('Scene');
  const outAnim = outDoc.createAnimation(srcAnim?.getName() || clipName);

  const outNodes = {};
  for (const name of CORE_23_BONES) {
    const node = outDoc.createNode(name)
      .setTranslation(restT[name])
      .setRotation(restR[name])
      .setScale([1, 1, 1]);
    outNodes[name] = node;
  }
  for (const name of CORE_23_BONES) {
    const parentName = CORE_23_PARENTS[name];
    if (parentName) outNodes[parentName].addChild(outNodes[name]);
    else outScene.addChild(outNodes[name]);
  }

  // Write root translation ONLY if non-zero across the clip
  const rootHasMotion = rootSamples.some(
    (v) => Math.abs(v[0]) > 1e-4 || Math.abs(v[1]) > 1e-4 || Math.abs(v[2]) > 1e-4,
  );
  if (rootHasMotion) {
    const rootFlat = new Float32Array(sampleCount * 3);
    for (let i = 0; i < sampleCount; i++) rootFlat.set(rootSamples[i], i * 3);
    addVecChannel(outDoc, outAnim, buffer, outNodes.root, 'translation', times, rootFlat, { isQuat: false, tolerance });
  }

  // Always preserve pelvis translation (retains vertical hip bounce)
  const pelvisFlat = new Float32Array(sampleCount * 3);
  for (let i = 0; i < sampleCount; i++) pelvisFlat.set(pelvisSamples[i], i * 3);
  addVecChannel(outDoc, outAnim, buffer, outNodes.pelvis, 'translation', times, pelvisFlat, { isQuat: false, tolerance });

  // Sample & fold all 23 bone rotations
  for (const name of CORE_23_BONES) {
    const rotFlat = new Float32Array(sampleCount * 4);
    let prevQ = null;
    for (let i = 0; i < sampleCount; i++) {
      const t = times[i];
      let q;
      if (name === 'spine_02' && hasSpine04 && hasSpine05) {
        const q2 = sampleBoneQuat(nodeMap, tracks, 'spine_02', t);
        const q3 = sampleBoneQuat(nodeMap, tracks, 'spine_03', t);
        q = quatNormalize(quatMul(q2, q3));
      } else if (name === 'spine_03' && hasSpine04 && hasSpine05) {
        const q4 = sampleBoneQuat(nodeMap, tracks, 'spine_04', t);
        const q5 = sampleBoneQuat(nodeMap, tracks, 'spine_05', t);
        q = quatNormalize(quatMul(q4, q5));
      } else if (name === 'spine_03' && hasSpine04 && !hasSpine05) {
        const q3 = sampleBoneQuat(nodeMap, tracks, 'spine_03', t);
        const q4 = sampleBoneQuat(nodeMap, tracks, 'spine_04', t);
        q = quatNormalize(quatMul(q3, q4));
      } else if (name === 'neck_01' && hasNeck02) {
        const qn1 = sampleBoneQuat(nodeMap, tracks, 'neck_01', t);
        const qn2 = sampleBoneQuat(nodeMap, tracks, 'neck_02', t);
        q = quatNormalize(quatMul(qn1, qn2));
      } else {
        q = sampleBoneQuat(nodeMap, tracks, name, t);
      }
      if (prevQ && quatDot(q, prevQ) < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      prevQ = q;
      rotFlat.set(q, i * 4);
    }
    addVecChannel(outDoc, outAnim, buffer, outNodes[name], 'rotation', times, rotFlat, { isQuat: true, tolerance });
  }

  return {
    outDoc,
    metrics: {
      rigType: 'humanoid_23',
      duration: Number(dur.toFixed(3)),
      channelCount: outAnim.listChannels().length,
      nodeCount: outDoc.getRoot().listNodes().length,
      ...motion,
    },
  };
}

/**
 * Read a GLB file from disk, bake to 23-bone format, and write binary GLB output.
 */
export async function bakeGlbFileTo23(srcPath, dstPath, options = {}) {
  const srcDoc = await sharedIO.read(srcPath);
  const { outDoc, metrics } = bakeDocumentTo23Bones(srcDoc, options);
  const outBytes = await sharedIO.writeBinary(outDoc);
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(dstPath), { recursive: true });
  await fs.writeFile(dstPath, outBytes);
  return { ...metrics, bytes: outBytes.byteLength };
}

/**
 * Ensure a character GLB contains a `root` node at world origin (0, 0, 0) as parent of `pelvis`.
 * Useful for upgrading legacy 22-bone character low-poly GLBs without altering skin weights.
 */
export async function ensureCharacterRootNode(glbPath) {
  const doc = await sharedIO.read(glbPath);
  const nodes = doc.getRoot().listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const pelvis = byName.get('pelvis');
  if (!pelvis) return { changed: false, reason: 'no_pelvis', boneCount: nodes.length };

  let changed = false;
  let root = byName.get('root');
  if (!root) {
    const parent = pelvis.getParentNode();
    root = doc.createNode('root').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    if (parent) {
      parent.removeChild(pelvis);
      parent.addChild(root);
    } else {
      const scene = doc.getRoot().listScenes()[0];
      if (scene) {
        scene.removeChild(pelvis);
        scene.addChild(root);
      }
    }
    root.addChild(pelvis);
    changed = true;
  } else {
    const t = root.getTranslation();
    if (Math.hypot(t[0], t[1], t[2]) > 1e-4) {
      const pT = pelvis.getTranslation();
      pelvis.setTranslation([pT[0] + t[0], pT[1] + t[1], pT[2] + t[2]]);
      root.setTranslation([0, 0, 0]);
      changed = true;
    }
  }

  const skin = doc.getRoot().listSkins()[0];
  if (skin) {
    if (!skin.listJoints().includes(root)) {
      skin.addJoint(root);
      changed = true;
    }
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    if (ibm && ibm.getCount() < joints.length) {
      const oldArr = ibm.getArray();
      const padded = new Float32Array(joints.length * 16);
      padded.set(oldArr);
      for (let j = ibm.getCount(); j < joints.length; j++) {
        // Identity 4x4 inverse bind matrix for root at (0, 0, 0)
        padded[j * 16 + 0] = 1;
        padded[j * 16 + 5] = 1;
        padded[j * 16 + 10] = 1;
        padded[j * 16 + 15] = 1;
      }
      ibm.setArray(padded);
      changed = true;
    }
  }

  if (!changed) return { changed: false, reason: 'already_ok' };
  const outBytes = await sharedIO.writeBinary(doc);
  const fs = await import('node:fs/promises');
  await fs.writeFile(glbPath, outBytes);
  return { changed: true, bytes: outBytes.byteLength };
}

/**
 * Clean-room cross-skeleton 3D animation retargeting (`createBoneMap3D`, `retargetClip3D`).
 * Never imports 'three' directly; callers pass { THREE } by dependency injection.
 */

const CANONICAL_BONE_ALIASES = new Map([
  ['hips', ['hips', 'hip', 'pelvis', 'root', 'cog', 'center']],
  ['spine', ['spine', 'spine0', 'spine01', 'abdomen', 'torso']],
  ['spine1', ['spine1', 'spine02', 'chest', 'ribcage', 'upperchest']],
  ['spine2', ['spine2', 'spine03', 'upperchest']],
  ['neck', ['neck', 'neck01', 'cervical']],
  ['head', ['head', 'skull', 'cranium']],
  ['leftshoulder', ['leftshoulder', 'shoulderl', 'claviclel', 'lclavicle', 'lshoulder']],
  ['leftarm', ['leftarm', 'leftupperarm', 'upperarml', 'lupperarm', 'larm', 'armupperl']],
  ['leftforearm', ['leftforearm', 'leftlowerarm', 'forearml', 'lowerarml', 'lforearm', 'llowerarm']],
  ['lefthand', ['lefthand', 'handl', 'lhand', 'wristl', 'lwrist']],
  ['rightshoulder', ['rightshoulder', 'shoulderr', 'clavicler', 'rclavicle', 'rshoulder']],
  ['rightarm', ['rightarm', 'rightupperarm', 'upperarmr', 'rupperarm', 'rarm', 'armupperr']],
  ['rightforearm', ['rightforearm', 'rightlowerarm', 'forearmr', 'lowerarmr', 'rforearm', 'rlowerarm']],
  ['righthand', ['righthand', 'handr', 'rhand', 'wristr', 'rwrist']],
  ['leftupleg', ['leftupleg', 'leftthigh', 'thighl', 'lthigh', 'lupleg', 'hipsl']],
  ['leftleg', ['leftleg', 'leftshin', 'leftcalf', 'shinl', 'calfl', 'lshin', 'lcalf', 'lleg']],
  ['leftfoot', ['leftfoot', 'footl', 'lfoot', 'anklel', 'lankle']],
  ['lefttoebase', ['lefttoebase', 'lefttoe', 'toel', 'ltoe']],
  ['rightupleg', ['rightupleg', 'rightthigh', 'thighr', 'rthigh', 'rupleg', 'hipsr']],
  ['rightleg', ['rightleg', 'rightshin', 'rightcalf', 'shinr', 'calfr', 'rshin', 'rcalf', 'rleg']],
  ['rightfoot', ['rightfoot', 'footr', 'rfoot', 'ankler', 'rankle']],
  ['righttoebase', ['righttoebase', 'righttoe', 'toer', 'rtoe']],
]);

const ALIAS_LOOKUP = new Map();
for (const [canonical, variants] of CANONICAL_BONE_ALIASES.entries()) {
  for (const v of variants) {
    ALIAS_LOOKUP.set(v, canonical);
  }
}

function normalizeBoneName(name) {
  if (typeof name !== 'string') return '';
  let s = name.trim().toLowerCase();
  // Strip common rig prefixes
  s = s.replace(/^(?:mixamorig[:_]?|def[-_.]|mch[-_.]|org[-_.]|rig[-_.]|bip0*1[\s_]?|valvebiped[-_.]|cc_base_)/i, '');
  // Handle Blender .L / .R suffixes before stripping punctuation
  let side = '';
  if (/(?:[._-]l$|^l[._-])/.test(s)) {
    side = 'l';
    s = s.replace(/[._-]l$/, '').replace(/^l[._-]/, '');
  } else if (/(?:[._-]r$|^r[._-])/.test(s)) {
    side = 'r';
    s = s.replace(/[._-]r$/, '').replace(/^r[._-]/, '');
  }
  s = s.replace(/[^a-z0-9]/g, '') + side;
  return ALIAS_LOOKUP.get(s) ?? s;
}

function extractBonesAndRoot(target) {
  if (!target) throw new TypeError('Expected a Skeleton, Bone array, or Object3D');
  if (Array.isArray(target)) {
    const bones = target.filter(Boolean);
    let root = bones[0] || null;
    while (root?.parent && bones.includes(root.parent)) {
      root = root.parent;
    }
    return { bones, root: root?.parent ?? root };
  }
  if (Array.isArray(target.bones)) {
    const bones = target.bones.filter(Boolean);
    let root = bones[0] || null;
    while (root?.parent) {
      root = root.parent;
    }
    return { bones, root };
  }
  if (target.skeleton && Array.isArray(target.skeleton.bones)) {
    return extractBonesAndRoot(target.skeleton);
  }
  const bones = [];
  if (typeof target.traverse === 'function') {
    target.traverse((obj) => {
      if (obj.isBone || obj !== target) {
        bones.push(obj);
      }
    });
  }
  return { bones, root: target };
}

/**
 * Automatically map bones between a source skeleton and a target skeleton using normalized names
 * and humanoid/Blender/Mixamo aliases. Returns `{ [targetBoneName]: sourceBoneName }`.
 *
 * @param {any} sourceSkeleton
 * @param {any} targetSkeleton
 * @param {{ aliases?: Record<string, string | string[]> }} [options]
 * @returns {Record<string, string>}
 */
export function createBoneMap3D(sourceSkeleton, targetSkeleton, { aliases = {} } = {}) {
  const src = extractBonesAndRoot(sourceSkeleton);
  const tgt = extractBonesAndRoot(targetSkeleton);

  const customMap = new Map();
  for (const [k, v] of Object.entries(aliases || {})) {
    if (Array.isArray(v)) {
      const canon = normalizeBoneName(k);
      for (const item of v) customMap.set(normalizeBoneName(item), canon);
      customMap.set(canon, canon);
    } else if (typeof v === 'string') {
      customMap.set(k, v);
      customMap.set(normalizeBoneName(k), normalizeBoneName(v));
    }
  }

  const sourceByExact = new Map();
  const sourceByNorm = new Map();
  for (const b of src.bones) {
    if (!b?.name) continue;
    sourceByExact.set(b.name, b.name);
    const norm = normalizeBoneName(b.name);
    if (!sourceByNorm.has(norm)) sourceByNorm.set(norm, b.name);
  }

  /** @type {Record<string, string>} */
  const map = {};
  for (const tb of tgt.bones) {
    if (!tb?.name) continue;
    if (customMap.has(tb.name) && sourceByExact.has(customMap.get(tb.name))) {
      map[tb.name] = sourceByExact.get(customMap.get(tb.name));
      continue;
    }
    if (sourceByExact.has(tb.name)) {
      map[tb.name] = tb.name;
      continue;
    }
    const normT = normalizeBoneName(tb.name);
    const aliasedNorm = customMap.get(normT) ?? normT;
    if (sourceByNorm.has(aliasedNorm)) {
      map[tb.name] = sourceByNorm.get(aliasedNorm);
    } else if (sourceByNorm.has(normT)) {
      map[tb.name] = sourceByNorm.get(normT);
    }
  }
  return map;
}

function resolveTargetToSourceMap(boneMap, srcBones, tgtBones) {
  const srcNames = new Set(srcBones.map((b) => b.name));
  const tgtNames = new Set(tgtBones.map((b) => b.name));
  const entries = boneMap instanceof Map ? Array.from(boneMap.entries()) : Object.entries(boneMap || {});
  if (entries.length === 0) return new Map();

  let tgtKeyMatches = 0;
  let srcKeyMatches = 0;
  for (const [k, v] of entries) {
    if (tgtNames.has(k) && srcNames.has(v)) tgtKeyMatches++;
    if (srcNames.has(k) && tgtNames.has(v)) srcKeyMatches++;
  }

  const out = new Map();
  if (srcKeyMatches > tgtKeyMatches) {
    for (const [s, t] of entries) {
      if (tgtNames.has(t) && srcNames.has(s)) out.set(t, s);
    }
  } else {
    for (const [t, s] of entries) {
      if (tgtNames.has(t) && srcNames.has(s)) out.set(t, s);
    }
  }
  return out;
}

function findHipBoneName(bones, hipBoneHint) {
  if (hipBoneHint) {
    const exact = bones.find((b) => b.name === hipBoneHint);
    if (exact) return exact.name;
    const hintNorm = normalizeBoneName(hipBoneHint);
    const byNorm = bones.find((b) => normalizeBoneName(b.name) === hintNorm);
    if (byNorm) return byNorm.name;
  }
  const byHips = bones.find((b) => normalizeBoneName(b.name) === 'hips');
  return byHips?.name ?? bones[0]?.name ?? null;
}

function savePose(bones) {
  return bones.map((b) => ({
    bone: b,
    pos: b.position.clone(),
    quat: b.quaternion.clone(),
    scale: b.scale.clone(),
  }));
}

function restorePose(saved) {
  for (const s of saved) {
    s.bone.position.copy(s.pos);
    s.bone.quaternion.copy(s.quat);
    s.bone.scale.copy(s.scale);
  }
}

/**
 * Retarget a Three.js `AnimationClip` from `source` skeleton/armature onto `target` skeleton/armature
 * using rest-pose world orientation deltas and proportional hip translation scaling.
 *
 * @param {any} THREE Three.js namespace.
 * @param {any} clip Source `THREE.AnimationClip`.
 * @param {{
 *   source: any,
 *   target: any,
 *   boneMap?: Record<string, string> | Map<string, string>,
 *   hipBone?: string,
 *   scalePosition?: 'auto' | number,
 *   fps?: number,
 * }} options
 * @returns {any} Retargeted `THREE.AnimationClip`.
 */
export function retargetClip3D(THREE, clip, {
  source,
  target,
  boneMap = null,
  hipBone = 'Hips',
  scalePosition = 'auto',
  fps = 30,
} = {}) {
  if (!THREE?.AnimationMixer || !THREE?.AnimationClip || !THREE?.Quaternion) {
    throw new TypeError('retargetClip3D requires a complete Three.js namespace');
  }
  if (!clip) throw new TypeError('retargetClip3D requires a source AnimationClip');

  const src = extractBonesAndRoot(source);
  const tgt = extractBonesAndRoot(target);
  if (!src.root || !tgt.root) {
    throw new TypeError('retargetClip3D could not resolve source/target skeleton roots');
  }

  const effectiveMap = boneMap ?? createBoneMap3D(source, target);
  const tgtToSrc = resolveTargetToSourceMap(effectiveMap, src.bones, tgt.bones);

  const srcByName = new Map(src.bones.map((b) => [b.name, b]));
  const tgtByName = new Map(tgt.bones.map((b) => [b.name, b]));

  // Order target bones top-down (parent before child) so world rotations propagate cleanly
  const tgtOrder = [];
  const visited = new Set();
  const visitTgt = (obj) => {
    if (tgtByName.has(obj.name) && !visited.has(obj)) {
      visited.add(obj.name);
      tgtOrder.push(obj);
    }
    if (Array.isArray(obj.children)) {
      for (const ch of obj.children) visitTgt(ch);
    }
  };
  visitTgt(tgt.root);
  for (const b of tgt.bones) {
    if (!visited.has(b)) tgtOrder.push(b);
  }

  const srcSaved = savePose(src.bones);
  const tgtSaved = savePose(tgt.bones);

  // Capture rest-pose world orientations & hip world positions
  src.root.updateMatrixWorld(true);
  tgt.root.updateMatrixWorld(true);

  const srcRestWorldQuat = new Map();
  const srcRestWorldPos = new Map();
  for (const b of src.bones) {
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    b.getWorldPosition(p);
    b.getWorldQuaternion(q);
    srcRestWorldQuat.set(b.name, q);
    srcRestWorldPos.set(b.name, p);
  }

  const tgtRestWorldQuat = new Map();
  const tgtRestLocalQuat = new Map();
  const tgtRestLocalPos = new Map();
  const tgtRestWorldPos = new Map();
  for (const b of tgtOrder) {
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    b.getWorldPosition(p);
    b.getWorldQuaternion(q);
    tgtRestWorldQuat.set(b.name, q);
    tgtRestLocalQuat.set(b.name, b.quaternion.clone());
    tgtRestLocalPos.set(b.name, b.position.clone());
    tgtRestWorldPos.set(b.name, p);
  }

  const tgtHipName = findHipBoneName(tgtOrder, hipBone);
  const srcHipName = tgtHipName ? tgtToSrc.get(tgtHipName) ?? findHipBoneName(src.bones, hipBone) : null;

  let posScale = 1;
  if (typeof scalePosition === 'number' && Number.isFinite(scalePosition)) {
    posScale = scalePosition;
  } else if (srcHipName && tgtHipName) {
    const srcRootPos = new THREE.Vector3();
    const tgtRootPos = new THREE.Vector3();
    src.root.getWorldPosition(srcRootPos);
    tgt.root.getWorldPosition(tgtRootPos);
    const srcHipH = Math.abs(srcRestWorldPos.get(srcHipName).y - srcRootPos.y);
    const tgtHipH = Math.abs(tgtRestWorldPos.get(tgtHipName).y - tgtRootPos.y);
    if (srcHipH > 1e-4 && tgtHipH > 1e-4) {
      posScale = tgtHipH / srcHipH;
    }
  }

  const duration = Math.max(0, Number(clip.duration) || 0);
  const sampleFps = Math.max(1, Number(fps) || 30);
  const frameCount = duration > 0 ? Math.max(2, Math.round(duration * sampleFps) + 1) : 1;

  const times = new Float32Array(frameCount);
  const quatBuffers = new Map();
  for (const tb of tgtOrder) {
    if (tgtToSrc.has(tb.name)) {
      quatBuffers.set(tb.name, new Float32Array(frameCount * 4));
    }
  }
  const hipPosBuffer = tgtHipName && srcHipName ? new Float32Array(frameCount * 3) : null;

  const mixer = new THREE.AnimationMixer(src.root);
  const action = mixer.clipAction(clip);
  action.play();

  const qSrcWorld = new THREE.Quaternion();
  const qSrcRestInv = new THREE.Quaternion();
  const qTgtParentWorld = new THREE.Quaternion();
  const qTgtParentInv = new THREE.Quaternion();
  const qTgtWorld = new THREE.Quaternion();
  const qTgtLocal = new THREE.Quaternion();
  const vSrcHipWorld = new THREE.Vector3();
  const vDeltaWorld = new THREE.Vector3();
  const vLocalOffset = new THREE.Vector3();
  const vOutPos = new THREE.Vector3();

  const tgtParentWorldQuatAtFrame = new Map();

  try {
    let prevTime = 0;
    for (let f = 0; f < frameCount; f++) {
      const t = frameCount === 1 ? 0 : (f / (frameCount - 1)) * duration;
      times[f] = t;
      if (f === 0) {
        mixer.setTime(0);
      } else {
        mixer.update(t - prevTime);
      }
      prevTime = t;
      src.root.updateMatrixWorld(true);

      // Compute target parent world orientation at rest if root is outside target bones
      tgtParentWorldQuatAtFrame.clear();

      for (const tb of tgtOrder) {
        if (tb.parent && tgtParentWorldQuatAtFrame.has(tb.parent.name)) {
          qTgtParentWorld.copy(tgtParentWorldQuatAtFrame.get(tb.parent.name));
        } else if (tb.parent) {
          tb.parent.getWorldQuaternion(qTgtParentWorld);
        } else {
          qTgtParentWorld.identity();
        }

        const srcName = tgtToSrc.get(tb.name);
        if (srcName && srcByName.has(srcName)) {
          const sb = srcByName.get(srcName);
          sb.getWorldQuaternion(qSrcWorld);
          qSrcRestInv.copy(srcRestWorldQuat.get(srcName)).invert();

          // R_T_w(t) = R_S_w(t) * inv(R_S_w0) * R_T_w0
          qTgtWorld.copy(qSrcWorld).multiply(qSrcRestInv).multiply(tgtRestWorldQuat.get(tb.name));
          qTgtParentInv.copy(qTgtParentWorld).invert();
          qTgtLocal.copy(qTgtParentInv).multiply(qTgtWorld).normalize();

          const buf = quatBuffers.get(tb.name);
          const base = f * 4;
          buf[base] = qTgtLocal.x;
          buf[base + 1] = qTgtLocal.y;
          buf[base + 2] = qTgtLocal.z;
          buf[base + 3] = qTgtLocal.w;

          tgtParentWorldQuatAtFrame.set(tb.name, qTgtWorld.clone());
        } else {
          qTgtWorld.copy(qTgtParentWorld).multiply(tgtRestLocalQuat.get(tb.name));
          tgtParentWorldQuatAtFrame.set(tb.name, qTgtWorld.clone());
        }

        if (hipPosBuffer && tb.name === tgtHipName) {
          const sbHip = srcByName.get(srcHipName);
          sbHip.getWorldPosition(vSrcHipWorld);
          vDeltaWorld.copy(vSrcHipWorld).sub(srcRestWorldPos.get(srcHipName)).multiplyScalar(posScale);
          qTgtParentInv.copy(qTgtParentWorld).invert();
          vLocalOffset.copy(vDeltaWorld).applyQuaternion(qTgtParentInv);
          vOutPos.copy(tgtRestLocalPos.get(tb.name)).add(vLocalOffset);

          const base = f * 3;
          hipPosBuffer[base] = vOutPos.x;
          hipPosBuffer[base + 1] = vOutPos.y;
          hipPosBuffer[base + 2] = vOutPos.z;
        }
      }
    }
  } finally {
    action.stop();
    mixer.stopAllAction();
    restorePose(srcSaved);
    restorePose(tgtSaved);
    src.root.updateMatrixWorld(true);
    tgt.root.updateMatrixWorld(true);
  }

  const tracks = [];
  if (hipPosBuffer && tgtHipName) {
    tracks.push(new THREE.VectorKeyframeTrack(`${tgtHipName}.position`, times, hipPosBuffer));
  }
  for (const [boneName, values] of quatBuffers.entries()) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
  }

  return new THREE.AnimationClip(clip.name || 'retargeted', duration, tracks);
}

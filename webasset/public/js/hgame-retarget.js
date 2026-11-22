import * as THREE from 'three';
import { stripNodeNamespace } from '../runtime/hgame/integrations/model3d/helpers.js';

const LIMB_ALIGNMENT_CHAIN = {
  upperarm_l: 'lowerarm_l',
  lowerarm_l: 'hand_l',
  upperarm_r: 'lowerarm_r',
  lowerarm_r: 'hand_r',
  thigh_l: 'calf_l',
  calf_l: 'foot_l',
  thigh_r: 'calf_r',
  calf_r: 'foot_r',
};

const BONE_NAME_ALIASES = {
  hips: 'pelvis',
  spine: 'spine_01',
  spine1: 'spine_02',
  spine2: 'spine_03',
  chest: 'spine_03',
  upperchest: 'spine_03',
  neck: 'neck_01',
  head: 'head',
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
};

function canonicalBoneName(lower) {
  return BONE_NAME_ALIASES[lower] || lower;
}

function mapNodesByLower(root) {
  const byLower = new Map();
  if (!root) return byLower;
  const register = node => {
    if (!node.name) return;
    const lower = stripNodeNamespace(node.name).toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, node);
    const canon = canonicalBoneName(lower);
    if (canon !== lower && !byLower.has(canon)) byLower.set(canon, node);
  };
  root.traverse(node => {
    if (node.isBone || node.type === 'Bone') register(node);
  });
  root.traverse(register);
  return byLower;
}

function resolveRetargetSourceBone(dstLower, srcMap) {
  const canon = canonicalBoneName(dstLower);
  if (canon === 'spine_03' && srcMap.has('spine_05')) return srcMap.get('spine_05');
  if (canon === 'spine_02' && srcMap.has('spine_05') && srcMap.has('spine_03')) return srcMap.get('spine_03');
  if (srcMap.has(canon)) return srcMap.get(canon);
  if (srcMap.has(dstLower)) return srcMap.get(dstLower);
  const fingerAlias = canon
    .replace(/^indexfinger_/, 'index_')
    .replace(/^finger_/, 'middle_');
  if (srcMap.has(fingerAlias)) return srcMap.get(fingerAlias);
  return null;
}

/**
 * Snapshot local TRS transforms of all nodes in a Three.js hierarchy.
 */
export function captureNodeTransforms(root) {
  const snapshot = new Map();
  if (!root) return snapshot;
  root.traverse(node => {
    snapshot.set(node, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  });
  return snapshot;
}

/**
 * Restore local TRS transforms and reset any skinned skeletons back to rest pose.
 */
export function restoreNodeTransforms(root, snapshot) {
  if (!root) return;
  if (snapshot && snapshot.size > 0) {
    for (const [node, saved] of snapshot) {
      node.position.copy(saved.position);
      node.quaternion.copy(saved.quaternion);
      node.scale.copy(saved.scale);
    }
  }
  root.traverse(node => {
    if (node.isSkinnedMesh && node.skeleton) {
      node.skeleton.pose();
    }
  });
  root.updateMatrixWorld(true);
}

/**
 * Retarget Unreal-exported skeleton clips onto a target rigged GLB hierarchy.
 */
export function retargetUnrealClips(animEntry, targetRoot, { targetRestSnapshot = null, stripRootMotion = false } = {}) {
  if (!animEntry?.scene || !animEntry?.clips?.length || !targetRoot) return [];
  const srcRoot = animEntry.scene;
  const srcSnapshot = captureNodeTransforms(srcRoot);
  restoreNodeTransforms(targetRoot, targetRestSnapshot);
  srcRoot.updateMatrixWorld(true);

  const srcMap = mapNodesByLower(srcRoot);
  const dstMap = mapNodesByLower(targetRoot);

  const srcRestWQ = new Map();
  const srcRestWP = new Map();
  for (const [, node] of srcMap) {
    srcRestWQ.set(node, node.getWorldQuaternion(new THREE.Quaternion()));
    srcRestWP.set(node, node.getWorldPosition(new THREE.Vector3()));
  }

  const dstOrdered = [];
  targetRoot.traverse(node => dstOrdered.push(node));

  const dstAlignedWQ = new Map();
  const dstAlignDelta = new Map();
  const vDst = new THREE.Vector3();
  const vSrc = new THREE.Vector3();

  for (const dstNode of dstOrdered) {
    const lower = stripNodeNamespace(dstNode.name).toLowerCase();
    const canon = canonicalBoneName(lower);
    const restWQ = dstNode.getWorldQuaternion(new THREE.Quaternion());
    const parentDelta = dstNode.parent
      ? (dstAlignDelta.get(dstNode.parent) || new THREE.Quaternion())
      : new THREE.Quaternion();
    let curDelta = parentDelta.clone();

    const childLower = LIMB_ALIGNMENT_CHAIN[canon];
    const srcNode = resolveRetargetSourceBone(canon, srcMap);
    const srcChild = childLower ? resolveRetargetSourceBone(childLower, srcMap) : null;
    const dstChild = childLower ? dstMap.get(childLower) : null;
    if (srcNode && srcChild && dstChild) {
      dstNode.getWorldPosition(vDst);
      dstChild.getWorldPosition(vSrc);
      vDst.subVectors(vSrc, vDst).normalize().applyQuaternion(parentDelta);
      vSrc.copy(srcRestWP.get(srcChild)).sub(srcRestWP.get(srcNode)).normalize();
      if (vDst.lengthSq() > 0.5 && vSrc.lengthSq() > 0.5) {
        const dot = Math.max(-1, Math.min(1, vDst.dot(vSrc)));
        if (dot > -0.999) {
          const rot = new THREE.Quaternion().setFromUnitVectors(vDst, vSrc);
          curDelta = rot.multiply(curDelta);
        }
      }
    }
    dstAlignDelta.set(dstNode, curDelta);
    dstAlignedWQ.set(dstNode, curDelta.clone().multiply(restWQ));
  }

  const mappedPairs = [];
  for (const dstNode of dstOrdered) {
    const lower = stripNodeNamespace(dstNode.name).toLowerCase();
    const canon = canonicalBoneName(lower);
    if (!dstNode.name || canon === 'root') continue;
    const srcNode = resolveRetargetSourceBone(lower, srcMap);
    if (!srcNode) continue;
    const offsetQ = srcRestWQ.get(srcNode).clone().invert().multiply(dstAlignedWQ.get(dstNode));
    mappedPairs.push({
      dstNode,
      srcNode,
      offsetQ,
      quats: [],
      prevQ: null,
    });
  }

  const dstPelvis = dstMap.get('pelvis');
  const srcPelvis = srcMap.get('pelvis');
  const hasPelvisPos = Boolean(dstPelvis && srcPelvis && dstPelvis.parent);
  const dstPelvisRestWP = hasPelvisPos ? dstPelvis.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const srcPelvisRestWP = hasPelvisPos ? srcRestWP.get(srcPelvis).clone() : new THREE.Vector3();
  const pelvisScale = hasPelvisPos ? (dstPelvisRestWP.y / Math.max(0.1, srcPelvisRestWP.y)) : 1;
  if (hasPelvisPos) dstPelvis.parent.updateMatrixWorld(true);

  const srcMixer = new THREE.AnimationMixer(srcRoot);
  const outClips = [];
  const tmpWQ = new THREE.Quaternion();
  const tmpParentWQ = new THREE.Quaternion();
  const tmpLocalQ = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();

  try {
    for (const srcClip of animEntry.clips) {
      const dur = Math.max(0.01, Number(srcClip.duration) || 0.01);
      const sampleCount = Math.max(2, Math.min(240, Math.round(dur * 30) + 1));
      const times = new Float32Array(sampleCount);
      for (const pair of mappedPairs) {
        pair.quats = new Float32Array(sampleCount * 4);
        pair.prevQ = null;
      }
      const pelvisPositions = hasPelvisPos ? new Float32Array(sampleCount * 3) : null;

      const srcAction = srcMixer.clipAction(srcClip);
      srcAction.reset().play();

      for (let i = 0; i < sampleCount; i++) {
        const t = sampleCount > 1 ? (dur * i) / (sampleCount - 1) : 0;
        times[i] = t;
        srcMixer.setTime(t);
        srcRoot.updateMatrixWorld(true);

        const targetWQ = new Map();
        for (const pair of mappedPairs) {
          pair.srcNode.getWorldQuaternion(tmpWQ).multiply(pair.offsetQ);
          targetWQ.set(pair.dstNode, tmpWQ.clone());
          const parentWQ = pair.dstNode.parent
            ? (targetWQ.get(pair.dstNode.parent) || pair.dstNode.parent.getWorldQuaternion(tmpParentWQ))
            : tmpParentWQ.identity();
          tmpLocalQ.copy(parentWQ).invert().multiply(tmpWQ).normalize();
          if (pair.prevQ && tmpLocalQ.dot(pair.prevQ) < 0) {
            tmpLocalQ.set(-tmpLocalQ.x, -tmpLocalQ.y, -tmpLocalQ.z, -tmpLocalQ.w);
          }
          pair.prevQ = pair.prevQ || new THREE.Quaternion();
          pair.prevQ.copy(tmpLocalQ);
          const off = i * 4;
          pair.quats[off] = tmpLocalQ.x;
          pair.quats[off + 1] = tmpLocalQ.y;
          pair.quats[off + 2] = tmpLocalQ.z;
          pair.quats[off + 3] = tmpLocalQ.w;
        }

        if (hasPelvisPos && pelvisPositions) {
          srcPelvis.getWorldPosition(tmpPos).sub(srcPelvisRestWP).multiplyScalar(pelvisScale);
          if (stripRootMotion) {
            tmpPos.x = 0;
            tmpPos.z = 0;
          }
          tmpPos.add(dstPelvisRestWP);
          dstPelvis.parent.worldToLocal(tmpPos);
          const poff = i * 3;
          pelvisPositions[poff] = tmpPos.x;
          pelvisPositions[poff + 1] = tmpPos.y;
          pelvisPositions[poff + 2] = tmpPos.z;
        }
      }

      srcMixer.stopAllAction();
      const tracks = [];
      if (hasPelvisPos && pelvisPositions) {
        tracks.push(new THREE.VectorKeyframeTrack(`${dstPelvis.name}.position`, times, pelvisPositions));
      }
      for (const pair of mappedPairs) {
        tracks.push(new THREE.QuaternionKeyframeTrack(`${pair.dstNode.name}.quaternion`, times, pair.quats));
      }
      outClips.push(new THREE.AnimationClip(srcClip.name || 'Clip', dur, tracks));
    }
  } finally {
    restoreNodeTransforms(srcRoot, srcSnapshot);
  }

  return outClips;
}

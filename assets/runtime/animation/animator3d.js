/**
 * 3D Skeletal Animator (StateMachine, 1D/2D Blend Trees, Avatar Masks, Animation Events,
 * Two-Bone Analytic IK, and Clamped LookAt IK). Zero direct 'three' imports.
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function readVec3(input, out = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(input) || ArrayBuffer.isView(input)) {
    out.x = Number(input[0]) || 0;
    out.y = Number(input[1]) || 0;
    out.z = Number(input[2]) || 0;
    return out;
  }
  if (input && typeof input === 'object') {
    out.x = Number(input.x) || 0;
    out.y = Number(input.y) || 0;
    out.z = Number(input.z) || 0;
    return out;
  }
  out.x = 0; out.y = 0; out.z = 0;
  return out;
}

function quatNormalize(q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= len; q.y /= len; q.z /= len; q.w /= len;
  return q;
}

function quatMul(a, b, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const ax = a.x, ay = a.y, az = a.z, aw = a.w;
  const bx = b.x, by = b.y, bz = b.z, bw = b.w;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

function quatConjugate(q, out = { x: 0, y: 0, z: 0, w: 1 }) {
  out.x = -q.x; out.y = -q.y; out.z = -q.z; out.w = q.w;
  return out;
}

function quatFromUnitVectors(vx, vy, vz, tx, ty, tz, out = { x: 0, y: 0, z: 0, w: 1 }) {
  let r = vx * tx + vy * ty + vz * tz + 1;
  if (r < 1e-6) {
    r = 0;
    if (Math.abs(vx) > Math.abs(vz)) {
      out.x = -vy; out.y = vx; out.z = 0; out.w = r;
    } else {
      out.x = 0; out.y = -vz; out.z = vy; out.w = r;
    }
  } else {
    out.x = vy * tz - vz * ty;
    out.y = vz * tx - vx * tz;
    out.z = vx * ty - vy * tx;
    out.w = r;
  }
  return quatNormalize(out);
}

function quatSlerp(a, b, t, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const alpha = clamp(t, 0, 1);
  if (alpha === 0) { out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w; return out; }
  if (alpha === 1) { out.x = b.x; out.y = b.y; out.z = b.z; out.w = b.w; return out; }
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cosHalf = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalf < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw; cosHalf = -cosHalf;
  }
  if (cosHalf >= 0.9995) {
    out.x = a.x + (bx - a.x) * alpha;
    out.y = a.y + (by - a.y) * alpha;
    out.z = a.z + (bz - a.z) * alpha;
    out.w = a.w + (bw - a.w) * alpha;
    return quatNormalize(out);
  }
  const sinHalf = Math.sqrt(Math.max(0, 1 - cosHalf * cosHalf));
  const halfTheta = Math.atan2(sinHalf, cosHalf);
  const rA = Math.sin((1 - alpha) * halfTheta) / sinHalf;
  const rB = Math.sin(alpha * halfTheta) / sinHalf;
  out.x = a.x * rA + bx * rB;
  out.y = a.y * rA + by * rB;
  out.z = a.z * rA + bz * rB;
  out.w = a.w * rA + bw * rB;
  return quatNormalize(out);
}

function getWorldPositionFallback(node, out = { x: 0, y: 0, z: 0 }) {
  node.updateMatrixWorld?.(true);
  if (typeof node.getWorldPosition === 'function' && node.matrixWorld?.elements) {
    const e = node.matrixWorld.elements;
    out.x = e[12]; out.y = e[13]; out.z = e[14];
    return out;
  }
  const m = node.matrixWorld?.elements;
  if (m) {
    out.x = m[12]; out.y = m[13]; out.z = m[14];
    return out;
  }
  out.x = node.position?.x ?? 0;
  out.y = node.position?.y ?? 0;
  out.z = node.position?.z ?? 0;
  return out;
}

function getWorldQuatFallback(node, out = { x: 0, y: 0, z: 0, w: 1 }) {
  const m = node.matrixWorld?.elements;
  if (!m) {
    const q = node.quaternion;
    out.x = q?.x ?? 0; out.y = q?.y ?? 0; out.z = q?.z ?? 0; out.w = q?.w ?? 1;
    return quatNormalize(out);
  }
  // Extract pure rotation from upper-left 3x3 (column-major) normalizing column scales
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const m11 = m[0] / sx, m21 = m[1] / sx, m31 = m[2] / sx;
  const m12 = m[4] / sy, m22 = m[5] / sy, m32 = m[6] / sy;
  const m13 = m[8] / sz, m23 = m[9] / sz, m33 = m[10] / sz;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    out.w = 0.25 / s;
    out.x = (m32 - m23) * s;
    out.y = (m13 - m31) * s;
    out.z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(Math.max(1e-8, 1.0 + m11 - m22 - m33));
    out.w = (m32 - m23) / s;
    out.x = 0.25 * s;
    out.y = (m12 + m21) / s;
    out.z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(Math.max(1e-8, 1.0 + m22 - m11 - m33));
    out.w = (m13 - m31) / s;
    out.x = (m12 + m21) / s;
    out.y = 0.25 * s;
    out.z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(Math.max(1e-8, 1.0 + m33 - m11 - m22));
    out.w = (m21 - m12) / s;
    out.x = (m13 + m31) / s;
    out.y = (m23 + m32) / s;
    out.z = 0.25 * s;
  }
  return quatNormalize(out);
}

function rotateVecByQuat(vx, vy, vz, q, out = { x: 0, y: 0, z: 0 }) {
  const ix = q.w * vx + q.y * vz - q.z * vy;
  const iy = q.w * vy + q.z * vx - q.x * vz;
  const iz = q.w * vz + q.x * vy - q.y * vx;
  const iw = -q.x * vx - q.y * vy - q.z * vz;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

/**
 * Create a bone/track mask restricting an animator layer or clip to a subset of the skeleton.
 * @param {object} [spec]
 * @param {Iterable<string>} [spec.bones] Explicit included bone names.
 * @param {object | null} [spec.includeBranch=null] Root Bone/Object3D whose entire descendant subtree is included.
 * @param {Iterable<string>} [spec.exclude] Bone names explicitly excluded.
 * @param {Record<string, number> | Map<string, number> | null} [spec.weights=null] Optional per-bone weight in [0..1].
 */
export function createAvatarMask(spec = {}) {
  const included = new Set();
  const excluded = new Set();
  const hasExplicitInclude = spec.bones != null || spec.includeBranch != null;

  if (spec.bones) {
    for (const name of spec.bones) {
      if (typeof name === 'string' && name) included.add(name);
    }
  }
  if (spec.includeBranch && typeof spec.includeBranch.traverse === 'function') {
    spec.includeBranch.traverse(node => {
      if (node?.name) included.add(node.name);
    });
  }
  if (spec.exclude) {
    for (const name of spec.exclude) {
      if (typeof name === 'string' && name) excluded.add(name);
    }
  }
  const weightMap = spec.weights instanceof Map
    ? new Map(spec.weights)
    : (spec.weights ? new Map(Object.entries(spec.weights)) : null);

  function extractTargetName(trackName) {
    if (typeof trackName !== 'string') return '';
    const dot = trackName.indexOf('.');
    const head = dot >= 0 ? trackName.slice(0, dot) : trackName;
    const slash = head.lastIndexOf('/');
    const node = slash >= 0 ? head.slice(slash + 1) : head;
    const bracket = node.indexOf('[');
    return bracket >= 0 ? node.slice(0, bracket) : node;
  }

  function allows(boneName) {
    const clean = extractTargetName(boneName);
    if (excluded.has(clean)) return false;
    if (!hasExplicitInclude) return true;
    return included.has(clean);
  }

  function getWeight(boneName) {
    if (!allows(boneName)) return 0;
    const clean = extractTargetName(boneName);
    if (weightMap && weightMap.has(clean)) return clamp(Number(weightMap.get(clean)) || 0, 0, 1);
    return 1;
  }

  function filterClip(clip) {
    if (!clip || !Array.isArray(clip.tracks)) return clip;
    const keptTracks = clip.tracks.filter(t => allows(t?.name ?? ''));
    return {
      ...clip,
      tracks: keptTracks,
      validate: clip.validate,
      optimize: clip.optimize,
      resetDuration: clip.resetDuration,
    };
  }

  return Object.freeze({
    allows,
    getWeight,
    filterClip,
    get size() { return included.size; },
  });
}

/**
 * 1D parameter-driven animation blend tree (piecewise linear interpolation across sorted thresholds).
 * @param {Array<{ clip: string, threshold: number, speed?: number }>} entries
 */
export function createBlendTree1D(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('createBlendTree1D requires at least one entry');
  }
  const sorted = entries
    .map(e => ({ clip: String(e.clip), threshold: Number(e.threshold) || 0, speed: Number.isFinite(e.speed) ? e.speed : 1 }))
    .sort((a, b) => a.threshold - b.threshold);

  function evaluate(value = 0) {
    const v = Number.isFinite(value) ? value : 0;
    if (sorted.length === 1 || v <= sorted[0].threshold) {
      return [{ clip: sorted[0].clip, weight: 1, speed: sorted[0].speed }];
    }
    const last = sorted[sorted.length - 1];
    if (v >= last.threshold) {
      return [{ clip: last.clip, weight: 1, speed: last.speed }];
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (v >= a.threshold && v <= b.threshold) {
        const span = b.threshold - a.threshold;
        if (span <= 1e-8) return [{ clip: b.clip, weight: 1, speed: b.speed }];
        const t = (v - a.threshold) / span;
        return [
          { clip: a.clip, weight: 1 - t, speed: a.speed },
          { clip: b.clip, weight: t, speed: b.speed },
        ];
      }
    }
    return [{ clip: last.clip, weight: 1, speed: last.speed }];
  }

  return Object.freeze({ type: '1d', entries: sorted, evaluate });
}

/**
 * 2D Cartesian/directional animation blend tree using inverse-distance falloff weights.
 * @param {Array<{ clip: string, x: number, y: number, speed?: number }>} entries
 */
export function createBlendTree2D(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('createBlendTree2D requires at least one entry');
  }
  const nodes = entries.map(e => ({
    clip: String(e.clip),
    x: Number(e.x) || 0,
    y: Number(e.y) || 0,
    speed: Number.isFinite(e.speed) ? e.speed : 1,
  }));

  function evaluate(px = 0, py = 0) {
    const x = Number.isFinite(px) ? px : 0;
    const y = Number.isFinite(py) ? py : 0;
    if (nodes.length === 1) return [{ clip: nodes[0].clip, weight: 1, speed: nodes[0].speed }];

    const raw = new Array(nodes.length);
    let sum = 0;
    for (let i = 0; i < nodes.length; i++) {
      const dx = x - nodes[i].x;
      const dy = y - nodes[i].y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= 1e-10) {
        return [{ clip: nodes[i].clip, weight: 1, speed: nodes[i].speed }];
      }
      const w = 1 / dSq;
      raw[i] = w;
      sum += w;
    }
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const w = raw[i] / sum;
      if (w > 1e-4) out.push({ clip: nodes[i].clip, weight: w, speed: nodes[i].speed });
    }
    return out;
  }

  return Object.freeze({ type: '2d', entries: nodes, evaluate });
}

/**
 * Analytic Two-Bone IK solver using the Law of Cosines and pole plane alignment.
 * Mutates `rootBone.quaternion` and `midBone.quaternion` cleanly with zero per-call heap allocations.
 */
const _ikRootPos = { x: 0, y: 0, z: 0 };
const _ikMidPos = { x: 0, y: 0, z: 0 };
const _ikEndPos = { x: 0, y: 0, z: 0 };
const _ikTarget = { x: 0, y: 0, z: 0 };
const _ikPole = { x: 0, y: 0, z: 0 };
const _ikQ1 = { x: 0, y: 0, z: 0, w: 1 };
const _ikQ2 = { x: 0, y: 0, z: 0, w: 1 };
const _ikQ3 = { x: 0, y: 0, z: 0, w: 1 };
const _ikQ4 = { x: 0, y: 0, z: 0, w: 1 };

export function solveTwoBoneIK(rootBone, midBone, endBone, targetPos, polePos = null, { weight = 1 } = {}) {
  if (!rootBone || !midBone || !endBone) return false;
  const w = clamp(Number.isFinite(weight) ? weight : 1, 0, 1);
  if (w <= 0) return true;

  getWorldPositionFallback(rootBone, _ikRootPos);
  getWorldPositionFallback(midBone, _ikMidPos);
  getWorldPositionFallback(endBone, _ikEndPos);
  readVec3(targetPos, _ikTarget);

  const uX = _ikMidPos.x - _ikRootPos.x, uY = _ikMidPos.y - _ikRootPos.y, uZ = _ikMidPos.z - _ikRootPos.z;
  const lX = _ikEndPos.x - _ikMidPos.x, lY = _ikEndPos.y - _ikMidPos.y, lZ = _ikEndPos.z - _ikMidPos.z;
  const L1 = Math.hypot(uX, uY, uZ);
  const L2 = Math.hypot(lX, lY, lZ);
  if (L1 <= 1e-5 || L2 <= 1e-5) return false;

  const tX = _ikTarget.x - _ikRootPos.x, tY = _ikTarget.y - _ikRootPos.y, tZ = _ikTarget.z - _ikRootPos.z;
  const rawDist = Math.hypot(tX, tY, tZ);
  if (rawDist <= 1e-5) return false;

  const minD = Math.abs(L1 - L2) + 1e-4;
  const maxD = L1 + L2 - 1e-4;
  const d = clamp(rawDist, minD, maxD);
  const dirX = tX / rawDist, dirY = tY / rawDist, dirZ = tZ / rawDist;

  // Determine bend normal from pole vector (or fallback perpendicular)
  let pX, pY, pZ;
  if (polePos) {
    readVec3(polePos, _ikPole);
    pX = _ikPole.x - _ikRootPos.x; pY = _ikPole.y - _ikRootPos.y; pZ = _ikPole.z - _ikRootPos.z;
  } else {
    pX = uX + lX; pY = uY + lY; pZ = uZ + lZ;
  }
  const pDot = pX * dirX + pY * dirY + pZ * dirZ;
  let bX = pX - dirX * pDot;
  let bY = pY - dirY * pDot;
  let bZ = pZ - dirZ * pDot;
  let bLen = Math.hypot(bX, bY, bZ);
  if (bLen <= 1e-5) {
    // Fallback axis orthogonal to dir
    if (Math.abs(dirY) < 0.9) { bX = -dirZ; bY = 0; bZ = dirX; }
    else { bX = 1; bY = 0; bZ = 0; }
    bLen = Math.hypot(bX, bY, bZ) || 1;
  }
  bX /= bLen; bY /= bLen; bZ /= bLen;

  // Law of cosines for shoulder/hip angle from target direction toward bend direction
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const desUpperX = dirX * cosA + bX * sinA;
  const desUpperY = dirY * cosA + bY * sinA;
  const desUpperZ = dirZ * cosA + bZ * sinA;

  // Apply root rotation delta in local space
  const invL1 = 1 / L1;
  quatFromUnitVectors(uX * invL1, uY * invL1, uZ * invL1, desUpperX, desUpperY, desUpperZ, _ikQ1); // world delta
  const rootParentQ = rootBone.parent ? getWorldQuatFallback(rootBone.parent, _ikQ2) : { x: 0, y: 0, z: 0, w: 1 };
  const invRootParentQ = quatConjugate(rootParentQ, _ikQ3);
  const rootWorldQ = getWorldQuatFallback(rootBone, _ikQ4);
  const targetRootWorldQ = quatMul(_ikQ1, rootWorldQ, { x: 0, y: 0, z: 0, w: 1 });
  const targetRootLocalQ = quatMul(invRootParentQ, targetRootWorldQ, { x: 0, y: 0, z: 0, w: 1 });

  const blendedRootLocal = w < 1
    ? quatSlerp(rootBone.quaternion, targetRootLocalQ, w, { x: 0, y: 0, z: 0, w: 1 })
    : targetRootLocalQ;
  rootBone.quaternion.set?.(blendedRootLocal.x, blendedRootLocal.y, blendedRootLocal.z, blendedRootLocal.w);
  if (!rootBone.quaternion.set) Object.assign(rootBone.quaternion, blendedRootLocal);

  rootBone.updateMatrixWorld?.(true);

  // Recompute updated mid & end positions after root rotated
  getWorldPositionFallback(midBone, _ikMidPos);
  getWorldPositionFallback(endBone, _ikEndPos);
  const newLX = _ikEndPos.x - _ikMidPos.x, newLY = _ikEndPos.y - _ikMidPos.y, newLZ = _ikEndPos.z - _ikMidPos.z;
  const newLLen = Math.hypot(newLX, newLY, newLZ) || 1;
  const desiredEndPosX = _ikRootPos.x + dirX * d;
  const desiredEndPosY = _ikRootPos.y + dirY * d;
  const desiredEndPosZ = _ikRootPos.z + dirZ * d;
  const toEndX = desiredEndPosX - _ikMidPos.x;
  const toEndY = desiredEndPosY - _ikMidPos.y;
  const toEndZ = desiredEndPosZ - _ikMidPos.z;
  const toEndLen = Math.hypot(toEndX, toEndY, toEndZ) || 1;

  quatFromUnitVectors(newLX / newLLen, newLY / newLLen, newLZ / newLLen,
    toEndX / toEndLen, toEndY / toEndLen, toEndZ / toEndLen, _ikQ1);
  const midParentQ = getWorldQuatFallback(midBone.parent ?? rootBone, _ikQ2);
  const invMidParentQ = quatConjugate(midParentQ, _ikQ3);
  const midWorldQ = getWorldQuatFallback(midBone, _ikQ4);
  const targetMidWorldQ = quatMul(_ikQ1, midWorldQ, { x: 0, y: 0, z: 0, w: 1 });
  const targetMidLocalQ = quatMul(invMidParentQ, targetMidWorldQ, { x: 0, y: 0, z: 0, w: 1 });

  const blendedMidLocal = w < 1
    ? quatSlerp(midBone.quaternion, targetMidLocalQ, w, { x: 0, y: 0, z: 0, w: 1 })
    : targetMidLocalQ;
  midBone.quaternion.set?.(blendedMidLocal.x, blendedMidLocal.y, blendedMidLocal.z, blendedMidLocal.w);
  if (!midBone.quaternion.set) Object.assign(midBone.quaternion, blendedMidLocal);
  midBone.updateMatrixWorld?.(true);
  return true;
}

/**
 * Aim a bone's forward axis smoothly at a world-space target, clamped within `maxAngle` radians.
 */
export function solveLookAtIK(bone, targetPos, { maxAngle = Math.PI * 0.45, weight = 1, forwardAxis = [0, 0, 1] } = {}) {
  if (!bone) return false;
  const w = clamp(Number.isFinite(weight) ? weight : 1, 0, 1);
  if (w <= 0) return true;

  getWorldPositionFallback(bone, _ikRootPos);
  readVec3(targetPos, _ikTarget);
  const dx = _ikTarget.x - _ikRootPos.x, dy = _ikTarget.y - _ikRootPos.y, dz = _ikTarget.z - _ikRootPos.z;
  const dLen = Math.hypot(dx, dy, dz);
  if (dLen <= 1e-6) return false;
  const tx = dx / dLen, ty = dy / dLen, tz = dz / dLen;

  readVec3(forwardAxis, _ikPole);
  const fLen = Math.hypot(_ikPole.x, _ikPole.y, _ikPole.z) || 1;
  const fx = _ikPole.x / fLen, fy = _ikPole.y / fLen, fz = _ikPole.z / fLen;

  const worldQ = getWorldQuatFallback(bone, _ikQ1);
  const curFwd = rotateVecByQuat(fx, fy, fz, worldQ, _ikMidPos);
  const dot = clamp(curFwd.x * tx + curFwd.y * ty + curFwd.z * tz, -1, 1);
  const angle = Math.acos(dot);
  const deltaQuat = quatFromUnitVectors(curFwd.x, curFwd.y, curFwd.z, tx, ty, tz, _ikQ2);

  const clampedScale = angle > maxAngle && angle > 1e-6 ? maxAngle / angle : 1;
  const appliedDelta = clampedScale < 1
    ? quatSlerp({ x: 0, y: 0, z: 0, w: 1 }, deltaQuat, clampedScale, _ikQ3)
    : deltaQuat;

  const targetWorldQ = quatMul(appliedDelta, worldQ, _ikQ4);
  const parentWorldQ = bone.parent ? getWorldQuatFallback(bone.parent, _ikQ2) : { x: 0, y: 0, z: 0, w: 1 };
  const invParentQ = quatConjugate(parentWorldQ, _ikQ3);
  const targetLocalQ = quatMul(invParentQ, targetWorldQ, { x: 0, y: 0, z: 0, w: 1 });
  const blended = w < 1
    ? quatSlerp(bone.quaternion, targetLocalQ, w, { x: 0, y: 0, z: 0, w: 1 })
    : targetLocalQ;
  bone.quaternion.set?.(blended.x, blended.y, blended.z, blended.w);
  if (!bone.quaternion.set) Object.assign(bone.quaternion, blended);
  bone.updateMatrixWorld?.(true);
  return true;
}

function evalCondition(paramValue, cond) {
  const op = cond.op ?? '===';
  const rhs = cond.value;
  switch (op) {
    case '>': return paramValue > rhs;
    case '>=': return paramValue >= rhs;
    case '<': return paramValue < rhs;
    case '<=': return paramValue <= rhs;
    case '!==':
    case '!=': return paramValue !== rhs;
    case 'trigger': return Boolean(paramValue);
    case '==':
    case '===':
    default: return paramValue === rhs;
  }
}

/**
 * Multi-layer 3D skeletal Animator with finite state machine, 1D/2D blend trees,
 * AvatarMask layer filtering, keyframe AnimationEvents, and post-pose IK hooks.
 */
export function createAnimator3D({
  mixer = null,
  clips = [],
  states = {},
  transitions = [],
  initialState = null,
  parameters = {},
  layers = null,
  events = {},
  onEvent = null,
  THREE = null,
} = {}) {
  const paramValues = new Map(Object.entries(parameters));
  const triggerSet = new Set();
  const clipByName = new Map();
  for (const clip of clips) {
    if (clip?.name) clipByName.set(clip.name, clip);
  }
  const eventTable = new Map();
  for (const [clipName, list] of Object.entries(events || {})) {
    if (Array.isArray(list)) eventTable.set(clipName, list.map(e => ({ ...e })));
  }

  const ikSolvers = [];
  const layerConfigs = Array.isArray(layers) && layers.length > 0
    ? layers
    : [{
        name: 'base',
        weight: 1,
        mask: null,
        states,
        transitions,
        initialState,
      }];

  const layerStates = layerConfigs.map(cfg => {
    const stateKeys = Object.keys(cfg.states || {});
    const startName = cfg.initialState ?? stateKeys[0] ?? null;
    return {
      name: String(cfg.name ?? 'base'),
      weight: clamp(Number.isFinite(cfg.weight) ? cfg.weight : 1, 0, 1),
      mask: cfg.mask ?? null,
      states: cfg.states || {},
      transitions: Array.isArray(cfg.transitions) ? cfg.transitions : [],
      currentState: startName,
      previousState: null,
      stateTime: 0,
      prevStateTime: 0,
      crossFadeElapsed: 0,
      crossFadeDuration: 0,
      actions: new Map(),
      lastLapTimes: new Map(),
      weights: Object.create(null),
    };
  });

  function resolveAction(layer, clipName) {
    if (!mixer || !clipName) return null;
    const cacheKey = clipName;
    if (layer.actions.has(cacheKey)) return layer.actions.get(cacheKey);
    const rawClip = clipByName.get(clipName);
    if (!rawClip) return null;
    const clip = layer.mask ? layer.mask.filterClip(rawClip) : rawClip;
    const action = mixer.clipAction(clip);
    if (action) {
      action.enabled = true;
      action.play?.();
      action.setEffectiveWeight?.(0);
      layer.actions.set(cacheKey, action);
    }
    return action ?? null;
  }

  function evaluateStateClips(layer, stateName) {
    const def = layer.states[stateName];
    if (!def) return [];
    if (typeof def === 'string') return [{ clip: def, weight: 1, speed: 1 }];
    if (def.blendTree) {
      const val = def.param ? (paramValues.get(def.param) ?? 0) : 0;
      if (def.blendTree.type === '2d') {
        const px = def.paramX ? (paramValues.get(def.paramX) ?? 0) : (val?.x ?? 0);
        const py = def.paramY ? (paramValues.get(def.paramY) ?? 0) : (val?.y ?? 0);
        return def.blendTree.evaluate(px, py);
      }
      return def.blendTree.evaluate(val);
    }
    if (def.clip) return [{ clip: def.clip, weight: 1, speed: Number.isFinite(def.speed) ? def.speed : 1 }];
    return [];
  }

  function stateDuration(layer, stateName) {
    const list = evaluateStateClips(layer, stateName);
    let maxDur = 0;
    for (const item of list) {
      const c = clipByName.get(item.clip);
      if (c && Number.isFinite(c.duration) && c.duration > maxDur) maxDur = c.duration;
    }
    return maxDur > 0 ? maxDur : 1;
  }

  function checkTransitions(layer, exitTimeOnly = false) {
    const cur = layer.currentState;
    const dur = stateDuration(layer, cur);
    const normTime = dur > 0 ? layer.stateTime / dur : 0;

    for (const tr of layer.transitions) {
      if (exitTimeOnly && !tr.hasExitTime) continue;
      if (tr.from !== cur && tr.from !== '*') continue;
      if (tr.to === cur || !layer.states[tr.to]) continue;
      if (tr.hasExitTime && normTime < (tr.exitTime ?? 0.9)) continue;

      const conds = tr.conditions ?? [];
      let allMet = true;
      const usedTriggers = [];
      for (const c of conds) {
        if (c.op === 'trigger' || c.trigger) {
          const trigName = c.param ?? c.trigger;
          if (!triggerSet.has(trigName)) { allMet = false; break; }
          usedTriggers.push(trigName);
        } else {
          if (!evalCondition(paramValues.get(c.param), c)) { allMet = false; break; }
        }
      }
      if (allMet) {
        for (const t of usedTriggers) triggerSet.delete(t);
        layer.previousState = cur;
        layer.prevStateTime = layer.stateTime;
        layer.currentState = tr.to;
        layer.stateTime = 0;
        layer.crossFadeDuration = Math.max(0, Number(tr.duration ?? 0.18) || 0);
        layer.crossFadeElapsed = 0;
        return true;
      }
    }
    return false;
  }

  function dispatchClipEvents(layer, clipName, prevTime, nextTime, loop = true) {
    const list = eventTable.get(clipName);
    if (!list || list.length === 0) return;
    const clip = clipByName.get(clipName);
    const dur = clip?.duration > 0 ? clip.duration : 1;
    for (const evt of list) {
      const tau = Number.isFinite(evt.time) ? clamp(evt.time, 0, dur) : clamp((evt.normalizedTime ?? 0) * dur, 0, dur);
      if (loop) {
        const minLap = Math.max(0, Math.floor(prevTime / dur));
        const maxLap = Math.floor(nextTime / dur);
        for (let lap = minLap; lap <= maxLap; lap++) {
          const boundary = lap * dur + tau;
          const hit = (lap === 0 && prevTime === 0 && tau === 0) ? (nextTime >= 0) : (boundary > prevTime && boundary <= nextTime);
          if (hit) {
            const payload = { name: evt.name, clipName, layer: layer.name, time: tau, normalizedTime: tau / dur, loopCount: lap, data: evt.data };
            evt.callback?.(payload);
            onEvent?.(payload);
          }
        }
      } else if ((prevTime === 0 && tau === 0 && nextTime >= 0) || (tau > prevTime && tau <= nextTime)) {
        const payload = { name: evt.name, clipName, layer: layer.name, time: tau, normalizedTime: tau / dur, loopCount: 0, data: evt.data };
        evt.callback?.(payload);
        onEvent?.(payload);
      }
    }
  }

  function applyLayerWeights(layer, stepDt) {
    const nextWeights = Object.create(null);
    let blendFactor = 1;
    if (layer.previousState && layer.crossFadeDuration > 0 && layer.crossFadeElapsed < layer.crossFadeDuration) {
      layer.crossFadeElapsed = Math.min(layer.crossFadeDuration, layer.crossFadeElapsed + stepDt);
      blendFactor = clamp(layer.crossFadeElapsed / layer.crossFadeDuration, 0, 1);
      if (blendFactor >= 1) layer.previousState = null;
    } else if (layer.previousState && layer.crossFadeDuration <= 0) {
      layer.previousState = null;
    }

    const activeList = evaluateStateClips(layer, layer.currentState);
    for (const item of activeList) {
      const w = item.weight * blendFactor * layer.weight;
      nextWeights[item.clip] = (nextWeights[item.clip] ?? 0) + w;
    }
    if (layer.previousState && blendFactor < 1) {
      const prevList = evaluateStateClips(layer, layer.previousState);
      for (const item of prevList) {
        const w = item.weight * (1 - blendFactor) * layer.weight;
        nextWeights[item.clip] = (nextWeights[item.clip] ?? 0) + w;
      }
    }
    layer.weights = nextWeights;

    // Reset previously active actions then apply target weights
    for (const [name, action] of layer.actions) {
      if (!(name in nextWeights)) action.setEffectiveWeight?.(0);
    }
    for (const [clipName, weight] of Object.entries(nextWeights)) {
      const action = resolveAction(layer, clipName);
      if (!action) continue;
      action.enabled = weight > 0;
      action.setEffectiveWeight?.(weight);
      if (weight > 0.01) {
        const prevT = layer.lastLapTimes.get(clipName) ?? 0;
        const nextT = prevT + stepDt;
        layer.lastLapTimes.set(clipName, nextT);
        const stateDef = layer.states[layer.currentState];
        const loop = typeof stateDef === 'object' ? (stateDef.loop !== false) : true;
        dispatchClipEvents(layer, clipName, prevT, nextT, loop);
      }
    }
  }

  function update(dt = 0) {
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    for (const layer of layerStates) {
      checkTransitions(layer, false);
      layer.stateTime += stepDt;
      if (stepDt > 0) checkTransitions(layer, true);
      applyLayerWeights(layer, stepDt);
    }
    if (stepDt > 0) mixer?.update?.(stepDt);
    for (const solver of ikSolvers) {
      solver?.();
    }
  }

  // Seed initial weights synchronously
  update(0);

  return {
    THREE,
    setParam(name, value) {
      paramValues.set(String(name), value);
    },
    getParam(name) {
      return paramValues.get(String(name));
    },
    trigger(name) {
      triggerSet.add(String(name));
    },
    setLayerWeight(layerName, weight) {
      const layer = layerStates.find(l => l.name === layerName);
      if (!layer) return false;
      layer.weight = clamp(Number(weight) || 0, 0, 1);
      return true;
    },
    crossFade(stateName, duration = 0.2, layerName = 'base') {
      const layer = layerStates.find(l => l.name === layerName) ?? layerStates[0];
      if (!layer || !layer.states[stateName]) return false;
      layer.previousState = layer.currentState;
      layer.prevStateTime = layer.stateTime;
      layer.currentState = stateName;
      layer.stateTime = 0;
      layer.crossFadeDuration = Math.max(0, Number(duration) || 0);
      layer.crossFadeElapsed = 0;
      return true;
    },
    addIK(solverFn) {
      if (typeof solverFn === 'function') ikSolvers.push(solverFn);
    },
    removeIK(solverFn) {
      const idx = ikSolvers.indexOf(solverFn);
      if (idx >= 0) { ikSolvers.splice(idx, 1); return true; }
      return false;
    },
    getState(layerName = 'base') {
      const layer = layerStates.find(l => l.name === layerName) ?? layerStates[0];
      return layer ? layer.currentState : null;
    },
    getWeights(layerName = 'base') {
      const layer = layerStates.find(l => l.name === layerName) ?? layerStates[0];
      return layer ? { ...layer.weights } : {};
    },
    update,
    dispose() {
      ikSolvers.length = 0;
      triggerSet.clear();
      for (const layer of layerStates) {
        layer.actions.clear();
        layer.lastLapTimes.clear();
      }
    },
  };
}

/**
 * Multi-bone FABRIK (Forward And Backward Reaching Inverse Kinematics) solver with optional
 * pole target plane alignment and blend weight. Updates local bone quaternions in-place.
 * @param {object[]} bones Array of >= 3 Transform/Bone nodes `[root, ..., endEffector]`.
 * @param {{ x: number, y: number, z: number } | [number, number, number]} targetPos
 * @param {object} [options]
 * @param {number} [options.iterations=10]
 * @param {number} [options.tolerance=0.001]
 * @param {{ x: number, y: number, z: number } | [number, number, number] | null} [options.poleTarget=null]
 * @param {number} [options.weight=1]
 */
export function solveFabrikIK(bones, targetPos, {
  iterations = 10,
  tolerance = 0.001,
  poleTarget = null,
  weight = 1,
} = {}) {
  if (!Array.isArray(bones) || bones.length < 3) return false;
  const w = clamp(Number.isFinite(weight) ? weight : 1, 0, 1);
  if (w <= 0) return true;

  const n = bones.length;
  const pts = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const lengths = new Array(n - 1);
  const origDirs = new Array(n - 1);
  const origLocalQuats = new Array(n - 1);

  bones[0].updateMatrixWorld?.(true);
  for (let i = 0; i < n; i++) {
    getWorldPositionFallback(bones[i], pts[i]);
  }
  let totalLen = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6) return false;
    lengths[i] = len;
    totalLen += len;
    origDirs[i] = { x: dx / len, y: dy / len, z: dz / len };
    origLocalQuats[i] = { ...bones[i].quaternion };
  }

  const tgt = { x: 0, y: 0, z: 0 };
  readVec3(targetPos, tgt);
  const rootOrig = { ...pts[0] };
  const toTgtX = tgt.x - rootOrig.x;
  const toTgtY = tgt.y - rootOrig.y;
  const toTgtZ = tgt.z - rootOrig.z;
  const tgtDist = Math.hypot(toTgtX, toTgtY, toTgtZ);

  if (tgtDist >= totalLen) {
    // Straight stretch toward unreachable target
    const inv = tgtDist > 1e-6 ? 1 / tgtDist : 1;
    for (let i = 0; i < n - 1; i++) {
      pts[i + 1].x = pts[i].x + toTgtX * inv * lengths[i];
      pts[i + 1].y = pts[i].y + toTgtY * inv * lengths[i];
      pts[i + 1].z = pts[i].z + toTgtZ * inv * lengths[i];
    }
  } else {
    const maxIters = Math.max(1, Math.floor(Number(iterations) || 10));
    const tolSq = Math.max(1e-8, Number(tolerance) || 0.001) ** 2;
    for (let it = 0; it < maxIters; it++) {
      const endErrSq = (pts[n - 1].x - tgt.x) ** 2 + (pts[n - 1].y - tgt.y) ** 2 + (pts[n - 1].z - tgt.z) ** 2;
      if (endErrSq <= tolSq) break;

      // Forward pass (end -> root)
      pts[n - 1].x = tgt.x;
      pts[n - 1].y = tgt.y;
      pts[n - 1].z = tgt.z;
      for (let i = n - 2; i >= 0; i--) {
        const dx = pts[i].x - pts[i + 1].x;
        const dy = pts[i].y - pts[i + 1].y;
        const dz = pts[i].z - pts[i + 1].z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const scale = lengths[i] / d;
        pts[i].x = pts[i + 1].x + dx * scale;
        pts[i].y = pts[i + 1].y + dy * scale;
        pts[i].z = pts[i + 1].z + dz * scale;
      }

      // Backward pass (root -> end)
      pts[0].x = rootOrig.x;
      pts[0].y = rootOrig.y;
      pts[0].z = rootOrig.z;
      for (let i = 0; i < n - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x;
        const dy = pts[i + 1].y - pts[i].y;
        const dz = pts[i + 1].z - pts[i].z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const scale = lengths[i] / d;
        pts[i + 1].x = pts[i].x + dx * scale;
        pts[i + 1].y = pts[i].y + dy * scale;
        pts[i + 1].z = pts[i].z + dz * scale;
      }
    }
  }

  // Optional pole vector projection for intermediate joints
  if (poleTarget) {
    const pole = { x: 0, y: 0, z: 0 };
    readVec3(poleTarget, pole);
    const axisX = pts[n - 1].x - pts[0].x;
    const axisY = pts[n - 1].y - pts[0].y;
    const axisZ = pts[n - 1].z - pts[0].z;
    const axisLen = Math.hypot(axisX, axisY, axisZ);
    if (axisLen > 1e-5) {
      const ax = axisX / axisLen, ay = axisY / axisLen, az = axisZ / axisLen;
      for (let i = 1; i < n - 1; i++) {
        const proj = (pts[i].x - pts[0].x) * ax + (pts[i].y - pts[0].y) * ay + (pts[i].z - pts[0].z) * az;
        const onAxisX = pts[0].x + ax * proj;
        const onAxisY = pts[0].y + ay * proj;
        const onAxisZ = pts[0].z + az * proj;
        const radius = Math.hypot(pts[i].x - onAxisX, pts[i].y - onAxisY, pts[i].z - onAxisZ);
        if (radius > 1e-4) {
          const pProj = (pole.x - pts[0].x) * ax + (pole.y - pts[0].y) * ay + (pole.z - pts[0].z) * az;
          const pOnAxisX = pts[0].x + ax * pProj;
          const pOnAxisY = pts[0].y + ay * pProj;
          const pOnAxisZ = pts[0].z + az * pProj;
          const px = pole.x - pOnAxisX, py = pole.y - pOnAxisY, pz = pole.z - pOnAxisZ;
          const pLen = Math.hypot(px, py, pz);
          if (pLen > 1e-5) {
            pts[i].x = onAxisX + (px / pLen) * radius;
            pts[i].y = onAxisY + (py / pLen) * radius;
            pts[i].z = onAxisZ + (pz / pLen) * radius;
          }
        }
      }
    }
  }

  // Convert solved world segment directions into local quaternions sequentially
  for (let i = 0; i < n - 1; i++) {
    bones[i].updateMatrixWorld?.(true);
    const curNext = { x: 0, y: 0, z: 0 };
    const curStart = { x: 0, y: 0, z: 0 };
    getWorldPositionFallback(bones[i], curStart);
    getWorldPositionFallback(bones[i + 1], curNext);
    const cdx = curNext.x - curStart.x, cdy = curNext.y - curStart.y, cdz = curNext.z - curStart.z;
    const cLen = Math.hypot(cdx, cdy, cdz) || 1;
    const tdx = pts[i + 1].x - pts[i].x, tdy = pts[i + 1].y - pts[i].y, tdz = pts[i + 1].z - pts[i].z;
    const tLen = Math.hypot(tdx, tdy, tdz) || 1;

    const deltaW = quatFromUnitVectors(cdx / cLen, cdy / cLen, cdz / cLen, tdx / tLen, tdy / tLen, tdz / tLen, { x: 0, y: 0, z: 0, w: 1 });
    const parentW = bones[i].parent ? getWorldQuatFallback(bones[i].parent, { x: 0, y: 0, z: 0, w: 1 }) : { x: 0, y: 0, z: 0, w: 1 };
    const invParentW = quatConjugate(parentW, { x: 0, y: 0, z: 0, w: 1 });
    const boneW = getWorldQuatFallback(bones[i], { x: 0, y: 0, z: 0, w: 1 });
    const targetW = quatMul(deltaW, boneW, { x: 0, y: 0, z: 0, w: 1 });
    const targetLocal = quatMul(invParentW, targetW, { x: 0, y: 0, z: 0, w: 1 });
    const finalLocal = w < 1 ? quatSlerp(origLocalQuats[i], targetLocal, w, { x: 0, y: 0, z: 0, w: 1 }) : targetLocal;
    bones[i].quaternion.set?.(finalLocal.x, finalLocal.y, finalLocal.z, finalLocal.w);
    if (!bones[i].quaternion.set) Object.assign(bones[i].quaternion, finalLocal);
    bones[i].updateMatrixWorld?.(true);
  }
  return true;
}

/**
 * Extract incremental root motion displacement `(dx, dy, dz, dyaw)` from a root bone
 * relative to `prevState` and update `prevState` in-place.
 */
export function extractRootMotion(rootBone, prevState = { x: 0, y: 0, z: 0, yaw: 0, initialized: false }) {
  if (!rootBone?.position) return { dx: 0, dy: 0, dz: 0, dyaw: 0 };
  const x = Number(rootBone.position.x) || 0;
  const y = Number(rootBone.position.y) || 0;
  const z = Number(rootBone.position.z) || 0;
  const q = rootBone.quaternion;
  const yaw = q
    ? Math.atan2(2 * ((q.w || 1) * (q.y || 0) + (q.x || 0) * (q.z || 0)), 1 - 2 * ((q.y || 0) ** 2 + (q.z || 0) ** 2))
    : 0;
  if (!prevState.initialized) {
    prevState.x = x;
    prevState.y = y;
    prevState.z = z;
    prevState.yaw = yaw;
    prevState.initialized = true;
    return { dx: 0, dy: 0, dz: 0, dyaw: 0 };
  }
  const dx = x - prevState.x;
  const dy = y - prevState.y;
  const dz = z - prevState.z;
  let dyaw = yaw - prevState.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  prevState.x = x;
  prevState.y = y;
  prevState.z = z;
  prevState.yaw = yaw;
  return { dx, dy, dz, dyaw };
}

/**
 * Smoothly blend BlendShape / MorphTarget influences on a Three.js Mesh or skinned model root.
 * @param {object} root
 * @param {Record<string | number, number>} targetWeights Named or indexed morph target weights in [0, 1].
 * @param {number} [alpha=1] Smoothing/lerp factor toward `targetWeights`.
 */
export function blendMorphTargets(root, targetWeights, alpha = 1) {
  if (!root || !targetWeights || typeof targetWeights !== 'object') return 0;
  const t = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
  let updated = 0;
  const applyMesh = mesh => {
    const influences = mesh?.morphTargetInfluences;
    if (!Array.isArray(influences)) return;
    const dict = mesh.morphTargetDictionary;
    for (const [key, rawWeight] of Object.entries(targetWeights)) {
      const targetW = clamp(Number(rawWeight) || 0, 0, 1);
      const idx = dict && Object.hasOwn(dict, key) ? dict[key] : Number(key);
      if (Number.isInteger(idx) && idx >= 0 && idx < influences.length) {
        influences[idx] = influences[idx] + (targetW - influences[idx]) * t;
        updated++;
      }
    }
  };
  if (typeof root.traverse === 'function') root.traverse(applyMesh);
  else applyMesh(root);
  return updated;
}

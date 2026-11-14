import { damp, dampAngle, SpringDamper1D, SpringDamper3D } from '../time/tween.js';

const HALF_PI_CLAMP = Math.PI * 0.495;
const DEG_TO_RAD = Math.PI / 180;

function readVec3(src, fallback = { x: 0, y: 0, z: 0 }) {
  if (!src || typeof src !== 'object') return { ...fallback };
  return {
    x: Number(src.x) || 0,
    y: Number(src.y) || 0,
    z: Number(src.z) || 0,
  };
}

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

/**
 * Computes unit quaternion `{ x, y, z, w }` matching Three.js `'YXZ'` Euler order
 * (`q = Ry(yaw) * Rx(pitch) * Rz(roll)`).
 */
function eulerYXZToQuaternion(pitch, yaw, roll, out) {
  const c1 = Math.cos(pitch * 0.5);
  const s1 = Math.sin(pitch * 0.5);
  const c2 = Math.cos(yaw * 0.5);
  const s2 = Math.sin(yaw * 0.5);
  const c3 = Math.cos(roll * 0.5);
  const s3 = Math.sin(roll * 0.5);

  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 - s1 * s2 * c3;
  out.w = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}

/**
 * Rotates local vector `(vx, vy, vz)` by unit quaternion `{ x, y, z, w }` without allocating.
 */
function rotateVecByQuat(vx, vy, vz, q, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;

  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

function resolveHitDistance(hit, maxDistance) {
  if (hit == null || hit === false) return null;
  if (typeof hit === 'number') {
    if (!Number.isFinite(hit) || hit < 0) return null;
    return Math.min(maxDistance, hit);
  }
  if (typeof hit === 'object') {
    if (hit.hit === false) return null;
    if (Number.isFinite(hit.distance) && hit.distance >= 0) return Math.min(maxDistance, hit.distance);
    if (Number.isFinite(hit.toi) && hit.toi >= 0) return Math.min(maxDistance, hit.toi);
    if (Number.isFinite(hit.fraction) && hit.fraction >= 0) return Math.min(maxDistance, hit.fraction * maxDistance);
  }
  return null;
}

/**
 * @typedef {object} CameraVec3 Plain or Three.js-like vector.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @typedef {object} CameraQuat Plain or Three.js-like unit quaternion.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} w
 * @typedef {object} CameraThreeLike Used Three.js constructors (optional; plain objects otherwise).
 * @property {new () => CameraVec3} Vector3
 * @property {new () => CameraQuat} Quaternion
 * @typedef {object} CameraTargetLike Camera-like object written by `applyToCamera` / rig update.
 * @property {{x: number, y: number, z: number, set?: (x: number, y: number, z: number) => unknown}} [position]
 * @property {{x: number, y: number, z: number, w: number, set?: (x: number, y: number, z: number, w: number) => unknown}} [quaternion]
 * @property {number} [fov] Vertical FOV in degrees.
 * @property {() => void} [updateProjectionMatrix]
 * @typedef {number | boolean | null | undefined | {hit?: boolean, distance?: number, toi?: number, fraction?: number}} SpringArmHit
 * Collision result: distance from the pivot (number), an object with `distance`/`toi`/`fraction`, or no hit (`null`/`false`).
 * @typedef {(pivot: CameraVec3, desired: CameraVec3, direction: CameraVec3, maxDistance: number, probeRadius: number) => SpringArmHit} SpringArmCollisionTest
 * Sweep/raycast callback from pivot towards the desired camera position (world units).
 * @typedef {object} SpringArmAngles
 * @property {number} [yaw] Radians.
 * @property {number} [pitch] Radians, clamped to min/max pitch.
 * @property {number} [roll] Radians.
 * @typedef {object} SpringArmOverrides Per-update transient overrides.
 * @property {number} [yaw]
 * @property {number} [pitch]
 * @property {number} [roll]
 * @property {number} [armLength]
 * @typedef {object} SpringArmConfig Runtime-adjustable arm settings.
 * @property {number} [minArmLength] Minimum collided length. World units.
 * @property {number} [probeRadius] World units.
 * @property {number} [minPitch] Radians.
 * @property {number} [maxPitch] Radians.
 * @property {number} [lagHalfLife] Seconds.
 * @property {number} [inHalfLife] Seconds (collision shorten).
 * @property {number} [outHalfLife] Seconds (collision recover).
 * @typedef {object} SpringArm3DOptions
 * @property {CameraThreeLike | null} [THREE] Optional Three.js subset; results use Vector3/Quaternion. Default `null` (plain objects).
 * @property {number} [armLength] Nominal boom length, world units. Default `4.5`.
 * @property {number} [minArmLength] Minimum length when colliding. Default `0.4`.
 * @property {number} [probeRadius] Collision probe radius. Default `0.22`.
 * @property {CameraVec3} [targetOffset] Pivot offset from target. Default `{x:0,y:1.5,z:0}`.
 * @property {CameraVec3} [socketOffset] Camera offset in boom-local space. Default zero.
 * @property {number} [yaw] Radians. Default `0`.
 * @property {number} [pitch] Radians. Default `-0.25`.
 * @property {number} [roll] Radians. Default `0`.
 * @property {number} [minPitch] Radians. Default `-0.495π`.
 * @property {number} [maxPitch] Radians. Default `0.495π`.
 * @property {number} [lagHalfLife] Target-follow half-life, seconds. Default `0.08`.
 * @property {'spring'|'exp'} [lagMode] Lag model. Default `'spring'`.
 * @property {number} [maxLagDistance] Max pivot lag distance, world units. Default `Infinity`.
 * @property {SpringArmCollisionTest | null} [collisionTest] Default `null`.
 * @property {number} [inHalfLife] Shorten half-life, seconds. Default `0.015`.
 * @property {number} [outHalfLife] Recover half-life, seconds. Default `0.18`.
 * @typedef {object} SpringArmResult Live (reused, non-copied) solve result.
 * @property {CameraVec3} pivot
 * @property {CameraVec3} position Final camera position.
 * @property {CameraVec3} forward
 * @property {CameraVec3} right
 * @property {CameraVec3} up
 * @property {CameraQuat} quaternion
 * @property {number} currentLength
 * @property {number} desiredLength
 * @property {boolean} collided
 * @typedef {object} SpringArm3D
 * @property {number} yaw Radians (read-only).
 * @property {number} pitch Radians (read-only).
 * @property {number} roll Radians (read-only).
 * @property {number} armLength Nominal length (read-only).
 * @property {number} currentLength Collision-adjusted length (read-only).
 * @property {boolean} collided Last update collided (read-only).
 * @property {CameraVec3} targetOffset Mutable pivot offset.
 * @property {CameraVec3} socketOffset Mutable socket offset.
 * @property {(angles?: SpringArmAngles) => SpringArm3D} setAngles
 * @property {(deltaYaw?: number, deltaPitch?: number, deltaRoll?: number) => SpringArm3D} addAngles
 * @property {(length: number) => SpringArm3D} setArmLength
 * @property {(config?: SpringArmConfig) => SpringArm3D} setConfig
 * @property {(fn: SpringArmCollisionTest | null) => SpringArm3D} setCollisionTest
 * @property {(targetPosition?: CameraVec3) => SpringArm3D} snap Teleport pivot to target, no lag.
 * @property {(dt?: number, targetPosition?: CameraVec3, overrides?: SpringArmOverrides | null) => SpringArmResult} update
 * @property {(camera: CameraTargetLike | null, dt?: number, targetPosition?: CameraVec3, overrides?: SpringArmOverrides | null) => SpringArmResult} applyToCamera
 */
/**
 * Creates a spring-arm camera boom with target lag smoothing, `'YXZ'` orbital
 * framing, optional over-the-shoulder socket offsets, and asymmetric fast-in /
 * smooth-out collision recovery.
 *
 * Works cleanly with injected `{ THREE }` or headless plain objects.
 * @param {SpringArm3DOptions} [options]
 * @returns {SpringArm3D}
 */
export function createSpringArm3D({
  THREE = null,
  armLength = 4.5,
  minArmLength = 0.4,
  probeRadius = 0.22,
  targetOffset = { x: 0, y: 1.5, z: 0 },
  socketOffset = { x: 0, y: 0, z: 0 },
  yaw = 0,
  pitch = -0.25,
  roll = 0,
  minPitch = -HALF_PI_CLAMP,
  maxPitch = HALF_PI_CLAMP,
  lagHalfLife = 0.08,
  lagMode = 'spring',
  maxLagDistance = Infinity,
  collisionTest = null,
  inHalfLife = 0.015,
  outHalfLife = 0.18,
} = {}) {
  const pivotSpring = new SpringDamper3D({ halfLife: lagHalfLife });
  const targetOff = readVec3(targetOffset);
  const socketOff = readVec3(socketOffset);

  const state = {
    yaw: Number(yaw) || 0,
    minPitch: Number(minPitch),
    maxPitch: Number(maxPitch),
    pitch: clamp(Number(pitch) || 0, minPitch, maxPitch),
    roll: Number(roll) || 0,
    armLength: Math.max(0, Number(armLength) || 0),
    minArmLength: Math.max(0, Number(minArmLength) || 0),
    probeRadius: Math.max(0, Number(probeRadius) || 0),
    lagHalfLife: Math.max(0, Number(lagHalfLife) || 0),
    inHalfLife: Math.max(0, Number(inHalfLife) || 0),
    outHalfLife: Math.max(0, Number(outHalfLife) || 0),
    currentLength: Math.max(0, Number(armLength) || 0),
    desiredLength: Math.max(0, Number(armLength) || 0),
    collided: false,
    initialized: false,
  };

  let activeCollisionTest = collisionTest;

  const pivotPos = THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
  const desiredCameraPos = THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
  const finalCameraPos = THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
  const forwardVec = THREE ? new THREE.Vector3() : { x: 0, y: 0, z: -1 };
  const rightVec = THREE ? new THREE.Vector3() : { x: 1, y: 0, z: 0 };
  const upVec = THREE ? new THREE.Vector3() : { x: 0, y: 1, z: 0 };
  const backVec = { x: 0, y: 0, z: 1 };
  const socketWorldVec = { x: 0, y: 0, z: 0 };
  const quat = THREE ? new THREE.Quaternion() : { x: 0, y: 0, z: 0, w: 1 };

  function setAngles({ yaw: nextYaw, pitch: nextPitch, roll: nextRoll } = {}) {
    if (nextYaw !== undefined && Number.isFinite(nextYaw)) state.yaw = nextYaw;
    if (nextPitch !== undefined && Number.isFinite(nextPitch)) {
      state.pitch = clamp(nextPitch, state.minPitch, state.maxPitch);
    }
    if (nextRoll !== undefined && Number.isFinite(nextRoll)) state.roll = nextRoll;
    return arm;
  }

  function addAngles(deltaYaw = 0, deltaPitch = 0, deltaRoll = 0) {
    state.yaw += Number(deltaYaw) || 0;
    state.pitch = clamp(state.pitch + (Number(deltaPitch) || 0), state.minPitch, state.maxPitch);
    state.roll += Number(deltaRoll) || 0;
    return arm;
  }

  function setConfig(cfg = {}) {
    if (cfg.minArmLength !== undefined && Number.isFinite(cfg.minArmLength)) {
      state.minArmLength = Math.max(0, cfg.minArmLength);
    }
    if (cfg.probeRadius !== undefined && Number.isFinite(cfg.probeRadius)) {
      state.probeRadius = Math.max(0, cfg.probeRadius);
    }
    if (cfg.minPitch !== undefined && Number.isFinite(cfg.minPitch)) state.minPitch = cfg.minPitch;
    if (cfg.maxPitch !== undefined && Number.isFinite(cfg.maxPitch)) state.maxPitch = cfg.maxPitch;
    state.pitch = clamp(state.pitch, state.minPitch, state.maxPitch);
    if (cfg.lagHalfLife !== undefined && Number.isFinite(cfg.lagHalfLife)) {
      state.lagHalfLife = Math.max(0, cfg.lagHalfLife);
      pivotSpring.halfLife = state.lagHalfLife;
    }
    if (cfg.inHalfLife !== undefined && Number.isFinite(cfg.inHalfLife)) {
      state.inHalfLife = Math.max(0, cfg.inHalfLife);
    }
    if (cfg.outHalfLife !== undefined && Number.isFinite(cfg.outHalfLife)) {
      state.outHalfLife = Math.max(0, cfg.outHalfLife);
    }
    return arm;
  }

  function setArmLength(length) {
    if (!Number.isFinite(length) || length < 0) {
      throw new RangeError('armLength must be a finite number >= 0');
    }
    state.armLength = length;
    return arm;
  }

  function setCollisionTest(fn) {
    activeCollisionTest = typeof fn === 'function' ? fn : null;
    return arm;
  }

  function snap(targetPosition = { x: 0, y: 0, z: 0 }) {
    const px = (Number(targetPosition.x) || 0) + targetOff.x;
    const py = (Number(targetPosition.y) || 0) + targetOff.y;
    const pz = (Number(targetPosition.z) || 0) + targetOff.z;
    pivotSpring.snap(px, py, pz, 0, 0, 0);
    pivotPos.x = px;
    pivotPos.y = py;
    pivotPos.z = pz;
    state.currentLength = state.armLength;
    state.desiredLength = state.armLength;
    state.collided = false;
    state.initialized = true;
    return arm;
  }

  function update(dt = 0, targetPosition = { x: 0, y: 0, z: 0 }, overrides = null) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const tx = (Number(targetPosition?.x) || 0) + targetOff.x;
    const ty = (Number(targetPosition?.y) || 0) + targetOff.y;
    const tz = (Number(targetPosition?.z) || 0) + targetOff.z;

    if (!state.initialized) {
      snap(targetPosition);
    } else if (delta > 0 && state.lagHalfLife > 0) {
      if (lagMode === 'exp') {
        pivotSpring.x = damp(pivotSpring.x, tx, state.lagHalfLife, delta);
        pivotSpring.y = damp(pivotSpring.y, ty, state.lagHalfLife, delta);
        pivotSpring.z = damp(pivotSpring.z, tz, state.lagHalfLife, delta);
      } else {
        pivotSpring.halfLife = state.lagHalfLife;
        pivotSpring.step(delta, tx, ty, tz);
      }
      if (Number.isFinite(maxLagDistance) && maxLagDistance >= 0) {
        const dx = pivotSpring.x - tx;
        const dy = pivotSpring.y - ty;
        const dz = pivotSpring.z - tz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > maxLagDistance * maxLagDistance) {
          const scale = maxLagDistance / Math.sqrt(distSq);
          pivotSpring.x = tx + dx * scale;
          pivotSpring.y = ty + dy * scale;
          pivotSpring.z = tz + dz * scale;
        }
      }
      pivotPos.x = pivotSpring.x;
      pivotPos.y = pivotSpring.y;
      pivotPos.z = pivotSpring.z;
    } else {
      pivotSpring.snap(tx, ty, tz, 0, 0, 0);
      pivotPos.x = tx;
      pivotPos.y = ty;
      pivotPos.z = tz;
    }

    const effPitch = overrides?.pitch !== undefined ? overrides.pitch : state.pitch;
    const effYaw = overrides?.yaw !== undefined ? overrides.yaw : state.yaw;
    const effRoll = overrides?.roll !== undefined ? overrides.roll : state.roll;

    eulerYXZToQuaternion(effPitch, effYaw, effRoll, quat);
    rotateVecByQuat(0, 0, -1, quat, forwardVec);
    rotateVecByQuat(1, 0, 0, quat, rightVec);
    rotateVecByQuat(0, 1, 0, quat, upVec);
    backVec.x = -forwardVec.x;
    backVec.y = -forwardVec.y;
    backVec.z = -forwardVec.z;

    const nominalLength = overrides?.armLength !== undefined ? Math.max(0, overrides.armLength) : state.armLength;
    state.desiredLength = nominalLength;

    let targetLength = nominalLength;
    state.collided = false;

    if (nominalLength > 0 && activeCollisionTest) {
      rotateVecByQuat(socketOff.x, socketOff.y, socketOff.z, quat, socketWorldVec);
      desiredCameraPos.x = pivotPos.x + socketWorldVec.x + backVec.x * nominalLength;
      desiredCameraPos.y = pivotPos.y + socketWorldVec.y + backVec.y * nominalLength;
      desiredCameraPos.z = pivotPos.z + socketWorldVec.z + backVec.z * nominalLength;

      const hit = activeCollisionTest(pivotPos, desiredCameraPos, backVec, nominalLength, state.probeRadius);
      const hitDist = resolveHitDistance(hit, nominalLength);
      if (hitDist !== null) {
        state.collided = true;
        const clampedMin = Math.min(state.minArmLength, nominalLength);
        targetLength = Math.max(clampedMin, hitDist - state.probeRadius);
      }
    } else {
      rotateVecByQuat(socketOff.x, socketOff.y, socketOff.z, quat, socketWorldVec);
    }

    if (delta <= 0) {
      state.currentLength = targetLength;
    } else {
      const recoveryHalfLife = targetLength < state.currentLength ? state.inHalfLife : state.outHalfLife;
      state.currentLength = damp(state.currentLength, targetLength, recoveryHalfLife, delta);
    }

    finalCameraPos.x = pivotPos.x + socketWorldVec.x + backVec.x * state.currentLength;
    finalCameraPos.y = pivotPos.y + socketWorldVec.y + backVec.y * state.currentLength;
    finalCameraPos.z = pivotPos.z + socketWorldVec.z + backVec.z * state.currentLength;

    return {
      pivot: pivotPos,
      position: finalCameraPos,
      forward: forwardVec,
      right: rightVec,
      up: upVec,
      quaternion: quat,
      currentLength: state.currentLength,
      desiredLength: state.desiredLength,
      collided: state.collided,
    };
  }

  function applyToCamera(camera, dt = 0, targetPosition = { x: 0, y: 0, z: 0 }, overrides = null) {
    const result = update(dt, targetPosition, overrides);
    if (camera) {
      if (camera.position) {
        if (typeof camera.position.set === 'function') {
          camera.position.set(result.position.x, result.position.y, result.position.z);
        } else {
          camera.position.x = result.position.x;
          camera.position.y = result.position.y;
          camera.position.z = result.position.z;
        }
      }
      if (camera.quaternion) {
        if (typeof camera.quaternion.set === 'function') {
          camera.quaternion.set(result.quaternion.x, result.quaternion.y, result.quaternion.z, result.quaternion.w);
        } else {
          camera.quaternion.x = result.quaternion.x;
          camera.quaternion.y = result.quaternion.y;
          camera.quaternion.z = result.quaternion.z;
          camera.quaternion.w = result.quaternion.w;
        }
      }
    }
    return result;
  }

  const arm = {
    get yaw() { return state.yaw; },
    get pitch() { return state.pitch; },
    get roll() { return state.roll; },
    get armLength() { return state.armLength; },
    get currentLength() { return state.currentLength; },
    get collided() { return state.collided; },
    get targetOffset() { return targetOff; },
    get socketOffset() { return socketOff; },
    setAngles,
    addAngles,
    setArmLength,
    setConfig,
    setCollisionTest,
    snap,
    update,
    applyToCamera,
  };

  return arm;
}

/**
 * @typedef {'thirdPerson'|'firstPerson'|'topDown'} CameraRigMode
 * @typedef {Omit<SpringArm3DOptions, 'THREE' | 'collisionTest'>} CameraRigPreset Spring-arm overrides for a mode.
 * @typedef {object} CameraShakeAngles Maximum shake angles in radians.
 * @property {number} [pitch] Default `0.045`.
 * @property {number} [yaw] Default `0.045`.
 * @property {number} [roll] Default `0.08`.
 * @typedef {object} CameraRig3DOptions
 * @property {CameraThreeLike | null} [THREE] Optional Three.js subset. Default `null`.
 * @property {CameraTargetLike | null} [camera] Camera updated by `update`. Default `null`.
 * @property {CameraRigMode} [mode] Initial mode. Default `'thirdPerson'`.
 * @property {number} [baseFov] Degrees. Default `70`.
 * @property {number} [fovHalfLife] FOV blend half-life, seconds. Default `0.1`.
 * @property {number} [traumaDecay] Trauma decay per second. Default `1.6`.
 * @property {number} [traumaExponent] Shake intensity = trauma^exponent. Default `2`.
 * @property {number} [shakeFrequency] Shake rate, rad/s clock multiplier. Default `26`.
 * @property {CameraShakeAngles} [maxShakeAngles] Radians. Default `{pitch:0.045,yaw:0.045,roll:0.08}`.
 * @property {CameraVec3} [maxShakeOffset] Max shake translation, world units. Default `{x:0.14,y:0.14,z:0.08}`.
 * @property {number} [recoilHalfLife] Recoil recovery half-life, seconds. Default `0.08`.
 * @property {CameraRigPreset} [thirdPerson] Preset overrides. Default `{}`.
 * @property {CameraRigPreset} [firstPerson] Preset overrides. Default `{}`.
 * @property {CameraRigPreset} [topDown] Preset overrides. Default `{}`.
 * @property {SpringArmCollisionTest | null} [collisionTest] Default `null`.
 * @typedef {object} CameraRecoil
 * @property {number} [pitch] Radians kick. Default `0`.
 * @property {number} [yaw] Radians kick. Default `0`.
 * @property {number} [roll] Radians kick. Default `0`.
 * @property {number} [pushback] Boom pushback, world units. Default `0`.
 * @typedef {object} CameraFovModifier
 * @property {number | null} [fov] Absolute target FOV (5..175 deg). Default `null`.
 * @property {number} [deltaFov] Offset from base FOV in degrees when `fov` is null. Default `0`.
 * @property {number} [priority] Higher wins; ties go to latest. Default `0`.
 * @property {number} [blendIn] Half-life when active, seconds. Default `0.1`.
 * @property {number} [blendOut] Half-life after clear, seconds. Default `0.16`.
 * @typedef {object} CameraLookMultipliers
 * @property {number} [pitchMultiplier] Default `1`.
 * @property {number} [yawMultiplier] Default `1`.
 * @typedef {SpringArmResult & {mode: CameraRigMode, fov: number, trauma: number, shakeIntensity: number}} CameraRigResult
 * @typedef {object} CameraRig3D
 * @property {SpringArm3D} arm Underlying spring arm.
 * @property {CameraRigMode} mode Current mode (read-only).
 * @property {number} fov Current FOV, degrees (read-only).
 * @property {number} baseFov Base FOV, degrees (read-only).
 * @property {number} trauma Current trauma 0..1 (read-only).
 * @property {number} yaw Radians (read-only).
 * @property {number} pitch Radians (read-only).
 * @property {(mode: CameraRigMode, overrides?: CameraRigPreset | null) => CameraRig3D} setMode Throws RangeError for unknown modes.
 * @property {(angles?: SpringArmAngles) => CameraRig3D} setAngles
 * @property {(deltaYaw?: number, deltaPitch?: number, multipliers?: CameraLookMultipliers) => CameraRig3D} addLookDelta Radians.
 * @property {(amount?: number) => number} addTrauma Adds 0..1 trauma (default 0.5); returns new trauma.
 * @property {() => CameraRig3D} clearTrauma
 * @property {(recoil?: CameraRecoil) => CameraRig3D} addRecoil
 * @property {(fov: number) => CameraRig3D} setBaseFov Degrees, (1, 179).
 * @property {(id: string, modifier?: CameraFovModifier) => CameraRig3D} setFovModifier
 * @property {(id: string) => boolean} clearFovModifier True if it existed.
 * @property {(targetPosition?: CameraVec3) => CameraRig3D} snap
 * @property {(dt?: number, targetPosition?: CameraVec3) => CameraRigResult} update Advance; `dt` seconds.
 */
/**
 * Multi-mode 3D camera rig featuring Third-Person / First-Person / Top-Down
 * presets, quadratic trauma camera shake, spring recoil kick & recovery, and
 * priority-layered smooth FOV modifiers.
 * @param {CameraRig3DOptions} [options]
 * @returns {CameraRig3D}
 */
export function createCameraRig3D({
  THREE = null,
  camera = null,
  mode = 'thirdPerson',
  baseFov = 70,
  fovHalfLife = 0.1,
  traumaDecay = 1.6,
  traumaExponent = 2,
  shakeFrequency = 26,
  maxShakeAngles = { pitch: 0.045, yaw: 0.045, roll: 0.08 },
  maxShakeOffset = { x: 0.14, y: 0.14, z: 0.08 },
  recoilHalfLife = 0.08,
  thirdPerson = {},
  firstPerson = {},
  topDown = {},
  collisionTest = null,
} = {}) {
  const modePresets = {
    thirdPerson: {
      armLength: 4.5,
      minArmLength: 0.45,
      targetOffset: { x: 0, y: 1.55, z: 0 },
      socketOffset: { x: 0.45, y: 0.15, z: 0 },
      pitch: -0.22,
      minPitch: -HALF_PI_CLAMP,
      maxPitch: HALF_PI_CLAMP,
      lagHalfLife: 0.07,
      ...thirdPerson,
    },
    firstPerson: {
      armLength: 0,
      minArmLength: 0,
      targetOffset: { x: 0, y: 1.68, z: 0 },
      socketOffset: { x: 0, y: 0, z: 0 },
      pitch: 0,
      minPitch: -HALF_PI_CLAMP,
      maxPitch: HALF_PI_CLAMP,
      lagHalfLife: 0,
      ...firstPerson,
    },
    topDown: {
      armLength: 14,
      minArmLength: 2,
      targetOffset: { x: 0, y: 0, z: 0 },
      socketOffset: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: -60 * DEG_TO_RAD,
      minPitch: -89 * DEG_TO_RAD,
      maxPitch: -15 * DEG_TO_RAD,
      lagHalfLife: 0.1,
      ...topDown,
    },
  };

  let currentMode = modePresets[mode] ? mode : 'thirdPerson';
  const initialPreset = modePresets[currentMode];

  const arm = createSpringArm3D({
    THREE,
    ...initialPreset,
    collisionTest,
  });

  const recoilPitchSpring = new SpringDamper1D({ halfLife: recoilHalfLife });
  const recoilYawSpring = new SpringDamper1D({ halfLife: recoilHalfLife });
  const recoilRollSpring = new SpringDamper1D({ halfLife: recoilHalfLife });
  const recoilPushSpring = new SpringDamper1D({ halfLife: recoilHalfLife });

  /** @type {Map<string, { id: string, fov: number | null, deltaFov: number, priority: number, blendIn: number, blendOut: number, order: number }>} */
  const fovModifiers = new Map();
  let fovOrder = 0;
  let activeBaseFov = Number(baseFov) || 70;
  let currentFov = activeBaseFov;
  let lastBlendOutHalfLife = fovHalfLife;

  let trauma = 0;
  let shakeClock = 0;

  const shakeQuat = { x: 0, y: 0, z: 0, w: 1 };
  const shakeWorldOffset = { x: 0, y: 0, z: 0 };
  const shakeMaxAngles = readVec3(
    { x: maxShakeAngles?.pitch, y: maxShakeAngles?.yaw, z: maxShakeAngles?.roll },
    { x: 0.045, y: 0.045, z: 0.08 },
  );
  const shakeMaxPos = readVec3(maxShakeOffset, { x: 0.14, y: 0.14, z: 0.08 });

  function setMode(nextMode, overrides = null) {
    const preset = modePresets[nextMode];
    if (!preset) {
      throw new RangeError(`Unknown camera rig mode: "${nextMode}"`);
    }
    currentMode = nextMode;
    const merged = overrides ? { ...preset, ...overrides } : preset;
    arm.setConfig({
      minArmLength: merged.minArmLength,
      probeRadius: merged.probeRadius,
      minPitch: merged.minPitch,
      maxPitch: merged.maxPitch,
      lagHalfLife: merged.lagHalfLife,
      inHalfLife: merged.inHalfLife,
      outHalfLife: merged.outHalfLife,
    });
    arm.setArmLength(merged.armLength);
    if (merged.targetOffset) {
      arm.targetOffset.x = Number(merged.targetOffset.x) || 0;
      arm.targetOffset.y = Number(merged.targetOffset.y) || 0;
      arm.targetOffset.z = Number(merged.targetOffset.z) || 0;
    }
    if (merged.socketOffset) {
      arm.socketOffset.x = Number(merged.socketOffset.x) || 0;
      arm.socketOffset.y = Number(merged.socketOffset.y) || 0;
      arm.socketOffset.z = Number(merged.socketOffset.z) || 0;
    }
    arm.setAngles({
      yaw: overrides?.yaw ?? (nextMode === 'topDown' ? preset.yaw : arm.yaw),
      pitch: overrides?.pitch ?? (nextMode === 'topDown' ? preset.pitch : arm.pitch),
      roll: overrides?.roll ?? 0,
    });
    return rig;
  }

  function addTrauma(amount = 0.5) {
    if (!Number.isFinite(amount) || amount <= 0) return trauma;
    trauma = clamp(trauma + amount, 0, 1);
    return trauma;
  }

  function clearTrauma() {
    trauma = 0;
    return rig;
  }

  function addRecoil({ pitch = 0, yaw = 0, roll = 0, pushback = 0 } = {}) {
    recoilPitchSpring.value += Number(pitch) || 0;
    recoilYawSpring.value += Number(yaw) || 0;
    recoilRollSpring.value += Number(roll) || 0;
    recoilPushSpring.value += Number(pushback) || 0;
    return rig;
  }

  function setBaseFov(fov) {
    if (!Number.isFinite(fov) || fov <= 1 || fov >= 179) {
      throw new RangeError('baseFov must be between 1 and 179 degrees');
    }
    activeBaseFov = fov;
    return rig;
  }

  function setFovModifier(id, { fov = null, deltaFov = 0, priority = 0, blendIn = 0.1, blendOut = 0.16 } = {}) {
    if (typeof id !== 'string' || !id) {
      throw new TypeError('FOV modifier id must be a non-empty string');
    }
    fovModifiers.set(id, {
      id,
      fov: fov != null && Number.isFinite(fov) ? clamp(fov, 5, 175) : null,
      deltaFov: Number(deltaFov) || 0,
      priority: Number(priority) || 0,
      blendIn: Math.max(0, Number(blendIn) || 0),
      blendOut: Math.max(0, Number(blendOut) || 0),
      order: ++fovOrder,
    });
    return rig;
  }

  function clearFovModifier(id) {
    const existing = fovModifiers.get(id);
    if (!existing) return false;
    lastBlendOutHalfLife = existing.blendOut;
    fovModifiers.delete(id);
    return true;
  }

  function resolveTargetFov() {
    if (fovModifiers.size === 0) {
      return { target: activeBaseFov, halfLife: lastBlendOutHalfLife };
    }
    let winner = null;
    for (const mod of fovModifiers.values()) {
      if (
        !winner ||
        mod.priority > winner.priority ||
        (mod.priority === winner.priority && mod.order > winner.order)
      ) {
        winner = mod;
      }
    }
    const target = winner.fov !== null
      ? winner.fov
      : clamp(activeBaseFov + winner.deltaFov, 5, 175);
    return { target, halfLife: winner.blendIn };
  }

  function update(dt = 0, targetPosition = { x: 0, y: 0, z: 0 }) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;

    // 1. Recoil springs settle cleanly back toward zero
    recoilPitchSpring.step(delta, 0);
    recoilYawSpring.step(delta, 0);
    recoilRollSpring.step(delta, 0);
    recoilPushSpring.step(delta, 0);

    // 2. Quadratic trauma shake driven by continuous multi-frequency harmonics
    let shakePitch = 0;
    let shakeYaw = 0;
    let shakeRoll = 0;
    let shakeLocalX = 0;
    let shakeLocalY = 0;
    let shakeLocalZ = 0;
    let appliedShakeIntensity = 0;

    if (trauma > 0) {
      shakeClock += delta * shakeFrequency;
      appliedShakeIntensity = Math.pow(trauma, traumaExponent);
      const intensity = appliedShakeIntensity;
      const s1 = Math.sin(shakeClock * 1.0 + 0.37) * 0.65 + Math.sin(shakeClock * 2.13 + 1.91) * 0.35;
      const s2 = Math.cos(shakeClock * 1.17 + 2.41) * 0.65 + Math.sin(shakeClock * 2.47 + 0.83) * 0.35;
      const s3 = Math.sin(shakeClock * 1.31 + 4.12) * 0.65 + Math.cos(shakeClock * 2.71 + 1.17) * 0.35;

      shakePitch = s1 * shakeMaxAngles.x * intensity;
      shakeYaw = s2 * shakeMaxAngles.y * intensity;
      shakeRoll = s3 * shakeMaxAngles.z * intensity;

      shakeLocalX = s2 * shakeMaxPos.x * intensity;
      shakeLocalY = s1 * shakeMaxPos.y * intensity;
      shakeLocalZ = s3 * shakeMaxPos.z * intensity;

      if (delta > 0) {
        trauma = Math.max(0, trauma - traumaDecay * delta);
      }
    }

    // 3. Solve base boom with recoil & trauma angles applied
    const effPitch = arm.pitch + recoilPitchSpring.value + shakePitch;
    const effYaw = arm.yaw + recoilYawSpring.value + shakeYaw;
    const effRoll = arm.roll + recoilRollSpring.value + shakeRoll;
    const effArmLength = Math.max(0, arm.armLength + recoilPushSpring.value);

    const boom = arm.update(delta, targetPosition, {
      pitch: effPitch,
      yaw: effYaw,
      roll: effRoll,
      armLength: effArmLength,
    });

    if (shakeLocalX !== 0 || shakeLocalY !== 0 || shakeLocalZ !== 0) {
      shakeQuat.x = boom.quaternion.x;
      shakeQuat.y = boom.quaternion.y;
      shakeQuat.z = boom.quaternion.z;
      shakeQuat.w = boom.quaternion.w;
      rotateVecByQuat(shakeLocalX, shakeLocalY, shakeLocalZ, shakeQuat, shakeWorldOffset);
      boom.position.x += shakeWorldOffset.x;
      boom.position.y += shakeWorldOffset.y;
      boom.position.z += shakeWorldOffset.z;
    }

    // 4. Smoothly converge FOV toward highest-priority active modifier or baseFov
    const fovSpec = resolveTargetFov();
    const prevFov = currentFov;
    currentFov = delta > 0 ? damp(currentFov, fovSpec.target, fovSpec.halfLife, delta) : fovSpec.target;

    // 5. Apply to camera if attached
    if (camera) {
      if (camera.position) {
        if (typeof camera.position.set === 'function') {
          camera.position.set(boom.position.x, boom.position.y, boom.position.z);
        } else {
          camera.position.x = boom.position.x;
          camera.position.y = boom.position.y;
          camera.position.z = boom.position.z;
        }
      }
      if (camera.quaternion) {
        if (typeof camera.quaternion.set === 'function') {
          camera.quaternion.set(boom.quaternion.x, boom.quaternion.y, boom.quaternion.z, boom.quaternion.w);
        } else {
          camera.quaternion.x = boom.quaternion.x;
          camera.quaternion.y = boom.quaternion.y;
          camera.quaternion.z = boom.quaternion.z;
          camera.quaternion.w = boom.quaternion.w;
        }
      }
      if (typeof camera.fov === 'number' && Math.abs(camera.fov - currentFov) > 1e-4) {
        camera.fov = currentFov;
        camera.updateProjectionMatrix?.();
      } else if (typeof camera.fov === 'number' && Math.abs(prevFov - currentFov) > 1e-4) {
        camera.fov = currentFov;
        camera.updateProjectionMatrix?.();
      }
    }

    return {
      ...boom,
      mode: currentMode,
      fov: currentFov,
      trauma,
      shakeIntensity: appliedShakeIntensity,
    };
  }

  function addLookDelta(deltaYaw = 0, deltaPitch = 0, { pitchMultiplier = 1, yawMultiplier = 1 } = {}) {
    arm.addAngles((Number(deltaYaw) || 0) * yawMultiplier, (Number(deltaPitch) || 0) * pitchMultiplier, 0);
    return rig;
  }

  function setAngles(angles) {
    arm.setAngles(angles);
    return rig;
  }

  function snap(targetPosition) {
    arm.snap(targetPosition);
    recoilPitchSpring.snap(0, 0);
    recoilYawSpring.snap(0, 0);
    recoilRollSpring.snap(0, 0);
    recoilPushSpring.snap(0, 0);
    trauma = 0;
    currentFov = resolveTargetFov().target;
    if (camera && typeof camera.fov === 'number') {
      camera.fov = currentFov;
      camera.updateProjectionMatrix?.();
    }
    return rig;
  }

  const rig = {
    arm,
    get mode() { return currentMode; },
    get fov() { return currentFov; },
    get baseFov() { return activeBaseFov; },
    get trauma() { return trauma; },
    get yaw() { return arm.yaw; },
    get pitch() { return arm.pitch; },
    setMode,
    setAngles,
    addLookDelta,
    addTrauma,
    clearTrauma,
    addRecoil,
    setBaseFov,
    setFovModifier,
    clearFovModifier,
    snap,
    update,
  };

  return rig;
}

export { damp, dampAngle };

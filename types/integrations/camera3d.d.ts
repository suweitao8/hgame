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
export function createSpringArm3D({ THREE, armLength, minArmLength, probeRadius, targetOffset, socketOffset, yaw, pitch, roll, minPitch, maxPitch, lagHalfLife, lagMode, maxLagDistance, collisionTest, inHalfLife, outHalfLife, }?: SpringArm3DOptions): SpringArm3D;
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
export function createCameraRig3D({ THREE, camera, mode, baseFov, fovHalfLife, traumaDecay, traumaExponent, shakeFrequency, maxShakeAngles, maxShakeOffset, recoilHalfLife, thirdPerson, firstPerson, topDown, collisionTest, }?: CameraRig3DOptions): CameraRig3D;
/**
 * Plain or Three.js-like vector.
 */
export type CameraVec3 = {
    x: number;
    y: number;
    z: number;
};
/**
 * Plain or Three.js-like unit quaternion.
 */
export type CameraQuat = {
    x: number;
    y: number;
    z: number;
    w: number;
};
/**
 * Used Three.js constructors (optional; plain objects otherwise).
 */
export type CameraThreeLike = {
    Vector3: new () => CameraVec3;
    Quaternion: new () => CameraQuat;
};
/**
 * Camera-like object written by `applyToCamera` / rig update.
 */
export type CameraTargetLike = {
    position?: {
        x: number;
        y: number;
        z: number;
        set?: (x: number, y: number, z: number) => unknown;
    };
    quaternion?: {
        x: number;
        y: number;
        z: number;
        w: number;
        set?: (x: number, y: number, z: number, w: number) => unknown;
    };
    /**
     * Vertical FOV in degrees.
     */
    fov?: number;
    updateProjectionMatrix?: () => void;
};
/**
 * Collision result: distance from the pivot (number), an object with `distance`/`toi`/`fraction`, or no hit (`null`/`false`).
 */
export type SpringArmHit = number | boolean | null | undefined | {
    hit?: boolean;
    distance?: number;
    toi?: number;
    fraction?: number;
};
/**
 * Sweep/raycast callback from pivot towards the desired camera position (world units).
 */
export type SpringArmCollisionTest = (pivot: CameraVec3, desired: CameraVec3, direction: CameraVec3, maxDistance: number, probeRadius: number) => SpringArmHit;
export type SpringArmAngles = {
    /**
     * Radians.
     */
    yaw?: number;
    /**
     * Radians, clamped to min/max pitch.
     */
    pitch?: number;
    /**
     * Radians.
     */
    roll?: number;
};
/**
 * Per-update transient overrides.
 */
export type SpringArmOverrides = {
    yaw?: number;
    pitch?: number;
    roll?: number;
    armLength?: number;
};
/**
 * Runtime-adjustable arm settings.
 */
export type SpringArmConfig = {
    /**
     * Minimum collided length. World units.
     */
    minArmLength?: number;
    /**
     * World units.
     */
    probeRadius?: number;
    /**
     * Radians.
     */
    minPitch?: number;
    /**
     * Radians.
     */
    maxPitch?: number;
    /**
     * Seconds.
     */
    lagHalfLife?: number;
    /**
     * Seconds (collision shorten).
     */
    inHalfLife?: number;
    /**
     * Seconds (collision recover).
     */
    outHalfLife?: number;
};
export type SpringArm3DOptions = {
    /**
     * Optional Three.js subset; results use Vector3/Quaternion. Default `null` (plain objects).
     */
    THREE?: CameraThreeLike | null;
    /**
     * Nominal boom length, world units. Default `4.5`.
     */
    armLength?: number;
    /**
     * Minimum length when colliding. Default `0.4`.
     */
    minArmLength?: number;
    /**
     * Collision probe radius. Default `0.22`.
     */
    probeRadius?: number;
    /**
     * Pivot offset from target. Default `{x:0,y:1.5,z:0}`.
     */
    targetOffset?: CameraVec3;
    /**
     * Camera offset in boom-local space. Default zero.
     */
    socketOffset?: CameraVec3;
    /**
     * Radians. Default `0`.
     */
    yaw?: number;
    /**
     * Radians. Default `-0.25`.
     */
    pitch?: number;
    /**
     * Radians. Default `0`.
     */
    roll?: number;
    /**
     * Radians. Default `-0.495π`.
     */
    minPitch?: number;
    /**
     * Radians. Default `0.495π`.
     */
    maxPitch?: number;
    /**
     * Target-follow half-life, seconds. Default `0.08`.
     */
    lagHalfLife?: number;
    /**
     * Lag model. Default `'spring'`.
     */
    lagMode?: "spring" | "exp";
    /**
     * Max pivot lag distance, world units. Default `Infinity`.
     */
    maxLagDistance?: number;
    /**
     * Default `null`.
     */
    collisionTest?: SpringArmCollisionTest | null;
    /**
     * Shorten half-life, seconds. Default `0.015`.
     */
    inHalfLife?: number;
    /**
     * Recover half-life, seconds. Default `0.18`.
     */
    outHalfLife?: number;
};
/**
 * Live (reused, non-copied) solve result.
 */
export type SpringArmResult = {
    pivot: CameraVec3;
    /**
     * Final camera position.
     */
    position: CameraVec3;
    forward: CameraVec3;
    right: CameraVec3;
    up: CameraVec3;
    quaternion: CameraQuat;
    currentLength: number;
    desiredLength: number;
    collided: boolean;
};
export type SpringArm3D = {
    /**
     * Radians (read-only).
     */
    yaw: number;
    /**
     * Radians (read-only).
     */
    pitch: number;
    /**
     * Radians (read-only).
     */
    roll: number;
    /**
     * Nominal length (read-only).
     */
    armLength: number;
    /**
     * Collision-adjusted length (read-only).
     */
    currentLength: number;
    /**
     * Last update collided (read-only).
     */
    collided: boolean;
    /**
     * Mutable pivot offset.
     */
    targetOffset: CameraVec3;
    /**
     * Mutable socket offset.
     */
    socketOffset: CameraVec3;
    setAngles: (angles?: SpringArmAngles) => SpringArm3D;
    addAngles: (deltaYaw?: number, deltaPitch?: number, deltaRoll?: number) => SpringArm3D;
    setArmLength: (length: number) => SpringArm3D;
    setConfig: (config?: SpringArmConfig) => SpringArm3D;
    setCollisionTest: (fn: SpringArmCollisionTest | null) => SpringArm3D;
    /**
     * Teleport pivot to target, no lag.
     */
    snap: (targetPosition?: CameraVec3) => SpringArm3D;
    update: (dt?: number, targetPosition?: CameraVec3, overrides?: SpringArmOverrides | null) => SpringArmResult;
    applyToCamera: (camera: CameraTargetLike | null, dt?: number, targetPosition?: CameraVec3, overrides?: SpringArmOverrides | null) => SpringArmResult;
};
export type CameraRigMode = "thirdPerson" | "firstPerson" | "topDown";
/**
 * Spring-arm overrides for a mode.
 */
export type CameraRigPreset = Omit<SpringArm3DOptions, "THREE" | "collisionTest">;
/**
 * Maximum shake angles in radians.
 */
export type CameraShakeAngles = {
    /**
     * Default `0.045`.
     */
    pitch?: number;
    /**
     * Default `0.045`.
     */
    yaw?: number;
    /**
     * Default `0.08`.
     */
    roll?: number;
};
export type CameraRig3DOptions = {
    /**
     * Optional Three.js subset. Default `null`.
     */
    THREE?: CameraThreeLike | null;
    /**
     * Camera updated by `update`. Default `null`.
     */
    camera?: CameraTargetLike | null;
    /**
     * Initial mode. Default `'thirdPerson'`.
     */
    mode?: CameraRigMode;
    /**
     * Degrees. Default `70`.
     */
    baseFov?: number;
    /**
     * FOV blend half-life, seconds. Default `0.1`.
     */
    fovHalfLife?: number;
    /**
     * Trauma decay per second. Default `1.6`.
     */
    traumaDecay?: number;
    /**
     * Shake intensity = trauma^exponent. Default `2`.
     */
    traumaExponent?: number;
    /**
     * Shake rate, rad/s clock multiplier. Default `26`.
     */
    shakeFrequency?: number;
    /**
     * Radians. Default `{pitch:0.045,yaw:0.045,roll:0.08}`.
     */
    maxShakeAngles?: CameraShakeAngles;
    /**
     * Max shake translation, world units. Default `{x:0.14,y:0.14,z:0.08}`.
     */
    maxShakeOffset?: CameraVec3;
    /**
     * Recoil recovery half-life, seconds. Default `0.08`.
     */
    recoilHalfLife?: number;
    /**
     * Preset overrides. Default `{}`.
     */
    thirdPerson?: CameraRigPreset;
    /**
     * Preset overrides. Default `{}`.
     */
    firstPerson?: CameraRigPreset;
    /**
     * Preset overrides. Default `{}`.
     */
    topDown?: CameraRigPreset;
    /**
     * Default `null`.
     */
    collisionTest?: SpringArmCollisionTest | null;
};
export type CameraRecoil = {
    /**
     * Radians kick. Default `0`.
     */
    pitch?: number;
    /**
     * Radians kick. Default `0`.
     */
    yaw?: number;
    /**
     * Radians kick. Default `0`.
     */
    roll?: number;
    /**
     * Boom pushback, world units. Default `0`.
     */
    pushback?: number;
};
export type CameraFovModifier = {
    /**
     * Absolute target FOV (5..175 deg). Default `null`.
     */
    fov?: number | null;
    /**
     * Offset from base FOV in degrees when `fov` is null. Default `0`.
     */
    deltaFov?: number;
    /**
     * Higher wins; ties go to latest. Default `0`.
     */
    priority?: number;
    /**
     * Half-life when active, seconds. Default `0.1`.
     */
    blendIn?: number;
    /**
     * Half-life after clear, seconds. Default `0.16`.
     */
    blendOut?: number;
};
export type CameraLookMultipliers = {
    /**
     * Default `1`.
     */
    pitchMultiplier?: number;
    /**
     * Default `1`.
     */
    yawMultiplier?: number;
};
export type CameraRigResult = SpringArmResult & {
    mode: CameraRigMode;
    fov: number;
    trauma: number;
    shakeIntensity: number;
};
export type CameraRig3D = {
    /**
     * Underlying spring arm.
     */
    arm: SpringArm3D;
    /**
     * Current mode (read-only).
     */
    mode: CameraRigMode;
    /**
     * Current FOV, degrees (read-only).
     */
    fov: number;
    /**
     * Base FOV, degrees (read-only).
     */
    baseFov: number;
    /**
     * Current trauma 0..1 (read-only).
     */
    trauma: number;
    /**
     * Radians (read-only).
     */
    yaw: number;
    /**
     * Radians (read-only).
     */
    pitch: number;
    /**
     * Throws RangeError for unknown modes.
     */
    setMode: (mode: CameraRigMode, overrides?: CameraRigPreset | null) => CameraRig3D;
    setAngles: (angles?: SpringArmAngles) => CameraRig3D;
    /**
     * Radians.
     */
    addLookDelta: (deltaYaw?: number, deltaPitch?: number, multipliers?: CameraLookMultipliers) => CameraRig3D;
    /**
     * Adds 0..1 trauma (default 0.5); returns new trauma.
     */
    addTrauma: (amount?: number) => number;
    clearTrauma: () => CameraRig3D;
    addRecoil: (recoil?: CameraRecoil) => CameraRig3D;
    /**
     * Degrees, (1, 179).
     */
    setBaseFov: (fov: number) => CameraRig3D;
    setFovModifier: (id: string, modifier?: CameraFovModifier) => CameraRig3D;
    /**
     * True if it existed.
     */
    clearFovModifier: (id: string) => boolean;
    snap: (targetPosition?: CameraVec3) => CameraRig3D;
    /**
     * Advance; `dt` seconds.
     */
    update: (dt?: number, targetPosition?: CameraVec3) => CameraRigResult;
};
import { damp } from '../time/tween.js';
import { dampAngle } from '../time/tween.js';
export { damp, dampAngle };

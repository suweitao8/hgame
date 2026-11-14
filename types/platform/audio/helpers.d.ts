/** @param {number} value @param {number} min @param {number} max @returns {number} */
export function clamp(value: number, min: number, max: number): number;
/** @param {readonly number[]} values @returns {number} Median (0 for empty). */
export function median(values: readonly number[]): number;
/**
 * Normalize a vector, or return the fallback when its length is ~0.
 * @param {number} x @param {number} y @param {number} z
 * @param {number} fx Fallback x. @param {number} fy Fallback y. @param {number} fz Fallback z.
 * @returns {Vec3Tuple}
 */
export function normalizeVec3(x: number, y: number, z: number, fx: number, fy: number, fz: number): Vec3Tuple;
/** @param {AudioPosition3D | null | undefined} pos @returns {{ x: number, y: number, z: number } | null} */
export function parsePosition3D(pos: AudioPosition3D | null | undefined): {
    x: number;
    y: number;
    z: number;
} | null;
/** @param {AudioPosition2D | null | undefined} pos @returns {{ x: number, y: number } | null} */
export function parsePosition2D(pos: AudioPosition2D | null | undefined): {
    x: number;
    y: number;
} | null;
/** @param {PannerNode | AudioListener | null | undefined} node @param {number} x @param {number} y @param {number} z @returns {void} */
export function applyAudioParamOrMethod(node: PannerNode | AudioListener | null | undefined, x: number, y: number, z: number): void;
/** @param {AudioListener | null | undefined} listener @param {AudioListenerState} state @returns {void} */
export function applyListenerOrientation(listener: AudioListener | null | undefined, state: AudioListenerState): void;
/**
 * Smoothly move an AudioParam (or plain `{ value }`) toward a target.
 * @param {AudioParam | { value: number } | null | undefined} gainParam
 * @param {number} value Target value.
 * @param {number} currentTime AudioContext time, seconds.
 * @param {number} [timeConstant=0.01] Seconds.
 * @returns {void}
 */
export function setGainTarget(gainParam: AudioParam | {
    value: number;
} | null | undefined, value: number, currentTime: number, timeConstant?: number): void;
/**
 * @typedef {object} AudioListenerState Listener pose in world units.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} forwardX Unit forward vector (default 0, 0, -1).
 * @property {number} forwardY
 * @property {number} forwardZ
 * @property {number} upX Unit up vector (default 0, 1, 0).
 * @property {number} upY
 * @property {number} upZ
 */
/** @typedef {{ x: number, y: number, z?: number } | readonly number[]} AudioPosition3D World-space point as `{x,y,z}` or `[x,y,z]`. */
/** @typedef {{ x: number, y: number } | readonly number[]} AudioPosition2D 2D point as `{x,y}` or `[x,y]` (pixels / world units). */
/** @typedef {[number, number, number]} Vec3Tuple */
/** Default bus gains (0..1.5). @type {Readonly<Record<string, number>>} */
export const DEFAULT_BUS_VOLUMES: Readonly<Record<string, number>>;
/**
 * Listener pose in world units.
 */
export type AudioListenerState = {
    x: number;
    y: number;
    z: number;
    /**
     * Unit forward vector (default 0, 0, -1).
     */
    forwardX: number;
    forwardY: number;
    forwardZ: number;
    /**
     * Unit up vector (default 0, 1, 0).
     */
    upX: number;
    upY: number;
    upZ: number;
};
/**
 * World-space point as `{x,y,z}` or `[x,y,z]`.
 */
export type AudioPosition3D = {
    x: number;
    y: number;
    z?: number;
} | readonly number[];
/**
 * 2D point as `{x,y}` or `[x,y]` (pixels / world units).
 */
export type AudioPosition2D = {
    x: number;
    y: number;
} | readonly number[];
export type Vec3Tuple = [number, number, number];

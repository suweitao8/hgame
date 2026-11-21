/**
 * Automatically map bones between a source skeleton and a target skeleton using normalized names
 * and humanoid/Blender/Mixamo aliases. Returns `{ [targetBoneName]: sourceBoneName }`.
 *
 * @param {any} sourceSkeleton
 * @param {any} targetSkeleton
 * @param {{ aliases?: Record<string, string | string[]> }} [options]
 * @returns {Record<string, string>}
 */
export function createBoneMap3D(sourceSkeleton: any, targetSkeleton: any, { aliases }?: {
    aliases?: Record<string, string | string[]>;
} | undefined): Record<string, string>;
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
export function retargetClip3D(THREE: any, clip: any, { source, target, boneMap, hipBone, scalePosition, fps, }?: {
    source: any;
    target: any;
    boneMap?: Record<string, string> | Map<string, string>;
    hipBone?: string;
    scalePosition?: "auto" | number;
    fps?: number;
}): any;

/**
 * Create a bone/track mask restricting an animator layer or clip to a subset of the skeleton.
 * @param {object} [spec]
 * @param {Iterable<string>} [spec.bones] Explicit included bone names.
 * @param {object | null} [spec.includeBranch=null] Root Bone/Object3D whose entire descendant subtree is included.
 * @param {Iterable<string>} [spec.exclude] Bone names explicitly excluded.
 * @param {Record<string, number> | Map<string, number> | null} [spec.weights=null] Optional per-bone weight in [0..1].
 */
export function createAvatarMask(spec?: {
    bones?: Iterable<string> | undefined;
    includeBranch?: object | null;
    exclude?: Iterable<string> | undefined;
    weights?: Record<string, number> | Map<string, number> | null | undefined;
} | undefined): Readonly<{
    allows: (boneName: any) => boolean;
    getWeight: (boneName: any) => any;
    filterClip: (clip: any) => any;
    readonly size: number;
}>;
/**
 * Convenience helper splitting a 3D character rig into complementary upper-body and lower-body
 * `AvatarMask` layers (so upper-body attack/aim clips and lower-body locomotion clips blend
 * with zero overlapping tracks).
 *
 * @param {any} rootOrSkeleton Character root Object3D, SkinnedMesh, or Skeleton.
 * @param {object} [options]
 * @param {string | object | null} [options.spineBone=null] Explicit split bone object or bone name; auto-detects Spine/Chest when omitted.
 * @param {readonly string[]} [options.spineNames] Custom ordered candidate names for spine auto-detection.
 * @param {boolean} [options.includeSpineInUpper=true] Include the split spine bone itself in the upper-body mask.
 * @returns {{ upperMask: ReturnType<typeof createAvatarMask>, lowerMask: ReturnType<typeof createAvatarMask>, spineBone: any, spineName: string | null, upperBones: readonly string[] }}
 */
export function createUpperLowerMasks(rootOrSkeleton: any, { spineBone, spineNames, includeSpineInUpper, }?: {
    spineBone?: string | object | null;
    spineNames?: readonly string[] | undefined;
    includeSpineInUpper?: boolean | undefined;
} | undefined): {
    upperMask: ReturnType<typeof createAvatarMask>;
    lowerMask: ReturnType<typeof createAvatarMask>;
    spineBone: any;
    spineName: string | null;
    upperBones: readonly string[];
};
/**
 * 1D parameter-driven animation blend tree (piecewise linear interpolation across sorted thresholds).
 * @param {Array<{ clip: string, threshold: number, speed?: number }>} entries
 */
export function createBlendTree1D(entries?: Array<{
    clip: string;
    threshold: number;
    speed?: number;
}>): Readonly<{
    type: "1d";
    entries: {
        clip: string;
        threshold: number;
        speed: number | undefined;
    }[];
    evaluate: (value?: number) => {
        clip: string;
        weight: number;
        speed: number | undefined;
    }[];
}>;
/**
 * 2D Cartesian/directional animation blend tree using inverse-distance falloff weights.
 * @param {Array<{ clip: string, x: number, y: number, speed?: number }>} entries
 */
export function createBlendTree2D(entries?: Array<{
    clip: string;
    x: number;
    y: number;
    speed?: number;
}>): Readonly<{
    type: "2d";
    entries: {
        clip: string;
        x: number;
        y: number;
        speed: number | undefined;
    }[];
    evaluate: (px?: number, py?: number) => {
        clip: string;
        weight: number;
        speed: number | undefined;
    }[];
}>;
export function solveTwoBoneIK(rootBone: any, midBone: any, endBone: any, targetPos: any, polePos?: null, { weight }?: {
    weight?: number | undefined;
}): boolean;
/**
 * Aim a bone's forward axis smoothly at a world-space target, clamped within `maxAngle` radians.
 */
export function solveLookAtIK(bone: any, targetPos: any, { maxAngle, weight, forwardAxis }?: {
    maxAngle?: number | undefined;
    weight?: number | undefined;
    forwardAxis?: number[] | undefined;
}): boolean;
/**
 * Multi-layer 3D skeletal Animator with finite state machine, 1D/2D blend trees,
 * AvatarMask layer filtering, keyframe AnimationEvents, and post-pose IK hooks.
 */
export function createAnimator3D({ mixer, clips, states, transitions, initialState, parameters, layers, events, onEvent, THREE, }?: {
    mixer?: null | undefined;
    clips?: never[] | undefined;
    states?: {} | undefined;
    transitions?: never[] | undefined;
    initialState?: null | undefined;
    parameters?: {} | undefined;
    layers?: null | undefined;
    events?: {} | undefined;
    onEvent?: null | undefined;
    THREE?: null | undefined;
}): {
    THREE: null;
    setParam(name: any, value: any): void;
    getParam(name: any): any;
    trigger(name: any): void;
    setLayerWeight(layerName: any, weight: any): boolean;
    crossFade(stateName: any, duration?: number, layerName?: string): boolean;
    addIK(solverFn: any): void;
    removeIK(solverFn: any): boolean;
    getState(layerName?: string): string | null;
    getWeights(layerName?: string): any;
    update: (dt?: number) => void;
    dispose(): void;
};
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
export function solveFabrikIK(bones: object[], targetPos: {
    x: number;
    y: number;
    z: number;
} | [number, number, number], { iterations, tolerance, poleTarget, weight, }?: {
    iterations?: number | undefined;
    tolerance?: number | undefined;
    poleTarget?: [number, number, number] | {
        x: number;
        y: number;
        z: number;
    } | null | undefined;
    weight?: number | undefined;
} | undefined): boolean;
/**
 * Extract incremental root motion displacement `(dx, dy, dz, dyaw)` from a root bone
 * relative to `prevState` and update `prevState` in-place.
 */
export function extractRootMotion(rootBone: any, prevState?: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    initialized: boolean;
}): {
    dx: number;
    dy: number;
    dz: number;
    dyaw: number;
};
/**
 * Smoothly blend BlendShape / MorphTarget influences on a Three.js Mesh or skinned model root.
 * @param {object} root
 * @param {Record<string | number, number>} targetWeights Named or indexed morph target weights in [0, 1].
 * @param {number} [alpha=1] Smoothing/lerp factor toward `targetWeights`.
 */
export function blendMorphTargets(root: object, targetWeights: Record<string | number, number>, alpha?: number | undefined): number;
/**
 * Presentation-layer Verlet SpringBone chain for Blender Auto-Rig secondary motion
 * (hair, capes, ribbons, tails). Purely visual — zero Rapier physics overhead and
 * never perturbs deterministic lockstep simulation.
 *
 * @param {object} options
 * @param {object[]} options.bones Ordered bone chain `[root, child1, ...]`.
 * @param {number} [options.stiffness=24] Rest-pose spring stiffness (1/s^2).
 * @param {number} [options.drag=0.25] Velocity damping factor in `[0, 0.99]`.
 * @param {[number, number, number] | { x: number, y: number, z: number }} [options.gravity=[0, -9.8, 0]]
 * @param {[number, number, number] | { x: number, y: number, z: number }} [options.wind=[0, 0, 0]]
 * @param {Array<object>} [options.colliders=[]] Spherical colliders `{ center|position, radius }`.
 * @param {number} [options.boneLength=0.25] Fallback length for the leaf bone.
 * @param {number} [options.tipRadius=0.04] Bone collision sphere padding radius.
 */
export function createSpringBoneChain3D({ bones, stiffness, drag, gravity, wind, colliders, boneLength, tipRadius, }?: {
    bones: object[];
    stiffness?: number | undefined;
    drag?: number | undefined;
    gravity?: [number, number, number] | {
        x: number;
        y: number;
        z: number;
    } | undefined;
    wind?: [number, number, number] | {
        x: number;
        y: number;
        z: number;
    } | undefined;
    colliders?: any[] | undefined;
    boneLength?: number | undefined;
    tipRadius?: number | undefined;
}): Readonly<{
    readonly boneCount: number;
    setWind(vec: any): void;
    setColliders(list: any): void;
    getTipPositions(): {
        x: any;
        y: any;
        z: any;
    }[];
    update: (dt?: number) => number;
    reset: () => void;
}>;
/**
 * Lightweight exponential inertialization blender for smooth pose/clip transitions
 * without running two full skeletal evaluators concurrently.
 * @param {object} [options]
 * @param {number} [options.halfLife=0.12] Decay half-life in seconds.
 */
export function createInertialBlend3D({ halfLife }?: {
    halfLife?: number | undefined;
} | undefined): Readonly<{
    capture: (bones: any, prevPoses: any) => number;
    apply: (bones: any, dt?: number) => boolean;
    reset: () => void;
    readonly active: boolean;
    readonly weight: number;
}>;

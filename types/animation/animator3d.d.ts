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

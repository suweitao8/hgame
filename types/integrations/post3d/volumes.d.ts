/**
 * Signed distance from a position to a volume surface (negative inside).
 * @param {Pick<PostVolume, 'center' | 'shape' | 'radius' | 'yaw' | 'extents'>} vol
 * @param {PostVolumePosition} pos
 * @returns {number} World units.
 */
export function volumeSignedDistance(vol: Pick<PostVolume, "center" | "shape" | "radius" | "yaw" | "extents">, pos: PostVolumePosition): number;
/**
 * Spatial priority-sorted post-processing volume evaluator (unbound globals
 * plus smooth distance-feathered box/sphere zones).
 * @param {PostVolumeInput[]} [initialVolumes=[]]
 * @returns {PostProcessVolumeStack}
 */
export function createPostProcessVolumeStack(initialVolumes?: PostVolumeInput[] | undefined): PostProcessVolumeStack;
/**
 * Post-process parameter set (all optional when used as a volume override).
 * @typedef {object} PostSettings
 * @property {string} [toneMapping] Tone mapping mode (default `'ueFilmic'`).
 * @property {boolean} [fxaa] FXAA toggle (volumes switch at blend weight >= 0.5).
 * @property {number} [exposure] Exposure multiplier (default 1).
 * @property {number} [bloomStrength] Default 0.28.
 * @property {number} [bloomThreshold] Default 0.85.
 * @property {number} [bloomSoftKnee] Default 0.5.
 * @property {number} [ssaoRadius] World units, default 0.5.
 * @property {number} [ssaoBias] World units, default 0.025.
 * @property {number} [ssaoIntensity] Default 0.42.
 * @property {number} [volumetricIntensity] Default 0.18.
 * @property {number} [giIntensity] Default 0.55.
 * @property {number} [ssrIntensity] Default 0.35.
 * @property {number} [contactShadows] Default 0.65.
 * @property {number} [contactShadowLength] World units, default 0.32.
 * @property {number} [whiteTemp] Kelvin, default 6500.
 * @property {number} [whiteTint] -1..1, default 0.
 * @property {number} [contrast] Default 1.
 * @property {number} [saturation] Default 1.05.
 * @property {number} [vignette] Default 0.18.
 * @property {number} [chromaticAberration] Default 0.
 * @property {number} [filmGrain] Default 0.
 * @property {number} [filmSlope] Default 0.88.
 * @property {number} [filmToe] Default 0.55.
 * @property {number} [filmShoulder] Default 0.26.
 * @property {number} [filmBlackClip] Default 0.
 * @property {number} [filmWhiteClip] Default 0.04.
 * @property {import('./color.js').RGBTuple} [colorLift] Default [0,0,0].
 * @property {import('./color.js').RGBTuple} [colorGamma] Default [1,1,1].
 * @property {import('./color.js').RGBTuple} [colorGain] Default [1,1,1].
 * @property {number} [damage] Damage overlay 0..1.
 * @property {number} [lowHealth] Low-health overlay 0..1.
 * @property {number} [focus] Focus effect 0..1.
 * @property {number} [flash] Flash overlay 0..1.
 * @property {number} [fade] Fade-to-black 0..1.
 */
/**
 * Position accepted by volume queries.
 * @typedef {{x?: number, y?: number, z?: number} | ArrayLike<number>} PostVolumePosition
 */
/**
 * Volume definition accepted by add/update.
 * @typedef {object} PostVolumeInput
 * @property {string | number} id Unique id (required).
 * @property {number} [priority=0] Higher priority blends later (wins).
 * @property {boolean} [unbound=false] Global volume (applies everywhere).
 * @property {'box' | 'sphere'} [shape='box']
 * @property {PostVolumePosition} [center] World-space center, default [0,0,0].
 * @property {[number, number, number]} [extents] Box half-extents in world units, default [10,10,10].
 * @property {number} [radius=10] Sphere radius in world units.
 * @property {number} [yaw=0] Box rotation around Y in radians.
 * @property {number} [blendRadius=4] Feather distance outside the volume in world units.
 * @property {number} [blendWeight=1] Max influence 0..1.
 * @property {boolean} [enabled=true]
 * @property {PostSettings} [settings] Overridden post settings.
 */
/**
 * Normalized volume as stored in the stack.
 * @typedef {object} PostVolume
 * @property {string} id
 * @property {number} priority
 * @property {boolean} unbound
 * @property {'box' | 'sphere'} shape
 * @property {[number, number, number]} center
 * @property {[number, number, number]} extents
 * @property {number} radius
 * @property {number} yaw
 * @property {number} blendRadius
 * @property {number} blendWeight
 * @property {boolean} enabled
 * @property {PostSettings} settings
 */
/**
 * Evaluated post state (defaults merged with volume blends).
 * @typedef {PostSettings & {toneMapping: string}} PostEvaluatedState
 */
/**
 * Pipeline accepting an evaluated state.
 * @typedef {object} PostPipelineStateTarget
 * @property {(state: PostEvaluatedState) => unknown} setState
 */
/**
 * @typedef {object} PostProcessVolumeStack
 * @property {number} size Number of registered volumes (getter).
 * @property {(vol: PostVolumeInput) => string} addVolume Adds/replaces a volume; returns its id.
 * @property {(id: string | number, patch?: Partial<PostVolumeInput>) => boolean} updateVolume Merges a patch; false if unknown id.
 * @property {(id: string | number) => boolean} removeVolume True if removed.
 * @property {(id: string | number) => PostVolume | null} getVolume
 * @property {() => void} clear Removes all volumes.
 * @property {(position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState} evaluate Blends volumes at `position` over `baseState`.
 * @property {(pipeline: PostPipelineStateTarget | null | undefined, position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState | null} applyToPipeline Evaluates and calls `pipeline.setState`; null if no setState.
 */
/** Numeric post-setting keys blended by volumes. */
export const POST_SCALAR_KEYS: string[];
export const POST_VEC3_KEYS: string[];
export const DEFAULT_POST_VOLUME_BASE: Readonly<{
    toneMapping: "ueFilmic";
    exposure: 1;
    bloomStrength: 0.28;
    bloomThreshold: 0.85;
    bloomSoftKnee: 0.5;
    ssaoRadius: 0.5;
    ssaoBias: 0.025;
    ssaoIntensity: 0.42;
    volumetricIntensity: 0.18;
    giIntensity: 0.55;
    ssrIntensity: 0.35;
    contactShadows: 0.65;
    contactShadowLength: 0.32;
    whiteTemp: 6500;
    whiteTint: 0;
    contrast: 1;
    saturation: 1.05;
    vignette: 0.18;
    chromaticAberration: 0;
    filmGrain: 0;
    filmSlope: 0.88;
    filmToe: 0.55;
    filmShoulder: 0.26;
    filmBlackClip: 0;
    filmWhiteClip: 0.04;
    colorLift: number[];
    colorGamma: number[];
    colorGain: number[];
    damage: 0;
    lowHealth: 0;
    focus: 0;
    flash: 0;
    fade: 0;
}>;
/**
 * Post-process parameter set (all optional when used as a volume override).
 */
export type PostSettings = {
    /**
     * Tone mapping mode (default `'ueFilmic'`).
     */
    toneMapping?: string | undefined;
    /**
     * FXAA toggle (volumes switch at blend weight >= 0.5).
     */
    fxaa?: boolean | undefined;
    /**
     * Exposure multiplier (default 1).
     */
    exposure?: number | undefined;
    /**
     * Default 0.28.
     */
    bloomStrength?: number | undefined;
    /**
     * Default 0.85.
     */
    bloomThreshold?: number | undefined;
    /**
     * Default 0.5.
     */
    bloomSoftKnee?: number | undefined;
    /**
     * World units, default 0.5.
     */
    ssaoRadius?: number | undefined;
    /**
     * World units, default 0.025.
     */
    ssaoBias?: number | undefined;
    /**
     * Default 0.42.
     */
    ssaoIntensity?: number | undefined;
    /**
     * Default 0.18.
     */
    volumetricIntensity?: number | undefined;
    /**
     * Default 0.55.
     */
    giIntensity?: number | undefined;
    /**
     * Default 0.35.
     */
    ssrIntensity?: number | undefined;
    /**
     * Default 0.65.
     */
    contactShadows?: number | undefined;
    /**
     * World units, default 0.32.
     */
    contactShadowLength?: number | undefined;
    /**
     * Kelvin, default 6500.
     */
    whiteTemp?: number | undefined;
    /**
     * -1..1, default 0.
     */
    whiteTint?: number | undefined;
    /**
     * Default 1.
     */
    contrast?: number | undefined;
    /**
     * Default 1.05.
     */
    saturation?: number | undefined;
    /**
     * Default 0.18.
     */
    vignette?: number | undefined;
    /**
     * Default 0.
     */
    chromaticAberration?: number | undefined;
    /**
     * Default 0.
     */
    filmGrain?: number | undefined;
    /**
     * Default 0.88.
     */
    filmSlope?: number | undefined;
    /**
     * Default 0.55.
     */
    filmToe?: number | undefined;
    /**
     * Default 0.26.
     */
    filmShoulder?: number | undefined;
    /**
     * Default 0.
     */
    filmBlackClip?: number | undefined;
    /**
     * Default 0.04.
     */
    filmWhiteClip?: number | undefined;
    /**
     * Default [0,0,0].
     */
    colorLift?: import("./color.js").RGBTuple | undefined;
    /**
     * Default [1,1,1].
     */
    colorGamma?: import("./color.js").RGBTuple | undefined;
    /**
     * Default [1,1,1].
     */
    colorGain?: import("./color.js").RGBTuple | undefined;
    /**
     * Damage overlay 0..1.
     */
    damage?: number | undefined;
    /**
     * Low-health overlay 0..1.
     */
    lowHealth?: number | undefined;
    /**
     * Focus effect 0..1.
     */
    focus?: number | undefined;
    /**
     * Flash overlay 0..1.
     */
    flash?: number | undefined;
    /**
     * Fade-to-black 0..1.
     */
    fade?: number | undefined;
};
/**
 * Position accepted by volume queries.
 */
export type PostVolumePosition = {
    x?: number;
    y?: number;
    z?: number;
} | ArrayLike<number>;
/**
 * Volume definition accepted by add/update.
 */
export type PostVolumeInput = {
    /**
     * Unique id (required).
     */
    id: string | number;
    /**
     * Higher priority blends later (wins).
     */
    priority?: number | undefined;
    /**
     * Global volume (applies everywhere).
     */
    unbound?: boolean | undefined;
    shape?: "box" | "sphere" | undefined;
    /**
     * World-space center, default [0,0,0].
     */
    center?: PostVolumePosition | undefined;
    /**
     * Box half-extents in world units, default [10,10,10].
     */
    extents?: [number, number, number] | undefined;
    /**
     * Sphere radius in world units.
     */
    radius?: number | undefined;
    /**
     * Box rotation around Y in radians.
     */
    yaw?: number | undefined;
    /**
     * Feather distance outside the volume in world units.
     */
    blendRadius?: number | undefined;
    /**
     * Max influence 0..1.
     */
    blendWeight?: number | undefined;
    enabled?: boolean | undefined;
    /**
     * Overridden post settings.
     */
    settings?: PostSettings | undefined;
};
/**
 * Normalized volume as stored in the stack.
 */
export type PostVolume = {
    id: string;
    priority: number;
    unbound: boolean;
    shape: "box" | "sphere";
    center: [number, number, number];
    extents: [number, number, number];
    radius: number;
    yaw: number;
    blendRadius: number;
    blendWeight: number;
    enabled: boolean;
    settings: PostSettings;
};
/**
 * Evaluated post state (defaults merged with volume blends).
 */
export type PostEvaluatedState = PostSettings & {
    toneMapping: string;
};
/**
 * Pipeline accepting an evaluated state.
 */
export type PostPipelineStateTarget = {
    setState: (state: PostEvaluatedState) => unknown;
};
export type PostProcessVolumeStack = {
    /**
     * Number of registered volumes (getter).
     */
    size: number;
    /**
     * Adds/replaces a volume; returns its id.
     */
    addVolume: (vol: PostVolumeInput) => string;
    /**
     * Merges a patch; false if unknown id.
     */
    updateVolume: (id: string | number, patch?: Partial<PostVolumeInput>) => boolean;
    /**
     * True if removed.
     */
    removeVolume: (id: string | number) => boolean;
    getVolume: (id: string | number) => PostVolume | null;
    /**
     * Removes all volumes.
     */
    clear: () => void;
    /**
     * Blends volumes at `position` over `baseState`.
     */
    evaluate: (position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState;
    /**
     * Evaluates and calls `pipeline.setState`; null if no setState.
     */
    applyToPipeline: (pipeline: PostPipelineStateTarget | null | undefined, position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState | null;
};

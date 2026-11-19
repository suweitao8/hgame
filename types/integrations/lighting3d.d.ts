/**
 * Light candidate for CPU stochastic sampling.
 * @typedef {object} StochasticLightCandidate
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {number} [range] Influence radius, world units (min 0.1). Default `10`.
 * @property {number} [luminance] Radiant weight (min 0.01); falls back to `intensity`.
 * @property {number} [intensity] Fallback weight. Default `1`.
 */
/**
 * Result of {@link computeStochasticLightSample}.
 * @typedef {object} StochasticLightSample
 * @property {number} index Chosen candidate index.
 * @property {StochasticLightCandidate} candidate Chosen candidate.
 * @property {number} pdf Selection probability.
 * @property {number} weight Importance weight of the chosen light.
 * @property {number} totalWeight Sum of all weights.
 * @property {number} unbiasedScale `1 / pdf` (0 when pdf is 0).
 */
/**
 * Computes CPU-side normalized importance weights and draws one stochastic
 * sample index from candidates using `random01` in `[0, 1)`. Useful for
 * offline validation and Monte Carlo unbiasedness verification.
 * @param {readonly StochasticLightCandidate[]} candidates
 * @param {LightingVec3Input} [surfacePos] Surface position, world units.
 * @param {LightingVec3Input} [surfaceNormal] Surface normal (default up).
 * @param {number} [random01] Uniform random in [0, 1). Default `0.5`.
 * @returns {StochasticLightSample | null} `null` when no light contributes.
 */ export function computeStochasticLightSample(candidates: readonly StochasticLightCandidate[], surfacePos?: LightingVec3Input | undefined, surfaceNormal?: LightingVec3Input | undefined, random01?: number | undefined): StochasticLightSample | null;
/**
 * @typedef {object} MegaLights3DOptions
 * @property {number} [maxLights] Integer capacity 1..1024. Default `256`.
 * @property {number} [samplesPerPixel] Stochastic samples 0..8. Default `3`.
 * @property {number} [activeBudget] Max lights binned per frame (1..maxLights). Default `maxLights`.
 * @typedef {object} MegaLightDescriptor
 * @property {number | string} [id] Explicit id; auto-incremented integer when omitted.
 * @property {'point'|'spot'} [type] Default `'point'`.
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {LightColorInput} [color] Default `0xffffff`.
 * @property {number} [intensity] Radiant intensity (>= 0). Default `4`.
 * @property {number} [range] Influence radius, world units (min 0.25). Default `12`.
 * @property {number} [radius] Soft source radius, world units 0.02..4. Default `0.15`.
 * @property {LightingVec3Input} [direction] Spot direction (normalised). Default `[0,-1,0]`.
 * @property {number} [innerAngle] Spot inner cone half-angle, radians. Default `0.65 * outerAngle`.
 * @property {number} [outerAngle] Spot outer cone half-angle, radians (0.02..0.49π). Default `π/4`.
 * @property {boolean} [enabled] Default `true`.
 * @property {boolean} [transient] Fade out and auto-remove after `duration`. Default `false`.
 * @property {number} [duration] Transient lifetime, seconds. Default `0`.
 * @typedef {object} MegaLightPatch Mutable light fields for `updateLight`.
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {LightColorInput} [color]
 * @property {number} [intensity]
 * @property {number} [range]
 * @property {number} [radius]
 * @property {LightingVec3Input} [direction]
 * @property {boolean} [enabled]
 * @property {'point'|'spot'} [type]
 * @typedef {object} MegaLightFlashOptions
 * @property {number} [x] Default `0`.
 * @property {number} [y] Default `0`.
 * @property {number} [z] Default `0`.
 * @property {LightColorInput} [color] Default `0xffb36b`.
 * @property {number} [intensity] Default `6`.
 * @property {number} [range] World units. Default `10`.
 * @property {number} [radius] World units. Default `0.2`.
 * @property {number} [duration] Seconds. Default `0.14`.
 * @typedef {object} MegaLightsQualityPreset
 * @property {number} [megaLightsSamples] Integer samples per pixel 0..8.
 * @property {number} [maxClusteredLights] Integer active-light budget.
 * @typedef {object} MegaLightsViewport
 * @property {number} width Pixels.
 * @property {number} height Pixels.
 * @typedef {object} MegaLightsClusterInfo
 * @property {number} clusterIndex Flat cluster index.
 * @property {number} cx Tile X.
 * @property {number} cy Tile Y.
 * @property {number} cz Depth slice.
 * @property {number} count Lights in the cluster.
 * @property {number[]} indices Light slot indices in the cluster.
 * @typedef {object} MegaLightsUniforms Shared shader uniforms.
 * @property {{value: LightingTextureLike}} uMegaLightData
 * @property {{value: LightingTextureLike}} uMegaClusterTex
 * @property {{value: number}} uMegaDataHeight
 * @property {{value: LightingVec2Like}} uMegaResolution
 * @property {{value: LightingVec4Like}} uMegaZParams
 * @property {{value: number}} uMegaActiveCount
 * @property {{value: number}} uMegaSamplesPerPixel
 * @property {{value: number}} uMegaTime
 * @typedef {object} MegaLights3D
 * @property {number} count Registered light count (read-only).
 * @property {number} activeCount Lights binned last update (read-only).
 * @property {number} maxLights Capacity (read-only).
 * @property {number} samplesPerPixel Current sample budget (read-only).
 * @property {number} activeBudget Current active-light budget (read-only).
 * @property {number[]} clusterDims `[tilesX, tilesY, slicesZ]` (read-only).
 * @property {LightingTextureLike} lightDataTexture (read-only)
 * @property {LightingTextureLike} clusterTexture (read-only)
 * @property {{light: import('./lighting3d/texture-updates.js').FloatTextureUploadStats, cluster: import('./lighting3d/texture-updates.js').FloatTextureUploadStats}} uploadStats Pending texture payload in bytes, excluding backing allocation and driver overhead.
 * @property {MegaLightsUniforms} uniforms (read-only)
 * @property {(desc?: MegaLightDescriptor) => number | string} addLight Returns the light id.
 * @property {(id: number | string, patch?: MegaLightPatch) => boolean} updateLight False when unknown id.
 * @property {(id: number | string) => boolean} removeLight
 * @property {(options?: MegaLightFlashOptions) => number | string} flash Transient point light; returns id.
 * @property {() => void} clear
 * @property {(preset: MegaLightsQualityPreset) => void} setQualityPreset
 * @property {(width: number, height: number) => void} setViewportSize Pixels.
 * @property {(camera?: LightingCameraLike | null, dt?: number, viewport?: MegaLightsViewport | null) => number} update Bin lights; `dt` seconds; returns active count.
 * @property {(vx: number, vy: number, vz: number, ndcX?: number, ndcY?: number) => MegaLightsClusterInfo} evaluateClusterAtViewPos Debug cluster lookup (view-space position, NDC -1..1).
 * @property {<M extends LightingMaterialLike>(material: M) => M} applyToMaterial Patch a material shader (idempotent).
 * @property {() => boolean} dispose False when already disposed.
 */
/**
 * Creates a GPU DataTexture-backed Clustered + Stochastic Many-Light manager
 * ("MegaLights"-grade for WebGL2): supports hundreds of dynamic point/spot lights
 * with zero scene-graph Three.js PointLight bloat and zero shader recompilations.
 * @param {LightingThreeLike | null | undefined} THREE Injected Three.js namespace subset (or null for headless).
 * @param {MegaLights3DOptions} [options]
 * @returns {MegaLights3D}
 */ export function createMegaLights3D(THREE: LightingThreeLike | null | undefined, options?: MegaLights3DOptions | undefined): MegaLights3D;
/**
 * @typedef {object} IrradianceProbeVolume3DOptions
 * @property {readonly number[]} [min] Volume minimum corner `[x,y,z]`, world units. Default `[-32,0,-32]`.
 * @property {readonly number[]} [max] Volume maximum corner. Default `[32,16,32]`.
 * @property {readonly number[]} [resolution] Probe counts `[nx,ny,nz]` (each >= 2). Default `[8,4,8]`.
 * @property {number} [intensity] Global intensity multiplier (>= 0). Default `1`.
 * @typedef {object} HemisphereInjection
 * @property {LightColorInput} [skyColor] Default `0x8bb7f0`.
 * @property {LightColorInput} [groundColor] Default `0x3a332a`.
 * @property {number} [intensity] Default `1`.
 * @typedef {object} DirectionalBounceInjection
 * @property {LightingVec3Input} [direction] Light travel/sun direction. Default `[0.46,0.72,0.52]`.
 * @property {LightColorInput} [color] Default `0xfff1d6`.
 * @property {number} [intensity] Default `1`.
 * @property {number} [groundAlbedo] Ground reflectance 0..1. Default `0.35`.
 * @typedef {object} PointLightBounceInjection
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {LightColorInput} [color] Default `0xffffff`.
 * @property {number} [intensity] Default `1`.
 * @property {number} [range] World units (min 0.5). Default `12`.
 * @property {number} [bounceRatio] Default `0.35`.
 * @typedef {object} ProbeBakeSky Sky-like object (e.g. from sky3d).
 * @property {Record<string, {value?: LightColorInput | number}>} [uniforms]
 * @property {LightingVec3Input} [sunDirection]
 * @typedef {object} ProbeBakeOptions
 * @property {ProbeBakeSky | null} [sky] Default `null`.
 * @property {readonly PointLightBounceInjection[]} [lights] Point lights to inject. Default `[]`.
 * @property {number} [ambientIntensity] Default `0.55`.
 * @property {number} [bounceIntensity] Ground albedo of sun bounce. Default `0.4`.
 * @typedef {object} ProbeVolumeMaterialOptions
 * @property {number | null} [intensity] Optional new global intensity. Default `null`.
 * @typedef {object} IrradianceProbeVolume3D
 * @property {{min: number[], max: number[]}} bounds Volume corners (copy; read-only).
 * @property {number[]} resolution Probe counts `[nx,ny,nz]` (copy; read-only).
 * @property {number} probeCount Total probes (read-only).
 * @property {LightingTextureLike} texture SH data texture (read-only).
 * @property {number} intensity Global intensity (read-only).
 * @property {() => void} clear Zero all probes.
 * @property {(options?: HemisphereInjection) => void} injectHemisphere
 * @property {(options?: DirectionalBounceInjection) => void} injectDirectionalBounce
 * @property {(options?: PointLightBounceInjection) => void} injectPointLightBounce
 * @property {(options?: ProbeBakeOptions) => void} bakeFromScene Clears then re-bakes.
 * @property {(x: number, y: number, z: number, normalX?: number, normalY?: number, normalZ?: number, out?: number[]) => number[]} sampleIrradiance Trilinear linear-RGB irradiance at a world position (default normal up).
 * @property {(dx?: number, dy?: number, dz?: number) => void} shiftOrigin Floating-origin shift, world units.
 * @property {(value: number) => void} setIntensity Ignored unless finite and >= 0.
 * @property {<M extends LightingMaterialLike>(material: M, options?: ProbeVolumeMaterialOptions) => M} applyToMaterial
 * @property {() => boolean} dispose
 */
/**
 * Creates a world-space Spherical Harmonics (SH L1) Irradiance Probe Volume
 * storing multi-bounce diffuse indirect illumination on a 3D lattice with
 * CPU trilinear sampling, Floating-Origin shifting, and composable PBR injection.
 * @param {LightingThreeLike | null | undefined} THREE Injected Three.js namespace subset (or null for headless).
 * @param {IrradianceProbeVolume3DOptions} [options]
 * @returns {IrradianceProbeVolume3D}
 */ export function createIrradianceProbeVolume3D(THREE: LightingThreeLike | null | undefined, options?: IrradianceProbeVolume3DOptions | undefined): IrradianceProbeVolume3D;
/**
 * Light candidate for CPU stochastic sampling.
 */
export type StochasticLightCandidate = {
    /**
     * World X. Default `0`.
     */
    x?: number | undefined;
    /**
     * World Y. Default `0`.
     */
    y?: number | undefined;
    /**
     * World Z. Default `0`.
     */
    z?: number | undefined;
    /**
     * Influence radius, world units (min 0.1). Default `10`.
     */
    range?: number | undefined;
    /**
     * Radiant weight (min 0.01); falls back to `intensity`.
     */
    luminance?: number | undefined;
    /**
     * Fallback weight. Default `1`.
     */
    intensity?: number | undefined;
};
/**
 * Result of {@link computeStochasticLightSample}.
 */
export type StochasticLightSample = {
    /**
     * Chosen candidate index.
     */
    index: number;
    /**
     * Chosen candidate.
     */
    candidate: StochasticLightCandidate;
    /**
     * Selection probability.
     */
    pdf: number;
    /**
     * Importance weight of the chosen light.
     */
    weight: number;
    /**
     * Sum of all weights.
     */
    totalWeight: number;
    /**
     * `1 / pdf` (0 when pdf is 0).
     */
    unbiasedScale: number;
};
export type MegaLights3DOptions = {
    /**
     * Integer capacity 1..1024. Default `256`.
     */
    maxLights?: number | undefined;
    /**
     * Stochastic samples 0..8. Default `3`.
     */
    samplesPerPixel?: number | undefined;
    /**
     * Max lights binned per frame (1..maxLights). Default `maxLights`.
     */
    activeBudget?: number | undefined;
};
export type MegaLightDescriptor = {
    /**
     * Explicit id; auto-incremented integer when omitted.
     */
    id?: string | number | undefined;
    /**
     * Default `'point'`.
     */
    type?: "point" | "spot" | undefined;
    /**
     * World X. Default `0`.
     */
    x?: number | undefined;
    /**
     * World Y. Default `0`.
     */
    y?: number | undefined;
    /**
     * World Z. Default `0`.
     */
    z?: number | undefined;
    /**
     * Default `0xffffff`.
     */
    color?: LightColorInput | undefined;
    /**
     * Radiant intensity (>= 0). Default `4`.
     */
    intensity?: number | undefined;
    /**
     * Influence radius, world units (min 0.25). Default `12`.
     */
    range?: number | undefined;
    /**
     * Soft source radius, world units 0.02..4. Default `0.15`.
     */
    radius?: number | undefined;
    /**
     * Spot direction (normalised). Default `[0,-1,0]`.
     */
    direction?: LightingVec3Input | undefined;
    /**
     * Spot inner cone half-angle, radians. Default `0.65 * outerAngle`.
     */
    innerAngle?: number | undefined;
    /**
     * Spot outer cone half-angle, radians (0.02..0.49π). Default `π/4`.
     */
    outerAngle?: number | undefined;
    /**
     * Default `true`.
     */
    enabled?: boolean | undefined;
    /**
     * Fade out and auto-remove after `duration`. Default `false`.
     */
    transient?: boolean | undefined;
    /**
     * Transient lifetime, seconds. Default `0`.
     */
    duration?: number | undefined;
};
/**
 * Mutable light fields for `updateLight`.
 */
export type MegaLightPatch = {
    x?: number | undefined;
    y?: number | undefined;
    z?: number | undefined;
    color?: LightColorInput | undefined;
    intensity?: number | undefined;
    range?: number | undefined;
    radius?: number | undefined;
    direction?: LightingVec3Input | undefined;
    enabled?: boolean | undefined;
    type?: "point" | "spot" | undefined;
};
export type MegaLightFlashOptions = {
    /**
     * Default `0`.
     */
    x?: number | undefined;
    /**
     * Default `0`.
     */
    y?: number | undefined;
    /**
     * Default `0`.
     */
    z?: number | undefined;
    /**
     * Default `0xffb36b`.
     */
    color?: LightColorInput | undefined;
    /**
     * Default `6`.
     */
    intensity?: number | undefined;
    /**
     * World units. Default `10`.
     */
    range?: number | undefined;
    /**
     * World units. Default `0.2`.
     */
    radius?: number | undefined;
    /**
     * Seconds. Default `0.14`.
     */
    duration?: number | undefined;
};
export type MegaLightsQualityPreset = {
    /**
     * Integer samples per pixel 0..8.
     */
    megaLightsSamples?: number | undefined;
    /**
     * Integer active-light budget.
     */
    maxClusteredLights?: number | undefined;
};
export type MegaLightsViewport = {
    /**
     * Pixels.
     */
    width: number;
    /**
     * Pixels.
     */
    height: number;
};
export type MegaLightsClusterInfo = {
    /**
     * Flat cluster index.
     */
    clusterIndex: number;
    /**
     * Tile X.
     */
    cx: number;
    /**
     * Tile Y.
     */
    cy: number;
    /**
     * Depth slice.
     */
    cz: number;
    /**
     * Lights in the cluster.
     */
    count: number;
    /**
     * Light slot indices in the cluster.
     */
    indices: number[];
};
/**
 * Shared shader uniforms.
 */
export type MegaLightsUniforms = {
    uMegaLightData: {
        value: LightingTextureLike;
    };
    uMegaClusterTex: {
        value: LightingTextureLike;
    };
    uMegaDataHeight: {
        value: number;
    };
    uMegaResolution: {
        value: LightingVec2Like;
    };
    uMegaZParams: {
        value: LightingVec4Like;
    };
    uMegaActiveCount: {
        value: number;
    };
    uMegaSamplesPerPixel: {
        value: number;
    };
    uMegaTime: {
        value: number;
    };
};
export type MegaLights3D = {
    /**
     * Registered light count (read-only).
     */
    count: number;
    /**
     * Lights binned last update (read-only).
     */
    activeCount: number;
    /**
     * Capacity (read-only).
     */
    maxLights: number;
    /**
     * Current sample budget (read-only).
     */
    samplesPerPixel: number;
    /**
     * Current active-light budget (read-only).
     */
    activeBudget: number;
    /**
     * `[tilesX, tilesY, slicesZ]` (read-only).
     */
    clusterDims: number[];
    /**
     * (read-only)
     */
    lightDataTexture: LightingTextureLike;
    /**
     * (read-only)
     */
    clusterTexture: LightingTextureLike;
    /**
     * Pending texture payload in bytes, excluding backing allocation and driver overhead.
     */
    uploadStats: {
        light: import("./lighting3d/texture-updates.js").FloatTextureUploadStats;
        cluster: import("./lighting3d/texture-updates.js").FloatTextureUploadStats;
    };
    /**
     * (read-only)
     */
    uniforms: MegaLightsUniforms;
    /**
     * Returns the light id.
     */
    addLight: (desc?: MegaLightDescriptor) => number | string;
    /**
     * False when unknown id.
     */
    updateLight: (id: number | string, patch?: MegaLightPatch) => boolean;
    removeLight: (id: number | string) => boolean;
    /**
     * Transient point light; returns id.
     */
    flash: (options?: MegaLightFlashOptions) => number | string;
    clear: () => void;
    setQualityPreset: (preset: MegaLightsQualityPreset) => void;
    /**
     * Pixels.
     */
    setViewportSize: (width: number, height: number) => void;
    /**
     * Bin lights; `dt` seconds; returns active count.
     */
    update: (camera?: LightingCameraLike | null, dt?: number, viewport?: MegaLightsViewport | null) => number;
    /**
     * Debug cluster lookup (view-space position, NDC -1..1).
     */
    evaluateClusterAtViewPos: (vx: number, vy: number, vz: number, ndcX?: number, ndcY?: number) => MegaLightsClusterInfo;
    /**
     * Patch a material shader (idempotent).
     */
    applyToMaterial: <M extends LightingMaterialLike>(material: M) => M;
    /**
     * False when already disposed.
     */
    dispose: () => boolean;
};
export type IrradianceProbeVolume3DOptions = {
    /**
     * Volume minimum corner `[x,y,z]`, world units. Default `[-32,0,-32]`.
     */
    min?: readonly number[] | undefined;
    /**
     * Volume maximum corner. Default `[32,16,32]`.
     */
    max?: readonly number[] | undefined;
    /**
     * Probe counts `[nx,ny,nz]` (each >= 2). Default `[8,4,8]`.
     */
    resolution?: readonly number[] | undefined;
    /**
     * Global intensity multiplier (>= 0). Default `1`.
     */
    intensity?: number | undefined;
};
export type HemisphereInjection = {
    /**
     * Default `0x8bb7f0`.
     */
    skyColor?: LightColorInput | undefined;
    /**
     * Default `0x3a332a`.
     */
    groundColor?: LightColorInput | undefined;
    /**
     * Default `1`.
     */
    intensity?: number | undefined;
};
export type DirectionalBounceInjection = {
    /**
     * Light travel/sun direction. Default `[0.46,0.72,0.52]`.
     */
    direction?: LightingVec3Input | undefined;
    /**
     * Default `0xfff1d6`.
     */
    color?: LightColorInput | undefined;
    /**
     * Default `1`.
     */
    intensity?: number | undefined;
    /**
     * Ground reflectance 0..1. Default `0.35`.
     */
    groundAlbedo?: number | undefined;
};
export type PointLightBounceInjection = {
    /**
     * World X. Default `0`.
     */
    x?: number | undefined;
    /**
     * World Y. Default `0`.
     */
    y?: number | undefined;
    /**
     * World Z. Default `0`.
     */
    z?: number | undefined;
    /**
     * Default `0xffffff`.
     */
    color?: LightColorInput | undefined;
    /**
     * Default `1`.
     */
    intensity?: number | undefined;
    /**
     * World units (min 0.5). Default `12`.
     */
    range?: number | undefined;
    /**
     * Default `0.35`.
     */
    bounceRatio?: number | undefined;
};
/**
 * Sky-like object (e.g. from sky3d).
 */
export type ProbeBakeSky = {
    uniforms?: Record<string, {
        value?: LightColorInput | number;
    }> | undefined;
    sunDirection?: LightingVec3Input | undefined;
};
export type ProbeBakeOptions = {
    /**
     * Default `null`.
     */
    sky?: ProbeBakeSky | null | undefined;
    /**
     * Point lights to inject. Default `[]`.
     */
    lights?: readonly PointLightBounceInjection[] | undefined;
    /**
     * Default `0.55`.
     */
    ambientIntensity?: number | undefined;
    /**
     * Ground albedo of sun bounce. Default `0.4`.
     */
    bounceIntensity?: number | undefined;
};
export type ProbeVolumeMaterialOptions = {
    /**
     * Optional new global intensity. Default `null`.
     */
    intensity?: number | null | undefined;
};
export type IrradianceProbeVolume3D = {
    /**
     * Volume corners (copy; read-only).
     */
    bounds: {
        min: number[];
        max: number[];
    };
    /**
     * Probe counts `[nx,ny,nz]` (copy; read-only).
     */
    resolution: number[];
    /**
     * Total probes (read-only).
     */
    probeCount: number;
    /**
     * SH data texture (read-only).
     */
    texture: LightingTextureLike;
    /**
     * Global intensity (read-only).
     */
    intensity: number;
    /**
     * Zero all probes.
     */
    clear: () => void;
    injectHemisphere: (options?: HemisphereInjection) => void;
    injectDirectionalBounce: (options?: DirectionalBounceInjection) => void;
    injectPointLightBounce: (options?: PointLightBounceInjection) => void;
    /**
     * Clears then re-bakes.
     */
    bakeFromScene: (options?: ProbeBakeOptions) => void;
    /**
     * Trilinear linear-RGB irradiance at a world position (default normal up).
     */
    sampleIrradiance: (x: number, y: number, z: number, normalX?: number, normalY?: number, normalZ?: number, out?: number[]) => number[];
    /**
     * Floating-origin shift, world units.
     */
    shiftOrigin: (dx?: number, dy?: number, dz?: number) => void;
    /**
     * Ignored unless finite and >= 0.
     */
    setIntensity: (value: number) => void;
    applyToMaterial: <M extends LightingMaterialLike>(material: M, options?: ProbeVolumeMaterialOptions) => M;
    dispose: () => boolean;
};
/**
 * Linear RGB triple.
 */
export type LightingRGB = [number, number, number];
/**
 * Three.js-like Color.
 */
export type LightingColorLike = {
    isColor?: boolean | undefined;
    r?: number | undefined;
    g?: number | undefined;
    b?: number | undefined;
};
/**
 * Hex number (`0xrrggbb`), CSS string (Three.js only), `[r,g,b]` array, or Color.
 */
export type LightColorInput = number | string | readonly number[] | LightingColorLike;
/**
 * `[x,y,z]` or `{x,y,z}`.
 */
export type LightingVec3Input = readonly number[] | {
    x?: number;
    y?: number;
    z?: number;
};
export type LightingVec2Like = {
    x: number;
    y: number;
    set: (x: number, y: number) => unknown;
};
export type LightingVec3Like = {
    x: number;
    y: number;
    z: number;
    set?: ((x: number, y: number, z: number) => unknown) | undefined;
};
export type LightingVec4Like = {
    x: number;
    y: number;
    z: number;
    w: number;
    set: (x: number, y: number, z: number, w: number) => unknown;
};
/**
 * Three.js DataTexture subset (or headless stand-in).
 */
export type LightingTextureLike = {
    needsUpdate: boolean;
    dispose?: (() => void) | undefined;
    image?: {
        data: Float32Array;
        width: number;
        height: number;
    } | undefined;
};
/**
 * Subset of the Three.js namespace used by lighting3d (all optional; headless plain objects are used when absent).
 */
export type LightingThreeLike = {
    Color?: (new (value?: LightColorInput) => LightingColorLike & {
        getRGB?: (target: {
            r: number;
            g: number;
            b: number;
        }) => unknown;
        clone: () => LightingColorLike;
    }) | undefined;
    DataTexture?: (new (data: Float32Array, width: number, height: number, format?: number, type?: number) => LightingTextureLike & Record<string, unknown>) | undefined;
    Vector2?: (new (x?: number, y?: number) => LightingVec2Like) | undefined;
    Vector3?: (new (x?: number, y?: number, z?: number) => LightingVec3Like & {
        set: (x: number, y: number, z: number) => unknown;
    }) | undefined;
    Vector4?: (new (x?: number, y?: number, z?: number, w?: number) => LightingVec4Like) | undefined;
    RGBAFormat?: number | undefined;
    FloatType?: number | undefined;
    NearestFilter?: number | undefined;
    ClampToEdgeWrapping?: number | undefined;
    /**
     * New GPU backing always initializes the whole DataTexture before range updates.
     */
    HGAME_FULL_DATA_TEXTURE_INITIAL_UPLOAD?: boolean | undefined;
};
/**
 * Three.js `onBeforeCompile` shader parameter.
 */
export type LightingShaderLike = {
    fragmentShader: string;
    vertexShader?: string | undefined;
    uniforms: Record<string, {
        value: unknown;
    }>;
};
/**
 * Three.js material subset patched by `applyToMaterial`.
 */
export type LightingMaterialLike = {
    userData?: Record<string, unknown> | undefined;
    onBeforeCompile?: ((shader: LightingShaderLike, renderer?: object) => void) | undefined;
    customProgramCacheKey?: (() => string) | undefined;
    needsUpdate?: boolean | undefined;
};
/**
 * Three.js perspective camera subset read by `update`.
 */
export type LightingCameraLike = {
    near?: number | undefined;
    far?: number | undefined;
    aspect?: number | undefined;
    /**
     * Vertical FOV, degrees.
     */
    fov?: number | undefined;
    updateMatrixWorld?: ((force?: boolean) => void) | undefined;
    matrixWorldInverse?: {
        elements: ArrayLike<number>;
        copy: (m: object) => {
            invert?: () => unknown;
        };
    } | undefined;
    matrixWorld?: object;
};

/**
 * @param {QualityPresetTier} [tier='high']
 * @param {'2d'|'3d'} [dimension='3d']
 * @returns {Readonly<Quality3DPreset>|Readonly<Quality2DPreset>}
 */
export function resolveQualityPreset(tier?: QualityPresetTier | undefined, dimension?: "2d" | "3d" | undefined): Readonly<Quality3DPreset> | Readonly<Quality2DPreset>;
/**
 * Pure, conservative hint selection. Does not allocate a probing WebGL context.
 * @param {QualityDeviceHints} [hints]
 * @returns {QualityTier}
 */
export function chooseInitial3dQuality({ mobile, rendererName, memoryGB, }?: QualityDeviceHints | undefined): QualityTier;
/**
 * @param {AdaptiveQualityOptions} [options]
 * @returns {Readonly<AdaptiveQualityController>}
 */
export function createAdaptiveQualityController({ mode, device, minScale, maxScale, minPixelRatio, maxPixelRatio, settleMs, settleAfterChangeMs, sampleFrames, degradeFrameMs, recoverFrameMs, memoryBudgetBytes, onChange, }?: AdaptiveQualityOptions | undefined): Readonly<AdaptiveQualityController>;
/** @typedef {'low'|'medium'|'high'} QualityTier */
/** @typedef {QualityTier|'ultra'} QualityPresetTier Tier names accepted by preset tables. */
/** @typedef {'auto'|QualityTier} QualityMode */
/**
 * @typedef {object} Quality3DPreset
 * @property {number} maxPixels Hard physical-pixel budget.
 * @property {number} maxPixelRatio Max device pixel ratio.
 * @property {number} shadowMapSize Shadow map edge in texels.
 * @property {boolean} shadowsEnabled
 * @property {number} shadowDistance World units.
 * @property {number} msaaSamples
 * @property {boolean} ssao
 * @property {boolean} ssgi
 * @property {boolean} ssr
 * @property {boolean} contactShadows
 * @property {boolean} bloom
 * @property {number} volumetricSteps
 * @property {number} anisotropy
 * @property {boolean} fxaa
 * @property {number} sharpen
 * @property {number} drawDistance World units.
 * @property {boolean} occlusionCulling
 * @property {number} animationLodScale
 * @property {number} particleScale
 * @property {number} maxDynamicLights
 * @property {number} megaLightsSamples
 * @property {number} maxClusteredLights
 */
/**
 * @typedef {object} Quality2DPreset
 * @property {number} maxPixelRatio
 * @property {boolean} groundShadows
 * @property {boolean} imageSmoothing
 * @property {number} particleScale
 * @property {'fast'|'full'} hitFlashQuality
 */
/**
 * @typedef {object} QualityDeviceHints
 * @property {boolean} [mobile=false]
 * @property {string} [rendererName=''] GPU renderer string.
 * @property {number|null} [memoryGB=null] Device memory in GB.
 */
/**
 * @typedef {object} QualitySnapshot
 * @property {QualityMode} mode
 * @property {QualityTier} tier
 * @property {Quality3DPreset} preset
 * @property {number} dynamicScale Resolution scale 0..1.
 * @property {number} lastMeanMs Last mean frame time in ms.
 * @property {number|null} lastMeanGpuMs Mean GPU time in the latest window, when enough samples were available.
 * @property {number} transitionCount
 * @property {number} droppedLongFrames
 * @property {{limitBytes: number, targetBytes: number, fixedTargetBytes: number, residentBytes: number, overBudget: boolean} | null} memory Latest observed render memory footprint.
 */
/**
 * @typedef {object} ViewportPlan
 * @property {number} cssWidth
 * @property {number} cssHeight
 * @property {number} pixelRatio
 * @property {number} bufferWidth
 * @property {number} bufferHeight
 * @property {QualityTier} tier
 * @property {number} dynamicScale
 * @property {number} maxPixels
 */
/**
 * @typedef {object} ViewportLimits
 * @property {number} [maxBufferWidth]
 * @property {number} [maxBufferHeight]
 */
/**
 * @typedef {object} AdaptiveQualityOptions
 * @property {QualityMode} [mode='auto']
 * @property {QualityDeviceHints} [device={}]
 * @property {number} [minScale=0.6] Min dynamic resolution scale.
 * @property {number} [maxScale=1] Max dynamic resolution scale.
 * @property {number} [minPixelRatio=0.1]
 * @property {number} [maxPixelRatio=2]
 * @property {number} [settleMs=3500] Initial settle time in ms.
 * @property {number} [settleAfterChangeMs=1000]
 * @property {number} [sampleFrames=45] Frames per sample window (2..300).
 * @property {number} [degradeFrameMs=22] Mean frame ms above which quality drops.
 * @property {number} [recoverFrameMs=17] Mean frame ms below which quality recovers.
 * @property {number | null} [memoryBudgetBytes=null] Optional nominal target and resident byte budget.
 * @property {((state: QualitySnapshot, reason: string) => void)|null} [onChange=null]
 */
/**
 * @typedef {object} AdaptiveQualityController
 * @property {QualitySnapshot} state Current snapshot (getter).
 * @property {(next: QualityMode) => boolean} setMode
 * @property {(ms: number, gpuMs?: number|null) => boolean} sampleFrame
 * @property {(scalableTargetBytes: number, residentBytes?: number, fixedTargetBytes?: number) => boolean} sampleMemory Record allocation pressure independently of frame time.
 * @property {() => void} resetMemoryMeasurements Forget observations after a context, resource graph or viewport change.
 * @property {(cssWidth: number, cssHeight: number, dpr?: number, limits?: ViewportLimits) => ViewportPlan} planViewport
 * @property {() => void} resetMeasurements
 */
/** @type {readonly QualityTier[]} */
export const QUALITY_TIERS: readonly QualityTier[];
/** @type {Readonly<Record<QualityPresetTier, Readonly<Quality3DPreset>>>} */
export const QUALITY3D_PRESETS: Readonly<Record<QualityPresetTier, Readonly<Quality3DPreset>>>;
/** @type {Readonly<Record<QualityPresetTier, Readonly<Quality2DPreset>>>} */
export const QUALITY2D_PRESETS: Readonly<Record<QualityPresetTier, Readonly<Quality2DPreset>>>;
export type QualityTier = "low" | "medium" | "high";
/**
 * Tier names accepted by preset tables.
 */
export type QualityPresetTier = QualityTier | "ultra";
export type QualityMode = "auto" | QualityTier;
export type Quality3DPreset = {
    /**
     * Hard physical-pixel budget.
     */
    maxPixels: number;
    /**
     * Max device pixel ratio.
     */
    maxPixelRatio: number;
    /**
     * Shadow map edge in texels.
     */
    shadowMapSize: number;
    shadowsEnabled: boolean;
    /**
     * World units.
     */
    shadowDistance: number;
    msaaSamples: number;
    ssao: boolean;
    ssgi: boolean;
    ssr: boolean;
    contactShadows: boolean;
    bloom: boolean;
    volumetricSteps: number;
    anisotropy: number;
    fxaa: boolean;
    sharpen: number;
    /**
     * World units.
     */
    drawDistance: number;
    occlusionCulling: boolean;
    animationLodScale: number;
    particleScale: number;
    maxDynamicLights: number;
    megaLightsSamples: number;
    maxClusteredLights: number;
};
export type Quality2DPreset = {
    maxPixelRatio: number;
    groundShadows: boolean;
    imageSmoothing: boolean;
    particleScale: number;
    hitFlashQuality: "fast" | "full";
};
export type QualityDeviceHints = {
    mobile?: boolean | undefined;
    /**
     * GPU renderer string.
     */
    rendererName?: string | undefined;
    /**
     * Device memory in GB.
     */
    memoryGB?: number | null | undefined;
};
export type QualitySnapshot = {
    mode: QualityMode;
    tier: QualityTier;
    preset: Quality3DPreset;
    /**
     * Resolution scale 0..1.
     */
    dynamicScale: number;
    /**
     * Last mean frame time in ms.
     */
    lastMeanMs: number;
    /**
     * Mean GPU time in the latest window, when enough samples were available.
     */
    lastMeanGpuMs: number | null;
    transitionCount: number;
    droppedLongFrames: number;
    /**
     * Latest observed render memory footprint.
     */
    memory: {
        limitBytes: number;
        targetBytes: number;
        fixedTargetBytes: number;
        residentBytes: number;
        overBudget: boolean;
    } | null;
};
export type ViewportPlan = {
    cssWidth: number;
    cssHeight: number;
    pixelRatio: number;
    bufferWidth: number;
    bufferHeight: number;
    tier: QualityTier;
    dynamicScale: number;
    maxPixels: number;
};
export type ViewportLimits = {
    maxBufferWidth?: number | undefined;
    maxBufferHeight?: number | undefined;
};
export type AdaptiveQualityOptions = {
    mode?: QualityMode | undefined;
    device?: QualityDeviceHints | undefined;
    /**
     * Min dynamic resolution scale.
     */
    minScale?: number | undefined;
    /**
     * Max dynamic resolution scale.
     */
    maxScale?: number | undefined;
    minPixelRatio?: number | undefined;
    maxPixelRatio?: number | undefined;
    /**
     * Initial settle time in ms.
     */
    settleMs?: number | undefined;
    settleAfterChangeMs?: number | undefined;
    /**
     * Frames per sample window (2..300).
     */
    sampleFrames?: number | undefined;
    /**
     * Mean frame ms above which quality drops.
     */
    degradeFrameMs?: number | undefined;
    /**
     * Mean frame ms below which quality recovers.
     */
    recoverFrameMs?: number | undefined;
    /**
     * Optional nominal target and resident byte budget.
     */
    memoryBudgetBytes?: number | null | undefined;
    onChange?: ((state: QualitySnapshot, reason: string) => void) | null | undefined;
};
export type AdaptiveQualityController = {
    /**
     * Current snapshot (getter).
     */
    state: QualitySnapshot;
    setMode: (next: QualityMode) => boolean;
    sampleFrame: (ms: number, gpuMs?: number | null) => boolean;
    /**
     * Record allocation pressure independently of frame time.
     */
    sampleMemory: (scalableTargetBytes: number, residentBytes?: number, fixedTargetBytes?: number) => boolean;
    /**
     * Forget observations after a context, resource graph or viewport change.
     */
    resetMemoryMeasurements: () => void;
    planViewport: (cssWidth: number, cssHeight: number, dpr?: number, limits?: ViewportLimits) => ViewportPlan;
    resetMeasurements: () => void;
};

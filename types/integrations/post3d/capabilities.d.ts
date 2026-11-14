/**
 * @typedef {object} FullscreenTriangleTHREE Minimal THREE namespace used here.
 * @property {new () => {setAttribute(name: string, attr: object): unknown}} BufferGeometry
 * @property {new (array: Float32Array, itemSize: number) => object} BufferAttribute
 */
/**
 * @typedef {object} WebGLCapabilities
 * @property {boolean} isWebGL2 True for a WebGL2 context.
 * @property {number} maxSamples Max MSAA samples (0 when unsupported).
 * @property {number} maxTextureSize Max texture dimension in px (default 2048).
 * @property {number} maxAnisotropy Max anisotropic filtering (>= 1).
 * @property {string} rendererName Unmasked GPU renderer string ('' if unknown).
 * @property {boolean} halfFloatRenderable True when EXT_color_buffer_float is available on WebGL2.
 */
/**
 * @typedef {object} WebGLRendererLike Structural subset of THREE.WebGLRenderer.
 * @property {() => ({[key: string]: unknown} | null | undefined)} [getContext] WebGL context accessor.
 * @property {{isWebGL2?: boolean, getMaxAnisotropy?: () => number}} [capabilities]
 */
/**
 * Creates a fullscreen triangle geometry (positions + uvs).
 * @param {FullscreenTriangleTHREE} THREE
 * @returns {{setAttribute(name: string, attr: object): unknown}} BufferGeometry.
 */
export function createFullscreenTriangle(THREE: FullscreenTriangleTHREE): {
    setAttribute(name: string, attr: object): unknown;
};
/**
 * Inspects GPU capabilities from an existing WebGLRenderer without creating
 * a second throwaway WebGL context.
 * @param {WebGLRendererLike | null | undefined} renderer
 * @returns {Readonly<WebGLCapabilities>} Frozen capability record (safe fallback when no context).
 */
export function inspectWebGLCapabilities(renderer: WebGLRendererLike | null | undefined): Readonly<WebGLCapabilities>;
/**
 * @typedef {object} QualityControllerLike
 * @property {{preset?: {msaaSamples?: number, anisotropy?: number}}} [state] Active quality state.
 */
/**
 * @typedef {object} QualityDeviceHints
 * @property {string} [rendererName] GPU renderer string override.
 * @property {number | null} [memoryGB] Device memory in GB (<= 2 forces 'low').
 * @property {boolean} [mobile] True on mobile devices (forces 'low').
 */
/**
 * @typedef {object} RefinedQuality
 * @property {Readonly<WebGLCapabilities>} capabilities Inspected capabilities.
 * @property {string} recommendedTier Recommended initial quality tier ('low' | 'medium' | 'high' | ...).
 * @property {number} clampedMsaaSamples MSAA samples clamped to hardware max.
 * @property {number} clampedAnisotropy Anisotropy clamped to hardware max.
 */
/**
 * Combines an existing WebGL context's capabilities with the 3D quality presets.
 * @param {QualityControllerLike | null | undefined} qualityController
 * @param {WebGLRendererLike | null | undefined} renderer
 * @param {QualityDeviceHints} [deviceHints={}]
 * @returns {Readonly<RefinedQuality>}
 */
export function refineQualityWithContext(qualityController: QualityControllerLike | null | undefined, renderer: WebGLRendererLike | null | undefined, deviceHints?: QualityDeviceHints): Readonly<RefinedQuality>;
/**
 * Minimal THREE namespace used here.
 */
export type FullscreenTriangleTHREE = {
    BufferGeometry: new () => {
        setAttribute(name: string, attr: object): unknown;
    };
    BufferAttribute: new (array: Float32Array, itemSize: number) => object;
};
export type WebGLCapabilities = {
    /**
     * True for a WebGL2 context.
     */
    isWebGL2: boolean;
    /**
     * Max MSAA samples (0 when unsupported).
     */
    maxSamples: number;
    /**
     * Max texture dimension in px (default 2048).
     */
    maxTextureSize: number;
    /**
     * Max anisotropic filtering (>= 1).
     */
    maxAnisotropy: number;
    /**
     * Unmasked GPU renderer string ('' if unknown).
     */
    rendererName: string;
    /**
     * True when EXT_color_buffer_float is available on WebGL2.
     */
    halfFloatRenderable: boolean;
};
/**
 * Structural subset of THREE.WebGLRenderer.
 */
export type WebGLRendererLike = {
    /**
     * WebGL context accessor.
     */
    getContext?: () => ({
        [key: string]: unknown;
    } | null | undefined);
    capabilities?: {
        isWebGL2?: boolean;
        getMaxAnisotropy?: () => number;
    };
};
export type QualityControllerLike = {
    /**
     * Active quality state.
     */
    state?: {
        preset?: {
            msaaSamples?: number;
            anisotropy?: number;
        };
    };
};
export type QualityDeviceHints = {
    /**
     * GPU renderer string override.
     */
    rendererName?: string;
    /**
     * Device memory in GB (<= 2 forces 'low').
     */
    memoryGB?: number | null;
    /**
     * True on mobile devices (forces 'low').
     */
    mobile?: boolean;
};
export type RefinedQuality = {
    /**
     * Inspected capabilities.
     */
    capabilities: Readonly<WebGLCapabilities>;
    /**
     * Recommended initial quality tier ('low' | 'medium' | 'high' | ...).
     */
    recommendedTier: string;
    /**
     * MSAA samples clamped to hardware max.
     */
    clampedMsaaSamples: number;
    /**
     * Anisotropy clamped to hardware max.
     */
    clampedAnisotropy: number;
};

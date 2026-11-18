/** WebGL capability inspection and fullscreen triangle helper. */
import { chooseInitial3dQuality, QUALITY3D_PRESETS } from '../quality3d.js';

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
export function createFullscreenTriangle(THREE) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Inspects GPU capabilities from an existing WebGLRenderer without creating
 * a second throwaway WebGL context.
 * @param {WebGLRendererLike | null | undefined} renderer
 * @returns {Readonly<WebGLCapabilities>} Frozen capability record (safe fallback when no context).
 */
export function inspectWebGLCapabilities(renderer) {
  const fallback = Object.freeze({
    isWebGL2: false,
    maxSamples: 0,
    maxTextureSize: 2048,
    maxAnisotropy: 1,
    rendererName: '',
    halfFloatRenderable: false,
  });
  const gl = renderer?.getContext?.();
  if (!gl) return fallback;

  const isWebGL2 = Boolean(
    renderer?.capabilities?.isWebGL2 ||
    (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)
  );
  let maxSamples = 0;
  if (isWebGL2 && 'MAX_SAMPLES' in gl && typeof gl.getParameter === 'function') {
    maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
  }
  const maxTextureSize = typeof gl.getParameter === 'function' && 'MAX_TEXTURE_SIZE' in gl
    ? (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048)
    : 2048;
  const maxAnisotropy = Math.max(1, Number(renderer?.capabilities?.getMaxAnisotropy?.() ?? 1) || 1);

  let rendererName = '';
  try {
    const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
    if (debugInfo && typeof gl.getParameter === 'function') {
      rendererName = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch {
    rendererName = '';
  }

  const halfFloatRenderable = Boolean(
    isWebGL2 && gl.getExtension?.('EXT_color_buffer_float')
  );

  return Object.freeze({
    isWebGL2,
    maxSamples,
    maxTextureSize,
    maxAnisotropy,
    rendererName,
    halfFloatRenderable,
  });
}

export function readSceneSampleCounts(gl, useHalfFloat) {
  const colorFormat = useHalfFloat ? gl?.RGBA16F : gl?.RGBA8;
  if (typeof gl?.getInternalformatParameter !== 'function' ||
      !colorFormat || !gl.DEPTH_COMPONENT24 || !gl.RENDERBUFFER || !gl.SAMPLES) return null;

  const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, colorFormat, gl.SAMPLES);
  const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
  // An empty list means the format can render without multisampling only.
  if (!colorSamples || !depthSamples) return [];
  return Array.from(colorSamples).filter(count => count > 0 && depthSamples.includes(count));
}

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
export function refineQualityWithContext(qualityController, renderer, deviceHints = {}) {
  const capabilities = inspectWebGLCapabilities(renderer);
  const recommendedTier = chooseInitial3dQuality({
    ...deviceHints,
    rendererName: capabilities.rendererName || deviceHints.rendererName || '',
  });
  const activePreset = qualityController?.state?.preset ?? QUALITY3D_PRESETS[recommendedTier];
  return Object.freeze({
    capabilities,
    recommendedTier,
    clampedMsaaSamples: Math.min(activePreset.msaaSamples ?? 0, capabilities.maxSamples),
    clampedAnisotropy: Math.min(activePreset.anisotropy ?? 1, capabilities.maxAnisotropy),
  });
}


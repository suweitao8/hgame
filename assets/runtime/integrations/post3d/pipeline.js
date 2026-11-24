/** HDR post-processing pipeline composer. */
import {
  FULLSCREEN_VERTEX_GLSL3,
  HALF_AO_VOL_FRAGMENT_GLSL3,
  HALF_GI_SSR_FRAGMENT_GLSL3,
  LUMA_EXTRACT_FRAGMENT_GLSL3,
  LUMA_DOWNSAMPLE_FRAGMENT_GLSL3,
  EYE_ADAPT_FRAGMENT_GLSL3,
  BILATERAL_BLUR_FRAGMENT_GLSL3,
  BLOOM_PREFILTER_FRAGMENT_GLSL3,
  BLOOM_DOWNSAMPLE_FRAGMENT_GLSL3,
  BLOOM_UPSAMPLE_FRAGMENT_GLSL3,
  COMPOSITE_FRAGMENT_GLSL3,
  TEMPORAL_AA_FRAGMENT_GLSL3,
  FXAA_SHARPEN_FRAGMENT_GLSL3,
} from './shaders.js';
import { createFullscreenTriangle, inspectWebGLCapabilities, readSceneSampleCounts } from './capabilities.js';
import { computeWhiteBalanceRGB, createColorLutTexture3D } from './color.js';
import { QUALITY3D_PRESETS } from '../quality3d.js';
import { readWorldPosition } from '../shadow3d/transform.js';
import { syncCameraWorldMatrices, usesZeroToOneDepth } from '../camera3d/matrices.js';
import { fitDrawingBuffer, readDrawingBufferLimits } from '../quality3d/viewport.js';
import { drawWithDiagnostics, estimateRenderTargetBytes } from '../quality3d/render-diagnostics.js';
import { createTemporalAA } from './temporal-aa.js';
import { createTemporalMotion } from './temporal-motion.js';
import { getVisibleBakedProbeGrid } from '../lighting3d/baked-probe-grid.js';
import { createHdrTargets } from './hdr-targets.js';
import { FULLSCREEN_PASSES, validateFullscreenPass } from './pass-contracts.js';
import { compileRenderGraph, executeRenderGraph, createPhysicalRenderTargetPool3D } from './render-graph.js';

const POST_STATE_SCALAR_KEYS = [
  'exposure', 'bloomStrength', 'bloomThreshold', 'bloomSoftKnee',
  'ssaoRadius', 'ssaoBias', 'ssaoIntensity', 'volumetricIntensity',
  'giIntensity', 'giRadius', 'ssrIntensity', 'ssrMaxDist', 'ssrThickness',
  'contactShadows', 'contactShadowLength', 'contactShadowThickness',
  'minExposure', 'maxExposure', 'adaptSpeedUp', 'adaptSpeedDown', 'keyValue', 'exposureCompensation',
  'whiteTemp', 'whiteTint', 'contrast', 'chromaticAberration', 'filmGrain',
  'filmSlope', 'filmToe', 'filmShoulder', 'filmBlackClip', 'filmWhiteClip',
  'sharpness', 'vignette', 'saturation', 'damage', 'lowHealth',
  'focus', 'flash', 'fade',
  'heightFogDensity', 'heightFogBase', 'heightFogFalloff', 'lutIntensity',
];
const GI_HISTORY_SETTINGS = ['giIntensity', 'giRadius', 'ssrIntensity', 'ssrMaxDist', 'ssrThickness'];

/**
 * One fullscreen HDR effect. The pipeline writes its output into a scratch color
 * target and supplies that texture to the next effect. The caller owns the material.
 * @typedef {object} PostHdrPass
 * @property {string} id Unique id in this chain.
 * @property {{uniforms: Record<string, {value: unknown}>}} material Fullscreen shader material that replaces all output pixels.
 * @property {{color: string, depth?: string, depthView?: {inverseProjection: string, clipDepthMode: string, far: string}}} inputs Uniform names for HDR color, optional world depth and its matching projection.
 * @property {boolean} [enabled=true] Disabled effects and effects requiring unavailable depth are skipped.
 */

/** @param {readonly PostHdrPass[]} passes */
function normalizeHdrPasses(passes) {
  if (!Array.isArray(passes)) throw new TypeError('HDR passes must be an array');
  const ids = new Set();
  return Object.freeze(passes.map(pass => {
    const id = typeof pass?.id === 'string' ? pass.id.trim() : '';
    if (!id) throw new TypeError('An HDR pass requires a nonempty id');
    if (ids.has(id)) throw new TypeError(`Duplicate HDR pass id: ${id}`);
    ids.add(id);
    const { material, inputs, enabled = true } = pass;
    const color = inputs?.color;
    const depth = inputs?.depth;
    const depthView = inputs?.depthView;
    const uniforms = material?.uniforms ?? {};
    if (typeof enabled !== 'boolean' || (depthView !== undefined && (depth === undefined || !depthView))) {
      throw new TypeError(`Invalid enabled flag or depth view for HDR pass: ${id}`);
    }
    const bindings = [color];
    if (depth !== undefined) bindings.push(depth);
    if (depthView) bindings.push(depthView.inverseProjection, depthView.clipDepthMode, depthView.far);
    const usedUniforms = new Set();
    for (const name of bindings) {
      const entry = typeof name === 'string' && name && Object.prototype.hasOwnProperty.call(uniforms, name) && uniforms[name];
      if (!entry || !Object.prototype.hasOwnProperty.call(entry, 'value') || usedUniforms.has(entry)) {
        throw new TypeError(`Invalid or overlapping input uniforms for HDR pass: ${id}`);
      }
      usedUniforms.add(entry);
    }
    const viewInputs = depthView ? Object.freeze({
      inverseProjection: depthView.inverseProjection,
      clipDepthMode: depthView.clipDepthMode,
      far: depthView.far,
    }) : undefined;
    const normalizedInputs = viewInputs ? { color, depth, depthView: viewInputs } : { color, depth };
    return Object.freeze({ id, material, inputs: Object.freeze(normalizedInputs), enabled });
  }));
}

/** @param {readonly PostHdrPass[]} passes @returns {{pass: PostHdrPass, contract: import('./pass-contracts.js').FullscreenPassContract}[]} */
function compileHdrPasses(passes) {
  return passes.map(pass => ({
    pass,
    contract: {
      name: `custom:${pass.id}`,
      reads: pass.inputs.depth ? [pass.inputs.color, pass.inputs.depth] : [pass.inputs.color],
      writes: 'color',
    },
  }));
}

/** @typedef {import('./color.js').RGBTuple} RGBTuple */
/** @typedef {import('../quality3d.js').Quality3DPreset} Quality3DPreset */
/** @typedef {import('./capabilities.js').WebGLCapabilities} WebGLCapabilities */

/**
 * Constructor of a THREE class (opaque, structurally matches any THREE constructor).
 * @typedef {new (...args: never[]) => object} ThreeCtor
 */

/**
 * Minimal subset of the THREE namespace used by the post pipeline. Optional
 * members are feature-detected; if required ones are missing the pipeline
 * falls back to plain forward rendering.
 * @typedef {object} PostPipelineTHREE
 * @property {ThreeCtor} WebGLRenderTarget
 * @property {ThreeCtor} DepthTexture
 * @property {ThreeCtor} ShaderMaterial
 * @property {ThreeCtor} OrthographicCamera
 * @property {ThreeCtor} Scene
 * @property {ThreeCtor} Mesh
 * @property {ThreeCtor} BufferGeometry
 * @property {ThreeCtor} BufferAttribute
 * @property {ThreeCtor} Matrix4
 * @property {ThreeCtor} Vector2
 * @property {ThreeCtor} Vector3
 * @property {ThreeCtor} [Color]
 * @property {number} GLSL3 Shader language version constant.
 * @property {number} LinearFilter
 * @property {number} NearestFilter
 * @property {number} UnsignedByteType
 * @property {number} UnsignedIntType
 * @property {number} [HalfFloatType]
 * @property {number} [RGBFormat]
 * @property {number} [UnsignedInt101111Type]
 */

/**
 * Structural subset of THREE.WebGLRenderer used by the pipeline.
 * @typedef {object} PostPipelineRenderer
 * @property {boolean} [autoClear] Restored after each render.
 * @property {number} [toneMapping] Restored after each render.
 * @property {{enabled: boolean}} [shadowMap]
 * @property {{isWebGL2?: boolean, logarithmicDepthBuffer?: boolean, reversedDepthBuffer?: boolean, getMaxAnisotropy?(): number}} [capabilities]
 * @property {(target: object | null) => void} setRenderTarget
 * @property {(x: number, y: number, width: number, height: number) => void} [setViewport]
 * @property {(x: number, y: number, width: number, height: number) => void} [setScissor]
 * @property {(scene: object, camera: object) => void} render
 * @property {(color?: boolean, depth?: boolean, stencil?: boolean) => void} [clear]
 * @property {() => void} [clearDepth]
 * @property {() => ({[key: string]: unknown} | null | undefined)} [getContext]
 */

/** @typedef {'aces' | 'agx' | 'none' | 'ueFilmic' | 'filmic' | 0 | 1 | 2 | 3 | string} PostToneMappingMode Unknown values resolve to ACES (index 0). */

/**
 * Post pipeline settings shared by creation options and `setState` patches.
 * @typedef {object} PostPipelineSettings
 * @property {PostToneMappingMode} [toneMapping] Default `'aces'` at creation.
 * @property {number} [exposure=1] Exposure multiplier.
 * @property {number} [bloomStrength=0.28]
 * @property {number} [bloomThreshold=0.85]
 * @property {number} [bloomSoftKnee=0.5]
 * @property {number} [ssaoRadius=0.5] World units.
 * @property {number} [ssaoBias=0.025] World units.
 * @property {number} [ssaoIntensity=0.42]
 * @property {number} [volumetricIntensity=0.18]
 * @property {number} [giIntensity=0.55]
 * @property {number} [giRadius=2.4] World units.
 * @property {number} [ssrIntensity=0.35]
 * @property {number} [ssrMaxDist=28] World units.
 * @property {number} [ssrThickness=0.35] World units.
 * @property {boolean} [temporalGiSsr=false] Reuse depth-validated GI and reflection history on half-float targets.
 * @property {boolean} [temporalAA=false] Jitter and resolve world color using depth-validated temporal history.
 * @property {boolean} [temporalMotion=true] Use object motion on supported WebGL2 HDR targets while temporalAA is active.
 * @property {boolean} [temporalUpsampling=false] Enable temporal upsampling from internal renderScale world targets to full display TAA output.
 * @property {number} [renderScale=1] Internal world resolution scale (0.25..1] when temporalUpsampling is active.
 * @property {number} [contactShadows] 0..1; default follows the quality preset (0.65 or 0).
 * @property {number} [contactShadowLength=0.32] World units.
 * @property {number} [contactShadowThickness=0.08] World units.
 * @property {boolean} [autoExposure=false] GPU eye adaptation (rebuilds targets when toggled).
 * @property {number} [minExposure=0.35]
 * @property {number} [maxExposure=2.6]
 * @property {number} [adaptSpeedUp=3.0] Adaptation rate (1/s) when exposure decreases.
 * @property {number} [adaptSpeedDown=1.4] Adaptation rate (1/s) when exposure increases.
 * @property {number} [keyValue=0.18]
 * @property {number} [exposureCompensation=1]
 * @property {number} [whiteTemp=6500] Kelvin.
 * @property {number} [whiteTint=0] -1..1.
 * @property {number} [contrast=1]
 * @property {RGBTuple} [colorLift=[0,0,0]]
 * @property {RGBTuple} [colorGamma=[1,1,1]]
 * @property {RGBTuple} [colorGain=[1,1,1]]
 * @property {number} [chromaticAberration=0]
 * @property {number} [filmGrain=0]
 * @property {number} [filmSlope=0.88]
 * @property {number} [filmToe=0.55]
 * @property {number} [filmShoulder=0.26]
 * @property {number} [filmBlackClip=0]
 * @property {number} [filmWhiteClip=0.04]
 * @property {number} [sharpness] Unsharp strength; default follows the preset (0.14).
 * @property {number} [vignette=0.18]
 * @property {number} [saturation=1.05]
 * @property {boolean} [fxaa] Default follows the preset (true).
 * @property {number} [damage=0] Damage overlay 0..1.
 * @property {number} [lowHealth=0] Low-health overlay 0..1.
 * @property {number} [focus=0] Focus effect 0..1.
 * @property {number} [flash=0] Flash overlay 0..1.
 * @property {number} [fade=0] Fade-to-black 0..1.
 * @property {number | string | {r: number, g: number, b: number}} [sunColor] Passed to `Color.set` (setState only).
 */

/**
 * Creation-only options of {@link createPostPipeline3D}.
 * @typedef {object} PostPipelineCreateBase
 * @property {PostPipelineTHREE} THREE Required THREE namespace subset.
 * @property {PostPipelineRenderer} renderer Required renderer.
 * @property {number} [width=960] Buffer width in px.
 * @property {number} [height=540] Buffer height in px.
 * @property {Partial<Quality3DPreset> | null} [preset] Quality preset (default: medium preset).
 * @property {readonly PostHdrPass[]} [passes] HDR effects in execution order before exposure sampling, bloom and tone mapping.
 */

/** @typedef {PostPipelineSettings & PostPipelineCreateBase} PostPipeline3DOptions */

/**
 * Snapshot of the pipeline state (copy).
 * @typedef {object} PostPipelineState
 * @property {number} toneMapping Resolved tone-mapping index (0 ACES, 1 AgX, 2 none, 3 UE filmic).
 * @property {number} exposure
 * @property {number} bloomStrength
 * @property {number} bloomThreshold
 * @property {number} bloomSoftKnee
 * @property {number} ssaoRadius
 * @property {number} ssaoBias
 * @property {number} ssaoIntensity
 * @property {number} volumetricIntensity
 * @property {number} giIntensity
 * @property {number} giRadius
 * @property {number} ssrIntensity
 * @property {number} ssrMaxDist
 * @property {number} ssrThickness
 * @property {boolean} temporalGiSsr
 * @property {boolean} temporalAA
 * @property {boolean} temporalMotion
 * @property {boolean} temporalUpsampling
 * @property {number} renderScale
 * @property {number} contactShadows
 * @property {number} contactShadowLength
 * @property {number} contactShadowThickness
 * @property {boolean} autoExposure
 * @property {number} minExposure
 * @property {number} maxExposure
 * @property {number} adaptSpeedUp
 * @property {number} adaptSpeedDown
 * @property {number} keyValue
 * @property {number} exposureCompensation
 * @property {number} whiteTemp
 * @property {number} whiteTint
 * @property {number} contrast
 * @property {RGBTuple} colorLift
 * @property {RGBTuple} colorGamma
 * @property {RGBTuple} colorGain
 * @property {number} chromaticAberration
 * @property {number} filmGrain
 * @property {number} filmSlope
 * @property {number} filmToe
 * @property {number} filmShoulder
 * @property {number} filmBlackClip
 * @property {number} filmWhiteClip
 * @property {number} sharpness
 * @property {number} vignette
 * @property {number} saturation
 * @property {boolean} fxaa
 * @property {number} damage
 * @property {number} lowHealth
 * @property {number} focus
 * @property {number} flash
 * @property {number} fade
 * @property {object | null} sunColor THREE.Color instance (null without THREE.Color).
 * @property {object | null} whiteBalanceVec THREE.Vector3 of white-balance multipliers.
 * @property {object | null} liftVec THREE.Vector3 mirror of `colorLift`.
 * @property {object | null} gammaVec THREE.Vector3 mirror of `colorGamma`.
 * @property {object | null} gainVec THREE.Vector3 mirror of `colorGain`.
 */

/**
 * Internal render-target allocation info.
 * @typedef {object} PostPipelineTargets
 * @property {number} bufferWidth Full-resolution buffer width in px.
 * @property {number} bufferHeight Full-resolution buffer height in px.
 * @property {boolean} hasSceneRT
 * @property {boolean} hasHalfRT Half-res AO/volumetric targets allocated.
 * @property {boolean} hasGiSsrRT Half-res GI/SSR targets allocated.
 * @property {boolean} hasAutoExposureRT Eye-adaptation pyramid allocated.
 * @property {number} bloomMipCount
 * @property {boolean} hasLdrRT Intermediate LDR target for FXAA/sharpen.
 * @property {boolean} hasTemporalAA Temporal color and depth history allocated.
 */

/**
 * Camera members read by `render`.
 * @typedef {object} PostPipelineCamera
 * @property {boolean} [isCamera]
 * @property {boolean} [isOrthographicCamera]
 * @property {boolean} [isArrayCamera]
 * @property {number} [coordinateSystem]
 * @property {boolean} [reversedDepth]
 * @property {number} [near] Default 0.1.
 * @property {number} [far] Default 1000.
 * @property {object} projectionMatrix
 * @property {object} projectionMatrixInverse
 * @property {object} matrixWorld
 * @property {object} matrixWorldInverse
 * @property {(force?: boolean) => void} [updateMatrixWorld]
 * @property {(updateParents: boolean, updateChildren: boolean) => void} [updateWorldMatrix]
 */

/**
 * Directional (sun) light members read by `render`.
 * @typedef {object} PostPipelineSunLight
 * @property {{x: number, y: number, z: number}} position
 * @property {{position?: {x: number, y: number, z: number}}} [target]
 * @property {object} [color] THREE.Color copied into the sun color.
 * @property {boolean} [visible]
 * @property {boolean} [castShadow]
 * @property {{map?: ({texture?: object, depthTexture?: {compareFunction?: number | null} | null} | null), matrix?: object, camera?: {reversedDepth?: boolean}}} [shadow]
 */

/**
 * Per-frame render options.
 * @typedef {object} PostPipelineRenderOptions
 * @property {object | null} [viewScene=null] Optional first-person scene composited before tone mapping.
 * @property {object | null} [viewCamera=null] Camera for `viewScene`.
 * @property {PostPipelineSunLight | null} [sunLight=null] Sun used for volumetrics/contact shadows.
 * @property {ReturnType<typeof import('../lighting3d/baked-probe-grid.js').createBakedProbeGrid>} [irradianceGrid=null] World-space baked diffuse coverage for SSGI blending.
 * @property {number} [dt=0] Frame delta in seconds.
 * @property {readonly [number, number, number, number] | null} [outputViewport=null] Screen x, y, width and height in renderer pixels before DPR, with a bottom-left origin.
 * @property {{beginPass: (name: string, target: object | null) => (() => void) | null, recordTarget: (target: object) => void} | null} [diagnostics=null] Optional stage and target sink.
 */

/**
 * @typedef {object} PostPipeline3D
 * @property {boolean} supported Getter; true when the HDR pipeline is active (WebGL2 + required THREE classes).
 * @property {Readonly<WebGLCapabilities>} capabilities Getter; inspected GPU capabilities.
 * @property {Quality3DPreset} preset Getter; active (merged) quality preset.
 * @property {PostPipelineState} state Getter; shallow copy of the current state.
 * @property {PostPipelineTargets} targets Getter; target allocation info.
 * @property {() => {scalableBytes: number, fixedBytes: number}} estimateTargetBytes Nominal bytes of currently owned render attachments.
 * @property {() => object[]} getRenderTargets Currently owned render targets, for resource deduplication.
 * @property {readonly PostHdrPass[]} passes Getter; current fullscreen HDR effects.
 * @property {(width: number, height: number) => void} resize Resizes buffers (px).
 * @property {(preset: Partial<Quality3DPreset>, buffer?: {width: number, height: number}) => void} setPreset Applies a preset and optionally resizes in one target rebuild.
 * @property {(patch?: PostPipelineSettings) => void} setState Merges finite numeric/array settings.
 * @property {(passes: readonly PostHdrPass[]) => void} setPasses Replaces the HDR effect chain.
 * @property {() => void} resetGiSsrHistory Discard GI and reflection history after a scene cut or discontinuous motion.
 * @property {() => void} resetTemporalHistory Discard AA, GI and reflection histories after a scene cut.
 * @property {(world: object, camera: PostPipelineCamera, options?: PostPipelineRenderOptions) => void} render Renders `world` through the pipeline (forward fallback when unsupported).
 * @property {() => void} handleContextLost Releases GPU targets.
 * @property {() => void} handleContextRestored Rebuilds GPU targets.
 * @property {() => boolean} dispose Releases resources; false if already disposed.
 */

/**
 * Maps a tone-mapping name/index to the shader index.
 * @param {PostToneMappingMode} mode
 * @returns {0 | 1 | 2 | 3} 0 ACES (default), 1 AgX, 2 none, 3 UE filmic.
 */
export function resolveToneMappingIndex(mode) {
  if (mode === 'agx' || mode === 1) return 1;
  if (mode === 'none' || mode === 2) return 2;
  if (mode === 'ueFilmic' || mode === 'filmic' || mode === 3) return 3;
  return 0;
}

/**
 * Creates a clean-room WebGL2 HDR post-processing composer with automatic
 * fallback to forward rendering on non-WebGL2 or mock renderers.
 * @param {PostPipeline3DOptions} options
 * @returns {PostPipeline3D}
 */
export function createPostPipeline3D(options = {}) {
  const {
    THREE,
    renderer,
    width = 960,
    height = 540,
    preset = QUALITY3D_PRESETS.medium,
    toneMapping = 'aces',
    exposure = 1.0,
    bloomStrength = 0.28,
    bloomThreshold = 0.85,
    bloomSoftKnee = 0.5,
    ssaoRadius = 0.5,
    ssaoBias = 0.025,
    ssaoIntensity = 0.42,
    volumetricIntensity = 0.18,
    giIntensity = 0.55,
    temporalGiSsr = false,
    temporalAA = false,
    temporalMotion = true,
    temporalUpsampling = false,
    renderScale = 1,
    giRadius = 2.4,
    ssrIntensity = 0.35,
    ssrMaxDist = 28.0,
    ssrThickness = 0.35,
    contactShadows,
    contactShadowLength = 0.32,
    contactShadowThickness = 0.08,
    autoExposure = false,
    minExposure = 0.35,
    maxExposure = 2.6,
    adaptSpeedUp = 3.0,
    adaptSpeedDown = 1.4,
    keyValue = 0.18,
    exposureCompensation = 1.0,
    whiteTemp = 6500,
    whiteTint = 0,
    contrast = 1.0,
    colorLift = [0, 0, 0],
    colorGamma = [1, 1, 1],
    colorGain = [1, 1, 1],
    chromaticAberration = 0,
    filmGrain = 0,
    filmSlope = 0.88,
    filmToe = 0.55,
    filmShoulder = 0.26,
    filmBlackClip = 0.0,
    filmWhiteClip = 0.04,
    sharpness,
    vignette = 0.18,
    saturation = 1.05,
    fxaa,
    heightFog = null,
    colorLut = null,
  } = options;
  if (!THREE || !renderer) {
    throw new TypeError('createPostPipeline3D requires THREE and renderer');
  }
  const explicitFxaa = fxaa !== undefined;
  const explicitSharpness = sharpness !== undefined;
  const explicitContactShadows = contactShadows !== undefined;
  const capabilities = inspectWebGLCapabilities(renderer);
  const supported = Boolean(
    capabilities.isWebGL2 &&
    THREE.WebGLRenderTarget &&
    THREE.DepthTexture &&
    THREE.ShaderMaterial &&
    THREE.GLSL3 &&
    THREE.OrthographicCamera &&
    THREE.Scene &&
    THREE.Mesh &&
    THREE.BufferGeometry &&
    THREE.BufferAttribute &&
    typeof renderer.setRenderTarget === 'function'
  );

  let activePreset = preset ? { ...QUALITY3D_PRESETS.medium, ...preset } : { ...QUALITY3D_PRESETS.medium };
  let customPasses = normalizeHdrPasses(options.passes ?? []);
  let customStages = compileHdrPasses(customPasses);
  let targetLimits = supported ? readDrawingBufferLimits(renderer) : undefined;
  let requestedWidth = Math.max(1, Math.floor(width));
  let requestedHeight = Math.max(1, Math.floor(height));
  let { bufferWidth, bufferHeight } = fitDrawingBuffer(requestedWidth, requestedHeight, 1, targetLimits);
  let disposed = false;
  let contextLost = false;
  let elapsed = 0;
  let adaptIndex = 0;
  let adaptNeedsReset = true;

  const whiteBalanceRgb = computeWhiteBalanceRGB(whiteTemp, whiteTint);
  const state = {
    toneMapping: resolveToneMappingIndex(toneMapping),
    exposure,
    bloomStrength,
    bloomThreshold,
    bloomSoftKnee,
    ssaoRadius,
    ssaoBias,
    ssaoIntensity,
    volumetricIntensity,
    giIntensity,
    temporalGiSsr: Boolean(temporalGiSsr),
    temporalAA: Boolean(temporalAA),
    temporalMotion: Boolean(temporalMotion),
    temporalUpsampling: Boolean(temporalUpsampling),
    renderScale: Number.isFinite(renderScale) ? Math.min(1, Math.max(0.25, renderScale)) : 1,
    giRadius,
    ssrIntensity,
    ssrMaxDist,
    ssrThickness,
    contactShadows: explicitContactShadows ? contactShadows : (activePreset.contactShadows ? 0.65 : 0),
    contactShadowLength,
    contactShadowThickness,
    autoExposure: Boolean(autoExposure),
    minExposure,
    maxExposure,
    adaptSpeedUp,
    adaptSpeedDown,
    keyValue,
    exposureCompensation,
    whiteTemp,
    whiteTint,
    contrast,
    colorLift: [...colorLift],
    colorGamma: [...colorGamma],
    colorGain: [...colorGain],
    chromaticAberration,
    filmGrain,
    filmSlope,
    filmToe,
    filmShoulder,
    filmBlackClip,
    filmWhiteClip,
    sharpness: explicitSharpness && Number.isFinite(sharpness) ? sharpness : (activePreset.sharpen ?? 0.14),
    vignette,
    saturation,
    fxaa: explicitFxaa ? Boolean(fxaa) : (activePreset.fxaa ?? true),
    damage: 0,
    lowHealth: 0,
    focus: 0,
    flash: 0,
    fade: 0,
    sunColor: THREE.Color ? new THREE.Color(0xfff1d6) : null,
    whiteBalanceVec: THREE.Vector3 ? new THREE.Vector3(whiteBalanceRgb[0], whiteBalanceRgb[1], whiteBalanceRgb[2]) : null,
    liftVec: THREE.Vector3 ? new THREE.Vector3(...colorLift) : null,
    gammaVec: THREE.Vector3 ? new THREE.Vector3(...colorGamma) : null,
    gainVec: THREE.Vector3 ? new THREE.Vector3(...colorGain) : null,
    heightFogDensity: 0,
    heightFogBase: 0,
    heightFogFalloff: 0.25,
    heightFogColor: THREE.Vector3 ? new THREE.Vector3(0.53, 0.64, 0.77) : null,
    lutIntensity: 0,
    lutSize: 16,
    lutSrgb: false,
    lutPreset: null,
  };

  let lutTexture = null;
  let ownedLutTexture = null;
  let dummyWhiteLut = THREE.DataTexture
    ? new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
    : null;
  if (dummyWhiteLut) dummyWhiteLut.needsUpdate = true;

  function applyHeightFogConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') {
      if (cfg === false) state.heightFogDensity = 0;
      return;
    }
    if (Number.isFinite(cfg.density)) state.heightFogDensity = Math.max(0, cfg.density);
    if (Number.isFinite(cfg.baseHeight)) state.heightFogBase = cfg.baseHeight;
    if (Number.isFinite(cfg.falloff)) state.heightFogFalloff = Math.max(0.001, cfg.falloff);
    if (cfg.color !== undefined && state.heightFogColor) {
      if (typeof cfg.color === 'number' && THREE.Color) {
        const tmp = new THREE.Color(cfg.color);
        state.heightFogColor.set(tmp.r, tmp.g, tmp.b);
      } else if (Array.isArray(cfg.color) && cfg.color.length >= 3) {
        state.heightFogColor.set(cfg.color[0], cfg.color[1], cfg.color[2]);
      } else if (cfg.color && typeof cfg.color === 'object' && Number.isFinite(cfg.color.r)) {
        state.heightFogColor.set(cfg.color.r, cfg.color.g, cfg.color.b);
      }
    }
  }

  function applyColorLutConfig(cfg) {
    if (cfg === false || cfg === null) {
      if (ownedLutTexture) { ownedLutTexture.dispose?.(); ownedLutTexture = null; }
      lutTexture = null;
      state.lutIntensity = 0;
      state.lutSrgb = false;
      state.lutPreset = null;
      return;
    }
    if (typeof cfg === 'string') {
      if (ownedLutTexture) { ownedLutTexture.dispose?.(); ownedLutTexture = null; }
      const tex = createColorLutTexture3D(THREE, cfg, 16);
      if (tex?.isDataTexture !== false) {
        ownedLutTexture = tex;
        lutTexture = tex;
      }
      state.lutSize = tex?.userData?.hgameLutSize ?? tex?.size ?? 16;
      state.lutSrgb = false;
      state.lutPreset = cfg;
      state.lutIntensity = 1.0;
      return;
    }
    if (cfg && typeof cfg === 'object') {
      if (cfg.texture) {
        if (ownedLutTexture) { ownedLutTexture.dispose?.(); ownedLutTexture = null; }
        lutTexture = cfg.texture;
        state.lutSize = cfg.size ?? cfg.texture?.userData?.hgameLutSize ?? 16;
        state.lutSrgb = Boolean(cfg.srgbInput ?? cfg.texture?.userData?.hgameLutSrgb);
        state.lutPreset = cfg.texture?.userData?.preset ?? 'custom';
        state.lutIntensity = Number.isFinite(cfg.intensity) ? cfg.intensity : 1.0;
      } else if (cfg.preset) {
        if (ownedLutTexture) { ownedLutTexture.dispose?.(); ownedLutTexture = null; }
        const tex = createColorLutTexture3D(THREE, cfg.preset, cfg.size ?? 16);
        if (tex?.isDataTexture !== false) {
          ownedLutTexture = tex;
          lutTexture = tex;
        }
        state.lutSize = tex?.userData?.hgameLutSize ?? tex?.size ?? 16;
        state.lutSrgb = false;
        state.lutPreset = cfg.preset;
        state.lutIntensity = Number.isFinite(cfg.intensity) ? cfg.intensity : 1.0;
      } else if (Number.isFinite(cfg.intensity)) {
        state.lutIntensity = cfg.intensity;
      }
    }
  }

  applyHeightFogConfig(heightFog);
  applyColorLutConfig(colorLut);

  let sceneRT = null;
  let sceneTargetSpec = null;
  const renderedSceneTargets = new WeakSet();
  let halfRT = null;
  let aoBlurRT = null;
  let halfScratchRT = null;
  let giSsrRT = null;
  let giHistoryRT = null;
  let giHistoryWorld = null;
  let giHistoryCamera = null;
  let giHistoryDepthMode = -1;
  let giHistoryGuideOffset = 0;
  let giHistoryView = null;
  let giHistoryProjection = null;
  let lastIrradianceGrid = null;
  let lumaMips = [];
  let adaptRT = [];
  let ldrRT = null;
  let reactiveMaskRT = null;
  let reactiveMaskMat = null;
  let lastExecutedGraph = [];
  let lastFrameGraph = null;
  const frameGraphOptions = { externalOutputs: ['backbuffer'], pruneDeadPasses: true };
  let frameGraphSignature;
  let compiledFrameGraph;

  function getCompiledFrameGraph(passes) {
    // Validate caller-provided IDs and outputs before serialization can coerce them.
    if (passes.some(pass => typeof pass.id !== 'string' ||
        pass.writes.some(output => typeof output !== 'string'))) {
      return compileRenderGraph(passes, frameGraphOptions);
    }
    // These declarations contain only strings, flags, target specs, and frame callbacks.
    const signature = JSON.stringify(passes);
    if (signature !== frameGraphSignature) {
      compiledFrameGraph = compileRenderGraph(
        passes.map(({ execute, ...declaration }) => declaration),
        frameGraphOptions,
      );
      frameGraphSignature = signature;
    }
    return compiledFrameGraph;
  }
  let lastReactiveMeshCount = 0;
  let temporalAa = null;
  let bloomMipCount = 0;
  let bloomStages = [];
  let postCamera = null;
  let postScene = null;
  let quadGeom = null;
  let quadMesh = null;
  let mats = null;
  let activeDiagnostics = null;
  let sceneProjectionUniforms = null;
  let decalRestoreProjection = null;
  let decalRestoreInverse = null;
  let customInverseProjection = null;
  let scratchCamToShadow = null;
  let scratchViewToWorld = null;
  let scratchCamWorld = THREE.Vector3 ? new THREE.Vector3() : null;
  let scratchInvView = THREE.Matrix4 ? new THREE.Matrix4() : null;
  let scratchSunView = null;
  let scratchSunTarget = null;
  const hdrType = capabilities.halfFloatRenderable && THREE.HalfFloatType
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
  const usesByteColorTargets = hdrType === THREE.UnsignedByteType;
  const hdrTargets = createHdrTargets((width, height, depthBuffer) =>
    makeColorTarget(width, height, { type: hdrType, depthBuffer }));
  const transientPool = supported ? createPhysicalRenderTargetPool3D(THREE, { maxIdleFrames: 4 }) : null;
  let sceneSampleCounts;
  let bloomStorage = chooseBloomStorage();

  function chooseBloomStorage() {
    if (supported && !usesByteColorTargets && THREE.RGBFormat !== undefined && THREE.UnsignedInt101111Type !== undefined &&
        renderer.getContext?.()?.getExtension?.('EXT_color_buffer_float')) {
      return { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat };
    }
    return { type: hdrType, format: THREE.RGBAFormat };
  }

  function makeColorTarget(w, h, { type, format, samples = 0, depthTexture = null, depthBuffer = Boolean(depthTexture) } = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type,
      ...(format === undefined ? {} : { format }),
      samples,
      depthBuffer,
      resolveDepthBuffer: Boolean(depthTexture),
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    if (depthTexture) rt.depthTexture = depthTexture;
    return rt;
  }

  function syncColorTarget(target, enabled, width, height, type, format) {
    if (!enabled) {
      target?.dispose?.();
      return null;
    }
    if (target && (target.texture?.type ?? type) === type &&
        (format === undefined || (target.texture?.format ?? format) === format)) {
      if (target.width === width && target.height === height) return target;
      if (typeof target.setSize === 'function') {
        target.setSize(width, height);
        return target;
      }
    }
    const replacement = makeColorTarget(width, height, { type, format });
    target?.dispose?.();
    return replacement;
  }

  function disposeExposureTargets() {
    for (const rt of lumaMips) rt.dispose?.();
    for (const rt of adaptRT) rt.dispose?.();
    lumaMips = [];
    adaptRT = [];
  }

  function disposeTargets() {
    halfRT?.dispose?.();
    aoBlurRT?.dispose?.();
    halfScratchRT?.dispose?.();
    giSsrRT?.dispose?.();
    giHistoryRT?.dispose?.();
    ldrRT?.dispose?.();
    reactiveMaskRT?.dispose?.();
    temporalAa?.release();
    disposeExposureTargets();
    hdrTargets.dispose();
    transientPool?.dispose();
    sceneRT = null;
    sceneTargetSpec = null;
    halfRT = null;
    aoBlurRT = null;
    halfScratchRT = null;
    giSsrRT = null;
    giHistoryRT = null;
    lastIrradianceGrid = null;
    resetGiSsrHistory();
    ldrRT = null;
    reactiveMaskRT = null;
    bloomMipCount = 0;
    bloomStages = [];
  }

  function makeDepthTexture(width, height) {
    const depth = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    depth.generateMipmaps = false;
    return depth;
  }

  function getWorldRenderDimensions() {
    const upsampling = Boolean(state.temporalAA && state.temporalUpsampling &&
      Number.isFinite(state.renderScale) && state.renderScale > 0 && state.renderScale < 1);
    return {
      upsampling,
      worldWidth: upsampling ? Math.max(1, Math.round(bufferWidth * state.renderScale)) : bufferWidth,
      worldHeight: upsampling ? Math.max(1, Math.round(bufferHeight * state.renderScale)) : bufferHeight,
    };
  }

  function syncSceneTarget() {
    const requestedSamples = Math.min(Math.max(0, activePreset.msaaSamples ?? 0), capabilities.maxSamples);
    let msaa = requestedSamples;
    if (requestedSamples > 0) {
      if (sceneSampleCounts === undefined) {
        sceneSampleCounts = readSceneSampleCounts(renderer.getContext?.(), !usesByteColorTargets);
      }
      if (sceneSampleCounts !== null) {
        msaa = sceneSampleCounts.reduce((best, count) => count <= requestedSamples ? Math.max(count, best) : best, 0);
      }
    }
    const { worldWidth, worldHeight } = getWorldRenderDimensions();
    const sampleDepth = renderer.capabilities?.logarithmicDepthBuffer !== true;
    if (sceneRT?.width === worldWidth && sceneRT.height === worldHeight &&
        sceneRT.samples === msaa && Boolean(sceneRT.depthTexture) === sampleDepth) return;

    if (sceneRT && !renderedSceneTargets.has(sceneRT)) transientPool.discard(sceneRT);
    sceneTargetSpec = Object.freeze({
      width: worldWidth,
      height: worldHeight,
      type: hdrType,
      format: THREE.RGBAFormat,
      samples: msaa,
      depthBuffer: true,
      depthTexture: sampleDepth,
    });
    // Keep the correctly sized target available to existing callers before the next draw.
    sceneRT = transientPool.acquire(sceneTargetSpec, 'sceneTarget');
    transientPool.release(sceneRT);
  }

  function syncBloomLayout(hw, hh) {
    bloomStages = [];
    bloomMipCount = 0;
    if (!activePreset.bloom) return;
    const specs = [];
    for (let width = hw, height = hh; specs.length < 4;) {
      specs.push(Object.freeze({ width, height, ...bloomStorage }));
      if (width === 1 && height === 1) break;
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
    bloomMipCount = specs.length;
    const add = (id, reads, output, spec) => {
      bloomStages.push({ id, reads, writes: [output], transientSpecs: { [output]: spec } });
    };
    add('bloom-prefilter', [], specs.length === 1 ? 'bloomColor' : 'bloomDown0', specs[0]);
    for (let i = 1; i < specs.length; i++) {
      add(`bloom-downsample-${i}`, [`bloomDown${i - 1}`], `bloomDown${i}`, specs[i]);
    }
    let lower = `bloomDown${specs.length - 1}`;
    for (let i = specs.length - 2; i >= 0; i--) {
      const output = i === 0 ? 'bloomColor' : `bloomUp${i}`;
      add(`bloom-upsample-${i}`, [lower, `bloomDown${i}`], output, specs[i]);
      lower = output;
    }
  }

  function syncTargets() {
    if (!supported || disposed || contextLost) return;
    syncSceneTarget();
    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    const useAoVol = Boolean(!transientPool && sceneRT.depthTexture && (activePreset.ssao || (activePreset.volumetricSteps ?? 0) > 0));
    halfRT = syncColorTarget(halfRT, useAoVol, hw, hh, THREE.UnsignedByteType);
    aoBlurRT = syncColorTarget(aoBlurRT, useAoVol && !usesByteColorTargets, hw, hh, THREE.UnsignedByteType);
    syncBloomLayout(hw, hh);

    syncOptionalTargets();
  }

  // Match the shader's branch thresholds, including whether each effect is
  // available in the current quality tier.
  function ssgiEnabled() {
    return Boolean(activePreset.ssgi && state.giIntensity > 0.001);
  }

  function ssrEnabled() {
    return Boolean(activePreset.ssr && state.ssrIntensity > 0.001);
  }

  function syncOptionalTargets() {
    if (!sceneRT) return;

    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    const useGiSsr = Boolean(sceneRT.depthTexture && (ssgiEnabled() || ssrEnabled()));
    giSsrRT = syncColorTarget(giSsrRT, useGiSsr && !transientPool, hw, hh, hdrType);
    const useGiHistory = useGiSsr && state.temporalGiSsr && !usesByteColorTargets;
    if (giHistoryRT && (!useGiHistory || giHistoryRT.width !== hw || giHistoryRT.height !== hh)) {
      resetGiSsrHistory();
    }
    giHistoryRT = syncColorTarget(giHistoryRT, useGiHistory, hw, hh, hdrType);
    const useHalfScratch = !transientPool && (useGiSsr || (usesByteColorTargets && Boolean(halfRT)));
    halfScratchRT = syncColorTarget(halfScratchRT, useHalfScratch, hw, hh, hdrType);

    // The fixed-size exposure targets retain adaptation history across viewport changes.
    if (state.autoExposure) {
      if (adaptRT.length === 0) {
        lumaMips = [64, 16, 4].map(size => makeColorTarget(size, size, { type: hdrType }));
        adaptRT = [
          makeColorTarget(1, 1, { type: hdrType }),
          makeColorTarget(1, 1, { type: hdrType }),
        ];
        adaptIndex = 0;
        adaptNeedsReset = true;
      }
    } else if (adaptRT.length > 0) {
      disposeExposureTargets();
    }

    const useLdr = !transientPool && (state.fxaa || state.sharpness > 0.001);
    ldrRT = syncColorTarget(ldrRT, useLdr, bufferWidth, bufferHeight, THREE.UnsignedByteType);
  }

  function initMaterials() {
    if (!supported) return;
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    quadGeom = createFullscreenTriangle(THREE);

    const makeShader = (fragmentShader, uniforms, defines = {}) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX_GLSL3,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
    });

    sceneProjectionUniforms = {
      uInvProj: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uSceneDepthMode: { value: 0 },
      uSceneDepthGuideOffset: { value: 0 },
    };
    scratchCamToShadow = new THREE.Matrix4();
    scratchViewToWorld = new THREE.Matrix4();
    scratchSunView = new THREE.Vector3(0, 1, 0);
    scratchSunTarget = new THREE.Vector3();
    giHistoryView = new THREE.Matrix4();
    giHistoryProjection = new THREE.Matrix4();
    const exposureDefines = usesByteColorTargets ? { HGAME_EXPOSURE_UNORM: 1 } : {};
    const giDepthDefines = usesByteColorTargets ? { HGAME_BYTE_GI_DEPTH: 1 } : {};
    const storedExposureRange = { value: new THREE.Vector2(state.minExposure, state.maxExposure) };

    const aoVolUniforms = {
      tDepth: { value: null },
      tSunShadow: { value: null },
      ...sceneProjectionUniforms,
      uCamToShadow: { value: scratchCamToShadow },
      uSunViewDir: { value: scratchSunView },
      uResolution: { value: new THREE.Vector2(bufferWidth, bufferHeight) },
      uSsaoEnabled: { value: 0 },
      uSsaoRadius: { value: state.ssaoRadius },
      uSsaoBias: { value: state.ssaoBias },
      uVolumetricSteps: { value: 0 },
      uShadowDepthSign: { value: 1 },
      uTime: { value: 0 },
    };
    mats = {
      aoVol: makeShader(HALF_AO_VOL_FRAGMENT_GLSL3, aoVolUniforms),
      aoVolCompare: makeShader(HALF_AO_VOL_FRAGMENT_GLSL3, aoVolUniforms, { HGAME_SHADOW_COMPARE: 1 }),
      blur: makeShader(BILATERAL_BLUR_FRAGMENT_GLSL3, {
        tInput: { value: null },
        uAxis: { value: new THREE.Vector2(1, 0) },
      }),
      giSsr: makeShader(HALF_GI_SSR_FRAGMENT_GLSL3, {
        tScene: { value: null },
        tDepth: { value: null },
        ...sceneProjectionUniforms,
        uResolution: { value: new THREE.Vector2(bufferWidth, bufferHeight) },
        uSsgiEnabled: { value: 0 },
        uSsrEnabled: { value: 0 },
        uGiRadius: { value: state.giRadius },
        uGiIntensity: { value: state.giIntensity },
        uIrradianceWeight: { value: 0 },
        uIrradianceViewToWorld: { value: new THREE.Matrix4() },
        uIrradianceGridMin: { value: new THREE.Vector3() },
        uIrradianceGridMax: { value: new THREE.Vector3() },
        uIrradianceGridResolution: { value: new THREE.Vector3() },
        uSsrIntensity: { value: state.ssrIntensity },
        uSsrMaxDist: { value: state.ssrMaxDist },
        uSsrThickness: { value: state.ssrThickness },
        uTime: { value: 0 },
      }),
      blurRgba: makeShader(BILATERAL_BLUR_FRAGMENT_GLSL3, {
        tInput: { value: null },
        uAxis: { value: new THREE.Vector2(1, 0) },
      }, { ...giDepthDefines, HGAME_BLUR_GI: 1 }),
      blurGiHistory: makeShader(BILATERAL_BLUR_FRAGMENT_GLSL3, {
        ...sceneProjectionUniforms,
        tInput: { value: null },
        uAxis: { value: new THREE.Vector2(0, 1) },
        tSceneDepth: { value: null },
        tHistory: { value: null },
        uPreviousFromCurrentView: { value: new THREE.Matrix4() },
        uPreviousProjection: { value: giHistoryProjection },
        uPreviousGuideOffset: { value: 0 },
        uHistoryWeight: { value: 0 },
      }, { HGAME_BLUR_GI: 1, HGAME_GI_HISTORY: 1 }),
      lumaExtract: makeShader(LUMA_EXTRACT_FRAGMENT_GLSL3, {
        tScene: { value: null },
      }, exposureDefines),
      lumaDown: makeShader(LUMA_DOWNSAMPLE_FRAGMENT_GLSL3, {
        tSource: { value: null },
      }, exposureDefines),
      eyeAdapt: makeShader(EYE_ADAPT_FRAGMENT_GLSL3, {
        tLogLuma: { value: null },
        tPrevAdapt: { value: null },
        uStoredExposureRange: storedExposureRange,
        uDt: { value: 1 / 60 },
        uKeyValue: { value: state.keyValue },
        uExposureComp: { value: state.exposureCompensation },
        uMinExposure: { value: state.minExposure },
        uMaxExposure: { value: state.maxExposure },
        uAdaptSpeedUp: { value: state.adaptSpeedUp },
        uAdaptSpeedDown: { value: state.adaptSpeedDown },
        uResetAdapt: { value: 1 },
      }, exposureDefines),
      prefilter: makeShader(BLOOM_PREFILTER_FRAGMENT_GLSL3, {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
        uThreshold: { value: state.bloomThreshold },
        uSoftKnee: { value: state.bloomSoftKnee },
      }),
      downsample: makeShader(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL3, {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
      }),
      upsample: makeShader(BLOOM_UPSAMPLE_FRAGMENT_GLSL3, {
        tLower: { value: null },
        tUpper: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
      }),
      composite: makeShader(COMPOSITE_FRAGMENT_GLSL3, {
        tScene: { value: null },
        tDepth: { value: null },
        tAoVol: { value: null },
        tGiSsr: { value: null },
        tBloom: { value: null },
        tAutoExposure: { value: null },
        uStoredExposureRange: storedExposureRange,
        ...sceneProjectionUniforms,
        uSunViewDir: { value: scratchSunView },
        uSunColor: { value: state.sunColor },
        uWhiteBalance: { value: state.whiteBalanceVec },
        uColorLift: { value: state.liftVec },
        uColorGamma: { value: state.gammaVec },
        uColorGain: { value: state.gainVec },
        uUseAo: { value: 0 },
        uUseVolumetric: { value: 0 },
        uUseGiSsr: { value: 0 },
        uUseBloom: { value: 0 },
        uUseAutoExposure: { value: 0 },
        uHasSunDir: { value: 0 },
        uContactShadows: { value: state.contactShadows },
        uContactShadowLength: { value: state.contactShadowLength },
        uContactShadowThickness: { value: state.contactShadowThickness },
        uSsaoIntensity: { value: state.ssaoIntensity },
        uVolumetricIntensity: { value: state.volumetricIntensity },
        uBloomStrength: { value: state.bloomStrength },
        uExposure: { value: state.exposure },
        uContrast: { value: state.contrast },
        uSaturation: { value: state.saturation },
        uChromaticAberration: { value: state.chromaticAberration },
        uFilmGrain: { value: state.filmGrain },
        uFilmSlope: { value: state.filmSlope },
        uFilmToe: { value: state.filmToe },
        uFilmShoulder: { value: state.filmShoulder },
        uFilmBlackClip: { value: state.filmBlackClip },
        uFilmWhiteClip: { value: state.filmWhiteClip },
        uVignette: { value: state.vignette },
        uDamage: { value: 0 },
        uLowHealth: { value: 0 },
        uFocus: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 0 },
        uTime: { value: 0 },
        uToneMapping: { value: state.toneMapping },
        uWriteLuma: { value: 0 },
        uHeightFogDensity: { value: state.heightFogDensity },
        uHeightFogColor: { value: state.heightFogColor },
        uHeightFogBase: { value: state.heightFogBase },
        uHeightFogFalloff: { value: state.heightFogFalloff },
        uCamWorldPos: { value: scratchCamWorld },
        uInvViewMat: { value: scratchInvView },
        tColorLut: { value: lutTexture ?? dummyWhiteLut },
        uLutIntensity: { value: state.lutIntensity },
        uLutSize: { value: state.lutSize },
        uLutSrgb: { value: state.lutSrgb ? 1.0 : 0.0 },
      }, { ...exposureDefines, ...giDepthDefines }),
      fxaaSharpen: makeShader(FXAA_SHARPEN_FRAGMENT_GLSL3, {
        tDiffuse: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
        uSharpness: { value: state.sharpness },
        uFxaaEnabled: { value: state.fxaa ? 1 : 0 },
      }),
      colorCopy: makeShader('precision highp float;\nin vec2 vUv;\nuniform sampler2D tInput;\nout vec4 fragColor;\nvoid main() {\n  fragColor = texture(tInput, vUv);\n}', {
        tInput: { value: null },
      }),
    };
    mats.worldLighting = makeShader(COMPOSITE_FRAGMENT_GLSL3, mats.composite.uniforms, {
      ...giDepthDefines,
      HGAME_WORLD_LIGHTING_ONLY: 1,
    });

    quadMesh = new THREE.Mesh(quadGeom, mats.composite);
    quadMesh.frustumCulled = false;
    postScene.add(quadMesh);
    syncTargets();
  }

  initMaterials();

  function renderReactiveMask(world, camera, worldWidth, worldHeight) {
    lastReactiveMeshCount = 0;
    if (!world || typeof world.traverse !== 'function' || !THREE.MeshBasicMaterial) {
      return null;
    }
    const nonReactive = [];
    let reactiveCount = 0;
    world.traverse(obj => {
      if (!obj?.isMesh || !obj.visible) return;
      if (obj.userData?.hgameReactive === true) {
        reactiveCount++;
      } else {
        nonReactive.push(obj);
      }
    });
    lastReactiveMeshCount = reactiveCount;
    if (reactiveCount === 0) return null;

    reactiveMaskRT = syncColorTarget(reactiveMaskRT, true, worldWidth, worldHeight, THREE.UnsignedByteType);
    if (!reactiveMaskMat) {
      reactiveMaskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: false });
    }
    const prevOverride = world.overrideMaterial;
    const prevAutoClear = renderer.autoClear;
    for (const m of nonReactive) m.visible = false;
    try {
      world.overrideMaterial = reactiveMaskMat;
      renderer.setRenderTarget(reactiveMaskRT);
      renderer.autoClear = true;
      renderer.clear?.(true, true, false);
      drawWithDiagnostics(renderer, activeDiagnostics?.beginPass, 'reactiveMask', reactiveMaskRT, world, camera);
    } finally {
      world.overrideMaterial = prevOverride;
      for (const m of nonReactive) m.visible = true;
      renderer.autoClear = prevAutoClear;
    }
    return reactiveMaskRT?.texture ?? null;
  }

  function runPass(contract, material, target, viewport = null) {
    validateFullscreenPass(contract, material.uniforms, target);
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    if (!target && viewport) {
      // Reapply the rectangle after target binding. Three rounds here, while its
      // default framebuffer bind floors DPR-scaled coordinates.
      renderer.setViewport?.(...viewport);
      renderer.setScissor?.(...viewport);
    }
    drawWithDiagnostics(renderer, activeDiagnostics?.beginPass, contract.name, target, postScene, postCamera);
  }

  let lastRenderGraphPlan = null;
  let lastRenderGraphOptions = null;

  function buildFrameRenderGraphPlan({
    useAo = false,
    useVolumetric = false,
    useGiSsr = false,
    useTemporalAA = false,
    hasViewModel = false,
    stages = customStages,
    useAutoExposure = false,
    bloomPasses = [],
    useFinalFxaaPass = false,
    width = bufferWidth,
    height = bufferHeight,
  } = {}) {
    const passes = [];
    const worldColor = 'sceneColor';
    let currentColor = worldColor;

    if (useAo || useVolumetric) {
      passes.push(
        { id: 'ao-volumetrics', reads: ['sceneDepth'], optionalReads: ['sunShadow'], writes: ['aoRaw'], transientSpecs: { aoRaw: { width: 'half', height: 'half', format: 'rg16f' } } },
        { id: 'ao-volumetrics-blur-x', reads: ['aoRaw'], writes: ['aoBlurX'], transientSpecs: { aoBlurX: { width: 'half', height: 'half', format: 'rg16f' } } },
        { id: 'ao-volumetrics-blur-y', reads: ['aoBlurX'], writes: ['aoVol'], transientSpecs: { aoVol: { width: 'half', height: 'half', format: 'rg16f' } } },
      );
    }
    if (useGiSsr) {
      passes.push(
        { id: 'gi-ssr', reads: [currentColor, 'sceneDepth'], writes: ['giSsrRaw'], transientSpecs: { giSsrRaw: { width: 'half', height: 'half', format: 'rgba16f' } } },
        { id: 'gi-ssr-blur-x', reads: ['giSsrRaw'], writes: ['giSsrBlurX'], transientSpecs: { giSsrBlurX: { width: 'half', height: 'half', format: 'rgba16f' } } },
        { id: 'gi-ssr-blur-y', reads: ['giSsrBlurX'], optionalReads: ['sceneDepth', 'prevGiHistory'], writes: ['giSsr'], transientSpecs: { giSsr: { width: 'half', height: 'half', format: 'rgba16f' } } },
      );
    }
    if (useTemporalAA) {
      passes.push({
        id: 'temporal-aa',
        reads: [currentColor, 'sceneDepth'],
        optionalReads: ['prevTemporalColor', 'prevTemporalDepth', 'motionVectors'],
        writes: ['taaColor'],
        transientSpecs: { taaColor: { width, height, format: 'rgba16f' } },
      });
      currentColor = 'taaColor';
    }
    if (hasViewModel && (useAo || useVolumetric || useGiSsr)) {
      passes.push({
        id: 'world-lighting',
        reads: [currentColor],
        optionalReads: ['sceneDepth', ...(useAo || useVolumetric ? ['aoVol'] : []), ...(useGiSsr ? ['giSsr'] : [])],
        writes: ['litWorldColor'],
        transientSpecs: { litWorldColor: { width, height, format: 'rgba16f', depthBuffer: true } },
      });
      currentColor = 'litWorldColor';
    }
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const outName = `customColor:${stage.pass.id}`;
      const reads = [currentColor];
      if (stage.pass.inputs.depth) reads.push('sceneDepth');
      passes.push({
        id: stage.contract.name,
        reads,
        writes: [outName],
        transientSpecs: { [outName]: { width, height, format: 'rgba16f' } },
      });
      currentColor = outName;
    }
    if (useAutoExposure) {
      passes.push(
        { id: 'luminance', reads: [currentColor], writes: ['lumaMip'], transientSpecs: { lumaMip: { width: 'pyramid', height: 'pyramid', format: 'r16f' } } },
        { id: 'eye-adaptation', reads: ['lumaMip', 'prevAdapt'], writes: ['adaptedExposure'], transientSpecs: { adaptedExposure: { width: 1, height: 1, format: 'r16f' } } },
      );
    }
    if (bloomPasses.length) {
      passes.push({ ...bloomPasses[0], reads: [currentColor] }, ...bloomPasses.slice(1));
    }
    const toneOptional = ['sceneDepth'];
    if (useAo || useVolumetric) toneOptional.push('aoVol');
    if (useGiSsr) toneOptional.push('giSsr');
    if (bloomPasses.length) toneOptional.push('bloomColor');
    if (useAutoExposure) toneOptional.push('adaptedExposure');
    passes.push({
      id: 'tone-mapping',
      reads: [currentColor],
      optionalReads: toneOptional,
      writes: [useFinalFxaaPass ? 'ldrColor' : 'backbuffer'],
      transientSpecs: useFinalFxaaPass ? { ldrColor: { width, height, format: 'rgba8' } } : {},
    });
    if (useFinalFxaaPass) {
      passes.push({
        id: 'fxaa-sharpen',
        reads: ['ldrColor'],
        writes: ['backbuffer'],
      });
    }
    return compileRenderGraph(passes, {
      externalInputs: ['sceneColor', 'sceneDepth', 'sunShadow', 'prevAdapt', 'prevGiHistory', 'prevTemporalColor', 'prevTemporalDepth', 'motionVectors'],
      externalOutputs: ['backbuffer'],
      pruneDeadPasses: true,
    });
  }

  function setPasses(passes) {
    if (disposed || passes === customPasses) return;
    customPasses = normalizeHdrPasses(passes);
    customStages = compileHdrPasses(customPasses);
    const count = customPasses.filter(pass => pass.enabled && (!pass.inputs.depth || sceneRT?.depthTexture)).length;
    hdrTargets.trimColor(Math.min(2, Math.max(count, Number(state.temporalAA))));
    lastRenderGraphPlan = null;
    lastRenderGraphOptions = null;
  }

  function runCustomPasses(stages, color, depth, cameraFar) {
    if (!stages.length) return color;
    let currentColor = color;
    let currentTarget = null;
    const graphPasses = stages.map(({ pass, contract }, index) => {
      const inputRes = index === 0 ? 'sceneColor' : `customOut:${index - 1}`;
      const outputRes = `customOut:${index}`;
      return {
        id: contract.name,
        reads: pass.inputs.depth ? [inputRes, 'sceneDepth'] : [inputRes],
        writes: [outputRes],
        transientSpecs: { [outputRes]: { width: bufferWidth, height: bufferHeight, format: 'rgba16f' } },
        meta: { uniforms: pass.material.uniforms },
        execute({ outputs }) {
          const uniforms = pass.material.uniforms;
          const depthView = pass.inputs.depthView;
          const colorUniform = uniforms[pass.inputs.color];
          const depthUniform = pass.inputs.depth ? uniforms[pass.inputs.depth] : null;
          const inverseProjection = depthView ? uniforms[depthView.inverseProjection] : null;
          const clipDepthMode = depthView ? uniforms[depthView.clipDepthMode] : null;
          const far = depthView ? uniforms[depthView.far] : null;
          const previousColor = colorUniform.value;
          const previousDepth = depthUniform?.value;
          const previousProjection = inverseProjection?.value;
          const previousMode = clipDepthMode?.value;
          const previousFar = far?.value;
          const target = outputs[outputRes];
          colorUniform.value = currentColor;
          if (depthUniform) depthUniform.value = depth;
          if (depthView) {
            customInverseProjection ??= new THREE.Matrix4();
            inverseProjection.value = customInverseProjection.copy(sceneProjectionUniforms.uInvProj.value);
            clipDepthMode.value = sceneProjectionUniforms.uSceneDepthMode.value;
            far.value = cameraFar;
          }
          try {
            runPass(contract, pass.material, target);
            currentTarget = target;
            currentColor = target.texture;
          } finally {
            colorUniform.value = previousColor;
            if (depthUniform) depthUniform.value = previousDepth;
            if (depthView) {
              inverseProjection.value = previousProjection;
              clipDepthMode.value = previousMode;
              far.value = previousFar;
            }
          }
        },
      };
    });
    const customGraph = compileRenderGraph(graphPasses, {
      externalInputs: ['sceneColor', 'sceneDepth'],
    });
    executeRenderGraph(customGraph, {
      acquire: (_spec, _res, _slot, pass) => hdrTargets.acquire(bufferWidth, bufferHeight, false, pass?.meta?.uniforms),
      release: target => {
        if (target !== currentTarget) hdrTargets.release(target);
      },
    }, { externalTargets: { sceneColor: color, sceneDepth: depth } });
    return currentColor;
  }

  function setBufferDimensions(w, h) {
    requestedWidth = Math.max(1, Math.floor(w));
    requestedHeight = Math.max(1, Math.floor(h));
    const next = fitDrawingBuffer(requestedWidth, requestedHeight, 1, targetLimits);
    const changed = next.bufferWidth !== bufferWidth || next.bufferHeight !== bufferHeight;
    if (changed) {
      resetGiSsrHistory();
      temporalAa?.release();
      hdrTargets.dispose();
      transientPool?.dispose();
      sceneRT = null;
      sceneTargetSpec = null;
    }
    bufferWidth = next.bufferWidth;
    bufferHeight = next.bufferHeight;
    return changed;
  }

  function resize(w, h) {
    if (disposed) return;
    if (setBufferDimensions(w, h) || !sceneRT) syncTargets();
  }

  function setPreset(nextPreset, buffer) {
    if (disposed || !nextPreset) return;
    if (buffer) {
      if (!Number.isFinite(buffer.width) || buffer.width < 1 || !Number.isFinite(buffer.height) || buffer.height < 1) {
        throw new RangeError('Invalid post-processing buffer size');
      }
      setBufferDimensions(buffer.width, buffer.height);
    }
    resetTemporalHistory();
    activePreset = { ...QUALITY3D_PRESETS.medium, ...nextPreset };
    if (!explicitFxaa && 'fxaa' in activePreset) {
      state.fxaa = Boolean(activePreset.fxaa);
    }
    if (!explicitSharpness && Number.isFinite(activePreset.sharpen)) {
      state.sharpness = activePreset.sharpen;
    }
    if (!explicitContactShadows && 'contactShadows' in activePreset) {
      state.contactShadows = activePreset.contactShadows ? 0.65 : 0;
    }
    syncTargets();
  }

  function setState(patch = {}) {
    if (disposed || !patch || typeof patch !== 'object') return;
    if ('fxaa' in patch) state.fxaa = Boolean(patch.fxaa);
    if ('autoExposure' in patch) state.autoExposure = Boolean(patch.autoExposure);
    if ('temporalGiSsr' in patch) state.temporalGiSsr = Boolean(patch.temporalGiSsr);
    if ('temporalMotion' in patch && Boolean(patch.temporalMotion) !== state.temporalMotion) {
      state.temporalMotion = Boolean(patch.temporalMotion);
      temporalAa?.release();
    }
    const prevTemporalAA = state.temporalAA;
    const prevTemporalUpsampling = state.temporalUpsampling;
    const prevRenderScale = state.renderScale;
    if ('temporalAA' in patch) {
      state.temporalAA = Boolean(patch.temporalAA);
      if (!state.temporalAA && temporalAa?.targets.length) temporalAa.release();
    }
    if ('temporalUpsampling' in patch) {
      state.temporalUpsampling = Boolean(patch.temporalUpsampling);
    }
    if ('renderScale' in patch && Number.isFinite(patch.renderScale)) {
      state.renderScale = Math.min(1, Math.max(0.25, patch.renderScale));
    }
    if (state.temporalAA !== prevTemporalAA || state.temporalUpsampling !== prevTemporalUpsampling ||
        state.renderScale !== prevRenderScale) {
      if (supported && !disposed && !contextLost) syncSceneTarget();
      resetTemporalHistory();
    }
    if (giHistoryRT && GI_HISTORY_SETTINGS.some(key => Number.isFinite(patch[key]) && patch[key] !== state[key])) {
      resetGiSsrHistory();
    }
    if ('toneMapping' in patch) {
      state.toneMapping = resolveToneMappingIndex(patch.toneMapping);
    }
    if (patch.sunColor !== undefined && state.sunColor?.set) state.sunColor.set(patch.sunColor);

    if (Array.isArray(patch.colorLift) && patch.colorLift.length >= 3) {
      state.colorLift[0] = patch.colorLift[0];
      state.colorLift[1] = patch.colorLift[1];
      state.colorLift[2] = patch.colorLift[2];
      state.liftVec?.set(state.colorLift[0], state.colorLift[1], state.colorLift[2]);
    }
    if (Array.isArray(patch.colorGamma) && patch.colorGamma.length >= 3) {
      state.colorGamma[0] = patch.colorGamma[0];
      state.colorGamma[1] = patch.colorGamma[1];
      state.colorGamma[2] = patch.colorGamma[2];
      state.gammaVec?.set(state.colorGamma[0], state.colorGamma[1], state.colorGamma[2]);
    }
    if (Array.isArray(patch.colorGain) && patch.colorGain.length >= 3) {
      state.colorGain[0] = patch.colorGain[0];
      state.colorGain[1] = patch.colorGain[1];
      state.colorGain[2] = patch.colorGain[2];
      state.gainVec?.set(state.colorGain[0], state.colorGain[1], state.colorGain[2]);
    }

    const previousWhiteTemp = state.whiteTemp;
    const previousWhiteTint = state.whiteTint;
    for (const key of POST_STATE_SCALAR_KEYS) {
      if (Number.isFinite(patch[key])) state[key] = patch[key];
    }

    if (state.whiteTemp !== previousWhiteTemp || state.whiteTint !== previousWhiteTint) {
      computeWhiteBalanceRGB(state.whiteTemp, state.whiteTint, whiteBalanceRgb);
      state.whiteBalanceVec?.set(whiteBalanceRgb[0], whiteBalanceRgb[1], whiteBalanceRgb[2]);
    }
    if ('heightFog' in patch) applyHeightFogConfig(patch.heightFog);
    if ('colorLut' in patch) applyColorLutConfig(patch.colorLut);

    syncOptionalTargets();
  }

  function resetGiSsrHistory() {
    giHistoryWorld = null;
    giHistoryCamera = null;
    giHistoryDepthMode = -1;
    if (mats?.blurGiHistory) {
      const uniforms = mats.blurGiHistory.uniforms;
      uniforms.tHistory.value = null;
      uniforms.tSceneDepth.value = null;
      uniforms.tInput.value = null;
    }
  }

  function resetTemporalHistory() {
    resetGiSsrHistory();
    temporalAa?.reset();
  }

  function createWorldTemporalAA() {
    return createTemporalAA(THREE,
      (width, height) => makeColorTarget(width, height, { type: hdrType, depthTexture: makeDepthTexture(width, height) }),
      uniforms => new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_GLSL3,
        fragmentShader: TEMPORAL_AA_FRAGMENT_GLSL3,
        uniforms,
        depthTest: true,
        depthWrite: true,
        depthFunc: THREE.AlwaysDepth,
      }), usesByteColorTargets || !THREE.DataTexture || !THREE.Material || !THREE.Color ? null : () =>
        createTemporalMotion(THREE, renderer,
          (width, height) => makeColorTarget(width, height, { type: hdrType }),
          (name, target, scene, camera) => drawWithDiagnostics(renderer, activeDiagnostics?.beginPass, name, target, scene, camera),
          capabilities.maxTextureSize));
  }


  function finishGiSsrBlur(world, camera, stepDt, useSsr, sceneDepth, blurXTarget, giSsrOutTarget) {
    const depthMode = sceneProjectionUniforms.uSceneDepthMode.value;
    let material = mats.blurRgba;
    if (giHistoryRT && giHistoryWorld === world && giHistoryCamera === camera &&
        giHistoryDepthMode === depthMode && stepDt <= 0.125) {
      scratchViewToWorld.copy(camera.matrixWorldInverse).invert();
      const uniforms = mats.blurGiHistory.uniforms;
      const transform = uniforms.uPreviousFromCurrentView.value;
      transform.multiplyMatrices(giHistoryView, scratchViewToWorld);
      const e = transform.elements;
      if (e[10] > 0.82 && e[12] ** 2 + e[13] ** 2 + e[14] ** 2 < 16) {
        uniforms.tSceneDepth.value = sceneDepth;
        uniforms.tHistory.value = giHistoryRT.texture;
        uniforms.uPreviousGuideOffset.value = giHistoryGuideOffset;
        const frameWeight = useSsr ? 0.55 : 0.78;
        uniforms.uHistoryWeight.value = Math.pow(frameWeight, Math.max(1, stepDt * 60));
        material = mats.blurGiHistory;
      }
    }
    material.uniforms.tInput.value = (blurXTarget ?? halfScratchRT).texture;
    material.uniforms.uAxis.value.set(0, 1);
    const outTarget = giSsrOutTarget ?? giSsrRT;
    runPass(material === mats.blurGiHistory ? FULLSCREEN_PASSES.giSsrTemporal : FULLSCREEN_PASSES.giSsrBlurY, material, outTarget);

    const texture = outTarget.texture;
    if (giHistoryRT) {
      if (outTarget !== giSsrRT) {
        mats.colorCopy.uniforms.tInput.value = texture;
        runPass({ name: 'gi-ssr-history-copy', reads: ['tInput'], writes: 'color' }, mats.colorCopy, giHistoryRT);
      } else {
        const previous = giHistoryRT;
        giHistoryRT = giSsrRT;
        giSsrRT = previous;
      }
      giHistoryView.copy(camera.matrixWorldInverse);
      giHistoryProjection.copy(sceneProjectionUniforms.uProj.value);
      giHistoryGuideOffset = sceneProjectionUniforms.uSceneDepthGuideOffset.value;
      giHistoryDepthMode = depthMode;
      giHistoryWorld = world;
      giHistoryCamera = camera;
    }
    return texture;
  }

  function renderForwardWithViewmodel(world, camera, viewScene, viewCamera, diagnostics) {
    const prevAutoClear = renderer.autoClear;
    const gl = renderer.getContext?.();
    try {
      drawWithDiagnostics(renderer, diagnostics?.beginPass, 'forward', null, world, camera);
      if (viewScene && viewCamera) {
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        drawWithDiagnostics(renderer, diagnostics?.beginPass, 'viewmodel', null, viewScene, viewCamera);
      }
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.autoClear = prevAutoClear;
    }
  }

  function reportTargets(sink) {
    if (!sink) return;
    for (const target of [halfRT, aoBlurRT, halfScratchRT, giSsrRT,
      giHistoryRT, ldrRT, ...(temporalAa?.targets ?? []), temporalAa?.motionTarget]) {
      if (target) sink.recordTarget(target);
    }
    for (const target of lumaMips) sink.recordTarget(target, true);
    for (const target of adaptRT) sink.recordTarget(target, true);
    hdrTargets.record(sink);
    if (transientPool) for (const target of transientPool.getTargets()) sink.recordTarget(target);
  }

  function estimateTargetBytes() {
    let scalableBytes = 0;
    let fixedBytes = 0;
    reportTargets({ recordTarget(target, fixed = false) {
      const bytes = estimateRenderTargetBytes(THREE, target);
      if (fixed) fixedBytes += bytes;
      else scalableBytes += bytes;
    } });
    return { scalableBytes, fixedBytes };
  }

  function getRenderTargets() {
    const targets = new Set();
    reportTargets({ recordTarget: target => targets.add(target) });
    return [...targets];
  }

  function compositeWorldIntoViewTarget(compU, target) {
    runPass(FULLSCREEN_PASSES.worldLighting, mats.worldLighting, target);
    compU.tScene.value = target.texture;
    compU.uUseAo.value = 0;
    compU.uUseVolumetric.value = 0;
    compU.uUseGiSsr.value = 0;
    compU.uContactShadows.value = 0;
  }

  /**
   * Render one frame through the unified RenderGraph DAG.
   * @param {object} world
   * @param {object} camera
   * @param {{ viewScene?: object | null, viewCamera?: object | null, sunLight?: object | null, irradianceGrid?: object | null, dt?: number, outputViewport?: object | null, diagnostics?: object | null, reactiveMask?: object | null, extraPasses?: { before?: Array<{ id: string, reads?: string[], writes?: string[], execute: Function }>, afterWorld?: Array<{ id: string, reads?: string[], writes?: string[], execute: Function }> } | null, projectedDecals?: Array<{ renderProjected: Function }> | null }} [options]
   */
  function render(world, camera, { viewScene = null, viewCamera = null, sunLight = null, irradianceGrid = null, dt = 0, outputViewport = null,
    diagnostics = null, reactiveMask = null, extraPasses = null, projectedDecals = null } = {}) {
    if (disposed || contextLost) return;
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (stepDt > 0) elapsed += stepDt;
    if (!supported || !sceneRT) {
      if (extraPasses) {
        const forwardPasses = [];
        let fwdPrev = null;
        for (const pass of extraPasses.before ?? []) {
          const outTok = `_fwd_${forwardPasses.length}`;
          forwardPasses.push({
            id: pass.id,
            reads: fwdPrev ? [fwdPrev] : [],
            writes: [outTok, ...(pass.writes ?? [])],
            sideEffect: true,
            execute: (ctx) => pass.execute?.(ctx),
          });
          fwdPrev = outTok;
        }
        forwardPasses.push({
          id: 'forward',
          reads: fwdPrev ? [fwdPrev] : [],
          writes: ['backbuffer'],
          sideEffect: true,
          execute: () => renderForwardWithViewmodel(world, camera, viewScene, viewCamera, diagnostics),
        });
        const fwdGraph = getCompiledFrameGraph(forwardPasses);
        const fwdRes = executeRenderGraph(fwdGraph, { acquire: (_s, res) => ({ token: res }), release() {} }, {
          state: { sceneRT: null, bufferWidth, bufferHeight },
          executors: new Map(forwardPasses.map(pass => [pass.id.trim(), pass.execute])),
        });
        lastExecutedGraph = fwdRes.executed.slice();
        lastFrameGraph = Object.freeze({
          compiledOrder: fwdGraph.order,
          culled: fwdGraph.culledPasses,
          executed: fwdRes.executed,
          lifetimes: fwdGraph.lifetimes,
          peakTargets: fwdGraph.peakTargets,
          reusedCount: fwdRes.reusedCount,
        });
      } else {
        renderForwardWithViewmodel(world, camera, viewScene, viewCamera, diagnostics);
      }
      return;
    }
    const gl = renderer.getContext?.();
    const prevAutoClear = renderer.autoClear;
    const prevToneMapping = renderer.toneMapping;
    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    const frameSceneSpec = sceneTargetSpec;
    const { upsampling } = getWorldRenderDimensions();
    const worldWidth = frameSceneSpec.width;
    const worldHeight = frameSceneSpec.height;
    const readSceneDepth = frameSceneSpec.depthTexture;
    const useProjectedDecals = Boolean(readSceneDepth && projectedDecals?.length);
    const worldColorReads = useProjectedDecals ? ['sceneTarget', 'decalColor'] : ['sceneTarget'];
    const hasSun = Boolean(sunLight?.position && sunLight.visible !== false);
    const useAo = Boolean(readSceneDepth && activePreset.ssao && state.ssaoIntensity > 0);
    const useSsgi = readSceneDepth && ssgiEnabled();
    const useSsr = readSceneDepth && ssrEnabled();
    const wantsGiSsr = Boolean(useSsgi || useSsr);
    const wantsContact = readSceneDepth && hasSun && state.contactShadows > 0.001;
    const volSteps = activePreset.volumetricSteps ?? 0;
    const shadow = sunLight?.shadow;
    const wantsVolumetric = Boolean(readSceneDepth && hasSun && volSteps > 0.5 &&
      state.volumetricIntensity !== 0 && sunLight.castShadow !== false &&
      renderer.shadowMap?.enabled !== false && shadow?.matrix);
    const activePasses = customStages.length
      ? customStages.filter(({ pass }) => pass.enabled && (!pass.inputs.depth || readSceneDepth)) : customStages;
    const customDepth = activePasses.some(({ pass }) => pass.inputs.depth);
    const useTemporal = Boolean(state.temporalAA && readSceneDepth && renderer.xr?.isPresenting !== true &&
      !renderer.capabilities?.reversedDepthBuffer && !camera.reversedDepth && !camera.isArrayCamera);
    let temporalFrame = useTemporal;
    const needsProjection = useAo || wantsGiSsr || wantsContact || wantsVolumetric || useTemporal ||
      (readSceneDepth && state.heightFogDensity > 0.0001) ||
      activePasses.some(({ pass }) => pass.inputs.depthView);
    const postWorldDepth = Array.isArray(extraPasses?.afterWorld) &&
      extraPasses.afterWorld.some(pass => pass.reads?.includes('sceneDepth'));
    const needsDepth = needsProjection || customDepth || useProjectedDecals || (readSceneDepth && postWorldDepth);
    if (useTemporal) temporalAa ??= createWorldTemporalAA();
    else if (temporalAa?.targets.length) temporalAa.release();

    const hasViewModel = Boolean(viewScene && viewCamera && (
      viewScene.children?.length !== 0 || viewScene.background
      || viewScene.onBeforeRender !== THREE.Scene.prototype.onBeforeRender
      || viewScene.onAfterRender !== THREE.Scene.prototype.onAfterRender
    ));
    const aoActive = Boolean(useAo || wantsVolumetric);
    const useGiSsr = wantsGiSsr;
    const useAutoExposure = Boolean(state.autoExposure && lumaMips.length > 0 && adaptRT.length === 2);
    const bloomPasses = state.bloomStrength !== 0 ? bloomStages : [];
    const useBloom = bloomPasses.length > 0;
    const plannedFxaa = state.fxaa && (!useTemporal || hasViewModel);
    const plannedFinalFxaaPass = Boolean(plannedFxaa || state.sharpness > 0.001);

    const previousDiagnostics = activeDiagnostics;
    let worldCameraFar;
    let visibleGrid = null;
    let hasSunDir = false;
    let depthTexture = null;
    let sunShadowTex = null;
    let shadowMatrix = null;
    let useVolumetric = false;
    let useContactShadows = false;
    let giSsrTexture = null;
    let compU = mats.composite.uniforms;
    let worldLightingEnabled = false;
    let separateViewModel = false;
    let prelightTemporal = false;
    let viewCompositeRT = null;

    activeDiagnostics = diagnostics;
    hdrTargets.beginFrame();
    try {
      const framePasses = [];
      let prevToken = null;
      let tokSeq = 0;
      const addStage = (id, execute, extra = {}) => {
        const outTok = `_stage_${tokSeq++}`;
        const reads = prevToken ? [prevToken, ...(extra.reads ?? [])] : (extra.reads ?? []);
        const writes = [outTok, ...(extra.writes ?? [])];
        framePasses.push({
          id,
          reads,
          writes,
          ...(extra.transientSpecs ? { transientSpecs: extra.transientSpecs } : {}),
          sideEffect: true,
          execute,
        });
        prevToken = outTok;
      };

      if (Array.isArray(extraPasses?.before)) {
        for (const p of extraPasses.before) {
          addStage(p.id, ctx => p.execute?.(ctx), { writes: p.writes ?? [] });
        }
      }

      addStage('world', ({ outputs, state: frameState }) => {
        const target = outputs.sceneTarget;
        frameState.sceneRT = target;
        if (sceneTargetSpec === frameSceneSpec) sceneRT = target;
        transientPool.beginFrame();
        renderedSceneTargets.add(target);
        // Retain the attachments for volume changes. Only resolve/store depth if this frame reads it.
        target.resolveDepthBuffer = needsDepth;
        target.storeMultisampledDepthBuffer = needsDepth;
        renderer.setRenderTarget(target);
        renderer.autoClear = true;
        // Three clears both attachments during ordinary scene rendering. XR and
        // renderers with different clear settings still need an explicit clear.
        if (renderer.xr?.isPresenting !== false || renderer.autoClearColor !== true || renderer.autoClearDepth !== true) {
          renderer.clear(true, true, false);
        }
        if (useTemporal) temporalAa.jitter(camera, worldWidth, worldHeight, bufferWidth, bufferHeight);
        try {
          drawWithDiagnostics(renderer, diagnostics?.beginPass, 'world', target, world, camera);
          if (needsProjection) {
            syncCameraWorldMatrices(camera);
            sceneProjectionUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
            sceneProjectionUniforms.uProj.value.copy(camera.projectionMatrix);
            sceneProjectionUniforms.uSceneDepthMode.value = camera.reversedDepth ? 2 : Number(usesZeroToOneDepth(camera));
            worldCameraFar = camera.far;
            // Orthographic views can include geometry behind the camera origin.
            sceneProjectionUniforms.uSceneDepthGuideOffset.value = camera.isOrthographicCamera
              ? Math.max(0, -(camera.near ?? 0)) : 0;
          }
        } finally {
          if (useTemporal) temporalFrame = temporalAa.restore(camera);
        }
      }, {
        writes: ['sceneTarget'],
        transientSpecs: { sceneTarget: frameSceneSpec },
      });

      if (Array.isArray(extraPasses?.afterWorld)) {
        for (const p of extraPasses.afterWorld) {
          addStage(p.id, ctx => p.execute?.(ctx), { reads: ['sceneTarget'], writes: p.writes ?? [] });
        }
      }

      if (useProjectedDecals) {
        addStage('projected-decals', ({ inputs, outputs }) => {
          const target = outputs.decalColor;
          const { texture, depthTexture } = inputs.sceneTarget;
          // Copy into a color-only target so the decal draw can sample scene depth without framebuffer feedback.
          mats.colorCopy.uniforms.tInput.value = texture;
          runPass(FULLSCREEN_PASSES.projectedDecalsCopy, mats.colorCopy, target);

          // The world draw has already restored the camera. Match the matrices that produced its depth.
          if (temporalFrame) {
            decalRestoreProjection ??= new THREE.Matrix4();
            decalRestoreInverse ??= new THREE.Matrix4();
            decalRestoreProjection.copy(camera.projectionMatrix);
            decalRestoreInverse.copy(camera.projectionMatrixInverse);
            camera.projectionMatrix.copy(sceneProjectionUniforms.uProj.value);
            camera.projectionMatrixInverse.copy(sceneProjectionUniforms.uInvProj.value);
          }
          try {
            for (const system of projectedDecals) {
              system.renderProjected(renderer, camera, depthTexture, worldWidth, worldHeight, target);
            }
          } finally {
            if (temporalFrame) {
              if (camera.projectionMatrix.equals(sceneProjectionUniforms.uProj.value) &&
                  camera.projectionMatrixInverse.equals(sceneProjectionUniforms.uInvProj.value)) {
                camera.projectionMatrix.copy(decalRestoreProjection);
                camera.projectionMatrixInverse.copy(decalRestoreInverse);
              } else {
                // Keep projection updates made by render callbacks, as in the world draw.
                resetTemporalHistory();
                temporalFrame = false;
              }
            }
          }
        }, {
          reads: ['sceneTarget'],
          writes: ['decalColor'],
          transientSpecs: {
            decalColor: { width: worldWidth, height: worldHeight, type: hdrType, format: THREE.RGBAFormat },
          },
        });
      }

      addStage('scene-setup', () => {
        visibleGrid = getVisibleBakedProbeGrid(irradianceGrid, world, camera);
        if (visibleGrid !== lastIrradianceGrid) {
          resetTemporalHistory();
          lastIrradianceGrid = visibleGrid;
        }
        hasSunDir = false;
        if (wantsContact || wantsVolumetric) {
          readWorldPosition(sunLight, scratchSunView).sub(readWorldPosition(sunLight.target, scratchSunTarget));
          const lengthSq = scratchSunView.lengthSq();
          hasSunDir = Number.isFinite(lengthSq) && lengthSq > 0;
          if (hasSunDir) scratchSunView.transformDirection(camera.matrixWorldInverse);
          if (sunLight.color && state.sunColor) state.sunColor.copy(sunLight.color);
        }

        // 1. Half-res SSAO + Volumetric sun shafts + separable bilateral blur
        depthTexture = shadow?.map?.depthTexture;
        sunShadowTex = depthTexture ?? shadow?.map?.texture;
        shadowMatrix = shadow?.matrix;
        // Three can allocate the sun's shadow texture during the world draw.
        useVolumetric = Boolean(wantsVolumetric && hasSunDir && sunShadowTex && shadowMatrix);
        useContactShadows = wantsContact && hasSunDir;
        renderer.autoClear = false;
        if (!useGiSsr && giHistoryRT) {
          resetGiSsrHistory();
        }
      });

      if (aoActive) {
        const aoSpec = { width: hw, height: hh, type: THREE.UnsignedByteType, format: THREE.RGBAFormat };
        addStage('ao-volumetrics', ({ inputs, outputs }) => {
          if (useAo || useVolumetric) {
            const aoMaterial = useVolumetric && depthTexture?.compareFunction != null ? mats.aoVolCompare : mats.aoVol;
            const ao = aoMaterial.uniforms;
            ao.tDepth.value = inputs.sceneTarget.depthTexture;
            ao.uResolution.value.set(hw, hh);
            ao.uSsaoEnabled.value = useAo ? 1 : 0;
            ao.uSsaoRadius.value = state.ssaoRadius;
            ao.uSsaoBias.value = state.ssaoBias;
            ao.uVolumetricSteps.value = useVolumetric ? volSteps : 0;
            ao.uTime.value = elapsed;
            ao.tSunShadow.value = useVolumetric ? sunShadowTex : null;
            ao.uShadowDepthSign.value = shadow?.camera?.reversedDepth ? -1 : 1;
            if (useVolumetric) {
              scratchViewToWorld.copy(camera.matrixWorldInverse).invert();
              scratchCamToShadow.multiplyMatrices(shadowMatrix, scratchViewToWorld);
            }
            runPass(FULLSCREEN_PASSES.aoVolumetrics, aoMaterial, outputs.aoRaw);
          }
        }, {
          reads: ['sceneTarget'],
          writes: ['aoRaw'],
          transientSpecs: { aoRaw: aoSpec },
        });
        addStage('ao-blur-x', ({ inputs, outputs }) => {
          if (useAo || useVolumetric) {
            mats.blur.uniforms.tInput.value = inputs.aoRaw.texture;
            mats.blur.uniforms.uAxis.value.set(1, 0);
            runPass(FULLSCREEN_PASSES.aoBlurX, mats.blur, outputs.aoBlurX);
          }
        }, {
          reads: ['aoRaw'],
          writes: ['aoBlurX'],
          transientSpecs: { aoBlurX: aoSpec },
        });
        addStage('ao-blur-y', ({ inputs, outputs }) => {
          if (useAo || useVolumetric) {
            mats.blur.uniforms.tInput.value = inputs.aoBlurX.texture;
            mats.blur.uniforms.uAxis.value.set(0, 1);
            runPass(FULLSCREEN_PASSES.aoBlurY, mats.blur, outputs.aoVol);
          }
        }, {
          reads: ['aoBlurX'],
          writes: ['aoVol'],
          transientSpecs: { aoVol: aoSpec },
        });
      }

      if (useGiSsr) {
        const giSpec = { width: hw, height: hh, type: hdrType, format: THREE.RGBAFormat };
        addStage('gi-ssr', ({ inputs, outputs }) => {
          const giU = mats.giSsr.uniforms;
          giU.tScene.value = (inputs.decalColor ?? inputs.sceneTarget).texture;
          giU.tDepth.value = inputs.sceneTarget.depthTexture;
          giU.uResolution.value.set(hw, hh);
          giU.uSsgiEnabled.value = useSsgi ? 1 : 0;
          giU.uSsrEnabled.value = useSsr ? 1 : 0;
          giU.uGiRadius.value = state.giRadius;
          giU.uGiIntensity.value = state.giIntensity;
          giU.uIrradianceWeight.value = useSsgi ? visibleGrid?.diffuseWeight ?? 0 : 0;
          if (giU.uIrradianceWeight.value > 0) {
            const { min, max } = visibleGrid.boundingBox;
            giU.uIrradianceGridMin.value.copy(min);
            giU.uIrradianceGridMax.value.copy(max);
            giU.uIrradianceGridResolution.value.copy(visibleGrid.resolution);
            giU.uIrradianceViewToWorld.value.copy(camera.matrixWorldInverse).invert();
          }
          giU.uSsrIntensity.value = state.ssrIntensity;
          giU.uSsrMaxDist.value = state.ssrMaxDist;
          giU.uSsrThickness.value = state.ssrThickness;
          giU.uTime.value = elapsed;
          runPass(FULLSCREEN_PASSES.giSsr, mats.giSsr, outputs.giSsrRaw);
        }, {
          reads: worldColorReads,
          writes: ['giSsrRaw'],
          transientSpecs: { giSsrRaw: giSpec },
        });
        addStage('gi-ssr-blur-x', ({ inputs, outputs }) => {
          mats.blurRgba.uniforms.tInput.value = inputs.giSsrRaw.texture;
          mats.blurRgba.uniforms.uAxis.value.set(1, 0);
          runPass(FULLSCREEN_PASSES.giSsrBlurX, mats.blurRgba, outputs.giSsrBlurX);
        }, {
          reads: ['giSsrRaw'],
          writes: ['giSsrBlurX'],
          transientSpecs: { giSsrBlurX: giSpec },
        });
        addStage('gi-ssr-blur-y', ({ inputs, outputs }) => {
          giSsrTexture = finishGiSsrBlur(world, camera, stepDt, useSsr, inputs.sceneTarget.depthTexture, inputs.giSsrBlurX, outputs.giSsr);
        }, {
          reads: ['sceneTarget', 'giSsrBlurX'],
          writes: ['giSsr'],
          transientSpecs: { giSsr: giSpec },
        });
      }

      addStage('composite-setup', ({ inputs }) => {
        compU = mats.composite.uniforms;
        compU.tScene.value = (inputs.decalColor ?? inputs.sceneTarget).texture;
        compU.tDepth.value = needsDepth ? inputs.sceneTarget.depthTexture : null;
        compU.tAoVol.value = (useAo || useVolumetric) ? (inputs.aoVol?.texture ?? null) : null;
        compU.tGiSsr.value = useGiSsr ? (inputs.giSsr?.texture ?? giSsrTexture) : null;
        compU.uUseAo.value = useAo ? 1 : 0;
        compU.uUseVolumetric.value = useVolumetric ? 1 : 0;
        compU.uUseGiSsr.value = useGiSsr ? 1 : 0;
        compU.uHasSunDir.value = hasSunDir ? 1 : 0;
        compU.uContactShadows.value = useContactShadows ? state.contactShadows : 0;
        compU.uContactShadowLength.value = state.contactShadowLength;
        compU.uContactShadowThickness.value = state.contactShadowThickness;
        compU.uSsaoIntensity.value = state.ssaoIntensity;
        compU.uVolumetricIntensity.value = state.volumetricIntensity;
        compU.uTime.value = elapsed;

        worldLightingEnabled = useAo || useVolumetric || useGiSsr || useContactShadows;
        separateViewModel = hasViewModel && (inputs.sceneTarget.samples > 0 || worldLightingEnabled || customDepth || temporalFrame || useProjectedDecals);
        prelightTemporal = temporalFrame && worldLightingEnabled;
        // First-person drawing needs an unmultisampled depth attachment and retained HDR color.
        viewCompositeRT = separateViewModel ? hdrTargets.acquire(bufferWidth, bufferHeight, true) : null;
        if (!temporalFrame) lastReactiveMeshCount = 0;
      }, {
        reads: [
          ...worldColorReads,
          ...(aoActive ? ['aoVol'] : []),
          ...(useGiSsr ? ['giSsr'] : []),
        ],
      });

      if (useTemporal) {
        addStage('temporal-aa', ({ inputs }) => {
          if (temporalFrame) {
            const autoReactive = reactiveMask ? null : renderReactiveMask(world, camera, worldWidth, worldHeight);
            const prelightRT = prelightTemporal
              ? (upsampling ? hdrTargets.acquire(worldWidth, worldHeight, false) : viewCompositeRT ?? hdrTargets.acquire(bufferWidth, bufferHeight, false))
              : null;
            if (prelightRT) compositeWorldIntoViewTarget(compU, prelightRT);
            compU.tScene.value = temporalAa.resolve(world, camera, compU.tScene.value, inputs.sceneTarget.depthTexture,
              sceneProjectionUniforms.uSceneDepthMode.value, stepDt, runPass,
              state.temporalMotion && !renderer.clippingPlanes?.length, inputs.sceneTarget.samples > 0, reactiveMask ?? autoReactive);
            if (prelightRT && prelightRT !== viewCompositeRT) hdrTargets.release(prelightRT);
          } else {
            lastReactiveMeshCount = 0;
          }
        }, { reads: ['sceneTarget'] });
      }

      if (hasViewModel) {
        addStage('viewmodel', ({ inputs }) => {
          if (separateViewModel) {
            // Finish the world lighting before clearing depth for the first-person layer.
            compositeWorldIntoViewTarget(compU, viewCompositeRT);
          }
          if (typeof renderer.clearDepth === 'function') renderer.clearDepth();
          else renderer.clear?.(false, true, false);
          gl?.depthRange?.(0, 0.05);
          drawWithDiagnostics(renderer, diagnostics?.beginPass, 'viewmodel', separateViewModel ? viewCompositeRT : inputs.sceneTarget, viewScene, viewCamera);
          gl?.depthRange?.(0, 1);
        }, { reads: ['sceneTarget'] });
      }

      if (activePasses.length) {
        addStage('custom-passes', ({ inputs }) => {
          compU.tScene.value = runCustomPasses(activePasses, compU.tScene.value, inputs.sceneTarget.depthTexture, worldCameraFar);
        }, { reads: ['sceneTarget'] });
      }

      if (useAutoExposure) {
        addStage('auto-exposure', () => {
          mats.lumaExtract.uniforms.tScene.value = compU.tScene.value;
          runPass(FULLSCREEN_PASSES.luminance, mats.lumaExtract, lumaMips[0]);
          for (let i = 1; i < lumaMips.length; i++) {
            mats.lumaDown.uniforms.tSource.value = lumaMips[i - 1].texture;
            runPass(FULLSCREEN_PASSES.luminanceDown, mats.lumaDown, lumaMips[i]);
          }
          const prevAdapt = adaptRT[adaptIndex];
          const nextAdapt = adaptRT[adaptIndex ^ 1];
          const adaptU = mats.eyeAdapt.uniforms;
          adaptU.tLogLuma.value = lumaMips[lumaMips.length - 1].texture;
          adaptU.tPrevAdapt.value = prevAdapt.texture;
          adaptU.uDt.value = stepDt > 0 ? stepDt : 1 / 60;
          adaptU.uKeyValue.value = state.keyValue;
          adaptU.uExposureComp.value = state.exposureCompensation;
          adaptU.uMinExposure.value = state.minExposure;
          adaptU.uMaxExposure.value = state.maxExposure;
          adaptU.uAdaptSpeedUp.value = state.adaptSpeedUp;
          adaptU.uAdaptSpeedDown.value = state.adaptSpeedDown;
          adaptU.uResetAdapt.value = adaptNeedsReset ? 1 : 0;
          runPass(FULLSCREEN_PASSES.eyeAdaptation, mats.eyeAdapt, nextAdapt);
          // Keep the encoding range of the history texture across settings changes.
          if (usesByteColorTargets) adaptU.uStoredExposureRange.value.set(adaptU.uMinExposure.value, adaptU.uMaxExposure.value);
          adaptIndex ^= 1;
          adaptNeedsReset = false;
        }, { reads: ['sceneTarget'] });
      }

      for (const pass of bloomPasses) {
        const [lower, upper] = pass.reads;
        const [output] = pass.writes;
        addStage(pass.id, ({ inputs, outputs }) => {
          const target = outputs[output];
          if (!lower) {
            const uniforms = mats.prefilter.uniforms;
            uniforms.tSource.value = compU.tScene.value;
            uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
            uniforms.uThreshold.value = state.bloomThreshold;
            uniforms.uSoftKnee.value = state.bloomSoftKnee;
            runPass(FULLSCREEN_PASSES.bloomPrefilter, mats.prefilter, target);
          } else if (!upper) {
            const source = inputs[lower];
            const uniforms = mats.downsample.uniforms;
            uniforms.tSource.value = source.texture;
            uniforms.uTexelSize.value.set(1 / source.width, 1 / source.height);
            runPass(FULLSCREEN_PASSES.bloomDown, mats.downsample, target);
          } else {
            const source = inputs[lower];
            const uniforms = mats.upsample.uniforms;
            uniforms.tLower.value = source.texture;
            uniforms.tUpper.value = inputs[upper].texture;
            uniforms.uTexelSize.value.set(1 / source.width, 1 / source.height);
            runPass(FULLSCREEN_PASSES.bloomUp, mats.upsample, target);
          }
        }, lower ? pass : { ...pass, reads: ['sceneTarget'] });
      }

      addStage('tone-mapping', ({ inputs, outputs }) => {
        compU.tBloom.value = inputs.bloomColor?.texture ?? null;
        compU.tAutoExposure.value = useAutoExposure ? adaptRT[adaptIndex].texture : null;
        compU.uUseBloom.value = useBloom ? 1 : 0;
        compU.uUseAutoExposure.value = useAutoExposure ? 1 : 0;
        compU.uBloomStrength.value = state.bloomStrength;
        compU.uExposure.value = state.exposure;
        compU.uContrast.value = state.contrast;
        compU.uSaturation.value = state.saturation;
        compU.uChromaticAberration.value = state.chromaticAberration;
        compU.uFilmGrain.value = state.filmGrain;
        compU.uFilmSlope.value = state.filmSlope;
        compU.uFilmToe.value = state.filmToe;
        compU.uFilmShoulder.value = state.filmShoulder;
        compU.uFilmBlackClip.value = state.filmBlackClip;
        compU.uFilmWhiteClip.value = state.filmWhiteClip;
        compU.uVignette.value = state.vignette;
        compU.uDamage.value = state.damage;
        compU.uLowHealth.value = state.lowHealth;
        compU.uFocus.value = state.focus;
        compU.uFlash.value = state.flash;
        compU.uFade.value = state.fade;
        compU.uToneMapping.value = state.toneMapping;
        compU.uWriteLuma.value = plannedFinalFxaaPass ? 1 : 0;
        compU.uHeightFogDensity.value = readSceneDepth ? state.heightFogDensity : 0;
        compU.uHeightFogBase.value = state.heightFogBase;
        compU.uHeightFogFalloff.value = state.heightFogFalloff;
        if (state.heightFogColor && compU.uHeightFogColor.value?.copy) {
          compU.uHeightFogColor.value.copy(state.heightFogColor);
        }
        if (scratchCamWorld && camera?.position && compU.uCamWorldPos.value?.set) {
          scratchCamWorld.set(camera.position.x ?? 0, camera.position.y ?? 0, camera.position.z ?? 0);
          compU.uCamWorldPos.value.copy(scratchCamWorld);
        }
        if (scratchInvView && camera?.matrixWorld && compU.uInvViewMat.value?.copy) {
          scratchInvView.copy(camera.matrixWorld);
          compU.uInvViewMat.value.copy(scratchInvView);
        }
        compU.tColorLut.value = lutTexture ?? dummyWhiteLut;
        compU.uLutIntensity.value = lutTexture ? state.lutIntensity : 0;
        compU.uLutSize.value = state.lutSize;
        if (compU.uLutSrgb) compU.uLutSrgb.value = state.lutSrgb ? 1.0 : 0.0;
        runPass(FULLSCREEN_PASSES.toneMapping, mats.composite, plannedFinalFxaaPass ? outputs.ldrColor : null, outputViewport);
      }, {
        reads: [
          ...worldColorReads,
          ...(aoActive ? ['aoVol'] : []),
          ...(useGiSsr ? ['giSsr'] : []),
          ...(useBloom ? ['bloomColor'] : []),
        ],
        writes: plannedFinalFxaaPass ? ['ldrColor'] : ['backbuffer'],
        transientSpecs: plannedFinalFxaaPass
          ? { ldrColor: { width: bufferWidth, height: bufferHeight, type: THREE.UnsignedByteType, format: THREE.RGBAFormat } }
          : undefined,
      });

      if (plannedFinalFxaaPass) {
        addStage('fxaa-sharpen', ({ inputs }) => {
          const useFxaa = state.fxaa && (!temporalFrame || hasViewModel);
          mats.fxaaSharpen.uniforms.tDiffuse.value = inputs.ldrColor.texture;
          mats.fxaaSharpen.uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
          mats.fxaaSharpen.uniforms.uSharpness.value = state.sharpness;
          mats.fxaaSharpen.uniforms.uFxaaEnabled.value = useFxaa ? 1 : 0;
          runPass(FULLSCREEN_PASSES.fxaaSharpen, mats.fxaaSharpen, null, outputViewport);
        }, {
          reads: ['ldrColor'],
          writes: ['backbuffer'],
        });
      }

      const frameGraph = getCompiledFrameGraph(framePasses);
      const poolAdapter = transientPool
        ? {
            acquire(spec, resource, slot, pass) {
              if (!spec) return { token: resource };
              return transientPool.acquire(spec, resource, slot, pass);
            },
            release(target, resource, slot) {
              if (!target || target.token) return;
              transientPool.release(target, resource, slot);
            },
          }
        : {
            acquire: (_spec, resource) => ({ token: resource }),
            release() {},
          };
      const graphExecResult = executeRenderGraph(frameGraph, poolAdapter, {
        state: { sceneRT, bufferWidth, bufferHeight },
        executors: new Map(framePasses.map(pass => [pass.id.trim(), pass.execute])),
      });
      lastExecutedGraph = graphExecResult.executed.slice();
      lastFrameGraph = Object.freeze({
        compiledOrder: frameGraph.order,
        culled: frameGraph.culledPasses,
        executed: graphExecResult.executed,
        lifetimes: frameGraph.lifetimes,
        peakTargets: frameGraph.peakTargets,
        reusedCount: graphExecResult.reusedCount,
        poolStats: transientPool?.getStats() ?? null,
      });
      lastRenderGraphPlan = null;
      lastRenderGraphOptions = {
        useAo,
        useVolumetric,
        useGiSsr,
        useTemporalAA: temporalFrame,
        hasViewModel,
        stages: activePasses,
        useAutoExposure,
        bloomPasses,
        useFinalFxaaPass: plannedFinalFxaaPass,
        width: bufferWidth,
        height: bufferHeight,
      };
    } catch (error) {
      resetTemporalHistory();
      throw error;
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.setRenderTarget(null);
      renderer.autoClear = prevAutoClear;
      if (prevToneMapping !== undefined) renderer.toneMapping = prevToneMapping;
      activeDiagnostics = previousDiagnostics;
      hdrTargets.finishFrame();
      reportTargets(diagnostics);
    }
  }

  function handleContextLost() {
    if (disposed || contextLost) return;
    contextLost = true;
    disposeTargets();
  }

  function handleContextRestored() {
    if (disposed) return;
    contextLost = false;
    resetGiSsrHistory();
    sceneSampleCounts = undefined;
    bloomStorage = chooseBloomStorage();
    if (supported) {
      targetLimits = readDrawingBufferLimits(renderer);
      setBufferDimensions(requestedWidth, requestedHeight);
    }
    syncTargets();
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    compiledFrameGraph = null;
    disposeTargets();
    ownedLutTexture?.dispose?.();
    ownedLutTexture = null;
    lutTexture = null;
    dummyWhiteLut?.dispose?.();
    dummyWhiteLut = null;
    reactiveMaskMat?.dispose?.();
    reactiveMaskMat = null;
    temporalAa?.dispose();
    temporalAa = null;
    quadGeom?.dispose?.();
    if (mats) for (const mat of Object.values(mats)) mat.dispose?.();
    mats = null;
    sceneProjectionUniforms = null;
    quadGeom = null;
    quadMesh = null;
    postScene = null;
    postCamera = null;
    return true;
  }

  return {
    get supported() { return supported; },
    get capabilities() { return capabilities; },
    get preset() { return activePreset; },
    get state() { return { ...state }; },
    get passes() { return customPasses; },
    getRenderGraphPlan() {
      if (lastRenderGraphOptions) return lastRenderGraphPlan ??= buildFrameRenderGraphPlan(lastRenderGraphOptions);
      return buildFrameRenderGraphPlan({
        useAo: state.ssaoIntensity > 0.001,
        useVolumetric: state.volumetricIntensity > 0.001,
        useGiSsr: state.giIntensity > 0.001 || state.ssrIntensity > 0.001,
        useTemporalAA: Boolean(state.temporalAA),
        stages: customStages,
        useAutoExposure: Boolean(state.autoExposure),
        bloomPasses: state.bloomStrength !== 0 ? bloomStages : [],
        useFinalFxaaPass: Boolean(supported && !contextLost && sceneRT && (state.fxaa || state.sharpness > 0.001)),
      });
    },
    getLastExecutedGraph() {
      return lastExecutedGraph.slice();
    },
    getLastFrameGraph() {
      return lastFrameGraph;
    },
    getMainTarget() {
      return sceneRT
        ? { depthTexture: sceneRT.depthTexture, texture: sceneRT.texture, width: sceneRT.width, height: sceneRT.height, target: sceneRT }
        : null;
    },
    estimateTargetBytes,
    getRenderTargets,
    getTemporalStats() {
      const dims = getWorldRenderDimensions();
      return {
        active: Boolean(state.temporalAA && sceneRT?.depthTexture),
        upsampling: dims.upsampling,
        renderScale: state.renderScale,
        internalWidth: sceneRT?.width ?? dims.worldWidth,
        internalHeight: sceneRT?.height ?? dims.worldHeight,
        displayWidth: bufferWidth,
        displayHeight: bufferHeight,
        reactiveMeshCount: lastReactiveMeshCount,
        motion: temporalAa?.getMotionClassificationStats?.() ?? null,
      };
    },
    get targets() {
      return {
        bufferWidth,
        bufferHeight,
        hasSceneRT: Boolean(sceneRT),
        hasHalfRT: Boolean(halfRT || (transientPool && sceneRT?.depthTexture && (activePreset.ssao || (activePreset.volumetricSteps ?? 0) > 0))),
        hasGiSsrRT: Boolean(giSsrRT || (transientPool && sceneRT?.depthTexture && (ssgiEnabled() || ssrEnabled()))),
        hasAutoExposureRT: Boolean(lumaMips.length > 0 && adaptRT.length === 2),
        bloomMipCount: state.bloomStrength !== 0 ? bloomMipCount : 0,
        hasLdrRT: Boolean(ldrRT || (transientPool && supported && !contextLost && sceneRT && (state.fxaa || state.sharpness > 0.001))),
        hasTemporalAA: Boolean(temporalAa?.targets.length),
        poolStats: transientPool?.getStats() ?? null,
      };
    },
    resize,
    setPreset,
    setState,
    setPasses,
    resetGiSsrHistory,
    resetTemporalHistory,
    render,
    handleContextLost,
    handleContextRestored,
    dispose,
  };
}


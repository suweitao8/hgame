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
  FXAA_SHARPEN_FRAGMENT_GLSL3,
} from './shaders.js';
import { createFullscreenTriangle, inspectWebGLCapabilities, readSceneSampleCounts } from './capabilities.js';
import { computeWhiteBalanceRGB } from './color.js';
import { QUALITY3D_PRESETS } from '../quality3d.js';
import { readWorldPosition } from '../shadow3d/transform.js';
import { syncCameraWorldMatrices, usesZeroToOneDepth } from '../camera3d/matrices.js';
import { fitDrawingBuffer, readDrawingBufferLimits } from '../quality3d/viewport.js';

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
];
const GI_HISTORY_SETTINGS = ['giIntensity', 'giRadius', 'ssrIntensity', 'ssrMaxDist', 'ssrThickness'];

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
 * @property {{isWebGL2?: boolean, logarithmicDepthBuffer?: boolean, getMaxAnisotropy?(): number}} [capabilities]
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
 */

/**
 * Camera members read by `render`.
 * @typedef {object} PostPipelineCamera
 * @property {boolean} [isCamera]
 * @property {boolean} [isOrthographicCamera]
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
 * @property {number} [dt=0] Frame delta in seconds.
 * @property {readonly [number, number, number, number] | null} [outputViewport=null] Screen x, y, width and height in renderer pixels before DPR, with a bottom-left origin.
 */

/**
 * @typedef {object} PostPipeline3D
 * @property {boolean} supported Getter; true when the HDR pipeline is active (WebGL2 + required THREE classes).
 * @property {Readonly<WebGLCapabilities>} capabilities Getter; inspected GPU capabilities.
 * @property {Quality3DPreset} preset Getter; active (merged) quality preset.
 * @property {PostPipelineState} state Getter; shallow copy of the current state.
 * @property {PostPipelineTargets} targets Getter; target allocation info.
 * @property {(width: number, height: number) => void} resize Resizes buffers (px).
 * @property {(preset: Partial<Quality3DPreset>, buffer?: {width: number, height: number}) => void} setPreset Applies a preset and optionally resizes in one target rebuild.
 * @property {(patch?: PostPipelineSettings) => void} setState Merges finite numeric/array settings.
 * @property {() => void} resetGiSsrHistory Discard GI and reflection history after a scene cut or discontinuous motion.
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
  };

  let sceneRT = null;
  let viewCompositeRT = null;
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
  let lumaMips = [];
  let adaptRT = [];
  let ldrRT = null;
  let bloomMips = [];
  let postCamera = null;
  let postScene = null;
  let quadGeom = null;
  let quadMesh = null;
  let mats = null;
  let sceneProjectionUniforms = null;
  let scratchCamToShadow = null;
  let scratchViewToWorld = null;
  let scratchSunView = null;
  let scratchSunTarget = null;
  const hdrType = capabilities.halfFloatRenderable && THREE.HalfFloatType
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
  const usesByteColorTargets = hdrType === THREE.UnsignedByteType;
  let sceneSampleCounts;
  let bloomStorage = chooseBloomStorage();

  function chooseBloomStorage() {
    if (supported && !usesByteColorTargets && THREE.RGBFormat !== undefined && THREE.UnsignedInt101111Type !== undefined &&
        renderer.getContext?.()?.getExtension?.('EXT_color_buffer_float')) {
      return { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat };
    }
    return { type: hdrType };
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
    sceneRT?.depthTexture?.dispose?.();
    sceneRT?.dispose?.();
    viewCompositeRT?.dispose?.();
    halfRT?.dispose?.();
    aoBlurRT?.dispose?.();
    halfScratchRT?.dispose?.();
    giSsrRT?.dispose?.();
    giHistoryRT?.dispose?.();
    ldrRT?.dispose?.();
    disposeExposureTargets();
    for (const mip of bloomMips) {
      mip.down?.dispose?.();
      mip.up?.dispose?.();
    }
    sceneRT = null;
    viewCompositeRT = null;
    halfRT = null;
    aoBlurRT = null;
    halfScratchRT = null;
    giSsrRT = null;
    giHistoryRT = null;
    resetGiSsrHistory();
    ldrRT = null;
    bloomMips = [];
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
    const sampleDepth = renderer.capabilities?.logarithmicDepthBuffer !== true;
    if (sceneRT?.width === bufferWidth && sceneRT.height === bufferHeight &&
        sceneRT.samples === msaa && Boolean(sceneRT.depthTexture) === sampleDepth) return;

    let depthTexture = null;
    if (sampleDepth) {
      depthTexture = new THREE.DepthTexture(bufferWidth, bufferHeight, THREE.UnsignedIntType);
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      depthTexture.generateMipmaps = false;
    }

    const replacement = makeColorTarget(bufferWidth, bufferHeight, {
      type: hdrType,
      samples: msaa,
      depthBuffer: true,
      depthTexture,
    });
    sceneRT?.depthTexture?.dispose?.();
    sceneRT?.dispose?.();
    sceneRT = replacement;
  }

  function syncViewCompositeTarget(enabled) {
    if (!enabled) {
      viewCompositeRT?.dispose?.();
      viewCompositeRT = null;
    } else if (viewCompositeRT?.width !== bufferWidth || viewCompositeRT.height !== bufferHeight) {
      // Three can discard multisampled attachments after each render call.
      // Color must survive the world lighting and first-person draws here.
      const replacement = makeColorTarget(bufferWidth, bufferHeight, {
        type: hdrType,
        depthBuffer: true,
      });
      viewCompositeRT?.dispose?.();
      viewCompositeRT = replacement;
    }
  }

  function syncBloomTargets(hw, hh) {
    let mipCount = 0;
    if (activePreset.bloom) {
      let mw = hw;
      let mh = hh;
      for (let i = 0; i < 4; i++) {
        const lastMip = i === 3 || (mw === 1 && mh === 1);
        const mip = bloomMips[i] ?? { down: null, up: null };
        mip.w = mw;
        mip.h = mh;
        mip.down = syncColorTarget(mip.down, true, mw, mh, bloomStorage.type, bloomStorage.format);
        // Mip zero uses the shared half-resolution scratch target. The last mip only downsamples.
        mip.up = syncColorTarget(mip.up, i > 0 && !lastMip, mw, mh, bloomStorage.type, bloomStorage.format);
        bloomMips[i] = mip;
        mipCount++;
        if (lastMip) break;
        mw = Math.max(1, mw >> 1);
        mh = Math.max(1, mh >> 1);
      }
    }
    while (bloomMips.length > mipCount) {
      const mip = bloomMips.pop();
      mip.down?.dispose?.();
      mip.up?.dispose?.();
    }
  }

  function syncTargets() {
    if (!supported || disposed || contextLost) return;
    syncSceneTarget();
    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    const useAoVol = Boolean(sceneRT.depthTexture && (activePreset.ssao || (activePreset.volumetricSteps ?? 0) > 0));
    halfRT = syncColorTarget(halfRT, useAoVol, hw, hh, THREE.UnsignedByteType);
    aoBlurRT = syncColorTarget(aoBlurRT, useAoVol && !usesByteColorTargets, hw, hh, THREE.UnsignedByteType);
    syncBloomTargets(hw, hh);

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
    giSsrRT = syncColorTarget(giSsrRT, useGiSsr, hw, hh, hdrType);
    const useGiHistory = useGiSsr && state.temporalGiSsr && !usesByteColorTargets;
    if (giHistoryRT && (!useGiHistory || giHistoryRT.width !== hw || giHistoryRT.height !== hh)) {
      resetGiSsrHistory();
    }
    giHistoryRT = syncColorTarget(giHistoryRT, useGiHistory, hw, hh, hdrType);
    // AO and GI finish their blur before bloom writes the final upsample.
    const useHalfScratch = useGiSsr || bloomMips.length > 1 || (usesByteColorTargets && Boolean(halfRT));
    // Reserve alpha when the preset can denoise GI/SSR, including while those effects fade out.
    const bloomOnly = bloomMips.length > 1 && !(sceneRT.depthTexture && (activePreset.ssgi || activePreset.ssr));
    halfScratchRT = syncColorTarget(halfScratchRT, useHalfScratch, hw, hh,
      bloomOnly ? bloomStorage.type : hdrType, bloomOnly ? bloomStorage.format : undefined);

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

    const useLdr = state.fxaa || state.sharpness > 0.001;
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
      }, { ...exposureDefines, ...giDepthDefines }),
      fxaaSharpen: makeShader(FXAA_SHARPEN_FRAGMENT_GLSL3, {
        tDiffuse: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
        uSharpness: { value: state.sharpness },
        uFxaaEnabled: { value: state.fxaa ? 1 : 0 },
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

  function runPass(material, target, viewport = null) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    if (!target && viewport) {
      // Reapply the rectangle after target binding. Three rounds here, while its
      // default framebuffer bind floors DPR-scaled coordinates.
      renderer.setViewport?.(...viewport);
      renderer.setScissor?.(...viewport);
    }
    renderer.render(postScene, postCamera);
  }

  function setBufferDimensions(w, h) {
    requestedWidth = Math.max(1, Math.floor(w));
    requestedHeight = Math.max(1, Math.floor(h));
    const next = fitDrawingBuffer(requestedWidth, requestedHeight, 1, targetLimits);
    const changed = next.bufferWidth !== bufferWidth || next.bufferHeight !== bufferHeight;
    if (changed) resetGiSsrHistory();
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
    resetGiSsrHistory();
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

  function finishGiSsrBlur(world, camera, stepDt, useSsr) {
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
        uniforms.tSceneDepth.value = sceneRT.depthTexture;
        uniforms.tHistory.value = giHistoryRT.texture;
        uniforms.uPreviousGuideOffset.value = giHistoryGuideOffset;
        const frameWeight = useSsr ? 0.55 : 0.78;
        uniforms.uHistoryWeight.value = Math.pow(frameWeight, Math.max(1, stepDt * 60));
        material = mats.blurGiHistory;
      }
    }
    material.uniforms.tInput.value = halfScratchRT.texture;
    material.uniforms.uAxis.value.set(0, 1);
    runPass(material, giSsrRT);

    const texture = giSsrRT.texture;
    if (giHistoryRT) {
      const previous = giHistoryRT;
      giHistoryRT = giSsrRT;
      giSsrRT = previous;
      giHistoryView.copy(camera.matrixWorldInverse);
      giHistoryProjection.copy(camera.projectionMatrix);
      giHistoryGuideOffset = sceneProjectionUniforms.uSceneDepthGuideOffset.value;
      giHistoryDepthMode = depthMode;
      giHistoryWorld = world;
      giHistoryCamera = camera;
    }
    return texture;
  }

  function renderForwardWithViewmodel(world, camera, viewScene, viewCamera) {
    const prevAutoClear = renderer.autoClear;
    const gl = renderer.getContext?.();
    try {
      renderer.render(world, camera);
      if (viewScene && viewCamera) {
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        renderer.render(viewScene, viewCamera);
      }
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.autoClear = prevAutoClear;
    }
  }

  function render(world, camera, { viewScene = null, viewCamera = null, sunLight = null, dt = 0, outputViewport = null } = {}) {
    if (disposed || contextLost) return;
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (stepDt > 0) elapsed += stepDt;
    if (!supported || !sceneRT) {
      renderForwardWithViewmodel(world, camera, viewScene, viewCamera);
      return;
    }

    const gl = renderer.getContext?.();
    const prevAutoClear = renderer.autoClear;
    const prevToneMapping = renderer.toneMapping;
    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    const readSceneDepth = Boolean(sceneRT.depthTexture);
    const hasSun = Boolean(sunLight?.position && sunLight.visible !== false);
    const aoScratch = aoBlurRT ?? halfScratchRT;
    const useAo = Boolean(readSceneDepth && activePreset.ssao && state.ssaoIntensity > 0 && halfRT && aoScratch);
    const useSsgi = readSceneDepth && ssgiEnabled();
    const useSsr = readSceneDepth && ssrEnabled();
    const wantsGiSsr = Boolean((useSsgi || useSsr) && giSsrRT && halfScratchRT);
    const wantsContact = readSceneDepth && hasSun && state.contactShadows > 0.001;
    const volSteps = activePreset.volumetricSteps ?? 0;
    const shadow = sunLight?.shadow;
    const wantsVolumetric = Boolean(readSceneDepth && hasSun && volSteps > 0.5 &&
      state.volumetricIntensity !== 0 && sunLight.castShadow !== false &&
      renderer.shadowMap?.enabled !== false && shadow?.matrix && halfRT && aoScratch);
    const needsDepth = useAo || wantsGiSsr || wantsContact || wantsVolumetric;

    try {
      // Retain the attachments for volume changes. Only resolve/store depth if this frame reads it.
      sceneRT.resolveDepthBuffer = needsDepth;
      sceneRT.storeMultisampledDepthBuffer = needsDepth;
      renderer.setRenderTarget(sceneRT);
      renderer.autoClear = true;
      // Three clears both attachments during ordinary scene rendering. XR and
      // renderers with different clear settings still need an explicit clear.
      if (renderer.xr?.isPresenting !== false || renderer.autoClearColor !== true || renderer.autoClearDepth !== true) {
        renderer.clear(true, true, false);
      }
      renderer.render(world, camera);

      if (needsDepth) {
        syncCameraWorldMatrices(camera);
        sceneProjectionUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
        sceneProjectionUniforms.uProj.value.copy(camera.projectionMatrix);
        sceneProjectionUniforms.uSceneDepthMode.value = camera.reversedDepth ? 2 : Number(usesZeroToOneDepth(camera));
        // Orthographic views can include geometry behind the camera origin.
        sceneProjectionUniforms.uSceneDepthGuideOffset.value = camera.isOrthographicCamera
          ? Math.max(0, -(camera.near ?? 0)) : 0;
      }
      let hasSunDir = false;
      if (wantsContact || wantsVolumetric) {
        readWorldPosition(sunLight, scratchSunView).sub(readWorldPosition(sunLight.target, scratchSunTarget));
        const lengthSq = scratchSunView.lengthSq();
        hasSunDir = Number.isFinite(lengthSq) && lengthSq > 0;
        if (hasSunDir) scratchSunView.transformDirection(camera.matrixWorldInverse);
        if (sunLight.color && state.sunColor) state.sunColor.copy(sunLight.color);
      }

      // 1. Half-res SSAO + Volumetric sun shafts + separable bilateral blur
      const depthTexture = shadow?.map?.depthTexture;
      const sunShadowTex = depthTexture ?? shadow?.map?.texture;
      const shadowMatrix = shadow?.matrix;
      // Three can allocate the sun's shadow texture during the world draw.
      const useVolumetric = Boolean(wantsVolumetric && hasSunDir && sunShadowTex && shadowMatrix);
      const useContactShadows = wantsContact && hasSunDir;

      renderer.autoClear = false;
      if (useAo || useVolumetric) {
        const aoMaterial = useVolumetric && depthTexture?.compareFunction != null ? mats.aoVolCompare : mats.aoVol;
        const ao = aoMaterial.uniforms;
        ao.tDepth.value = sceneRT.depthTexture;
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
        runPass(aoMaterial, halfRT);

        mats.blur.uniforms.tInput.value = halfRT.texture;
        mats.blur.uniforms.uAxis.value.set(1, 0);
        runPass(mats.blur, aoScratch);

        mats.blur.uniforms.tInput.value = aoScratch.texture;
        mats.blur.uniforms.uAxis.value.set(0, 1);
        runPass(mats.blur, halfRT);
      }

      // 1b. Half-res HDR SSGI + SSR bounce reflections + depth-guided bilateral denoise
      const useGiSsr = Boolean(wantsGiSsr && giSsrRT && halfScratchRT);
      let giSsrTexture = null;
      if (useGiSsr) {
        const giU = mats.giSsr.uniforms;
        giU.tScene.value = sceneRT.texture;
        giU.tDepth.value = sceneRT.depthTexture;
        giU.uResolution.value.set(hw, hh);
        giU.uSsgiEnabled.value = useSsgi ? 1 : 0;
        giU.uSsrEnabled.value = useSsr ? 1 : 0;
        giU.uGiRadius.value = state.giRadius;
        giU.uGiIntensity.value = state.giIntensity;
        giU.uSsrIntensity.value = state.ssrIntensity;
        giU.uSsrMaxDist.value = state.ssrMaxDist;
        giU.uSsrThickness.value = state.ssrThickness;
        giU.uTime.value = elapsed;
        runPass(mats.giSsr, giSsrRT);

        mats.blurRgba.uniforms.tInput.value = giSsrRT.texture;
        mats.blurRgba.uniforms.uAxis.value.set(1, 0);
        runPass(mats.blurRgba, halfScratchRT);

        giSsrTexture = finishGiSsrBlur(world, camera, stepDt, useSsr);
      } else if (giHistoryRT) {
        resetGiSsrHistory();
      }

      const compU = mats.composite.uniforms;
      compU.tScene.value = sceneRT.texture;
      compU.tDepth.value = needsDepth ? sceneRT.depthTexture : null;
      compU.tAoVol.value = (useAo || useVolumetric) ? halfRT.texture : null;
      compU.tGiSsr.value = giSsrTexture;
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

      const hasViewModel = Boolean(viewScene && viewCamera && (
        viewScene.children?.length !== 0 || viewScene.background
        || viewScene.onBeforeRender !== THREE.Scene.prototype.onBeforeRender
        || viewScene.onAfterRender !== THREE.Scene.prototype.onAfterRender
      ));
      const separateViewModel = hasViewModel && (sceneRT.samples > 0 || useAo || useVolumetric || useGiSsr || useContactShadows);
      syncViewCompositeTarget(separateViewModel);
      if (hasViewModel) {
        if (separateViewModel) {
          // Finish the world lighting before clearing depth for the first-person layer.
          runPass(mats.worldLighting, viewCompositeRT);
        }
        if (typeof renderer.clearDepth === 'function') renderer.clearDepth();
        else renderer.clear?.(false, true, false);
        gl?.depthRange?.(0, 0.05);
        renderer.render(viewScene, viewCamera);
        gl?.depthRange?.(0, 1);
        if (separateViewModel) {
          compU.tScene.value = viewCompositeRT.texture;
          compU.uUseAo.value = 0;
          compU.uUseVolumetric.value = 0;
          compU.uUseGiSsr.value = 0;
          compU.uContactShadows.value = 0;
        }
      }

      // 1c. GPU Eye Adaptation / Auto-Exposure pyramid
      const useAutoExposure = Boolean(state.autoExposure && lumaMips.length > 0 && adaptRT.length === 2);
      if (useAutoExposure) {
        mats.lumaExtract.uniforms.tScene.value = compU.tScene.value;
        runPass(mats.lumaExtract, lumaMips[0]);
        for (let i = 1; i < lumaMips.length; i++) {
          mats.lumaDown.uniforms.tSource.value = lumaMips[i - 1].texture;
          runPass(mats.lumaDown, lumaMips[i]);
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
        runPass(mats.eyeAdapt, nextAdapt);
        // Keep the encoding range of the history texture across settings changes.
        if (usesByteColorTargets) adaptU.uStoredExposureRange.value.set(adaptU.uMinExposure.value, adaptU.uMaxExposure.value);
        adaptIndex ^= 1;
        adaptNeedsReset = false;
      }

      // 2. Multi-mip Karis-average Bloom pyramid
      const useBloom = Boolean(activePreset.bloom && state.bloomStrength !== 0 && bloomMips.length > 0);
      let bloomTexture = null;
      if (useBloom) {
        mats.prefilter.uniforms.tSource.value = compU.tScene.value;
        mats.prefilter.uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
        mats.prefilter.uniforms.uThreshold.value = state.bloomThreshold;
        mats.prefilter.uniforms.uSoftKnee.value = state.bloomSoftKnee;
        runPass(mats.prefilter, bloomMips[0].down);

        for (let i = 1; i < bloomMips.length; i++) {
          const prev = bloomMips[i - 1];
          const curr = bloomMips[i];
          mats.downsample.uniforms.tSource.value = prev.down.texture;
          mats.downsample.uniforms.uTexelSize.value.set(1 / prev.w, 1 / prev.h);
          runPass(mats.downsample, curr.down);
        }

        let accumTex = bloomMips[bloomMips.length - 1].down.texture;
        let accumW = bloomMips[bloomMips.length - 1].w;
        let accumH = bloomMips[bloomMips.length - 1].h;
        for (let i = bloomMips.length - 2; i >= 0; i--) {
          const curr = bloomMips[i];
          const target = i === 0 ? halfScratchRT : curr.up;
          mats.upsample.uniforms.tLower.value = accumTex;
          mats.upsample.uniforms.tUpper.value = curr.down.texture;
          mats.upsample.uniforms.uTexelSize.value.set(1 / accumW, 1 / accumH);
          runPass(mats.upsample, target);
          accumTex = target.texture;
          accumW = curr.w;
          accumH = curr.h;
        }
        bloomTexture = accumTex;
      }

      // 3. Composite HDR + contact shadows + GI/SSR + grading + UE Filmic/ACES/AgX tone mapping
      const useFinalFxaaPass = Boolean(ldrRT && (state.fxaa || state.sharpness > 0.001));
      compU.tBloom.value = bloomTexture;
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
      compU.uWriteLuma.value = useFinalFxaaPass ? 1 : 0;
      runPass(mats.composite, useFinalFxaaPass ? ldrRT : null, outputViewport);

      // 4. FXAA + edge-attenuated unsharp mask + IGN dither
      if (useFinalFxaaPass) {
        mats.fxaaSharpen.uniforms.tDiffuse.value = ldrRT.texture;
        mats.fxaaSharpen.uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
        mats.fxaaSharpen.uniforms.uSharpness.value = state.sharpness;
        mats.fxaaSharpen.uniforms.uFxaaEnabled.value = state.fxaa ? 1 : 0;
        runPass(mats.fxaaSharpen, null, outputViewport);
      }
    } catch (error) {
      resetGiSsrHistory();
      throw error;
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.setRenderTarget(null);
      renderer.autoClear = prevAutoClear;
      if (prevToneMapping !== undefined) renderer.toneMapping = prevToneMapping;
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
    disposeTargets();
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
    get targets() {
      return {
        bufferWidth,
        bufferHeight,
        hasSceneRT: Boolean(sceneRT),
        hasHalfRT: Boolean(halfRT),
        hasGiSsrRT: Boolean(giSsrRT),
        hasAutoExposureRT: Boolean(lumaMips.length > 0 && adaptRT.length === 2),
        bloomMipCount: bloomMips.length,
        hasLdrRT: Boolean(ldrRT),
      };
    },
    resize,
    setPreset,
    setState,
    resetGiSsrHistory,
    render,
    handleContextLost,
    handleContextRestored,
    dispose,
  };
}


import { Component } from '../core/component.js';
import { createAdaptiveQualityController, resolveQualityPreset } from './quality3d.js';
import { createGpuFrameTimer } from './quality3d/gpu-timer.js';
import { createRenderDiagnostics3D, drawWithDiagnostics } from './quality3d/render-diagnostics.js';
import { fitDrawingBuffer, readDrawingBufferLimits } from './quality3d/viewport.js';
import { createPostPipeline3D, inspectWebGLCapabilities } from './post3d.js';
import { createSceneCuller3D } from './culling3d.js';
import { fitDirectionalShadowFrustum } from './shadow3d.js';
import { syncCameraWorldMatrices, usesZeroToOneDepth } from './camera3d/matrices.js';
import { normalizeSplitViews, pickSplitView } from '../platform/input.js';
import { cleanupAll } from '../internal/cleanup.js';

const SCRATCH_WORLD_MAT = new Float64Array(16);

function resolveToneMappingConstant(THREE, mode) {
  switch (mode) {
    case 'aces':
    case 'ueFilmic':
    case 'filmic':
      return THREE.ACESFilmicToneMapping ?? 4;
    case 'agx': return THREE.AgXToneMapping ?? 6;
    case 'neutral': return THREE.NeutralToneMapping ?? 7;
    case 'none': return THREE.NoToneMapping ?? 0;
    default: return null;
  }
}

function buildPrimitiveGeometry(THREE, { type, size, radius, height }) {
  switch (type) {
    case 'sphere':
      return THREE.SphereGeometry
        ? new THREE.SphereGeometry(radius, 24, 16)
        : new THREE.BoxGeometry(size, size, size);
    case 'capsule':
      return THREE.CapsuleGeometry
        ? new THREE.CapsuleGeometry(radius, Math.max(0.01, height - radius * 2), 8, 16)
        : new THREE.BoxGeometry(size, height, size);
    case 'cylinder':
      return THREE.CylinderGeometry
        ? new THREE.CylinderGeometry(radius, radius, height, 20)
        : new THREE.BoxGeometry(size, height, size);
    case 'plane':
      return THREE.PlaneGeometry
        ? new THREE.PlaneGeometry(size, size)
        : new THREE.BoxGeometry(size, 0.01, size);
    case 'box':
    default:
      return new THREE.BoxGeometry(size, size, size);
  }
}

/**
 * Minimal structural Three.js Object3D (add/remove capable).
 * @typedef {{ add(object: object): unknown, remove(object: object): unknown, [key: string]: unknown }} ThreeObject3D
 */

/**
 * Injected Three.js namespace: only the constructors this module uses.
 * @typedef {{
 *   Scene: new () => ThreeObject3D,
 *   PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCamera,
 *   WebGLRenderer: new (options: object) => ThreeRenderer,
 *   Mesh?: new (geometry: object, material: object) => ThreeMesh,
 *   BoxGeometry?: new (...args: number[]) => ThreeDisposable,
 *   MeshStandardMaterial?: new (options: object) => ThreeDisposable,
 *   Color?: new (value: number | string) => object,
 *   Fog?: new (color: number | string, near: number, far: number) => object,
 *   HemisphereLight?: new (sky: number | string, ground: number | string, intensity: number) => object,
 *   DirectionalLight?: new (color: number | string, intensity: number) => ThreeDirectionalLight,
 *   Vector3?: new (x?: number, y?: number, z?: number) => ThreeVector3,
 *   Matrix4?: new () => ThreeMatrix4,
 *   [key: string]: unknown
 * }} ThreeNamespace
 */

/**
 * @typedef {{ dispose?(): void, [key: string]: unknown }} ThreeDisposable
 */

/**
 * @typedef {{ x: number, y: number, z: number, set(x: number, y: number, z: number): ThreeVector3,
 *   copy(v: object): ThreeVector3, sub(v: object): ThreeVector3, normalize(): ThreeVector3,
 *   applyMatrix4(m: object): ThreeVector3, setFromMatrixPosition?(m: object): ThreeVector3 }} ThreeVector3
 */

/**
 * @typedef {{ fromArray(a: ArrayLike<number>): ThreeMatrix4,
 *   decompose(position: object, quaternion: object, scale: object): ThreeMatrix4 }} ThreeMatrix4
 */

/**
 * Minimal structural Three.js camera.
 * @typedef {{ position: { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown },
 *   aspect?: number, far?: number, updateProjectionMatrix?(): void, updateMatrixWorld?(force?: boolean): void,
 *   lookAt?(x: number, y: number, z: number): void,
 *   matrixWorld?: object, matrixWorldInverse?: object, projectionMatrix?: object, projectionMatrixInverse?: object,
 *   [key: string]: unknown }} ThreeCamera
 */

/**
 * Minimal structural Three.js mesh.
 * @typedef {{ geometry?: ThreeDisposable, material?: ThreeDisposable | ThreeDisposable[],
 *   castShadow: boolean, receiveShadow: boolean, visible: boolean,
 *   position: { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown },
 *   rotation: { set(x: number, y: number, z: number): unknown },
 *   scale: { set(x: number, y: number, z: number): unknown },
 *   quaternion?: object, [key: string]: unknown }} ThreeMesh
 */

/**
 * Minimal structural Three.js WebGLRenderer.
 * @typedef {{ render(scene: object, camera: object): void, setSize(w: number, h: number, updateStyle?: boolean): void,
 *   setPixelRatio(ratio: number): void, getContext?(): object | null, dispose(): void,
 *   autoClear: boolean, toneMapping: number, toneMappingExposure: number,
 *   shadowMap?: { enabled: boolean, type: number },
 *   [key: string]: unknown }} ThreeRenderer
 */

/**
 * Quality options forwarded to `createAdaptiveQualityController` (see quality3d.js).
 * @typedef {object} ThreeQuality3DOptions
 * @property {(state: { preset: object, tier?: string, [key: string]: unknown }, reason?: string) => void} [onChange] Called after the adapter applied a quality change.
 * @property {Record<string, unknown>} [device] Device hints (e.g. `rendererName`).
 * @property {boolean} [calibrateGpu] Fill `device.rendererName` from the WebGL context.
 * @property {boolean} [gpuTiming=true] Use asynchronous GPU timings in automatic quality mode when available.
 * @property {string} [mode] Quality mode: 'auto' | 'low' | 'medium' | 'high' | 'ultra'.
 */

/**
 * Optional sky object bound to the adapter.
 * @typedef {{ setLinearOutput?(linear: boolean): void, linearOutput?: boolean, [key: string]: unknown }} ThreeSkyLike
 */

/**
 * Optional post-process volume stack.
 * @typedef {{ applyToPipeline(pipeline: object, position: object, base?: { exposure?: number }): unknown, [key: string]: unknown }} ThreePostVolumesLike
 */

/**
 * Material palette whose anisotropy follows the quality tier.
 * @typedef {{ setAnisotropy?(value: number): void, [key: string]: unknown }} ThreeMaterialPalette
 */

/**
 * @typedef {object} ThreeDirectionalLight
 * @property {{set(x: number, y: number, z: number): unknown}} position
 * @property {boolean} castShadow
 * @property {{mapSize: {x: number, set(x: number, y: number): unknown},
 *   camera: {updateProjectionMatrix?(): void}, bias: number}} shadow
 * @property {() => void} [dispose]
 */

/**
 * Default lighting for each world created by this adapter.
 * @typedef {object} ThreeWorldLighting
 * @property {{color?: number | string, near: number, far: number}} [fog]
 * @property {{sky: number | string, ground: number | string, intensity: number}} [hemisphere]
 * @property {{color: number | string, intensity: number, position: [number, number, number],
 *   shadow?: {extent: number, near: number, far: number, mapSize?: number, bias?: number, adaptiveExtent?: boolean, autoUpdate?: boolean}}} [sun] Set shadow.autoUpdate to false to cache static shadows.
 */

/**
 * @typedef {object} ThreeAdapterOptions
 * @property {ThreeNamespace} THREE Injected Three.js namespace (required).
 * @property {HTMLCanvasElement | object} canvas Target canvas (required).
 * @property {number} [width=960] Initial width in CSS px.
 * @property {number} [height=540] Initial height in CSS px.
 * @property {number} [pixelRatio=globalThis.devicePixelRatio||1] Requested device pixel ratio.
 * @property {number} [cameraFov=60] Vertical field of view, degrees.
 * @property {[number, number, number]} [cameraPosition] Starting camera position.
 * @property {[number, number, number]} [cameraTarget] Starting camera look-at target.
 * @property {number} [near=0.1] Camera near plane, world units.
 * @property {number} [far=1000] Camera far plane / cull distance, world units.
 * @property {boolean} [limitCameraDrawDistance=false] Limit the adapter camera far plane to the active render tier's draw distance.
 * @property {number | string} [background=0x101820] Scene background colour.
 * @property {ThreeWorldLighting | null} [worldLighting=null] Default fog and lights, allocated per scene.
 * @property {ThreeQuality3DOptions | null} [quality3d=null] Adaptive quality options.
 * @property {boolean | Record<string, unknown> | null} [post3d=null] Enable post pipeline (true or its options).
 * @property {boolean} [diagnostics3d=false] Collect frame and render-stage performance diagnostics.
 * @property {boolean | null} [shadows=null] Force shadows on/off; null follows the quality preset.
 * @property {string | null} [toneMapping=null] 'aces' | 'ueFilmic' | 'filmic' | 'agx' | 'neutral' | 'none'.
 * @property {number} [exposure=1] Base tone-mapping exposure.
 * @property {{ shadow?: { mapSize?: { x: number, set?(x: number, y: number): unknown }, [key: string]: unknown }, [key: string]: unknown } | null} [sunLight=null] Shadow-casting sun light.
 * @property {ThreeCamera | null} [viewCamera=null] Camera for the view-model overlay layer.
 * @property {ThreeSkyLike | null} [sky=null] Sky controller.
 * @property {ThreePostVolumesLike | null} [postVolumes=null] Post volume stack.
 */

/**
 * @typedef {object} ThreeSplitView
 * @property {ThreeCamera} camera View camera.
 * @property {number} x Normalised left (0..1).
 * @property {number} y Normalised top (0..1).
 * @property {number} width Normalised width (0..1).
 * @property {number} height Normalised height (0..1).
 */

/**
 * @typedef {object} ThreeRay
 * @property {{ x: number, y: number, z: number }} origin World-space ray origin.
 * @property {{ x: number, y: number, z: number }} direction Normalised world-space direction.
 */

/**
 * @typedef {object} ThreeScreenPoint
 * @property {number} x Screen x in CSS px.
 * @property {number} y Screen y in CSS px.
 * @property {number} ndcZ Normalised device depth.
 * @property {boolean} visible True when inside the view frustum.
 */

/**
 * @typedef {object} ThreeAdapter
 * @property {ThreeNamespace} THREE
 * @property {ThreeRenderer} renderer
 * @property {ThreeCamera} camera
 * @property {ReturnType<typeof createAdaptiveQualityController> | null} qualityController
 * @property {object | null} qualityPreset
 * @property {ReturnType<typeof createPostPipeline3D> | null} postPipeline
 * @property {ReturnType<typeof createSceneCuller3D>} culler3d
 * @property {boolean} contextLost
 * @property {() => import('./quality3d/render-diagnostics.js').RenderDiagnosticsSnapshot3D | null} getRenderDiagnostics Latest frame when diagnostics are enabled.
 * @property {(scene: object) => ThreeObject3D} getWorld
 * @property {(scene: object) => ThreeObject3D} getViewWorld
 * @property {(scene: object, object: object) => void} add
 * @property {(scene: object, object: object) => void} remove
 * @property {(scene: object, object: object) => void} addView
 * @property {(scene: object, object: object) => void} removeView
 * @property {(cam: ThreeCamera | null) => void} setViewCamera
 * @property {(light: object | null) => void} setSunLight
 * @property {(scene?: object | null) => boolean} invalidateSunShadow Request a fresh sun shadow map for a scene or the active sun.
 * @property {(sun?: import('./sky3d.js').DirectionalLightLike | null, target?: import('./sky3d.js').SkyVec3Input, options?: import('./sky3d.js').ShadowFitOptions & { shadowDistance?: number, radius?: number }) => import('./sky3d.js').ShadowFrustum | null} fitShadowToPreset
 * @property {(nextSky: ThreeSkyLike | null | undefined) => void} setSky
 * @property {(nextExposure: number) => void} setExposure
 * @property {ThreePostVolumesLike | null} postVolumes
 * @property {(stack: ThreePostVolumesLike | null | undefined) => void} setPostVolumes
 * @property {(palette: ThreeMaterialPalette) => void} registerMaterialPalette
 * @property {(palette: ThreeMaterialPalette) => void} unregisterMaterialPalette
 * @property {(mode: string) => object} setQuality
 * @property {() => string | null} getQuality
 * @property {(views: object[] | null, options?: object) => ThreeSplitView[] | null} setViews
 * @property {() => ThreeSplitView[] | null} getViews
 * @property {(clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => ThreeRay} screenToRay
 * @property {(x: number, y: number, z: number, out?: object | null, viewIndex?: number) => ThreeScreenPoint} worldToScreen
 * @property {(scene: object, app?: object | null) => void} render
 * @property {() => void} resize
 * @property {(ms: number) => void} recordFrameInterval
 * @property {() => void} dispose
 */

/**
 * The Three.js namespace is injected; this module never imports Three itself.
 * @param {ThreeAdapterOptions} options
 * @returns {ThreeAdapter}
 */
export function createThreeAdapter({
  THREE,
  canvas,
  width = 960,
  height = 540,
  pixelRatio = globalThis.devicePixelRatio || 1,
  cameraFov = 60,
  cameraPosition = [0, 4, 11],
  cameraTarget = [0, 0, 0],
  near = 0.1,
  far = 1000,
  limitCameraDrawDistance = false,
  background = 0x101820,
  worldLighting = null,
  quality3d = null,
  post3d = null,
  diagnostics3d = false,
  shadows = null,
  toneMapping = null,
  exposure = 1.0,
  sunLight = null,
  viewCamera = null,
  sky = null,
  postVolumes = null,
} = {}) {
  if (!THREE?.Scene || !THREE?.PerspectiveCamera || !THREE?.WebGLRenderer) {
    throw new TypeError('A complete Three.js namespace is required');
  }
  if (!canvas) throw new TypeError('Three adapter requires a canvas');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !post3d,
    powerPreference: 'high-performance',
  });
  const renderDiagnostics = diagnostics3d ? createRenderDiagnostics3D(THREE, renderer) : null;

  let postPipeline = null;
  const viewPipelines = [];
  let activeSunLight = sunLight;
  let worldSunLight = null;
  const worldSuns = new WeakMap();
  const ownedSuns = new Map();
  const appliedShadowExtents = new WeakMap();
  const cachedShadowLayers = new WeakMap();
  let activeViewCamera = viewCamera;
  let activeSky = sky;
  let activePostVolumes = postVolumes;
  let baseExposure = Number.isFinite(exposure) ? exposure : 1.0;
  const registeredPalettes = new Set();
  const culler3d = createSceneCuller3D({
    maxDistance: far,
    occlusion: true,
    gl: renderer.getContext?.() ?? null,
  });

  function markSunShadowDirty(light) {
    if (!light?.shadow) return false;
    light.shadow.needsUpdate = true;
    if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    return true;
  }

  function invalidateCachedWorldSun(world) {
    const light = world && worldSuns.get(world);
    if (light?.shadow?.autoUpdate === false) markSunShadowDirty(light);
  }

  function prepareSunShadows(world, camera) {
    if (activeSunLight?.shadow?.needsUpdate && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    const light = worldSuns.get(world);
    const shadow = light?.castShadow ? light.shadow : null;
    if (shadow?.autoUpdate !== false) return;
    const shadowLayers = shadow.camera?.layers?.mask;
    // Match Three.js's selection of shadow caster layers.
    const layers = (shadowLayers & 0xfffffffe) !== 0 ? shadowLayers : camera.layers?.mask;
    if (!cachedShadowLayers.has(shadow) || cachedShadowLayers.get(shadow) !== layers) {
      cachedShadowLayers.set(shadow, layers);
      markSunShadowDirty(light);
    } else if (shadow.needsUpdate && renderer.shadowMap) {
      renderer.shadowMap.needsUpdate = true;
    }
  }

  function applySunShadowPreset(light, preset, needsRefresh = false) {
    const shadow = light?.shadow;
    if (!preset || !shadow?.mapSize) {
      if (needsRefresh) markSunShadowDirty(light);
      return;
    }
    const configured = light === worldSunLight ? worldLighting?.sun?.shadow : null;
    if (configured?.adaptiveExtent && preset.shadowDistance > 0) {
      const extent = Math.min(configured.extent, preset.shadowDistance * 0.5);
      const camera = shadow.camera;
      if (camera && appliedShadowExtents.get(camera) !== extent) {
        if (camera.left !== -extent || camera.right !== extent || camera.top !== extent || camera.bottom !== -extent) {
          Object.assign(camera, { left: -extent, right: extent, top: extent, bottom: -extent });
          camera.updateProjectionMatrix?.();
          needsRefresh = true;
        }
        appliedShadowExtents.set(camera, extent);
      }
    }

    const requestedSize = preset.shadowMapSize;
    if (Number.isFinite(requestedSize) && requestedSize > 0) {
      const maxTextureSize = renderer.capabilities?.maxTextureSize ?? Infinity;
      const frameExtents = shadow.getFrameExtents?.();
      const atlasSpan = Math.max(1, frameExtents?.x ?? 1, frameExtents?.y ?? 1);
      const wanted = Math.max(1, Math.floor(Math.min(requestedSize, maxTextureSize / atlasSpan)));
      if (shadow.mapSize.x !== wanted || shadow.mapSize.y !== wanted) {
        if (typeof shadow.mapSize.set === 'function') shadow.mapSize.set(wanted, wanted);
        else Object.assign(shadow.mapSize, { x: wanted, y: wanted });

        const map = shadow.map;
        const mapPass = shadow.mapPass;
        shadow.map = null;
        if (mapPass) shadow.mapPass = null;
        map?.dispose?.();
        if (mapPass !== map) mapPass?.dispose?.();
        needsRefresh = true;
      }
    }

    if (needsRefresh) markSunShadowDirty(light);
  }

  function applyQualityToRenderer(preset = null) {
    const enableShadows = shadows === false
      ? false
      : (preset
          ? Boolean(preset.shadowsEnabled ?? (preset.shadowMapSize > 0))
          : Boolean(shadows));
    let refreshShadow = false;
    if (renderer.shadowMap) {
      const previousEnabled = renderer.shadowMap.enabled;
      const previousType = renderer.shadowMap.type;
      renderer.shadowMap.enabled = enableShadows;
      if (enableShadows && THREE.PCFShadowMap !== undefined) {
        renderer.shadowMap.type = THREE.PCFShadowMap;
      }
      refreshShadow = enableShadows && (!previousEnabled || previousType !== renderer.shadowMap.type);
    }
    applySunShadowPreset(activeSunLight ?? worldSunLight, preset, refreshShadow);
    if (preset) {
      culler3d.setMaxDistance(preset.drawDistance ?? far);
      culler3d.setOcclusionEnabled(preset.occlusionCulling ?? true);
      if (registeredPalettes.size > 0) {
        const caps = inspectWebGLCapabilities(renderer);
        const clampedAniso = Math.min(preset.anisotropy ?? 1, caps.maxAnisotropy);
        for (const palette of registeredPalettes) {
          palette.setAnisotropy?.(clampedAniso);
        }
      }
    }
    if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if (postPipeline?.supported) {
      if ('toneMapping' in renderer && THREE.NoToneMapping !== undefined) {
        renderer.toneMapping = THREE.NoToneMapping;
      }
      if ('toneMappingExposure' in renderer) {
        renderer.toneMappingExposure = 1.0;
      }
      activeSky?.setLinearOutput?.(true);
    } else {
      if (toneMapping && 'toneMapping' in renderer) {
        const resolved = resolveToneMappingConstant(THREE, toneMapping);
        if (resolved !== null) renderer.toneMapping = resolved;
      }
      if ('toneMappingExposure' in renderer && Number.isFinite(baseExposure)) {
        renderer.toneMappingExposure = baseExposure;
      }
      activeSky?.setLinearOutput?.(false);
    }
  }

  let qualityController = null;
  let appliedPreset = null;
  let drawingBufferLimits = readDrawingBufferLimits(renderer);
  let gpuFrameTimer;
  let measureGpu = false;
  const enableGpuTiming = quality3d?.gpuTiming !== false;
  const userQualityOnChange = quality3d?.onChange ?? null;
  if (userQualityOnChange !== null && typeof userQualityOnChange !== 'function') {
    throw new TypeError('onChange must be a function');
  }
  function onQualityChange(state, reason) {
    measureGpu = enableGpuTiming && state.mode === 'auto';
    gpuFrameTimer?.reset();
    renderDiagnostics?.resetGpu();
    resize();
    userQualityOnChange?.(state, reason);
  }

  if (quality3d !== null) {
    let qualityDevice = quality3d.device ?? {};
    if (quality3d.calibrateGpu === true) {
      const caps = inspectWebGLCapabilities(renderer);
      qualityDevice = {
        ...qualityDevice,
        rendererName: qualityDevice.rendererName || caps.rendererName || '',
      };
    }
    qualityController = createAdaptiveQualityController({
      ...quality3d,
      device: qualityDevice,
      onChange: onQualityChange,
    });
    measureGpu = enableGpuTiming && qualityController.state.mode === 'auto';
  }

  function setQuality(mode) {
    if (!qualityController) {
      const caps = inspectWebGLCapabilities(renderer);
      qualityController = createAdaptiveQualityController({
        mode,
        device: { rendererName: caps.rendererName || '' },
        onChange: onQualityChange,
      });
      measureGpu = enableGpuTiming && qualityController.state.mode === 'auto';
      resize();
      return qualityController.state;
    }
    if (!qualityController.setMode(mode)) resize();
    return qualityController.state;
  }

  function getQuality() {
    return qualityController?.state?.tier ?? null;
  }

  const postOptions = typeof post3d === 'object' && post3d ? { ...post3d } : {};
  function createViewPostPipeline(width, height, preset, passes = postOptions.passes) {
    return createPostPipeline3D({
      THREE, renderer,
      exposure: postOptions.exposure ?? baseExposure,
      ...(toneMapping && !postOptions.toneMapping ? { toneMapping } : {}),
      ...postOptions, preset, passes, width, height,
    });
  }
  if (post3d) {
    const initialSize = planCanvasSize();
    postPipeline = createViewPostPipeline(initialSize.bufferWidth, initialSize.bufferHeight,
      qualityController?.state.preset ?? postOptions.preset);
    const resetPrimaryHistory = postPipeline.resetGiSsrHistory;
    postPipeline.resetGiSsrHistory = () => {
      resetPrimaryHistory();
      for (const entry of viewPipelines) entry?.pipeline.resetGiSsrHistory();
    };
  }

  appliedPreset = qualityController?.state?.preset ?? null;
  applyQualityToRenderer(appliedPreset);

  const camera = new THREE.PerspectiveCamera(cameraFov, width / height, near, far);
  camera.position.set(...cameraPosition);
  camera.lookAt?.(...cameraTarget);

  const worlds = new WeakMap();
  const viewWorlds = new WeakMap();
  let activeViews = null;
  let contextLost = false;
  let lastDtSeconds = 0;
  let lastCanvasSize = null;

  function getWorld(scene) {
    if (!worlds.has(scene)) {
      const world = new THREE.Scene();
      if (THREE.Color && 'background' in world) world.background = new THREE.Color(background);
      const { fog, hemisphere, sun } = worldLighting ?? {};
      if (fog && THREE.Fog) world.fog = new THREE.Fog(fog.color ?? background, fog.near, fog.far);
      if (hemisphere && THREE.HemisphereLight) {
        world.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
      }
      if (sun && THREE.DirectionalLight) {
        const light = new THREE.DirectionalLight(sun.color, sun.intensity);
        light.position.set(...sun.position);
        light.castShadow = Boolean(sun.shadow);
        if (sun.shadow) {
          const { extent, near, far, bias = 0, mapSize = 1024, autoUpdate = true } = sun.shadow;
          Object.assign(light.shadow.camera, {
            left: -extent, right: extent, top: extent, bottom: -extent, near, far,
          });
          light.shadow.camera.updateProjectionMatrix?.();
          light.shadow.mapSize.set(mapSize, mapSize);
          light.shadow.bias = bias;
          light.shadow.autoUpdate = autoUpdate !== false;
          if (!light.shadow.autoUpdate) markSunShadowDirty(light);
        }
        const release = () => {
          if (!ownedSuns.delete(light)) return;
          offDispose?.();
          worldSuns.delete(world);
          worlds.delete(scene);
          if (worldSunLight === light) worldSunLight = null;
          world.remove(light);
          light.dispose?.();
        };
        const offDispose = scene.onDispose?.(release);
        ownedSuns.set(light, release);
        worldSuns.set(world, light);
        world.add(light);
      }
      worlds.set(scene, world);
    }
    return worlds.get(scene);
  }

  function getViewWorld(scene) {
    if (!viewWorlds.has(scene)) {
      const viewWorld = new THREE.Scene();
      viewWorlds.set(scene, viewWorld);
    }
    return viewWorlds.get(scene);
  }

  function planCanvasSize() {
    const w = Math.max(1, Math.floor(canvas.clientWidth || width));
    const h = Math.max(1, Math.floor(canvas.clientHeight || height));
    if (qualityController) return qualityController.planViewport(w, h, pixelRatio, drawingBufferLimits);
    const ratio = Math.max(1, Math.min(3, pixelRatio));
    return { cssWidth: w, cssHeight: h, ...fitDrawingBuffer(w, h, ratio, drawingBufferLimits) };
  }

  function writeDrawingBuffer(w, h, ratio) {
    if (typeof renderer.setDrawingBufferSize === 'function' && !renderer.xr?.isPresenting) {
      renderer.setDrawingBufferSize(w, h, ratio);
    } else {
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
  }

  function applyCanvasSize(plan) {
    let { cssWidth: w, cssHeight: h, pixelRatio: ratio, bufferWidth, bufferHeight } = plan;
    // A degenerate aspect ratio may require rounding one axis up to a pixel.
    if (w * ratio < 1 || h * ratio < 1) {
      w = bufferWidth;
      h = bufferHeight;
      ratio = 1;
    }
    writeDrawingBuffer(w, h, ratio);
    const gl = renderer.getContext?.();
    if (gl?.canvas === canvas && !renderer.xr?.isPresenting) {
      const actualWidth = gl.drawingBufferWidth;
      const actualHeight = gl.drawingBufferHeight;
      if (actualWidth > 0 && actualHeight > 0 && (actualWidth < bufferWidth || actualHeight < bufferHeight)) {
        // Normalize renderer coordinates to the smaller buffer the browser accepted.
        writeDrawingBuffer(actualWidth, actualHeight, 1);
        bufferWidth = gl.drawingBufferWidth || actualWidth;
        bufferHeight = gl.drawingBufferHeight || actualHeight;
        ratio = 1;
      }
    }
    renderer.setViewport?.(0, 0, bufferWidth / ratio, bufferHeight / ratio);
    return {
      plan, bufferWidth, bufferHeight, rendererRatio: ratio,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
    };
  }

  function resize() {
    const size = planCanvasSize();
    const { cssWidth: w, cssHeight: h, pixelRatio: ratio } = size;
    const lastPlan = lastCanvasSize?.plan;
    const canvasChanged = lastCanvasSize &&
      (canvas.width !== lastCanvasSize.canvasWidth || canvas.height !== lastCanvasSize.canvasHeight);
    const viewportChanged = !lastPlan || lastPlan.cssWidth !== w || lastPlan.cssHeight !== h || lastPlan.pixelRatio !== ratio;
    if (!contextLost && (canvasChanged || viewportChanged)) {
      gpuFrameTimer?.reset();
      renderDiagnostics?.resetGpu();
      lastCanvasSize = applyCanvasSize(size);
    }
    const { bufferWidth, bufferHeight } = contextLost ? size : lastCanvasSize;
    const preset = qualityController?.state?.preset ?? null;
    if (limitCameraDrawDistance && preset && far > near) {
      camera.far = Math.max(near + Math.min(0.001, far - near), Math.min(far, preset.drawDistance ?? far));
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (activeViewCamera && 'aspect' in activeViewCamera && typeof activeViewCamera.updateProjectionMatrix === 'function') {
      activeViewCamera.aspect = w / h;
      activeViewCamera.updateProjectionMatrix();
    }
    if (activeViews) {
      for (let i = 0; i < activeViews.length; i++) {
        const v = activeViews[i];
        if ('aspect' in v.camera && typeof v.camera.updateProjectionMatrix === 'function') {
          v.camera.aspect = (w * v.width) / Math.max(1, h * v.height);
          v.camera.updateProjectionMatrix();
        }
      }
    }
    // The public pipeline owns the shared settings even while its full-sized
    // targets are idle. Pane-sized pipelines only allocate for drawn views.
    const postWidth = activeViews ? 1 : bufferWidth;
    const postHeight = activeViews ? 1 : bufferHeight;
    if (preset && preset !== appliedPreset) {
      postPipeline?.setPreset(preset, { width: postWidth, height: postHeight });
      appliedPreset = preset;
      applyQualityToRenderer(preset);
    } else {
      postPipeline?.resize(postWidth, postHeight);
    }
  }

  const onContextLost = (event) => {
    event?.preventDefault?.();
    contextLost = true;
    gpuFrameTimer?.reset();
    gpuFrameTimer = undefined;
    renderDiagnostics?.resetGpu(true);
    postPipeline?.handleContextLost?.();
    // Recreate pane resources from the restored GPU's limits on the next draw.
    removeObsoleteViewPipelines(null);
  };
  const onContextRestored = () => {
    contextLost = false;
    drawingBufferLimits = readDrawingBufferLimits(renderer);
    lastCanvasSize = null;
    resize();
    for (const light of ownedSuns.keys()) {
      if (light.shadow?.autoUpdate === false) markSunShadowDirty(light);
    }
    applySunShadowPreset(activeSunLight ?? worldSunLight, appliedPreset, true);
    postPipeline?.handleContextRestored?.();
  };
  canvas.addEventListener?.('webglcontextlost', onContextLost, false);
  canvas.addEventListener?.('webglcontextrestored', onContextRestored, false);

  resize();

  const scratchOrigin = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchPoint = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchView = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchViewToWorld = THREE.Matrix4 ? new THREE.Matrix4() : null;

  function canvasRect() {
    if (typeof canvas.getBoundingClientRect === 'function') {
      const rect = canvas.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    return {
      left: 0,
      top: 0,
      width: Math.max(1, canvas.clientWidth || width),
      height: Math.max(1, canvas.clientHeight || height),
    };
  }

  function setViews(views, options = {}) {
    const res = normalizeSplitViews(views, options);
    const changedMode = Boolean(activeViews) !== Boolean(res.views);
    activeViews = res.views;
    removeObsoleteViewPipelines(activeViews);
    if (changedMode && postPipeline?.supported) resize();
    if (activeViews) {
      const rect = canvasRect();
      for (let i = 0; i < activeViews.length; i++) {
        const v = activeViews[i];
        if ('aspect' in v.camera && typeof v.camera.updateProjectionMatrix === 'function') {
          v.camera.aspect = (rect.width * v.width) / Math.max(1, rect.height * v.height);
          v.camera.updateProjectionMatrix();
        }
      }
    }
    return getViews();
  }

  function removeObsoleteViewPipelines(views) {
    for (let i = 0; i < viewPipelines.length; i++) {
      const entry = viewPipelines[i];
      const view = views?.[i];
      if (entry && (!view || entry.camera !== view.camera || entry.playerId !== view.playerId)) {
        entry.pipeline.dispose();
        viewPipelines[i] = null;
      }
    }
    viewPipelines.length = Math.min(viewPipelines.length, views?.length ?? 0);
  }

  function getViewPipeline(view, width, height) {
    const preset = postPipeline.preset;
    const passes = postPipeline.passes;
    let entry = viewPipelines[view.index];
    if (!entry) {
      entry = { camera: view.camera, playerId: view.playerId, preset, passes,
        pipeline: createViewPostPipeline(width, height, preset, passes) };
      viewPipelines[view.index] = entry;
    } else if (entry.preset !== preset) {
      entry.pipeline.setPreset(preset, { width, height });
      entry.preset = preset;
    } else {
      entry.pipeline.resize(width, height);
    }
    if (entry.passes !== passes) {
      entry.pipeline.setPasses(passes);
      entry.passes = passes;
    }
    return entry.pipeline;
  }

  function getViews() {
    return activeViews ? activeViews.map(v => ({ ...v })) : null;
  }

  function screenToRay(clientX, clientY, out = null, viewIndex = null) {
    if (!scratchOrigin || !scratchPoint) {
      throw new Error('screenToRay requires Three.js Vector3 and PerspectiveCamera matrices');
    }
    const rect = canvasRect();
    const nxFull = (clientX - (rect.left || 0)) / Math.max(1, rect.width);
    const nyFull = (clientY - (rect.top || 0)) / Math.max(1, rect.height);
    const targetView = activeViews ? pickSplitView(activeViews, nxFull, nyFull, viewIndex) : null;
    const cam = targetView ? targetView.camera : camera;
    if (!cam.projectionMatrixInverse || !cam.matrixWorld) {
      throw new Error('screenToRay requires Three.js Vector3 and PerspectiveCamera matrices');
    }
    const vx = targetView ? targetView.x : 0;
    const vy = targetView ? targetView.y : 0;
    const vw = targetView ? targetView.width : 1;
    const vh = targetView ? targetView.height : 1;
    const ndcX = ((nxFull - vx) / vw) * 2 - 1;
    const ndcY = -(((nyFull - vy) / vh) * 2 - 1);
    syncCameraWorldMatrices(cam);
    const viewToWorld = scratchViewToWorld && cam.matrixWorldInverse
      ? scratchViewToWorld.copy(cam.matrixWorldInverse).invert()
      : cam.matrixWorld;

    if (cam.isOrthographicCamera) {
      const nearDepth = cam.reversedDepth ? 1 : (usesZeroToOneDepth(cam) ? 0 : -1);
      scratchOrigin.set(ndcX, ndcY, nearDepth).applyMatrix4(cam.projectionMatrixInverse).applyMatrix4(viewToWorld);
    } else if (typeof scratchOrigin.setFromMatrixPosition === 'function') {
      scratchOrigin.setFromMatrixPosition(viewToWorld);
    } else {
      scratchOrigin.copy(cam.position);
    }
    scratchPoint.set(ndcX, ndcY, 0.5)
      .applyMatrix4(cam.projectionMatrixInverse)
      .applyMatrix4(viewToWorld)
      .sub(scratchOrigin)
      .normalize();

    if (out) {
      if (typeof out.origin?.set === 'function') out.origin.set(scratchOrigin.x, scratchOrigin.y, scratchOrigin.z);
      else if (out.origin) { out.origin.x = scratchOrigin.x; out.origin.y = scratchOrigin.y; out.origin.z = scratchOrigin.z; }
      if (typeof out.direction?.set === 'function') out.direction.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
      else if (out.direction) { out.direction.x = scratchPoint.x; out.direction.y = scratchPoint.y; out.direction.z = scratchPoint.z; }
      return out;
    }
    return {
      origin: { x: scratchOrigin.x, y: scratchOrigin.y, z: scratchOrigin.z },
      direction: { x: scratchPoint.x, y: scratchPoint.y, z: scratchPoint.z },
    };
  }

  function worldToScreen(x, y, z, out = null, viewIndex = 0) {
    if (!scratchView) {
      throw new Error('worldToScreen requires Three.js Vector3 and PerspectiveCamera matrices');
    }
    const rect = canvasRect();
    const targetView = activeViews ? (activeViews[viewIndex] ?? activeViews[0]) : null;
    const cam = targetView ? targetView.camera : camera;
    if (!cam.matrixWorldInverse || !cam.projectionMatrix) {
      throw new Error('worldToScreen requires Three.js Vector3 and PerspectiveCamera matrices');
    }
    syncCameraWorldMatrices(cam);
    scratchView.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const inFront = cam.isOrthographicCamera || scratchView.z < 0;
    scratchView.applyMatrix4(cam.projectionMatrix);

    const vx = targetView ? targetView.x : 0;
    const vy = targetView ? targetView.y : 0;
    const vw = targetView ? targetView.width : 1;
    const vh = targetView ? targetView.height : 1;
    const sx = (vx + (scratchView.x * 0.5 + 0.5) * vw) * rect.width;
    const sy = (vy + (-scratchView.y * 0.5 + 0.5) * vh) * rect.height;
    const visible = Boolean(
      inFront &&
      scratchView.z >= (usesZeroToOneDepth(cam) ? 0 : -1) && scratchView.z <= 1 &&
      scratchView.x >= -1 && scratchView.x <= 1 &&
      scratchView.y >= -1 && scratchView.y <= 1
    );

    if (out) {
      out.x = sx;
      out.y = sy;
      out.ndcZ = scratchView.z;
      out.visible = visible;
      return out;
    }
    return { x: sx, y: sy, ndcZ: scratchView.z, visible };
  }

  function renderView(world, camera, pipeline, options = {}) {
    const diagnostics = options.diagnostics;
    diagnostics?.beginView(options.viewIndex ?? 0);
    culler3d.beginFrame(camera);
    prepareSunShadows(world, camera);
    if (pipeline) {
      pipeline.render(world, camera, options);
      return;
    }

    const { viewScene, viewCamera } = options;
    if (viewScene && viewCamera) {
      const prevAutoClear = renderer.autoClear;
      const gl = renderer.getContext?.();
      try {
        drawWithDiagnostics(renderer, diagnostics?.beginPass, 'forward', null, world, camera);
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        drawWithDiagnostics(renderer, diagnostics?.beginPass, 'viewmodel', null, viewScene, viewCamera);
      } finally {
        gl?.depthRange?.(0, 1);
        renderer.autoClear = prevAutoClear;
      }
      return;
    }

    drawWithDiagnostics(renderer, diagnostics?.beginPass, 'forward', null, world, camera);
  }

  function renderWorld(scene, diagnostics = null) {
    const world = getWorld(scene);
    const sceneSun = worldLighting?.sun ? worldSuns.get(world) ?? null : null;
    if (worldSunLight !== sceneSun) {
      worldSunLight = sceneSun;
      applySunShadowPreset(activeSunLight ?? worldSunLight, appliedPreset, Boolean(activeSunLight));
    }

    if (activeViews && activeViews.length > 0) {
      const rect = canvasRect();
      const outputWidth = lastCanvasSize?.bufferWidth ?? Math.max(1, Math.floor(rect.width));
      const outputHeight = lastCanvasSize?.bufferHeight ?? Math.max(1, Math.floor(rect.height));
      const ratio = lastCanvasSize?.rendererRatio ?? 1;
      const prevAutoClear = renderer.autoClear;
      const postState = postPipeline?.supported ? postPipeline.state : null;
      try {
        renderer.setScissorTest?.(false);
        renderer.setViewport?.(0, 0, outputWidth / ratio, outputHeight / ratio);
        renderer.clear?.(true, true, true);
        renderer.autoClear = false;
        renderer.setScissorTest?.(true);

        for (let i = 0; i < activeViews.length; i++) {
          const v = activeViews[i];
          const left = Math.round(v.x * outputWidth);
          const right = Math.round((v.x + v.width) * outputWidth);
          const top = Math.round(v.y * outputHeight);
          const bottom = Math.round((v.y + v.height) * outputHeight);
          if (left === right || top === bottom) {
            viewPipelines[i]?.pipeline.dispose();
            viewPipelines[i] = null;
            continue;
          }
          const vx = left / ratio;
          const vyBottomUp = (outputHeight - bottom) / ratio;
          const vw = (right - left) / ratio;
          const vh = (bottom - top) / ratio;
          const aspect = Math.max(1, rect.width * v.width) / Math.max(1, rect.height * v.height);
          if ('aspect' in v.camera && Math.abs(v.camera.aspect - aspect) > 1e-4) {
            v.camera.aspect = aspect;
            v.camera.updateProjectionMatrix?.();
          }
          let pipeline = null;
          if (postState) {
            pipeline = getViewPipeline(v, right - left, bottom - top);
            // Merge each volume before touching history-dependent settings in the pane.
            const state = activePostVolumes ? { ...postState } : postState;
            activePostVolumes?.applyToPipeline({ setState: patch => Object.assign(state, patch) },
              v.camera.position, { exposure: baseExposure });
            pipeline.setState(state);
          }
          renderer.setViewport?.(vx, vyBottomUp, vw, vh);
          renderer.setScissor?.(vx, vyBottomUp, vw, vh);
          renderView(world, v.camera, pipeline, {
            diagnostics,
            viewIndex: v.index,
            outputViewport: pipeline ? [vx, vyBottomUp, vw, vh] : null,
            sunLight: activeSunLight ?? worldSunLight,
            dt: lastDtSeconds,
          });
        }
      } finally {
        renderer.setScissorTest?.(false);
        renderer.setViewport?.(0, 0, outputWidth / ratio, outputHeight / ratio);
        renderer.autoClear = prevAutoClear;
      }
      return;
    }

    const viewScene = scene && viewWorlds.has(scene) ? viewWorlds.get(scene) : null;
    if (postPipeline && activePostVolumes) {
      activePostVolumes.applyToPipeline(postPipeline, camera.position, { exposure: baseExposure });
    }
    renderView(world, camera, postPipeline, {
      diagnostics,
      viewScene, viewCamera: activeViewCamera,
      sunLight: activeSunLight ?? worldSunLight,
      dt: lastDtSeconds,
    });
  }

  function render(scene, _app = null) {
    if (contextLost) return;
    if (renderDiagnostics) {
      if (!renderDiagnostics.beginFrame()) {
        renderWorld(scene);
        return;
      }
      let complete = false;
      try {
        renderWorld(scene, renderDiagnostics);
        complete = true;
      } finally {
        renderDiagnostics.endFrame(complete);
      }
      return;
    }
    const timer = measureGpu ? gpuFrameTimer : null;
    if (!timer?.begin()) {
      renderWorld(scene);
      return;
    }
    try {
      renderWorld(scene);
    } finally {
      timer.end();
    }
  }

  return {
    THREE,
    renderer,
    camera,
    get qualityController() { return qualityController; },
    get qualityPreset() { return qualityController?.state?.preset ?? null; },
    postPipeline,
    culler3d,
    get contextLost() { return contextLost; },
    getRenderDiagnostics: () => renderDiagnostics?.snapshot() ?? null,
    getWorld,
    getViewWorld,
    add(scene, object) {
      const world = getWorld(scene);
      const previousParent = object?.parent;
      world.add(object);
      if (object?.parent === world && previousParent !== world) {
        invalidateCachedWorldSun(previousParent);
        invalidateCachedWorldSun(world);
      }
    },
    remove(scene, object) {
      const world = scene && worlds.get(scene);
      if (!world) return;
      const wasChild = object?.parent === world;
      world.remove(object);
      if (wasChild) invalidateCachedWorldSun(world);
    },
    addView(scene, object) { getViewWorld(scene).add(object); },
    removeView(scene, object) { if (scene && viewWorlds.has(scene)) getViewWorld(scene).remove(object); },
    setViewCamera(cam) { activeViewCamera = cam; },
    setSunLight(light) {
      const previousSun = activeSunLight ?? worldSunLight;
      activeSunLight = light;
      if (qualityController?.state?.preset) applyQualityToRenderer(qualityController.state.preset);
      const nextSun = activeSunLight ?? worldSunLight;
      if (nextSun !== previousSun) markSunShadowDirty(nextSun);
    },
    invalidateSunShadow(scene = null) {
      const light = scene ? worldSuns.get(worlds.get(scene)) : activeSunLight ?? worldSunLight;
      return markSunShadowDirty(light);
    },
    fitShadowToPreset(sun = activeSunLight ?? worldSunLight, target = { x: 0, y: 0, z: 0 }, options = {}) {
      const light = sun ?? activeSunLight ?? worldSunLight;
      if (!light) return null;
      const presetDist = qualityController?.state?.preset?.shadowDistance;
      const shadowDistance = Number.isFinite(options?.shadowDistance)
        ? Math.max(1, options.shadowDistance)
        : (Number.isFinite(presetDist) && presetDist > 0 ? presetDist : 35);
      const radius = Number.isFinite(options?.radius) ? Math.max(0.5, options.radius) : shadowDistance * 0.5;
      const center = Array.isArray(target)
        ? [Number(target[0]) || 0, Number(target[1]) || 0, Number(target[2]) || 0]
        : [Number(target?.x) || 0, Number(target?.y) || 0, Number(target?.z) || 0];
      const sunDirection = options?.sunDirection ?? (activeSky?.sunDirection ?? null);
      const frustum = fitDirectionalShadowFrustum(THREE, light, { center, radius }, { ...options, sunDirection });
      markSunShadowDirty(light);
      return frustum;
    },
    setSky(nextSky) {
      activeSky = nextSky ?? null;
      activeSky?.setLinearOutput?.(Boolean(postPipeline?.supported));
    },
    setExposure(nextExposure) {
      if (!Number.isFinite(nextExposure) || nextExposure < 0) {
        throw new RangeError('exposure must be a non-negative finite number');
      }
      baseExposure = nextExposure;
      if (postPipeline?.supported) {
        postPipeline.setState({ exposure: baseExposure });
      } else if ('toneMappingExposure' in renderer) {
        renderer.toneMappingExposure = baseExposure;
      }
    },
    get postVolumes() { return activePostVolumes; },
    setPostVolumes(stack) {
      activePostVolumes = stack ?? null;
    },
    registerMaterialPalette(palette) {
      if (!palette) return;
      registeredPalettes.add(palette);
      if (qualityController?.state?.preset) applyQualityToRenderer(qualityController.state.preset);
    },
    unregisterMaterialPalette(palette) {
      registeredPalettes.delete(palette);
    },
    setQuality,
    getQuality,
    setViews,
    getViews,
    screenToRay,
    worldToScreen,
    render,
    resize,
    recordFrameInterval(ms) {
      if (contextLost) return;
      if (Number.isFinite(ms) && ms > 0) lastDtSeconds = ms / 1000;
      let gpuMs = null;
      if (measureGpu && Number.isFinite(ms) && ms > 0) {
        if (renderDiagnostics) {
          if (ms >= 250) renderDiagnostics.resetGpu();
          else gpuMs = renderDiagnostics.consumeGpuFrameMs();
        } else {
          if (gpuFrameTimer === undefined) gpuFrameTimer = createGpuFrameTimer(renderer.getContext?.());
          if (ms >= 250) gpuFrameTimer?.reset();
          else gpuMs = gpuFrameTimer?.poll() ?? null;
        }
      }
      qualityController?.sampleFrame(ms, gpuMs);
    },
    dispose() {
      canvas.removeEventListener?.('webglcontextlost', onContextLost, false);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored, false);
      registeredPalettes.clear();
      cleanupAll([
        ...ownedSuns.values(),
        () => gpuFrameTimer?.reset(),
        () => renderDiagnostics?.resetGpu(true),
        () => culler3d.dispose(),
        () => removeObsoleteViewPipelines(null),
        () => postPipeline?.dispose?.(),
        () => renderer.dispose(),
      ], 'Three renderer disposal failed');
    },
  };
}

/**
 * @typedef {object} ThreeMeshComponentOptions
 * @property {'box' | 'sphere' | 'capsule' | 'cylinder' | 'plane'} [type='box'] Primitive shape.
 * @property {number} [color=0x67d9ba] Default material colour (0xRRGGBB).
 * @property {number} [size=1] Edge length, world units.
 * @property {number} [radius=size*0.5] Radius, world units.
 * @property {number} [height=size] Height, world units.
 * @property {ThreeDisposable | null} [geometry=null] Custom shared geometry (not disposed).
 * @property {ThreeDisposable | null} [material=null] Custom shared material (not disposed).
 * @property {boolean} [castShadow=false]
 * @property {boolean} [receiveShadow=false]
 * @property {boolean} [interpolate=false] Use render-alpha interpolated transforms.
 * @property {boolean} [cull=false] Enable adapter distance and occlusion culling for meshes that do not contribute to shadow maps.
 * @property {number} [cullRadius=0] Minimum culling sphere radius in world units (0 = geometry bounds).
 */

/**
 * Minimal renderer-owned 3D mesh component (not a physics body).
 * @param {ThreeNamespace} THREE Injected Three.js namespace.
 * @param {ThreeMeshComponentOptions} [options]
 * @returns {Component & { mesh: ThreeMesh, updateTransform(): void }} Component instance owning a `mesh`.
 */
export function createThreeMeshComponent(THREE, {
  type = 'box',
  color = 0x67d9ba,
  size = 1,
  radius = size * 0.5,
  height = size,
  geometry = null,
  material = null,
  castShadow = false,
  receiveShadow = false,
  interpolate = false,
  cull = false,
  cullRadius = 0,
} = {}) {
  if (!THREE?.Mesh || (!geometry && !THREE?.BoxGeometry) || (!material && !THREE?.MeshStandardMaterial)) {
    throw new TypeError('Three mesh component requires Mesh, BoxGeometry, MeshStandardMaterial');
  }
  const ownsGeometry = !geometry;
  const ownsMaterial = !material;

  class Mesh3D extends Component {
    awake() {
      const geo = geometry ?? buildPrimitiveGeometry(THREE, { type, size, radius, height });
      const mat = material ?? new THREE.MeshStandardMaterial({ color });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.castShadow = Boolean(castShadow);
      this.mesh.receiveShadow = Boolean(receiveShadow);
      this._scratchMat4 = THREE.Matrix4 ? new THREE.Matrix4() : null;
      if (cull) this.installViewCulling();
      this.updateTransform();
    }
    installViewCulling() {
      const mesh = this.mesh;
      const nativeIntersects = mesh.intersectsFrustum;
      if (typeof nativeIntersects !== 'function' || !THREE.Sphere) return;
      const bounds = new THREE.Sphere();
      mesh.intersectsFrustum = (frustum) => {
        if (!nativeIntersects.call(mesh, frustum)) return false;
        // Shadow passes use the same mesh hook with the light's frustum.
        // Preserve native per-pass visibility for every shadow contributor.
        const adapter = this.scene?.app?.renderer;
        const shadowType = adapter?.renderer?.shadowMap?.type;
        const contributesToShadow = mesh.castShadow ||
          (mesh.receiveShadow && THREE.VSMShadowMap !== undefined && shadowType === THREE.VSMShadowMap);
        const culler = adapter?.culler3d;
        if (contributesToShadow || !culler?.frustum?.hasPlanes) return true;

        const localSphere = mesh.geometry?.boundingSphere;
        if (!localSphere || !mesh.matrixWorld) return true;
        bounds.copy(localSphere).applyMatrix4(mesh.matrixWorld);
        if (!Number.isFinite(bounds.radius)) return true;
        const { x, y, z } = bounds.center;
        return culler.testSphere(x, y, z, Math.max(bounds.radius, cullRadius > 0 ? cullRadius : 0));
      };
    }
    onEnable() { this.scene?.app?.renderer?.add(this.scene, this.mesh); }
    start() { this.updateTransform(); }
    lateUpdate() { this.updateTransform(); }
    updateTransform() {
      if (!this.mesh || !this.entity) return;
      const app = this.scene?.app;
      const useInterp = Boolean((interpolate || this.entity.interpolate) && app?.renderAlpha !== undefined);
      const alpha = app?.renderAlpha ?? 1;

      if (this._scratchMat4 && this.mesh.quaternion && this.mesh.position && this.mesh.scale) {
        // Parent transforms are baked into a display matrix: meshes currently
        // live directly in the Three Scene, not the parent's Object3D node.
        const mat = useInterp
          ? this.entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD_MAT)
          : this.entity.worldMatrixInto(SCRATCH_WORLD_MAT);
        this._scratchMat4.fromArray(mat)
          .decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
        return;
      }
      const pos = useInterp
        ? this.entity.interpolatedWorldPosition(alpha)
        : this.entity.worldPosition();
      this.mesh.position.set(pos.x, pos.y, pos.z);
      this.mesh.rotation.set(this.entity.rotationX, this.entity.rotationY, this.entity.rotationZ);
      this.mesh.scale.set(this.entity.scaleX, this.entity.scaleY, this.entity.scaleZ);
    }
    onDisable() { this.scene?.app?.renderer?.remove(this.scene, this.mesh); }
    onDestroy() {
      if (ownsGeometry) this.mesh?.geometry?.dispose?.();
      if (ownsMaterial) {
        if (Array.isArray(this.mesh?.material)) {
          for (const mat of this.mesh.material) mat.dispose?.();
        } else {
          this.mesh?.material?.dispose?.();
        }
      }
    }
  }
  return new Mesh3D();
}

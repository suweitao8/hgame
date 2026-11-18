import { Component } from '../core/component.js';
import { createAdaptiveQualityController, resolveQualityPreset } from './quality3d.js';
import { createPostPipeline3D, inspectWebGLCapabilities } from './post3d.js';
import { createSceneCuller3D } from './culling3d.js';
import { fitDirectionalShadowFrustum } from './shadow3d.js';
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
 *   shadow?: {extent: number, near: number, far: number, mapSize?: number, bias?: number, adaptiveExtent?: boolean}}} [sun]
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
 * @property {(scene: object) => ThreeObject3D} getWorld
 * @property {(scene: object) => ThreeObject3D} getViewWorld
 * @property {(scene: object, object: object) => void} add
 * @property {(scene: object, object: object) => void} remove
 * @property {(scene: object, object: object) => void} addView
 * @property {(scene: object, object: object) => void} removeView
 * @property {(cam: ThreeCamera | null) => void} setViewCamera
 * @property {(light: object | null) => void} setSunLight
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

  let postPipeline = null;
  let activeSunLight = sunLight;
  let worldSunLight = null;
  const worldSuns = new WeakMap();
  const ownedSuns = new Set();
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

  function applySunShadowPreset(light, preset) {
    if (!preset || !light?.shadow?.mapSize) return;
    const configured = light === worldSunLight ? worldLighting?.sun?.shadow : null;
    if (configured?.adaptiveExtent && preset.shadowDistance > 0) {
      const extent = Math.min(configured.extent, preset.shadowDistance * 0.5);
      const camera = light.shadow.camera;
      if (camera && camera.right !== extent) {
        Object.assign(camera, { left: -extent, right: extent, top: extent, bottom: -extent });
        camera.updateProjectionMatrix?.();
        light.shadow.needsUpdate = true;
      }
    }
    const wanted = preset.shadowMapSize;
    if (!Number.isFinite(wanted) || wanted <= 0 || light.shadow.mapSize.x === wanted) return;
    light.shadow.mapSize.set?.(wanted, wanted);
    light.shadow.map?.dispose?.();
    light.shadow.map = null;
    light.shadow.needsUpdate = true;
  }

  function applyQualityToRenderer(preset = null) {
    const enableShadows = shadows === false
      ? false
      : (preset
          ? Boolean(preset.shadowsEnabled ?? (preset.shadowMapSize > 0))
          : Boolean(shadows));
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = enableShadows;
      if (enableShadows && THREE.PCFShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    applySunShadowPreset(activeSunLight ?? worldSunLight, preset);
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
  const userQualityOnChange = quality3d?.onChange ?? null;
  if (userQualityOnChange !== null && typeof userQualityOnChange !== 'function') {
    throw new TypeError('onChange must be a function');
  }
  function onQualityChange(state, reason) {
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
  }

  function setQuality(mode) {
    if (!qualityController) {
      const caps = inspectWebGLCapabilities(renderer);
      qualityController = createAdaptiveQualityController({
        mode,
        device: { rendererName: caps.rendererName || '' },
        onChange: onQualityChange,
      });
      resize();
      return qualityController.state;
    }
    if (!qualityController.setMode(mode)) resize();
    return qualityController.state;
  }

  function getQuality() {
    return qualityController?.state?.tier ?? null;
  }

  if (post3d) {
    const postOptions = typeof post3d === 'object' ? post3d : {};
    const initialSize = planCanvasSize();
    postPipeline = createPostPipeline3D({
      THREE,
      renderer,
      exposure: postOptions.exposure ?? baseExposure,
      ...(toneMapping && !postOptions.toneMapping ? { toneMapping } : {}),
      ...postOptions,
      preset: qualityController?.state.preset ?? postOptions.preset,
      width: initialSize.bufferWidth,
      height: initialSize.bufferHeight,
    });
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
          const { extent, near, far, bias = 0, mapSize = 1024 } = sun.shadow;
          Object.assign(light.shadow.camera, {
            left: -extent, right: extent, top: extent, bottom: -extent, near, far,
          });
          light.shadow.camera.updateProjectionMatrix?.();
          light.shadow.mapSize.set(mapSize, mapSize);
          light.shadow.bias = bias;
        }
        const release = () => {
          if (!ownedSuns.delete(release)) return;
          offDispose?.();
          worldSuns.delete(world);
          worlds.delete(scene);
          if (worldSunLight === light) worldSunLight = null;
          world.remove(light);
          light.dispose?.();
        };
        const offDispose = scene.onDispose?.(release);
        ownedSuns.add(release);
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
    const w = Math.max(1, canvas.clientWidth || width);
    const h = Math.max(1, canvas.clientHeight || height);
    if (qualityController) return qualityController.planViewport(w, h, pixelRatio);
    const ratio = Math.max(1, Math.min(3, pixelRatio));
    return { cssWidth: w, cssHeight: h, pixelRatio: ratio,
      bufferWidth: Math.max(1, Math.floor(w * ratio)), bufferHeight: Math.max(1, Math.floor(h * ratio)) };
  }

  function resize() {
    const size = planCanvasSize();
    const { cssWidth: w, cssHeight: h, pixelRatio: ratio, bufferWidth, bufferHeight } = size;
    const canvasChanged = typeof canvas.width === 'number' && typeof canvas.height === 'number'
      && (canvas.width !== bufferWidth || canvas.height !== bufferHeight);
    const viewportChanged = lastCanvasSize?.cssWidth !== w || lastCanvasSize.cssHeight !== h || lastCanvasSize.pixelRatio !== ratio;
    if (!contextLost && (canvasChanged || viewportChanged)) {
      if (typeof renderer.setDrawingBufferSize === 'function' && !renderer.xr?.isPresenting) {
        renderer.setDrawingBufferSize(w, h, ratio);
      } else {
        renderer.setPixelRatio(ratio);
        renderer.setSize(w, h, false);
      }
      lastCanvasSize = size;
    }
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
    if (preset && preset !== appliedPreset) {
      postPipeline?.setPreset(preset, { width: bufferWidth, height: bufferHeight });
      appliedPreset = preset;
      applyQualityToRenderer(preset);
    } else {
      postPipeline?.resize(bufferWidth, bufferHeight);
    }
  }

  const onContextLost = (event) => {
    event?.preventDefault?.();
    contextLost = true;
    postPipeline?.handleContextLost?.();
  };
  const onContextRestored = () => {
    contextLost = false;
    lastCanvasSize = null;
    resize();
    postPipeline?.handleContextRestored?.();
  };
  canvas.addEventListener?.('webglcontextlost', onContextLost, false);
  canvas.addEventListener?.('webglcontextrestored', onContextRestored, false);

  resize();

  const scratchOrigin = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchPoint = THREE.Vector3 ? new THREE.Vector3() : null;
  const scratchView = THREE.Vector3 ? new THREE.Vector3() : null;

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

  function syncCameraMatrices(cam = camera) {
    cam.updateMatrixWorld?.(true);
    if (cam.matrixWorldInverse && cam.matrixWorld && typeof cam.matrixWorldInverse.copy === 'function') {
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert?.();
    }
  }

  function setViews(views, options = {}) {
    const res = normalizeSplitViews(views, options);
    activeViews = res.views;
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
    syncCameraMatrices(cam);

    if (typeof scratchOrigin.setFromMatrixPosition === 'function') {
      scratchOrigin.setFromMatrixPosition(cam.matrixWorld);
    } else {
      scratchOrigin.copy(cam.position);
    }
    scratchPoint.set(ndcX, ndcY, 0.5)
      .applyMatrix4(cam.projectionMatrixInverse)
      .applyMatrix4(cam.matrixWorld)
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
    syncCameraMatrices(cam);
    scratchView.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const inFront = scratchView.z < 0;
    scratchView.applyMatrix4(cam.projectionMatrix);

    const vx = targetView ? targetView.x : 0;
    const vy = targetView ? targetView.y : 0;
    const vw = targetView ? targetView.width : 1;
    const vh = targetView ? targetView.height : 1;
    const sx = (vx + (scratchView.x * 0.5 + 0.5) * vw) * rect.width;
    const sy = (vy + (-scratchView.y * 0.5 + 0.5) * vh) * rect.height;
    const visible = Boolean(
      inFront &&
      scratchView.z >= -1 && scratchView.z <= 1 &&
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

  function render(scene, _app = null) {
    if (contextLost) return;
    const world = getWorld(scene);
    const sceneSun = worldLighting?.sun ? worldSuns.get(world) ?? null : null;
    if (worldSunLight !== sceneSun) {
      worldSunLight = sceneSun;
      applySunShadowPreset(activeSunLight ?? worldSunLight, appliedPreset);
    }

    if (activeViews && activeViews.length > 0) {
      const rect = canvasRect();
      const rectW = Math.max(1, rect.width);
      const rectH = Math.max(1, rect.height);
      const prevAutoClear = renderer.autoClear;
      const prevToneMapping = renderer.toneMapping;
      const prevExposure = renderer.toneMappingExposure;
      const prevSkyLinear = activeSky?.linearOutput ?? false;
      try {
        if (postPipeline?.supported) {
          const forwardTm = resolveToneMappingConstant(THREE, toneMapping || 'aces');
          if (forwardTm !== null && 'toneMapping' in renderer) renderer.toneMapping = forwardTm;
          if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = baseExposure;
          activeSky?.setLinearOutput?.(false);
        }
        renderer.setScissorTest?.(false);
        renderer.setViewport?.(0, 0, rectW, rectH);
        renderer.clear?.(true, true, true);
        renderer.autoClear = false;
        renderer.setScissorTest?.(true);

        for (let i = 0; i < activeViews.length; i++) {
          const v = activeViews[i];
          const vw = Math.max(1, rectW * v.width);
          const vh = Math.max(1, rectH * v.height);
          const vx = rectW * v.x;
          const vyBottomUp = rectH - (v.y + v.height) * rectH;
          if ('aspect' in v.camera && Math.abs(v.camera.aspect - vw / vh) > 1e-4) {
            v.camera.aspect = vw / vh;
            v.camera.updateProjectionMatrix?.();
          }
          syncCameraMatrices(v.camera);
          culler3d.beginFrame(v.camera);
          renderer.setViewport?.(vx, vyBottomUp, vw, vh);
          renderer.setScissor?.(vx, vyBottomUp, vw, vh);
          renderer.render(world, v.camera);
        }
      } finally {
        renderer.setScissorTest?.(false);
        renderer.setViewport?.(0, 0, rectW, rectH);
        renderer.autoClear = prevAutoClear;
        if (postPipeline?.supported) {
          if ('toneMapping' in renderer) renderer.toneMapping = prevToneMapping;
          if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = prevExposure;
          activeSky?.setLinearOutput?.(prevSkyLinear);
        }
      }
      return;
    }

    syncCameraMatrices(camera);
    culler3d.beginFrame(camera);
    const viewScene = scene && viewWorlds.has(scene) ? viewWorlds.get(scene) : null;

    if (postPipeline) {
      if (activePostVolumes) {
        activePostVolumes.applyToPipeline(postPipeline, camera.position, { exposure: baseExposure });
      }
      postPipeline.render(world, camera, {
        viewScene,
        viewCamera: activeViewCamera,
        sunLight: activeSunLight ?? worldSunLight,
        dt: lastDtSeconds,
      });
      return;
    }

    if (viewScene && activeViewCamera) {
      const prevAutoClear = renderer.autoClear;
      const gl = renderer.getContext?.();
      try {
        renderer.render(world, camera);
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        renderer.render(viewScene, activeViewCamera);
      } finally {
        gl?.depthRange?.(0, 1);
        renderer.autoClear = prevAutoClear;
      }
      return;
    }

    renderer.render(world, camera);
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
    getWorld,
    getViewWorld,
    add(scene, object) { getWorld(scene).add(object); },
    remove(scene, object) { if (scene && worlds.has(scene)) getWorld(scene).remove(object); },
    addView(scene, object) { getViewWorld(scene).add(object); },
    removeView(scene, object) { if (scene && viewWorlds.has(scene)) getViewWorld(scene).remove(object); },
    setViewCamera(cam) { activeViewCamera = cam; },
    setSunLight(light) {
      activeSunLight = light;
      if (qualityController?.state?.preset) applyQualityToRenderer(qualityController.state.preset);
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
      return fitDirectionalShadowFrustum(THREE, light, { center, radius }, { ...options, sunDirection });
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
      qualityController?.sampleFrame(ms);
    },
    dispose() {
      canvas.removeEventListener?.('webglcontextlost', onContextLost, false);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored, false);
      registeredPalettes.clear();
      cleanupAll([
        ...ownedSuns,
        () => culler3d.dispose(),
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
 * @property {boolean} [cull=false] Enable frustum culling via the adapter.
 * @property {number} [cullRadius=0] Culling sphere radius (0 = derived), world units.
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
      this._effectiveRadius = cullRadius > 0 ? cullRadius : Math.max(0.5, Math.max(size, height, radius * 2) * 0.9);
      this.updateTransform();
    }
    onEnable() { this.scene?.app?.renderer?.add(this.scene, this.mesh); }
    start() { this.updateTransform(); }
    lateUpdate() {
      this.updateTransform();
      if (cull && this.mesh?.position) {
        const culler = this.scene?.app?.renderer?.culler3d;
        if (culler && culler.frustum?.hasPlanes) {
          this.mesh.visible = culler.testSphere(
            this.mesh.position.x, this.mesh.position.y, this.mesh.position.z, this._effectiveRadius,
          );
        }
      }
    }
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

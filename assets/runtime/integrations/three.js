import { Component } from '../core/component.js';
import { createAdaptiveQualityController, resolveQualityPreset } from './quality3d.js';
import { createPostPipeline3D, inspectWebGLCapabilities } from './post3d.js';
import { createSceneCuller3D } from './culling3d.js';
import { normalizeSplitViews, pickSplitView } from '../platform/input.js';

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

/** The Three.js namespace is injected; this module never imports Three itself. */
export function createThreeAdapter({
  THREE,
  canvas,
  width = 960,
  height = 540,
  pixelRatio = globalThis.devicePixelRatio || 1,
  cameraFov = 60,
  near = 0.1,
  far = 1000,
  background = 0x101820,
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
    if (preset && activeSunLight?.shadow?.mapSize) {
      const wanted = preset.shadowMapSize;
      if (Number.isFinite(wanted) && wanted > 0 && activeSunLight.shadow.mapSize.x !== wanted) {
        activeSunLight.shadow.mapSize.set?.(wanted, wanted);
        activeSunLight.shadow.map?.dispose?.();
        activeSunLight.shadow.map = null;
        activeSunLight.shadow.needsUpdate = true;
      }
    }
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
  let userQualityOnChange = null;
  if (quality3d !== null) {
    userQualityOnChange = quality3d.onChange ?? null;
    if (userQualityOnChange !== null && typeof userQualityOnChange !== 'function') {
      throw new TypeError('onChange must be a function');
    }
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
      onChange(state, reason) {
        applyQualityToRenderer(state.preset);
        postPipeline?.setPreset(state.preset);
        userQualityOnChange?.(state, reason);
      },
    });
  }

  function setQuality(mode) {
    if (!qualityController) {
      const caps = inspectWebGLCapabilities(renderer);
      qualityController = createAdaptiveQualityController({
        mode,
        device: { rendererName: caps.rendererName || '' },
        onChange(state, reason) {
          applyQualityToRenderer(state.preset);
          postPipeline?.setPreset(state.preset);
          userQualityOnChange?.(state, reason);
        },
      });
      applyQualityToRenderer(qualityController.state.preset);
      postPipeline?.setPreset(qualityController.state.preset);
      resize();
      return qualityController.state;
    }
    qualityController.setMode(mode);
    resize();
    return qualityController.state;
  }

  function getQuality() {
    return qualityController?.state?.tier ?? null;
  }

  if (post3d) {
    const postOptions = typeof post3d === 'object' ? post3d : {};
    postPipeline = createPostPipeline3D({
      THREE,
      renderer,
      width,
      height,
      preset: qualityController?.state?.preset,
      exposure: postOptions.exposure ?? baseExposure,
      ...(toneMapping && !postOptions.toneMapping ? { toneMapping } : {}),
      ...postOptions,
    });
  }

  applyQualityToRenderer(qualityController?.state?.preset ?? null);

  const camera = new THREE.PerspectiveCamera(cameraFov, width / height, near, far);
  camera.position.set(0, 4, 11);
  camera.lookAt?.(0, 0, 0);

  const worlds = new WeakMap();
  const viewWorlds = new WeakMap();
  let activeViews = null;
  let contextLost = false;
  let lastDtSeconds = 0;

  function getWorld(scene) {
    if (!worlds.has(scene)) {
      const world = new THREE.Scene();
      if (THREE.Color && 'background' in world) world.background = new THREE.Color(background);
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

  function resize() {
    const w = Math.max(1, canvas.clientWidth || width);
    const h = Math.max(1, canvas.clientHeight || height);
    const ratio = qualityController
      ? qualityController.planViewport(w, h, pixelRatio).pixelRatio
      : Math.max(1, Math.min(3, pixelRatio));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
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
    if (qualityController?.state?.preset) {
      applyQualityToRenderer(qualityController.state.preset);
      postPipeline?.setPreset(qualityController.state.preset);
    }
    postPipeline?.resize(Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)));
  }

  const onContextLost = (event) => {
    event?.preventDefault?.();
    contextLost = true;
    postPipeline?.handleContextLost?.();
  };
  const onContextRestored = () => {
    contextLost = false;
    postPipeline?.handleContextRestored?.();
    resize();
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
        sunLight: activeSunLight,
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
      if (Number.isFinite(ms) && ms > 0) lastDtSeconds = ms / 1000;
      if (qualityController?.sampleFrame(ms)) resize();
    },
    dispose() {
      canvas.removeEventListener?.('webglcontextlost', onContextLost, false);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored, false);
      registeredPalettes.clear();
      culler3d.dispose();
      postPipeline?.dispose?.();
      renderer.dispose();
    },
  };
}

/** Minimal renderer-owned 3D mesh component (not a physics body). */
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

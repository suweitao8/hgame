import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  Component,
  Entity,
  Scene,
  createGameApplication,
  defineProject,
} from '../assets/runtime/index.js';
import { QUALITY3D_PRESETS } from '../assets/runtime/integrations/quality3d.js';
import {
  SKY3D_PRESETS,
  createLightPool3D,
  createProceduralSky3D,
  fitDirectionalShadowFrustum,
} from '../assets/runtime/integrations/sky3d.js';
import {
  createPostPipeline3D,
  inspectWebGLCapabilities,
  refineQualityWithContext,
} from '../assets/runtime/integrations/post3d.js';
import {
  applyGeometricSpecularAA,
  createWorldAlignedMaterial,
  createWorldMaterialPalette,
} from '../assets/runtime/integrations/world-aligned-material.js';
import {
  cloneObject3DWithSkins,
  createModel3DProvider,
} from '../assets/runtime/integrations/model3d.js';
import { createThreeAdapter, createThreeMeshComponent } from '../assets/runtime/integrations/three.js';

function createPlatformStub() {
  return {
    input: { reset() {}, endFrame() {} },
    lifecycle: { on() { return () => {}; } },
    ready() {},
    dispose() {},
    diagnostics: { recordFrame() {}, reportError() {} },
  };
}

function createMockWebGL2Renderer({ rendererName = 'Mock RTX GPU', maxSamples = 4 } = {}) {
  const calls = [];
  const gl = {
    MAX_SAMPLES: 0x8d57,
    MAX_TEXTURE_SIZE: 0x0d33,
    depthRange(near, far) { calls.push(['depthRange', near, far]); },
    getParameter(param) {
      if (param === 0x8d57) return maxSamples;
      if (param === 0x0d33) return 8192;
      if (param === 'UNMASKED') return rendererName;
      return 0;
    },
    getExtension(name) {
      if (name === 'EXT_color_buffer_float') return {};
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 'UNMASKED' };
      return null;
    },
  };
  const renderer = {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 },
    shadowMap: { enabled: false, type: 0 },
    autoClear: true,
    toneMapping: 0,
    getContext: () => gl,
    setPixelRatio(r) { calls.push(['setPixelRatio', r]); },
    setSize(w, h) { calls.push(['setSize', w, h]); },
    setRenderTarget(rt) { calls.push(['setRenderTarget', rt ? `${rt.width}x${rt.height}` : 'screen']); },
    clear(c, d, s) { calls.push(['clear', c, d, s]); },
    clearDepth() { calls.push(['clearDepth']); },
    render(scene, camera) { calls.push(['render', scene.children?.length ?? 0, camera.isOrthographicCamera ? 'ortho' : 'persp']); },
    dispose() { calls.push(['dispose']); },
  };
  return { renderer, calls, gl };
}

test('one adaptive quality transition rebuilds the post pipeline once at the final drawing-buffer size', () => {
  const { renderer, calls } = createMockWebGL2Renderer();
  const allocations = [];
  const namespace = {
    ...THREE,
    WebGLRenderer: class { constructor() { return renderer; } },
    DepthTexture: class extends THREE.DepthTexture {
      constructor(w, h, type) { super(w, h, type); allocations.push([w, h]); }
    },
  };
  const notifications = [];
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 3840, clientHeight: 2160 }, pixelRatio: 2,
    quality3d: { mode: 'auto', sampleFrames: 2, settleMs: 0, settleAfterChangeMs: 0,
      onChange: () => notifications.push(allocations.at(-1)) }, post3d: true });
  const initial = allocations.at(-1);
  allocations.length = 0;
  calls.length = 0;
  adapter.recordFrameInterval(45);
  adapter.recordFrameInterval(45);
  assert.equal(allocations.length, 1, 'no intermediate targets at the old dimensions');
  assert.ok(allocations[0][0] < initial[0]);
  assert.equal(calls.filter(([name]) => name === 'setSize').length, 1);
  assert.deepEqual(notifications, allocations, 'callbacks see the applied size');
  allocations.length = 0;
  calls.length = 0;
  adapter.resize();
  assert.equal(allocations.length, 0, 'unchanged sizing must not recreate GPU targets');
  assert.equal(calls.filter(([name]) => name === 'setSize').length, 0);
  adapter.dispose();
});

test('the initial adapter quality controls post processing when both presets are supplied', () => {
  const { renderer } = createMockWebGL2Renderer();
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: namespace, canvas: { clientWidth: 640, clientHeight: 360 },
    quality3d: { mode: 'low' }, post3d: { preset: QUALITY3D_PRESETS.high },
  });
  assert.equal(adapter.postPipeline.preset.msaaSamples, 0);
  assert.equal(adapter.postPipeline.targets.hasHalfRT, false);
  adapter.dispose();
});

test('a quality change triggered by the sky hook leaves the latest post preset applied', () => {
  const { renderer } = createMockWebGL2Renderer();
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  let nextMode = null;
  const adapter = createThreeAdapter({
    THREE: namespace, canvas: { clientWidth: 640, clientHeight: 360 },
    quality3d: { mode: 'medium' }, post3d: true,
    sky: {
      setLinearOutput() {
        if (!nextMode) return;
        const requested = nextMode;
        nextMode = null;
        adapter.setQuality(requested);
      },
    },
  });
  nextMode = 'high';
  adapter.setQuality('low');
  assert.equal(adapter.getQuality(), 'high');
  assert.equal(adapter.postPipeline.preset.msaaSamples, QUALITY3D_PRESETS.high.msaaSamples);
  adapter.dispose();
});

test('sky3d presets, sky dome, tight texel-snapped shadow frustum and light pool lifecycle', () => {
  assert.deepEqual(Object.keys(SKY3D_PRESETS), ['day', 'goldenHour', 'overcast', 'dusk', 'night']);
  const sky = createProceduralSky3D(THREE, { preset: 'goldenHour' });
  assert.ok(sky.mesh.isMesh);
  assert.equal(sky.mesh.renderOrder, -1000);
  sky.setPreset('night');
  sky.update(0.5, { x: 10, y: 2, z: -5 });
  assert.equal(sky.mesh.position.x, 10);
  assert.equal(sky.uniforms.uTime.value, 0.5);

  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.shadow.mapSize.set(1024, 1024);
  const frustum = fitDirectionalShadowFrustum(THREE, sun, {
    min: [-12, -2, -14],
    max: [14, 10, 12],
  }, { snapToTexels: true, sunDirection: sky.sunDirection });
  assert.ok(frustum.right > frustum.left);
  assert.ok(frustum.top > frustum.bottom);
  assert.ok(frustum.far > frustum.near);
  assert.equal(sun.shadow.camera.left, frustum.left);

  const world = new THREE.Scene();
  const pool = createLightPool3D(THREE, world, { size: 3 });
  assert.equal(world.children.length, 3);
  assert.equal(pool.activeCount, 0);

  pool.flash({ x: 1, y: 2, z: 3, intensity: 8, duration: 0.1 });
  pool.flash({ x: 4, y: 2, z: 3, intensity: 4, duration: 0.2 });
  assert.equal(pool.activeCount, 2);
  assert.equal(world.children.length, 3, 'light pool never attaches new lights dynamically');

  pool.update(0.15);
  assert.equal(pool.activeCount, 1);
  pool.update(0.15);
  assert.equal(pool.activeCount, 0);

  assert.equal(pool.dispose(), true);
  assert.equal(sky.dispose(), true);
  assert.equal(world.children.length, 0);
});

test('post3d capability probing, WebGL1 fallback and full WebGL2 multi-pass composer', () => {
  // 1. Minimal non-WebGL2 renderer falls back cleanly to forward + viewmodel depthRange pass.
  const fallbackCalls = [];
  const fallbackRenderer = {
    capabilities: { isWebGL2: false, getMaxAnisotropy: () => 1 },
    autoClear: true,
    getContext: () => ({ depthRange: (a, b) => fallbackCalls.push(['depthRange', a, b]) }),
    clearDepth: () => fallbackCalls.push(['clearDepth']),
    render: (s) => fallbackCalls.push(['render', s.children.length]),
  };
  const fallbackCaps = inspectWebGLCapabilities(fallbackRenderer);
  assert.equal(fallbackCaps.isWebGL2, false);
  const fallbackPost = createPostPipeline3D({ THREE, renderer: fallbackRenderer, preset: QUALITY3D_PRESETS.low });
  assert.equal(fallbackPost.supported, false);
  const world = new THREE.Scene();
  const viewScene = new THREE.Scene();
  viewScene.add(new THREE.Object3D());
  const cam = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
  const viewCam = new THREE.PerspectiveCamera(50, 1.5, 0.02, 10);
  fallbackPost.render(world, cam, { viewScene, viewCamera: viewCam });
  assert.deepEqual(fallbackCalls, [
    ['render', 0],
    ['clearDepth'],
    ['depthRange', 0, 0.05],
    ['render', 1],
    ['depthRange', 0, 1],
  ]);
  fallbackPost.dispose();

  // 2. WebGL2 ultra pipeline allocates HDR + depth + half-res AO/vol + 4-mip bloom + LDR FXAA targets.
  const { renderer, calls } = createMockWebGL2Renderer({ rendererName: 'NVIDIA RTX 4080', maxSamples: 4 });
  const refined = refineQualityWithContext(null, renderer, {});
  assert.equal(refined.recommendedTier, 'high');
  assert.equal(refined.clampedMsaaSamples, 2);

  const post = createPostPipeline3D({
    THREE,
    renderer,
    width: 640,
    height: 360,
    preset: QUALITY3D_PRESETS.ultra,
    toneMapping: 'agx',
  });
  assert.equal(post.supported, true);
  assert.equal(post.targets.hasSceneRT, true);
  assert.equal(post.targets.hasHalfRT, true);
  assert.equal(post.targets.bloomMipCount, 4);
  assert.equal(post.targets.hasLdrRT, true);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2);
  sun.shadow.map = { texture: new THREE.Texture() };
  sun.shadow.matrix.identity();

  cam.updateMatrixWorld(true);
  post.setState({ damage: 0.35, focus: 0.5 });
  post.render(world, cam, { viewScene, viewCamera: cam, sunLight: sun, dt: 1 / 60 });

  const renderTargetsUsed = calls.filter(c => c[0] === 'setRenderTarget').map(c => c[1]);
  assert.equal(renderTargetsUsed[0], '640x360', 'scene HDR pass runs first');
  assert.ok(renderTargetsUsed.includes('320x180'), 'half-res SSAO/volumetric passes run');
  assert.ok(renderTargetsUsed.includes('40x22'), '4-mip downsampled bloom pyramid runs');
  assert.equal(renderTargetsUsed.at(-1), 'screen', 'final output restores screen render target');

  // Context loss tears down GPU targets, restore rebuilds them.
  post.handleContextLost();
  assert.equal(post.targets.hasSceneRT, false);
  post.handleContextRestored();
  assert.equal(post.targets.hasSceneRT, true);

  // Switching to low preset frees half-res & bloom targets.
  post.setPreset(QUALITY3D_PRESETS.low);
  assert.equal(post.targets.hasHalfRT, false);
  assert.equal(post.targets.bloomMipCount, 0);

  assert.equal(post.dispose(), true);
});

test('world-aligned materials support opt-in Specular AA and anisotropy scaling', () => {
  const mat = createWorldAlignedMaterial(THREE, {
    pattern: 'stone',
    projection: 'triplanar',
    specularAA: true,
    anisotropy: 8,
  });
  assert.ok(mat.userData.specularAA);
  assert.equal(mat.userData.worldAligned.texture.anisotropy, 8);

  const std = new THREE.MeshStandardMaterial({ roughness: 0.25 });
  applyGeometricSpecularAA(std, { strength: 1.5, maxRoughnessBoost: 0.3 });
  assert.match(std.customProgramCacheKey(), /specaa/);
  const mockShader = {
    uniforms: {},
    fragmentShader: 'void main() {\n#include <lights_physical_fragment>\n}',
  };
  std.onBeforeCompile(mockShader, {});
  assert.ok(mockShader.uniforms.uSpecAAStrength.value === 1.5);
  assert.match(mockShader.fragmentShader, /dFdx\(normal\)/);

  const palette = createWorldMaterialPalette(THREE, {
    floor: { pattern: 'concrete', projection: 'planar', normalStrength: 0.4 },
  }, { anisotropy: 4 });
  palette.setAnisotropy(16);
  assert.equal(palette.get('floor').userData.worldAligned.texture.anisotropy, 16);
  assert.equal(palette.get('floor').userData.worldAligned.detailTexture.anisotropy, 16);
  palette.dispose();
  mat.dispose();
  std.dispose();
});

test('model3d clones SkinnedMesh skeletons independently and drives AnimationMixer in App', async () => {
  // Build an in-memory rigged SkinnedMesh + AnimationClip.
  const rootBone = new THREE.Bone();
  rootBone.name = 'RootBone';
  const childBone = new THREE.Bone();
  childBone.name = 'ArmBone';
  childBone.position.set(0, 1, 0);
  rootBone.add(childBone);

  const geom = new THREE.BoxGeometry(1, 2, 1);
  const posAttr = geom.attributes.position;
  const skinIndices = [];
  const skinWeights = [];
  for (let i = 0; i < posAttr.count; i++) {
    skinIndices.push(0, 1, 0, 0);
    skinWeights.push(0.5, 0.5, 0, 0);
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const protoScene = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x88ccaa });
  const skinned = new THREE.SkinnedMesh(geom, mat);
  protoScene.add(rootBone);
  protoScene.add(skinned);
  const protoSkeleton = new THREE.Skeleton([rootBone, childBone]);
  skinned.bind(protoSkeleton);

  const clip = new THREE.AnimationClip('Wave', 1.0, [
    new THREE.NumberKeyframeTrack('ArmBone.rotation[z]', [0, 0.5, 1.0], [0, 1.2, 0]),
  ]);

  // Direct skin cloning keeps source bones isolated from clone animations.
  const clonedA = cloneObject3DWithSkins(THREE, protoScene);
  const clonedSkinned = clonedA.children.find(c => c.isSkinnedMesh);
  assert.ok(clonedSkinned);
  assert.notEqual(clonedSkinned.skeleton, protoSkeleton);
  assert.notEqual(clonedSkinned.skeleton.bones[1], childBone);
  clonedSkinned.skeleton.bones[1].rotation.z = 0.99;
  assert.equal(childBone.rotation.z, 0, 'source prototype skeleton untouched');

  // Unsafe paths must reject.
  const provider = createModel3DProvider({ THREE });
  await assert.rejects(() => provider.load('https://evil.example/a.glb'), /relative project path/i);
  await assert.rejects(() => provider.load('../outside/a.glb'), /traversal/i);

  provider.registerAsset('assets/models/hero.glb', { scene: protoScene, animations: [clip], owned: true });
  const loaded = await provider.load('assets/models/hero.glb');

  const addedObjects = [];
  const project = defineProject({ profile: '3d', tickHz: 60, features: ['scene', 'model3d'] });
  const app = createGameApplication({
    project,
    platform: createPlatformStub(),
    renderer: {
      render() {},
      add(_scene, obj) { addedObjects.push(obj); },
      remove(_scene, obj) {
        const at = addedObjects.indexOf(obj);
        if (at !== -1) addedObjects.splice(at, 1);
      },
      dispose() {},
    },
  });
  await app.installFeatures({ model3d: provider });

  const scene = app.scenes.add(new Scene('rig'));
  const actor = scene.add(new Entity({ x: 3, y: 0, z: -2 }));
  const modelComp = actor.addComponent(provider.createComponent({
    asset: loaded,
    clip: 'Wave',
    offsetY: 0.5,
    scale: 2,
    castShadow: true,
  }));

  app.scenes.start('rig');
  assert.equal(addedObjects.length, 1);
  assert.deepEqual(modelComp.getClipNames(), ['Wave']);

  app.step(0.25);
  app.step(0.25);
  const animatedArm = modelComp.modelRoot.getObjectByName('ArmBone');
  assert.ok(Math.abs(animatedArm.rotation.z - 1.2) < 0.05, `expected ArmBone animated near 1.2, got ${animatedArm.rotation.z}`);
  assert.ok(Math.abs(modelComp.object3d.position.x - 3) < 1e-6);

  modelComp.stop();
  app.dispose();
  await assert.rejects(() => provider.load('assets/models/other.glb'), /disposed/i);
  assert.equal(await provider.dispose(), false, 'app.dispose already disposed installed model3d provider');
});

test('Three adapter picking, context loss guard and shared material ownership', () => {
  const { renderer, calls } = createMockWebGL2Renderer({ rendererName: 'NVIDIA RTX 4070', maxSamples: 4 });
  class MockWebGLRenderer {
    constructor({ canvas }) {
      this.domElement = canvas;
      this.capabilities = renderer.capabilities;
      this.shadowMap = renderer.shadowMap;
      this.autoClear = true;
      this.toneMapping = 0;
    }
    getContext() { return renderer.getContext(); }
    setPixelRatio(r) { renderer.setPixelRatio(r); }
    setSize(w, h) { renderer.setSize(w, h); }
    setRenderTarget(rt) { renderer.setRenderTarget(rt); }
    clear(c, d, s) { renderer.clear(c, d, s); }
    clearDepth() { renderer.clearDepth(); }
    render(s, c) { renderer.render(s, c); }
    dispose() { renderer.dispose(); }
  }
  const MockTHREE = { ...THREE, WebGLRenderer: MockWebGLRenderer };
  const listeners = new Map();
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };

  const adapter = createThreeAdapter({
    THREE: MockTHREE,
    canvas,
    width: 800,
    height: 600,
    pixelRatio: 1,
    quality3d: { mode: 'auto', calibrateGpu: true },
    post3d: { toneMapping: 'aces' },
  });
  assert.equal(adapter.qualityController.state.tier, 'high');
  assert.equal(adapter.postPipeline.supported, true);

  adapter.camera.position.set(0, 5, 10);
  adapter.camera.lookAt(0, 0, 0);
  const projected = adapter.worldToScreen(1, 0, -2);
  assert.equal(projected.visible, true);

  const ray = adapter.screenToRay(projected.x, projected.y);
  // Ray origin -> direction must pass close to (1, 0, -2).
  const distToTarget = Math.hypot(1 - ray.origin.x, 0 - ray.origin.y, -2 - ray.origin.z);
  const hitX = ray.origin.x + ray.direction.x * distToTarget;
  const hitY = ray.origin.y + ray.direction.y * distToTarget;
  const hitZ = ray.origin.z + ray.direction.z * distToTarget;
  assert.ok(Math.hypot(hitX - 1, hitY - 0, hitZ + 2) < 1e-4);

  const scene = new Scene('lost');
  const beforeLostCount = calls.filter(c => c[0] === 'render').length;
  listeners.get('webglcontextlost')?.({ preventDefault() {} });
  assert.equal(adapter.contextLost, true);
  adapter.render(scene);
  assert.equal(calls.filter(c => c[0] === 'render').length, beforeLostCount);
  listeners.get('webglcontextrestored')?.();
  assert.equal(adapter.contextLost, false);

  // Custom shared geometry/material must NOT be disposed when Mesh3D destroys.
  let sharedMatDisposed = false;
  let sharedGeoDisposed = false;
  const sharedGeo = new THREE.BoxGeometry(1, 1, 1);
  sharedGeo.dispose = () => { sharedGeoDisposed = true; };
  const sharedMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  sharedMat.dispose = () => { sharedMatDisposed = true; };

  const ent = scene.add(new Entity({ x: 1, y: 2, z: 3 }));
  scene.app = { renderer: adapter, renderAlpha: 1 };
  scene._setActive(true);
  ent.addComponent(createThreeMeshComponent(MockTHREE, { geometry: sharedGeo, material: sharedMat }));
  scene.dispose();
  assert.equal(sharedGeoDisposed, false);
  assert.equal(sharedMatDisposed, false);

  adapter.dispose();
  assert.equal(listeners.size, 0);
});

test('Three adapter fitShadowToPreset fits directional shadow camera from quality preset shadowDistance', () => {
  const { renderer } = createMockWebGL2Renderer({ rendererName: 'NVIDIA RTX 4070', maxSamples: 4 });
  class MockWebGLRenderer {
    constructor({ canvas }) {
      this.domElement = canvas;
      this.capabilities = renderer.capabilities;
      this.shadowMap = renderer.shadowMap;
      this.autoClear = true;
      this.toneMapping = 0;
    }
    getContext() { return renderer.getContext(); }
    setPixelRatio(r) { renderer.setPixelRatio(r); }
    setSize(w, h) { renderer.setSize(w, h); }
    setRenderTarget(rt) { renderer.setRenderTarget(rt); }
    clear(c, d, s) { renderer.clear(c, d, s); }
    clearDepth() { renderer.clearDepth(); }
    render(s, c) { renderer.render(s, c); }
    dispose() { renderer.dispose(); }
  }
  const MockTHREE = { ...THREE, WebGLRenderer: MockWebGLRenderer };
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener() {},
    removeEventListener() {},
  };

  const adapter = createThreeAdapter({
    THREE: MockTHREE,
    canvas,
    width: 800,
    height: 600,
    pixelRatio: 1,
    quality3d: { mode: 'low' },
  });

  // Null sun without activeSunLight returns null cleanly
  assert.equal(adapter.fitShadowToPreset(null, { x: 0, y: 0, z: 0 }), null);

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(12, 24, 16);
  sun.shadow.mapSize.set(1024, 1024);
  adapter.setSunLight(sun);

  const lowDist = QUALITY3D_PRESETS.low.shadowDistance;
  const frustumLow = adapter.fitShadowToPreset(undefined, { x: 10, y: 0, z: -5 });
  assert.ok(frustumLow);
  const lowSpan = frustumLow.right - frustumLow.left;
  assert.ok(lowSpan >= lowDist && lowSpan < QUALITY3D_PRESETS.high.shadowDistance * 2);

  adapter.setQuality('high');
  const frustumHigh = adapter.fitShadowToPreset(sun, [10, 0, -5], { snapToTexels: true });
  const highSpan = frustumHigh.right - frustumHigh.left;
  assert.ok(highSpan > lowSpan, `Expected high tier span (${highSpan}) > low tier span (${lowSpan})`);
  assert.equal(sun.shadow.camera.left, frustumHigh.left);
  assert.equal(sun.shadow.camera.right, frustumHigh.right);

  adapter.dispose();
});

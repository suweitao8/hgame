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

test('split Three views use pane-sized HDR targets, isolated exposure, and physical output rectangles', () => {
  const { renderer, calls } = createMockWebGL2Renderer();
  const passes = [];
  const released = [];
  let target = null;
  let viewport;
  let scissor;
  let scissorEnabled = false;
  renderer.setViewport = (...rect) => { viewport = rect; };
  renderer.setScissor = (...rect) => { scissor = rect; };
  renderer.setScissorTest = enabled => { scissorEnabled = enabled; };
  renderer.setRenderTarget = next => { target = next; };
  renderer.render = (scene, camera) => passes.push({ camera, target, viewport, scissor, scissorEnabled,
    material: scene.children?.[0]?.material,
    exposure: scene.children?.[0]?.material?.uniforms?.uExposure?.value,
    previousAdapt: scene.children?.[0]?.material?.uniforms?.tPrevAdapt?.value,
    previousGi: scene.children?.[0]?.material?.uniforms?.tHistory?.value });
  const namespace = { ...THREE,
    WebGLRenderer: class { constructor() { return renderer; } },
    WebGLRenderTarget: class extends THREE.WebGLRenderTarget {
      dispose() { released.push(this); super.dispose(); }
    },
  };
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 901, clientHeight: 600 },
    pixelRatio: 1, post3d: { autoExposure: true, fxaa: false, sharpness: 0, temporalGiSsr: true, preset: { ssgi: true } } });
  const scene = new Scene('split-hdr');
  const left = new THREE.PerspectiveCamera();
  const right = new THREE.PerspectiveCamera();
  left.position.x = -1;
  right.position.x = 1;
  adapter.setPostVolumes({ applyToPipeline(pipeline, position) {
    pipeline.setState({ exposure: position.x < 0 ? 0.5 : 2 });
  } });
  adapter.setViews([{ camera: left, width: 0.5 }, { camera: right, x: 0.5, width: 0.5 }]);
  adapter.render(scene);
  const draws = passes.filter(pass => pass.camera === left || pass.camera === right);
  assert.deepEqual(draws.map(({ target }) => [target?.width, target?.height]), [[451, 600], [450, 600]]);
  const outputs = passes.filter(pass => !pass.target);
  assert.deepEqual(outputs.map(pass => [pass.viewport, pass.scissor, pass.scissorEnabled, pass.exposure]), [
    [[0, 0, 451, 600], [0, 0, 451, 600], true, 0.5],
    [[451, 0, 450, 600], [451, 0, 450, 600], true, 2],
  ]);
  const history = passes.filter(pass => pass.previousAdapt).map(pass => [pass.previousAdapt, pass.target.texture]);
  assert.equal(history.length, 2);
  assert.notEqual(history[0][0], history[1][0]);
  assert.equal(scissorEnabled, false);
  assert.deepEqual(viewport, [0, 0, 901, 600]);
  assert.equal(renderer.autoClear, true);

  // Rewiring the same pane identities retains history across frames.
  passes.length = 0;
  adapter.setViews([{ camera: left, width: 0.5 }, { camera: right, x: 0.5, width: 0.5 }]);
  adapter.render(scene);
  assert.deepEqual(passes.filter(pass => pass.previousAdapt).map(pass => pass.previousAdapt), history.map(pair => pair[1]));
  assert.equal(passes.filter(pass => pass.previousGi).length, 2);
  assert.deepEqual([adapter.postPipeline.targets.bufferWidth, adapter.postPipeline.targets.bufferHeight], [1, 1]);

  adapter.postPipeline.resetGiSsrHistory();
  passes.length = 0;
  adapter.render(scene);
  assert.equal(passes.filter(pass => pass.previousGi).length, 0);

  adapter.setPostVolumes(null);
  adapter.setExposure(1.25);
  adapter.postPipeline.setState({ fxaa: true });
  const effect = new THREE.ShaderMaterial({ uniforms: { inputColor: { value: null } } });
  adapter.postPipeline.setPasses([{ id: 'game-effect', material: effect, inputs: { color: 'inputColor' } }]);
  passes.length = 0;
  adapter.render(scene);
  assert.deepEqual(passes.filter(pass => pass.exposure === 1.25).map(pass => pass.target?.width), [451, 450]);
  assert.deepEqual(passes.filter(pass => !pass.target).map(pass => pass.viewport), [[0, 0, 451, 600], [451, 0, 450, 600]]);
  assert.deepEqual(passes.filter(pass => pass.material === effect).map(pass => pass.target.width), [451, 450]);
  adapter.setViews(null);
  assert.ok(draws.every(pass => released.includes(pass.target)));
  adapter.render(scene);
  assert.ok(passes.some(pass => pass.camera === adapter.camera && pass.target?.width === 901));
  adapter.dispose();
  assert.equal(calls.filter(([name]) => name === 'dispose').length, 1);
});

test('custom HDR passes declare color and depth dependencies and chain owned targets safely', () => {
  const { renderer } = createMockWebGL2Renderer();
  const source = { value: 'caller-color' };
  const depth = { value: 'caller-depth' };
  const first = new THREE.ShaderMaterial({ uniforms: { colorInput: source, depthInput: depth } });
  const second = new THREE.ShaderMaterial({ uniforms: { colorInput: source } });
  const descriptors = [
    { id: 'fog', material: first, inputs: { color: 'colorInput', depth: 'depthInput' } },
    { id: 'tint', material: second, inputs: { color: 'colorInput' } },
    { id: 'glare', material: second, inputs: { color: 'colorInput' } },
  ];
  let target = null;
  let sceneTarget;
  let overlayTarget;
  let outputColor;
  let disposedMaterials = 0;
  const draws = [];
  first.addEventListener('dispose', () => disposedMaterials++);
  second.addEventListener('dispose', () => disposedMaterials++);
  const world = new THREE.Scene();
  const overlay = new THREE.Scene();
  overlay.add(new THREE.Object3D());
  const camera = new THREE.PerspectiveCamera();
  renderer.setRenderTarget = next => { target = next; };
  renderer.render = (scene) => {
    if (scene === world) sceneTarget = target;
    if (scene === overlay) overlayTarget = target;
    const material = scene.children[0]?.material;
    if (material === first || material === second) draws.push({ material, target, input: source.value, depth: depth.value });
    else if (target === null) outputColor = material?.uniforms?.tScene?.value;
  };
  const make = () => createPostPipeline3D({ THREE, renderer, width: 320, height: 180,
    preset: QUALITY3D_PRESETS.low, sharpness: 0, fxaa: false, passes: descriptors });
  const pipeline = make();
  pipeline.render(world, camera, { viewScene: overlay, viewCamera: camera });
  assert.equal(draws.length, 3);
  assert.notEqual(overlayTarget, sceneTarget);
  assert.equal(draws[0].input, overlayTarget.texture);
  assert.equal(draws[0].depth, sceneTarget.depthTexture);
  assert.equal(sceneTarget.resolveDepthBuffer, true);
  assert.strictEqual(draws[1].input, draws[0].target.texture);
  assert.strictEqual(draws[2].input, draws[1].target.texture);
  assert.strictEqual(draws[0].target, draws[2].target);
  assert.notStrictEqual(draws[0].target, draws[1].target);
  assert.strictEqual(outputColor, draws[2].target.texture);
  assert.equal(source.value, 'caller-color');
  assert.equal(depth.value, 'caller-depth');
  const originalPasses = pipeline.passes;
  assert.throws(() => pipeline.setPasses([descriptors[0], descriptors[0]]), /duplicate/i);
  assert.strictEqual(pipeline.passes, originalPasses);
  let disposedTargets = 0;
  draws[0].target.addEventListener('dispose', () => disposedTargets++);
  draws[1].target.addEventListener('dispose', () => disposedTargets++);
  pipeline.setPasses([]);
  assert.equal(disposedTargets, 2);
  pipeline.dispose();

  draws.length = 0;
  renderer.capabilities.logarithmicDepthBuffer = true;
  const noDepth = make();
  noDepth.render(world, camera);
  assert.deepEqual(draws.map(draw => draw.material), [second, second]);
  assert.equal(draws[0].input, sceneTarget.texture);
  noDepth.dispose();
  assert.equal(disposedMaterials, 0);
});

test('Three diagnostics report named passes, unique target usage and asynchronous GPU sample identity', () => {
  const { renderer, gl } = createMockWebGL2Renderer();
  const extension = { TIME_ELAPSED_EXT: 100, QUERY_COUNTER_BITS_EXT: 101, GPU_DISJOINT_EXT: 102 };
  const previousExtension = gl.getExtension;
  const previousParameter = gl.getParameter;
  let active = null;
  let resultsReady = false;
  let disjoint = false;
  let resultReads = 0;
  Object.assign(gl, {
    CURRENT_QUERY: 103, QUERY_RESULT_AVAILABLE: 104, QUERY_RESULT: 105,
    getExtension: name => name === 'EXT_disjoint_timer_query_webgl2' ? extension : previousExtension(name),
    getParameter: key => key === extension.GPU_DISJOINT_EXT ? disjoint : previousParameter(key),
    getQuery: (target, key) => key === extension.QUERY_COUNTER_BITS_EXT ? 64 : active,
    createQuery: () => ({}), deleteQuery() {},
    beginQuery(target, query) { assert.equal(active, null); active = query; },
    endQuery() { assert.ok(active); active = null; },
    getQueryParameter(query, key) {
      if (key === this.QUERY_RESULT_AVAILABLE) return resultsReady;
      assert.ok(resultsReady, 'never read the result until available');
      resultReads++;
      return 2_500_000;
    },
  });
  const counts = { calls: 99, triangles: 99 };
  renderer.info = { autoReset: true, render: counts, reset() { counts.calls = counts.triangles = 0; } };
  renderer.render = () => { counts.calls++; counts.triangles += 3; };
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const effect = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null } } });
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 320, clientHeight: 180 }, pixelRatio: 1,
    diagnostics3d: true, post3d: { fxaa: false, sharpness: 0, preset: QUALITY3D_PRESETS.low,
      passes: [{ id: 'tint', material: effect, inputs: { color: 'tColor' } }] } });
  const scene = new Scene('diagnostics');
  assert.equal(adapter.getRenderDiagnostics(), null);
  adapter.render(scene);
  const first = adapter.getRenderDiagnostics();
  assert.equal(first.frame, 1);
  assert.equal(first.complete, true);
  assert.equal(first.drawCalls, 3);
  assert.equal(first.triangles, 9);
  assert.ok(first.cpuMs >= 0);
  assert.deepEqual(first.passes.map(pass => [pass.name, pass.viewIndex, pass.drawCalls]), [
    ['world', 0, 1], ['custom:tint', 0, 1], ['tone-mapping', 0, 1],
  ]);
  assert.equal(first.passes[2].target, null);
  assert.equal(first.targets.length, 2);
  assert.equal(first.estimatedTargetBytes, first.targets.reduce((sum, target) => sum + target.bytes, 0));
  assert.equal(resultReads, 0);
  assert.deepEqual(first.gpu.samples, []);
  assert.equal(renderer.info.autoReset, true);

  resultsReady = true;
  adapter.render(scene);
  const second = adapter.getRenderDiagnostics();
  assert.deepEqual(second.gpu.samples.map(sample => [sample.frame, sample.name, sample.status, sample.ms]),
    [[1, 'frame', 'ready', 2.5]]);
  adapter.render(scene);
  const third = adapter.getRenderDiagnostics();
  assert.deepEqual(third.gpu.samples.map(sample => [sample.frame, sample.name, sample.status, sample.ms]),
    [[1, 'frame', 'ready', 2.5], [2, 'world', 'ready', 2.5]]);
  assert.equal(third.gpu.samples[1].passIndex, 0);
  assert.deepEqual(first.gpu.samples, []);
  disjoint = true;
  adapter.render(scene);
  assert.deepEqual(adapter.getRenderDiagnostics().gpu.samples.at(-1),
    { frame: 3, name: 'frame', viewIndex: null, passIndex: null, status: 'disjoint', ms: null });
  renderer.render = () => { throw new Error('simulated draw failure'); };
  assert.throws(() => adapter.render(scene), /simulated draw failure/);
  assert.equal(adapter.getRenderDiagnostics().complete, false);
  assert.equal(renderer.info.autoReset, true);
  assert.equal(active, null);
  adapter.dispose();
});

test('Three diagnostics keep forward draw counts when GPU timing is unavailable', () => {
  const { renderer } = createMockWebGL2Renderer();
  const counts = { calls: 12, triangles: 30 };
  renderer.info = { autoReset: false, render: counts };
  let drewAuxiliary = false;
  renderer.render = () => {
    counts.calls++;
    counts.triangles += 3;
    if (!drewAuxiliary) {
      drewAuxiliary = true;
      adapter.render(new Scene('auxiliary-draw'));
    }
  };
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({ THREE: namespace, canvas: {}, pixelRatio: 1, diagnostics3d: true });
  adapter.render(new Scene('forward-diagnostics'));
  const report = adapter.getRenderDiagnostics();
  assert.deepEqual(report.passes.map(pass => [pass.name, pass.drawCalls, pass.triangles]), [['forward', 2, 6]]);
  assert.equal(report.estimatedTargetBytes, 0);
  assert.deepEqual(report.gpu, { supported: false, samples: [] });
  assert.deepEqual(counts, { calls: 14, triangles: 36 });
  assert.equal(renderer.info.autoReset, false);
  adapter.dispose();
});

test('Three diagnostics account for frame and pass buffer and texture upload payloads', () => {
  const { renderer, gl } = createMockWebGL2Renderer();
  const calls = { buffer: 0, texture: 0 };
  const bufferData = function () { assert.equal(this, gl); calls.buffer++; };
  const texSubImage2D = function () { assert.equal(this, gl); calls.texture++; };
  Object.assign(gl, { RGBA: 6408, FLOAT: 5126, bufferData, texSubImage2D,
    texImage2D() { calls.texture++; }, compressedTexImage2D() { calls.texture++; } });
  Object.defineProperty(gl, 'texImage3D', { get() { throw new Error('native method unavailable'); } });
  const shared = new Float32Array(128);
  const image = new Uint32Array(10);
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({ THREE: namespace, canvas: {}, pixelRatio: 1, diagnostics3d: true,
    post3d: { preset: QUALITY3D_PRESETS.low, fxaa: false, sharpness: 0 } });
  renderer.render = (scene, camera) => {
    if (camera === adapter.camera) {
      gl.bufferData(0, shared, 0, 2, 4);
      gl.bufferData(0, 128, 0);
      gl.texSubImage2D(0, 0, 0, 0, 3, 1, gl.RGBA, gl.FLOAT, shared);
    } else {
      gl.compressedTexImage2D(0, 0, 0, 4, 4, 0, image, 1, 3);
      gl.texImage2D(0, 0, 0, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
      gl.texSubImage2D(0, 0, 0, 0, 1, 1, -7, gl.FLOAT, shared);
    }
  };
  adapter.render(new Scene('upload-diagnostics'));
  const report = adapter.getRenderDiagnostics();
  assert.deepEqual(report.uploads, { bufferBytes: 16, textureBytes: 60, calls: 4, unmeasuredCalls: 1 });
  assert.deepEqual(report.passes.map(pass => pass.uploads), [
    { bufferBytes: 16, textureBytes: 48, calls: 2, unmeasuredCalls: 0 },
    { bufferBytes: 0, textureBytes: 12, calls: 2, unmeasuredCalls: 1 },
  ]);
  assert.deepEqual(calls, { buffer: 2, texture: 4 });
  assert.equal(gl.bufferData, bufferData);
  assert.equal(gl.texSubImage2D, texSubImage2D);
  adapter.dispose();
});

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

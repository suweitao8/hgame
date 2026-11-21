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
import { createAdaptiveQualityController, QUALITY3D_PRESETS } from '../assets/runtime/integrations/quality3d.js';
import {
  SKY3D_PRESETS,
  createLightPool3D,
  createProceduralSky3D,
  fitDirectionalShadowFrustum,
} from '../assets/runtime/integrations/sky3d.js';
import {
  compileRenderGraph,
  createFullscreenShaderPass,
  createPostPipeline3D,
  executeRenderGraph,
  inspectWebGLCapabilities,
  refineQualityWithContext,
} from '../assets/runtime/integrations/post3d.js';
import { FULLSCREEN_PASSES, validateFullscreenPass } from '../assets/runtime/integrations/post3d/pass-contracts.js';
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
  adapter.postPipeline.setState({ temporalAA: true });
  passes.length = 0;
  adapter.render(scene);
  const taa = pass => pass.material?.uniforms?.tPreviousDepth;
  assert.deepEqual(passes.filter(taa).map(pass => pass.target.width), [451, 450]);
  const firstTemporalTargets = passes.filter(taa).map(pass => pass.target);
  passes.length = 0;
  adapter.render(scene);
  assert.ok(passes.filter(taa).every((pass, index) => pass.target !== firstTemporalTargets[index]));
  adapter.postPipeline.resetTemporalHistory();
  passes.length = 0;
  adapter.render(scene);
  assert.deepEqual(passes.filter(taa).map(pass => pass.material.uniforms.uHistoryWeight.value), [0, 0]);
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

test('fullscreen shader passes receive camera-matched depth inputs and preserve material state', () => {
  const { renderer } = createMockWebGL2Renderer();
  const world = new THREE.Scene();
  const depthShader = createFullscreenShaderPass(THREE, {
    id: 'depth-fog', sceneDepth: true,
    fragment: 'vec4 shadeFullscreen(vec2 uv) { return vec4(hgameSceneLinearDepth(uv)); }',
  });
  const colorShader = createFullscreenShaderPass(THREE, {
    id: 'copy', fragment: 'vec4 shadeFullscreen(vec2 uv) { return hgameSceneColor(uv); }',
  });
  const { material, inputs } = depthShader;
  const uniforms = material.uniforms;
  const view = inputs.depthView;
  const projection = new THREE.Matrix4();
  uniforms[view.inverseProjection].value = projection;
  uniforms[view.clipDepthMode].value = -1;
  uniforms[view.far].value = 9;
  const originalColor = { isTexture: true };
  uniforms[inputs.color].value = originalColor;

  let target;
  let worldTarget;
  let worldProjection;
  const bound = [];
  let colorDraws = 0;
  let fail = false;
  renderer.setRenderTarget = next => { target = next; };
  renderer.render = (scene, camera) => {
    if (scene === world) {
      worldTarget = target;
      worldProjection = camera.projectionMatrixInverse.clone();
    }
    if (scene.children[0]?.material === material) {
      assert.equal(uniforms[inputs.depth].value, worldTarget.depthTexture);
      assert.ok(uniforms[view.inverseProjection].value.equals(worldProjection));
      bound.push([uniforms[view.clipDepthMode].value, uniforms[view.far].value]);
      if (fail) throw new Error('draw interrupted');
    }
    if (scene.children[0]?.material === colorShader.material) colorDraws++;
  };
  const make = () => createPostPipeline3D({ THREE, renderer, width: 64, height: 32,
    preset: QUALITY3D_PRESETS.low, fxaa: false, sharpness: 0, temporalAA: true, passes: [depthShader, colorShader] });
  const pipeline = make();
  const perspective = new THREE.PerspectiveCamera(40, 2, 0.5, 68);
  const ortho = new THREE.OrthographicCamera(-4, 4, 2, -2, 1, 30);
  ortho.coordinateSystem = THREE.WebGPUCoordinateSystem;
  ortho.updateProjectionMatrix();
  pipeline.render(world, perspective, { dt: 0.016 });
  pipeline.render(world, ortho, { dt: 0.016 });
  assert.deepEqual(bound, [[0, 68], [1, 30]]);
  assert.equal(uniforms[inputs.color].value, originalColor);
  assert.equal(uniforms[inputs.depth].value, null);
  assert.equal(uniforms[view.inverseProjection].value, projection);
  assert.equal(uniforms[view.clipDepthMode].value, -1);
  assert.equal(uniforms[view.far].value, 9);
  assert.throws(() => pipeline.setPasses([{ ...depthShader, inputs: { ...inputs,
    depthView: { ...view, far: inputs.color } } }]), /uniform/i);
  fail = true;
  assert.throws(() => pipeline.render(world, perspective), /draw interrupted/);
  assert.equal(uniforms[view.inverseProjection].value, projection);
  assert.equal(uniforms[view.far].value, 9);
  pipeline.dispose();

  renderer.capabilities.logarithmicDepthBuffer = true;
  const noDepth = make();
  noDepth.render(world, perspective);
  assert.equal(bound.length, 3, 'missing sampleable depth skips the depth pass');
  assert.equal(colorDraws, 3, 'the color-only pass still runs without depth');
  noDepth.dispose();
  depthShader.material.dispose();
  colorShader.material.dispose();
});

test('3D passes reuse released HDR targets without reading their own output', () => {
  const { renderer } = createMockWebGL2Renderer();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const effect = new THREE.ShaderMaterial({ uniforms: { inputColor: { value: null } } });
  const pipeline = createPostPipeline3D({ THREE, renderer, width: 320, height: 180,
    preset: { ...QUALITY3D_PRESETS.low, ssao: true }, temporalAA: true, fxaa: false, sharpness: 0,
    passes: [{ id: 'test', material: effect, inputs: { color: 'inputColor' } }] });
  const draws = new Map();
  const diagnostics = { beginPass(name, target) {
    draws.set(name, target);
    return () => {};
  }, recordTarget() {} };

  pipeline.render(world, camera, { diagnostics });
  const scratch = draws.get('custom:test');
  assert.equal(draws.get('world-lighting'), scratch);
  assert.notEqual(draws.get('temporal-aa'), scratch);
  pipeline.render(world, camera, { diagnostics });
  assert.equal(draws.get('world-lighting'), scratch);
  assert.equal(draws.get('custom:test'), scratch);
  let disposed = 0;
  scratch.addEventListener('dispose', () => disposed++);
  pipeline.resize(640, 360);
  assert.equal(disposed, 1);
  pipeline.render(world, camera, { diagnostics });
  assert.equal(draws.get('custom:test').width, 640);
  assert.equal(draws.get('world-lighting'), draws.get('custom:test'));

  // A caller texture can be bound through a sampler array or struct.
  const extraUniform = { value: [] };
  effect.uniforms.extraTextures = extraUniform;
  const beginPass = diagnostics.beginPass;
  diagnostics.beginPass = (name, target) => {
    if (name === 'world-lighting') extraUniform.value = [{ map: target.texture }];
    return beginPass(name, target);
  };
  pipeline.render(world, camera, { diagnostics });
  assert.notEqual(draws.get('world-lighting'), draws.get('custom:test'));

  pipeline.dispose();
});

test('fullscreen pass contracts enforce required inputs, writable outputs and feedback safety', () => {
  const target = { texture: new THREE.Texture(), depthTexture: new THREE.DepthTexture(1, 1) };
  const uniforms = { tCurrentColor: { value: new THREE.Texture() }, tCurrentDepth: { value: null },
    tPreviousDepth: { value: null } };
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.temporalAA, uniforms, target), /requires tCurrentDepth/);
  uniforms.tCurrentDepth.value = new THREE.DepthTexture(1, 1);
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.temporalAA, uniforms, { texture: target.texture }), /color-depth output/);
  assert.doesNotThrow(() => validateFullscreenPass(FULLSCREEN_PASSES.temporalAA, uniforms, target));
  uniforms.tPreviousDepth.value = target.depthTexture;
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.temporalAA, uniforms, target), /own output through tPreviousDepth/);
  const toneMapping = FULLSCREEN_PASSES.toneMapping;
  assert.throws(() => validateFullscreenPass(toneMapping, { tScene: { value: target.texture } }, target), /own output through tScene/);
  assert.doesNotThrow(() => validateFullscreenPass(toneMapping, { tScene: { value: target.texture } }, null));
});

function createProbeAdapter() {
  const { renderer, gl } = createMockWebGL2Renderer();
  gl.MAX_3D_TEXTURE_SIZE = 0x8073;
  const getParameter = gl.getParameter;
  gl.getParameter = key => key === gl.MAX_3D_TEXTURE_SIZE ? 64 : getParameter(key);
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 320, clientHeight: 180 },
    pixelRatio: 1, post3d: { preset: { ssgi: true, ssr: true }, fxaa: false, sharpness: 0 } });
  return { adapter, renderer };
}

function bakedProbeData() {
  return { schemaVersion: 1, min: [-4, -2, -6], max: [4, 6, 6], resolution: [2, 1, 2],
    coefficients: Array.from({ length: 108 }, (_, index) => (index - 48) / 16), intensity: 0.5 };
}

test('baked irradiance data packs RGB SH coefficients and padded atlas slices', () => {
  const { adapter } = createProbeAdapter();
  const scene = new Scene('probe-atlas');
  const input = bakedProbeData();
  const grid = adapter.setIrradianceProbeGrid(scene, input);
  const { data, width, height, depth } = grid.texture.image;
  assert.deepEqual([width, height, depth], [2, 1, 28]);
  assert.equal(grid.texture.type, THREE.HalfFloatType);
  assert.equal(grid.texture.minFilter, THREE.LinearFilter);
  assert.deepEqual(grid.boundingBox.min.toArray(), input.min);
  assert.deepEqual(grid.boundingBox.max.toArray(), input.max);
  for (let band = 0; band < 7; band++) {
    for (let slice = 0; slice < 4; slice++) {
      const z = slice < 2 ? 0 : 1;
      for (let x = 0; x < 2; x++) {
        const probe = z * 2 + x;
        const offset = ((band * 4 + slice) * 2 + x) * 4;
        const actual = Array.from(data.subarray(offset, offset + 4), THREE.DataUtils.fromHalfFloat);
        const expected = Array.from({ length: 4 }, (_, channel) => {
          const index = band * 4 + channel;
          return index < 27 ? input.coefficients[probe * 27 + index] * input.intensity : 0;
        });
        assert.deepEqual(actual, expected);
      }
    }
  }

  assert.throws(() => adapter.setIrradianceProbeGrid(scene, { ...input, min: input.max }), /bounds/i);
  assert.throws(() => adapter.setIrradianceProbeGrid(scene, { ...input, min: [3.4e38, -2, -6], max: [3.5e38, 6, 6] }), /bounds/i);
  assert.throws(() => adapter.setIrradianceProbeGrid(scene, { ...input, coefficients: [NaN] }), /coefficients/i);
  assert.throws(() => adapter.setIrradianceProbeGrid(scene, { ...input, schemaVersion: 2 }), /schemaVersion/);
  assert.equal(adapter.setIrradianceProbeGrid(scene, { ...input, resolution: [2, 1, 8], coefficients: Array(432).fill(0) }), null);
  assert.ok(adapter.getWorld(scene).children.includes(grid));
  adapter.dispose();
});

test('the Three adapter owns one baked irradiance grid per scene across views and releases it safely', () => {
  const { adapter, renderer } = createProbeAdapter();
  const scene = new Scene('probe-world');
  const anotherScene = new Scene('plain-world');
  const grid = adapter.setIrradianceProbeGrid(scene, bakedProbeData());
  const world = adapter.getWorld(scene);
  assert.equal(grid.parent, world);
  assert.equal(grid.isLight && grid.isLightProbeGrid, true);
  assert.ok(!adapter.getWorld(anotherScene).children.includes(grid));
  const observations = [];
  renderer.render = drawn => {
    const uniforms = drawn.children?.[0]?.material?.uniforms;
    if (!uniforms?.uSsgiEnabled) return;
    observations.push([uniforms.uIrradianceWeight.value, uniforms.uIrradianceGridMin.value.toArray(),
      uniforms.uIrradianceViewToWorld.value.elements[12], uniforms.uSsrEnabled.value]);
  };
  const left = new THREE.PerspectiveCamera();
  left.position.x = -2;
  const right = new THREE.PerspectiveCamera();
  right.position.x = 3;
  adapter.setViews([{ camera: left, width: 0.5 }, { camera: right, x: 0.5, width: 0.5 }]);
  adapter.render(scene);
  assert.deepEqual(observations, [[0.5, [-4, -2, -6], -2, 1], [0.5, [-4, -2, -6], 3, 1]]);
  observations.length = 0;
  adapter.render(anotherScene);
  assert.deepEqual(observations.map(([enabled, , , ssr]) => [enabled, ssr]), [[0, 1], [0, 1]]);

  grid.removeFromParent();
  observations.length = 0;
  adapter.render(scene);
  assert.deepEqual(observations.map(([weight]) => weight), [0, 0]);
  const group = new THREE.Group();
  group.visible = false;
  world.add(group);
  group.add(grid);
  observations.length = 0;
  adapter.render(scene);
  assert.deepEqual(observations.map(([weight]) => weight), [0, 0]);
  group.visible = true;
  right.layers.set(1);
  observations.length = 0;
  adapter.render(scene);
  assert.deepEqual(observations.map(([weight]) => weight), [0.5, 0]);

  let disposed = 0;
  grid.texture.addEventListener('dispose', () => disposed++);
  const replacement = adapter.setIrradianceProbeGrid(scene, bakedProbeData());
  replacement.texture.addEventListener('dispose', () => disposed++);
  assert.equal(disposed, 1);
  assert.equal(grid.parent, null);
  assert.equal(replacement.parent, world);
  replacement.texture = null;
  scene.dispose();
  assert.equal(disposed, 2);
  assert.equal(replacement.parent, null);

  renderer.capabilities.isWebGL2 = false;
  assert.equal(adapter.setIrradianceProbeGrid(anotherScene, bakedProbeData()), null);
  assert.equal(adapter.getWorld(anotherScene).children.length, 0);
  renderer.capabilities.isWebGL2 = true;
  const last = adapter.setIrradianceProbeGrid(anotherScene, bakedProbeData());
  last.texture.addEventListener('dispose', () => disposed++);
  assert.equal(adapter.setIrradianceProbeGrid(anotherScene, null), null);
  assert.equal(disposed, 3);
  adapter.dispose();
  assert.equal(disposed, 3);
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

test('temporal AA jitters the world, restores camera matrices and invalidates per-view history', () => {
  const { renderer } = createMockWebGL2Renderer();
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
  const original = camera.projectionMatrix.toArray();
  const originalInverse = camera.projectionMatrixInverse.toArray();
  const viewCamera = new THREE.PerspectiveCamera();
  const world = new THREE.Scene();
  const viewScene = new THREE.Scene();
  viewScene.add(new THREE.Object3D());
  const stages = [];
  const historyWeights = [];
  let jitteredProjection;
  renderer.render = (scene, drawnCamera) => {
    if (drawnCamera === camera) jitteredProjection = drawnCamera.projectionMatrix.toArray();
    if (scene === viewScene) assert.deepEqual(camera.projectionMatrix.toArray(), original);
    const sampler = scene.children?.[0]?.material?.uniforms;
    if (sampler?.tPreviousDepth) historyWeights.push(sampler.uHistoryWeight.value);
  };
  const pipeline = createPostPipeline3D({ THREE, renderer, width: 318, height: 212,
    preset: QUALITY3D_PRESETS.low, temporalAA: true, fxaa: false, sharpness: 0 });
  const diagnostics = { beginPass(name, target) { stages.push([name, target]); }, recordTarget() {} };
  const draw = (dt = 1 / 60) => pipeline.render(world, camera, { viewScene, viewCamera, dt, diagnostics });

  draw();
  assert.deepEqual(stages.map(([name]) => name), ['world', 'temporal-aa', 'world-lighting', 'viewmodel', 'tone-mapping']);
  assert.equal(stages[0][1].resolveDepthBuffer, true);
  assert.ok(stages[1][1].depthTexture);
  assert.deepEqual(historyWeights, [0]);
  assert.notDeepEqual(jitteredProjection, original);
  assert.deepEqual(camera.projectionMatrix.toArray(), original);
  assert.deepEqual(camera.projectionMatrixInverse.toArray(), originalInverse);
  const firstHistory = stages[1][1];
  stages.length = 0;
  draw();
  assert.ok(historyWeights.at(-1) > 0);
  assert.notEqual(stages[1][1], firstHistory);

  draw(0.5);
  assert.equal(historyWeights.at(-1), 0);
  draw();
  assert.ok(historyWeights.at(-1) > 0);
  pipeline.resetTemporalHistory();
  draw();
  assert.equal(historyWeights.at(-1), 0);
  draw();
  camera.position.x = 5;
  draw();
  assert.equal(historyWeights.at(-1), 0);
  pipeline.resize(225, 150);
  stages.length = 0;
  draw();
  assert.equal(historyWeights.at(-1), 0);
  assert.deepEqual([stages[1][1].width, stages[1][1].height], [225, 150]);
  renderer.render = (_scene, drawnCamera) => {
    if (drawnCamera === camera) {
      camera.fov = 75;
      camera.updateProjectionMatrix();
    }
  };
  stages.length = 0;
  draw();
  const changed = new THREE.PerspectiveCamera(75, 1.5, 0.1, 200);
  assert.deepEqual(camera.projectionMatrix.toArray(), changed.projectionMatrix.toArray());
  assert.deepEqual(camera.projectionMatrixInverse.toArray(), changed.projectionMatrixInverse.toArray());
  assert.ok(!stages.some(([name]) => name === 'temporal-aa'));
  pipeline.setState({ temporalAA: false });
  assert.equal(pipeline.targets.hasTemporalAA, false);
  pipeline.dispose();
});

test('temporal AA uses previous rigid and instance transforms only for moving or new geometry', () => {
  const { renderer } = createMockWebGL2Renderer();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 5;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial();
  const rigid = new THREE.Mesh(geometry, material);
  const instances = new THREE.InstancedMesh(geometry, material, 2);
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
  world.add(rigid, instances);
  const pipeline = createPostPipeline3D({ THREE, renderer, width: 160, height: 90,
    preset: QUALITY3D_PRESETS.low, temporalAA: true, fxaa: false, sharpness: 0 });
  const motions = [];
  const resolves = [];
  let activePass;
  let target;
  const diagnostics = { beginPass(name, output) {
    activePass = name;
    target = output;
  }, recordTarget() {} };
  renderer.render = scene => {
    if (scene === world) world.updateMatrixWorld();
    if (activePass === 'temporal-motion') {
      for (const mesh of scene.children) {
        mesh.onBeforeRender();
        const uniforms = mesh.material.uniforms;
        motions.push({ mesh, isInstance: Boolean(mesh.isInstancedMesh), target, valid: uniforms.uHasPrevious.value,
          previousX: uniforms.uPreviousModelView.value.elements[12],
          oldInstance: uniforms.tPreviousInstances.value?.image.data[28] });
      }
    }
    if (activePass === 'temporal-aa') resolves.push(scene.children[0].material.uniforms.tMotionVectors.value);
  };
  const draw = (dt = 1 / 60) => pipeline.render(world, camera, { dt, diagnostics });
  draw();
  draw();
  assert.equal(motions.length, 0);
  assert.deepEqual(resolves, [null, null]);

  rigid.position.x = 0.5;
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 0, 0));
  instances.instanceMatrix.needsUpdate = true;
  draw();
  assert.deepEqual(motions.map(({ isInstance, valid, previousX, oldInstance }) =>
    [isInstance, valid, previousX, oldInstance]), [[false, true, 0, undefined], [true, true, 0, 2]]);
  assert.equal(resolves.at(-1), motions[0].target.texture);
  assert.equal(motions[0].target, motions[1].target);
  draw();
  assert.equal(motions.length, 2);
  assert.equal(resolves.at(-1), null);

  instances.count = 1;
  draw();
  assert.equal(motions.at(-1).isInstance, true);
  assert.equal(motions.at(-1).valid, false);

  world.add(new THREE.Mesh(geometry, material));
  draw();
  assert.equal(motions.at(-1).valid, false);
  const scratch = motions[0].target;
  let released = 0;
  let releasedProxy = 0;
  scratch.addEventListener('dispose', () => released++);
  motions[1].mesh.addEventListener('dispose', () => {
    assert.notEqual(motions[1].mesh.instanceMatrix, instances.instanceMatrix);
    releasedProxy++;
  });
  pipeline.resize(100, 90);
  assert.equal(released, 1);
  assert.equal(releasedProxy, 1);
  draw();
  assert.equal(resolves.at(-1), null);
  pipeline.setState({ temporalMotion: false });
  rigid.position.x = 1;
  draw();
  assert.equal(resolves.at(-1), null);
  pipeline.dispose();
  geometry.dispose();
  material.dispose();
});

test('adaptive render memory pressure constrains resolution and tier recovery independently of frame time', () => {
  const changes = [];
  const mib = 1024 * 1024;
  const options = { device: { rendererName: 'NVIDIA RTX 4080' }, settleMs: 0, settleAfterChangeMs: 0,
    sampleFrames: 2, memoryBudgetBytes: 20 * mib, onChange: (_state, reason) => changes.push(reason) };
  const controller = createAdaptiveQualityController({ ...options, minScale: 0.5 });
  assert.equal(controller.sampleMemory(16 * mib, 8 * mib), true);
  const constrained = controller.state.dynamicScale;
  assert.ok(constrained > 0.5 && constrained < 0.87);
  assert.deepEqual(changes, ['memory-resolution']);
  controller.sampleMemory(11.8 * mib, 8 * mib);
  for (let frame = 0; frame < 20; frame++) controller.sampleFrame(10, 7);
  assert.equal(controller.state.dynamicScale, constrained);
  controller.sampleMemory(5 * mib, 2 * mib);
  controller.sampleFrame(10, 7);
  assert.equal(controller.sampleFrame(10, 7), true);
  assert.ok(controller.state.dynamicScale > constrained);

  const tierLimited = createAdaptiveQualityController({ ...options, minScale: 1 });
  assert.equal(tierLimited.state.tier, 'high');
  assert.equal(tierLimited.sampleMemory(22 * mib, 2 * mib), true);
  assert.equal(tierLimited.state.tier, 'medium');
  tierLimited.sampleMemory(6 * mib, 2 * mib);
  for (let frame = 0; frame < 500; frame++) tierLimited.sampleFrame(10, 7);
  assert.equal(tierLimited.state.tier, 'medium');
  assert.equal(changes.at(-1), 'memory-tier');
  const fixed = createAdaptiveQualityController({ ...options, mode: 'high', minScale: 1 });
  assert.equal(fixed.sampleMemory(30 * mib, 0), false);
  assert.equal(fixed.state.tier, 'high');
  assert.equal(fixed.state.memory.overBudget, true);

  const canPromote = createAdaptiveQualityController({ ...options, minScale: 0.5, memoryBudgetBytes: 30 * mib });
  canPromote.sampleMemory(23 * mib, 20 * mib, 10 * mib);
  assert.equal(canPromote.state.tier, 'medium');
  canPromote.sampleMemory(8 * mib, 0, 5 * mib);
  for (let frame = 0; frame < 1000; frame++) canPromote.sampleFrame(10, 7);
  assert.equal(canPromote.state.tier, 'high');
  assert.ok(canPromote.state.dynamicScale < 1);

  const low = createAdaptiveQualityController({ ...options, device: { mobile: true }, memoryBudgetBytes: 30 * mib });
  for (let frame = 0; frame < 10; frame++) {
    low.sampleMemory(8 * mib, 25 * mib, 6 * mib);
    low.sampleFrame(40, 38);
  }
  assert.equal(low.state.lastMeanMs, 40);
});

test('Three memory budget measures post attachments and trims idle residency before lowering quality', () => {
  const { renderer } = createMockWebGL2Renderer();
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const limit = 16 * 1024 * 1024;
  let residentBytes = 2 * limit;
  const trims = [];
  let canTrim = true;
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 320, clientHeight: 180 }, pixelRatio: 1,
    post3d: true, quality3d: { mode: 'auto', device: { rendererName: 'NVIDIA RTX 4080' }, memoryBudgetBytes: limit,
      residency: { readBytes: () => residentBytes, trimIdle(bytes) { trims.push(bytes); if (canTrim) residentBytes = 0; } } } });
  const scene = new Scene('render-budget');
  adapter.render(scene);
  assert.equal(adapter.getRenderDiagnostics(), null);
  const measured = adapter.qualityController.state.memory;
  assert.ok(measured.targetBytes > 320 * 180 * 8);
  assert.equal(measured.residentBytes, 0);
  assert.equal(measured.overBudget, false);
  assert.equal(adapter.qualityController.state.dynamicScale, 1);
  assert.deepEqual(trims, [limit + measured.targetBytes]);

  canTrim = false;
  residentBytes = limit - 1;
  adapter.render(scene);
  assert.equal(adapter.qualityController.state.memory.overBudget, true);
  assert.ok(adapter.qualityController.state.dynamicScale < 1);
  adapter.render(scene);
  assert.equal(trims.length, 2, 'an unchanged cache is not retrimmed within its cooldown');
  canTrim = true;
  for (let frame = 0; frame < 120; frame++) adapter.render(scene);
  assert.equal(trims.length, 3);
  assert.equal(adapter.qualityController.state.memory.residentBytes, 0);
  adapter.postPipeline.setState({ autoExposure: true });
  assert.equal(adapter.qualityController.state.memory, null);
  adapter.render(scene);
  const fixed = adapter.qualityController.state.memory.fixedTargetBytes;
  assert.ok(fixed >= (64 ** 2 + 16 ** 2 + 4 ** 2 + 2) * 8);
  adapter.setViews([{ camera: adapter.camera, width: .5 }, { camera: adapter.camera.clone(), x: .5, width: .5 }]);
  assert.equal(adapter.qualityController.state.memory, null);
  adapter.render(scene);
  assert.ok(adapter.qualityController.state.memory.fixedTargetBytes > fixed * 2);
  adapter.dispose();
});

test('memory pressure releases fixed shadow maps when disabled at the hardware size cap', () => {
  const { renderer } = createMockWebGL2Renderer();
  renderer.capabilities.maxTextureSize = 1024;
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({ THREE: namespace, canvas: { clientWidth: 320, clientHeight: 180 },
    worldLighting: { sun: { color: 0xffffff, intensity: 1, position: [1, 2, 3],
      shadow: { extent: 10, near: 0.1, far: 30, mapSize: 1024 } } },
    quality3d: { memoryBudgetBytes: 4 * 1024 * 1024, device: { rendererName: 'NVIDIA RTX 4080' } } });
  const scene = new Scene('shadow-budget');
  const sun = adapter.getWorld(scene).children.find(object => object.isDirectionalLight);
  sun.shadow.map = new THREE.WebGLRenderTarget(1024, 1024);
  let releases = 0;
  sun.shadow.map.addEventListener('dispose', () => releases++);
  adapter.render(scene);
  assert.equal(adapter.getQuality(), 'medium');
  assert.equal(releases, 0);
  adapter.render(scene);
  assert.equal(adapter.getQuality(), 'low');
  assert.equal(releases, 1);
  adapter.render(scene);
  assert.equal(adapter.qualityController.state.memory.fixedTargetBytes, 0);
  assert.equal(adapter.qualityController.state.memory.overBudget, false);
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

test('render graph schedules passes by read/write dependencies and aliases/reclaims transient targets', () => {
  const executed = [];
  const graph = compileRenderGraph([
    {
      id: 'tone-mapping',
      reads: ['bloomOut', 'aoOut'],
      writes: ['backbuffer'],
      execute: () => executed.push('tone-mapping'),
    },
    {
      id: 'bloom-blur',
      reads: ['bloomPre'],
      writes: ['bloomOut'],
      transientSpecs: { bloomOut: { width: 'half', height: 'half', format: 'rgba16f' } },
      execute: () => executed.push('bloom-blur'),
    },
    {
      id: 'ao-blur',
      reads: ['aoRaw'],
      writes: ['aoOut'],
      transientSpecs: { aoOut: { width: 'half', height: 'half', format: 'rgba16f' } },
      execute: () => executed.push('ao-blur'),
    },
    {
      id: 'bloom-prefilter',
      reads: ['sceneColor'],
      writes: ['bloomPre'],
      transientSpecs: { bloomPre: { width: 'half', height: 'half', format: 'rgba16f' } },
      execute: () => executed.push('bloom-prefilter'),
    },
    {
      id: 'ao-pass',
      reads: ['sceneDepth'],
      writes: ['aoRaw'],
      transientSpecs: { aoRaw: { width: 'half', height: 'half', format: 'rgba16f' } },
      execute: () => executed.push('ao-pass'),
    },
  ], {
    externalInputs: ['sceneColor', 'sceneDepth'],
    externalOutputs: ['backbuffer'],
  });

  // Topological order puts producers strictly before consumers
  assert.ok(graph.order.indexOf('bloom-prefilter') < graph.order.indexOf('bloom-blur'));
  assert.ok(graph.order.indexOf('ao-pass') < graph.order.indexOf('ao-blur'));
  assert.ok(graph.order.indexOf('bloom-blur') < graph.order.indexOf('tone-mapping'));
  assert.ok(graph.order.indexOf('ao-blur') < graph.order.indexOf('tone-mapping'));

  // Transient aliasing reduces 4 logical half-res targets down to <= 3 physical slots
  assert.ok(graph.peakTargets <= 3, `Expected aliasing peakTargets <= 3, got ${graph.peakTargets}`);
  assert.ok(graph.reclaimedAt['tone-mapping'].length >= 2);

  // Execute against a pool and verify reuse & last-use release
  let nextTargetId = 0;
  const free = [];
  const allocated = [];
  const pool = {
    acquire(spec) {
      const reused = free.pop();
      if (reused) return reused;
      const t = { id: ++nextTargetId, spec, releasedCount: 0 };
      allocated.push(t);
      return t;
    },
    release(target) {
      target.releasedCount++;
      free.push(target);
    },
  };
  const summary = executeRenderGraph(graph, pool, { externalTargets: { sceneColor: 'hdr', sceneDepth: 'depth' } });
  assert.deepEqual(summary.executed, graph.order);
  assert.equal(allocated.length, graph.peakTargets);
  assert.ok(summary.reusedCount >= 1);
  assert.equal(free.length, allocated.length);

  // Cycle and missing producer detection
  assert.throws(() => compileRenderGraph([
    { id: 'a', reads: ['b'], writes: ['a'] },
    { id: 'b', reads: ['a'], writes: ['b'] },
  ]), /cycle/i);
  assert.throws(() => compileRenderGraph([
    { id: 'consumer', reads: ['missingTex'], writes: ['backbuffer'] },
  ], { externalOutputs: ['backbuffer'] }), /missing input/i);

  // Pipeline exposes compiled render graph plan reflecting active stages
  const pipeline = createPostPipeline3D({
    THREE,
    renderer: {
      getSize: () => ({ width: 640, height: 360 }),
      getPixelRatio: () => 1,
      getContext: () => null,
      capabilities: { isWebGL2: false },
      render() {},
    },
    qualityPreset: 'high',
  });
  const plan = pipeline.getRenderGraphPlan();
  assert.ok(plan.order.includes('tone-mapping'));
  assert.ok(plan.lifetimes && typeof plan.peakTargets === 'number');
  pipeline.dispose();
});

test('R2: streamed probe volume manager blends across adjacent cells and evicts LRU within residency budget', async () => {
  const { createStreamedProbeVolumeManager3D } = await import('../assets/runtime/integrations/lighting3d.js');
  const { renderer } = createProbeAdapter();
  const hostScene = new THREE.Scene();
  const manager = createStreamedProbeVolumeManager3D(THREE, renderer, {
    maxCells: 2,
    blendMargin: 4,
    transitionSeconds: 0.5,
    scene: hostScene,
  });

  const cellA = { ...bakedProbeData(), min: [0, -2, -6], max: [10, 6, 6], intensity: 0.8 };
  const cellB = { ...bakedProbeData(), min: [10, -2, -6], max: [20, 6, 6], intensity: 0.6 };
  const cellC = { ...bakedProbeData(), min: [20, -2, -6], max: [30, 6, 6], intensity: 1.0 };

  const resA = manager.attachCell('0,0', cellA);
  const resB = manager.attachCell('1,0', cellB);
  assert.equal(resA.active, true);
  assert.equal(resB.active, true);
  assert.equal(manager.getStats().cellCount, 2);

  // Fade in both A and B over 0.5s
  manager.evaluateAt([10, 0, 0], 0.5);
  const seam = manager.evaluateAt([10, 0, 0], 0);
  assert.equal(seam.active.length, 2);
  assert.ok(Math.abs(seam.active[0].weight - 0.5) < 1e-6);
  assert.ok(Math.abs(seam.active[1].weight - 0.5) < 1e-6);

  // Smooth crossing from inside A ([5,0,0]) through seam ([10,0,0]) into B ([15,0,0])
  const deepA = manager.evaluateAt([4, 0, 0], 0);
  assert.equal(deepA.active.length, 1);
  assert.equal(deepA.active[0].key, '0,0');
  const deepB = manager.evaluateAt([16, 0, 0], 0);
  assert.equal(deepB.active.length, 1);
  assert.equal(deepB.active[0].key, '1,0');

  // Touching B then attaching C evicts LRU cell A and disposes its 3D texture
  const disposed = [];
  manager.getCell('0,0').light.texture.addEventListener('dispose', () => disposed.push('0,0'));
  manager.touchCell('1,0');
  const resC = manager.attachCell('2,0', cellC);
  assert.equal(resC.evicted.length, 1);
  assert.equal(resC.evicted[0].key, '0,0');
  assert.deepEqual(disposed, ['0,0']);
  assert.equal(manager.getStats().cellCount, 2);
  assert.equal(manager.getStats().lastEvictionReason, 'cell-budget');

  manager.dispose();
  assert.equal(manager.getStats().cellCount, 0);
});

test('R3: temporal motion vectors support SkinnedMesh, GPU animation classification, explicit exclusions, and temporal upsampling', () => {
  const { renderer } = createMockWebGL2Renderer();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 5;

  // 1. SkinnedMesh with 2 bones
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  skinGeo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), 4));
  skinGeo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const skinMat = new THREE.MeshStandardMaterial();
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.boneMatrices = new Float32Array(32);
  new THREE.Matrix4().identity().toArray(skeleton.boneMatrices, 0);
  new THREE.Matrix4().makeTranslation(1, 0, 0).toArray(skeleton.boneMatrices, 16);
  const skinnedMesh = new THREE.SkinnedMesh(skinGeo, skinMat);
  skinnedMesh.bind(skeleton, new THREE.Matrix4().identity());

  // 2. GPU-animated mesh (e.g. Bone-VAT style) + explicit exclusion
  const vatGeo = new THREE.PlaneGeometry(1, 1);
  const vatMat = new THREE.ShaderMaterial();
  const vatMesh = new THREE.Mesh(vatGeo, vatMat);
  vatMesh.userData.hgameTemporalMotion = 'bone-vat';

  const customExcluded = new THREE.Mesh(vatGeo, new THREE.ShaderMaterial());
  const explicitExcluded = new THREE.Mesh(vatGeo, new THREE.MeshStandardMaterial());
  explicitExcluded.userData.hgameTemporalMotion = 'exclude';

  world.add(skinnedMesh, vatMesh, customExcluded, explicitExcluded);

  const pipeline = createPostPipeline3D({
    THREE,
    renderer,
    width: 160,
    height: 90,
    preset: QUALITY3D_PRESETS.low,
    temporalAA: true,
    temporalUpsampling: true,
    renderScale: 0.5,
    fxaa: false,
    sharpness: 0,
  });

  const statsPre = pipeline.getTemporalStats();
  assert.equal(statsPre.upsampling, true);
  assert.equal(statsPre.renderScale, 0.5);
  assert.equal(statsPre.internalWidth, 80);
  assert.equal(statsPre.internalHeight, 45);
  assert.equal(statsPre.displayWidth, 160);
  assert.equal(statsPre.displayHeight, 90);

  let activePass;
  let worldTarget = null;
  let taaOutput = null;
  const skinnedMotions = [];
  const diagnostics = {
    beginPass(name, output) {
      activePass = name;
      if (name === 'world') worldTarget = output;
      if (name === 'temporal-aa') taaOutput = output;
    },
    recordTarget() {},
  };
  renderer.render = scene => {
    if (scene === world) world.updateMatrixWorld();
    if (activePass === 'temporal-motion') {
      for (const mesh of scene.children) {
        mesh.onBeforeRender();
        const u = mesh.material.uniforms;
        if (u.uReadPreviousBones.value) {
          skinnedMotions.push({
            hasPrevBones: Boolean(u.tPreviousBones.value),
            prevBoneX: u.tPreviousBones.value?.image.data[28],
            currBoneX: u.tCurrentBones.value?.image.data[28],
            prevCount: u.uPreviousBoneCount.value,
          });
        }
      }
    }
  };

  // Frame 1 & Frame 2 with static bones -> 0 skinned motion draws
  pipeline.render(world, camera, { dt: 1 / 60, diagnostics });
  pipeline.render(world, camera, { dt: 1 / 60, diagnostics });
  assert.equal(skinnedMotions.length, 0);
  assert.equal(worldTarget.width, 80);
  assert.equal(worldTarget.height, 45);
  assert.equal(taaOutput.width, 160);
  assert.equal(taaOutput.height, 90);

  const motionClass = pipeline.getTemporalStats().motion;
  assert.equal(motionClass.skinned, 1);
  assert.equal(motionClass.gpuAnimated, 1);
  assert.equal(motionClass.excluded, 2);

  // Frame 3: move bone 1 from x=1 to x=2.5 -> emits skinned motion vector with prevBoneX=1, currBoneX=2.5
  new THREE.Matrix4().makeTranslation(2.5, 0, 0).toArray(skeleton.boneMatrices, 16);
  pipeline.render(world, camera, { dt: 1 / 60, diagnostics });
  assert.equal(skinnedMotions.length, 1);
  assert.equal(skinnedMotions[0].hasPrevBones, true);
  assert.equal(skinnedMotions[0].prevBoneX, 1);
  assert.equal(skinnedMotions[0].currBoneX, 2.5);
  assert.equal(skinnedMotions[0].prevCount, 2);

  // Toggle temporalUpsampling off -> internal world target restores to full 160x90 cleanly
  pipeline.setState({ temporalUpsampling: false });
  pipeline.render(world, camera, { dt: 1 / 60, diagnostics });
  assert.equal(worldTarget.width, 160);
  assert.equal(worldTarget.height, 90);
  assert.equal(pipeline.getTemporalStats().upsampling, false);

  pipeline.dispose();
});

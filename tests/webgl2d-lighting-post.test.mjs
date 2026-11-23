import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Entity, createRenderBudgetController } from '../assets/runtime/index.js';
import { Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';
import { createLighting2DState, MAX_2D_LIGHTS, MAX_2D_OCCLUDERS, QUALITY2D_LIGHTING_PRESETS } from '../assets/runtime/integrations/post2d.js';
import { createRenderDiagnostics2D } from '../assets/runtime/integrations/render-diagnostics-2d.js';

function createMockCanvas2D() {
  const ops = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    setTransform() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(...args) { ops.push(['fillRect', ...args]); },
    strokeRect() {},
    createRadialGradient() {
      ops.push('radialGradient');
      return { addColorStop() {} };
    },
  };
  return {
    ops,
    canvas: {
      clientWidth: 640,
      clientHeight: 360,
      width: 640,
      height: 360,
      getContext(kind) { return kind === '2d' ? ctx : null; },
    },
  };
}

test('createLighting2DState packs up to MAX_2D_LIGHTS, projects world-to-UV, and stays inactive by default', () => {
  const st = createLighting2DState();
  assert.equal(st.hasActivePass(), false);

  st.setAmbientLight('#203050', 0.35);
  assert.equal(st.hasActivePass(), true);

  const many = Array.from({ length: MAX_2D_LIGHTS + 5 }, (_, i) => ({
    x: i * 10,
    y: i * 5,
    radius: 150,
    color: 0xffaa44,
    intensity: 1.4,
  }));
  const count = st.setLights(many);
  assert.equal(count, MAX_2D_LIGHTS);
  assert.equal(st.lightCount, MAX_2D_LIGHTS);

  st.projectLightsToUv(
    { x: 0, y: 0, offsetX: 0, offsetY: 0, zoom: 1, rotation: 0 },
    { vw: 960, vh: 540, dpr: 1, scale: 1, x: 0, y: 0 },
    960,
    540,
  );
  // Light 0 at (0,0) maps to screen center UV (0.5, 0.5)
  assert.ok(Math.abs(st.lightUvPosRad[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(st.lightUvPosRad[1] - 0.5) < 1e-4);

  st.clearLights();
  st.setAmbientLight('#ffffff', 1);
  st.setPost({ bloomIntensity: 0.8, vignette: 0.4, hitPulse: 0.5, chromatic: 0.005 });
  assert.equal(st.hasActivePass(), true);
  assert.equal(st.snapshot().post.bloomIntensity, 0.8);
});

test('Canvas2D and WebGL2D fallback expose identical 2D lighting/post methods and render without allocations', () => {
  const { canvas, ops } = createMockCanvas2D();
  const renderer = createWebGL2DAdapter({ canvas, width: 640, height: 360, allowFallback: true });
  assert.equal(renderer.stats.backend, 'canvas2d');

  const scene = new Scene('lit');
  const hero = new Entity({ name: 'hero' });
  hero.addComponent(new Sprite2D({ width: 32, height: 32, color: '#ff8844' }));
  scene.add(hero);

  // Disabled pass incurs zero radialGradient overhead.
  renderer.render(scene);
  assert.equal(renderer.stats.postPassActive, false);
  assert.equal(ops.filter((o) => o === 'radialGradient').length, 0);

  // Enabled ambient + dynamic point light + vignette renders lighting fallback cleanly.
  renderer.setAmbientLight('#101830', 0.3);
  renderer.addLight2D({ x: 100, y: 60, radius: 180, color: '#ffd166', intensity: 1.2 });
  renderer.setPost2D({ vignette: 0.45, hitPulse: 0.25 });
  renderer.render(scene);

  assert.equal(renderer.stats.postPassActive, true);
  assert.ok(ops.filter((o) => o === 'radialGradient').length >= 2);
  assert.equal(renderer.getLighting2DState().lightCount, 1);

  renderer.dispose();
});

test('createCanvas2DAdapter skips post pass again once lights and post effects are cleared', () => {
  const { canvas } = createMockCanvas2D();
  const c2d = createCanvas2DAdapter({ canvas, width: 640, height: 360 });
  const scene = new Scene('lit');
  c2d.setPost2D({ bloomIntensity: 0.5, vignette: 0.3 });
  c2d.render(scene);
  assert.equal(c2d.stats.postPassActive, true);

  c2d.setPost2D({ bloomIntensity: 0, vignette: 0 });
  c2d.render(scene);
  assert.equal(c2d.stats.postPassActive, false);
  c2d.dispose();
});

test('Canvas fallback reports ordered CPU stages and unavailable GPU counters', () => {
  const { canvas } = createMockCanvas2D();
  const renderer = createWebGL2DAdapter({ canvas, diagnostics2d: true });
  assert.equal(renderer.getRenderDiagnostics(), null);
  renderer.setViews([{ camera: renderer.camera, width: 0.5 }, { camera: renderer.camera, x: 0.5, width: 0.5 }]);
  renderer.setPost2D({ vignette: 0.3 });
  renderer.render(new Scene('canvas-diagnostics'));
  const snapshot = renderer.getRenderDiagnostics();
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.passes.map(({ name, viewIndex }) => [name, viewIndex]),
    [['world', 0], ['lighting-composite', 0], ['world', 1], ['lighting-composite', 1]]);
  assert.equal(snapshot.drawCalls, null);
  assert.equal(snapshot.triangles, null);
  assert.equal(snapshot.uploads, null);
  assert.equal(snapshot.gpu.supported, false);
  assert.ok(snapshot.passes.every(pass => pass.cpuMs >= 0 && pass.drawCalls === null));
  renderer.dispose();
  assert.equal(renderer.getRenderDiagnostics(), null);
});

test('Pixi WebGPU diagnostics observe queue writes and flag opaque bundles', () => {
  const queue = { writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {} };
  const pass = () => ({ draw() {}, drawIndexed() {}, drawIndirect() {}, drawIndexedIndirect() {}, executeBundles() {} });
  const device = { queue, createCommandEncoder: () => ({ beginRenderPass: pass }) };
  const renderTarget = { bind: value => value };
  const screenTarget = { isRoot: true, pixelWidth: 128, pixelHeight: 128 };
  const renderer = { gpu: { device }, renderTarget, view: { renderTarget: screenTarget } };
  const report = createRenderDiagnostics2D({ pixiRenderer: renderer });
  const originalEncoder = device.createCommandEncoder;
  const originalBind = renderTarget.bind;
  assert.equal(report.beginFrame(), true);
  const stage = report.beginPass('scene', null);
  const target = { isRoot: true, pixelWidth: 32, pixelHeight: 16, colorAttachments: [{ texture: { format: 'rgba8unorm' } }] };
  renderTarget.bind(target);
  renderTarget.bind(target);
  renderTarget.bind(screenTarget);
  queue.writeBuffer({}, 0, new Float32Array(12), 2, 4);
  queue.writeTexture({ texture: { format: 'rgba16float' } }, new Uint16Array(96), {}, [4, 3, 2]);
  queue.copyExternalImageToTexture({}, { texture: { format: 'unknown' } }, [4, 2]);
  const encoder = device.createCommandEncoder().beginRenderPass();
  encoder.draw();
  encoder.drawIndirect();
  stage();
  const bundle = report.beginPass('bundle', null);
  encoder.executeBundles([{}]);
  bundle();
  const next = report.beginPass('next', null);
  device.createCommandEncoder().beginRenderPass().drawIndexed();
  next();
  report.endFrame(true);
  const snapshot = report.snapshot();
  assert.equal(snapshot.drawCalls, null);
  assert.equal(snapshot.passes[0].drawCalls, 2);
  assert.equal(snapshot.passes[0].triangles, null);
  assert.equal(snapshot.passes[1].drawCalls, null);
  assert.equal(snapshot.passes[2].drawCalls, 1);
  assert.deepEqual(snapshot.uploads, { bufferBytes: 16, textureBytes: 192, calls: 3, unmeasuredCalls: 1 });
  assert.equal(snapshot.estimatedTargetBytes, 2048);
  assert.equal(device.createCommandEncoder, originalEncoder);
  assert.equal(renderTarget.bind, originalBind);
});

test('2D diagnostics release hooks and discard the active frame on context loss', () => {
  let lost = false;
  const gl = { drawArrays() {}, isContextLost: () => lost };
  const original = gl.drawArrays;
  const report = createRenderDiagnostics2D({ gl });
  assert.equal(report.beginFrame(), true);
  const finish = report.beginPass('world', null);
  assert.notEqual(gl.drawArrays, original);
  lost = true;
  report.resetGpu(true);
  assert.equal(gl.drawArrays, original);
  finish();
  report.endFrame(true);
  assert.equal(report.snapshot(), null);
  assert.equal(report.beginFrame(), false);
  lost = false;
  assert.equal(report.beginFrame(), true);
  report.endFrame(true);
  assert.equal(report.snapshot().complete, true);
});

test('Pixi diagnostics discard snapshots when the WebGPU device is lost or replaced', async () => {
  let lose;
  const first = { lost: new Promise(resolve => { lose = resolve; }) };
  const pixiRenderer = { gpu: { device: first } };
  const report = createRenderDiagnostics2D({ pixiRenderer });
  assert.equal(report.beginFrame(), true);
  report.endFrame(true);
  lose();
  await first.lost;
  assert.equal(report.snapshot(), null);
  assert.equal(report.beginFrame(), false);
  pixiRenderer.gpu.device = {};
  assert.equal(report.beginFrame(), true);
  report.endFrame(true);
  pixiRenderer.gpu.device = {};
  assert.equal(report.snapshot(), null);
});

test('P3: 2D render budget reclaims idle resources by type with recorded trigger reasons across backends', () => {
  const evicted = [];
  const budget = createRenderBudgetController({ maxBytes: 1024, idleFrames: 3, frameBudgetMs: 16 });
  budget.registerResource({ id: 'post:rt', type: 'postTargets', bytes: 600, priority: 1, reclaim: r => { evicted.push(['post:rt', r]); } });
  budget.registerResource({ id: 'text:a', type: 'textCache', bytes: 600, priority: 0, reclaim: r => { evicted.push(['text:a', r]); } });

  // Frame 1: touch post:rt so text:a is idle and evicted due to memory-budget (600 + 600 > 1024)
  budget.stepFrame({ frameTimeMs: 8 });
  budget.touch('post:rt');
  budget.stepFrame({ frameTimeMs: 8 });
  const snap1 = budget.getBudgetSnapshot();
  assert.equal(snap1.evictions.length, 1);
  assert.equal(snap1.evictions[0].resourceType, 'textCache');
  assert.equal(snap1.evictions[0].reason, 'memory-budget');

  // Advance 3 frames without touching post:rt -> idle-ttl eviction
  budget.stepFrame();
  budget.stepFrame();
  budget.stepFrame();
  const snap2 = budget.getBudgetSnapshot();
  assert.equal(snap2.evictions.length, 2);
  assert.equal(snap2.evictions[1].resourceType, 'postTargets');
  assert.equal(snap2.evictions[1].reason, 'idle-ttl');
  assert.equal(snap2.totalBytes, 0);

  // Canvas2D adapter integrates render budget + exposes getRenderBudget/reclaimRenderResources
  const { canvas } = createMockCanvas2D();
  const adapter = createCanvas2DAdapter({
    canvas,
    width: 320,
    height: 180,
    diagnostics2d: true,
    budgetOptions: { maxBytes: 4096, idleFrames: 2 },
  });
  const scene = new Scene('s');
  const ent = scene.add(new Entity());
  ent.addComponent(new Sprite2D({ width: 20, height: 20, color: '#ff0000' }));
  adapter.render(scene);
  const cBudget = adapter.getRenderBudget();
  assert.ok(cBudget && cBudget.frame === 1);
  assert.equal(typeof adapter.reclaimRenderResources, 'function');
  adapter.dispose();
});

test('P4: 2D diagnostics emit unified frame/pass draws, uploadBytes, targetBytes and measurementSources', () => {
  const { canvas } = createMockCanvas2D();
  const adapter = createCanvas2DAdapter({ canvas, width: 320, height: 180, diagnostics2d: true });
  const scene = new Scene('p4');
  const ent = scene.add(new Entity());
  ent.addComponent(new Sprite2D({ width: 24, height: 24, color: '#00ff88' }));
  adapter.render(scene);
  const snap = adapter.getRenderDiagnostics();
  assert.ok(snap);
  assert.ok(snap.draws > 0, 'Canvas2D reports measured draw count');
  assert.equal(snap.measurementSources.draws, 'measured');
  assert.equal(snap.measurementSources.gpuMs, 'unavailable');
  assert.equal(snap.measurementSources.targetBytes, 'estimated');
  assert.ok(snap.estimatedFields.includes('targetBytes'));
  assert.ok(snap.passes.length >= 1);
  assert.equal(snap.passes[0].measurementSources.draws, 'measured');
  adapter.dispose();

  // Pixi WebGPU with timestamp-query capability marks gpuMs measured vs unavailable without it
  const gpuDevice = {
    features: new Set(['timestamp-query']),
    queue: { writeBuffer() {} },
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ draw() {}, drawIndexed() {}, drawIndirect() {}, drawIndexedIndirect() {}, executeBundles() {}, end() {} }),
    }),
  };
  const gpuReport = createRenderDiagnostics2D({ pixiRenderer: { gpu: { device: gpuDevice } } });
  gpuReport.beginFrame();
  const endPass = gpuReport.beginPass('scene', null);
  gpuDevice.createCommandEncoder().beginRenderPass().draw();
  endPass();
  gpuReport.endFrame(true);
  const gpuSnap = gpuReport.snapshot();
  assert.equal(gpuSnap.measurementSources.gpuMs, 'measured');
  assert.equal(gpuSnap.measurementSources.draws, 'measured');
  assert.equal(gpuSnap.measurementSources.targetBytes, 'estimated');
  assert.equal(gpuSnap.passes[0].draws, 1);
});

test('R1: 2D lighting supports occluder shadows, Sprite2D material props, and explicit low/medium/high quality policies', () => {
  assert.equal(MAX_2D_OCCLUDERS, 128);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.low.maxLights, 8);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.medium.maxLights, 16);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.high.maxLights, 32);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.low.occluderShadows, false);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.low.bloom, false);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.medium.occluderShadows, true);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.medium.normalMaps, false);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.high.softShadows, true);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.high.normalMaps, true);

  const sprite = new Sprite2D({
    width: 32,
    height: 32,
    normalMap: { width: 32, height: 32 },
    normalStrength: 1.5,
    roughness: 0.35,
  });
  assert.ok(sprite.normalMap);
  assert.equal(sprite.normalStrength, 1.5);
  assert.equal(sprite.roughness, 0.35);

  const state = createLighting2DState();
  for (let i = 0; i < MAX_2D_OCCLUDERS + 5; i++) {
    state.addOccluder({ x1: i, y1: 0, x2: i + 10, y2: 20 });
  }
  assert.equal(state.snapshot().occluderCount, MAX_2D_OCCLUDERS);
  state.clearOccluders();
  assert.equal(state.snapshot().occluderCount, 0);

  const { canvas } = createMockCanvas2D();
  const c2d = createCanvas2DAdapter({ canvas, width: 640, height: 360 });
  const wglFallback = createWebGL2DAdapter({ canvas, width: 640, height: 360, allowFallback: true });

  for (const adapter of [c2d, wglFallback]) {
    adapter.setAmbientLight('#182030', 0.5);
    adapter.addLight2D({ x: 100, y: 100, radius: 220, intensity: 1.2, castShadow: true });
    adapter.setOccluders2D([{ x1: 140, y1: 60, x2: 140, y2: 140 }]);
    adapter.setNormalLighting2D({ enabled: true, strength: 1.25 });
    adapter.setPost2D({ bloomIntensity: 0.6, vignette: 0.25 });

    adapter.setQuality('low');
    assert.deepEqual(adapter.getQualityPolicy2D(), QUALITY2D_LIGHTING_PRESETS.low);
    assert.ok(adapter.getQualityPolicy2D().retainedEffects.includes('vignette'));

    adapter.setQuality('medium');
    assert.deepEqual(adapter.getQualityPolicy2D(), QUALITY2D_LIGHTING_PRESETS.medium);
    assert.equal(adapter.getQualityPolicy2D().occluderShadows, true);
    assert.equal(adapter.getQualityPolicy2D().normalMaps, false);

    adapter.setQuality('high');
    assert.deepEqual(adapter.getQualityPolicy2D(), QUALITY2D_LIGHTING_PRESETS.high);

    const scene = new Scene('r1-scene');
    const ent = scene.add(new Entity());
    ent.addComponent(new Sprite2D({ width: 32, height: 32, roughness: 0.4 }));
    adapter.render(scene);
    assert.equal(adapter.getLighting2DState().occluderCount, 1);
  }

  c2d.dispose();
  wglFallback.dispose();
});

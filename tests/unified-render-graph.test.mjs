import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Scene } from '../assets/runtime/index.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';

function createMockWebGL2Renderer() {
  const gl = {
    MAX_SAMPLES: 0x8d57,
    MAX_TEXTURE_SIZE: 0x0d33,
    depthRange() {},
    getParameter(param) {
      if (param === 0x8d57) return 4;
      if (param === 0x0d33) return 8192;
      return 0;
    },
    getExtension(name) {
      if (name === 'EXT_color_buffer_float') return {};
      return null;
    },
  };
  const size = { width: 640, height: 360 };
  let pixelRatio = 1;
  return {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 8 },
    shadowMap: { enabled: false, type: 0 },
    autoClear: true,
    toneMapping: 0,
    info: { render: { calls: 0, triangles: 0 } },
    getContext: () => gl,
    getSize(out = { width: 0, height: 0 }) {
      out.width = size.width;
      out.height = size.height;
      return out;
    },
    getPixelRatio: () => pixelRatio,
    setPixelRatio(r) { pixelRatio = r; },
    setSize(w, h) { size.width = w; size.height = h; },
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    setRenderTarget() {},
    clear() {},
    clearDepth() {},
    render() {},
    dispose() {},
  };
}

test('A2 unified RenderGraph defaults renderGraph=true and executes shadow-csm -> world -> tone-mapping in one compiled DAG', () => {
  const renderer = createMockWebGL2Renderer();
  const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: ns,
    canvas: { clientWidth: 640, clientHeight: 360 },
    post3d: { bloomStrength: 0.4 },
    worldLighting: {
      sun: { color: 0xffffff, intensity: 1.5, position: [10, 20, 10], cascades: { cascades: 3, mapSize: 256 } },
    },
  });

  const scene = new Scene('unified-dag-shadow');
  scene._setActive(true);
  adapter.render(scene);

  const g = adapter.getExecutedRenderGraph();
  const p = adapter.postPipeline;
  assert.ok(g, 'Executed frame RenderGraph must be captured');
  assert.deepEqual(g.executed, g.compiledOrder, 'Executed passes must match compiled DAG order');
  assert.deepEqual(p.getLastExecutedGraph(), g.executed, 'Adapter and postPipeline must share identical executed graph');
  assert.equal(g.executed[0], 'shadow-csm');
  assert.ok(g.executed.indexOf('shadow-csm') < g.executed.indexOf('world'));
  assert.ok(g.executed.indexOf('world') < g.executed.indexOf('tone-mapping'));

  const mainTarget = p.getMainTarget();
  assert.ok(mainTarget && mainTarget.texture && mainTarget.width > 0 && mainTarget.height > 0);
  assert.ok(p.getLastFrameGraph()?.compiledOrder?.length >= 3);

  adapter.dispose();
});

test('A2 unified RenderGraph omits shadow-csm and projected-decals when inactive and preserves decals pass ordering when active', () => {
  const renderer = createMockWebGL2Renderer();
  const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: ns,
    canvas: { clientWidth: 640, clientHeight: 360 },
    post3d: { bloomStrength: 0.25 },
  });

  const scene = new Scene('unified-dag-clean');
  scene._setActive(true);
  adapter.render(scene);

  const gEmpty = adapter.getExecutedRenderGraph();
  assert.ok(gEmpty);
  assert.equal(gEmpty.executed.includes('shadow-csm'), false);
  assert.equal(gEmpty.executed.includes('projected-decals'), false);
  assert.equal(gEmpty.executed[0], 'world');
  assert.ok(gEmpty.executed.includes('tone-mapping'));
  assert.deepEqual(gEmpty.executed, gEmpty.compiledOrder);

  const decals = adapter.createDecalSystem(scene, { mode: 'projected', maxDecals: 4 });
  decals.spawn({ position: [0, 0, 0], normal: [0, 1, 0], size: [1, 1, 1], color: 0xf97316 });
  adapter.render(scene);

  const gDecal = adapter.getExecutedRenderGraph();
  assert.ok(gDecal.executed.includes('projected-decals'));
  assert.ok(gDecal.executed.indexOf('world') < gDecal.executed.indexOf('projected-decals'));
  assert.ok(gDecal.executed.indexOf('projected-decals') < gDecal.executed.indexOf('tone-mapping'));

  decals.dispose();
  adapter.dispose();
});

test('A2 unified RenderGraph drives PhysicalRenderTargetPool3D aliasing across AO blur & FXAA', () => {
  const renderer = createMockWebGL2Renderer();
  const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: ns,
    canvas: { clientWidth: 640, clientHeight: 360 },
    post3d: {
      ssaoIntensity: 0.9,
      fxaa: true,
      bloomStrength: 0.4,
      preset: { ssao: true, bloom: true, fxaa: true, msaaSamples: 0, volumetricSteps: 0 },
    },
  });

  const scene = new Scene('unified-pool');
  scene._setActive(true);
  adapter.render(scene);

  const g = adapter.getExecutedRenderGraph();
  assert.ok(g.executed.includes('ao-volumetrics'));
  assert.ok(g.executed.includes('ao-blur-x'));
  assert.ok(g.executed.includes('ao-blur-y'));
  assert.ok(g.poolStats, 'poolStats must be reported on frame graph');
  assert.ok(g.poolStats.reuses >= 1, `expected physical RT reuse >= 1 in frame, got ${g.poolStats.reuses}`);
  assert.ok(g.poolStats.estimatedSavedBytes > 0, 'expected saved bytes > 0 from RT aliasing');

  adapter.render(scene);
  const g2 = adapter.getExecutedRenderGraph();
  assert.ok(g2.poolStats.reuses > g.poolStats.reuses, 'subsequent frames reuse pooled targets');
  adapter.dispose();
});

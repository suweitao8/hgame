import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Scene } from '../assets/runtime/index.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';

function createStubRenderer() {
  const gl = {
    MAX_SAMPLES: 0x8d57,
    MAX_TEXTURE_SIZE: 0x0d33,
    depthRange() {},
    getParameter() { return 4; },
    getExtension() { return null; },
  };
  return {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 8 },
    shadowMap: { enabled: false, type: 0 },
    autoClear: true,
    toneMapping: 0,
    info: { render: { calls: 0, triangles: 0 } },
    getContext: () => gl,
    setPixelRatio() {},
    setSize() {},
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

test('A2 createThreeAdapter renderGraph compiles scene DAG and prunes dead shadow/decal passes when inactive', () => {
  const renderer = createStubRenderer();
  const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: ns,
    canvas: { clientWidth: 390, clientHeight: 844 },
    post3d: false,
    renderGraph: true,
  });

  const scene = new Scene('dag-empty');
  scene._setActive(true);
  adapter.render(scene);

  const g1 = adapter.getExecutedRenderGraph();
  assert.ok(g1);
  assert.deepEqual(g1.executed, ['opaque-scene', 'post-composite']);
  assert.ok(g1.culled.includes('shadow-csm'));
  assert.ok(g1.culled.includes('projected-decals'));
  adapter.dispose();
});

test('A2 createThreeAdapter renderGraph activates shadow-csm and projected-decals passes dynamically when enabled', () => {
  const renderer = createStubRenderer();
  const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: ns,
    canvas: { clientWidth: 390, clientHeight: 844 },
    post3d: false,
    renderGraph: true,
    worldLighting: {
      sun: { color: 0xffffff, intensity: 1.5, position: [10, 20, 10], cascades: { cascades: 3, mapSize: 256 } },
    },
  });

  const scene = new Scene('dag-full');
  scene._setActive(true);
  const decals = adapter.createDecalSystem(scene, { mode: 'projected', maxDecals: 4 });
  decals.spawn({ position: [0, 0, 0], normal: [0, 1, 0], size: [1, 1, 1], color: 0xf97316 });

  adapter.render(scene);
  const g2 = adapter.getExecutedRenderGraph();
  assert.ok(g2);
  assert.deepEqual(g2.executed, ['shadow-csm', 'opaque-scene', 'projected-decals', 'post-composite']);
  assert.deepEqual(g2.culled, []);

  decals.dispose();
  adapter.dispose();
});

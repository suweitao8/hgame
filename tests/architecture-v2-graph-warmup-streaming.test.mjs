import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  Scene,
  createAssetCatalog,
  createStreamingResidencyPolicy,
} from '../assets/runtime/index.js';
import {
  compileRenderGraph,
  createPostPipeline3D,
} from '../assets/runtime/integrations/post3d.js';
import { createShaderWarmupQueue3D } from '../assets/runtime/integrations/quality3d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';

function createMockWebGL2Renderer() {
  const compileCalls = [];
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
  const renderer = {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 },
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
    compile(scene, camera) {
      compileCalls.push({ scene, camera });
    },
    dispose() {},
  };
  return { renderer, compileCalls };
}

test('compileRenderGraph prunes unreachable dead passes and records culledPasses', () => {
  const compiled = compileRenderGraph(
    [
      { id: 'scene_color', writes: ['hdr_color'] },
      { id: 'unused_debug_heatmap', reads: ['hdr_color'], writes: ['debug_tex'] },
      { id: 'orphan_blur', reads: ['nonexistent'], writes: ['orphan_out'] },
      { id: 'bloom', reads: ['hdr_color'], writes: ['bloom_tex'] },
      { id: 'tonemap', reads: ['hdr_color', 'bloom_tex'], writes: ['screen'] },
    ],
    {
      pruneDeadPasses: true,
      externalOutputs: ['screen'],
    },
  );
  assert.deepEqual(compiled.order, ['scene_color', 'bloom', 'tonemap']);
  assert.deepEqual([...compiled.culledPasses].sort(), ['orphan_blur', 'unused_debug_heatmap']);
  assert.equal(compiled.passes.length, 3);

  const { renderer } = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE,
    renderer,
    width: 320,
    height: 180,
    preset: { bloom: true, taa: false },
  });
  const plan = pipeline.getRenderGraphPlan({ pruneDeadPasses: true });
  assert.ok(plan.passes.length >= 2);
  assert.equal(Array.isArray(plan.culledPasses), true);
  pipeline.dispose();
});

test('createThreeAdapter supports gpuIndirect culling mode and shader warmup queue', () => {
  const { renderer, compileCalls } = createMockWebGL2Renderer();
  const namespace = {
    ...THREE,
    WebGLRenderer: class { constructor() { return renderer; } },
  };
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const adapter = createThreeAdapter({
    THREE: namespace,
    canvas: { clientWidth: 640, clientHeight: 360 },
    camera: cam,
    pixelRatio: 1,
    gpuIndirect: true,
    shaderWarmup: { budgetMsPerFrame: 2 },
  });

  let culled = 0;
  const batch = {
    count: 256,
    visibleCount: 0,
    cull(frustumPlanes) {
      assert.equal(frustumPlanes?.length, 24);
      culled++;
      this.visibleCount = 128;
      return 128;
    },
    render() {},
  };
  adapter.registerIndirectBatch('trees', batch);

  const hgameScene = new Scene('phase-c-three');
  const meshA = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff5522 }),
  );
  const meshB = new THREE.Mesh(
    new THREE.SphereGeometry(0.5),
    new THREE.MeshStandardMaterial({ color: 0x2299ff }),
  );
  adapter.enqueueShaderWarmup(meshA, cam);
  adapter.enqueueShaderWarmup(meshB, cam);
  const warmupStep = adapter.stepShaderWarmup(50);
  assert.ok(warmupStep.compiled >= 2);
  assert.equal(compileCalls.length, warmupStep.compiled);
  assert.equal(adapter.getShaderWarmupStats().compiled, warmupStep.compiled);

  adapter.render(hgameScene);
  assert.ok(culled >= 1);
  const stats = adapter.getGpuSubmitStats();
  assert.equal(stats.enabled, true);
  assert.equal(stats.batches, 1);

  assert.equal(adapter.unregisterIndirectBatch('trees'), true);
  assert.equal(adapter.getGpuSubmitStats().batches, 0);
  adapter.dispose();
});

test('createShaderWarmupQueue3D slices work across per-frame time budgets and deduplicates materials', async () => {
  let fakeNow = 0;
  const compiled = [];
  const renderer = {
    compile(scene, camera) {
      fakeNow += 2.5;
      compiled.push({ scene, camera });
    },
  };
  const queue = createShaderWarmupQueue3D(THREE, renderer, {
    budgetMsPerFrame: 3,
    now: () => fakeNow,
  });
  const cam = new THREE.PerspectiveCamera();
  const sharedMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mat1 = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const mat2 = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const mat3 = new THREE.MeshStandardMaterial({ color: 0x0000ff });

  assert.equal(queue.enqueueMaterials([sharedMat, mat1, mat2, mat3], cam), 4);
  const firstStep = queue.step(3);
  assert.equal(firstStep.compiled, 2); // 1st compile -> 2.5ms < 3ms, 2nd -> 5ms >= 3ms stop
  assert.equal(firstStep.done, false);

  const rest = await queue.warmupAll(cam);
  assert.equal(rest.done, true);
  assert.equal(queue.getStats().compiled, 4);
  assert.equal(queue.enqueueMaterials([sharedMat], cam), 0); // already compiled
  queue.dispose();
});

test('createStreamingResidencyPolicy manages distance mip upgrades/downgrades, evictions, and catalog residency stats', () => {
  const mipChanges = [];
  const evicted = [];
  const policy = createStreamingResidencyPolicy({
    maxBytes: 2 * 1024 * 1024, // 2 MiB budget
    nearDistance: 10,
    midDistance: 30,
    farDistance: 60,
  });

  // 64 MiB far props => 1 MiB even at mipBias=3; hero_tex is 1 MiB at mipBias=0
  policy.register('hero_tex', {
    position: { x: 2, y: 0, z: 0 },
    baseBytes: 1024 * 1024,
    priority: 10,
    onMipChange: (next, prev, entry) => mipChanges.push({ id: entry.id, next, prev }),
  });
  policy.register('far_prop_a', {
    position: { x: 40, y: 0, z: 0 },
    baseBytes: 64 * 1024 * 1024,
    priority: 1,
    onEvict: entry => evicted.push(entry.id),
  });
  policy.register('far_prop_b', {
    position: { x: 80, y: 0, z: 0 },
    baseBytes: 64 * 1024 * 1024,
    priority: 0,
    onEvict: entry => evicted.push(entry.id),
  });

  const tick1 = policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(tick1.withinBudget, true);
  assert.ok(tick1.residentBytes <= 2 * 1024 * 1024);
  assert.ok(evicted.includes('far_prop_b'));
  assert.ok(tick1.evictedCount >= 1);
  assert.equal(policy.getEntry('hero_tex').mipBias, 0);

  // Move hero_tex far away via viewer movement -> mip downgrades 0 -> 3
  const tick2 = policy.update({ x: 1000, y: 0, z: 0 });
  assert.equal(policy.getEntry('hero_tex').mipBias, 3);
  assert.ok(mipChanges.some(e => e.id === 'hero_tex' && e.next === 3));
  assert.equal(tick2.withinBudget, true);

  const catalog = createAssetCatalog(
    { schemaVersion: 1, baseUrl: './', assets: { hero: { kind: 'image', path: 'hero.png' } } },
    { loader: { load: async () => ({}) }, streamingPolicy: policy },
  );
  const resStats = catalog.getResidencyStats();
  assert.equal(resStats.streamingWithinBudget, true);
  assert.ok(resStats.streamingBytes > 0);
  assert.ok(resStats.streamingEvictions >= 1);

  catalog.dispose();
  policy.dispose();
});

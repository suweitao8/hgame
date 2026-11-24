import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Scene } from '../assets/runtime/index.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import { createPostPipeline3D } from '../assets/runtime/integrations/post3d.js';

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

test('3D pipeline reuses the compiled frame graph with current callbacks, then recompiles changed layouts', () => {
  const renderer = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE, renderer, width: 640, height: 360,
    preset: { bloom: true, fxaa: true, msaaSamples: 0 },
  });
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const seen = [];
  const frame = (value, id = 'frame-setup', writes = ['custom-output']) => {
    pipeline.render(world, camera, {
      extraPasses: {
        before: [{
          id,
          writes,
          execute: ({ pass }) => {
            assert.equal(typeof pass.execute, 'function');
            assert.equal(pass.transientSpecs.checked, undefined);
            pass.transientSpecs.checked = true;
            seen.push(value);
          },
        }],
      },
    });
    return pipeline.getLastFrameGraph().compiledOrder;
  };

  const first = frame(1);
  const { spec: ldrSpec } = pipeline.getLastFrameGraph().lifetimes.ldrColor;
  assert.equal(ldrSpec.width, 640);
  assert.throws(() => { ldrSpec.width = 7; }, TypeError);
  const plan = pipeline.getRenderGraphPlan();
  assert.equal(pipeline.getRenderGraphPlan(), plan);
  assert.equal(frame(2), first);
  assert.deepEqual(seen, [1, 2]);
  assert.throws(() => frame(0, new String('frame-setup')), /requires a nonempty id/);
  assert.throws(() => frame(0, 'frame-setup', [{ toJSON: () => 'custom-output' }]), /writes entries must be nonempty strings/);
  pipeline.resize(320, 180);
  assert.equal(pipeline.getRenderGraphPlan().lifetimes.ldrColor.spec.width, 640);
  assert.notEqual(frame(3), first);
  assert.equal(pipeline.getRenderGraphPlan().lifetimes.ldrColor.spec.width, 320);
  const resized = pipeline.getLastFrameGraph().compiledOrder;
  assert.equal(frame(4), resized);
  pipeline.setState({ fxaa: false, sharpness: 0 });
  const reduced = frame(5);
  assert.notEqual(reduced, resized);
  assert.ok(!reduced.includes('fxaa-sharpen'));
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  pipeline.dispose();
});

test('Bloom mips are graph-owned and their idle targets are reported until eviction', () => {
  const renderer = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE, renderer, width: 640, height: 360, bloomStrength: 0.4,
    preset: { bloom: true, ssao: false, fxaa: false, sharpen: 0, msaaSamples: 0, volumetricSteps: 0 },
  });
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const worldTarget = pipeline.getMainTarget().target;
  assert.equal(pipeline.getRenderTargets().length, 1, 'before first draw only the scene target is allocated');
  const render = () => pipeline.render(world, camera);
  render();
  assert.equal(pipeline.targets.bloomMipCount, 4);
  assert.deepEqual(pipeline.getLastExecutedGraph().filter(id => id.startsWith('bloom-')), [
    'bloom-prefilter', 'bloom-downsample-1', 'bloom-downsample-2', 'bloom-downsample-3',
    'bloom-upsample-2', 'bloom-upsample-1', 'bloom-upsample-0',
  ]);
  const firstBloomTargets = pipeline.getRenderTargets().filter(target => target !== worldTarget);
  assert.deepEqual(firstBloomTargets.map(target => [target.width, target.height]), [
    [320, 180], [160, 90], [80, 45], [40, 22], [80, 45], [160, 90], [320, 180],
  ]);
  assert.ok(firstBloomTargets.every(target => !target.depthBuffer &&
    target.texture.type === THREE.UnsignedInt101111Type && target.texture.format === THREE.RGBFormat));
  const plan = pipeline.getRenderGraphPlan();
  assert.equal(plan.lifetimes.bloomColor.lastRead, plan.order.indexOf('tone-mapping'));
  const activeBytes = pipeline.estimateTargetBytes().scalableBytes;
  pipeline.setState({ bloomStrength: 0 });
  render();
  assert.equal(pipeline.targets.bloomMipCount, 0);
  assert.ok(!pipeline.getLastExecutedGraph().some(id => id.startsWith('bloom-')));
  assert.equal(pipeline.estimateTargetBytes().scalableBytes, activeBytes, 'idle allocations are still resident');

  const reusedBytes = pipeline.targets.poolStats.estimatedSavedBytes;
  pipeline.setState({ bloomStrength: 0.4 });
  render();
  assert.deepEqual(pipeline.getRenderTargets().filter(target => target !== worldTarget), firstBloomTargets);
  assert.equal(pipeline.targets.poolStats.estimatedSavedBytes - reusedBytes, activeBytes);
  const disposed = new Set();
  for (const target of firstBloomTargets) target.addEventListener('dispose', () => disposed.add(target));
  pipeline.setState({ bloomStrength: 0 });
  for (let frame = 0; frame < 5; frame++) render();
  assert.equal(disposed.size, firstBloomTargets.length);
  assert.deepEqual(pipeline.getRenderTargets(), [worldTarget]);

  pipeline.setState({ bloomStrength: 0.4 });
  pipeline.resize(2, 2);
  render();
  assert.equal(pipeline.targets.bloomMipCount, 1);
  assert.deepEqual(pipeline.getLastExecutedGraph().filter(id => id.startsWith('bloom-')), ['bloom-prefilter']);
  pipeline.handleContextLost();
  assert.equal(pipeline.getRenderTargets().length, 0);
  pipeline.handleContextRestored();
  render();
  assert.deepEqual(pipeline.getLastExecutedGraph().filter(id => id.startsWith('bloom-')), ['bloom-prefilter']);
  pipeline.dispose();
  assert.equal(pipeline.getRenderTargets().length, 0);
});

test('scene attachments are leased during the graph and reused across internal render-scale changes', () => {
  const renderer = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE, renderer, width: 640, height: 360,
    temporalAA: true, temporalUpsampling: true, renderScale: 0.5,
  });
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const reduced = pipeline.getMainTarget();
  assert.deepEqual([reduced.width, reduced.height], [320, 180]);
  pipeline.render(world, camera);
  pipeline.setState({ renderScale: 1 });
  const full = pipeline.getMainTarget();
  assert.deepEqual([full.width, full.height], [640, 360]);
  pipeline.render(world, camera);
  pipeline.setState({ renderScale: 0.5 });
  assert.ok(pipeline.getMainTarget().target === reduced.target, 'reuse a recently used color and depth target');
  assert.ok(pipeline.getRenderTargets().includes(full.target), 'count idle native-resolution target until eviction');
  let observed = false;
  pipeline.render(world, camera, {
    extraPasses: { afterWorld: [{ id: 'inspect-scene-attachments', execute({ inputs, state }) {
      assert.equal(inputs.sceneTarget, reduced.target);
      assert.equal(state.sceneRT, reduced.target);
      assert.equal(state.sceneRT.depthTexture, reduced.depthTexture);
      assert.ok(pipeline.targets.poolStats.activeCount > 0);
      observed = true;
    } }] },
  });
  assert.equal(observed, true);
  const graph = pipeline.getLastFrameGraph();
  assert.equal(graph.lifetimes.sceneTarget.firstWrite, graph.executed.indexOf('world'));
  assert.equal(graph.lifetimes.sceneTarget.lastRead, graph.executed.indexOf('tone-mapping'));
  assert.equal(pipeline.targets.poolStats.activeCount, 0);
  assert.throws(() => pipeline.render(world, camera, {
    extraPasses: { afterWorld: [{ id: 'failed-scene-pass', execute() { throw new Error('failed scene pass'); } }] },
  }), /failed scene pass/);
  assert.equal(pipeline.targets.poolStats.activeCount, 0);
  for (let frame = 0; frame < 3; frame++) pipeline.render(world, camera);
  assert.ok(!pipeline.getRenderTargets().includes(full.target));
  assert.equal(pipeline.getMainTarget().target, reduced.target);
  pipeline.dispose();
  assert.equal(pipeline.getRenderTargets().length, 0);
});

test('post-world depth readers request an MSAA depth resolve for their scene target', () => {
  const renderer = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE, renderer, width: 640, height: 360,
    preset: { msaaSamples: 2, bloom: false, ssao: false, volumetricSteps: 0, contactShadows: false },
  });
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  pipeline.render(world, camera);
  assert.equal(pipeline.getMainTarget().target.resolveDepthBuffer, false);
  let observed = false;
  pipeline.render(world, camera, {
    extraPasses: { afterWorld: [{
      id: 'projected-depth-reader',
      reads: ['sceneDepth'],
      execute({ inputs }) {
        assert.equal(inputs.sceneTarget.samples, 2);
        assert.equal(inputs.sceneTarget.resolveDepthBuffer, true);
        assert.equal(inputs.sceneTarget.storeMultisampledDepthBuffer, true);
        observed = true;
      },
    }] },
  });
  assert.equal(observed, true);
  pipeline.dispose();
});

test('skipped world passes leave the configured target available', () => {
  const pipeline = createPostPipeline3D({ THREE, renderer: createMockWebGL2Renderer(), width: 640, height: 360 });
  const target = pipeline.getMainTarget().target;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  for (let i = 0; i < 5; i++) {
    assert.throws(() => pipeline.render(world, camera, {
      extraPasses: { before: [{ id: 'skip-world', execute() { throw new Error('skip world'); } }] },
    }), /skip world/);
  }
  assert.ok(pipeline.getRenderTargets().includes(target));
  assert.equal(pipeline.getMainTarget().target, target);
  pipeline.dispose();
});

test('configuration changes during a hook leave the next scene target correctly sized', () => {
  const pipeline = createPostPipeline3D({
    THREE, renderer: createMockWebGL2Renderer(), width: 640, height: 360,
    temporalAA: true, temporalUpsampling: true,
  });
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  pipeline.render(world, camera, {
    extraPasses: { before: [{ id: 'change-scale', execute() { pipeline.setState({ renderScale: 0.5 }); } }] },
  });
  assert.equal(pipeline.getMainTarget().width, 320);
  pipeline.render(world, camera);
  assert.equal(pipeline.getTemporalStats().internalWidth, 320);
  pipeline.dispose();
});

test('scene configurations that are never drawn do not accumulate targets', () => {
  const pipeline = createPostPipeline3D({
    THREE, renderer: createMockWebGL2Renderer(), width: 640, height: 360,
    temporalAA: true, temporalUpsampling: true,
  });
  for (let i = 1; i <= 20; i++) pipeline.setState({ renderScale: i / 40 + 0.25 });
  assert.equal(pipeline.getRenderTargets().length, 1);
  pipeline.dispose();
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  Entity,
  Scene,
  createWorldPartition,
  createHLODProxyGroup3D,
  createFloatingOrigin,
} from '../assets/runtime/index.js';
import { QUALITY3D_PRESETS } from '../assets/runtime/integrations/quality3d.js';
import { createProceduralSky3D } from '../assets/runtime/integrations/sky3d.js';
import {
  computeWhiteBalanceRGB,
  evaluateFilmicCurveChannel,
  evaluateFilmicCurveRGB,
  stepEyeAdaptation,
  createPostProcessVolumeStack,
  createPostPipeline3D,
} from '../assets/runtime/integrations/post3d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import {
  createMegaLights3D,
  computeStochasticLightSample,
  createIrradianceProbeVolume3D,
} from '../assets/runtime/integrations/lighting3d.js';
import {
  createWorldAlignedMaterial,
  createWorldMaterialPalette,
} from '../assets/runtime/integrations/world-aligned-material.js';
import {
  createInstancedBatch3D,
  createGpuIndirectCuller3D,
  GPU_CULL_WGSL,
} from '../assets/runtime/integrations/culling3d.js';

function createMockRendererNS({ isWebGL2 = true } = {}) {
  const calls = [];
  const state = { instances: [] };
  const gl = isWebGL2
    ? {
        MAX_SAMPLES: 0x8d57,
        MAX_TEXTURE_SIZE: 0x0d33,
        depthRange(a, b) { calls.push(['depthRange', a, b]); },
        getParameter(p) {
          if (p === 0x8d57) return 4;
          if (p === 0x0d33) return 8192;
          if (p === 'UNMASKED') return 'NVIDIA RTX 4080';
          return 0;
        },
        getExtension(name) {
          if (name === 'EXT_color_buffer_float') return {};
          if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 'UNMASKED' };
          return null;
        },
      }
    : {
        depthRange(a, b) { calls.push(['depthRange', a, b]); },
      };

  class MockWebGLRenderer {
    constructor({ canvas }) {
      this.domElement = canvas;
      this.capabilities = { isWebGL2, getMaxAnisotropy: () => 16 };
      this.shadowMap = { enabled: false, type: 0 };
      this.autoClear = true;
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.outputColorSpace = '';
      state.instances.push(this);
    }
    getContext() { return gl; }
    setPixelRatio(r) { calls.push(['setPixelRatio', r]); }
    setSize(w, h) { calls.push(['setSize', w, h]); }
    setRenderTarget(rt) { calls.push(['setRenderTarget', rt ? `${rt.width}x${rt.height}` : 'screen']); }
    clear(c, d, s) { calls.push(['clear', c, d, s]); }
    clearDepth() { calls.push(['clearDepth']); }
    render(s, c) { calls.push(['render', s.children?.length ?? 0, c.isOrthographicCamera ? 'ortho' : 'persp']); }
    dispose() { calls.push(['dispose']); }
  }

  return {
    MockTHREE: { ...THREE, WebGLRenderer: MockWebGLRenderer },
    calls,
    getRenderer: () => state.instances[0],
  };
}

function makeMockCanvas(width = 800, height = 600) {
  return {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {},
    removeEventListener() {},
  };
}

test('Pipeline deduplication: sky linear HDR output + single exposure ownership across WebGL2/WebGL1', () => {
  const sky = createProceduralSky3D(THREE, { preset: 'day', exposure: 1.3 });
  assert.equal(sky.linearOutput, false);
  assert.equal(sky.material.toneMapped, true);

  // WebGL2 with post3d owns exposure, tonemapping and sRGB output exclusively.
  const webgl2 = createMockRendererNS({ isWebGL2: true });
  const adapter2 = createThreeAdapter({
    THREE: webgl2.MockTHREE,
    canvas: makeMockCanvas(),
    post3d: { preset: QUALITY3D_PRESETS.medium },
    toneMapping: 'ueFilmic',
    exposure: 1.45,
    sky,
  });
  assert.equal(adapter2.postPipeline.supported, true);
  assert.equal(adapter2.postPipeline.state.exposure, 1.45);
  assert.equal(adapter2.postPipeline.state.toneMapping, 3, 'ueFilmic maps to mode index 3');
  assert.equal(webgl2.getRenderer().toneMapping, THREE.NoToneMapping);
  assert.equal(webgl2.getRenderer().toneMappingExposure, 1.0);
  assert.equal(sky.linearOutput, true);
  assert.equal(sky.material.toneMapped, false);

  adapter2.setExposure(1.75);
  assert.equal(adapter2.postPipeline.state.exposure, 1.75);
  assert.equal(webgl2.getRenderer().toneMappingExposure, 1.0);
  adapter2.dispose();

  // WebGL1 forward path switches sky back to sRGB+tonemap output and routes exposure to renderer.
  const webgl1 = createMockRendererNS({ isWebGL2: false });
  const adapter1 = createThreeAdapter({
    THREE: webgl1.MockTHREE,
    canvas: makeMockCanvas(),
    toneMapping: 'ueFilmic',
    exposure: 1.6,
    sky,
  });
  assert.equal(webgl1.getRenderer().toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(webgl1.getRenderer().toneMappingExposure, 1.6);
  assert.equal(sky.linearOutput, false);
  adapter1.setExposure(1.25);
  assert.equal(webgl1.getRenderer().toneMappingExposure, 1.25);
  adapter1.dispose();
  sky.dispose();
});

test('UE Filmic curve, White Balance, Eye Adaptation, SSGI/SSR targets, and PostProcessVolumeStack blending', () => {
  // 1. White balance exact D65 identity + Planckian warm/cool conservation
  const wbNeutral = computeWhiteBalanceRGB(6500, 0);
  assert.deepEqual(wbNeutral, [1, 1, 1]);
  const wbWarm = computeWhiteBalanceRGB(9500, 0);
  assert.ok(wbWarm[0] > 1 && wbWarm[2] < 1);
  const wbCool = computeWhiteBalanceRGB(3400, 0);
  assert.ok(wbCool[2] > 1 && wbCool[0] < 1);
  const wbTint = computeWhiteBalanceRGB(6500, 0.4);
  assert.ok(wbTint[1] < wbTint[0] && wbTint[1] < wbTint[2]);

  // 2. Parametric UE Filmic curve properties
  assert.equal(evaluateFilmicCurveChannel(0), 0);
  const samples = [0.005, 0.02, 0.08, 0.18, 0.5, 1.2, 4.0, 12.0];
  let prev = -1;
  for (const s of samples) {
    const v = evaluateFilmicCurveChannel(s);
    assert.ok(v > prev && v <= 1.0, `monotonic at ${s}: ${prev} -> ${v}`);
    prev = v;
  }
  const midGray = evaluateFilmicCurveChannel(0.18);
  assert.ok(Math.abs(midGray - 0.189) < 0.03, `preserves 18% middle gray closely, got ${midGray}`);
  assert.ok(evaluateFilmicCurveChannel(0.03, { toe: 0.9 }) < evaluateFilmicCurveChannel(0.03, { toe: 0.1 }));
  const rgbOut = evaluateFilmicCurveRGB([2, 0.5, 0.25]);
  assert.ok(rgbOut.every(v => v >= 0 && v <= 1));

  // 3. Asymmetric Eye Adaptation
  const brightStep = stepEyeAdaptation(1.0, 5.0, {}, 0.2);
  const darkStep = stepEyeAdaptation(1.0, 0.02, {}, 0.2);
  assert.ok(brightStep < 1.0 && Math.abs(1.0 - brightStep) > Math.abs(darkStep - 1.0) * 0.5);
  assert.equal(stepEyeAdaptation(1.0, 1000, { minExposure: 0.4 }, 10).toFixed(2), '0.40');
  assert.equal(stepEyeAdaptation(1.0, 0.0001, { maxExposure: 2.5 }, 10).toFixed(2), '2.50');

  // 4. Spatial PostProcessVolumeStack priority + smooth blendRadius
  const stack = createPostProcessVolumeStack([
    {
      id: 'global',
      priority: 0,
      unbound: true,
      settings: { exposure: 1.0, whiteTemp: 6500, bloomStrength: 0.2, toneMapping: 'ueFilmic' },
    },
    {
      id: 'cave',
      priority: 5,
      shape: 'box',
      center: [20, 0, 0],
      extents: [4, 4, 4],
      blendRadius: 4,
      settings: { exposure: 2.0, whiteTemp: 4500, bloomStrength: 0.6, toneMapping: 'agx' },
    },
  ]);

  const outside = stack.evaluate([0, 0, 0]);
  assert.equal(outside.exposure, 1.0);
  assert.equal(outside.toneMapping, 'ueFilmic');

  const halfway = stack.evaluate([14, 0, 0]); // sd = 16-14 = 2 (50% through blendRadius=4)
  assert.ok(Math.abs(halfway.exposure - 1.5) < 1e-6);
  assert.equal(halfway.toneMapping, 'agx');

  const inside = stack.evaluate([20, 0, 0]);
  assert.equal(inside.exposure, 2.0);
  assert.equal(inside.whiteTemp, 4500);

  // 5. WebGL2 post3d allocates Half-Res HDR GI/SSR + Eye Adaptation on high preset
  const webgl2 = createMockRendererNS({ isWebGL2: true });
  const r = new webgl2.MockTHREE.WebGLRenderer({ canvas: makeMockCanvas(640, 360) });
  const post = createPostPipeline3D({
    THREE: webgl2.MockTHREE,
    renderer: r,
    width: 640,
    height: 360,
    preset: QUALITY3D_PRESETS.high,
    toneMapping: 'ueFilmic',
    autoExposure: true,
  });
  assert.equal(post.targets.hasGiSsrRT, true);
  assert.equal(post.targets.hasAutoExposureRT, true);
  assert.equal(post.targets.hasHalfRT, true);

  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2);
  stack.applyToPipeline(post, [20, 0, 0]);
  assert.equal(post.state.exposure, 2.0);
  post.render(world, cam, { sunLight: sun, dt: 1 / 60 });

  const targetsHit = webgl2.calls.filter(c => c[0] === 'setRenderTarget').map(c => c[1]);
  assert.ok(targetsHit.includes('64x64') && targetsHit.includes('1x1'), 'auto-exposure mip chain ran');
  assert.ok(targetsHit.includes('320x180'), 'half-res AO/SSGI/SSR ran');
  assert.equal(targetsHit.at(-1), 'screen');

  post.setPreset(QUALITY3D_PRESETS.low);
  assert.equal(post.targets.hasGiSsrRT, false);
  post.dispose();
});

test('MegaLights skips static uploads and queues row-bounded ranges across updates before a draw', () => {
  const mega = createMegaLights3D(THREE, { maxLights: 16 });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const left = mega.addLight({ x: -2, y: 0, z: -8, range: 0.75 });
  const right = mega.addLight({ x: 2, y: 0, z: -8, range: 0.75 });
  const { lightDataTexture: light, clusterTexture: clusters } = mega;
  const gpuConsumed = texture => {
    texture.clearUpdateRanges();
    texture.onUpdate?.(texture);
  };
  const versions = () => [light.version, clusters.version];
  const active = mega.update(camera);
  assert.equal(active, 2);
  gpuConsumed(light);
  gpuConsumed(clusters);
  const initial = versions();
  const uploadedLightSourceVersion = light.source.version;
  mega.update(camera, 0.017, { width: 501, height: 350 });
  assert.deepEqual(versions(), initial);
  assert.equal(mega.uniforms.uMegaResolution.value.x, 501);
  assert.equal(mega.uniforms.uMegaTime.value, 0.017);

  mega.updateLight(left, { intensity: 3 });
  mega.update(camera);
  assert.deepEqual(versions(), [initial[0] + 1, initial[1]]);
  assert.ok(light.updateRanges.length > 0);
  assert.equal(light.userData.hgameDataTextureRangeBaseVersion, uploadedLightSourceVersion);
  assert.ok(light.updateRanges.every(range => range.start < 16 && range.start + range.count <= 16));
  mega.updateLight(right, { intensity: 2 });
  mega.update(camera);
  assert.equal(light.updateRanges.length, 2);
  assert.ok(light.updateRanges.some(range => range.start >= 16));
  assert.ok(mega.uploadStats.light.queuedBytes < light.image.data.byteLength);
  assert.equal(mega.uploadStats.cluster.queuedBytes, 0);
  gpuConsumed(light);

  mega.updateLight(left, { x: 4 });
  mega.update(camera);
  assert.ok(clusters.version > initial[1]);
  assert.ok(clusters.updateRanges.length > 0);
  assert.ok(clusters.updateRanges.every(({ start, count }) => (start % 512) + count <= 512));
  assert.ok(mega.uploadStats.cluster.queuedBytes < clusters.image.data.byteLength);
  gpuConsumed(clusters);
  const beforeMove = versions();
  camera.position.x = 1;
  mega.update(camera);
  assert.ok(light.version > beforeMove[0]);
  mega.clear();
  assert.equal(mega.activeCount, 0);
  assert.ok(!clusters.image.data.some(Boolean));
  assert.ok(!light.image.data.some(Boolean));
  mega.dispose();

  const stock = createMegaLights3D({ ...THREE, HGAME_FULL_DATA_TEXTURE_INITIAL_UPLOAD: false }, { maxLights: 16 });
  const id = stock.addLight({ z: -8 });
  stock.update(camera);
  gpuConsumed(stock.lightDataTexture);
  stock.updateLight(id, { intensity: 9 });
  stock.update(camera);
  assert.deepEqual(stock.lightDataTexture.updateRanges, []);
  assert.equal(stock.uploadStats.light.queuedBytes, stock.lightDataTexture.image.data.byteLength);
  stock.dispose();

  const stub = createMegaLights3D({ DataTexture: class { dispose() {} } });
  stub.addLight({ z: -8 });
  assert.equal(stub.update(camera), 1);
  stub.dispose();
});

test('MegaLights3D 300+ lights, cluster packing, stochastic unbiasedness, SH probes, and full material shader stack', () => {
  const mega = createMegaLights3D(THREE, { maxLights: 512, samplesPerPixel: 3 });
  for (let i = 0; i < 300; i++) {
    const angle = (i / 300) * Math.PI * 20;
    mega.addLight({
      type: i % 5 === 0 ? 'spot' : 'point',
      x: Math.cos(angle) * (4 + (i % 15)),
      y: 1.5,
      z: -12 - (i % 40),
      color: i % 2 === 0 ? 0xffaa44 : 0x55aaff,
      intensity: 5 + (i % 4),
      range: 10,
      direction: [0, -1, 0],
    });
  }
  const flashId = mega.flash({ x: 0, y: 1, z: -8, intensity: 12, range: 12, duration: 0.1 });
  assert.equal(mega.count, 301);

  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 250);
  cam.position.set(0, 2, 10);
  cam.lookAt(0, 1, -20);
  cam.updateMatrixWorld(true);

  const activeHigh = mega.update(cam, 0.05, { width: 1280, height: 720 });
  assert.ok(activeHigh > 200, `expected > 200 visible lights, got ${activeHigh}`);

  // Transient flash expires after duration completes
  mega.update(cam, 0.12);
  assert.equal(mega.count, 300);
  assert.equal(mega.removeLight(flashId), false);

  // Quality tier clamps cluster light budget and sample budget smoothly
  mega.setQualityPreset(QUALITY3D_PRESETS.medium);
  const activeMed = mega.update(cam, 0.016);
  assert.equal(activeMed, QUALITY3D_PRESETS.medium.maxClusteredLights);
  assert.equal(mega.samplesPerPixel, QUALITY3D_PRESETS.medium.megaLightsSamples);

  const clusterInfo = mega.evaluateClusterAtViewPos(0, -1, -20, 0, 0);
  assert.ok(clusterInfo.count > 0, 'cluster overlapping view corridor contains lights');

  // Verify Monte Carlo importance sampling is statistically unbiased (< 3% over 4000 stratified draws)
  const testLights = [
    { x: 2, y: 2, z: 0, intensity: 9, range: 15, luminance: 9 },
    { x: -3, y: 4, z: 1, intensity: 3, range: 12, luminance: 3 },
    { x: 0, y: 1, z: -2, intensity: 16, range: 18, luminance: 16 },
    { x: 5, y: 3, z: 4, intensity: 2, range: 10, luminance: 2 },
  ];
  const exactTotal = testLights.reduce((acc, l, i) => {
    const res = computeStochasticLightSample([l], [0, 0, 0], [0, 1, 0], 0.5);
    return acc + (res ? l.intensity * (i + 1) * 0.1 : 0);
  }, 0);
  let mcAccum = 0;
  const N = 4000;
  for (let s = 0; s < N; s++) {
    const draw = computeStochasticLightSample(testLights, [0, 0, 0], [0, 1, 0], (s + 0.5) / N);
    mcAccum += draw.candidate.intensity * (draw.index + 1) * 0.1 * draw.unbiasedScale;
  }
  const mcMean = mcAccum / N;
  assert.ok(Math.abs(mcMean - exactTotal) / exactTotal < 0.03, `MC=${mcMean} vs exact=${exactTotal}`);

  // Irradiance Probe Volume SH L1 exact hemisphere integral + point bounce
  const probes = createIrradianceProbeVolume3D(THREE, {
    min: [-20, 0, -20],
    max: [20, 12, 20],
    resolution: [5, 3, 5],
  });
  probes.injectHemisphere({ skyColor: 0xffffff, groundColor: 0x000000, intensity: 1.0 });
  const irrUp = probes.sampleIrradiance(0, 6, 0, 0, 1, 0);
  const irrSide = probes.sampleIrradiance(0, 6, 0, 1, 0, 0);
  const irrDown = probes.sampleIrradiance(0, 6, 0, 0, -1, 0);
  assert.ok(Math.abs(irrUp[0] - Math.PI) < 0.15, `up=${irrUp[0]} ~ PI`);
  assert.ok(Math.abs(irrSide[0] - Math.PI * 0.5) < 0.1, `side=${irrSide[0]} ~ PI/2`);
  assert.ok(irrDown[0] < 0.1, `down=${irrDown[0]} ~ 0`);

  probes.clear();
  probes.injectPointLightBounce({ x: 4, y: 4, z: 0, color: 0xff5500, intensity: 10, range: 12 });
  const nearLight = probes.sampleIrradiance(3, 4, 0, 1, 0, 0);
  const farAway = probes.sampleIrradiance(-15, 4, 0, 1, 0, 0);
  assert.ok(nearLight[0] > farAway[0] && nearLight[0] > nearLight[2]);

  // Composable onBeforeCompile stacking with WorldAligned + SpecularAA + MegaLights + SH Probe Volume
  const mat = createWorldAlignedMaterial(THREE, {
    pattern: 'stone',
    projection: 'triplanar',
    specularAA: true,
    normalStrength: 0.5,
    roughnessVariation: 0.4,
    aoIntensity: 0.5,
  });
  mega.applyToMaterial(mat);
  probes.applyToMaterial(mat);

  const cacheKey = mat.customProgramCacheKey();
  assert.match(cacheKey, /world-aligned-v2/);
  assert.match(cacheKey, /specaa/);
  assert.match(cacheKey, /megalights/);
  assert.match(cacheKey, /shprobes/);

  const mockShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  mat.onBeforeCompile(mockShader, {});
  assert.ok(mockShader.uniforms.uWorldAlignedTexture);
  assert.ok(mockShader.uniforms.uSpecAAStrength);
  assert.ok(mockShader.uniforms.uMegaLightData);
  assert.ok(mockShader.uniforms.uMegaClusterTex);
  assert.ok(mockShader.uniforms.uProbeVolumeTex);
  assert.match(mockShader.vertexShader, /vWorldAlignedPos/);
  assert.match(mockShader.vertexShader, /vShProbeWorldPos/);
  assert.match(mockShader.fragmentShader, /sampleShProbeVolume/);
  assert.match(mockShader.fragmentShader, /megaLightWeight/);

  mat.dispose();
  mega.dispose();
  probes.dispose();
});

test('World partition keeps its proxy during failed or cancelled promotion', async () => {
  const created = [], destroyed = [], released = [], jobs = [], failures = [];
  const partition = createWorldPartition({
    cellSize: 10, loadRadius: 2, unloadRadius: 4, hlodRadius: 20, hlodUnloadRadius: 30,
    cellFilter: cell => cell.key === '0,0',
    loadCell(_cell, { signal } = {}) {
      const job = Promise.withResolvers();
      jobs.push({ ...job, signal });
      return job.promise;
    },
    unloadCell(_cell, data) { released.push(data); },
    createHLOD() { const proxy = {}; created.push(proxy); return proxy; },
    destroyHLOD(_cell, proxy) { destroyed.push(proxy); },
    onCellError(cell, error, stage) { failures.push([cell.key, error, stage]); },
  });
  const near = [5, 0, 5], far = [25, 0, 5], hysteresisRing = [37, 0, 5];
  partition.step(far);
  partition.step(near);
  assert.equal(partition.getCellState(0, 0), 'loading');
  assert.deepEqual(partition.getHlodCells().map(cell => cell.key), ['0,0']);
  assert.equal(partition.stats.hlod, 1);
  const error = new Error('detail load failed');
  jobs[0].reject(error);
  await Promise.resolve();
  assert.equal(partition.getCellState(0, 0), 'hlod');
  assert.deepEqual(failures, [['0,0', error, 'load']]);
  partition.step(near);
  partition.step(hysteresisRing);
  assert.equal(jobs[1].signal.aborted, true);
  assert.equal(partition.getCellState(0, 0), 'hlod');
  assert.equal(created.length, 1);
  const stale = {};
  jobs[1].resolve(stale);
  await Promise.resolve();
  assert.deepEqual(released, [stale]);
  assert.deepEqual(destroyed, []);
  partition.step(near);
  const ready = {};
  jobs[2].resolve(ready);
  await Promise.resolve();
  assert.equal(partition.getCellState(0, 0), 'loaded');
  assert.equal(partition.getCellData(0, 0), ready);
  assert.deepEqual(destroyed, created);
  partition.step(far);
  partition.step(near);
  partition.clear();
  assert.equal(jobs[3].signal.aborted, true);
  assert.equal(partition.stats.tracked, 0);
  assert.deepEqual(destroyed, created);
  const cleared = {};
  jobs[3].resolve(cleared);
  await Promise.resolve();
  assert.deepEqual(released, [stale, ready, cleared]);
});

test('World partition keeps full data when downgrade fails and budgets proxy preparation', () => {
  const events = [], failures = [];
  const error = new Error('proxy build failed');
  let shouldFail = true;
  const partition = createWorldPartition({
    cellSize: 10, loadRadius: 2, unloadRadius: 4, hlodRadius: 40,
    cellFilter: cell => cell.key === '0,0' || cell.key === '1,0',
    maxHlodBuildsPerStep: 1,
    loadCell: cell => cell.key,
    unloadCell(cell, data) { assert.equal(data, cell.key); events.push(['unload', cell.key]); },
    createHLOD(cell) {
      events.push(['prepare', cell.key]);
      if (shouldFail && cell.key === '0,0') throw error;
      return cell.key;
    },
    onCellError(cell, cause, stage) { failures.push([cell.key, cause, stage]); },
  });
  partition.step([10, 0, 5]);
  assert.equal(partition.stats.loaded, 2);
  partition.step([33, 0, 5]);
  assert.equal(partition.stats.loaded, 2);
  assert.equal(partition.getCellData(0, 0), '0,0');
  assert.deepEqual(events, [['prepare', '0,0']]);
  assert.deepEqual(failures, [['0,0', error, 'hlod']]);
  const downgrade = partition.step([33, 0, 5]);
  assert.equal(downgrade.hlodCreated, 1);
  assert.equal(downgrade.unloaded, 1);
  assert.deepEqual(events.slice(1), [['prepare', '1,0'], ['unload', '1,0']]);
  assert.equal(partition.getCellState(0, 0), 'loaded');
  assert.equal(partition.getCellState(1, 0), 'hlod');
  shouldFail = false;
  partition.step([33, 0, 5]);
  assert.equal(partition.getCellState(0, 0), 'hlod');
});

test('Open-World: WorldPartition hysteresis + velocity lookahead + HLOD batching + Floating Origin Float64 preservation', () => {
  const events = [];
  const partition = createWorldPartition({
    cellSize: 100,
    loadRadius: 80,
    unloadRadius: 130,
    hlodRadius: 260,
    hlodUnloadRadius: 310,
    maxLoadsPerStep: 2,
    maxUnloadsPerStep: 4,
    maxHlodBuildsPerStep: 6,
    loadCell: (c) => { events.push(['load', c.key]); return { id: c.key }; },
    unloadCell: (c) => { events.push(['unload', c.key]); },
    createHLOD: (c) => { events.push(['hlod+', c.key]); return { proxy: c.key }; },
    destroyHLOD: (c) => { events.push(['hlod-', c.key]); },
  });

  partition.forceFlush([50, 0, 50]);
  assert.equal(partition.getCellState(0, 0), 'loaded');
  assert.ok(partition.getHlodCells().length > 0, 'outer ring builds HLOD proxies');

  // Move just outside loadRadius=80 of cell (0,0) (edge at x=100, dist=95 <= unloadRadius=130):
  // hysteresis keeps cell (0,0) loaded without unload/reload thrashing!
  partition.step([195, 0, 50]);
  assert.equal(partition.getCellState(0, 0), 'loaded');

  // Move past unloadRadius=130 into HLOD ring: cell (0,0) downgrades cleanly to HLOD
  partition.step([250, 0, 50]);
  assert.equal(partition.getCellState(0, 0), 'hlod');

  // Velocity lookahead prioritizes cells ahead (+X) under strict per-step load budget
  partition.clear();
  events.length = 0;
  const budgeted = createWorldPartition({
    cellSize: 100,
    loadRadius: 150,
    unloadRadius: 200,
    maxLoadsPerStep: 1,
    lookaheadSeconds: 1.0,
    loadCell: (c) => c.key,
  });
  budgeted.step([50, 0, 50], [150, 0, 0]);
  assert.equal(budgeted.stats.loaded, 1);
  // Lookahead point is (200, 0, 50) inside cell (2, 0), closer to (1,0)/(2,0) than (-1,0)
  assert.equal(budgeted.getCellState(1, 0), 'loaded');
  budgeted.pinCell(-5, 0);
  budgeted.step([50, 0, 50], [0, 0, 0]);
  assert.equal(budgeted.getCellState(-5, 0), 'loaded', 'pinned cells receive priority load');
  budgeted.step([2000, 0, 2000], [0, 0, 0]);
  assert.equal(budgeted.getCellState(-5, 0), 'loaded', 'pinned cells stay loaded even far away');

  // HLOD InstancedMesh batching
  const parentGroup = new THREE.Group();
  const proxies = [];
  for (let i = 0; i < 40; i++) {
    proxies.push({ x: i * 4, y: 1, z: -10, sx: 2, sy: 4, sz: 2, color: 0x7799aa });
  }
  const hlodBatch = createHLODProxyGroup3D(THREE, { parent: parentGroup, proxies });
  assert.equal(hlodBatch.drawCallCount, 1);
  assert.equal(hlodBatch.instanceCount, 40);
  assert.equal(parentGroup.children.length, 1);
  assert.equal(hlodBatch.dispose(), true);
  assert.equal(parentGroup.children.length, 0);

  // Floating Origin: Float64 global coordinates + entity interpolation safety + palette offset sync
  const origin = createFloatingOrigin({ threshold: 4096, snapGrid: 64 });
  const scene = new Scene('openworld');
  const player = scene.add(new Entity({ name: 'hero', x: 5000, y: 12, z: -4500 }));
  player._capturePreviousTransform();
  player.x = 5005;
  player.z = -4502;
  const mesh = new THREE.Group();
  mesh.position.set(120, 0, -80);
  const probes = createIrradianceProbeVolume3D(THREE, { min: [-32, 0, -32], max: [32, 16, 32] });
  const palette = createWorldMaterialPalette(THREE, { road: { pattern: 'concrete', projection: 'planar' } });

  origin.registerScene(scene);
  origin.registerObject3D(mesh);
  origin.registerProbeVolume(probes);
  origin.registerWorldMaterialPalette(palette);

  const shift = origin.update([player.x, player.y, player.z]);
  assert.equal(shift.shifted, true);
  assert.equal(shift.dx % 64, 0);
  assert.equal(Math.abs(shift.dz % 64), 0);
  assert.ok(shift.dx !== 0 && shift.dz !== 0);
  assert.ok(Math.hypot(player.x, player.z) < 64, 'player re-centered near local origin');
  assert.ok(Math.abs((player.x - player._prevX) - 5) < 1e-9, 'previous transform shifted identically so renderAlpha never streaks');

  const globalRec = origin.localToWorld(player.x, player.y, player.z);
  assert.ok(Math.abs(globalRec[0] - 5005) < 1e-9);
  assert.ok(Math.abs(globalRec[2] - (-4502)) < 1e-9);

  // Multi-hundred-km travel preserves Float64 precision while keeping local coords bounded
  for (let hop = 0; hop < 100; hop++) {
    player.x += 5000;
    player.z -= 3000;
    origin.update([player.x, player.y, player.z]);
  }
  const farGlobal = origin.localToWorld(player.x, player.y, player.z);
  assert.ok(Math.hypot(player.x, player.z) < 4096, 'local coordinates remain near precision origin');
  assert.ok(Math.abs(farGlobal[0] - 505005) < 1e-6);
  assert.ok(Math.abs(farGlobal[2] - (-304502)) < 1e-6);

  // Verify shader uWorldAlignedOffset compensated exactly for world-space texture alignment
  const roadOffset = palette.get('road').userData.worldAlignedOffsetUniform.value;
  assert.equal(roadOffset.x, origin.origin[0]);
  assert.equal(roadOffset.z, origin.origin[2]);
  assert.equal(probes.bounds.min[0], -32 - origin.origin[0]);

  palette.dispose();
  probes.dispose();
  partition.clear();
});

test('P2: createInstancedBatch3D skips static uploads & uses dirty ranges, and createGpuIndirectCuller3D handles WebGPU, WebGL2 multidraw, and CPU fallback', () => {
  // 1. Ordinary 3D instanced batch static skip & sparse dirty range upload
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const batch = createInstancedBatch3D(THREE, { geometry: geom, material: mat, capacity: 16 });
  const a = batch.alloc({ x: 0, y: 0, z: 0 });
  const b = batch.alloc({ x: 5, y: 0, z: 0 });
  const c = batch.alloc({ x: 10, y: 0, z: 0 });
  batch.flush();
  assert.equal(batch.lastUploadStats.skippedStatic, false);
  assert.equal(batch.lastUploadStats.uploadedInstances, 3);

  // Static frame -> zero uploads
  batch.flush();
  assert.equal(batch.lastUploadStats.skippedStatic, true);
  assert.equal(batch.lastUploadStats.uploadedInstances, 0);

  // Sparse single-instance update -> only 1 instance matrix uploaded
  batch.setTransform(b, 6, 0, 0);
  batch.flush();
  assert.equal(batch.lastUploadStats.skippedStatic, false);
  assert.equal(batch.lastUploadStats.uploadedInstances, 1);
  batch.dispose();
  geom.dispose();
  mat.dispose();

  // 2. WebGPU compute culling + indirect draw path
  assert.ok(GPU_CULL_WGSL.includes('drawIndexedIndirect') || GPU_CULL_WGSL.includes('DrawIndexedIndirectArgs'));
  const writes = [];
  const computeDispatches = [];
  const indirectDraws = [];
  const mockDevice = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: desc => ({ desc, destroyed: false, destroy() { this.destroyed = true; } }),
    createBindGroup: () => ({}),
    queue: {
      writeBuffer(buf, offset, data, dataOffset, size) {
        writes.push({ usage: buf.desc.usage, offset, bytes: size ? size * 4 : data.byteLength });
      },
    },
  };
  const gpuCuller = createGpuIndirectCuller3D({ webgpuDevice: mockDevice, maxInstances: 64 });
  assert.equal(gpuCuller.mode, 'webgpu-indirect');
  assert.equal(gpuCuller.fallbackReason, null);
  gpuCuller.setInstanceBounds(0, 0, 0, -5, 1);
  gpuCuller.setInstanceBounds(1, 2, 0, -5, 1);
  const planes = new Float32Array(24);
  planes[2] = 1; planes[3] = 20; // simple z >= -20 plane
  gpuCuller.setFrustumPlanes(planes);
  const commandEncoder = {
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups(n) { computeDispatches.push(n); },
      end() {},
    }),
  };
  const renderPassEncoder = {
    drawIndexedIndirect(_buf, offset) { indirectDraws.push(offset); },
  };
  gpuCuller.execute({ commandEncoder, renderPassEncoder, indexCount: 36 });
  assert.deepEqual(computeDispatches, [1]);
  assert.deepEqual(indirectDraws, [0]);
  assert.equal(gpuCuller.getStats().indirectDraws, 1);
  // Static second execute skips bounds buffer write
  writes.length = 0;
  gpuCuller.execute({ commandEncoder, renderPassEncoder, indexCount: 36 });
  assert.equal(gpuCuller.getStats().skippedStatic, true);
  assert.equal(writes.length, 1); // only indirect header reset
  gpuCuller.dispose();

  // 3. WebGL2 WEBGL_multi_draw path
  const multiCalls = [];
  const gl = {
    getExtension(name) {
      if (name !== 'WEBGL_multi_draw') return null;
      return {
        multiDrawElementsInstancedWEBGL(...args) { multiCalls.push(args); },
      };
    },
  };
  const glCuller = createGpuIndirectCuller3D({ gl });
  assert.equal(glCuller.mode, 'webgl2-multidraw');
  assert.ok(glCuller.fallbackReason);
  glCuller.execute({
    counts: new Int32Array([36, 36]),
    offsets: new Int32Array([0, 0]),
    instanceCounts: new Int32Array([4, 2]),
    drawCount: 2,
  });
  assert.equal(multiCalls.length, 1);
  glCuller.dispose();

  // 4. Explicit CPU instanced fallback
  const cpuFallback = createGpuIndirectCuller3D();
  assert.equal(cpuFallback.mode, 'cpu-instanced');
  assert.match(cpuFallback.fallbackReason, /CPU instanced/i);
  cpuFallback.setInstanceBounds(0, 0, 0, -5, 1);
  cpuFallback.setInstanceBounds(1, 0, 0, -50, 1);
  cpuFallback.setFrustumPlanes(planes);
  const cpuRes = cpuFallback.execute();
  assert.equal(cpuRes.visibleCount, 1);
  assert.deepEqual([...cpuRes.visibleIndices], [0]);
  cpuFallback.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  ATMOSPHERE_PRESETS_CN,
  QUALITY3D_PROFILES,
  SURFACE_TYPES,
  createAtmosphere3D,
  createAudioManager,
  createSurfaceFeedbackRouter,
  createTwoMapWorldPbrMaterial,
  createVfxSystem,
  resolveQuality3DProfile,
} from '../assets/runtime/index.js';
import { createDecalSystem3D } from '../assets/runtime/integrations/decal3d.js';
import {
  createComposableMaterial3D,
  createSharedMaterialBlock3D,
} from '../assets/runtime/integrations/material-graph3d.js';
import {
  createRealisticGlassMaterial3D,
  createRealisticWater3D,
} from '../assets/runtime/integrations/water3d.js';
import { createInstancedFoliage3D } from '../assets/runtime/integrations/foliage3d.js';
import { QUALITY3D_PRESETS } from '../assets/runtime/integrations/quality3d.js';
import { createAtlasParticlePool } from '../assets/runtime/vfx/vfx-atlas-particles.js';

function compileMockShader(material) {
  const shader = {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      '#include <begin_vertex>',
      '#include <project_vertex>',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <metalnessmap_fragment>',
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_maps>',
      '#include <emissivemap_fragment>',
      '#include <lights_physical_fragment>',
      '#include <aomap_fragment>',
    ].join('\n'),
  };
  material.onBeforeCompile?.(shader, {});
  return shader;
}

test('vfx-atlas-particles compresses attributes within WebGL2 budget (<= 12 incl. Custom1/2) and accepts external KTX2/compressed textures', () => {
  const scene = new THREE.Scene();
  const pool = createAtlasParticlePool({ mode: '3d', THREE, scene, maxParticles: 16 });
  try {
    const fakeKtx2 = { isTexture: true, isCompressedTexture: true, flipY: false };
    pool.setAtlas(fakeKtx2, { dust: [0, 0, 0.25, 0.25] });
    pool.emit({ x: 1, y: 2, z: 3, sprite: 'dust', duration: 0.8 });
    pool.update(0.05);

    const mesh = scene.getObjectByName('HGameVfxAtlasNormal');
    assert.ok(mesh);
    const attrNames = Object.keys(mesh.geometry.attributes);
    assert.ok(attrNames.length <= 12, `expected <= 12 attributes (got ${attrNames.length}: ${attrNames.join(',')})`);
    assert.equal(mesh.material.uniforms.uAtlasTex.value, fakeKtx2);
    assert.equal(mesh.material.uniforms.uHasAtlas.value, 1);
    assert.equal(mesh.material.uniforms.uFlipV.value, 0);
  } finally {
    pool.dispose();
  }
});

test('material-graph3d normalRmUnpack, wetness, and interactRim inject deterministic shaders and uniforms', () => {
  const shared = createSharedMaterialBlock3D({ uTime: 0, uWetness: 0.25 });
  const colorMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalRmMap = new THREE.DataTexture(new Uint8Array([128, 128, 160, 0]), 1, 1);
  const mat = createComposableMaterial3D(THREE, {
    sharedBlock: shared,
    normalRmUnpack: { colorMap, normalRmMap, normalStrength: 1.1 },
    wetness: true,
    interactRim: { highlight: 0.5, color: 0xffe082 },
    specularAA: true,
  });
  const compiled = compileMockShader(mat);
  assert.match(mat.customProgramCacheKey(), /normalRmUnpack/);
  assert.match(mat.customProgramCacheKey(), /wetness/);
  assert.match(mat.customProgramCacheKey(), /interactRim/);
  assert.match(compiled.fragmentShader, /uNormalRmMap/);
  assert.match(compiled.fragmentShader, /uWetness/);
  assert.match(compiled.fragmentShader, /uInteractHighlight/);
  assert.equal(compiled.uniforms.uWetness, shared.uniforms.uWetness);

  mat.userData.hgameMaterialGraph.setWetness(0.9);
  assert.equal(shared.get('uWetness'), 0.9);
  mat.userData.hgameMaterialGraph.setHighlight(0.8);
  assert.equal(mat.userData.hgameUniforms.uInteractHighlight.value, 0.8);
  mat.dispose();
  colorMap.dispose();
  normalRmMap.dispose();
});

test('water3d creates scrolling dual-normal Fresnel water and architectural glass materials', () => {
  const water = createRealisticWater3D(THREE, { shallowColor: 0x226677 });
  const shader = compileMockShader(water);
  assert.equal(water.transparent, true);
  assert.equal(water.depthWrite, false);
  assert.match(shader.fragmentShader, /uWaterNormalMap/);
  assert.match(shader.fragmentShader, /uWaterFresnelPower/);
  water.userData.hgameWater.update(0.25);
  assert.equal(water.userData.hgameUniforms.uWaterTime.value, 0.25);

  const glass = createRealisticGlassMaterial3D(THREE, { opacity: 0.22 });
  assert.equal(glass.transparent, true);
  assert.equal(glass.depthWrite, false);
  assert.equal(glass.userData.surfaceType, 'glass');
  water.dispose();
  glass.dispose();
});

test('pbr-material-library createTwoMapWorldPbrMaterial supports 2-map triplanar and TEXTURE_2D_ARRAY splatmaps', () => {
  const colorTex = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
  const normalRmTex = new THREE.DataTexture(new Uint8Array([128, 128, 180, 0]), 1, 1);
  const singleMat = createTwoMapWorldPbrMaterial(THREE, { color: colorTex, normalRm: normalRmTex, wetness: 0.4 });
  const singleShader = compileMockShader(singleMat);
  assert.match(singleShader.fragmentShader, /sampler2D uTwoColor/);
  assert.match(singleShader.fragmentShader, /uTwoWetness/);

  const arrColor = new THREE.DataArrayTexture(new Uint8Array(16), 1, 1, 4);
  const arrNormalRm = new THREE.DataArrayTexture(new Uint8Array(16), 1, 1, 4);
  const splatMap = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
  const arrMat = createTwoMapWorldPbrMaterial(THREE, {
    color: arrColor,
    normalRm: arrNormalRm,
    splatMap,
    layerIndices: [0, 1, 2, 3],
  });
  const arrShader = compileMockShader(arrMat);
  assert.match(arrShader.fragmentShader, /sampler2DArray uTwoColor/);
  assert.match(arrShader.fragmentShader, /uTwoSplatMap/);
  singleMat.dispose();
  arrMat.dispose();
  colorTex.dispose();
  normalRmTex.dispose();
  arrColor.dispose();
  arrNormalRm.dispose();
  splatMap.dispose();
});

test('QUALITY3D_PROFILES, foliage3d Bayer toggle, and decal3d fallback preserve existing presets', () => {
  assert.deepEqual(Object.keys(QUALITY3D_PRESETS), ['low', 'medium', 'high', 'ultra']);
  const mLow = resolveQuality3DProfile('mobile_low');
  const mHigh = resolveQuality3DProfile('mobile_high');
  const pcUltra = resolveQuality3DProfile('pc_ultra');
  assert.equal(mLow.bloom, false);
  assert.equal(mLow.foliageBayerDither, false);
  assert.equal(mLow.decalMode, 'surface');
  assert.equal(mHigh.bloom, true);
  assert.equal(mHigh.ssao, false);
  assert.equal(pcUltra.ssgi, true);
  assert.equal(QUALITY3D_PROFILES.pc_ultra.shadowCascades, 3);

  const foliage = createInstancedFoliage3D(THREE, { count: 8, bayerDither: false, atlasGrid: [4, 4], tileIndex: 5 });
  assert.equal(foliage.uniforms.uBayerEnabled.value, 0);
  foliage.setBayerDither(true);
  assert.equal(foliage.uniforms.uBayerEnabled.value, 1);
  foliage.dispose();

  const decals = createDecalSystem3D(THREE, { mode: 'projected', maxDecals: 4 });
  assert.equal(decals.mode, 'projected');
  decals.applyQualityProfile(mLow);
  assert.equal(decals.mode, 'surface');
  decals.dispose();
});

test('platform/audio setIndoor, playSurfaceCue, and bindLifecycle manage indoor acoustics and suspension cleanly', async () => {
  let suspended = 0;
  let resumed = 0;
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = { connect() {} };
      this.listener = {};
    }
    createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: { value: 22000, setTargetAtTime() {} }, Q: { value: 0.7 }, gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 }, connect() {} }; }
    createConvolver() { return { buffer: null, connect() {}, disconnect() {} }; }
    createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
    suspend() { suspended++; return Promise.resolve(); }
    resume() { resumed++; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  const audio = createAudioManager({ AudioContextClass: FakeAudioContext });
  await audio.unlock();
  assert.equal(audio.isIndoor, false);
  audio.setIndoor(true);
  assert.equal(audio.isIndoor, true);
  assert.equal(audio.activeSnapshot, 'indoor');
  audio.setIndoor(false);
  assert.equal(audio.isIndoor, false);
  assert.equal(audio.activeSnapshot, 'outdoor');

  const listeners = new Map();
  let hideCb = null;
  let showCb = null;
  const fakeDoc = {
    hidden: true,
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
  };
  const fakeHost = {
    onHide(fn) { hideCb = fn; },
    onShow(fn) { showCb = fn; },
  };
  audio.bindLifecycle({ doc: fakeDoc, win: null, miniGameHost: fakeHost });
  listeners.get('visibilitychange')?.();
  hideCb?.();
  fakeDoc.hidden = false;
  listeners.get('visibilitychange')?.();
  showCb?.();
  assert.equal(suspended, 2);
  assert.equal(resumed, 2);

  const missed = await audio.playSurfaceCue('metal', 'impact');
  assert.equal(missed, null);
  await audio.dispose();
});

test('surface-feedback router and atmosphere3d coordinate surfaceType, CN presets, wetness, and indoor toggles', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene });
  const decals = createDecalSystem3D(THREE, { mode: 'surface', maxDecals: 16 });
  const router = createSurfaceFeedbackRouter({ vfx, decals });

  assert.equal(SURFACE_TYPES.length, 10);
  for (const s of SURFACE_TYPES) {
    const res = router.triggerImpact({ pos: [0, 0, 0], normal: [0, 1, 0], surfaceType: s });
    assert.equal(res.surfaceType, s);
    assert.equal(res.vfxMode, 'particles');
  }
  assert.ok(decals.getStats().active > 0);
  router.playFootstep('water', { pos: [1, 0, 1], isRunning: true });

  const shared = createSharedMaterialBlock3D({ uWetness: 0 });
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  let rainVisible = true;
  const appliedPresets = [];
  const atmosphere = createAtmosphere3D({
    sharedBlock: shared,
    directionalLight: sun,
    decals,
    postPipeline: {
      setPreset(p) { appliedPresets.push(p.profile); },
      setState() {},
    },
    rainToggle(flag) { rainVisible = flag; },
  });

  atmosphere.setPreset('cn_horror_night', { quality: 'mobile_low', wetness: 0.8, transitionSec: 1.0 });
  assert.equal(atmosphere.preset.id, ATMOSPHERE_PRESETS_CN.cn_horror_night.id);
  assert.deepEqual(appliedPresets, ['mobile_low']);
  assert.equal(decals.mode, 'surface');
  atmosphere.update(0.5);
  assert.ok(Math.abs(shared.get('uWetness') - 0.4) < 0.01);
  atmosphere.update(0.5);
  assert.ok(Math.abs(shared.get('uWetness') - 0.8) < 0.01);

  atmosphere.setPlayerIndoor(true);
  assert.equal(rainVisible, false);
  atmosphere.setPlayerIndoor(false);
  assert.equal(rainVisible, true);

  vfx.dispose();
  decals.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from '../assets/optional/three/three.module.js';
import { evaluateVfxFidelity } from '../scripts/score-vfx-fidelity.mjs';
import { convertUnityPrefab } from '../scripts/import-unity-vfx.mjs';

import {
  unpack2x12Pos,
  unpack2x12Sym,
  unpackUvPair,
} from '../assets/runtime/vfx/vfx-atlas-particles.js';
import {
  UBER_FLAG_ALPHA_TEST,
  UBER_FLAG_CULL_FRONT,
  VFX_UBER_FRAGMENT_GLSL,
  packUberMaterialRow,
} from '../assets/runtime/vfx/vfx-shader-chunks.js';
import { createEffectPlayer } from '../assets/runtime/vfx/vfx-recipes.js';
import {
  ATLAS_PARTICLE_FRAGMENT_GLSL,
  CROWD_STATUS,
  DAMAGE_NUMBER_PRESETS,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  RIBBON_FRAGMENT_GLSL,
  UBER_MAT_LUT_ROWS,
  UBER_MAT_LUT_WIDTH,
  VFX_COMMON_GLSL,
  VFX_MATERIAL_PRESETS,
  VFX_MESH_INSTANCED_FS,
  VFX_MESH_INSTANCED_VS,
  VFX_RENDER_MODE,
  VFX_SHAPE,
  bakeGlyphAtlasCanvas,
  createAtlasParticlePool,
  createCameraShake,
  createCurveLutTable,
  createGpuParticleSystem,
  createHitstopClock,
  createMeshVfxPool,
  createOffscreen2dCanvas,
  createProceduralVfxAtlas,
  createShurikenKernel,
  createStatelessParticlePool,
  createUberMaterialSpec,
  createVfxSystem,
  createVisualPrng,
  isMobileOrMiniGameEnv,
  defineVfxRecipe,
  evaluateAtlasParticlePosition,
  evaluateColorByNumber,
  evaluateColorCurve,
  evaluateScaleByNumber,
  evaluateSizeCurve,
  extractGlyphIndices,
  formatDamageValue,
  getDamagePreset,
  loadVfxPack,
  packCrowdAnimStatus,
  packRgb24,
  registerDamagePreset,
  unpackCrowdAnimStatus,
  unpackRgb24Into,
  validateVfxRecipe,
  UBER_SHADER_KIND,
  createUberMaterialLut,
  compileCustomDataCurves,
} from '../assets/runtime/vfx/index.js';

test('stateless particle pool wraps 100,000 emits across 65,536 ring boundary with split dirty ranges', () => {
  const pool = createStatelessParticlePool({ mode: 'headless', maxParticles: 65536 });

  // Advance cursor to 65,520
  for (let i = 0; i < 65520; i++) {
    pool.emit({ x: i, y: 1, z: 0, additive: true });
  }
  pool.flushDirty();
  assert.equal(pool.getStats().additiveCursor, 65520);

  // Emit 50 more -> wraps [65520..65535] (16) and [0..33] (34)
  for (let i = 0; i < 50; i++) {
    pool.emit({ x: i, y: 2, z: 0, additive: true });
  }
  pool.flushDirty();
  const st1 = pool.getStats();
  assert.equal(st1.additiveCursor, 34);
  assert.equal(st1.additiveWrapCount, 1);
  assert.deepEqual(st1.additiveLastRanges, [
    { offset: 65520, count: 16 },
    { offset: 0, count: 34 },
  ]);

  // Continue up to 100,000 total emits
  for (let i = 65570; i < 100000; i++) {
    pool.emit({ x: i, y: 3, z: 0, additive: true });
  }
  pool.flushDirty();
  const st2 = pool.getStats();
  assert.equal(st2.additiveTotal, 100000);
  assert.equal(st2.additiveCursor, 100000 % 65536);
  assert.equal(st2.additiveWrapCount, 1);
});

test('extractGlyphIndices decomposes 0, positive, negative, crit, heal, miss without strings', () => {
  const buf = new Int32Array(12);

  let n = extractGlyphIndices(0, false, false, false, buf);
  assert.equal(n, 1);
  assert.deepEqual(Array.from(buf.subarray(0, n)), [0]);

  n = extractGlyphIndices(1280, true, false, false, buf);
  assert.equal(n, 6);
  assert.deepEqual(Array.from(buf.subarray(0, n)), [13, 1, 2, 8, 0, 12]); // '暴','1','2','8','0','!'

  n = extractGlyphIndices(450, false, true, false, buf);
  assert.equal(n, 4);
  assert.deepEqual(Array.from(buf.subarray(0, n)), [11, 4, 5, 0]); // '+','4','5','0'

  n = extractGlyphIndices(-95, false, false, false, buf);
  assert.equal(n, 3);
  assert.deepEqual(Array.from(buf.subarray(0, n)), [10, 9, 5]); // '-','9','5'

  n = extractGlyphIndices(0, false, false, true, buf);
  assert.equal(n, 1);
  assert.deepEqual(Array.from(buf.subarray(0, n)), [14]); // '闪'
});

test('packRgb24 and packCrowdAnimStatus round-trip within < 0.02 precision error', () => {
  const outRgb = new Float32Array(3);
  const packed = packRgb24(0x38bdf8);
  assert.equal(packed, 0x38bdf8);
  unpackRgb24Into(packed, outRgb);
  assert.ok(Math.abs(outRgb[0] - 0x38 / 255) < 1e-5);
  assert.ok(Math.abs(outRgb[1] - 0xbd / 255) < 1e-5);
  assert.ok(Math.abs(outRgb[2] - 0xf8 / 255) < 1e-5);

  const outStatus = { frameRow: 0, statusCode: 0 };
  for (let sc = 0; sc <= 15; sc++) {
    const f = 123.45;
    const w = Math.fround(packCrowdAnimStatus(f, sc));
    unpackCrowdAnimStatus(w, outStatus);
    assert.equal(outStatus.statusCode, sc);
    assert.ok(Math.abs(outStatus.frameRow - f) < 0.02, `error too high at sc=${sc}: ${outStatus.frameRow}`);
  }

  // Backward compatibility with legacy negative hitFlash encoding
  unpackCrowdAnimStatus(-25.5, outStatus);
  assert.equal(outStatus.statusCode, CROWD_STATUS.FLASH_92);
  assert.ok(Math.abs(outStatus.frameRow - 24.5) < 1e-5);
});

test('visual PRNG and HitstopClock stay isolated from gameplay determinism', () => {
  const prngA = createVisualPrng(12345);
  const prngB = createVisualPrng(12345);
  assert.equal(prngA.nextFloat(), prngB.nextFloat());
  assert.equal(prngA.range(-5, 5), prngB.range(-5, 5));

  const hitstop = createHitstopClock();
  assert.equal(hitstop.step(0.016), 0.016);
  hitstop.trigger(0.04, 0.05);
  assert.equal(hitstop.isFrozen(), true);
  assert.ok(Math.abs(hitstop.step(0.016) - 0.016 * 0.05) < 1e-9);
  hitstop.step(0.03);
  assert.equal(hitstop.isFrozen(), false);
  assert.equal(hitstop.step(0.016), 0.016);

  const shake = createCameraShake();
  shake.impulse(0.6, 1, 0, 0);
  const off = shake.update(0.016);
  assert.ok(Number.isFinite(off.x) && Number.isFinite(off.roll));
});

test('createVfxSystem runs cleanly in headless and canvas2d fallback modes', () => {
  const vfx = createVfxSystem({ mode: 'headless', maxParticles: 1024 });
  vfx.emitHitImpact({ x: 10, y: 20, z: 0, damage: 999, isCrit: true, element: 'lightning' });
  vfx.burstParticles('fire');
  vfx.lightningBolt({ x0: 0, y0: 0, x1: 5, y1: 5 });
  const tid = vfx.allocTrail(0x38bdf8, 0.3);
  assert.ok(tid >= 0);
  vfx.pushTrailPoint(tid, 1, 2, 0);
  vfx.pushTrailPoint(tid, 3, 4, 0);
  vfx.freeTrail(tid);
  vfx.spawnTelegraph({ shape: 'sector', x: 0, z: 0, radius: 5, angleRad: 1.2, duration: 1.0 });
  vfx.setShrinkZone({ centerX: 0, centerZ: 0, safeRadius: 35, active: true });
  vfx.screenPulse({ ndcX: 0, ndcY: 0, strength: 0.7 });

  const stepRes = vfx.update(0.016);
  assert.ok(stepRes.visualDt >= 0);
  assert.ok(vfx.getStats().particles.additiveTotal > 0);
  vfx.dispose();

  // Canvas2D mock context smoke
  const ops = [];
  const mockCtx = {
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    strokeRect() {},
    strokeText() {},
    fillText() {},
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#fff',
    strokeStyle: '#fff',
    lineWidth: 1,
    font: '12px sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
  };
  const vfx2d = createVfxSystem({ mode: 'canvas2d', sceneOrAdapter: mockCtx });
  vfx2d.emitHitImpact({ x: 100, y: 120, damage: 250, isCrit: true });
  vfx2d.update(0.016);
  vfx2d.render(mockCtx, { x: 0, y: 0, zoom: 1 }, 960, 540);
  assert.ok(ops.includes('save') && ops.includes('restore'));
  vfx2d.dispose();
});

test('reset immediately clears uploaded 3D telegraphs, including the shrink zone', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxTelegraphs: 4, maxParticles: 8 });
  try {
    vfx.update(0.5);
    const slot = vfx.spawnTelegraph({ duration: 1 });
    vfx.setShrinkZone({ active: true });
    vfx.update(0.25);
    const mesh = scene.getObjectByName('HGameVfxTelegraphs');
    const instances = mesh.geometry.getAttribute('aTeleP1');
    assert.equal(instances.array[slot * 4 + 3], 1);
    assert.equal(instances.array[instances.array.length - 1], 99999);

    // Three consumes the queued ranges after sending them to the GPU.
    instances.clearUpdateRanges();
    const uploadedVersion = instances.version;
    vfx.reset();
    assert.equal(instances.version, uploadedVersion + 1);
    assert.deepEqual(instances.updateRanges, [{ start: 0, count: instances.array.length }]);
    assert.ok(instances.array.every(value => value === 0));
    assert.equal(mesh.material.uniforms.uTime.value, 0);

    const next = vfx.spawnTelegraph({ duration: 2 });
    vfx.update(0.1);
    assert.equal(instances.array[next * 4 + 3], 2);
    assert.equal(instances.array[instances.array.length - 1], 0);
  } finally {
    vfx.dispose();
  }
});


test('damage number formatting supports decimals, grouping separators, and K/M/B/T suffix shortening', () => {
  assert.equal(formatDamageValue(1234.56, { decimals: 2 }), '1234.56');
  assert.equal(formatDamageValue(12.50, { decimals: 2, hideZeros: true }), '12.5');
  assert.equal(formatDamageValue(12.00, { decimals: 2, hideZeros: true }), '12');
  assert.equal(formatDamageValue(1234567, { dotSeparation: true, dotDistance: 3, dotChar: ',' }), '1,234,567');
  assert.equal(formatDamageValue(12500, { suffixShorten: true }), '12.5K');
  assert.equal(formatDamageValue(10000, { suffixShorten: { maxDigits: 3, hideZeros: true } }), '10K');
  assert.equal(formatDamageValue(2450000, { suffixShorten: true }), '2.5M');
  assert.equal(formatDamageValue(999, { suffixShorten: true }), '999');

  const c0 = evaluateColorByNumber(10, { fromNumber: 10, toNumber: 100, fromColor: 0x00ff00, toColor: 0xff0000 });
  const c1 = evaluateColorByNumber(100, { fromNumber: 10, toNumber: 100, fromColor: 0x00ff00, toColor: 0xff0000 });
  assert.equal(c0, 0x00ff00);
  assert.equal(c1, 0xff0000);
  assert.equal(evaluateScaleByNumber(500, { fromNumber: 0, toNumber: 1000, fromScale: 1, toScale: 2 }), 1.5);
});

test('damage number presets, combination, collision separation, destruction, follow, and unscaledTime work cleanly', () => {
  registerDamagePreset('testBossHit', {
    color: 0xff5500,
    topText: '连击',
    lifetime: 0.9,
  });
  assert.equal(getDamagePreset('testBossHit').color, 0xff5500);
  assert.ok(DAMAGE_NUMBER_PRESETS.crit && DAMAGE_NUMBER_PRESETS.combo);

  const vfx = createVfxSystem({ mode: 'headless', maxFloatingGlyphs: 1024, maxPopups: 64 });
  try {
    // 1. Combination: absorbNew (instantGain + animated)
    vfx.popupNumber({
      x: 0, y: 0, value: 120, spamGroup: 'boss1',
      combination: { method: 'absorbNew', maxDistance: 5, spawnDelay: 0.02, instantGain: true, bonusLifetime: 0.5, absorberScaleFactor: 1.5 },
    });
    vfx.update(0.05);
    vfx.popupNumber({
      x: 0.5, y: 0.2, value: 80, spamGroup: 'boss1',
      combination: { method: 'absorbNew', maxDistance: 5, spawnDelay: 0.02, instantGain: true, bonusLifetime: 0.5, absorberScaleFactor: 1.5 },
    });
    let active = vfx.floatingText.getActivePopups();
    assert.equal(active.length, 1);
    assert.equal(active[0].value, 200);
    assert.equal(vfx.floatingText.getStats().totalCombined, 1);

    // Animated absorption
    vfx.popupNumber({
      x: 1.0, y: 0.0, value: 50, spamGroup: 'boss1',
      combination: { method: 'absorbNew', maxDistance: 5, spawnDelay: 0.02, instantGain: false, absorbDuration: 0.2, bonusLifetime: 0.5 },
    });
    assert.equal(vfx.floatingText.getActivePopups().length, 2);
    vfx.update(0.12);
    assert.equal(vfx.floatingText.getActivePopups().some(p => p.absorbing), true);
    vfx.update(0.12);
    active = vfx.floatingText.getActivePopups();
    assert.equal(active.length, 1);
    assert.equal(active[0].value, 250);

    // 2. Follow target + unscaledTime during hitstop
    vfx.reset();
    const enemy = { x: 10, y: 2, z: 0 };
    vfx.popupNumber({
      x: 10, y: 3, z: 0, value: 300,
      lerp: { enabled: false },
      follow: { target: enemy, speed: 20 },
      unscaledTime: true,
    });
    vfx.hitstop.trigger(0.1, 0.0); // freeze visualDt completely
    enemy.x = 15;
    vfx.update(0.05);
    const followed = vfx.floatingText.getActivePopups()[0];
    assert.ok(followed.x > 12, 'follow + unscaledTime should advance even during hitstop');

    // 3. Collision separation
    vfx.reset();
    vfx.popupNumber({ x: 0, y: 0, value: 10, spamGroup: 'col', lerp: { enabled: false }, collision: { radius: 1, pushFactor: 2 } });
    vfx.popupNumber({ x: 0.1, y: 0, value: 20, spamGroup: 'col', lerp: { enabled: false }, collision: { radius: 1, pushFactor: 2 } });
    vfx.update(0.05);
    const colPopups = vfx.floatingText.getActivePopups();
    assert.ok(Math.abs(colPopups[1].x - colPopups[0].x) > 0.2);

    // 4. Destruction on overlap
    vfx.reset();
    vfx.popupNumber({ x: 0, y: 0, value: 10, spamGroup: 'dest', lerp: { enabled: false }, destruction: { maxDistance: 3, spawnDelay: 0.01, duration: 0.1 } });
    vfx.update(0.05);
    vfx.popupNumber({ x: 0.2, y: 0, value: 20, spamGroup: 'dest', lerp: { enabled: false }, destruction: { maxDistance: 3, spawnDelay: 0.01, duration: 0.1 } });
    assert.equal(vfx.floatingText.getActivePopups().filter(p => p.destroying).length, 1);
    vfx.update(0.12);
    assert.equal(vfx.floatingText.getActivePopups().length, 1);
  } finally {
    vfx.dispose();
  }
});


test('floating text evicts oldest live popup after out-of-order expiry and reset', () => {
  const vfx = createVfxSystem({ mode: 'headless', maxPopups: 8 });
  const values = () => vfx.floatingText.getActivePopups().map(popup => popup.value).sort((a, b) => a - b);
  try {
    for (let value = 1; value <= 8; value++) {
      vfx.popupNumber({ value, duration: value === 4 ? 0.05 : 2 });
    }
    vfx.update(0.09);
    assert.deepEqual(values(), [1, 2, 3, 5, 6, 7, 8]);
    for (let value = 9; value <= 13; value++) vfx.popupNumber({ value, duration: 2 });
    assert.deepEqual(values(), [6, 7, 8, 9, 10, 11, 12, 13]);
    vfx.reset();
    for (let value = 1; value <= 9; value++) vfx.popupNumber({ value, duration: 2 });
    assert.deepEqual(values(), [2, 3, 4, 5, 6, 7, 8, 9]);
  } finally {
    vfx.dispose();
  }
});

test('floating text recovers reserved slots when popup initialization throws', () => {
  const vfx = createVfxSystem({ mode: 'headless', maxPopups: 8 });
  try {
    for (let i = 0; i < 9; i++) {
      assert.throws(() => vfx.popupNumber({ follow() { throw new Error('unavailable target'); } }), /unavailable target/);
    }
    for (let value = 1; value <= 8; value++) vfx.popupNumber({ value });
    assert.equal(vfx.floatingText.getActivePopups().length, 8);
  } finally {
    vfx.dispose();
  }
});

test('3D floating text packs active glyphs, scales by camera distance, and resets cleanly', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 8, maxFloatingGlyphs: 64 });
  try {
    vfx.popupNumber({
      x: 0, y: 2, z: -20,
      value: 12500,
      preset: 'crit',
      digits: { suffixShorten: true },
      consistentScreenSize: true,
      distanceScaling: { baseDistance: 10, closeDistance: 2, farDistance: 30, closeScale: 2, farScale: 0.5 },
    });
    vfx.update(0.05, { x: 0, y: 2, z: 0 });
    const mesh = scene.getObjectByName('HGameVfxFloatingText');
    assert.ok(mesh);
    assert.ok(mesh.geometry.instanceCount >= 6);
    const p1 = mesh.geometry.getAttribute('aTextP1');
    assert.ok(p1.array[1] > 0);
    vfx.reset();
    assert.equal(mesh.geometry.instanceCount, 0);
  } finally {
    vfx.dispose();
  }
});


test('validateVfxRecipe validates schemaVersion, layers, renderModes, and rejects malformed recipes', () => {
  const valid = validateVfxRecipe({
    schemaVersion: 1,
    id: 'fire_burst',
    duration: 2.0,
    layers: [
      { kind: 'particle', renderMode: 'horizontal', blend: 'alpha', colorCurve: [[0, [1, 0.5, 0, 1]], [1, [0, 0, 0, 0]]] },
      { kind: 'mesh', renderMode: 'mesh', mesh: 'crystal' },
    ],
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.errors, []);

  const invalid = validateVfxRecipe({
    schemaVersion: 2,
    id: '',
    duration: -1,
    layers: [{ kind: 'unknown', renderMode: 'bad', blend: 'weird', colorCurve: [] }],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length >= 5);
});

test('curve LUT table compiles, caches, and decodes 4-stop colorCurve and sizeCurve within tight tolerance', () => {
  const lut = createCurveLutTable(THREE);
  const colorCurve = [
    [0.0, [1.0, 0.2, 0.0, 0.0]],
    [0.1, [0.9, 0.4, 0.1, 1.0]],
    [0.8, [0.1, 0.05, 0.05, 1.0]],
    [1.0, [0.0, 0.0, 0.0, 0.0]],
  ];
  const sizeCurve = [
    [0.0, 0.0],
    [0.1, 2.5],
    [1.0, 0.5],
  ];
  const rowA = lut.compile(colorCurve, sizeCurve);
  const rowB = lut.compile(colorCurve, sizeCurve);
  assert.equal(rowA, rowB);
  assert.equal(rowA, 1);

  const rgba = new Float32Array(4);
  lut.sampleColor(rowA, 0.1, rgba);
  const refRgba = evaluateColorCurve(colorCurve, 0.1);
  assert.ok(Math.abs(rgba[0] - refRgba[0]) < 0.03);
  assert.ok(Math.abs(rgba[3] - refRgba[3]) < 0.03);

  const szPeak = lut.sampleSize(rowA, 0.1);
  assert.ok(Math.abs(szPeak - evaluateSizeCurve(sizeCurve, 0.1)) < 0.1);
  assert.ok(lut.texture && lut.texture.isDataTexture);
  lut.dispose();
});

test('atlas particle pool supports flipbook, horizontal, HDR, noise, and Canvas2D fallback', () => {
  const scene = new THREE.Scene();
  const pool = createAtlasParticlePool({ mode: '3d', THREE, scene, maxParticles: 32 });
  try {
    pool.emit({
      x: 1, y: 2, z: 3,
      vx: 0, vy: 1, vz: 0,
      duration: 1.5,
      sizeStart: 2.5,
      hdr: 3.0,
      renderMode: 'horizontal',
      blend: 'alpha',
      flipbook: { region: 'fireball_flipbook', cols: 8, rows: 1, cycles: 1, blend: true },
      noiseStrength: 0.8,
      noiseFreq: 0.5,
    });
    pool.update(0.1);

    const normalMesh = scene.getObjectByName('HGameVfxAtlasNormal');
    assert.ok(normalMesh);
    assert.ok(Object.keys(normalMesh.geometry.attributes).length <= 12, 'compressed atlas geometry stays well below 16 vertex attributes');
    assert.equal(normalMesh.geometry.getAttribute('aAtlasP8'), undefined, 'legacy aAtlasP8..P11 attributes removed');
    const p2 = normalMesh.geometry.getAttribute('aAtlasP2');
    const p3 = normalMesh.geometry.getAttribute('aAtlasP3');
    const p4 = normalMesh.geometry.getAttribute('aAtlasP4');
    assert.equal(p2.array[0], 2.5);
    assert.ok(Math.abs(unpack2x12Pos(p3.array[1], 35, 35)[0] - 3.0) < 0.01);
    assert.equal(Math.floor(p2.array[3] / 4096) % 8, VFX_RENDER_MODE.HORIZONTAL);
    const uv0 = unpackUvPair(p4.array[0]);
    const uv1 = unpackUvPair(p4.array[1]);
    assert.deepEqual([...uv0, ...uv1], Array.from(PROCEDURAL_VFX_ATLAS_REGIONS.fireball_flipbook));
    let fbWord = Math.floor(p4.array[2] + 0.5);
    const fbCycles = Math.floor(fbWord / 8192) / 32; fbWord %= 8192;
    const fbBlend = fbWord >= 4096 ? 1 : 0; fbWord %= 4096;
    const fbRows = Math.floor(fbWord / 64) + 1;
    const fbCols = (fbWord % 64) + 1;
    assert.deepEqual([fbCols, fbRows, fbCycles, fbBlend], [8, 1, 1, 1]);
  } finally {
    pool.dispose();
  }

  // Canvas2D fallback smoke
  const ops = [];
  const mockCtx = {
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    translate() {},
    rotate() {},
    beginPath() {},
    arc() {},
    fill() {},
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#fff',
  };
  const pool2d = createAtlasParticlePool({ mode: 'canvas2d', maxParticles: 16 });
  pool2d.emit({
    x: 50, y: 60, duration: 1.0, sizeStart: 20, hdr: 2.0,
    colorCurve: [[0, [1, 0.5, 0, 1]], [1, [1, 0.5, 0, 0]]],
  });
  pool2d.update(0.2);
  pool2d.renderCanvas2D(mockCtx, { x: 0, y: 0, zoom: 1 }, 960, 540);
  assert.ok(ops.includes('save') && ops.includes('restore'));
  pool2d.dispose();
});

test('mesh VFX pool spawns custom & built-in meshes with Fresnel/dissolve and recycles on expiry', () => {
  const scene = new THREE.Scene();
  const meshPool = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 4 });
  try {
    const customGeo = new THREE.OctahedronGeometry(0.4, 0);
    assert.equal(meshPool.registerMesh('ice_spike', customGeo), true);
    const slot = meshPool.spawn({
      mesh: 'ice_spike',
      x: 2, y: 1, z: -3,
      duration: 0.5,
      sizeStart: 1.5,
      spinY: 3.14,
      hdr: 1.6,
      fresnel: { power: 2.5, intensity: 1.4 },
      dissolve: { start: 0.4, edgeWidth: 0.1, edgeColor: [0.4, 0.9, 1.0] },
    });
    assert.equal(slot, 0);
    assert.equal(meshPool.getStats().activeCount, 1);

    const obj = scene.getObjectByName('HGameVfxMesh_0');
    assert.ok(obj && obj.visible === true);
    assert.equal(obj.geometry, customGeo);

    meshPool.update(0.25);
    assert.ok(obj.rotation.y > 0.5);
    assert.ok(obj.material.uniforms.uFresnel.value.y > 1.0);

    meshPool.update(0.35);
    assert.equal(meshPool.getStats().activeCount, 0);
    assert.equal(obj.visible, false);
    customGeo.dispose();
  } finally {
    meshPool.dispose();
  }
});

test('Three particle depth state shares atlas batches and resets pooled mesh state', () => {
  const scene = new THREE.Scene();
  const atlas = createAtlasParticlePool({ mode: '3d', THREE, scene, maxParticles: 8 });
  const mesh = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 1 });
  const state = { opaque: true, depthTest: 'greater', depthWrite: false };
  const recipe = { schemaVersion: 1, id: 'depth', layers: [{ kind: 'particle', ...state }] };
  assert.equal(validateVfxRecipe(recipe).ok, true);
  assert.equal(validateVfxRecipe({ ...recipe, layers: [{ depthTest: 5, depthWrite: 1 }] }).ok, false);
  const initialCount = scene.children.length;
  atlas.update(0.25);
  atlas.setWind(1, 2, 3);
  const slot = atlas.emit({ ...state, blend: 'multiply', duration: 1 });
  atlas.emit({ ...state, duration: 1 });
  atlas.emit({ depthTest: 'less-equal', depthWrite: false, duration: 1 });
  atlas.flushDirty();
  assert.equal(scene.children.length, initialCount + 1, 'equivalent state shares a batch and explicit defaults reuse the base batch');
  const batch = scene.children.at(-1);
  assert.equal(batch.geometry.instanceCount, 2);
  assert.equal(batch.material.blending, THREE.NoBlending);
  assert.equal(batch.material.transparent, false);
  assert.equal(batch.material.depthFunc, THREE.GreaterDepth);
  assert.equal(batch.material.depthWrite, false);
  assert.equal(batch.material.uniforms.uTime.value, 0.25);
  assert.deepEqual(batch.material.uniforms.uWind.value.toArray(), [1, 2, 3]);
  atlas.updateSlot(state, slot, 3, 0, 0, 0, 0, 0);
  assert.equal(batch.geometry.getAttribute('aAtlasP0').getX(slot), 3);
  atlas.killSlot(state, slot);
  assert.equal(batch.geometry.getAttribute('aAtlasP1').getW(slot), 0);
  atlas.reset();
  assert.equal(batch.geometry.instanceCount, 0);
  atlas.emit({ ...state, duration: 0.05 });
  atlas.update(0.1);
  assert.equal(batch.geometry.instanceCount, 0, 'an expired batch stops submitting');
  const persistent = atlas.emit({ ...state, persistent: true });
  assert.equal(persistent, 1, 'idle retirement preserves ring order for existing slot owners');
  atlas.update(1);
  assert.equal(batch.geometry.instanceCount, 2, 'a new burst reuses the idle batch');
  atlas.killSlot(state, persistent);
  atlas.flushDirty();
  assert.equal(batch.geometry.instanceCount, 0, 'killing the final persistent slot retires the batch');

  mesh.spawn({ ...state, mesh: 'quad', duration: 1 });
  const meshInstance = scene.children.find(child => child.material?.uniforms.uOpaque && child !== batch);
  assert.equal(meshInstance.material.depthFunc, THREE.GreaterDepth);
  assert.equal(meshInstance.material.depthWrite, false);
  mesh.reset();
  mesh.spawn({ mesh: 'quad', duration: 1, depthTest: 'disabled', depthWrite: true });
  assert.equal(meshInstance.material.depthTest, false);
  assert.equal(meshInstance.material.depthWrite, false, 'disabled depth testing disables depth writes on WebGL');
  mesh.reset();
  mesh.spawn({ mesh: 'quad', duration: 1 });
  assert.equal(meshInstance.material.depthTest, true);
  assert.equal(meshInstance.material.depthFunc, THREE.LessEqualDepth);
  assert.equal(meshInstance.material.transparent, true);
  atlas.dispose();
  assert.ok(!scene.children.includes(batch));
  mesh.dispose();
});

test('Three mesh recipes use texture-sheet rows and clear recycled sheet state', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxAtlasParticles: 4, maxMeshVfx: 1 });
  const atlas = new THREE.Texture();
  vfx.setAtlas(atlas, { sheet: [0.5, 0, 1, 1] });
  vfx.playEffect({
    schemaVersion: 1, id: 'sheet_mesh', duration: 1,
    layers: [{
      kind: 'mesh', mesh: 'quad', life: 1, rate: 1, prewarm: true,
      flipbook: { region: 'sheet', cols: 2, rows: 2, rowMode: 'custom', rowIndex: 1, cycles: 2, blend: true },
    }],
  });
  const uniforms = scene.children.find(child => child.material?.uniforms.uOpaque).material.uniforms;
  assert.equal(uniforms.uTex.value, atlas);
  assert.deepEqual(uniforms.uTexRect.value.toArray(), [0.5, 0.5, 1, 1]);
  assert.deepEqual(uniforms.uFlipbook.value.toArray(), [2, 1, 2, 1]);
  assert.ok(uniforms.uLifeRatio.value > 0, 'prewarmed mesh starts at the matching texture-sheet age');
  vfx.meshVfx.spawn({ mesh: 'quad', x: 1, vx: 10, spinZ: 3, duration: 1, initialAge: 0.4 });
  const mesh = scene.children.find(child => child.material?.uniforms.uOpaque);
  assert.ok(Math.abs(mesh.position.x - 5) < 1e-6, 'initial age advances the mesh position');
  assert.ok(Math.abs(mesh.rotation.z - 1.2) < 1e-6, 'initial age advances mesh rotation');
  vfx.reset();
  vfx.meshVfx.spawn({ mesh: 'quad', texture: atlas, duration: 1 });
  assert.deepEqual(uniforms.uFlipbook.value.toArray(), [1, 1, 1, 0]);
  assert.equal(uniforms.uLifeRatio.value, 0);
  assert.equal(uniforms.uAtlasUv.value, 0, 'ordinary mesh textures keep their UV convention');
  vfx.dispose();
  atlas.dispose();
});

test('createVfxSystem.playEffect orchestrates composite one-shot explosion and looping shield recipes', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 256, maxMeshVfx: 8 });
  try {
    const explosionRecipe = {
      schemaVersion: 1,
      id: 'test_explosion_fire',
      loop: false,
      duration: 1.2,
      juice: {
        hitstop: 0.04,
        shakeTrauma: 0.35,
        screenPulse: { color: '#ff6a1a', strength: 0.4, duration: 0.2 },
        lightPulse: { color: '#ff9e44', intensity: 2.5, range: 10, duration: 0.3 },
      },
      layers: [
        {
          name: 'fireball_flipbook',
          kind: 'particle',
          renderMode: 'billboard',
          blend: 'alpha',
          hdr: 3.0,
          bursts: [{ time: 0.0, count: 12 }],
          life: [0.8, 1.0],
          size: [0.8, 1.2],
          flipbook: { region: 'fireball_flipbook', cols: 8, rows: 1, cycles: 1, blend: true },
          sizeCurve: [[0, 0], [0.1, 1], [1, 1]],
          colorCurve: [[0, [1, 0.2, 0, 1]], [0.8, [0.1, 0.02, 0.02, 1]], [1, [0, 0, 0, 0]]],
        },
        {
          name: 'wave_ground',
          kind: 'particle',
          renderMode: 'horizontal',
          hdr: 2.4,
          bursts: [{ time: 0.0, count: 2 }],
          life: 0.6,
          size: 3.0,
          sprite: 'wave',
        },
        {
          name: 'sparks_trail',
          kind: 'particle',
          bursts: [{ time: 0.0, count: 6 }],
          life: 0.5,
          speed: [2, 4],
          noise: { strength: 0.8, frequency: 0.5 },
          trail: { lifetime: 0.2, width: 0.05, color: '#ffaa33' },
        },
      ],
    };

    const handle = vfx.playEffect(explosionRecipe, { x: 4, y: 0, z: -2, scale: 1.2 });
    assert.ok(handle && handle.isActive());
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 20);
    assert.equal(vfx.trails.getStats().activeTrails, 6);
    const ptLight = scene.getObjectByName('HGameVfxPointLight_0');
    assert.ok(ptLight && ptLight.visible === true && ptLight.intensity > 2.0);

    // Advance past hitstop & full explosion duration
    for (let i = 0; i < 30; i++) vfx.update(0.05);
    assert.equal(handle.isActive(), false);
    assert.equal(ptLight.visible, false);
    assert.equal(vfx.trails.getStats().activeTrails, 0);

    // Looping shield with follow target and 3D mesh layer
    const hero = { x: 0, y: 1, z: 0, yaw: 0 };
    const shieldHandle = vfx.playEffect({
      schemaVersion: 1,
      id: 'test_shield_ice',
      loop: true,
      duration: 1.0,
      layers: [
        { name: 'dome', kind: 'mesh', mesh: 'sphere', bursts: [{ time: 0, count: 1 }], life: 1.0, size: 2.2, fresnel: { power: 2.5, intensity: 1.2 } },
        { name: 'snow', kind: 'particle', rate: 20, life: 0.6, size: 0.2, sprite: 'snowflake', shape: { type: 'circle', radius: 1.5 } },
      ],
    }, { follow: hero });

    hero.x = 5;
    vfx.update(0.2);
    assert.equal(shieldHandle.isActive(), true);
    assert.ok(vfx.meshVfx.getStats().activeCount >= 1);
    assert.ok(vfx.atlasParticles.getStats().normalTotal > 20);

    shieldHandle.stop();
    assert.equal(shieldHandle.isActive(), false);
  } finally {
    vfx.dispose();
  }
});


test('vfx extensions support vertical billboard, orbital motion, startColor, textured tapered trails, lit/aligned mesh, collision bounce, and subEmitters', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 32, maxAtlasParticles: 128, maxMeshVfx: 8 });
  try {
    // 1. Textured & tapered ribbon trail + orbital position evaluator
    const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    vfx.setTrailTexture(dummyTex, [0, 0.75, 0.25, 1.0]);
    vfx.setDepthTexture(dummyTex, { near: 0.1, far: 100, width: 800, height: 600, softFade: 0.5 });

    const tid = vfx.allocTrail({ color: 0xff8800, endColor: 0x220000, width: 0.4, endWidth: 0.05, hdr: 2.5 });
    assert.ok(tid >= 0);
    vfx.pushTrailPoint(tid, 0, 0, 0);
    vfx.pushTrailPoint(tid, 1, 0, 0);
    vfx.pushTrailPoint(tid, 2, 0, 0);
    const ribbonMesh = scene.getObjectByName('HGameVfxRibbonTrails');
    const segExtra = ribbonMesh.geometry.getAttribute('aSegExtra');
    assert.equal(segExtra.array[tid * 2 * 7 * 4 + 3], 2.5);
    vfx.freeTrail(tid);

    const orbPos = new Float32Array(3);
    evaluateAtlasParticlePosition(2, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, Math.PI * 0.5, false, orbPos, 1.0, 2, 0);
    assert.ok(Math.abs(orbPos[0]) < 1e-4 && Math.abs(orbPos[2] - 2) < 1e-4);

    // 2. Vertical billboard + startColor + orbital + soft depth uniforms
    vfx.atlasParticles.emit({
      x: 1, y: 0, z: 0,
      duration: 1.0,
      renderMode: 'vertical',
      tintRgb24: packRgb24(0x33ccff),
      orbitalY: 1.5,
      centerOffX: 1,
      centerOffZ: 0,
    });
    vfx.update(0.05);
    const atlasNormal = scene.getObjectByName('HGameVfxAtlasNormal');
    const p2 = atlasNormal.geometry.getAttribute('aAtlasP2');
    const p4 = atlasNormal.geometry.getAttribute('aAtlasP4');
    const p5 = atlasNormal.geometry.getAttribute('aAtlasP5');
    assert.equal(Math.floor(p2.array[3] / 4096) % 8, VFX_RENDER_MODE.VERTICAL);
    assert.equal(p4.array[3], packRgb24(0x33ccff));
    assert.equal(p5.array[2], 1.5);
    assert.equal(atlasNormal.material.uniforms.uHasSoftDepth.value, 1.0);

    // 3. Velocity-aligned lit mesh particle
    const mSlot = vfx.meshVfx.spawn({
      mesh: 'crystal',
      x: 0, y: 1, z: 0,
      vx: 3, vy: 4, vz: 0,
      duration: 0.6,
      alignToVelocity: true,
      forwardAxis: 'z',
      lit: true,
      emission: [0.2, 0.5, 0.8],
    });
    assert.equal(mSlot, 0);
    const mObj = scene.getObjectByName('HGameVfxMesh_0');
    assert.equal(mObj.material.uniforms.uLit.value, 1.0);
    assert.ok(Math.abs(mObj.quaternion.x) > 0.01 || Math.abs(mObj.quaternion.y) > 0.01 || Math.abs(mObj.quaternion.z) > 0.01);

    // 4. CollisionModule bounce + SubModule (birth, collision, death)
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'sub_spark_pop',
      loop: false,
      duration: 0.3,
      layers: [{ kind: 'particle', bursts: [{ time: 0, count: 2 }], life: 0.2, size: 0.3 }],
    });
    vfx.playEffect({
      schemaVersion: 1,
      id: 'bouncing_bomb',
      loop: false,
      duration: 1.0,
      layers: [
        {
          kind: 'particle',
          bursts: [{ time: 0, count: 1 }],
          life: 0.5,
          size: 0.5,
          offset: [0, 0.4, 0],
          velocity: { linear: [1, -4, 0] },
          gravity: 9.8,
          startColor: ['#ff4400', '#ffff00'],
          collision: { groundY: 0, bounce: 0.6, dampen: 0.2, maxBounces: 2 },
          subEmitters: [
            { trigger: 'birth', effect: 'sub_spark_pop' },
            { trigger: 'collision', effect: 'sub_spark_pop' },
            { trigger: 'death', effect: 'sub_spark_pop' },
          ],
        },
      ],
    });
    // Step through bounce (t ~ 0.1s) and death (t ~ 0.5s)
    for (let i = 0; i < 15; i++) vfx.update(0.05);
    // 1 main + birth(2) + collision(2) + death(2) = 7+ normal particles
    assert.ok(vfx.atlasParticles.getStats().normalTotal >= 7);

    // 5. Prewarm, long-lived spark trail survival, shape.scale/shell/alignToDirection, noise.strengthY
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'prewarm_sparks_and_shell',
      loop: true,
      duration: 4.0,
      layers: [
        {
          name: 'sparks',
          kind: 'particle',
          prewarm: true,
          rate: 20,
          life: 2.0,
          size: 0.05,
          velocity: { linear: [0, [0.5, 1.0], 0], orbitalY: [0, 0.3] },
          noise: { strength: 1.0, strengthY: 0.25, frequency: 0.5 },
          colorCurve: [[0, [1, 0.2, 0.04, 1]], [1, [1, 0.2, 0.04, 0]]],
          trail: { lifetime: 0.15, blend: 'alpha', widthOverTrail: 1.0, sizeAffectsWidth: true, inheritColor: true, endColor: '#000000' },
        },
        {
          name: 'lances',
          kind: 'mesh',
          mesh: 'crystal',
          forwardAxis: 'y',
          rate: 10,
          life: 1.0,
          size: 0.4,
          shape: { type: 'sphere', radius: 2.0, shell: true, scale: [0.5, 0.8, 0.5], alignToDirection: true },
        },
      ],
    }, { x: 0, y: 0, z: 0 });
    assert.ok(vfx.atlasParticles.getStats().normalTotal >= 35, 'prewarm emits steady-state sparks on frame 0');
    assert.ok(vfx.trails.getStats().activeTrails >= 35, 'prewarm allocates trails for prewarmed sparks');
    // Step 0.4s (> trail.lifetime 0.15s) -> spark trails must remain active for full particle duration (2.0s)
    for (let i = 0; i < 8; i++) vfx.update(0.05);
    assert.ok(vfx.trails.getStats().activeTrails >= 35, 'trail followers stay alive past trailLifetime up to particle life');
    assert.ok(vfx.meshVfx.getStats().activeCount >= 3, 'aligned shell meshes spawn');

    // 6. Layer maxParticles cap triggers continuous immediate replay when life expires (e.g. Aura_Effect 1s inside 5s recipe)
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'max_particles_loop_test',
      loop: true,
      duration: 5.0,
      layers: [
        { name: 'pulse_ring', kind: 'particle', maxParticles: 1, rate: 10, life: 1.0, size: 8 },
      ],
    }, { x: 0, y: 0, z: 0 });
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 1, 'maxParticles=1 emits immediately at t=0');
    for (let i = 0; i < 23; i++) vfx.update(0.1); // t = 2.3s -> t=0, t=1.0, t=2.0 => 3 emissions!
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 3, 'maxParticles=1 layer replays immediately after each 1s particle expires');

    // 7. Unity TrailModule lifetimeMode === 'fraction' multiplies trail lifetime by particle duration
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'fraction_trail_test',
      loop: true,
      duration: 4.0,
      layers: [
        {
          name: 'sparks',
          kind: 'particle',
          prewarm: true,
          rate: 4,
          life: 4.0,
          size: 0.05,
          velocity: { linear: [0, 2, 0] },
          trail: { lifetime: 0.15, lifetimeMode: 'fraction', blend: 'alpha', widthOverTrail: 1.0, endColor: '#000000' },
        },
      ],
    }, { x: 0, y: 0, z: 0 });
    const fracRibbon = scene.getObjectByName('HGameVfxRibbonTrailsNormal');
    const fracA = fracRibbon.geometry.getAttribute('aSegA').array;
    const fracB = fracRibbon.geometry.getAttribute('aSegB').array;
    const fracMeta = fracRibbon.geometry.getAttribute('aSegMeta').array;
    let maxFracLen = 0;
    for (let t = 0; t < vfx.trails.getStats().trailCap; t++) {
      let len = 0;
      for (let s = 0; s < 7; s++) {
        const i4 = (t * 7 + s) * 4;
        if (fracMeta[i4 + 1] > 0 && (fracMeta[i4 + 2] > 0.001 || fracMeta[i4 + 3] > 0.001)) {
          len += Math.hypot(fracB[i4] - fracA[i4], fracB[i4 + 1] - fracA[i4 + 1], fracB[i4 + 2] - fracA[i4 + 2]);
        }
      }
      if (len > maxFracLen) maxFracLen = len;
    }
    // 4.0s * 0.15 = 0.60s trail duration at 2 m/s => ~1.2m ribbon length (vs ~0.3m if treated as 0.15s)
    assert.ok(maxFracLen >= 1.0, `fraction trail length (${maxFracLen.toFixed(2)}m) reflects particleDur * fraction`);

    // 8. Near-zero sphere radius with randomPos + radial velocity spreads spherically at non-zero Y (no vertical +Y pillar)
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'radial_zero_radius_test',
      loop: true,
      duration: 2.0,
      layers: [
        {
          name: 'trails',
          kind: 'particle',
          rate: 30,
          life: 1.0,
          size: 0.1,
          shape: { type: 'sphere', radius: 0, randomPos: 1, scale: [0.5, 0.8, 0.5] },
          velocity: { radial: 1, orbitalY: [1, 3] },
          trail: { lifetime: 0.4, lifetimeMode: 'fraction', width: 0.04, endColor: '#00123c' },
        },
      ],
    }, { x: 0, y: 1.2, z: 0 });
    for (let i = 0; i < 20; i++) vfx.update(0.05);
    const atlasNorm = scene.getObjectByName('HGameVfxAtlasNormal');
    const p0Arr = atlasNorm.geometry.getAttribute('aAtlasP0').array;
    const p1Arr = atlasNorm.geometry.getAttribute('aAtlasP1').array;
    let nonAxisCount = 0;
    for (let i = 0; i < 30; i++) {
      const x = p0Arr[i * 4];
      const z = p0Arr[i * 4 + 2];
      const vx = p1Arr[i * 4];
      const vz = p1Arr[i * 4 + 2];
      if (Math.hypot(x, z) > 0.05 && Math.hypot(vx, vz) > 0.05) nonAxisCount += 1;
    }
    assert.ok(nonAxisCount >= 10, `expected spherical spread off-axis (got ${nonAxisCount})`);
    // 9. Trail opacity (colorOverLifetime alpha) and endWidthScale scale segMeta alpha and segExtra endWidth
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'translucent_ribbon_test',
      loop: false,
      duration: 1.0,
      layers: [
        {
          name: 'trails',
          kind: 'particle',
          bursts: [{ time: 0, count: 1 }],
          life: 1.0,
          size: 0.1,
          velocity: { linear: [1, 0, 0] },
          trail: {
            lifetime: 0.5,
            lifetimeMode: 'fraction',
            blend: 'alpha',
            widthOverTrail: 0.5,
            endWidthScale: 1,
            alpha: 0.25,
            color: '#4ef7ff',
            endColor: '#004dff',
          },
        },
      ],
    }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 4; i++) vfx.update(0.05);
    const transRibbon = scene.getObjectByName('HGameVfxRibbonTrailsNormal');
    const transMeta = transRibbon.geometry.getAttribute('aSegMeta').array;
    const transExtra = transRibbon.geometry.getAttribute('aSegExtra').array;
    assert.ok(transMeta[2] > 0 && transMeta[2] <= 0.26, `expected trail alpha scaled <= 0.26 (got ${transMeta[2]})`);
    assert.ok(Math.abs(transExtra[2] - 1) < 0.05, `expected constant endWidthScale ~1 (got ${transExtra[2]})`);

    // 10. Per-trail sprite resolves custom aSegUvRect from registered atlasRegions
    vfx.reset();
    vfx.trails.setAtlasRegions({ snow_1: [0.25, 0.5, 0.75, 0.625] });
    vfx.playEffect({
      schemaVersion: 1,
      id: 'per_trail_sprite_test',
      loop: false,
      duration: 1.0,
      layers: [
        {
          name: 'trails',
          kind: 'particle',
          bursts: [{ time: 0, count: 1 }],
          life: 1.0,
          size: 0.2,
          velocity: { linear: [2, 0, 0] },
          trail: { lifetime: 0.5, widthOverTrail: 0.5, sprite: 'snow_1' },
        },
      ],
    }, { x: 0, y: 0, z: 0 });
    vfx.update(0.05);
    vfx.update(0.05);
    const addRibbon = scene.getObjectByName('HGameVfxRibbonTrails');
    const segUv = addRibbon.geometry.getAttribute('aSegUvRect').array;
    assert.ok(Math.abs(segUv[0] - 0.25) < 1e-4 && Math.abs(segUv[1] - 0.5) < 1e-4 && Math.abs(segUv[2] - 0.75) < 1e-4 && Math.abs(segUv[3] - 0.625) < 1e-4, `expected per-trail aSegUvRect=[0.25,0.5,0.75,0.625], got [${segUv[0]},${segUv[1]},${segUv[2]},${segUv[3]}]`);

    // 11. Persistent layers encode curveRow+1024/+2048 and emit only once across loop cycles, while LUT supports >8 stops
    vfx.reset();
    const multiStopSize = [];
    for (let k = 0; k <= 16; k++) multiStopSize.push([k / 16, k % 2 === 0 ? 1.0 : 0.1]);
    vfx.playEffect({
      schemaVersion: 1,
      id: 'persistent_flicker_test',
      loop: true,
      duration: 5.0,
      layers: [
        {
          name: 'base_glyph',
          kind: 'particle',
          maxParticles: 1,
          rate: 10,
          persistent: true,
          curveCycle: 5.0,
          life: 5.0,
          size: 8,
          sizeCurve: multiStopSize,
          colorCurve: [[0, [0, 1, 0, 1]], [0.5, [0, 1, 0, 0.4]], [1, [0, 1, 0, 1]]],
        },
        {
          name: 'outer_static',
          kind: 'particle',
          maxParticles: 1,
          rate: 10,
          persistent: true,
          life: 5.0,
          size: 10,
        },
      ],
    }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60; i++) vfx.update(0.1); // t = 6.0s > duration 5.0s
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 2, 'persistent maxParticles=1 layers emit once without respawning across loops');
    const p1Loop = atlasNorm.geometry.getAttribute('aAtlasP1').array;
    const p2Loop = atlasNorm.geometry.getAttribute('aAtlasP2').array;
    assert.equal(p1Loop[3], 5.0, 'curveCycle layer keeps cycle duration in p1.w');
    assert.ok((p2Loop[3] % 4096) >= 1024 && (p2Loop[3] % 4096) < 2048, `curveCycle layer packs +1024 row offset (got ${p2Loop[3] % 4096})`);
    assert.ok((p2Loop[7] % 4096) >= 2048, `static persistent layer packs +2048 row offset (got ${p2Loop[7] % 4096})`);

    const lutHi = createCurveLutTable(THREE);
    const hiRow = lutHi.compile(null, multiStopSize);
    const valValley = lutHi.sampleSize(hiRow, 1 / 16);
    const valPeak = lutHi.sampleSize(hiRow, 2 / 16);
    assert.ok(valValley < 0.2 && valPeak > 0.9, `expected >8-stop PingPong sizeCurve preserved in LUT (valley=${valValley.toFixed(2)}, peak=${valPeak.toFixed(2)})`);
    lutHi.dispose();

    // 12. Billboard aspectY, persistent orbiting mesh with orbitalOffset, spin axes, and GLB map extraction
    vfx.reset();
    const rockGeom = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const rockMat = new THREE.MeshBasicMaterial({ map: dummyTex });
    const rockObj = new THREE.Mesh(rockGeom, rockMat);
    vfx.registerMesh('rock_test', rockObj);
    vfx.playEffect({
      schemaVersion: 1,
      id: 'shield_aspect_and_rock_test',
      loop: true,
      duration: 5.0,
      layers: [
        {
          name: 'glow',
          kind: 'particle',
          renderMode: 'billboard',
          maxParticles: 1,
          rate: 10,
          persistent: true,
          life: 2.0,
          size: 3.0,
          aspectY: 1.333,
        },
        {
          name: 'rock',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'rock_test',
          maxParticles: 1,
          rate: 10,
          persistent: true,
          curveCycle: 5.0,
          life: 5.0,
          size: 1.0,
          offset: [1.118, 0.21, 0],
          velocity: { orbitalY: 4, orbitalOffset: [-1, 0, 0] },
          spin: [2.0, -3.0, 0],
        },
      ],
    }, { x: 0, y: 1.4, z: 0 });
    vfx.update(0.1);
    const p5Aspect = atlasNorm.geometry.getAttribute('aAtlasP5').array;
    const decScaleY = unpack2x12Pos(p5Aspect[1], 64, 64);
    assert.ok(Math.abs(decScaleY[1] - 1.333) < 0.02, `expected billboard aspectY=1.333 packed in aAtlasP5.y (got ${decScaleY[1]})`);
    const meshChild = scene.children.find((c) => c.geometry === rockGeom);
    assert.ok(meshChild, 'expected orbiting rock mesh spawned in scene');
    assert.equal(meshChild.material.uniforms.uHasTex.value, 1, 'registerMesh auto-binds material.map to uHasTex=1');
    const startX = meshChild.position.x;
    for (let i = 0; i < 60; i++) vfx.update(0.1); // t = 6.1s (> 5.0s)
    assert.equal(meshChild.visible, true, 'persistent mesh stays alive past duration');
    assert.ok(Math.abs(meshChild.position.x - startX) > 0.05 || Math.abs(meshChild.position.z) > 0.05, 'orbitalY orbits mesh around orbitalOffset pivot');
    assert.ok(Math.abs(meshChild.rotation.x) > 0.1 || Math.abs(meshChild.rotation.y) > 0.1, 'separateAxes spin rotates mesh');
    rockGeom.dispose();
    rockMat.dispose();

    // 13. shape.rotation rotates cone emission downward (-Y), and inline subEmitters pre-register on mesh layers
    vfx.reset();
    vfx.playEffect({
      schemaVersion: 1,
      id: 'shape_rot_and_mesh_sub_test',
      loop: false,
      duration: 1.5,
      layers: [
        {
          name: 'falling_shards',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'crystal',
          bursts: [{ time: 0, count: 1 }],
          life: 0.4,
          speed: 4.0,
          size: 0.5,
          shape: { type: 'cone', radius: 0.001, angle: 5, rotation: [Math.PI, 0, 0] },
          subEmitters: [
            {
              trigger: 'death',
              effect: {
                schemaVersion: 1,
                id: 'shape_rot_and_mesh_sub_test__sub_1',
                loop: false,
                duration: 0.6,
                layers: [{ name: 'burst', kind: 'particle', bursts: [{ time: 0, count: 2 }], life: 0.5, size: 1.0 }],
              },
            },
          ],
        },
      ],
    }, { x: 0, y: 3.0, z: 0 });
    vfx.update(0.1);
    const shardMesh = scene.children.find((c) => c.visible && c.name?.startsWith('HGameVfxMesh_') && c.geometry !== rockGeom);
    assert.ok(shardMesh, 'expected falling crystal mesh');
    assert.ok(shardMesh.position.y < 3.0, `expected cone rotation=[PI,0,0] to emit downward (y=${shardMesh.position.y})`);
    for (let i = 0; i < 6; i++) vfx.update(0.1); // t = 0.7s -> past life=0.4 triggers death subEmitter
    assert.ok(vfx.atlasParticles.getStats().normalTotal >= 2, 'mesh death subEmitter spawned particles');

    // 14. rateOverDistance emits particles interpolated along travel segments when moved via setTransform
    vfx.reset();
    const projHandle = vfx.playEffect({
      schemaVersion: 1,
      id: 'proj_rate_dist_test',
      loop: true,
      duration: 2.0,
      layers: [
        { name: 'wake', kind: 'particle', rateOverDistance: 10, life: 1.0, size: 0.4 },
      ],
    }, { x: 0, y: 1.4, z: 0 });
    vfx.update(0.05);
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 0, 'stationary rateOverDistance emits 0');
    projHandle.setTransform(2.0, 1.4, 0, 0);
    vfx.update(0.05);
    assert.equal(vfx.atlasParticles.getStats().normalTotal, 20, '2m displacement at rateOverDistance=10 emits 20 wake particles');

    // 15. Curve LUT supports up to 1024 unique curve rows without overwriting past 256
    const lutBig = createCurveLutTable(THREE);
    const seenRows = [];
    for (let k = 1; k <= 300; k++) {
      seenRows.push(lutBig.compile([[0, [k / 300, 0.5, 0.2, 1]], [1, [0, 0, 0, 0]]], [[0, 1], [1, k / 100]]));
    }
    assert.equal(seenRows[299], 300, '300th distinct curve receives unique row 300 (>256)');
    assert.ok(Math.abs(lutBig.sampleSize(300, 1.0) - 3.0) < 0.02, 'row 300 samples exact high-row sizeCurve');
    lutBig.dispose();

    // 16. Unity VFX fidelity evaluator scores synthetic prefab + converted recipe accurately
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-score-'));
    try {
      const pfDir = path.join(tmpRoot, 'unity/Particles/Prefabs/Auras');
      const vfxOut = path.join(tmpRoot, 'vfx');
      fs.mkdirSync(pfDir, { recursive: true });
      fs.mkdirSync(vfxOut, { recursive: true });
      fs.writeFileSync(path.join(pfDir, 'Aura_Test.prefab'), [
        '%YAML 1.1',
        '--- !u!1 &1',
        'GameObject:',
        '  m_Name: Aura_Test',
        '  m_IsActive: 1',
        '--- !u!198 &2',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 1}',
        '  simulationSpeed: 1',
        '  InitialModule:',
        '    enabled: 1',
        '    maxNumParticles: 1',
        '    startLifetime: { minMaxState: 0, scalar: Infinity }',
        '  EmissionModule:',
        '    enabled: 1',
        '    rateOverTime: { minMaxState: 0, scalar: 10 }',
        '    m_BurstCount: 0',
        '  ShapeModule:',
        '    enabled: 1',
        '    type: 10',
        '--- !u!199 &3',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 1}',
        '  m_RenderMode: 2',
      ].join('\n'), 'utf8');
      fs.writeFileSync(path.join(vfxOut, 'aura_test.vfx.json'), JSON.stringify({
        schemaVersion: 1,
        id: 'aura_test',
        duration: 5,
        loop: true,
        layers: [{ name: 'aura_test', kind: 'particle', renderMode: 'horizontal', rate: 10, maxParticles: 1, persistent: true, life: 5 }],
      }), 'utf8');
      const report = evaluateVfxFidelity({
        unityRoot: path.join(tmpRoot, 'unity'),
        vfxDir: vfxOut,
        subfolders: ['Auras'],
      });
      assert.equal(report.summary.prefabsAudited, 1);
      assert.equal(report.summary.activeParticleSystems, 1);
      assert.equal(report.dimensions.D5_Asset_Integrity.score, 15);
      assert.ok(report.summary.totalScore >= 95, `expected high score on 100%-matched prefab (got ${report.summary.totalScore})`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    dummyTex.dispose();
  } finally {
    vfx.dispose();
  }
});


test('Unity VFX full parity features: velCurve, sizeYCurve, simulationSpeed, donut/rectangle/mesh shapes, local moving offsets, wind, particle lights, widthCurve trails, collision resolver, and distortion pass', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 128, maxMeshVfx: 16 });
  const sceneTex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  try {
    // 1. Separate Y sizeCurve + cumulative signed velCurve in 1024-row Curve LUT
    const row = vfx.atlasParticles.compileCurves(
      [[0, [1, 1, 1, 1]], [1, [1, 1, 1, 0]]],
      [[0, 1], [1, 3]],
      [[0, 2], [1, 0.5]],
      [[0, 2], [1, 0]],
    );
    assert.ok(Math.abs(vfx.atlasParticles.lut.sampleSize(row, 0.5) - 2.0) < 0.05);
    assert.ok(Math.abs(vfx.atlasParticles.lut.sampleSizeY(row, 0.5) - 1.25) < 0.05);
    // Integral of v(u) = 2*(1-u) from 0..0.5 is 2*0.5 - 0.25 = 0.75
    assert.ok(Math.abs(vfx.atlasParticles.lut.sampleVelDisp(row, 0.5) - 0.75) < 0.06);

    // 2. Distortion channel starts hidden until setSceneTexture is bound
    const distMesh = scene.getObjectByName('HGameVfxAtlasDistortion');
    assert.ok(distMesh, 'expected distortion channel mesh created in 3D mode');
    assert.equal(distMesh.visible, false, 'distortion channel stays hidden without scene texture');
    vfx.setSceneTexture(sceneTex, { width: 640, height: 360, strength: 0.06 });
    assert.equal(distMesh.visible, true, 'distortion channel activates once scene texture is bound');

    // 3. simulationSpeed, rotation3D, 3D force, windMul, donut shape, moving local space, particleLight
    vfx.setWind(1.5, 0, -0.5);
    const h = vfx.playEffect({
      schemaVersion: 1,
      id: 'parity_showcase',
      duration: 2.0,
      loop: false,
      layers: [
        {
          name: 'local_torus_sparks',
          kind: 'particle',
          renderMode: 'billboard',
          blend: 'additive',
          space: 'local',
          simulationSpeed: 2.0,
          bursts: [{ time: 0, count: 2, cycles: 1, interval: 0.1 }],
          shape: { type: 'donut', radius: 1.5, donutRadius: 0.25 },
          life: 1.0,
          speed: 0,
          size: 0.6,
          rotX: 0.7,
          rotY: 1.1,
          force: [2.5, 0, -1.5],
          windMul: 2.0,
          sizeCurve: [[0, 1], [1, 0]],
          sizeYCurve: [[0, 2], [1, 0.5]],
          velCurve: [[0, 1], [1, -1]],
          particleLight: { color: '#ff8822', intensity: 3.0, range: 9, ratio: 1.0, maxLights: 4 },
          trail: {
            lifetime: 0.2,
            width: 0.3,
            widthCurve: [[0, 0.2], [0.5, 1.5], [1, 0.1]],
          },
        },
        {
          name: 'dist_wave',
          kind: 'particle',
          renderMode: 'horizontal',
          blend: 'distortion',
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          life: 0.5,
          size: 1.2,
        },
      ],
    }, { x: 1, y: 0.5, z: -1 });

    vfx.update(0.05);
    const addMesh = scene.getObjectByName('HGameVfxAtlasAdditive');
    const p1 = addMesh.geometry.getAttribute('aAtlasP1').array;
    const p6 = addMesh.geometry.getAttribute('aAtlasP6').array;
    assert.ok(Math.abs(p1[3] - 0.5) < 0.01, `simulationSpeed=2 halves duration 1.0->0.5 (got ${p1[3]})`);
    const decAccel = unpack2x12Sym(p6[1], 64, 64);
    const decRotXY = unpack2x12Sym(p6[2], Math.PI, Math.PI);
    assert.ok(Math.abs(decAccel[0] - 10.0) < 0.05, `forceX=2.5 * simSpd^2(4) == 10.0 packed in aAtlasP6.y (got ${decAccel[0]})`);
    assert.ok(Math.abs(decRotXY[0] - 0.7) < 0.01 && Math.abs(decRotXY[1] - 1.1) < 0.01, 'rotation3D rotX/rotY packed in aAtlasP6.z');
    assert.equal(vfx.atlasParticles.getStats().distortionTotal, 1, 'distortion particle routed to distortion channel');

    // Local emitter translation updates uEffectDeltas uniform
    h.setTransform(5, 1, 2, 0);
    vfx.update(0.05);
    const effDeltas = addMesh.material.uniforms.uEffectDeltas.value;
    const hasMovedAnchor = effDeltas.some((v) => Math.abs(v.x - 5) < 0.01 && Math.abs(v.z - 2) < 0.01);
    assert.equal(hasMovedAnchor, true, 'moving local-space effect updates GPU uEffectDeltas anchor');

    // Particle light active and following
    const activeLights = scene.children.filter((c) => c.isPointLight && c.visible);
    assert.ok(activeLights.length >= 1, 'LightsModule activates pooled PointLight on emitted particle');

    // Trail multi-stop widthCurve applied onto ribbon segments
    vfx.update(0.05);
    const ribbonMesh = scene.getObjectByName('HGameVfxRibbonTrails');
    const segExtra = ribbonMesh.geometry.getAttribute('aSegExtra').array;
    let nonLinearWidth = false;
    for (let i = 1; i < segExtra.length; i += 4) {
      if (segExtra[i] > 1.05 || segExtra[i + 1] > 1.05) {
        nonLinearWidth = true;
        break;
      }
    }
    assert.equal(nonLinearWidth, true, 'TrailModule multi-stop widthCurve scales segment widths > 1.0');

    // 4. Mesh surface shape sampling & custom collision resolver syncing mesh pool
    const triGeo = new THREE.BoxGeometry(2, 2, 2);
    vfx.registerMesh('box_surface_emitter', triGeo);
    const surf = vfx.meshVfx.getSurfaceSamples('box_surface_emitter');
    assert.ok(surf && surf.count > 0, 'getSurfaceSamples extracts triangle centroids and normals');

    let customResolverCalled = false;
    vfx.setCollisionResolver((x, y, z, vx, vy) => {
      customResolverCalled = true;
      return (y <= 1.2 && vy < 0) ? { hit: true, y: 1.2, nx: 0, ny: 1, nz: 0 } : null;
    });
    vfx.playEffect({
      schemaVersion: 1,
      id: 'mesh_bounce_test',
      duration: 1.0,
      loop: false,
      layers: [
        {
          name: 'rect_spawn',
          kind: 'particle',
          shape: { type: 'rectangle', size: [2, 2, 0] },
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          life: 0.4,
          size: 0.3,
        },
        {
          name: 'mesh_surface_spawn',
          kind: 'mesh',
          mesh: 'box_surface_emitter',
          shape: { type: 'mesh', mesh: 'box_surface_emitter' },
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          offset: [0, 1.4, 0],
          life: 0.8,
          gravity: 12,
          collision: { groundY: 0, bounce: 0.6, dampen: 0.1, maxBounces: 2 },
        },
      ],
    });
    for (let k = 0; k < 10; k++) vfx.update(0.04);
    assert.equal(customResolverCalled, true, 'custom collision resolver invoked for collision layers');
    triGeo.dispose();
  } finally {
    sceneTex.dispose();
    vfx.dispose();
  }
});

test('Unity Shader/Blend/Pivot/Shape parity & convertUnityPrefab extract _TintColor, _Blend:3, _Cull, _AlphaClip, built-ins, and parent scale', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 32, maxAtlasParticles: 128, maxMeshVfx: 16 });
  try {
    vfx.playEffect({
      schemaVersion: 1,
      id: 'shader_parity_smoke',
      duration: 1.0,
      loop: false,
      layers: [
        {
          name: 'mult_cull_layer',
          kind: 'particle',
          blend: 'multiply',
          cullMode: 'front',
          alphaCutoff: 0.45,
          cameraFade: [0.3, 1.5],
          uvScale: [2, 3],
          uvOffset: [0.1, 0.2],
          emissionBoost: 2.5,
          dissolve: { start: 0.4, edge: 0.1 },
          pivot: [0.25, -0.5],
          renderMode: 'stretched',
          velocityScale: 0.25,
          lengthScale: 1.5,
          shape: { type: 'cone', radius: 0.5, sphericalDirectionAmount: 1.0, randomDirectionAmount: 0.2 },
          bursts: [{ time: 0, count: 2, cycles: 1, interval: 0.1 }],
          life: 1.0,
          size: 0.8,
          speed: 3.0,
        },
        {
          name: 'premult_layer',
          kind: 'particle',
          blend: 'premultiply',
          cullMode: 'none',
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          life: 1.0,
          size: 0.6,
        },
        {
          name: 'builtin_quad_mesh',
          kind: 'mesh',
          mesh: 'quad',
          meshGlobalScale: 1.75,
          blend: 'multiply',
          cullMode: 'none',
          alphaCutoff: 0.5,
          uvScale: [2, 2],
          uvOffset: [0.25, 0.25],
          pivot: [0, 0.5],
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          life: 1.0,
          size: 1.0,
        },
        {
          name: 'builtin_cube_mesh',
          kind: 'mesh',
          mesh: 'cube',
          blend: 'premultiply',
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.1 }],
          life: 1.0,
          size: 0.5,
        },
      ],
    });
    vfx.update(0.05);

    const stats = vfx.atlasParticles.getStats();
    assert.equal(stats.multiplyTotal, 2, 'multiply blend channel receives 2 particles');
    assert.equal(stats.premultiplyTotal, 1, 'premultiply blend channel receives 1 particle');

    const multMesh = scene.getObjectByName('HGameVfxAtlasMultiply');
    assert.ok(multMesh, 'HGameVfxAtlasMultiply mesh attached to scene');
    const p2 = multMesh.geometry.getAttribute('aAtlasP2').array;
    const p3 = multMesh.geometry.getAttribute('aAtlasP3').array;
    const p7 = multMesh.geometry.getAttribute('aAtlasP7').array;
    const decPivot = unpack2x12Sym(p3[2], 2, 2);
    const decStretch = unpack2x12Pos(p3[3], 15, 15);
    const decHdrEm = unpack2x12Pos(p3[1], 35, 35);
    assert.ok(Math.abs(decPivot[0] - 0.25) < 0.01 && Math.abs(decPivot[1] + 0.5) < 0.01, 'pivot packed in aAtlasP3.z');
    assert.ok(Math.abs(decStretch[0] - 0.25) < 0.01 && Math.abs(decStretch[1] - 1.5) < 0.01, 'velocityScale/lengthScale packed in aAtlasP3.w');
    assert.ok(Math.abs(decHdrEm[1] - 2.5) < 0.01, 'emissionBoost packed in aAtlasP3.y');
    assert.equal(Math.floor(p2[3] / 262144) % 4, 2, 'cullMode front (2) packed in aAtlasP2.w');

    // Verify unpackRgb24 round-trip on cutoff / camFade / uvScale / dissolve
    const decCut = unpackRgb24Into(p7[0], [0, 0, 0]);
    assert.ok(Math.abs(decCut[0] - 0.45) < 0.02, 'alphaCutoff round-trips in aAtlasP7.x');
    const decUv = unpackRgb24Into(p7[1], [0, 0, 0]);
    assert.ok(Math.abs(decUv[0] * 8 - 2) < 0.1, 'uvScale.x round-trips in aAtlasP7.y');

    // Built-in Unity primitive meshes quad & cube spawn without registerMesh
    assert.equal(vfx.meshVfx.getStats().activeCount, 2, 'built-in quad + cube mesh VFX spawn automatically');

    // Synthetic Unity .prefab + .mat + .meta conversion test
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-parity-'));
    try {
      const texGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const matGuid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const legacyTexGuid = 'cccccccccccccccccccccccccccccccc';
      const texPath = path.join(tmpDir, 'Spark.png');
      fs.writeFileSync(texPath, '');
      fs.writeFileSync(`${texPath}.meta`, `fileFormatVersion: 2\nguid: ${texGuid}\n`);
      const legacyTexPath = path.join(tmpDir, 'Old.png');
      fs.writeFileSync(legacyTexPath, '');
      fs.writeFileSync(`${legacyTexPath}.meta`, `fileFormatVersion: 2\nguid: ${legacyTexGuid}\n`);
      const matPath = path.join(tmpDir, 'MultMat.mat');
      fs.writeFileSync(
        matPath,
        [
          '%YAML 1.1',
          'Material:',
          '  m_SavedProperties:',
          '    m_TexEnvs:',
          '    - _MainTex:',
          `        m_Texture: {fileID: 2800000, guid: ${legacyTexGuid}, type: 3}`,
          '        m_Scale: {x: 1, y: 1}',
          '        m_Offset: {x: 0, y: 0}',
          '    - _BaseMap:',
          `        m_Texture: {fileID: 2800000, guid: ${texGuid}, type: 3}`,
          '        m_Scale: {x: 2, y: 4}',
          '        m_Offset: {x: 0.1, y: 0.25}',
          '    m_Floats:',
          '    - _Surface: 1',
          '    - _Mode: 0',
          '    - _ZWrite: 1',
          '    - _ZTest: 5',
          '    - _SoftParticlesEnabled: 0',
          '    - _Blend: 3',
          '    - _Cull: 2',
          '    - _AlphaClip: 1',
          '    - _Cutoff: 0.35',
          '    - _EmissionEnabled: 1',
          '    - _CameraFadingEnabled: 1',
          '    - _CameraNearFadeDistance: 0.5',
          '    - _CameraFarFadeDistance: 2.5',
          '    m_Colors:',
          '    - _Color: {r: 0.1, g: 1, b: 0.1, a: 1}',
          '    - _TintColor: {r: 1, g: 0.5, b: 0.25, a: 0.4}',
          '    - _BaseColor: {r: 1, g: 0.5, b: 0.25, a: 0.6}',
          '    - _EmissionColor: {r: 2, g: 1, b: 0.5, a: 1}',
        ].join('\n')
      );
      fs.writeFileSync(`${matPath}.meta`, `fileFormatVersion: 2\nguid: ${matGuid}\n`);

      const prefabPath = path.join(tmpDir, 'ParityRoot.prefab');
      fs.writeFileSync(
        prefabPath,
        [
          '%YAML 1.1',
          '--- !u!1 &10',
          'GameObject:',
          '  m_Name: ParityRoot',
          '  m_IsActive: 1',
          '--- !u!4 &11',
          'Transform:',
          '  m_GameObject: {fileID: 10}',
          '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
          '  m_LocalPosition: {x: 0, y: 0, z: 0}',
          '  m_LocalScale: {x: 2, y: 2, z: 2}',
          '  m_Father: {fileID: 0}',
          '--- !u!1 &20',
          'GameObject:',
          '  m_Name: ChildMesh',
          '  m_IsActive: 1',
          '--- !u!4 &21',
          'Transform:',
          '  m_GameObject: {fileID: 20}',
          '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
          '  m_LocalPosition: {x: 0, y: 1, z: 0}',
          '  m_LocalScale: {x: 1, y: 1, z: 1}',
          '  m_Father: {fileID: 11}',
          '--- !u!198 &22',
          'ParticleSystem:',
          '  m_GameObject: {fileID: 20}',
          '  lengthInSec: 1',
          '  looping: 0',
          '  simulationSpeed: 1',
          '  moveWithTransform: 0',
          '  InitialModule:',
          '    startLifetime:',
          '      minMaxState: 0',
          '      scalar: 1',
          '    startSpeed:',
          '      minMaxState: 0',
          '      scalar: 2',
          '    startSize:',
          '      minMaxState: 0',
          '      scalar: 1.5',
          '    startColor:',
          '      minMaxState: 0',
          '      maxColor: {r: 1, g: 1, b: 1, a: 1}',
          '  EmissionModule:',
          '    enabled: 1',
          '    rateOverTime:',
          '      minMaxState: 0',
          '      scalar: 0',
          '    m_BurstCount: 1',
          '    m_Bursts:',
          '    - time: 0',
          '      countCurve:',
          '        scalar: 1',
          '      cycleCount: 1',
          '      repeatInterval: 0.1',
          '  ShapeModule:',
          '    enabled: 1',
          '    type: 4',
          '    radius:',
          '      value: 0.5',
          '    randomDirectionAmount: 0.3',
          '    sphericalDirectionAmount: 0.8',
          '  SizeModule:',
          '    enabled: 0',
          '  ColorModule:',
          '    enabled: 0',
          '  UVModule:',
          '    enabled: 0',
          '  TrailModule:',
          '    enabled: 0',
          '  SubModule:',
          '    enabled: 0',
          '--- !u!199 &23',
          'ParticleSystemRenderer:',
          '  m_GameObject: {fileID: 20}',
          '  m_Enabled: 1',
          '  m_RenderMode: 4',
          '  m_Pivot: {x: 0, y: 0.5, z: 0}',
          '  m_Materials:',
          `  - {fileID: 2100000, guid: ${matGuid}, type: 2}`,
          '  m_Mesh: {fileID: 10210, guid: 0000000000000000e000000000000000, type: 0}',
          '--- !u!1 &30',
          'GameObject:',
          '  m_Name: DisabledRenderer',
          '  m_IsActive: 1',
          '--- !u!4 &31',
          'Transform:',
          '  m_GameObject: {fileID: 30}',
          '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
          '  m_LocalPosition: {x: 0, y: 0, z: 0}',
          '  m_LocalScale: {x: 1, y: 1, z: 1}',
          '  m_Father: {fileID: 11}',
          '--- !u!198 &32',
          'ParticleSystem:',
          '  m_GameObject: {fileID: 30}',
          '  lengthInSec: 1',
          '  looping: 0',
          '  InitialModule:',
          '    startLifetime:',
          '      minMaxState: 0',
          '      scalar: 1',
          '    startSize:',
          '      minMaxState: 0',
          '      scalar: 1',
          '  EmissionModule:',
          '    enabled: 1',
          '    rateOverTime:',
          '      scalar: 1',
          '  TrailModule:',
          '    enabled: 0',
          '--- !u!199 &33',
          'ParticleSystemRenderer:',
          '  m_GameObject: {fileID: 30}',
          '  m_Enabled: 0',
        ].join('\n')
      );

      const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'parity_root' });
      assert.equal(validateVfxRecipe(recipe).ok, true, 'converted synthetic recipe validates cleanly');
      assert.equal(recipe.layers.length, 1, 'm_Enabled: 0 renderer without trail is skipped');
      const l = recipe.layers[0];
      assert.equal(l.mesh, 'quad', 'built-in fileID 10210 maps to quad');
      assert.equal(l.sprite, 'spark', 'mesh particles reuse the material texture by atlas key');
      assert.equal(l.opaque, undefined, 'URP surface type takes precedence over the legacy mode');
      assert.equal(l.depthWrite, true, 'transparent materials may write depth');
      assert.equal(l.depthTest, 'greater', 'Unity CompareFunction is translated to a recipe name');
      assert.equal(l.softParticles, false, 'material can opt out of a shared scene-depth fade');
      assert.equal(l.blend, 'multiply', '_Blend: 3 maps to multiply');
      assert.equal(l.cullMode, 'back', '_Cull: 2 maps to back');
      assert.equal(l.alphaCutoff, 0.35, '_AlphaClip + _Cutoff extracted');
      assert.ok(l.colorCurve.every(([, color]) => color[3] === 0.6), 'URP base color alpha modulates the particle lifetime color');
      const legacyMaterial = fs.readFileSync(matPath, 'utf8')
        .replace(/^.*_Surface:.*\n/m, '')
        .replace(/^.*_BaseColor:.*\n/m, '')
        .replace('_Mode: 0', '_Mode: 3');
      fs.writeFileSync(matPath, legacyMaterial);
      const { recipe: legacyRecipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'legacy' });
      assert.ok(legacyRecipe.layers[0].colorCurve.every(([, color]) => color[3] === 0.4), 'legacy tint alpha modulates the particle lifetime color');
      assert.equal(legacyRecipe.layers[0].sprite, 'old', 'legacy materials prefer their _MainTex');
      const emptyBase = legacyMaterial.replace(/(- _BaseMap:\n\s+m_Texture: ).+/, '$1{fileID: 0}').replace('_Mode: 3', '_Surface: 1');
      fs.writeFileSync(matPath, emptyBase);
      const { recipe: emptyBaseRecipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'empty' });
      assert.equal(emptyBaseRecipe.layers[0].sprite, undefined, 'a cleared URP base map keeps the default texture');
      fs.writeFileSync(matPath, emptyBase.replace('_Surface: 1', '_Surface: 0').replace('_ZWrite: 1', '_ZWrite: 0').replace('_ZTest: 5', '_ZTest: 0'));
      const meshPrefab = fs.readFileSync(prefabPath, 'utf8');
      fs.writeFileSync(prefabPath, meshPrefab.replace('m_RenderMode: 4', 'm_RenderMode: 0'));
      const { recipe: billboardRecipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'billboard' });
      const billboard = billboardRecipe.layers[0];
      assert.equal(billboard.renderMode, 'billboard');
      assert.equal(billboard.opaque, true);
      assert.equal(billboard.useTexture, false, 'a cleared opaque material uses white instead of the entire atlas');
      assert.equal(billboard.depthWrite, false, 'explicitly disabled depth writes survive on an opaque layer');
      assert.equal(billboard.depthTest, 'disabled');
      assert.equal(validateVfxRecipe(billboardRecipe).ok, true);
      const uvBlock = ['  UVModule:', '    enabled: 1', '    tilesX: 2', '    tilesY: 3', '    cycles: 2',
        '    animationType: 0', '    rowMode: 1', '    rowIndex: 2'].join('\n');
      const meshSheet = meshPrefab.replace('  UVModule:\n    enabled: 0', uvBlock);
      fs.writeFileSync(matPath, legacyMaterial.replace('_Mode: 3', '_Surface: 1\n    - _FlipbookMode: 0\n    - _FlipbookBlending: 1'));
      fs.writeFileSync(prefabPath, meshSheet);
      const { recipe: wholeSheet } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'whole_sheet' });
      const expectedSheet = { region: 'spark', cols: 2, rows: 3, cycles: 2, blend: true };
      assert.deepEqual(wholeSheet.layers[0].flipbook, expectedSheet, 'whole sheet ignores an inactive row mode');
      fs.writeFileSync(prefabPath, meshSheet.replace('animationType: 0', 'animationType: 1').replace('rowMode: 1', 'rowMode: 0'));
      const { recipe: singleRow } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'single_row' });
      assert.deepEqual(singleRow.layers[0].flipbook, { ...expectedSheet, rowMode: 'custom', rowIndex: 2 });
      assert.ok(l.emissionBoost > 1.0, '_EmissionEnabled + HDR _EmissionColor sets emissionBoost');
      assert.deepEqual(l.cameraFade, [0.5, 2.5], '_CameraFadingEnabled extracts near/far fade distances');
      assert.deepEqual(l.uvScale, [2, 4], 'URP _BaseMap scale is paired with its texture');
      assert.deepEqual(l.uvOffset, [0.1, 0.25], 'URP _BaseMap offset is paired with its texture');
      assert.deepEqual(l.pivot, [0, 0.5, 0], 'm_Pivot extracted');
      assert.equal(l.shape.sphericalDirectionAmount, 0.8, 'sphericalDirectionAmount extracted');
      assert.equal(l.shape.randomDirectionAmount, 0.3, 'randomDirectionAmount extracted');
      assert.equal(l.shape.radius, 1, 'parent m_LocalScale:2 scales child shape radius');
      assert.equal(l.offset[1], 2, 'parent m_LocalScale:2 scales child local offset');
      assert.equal(l.size, 3, 'parent m_LocalScale:2 scales child startSize 1.5 -> 3');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    vfx.dispose();
  }
});

test('Piloto ShaderGraph parity: UberFXSG, Piloto Warp, PBR FX packing, Distorted name safety, and InstancedMesh batching', async () => {
  const { convertUnityPrefab } = await import('../scripts/import-unity-vfx.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');

  const lut = createUberMaterialLut(THREE, 8);
  const row0 = lut.allocateRow('uber_test', {
    shaderKind: 'uber_fx',
    blend: 'additive',
    keywords: ['_USERAMP', '_USESOFTALPHA', '_FRESNEL'],
    mainTexKey: 'spark',
    detailNoiseKey: 'smoke',
    whiteColor: [4, 2, 1, 1],
    midColor: [2, 0.5, 0.1, 1],
    lastColor: [0.1, 0, 0, 1],
    middlePointPos: 0.65,
    middlePointPos1: 0.15,
    fresnelPower: 3.0,
    fresnelScale: 1.5,
  }, { spark: [0.1, 0.2, 0.4, 0.5], smoke: [0.5, 0.0, 0.9, 0.4] });
  assert.equal(row0, 0);
  const row0Offset = 0;
  assert.equal(lut.data[row0Offset], UBER_SHADER_KIND.UBER_FX);
  assert.ok((lut.data[row0Offset + 1] & 1) !== 0 && (lut.data[row0Offset + 1] & 4) !== 0 && (lut.data[row0Offset + 1] & 16) !== 0);
  assert.ok(Math.abs(lut.data[row0Offset + 4] - 0.1) < 1e-5 && Math.abs(lut.data[row0Offset + 7] - 0.5) < 1e-5);
  assert.equal(lut.data[row0Offset + 19 * 4], 4);
  lut.dispose();

  // InstancedMesh batching + CustomData + ClampVelocity + SoftParticles + QualityTier + Distortion tracking
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, maxAtlasParticles: 64, maxMeshVfx: 16 });
  try {
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'piloto_inst_test',
      duration: 2.0,
      loop: false,
      layers: [
        {
          name: 'mesh_uber',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'crystal',
          blend: 'additive',
          life: 1.0,
          speed: 20,
          size: 1.0,
          clampVelocity: { limit: 5, dampen: 1 },
          rotationBySpeed: { enabled: true, minSpeed: 0, maxSpeed: 20, minAngularVel: 0, maxAngularVel: 4 },
          customData: {
            custom1: { mode: 'vector', x: { scalar: 3, curve: [[0, 0], [1, 1]] }, y: 1.5, z: 0, w: 0 },
            custom2: { mode: 'vector', x: 0.4, y: 0, z: 0, w: 0 },
          },
          uberMat: { key: 'test_uber_m', shaderKind: 'uber_fx', blend: 'additive', useRamp: true },
          bursts: [{ time: 0, count: 3, cycles: 1, interval: 0.01 }],
        },
        {
          name: 'warp_layer',
          kind: 'particle',
          renderMode: 'billboard',
          blend: 'distortion',
          life: 0.8,
          size: 2.0,
          uberMat: { key: 'test_warp_m', shaderKind: 'piloto_warp', polarCoordinates: true, distortionStrength: 0.08 },
          bursts: [{ time: 0, count: 1, cycles: 1, interval: 0.01 }],
        },
        {
          name: 'ribbon_ctrl',
          kind: 'particle',
          renderMode: 'none',
          life: 1.0,
          speed: 4,
          rate: 20,
          trail: { mode: 'ribbon', lifetime: 0.25, width: 0.4, blend: 'additive' },
        },
      ],
    });
    vfx.playEffect('piloto_inst_test', { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 6; i++) vfx.update(0.05);

    const meshStats = vfx.meshVfx.getStats();
    assert.equal(meshStats.activeCount, 3, 'all 3 UberFX meshes active');
    assert.equal(meshStats.instancedBatches, 1, 'identical UberFX meshes share 1 InstancedMesh draw batch');
    const velOut = [0, 0, 0];
    const posOut = [0, 0, 0];
    vfx.meshVfx.readSlotMotion(16, posOut, velOut);
    assert.ok(Math.hypot(velOut[0], velOut[1], velOut[2]) <= 5.05, 'ClampVelocity clamps mesh speed <= limit');
    assert.equal(vfx.hasActiveDistortion(), true, 'distortion reported active while warp particle alive');
    vfx.setQualityTier('low');
    assert.equal(vfx.hasActiveDistortion(), false, 'low quality tier disables distortion grab');
    vfx.setQualityTier('high');

    // Also confirm atlas particle Custom1 curve + ClampVelocity
    const atlasCh = scene.getObjectByName('HGameVfxAtlasAdditive');
    assert.ok(atlasCh.geometry.getAttribute('aCustom1'), 'atlas particles expose aCustom1');
    assert.ok(atlasCh.geometry.getAttribute('aCustom2'), 'atlas particles expose aCustom2');
    assert.equal(Object.keys(atlasCh.geometry.attributes).length, 12, 'atlas particle geometry keeps <= 12 attributes');

    // Confirm meshGlobalScale normalizes Custom2.x object-space vertex offset before instance scaling
    vfx.reset();
    vfx.meshVfx.spawn({
      mesh: 'crystal',
      meshGlobalScale: 100,
      sizeStart: 2,
      life: 1,
      customData: { custom2: { mode: 'vector', x: 0.1, y: 0, z: 0, w: 0 } },
      uberMat: { key: 'test_uber_mgs', shaderKind: 'uber_fx', blend: 'alpha' },
    });
    vfx.update(0.05);
    const scaledBatch = scene.getObjectByName('HGameVfxMeshInst_1');
    const c2Arr = scaledBatch?.geometry?.getAttribute('aInstCustom2')?.array;
    assert.ok(c2Arr && Math.abs(c2Arr[0] - 0.001) < 1e-6, `aInstCustom2.x scaled by 1/meshGlobalScale (got ${c2Arr?.[0]})`);
  } finally {
    vfx.dispose();
  }

  // Test ShaderGraph importer bugfix: "Distorted" name on UberFXSG stays additive/alpha, shaderGuid wins over stale props
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piloto-sg-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'tex.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'tex.png.meta'), 'fileFormatVersion: 2\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    const uberDistortedMat = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: Explosion_Shockwave_06_Distorted_M',
      '  m_Shader: {fileID: 4800000, guid: 7f11fe28133f1a74594785107b98f2fe, type: 3}',
      '  m_ValidKeywords:',
      '  - _USERAMP',
      '  - _USESOFTALPHA',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      '        m_Texture: {fileID: 2800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '        m_Scale: {x: 3, y: 1}',
      '        m_Offset: {x: 0.2, y: 0}',
      '    m_Floats:',
      '    - _Blend: 2',
      '    - _Cull: 0',
      '    - _MiddlePointPos: 0.6',
      '    m_Colors:',
      '    - _WhiteColor: {r: 5, g: 2, b: 1, a: 1}',
      '    - _DetailNoisePanning: {r: 0.5, g: -0.25, b: 0, a: 0}',
    ].join('\n');
    const pbrStaleMat = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: Blood_Decal_PBR',
      '  m_Shader: {fileID: 4800000, guid: de445866a68ac7049bf65b2cf854d5a5, type: 3}',
      '  m_ValidKeywords:',
      '  - _ISPARTICLE',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _BaseColorMap:',
      '        m_Texture: {fileID: 2800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}',
      '    m_Floats:',
      '    - _AlphaClip: 1',
      '    - _AlphaClipping: 0.45',
      '    - _MetallicScale: 0.8',
      '    m_Colors:',
      '    - _MainTextureChannel: {r: 1, g: 1, b: 1, a: 0}',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'DistortedUber.mat'), uberDistortedMat);
    fs.writeFileSync(path.join(tmpDir, 'DistortedUber.mat.meta'), 'fileFormatVersion: 2\nguid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n');
    fs.writeFileSync(path.join(tmpDir, 'StalePbr.mat'), pbrStaleMat);
    fs.writeFileSync(path.join(tmpDir, 'StalePbr.mat.meta'), 'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n');
    const prefab = [
      '%YAML 1.1',
      '--- !u!1 &1000',
      'GameObject:\n  m_Name: Root\n  m_IsActive: 1',
      '--- !u!4 &1001',
      'Transform:\n  m_GameObject: {fileID: 1000}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 0}',
      '--- !u!1 &1010',
      'GameObject:\n  m_Name: UberNode\n  m_IsActive: 1',
      '--- !u!4 &1011',
      'Transform:\n  m_GameObject: {fileID: 1010}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 1001}',
      '--- !u!198 &1012',
      'ParticleSystem:\n  m_GameObject: {fileID: 1010}\n  lengthInSec: 1\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n    startSize:\n      minMaxState: 0\n      scalar: 1\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 5\n  ClampVelocityModule:\n    enabled: 1\n    separateAxis: 0\n    dampen: 0.25\n    magnitude:\n      minMaxState: 0\n      scalar: 6\n  CustomDataModule:\n    enabled: 1\n    mode0: 1\n    vector0_0:\n      minMaxState: 0\n      scalar: 2.5',
      '--- !u!199 &1013',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 1010}\n  m_Enabled: 1\n  m_RenderMode: 0\n  m_Materials:\n  - {fileID: 2100000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 2}',
      '--- !u!1 &1020',
      'GameObject:\n  m_Name: PbrNode\n  m_IsActive: 1',
      '--- !u!4 &1021',
      'Transform:\n  m_GameObject: {fileID: 1020}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 1001}',
      '--- !u!198 &1022',
      'ParticleSystem:\n  m_GameObject: {fileID: 1020}\n  lengthInSec: 1\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 1',
      '--- !u!199 &1023',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 1020}\n  m_Enabled: 1\n  m_RenderMode: 5\n  m_Materials:\n  - {fileID: 2100000, guid: cccccccccccccccccccccccccccccccc, type: 2}',
    ].join('\n');
    const pPath = path.join(tmpDir, 'sg.prefab');
    fs.writeFileSync(pPath, prefab);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath: pPath, id: 'sg_check' });
    assert.equal(validateVfxRecipe(recipe).ok, true);
    assert.equal(recipe.layers[0].blend, 'additive', 'UberFXSG named Distorted is NOT misclassified as distortion');
    assert.equal(recipe.layers[0].uberMat.shaderKind, 'uber_fx');
    assert.deepEqual(recipe.layers[0].uberMat.mainTexST, [3, 1, 0.2, 0]);
    assert.deepEqual(recipe.layers[0].clampVelocity, { separateAxis: false, limit: 6, magnitude: 6, dampen: 0.25 });
    assert.equal(recipe.layers[0].customData.custom1.x, 2.5);
    assert.equal(recipe.layers[1].renderMode, 'none', 'm_RenderMode: 5 imports as none');
    assert.equal(recipe.layers[1].uberMat.shaderKind, 'pbr_fx', 'm_Shader GUID takes priority over leftover _MainTextureChannel');
    assert.equal(recipe.layers[1].uberMat.alphaClipping, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3D orbital sphere trails stay centered on layer offset and obey noise damping bounds', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 16, maxAtlasParticles: 64, maxTrails: 32, maxTrailNodes: 20 });
  try {
    const points = [];
    const origPush = vfx.trails.pushTrailPoint.bind(vfx.trails);
    const origHead = vfx.trails.updateTrailHead.bind(vfx.trails);
    vfx.trails.pushTrailPoint = (id, x, y, z, t) => {
      points.push([x, y, z]);
      return origPush(id, x, y, z, t);
    };
    vfx.trails.updateTrailHead = (id, x, y, z, t) => {
      points.push([x, y, z]);
      return origHead(id, x, y, z, t);
    };

    vfx.registerEffect({
      schemaVersion: 1,
      id: 'orbital_offset_trail_test',
      duration: 1.0,
      loop: false,
      layers: [{
        name: 'trails',
        kind: 'particle',
        offset: [0, 0.84, 0],
        shape: { type: 'sphere', radius: 0.84, shell: true },
        life: 1.0,
        rate: 8,
        speed: 0,
        velocity: {
          orbitalX: [-0.72, 0.74],
          orbitalY: [-6.28, 6.68],
          orbitalZ: [-5.98, 8.21],
        },
        noise: { strength: 0.2, frequency: 0.5, scrollSpeed: 0.1, damping: true },
        trail: { lifetime: 1.0, width: 0.6, mode: 'particles' },
      }],
    });

    vfx.playEffect('orbital_offset_trail_test', { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 50; i++) vfx.update(0.02);

    assert.ok(points.length >= 40, `expected >= 40 trail points, got ${points.length}`);
    let minY = Infinity;
    let maxDist = 0;
    for (const [x, y, z] of points) {
      if (y < minY) minY = y;
      const dist = Math.hypot(x, y - 0.84, z);
      if (dist > maxDist) maxDist = dist;
    }
    assert.ok(minY >= -0.15, `expected orbital sphere trails to stay above floor (minY=${minY.toFixed(3)})`);
    assert.ok(maxDist <= 1.15, `expected orbital sphere trails within 1.15m of emitter center (maxDist=${maxDist.toFixed(3)})`);
  } finally {
    vfx.dispose();
  }
});

test('convertUnityPrefab extracts 2-space startDelay and rotates local VelocityModule by Transform rotation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-delay-rot-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'tex.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'tex.png.meta'), 'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n');
    const matYaml = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: TestMat',
      '  m_Shader: {fileID: 4800000, guid: 7f11fe28133f1a74594785107b98f2fe, type: 3}',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      '        m_Texture: {fileID: 2800000, guid: dddddddddddddddddddddddddddddddd, type: 3}',
      '    m_Floats:',
      '    - _Blend: 1',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'Test.mat'), matYaml);
    fs.writeFileSync(path.join(tmpDir, 'Test.mat.meta'), 'fileFormatVersion: 2\nguid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n');
    const prefabYaml = [
      '%YAML 1.1',
      '--- !u!1 &100',
      'GameObject:\n  m_Name: Root\n  m_IsActive: 1',
      '--- !u!4 &101',
      'Transform:\n  m_GameObject: {fileID: 100}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 0}',
      '--- !u!1 &200',
      'GameObject:\n  m_Name: DelayedLocalVel\n  m_IsActive: 1',
      '--- !u!4 &201',
      'Transform:\n  m_GameObject: {fileID: 200}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0.38268343, z: 0, w: 0.92387956}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 101}',
      '--- !u!198 &202',
      'ParticleSystem:\n  m_GameObject: {fileID: 200}\n  lengthInSec: 1\n  looping: 0\n  startDelay:\n    serializedVersion: 2\n    minMaxState: 0\n    scalar: 2.15\n    minScalar: 0\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n    startSpeed:\n      minMaxState: 0\n      scalar: 0\n    startSize:\n      minMaxState: 0\n      scalar: 1\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 1\n  VelocityModule:\n    enabled: 1\n    inWorldSpace: 0\n    x:\n      minMaxState: 0\n      scalar: 0\n    y:\n      minMaxState: 0\n      scalar: 0\n    z:\n      minMaxState: 0\n      scalar: 1\n  ShapeModule:\n    enabled: 0',
      '--- !u!199 &203',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 200}\n  m_Enabled: 1\n  m_RenderMode: 1\n  m_Materials:\n  - {fileID: 2100000, guid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee, type: 2}',
    ].join('\n');
    const pPath = path.join(tmpDir, 'delay_rot.prefab');
    fs.writeFileSync(pPath, prefabYaml);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath: pPath, id: 'delay_rot_test' });
    assert.equal(validateVfxRecipe(recipe).ok, true);
    const layer = recipe.layers[0];
    assert.equal(layer.delay, 2.15, 'extracts 2-space indented startDelay from ParticleSystem');
    assert.ok(recipe.duration >= 3.14, `recipe duration includes startDelay + life (${recipe.duration})`);
    const [vx, vy, vz] = layer.velocity.linear;
    assert.ok(Math.abs(vx - Math.SQRT1_2) < 0.01, `expected rotated local vx ~ 0.707, got ${vx}`);
    assert.ok(Math.abs(vy) < 0.01, `expected vy ~ 0, got ${vy}`);
    assert.ok(Math.abs(vz + Math.SQRT1_2) < 0.01, `expected rotated RHS vz ~ -0.707, got ${vz}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('high aspectY (17.5), static flipbook startFrame, and sortingOrder batching do not overflow or collide', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, maxAtlasParticles: 64, maxMeshVfx: 32 });
  try {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    vfx.setAtlas(tex, {
      smoke_8x8: [0.0, 0.0, 0.5, 0.5],
      beam: [0.5, 0.0, 1.0, 0.5],
    });
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'cage_aftermath_parity',
      duration: 2.0,
      loop: false,
      layers: [
        {
          name: 'trail_cage',
          kind: 'particle',
          renderMode: 'stretched',
          blend: 'alpha',
          sortingOrder: 25,
          sprite: 'beam',
          bursts: [{ time: 0, count: 1 }],
          life: 1.5,
          size: 0.42,
          sizeY: 7.35,
          aspectY: 17.5,
          velocity: { linear: [1, 0, 0] },
        },
        {
          name: 'clair_smoke',
          kind: 'particle',
          renderMode: 'billboard',
          blend: 'alpha',
          sortingOrder: 3,
          bursts: [{ time: 0, count: 4 }],
          life: 1.5,
          size: 6.0,
          pivot: [0, 0, -0.2],
          flipbook: {
            region: 'smoke_8x8',
            cols: 8,
            rows: 8,
            cycles: 0,
            startFrame: [0, 0.9999],
            blend: true,
          },
        },
      ],
    });
    vfx.playEffect('cage_aftermath_parity', { x: 0, y: 0, z: 0 });
    vfx.update(0.1);
    const sortedMeshes = scene.children.filter((c) => c.name === 'HGameVfxAtlasNormal' && c.geometry.instanceCount > 0);
    assert.equal(sortedMeshes.length, 2, 'distinct sortingOrders allocate distinct renderOrder channels');
    const cageMesh = sortedMeshes.find((m) => Math.abs(m.renderOrder - 20.25) < 1e-4);
    const smokeMesh = sortedMeshes.find((m) => Math.abs(m.renderOrder - 20.03) < 1e-4);
    assert.ok(cageMesh && smokeMesh && cageMesh.renderOrder > smokeMesh.renderOrder, 'trail_cage sortingOrder 25 renders after clair_smoke sortingOrder 3');
    const p5Cage = cageMesh.geometry.getAttribute('aAtlasP5').array;
    const decCageY = unpack2x12Pos(p5Cage[1], 64, 64);
    assert.ok(Math.abs(decCageY[1] - 17.5) < 0.05, `expected aspectY=17.5 preserved without overflow (got ${decCageY[1]})`);
  } finally {
    vfx.dispose();
  }
});

test('ConeVolume length distributes particles along +Y height and Rx(-90) ShapeModule points +Y upward', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-cone-vol-'));
  try {
    const prefabPath = path.join(tmpDir, 'ConeVolumeTest.prefab');
    fs.writeFileSync(
      prefabPath,
      [
        '%YAML 1.1',
        '--- !u!1 &100',
        'GameObject:',
        '  m_Name: Mana_Symbols',
        '  m_IsActive: 1',
        '--- !u!4 &200',
        'Transform:',
        '  m_GameObject: {fileID: 100}',
        '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
        '  m_LocalPosition: {x: 0, y: 0, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Children: []',
        '  m_Father: {fileID: 0}',
        '--- !u!198 &300',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 100}',
        '  lengthInSec: 3',
        '  simulationSpeed: 1',
        '  looping: 0',
        '  startDelay:',
        '    minMaxState: 0',
        '    scalar: 0',
        '  InitialModule:',
        '    enabled: 1',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 1.5',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 0.5',
        '    startRotation:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startColor:',
        '      minMaxState: 0',
        '      maxColor: {r: 1, g: 1, b: 1, a: 1}',
        '    gravityModifier:',
        '      minMaxState: 0',
        '      scalar: 0',
        '  EmissionModule:',
        '    enabled: 1',
        '    rateOverTime:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 32',
        '        minScalar: 32',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '  ShapeModule:',
        '    enabled: 1',
        '    type: 8',
        '    angle: 0',
        '    length: 3',
        '    radiusThickness: 1',
        '    m_Position: {x: 0, y: 0.84, z: 0}',
        '    m_Rotation: {x: -90, y: 0, z: 0}',
        '    m_Scale: {x: 1, y: 1, z: 1}',
        '    radius:',
        '      value: 2.6',
        '--- !u!199 &400',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 100}',
        '  m_Enabled: 1',
        '  m_RenderMode: 0',
        '  m_Materials:',
        '  - {fileID: 0}',
      ].join('\n'),
      'utf8',
    );
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'cone_vol_test' });
    assert.equal(recipe.layers.length, 1);
    assert.deepEqual(recipe.layers[0].offset, [0, 0.84, 0], 'ShapeModule.m_Position adds to layer.offset');
    const sh = recipe.layers[0].shape;
    assert.equal(sh.type, 'cone');
    assert.equal(sh.length, 3);
    assert.equal(sh.rotation, undefined, 'Rx(-90) ShapeModule in Unity maps to canonical +Y in HGame without 180 deg flip');

    const scene = new THREE.Scene();
    const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 64 });
    try {
      vfx.registerEffect(recipe);
      vfx.playEffect('cone_vol_test', { x: 0, y: 0, z: 0 });
      vfx.update(0.01);
      const poolMesh = scene.children.find((c) => (c.name === 'HGameVfxAtlasNormal' || c.name === 'HGameVfxAtlasAdditive') && c.geometry.instanceCount > 0);
      assert.ok(poolMesh && poolMesh.geometry.instanceCount === 32, 'spawned 32 cone volume particles');
      const p0 = poolMesh.geometry.getAttribute('aAtlasP0').array;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < 32; i++) {
        const y = p0[i * 4 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      assert.ok(minY >= 0.83 && maxY > 2.6 && maxY <= 3.89, `expected cone volume Y distributed in [0.84, 3.84], got [${minY}, ${maxY}]`);
      const runeVelCurve = [
        [0, 1],
        [0.167, 0.665],
        [0.333, 0.407],
        [0.5, 0.218],
        [0.667, 0.092],
        [0.833, 0.022],
        [1, 0],
      ];
      const vRow = vfx.atlasParticles.lut.compile(null, null, null, runeVelCurve);
      let prevDisp = vfx.atlasParticles.lut.sampleVelDisp(vRow, 0);
      for (let step = 1; step <= 100; step++) {
        const curDisp = vfx.atlasParticles.lut.sampleVelDisp(vRow, (step / 100) * 0.85);
        assert.ok(curDisp > prevDisp + 1e-4, `expected smooth monotonic 16-bit velDisp at step ${step}, got ${prevDisp} -> ${curDisp}`);
        prevDisp = curDisp;
      }
    } finally {
      vfx.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Shuriken upgrade parity: m_Flip/flipUV, SizeModule scalar & folding, 3D transformRot/align, rateCurve/burst probability, FPS flipbook, RandomColor & HDR folding', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-vfx-upgrade-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'tex.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'tex.png.meta'), 'fileFormatVersion: 2\nguid: 11111111111111111111111111111111\n');
    const matYaml = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: TestMat',
      '  m_Shader: {fileID: 4800000, guid: 7f11fe28133f1a74594785107b98f2fe, type: 3}',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      '        m_Texture: {fileID: 2800000, guid: 11111111111111111111111111111111, type: 3}',
      '    m_Floats:',
      '    - _Blend: 1',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'Test.mat'), matYaml);
    fs.writeFileSync(path.join(tmpDir, 'Test.mat.meta'), 'fileFormatVersion: 2\nguid: 22222222222222222222222222222222\n');

    const s45 = Math.SQRT1_2;
    const prefabYaml = [
      '%YAML 1.1',
      '--- !u!1 &100',
      'GameObject:\n  m_Name: Root\n  m_IsActive: 1',
      '--- !u!4 &101',
      'Transform:\n  m_GameObject: {fileID: 100}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 0}',
      '--- !u!1 &200',
      'GameObject:\n  m_Name: TiltedBillboardFlip\n  m_IsActive: 1',
      '--- !u!4 &201',
      `Transform:\n  m_GameObject: {fileID: 200}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0.382683, z: 0, w: 0.92388}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 101}`,
      '--- !u!198 &202',
      [
        'ParticleSystem:',
        '  m_GameObject: {fileID: 200}',
        '  lengthInSec: 2',
        '  looping: 0',
        '  InitialModule:',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startColor:',
        '      minMaxState: 0',
        '      maxColor: {r: 4, g: 1, b: 0.5, a: 1}',
        '  EmissionModule:',
        '    enabled: 1',
        '    rateOverTime:',
        '      minMaxState: 1',
        '      scalar: 20',
        '      maxCurve:',
        '        serializedVersion: 2',
        '        m_Curve:',
        '        - time: 0',
        '          value: 1',
        '        - time: 1',
        '          value: 0.5',
        '    m_BurstCount: 2',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 3',
        '        minScalar: 3',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '      probability: 1',
        '    - serializedVersion: 2',
        '      time: 0.1',
        '      countCurve:',
        '        minMaxState: 3',
        '        scalar: 10',
        '        minScalar: 0',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '      probability: 0',
        '  ShapeModule:',
        '    enabled: 0',
        '  SizeModule:',
        '    enabled: 1',
        '    separateAxes: 0',
        '    curve:',
        '      minMaxState: 1',
        '      scalar: 12',
        '      maxCurve:',
        '        serializedVersion: 2',
        '        m_Curve:',
        '        - time: 0',
        '          value: 0.5',
        '        - time: 1',
        '          value: 1',
        '  UVModule:',
        '    enabled: 1',
        '    tilesX: 4',
        '    tilesY: 2',
        '    timeMode: 2',
        '    fps: 16',
        '    flipU: 1',
        '    flipV: 0',
      ].join('\n'),
      '--- !u!199 &203',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 200}\n  m_Enabled: 1\n  m_RenderMode: 0\n  m_RenderAlignment: 2\n  m_Flip: {x: 0, y: 1, z: 0}\n  m_Materials:\n  - {fileID: 2100000, guid: 22222222222222222222222222222222, type: 2}',
      '--- !u!1 &300',
      'GameObject:\n  m_Name: MeshTransformFlipVel\n  m_IsActive: 1',
      '--- !u!4 &301',
      `Transform:\n  m_GameObject: {fileID: 300}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: -${s45.toFixed(6)}, w: ${s45.toFixed(6)}}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 101}`,
      '--- !u!198 &302',
      [
        'ParticleSystem:',
        '  m_GameObject: {fileID: 300}',
        '  lengthInSec: 1',
        '  looping: 0',
        '  InitialModule:',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startColor:',
        '      minMaxState: 4',
        '      maxGradient:',
        '        key0: {r: 1, g: 0, b: 0, a: 1}',
        '        key1: {r: 0, g: 0, b: 1, a: 1}',
        '        ctime0: 0',
        '        ctime1: 65535',
        '        atime0: 0',
        '        atime1: 65535',
        '        m_NumColorKeys: 2',
        '        m_NumAlphaKeys: 2',
        '  EmissionModule:',
        '    enabled: 1',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 1',
        '        minScalar: 1',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '      probability: 1',
        '  ShapeModule:',
        '    enabled: 0',
      ].join('\n'),
      '--- !u!199 &303',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 300}\n  m_Enabled: 1\n  m_RenderMode: 4\n  m_RenderAlignment: 2\n  m_Mesh: {fileID: 10210, guid: 0000000000000000e000000000000000, type: 0}\n  m_Flip: {x: 1, y: 0, z: 0}\n  m_Materials:\n  - {fileID: 2100000, guid: 22222222222222222222222222222222, type: 2}',
    ].join('\n');

    const pPath = path.join(tmpDir, 'upgrade.prefab');
    fs.writeFileSync(pPath, prefabYaml);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath: pPath, id: 'upgrade_test' });
    assert.equal(validateVfxRecipe(recipe).ok, true, 'upgraded recipe validates');
    assert.equal(recipe.layers.length, 2);

    const bLayer = recipe.layers[0];
    assert.equal(bLayer.renderMode, 'vertical', 'tilted Local-aligned Billboard locks to vertical 3D euler orientation');
    assert.ok(Math.abs(bLayer.rotY + Math.PI * 0.25) < 0.02, `expected RHS Ry ~ -pi/4, got ${bLayer.rotY}`);
    assert.deepEqual(bLayer.flip, [1, 1, 0], 'combines UVModule.flipU and m_Flip.y');
    assert.ok(bLayer.hdr > 3.9, `HDR maxColor folded into layer.hdr (${bLayer.hdr})`);
    assert.ok(bLayer.colorCurve.every(([, c]) => c[0] <= 1.001 && c[1] <= 1.001 && c[2] <= 1.001), 'colorCurve normalized <= 1.0');
    assert.ok(bLayer.size > 1.5, `SizeModule peak > 7.8 folded into layer.size (${bLayer.size})`);
    assert.ok(Math.max(...bLayer.sizeCurve.map((k) => k[1])) <= 7.51, 'folded sizeCurve stays within 8.0 LUT ceiling');
    assert.ok(Array.isArray(bLayer.rateCurve) && bLayer.rateCurve.length === 2, 'rateOverTime curve extracted');
    assert.equal(bLayer.bursts[1].probability, 0, 'burst probability extracted');
    assert.deepEqual(bLayer.bursts[1].count, [0, 10], 'minScalar: 0 random burst preserved');
    assert.equal(bLayer.flipbook.fps, 16, 'UVModule timeMode 2 fps extracted');

    const mLayer = recipe.layers[1];
    assert.equal(mLayer.renderMode, 'mesh');
    assert.ok(Array.isArray(mLayer.transformRot) && Math.abs(mLayer.transformRot[2] + s45) < 0.01, 'full 3D Z transformRot preserved');
    assert.deepEqual(mLayer.flip, [1, 0, 0], 'mesh m_Flip preserved');
    assert.ok(Array.isArray(mLayer.startColor) && Array.isArray(mLayer.startColor[0]) && Array.isArray(mLayer.startColor[0][1]), 'RandomColor gradient extracted');

    const scene = new THREE.Scene();
    const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 64, maxMeshVfx: 16 });
    try {
      const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
      vfx.setAtlas(tex, { flipbook: [0, 0, 1, 1] });
      vfx.registerEffect(recipe);
      vfx.playEffect('upgrade_test', { x: 0, y: 0, z: 0 });
      vfx.update(0.11);

      const poolMesh = scene.children.find((c) => c.name?.startsWith('HGameVfxAtlas') && c.geometry?.instanceCount > 0);
      assert.ok(poolMesh, `atlas particles emitted (${scene.children.map((c) => `${c.name}:${c.geometry?.instanceCount ?? c.count}`).join(',')})`);
      const p2 = poolMesh.geometry.getAttribute('aAtlasP2').array;
      const matFlags = Math.floor(p2[3] / 1048576.0);
      assert.equal((matFlags & 12), 12, `expected flipX (4) + flipY (8) in materialFlags, got ${matFlags}`);

      let meshNode = null;
      scene.traverse((c) => {
        if (!meshNode && c.isMesh && c.visible && c.name?.startsWith('HGameVfxMesh')) {
          if (c.geometry?.isInstancedBufferGeometry) {
            if (c.geometry.instanceCount > 0) meshNode = c;
          } else {
            meshNode = c;
          }
        }
      });
      assert.ok(meshNode, 'mesh particle spawned and visible');
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      if (meshNode.geometry?.isInstancedBufferGeometry) {
        const ps = meshNode.geometry.getAttribute('aInstPosScale').array;
        const qt = meshNode.geometry.getAttribute('aInstQuat').array;
        const si = meshNode.geometry.getAttribute('aInstScaleInfo').array;
        sc.set(ps[3], si[0], si[1]);
        q.set(qt[0], qt[1], qt[2], qt[3]);
        assert.ok(si[3] >= 1.5, `expected odd reflection winding flag in aInstScaleInfo.w, got ${si[3]}`);
      } else {
        q.copy(meshNode.quaternion);
        sc.copy(meshNode.scale);
      }
      assert.ok(sc.x < 0, `expected negative mirrored X scale on m_Flip.x mesh, got ${sc.x}`);
      const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      assert.ok(Math.abs(xAxis.y + 1) < 0.05, `expected Rz(-90) transformRot mapping local +X to -Y, got (${xAxis.x.toFixed(2)}, ${xAxis.y.toFixed(2)}, ${xAxis.z.toFixed(2)})`);
    } finally {
      vfx.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ShapeModule arc.mode=3 (burst-spread) distributes burst particles uniformly around circle', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 64 });
  try {
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'burst_spread_test',
      duration: 1.0,
      loop: false,
      layers: [{
        name: 'ring',
        kind: 'particle',
        renderMode: 'horizontal',
        shape: { type: 'circle', radius: 2.0, shell: true, arc: 360, arcMode: 'burst-spread' },
        bursts: [{ time: 0, count: 7 }],
        life: 1.0,
        size: 0.5,
        speed: 0,
      }],
    });
    vfx.playEffect('burst_spread_test', { x: 0, y: 0, z: 0 });
    vfx.update(0.01);
    const poolMesh = scene.children.find((c) => c.name?.startsWith('HGameVfxAtlas') && c.geometry?.instanceCount === 7);
    assert.ok(poolMesh, 'emits all 7 evenly-spaced burst particles');
    const p0 = poolMesh.geometry.getAttribute('aAtlasP0').array;
    const angles = [];
    for (let i = 0; i < 7; i++) {
      angles.push(Math.atan2(p0[i * 4 + 2], p0[i * 4]));
    }
    angles.sort((a, b) => a - b);
    const step = (Math.PI * 2) / 7;
    for (let i = 0; i < 6; i++) {
      assert.ok(Math.abs((angles[i + 1] - angles[i]) - step) < 0.02, `expected uniform angular gap ${step.toFixed(3)}, got ${(angles[i + 1] - angles[i]).toFixed(3)}`);
    }
  } finally {
    vfx.dispose();
  }
});

test('Uber Material LUT expands to 1024 rows, dirty-checks repacks, and shares vfxFinalizeOutput + lazy guards', () => {
  assert.equal(UBER_MAT_LUT_ROWS, 1024);

  const lut = createUberMaterialLut(THREE);
  assert.equal(lut.height, 1024);
  let dirtySets = 0;
  let needsVal = false;
  Object.defineProperty(lut.texture, 'needsUpdate', {
    get() { return needsVal; },
    set(v) {
      needsVal = Boolean(v);
      if (v) dirtySets += 1;
    },
  });

  const spec = createUberMaterialSpec('glow', { mainTexKey: 'spark', whiteColor: [2, 1, 0.5, 1] });
  const regions = { spark: [0.1, 0.2, 0.5, 0.6] };
  const rowA = lut.allocateRow('spark_glow', spec, regions);
  assert.equal(rowA, 0);
  assert.equal(dirtySets, 1);

  needsVal = false;
  const rowRepeat = lut.allocateRow('spark_glow', spec, regions);
  assert.equal(rowRepeat, 0);
  assert.equal(dirtySets, 1, 'identical repack must not re-mark texture dirty');

  lut.allocateRow('spark_glow', { ...spec, desaturate: 0.45 }, regions);
  assert.equal(dirtySets, 2, 'mutated repack marks texture dirty');
  lut.dispose();

  assert.ok(VFX_COMMON_GLSL.includes('vec4 vfxFinalizeOutput('));
  assert.ok(ATLAS_PARTICLE_FRAGMENT_GLSL.includes('vfxFinalizeOutput('));
  assert.ok(VFX_MESH_INSTANCED_FS.includes('vfxFinalizeOutput('));
  assert.ok(RIBBON_FRAGMENT_GLSL.includes('vfxFinalizeOutput('));
  for (const guard of ['bool useRamp', 'bool useErosion', 'bool useAlphaOv', 'bool useFresnel', 'bool hasDetTex', 'bool hasOrmTex']) {
    assert.ok(VFX_UBER_FRAGMENT_GLSL.includes(guard), `expected lazy LUT guard "${guard}" in VFX_UBER_FRAGMENT_GLSL`);
  }
});

test('defineVfxRecipe, createUberMaterialSpec presets, and loadVfxPack register atlas, __sub_ meshes, and recipes', async () => {
  assert.deepEqual(Object.keys(VFX_MATERIAL_PRESETS).sort(), ['dissolve', 'glow', 'pbr', 'ribbon', 'smoke', 'warp']);

  const recipe = defineVfxRecipe({
    id: 'hand_slash_fx',
    layers: [
      {
        name: 'glow_core',
        region: 'spark',
        uberMat: 'glow',
      },
    ],
  });
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.layers[0].uberMat.shaderKind, 'uber_fx');
  assert.equal(recipe.layers[0].uberMat.blend, 'additive');
  assert.throws(() => defineVfxRecipe({ id: '', layers: [] }), /Invalid VFX recipe/);

  const registeredMeshes = new Map();
  const registeredEffects = [];
  let atlasArgs = null;
  const mockVfx = {
    setAtlas(tex, regions, opts) { atlasArgs = { tex, regions, opts }; },
    registerMesh(name, geo) { registeredMeshes.set(name, geo); return true; },
    registerEffect(rec) { registeredEffects.push(rec); return true; },
  };

  const geo1 = new THREE.BoxGeometry(1, 1, 1);
  const geo2 = new THREE.SphereGeometry(0.5, 8, 6);
  const m1 = new THREE.Mesh(geo1); m1.name = 'SkelBone_1';
  const m2 = new THREE.Mesh(geo2); m2.name = 'SkelBone_2';
  const glbScene = new THREE.Group();
  glbScene.add(m1, m2);

  const mockFiles = {
    'https://example.test/pack/vfx-pack.manifest.json': {
      schemaVersion: 1,
      atlas: 'atlas.png',
      regions: 'atlas_regions.json',
      meshes: ['meshes/bones_1.glb'],
      aliases: {
        bones_1__sub_skelbone_1: 'meshes/bones_1.glb',
        bones_1__sub_skelbone_2: 'meshes/bones_1.glb',
      },
      recipes: [{ id: 'hand_slash_fx', file: 'recipes/hand_slash_fx.vfx.json' }],
    },
    'https://example.test/pack/atlas_regions.json': {
      spark: [0, 0, 0.5, 0.5],
      smoke: [0.5, 0, 1, 0.5],
    },
    'https://example.test/pack/recipes/hand_slash_fx.vfx.json': recipe,
  };

  let glbLoadCount = 0;
  const res = await loadVfxPack(mockVfx, 'https://example.test/pack/vfx-pack.manifest.json', {
    THREE: null,
    fetchFn: async (url) => {
      if (!(url in mockFiles)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => mockFiles[url] };
    },
    gltfLoader: {
      async loadAsync(url) {
        assert.equal(url, 'https://example.test/pack/meshes/bones_1.glb');
        glbLoadCount += 1;
        return { scene: glbScene };
      },
    },
  });

  assert.equal(glbLoadCount, 1, 'caches shared .glb across __sub_ aliases');
  assert.equal(res.regionCount, 2);
  assert.equal(res.meshCount, 2);
  assert.deepEqual(res.recipeIds, ['hand_slash_fx']);
  assert.equal(registeredMeshes.get('bones_1__sub_skelbone_1'), geo1);
  assert.equal(registeredMeshes.get('bones_1__sub_skelbone_2'), geo2);
  assert.equal(atlasArgs.opts.flipV, true);
  assert.equal(registeredEffects.length, 1);
  geo1.dispose();
  geo2.dispose();
});

test('mesh layers support trails, collision lifetimeLoss kills & triggers death subEmitters, and negative velCurve aligns velocity', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, maxMeshVfx: 32, trailNodes: 16 });
  vfx.registerMesh('spike_test', new THREE.ConeGeometry(0.1, 0.5, 6));

  let deathSpawned = false;
  vfx.registerEffect({
    schemaVersion: 1,
    id: 'mesh_rain_collision_test',
    loop: false,
    duration: 2.0,
    layers: [
      {
        name: 'rain_mesh',
        kind: 'mesh',
        renderMode: 'mesh',
        mesh: 'spike_test',
        alignToVelocity: true,
        forwardAxis: 'z',
        rotX: -Math.PI / 2,
        offset: [0, 1.0, 0],
        life: 2.0,
        speed: 0,
        size: 1.0,
        bursts: [{ time: 0, count: 1 }],
        velocity: { linear: [0, 5, 0] },
        velCurve: [[0, -1], [1, -1]],
        trail: { mode: 'particles', lifetime: 0.2, lifetimeMode: 'seconds', width: 0.1 },
        collision: { groundY: 0, bounce: 0, dampen: 0, maxBounces: 1, lifetimeLoss: 1 },
        subEmitters: [
          {
            trigger: 'death',
            effect: {
              schemaVersion: 1,
              id: 'rain_death_burst',
              loop: false,
              duration: 0.5,
              layers: [
                {
                  name: 'impact_spark',
                  kind: 'particle',
                  renderMode: 'billboard',
                  bursts: [{ time: 0, count: 3 }],
                  life: 0.4,
                  size: 0.5,
                  speed: 0,
                },
              ],
            },
          },
        ],
      },
    ],
  });

  vfx.playEffect('mesh_rain_collision_test', { x: 0, y: 0, z: 0 });
  // Step 0.1s: particle moves downward from y=1.0 at vy=-5 -> y=0.5, active mesh=1, active trail=1
  vfx.update(0.1);
  const posMid = new Float32Array(3);
  const velMid = new Float32Array(3);
  vfx.meshVfx.readSlotMotion(0, posMid, velMid);
  assert.ok(posMid[1] > 0.35 && posMid[1] < 0.65, `staticPos avoids double integration (y=${posMid[1]})`);
  assert.equal(vfx.meshVfx.getStats().activeCount, 1, 'mesh particle active before collision');
  assert.equal(vfx.trails.getStats().activeTrails, 1, 'mesh layer spawned attached trail');

  // Step 0.2s more (total 0.3s): crosses groundY=0 -> lifetimeLoss=1 kills mesh & trail and spawns death subEmitter
  vfx.update(0.1);
  vfx.update(0.1);
  const st = vfx.getStats();
  assert.equal(st.meshVfx.activeCount, 0, 'collision lifetimeLoss=1 kills mesh particle on impact');
  assert.equal(st.trails.activeTrails, 0, 'attached trail stops when colliding particle dies');
  deathSpawned = st.atlasParticles.additiveTotal > 0 || st.atlasParticles.normalTotal > 0;
  assert.equal(deathSpawned, true, 'death subEmitter fires upon collision kill');

  vfx.dispose();
});

test('cullMode=front sets UBER_FLAG_CULL_FRONT without double-counting isOddFlip in VFX_MESH_INSTANCED_VS', () => {
  const row = new Float32Array(UBER_MAT_LUT_WIDTH * 4);
  const packed = packUberMaterialRow(row, 0, { cullMode: 'front', blend: 'additive' });
  assert.equal(packed, true, 'packUberMaterialRow writes valid LUT row');
  const packedFlags = row[1];
  assert.notEqual(packedFlags & UBER_FLAG_CULL_FRONT, 0, 'packUberMaterialRow packs UBER_FLAG_CULL_FRONT for cullMode=front');
  assert.ok(VFX_UBER_FRAGMENT_GLSL.includes('UBER_FLAG_CULL_FRONT') || VFX_UBER_FRAGMENT_GLSL.includes(UBER_FLAG_CULL_FRONT.toFixed(1)),
    'VFX_UBER_FRAGMENT_GLSL checks UBER_FLAG_CULL_FRONT');
  assert.ok(VFX_UBER_FRAGMENT_GLSL.includes('cullFront ? isFrontFacing : !isFrontFacing'),
    'VFX_UBER_FRAGMENT_GLSL discards front faces when cullFront is active');
  assert.ok(VFX_MESH_INSTANCED_VS.includes('vFlipLocalV = aInstScaleInfo.w;'),
    'VFX_MESH_INSTANCED_VS forwards aInstScaleInfo.w without double-adding isOddFlip');
  assert.ok(!VFX_MESH_INSTANCED_VS.includes('vFlipLocalV = aInstScaleInfo.w + isOddFlip'),
    'VFX_MESH_INSTANCED_VS must not double-add isOddFlip');
});

test('mesh layer aspectY and aspectZ propagate into non-uniform mesh instance scale and setSceneTexture preserves depth viewport', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 32, maxAtlasParticles: 32 });
  try {
    const depthTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    const sceneTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    vfx.setDepthTexture(depthTex, { near: 0.2, far: 120, width: 960, height: 540, softFade: 0.45 });
    // Calling setSceneTexture(null) without width/height (like prepareDistortionBeforeWorld) must keep 960x540
    vfx.setSceneTexture(null);

    vfx.registerEffect({
      schemaVersion: 1,
      id: 'mesh_aspect_viewport_test',
      duration: 1.0,
      loop: false,
      layers: [{
        name: 'billar_ring',
        kind: 'mesh',
        mesh: 'quad',
        blend: 'additive',
        cullMode: 'front',
        uberMat: createUberMaterialSpec('glow', { cullMode: 'front' }),
        life: 1.0,
        size: 3.0,
        aspectY: 0.56,
        aspectZ: 0.97,
        speed: 0,
        bursts: [{ time: 0, count: 1 }],
      }],
    });
    vfx.playEffect('mesh_aspect_viewport_test', { x: 0, y: 0, z: 0 });
    vfx.update(0.05);

    const meshNode = scene.children.find((c) => c.name?.startsWith('HGameVfxMeshInst_') && c.visible);
    assert.ok(meshNode, 'instanced mesh batch spawned');
    assert.equal(meshNode.material.side, THREE.DoubleSide, 'UBER_FX batch uses DoubleSide for shader-level per-instance cullMode');
    const invVp = meshNode.material.uniforms.uInvViewport.value;
    assert.ok(Math.abs(invVp.x - 1 / 960) < 1e-6 && Math.abs(invVp.y - 1 / 540) < 1e-6,
      `expected uInvViewport to stay [1/960, 1/540] after setSceneTexture(null), got [${invVp.x}, ${invVp.y}]`);

    const si = meshNode.geometry.getAttribute('aInstScaleInfo').array;
    const ps = meshNode.geometry.getAttribute('aInstPosScale').array;
    assert.ok(Math.abs(ps[3] - 3.0) < 0.05, `expected scaleX ~ 3.0, got ${ps[3]}`);
    assert.ok(Math.abs(si[0] - 3.0 * 0.56) < 0.05, `expected scaleY ~ 1.68 via aspectY, got ${si[0]}`);
    assert.ok(Math.abs(si[1] - 3.0 * 0.97) < 0.05, `expected scaleZ ~ 2.91 via aspectZ, got ${si[1]}`);

    vfx.setSceneTexture(sceneTex, { width: 640, height: 360 });
    assert.ok(Math.abs(invVp.x - 1 / 640) < 1e-6 && Math.abs(invVp.y - 1 / 360) < 1e-6,
      'explicit dimensions on setSceneTexture still update uInvViewport');
  } finally {
    vfx.dispose();
  }
});

test('convertUnityPrefab preserves non-uniform parent scale on mesh, ignores null CollisionModule planes, and skips burstless sub-emitters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-deathice-guards-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'tex.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'tex.png.meta'), 'fileFormatVersion: 2\nguid: 11111111111111111111111111111111\n');
    const matYaml = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: TestMat',
      '  m_Shader: {fileID: 4800000, guid: 7f11fe28133f1a74594785107b98f2fe, type: 3}',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      '        m_Texture: {fileID: 2800000, guid: 11111111111111111111111111111111, type: 3}',
      '    m_Floats:',
      '    - _Blend: 1',
      '    - _Cull: 1',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'Test.mat'), matYaml);
    fs.writeFileSync(path.join(tmpDir, 'Test.mat.meta'), 'fileFormatVersion: 2\nguid: 22222222222222222222222222222222\n');
    const prefabYaml = [
      '%YAML 1.1',
      '--- !u!1 &100',
      'GameObject:\n  m_Name: Root\n  m_IsActive: 1',
      '--- !u!4 &101',
      'Transform:\n  m_GameObject: {fileID: 100}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 0}',
      '--- !u!1 &200',
      'GameObject:\n  m_Name: NonUniformParent\n  m_IsActive: 1',
      '--- !u!4 &201',
      'Transform:\n  m_GameObject: {fileID: 200}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 0.5, z: 1}\n  m_Father: {fileID: 101}',
      '--- !u!198 &202',
      'ParticleSystem:\n  m_GameObject: {fileID: 200}\n  lengthInSec: 1\n  looping: 0\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n    startSpeed:\n      minMaxState: 0\n      scalar: 0\n    startSize:\n      minMaxState: 0\n      scalar: 2\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 0\n    m_Bursts:\n    - time: 0\n      countCurve:\n        scalar: 1\n  ShapeModule:\n    enabled: 0\n  CollisionModule:\n    enabled: 1\n    type: 0\n    m_Planes:\n    - {fileID: 0}\n  SubModule:\n    enabled: 1\n    subEmitters:\n    - emitter: {fileID: 302}\n      type: 2\n      properties: 0',
      '--- !u!199 &203',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 200}\n  m_Enabled: 1\n  m_RenderMode: 4\n  m_Mesh: {fileID: 10210, guid: 0000000000000000e000000000000000, type: 0}\n  m_Materials:\n  - {fileID: 2100000, guid: 22222222222222222222222222222222, type: 2}',
      '--- !u!1 &300',
      'GameObject:\n  m_Name: BurstlessSub\n  m_IsActive: 1',
      '--- !u!4 &301',
      'Transform:\n  m_GameObject: {fileID: 300}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 201}',
      '--- !u!198 &302',
      'ParticleSystem:\n  m_GameObject: {fileID: 300}\n  lengthInSec: 1\n  looping: 0\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n    startSpeed:\n      minMaxState: 0\n      scalar: 0\n    startSize:\n      minMaxState: 0\n      scalar: 1\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 250\n    m_Bursts: []\n  ShapeModule:\n    enabled: 0',
      '--- !u!199 &303',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 300}\n  m_Enabled: 1\n  m_RenderMode: 0\n  m_Materials:\n  - {fileID: 2100000, guid: 22222222222222222222222222222222, type: 2}',
    ].join('\n');
    const pPath = path.join(tmpDir, 'guards.prefab');
    fs.writeFileSync(pPath, prefabYaml);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath: pPath, id: 'guards_test' });
    assert.equal(validateVfxRecipe(recipe).ok, true);
    const layer = recipe.layers[0];
    assert.equal(layer.cullMode, 'front', 'maps _Cull: 1 to front');
    assert.ok(Math.abs(layer.size - 2.0) < 0.01 && Math.abs(layer.aspectY - 0.5) < 0.01,
      `preserves non-uniform scale (size=${layer.size}, aspectY=${layer.aspectY})`);
    assert.equal(layer.collision, undefined, 'skips CollisionModule type=0 with only {fileID: 0} planes');
    assert.equal(layer.subEmitters, undefined, 'skips sub-emitter that has only rateOverTime and no bursts');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('convertUnityPrefab suppresses stale _ALPHATEST_ON on Transparent+Additive uber_fx and emits radialOffset when ShapeModule offsets position', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-icicle-guards-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'trail.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'trail.png.meta'), 'fileFormatVersion: 2\nguid: 33333333333333333333333333333333\n');
    const matYaml = [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: TrailAdd',
      '  m_Shader: {fileID: 4800000, guid: 7f11fe28133f1a74594785107b98f2fe, type: 3}',
      '  m_ValidKeywords:',
      '  - _ALPHATEST_ON',
      '  - _SURFACE_TYPE_TRANSPARENT',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      '        m_Texture: {fileID: 2800000, guid: 33333333333333333333333333333333, type: 3}',
      '    m_Floats:',
      '    - _Alpha_Clip_Threshold: 0.5',
      '    - _Blend: 2',
      '    - _Surface: 1',
      '    - _Cull: 2',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'TrailAdd.mat'), matYaml);
    fs.writeFileSync(path.join(tmpDir, 'TrailAdd.mat.meta'), 'fileFormatVersion: 2\nguid: 44444444444444444444444444444444\n');
    const prefabYaml = [
      '%YAML 1.1',
      '--- !u!1 &100',
      'GameObject:\n  m_Name: Root\n  m_IsActive: 1',
      '--- !u!4 &101',
      'Transform:\n  m_GameObject: {fileID: 100}\n  m_LocalPosition: {x: 0, y: 0, z: 0}\n  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}\n  m_LocalScale: {x: 1, y: 1, z: 1}\n  m_Father: {fileID: 0}',
      '--- !u!198 &102',
      'ParticleSystem:\n  m_GameObject: {fileID: 100}\n  lengthInSec: 1\n  looping: 0\n  InitialModule:\n    startLifetime:\n      minMaxState: 0\n      scalar: 1\n    startSpeed:\n      minMaxState: 0\n      scalar: 0\n    startSize:\n      minMaxState: 0\n      scalar: 1\n  EmissionModule:\n    enabled: 1\n    rateOverTime:\n      minMaxState: 0\n      scalar: 0\n    m_Bursts:\n    - time: 0\n      countCurve:\n        scalar: 1\n  ShapeModule:\n    enabled: 1\n    type: 10\n    radius:\n      value: 1\n    m_Position: {x: 0, y: 2, z: 0}\n  VelocityModule:\n    enabled: 1\n    radial:\n      minMaxState: 0\n      scalar: 10',
      '--- !u!199 &103',
      'ParticleSystemRenderer:\n  m_GameObject: {fileID: 100}\n  m_Enabled: 1\n  m_RenderMode: 0\n  m_Materials:\n  - {fileID: 2100000, guid: 44444444444444444444444444444444, type: 2}',
    ].join('\n');
    const pPath = path.join(tmpDir, 'radial_trail.prefab');
    fs.writeFileSync(pPath, prefabYaml);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath: pPath, id: 'radial_trail_test' });
    assert.equal(validateVfxRecipe(recipe).ok, true);
    const layer = recipe.layers[0];
    assert.deepEqual(layer.offset, [0, 2, 0], 'preserves ShapeModule.m_Position in layer.offset');
    assert.deepEqual(layer.velocity.radialOffset, [0, -2, 0], 'cancels ShapeModule.m_Position in radialOrigin');
    assert.equal(layer.uberMat.alphaTest, false, 'clears alphaTest on Transparent+Additive uber_fx');
    assert.equal(layer.uberMat.keywords.includes('_ALPHATEST_ON'), false, 'strips stale _ALPHATEST_ON keyword');

    const row = new Float32Array(UBER_MAT_LUT_WIDTH * 4);
    packUberMaterialRow(row, 0, layer.uberMat, null);
    assert.equal((Math.round(row[1]) & UBER_FLAG_ALPHA_TEST), 0, 'LUT flags omit UBER_FLAG_ALPHA_TEST');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mesh layer velCurve Euler tracks ribbon follower with sub-steps and keeps additive head alpha nonzero', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, trailNodes: 24 });
  const boxGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  try {
    vfx.registerMesh('test_box', boxGeo);
    const recipe = defineVfxRecipe({
      id: 'mesh_velcurve_trail',
      duration: 1.0,
      layers: [{
        kind: 'mesh',
        renderMode: 'mesh',
        bursts: [{ time: 0, count: 1 }],
        life: 0.5,
        size: 0.5,
        offset: [0, 2, 0],
        shape: { type: 'circle', radius: 0.01 },
        velocity: { radial: 8, radialOffset: [0, -2, 0] },
        velCurve: [[0, 0], [0.2, -1], [1, -1]],
        mesh: 'test_box',
        trail: {
          mode: 'particles',
          lifetime: 0.2,
          lifetimeMode: 'fraction',
          blend: 'additive',
          width: 0.2,
          alpha: 0.25,
          sizeAffectsWidth: false,
        },
      }],
    });
    vfx.registerEffect(recipe);
    vfx.playEffect('mesh_velcurve_trail', { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 7; i++) vfx.update(1 / 30);

    let ribbonMesh = null;
    scene.traverse((obj) => {
      if (obj.name === 'HGameVfxRibbonTrails') ribbonMesh = obj;
    });
    assert.ok(ribbonMesh, 'expected HGameVfxRibbonTrails mesh in scene');
    const aA = ribbonMesh.geometry.getAttribute('aSegA').array;
    const aB = ribbonMesh.geometry.getAttribute('aSegB').array;
    const aMeta = ribbonMesh.geometry.getAttribute('aSegMeta').array;

    const headA = aMeta[2];
    assert.ok(headA > 0.2, `expected additive trail head alpha > 0.2 (no headFade(0)=0), got ${headA}`);

    let dySum = 0;
    let activeSegs = 0;
    for (let s = 0; s < 23; s++) {
      const i4 = s * 4;
      if (aMeta[i4 + 1] <= 0) break;
      activeSegs++;
      dySum += aB[i4 + 1] - aA[i4 + 1];
    }
    assert.ok(activeSegs >= 3, `expected >= 3 sub-stepped ribbon segments along fast fall, got ${activeSegs}`);
    assert.ok(dySum > 0.3, `expected negative velCurve + radialOffset to drop particle downward so tail is above head (dySum=${dySum})`);
  } finally {
    boxGeo.dispose();
    vfx.dispose();
  }
});

test('mesh dynamicRadial converges particles into radialOffset origin without underground overshoot and spawns death subEmitters at ground', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  const boxGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  try {
    vfx.registerMesh('test_icicle', boxGeo);
    const recipe = defineVfxRecipe({
      id: 'icicle_converge_test',
      duration: 1.0,
      layers: [{
        kind: 'mesh',
        renderMode: 'mesh',
        bursts: [{ time: 0, count: 1 }],
        life: 0.5,
        size: 0.2,
        offset: [0, 2.07, 0],
        shape: { type: 'circle', radius: 1.5, shell: true },
        velocity: { linear: [0, 5, 0], radial: 10, radialOffset: [0, -2, 0] },
        velCurve: [[0.41, 0], [0.548, -1]],
        mesh: 'test_icicle',
        subEmitters: [{
          trigger: 'death',
          effect: {
            schemaVersion: 1,
            id: 'impact_ring',
            loop: false,
            duration: 0.5,
            layers: [{
              kind: 'mesh',
              renderMode: 'mesh',
              bursts: [{ time: 0, count: 1 }],
              life: 0.5,
              speed: 0,
              size: 1.0,
              mesh: 'test_icicle',
            }],
          },
        }],
      }],
    });
    vfx.registerEffect(recipe);
    vfx.playEffect('icicle_converge_test', { x: 0, y: 0, z: 0 });
    const pos = new Float32Array(3);
    const vel = new Float32Array(3);
    for (let i = 0; i < 14; i++) vfx.update(1 / 30);
    vfx.meshVfx.readSlotMotion(0, pos, vel);
    assert.ok(pos[1] > -0.25 && pos[1] < 0.25, `expected dynamicRadial to settle near ground origin y=0.07, got y=${pos[1]}`);
    assert.ok(Math.hypot(pos[0], pos[2]) < 0.3, `expected dynamicRadial to converge toward XZ center, got (${pos[0]}, ${pos[2]})`);
    // Step past life=0.5s so death subEmitter spawns at ground impact position
    for (let i = 0; i < 3; i++) vfx.update(1 / 30);
    const impactPos = new Float32Array(3);
    vfx.meshVfx.readSlotMotion(0, impactPos, vel);
    assert.ok(impactPos[1] > -0.25 && impactPos[1] < 0.25, `expected death subEmitter at ground y ~ 0, got y=${impactPos[1]}`);
  } finally {
    boxGeo.dispose();
    vfx.dispose();
  }
});

test('atlas shaders add pivot offset positively, use subtle minBill floor, clamp bloom fireflies, and subdivide Unity sRGB gradients', async () => {
  const { ATLAS_PARTICLE_VERTEX_GLSL, ATLAS_PARTICLE_WEBGL2_2D_VS } = await import('../assets/runtime/vfx/vfx-atlas-particles.js');
  const { BLOOM_PREFILTER_FRAGMENT_GLSL3 } = await import('../assets/runtime/integrations/post3d/shaders.js');
  const { convertUnityPrefab } = await import('../scripts/import-unity-vfx.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  assert.match(ATLAS_PARTICLE_VERTEX_GLSL, /vec2 posLocal = position\.xy \+ pivotPair;/, '3D billboard/vertical/horizontal particles offset +pivot matching Unity ParticleSystemRenderer.pivot');
  assert.match(ATLAS_PARTICLE_VERTEX_GLSL, /float stretchX = \(posLocal\.x - pivotPair\.x\) - 0\.5 \+ pivotPair\.y;/, 'stretched mode preserves original stretch pivot convention');
  assert.match(ATLAS_PARTICLE_VERTEX_GLSL, /abs\(mvCenter\.z\) \* 0\.0010/, 'minBill keeps tiny micro-sparks from blowing up in world/bloom size');
  assert.match(ATLAS_PARTICLE_WEBGL2_2D_VS, /vec2 posLocal = aQuadPos \+ pivotPair;/, '2D atlas particles offset +pivot consistently');
  assert.match(BLOOM_PREFILTER_FRAGMENT_GLSL3, /if \(pk > 4\.0\) c \*= 4\.0 \/ pk;/, 'bloom prefilter clamps extreme HDR spark fireflies');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-srgb-grad-'));
  try {
    const prefabPath = path.join(tmpDir, 'GradFx.prefab');
    fs.writeFileSync(prefabPath, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: SrgbSparks
--- !u!4 &200
Transform:
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 0}
--- !u!198 &300
ParticleSystem:
  m_GameObject: {fileID: 100}
  lengthInSec: 1
  InitialModule:
    enabled: 1
    startLifetime:
      scalar: 1
    startSize:
      scalar: 0.05
    startSpeed:
      scalar: 0
    startColor:
      minMaxState: 0
      maxColor: {r: 1, g: 1, b: 1, a: 1}
  EmissionModule:
    enabled: 1
    rateOverTime:
      scalar: 10
  ColorModule:
    enabled: 1
    gradient:
      maxGradient:
        key0: {r: 1, g: 0.6, b: 0, a: 1}
        key1: {r: 0, g: 0, b: 0.2, a: 1}
        ctime0: 0
        ctime1: 65535
        atime0: 0
        atime1: 65535
        m_ColorSpace: 0
        m_NumColorKeys: 2
        m_NumAlphaKeys: 2
--- !u!199 &400
ParticleSystemRenderer:
  m_GameObject: {fileID: 100}
  m_RenderMode: 0
`);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'srgb_grad_fx' });
    const curve = recipe.layers[0].colorCurve;
    assert.ok(curve.length >= 4, `wide Gamma gradient should subdivide intermediate sRGB->Linear stops, got ${curve.length}`);
    const mid = curve.find(([t]) => Math.abs(t - 0.6) < 0.05);
    assert.ok(mid, 'expected intermediate stop near t=0.6');
    // sRGB lerp(1 -> 0, 0.6) = 0.4 -> sRGBToLinear(0.4) ~ 0.133 (not linear interpolation 0.4!)
    assert.ok(mid[1][0] < 0.2, `expected gamma-interpolated linear R ~ 0.133 at t=0.6, got ${mid[1][0]}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('convertUnityPrefab imports TwoConstants gravityModifier ranges and PBR FX inverts orm.g roughness', async () => {
  const { VFX_UBER_FRAGMENT_GLSL } = await import('../assets/runtime/vfx/vfx-shader-chunks.js');
  const { convertUnityPrefab } = await import('../scripts/import-unity-vfx.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  assert.match(VFX_UBER_FRAGMENT_GLSL, /clamp\(1\.0 - orm\.g, 0\.0, 1\.0\) \* pbrScalars\.x/, 'PBR FX ORM.g encodes Roughness (One Minus -> Smoothness)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-grav-range-'));
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  const boxGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  try {
    const prefabPath = path.join(tmpDir, 'GravRangeFx.prefab');
    fs.writeFileSync(prefabPath, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: FallingDebris
--- !u!4 &200
Transform:
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 0}
--- !u!198 &300
ParticleSystem:
  m_GameObject: {fileID: 100}
  lengthInSec: 1
  InitialModule:
    enabled: 1
    startLifetime:
      scalar: 2
    startSize:
      scalar: 0.5
    startSpeed:
      scalar: 0
    gravityModifier:
      minMaxState: 3
      scalar: 1.5
      minScalar: 2.5
    startColor:
      minMaxState: 0
      maxColor: {r: 1, g: 1, b: 1, a: 1}
  EmissionModule:
    enabled: 1
    rateOverTime:
      scalar: 0
    m_BurstCount: 1
    m_Bursts:
    - serializedVersion: 2
      time: 0
      countCurve:
        minMaxState: 0
        scalar: 1
      cycleCount: 1
      repeatInterval: 0.01
--- !u!199 &400
ParticleSystemRenderer:
  m_GameObject: {fileID: 100}
  m_RenderMode: 4
  m_Mesh: {fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}
`);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'grav_range_fx' });
    assert.deepEqual(recipe.layers[0].gravity, [14.715, 24.525], 'TwoConstants gravityModifier converts to [min, max] m/s^2');
    vfx.registerMesh('cube', boxGeo);
    vfx.registerEffect(recipe);
    vfx.playEffect('grav_range_fx', { x: 0, y: 10, z: 0 });
    for (let i = 0; i < 6; i++) vfx.update(1 / 30);
    assert.ok(Array.isArray(recipe.layers[0].bursts) && recipe.layers[0].bursts.length === 1, 'expected burst emission in converted layer');
    const pos = new Float32Array(3);
    const vel = new Float32Array(3);
    vfx.meshVfx.readSlotMotion(0, pos, vel);
    assert.ok(pos[1] < 9.9 && pos[1] > 0, `mesh with array gravity should fall downward, got y=${pos[1]}`);
    assert.ok(vel[1] < -2.0, `mesh downward velocity should accumulate gravity, got vy=${vel[1]}`);
  } finally {
    boxGeo.dispose();
    vfx.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createGpuParticleSystem supports lazy init, curl turbulence, attractor/vortex, ground bounce, idle sleep, and recipe routing', () => {
  const gpu = createGpuParticleSystem({ mode: 'headless', maxParticles: 64 });
  assert.equal(gpu.getStats().initialized, false, 'GPU particle buffers stay unallocated until first emit');
  assert.equal(gpu.getStats().activeEstimate, 0);

  gpu.setField({
    gravity: [0, -10, 0],
    turbulence: { strength: 4.5, frequency: 0.8, scroll: 1.0 },
    attractor: { x: 4, y: 2, z: 0, strength: 18, vortexStrength: 6, killRadius: 0.35 },
    ground: { enabled: true, y: 0, friction: 0.25 },
    maxSpeed: 20,
  });

  const idx = gpu.emit({ x: 0, y: 0.2, z: 0, vx: 1, vy: -4, vz: 0, duration: 0.5, bounce: 0.6, drag: 0.5 });
  assert.equal(gpu.getStats().initialized, true);
  assert.equal(gpu.getStats().activeEstimate, 1);

  gpu.update(0.1);
  const s = gpu.readParticleSample(idx);
  assert.equal(s.active, true);
  assert.ok(s.y >= 0, `ground collision clamps particle above groundY=0 (got y=${s.y})`);
  assert.ok(s.vy > 0, `ground collision reflects downward velocity upward (got vy=${s.vy})`);
  assert.ok(s.vx > 1.0, `attractor pulls particle toward x=4 (got vx=${s.vx})`);

  gpu.update(0.5);
  assert.equal(gpu.getStats().activeEstimate, 0, 'expired GPU particles enter idle sleep');

  // Ring-buffer wrap + Canvas2D fallback rendering
  gpu.reset();
  gpu.burst({ count: 40, x: 0, y: 3, z: 0, speedMin: 1, speedMax: 5, durationMin: 0.2, durationMax: 0.4 });
  gpu.burst({ count: 40, x: 0, y: 3, z: 0, speedMin: 1, speedMax: 5, durationMin: 0.2, durationMax: 0.4 });
  assert.equal(gpu.getStats().totalEmitted, 80);
  const drawOps = [];
  const mockCtx = {
    save() {},
    restore() {},
    beginPath() {},
    arc() { drawOps.push('arc'); },
    fill() { drawOps.push('fill'); },
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#fff',
  };
  gpu.renderCanvas2D(mockCtx, { x: 0, y: 0, zoom: 1 }, 640, 360);
  assert.ok(drawOps.length > 0, 'Canvas2D fallback renders active GPU particles');
  gpu.dispose();

  // .vfx.json simulation: 'gpu' routing via createVfxSystem
  const vfx = createVfxSystem({ mode: 'headless', maxParticles: 64, maxGpuParticles: 256 });
  vfx.registerEffect({
    schemaVersion: 1,
    id: 'gpu_swirl_test',
    duration: 0.6,
    layers: [{
      kind: 'particle',
      simulation: 'gpu',
      blend: 'additive',
      size: 0.4,
      life: 0.4,
      turbulence: { strength: 3.0, frequency: 0.7 },
      attractor: { offset: [0, 2, 0], strength: 10 },
      bursts: [{ time: 0, count: 16 }],
    }],
  });
  vfx.playEffect('gpu_swirl_test', { x: 1, y: 1, z: 0 });
  vfx.update(0.05);
  assert.equal(vfx.getStats().gpuParticles.activeEstimate, 16);
  for (let k = 0; k < 6; k++) vfx.update(0.1);
  assert.equal(vfx.getStats().gpuParticles.activeEstimate, 0);
  vfx.dispose();
});

test('stateless, atlas, and shuriken pools retire idle meshes, bound dirty ranges, and swap-remove active slots', () => {
  const scene = new THREE.Scene();
  const stateless = createStatelessParticlePool({ mode: '3d', THREE, scene, maxParticles: 128 });
  stateless.burst({ count: 32, durationMin: 0.1, durationMax: 0.2 });
  stateless.update(0.05);
  const statelessMesh = scene.children.find((c) => c.name === 'HGameVfxParticlesAdditive');
  assert.ok(statelessMesh && statelessMesh.visible === true && statelessMesh.geometry.instanceCount === 32);
  stateless.update(0.3);
  assert.equal(statelessMesh.visible, false, 'stateless pool hides mesh when all particles expire');
  assert.equal(statelessMesh.geometry.instanceCount, 0);
  stateless.dispose();

  const atlas = createAtlasParticlePool({ mode: '3d', THREE, scene, maxParticles: 128 });
  const s0 = atlas.emit({ x: 0, y: 0, z: 0, duration: 0.4 });
  atlas.emit({ x: 1, y: 0, z: 0, duration: 0.4 });
  atlas.emit({ x: 2, y: 0, z: 0, duration: 0.4 });
  const s3 = atlas.emit({ x: 3, y: 0, z: 0, duration: 0.4 });
  atlas.update(0.02);
  const atlasMesh = scene.children.find((c) => c.name === 'HGameVfxAtlasNormal');
  assert.ok(atlasMesh && atlasMesh.visible === true);
  atlas.updateSlot('alpha', s0, 0, 1, 0, 0, 0, 0);
  atlas.updateSlot('alpha', s3, 3, 1, 0, 0, 0, 0);
  atlas.update(0.02);
  assert.equal(atlas.getStats().normalCursor, 4);
  atlas.update(0.5);
  assert.equal(atlasMesh.visible, false, 'atlas pool hides mesh when all particles expire');
  assert.equal(atlasMesh.geometry.instanceCount, 0);
  atlas.dispose();

  const shuriken = createShurikenKernel({ THREE, scene });
  const layer = shuriken.registerLayer({ name: 'compact_test', maxParticles: 64, life: 0.25, size: 1 });
  shuriken.emitParticle(layer, { x: 0, y: 0, z: 0, duration: 0.1 });
  shuriken.emitParticle(layer, { x: 1, y: 0, z: 0, duration: 0.3 });
  shuriken.emitParticle(layer, { x: 2, y: 0, z: 0, duration: 0.1 });
  shuriken.update(0.15);
  assert.equal(shuriken.getStats().activeParticles, 1, 'swap-remove retains exactly 1 surviving particle');
  shuriken.update(0.2);
  assert.equal(shuriken.getStats().activeParticles, 0);
  assert.equal(layer.mesh.visible, false);
  shuriken.dispose();
});

test('mobile/minigame defaults, zero idle draw calls across createVfxSystem, and DOM-free wx canvas', () => {
  const prevWx = globalThis.wx;
  const prevTt = globalThis.tt;
  try {
    delete globalThis.wx;
    delete globalThis.tt;
    assert.equal(isMobileOrMiniGameEnv(), false);

    const drawCalls = [];
    const makeMockCtx = () => ({
      fillStyle: '#000',
      strokeStyle: '#000',
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      lineWidth: 1,
      globalAlpha: 1,
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() { drawCalls.push('fillRect'); },
      strokeRect() {},
      clearRect() {},
      beginPath() {},
      closePath() {},
      arc() {},
      ellipse() {},
      moveTo() {},
      lineTo() {},
      fill() { drawCalls.push('fill'); },
      stroke() {},
      fillText() { drawCalls.push('fillText'); },
      strokeText() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
    });
    const fakeCanvases = [];
    globalThis.wx = {
      createCanvas() {
        const c = { width: 0, height: 0, getContext: () => makeMockCtx() };
        fakeCanvases.push(c);
        return c;
      },
    };
    assert.equal(isMobileOrMiniGameEnv(), true, 'detects wx mini-game environment');

    const offscreen = createOffscreen2dCanvas(128, 64);
    assert.equal(offscreen.width, 128);
    assert.equal(offscreen.height, 64);
    assert.equal(fakeCanvases.length, 1);

    const glyphAtlas = bakeGlyphAtlasCanvas();
    assert.ok(glyphAtlas && glyphAtlas.width > 0 && glyphAtlas.height > 0);
    const vfxAtlas = createProceduralVfxAtlas();
    assert.equal(vfxAtlas.canvas.width, 512);
    assert.equal(vfxAtlas.canvas.height, 512);
    assert.ok(drawCalls.length > 0, 'wx mock canvas executes 2D atlas baking without DOM');

    delete globalThis.wx;
    globalThis.tt = { createCanvas: () => ({ width: 0, height: 0, getContext: () => makeMockCtx() }) };
    assert.equal(isMobileOrMiniGameEnv(), true, 'detects tt mini-game environment');
  } finally {
    if (prevWx === undefined) delete globalThis.wx;
    else globalThis.wx = prevWx;
    if (prevTt === undefined) delete globalThis.tt;
    else globalThis.tt = prevTt;
  }

  // Mobile GPU particle defaults + quality tier scaling + chunked window compaction
  const mobileGpu = createGpuParticleSystem({ mode: 'headless', mobile: true });
  assert.equal(mobileGpu.getStats().capacity, 16384);
  assert.equal(mobileGpu.getStats().precision, 'fp16');
  mobileGpu.setQualityTier('low');
  mobileGpu.burst({ count: 10, duration: 0.2 });
  assert.equal(mobileGpu.getStats().totalEmitted, 5, 'low quality tier halves burst count');
  mobileGpu.setQualityTier('ultra');
  mobileGpu.burst({ count: 10, duration: 0.2 });
  assert.equal(mobileGpu.getStats().totalEmitted, 15, 'ultra quality tier restores full burst count');
  mobileGpu.dispose();

  const windowedGpu = createGpuParticleSystem({ mode: 'headless', maxParticles: 512, mobile: true });
  windowedGpu.burst({ count: 256, duration: 0.05 }); // fills chunk 0 (slots 0..255)
  windowedGpu.emit({ x: 1, y: 2, z: 3, duration: 0.8 }); // lands in chunk 1 (slot 256)
  assert.equal(windowedGpu.getStats().activeBaseSlot, 0);
  assert.equal(windowedGpu.getStats().activeSpanCount, 257);
  windowedGpu.update(0.1); // chunk 0 expired, chunk 1 still alive (tail-clamped before wrap)
  assert.equal(windowedGpu.getStats().activeBaseSlot, 256, 'compacts active window to live chunk 1');
  assert.equal(windowedGpu.getStats().activeSpanCount, 1);
  windowedGpu.burst({ count: 300, duration: 0.05 }); // wraps cursor past 512 into chunk 0
  windowedGpu.update(0.1); // wrapped short burst expires while chunk 1 remains alive
  assert.equal(windowedGpu.getStats().activeBaseSlot, 256);
  assert.equal(windowedGpu.getStats().activeSpanCount, 256, 'clamps to live chunk 1 after ring wrap');
  windowedGpu.update(0.8); // chunk 1 expired
  assert.equal(windowedGpu.getStats().activeSpanCount, 0);
  windowedGpu.dispose();

  // Full createVfxSystem 3D zero idle DrawCalls check
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({
    mode: '3d',
    THREE,
    sceneOrAdapter: scene,
    maxParticles: 512,
    atlasMaxParticles: 128,
    maxSlashArcs: 8,
    maxLightningBolts: 8,
    maxTrails: 4,
    maxTelegraphs: 8,
    maxGlyphs: 64,
  });

  const collectMeshes = () => {
    const meshes = [];
    scene.traverse((obj) => {
      if (obj && obj.isMesh) meshes.push(obj);
    });
    return meshes;
  };
  const initialMeshes = collectMeshes();
  assert.ok(initialMeshes.length >= 7, `expected subsystem meshes in scene, got ${initialMeshes.length}`);
  for (const m of initialMeshes) {
    assert.equal(m.visible, false, `mesh ${m.name} must start hidden with 0 idle draw calls`);
  }

  vfx.particles.burst({ count: 4, durationMin: 0.15, durationMax: 0.15 });
  vfx.gpuParticles.emit({ x: 0, y: 0, z: 0, duration: 0.15 });
  vfx.atlasParticles.emit({ x: 0, y: 0, z: 0, duration: 0.15 });
  vfx.slashArc({ x: 0, y: 0, z: 0, duration: 0.15 });
  vfx.lightningBolt({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0, z1: 0, duration: 0.15 });
  const tid = vfx.allocTrail({ color: 0x38bdf8, width: 0.25 });
  vfx.pushTrailPoint(tid, 0, 0, 0);
  vfx.pushTrailPoint(tid, 1, 0, 0);
  vfx.spawnTelegraph({ x: 0, z: 0, radius: 1.5, duration: 0.15 });
  vfx.popupNumber({ value: 42, x: 0, y: 1, z: 0, duration: 0.15 });
  vfx.screenPulse({ color: 0xffffff, duration: 0.15 });
  vfx.update(0.05);

  const visibleDuringActive = collectMeshes().filter((m) => m.visible).map((m) => m.name);
  assert.ok(visibleDuringActive.includes('HGameVfxSlashArcs'), 'slash mesh becomes visible when active');
  assert.ok(visibleDuringActive.includes('HGameVfxLightningBolts'), 'bolt mesh becomes visible when active');
  assert.ok(visibleDuringActive.includes('HGameVfxRibbonTrails'), 'ribbon mesh becomes visible when active');
  assert.ok(visibleDuringActive.includes('HGameVfxTelegraphs'), 'telegraph mesh becomes visible when active');
  assert.ok(visibleDuringActive.includes('HGameVfxFloatingText'), 'floating text mesh becomes visible when active');
  assert.ok(visibleDuringActive.includes('HGameVfxScreenFeedback'), 'screen pulse mesh becomes visible when active');

  vfx.freeTrail(tid);
  for (let i = 0; i < 4; i++) vfx.update(0.08);
  for (const m of collectMeshes()) {
    assert.equal(m.visible, false, `mesh ${m.name} must auto-hide after effects expire`);
  }

  vfx.slashArc({ x: 0, y: 0, z: 0, duration: 0.5 });
  vfx.screenPulse({ color: 0xffffff, duration: 0.5 });
  vfx.update(0.02);
  vfx.reset();
  for (const m of collectMeshes()) {
    assert.equal(m.visible, false, `mesh ${m.name} must hide immediately on reset()`);
  }
  vfx.dispose();
});

test('parseUnityAssetMesh flips UV V-coordinates and convertUnityPrefab negates rotX for .asset meshes only', async () => {
  const { parseUnityAssetMesh } = await import('../scripts/export-unity-vfx-bench.mjs');
  const { convertUnityPrefab } = await import('../scripts/import-unity-vfx.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  // 1. parseUnityAssetMesh flips UV V (1.0 - v) for uncompressed Unity .asset mesh
  const v0Pos = Buffer.alloc(12 * 3);
  const v0Uv = [
    [0.25, 0.0],
    [0.5, 1.0],
    [0.75, 0.2],
  ];
  const stride = 32; // pos(12) + nrm(12) + uv0(8)
  const vBuf = Buffer.alloc(stride * 3);
  for (let i = 0; i < 3; i++) {
    const base = i * stride;
    vBuf.writeFloatLE(i * 0.5, base);
    vBuf.writeFloatLE(0, base + 4);
    vBuf.writeFloatLE(0.5, base + 8);
    vBuf.writeFloatLE(0, base + 12);
    vBuf.writeFloatLE(1, base + 16);
    vBuf.writeFloatLE(0, base + 20);
    vBuf.writeFloatLE(v0Uv[i][0], base + 24);
    vBuf.writeFloatLE(v0Uv[i][1], base + 28);
  }
  const idxBuf = Buffer.alloc(6);
  idxBuf.writeUInt16LE(0, 0);
  idxBuf.writeUInt16LE(1, 2);
  idxBuf.writeUInt16LE(2, 4);
  const assetYaml = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!43 &4300000
Mesh:
  m_MeshCompression: 0
  m_IndexFormat: 0
  m_IndexBuffer: ${idxBuf.toString('hex')}
  m_VertexData:
    m_VertexCount: 3
    m_Channels:
    - stream: 0
      offset: 0
      format: 0
      dimension: 3
    - stream: 0
      offset: 12
      format: 0
      dimension: 3
    - stream: 0
      offset: 0
      format: 0
      dimension: 0
    - stream: 0
      offset: 0
      format: 0
      dimension: 0
    - stream: 0
      offset: 24
      format: 0
      dimension: 2
    m_DataSize: ${vBuf.length}
    _typelessdata: ${vBuf.toString('hex')}
`;
  const parsed = parseUnityAssetMesh(assetYaml);
  assert.ok(Math.abs(parsed.uv0[1] - 1.0) < 1e-5, `expected uv0[0].v flipped 0 -> 1, got ${parsed.uv0[1]}`);
  assert.ok(Math.abs(parsed.uv0[3] - 0.0) < 1e-5, `expected uv0[1].v flipped 1 -> 0, got ${parsed.uv0[3]}`);
  assert.ok(Math.abs(parsed.uv0[5] - 0.8) < 1e-5, `expected uv0[2].v flipped 0.2 -> 0.8, got ${parsed.uv0[5]}`);
  assert.equal(parsed.positions[2], -0.5, 'LHS->RHS negates Z');

  // 2. convertUnityPrefab negates startRotationX for .asset meshes and preserves it for .fbx meshes
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-asset-rotx-'));
  try {
    const assetPath = path.join(tmpDir, 'MyCone.asset');
    const fbxPath = path.join(tmpDir, 'MyFbxCone.fbx');
    const assetGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fbxGuid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    fs.writeFileSync(assetPath, assetYaml);
    fs.writeFileSync(`${assetPath}.meta`, `fileFormatVersion: 2\nguid: ${assetGuid}\n`);
    fs.writeFileSync(fbxPath, 'dummy fbx');
    fs.writeFileSync(`${fbxPath}.meta`, `fileFormatVersion: 2\nguid: ${fbxGuid}\nModelImporter:\n  globalScale: 1\n`);

    const prefabPath = path.join(tmpDir, 'RotXTest.prefab');
    fs.writeFileSync(prefabPath, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_Name: Root
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 21}
  - {fileID: 31}
  m_Father: {fileID: 0}
--- !u!1 &20
GameObject:
  m_Name: AssetMeshLayer
--- !u!4 &21
Transform:
  m_GameObject: {fileID: 20}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 11}
--- !u!198 &22
ParticleSystem:
  m_GameObject: {fileID: 20}
  lengthInSec: 1
  InitialModule:
    enabled: 1
    startLifetime:
      scalar: 0.5
    startSize:
      scalar: 1
    startSpeed:
      scalar: 0
    rotation3D: 1
    startRotationX:
      scalar: -1.5707963
    startRotationY:
      minMaxState: 3
      minScalar: 0
      scalar: 6.2831855
    startColor:
      minMaxState: 0
      maxColor: {r: 1, g: 1, b: 1, a: 1}
  EmissionModule:
    enabled: 1
    m_BurstCount: 1
    m_Bursts:
    - serializedVersion: 2
      time: 0
      countCurve:
        scalar: 1
      cycleCount: 1
      repeatInterval: 0.01
--- !u!199 &23
ParticleSystemRenderer:
  m_GameObject: {fileID: 20}
  m_RenderMode: 4
  m_Mesh: {fileID: 4300000, guid: ${assetGuid}, type: 2}
--- !u!1 &30
GameObject:
  m_Name: FbxMeshLayer
--- !u!4 &31
Transform:
  m_GameObject: {fileID: 30}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 11}
--- !u!198 &32
ParticleSystem:
  m_GameObject: {fileID: 30}
  lengthInSec: 1
  InitialModule:
    enabled: 1
    startLifetime:
      scalar: 0.5
    startSize:
      scalar: 1
    startSpeed:
      scalar: 0
    rotation3D: 1
    startRotationX:
      scalar: -1.5707963
    startRotationY:
      minMaxState: 3
      minScalar: 0
      scalar: 6.2831855
    startColor:
      minMaxState: 0
      maxColor: {r: 1, g: 1, b: 1, a: 1}
  EmissionModule:
    enabled: 1
    m_BurstCount: 1
    m_Bursts:
    - serializedVersion: 2
      time: 0
      countCurve:
        scalar: 1
      cycleCount: 1
      repeatInterval: 0.01
--- !u!199 &33
ParticleSystemRenderer:
  m_GameObject: {fileID: 30}
  m_RenderMode: 4
  m_Mesh: {fileID: 4300000, guid: ${fbxGuid}, type: 2}
`);
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'rotx_test' });
    const assetLayer = recipe.layers.find((l) => l.name === 'assetmeshlayer');
    const fbxLayer = recipe.layers.find((l) => l.name === 'fbxmeshlayer');
    assert.ok(assetLayer && fbxLayer, 'expected both layers converted');
    assert.ok(Math.abs(assetLayer.rotX - 1.5708) < 1e-3, `.asset mesh rotX should negate -1.5708 -> +1.5708, got ${assetLayer.rotX}`);
    assert.deepEqual(assetLayer.rotY, [0, 6.2832], 'full 2pi spin range stays [0, 6.2832]');
    assert.ok(Math.abs(fbxLayer.rotX - 1.5708) < 1e-3, `.fbx mesh rotX should also negate -1.5708 -> +1.5708 under unified UnityEngine.Mesh GLB export, got ${fbxLayer.rotX}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('instanced mesh integer bit-packing rounds varyings and vfxHasFlag avoids bit overflow', () => {
  const scene = new THREE.Scene();
  const meshPool = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 4 });
  const customGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  try {
    meshPool.registerMesh('topdown_tube', customGeo, { topDownUv: true });
    const uberMat = createUberMaterialSpec({
      shaderKind: 'uber_fx',
      blend: 'additive',
      mainTexKey: 'tx_noise_10',
      alphaOverrideKey: 'gradient_maker_noise_y_cut_down',
      useAlphaOverride: true,
    });
    meshPool.spawn({
      mesh: 'topdown_tube',
      blend: 'additive',
      duration: 1.0,
      flipX: -1,
      flipY: 1,
      flipZ: 1,
      flipbook: { cols: 4, rows: 4, cycles: 0, blend: true },
      uberMat,
    });
    const instMesh = scene.children.find((c) => c.name?.startsWith('HGameVfxMeshInst_'));
    assert.ok(instMesh, 'expected instanced mesh batch in scene');
    const aScaleInfo = instMesh.geometry.getAttribute('aInstScaleInfo');
    const aMeta = instMesh.geometry.getAttribute('aInstMeta');
    assert.equal(aScaleInfo.getW(0), 2, 'topDownUv with odd negative scale writes aInstScaleInfo.w === 2');
    assert.equal(aMeta.getW(0), 4096, 'cycles=0 + blend=true writes aInstMeta.w === 4096');

    assert.match(VFX_MESH_INSTANCED_VS, /float flipBitsVs = floor\(aInstScaleInfo\.w \+ 0\.5\);/);
    assert.match(VFX_MESH_INSTANCED_FS, /float flipBits = floor\(vFlipLocalV \+ 0\.5\);/);
    assert.match(VFX_MESH_INSTANCED_FS, /float metaW = floor\(vMeta\.w \+ 0\.5\);/);
    assert.match(VFX_COMMON_GLSL, /float cleanFlags = floor\(flags \+ 0\.5\);/);

    // Mirror exact GLSL decoding for sub-ULP interpolated varyings
    const decodeFlip = (v) => {
      const flipBits = Math.floor(v + 0.5);
      const flipLocalVFlag = ((flipBits % 2) + 2) % 2;
      const isOddFlip = Math.floor(flipBits * 0.5 + 0.25);
      return { flipLocalVFlag, isOddFlip };
    };
    assert.deepEqual(decodeFlip(1.9999999), { flipLocalVFlag: 0, isOddFlip: 1 });

    const decodeMetaW = (v) => {
      const metaW = Math.floor(v + 0.5);
      const fbBlendFlag = Math.floor(metaW / 4096.0 + 0.0001);
      const fbCyc = metaW - fbBlendFlag * 4096.0;
      return { fbBlendFlag, fbCyc };
    };
    assert.deepEqual(decodeMetaW(4095.9998), { fbBlendFlag: 1, fbCyc: 0 });

    const hasFlagGlsl = (flags, bitVal) => {
      const cleanFlags = Math.floor(flags + 0.5);
      return ((Math.floor(cleanFlags / bitVal) % 2) + 2) % 2 > 0.5;
    };
    assert.equal(hasFlagGlsl(2047, 2048), false, 'all lower bits 1..1024 set must not overflow into 2048');
    assert.equal(hasFlagGlsl(2097151, 2097152), false, 'all lower bits 1..1048576 set must not overflow into 2097152');
    assert.equal(hasFlagGlsl(2047 + 2048, 2048), true);
  } finally {
    meshPool.dispose();
    customGeo.dispose();
  }
});

test('Shuriken Box ShapeModule rotation and hierarchy scale keep horizontal lunge dust along Z', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-box-rot-'));
  try {
    const prefabPath = path.join(tmpDir, 'BoxLunge.prefab');
    fs.writeFileSync(prefabPath, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_Name: BoxLunge
  m_IsActive: 1
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 0}
--- !u!1 &20
GameObject:
  m_Name: Parent
  m_IsActive: 1
--- !u!4 &21
Transform:
  m_GameObject: {fileID: 20}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 0.6, y: 0.6, z: 0.6}
  m_Father: {fileID: 11}
--- !u!1 &30
GameObject:
  m_Name: Smoke_Flipbook_Clean_Ground
  m_IsActive: 1
--- !u!4 &31
Transform:
  m_GameObject: {fileID: 30}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: -1.5, z: -3}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 21}
--- !u!198 &32
ParticleSystem:
  m_GameObject: {fileID: 30}
  lengthInSec: 1
  looping: 0
  simulationSpeed: 1
  scalingMode: 0
  InitialModule:
    maxNumParticles: 200
    startLifetime:
      minMaxState: 0
      scalar: 1
    startSpeed:
      minMaxState: 0
      scalar: 0
    startSize:
      minMaxState: 0
      scalar: 0.5
    startRotation:
      minMaxState: 0
      scalar: 0
    gravityModifier:
      minMaxState: 0
      scalar: 0
    startColor:
      minMaxState: 0
      maxColor: {r: 1, g: 1, b: 1, a: 1}
  EmissionModule:
    enabled: 1
    rateOverTime:
      minMaxState: 0
      scalar: 0
    m_BurstCount: 1
    m_Bursts:
      - serializedVersion: 2
        time: 0
        minMaxState: 0
        scalar: 60
        minScalar: 60
        cycleCount: 1
        repeatInterval: 0.01
        probability: 1
  ShapeModule:
    enabled: 1
    type: 5
    radius:
      value: 0.5
    angle: 25
    radiusThickness: 0
    m_Position: {x: 0, y: 0, z: 0}
    m_Rotation: {x: 90, y: 0, z: 0}
    m_Scale: {x: 0.6, y: 10, z: 1}
--- !u!199 &33
ParticleSystemRenderer:
  m_GameObject: {fileID: 30}
  m_Enabled: 1
  m_RenderMode: 0
  m_Materials: []
`, 'utf8');
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'box_lunge_test' });
    const layer = recipe.layers[0];
    assert.equal(layer.shape.type, 'box');
    assert.deepEqual(layer.shape.size, [0.36, 6, 0.6]);
    assert.equal(layer.shape.shell, undefined);
    assert.equal(layer.shape.scale, undefined);
    assert.ok(Array.isArray(layer.shape.rotation) && Math.abs(layer.shape.rotation[0] + Math.PI * 0.5) < 0.01);

    const xs = [];
    const ys = [];
    const zs = [];
    const realAtlas = createAtlasParticlePool({ mode: 'headless', maxParticles: 256 });
    const origEmit = realAtlas.emit.bind(realAtlas);
    const atlasParticles = Object.assign(Object.create(realAtlas), {
      emit(opts) {
        xs.push(opts.x);
        ys.push(opts.y);
        zs.push(opts.z);
        return origEmit(opts);
      },
    });
    const player = createEffectPlayer({ atlasParticles });
    try {
      player.registerEffect(recipe);
      player.playEffect('box_lunge_test', { x: 0, y: 0, z: 0 });
      player.update(0.05);

      assert.equal(xs.length, 60);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      assert.ok(maxZ - minZ > 4.0, `Expected dust trail along Z (> 4.0m), got span ${(maxZ - minZ).toFixed(2)}`);
      assert.ok(maxY - minY < 1.0, `Expected flat Y thickness (< 1.0m), got span ${(maxY - minY).toFixed(2)}`);

      // Also verify rectangle uses size[1] for depth (XZ) in 3D and box shell / boxEdge spawn cleanly
      const rectRecipe = {
        schemaVersion: 1,
        id: 'rect_edge_test',
        duration: 1,
        layers: [
          {
            kind: 'particle',
            renderMode: 'billboard',
            life: 1,
            speed: 0,
            bursts: [{ time: 0, count: 40 }],
            shape: { type: 'rectangle', radius: 1, size: [4.5, 4.5, 1] },
          },
          {
            kind: 'particle',
            renderMode: 'billboard',
            life: 1,
            speed: 0,
            bursts: [{ time: 0, count: 40 }],
            shape: { type: 'box', radius: 1, size: [2, 2, 2], boxEdge: true },
          },
        ],
      };
      xs.length = 0; ys.length = 0; zs.length = 0;
      player.registerEffect(rectRecipe);
      player.playEffect('rect_edge_test', { x: 0, y: 0, z: 0 });
      player.update(0.05);
      assert.equal(xs.length, 80);
      const rectZSpan = Math.max(...zs.slice(0, 40)) - Math.min(...zs.slice(0, 40));
      assert.ok(rectZSpan > 2.0, `Expected rectangle 3D depth from size[1]=4.5 (> 2.0m), got ${rectZSpan.toFixed(2)}`);
    } finally {
      player.dispose();
      realAtlas.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unity VFX spatial parity: scalingMode 0/1/2, shape scale/rotation, unified meshAlign + rotOverLifetime, and 512-layer cap', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-parity-unit-'));
  try {
    const fbxPath = path.join(tmpDir, 'BladeMesh.fbx');
    const fbxGuid = 'cccccccccccccccccccccccccccccccc';
    fs.writeFileSync(fbxPath, 'dummy');
    fs.writeFileSync(`${fbxPath}.meta`, `fileFormatVersion: 2\nguid: ${fbxGuid}\nModelImporter:\n  globalScale: 100\n`);

    const prefabPath = path.join(tmpDir, 'SpatialParity.prefab');
    fs.writeFileSync(prefabPath, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_Name: Root
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 2, y: 2, z: 2}
  m_Children:
  - {fileID: 21}
  - {fileID: 31}
  - {fileID: 41}
  - {fileID: 51}
  m_Father: {fileID: 0}
--- !u!1 &20
GameObject:
  m_Name: ModeHierarchyCone
--- !u!4 &21
Transform:
  m_GameObject: {fileID: 20}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 11}
--- !u!198 &22
ParticleSystem:
  m_GameObject: {fileID: 20}
  scalingMode: 0
  lengthInSec: 1
  InitialModule:
    startLifetime:
      minMaxState: 0
      scalar: 1
    startSpeed:
      minMaxState: 0
      scalar: 0
    startSize:
      minMaxState: 0
      scalar: 1
  EmissionModule:
    enabled: 1
    rateOverTime:
      minMaxState: 0
      scalar: 10
  ShapeModule:
    enabled: 1
    type: 8
    angle: 0
    length: 5
    radius:
      value: 1
    m_Rotation: {x: 0, y: 0, z: 0}
    m_Scale: {x: 1, y: 1, z: 7}
--- !u!199 &23
ParticleSystemRenderer:
  m_GameObject: {fileID: 20}
  m_RenderMode: 0
--- !u!1 &30
GameObject:
  m_Name: ModeLocalSphere
--- !u!4 &31
Transform:
  m_GameObject: {fileID: 30}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1.5, y: 1.5, z: 1.5}
  m_Father: {fileID: 11}
--- !u!198 &32
ParticleSystem:
  m_GameObject: {fileID: 30}
  scalingMode: 1
  lengthInSec: 1
  InitialModule:
    startLifetime:
      minMaxState: 0
      scalar: 1
    startSpeed:
      minMaxState: 0
      scalar: 0
    startSize:
      minMaxState: 0
      scalar: 1
  EmissionModule:
    enabled: 1
    rateOverTime:
      minMaxState: 0
      scalar: 10
  ShapeModule:
    enabled: 1
    type: 0
    radius:
      value: 1
    m_Rotation: {x: 90, y: 0, z: 0}
    m_Scale: {x: 0.01, y: 0.01, z: 0.5}
--- !u!199 &33
ParticleSystemRenderer:
  m_GameObject: {fileID: 30}
  m_RenderMode: 0
--- !u!1 &40
GameObject:
  m_Name: ModeShapeChild
--- !u!4 &41
Transform:
  m_GameObject: {fileID: 40}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 11}
--- !u!198 &42
ParticleSystem:
  m_GameObject: {fileID: 40}
  scalingMode: 2
  lengthInSec: 1
  InitialModule:
    startLifetime:
      minMaxState: 0
      scalar: 1
    startSpeed:
      minMaxState: 0
      scalar: 0
    startSize:
      minMaxState: 0
      scalar: 1
  EmissionModule:
    enabled: 1
    rateOverTime:
      minMaxState: 0
      scalar: 10
  ShapeModule:
    enabled: 1
    type: 10
    radius:
      value: 1
--- !u!199 &43
ParticleSystemRenderer:
  m_GameObject: {fileID: 40}
  m_RenderMode: 0
--- !u!1 &50
GameObject:
  m_Name: ManifestMeshLayer
--- !u!4 &51
Transform:
  m_GameObject: {fileID: 50}
  m_LocalRotation: {x: 0, y: 0.7071068, z: 0, w: 0.7071068}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Father: {fileID: 11}
--- !u!198 &52
ParticleSystem:
  m_GameObject: {fileID: 50}
  scalingMode: 0
  lengthInSec: 1
  InitialModule:
    startLifetime:
      minMaxState: 0
      scalar: 1
    startSpeed:
      minMaxState: 0
      scalar: 5
    startSize:
      minMaxState: 0
      scalar: 1
    rotation3D: 1
    startRotationX:
      minMaxState: 0
      scalar: 0.5
  EmissionModule:
    enabled: 1
    m_BurstCount: 1
    m_Bursts:
    - serializedVersion: 2
      time: 0
      countCurve:
        scalar: 1
      cycleCount: 1
      repeatInterval: 0.01
--- !u!199 &53
ParticleSystemRenderer:
  m_GameObject: {fileID: 50}
  m_RenderMode: 4
  m_RenderAlignment: 4
  m_Mesh: {fileID: 4300000, guid: ${fbxGuid}, type: 2}
`);
    const meshManifest = {
      [`${fbxGuid}:4300000`]: { meshKey: 'blademesh', subMeshName: 'blademesh', multi: false },
    };
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'parity_unit', meshManifest });

    // 1. scalingMode 0/1/2 + Y<->Z cone scale + sphere rotation
    const lHier = recipe.layers.find((l) => l.name === 'modehierarchycone');
    const lLocal = recipe.layers.find((l) => l.name === 'modelocalsphere');
    const lShape = recipe.layers.find((l) => l.name === 'modeshapechild');
    const lMesh = recipe.layers.find((l) => l.name === 'manifestmeshlayer');
    assert.equal(lHier.size, 2, 'scalingMode=0 multiplies particle size by hierarchy scale 2');
    assert.deepEqual(lHier.shape.scale, [1, 7, 1], 'cone m_Scale.z=7 maps to HGame Y (beam length)');
    assert.equal(lLocal.size, 1.5, 'scalingMode=1 uses own scale 1.5 and ignores parent scale 2');
    assert.ok(Array.isArray(lLocal.shape.rotation) && Math.abs(lLocal.shape.rotation[0] + Math.PI * 0.5) < 0.02, 'sphere preserves non-uniform m_Rotation');
    assert.equal(lShape.size, 1, 'scalingMode=2 keeps particle size at 1 while shape radius scales by 2');
    assert.equal(lShape.shape.radius, 2);

    // 2. meshManifest suppresses double meshGlobalScale and configures unified velocity align -z
    assert.equal(lMesh.meshGlobalScale, undefined, 'manifest-baked GLB must not emit meshGlobalScale=100');
    assert.equal(lMesh.unityMeshRot, true);
    assert.equal(lMesh.meshAlign, 'velocity');
    assert.equal(lMesh.forwardAxis, '-z');

    // 3. Runtime readSlotTransform checks unityMeshRot across velocity/view + rotationOverLifetime integration
    const scene = new THREE.Scene();
    const meshVfx = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 8 });
    try {
      const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      cam.position.set(0, 0, 10);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      meshVfx.setCamera(cam);

      const hView = meshVfx.spawn({
        mesh: 'crystal',
        duration: 1,
        unityMeshRot: true,
        meshAlign: 'view',
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        rotationOverLifetime: { z: { mode: 'curve', scalar: 2, curve: [[0, 1], [1, 1]] } },
      });
      const hVel = meshVfx.spawn({
        mesh: 'crystal',
        duration: 1,
        vx: 10,
        vy: 0,
        vz: 0,
        unityMeshRot: true,
        meshAlign: 'velocity',
        forwardAxis: '-z',
        rotX: 0,
        rotY: 0,
        rotZ: 0,
      });
      meshVfx.update(0.5);
      const pos = new Float32Array(3);
      const qView = new Float32Array(4);
      const qVel = new Float32Array(4);
      const sc = new Float32Array(3);
      assert.ok(meshVfx.readSlotTransform(hView, pos, qView, sc));
      assert.ok(meshVfx.readSlotTransform(hVel, pos, qVel, sc));
      // Z rotated by integral(2 * 0.5) = 1 rad around camera Z: q.z ~= sin(0.5), q.w ~= cos(0.5)
      assert.ok(Math.abs(qView[2] - Math.sin(0.5)) < 0.02, `expected view+rotOverLife Z=sin(0.5), got ${qView[2]}`);
      // -Z rotated to +X is -90 deg around Y: q.y ~= -0.7071, q.w ~= 0.7071
      assert.ok(Math.abs(qVel[1] + Math.SQRT1_2) < 0.02 && Math.abs(qVel[3] - Math.SQRT1_2) < 0.02, `expected -Z->+X velocity quat, got [${qVel.join(', ')}]`);
    } finally {
      meshVfx.dispose();
    }

    // 4. Recipe validator accepts > 128 layers up to 512
    const bigLayers = Array.from({ length: 200 }, (_, i) => ({
      name: `l_${i}`,
      kind: 'particle',
      life: 1,
      rate: 1,
    }));
    const bigRes = validateVfxRecipe({ schemaVersion: 1, id: 'mega_200', duration: 2, layers: bigLayers });
    assert.equal(bigRes.ok, true, `expected 200-layer recipe valid, got ${bigRes.errors?.join('; ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('VelocityModule single-curve scalar preservation and Rx(180) carrier death sub-emitter land at ground level', async () => {
  const { convertUnityPrefab } = await import('../scripts/import-unity-vfx.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vel-carrier-'));
  try {
    const prefabPath = path.join(tmpDir, 'CarrierDropTest.prefab');
    fs.writeFileSync(
      prefabPath,
      [
        '%YAML 1.1',
        '--- !u!1 &100',
        'GameObject:',
        '  m_Name: Root',
        '  m_IsActive: 1',
        '--- !u!4 &101',
        'Transform:',
        '  m_GameObject: {fileID: 100}',
        '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
        '  m_LocalPosition: {x: 0, y: 0, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Father: {fileID: 0}',
        '--- !u!1 &200',
        'GameObject:',
        '  m_Name: Lightning_Ring',
        '  m_IsActive: 1',
        '--- !u!4 &201',
        'Transform:',
        '  m_GameObject: {fileID: 200}',
        '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
        '  m_LocalPosition: {x: 0, y: 6.46, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Father: {fileID: 101}',
        '--- !u!198 &202',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 200}',
        '  lengthInSec: 1',
        '  looping: 0',
        '  InitialModule:',
        '    enabled: 1',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 0.8',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 0.1',
        '  EmissionModule:',
        '    enabled: 1',
        '    rateOverTime:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 4',
        '        minScalar: 4',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '  ShapeModule:',
        '    enabled: 1',
        '    type: 10',
        '    radiusThickness: 0',
        '    m_Rotation: {x: -90, y: 0, z: 0}',
        '    radius:',
        '      value: 2.5',
        '    arc:',
        '      value: 360',
        '      mode: 3',
        '  SubModule:',
        '    enabled: 1',
        '    subEmitters:',
        '    - serializedVersion: 3',
        '      emitter: {fileID: 302}',
        '      type: 0',
        '      properties: 0',
        '      emitProbability: 1',
        '--- !u!199 &203',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 200}',
        '  m_Enabled: 1',
        '  m_RenderMode: 5',
        '--- !u!1 &300',
        'GameObject:',
        '  m_Name: Ground',
        '  m_IsActive: 1',
        '--- !u!4 &301',
        'Transform:',
        '  m_GameObject: {fileID: 300}',
        '  m_LocalRotation: {x: 1, y: 0, z: 0, w: 0}',
        '  m_LocalPosition: {x: 0, y: 0, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Father: {fileID: 201}',
        '--- !u!198 &302',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 300}',
        '  lengthInSec: 1',
        '  looping: 0',
        '  InitialModule:',
        '    enabled: 1',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 0.15',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 0.3',
        '  EmissionModule:',
        '    enabled: 1',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 1',
        '        minScalar: 1',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '  VelocityModule:',
        '    enabled: 1',
        '    inWorldSpace: 0',
        '    x:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    y:',
        '      minMaxState: 0',
        '      scalar: 25',
        '    z:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    speedModifier:',
        '      minMaxState: 1',
        '      scalar: 2.2081912',
        '      maxCurve:',
        '        m_Curve:',
        '        - time: 0',
        '          value: 1',
        '        - time: 1',
        '          value: 0.0018978119',
        '  SubModule:',
        '    enabled: 1',
        '    subEmitters:',
        '    - serializedVersion: 3',
        '      emitter: {fileID: 402}',
        '      type: 2',
        '      properties: 0',
        '      emitProbability: 1',
        '--- !u!199 &303',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 300}',
        '  m_Enabled: 1',
        '  m_RenderMode: 5',
        '--- !u!1 &400',
        'GameObject:',
        '  m_Name: Crater_Dark_Bigger',
        '  m_IsActive: 1',
        '--- !u!4 &401',
        'Transform:',
        '  m_GameObject: {fileID: 400}',
        '  m_LocalRotation: {x: -0.7071068, y: 0, z: 0, w: 0.7071068}',
        '  m_LocalPosition: {x: 0, y: 0, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Father: {fileID: 301}',
        '--- !u!198 &402',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 400}',
        '  lengthInSec: 1',
        '  looping: 0',
        '  InitialModule:',
        '    enabled: 1',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 2',
        '  EmissionModule:',
        '    enabled: 1',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        minMaxState: 0',
        '        scalar: 1',
        '        minScalar: 1',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '  VelocityModule:',
        '    enabled: 1',
        '    inWorldSpace: 1',
        '    y:',
        '      minMaxState: 1',
        '      scalar: -10',
        '      maxCurve:',
        '        m_Curve:',
        '        - time: 0',
        '          value: 1',
        '        - time: 1',
        '          value: 0',
        '    speedModifier:',
        '      minMaxState: 0',
        '      scalar: 1',
        '--- !u!199 &403',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 400}',
        '  m_Enabled: 1',
        '  m_RenderMode: 3',
      ].join('\n'),
      'utf8',
    );
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'carrier_drop_test' });
    const groundLayer = recipe.layers[0].subEmitters[0].effect.layers[0];
    assert.ok(
      Math.abs(groundLayer.velocity.linear[1] + 55.205) < 0.05,
      `expected Rx(180) + speedModifier curve scalar to keep full -55.205 m/s (got ${groundLayer.velocity.linear[1]})`,
    );
    const craterLayer = groundLayer.subEmitters[0].effect.layers[0];
    assert.ok(
      Math.abs(craterLayer.velocity.linear[1] - 10) < 0.05 && craterLayer.velCurve[0][1] < -0.99,
      `expected single-curve VelocityModule axis to preserve full peak magnitude 10 (got ${craterLayer.velocity.linear[1]})`,
    );

    const scene = new THREE.Scene();
    const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: scene, maxParticles: 64, maxAtlasParticles: 64 });
    try {
      const craterSpawns = [];
      const origEmit = vfx.atlasParticles.emit.bind(vfx.atlasParticles);
      vfx.atlasParticles.emit = (opts) => {
        craterSpawns.push({ x: opts.x, y: opts.y, z: opts.z });
        return origEmit(opts);
      };
      // Use Shock_Calling's exact 9-key decaying velCurve from Unity
      groundLayer.velCurve = [[0, 1], [0.167, 0.974], [0.333, 0.923], [0.5, 0.825], [0.667, 0.654], [0.833, 0.388], [1, 0.002]];
      craterLayer.velocity = undefined;
      craterLayer.velCurve = undefined;
      vfx.registerEffect(recipe);
      vfx.playEffect('carrier_drop_test', { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 30; i++) vfx.update(1 / 60);
      assert.equal(craterSpawns.length, 4, 'all 4 ring craters spawned on carrier death');
      for (const p of craterSpawns) {
        const r = Math.hypot(p.x, p.z);
        assert.ok(Math.abs(p.y) <= 0.15, `expected crater death Y near ground (0), got ${p.y}`);
        assert.ok(Math.abs(r - 2.5) <= 0.05, `expected crater radius 2.5m centered on origin, got ${r}`);
      }
    } finally {
      vfx.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('convertUnityPrefab + createMeshVfxPool integrate AmbarBlade Hermite rotationOverLifetime monotonically in one chop', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame_ambarblade_rot_'));
  try {
    const prefabPath = path.join(tmpDir, 'AmbarBladeRot.prefab');
    fs.writeFileSync(
      prefabPath,
      [
        '%YAML 1.1',
        '%TAG !u! tag:unity3d.com,2011:',
        '--- !u!1 &100',
        'GameObject:',
        '  m_Name: BladeChop',
        '  m_IsActive: 1',
        '--- !u!4 &101',
        'Transform:',
        '  m_GameObject: {fileID: 100}',
        '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
        '  m_LocalPosition: {x: 0, y: 0, z: 0}',
        '  m_LocalScale: {x: 1, y: 1, z: 1}',
        '  m_Father: {fileID: 0}',
        '--- !u!198 &102',
        'ParticleSystem:',
        '  m_GameObject: {fileID: 100}',
        '  lengthInSec: 5',
        '  looping: 0',
        '  InitialModule:',
        '    startLifetime:',
        '      minMaxState: 0',
        '      scalar: 5',
        '    startSpeed:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    startSize:',
        '      minMaxState: 0',
        '      scalar: 1',
        '    startRotationX:',
        '      minMaxState: 0',
        '      scalar: -1.5707963',
        '    startRotation:',
        '      minMaxState: 0',
        '      scalar: 0',
        '  EmissionModule:',
        '    enabled: 1',
        '    rateOverTime:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    m_BurstCount: 1',
        '    m_Bursts:',
        '    - serializedVersion: 2',
        '      time: 0',
        '      countCurve:',
        '        scalar: 1',
        '      cycleCount: 1',
        '      repeatInterval: 0.01',
        '  RotationModule:',
        '    enabled: 1',
        '    separateAxes: 1',
        '    x:',
        '      serializedVersion: 2',
        '      minMaxState: 1',
        '      scalar: 37.022522',
        '      minScalar: 0',
        '      maxCurve:',
        '        serializedVersion: 2',
        '        m_Curve:',
        '        - serializedVersion: 3',
        '          time: 0.20903778',
        '          value: -0.0027444065',
        '          inSlope: -0.052745614',
        '          outSlope: -0.052745614',
        '        - serializedVersion: 3',
        '          time: 0.39860243',
        '          value: -0.0032482222',
        '          inSlope: 0.14851181',
        '          outSlope: 0.14851181',
        '        - serializedVersion: 3',
        '          time: 0.47538057',
        '          value: 0.048846506',
        '          inSlope: 1.5751183',
        '          outSlope: 1.5751183',
        '        - serializedVersion: 3',
        '          time: 0.5167471',
        '          value: 0.24895507',
        '          inSlope: -0.97325015',
        '          outSlope: -0.97325015',
        '        - serializedVersion: 3',
        '          time: 0.539548',
        '          value: 0.015658569',
        '          inSlope: -0.12692018',
        '          outSlope: -0.12692018',
        '        - serializedVersion: 3',
        '          time: 0.9773914',
        '          value: 0',
        '          inSlope: 0',
        '          outSlope: 0',
        '    y:',
        '      minMaxState: 0',
        '      scalar: 0',
        '    curve:',
        '      minMaxState: 0',
        '      scalar: 0',
        '--- !u!199 &103',
        'ParticleSystemRenderer:',
        '  m_GameObject: {fileID: 100}',
        '  m_Enabled: 1',
        '  m_RenderMode: 4',
        '  m_RenderAlignment: 2',
      ].join('\n'),
      'utf8',
    );
    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'ambarblade_rot_test' });
    const layer = recipe.layers[0];
    assert.ok(layer.rotationOverLifetime?.x?.curve?.length > 10, 'preserves Hermite subdivision along slope-varying tail');

    const scene = new THREE.Scene();
    const meshVfx = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 4 });
    try {
      const slot = meshVfx.spawn({
        mesh: 'quad',
        duration: 5,
        unityMeshRot: true,
        meshAlign: 'local',
        rotX: layer.rotX ?? 1.5708,
        rotY: layer.rotY ?? 0,
        rotZ: layer.rotZ ?? 0,
        rotationOverLifetime: layer.rotationOverLifetime,
      });
      const pos = [0, 0, 0];
      const quat = [0, 0, 0, 1];
      const scale = [1, 1, 1];
      let prevPitch = null;
      const tailPitches = [];
      for (let step = 1; step < 300; step++) {
        meshVfx.update(1 / 60);
        const ok = meshVfx.readSlotTransform(slot, pos, quat, scale);
        assert.equal(ok, true);
        // Pure X rotation quaternion [sin(a/2), 0, 0, cos(a/2)] avoids Euler ±PI/2 gimbal reflection
        const pitch = 2 * Math.atan2(quat[0], quat[3]);
        const age = step / 60;
        if (age >= 2.2) {
          if (prevPitch !== null) {
            assert.ok(
              pitch - prevPitch <= 0.005,
              `chop must not bounce back upward at age=${age.toFixed(2)}s (prev=${prevPitch.toFixed(4)}, curr=${pitch.toFixed(4)})`,
            );
          }
          prevPitch = pitch;
        }
        if (age >= 3.8 && age <= 4.95) tailPitches.push(pitch);
      }
      const expectedSettled = (layer.rotX ?? 1.5708) - (108.27 * Math.PI) / 180;
      for (const p of tailPitches) {
        assert.ok(
          Math.abs(p - expectedSettled) < 0.03,
          `settled pitch (${p.toFixed(4)}) should match Unity Hermite -108.27 deg offset (${expectedSettled.toFixed(4)})`,
        );
      }
    } finally {
      meshVfx.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});




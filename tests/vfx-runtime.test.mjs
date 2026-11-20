import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from '../assets/optional/three/three.module.js';
import { evaluateVfxFidelity } from '../scripts/score-vfx-fidelity.mjs';
import { convertUnityPrefab } from '../scripts/import-unity-vfx.mjs';

import {
  CROWD_STATUS,
  DAMAGE_NUMBER_PRESETS,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  VFX_RENDER_MODE,
  VFX_SHAPE,
  createAtlasParticlePool,
  createCameraShake,
  createCurveLutTable,
  createHitstopClock,
  createMeshVfxPool,
  createStatelessParticlePool,
  createVfxSystem,
  createVisualPrng,
  evaluateAtlasParticlePosition,
  evaluateColorByNumber,
  evaluateColorCurve,
  evaluateScaleByNumber,
  evaluateSizeCurve,
  extractGlyphIndices,
  formatDamageValue,
  getDamagePreset,
  packCrowdAnimStatus,
  packRgb24,
  registerDamagePreset,
  unpackCrowdAnimStatus,
  unpackRgb24Into,
  validateVfxRecipe,
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
    const p2 = normalMesh.geometry.getAttribute('aAtlasP2');
    const p3 = normalMesh.geometry.getAttribute('aAtlasP3');
    const p4 = normalMesh.geometry.getAttribute('aAtlasP4');
    const p5 = normalMesh.geometry.getAttribute('aAtlasP5');
    assert.equal(p2.array[0], 2.5);
    assert.equal(p3.array[2], 3.0);
    assert.equal(p3.array[3], VFX_RENDER_MODE.HORIZONTAL);
    assert.deepEqual(Array.from(p4.array.subarray(0, 4)), Array.from(PROCEDURAL_VFX_ATLAS_REGIONS.fireball_flipbook));
    assert.deepEqual(Array.from(p5.array.subarray(0, 4)), [8, 1, 1, 1]);
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
    const p3 = atlasNormal.geometry.getAttribute('aAtlasP3');
    const p7 = atlasNormal.geometry.getAttribute('aAtlasP7');
    assert.equal(p3.array[3], VFX_RENDER_MODE.VERTICAL);
    assert.equal(p7.array[0], packRgb24(0x33ccff));
    assert.equal(p7.array[1], 1.5);
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
    const p1 = atlasNorm.geometry.getAttribute('aAtlasP1').array;
    const p2 = atlasNorm.geometry.getAttribute('aAtlasP2').array;
    assert.equal(p1[3], 5.0, 'curveCycle layer keeps cycle duration in p1.w');
    assert.ok(p2[3] >= 1024 && p2[3] < 2048, `curveCycle layer packs +1024 row offset (got ${p2[3]})`);
    assert.ok(p2[7] >= 2048, `static persistent layer packs +2048 row offset (got ${p2[7]})`);

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
    const p8 = atlasNorm.geometry.getAttribute('aAtlasP8').array;
    assert.ok(Math.abs(p8[2] - 1.333) < 0.01, `expected billboard aspectY=1.333 packed in aAtlasP8.z (got ${p8[2]})`);
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
    const shardMesh = scene.children.find((c) => c.visible && c !== meshChild && c.geometry);
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
    const p8 = addMesh.geometry.getAttribute('aAtlasP8').array;
    const p9 = addMesh.geometry.getAttribute('aAtlasP9').array;
    assert.ok(Math.abs(p1[3] - 0.5) < 0.01, `simulationSpeed=2 halves duration 1.0->0.5 (got ${p1[3]})`);
    assert.ok(Math.abs(p8[0] - 10.0) < 0.05, `forceX=2.5 * simSpd^2(4) == 10.0 packed in aAtlasP8.x (got ${p8[0]})`);
    assert.ok(Math.abs(p9[0] - 0.7) < 0.01 && Math.abs(p9[1] - 1.1) < 0.01, 'rotation3D rotX/rotY packed in aAtlasP9');
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
    const p8 = multMesh.geometry.getAttribute('aAtlasP8').array;
    const p10 = multMesh.geometry.getAttribute('aAtlasP10').array;
    const p11 = multMesh.geometry.getAttribute('aAtlasP11').array;
    assert.ok(Math.abs(p10[0] - 0.25) < 0.01 && Math.abs(p10[1] + 0.5) < 0.01, 'pivot packed in aAtlasP10.xy');
    assert.ok(Math.abs(p10[2] - 0.25) < 0.01 && Math.abs(p10[3] - 1.5) < 0.01, 'velocityScale/lengthScale packed in aAtlasP10.zw');
    assert.ok(Math.abs(p11[2] - 2.5) < 0.01, 'emissionBoost packed in aAtlasP11.z');
    assert.equal(Math.floor(p8[3] / 524288) % 4, 2, 'cullMode front (2) packed in aAtlasP8.w');

    // Verify unpackRgb24 round-trip on cutoff / camFade / uvScale / dissolve
    const decCut = unpackRgb24Into(p11[0], [0, 0, 0]);
    assert.ok(Math.abs(decCut[0] - 0.45) < 0.02, 'alphaCutoff round-trips in aAtlasP11.x');
    const decUv = unpackRgb24Into(p11[1], [0, 0, 0]);
    assert.ok(Math.abs(decUv[0] * 8 - 2) < 0.1, 'uvScale.x round-trips in aAtlasP11.y');

    // Built-in Unity primitive meshes quad & cube spawn without registerMesh
    assert.equal(vfx.meshVfx.getStats().activeCount, 2, 'built-in quad + cube mesh VFX spawn automatically');

    // Synthetic Unity .prefab + .mat + .meta conversion test
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-parity-'));
    try {
      const texGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const matGuid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const texPath = path.join(tmpDir, 'Spark.png');
      fs.writeFileSync(texPath, '');
      fs.writeFileSync(`${texPath}.meta`, `fileFormatVersion: 2\nguid: ${texGuid}\n`);
      const matPath = path.join(tmpDir, 'MultMat.mat');
      fs.writeFileSync(
        matPath,
        [
          '%YAML 1.1',
          'Material:',
          '  m_SavedProperties:',
          '    m_TexEnvs:',
          '    - _MainTex:',
          `        m_Texture: {fileID: 2800000, guid: ${texGuid}, type: 3}`,
          '        m_Scale: {x: 2, y: 4}',
          '        m_Offset: {x: 0.1, y: 0.25}',
          '    m_Floats:',
          '    - _Blend: 3',
          '    - _Cull: 2',
          '    - _AlphaClip: 1',
          '    - _Cutoff: 0.35',
          '    - _EmissionEnabled: 1',
          '    - _CameraFadingEnabled: 1',
          '    - _CameraNearFadeDistance: 0.5',
          '    - _CameraFarFadeDistance: 2.5',
          '    m_Colors:',
          '    - _TintColor: {r: 1, g: 0.5, b: 0.25, a: 1}',
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
      assert.equal(l.blend, 'multiply', '_Blend: 3 maps to multiply');
      assert.equal(l.cullMode, 'back', '_Cull: 2 maps to back');
      assert.equal(l.alphaCutoff, 0.35, '_AlphaClip + _Cutoff extracted');
      assert.ok(l.emissionBoost > 1.0, '_EmissionEnabled + HDR _EmissionColor sets emissionBoost');
      assert.deepEqual(l.cameraFade, [0.5, 2.5], '_CameraFadingEnabled extracts near/far fade distances');
      assert.deepEqual(l.uvScale, [2, 4], '_MainTex m_Scale extracted');
      assert.deepEqual(l.uvOffset, [0.1, 0.25], '_MainTex m_Offset extracted');
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

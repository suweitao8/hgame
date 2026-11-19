import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';

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
          trail: { lifetime: 0.15, widthOverTrail: 1.0, sizeAffectsWidth: true, inheritColor: true },
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
    dummyTex.dispose();
  } finally {
    vfx.dispose();
  }
});

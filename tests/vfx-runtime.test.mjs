import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';

import {
  CROWD_STATUS,
  DAMAGE_NUMBER_PRESETS,
  VFX_SHAPE,
  createCameraShake,
  createHitstopClock,
  createStatelessParticlePool,
  createVfxSystem,
  createVisualPrng,
  evaluateColorByNumber,
  evaluateScaleByNumber,
  extractGlyphIndices,
  formatDamageValue,
  getDamagePreset,
  packCrowdAnimStatus,
  packRgb24,
  registerDamagePreset,
  unpackCrowdAnimStatus,
  unpackRgb24Into,
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

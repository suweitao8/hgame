import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CROWD_STATUS,
  VFX_SHAPE,
  createCameraShake,
  createHitstopClock,
  createStatelessParticlePool,
  createVfxSystem,
  createVisualPrng,
  extractGlyphIndices,
  packCrowdAnimStatus,
  packRgb24,
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbArcHud, measureHotLoopAllocations } from '../assets/runtime/index.js';
import { createPortraitDrsController } from '../assets/runtime/integrations/quality3d.js';
import { createMaterialBatchRegistry3D } from '../assets/runtime/integrations/material-graph3d.js';

test('Phase T3-C: createPortraitDrsController drops render scale on sustained 24ms overload and recovers cleanly on 11ms frames', () => {
  const drs = createPortraitDrsController({
    width: 390,
    height: 844,
    dpr: 2,
    minScale: 0.72,
    maxScale: 1.0,
    windowFrames: 8,
  });

  const initial = drs.getState();
  assert.equal(initial.scale, 1.0);
  const initWidth = initial.bufferWidth;

  let dropped = false;
  for (let i = 0; i < 16; i++) {
    const res = drs.sample(24.0);
    if (res.changed && res.scale < 1.0) dropped = true;
  }
  assert.equal(dropped, true, 'Overload frames must step down render scale');
  const degraded = drs.getState();
  assert.ok(degraded.scale >= 0.72 && degraded.scale < 1.0);
  assert.ok(degraded.bufferWidth < initWidth);

  let recovered = false;
  for (let i = 0; i < 32; i++) {
    const res = drs.sample(11.0);
    if (res.changed && res.scale > degraded.scale) recovered = true;
  }
  assert.equal(recovered, true, 'Healthy 11ms frames must step up render scale');
  const finalState = drs.getState();
  assert.ok(finalState.scale <= 1.0 && finalState.scale > degraded.scale);
});

test('Phase T3-C: measureHotLoopAllocations validates low-GC hot loops cleanly', () => {
  const drs = createPortraitDrsController({ windowFrames: 16 });
  const batch = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.01 });
  const hud = createThumbArcHud({
    items: [
      { id: 'atk', primary: true },
      { id: 'dash' },
      { id: 'ult' },
    ],
  });
  hud.layout(390, 844);

  const drsOut = { scale: 1, pixelRatio: 1, bufferWidth: 0, bufferHeight: 0, avgFrameMs: 16.6, changed: false };
  const report = measureHotLoopAllocations(() => {
    batch.updateFrame(0.016);
    drs.sample(16.6, drsOut);
    hud.hitTest(338, 758);
  }, { warmup: 300, iterations: 2000, maxHeapBytesPerIter: 512 });

  assert.equal(report.passed, true, `Expected low allocation hot loop, got ${report.bytesPerIter} B/iter`);
  assert.equal(report.iterations, 2000);
  assert.ok(report.avgMs >= 0 && report.p95Ms >= 0);
});

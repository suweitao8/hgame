import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLighting2DState,
  addPolygonOccluder,
  setPolygonOccluders,
} from '../assets/runtime/integrations/post2d.js';
import { createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import { createRenderDiagnostics } from '../assets/runtime/integrations/quality3d/render-diagnostics.js';

test('R1: addPolygonOccluder and setPolygonOccluders decompose closed/open polygons into segments on post2d & adapters', () => {
  const state = createLighting2DState();
  // Square -> 4 edges
  const triAdded = addPolygonOccluder(state, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 80 },
  ]);
  assert.equal(triAdded, 3);
  assert.equal(state.rawOccluderCount, 3);

  // Open polyline L-shape -> 2 edges
  const openAdded = state.addPolygonOccluder([[10, 10], [20, 10], [20, 30]], { closed: false });
  assert.equal(openAdded, 2);
  assert.equal(state.rawOccluderCount, 5);

  // Replace with 2 concave/convex polygons (4 + 5 = 9 edges)
  const total = setPolygonOccluders(state, [
    [[0, 0], [50, 0], [50, 50], [0, 50]],
    { points: [[100, 100], [160, 100], [130, 130], [160, 160], [100, 160]], closed: true },
  ]);
  assert.equal(total, 9);

  // Adapter pass-through
  const canvas = {
    width: 320,
    height: 180,
    clientWidth: 320,
    clientHeight: 180,
    getContext() {
      return {
        save() {}, restore() {}, setTransform() {}, clearRect() {},
        beginPath() {}, rect() {}, clip() {}, fillRect() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        drawImage() {},
      };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const adapter = createCanvas2DAdapter({ canvas, pixelRatio: 1, diagnostics2d: true });
  const count = adapter.setPolygonOccluders2D([[[0, 0], [10, 0], [10, 10], [0, 10]]]);
  assert.equal(count, 4);
  assert.equal(adapter.addPolygonOccluder2D([[20, 20], [30, 20], [30, 30]]), 3);
  assert.equal(adapter.getLighting2DState().occluderCount, 7);
  adapter.dispose();
});

test('P4: createRenderDiagnostics records frame percentile stats and exports valid Chrome Trace JSON', () => {
  let drawCount = 0;
  const diag = createRenderDiagnostics({
    getContext: () => null,
    beginCounters: () => ({
      read: () => ({ calls: drawCount, triangles: drawCount * 100 }),
      stop() {},
    }),
  });

  for (let i = 0; i < 12; i++) {
    assert.equal(diag.beginFrame(), true);
    const stopShadow = diag.beginPass('shadow', null);
    drawCount += 3;
    stopShadow?.();
    const stopMain = diag.beginPass('forward', null);
    drawCount += 7;
    stopMain?.();
    diag.endFrame(true);
  }

  const stats = diag.getFrameStats();
  assert.equal(stats.count, 12);
  assert.ok(stats.p50Ms >= 0);
  assert.ok(stats.p95Ms >= stats.p50Ms);
  assert.ok(stats.p99Ms >= stats.p95Ms);
  assert.ok(stats.maxMs >= stats.p99Ms);
  assert.equal(stats.avgDrawCalls, 10);

  const trace = diag.exportChromeTrace();
  assert.equal(trace.displayTimeUnit, 'ms');
  // 12 frames * (1 frame event + 2 pass events) = 36 events
  assert.equal(trace.traceEvents.length, 36);
  const firstFrame = trace.traceEvents[0];
  assert.equal(firstFrame.ph, 'X');
  assert.equal(firstFrame.cat, 'render');
  assert.equal(firstFrame.args.draws, 10);
  assert.ok(firstFrame.dur >= 1);
});

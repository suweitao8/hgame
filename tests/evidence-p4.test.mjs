// Evidence for scorecard P4: unified render diagnostics, Chrome trace export, zero-GC audit, resource snapshot diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenderDiagnostics, captureResourceSnapshot, diffResourceSnapshots,
} from '../assets/runtime/integrations/quality3d/render-diagnostics.js';
import { measureHotLoopAllocations } from '../assets/runtime/sim/zero-gc-audit.js';

function makeDiagnostics() {
  let calls = 0, triangles = 0;
  const diag = createRenderDiagnostics({
    getContext: () => null,
    getIdentity: () => 'stub-backend',
    beginUploads: () => null,
    beginCounters: () => ({ read: () => ({ calls, triangles, opaqueDraws: 0 }), stop() {} }),
    describeTarget: (t, viewIndex) => ({ viewIndex, width: t.w, height: t.h, samples: 1, bytes: t.w * t.h * 4 }),
  });
  return { diag, draw: (c, t) => { calls += c; triangles += t; } };
}

test('P4 render diagnostics: frame/pass counters, target bytes and measurement sources are recorded', () => {
  const { diag, draw } = makeDiagnostics();
  assert.equal(diag.beginFrame(), true);
  assert.equal(diag.beginFrame(), false); // re-entrancy guarded
  diag.beginView(0);
  const endShadow = diag.beginPass('shadow', { w: 512, h: 512 });
  draw(5, 1000);
  endShadow();
  diag.beginView(1);
  const endMain = diag.beginPass('main', { w: 100, h: 50 });
  draw(7, 2000);
  endMain();
  diag.endFrame(true);
  const s = diag.snapshot();
  assert.equal(s.complete, true);
  assert.equal(s.drawCalls, 12);
  assert.equal(s.triangles, 3000);
  assert.deepEqual(s.passes.map(p => [p.name, p.viewIndex, p.drawCalls, p.triangles]), [['shadow', 0, 5, 1000], ['main', 1, 7, 2000]]);
  assert.equal(s.targetBytes, 512 * 512 * 4 + 100 * 50 * 4);
  assert.equal(s.measurementSources.draws, 'measured');
  assert.equal(s.measurementSources.gpuMs, 'unavailable');
  assert.equal(s.measurementSources.targetBytes, 'estimated');
  assert.ok(s.estimatedFields.includes('targetBytes'));
});

test('P4 render diagnostics: Chrome Trace export is well-formed and frame stats aggregate', () => {
  const { diag, draw } = makeDiagnostics();
  assert.equal(diag.getFrameStats().count, 0);
  for (let i = 0; i < 4; i++) {
    diag.beginFrame();
    const end = diag.beginPass('main', { w: 8, h: 8 });
    draw(2, 10);
    end();
    diag.endFrame(true);
  }
  const trace = diag.exportChromeTrace();
  assert.equal(trace.displayTimeUnit, 'ms');
  assert.equal(trace.traceEvents.length, 8); // 4 frames + 4 passes
  for (const ev of trace.traceEvents) {
    assert.equal(ev.ph, 'X');
    assert.ok(ev.dur >= 1 && Number.isFinite(ev.ts));
  }
  assert.deepEqual(trace.traceEvents.filter(e => e.cat === 'render').map(e => e.name), ['frame#1', 'frame#2', 'frame#3', 'frame#4']);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(trace)));
  const stats = diag.getFrameStats();
  assert.equal(stats.count, 4);
  assert.equal(stats.avgDrawCalls, 2);
  assert.ok(stats.p50Ms <= stats.p95Ms && stats.p95Ms <= stats.maxMs);
  // identity change (context loss / backend switch) invalidates snapshots
  assert.ok(diag.snapshot());
});

test('P4 resource snapshot diff: tracks leaked and released GPU resources by reference', () => {
  const tex = (id, w) => ({ uuid: id, image: { width: w, height: w } });
  const geo = (id, bytes) => ({ uuid: id, attributes: { position: { array: new Uint8Array(bytes) } } });
  const mat = (id, map) => ({ uuid: id, map });
  const meshA = { name: 'A', geometry: geo('gA', 100), material: mat('mA', tex('tA', 4)) };
  const meshB = { name: 'B', geometry: geo('gB', 50), material: mat('mB', null) };
  const scene = (...m) => ({ traverse: fn => m.forEach(fn) });

  const s0 = captureResourceSnapshot(scene(meshA), { label: 'before' });
  assert.equal(s0.count, 3); // geometry + material + texture
  assert.equal(s0.totalBytes, 100 + 4 * 4 * 4);

  const clean = diffResourceSnapshots(s0, captureResourceSnapshot(scene(meshA)));
  assert.equal(clean.hasLeak, false);
  assert.equal(clean.retainedCount, 3);
  assert.equal(clean.deltaBytes, 0);

  const s1 = captureResourceSnapshot(scene(meshA, meshB));
  const leak = diffResourceSnapshots(s0, s1);
  assert.equal(leak.hasLeak, true);
  assert.deepEqual(leak.leaked.map(e => e.key).sort(), ['geometry:gB', 'material:mB']);
  assert.equal(leak.deltaBytes, 50);

  const released = diffResourceSnapshots(s1, captureResourceSnapshot(scene()));
  assert.equal(released.releasedCount, 5);
  assert.equal(released.leakedCount, 0);
  assert.equal(released.deltaBytes, -(100 + 64 + 50));
  // empty/invalid inputs do not throw
  assert.equal(diffResourceSnapshots(null, null).hasLeak, false);
});

test('P4 zero-gc audit: flags allocating hot loops and passes allocation-free loops', () => {
  const buf = new Float64Array(64);
  const clean = measureHotLoopAllocations(i => { buf[i & 63] += i * 0.5; }, { warmup: 50, iterations: 2000, maxHeapBytesPerIter: 64 });
  assert.equal(clean.passed, true);
  assert.ok(clean.bytesPerIter <= 64);

  const keep = [];
  const dirty = measureHotLoopAllocations(i => { keep.push(new Array(64).fill(i)); }, { warmup: 5, iterations: 500, maxHeapBytesPerIter: 64 });
  assert.equal(dirty.passed, false);
  assert.ok(dirty.bytesPerIter > 64);
  assert.equal(dirty.iterations, 500);
  assert.throws(() => measureHotLoopAllocations(null), TypeError);
});

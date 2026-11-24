// Evidence for scorecard P3: frame budget controllers, shader warmup queue, VRAM guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveQualityController, createShaderWarmupQueue3D, resolveQualityPreset } from '../assets/runtime/integrations/quality3d.js';
import { createRenderBudgetController, RENDER_RESOURCE_TYPES_2D } from '../assets/runtime/integrations/render-budget-2d.js';
import { createVramMipGuard } from '../assets/runtime/platform/asset-catalog.js';

function feed(ctrl, ms, frames) {
  let changed = 0;
  for (let i = 0; i < frames; i++) if (ctrl.sampleFrame(ms)) changed++;
  return changed;
}

test('P3 adaptive quality: sustained slow frames degrade scale then tier; fast frames recover; hitches are ignored', () => {
  const changes = [];
  const ctrl = createAdaptiveQualityController({
    mode: 'auto', device: {}, settleMs: 0, settleAfterChangeMs: 0, sampleFrames: 10,
    onChange: (s, reason) => changes.push(reason),
  });
  const start = ctrl.state;
  assert.equal(start.dynamicScale, 1);
  // 40ms frames: step down 0.2 per window until the 0.6 floor
  assert.equal(feed(ctrl, 40, 10), 1);
  assert.equal(ctrl.state.dynamicScale, 0.8);
  feed(ctrl, 40, 20);
  assert.equal(ctrl.state.dynamicScale, 0.6);
  // at floor, repeated slow windows lower the tier
  const tierBefore = ctrl.state.tier;
  feed(ctrl, 40, 50);
  if (tierBefore !== 'low') {
    assert.notEqual(ctrl.state.tier, tierBefore);
    assert.ok(changes.includes('tier'));
  }
  assert.ok(ctrl.state.transitionCount >= 3);
  // 300ms hitch must not count as a sample and is tallied separately
  const dropped = ctrl.state.droppedLongFrames;
  assert.equal(ctrl.sampleFrame(300), false);
  assert.equal(ctrl.state.droppedLongFrames, dropped + 1);
  // fast frames: scale recovers
  const scaleLow = ctrl.state.dynamicScale;
  for (let i = 0; i < 40; i++) { feed(ctrl, 8, 10); }
  assert.ok(ctrl.state.dynamicScale > scaleLow);
});

test('P3 adaptive quality: manual mode never auto-degrades; invalid config rejected', () => {
  const ctrl = createAdaptiveQualityController({ mode: 'high', settleMs: 0, sampleFrames: 5 });
  assert.equal(feed(ctrl, 60, 50), 0);
  assert.equal(ctrl.state.tier, 'high');
  assert.throws(() => createAdaptiveQualityController({ mode: 'bogus' }), RangeError);
  assert.throws(() => createAdaptiveQualityController({ degradeFrameMs: 10, recoverFrameMs: 17 }), RangeError);
  assert.ok(resolveQualityPreset('low', '3d'));
});

test('P3 render-budget-2d: memory pressure evicts low-priority idle resources first; idle TTL and frame pressure reclaim', () => {
  assert.ok(RENDER_RESOURCE_TYPES_2D.includes('postTargets'));
  const reclaimed = [];
  const ctrl = createRenderBudgetController({ maxBytes: 1000, idleFrames: 5, frameBudgetMs: 16 });
  const reg = (id, type, bytes, priority) => ctrl.registerResource({
    id, type, bytes, priority, reclaim: reason => { reclaimed.push([id, reason]); return bytes; },
  });
  reg('hi', 'atlasCache', 400, 10);
  reg('lo', 'textCache', 400, 0);
  reg('mid', 'postTargets', 400, 5);
  ctrl.stepFrame(); // frame 0: everything touched this frame, nothing evictable yet
  assert.equal(reclaimed.length, 0);
  ctrl.stepFrame(); // now over budget (1200 > 1000): lowest priority goes first
  assert.deepEqual(reclaimed[0], ['lo', 'memory-budget']);
  assert.equal(reclaimed.length, 1);
  assert.equal(ctrl.getBudgetSnapshot().totalBytes, 800);
  ctrl.touch('hi');
  for (let i = 0; i < 6; i++) ctrl.stepFrame();
  assert.ok(reclaimed.some(([id, r]) => r === 'idle-ttl'));
  assert.throws(() => ctrl.registerResource({ id: 'x', type: 'bogus', reclaim() {} }), RangeError);
  const freed = ctrl.reclaimAll();
  assert.ok(freed >= 0);
  assert.equal(ctrl.getBudgetSnapshot().resourceCount, 0);
});

test('P3 shader warmup: compiles in frame-budgeted slices and never recompiles a material', () => {
  let t = 0;
  const compiled = [];
  const renderer = { compile: obj => { compiled.push(obj.material); t += 1; } };
  const mats = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const THREE = {};
  const q = createShaderWarmupQueue3D(THREE, renderer, { budgetMsPerFrame: 3, now: () => t });
  assert.equal(q.enqueueMaterials(mats, {}), 10);
  const s1 = q.step();
  assert.ok(s1.compiled >= 1 && s1.compiled < 10, 'sliced, not all at once');
  assert.equal(s1.done, false);
  assert.equal(s1.remaining, 10 - s1.compiled);
  let guard = 0;
  while (!q.step().done && guard++ < 20);
  assert.equal(compiled.length, 10);
  assert.equal(q.enqueueMaterials(mats, {}), 0); // already compiled
  assert.throws(() => createShaderWarmupQueue3D(null, renderer), TypeError);
  // failure isolation
  const bad = createShaderWarmupQueue3D(THREE, { compile() { throw new Error('x'); } }, { now: () => 0 });
  bad.enqueueMaterials([{}], {});
  assert.equal(bad.step().failed, 1);
});

test('P3 VRAM mip guard: soft/hard thresholds raise mip bias with hysteresis and notify the streaming policy', () => {
  const biasLog = [];
  const policy = { setGlobalMipBias: b => biasLog.push(b) };
  const guard = createVramMipGuard({ streamingPolicy: policy, budgetBytes: 1e6 });
  assert.deepEqual(guard.step(500e3), { mipBiasOffset: 0, state: 'healthy', ratio: 0.5, changed: false });
  const soft = guard.step(850e3);
  assert.equal(soft.state, 'soft-degrade');
  assert.equal(soft.mipBiasOffset, 1);
  const hard = guard.step(950e3);
  assert.equal(hard.state, 'hard-degrade');
  assert.equal(hard.mipBiasOffset, 2);
  assert.equal(guard.step(950e3).changed, false); // no spam
  const rec = guard.step(300e3);
  assert.equal(rec.state, 'healthy');
  assert.equal(rec.mipBiasOffset, 0);
  assert.deepEqual(biasLog, [1, 2, 0]);
  assert.equal(guard.getState().budgetBytes, 1e6);
  // per-call budget override
  assert.equal(guard.step(480e3, 500e3).state, 'hard-degrade');
});

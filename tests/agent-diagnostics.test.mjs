import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, defineProject, resolveFeatureGraph } from '../assets/runtime/index.js';

test('diagnostics snapshot exposes frame-time distribution as plain JSON-able data', () => {
  const d = createDiagnostics({ windowRef: null });
  let t = 0;
  for (let i = 0; i < 40; i++) d.recordFrame(t += i === 20 ? 120 : 16);
  const s = d.snapshot();
  assert.equal(s.longFrames, 1);
  assert.equal(s.frameTimeMaxMs, 120);
  assert.ok(s.frameTimeP95Ms >= 16);
  assert.doesNotThrow(() => JSON.stringify(s));
  d.dispose();
});

test('config errors tell the agent how to fix them', () => {
  assert.throws(() => defineProject({ profile: '2d', tickHzz: 60 }), /Valid fields: .*Did you mean "tickHz"\?/);
  assert.throws(() => defineProject({ profile: '4d' }), /Use one of: 2d, 3d, ui/);
  assert.throws(() => defineProject({ profile: '2d', features: ['audi'] }), /Valid features: .*Did you mean "audio"\?/);
  assert.throws(() => resolveFeatureGraph(['nope'], { a: [] }), /Known: a/);
});

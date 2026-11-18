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

test('gameplay diagnostics retain a bounded chronological event trace', () => {
  const d = createDiagnostics({ windowRef: null, eventCapacity: 2 });
  d.recordEvent({ tick: 0, type: 'run.started', subject: 'arena' });
  const details = { enemy: 4 };
  d.recordEvent({ tick: 20, type: 'beacon.blocked', subject: 'beacon:1', details });
  details.enemy = 12;
  d.recordEvent({ tick: 21, type: 'player.damaged', subject: 'player', details: { hp: 91 } });
  assert.deepEqual(d.readEvents(), {
    dropped: 1,
    events: [
      { tick: 20, type: 'beacon.blocked', subject: 'beacon:1', details: { enemy: 4 } },
      { tick: 21, type: 'player.damaged', subject: 'player', details: { hp: 91 } },
    ],
  });
  d.dispose();
  assert.equal(d.recordEvent({ tick: 22, type: 'run.finished', subject: 'arena' }), false);
  assert.deepEqual(d.readEvents(), { dropped: 0, events: [] });
});

test('config errors tell the agent how to fix them', () => {
  assert.throws(() => defineProject({ profile: '2d', tickHzz: 60 }), /Valid fields: .*Did you mean "tickHz"\?/);
  assert.throws(() => defineProject({ profile: '4d' }), /Use one of: 2d, 3d, ui/);
  assert.throws(() => defineProject({ profile: '2d', features: ['audi'] }), /Valid features: .*Did you mean "audio"\?/);
  assert.throws(() => resolveFeatureGraph(['nope'], { a: [] }), /Known: a/);
});

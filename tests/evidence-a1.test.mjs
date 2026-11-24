// Scorecard A1 evidence: fixed-step scheduler, renderAlpha, scene hot-reload + atomic rollback, leak diffing.
// Headless note: real-GPU multi-scene leak measurement is browser-only; we test the pure diff + lifecycle logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameApplication, defineProject, Scene } from '../assets/runtime/index.js';
import { createHotReloadController } from '../assets/runtime/core/scene.js';
import { captureResourceSnapshot, diffResourceSnapshots }
  from '../assets/runtime/integrations/quality3d/render-diagnostics.js';

function makeApp(tickHz = 60, extra = {}) {
  const project = defineProject({ profile: '2d', tickHz, features: ['scene'] });
  const platform = { input: { reset() {}, endFrame() {} }, lifecycle: { on() { return () => {}; } },
    ready() {}, dispose() {}, diagnostics: { recordFrame() {}, reportError() {} } };
  const renders = [];
  const renderer = { render(scene) { renders.push(scene.name); }, resize() {} };
  const app = createGameApplication({ project, platform, renderer,
    requestFrame() { return 1; }, cancelFrame() {}, ...extra });
  return { app, renders };
}

test('fixed-step: ticks are deterministic and independent of frame slicing; renderAlpha is the remainder', () => {
  const run = (frames) => {
    const { app } = makeApp(60);
    let fixed = 0;
    class S extends Scene { fixedUpdate() { fixed++; } }
    app.scenes.add(new S('s')); app.scenes.start('s');
    for (const dt of frames) app.step(dt);
    const out = { fixed, ticks: app.stats.ticks, alpha: app.renderAlpha };
    app.dispose();
    return out;
  };
  const a = run(Array(60).fill(1 / 60));
  const b = run(Array(120).fill(1 / 120));
  assert.equal(a.fixed, 60);
  assert.equal(b.fixed, 60);
  assert.equal(a.ticks, a.fixed);
  // 2.5 fixed steps -> 2 ticks, alpha 0.5
  const c = run([2.5 / 60]);
  assert.equal(c.fixed, 2);
  assert.ok(Math.abs(c.alpha - 0.5) < 1e-6, `alpha=${c.alpha}`);
  assert.ok(c.alpha >= 0 && c.alpha <= 1);
});

test('fixed-step: spiral of death is bounded by maxSubSteps/maxDelta and counted as dropped', () => {
  const { app } = makeApp(60, { maxSubSteps: 3, maxDelta: 10 });
  let fixed = 0;
  class S extends Scene { fixedUpdate() { fixed++; } }
  app.scenes.add(new S('s')); app.scenes.start('s');
  app.step(1); // 60 owed ticks, only 3 allowed
  assert.equal(fixed, 3);
  assert.equal(app.stats.droppedTicks, 57);
  assert.ok(app.renderAlpha < 1e-6);
  app.dispose();
});

test('time scale and hitStop scale the simulated delta deterministically', () => {
  const { app } = makeApp(60);
  let fixed = 0;
  class S extends Scene { fixedUpdate() { fixed++; } }
  app.scenes.add(new S('s')); app.scenes.start('s');
  app.setTimeScale(0.5);
  for (let i = 0; i < 60; i++) app.step(1 / 60);
  assert.equal(fixed, 30);
  app.setTimeScale(1).hitStop(0.5);
  const before = fixed;
  for (let i = 0; i < 30; i++) app.step(1 / 60); // 0.5s fully frozen
  assert.equal(fixed, before);
  assert.ok(app.hitStopRemaining < 1e-9);
  app.step(1 / 60);
  assert.equal(fixed, before + 1);
  assert.throws(() => app.setTimeScale(-1), RangeError);
  app.dispose();
});

test('scene hot-reload preserves state and rolls back atomically when the new factory throws', () => {
  const { app } = makeApp(60);
  const log = [];
  class V1 extends Scene {
    constructor() { super('level'); this.score = 0; }
    enter() { log.push('enter-v1'); }
    exit() { log.push('exit-v1'); }
    serializeState() { return { score: this.score }; }
    restoreState(s) { this.score = s.score; }
  }
  const v1 = new V1(); v1.score = 42;
  app.scenes.add(v1); app.scenes.start('level');
  const hot = createHotReloadController(app.scenes);

  class V2 extends V1 { enter() { log.push('enter-v2'); } }
  const res = hot.reload('level', () => new V2());
  assert.equal(res.ok, true);
  assert.equal(res.rolledBack, false);
  assert.equal(app.scenes.current, res.scene);
  assert.equal(res.scene.score, 42, 'state carried across reload');
  assert.deepEqual(log.filter(x => x === 'enter-v2'), ['enter-v2']);

  assert.throws(() => hot.reload('level', () => { throw new Error('boom'); }), /boom/);
  assert.ok(app.scenes.get('level'), 'scene still registered after failed reload');
  assert.equal(app.scenes.current, res.scene, 'previous scene remains active after factory failure');
  assert.equal(hot.getStats().reloadCount, 1, 'failed reload not counted');

  assert.throws(() => hot.reload('level', () => new Scene('wrong-name')), TypeError);
  assert.equal(app.scenes.current, res.scene);
  app.dispose();
});

test('multi-scene switching runs enter/exit exactly once each in order and aborts the old activation signal', () => {
  const { app } = makeApp(60);
  const log = [];
  const mk = (n) => {
    const s = new Scene(n);
    s.enter = () => log.push('enter:' + n);
    s.exit = () => log.push('exit:' + n);
    return s;
  };
  app.scenes.add(mk('a')); app.scenes.add(mk('b'));
  app.scenes.start('a');
  const sigA = app.scenes.current.activationSignal;
  for (let i = 0; i < 5; i++) { app.scenes.start('b'); app.scenes.start('a'); }
  assert.equal(sigA.aborted, true);
  assert.equal(log.filter(x => x === 'enter:a').length, log.filter(x => x === 'exit:a').length + 1);
  assert.equal(log.filter(x => x === 'enter:b').length, log.filter(x => x === 'exit:b').length);
  assert.equal(app.scenes.start('a'), false, 'restarting current scene is a no-op');
  app.dispose();
});

test('diffResourceSnapshots detects leaked vs released GPU-like resources (pure logic)', () => {
  const geo = (id, n) => ({ uuid: id, attributes: { position: { array: new Float32Array(n) } } });
  const mat = (id) => ({ uuid: id });
  const node = (name, g, m) => ({ name, geometry: g, material: m });
  const worldOf = (...nodes) => ({ traverse(fn) { nodes.forEach(fn); } });
  const g1 = geo('g1', 30), g2 = geo('g2', 60), m1 = mat('m1');
  const before = captureResourceSnapshot(worldOf(node('a', g1, m1)), { label: 'before' });
  const clean = captureResourceSnapshot(worldOf(node('a', g1, m1)), { label: 'after-clean' });
  const d0 = diffResourceSnapshots(before, clean);
  assert.equal(d0.hasLeak, false);
  assert.equal(d0.deltaBytes, 0);

  const leaky = captureResourceSnapshot(worldOf(node('a', g1, m1), node('b', g2, m1)), { label: 'leak' });
  const d1 = diffResourceSnapshots(before, leaky);
  assert.equal(d1.hasLeak, true);
  assert.equal(d1.leakedCount, 1);
  assert.equal(d1.deltaBytes, 60 * 4);

  const released = captureResourceSnapshot(worldOf(node('b', g2, m1)));
  const d2 = diffResourceSnapshots(before, released);
  assert.equal(d2.releasedCount, 1);
  assert.equal(d2.leakedCount, 1);
});

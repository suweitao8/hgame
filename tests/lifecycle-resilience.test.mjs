import test from 'node:test';
import assert from 'node:assert/strict';
import { Component, Entity, Scene, createGameApplication, createGameEngine, createInputManager } from '../assets/runtime/index.js';

function scheduler() {
  let next = 0;
  const pending = new Map();
  return {
    pending,
    requestFrame(callback) { const id = ++next; pending.set(id, callback); return id; },
    cancelFrame(id) { pending.delete(id); },
    advance(time) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

test('frame extensions have ordered checkpoints and defer registrations until the next invocation', () => {
  const calls = [];
  class Play extends Scene {
    fixedUpdate() { calls.push('fixed'); }
    update() { calls.push('update'); }
    lateUpdate() { calls.push('late'); }
  }
  const app = createGameApplication({ renderer: { render() { calls.push('render'); } } });
  const scene = app.scenes.add(new Play('play'));
  scene.physics = { step() { calls.push('physics'); } };
  app.scenes.start('play');
  const remove = app.onPhase('beforeFixedUpdate', () => calls.push('remove'), { order: 5 });
  app.onPhase('beforeFixedUpdate', ({ app: owner, scene: current, signal, deltaSeconds }) => {
    assert.equal(owner, app);
    assert.equal(current, scene);
    assert.equal(signal, scene.activationSignal);
    assert.equal(deltaSeconds, 1 / 60);
    calls.push('first');
    if (remove()) app.onPhase('beforeFixedUpdate', () => calls.push('next'), { order: -5 });
  }, { order: -4, signal: scene.activationSignal });
  app.onPhase('beforeFixedUpdate', () => calls.push('second'), { order: -4 });
  for (const phase of ['afterPhysics', 'beforeUpdate', 'beforeLateUpdate', 'beforeRender', 'afterRender']) {
    app.onPhase(phase, () => calls.push(phase));
  }
  app.step(2 / 60);
  assert.deepEqual(calls, [
    'first', 'second', 'fixed', 'physics', 'afterPhysics',
    'next', 'first', 'second', 'fixed', 'physics', 'afterPhysics',
    'beforeUpdate', 'update', 'beforeLateUpdate', 'late', 'beforeRender', 'render', 'afterRender',
  ]);
  assert.equal(app.stats.ticks, 2);
  app.dispose();
});

test('scene activation signals end before exit and prepared rollback preserves the current activation', () => {
  const calls = [];
  let candidateSignal;
  class Candidate extends Scene {
    enter() {
      candidateSignal = this.activationSignal;
      candidateSignal.addEventListener('abort', () => calls.push('candidate-abort'));
    }
    exit() { calls.push('candidate-exit'); }
  }
  class Playing extends Scene { exit() { calls.push('exit'); } }
  const app = createGameApplication({ renderer: { render() {} } });
  const scene = app.scenes.add(new Playing('play'));
  const next = app.scenes.add(new Candidate('next'));
  scene.add(new Entity()).addComponent(new class extends Component {
    onDisable() { calls.push('disable'); }
  }());
  app.scenes.start(scene.name);
  const firstSignal = scene.activationSignal;
  firstSignal.addEventListener('abort', () => calls.push('abort'));
  const remove = app.onPhase('beforeUpdate', () => calls.push('old-hook'), { signal: firstSignal });
  let checks = 0;
  assert.throws(() => app.scenes.activatePrepared(next.name, undefined, () => ++checks === 1), { name: 'AbortError' });
  assert.equal(app.scenes.current, scene);
  assert.equal(firstSignal.aborted, false);
  assert.equal(candidateSignal.aborted, true);
  assert.equal(next.activationSignal, null);
  assert.deepEqual(calls, ['candidate-abort', 'candidate-exit']);
  assert.equal(app.scenes.start(next.name), true);
  assert.equal(firstSignal.aborted, true);
  assert.equal(remove(), false);
  assert.deepEqual(calls, ['candidate-abort', 'candidate-exit', 'abort', 'disable', 'exit']);
  assert.equal(app.scenes.start(scene.name), true);
  assert.notEqual(scene.activationSignal, firstSignal);
  app.step(0);
  assert.equal(calls.includes('old-hook'), false);
  const resumedSignal = scene.activationSignal;
  app.onPhase('beforeUpdate', () => {
    app.scenes.start(next.name);
    app.scenes.start(scene.name);
  }, { signal: resumedSignal });
  app.onPhase('beforeUpdate', () => calls.push('stale-phase'), { order: 1 });
  app.step(0);
  assert.equal(resumedSignal.aborted, true);
  assert.equal(calls.includes('stale-phase'), false);
  app.dispose();

  const guarded = createGameApplication({ renderer: { render() {} } });
  guarded.scenes.add(new Scene('old'));
  let guardedEntries = 0;
  guarded.scenes.add(new class extends Scene { enter() { guardedEntries++; } }('guarded'));
  guarded.scenes.start('old');
  assert.equal(guarded.scenes.activatePrepared('guarded', undefined, () => { guarded.dispose(); return true; }).changed, false);
  assert.equal(guardedEntries, 0);
});

test('scene teardown calls exit once during reentrant disposal and rolls back a failed entry', () => {
  let exits = 0;
  class Leaving extends Scene { exit(app) { exits++; app.dispose(); } }
  const app = createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Leaving('first'));
  app.scenes.add(new Scene('next'));
  app.scenes.start('first');
  assert.equal(app.scenes.start('next'), false);
  assert.equal(exits, 1);
  assert.equal(app.scenes.current, null);

  let failedSignal;
  let failedExits = 0;
  class Failed extends Scene {
    enter() { failedSignal = this.activationSignal; throw new Error('enter failed'); }
    exit() { failedExits++; }
  }
  const retry = createGameApplication({ renderer: { render() {} } });
  const failed = retry.scenes.add(new Failed('failed'));
  retry.scenes.add(new Scene('healthy'));
  assert.throws(() => retry.scenes.start('failed'), /enter failed/);
  assert.equal(failed.active, false);
  assert.equal(failedSignal.aborted, true);
  assert.equal(failedExits, 1);
  assert.equal(retry.scenes.current, null);
  assert.equal(retry.scenes.start('healthy'), true);
  retry.dispose();
});

test('command driven rendering uses the common phase sequence without nesting', () => {
  const calls = [];
  const clock = scheduler();
  let value = 0;
  class Menu extends Scene { onCommand() { calls.push('command'); value++; } }
  const app = createGameApplication({ ...clock, project: { profile: 'ui', tickHz: 0 },
    renderer: { render() { calls.push('render:' + value); } } });
  app.scenes.add(new Menu('menu'));
  app.scenes.start('menu');
  app.onPhase('beforeRender', ({ deltaSeconds }) => {
    assert.equal(deltaSeconds, 0);
    calls.push('before');
    assert.throws(() => app.step(0), /frame.*progress/i);
  });
  const remove = app.onPhase('afterRender', () => {
    calls.push('after');
    remove();
    app.dispatch({ type: 'from-render' });
    app.dispatch({ type: 'from-render' });
  });
  app.start();
  assert.deepEqual(calls, ['before', 'render:0', 'after', 'command', 'command']);
  assert.equal(clock.pending.size, 1);
  clock.advance(16);
  assert.deepEqual(calls.slice(-2), ['before', 'render:2']);
  app.dispatch({ type: 'outer' });
  assert.deepEqual(calls.slice(-3), ['command', 'before', 'render:3']);
  assert.equal(clock.pending.size, 0);
  app.dispose();
});

test('scene exit follows abort and all component disables even when deactivation disposes the app', () => {
  const transitions = [
    scenes => scenes.start('next'),
    scenes => scenes.activatePrepared('next'),
    scenes => scenes.remove('old'),
  ];
  for (const [transition, disposeAt] of transitions.flatMap(action => ['abort', 'disable'].map(phase => [action, phase]))) {
    const calls = [];
    class Leaving extends Scene { exit() { calls.push('exit'); } }
    const app = createGameApplication({ renderer: { render() {}, dispose() { calls.push('renderer-dispose'); } } });
    const scene = app.scenes.add(new Leaving('old'));
    app.scenes.add(new Scene('next'));
    for (const id of ['first', 'second']) {
      scene.add(new Entity()).addComponent(new class extends Component {
        onDisable() { calls.push(id + '-disable'); if (id === 'first' && disposeAt === 'disable') app.dispose(); }
        onDestroy() { calls.push(id + '-destroy'); }
      }());
    }
    scene.onDispose(() => calls.push('scene-cleanup'));
    app.scenes.start('old');
    scene.activationSignal.addEventListener('abort', () => { calls.push('abort'); if (disposeAt === 'abort') app.dispose(); });
    transition(app.scenes);
    assert.equal(app.disposed, true);
    assert.deepEqual(calls, [
      'abort', 'first-disable', 'second-disable', 'exit', 'first-destroy', 'second-destroy', 'scene-cleanup', 'renderer-dispose',
    ]);
  }
});

test('phase callbacks stop when an earlier abort listener blocks event propagation', () => {
  const owner = new AbortController();
  owner.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  const app = createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Scene('play'));
  app.scenes.start('play');
  let calls = 0;
  app.onPhase('beforeUpdate', () => calls++, { signal: owner.signal });
  owner.abort();
  app.step(0);
  assert.equal(calls, 0);
  app.dispose();
});

for (const checkpoint of ['before installation starts', 'during an awaited feature import']) {
  test(`disposing ${checkpoint} rejects installation without restoring services`, async () => {
    const app = createGameApplication({ project: { profile: '2d', features: ['scene', 'input', 'animation2d'] }, renderer: { render() {} } });
    app.scenes.add(new Scene('main'));
    const pending = [app.installFeatures(), app.installFeatures()];
    if (checkpoint.startsWith('during')) await Promise.resolve();
    app.dispose();
    await Promise.all(pending.map(installation => assert.rejects(installation, /disposed/i)));
    assert.deepEqual(Object.keys(app.services), []);
    assert.equal(app.scenes.registry.size, 0);
    assert.equal(app.start(), false);
  });
}

test('disposal inside fixedUpdate terminates the current step without late work', () => {
  const calls = [];
  class Quit extends Component {
    fixedUpdate(_dt, app) { calls.push('fixed'); app.dispose(); }
    update() { calls.push('update'); }
    lateUpdate() { calls.push('late'); }
    onDestroy() { calls.push('destroy'); }
  }
  const app = createGameApplication({ renderer: { render() { calls.push('render'); }, dispose() { calls.push('renderer-dispose'); } } });
  const scene = app.scenes.add(new Scene('main'));
  scene.add(new Entity()).addComponent(new Quit());
  app.scenes.start('main');
  assert.doesNotThrow(() => app.step(1 / 60));
  assert.deepEqual(calls, ['fixed', 'destroy', 'renderer-dispose']);
  assert.equal(app.dispose(), false);
  assert.equal(app.start(), false);
  assert.throws(() => app.step(0), /disposed/);
  assert.throws(() => app.scenes.add(new Scene('revived')), /disposed/);
});

test('cleanup failures still destroy sibling trees, release the platform and cancel scheduled work', () => {
  const clock = scheduler();
  let destroyed = 0;
  let rendererDisposals = 0;
  class Failing extends Component {
    onDisable() { throw new Error('disable-failed'); }
    onDestroy() { throw new Error('destroy-failed'); }
  }
  class Healthy extends Component { onDestroy() { destroyed++; } }
  class FailingScene extends Scene { exit() { throw new Error('exit-failed'); } }
  const app = createGameApplication({ ...clock, renderer: { render() {}, dispose() { rendererDisposals++; throw new Error('renderer-failed'); } } });
  const first = app.scenes.add(new FailingScene('first'));
  const second = app.scenes.add(new Scene('second'));
  const parent = first.add(new Entity());
  const child = parent.add(new Entity());
  const failing = child.addComponent(new Failing());
  parent.addComponent(new Healthy());
  second.add(new Entity()).addComponent(new Healthy());
  app.scenes.start('first');
  app.start();
  assert.equal(clock.pending.size, 1);
  const messages = error => [error.message, ...(error.errors ?? []).flatMap(messages)];
  assert.throws(() => app.dispose(), error => {
    assert.ok(error instanceof AggregateError);
    const all = messages(error);
    for (const expected of ['disable-failed', 'destroy-failed', 'exit-failed', 'renderer-failed']) assert.ok(all.includes(expected), all.join('\n'));
    return true;
  });
  assert.equal(destroyed, 2);
  assert.equal(parent.destroyed, true);
  assert.equal(child.destroyed, true);
  assert.equal(failing.entity, null);
  assert.equal(first.objects.length, 0);
  assert.equal(second.objects.length, 0);
  assert.equal(app.scenes.registry.size, 0);
  assert.equal(app.scenes.current, null);
  assert.equal(clock.pending.size, 0);
  assert.equal(rendererDisposals, 1);
  assert.equal(app.platform.dispose(), false);
  assert.equal(app.dispose(), false);
});

test('a throwing platform disposal listener does not leave browser input attached', () => {
  const target = new EventTarget();
  const platform = createGameEngine({ gameId: 'cleanup-test', windowRef: target, storage: null });
  const failure = new Error('platform-dispose-hook');
  const unsubscribe = platform.lifecycle.on('dispose', () => { throw failure; });
  const press = () => {
    const event = new Event('keydown');
    Object.defineProperty(event, 'code', { value: 'KeyD' });
    target.dispatchEvent(event);
  };
  press();
  assert.equal(platform.input.isDown('KeyD'), true);
  assert.throws(() => platform.dispose(), error => error === failure || error.errors?.includes(failure));
  assert.equal(platform.input.isDown('KeyD'), false, 'held key released during cleanup');
  press();
  assert.equal(platform.input.isDown('KeyD'), false, 'disposed input no longer receives browser events');
  assert.equal(platform.dispose(), false);
  assert.equal(platform.lifecycle.state, 'disposed');
  // Disposal subscriptions can still be held by callers, but the emitter must release them.
  assert.equal(unsubscribe(), false);
});

test('stop and pause release input while a borrowed platform remains usable after disposal', () => {
  const target = new EventTarget();
  const input = createInputManager({ target });
  const clock = scheduler();
  const platform = { input, ready() {} };
  const app = createGameApplication({ ...clock, platform, renderer: { render() {} } });
  app.scenes.add(new Scene('main'));
  app.scenes.start('main');
  const press = () => {
    const event = new Event('keydown');
    Object.defineProperty(event, 'code', { value: 'KeyD' });
    target.dispatchEvent(event);
  };
  app.start();
  press();
  assert.equal(input.isDown('KeyD'), true);
  app.pause();
  assert.equal(input.isDown('KeyD'), false);
  assert.equal(clock.pending.size, 0);
  app.resume();
  assert.equal(clock.pending.size, 1);
  app.dispose();
  assert.equal(clock.pending.size, 0);
  press();
  assert.equal(input.isDown('KeyD'), true);
  input.dispose();
});

test('UI scenes remain command-driven through transitions and repeated disposal', () => {
  const clock = scheduler();
  const rendered = [];
  const app = createGameApplication({ ...clock, project: { profile: 'ui' }, renderer: { render(scene) { rendered.push(scene.name); } } });
  class Menu extends Scene { onCommand(_command, owner) { owner.scenes.start('second'); } }
  app.scenes.add(new Menu('first'));
  app.scenes.add(new Scene('second'));
  app.scenes.start('first');
  app.start();
  app.dispatch({ type: 'next' });
  assert.deepEqual(rendered, ['first', 'second']);
  assert.equal(clock.pending.size, 0);
  assert.equal(app.dispose(), true);
  assert.equal(app.dispose(), false);
  assert.equal(app.start(), false);
});

test('returning from a hidden document rebases simulation and render timing', async () => {
  const clock = scheduler();
  const samples = [];
  const renderer = {
    render() {},
    qualityController: {},
    recordFrameInterval(ms) { samples.push(ms); },
  };
  const project = { profile: '3d', features: ['scene', 'diagnostics', 'adaptiveQuality3d'] };
  const app = createGameApplication({ ...clock, project, renderer });
  await app.installFeatures();
  app.scenes.add(new Scene('main'));
  app.scenes.start('main');
  app.start();
  clock.advance(100);
  clock.advance(120);
  assert.deepEqual(samples, [20]);

  app.platform.lifecycle.setVisible(false);
  clock.advance(160);
  clock.advance(200);
  assert.deepEqual(samples, [20], 'hidden frames must not drive adaptive quality');
  const before = app.stats;

  app.platform.lifecycle.setVisible(true);
  clock.advance(1300);
  assert.equal(app.unscaledDeltaSeconds, 0);
  assert.deepEqual(app.stats, { ...before, frames: before.frames + 1 });
  assert.equal(clock.pending.size, 1, 'the original scheduler continues');
  assert.equal(app.services.diagnostics.snapshot().frameCount, 1);
  clock.advance(1320);
  assert.equal(app.stats.ticks, before.ticks + 1);
  assert.deepEqual(samples, [20, 20]);
  assert.equal(app.services.diagnostics.snapshot().frameTimeMaxMs, 20);
  app.dispose();
});

test('disposing from an adaptive quality callback leaves diagnostics disposed', async () => {
  const clock = scheduler();
  const renderer = {
    render() {},
    qualityController: {},
    recordFrameInterval() { app.dispose(); },
  };
  const project = { profile: '3d', features: ['scene', 'diagnostics', 'adaptiveQuality3d'] };
  const app = createGameApplication({ ...clock, project, renderer });
  await app.installFeatures();
  const { diagnostics } = app.services;
  app.scenes.add(new Scene('main'));
  app.scenes.start('main');
  app.start();
  clock.advance(100);
  assert.equal(diagnostics.snapshot().frameCount, 1);
  clock.advance(120);
  assert.equal(app.disposed, true);
  assert.equal(diagnostics.snapshot().frameCount, 0);
  assert.equal(clock.pending.size, 0);
});

test('disposing from the platform ready callback leaves no scheduled frame', () => {
  const clock = scheduler();
  let app;
  app = createGameApplication({ ...clock, platform: { ready() { app.dispose(); } }, renderer: { render() {} } });
  app.scenes.add(new Scene('main'));
  app.scenes.start('main');
  assert.equal(app.start(), false);
  assert.equal(clock.pending.size, 0);
  assert.equal(app.disposed, true);
});

for (const phase of ['ready', 'update']) {
  test(`pause and resume from ${phase} keep one scheduled frame`, () => {
    const clock = scheduler();
    let renders = 0;
    const toggle = owner => {
      assert.equal(owner.pause(), true);
      assert.equal(owner.resume(), true);
    };
    const app = createGameApplication({ ...clock, platform: {
      ready() { if (phase === 'ready') toggle(app); },
    }, renderer: { render() { renders++; } } });
    class Main extends Scene {
      update(_dt, owner) { if (phase === 'update' && renders === 0) toggle(owner); }
    }
    app.scenes.add(new Main('main'));
    app.scenes.start('main');
    app.start();
    assert.equal(clock.pending.size, 1);
    clock.advance(10);
    assert.equal(clock.pending.size, 1);
    clock.advance(27);
    assert.equal(renders, 2);
    app.stop();
    assert.equal(clock.pending.size, 0);
    app.dispose();
  });
}

test('a failed ready callback rolls back startup and can be retried', () => {
  const clock = scheduler();
  const app = createGameApplication({ ...clock, renderer: { render() {} } });
  app.scenes.add(new Scene('main'));
  app.scenes.start('main');
  const failure = new Error('ready-hook-failed');
  app.platform.lifecycle.on('ready', () => {
    app.pause();
    app.resume();
    throw failure;
  });
  assert.throws(() => app.start(), error => error === failure);
  assert.equal(app.running, false);
  assert.equal(clock.pending.size, 0);
  assert.equal(app.start(), true);
  assert.equal(clock.pending.size, 1);
  app.dispose();
});

test('clearing scenes on a live application still permits a new scene', () => {
  const app = createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Scene('first'));
  app.scenes.start('first');
  app.scenes.dispose();
  app.scenes.add(new Scene('replacement'));
  app.scenes.start('replacement');
  assert.doesNotThrow(() => app.step(1 / 60));
  app.dispose();
});

test('disposal during a scene transition prevents the next scene from entering', () => {
  let entered = 0;
  class Leaving extends Scene { exit(app) { app.dispose(); } }
  class Arriving extends Scene { enter() { entered++; } }
  const app = createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Leaving('first'));
  const next = app.scenes.add(new Arriving('next'));
  app.scenes.start('first');
  assert.equal(app.scenes.start('next'), false);
  assert.equal(entered, 0);
  assert.equal(next.active, false);
  assert.equal(app.scenes.current, null);
});

test('scene and entity cleanup cannot reattach dying entities or create orphan roots', () => {
  const app = createGameApplication({ renderer: { render() {} } });
  const scene = app.scenes.add(new Scene('main'));
  const other = new Scene('other');
  let rejected = 0;
  class Reattach extends Component {
    onDestroy() {
      assert.throws(() => other.add(this.entity), /destroy|dispos/i); rejected++;
      assert.throws(() => scene.add(new Entity()), /dispos/i); rejected++;
    }
  }
  const entity = scene.add(new Entity());
  entity.addComponent(new Reattach());
  app.scenes.start('main');
  app.dispose();
  assert.equal(rejected, 2);
  assert.equal(other.objects.length, 0);
  assert.equal(scene.objects.length, 0);
  assert.equal(entity.scene, null);
});

for (const count of [1, 2]) {
  test(`timer-triggered disposal cancels scene hooks and remaining callbacks (${count} timers)`, () => {
    const calls = [];
    class Timed extends Scene { fixedUpdate() { calls.push('scene-fixed'); } }
    const app = createGameApplication({ renderer: { render() { calls.push('render'); }, dispose() { calls.push('disposed'); } } });
    const scene = app.scenes.add(new Timed('timed'));
    scene.tweens.after(0.001, () => { calls.push('timer'); app.dispose(); });
    if (count === 2) scene.tweens.after(0.001, () => calls.push('late-timer'));
    app.scenes.start('timed');
    assert.doesNotThrow(() => app.step(1 / 60));
    assert.deepEqual(calls, ['timer', 'disposed']);
    assert.equal(app.disposed, true);
  });
}

test('disposal inside tween onUpdate cancels completion and following tweens', () => {
  const calls = [];
  const app = createGameApplication({ renderer: { render() {} } });
  const scene = app.scenes.add(new Scene('timed'));
  scene.tweens.add({ x: 0 }, { x: 1 }, { duration: 0, onUpdate() { calls.push('update'); app.dispose(); },
    onComplete() { calls.push('complete'); } });
  scene.tweens.add({ x: 0 }, { x: 1 }, { duration: 0, onComplete() { calls.push('late-tween'); } });
  app.scenes.start('timed');
  assert.doesNotThrow(() => app.step(1 / 60));
  assert.deepEqual(calls, ['update']);
});

test('diagnostics attribute mid-phase exceptions and scene cancellation reasons accurately', () => {
  const cases = [
    { label: 'fixedUpdate', setup: app => app.scenes.add(new class extends Scene { fixedUpdate() { throw new Error('fixed-boom'); } }('s')), run: app => app.step(1 / 60), phase: 'fixedUpdate' },
    { label: 'update', setup: app => app.scenes.add(new class extends Scene { update() { throw new Error('update-boom'); } }('s')), run: app => app.step(1 / 60), phase: 'update' },
    { label: 'render', setup: app => app.scenes.add(new Scene('s')), run: app => app.step(1 / 60), phase: 'render', renderThrows: true },
    { label: 'phaseHook', setup: app => { app.scenes.add(new Scene('s')); app.onPhase('beforeUpdate', () => { throw new Error('hook-boom'); }); }, run: app => app.step(1 / 60), phase: 'phaseHook:beforeUpdate' },
    { label: 'sceneEnter', setup: app => app.scenes.add(new class extends Scene { enter() { throw new Error('enter-boom'); } }('s2')), run: app => app.scenes.start('s2'), phase: 'sceneEnter', startFirst: false },
  ];

  for (const tc of cases) {
    const app = createGameApplication({
      renderer: { render() { if (tc.renderThrows) throw new Error('render-boom'); } },
    });
    if (tc.startFirst === false) {
      app.scenes.add(new Scene('s'));
      app.scenes.start('s');
    }
    tc.setup(app);
    if (tc.startFirst !== false) app.scenes.start('s');
    assert.throws(() => tc.run(app), /boom/);
    assert.equal(app.activePhase, 'idle');
    const snap = app.platform.diagnostics.snapshot();
    assert.equal(snap.errorCount, 1);
    assert.equal(snap.lastPhaseError?.context.phase, tc.phase);
    assert.equal(snap.lastPhaseError?.context.scene, tc.startFirst === false ? 's2' : 's');
    app.dispose();
    assert.equal(app.dispose(), false);
  }

  // Verify scene cancellation reasons are propagated to AbortSignal and diagnostics
  const app2 = createGameApplication({ renderer: { render() {} } });
  const a = app2.scenes.add(new Scene('alpha'));
  const b = app2.scenes.add(new Scene('beta'));
  app2.scenes.start('alpha');
  let abortReason = null;
  const alphaSignal = a.activationSignal;
  alphaSignal.addEventListener('abort', () => { abortReason = alphaSignal.reason; });
  app2.scenes.start('beta');
  assert.match(String(abortReason?.message ?? abortReason), /scene-switch:beta/);
  assert.throws(() => app2.scenes.activatePrepared('alpha', undefined, () => false), { name: 'AbortError' });
  const snap2 = app2.platform.diagnostics.snapshot();
  assert.ok(snap2.sceneCancellations.some(c => c.scene === 'alpha' && /scene-switch:beta/.test(c.reason)));
  assert.ok(snap2.sceneCancellations.some(c => c.scene === 'alpha' && /cancelled/i.test(c.reason)));
  app2.dispose();
  assert.equal(b.active, false);
});

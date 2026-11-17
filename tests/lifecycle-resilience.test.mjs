import test from 'node:test';
import assert from 'node:assert/strict';
import { Component, Entity, Scene, createGameApplication, createInputManager } from '../assets/runtime/index.js';

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

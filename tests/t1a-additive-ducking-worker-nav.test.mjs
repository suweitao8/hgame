import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,
  createGameApplication,
  createAudioManager,
  createSimWorkerRunner,
  createNavMesh3D,
} from '../assets/runtime/index.js';

function createFakeAudioContextClass() {
  class FakeParam {
    constructor(v = 1) { this.value = v; this.events = []; }
    cancelScheduledValues(t) { this.events.push(['cancel', t]); }
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); }
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['ramp', v, t]); }
    setTargetAtTime(v, t, tc) { this.value = v; this.events.push(['target', v, t, tc]); }
  }
  class FakeNode {
    connect(dest) { return dest; }
    disconnect() {}
  }
  class FakeGain extends FakeNode {
    constructor() { super(); this.gain = new FakeParam(1); }
  }
  class FakeFilter extends FakeNode {
    constructor() {
      super();
      this.type = 'lowpass';
      this.frequency = new FakeParam(22000);
      this.Q = new FakeParam(0.707);
      this.gain = new FakeParam(0);
    }
  }
  return class FakeAudioContext {
    constructor() {
      this.currentTime = 1.0;
      this.state = 'running';
      this.sampleRate = 48000;
      this.destination = new FakeNode();
      this.listener = {};
      this.createdGains = [];
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { const g = new FakeGain(); this.createdGains.push(g); return g; }
    createBiquadFilter() { return new FakeFilter(); }
    createDynamicsCompressor() { return new FakeNode(); }
  };
}

test('A1 SceneManager additive sub-scenes mount, step alongside current, render, and unmount cleanly', () => {
  const events = [];
  const app = createGameApplication({
    renderer: {
      render(scene) { events.push(`render:${scene.name}`); },
    },
  });

  const main = new Scene('main');
  main.enter = () => events.push('enter:main');
  main.exit = () => events.push('exit:main');
  main.fixedUpdate = () => events.push('fixed:main');
  main.update = () => events.push('update:main');
  main.lateUpdate = () => events.push('late:main');

  const hud = new Scene('hud-overlay');
  hud.enter = (_, data) => events.push(`enter:hud:${data?.mode}`);
  hud.exit = () => events.push('exit:hud');
  hud.fixedUpdate = () => events.push('fixed:hud');
  hud.update = () => events.push('update:hud');
  hud.lateUpdate = () => events.push('late:hud');

  app.scenes.add(main);
  app.scenes.add(hud);
  app.scenes.start('main');
  assert.equal(app.scenes.mountAdditive('hud-overlay', { mode: 'shop' }), true);
  assert.equal(app.scenes.mountAdditive('hud-overlay'), false);
  assert.equal(app.scenes.current, main);
  assert.equal(app.scenes.getAdditive('hud-overlay'), hud);

  events.length = 0;
  app.step(1 / 60);
  assert.ok(events.includes('fixed:main') && events.includes('fixed:hud'));
  assert.ok(events.includes('update:main') && events.includes('update:hud'));
  assert.ok(events.includes('late:main') && events.includes('late:hud'));
  assert.ok(events.includes('render:main') && events.includes('render:hud-overlay'));
  assert.ok(!events.includes('exit:main'));

  assert.equal(app.scenes.unmountAdditive('hud-overlay'), true);
  assert.ok(events.includes('exit:hud'));
  assert.equal(app.scenes.overlays.length, 0);
  app.dispose();
});

test('S3 createAudioManager.duckBus schedules Web Audio gain envelope and exposes active ducking state', async () => {
  const FakeAudioContext = createFakeAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: FakeAudioContext });
  await audio.unlock();

  const ok = audio.duckBus('bgm', { targetGain: 0.25, attackSec: 0.05, holdSec: 0.3, releaseSec: 0.4 });
  assert.equal(ok, true);
  const dsp = audio.getDspState();
  assert.ok(dsp.ducking.bgm);
  assert.equal(dsp.ducking.bgm.targetGain, 0.25);

  // Verify legacy positional call also works
  assert.equal(audio.duckBus('bgm', 0.4, 150), true);
  await audio.dispose();
});

test('P1 createNavMesh3D.findPathAsync offloads A* + string-pull smoothing to worker kernel', async () => {
  const nav = createNavMesh3D({
    bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 20 },
    cellSize: 1,
    obstacles: [{ minX: 8, maxX: 11, minZ: 2, maxZ: 14 }],
  });

  const start = { x: 2, z: 8 };
  const goal = { x: 18, z: 8 };
  const syncPath = nav.findPath(start, goal);
  assert.ok(Array.isArray(syncPath) && syncPath.length >= 3);

  const workerLogs = [];
  const workerRunner = createSimWorkerRunner({
    workerFactory: () => ({
      onmessage: null,
      onerror: null,
      postMessage(msg) {
        workerLogs.push(msg.type);
        queueMicrotask(async () => {
          // Run true worker-sim logic via workerRunner built-in path by simulating main worker response
          const runner = createSimWorkerRunner();
          const h = runner.submit(msg.type, msg.payload, { tick: 1 });
          const [res] = runner.flushTick(1);
          this.onmessage?.({ data: { id: msg.id, ok: true, result: res.value } });
        });
      },
      terminate() {},
    }),
  });

  const asyncPath = await nav.findPathAsync(start, goal, { workerRunner });
  assert.deepEqual(workerLogs, ['navmesh-path']);
  assert.ok(Array.isArray(asyncPath) && asyncPath.length === syncPath.length);
  for (let i = 0; i < syncPath.length; i++) {
    assert.ok(Math.abs(asyncPath[i].x - syncPath[i].x) < 1e-4);
    assert.ok(Math.abs(asyncPath[i].z - syncPath[i].z) < 1e-4);
  }
  workerRunner.dispose();
});

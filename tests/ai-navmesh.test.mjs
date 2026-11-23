import test from 'node:test';
import assert from 'node:assert/strict';
import * as Runtime from '../assets/runtime/index.js';
import {
  HGame,
  createStateMachine,
  BT_STATUS,
  sequence,
  selector,
  parallel,
  inverter,
  repeater,
  cooldown,
  condition,
  action,
  wait,
  createBehaviorTree,
  createNavMesh3D,
} from '../assets/runtime/index.js';

test('simulation work is bounded and fair across fixed ticks with observable backpressure', () => {
  const run = frameLengths => {
    const app = Runtime.createGameApplication({ renderer: { render() {} } });
    const timeline = [];
    const scene = app.scenes.add(new Runtime.Scene('battle'));
    scene.physics = { step() { timeline.push('physics'); } };
    app.scenes.start(scene.name);
    const budget = Runtime.createSimulationWorkBudget({ app, unitsPerTick: 3, unitsPerSlice: 1, maxPending: 2 });
    function* decide(name) {
      for (let i = 0; i < 3; i++) { timeline.push(name + i); yield; }
      return name;
    }
    const a = budget.enqueue(decide('a'));
    const b = budget.enqueue(decide('b'));
    assert.equal(budget.enqueue(decide('overload')), null);
    const samples = [];
    app.onPhase('afterPhysics', () => samples.push(budget.snapshot()), { order: 1 });
    for (const ticks of frameLengths) app.step(ticks / 60);
    assert.equal(a.state, 'completed');
    assert.equal(b.value, 'b');
    assert.deepEqual(samples.map(({ pending, used, rejected }) => [pending, used, rejected]), [[2, 3, 1], [2, 3, 1], [0, 2, 1]]);
    assert.equal(app.stats.ticks, 3);
    assert.deepEqual(timeline, ['physics', 'a0', 'b0', 'a1', 'physics', 'b1', 'a2', 'b2', 'physics']);
    app.dispose();
    return { timeline, samples };
  };
  assert.deepEqual(run([1, 1, 1]), run([2, 1]));
});

test('budgeted 2D and 3D navigation preserve immediate paths under interleaved work', () => {
  const app = Runtime.createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Runtime.Scene('paths'));
  app.scenes.start('paths');
  const budget = Runtime.createSimulationWorkBudget({ app, unitsPerTick: 7, unitsPerSlice: 1 });
  const map = new Runtime.TileMap({ tiles: Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 14 }, (_, x) => x === 6 && y < 7 ? 1 : 0)), solid: [1] });
  const nav = createNavMesh3D({
    bounds: { minX: 0, maxX: 14, minZ: 0, maxZ: 10 },
    agentRadius: 0, obstacles: [{ minX: 6, maxX: 7, minZ: 0, maxZ: 7 }],
  });
  const gridStart = { x: 1, y: 2 }, gridGoal = { x: 12, y: 2 };
  const navStart = { x: 1.5, z: 2.5 }, navGoal = { x: 12.5, z: 2.5 };
  const opts = { allowDiagonal: true };
  const expectedGrid = Runtime.findGridPath(map, gridStart, gridGoal, opts);
  const expectedNav = nav.findPath(navStart, navGoal);
  const expectedSnapped = nav.findPath({ x: 6.5, z: 3.5 }, navGoal, { smooth: false });
  const grid = budget.enqueue(Runtime.createGridPathWork(map, gridStart, gridGoal, opts));
  const path = budget.enqueue(nav.createPathWork(navStart, navGoal));
  const snapped = budget.enqueue(nav.createPathWork({ x: 6.5, z: 3.5 }, navGoal, { smooth: false }));
  gridGoal.x = 1;
  navGoal.x = 1.5;
  app.step(1 / 60);
  assert.equal(path.state, 'pending');
  assert.equal(grid.state, 'pending');
  assert.equal(budget.snapshot().used, 7);
  for (let i = 0; i < 400 && budget.snapshot().pending; i++) {
    app.step(1 / 60);
    assert.ok(budget.snapshot().used <= 7);
  }
  assert.equal(grid.state, 'completed');
  assert.deepEqual(grid.value, expectedGrid);
  assert.equal(path.state, 'completed');
  assert.deepEqual(path.value, expectedNav);
  assert.equal(snapped.state, 'completed');
  assert.deepEqual(snapped.value, expectedSnapped);
  assert.equal(budget.snapshot().pending, 0);
  app.dispose();
});

test('navigation edits invalidate pending searches and scene exit cancels deferred AI', () => {
  const app = Runtime.createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Runtime.Scene('first'));
  app.scenes.add(new Runtime.Scene('next'));
  app.scenes.start('first');
  const budget = Runtime.createSimulationWorkBudget({ app, unitsPerTick: 3, unitsPerSlice: 1 });
  const map = new Runtime.TileMap({ tiles: [Array(12).fill(0), Array(12).fill(0)], solid: [1] });
  const nav = createNavMesh3D({ bounds: { minX: 0, maxX: 12, minZ: 0, maxZ: 2 } });
  const grid = budget.enqueue(Runtime.createGridPathWork(map, { x: 0, y: 0 }, { x: 11, y: 0 }));
  const path = budget.enqueue(nav.createPathWork({ x: 0, z: 0 }, { x: 11, z: 0 }));
  let cleaned = 0;
  const ai = budget.enqueue((function* () {
    try { while (true) yield; } finally { cleaned++; }
  })());
  app.step(1 / 60);
  map.set(2, 0, 1);
  nav.rebuild();
  app.step(1 / 60);
  assert.equal(grid.state, 'failed');
  assert.match(grid.error.message, /navigation changed/i);
  assert.equal(path.state, 'failed');
  assert.match(path.error.message, /navigation changed/i);
  app.scenes.start('next');
  assert.equal(ai.state, 'cancelled');
  assert.equal(cleaned, 1);
  assert.equal(budget.snapshot().pending, 0);
  assert.equal(budget.snapshot().failed, 2);
  assert.equal(budget.snapshot().cancelled, 1);
  const direct = budget.enqueue(Runtime.createGridPathWork(map, { x: 0, y: 1 }, { x: 11, y: 1 }));
  map.solid.add(0);
  map.invalidateNavigation();
  app.step(1 / 60);
  assert.equal(direct.state, 'failed');
  assert.match(direct.error.message, /navigation changed/i);
  app.dispose();
});

test('deferred work keeps iterator ownership until reentrant cancellation finishes', () => {
  const app = Runtime.createGameApplication({ renderer: { render() {} } });
  app.scenes.add(new Runtime.Scene('work'));
  app.scenes.start('work');
  const budget = Runtime.createSimulationWorkBudget({ app, unitsPerTick: 2, maxPending: 2 });
  let handle;
  let cleanups = 0;
  const iterator = (function* () {
    try {
      assert.equal(handle.cancel(), true);
      assert.throws(() => budget.enqueue(iterator), /already queued/i);
      yield;
    } finally {
      assert.throws(() => budget.enqueue(iterator), /already queued/i);
      cleanups++;
    }
  })();
  handle = budget.enqueue(iterator);
  app.step(1 / 60);
  assert.equal(handle.state, 'cancelled');
  assert.equal(handle.error.name, 'AbortError');
  assert.equal(cleanups, 1);
  assert.equal(budget.snapshot().pending, 0);
  assert.equal(budget.snapshot().used, 1);
  app.dispose();
});

test('createStateMachine handles hierarchical LCA transitions, events, guards, and resets', () => {
  assert.equal(typeof HGame.createStateMachine, 'function');
  const log = [];
  const ctx = { hp: 100, enemyNear: false, attacked: 0 };

  const fsm = createStateMachine({
    initial: 'combat',
    context: ctx,
    states: {
      alive: {
        onEnter: () => log.push('enter:alive'),
        onExit: () => log.push('exit:alive'),
        transitions: [
          { to: 'dead', when: (c) => c.hp <= 0 },
        ],
      },
      combat: {
        parent: 'alive',
        initial: 'patrol',
        onEnter: () => log.push('enter:combat'),
        onExit: () => log.push('exit:combat'),
      },
      patrol: {
        parent: 'combat',
        onEnter: () => log.push('enter:patrol'),
        onExit: () => log.push('exit:patrol'),
        transitions: [
          { to: 'chase', when: (c) => c.enemyNear },
        ],
      },
      chase: {
        parent: 'combat',
        onEnter: () => log.push('enter:chase'),
        onExit: () => log.push('exit:chase'),
        transitions: [
          { event: 'strike', to: 'attack' },
        ],
      },
      attack: {
        parent: 'combat',
        onEnter: (c) => { c.attacked++; log.push('enter:attack'); },
        onExit: () => log.push('exit:attack'),
        transitions: [
          { to: 'patrol', when: (_c, t) => t >= 0.5 },
        ],
      },
      dead: {
        onEnter: () => log.push('enter:dead'),
      },
    },
  });

  assert.equal(fsm.getState(), 'patrol');
  assert.equal(fsm.isIn('alive'), true);
  assert.equal(fsm.isIn('combat'), true);

  // Transition patrol -> chase stays inside alive/combat without re-entering parents.
  ctx.enemyNear = true;
  fsm.update(0.016);
  assert.equal(fsm.getState(), 'chase');
  assert.equal(fsm.send('strike'), true);
  assert.equal(fsm.getState(), 'attack');
  assert.equal(ctx.attacked, 1);

  ctx.enemyNear = false;
  fsm.update(0.6);
  assert.equal(fsm.getState(), 'patrol');

  // Parent alive transition triggers full exit up to alive -> dead.
  ctx.hp = 0;
  fsm.update(0.016);
  assert.equal(fsm.getState(), 'dead');
  assert.deepEqual(log, [
    'enter:alive',
    'enter:combat',
    'enter:patrol',
    'exit:patrol',
    'enter:chase',
    'exit:chase',
    'enter:attack',
    'exit:attack',
    'enter:patrol',
    'exit:patrol',
    'exit:combat',
    'exit:alive',
    'enter:dead',
  ]);
});

test('createBehaviorTree supports running memory, cooldowns, decorators, and shared immutable trees across agents', () => {
  assert.equal(typeof HGame.createBehaviorTree, 'function');

  // Shared tree definition for two independent agents.
  const sharedTree = selector(
    sequence(
      condition((bb) => bb.targetInRange),
      cooldown(1.0, sequence(
        action((bb) => { bb.windups++; return BT_STATUS.SUCCESS; }),
        wait(0.25),
        action((bb) => { bb.strikes++; return BT_STATUS.SUCCESS; }),
      )),
    ),
    parallel('all',
      inverter(condition((bb) => bb.stunned)),
      repeater(2, action((bb) => { bb.patrolSteps++; return BT_STATUS.SUCCESS; })),
    ),
  );

  const a1 = createBehaviorTree(sharedTree, { blackboard: { targetInRange: true, stunned: false, windups: 0, strikes: 0, patrolSteps: 0 } });
  const a2 = createBehaviorTree(sharedTree, { blackboard: { targetInRange: false, stunned: false, windups: 0, strikes: 0, patrolSteps: 0 } });

  // Agent 1 begins attack sequence and pauses inside wait(0.25) while Agent 2 patrols.
  assert.equal(a1.tick(0.1), BT_STATUS.RUNNING);
  assert.equal(a1.blackboard.windups, 1);
  assert.equal(a1.blackboard.strikes, 0);

  assert.equal(a2.tick(0.1), BT_STATUS.RUNNING); // repeater 1/2
  assert.equal(a2.blackboard.patrolSteps, 1);

  // Agent 1 finishes wait(0.25) -> completes strike; subsequent tick hits 1.0s cooldown -> falls through to patrol.
  assert.equal(a1.tick(0.2), BT_STATUS.SUCCESS);
  assert.equal(a1.blackboard.strikes, 1);
  a1.tick(0.1);
  assert.equal(a1.blackboard.windups, 1); // still on cooldown
  assert.equal(a1.blackboard.patrolSteps, 1); // fell back to patrol branch

  // Wait out cooldown -> Agent 1 attacks again.
  a1.tick(1.0);
  assert.equal(a1.blackboard.windups, 2);
});

test('createNavMesh3D avoids inflated obstacles, traverses stepped surfaces, and string-pulls smooth waypoints', () => {
  assert.equal(typeof HGame.createNavMesh3D, 'function');
  const nav = createNavMesh3D({
    bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 20 },
    cellSize: 1,
    agentRadius: 0.5,
    stepHeight: 0.6,
    obstacles: [
      { minX: 8, maxX: 11, minZ: 0, maxZ: 14 },
    ],
    surfaces: [
      { minX: 12, maxX: 18, minZ: 14, maxZ: 18, y: 0.5 },
    ],
  });

  assert.equal(nav.isWalkable(9.5, 5), false);
  assert.equal(nav.isWalkable(2, 2), true);

  const path = nav.findPath({ x: 2, z: 4 }, { x: 16, z: 16 });
  assert.ok(Array.isArray(path) && path.length >= 2 && path.length <= 8);
  assert.equal(path[path.length - 1].y, 0.5);
  assert.ok(path[0].x === 2 && path[0].z === 4);

  // Ensure no intermediate waypoint lies inside the blocking wall.
  for (const wp of path) {
    assert.equal(nav.isWalkable(wp.x, wp.z), true);
  }

  // Unreachable enclosed room -> returns null cleanly.
  nav.addObstacle({ minX: 13, maxX: 19, minZ: 13, maxZ: 14 });
  nav.addObstacle({ minX: 13, maxX: 14, minZ: 13, maxZ: 19 });
  nav.addObstacle({ minX: 13, maxX: 19, minZ: 18, maxZ: 19 });
  nav.addObstacle({ minX: 18, maxX: 19, minZ: 13, maxZ: 19 });
  assert.equal(nav.findPath({ x: 2, z: 4 }, { x: 16, z: 16 }, { maxSnapCells: 0 }), null);
});

test('createSimWorkerRunner executes on main-thread fallback and Worker pool with deterministic tick commits and cancellation cleanup', () => {
  // 1. Main-thread fallback parity for grid-path
  const mainCommits = [];
  const mainRunner = Runtime.createSimWorkerRunner({
    onCommit: entry => mainCommits.push(entry.id),
  });
  assert.equal(mainRunner.mode, 'main-thread');
  const grid = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  grid[1][2] = 1;
  grid[2][2] = 1;
  const hLow = mainRunner.submit('grid-path', { tiles: grid, solid: [1], start: { x: 0, y: 2 }, goal: { x: 4, y: 2 } }, { tick: 1, priority: 1 });
  const hHigh = mainRunner.submit('grid-path', { tiles: grid, solid: [1], start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } }, { tick: 1, priority: 10 });
  assert.equal(mainRunner.flushTick(0).length, 0);
  const flushedMain = mainRunner.flushTick(1);
  assert.deepEqual(flushedMain.map(r => r.id), [hHigh.id, hLow.id]);
  assert.ok(Array.isArray(hLow.value) && hLow.value.length > 0);
  assert.equal(hLow.state, 'completed');
  mainRunner.dispose();

  // 2. Worker path: out-of-order completion commits strictly in deterministic (submitTick, priority, id) order
  const workers = [];
  const commits = [];
  const workerRunner = Runtime.createSimWorkerRunner({
    workerCount: 2,
    workerFactory(index) {
      const w = {
        index,
        posted: [],
        terminated: false,
        listeners: [],
        addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); },
        removeEventListener(type, fn) { this.listeners = this.listeners.filter(f => f !== fn); },
        postMessage(msg) { this.posted.push(msg); },
        emit(data) { for (const fn of [...this.listeners]) fn({ data }); },
        terminate() { this.terminated = true; },
      };
      workers.push(w);
      return w;
    },
    onCommit: entry => commits.push({ id: entry.id, value: entry.value }),
  });

  assert.equal(workerRunner.mode, 'worker');
  assert.equal(workerRunner.workerCount, 2);

  const j1 = workerRunner.submit('batch-eval', { items: [1, 2] }, { tick: 2, priority: 1 });
  const j2 = workerRunner.submit('batch-eval', { items: [3, 4] }, { tick: 2, priority: 5 });
  const ac = new AbortController();
  const j3 = workerRunner.submit('batch-eval', { items: [5, 6] }, { tick: 2, signal: ac.signal });

  // Cancel j3 before worker responds; worker gets cancel message and late response is dropped
  ac.abort();
  assert.equal(j3.state, 'cancelled');
  assert.ok(workers[0].posted.some(m => m.op === 'cancel' && m.id === j3.id));

  // Deliver j1 before j2, plus late message for cancelled j3
  workers[0].emit({ id: j1.id, ok: true, result: [2, 4] });
  workers[1].emit({ id: j2.id, ok: true, result: [6, 8] });
  workers[0].emit({ id: j3.id, ok: true, result: [10, 12] });

  // Before tick 2, nothing commits
  assert.equal(workerRunner.flushTick(1).length, 0);
  // At tick 2, j2 (higher priority) commits before j1 deterministically
  const committed = workerRunner.flushTick(2);
  assert.deepEqual(committed.map(c => c.id), [j2.id, j1.id]);
  assert.deepEqual(commits, [{ id: j2.id, value: [6, 8] }, { id: j1.id, value: [2, 4] }]);
  const wStats = workerRunner.getStats();
  assert.equal(wStats.committed, 2);
  assert.equal(wStats.cancelled, 1);
  assert.equal(wStats.droppedLate, 1);

  workerRunner.dispose();
  assert.equal(workers.every(w => w.terminated), true);
});

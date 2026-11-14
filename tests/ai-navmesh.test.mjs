import test from 'node:test';
import assert from 'node:assert/strict';
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

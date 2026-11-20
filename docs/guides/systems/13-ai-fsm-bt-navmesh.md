# 4.13 AI Decision Kernel (`fsm`, `bt`) & 3D NavMesh (`navmesh3d`)

> Zero-GC hierarchical FSM, shared-definition Behavior Trees, and height-aware 3D NavMesh A* + LOS smoother.

- **Files**: `vendor/hgame/ai/index.js`, `vendor/hgame/ai/fsm.js`, `vendor/hgame/ai/bt.js`, `vendor/hgame/world/navmesh3d.js`
- **When**: Enemy/boss state machines, utility/behavior AI across crowds, 3D pathfinding over arenas/slopes.

```js
import { createStateMachine, createBehaviorTree, BT_STATUS, selector, sequence, condition, cooldown, action } from '../vendor/hgame/ai/index.js';
import { createNavMesh3D } from '../vendor/hgame/world/navmesh3d.js';

const fsm = createStateMachine({
  initial: 'patrol',
  states: { patrol: { onUpdate(ctx, dt) {} }, chase: { onEnter() {} } },
  transitions: [{ from: 'patrol', to: 'chase', event: 'aggro', guard: ctx => ctx.dist < 12 }],
});

const tree = createBehaviorTree(selector([
  sequence([condition(c => c.dist < 2), cooldown(1.2, action(c => (c.attack(), BT_STATUS.SUCCESS)))]),
  action(c => (c.moveToTarget(), BT_STATUS.RUNNING)),
]));
const mem = tree.createMemory();
tree.tick(ctx, dt, mem);

const nav = createNavMesh3D({
  bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  cellSize: 1.5,
  agentRadius: 0.6,
  obstacles: [{ minX: 2.5, maxX: 5.5, minZ: 2.5, maxZ: 5.5, minY: 0, maxY: 2 }],
});
const path = nav.findPath({ x: -10, z: 0 }, { x: 12, z: 8 }, { maxNodes: 2000 });
```

## Fixed-tick budget for deferred AI and navigation

Use `createSimulationWorkBudget` once per application for work that can finish across several ticks. It advances after physics and before fixed-step input edges are cleared. Work is counted in iterator advances, independent of wall-clock time and render frequency. A command-driven application advances this queue during explicit `app.step()` calls.

```js
import { createSimulationWorkBudget } from '../vendor/hgame/sim/index.js';
import { createGridPathWork } from '../vendor/hgame/world/tilemap.js';

const work = createSimulationWorkBudget({
  app, unitsPerTick: 256, unitsPerSlice: 16, maxPending: 128,
});

// Supply the owning scene explicitly when enqueuing from a prepared enter hook.
const options = { signal: scene.activationSignal };
const groundPath = work.enqueue(createGridPathWork(tilemap, startCell, endCell), options);
const worldPath = work.enqueue(nav.createPathWork(startPosition, targetPosition), options);
const patrol = work.enqueue((function* () {
  for (const actor of patrolActors) {
    actor.refreshPatrolTarget(); // One deferrable decision per advance.
    yield;
  }
})(), options);
```

An accepted task handle exposes `state`, `value`, `error`, and `cancel()`. Poll results at a consistent simulation phase when later fixed ticks consume them. The queue runs at order 0. Work with a smaller maximum slice rotates sooner among pending tasks. A full queue returns `null` and increments `snapshot().rejected`. The snapshot also reports pending count, capacity, units used last tick, and counts for completion, cancellation, and failure.

By default work belongs to the current scene activation at enqueue time. Pass `signal: null` for work that can survive a scene transition. Prepared scenes and other explicit owners can pass their own signal. Cancellation closes the iterator. Keep cleanup synchronous and free of yields. Each advance should do a bounded amount of synchronous work so the operation budget remains meaningful.

The sliced paths use the same traversal, snapping, corner rules, and path output as `findGridPath` or `nav.findPath`. A unit processes one A* expansion, one snap or reconstruction step, or up to 16 3D line-of-sight samples. Sliced jobs own their search state and 3D storage grows with discovered cells. `TileMap.set` and NavMesh rebuilds invalidate pending paths. After directly editing tile rows or the solid palette, call `tilemap.invalidateNavigation()` in the same synchronous operation. A failed request can be submitted again against the new map.

## Pitfalls
- Reuse one compiled `createBehaviorTree(root)` across all enemies; allocate only per-agent `tree.createMemory()` (never rebuild BT nodes inside `update`).
- Supply navigation obstacles from `level.json` colliders through `obstacles` or `nav.addObstacle(aabb)`.
- `maxNodes` caps the cells visited by one search and defaults to unlimited. A blocked destination or an exhausted budget yields `null` when the search cannot reach the goal.

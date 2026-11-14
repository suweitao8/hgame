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

const nav = createNavMesh3D({ minX: -40, maxX: 40, minZ: -40, maxZ: 40, cellSize: 1.5, agentRadius: 0.6 });
nav.addBoxObstacle(4, 4, 3, 3, 2);
const path = nav.findPath({ x: -10, y: 0, z: 0 }, { x: 12, y: 0, z: 8 });
```

## Pitfalls
- Reuse one compiled `createBehaviorTree(root)` across all enemies; allocate only per-agent `tree.createMemory()` (never rebuild BT nodes inside `update`).
- Keep `nav.addBoxObstacle(...)` synchronized with `level.json` colliders, never derived dynamically from PBR visual meshes.

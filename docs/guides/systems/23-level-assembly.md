# Declarative level assembly

Use `mountLevel` to assemble a level from `PrefabRegistry` trees and a JSON-compatible definition. The definition can name spawn points and trigger volumes independently of the renderer. A level owns its entity hierarchy under one scene root.

```js
import { mountLevel } from '../vendor/hgame/world/level.js';
import { createEncounterDirector } from '../vendor/hgame/gameplay/encounters.js';

// The game registers prefab IDs and component factories before loading this data.
const definition = {
  schemaVersion: 1,
  id: 'relay-room',
  dimensions: 3,
  entities: [
    { id: 'relay-area', transform: { x: 2, z: 6 } },
    { id: 'relay-door', prefab: 'door', parent: 'relay-area', transform: { x: 1 } },
  ],
  spawns: { north: { position: [2, 0, 10], rotation: [0, Math.PI, 0] } },
  triggers: {
    relay: { min: [0, -1, 5], max: [4, 2, 8], tags: { all: ['Player'] },
      once: true, enterSignal: 'relay.activated' },
  },
};

const tickets = new WeakMap();
const director = createEncounterDirector(encounterDefinition, {
  spawn(batch) {
    if (!canSpawn(batch.count)) return false;
    for (const enemy of level.spawnBatch(batch.enemy, batch.point ?? 'north', batch.count)) {
      tickets.set(enemy, batch.ticket);
    }
    return true;
  },
});
const level = mountLevel(scene, prefabs, definition, {
  onTrigger(event) { if (event.signal) director.signal(event.signal); },
});
director.start();

// The game's existing fixed step samples selected actors and advances the encounter.
function updateRoom(dt) {
  level.updateEntityTriggers([hero]);
  director.update(dt);
}
// At the point where game logic confirms one enemy defeated:
function reportDefeat(enemy) {
  const ticket = tickets.get(enemy);
  if (ticket === undefined) return;
  tickets.delete(enemy);
  director.defeated(ticket);
}
```

Parent references use placement IDs and can appear in any declaration order. Transforms on placed entities are local to their parent. Spawn and trigger coordinates are world positions. Keep the level root at its identity transform. For `dimensions: 2`, use XY coordinates. For `dimensions: 3`, use XYZ. Optional spawn rotations are XYZ radians. `getSpawnPoint()` returns a copy for systems that use another spawning backend.

`spawn()` and `spawnBatch()` create fresh prefabs beneath the level root. Batches stage their prefab trees before activation. If a factory or activation hook throws, the level destroys this batch's instances and propagates the error. Check any external capacity before calling `spawnBatch()`. Swarms can keep using their bulk simulation and read the same location via `getSpawnPoint()`.

Trigger volumes sample points within axis-aligned bounds, inclusive of the edges. Pass selected entities via `updateEntityTriggers()` for ordinary scene gameplay. For authoritative simulations, pass the simulation's coordinates and stable IDs directly to `updateTriggers()`. The tracker evaluates tag filters against current tags and emits exit when a previously tracked actor leaves the bounds, loses eligibility or disappears from the sample. For a one-shot volume, the first qualifying actor consumes it. Keep samples in a stable order when that actor matters. Sampled volumes can miss an actor that crosses entirely between two ticks. Use the game's physics sensors when continuous overlap or collider geometry matters.

`level.snapshot()` stores consumed one-shot triggers. Restore it together with any encounter checkpoint and game-owned state. Occupancy is sampled anew after restoration. Disposing the level destroys its placed and spawned descendants and releases subscriptions. The engine's visual-only 3D modular renderer can still load scenery separately from the gameplay definition.

# HGame Runtime 1.0.0

This directory is the canonical, renderer-neutral runtime source. `core/` owns Scene/Entity/Component/Prefab and the single application scheduler; `platform/` provides browser services and an optional Host bridge; `integrations/`, `animation/`, `world/`, `time/`, `physics/`, and `lockstep/` are imported only when a project needs them.

## Deterministic physics standard

- 2D: `@dimforge/rapier2d-deterministic@0.21.0`
- 3D: `@dimforge/rapier3d-deterministic@0.21.0`
- Single-player and multiplayer use the same selected backend. HGame has no offline/online physics switch.
- Physics is opt-in. UI and games without physical simulation do not download either WASM. A 2D project loads only Rapier2D; a 3D project loads only Rapier3D.
- The WASM and ESM bundles are vendored under `vendor/`; there is no CDN dependency.
- New projects must use `physics: "rapier2d"` with `physics2d`, or `physics: "rapier3d"` with `physics3d`.

## Quick use

```js
import { HGame, Entity, Scene, defineProject } from './vendor/hgame/index.js';

const project = defineProject({
  profile: '3d', physics: 'rapier3d', tickHz: 60,
  features: ['scene', 'input', 'physics3d'],
});
const app = HGame.createApplication({ project, renderer });
await app.installFeatures();
const scene = app.scenes.add(new Scene('main'));
const floor = scene.add(new Entity({ x: 0, y: 0, z: 0, width: 20, height: 1, depth: 20 }));
scene.physics.add(floor, { type: 'fixed' });
const actor = scene.add(new Entity({ x: 0, y: 2, z: 0, width: 1, height: 2, depth: 1 }));
const body = scene.physics.add(actor, { type: 'dynamic', shape: 'capsule', radius: 0.4 });
body.setVelocity({ x: 1, y: 0, z: 0 });
app.scenes.start('main');
app.start();
```

Supported body types: `fixed`, `dynamic`, `kinematicPosition`, `kinematicVelocity`. Shapes: `cuboid`, `ball`, `capsule`. Physics worlds expose `add`, `get`, `remove`, `setPosition`, `setVelocity`, `getVelocity`, `setGravity`, `overlaps`, `castRay`, `on('enter'|'exit')`, `takeSnapshot`, `restoreSnapshot`, and `stateChecksum`. Use dynamic bodies plus `setVelocity` for characters that must collide and slide against the world; `kinematicPosition` follows an authored transform and does not provide automatic character-controller sliding.

The application owns the only fixed Tick. `scene.physics.step(dt)` is called by `app.step()` and rejects a timestep other than `1 / tickHz`. Do not add another RAF or step Rapier from the Renderer. Ray/overlap queries use Rapier's broad phase, which is refreshed by the first physics Tick after collider creation.

Snapshots restore the Rapier world and the current in-memory Entity-to-body registry. They do not serialize Entity, AI, input, gameplay rules or network state; complete rollback remains a game-level responsibility.

## Rebuild vendored WASM

From the HGame repository root:

```bash
npm run build:physics
npm run check:physics
```

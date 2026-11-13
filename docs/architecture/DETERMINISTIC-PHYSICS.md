# Deterministic Rapier Physics

## Pinned backends

- 2D: `@dimforge/rapier2d-deterministic@0.21.0`
- 3D: `@dimforge/rapier3d-deterministic@0.21.0`

The matching ESM glue, WASM, and Apache-2.0 license notice are vendored in `assets/runtime/vendor/`. There is no CDN fallback. A project loads only its configured dimension; projects with `physics: "none"` load neither backend.

## Project configuration

2D:

```json
{
  "configVersion": 1,
  "profile": "2d",
  "renderer": "canvas2d",
  "physics": "rapier2d",
  "tickHz": 60,
  "features": ["scene", "input", "physics2d"]
}
```

3D:

```json
{
  "configVersion": 1,
  "profile": "3d",
  "renderer": "threejs",
  "physics": "rapier3d",
  "tickHz": 60,
  "features": ["scene", "input", "physics3d"]
}
```

Create projects with `node scripts/create-game.mjs <folder> --profile 2d --with physics2d` or `--profile 3d --with physics3d`. The configuration validator rejects profile/backend mismatches.

## Lifecycle and API

The Application owns one fixed-step accumulator and one RAF. Each fixed step runs active components' `fixedUpdate(dt, app)`, advances the installed physics world with exactly `1 / tickHz`, then processes the frame boundary. Do not start another RAF or call `scene.physics.step()` manually.

The wrapper exposes body registration (`add`, `get`, `remove`), transforms and velocity (`setPosition`, `setVelocity`, `getVelocity`), queries (`overlaps`, `castRay`), gravity, enter/exit events, snapshots, checksums, tick counters, and `dispose()`.

Supported body types: `fixed`, `dynamic`, `kinematicPosition`, `kinematicVelocity`. Supported collider shapes: `cuboid`, `ball`, `capsule`. Physics bodies currently require root Entities.

## Snapshot and determinism limits

Rapier snapshots contain physics-world state and HGame's live Entity/body registry. They do not serialize gameplay state, AI, RNG, input history, scheduled entity changes, or network state. A complete replay/rollback format must be game-owned and use stable entity IDs.

The deterministic Rapier package constrains the physics backend; it does not make the entire game deterministic. Keep authoritative state separate from renderer objects, quantize inputs, use seeded RNG, sort simulation work by stable IDs, and avoid asynchronous creation/destruction of authoritative bodies.

A fixed floating-point timestep is not proof of cross-browser or cross-CPU lockstep. Compare complete game-owned state at matching ticks on each target runtime.

## Rebuild and verify vendor files

```powershell
npm ci
npm run build:physics
npm run check:physics
node --test tests/deterministic-physics.test.mjs
```

`check:physics` rebuilds the expected ESM output in memory and compares it byte-for-byte with the committed JavaScript and WASM files. Do not replace the deterministic packages with standard Rapier or another physics backend without an intentional compatibility review.

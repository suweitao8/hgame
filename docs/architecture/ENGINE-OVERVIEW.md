# HGame Runtime Architecture

## Positioning

HGame is a small, modular HTML5 runtime for standalone 2D, 3D, and UI-driven games. It borrows the Scene / Entity / Component / Prefab model and lifecycle vocabulary from common game engines; it is not a full editor, asset pipeline, or replacement for Unity, Godot, Three.js, PixiJS, or a dedicated game framework.

## Runtime layout

| Directory | Responsibility |
|---|---|
| `core/` | Project configuration, feature graph, Application, Scene, Entity, Component, PrefabRegistry |
| `platform/` | Browser input, assets, save namespace, audio, lifecycle, diagnostics, optional Host bridge |
| `integrations/` | Canvas 2D, Three.js, DOM, modular levels, world-aligned materials, optional 3D input/quality |
| `physics/` | Rapier2D/3D adapters and shared physics wrapper |
| `vendor/` | Pinned deterministic Rapier ESM/WASM bundles and license notice |
| `animation/` | SpriteSheet and AnimationPlayer |
| `world/` | TileMap and grid pathfinding helpers |
| `time/` | TweenManager |
| `lockstep/` | Optional confirmed-frame scheduler |

All game-specific rules, AI, content, balance, renderer ownership, and save schemas remain in the game project.

## Profiles

| Profile | Renderer | Tick | Default features |
|---|---|---:|---|
| `2d` | Canvas 2D | 60 Hz | `scene`, `input` |
| `3d` | Three.js | 60 Hz | `scene`, `input` |
| `ui` | DOM | 0 Hz | `scene` |

Physics and other optional modules are selected explicitly in `engine.config.json`. UI projects are command-driven and do not create an idle animation loop.

## Component lifecycle

Components may implement `awake`, `onEnable`, `start`, `fixedUpdate`, `update`, `lateUpdate`, `onDisable`, and `onDestroy`. The Application owns the only animation-frame scheduler and the fixed-step accumulator. Do not start a second RAF or advance the physics world from a renderer callback.

## Project configuration

`game.config.json` describes the game and optional Host-facing metadata. `engine.config.json` is the HGame runtime recipe: profile, renderer, physics backend, tick rate, and requested features. `defineProject()` validates incompatible combinations and `resolveFeatureGraph()` resolves feature dependencies.

## Create a project

```powershell
node scripts/create-game.mjs "D:\Games\demo-2d" --profile 2d
node scripts/create-game.mjs "D:\Games\demo-3d" --profile 3d --quality auto
node scripts/create-game.mjs "D:\Games\demo-ui" --profile ui
```

The generator refuses to overwrite an existing directory and creates a self-contained `vendor/hgame/` runtime copy. It includes only the selected Rapier dimension; projects without physics receive neither WASM bundle. Three.js files are copied only into 3D projects.

## Boundaries

- Fixed timestep is not proof of cross-platform deterministic lockstep.
- A Rapier snapshot is not a complete game snapshot.
- `model3d` is an integration slot, not a built-in GLTF/FBX importer.
- Complex animation, navmesh, IK, rollback, authoritative simulation, matchmaking, and production deployment remain separate systems.
- Existing games are not automatically migrated.

# Game Architecture and QA Guide

## Choose the renderer from the game loop

| Game shape | Preferred approach | HGame integration |
|---|---|---|
| Cards, dialogue, turn-based, management panels | DOM / CSS / SVG, command-driven | `ui` profile; no idle 60 Hz loop |
| Small 2D action, tower defense, top-down maps | Canvas 2D | `2d` profile; optional TileMap and sprite animation |
| Standard 2D projects | `2d` preset / profile (PixiJS starter) | PixiJS scene graph, shared atlas, batched sprites and effects, with the HGame application scheduler |
| High-density 2D CPU swarms | `horde` preset (PixiJS) | HGame swarm simulation with a Pixi particle layer and one application scheduler |
| Existing custom WebGL2 swarms | Explicit `--renderer webgl2d` | Hardware-instanced WebGL2 batching with automatic Canvas2D fallback and a single RAF |
| 3D scenes, first/third person, model animation | Three.js + HGame `post3d` / `lighting3d` / `culling3d` / `model3d` | `3d` profile or explicit renderer adapter |
| Advanced joints, CCD, or complex character controllers | Dedicated physics system | Enable the matching deterministic Rapier backend when suitable |

HGame is intentionally modular for AI-first game development: compose UI/meta systems with `ui/red-dot.js` + `integrations/red-dot-dom.js`, touch controls with `integrations/touch-controls.js` + `createArcadeControls`, and deliver minimal uploadable builds via `scripts/package-game.mjs` (`build/<id>_<version>/` + `.zip`). Keep a dedicated third-party library when the game needs capabilities beyond the runtime's actual scope.

## Separate authority from presentation

```text
Application
  ├── Domain: state, commands, rules, seeded RNG, save schema
  ├── Systems: AI, combat, collision policy, level events
  ├── Renderer: DOM, Canvas, PixiJS, Three.js
  └── Services: input, audio, assets, persistence, optional Host
```

Damage, health, cooldowns, currency, objectives, and win conditions belong to game rules. UI submits commands; renderers read snapshots. A mesh or DOM label must never be the only storage for authoritative game state.

For complex games, let Components call pure game-rule modules and project the resulting state into Entities. Avoid coupling simulation correctness to display objects.

## Input and lifecycle

- Convert keyboard, pointer, touch, and gamepad input into semantic game actions.
- The current platform input service provides keyboard and Pointer primitives; virtual sticks, gamepad policy, and multi-touch controls are explicit adapters.
- Clear held inputs on focus loss, page hide, pointer cancellation, and teardown.
- Audio must unlock after a user gesture; decode/playback failure must not prevent the core game from running.
- Release event listeners, audio, GPU resources, physics bodies, and subscriptions on scene or app disposal.

## Maps, collision, and AI

Keep visual map data separate from collision, spawn, trigger, navigation, and objective data. Units, grid anchors, world axes, and rotation conventions must be explicit. Use stable IDs for entities and deterministic ordering wherever gameplay outcomes depend on iteration order.

Do not infer AI quality from pathfinding existence. Test blocked routes, corners, narrow passages, crowded targets, moving obstacles, and repeated deadlocks with deterministic seeds and logs.

## Browser verification matrix

| Area | Verify | A passing build does not prove |
|---|---|---|
| Startup/offline | HTTP entry, module load, local assets, no unexpected 404 | Full playability |
| Input | Keyboard/pointer and required touch/gamepad paths; focus reset | Real mobile behavior from desktop emulation |
| Gameplay | Fixed seeds, damage, cooldowns, AI, win/loss, restart | Rule fidelity from visual similarity |
| Collision | Corners, walls, fast motion, narrow gaps, projectile paths | CCD correctness from AABB unit tests |
| Camera/layout | DPR, aspect ratios, resizing, coordinate mapping | Camera tracking from one screenshot |
| Audio/save | Gesture unlock, mute/volume, scene disposal, namespaced save | Successful playback from HTTP 200 |
| Stability | One RAF, listener cleanup, long-run frame time, memory | Long-term stability from one FPS reading |

Record the exact command, browser, viewport, input sequence, console errors, network failures, and observed result. Distinguish unit tests, browser automation, device testing, and human playtesting in reports.

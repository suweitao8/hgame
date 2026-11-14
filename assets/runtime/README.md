# HGame Runtime 1.0.0

This directory is the canonical, renderer-neutral runtime source. `core/` owns Scene/Entity/Component/Prefab and the single application scheduler; `platform/` provides browser services, spatial/cue audio, and an optional Host bridge; `integrations/`, `animation/`, `world/`, `time/`, `physics/`, and `lockstep/` are imported only when a project needs them.

## Module map

| Import path | Purpose |
|---|---|
| `./index.js` | Top-level entry (`HGame` facade, core, platform, tweens, animation, world/spatial, lockstep helpers) |
| `./core/*` | `defineProject`, `createGameApplication` (`renderAlpha`, `setTimeScale`, `hitStop`), `Scene` (`scene.tweens`, `findByTag`, `queryTags`), `Entity`, `Component`, `PrefabRegistry`, `tags.js` (`createTagContainer`, `matchGameplayTags`) |
| `./platform/*` | `createGameEngine`, `createAudioManager` (3D HRTF / 2D panning, multi-variant cues, acoustic occlusion, mix snapshots, limiter, MP3 trim), `input` (`createInputManager` multi-pointer + `wasPointerPressed`, `defineInputContext`, `createInputActionRouter` virtual inputs, `PLAYER_KEYMAPS`, `createArcadeControls`, `computeSplitScreenViews`), `assets`, `save`, `lifecycle`, `diagnostics`, `game-bridge` |
| `./time/tween.js` | `EASING` curves, `TweenManager`, `damp`, `dampAngle`, `stepSpring1D`, `SpringDamper1D/2D/3D`, sequence/yoyo/delay, 2D procedural motion presets (`idle`, `run`, `attackLunge`, `dieKnockback`) |
| `./animation/spritesheet.js`, `./animation/player.js` | `SpriteSheet` (`SpriteSheet.fromGrid`, `inset`), frame `AnimationPlayer` |
| `./world/tilemap.js`, `./world/spatial2d.js`, `./world/open-world.js` | `TileMap` viewport culling, octile `findGridPath`, `ObjectPool`, `SpatialHash2D` (`resolveSoftSeparation`), `createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin` |
| `./integrations/canvas2d.js`, `./integrations/webgl2d.js` | `Camera2D`, `Sprite2D`, high-density SoA `SpriteCrowd2D`, `createCanvas2DAdapter` (`setViews` split-screen), GPU-instanced `createWebGL2DAdapter` (`setViews` split-screen + automatic Canvas2D fallback) |
| `./integrations/three.js`, `./integrations/camera3d.js`, `./integrations/culling3d.js`, `./integrations/sky3d.js`, `./integrations/post3d.js`, `./integrations/lighting3d.js` | Three.js adapter (`setSky`/`setExposure`/`setPostVolumes`/`setViews` split-screen), `createSpringArm3D` / `createCameraRig3D` (trauma/recoil/FOV), frustum/convex-cone/hardware occlusion culling & `createInstancedBatch3D`, sky presets/shadows/light pool (`setLinearOutput`), WebGL2 MSAA HDR/SSAO/SSGI+SSR/Contact Shadows/Eye Adaptation/`ueFilmic`/`createPostProcessVolumeStack`, `createMegaLights3D` (`computeStochasticLightSample`) & `createIrradianceProbeVolume3D` |
| `./integrations/model3d.js`, `./integrations/world-aligned-material.js`, `./integrations/modular-level.js` | Rigged GLB loader (`inspectModel3D`, `prepareAnimationClips`, bone sockets, overlays, `AnimNotify`, `createAnimationBudgetAllocator`), VAT GPU crowd (`createInstancedCrowd3D`), world-aligned PBR + Specular AA (`shiftOffset` for floating origin), modular levels |
| `./integrations/quality3d.js`, `./integrations/touch-controls.js`, `./integrations/red-dot-dom.js`, `./integrations/fps-input3d.js`, `./integrations/dom.js`, `./integrations/trace.js` | Unified `low`/`medium`/`high`/`ultra` 2D & 3D presets (`QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`, `createAdaptiveQualityController`), opt-in touch virtual joystick & skill buttons (`createTouchControls`, `applyRadialDeadzone`), declarative `[data-red-dot]` DOM badge binder (`bindRedDotDOM`), FPS controls, DOM UI adapter, renderer-neutral JSONL trace recorder |
| `./ui/red-dot.js` | Commercial Trie + DAG hierarchical Red Dot System (`createRedDotSystem`, `computeCommercialDayKey`, `formatRedDotBadge`, 4 leaf modes: condition rule/count, persistent `NEW` unread, daily reset, cooldown timer; unlock gating, mute & `explain()`) |
| `./physics/*`, `./lockstep/confirmed-frames.js` | Deterministic Rapier2D/3D wrappers (`createCharacterController`), confirmed-frame lockstep buffer |

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

# HGame Runtime Architecture

## Positioning

HGame is a small, modular HTML5 runtime for standalone 2D, 3D, and UI-driven games. It borrows the Scene / Entity / Component / Prefab model and lifecycle vocabulary from common game engines; it is not a full editor, asset pipeline, or replacement for Unity, Godot, Three.js, PixiJS, or a dedicated game framework.

## Runtime layout

| Directory | Responsibility |
|---|---|
| `core/` | Project configuration, feature graph, Application (`renderAlpha`, `setTimeScale`, `hitStop`), Scene (`scene.tweens`, `findByTag`, `queryTags`), Entity (zero-GC world matrices, interpolation, lazy GameplayTags), Component, PrefabRegistry, hierarchical `tags.js` |
| `platform/` | Browser input (`createInputManager` multi-pointer/touch & scroll guard, `defineInputContext`, `createInputActionRouter` virtual inputs, `ARCADE_SLOTS`, `PLAYER_KEYMAPS`, `createArcadeControls`, `computeSplitScreenViews`), assets, save namespace, spatial/cue audio (3D HRTF, 2D stereo panning, acoustic low-pass occlusion, mix snapshots, multi-variant cues, MP3 silence trim, master limiter), lifecycle, diagnostics, optional Host bridge |
| `integrations/` | Canvas 2D (`Camera2D`, `Sprite2D`, high-density SoA `SpriteCrowd2D`, `setViews` split-screen) & GPU-instanced WebGL2 2D (`webgl2d.js`, `setViews` split-screen), Three.js adapter (`setSky`/`setExposure`/`setPostVolumes`/`setViews` split-screen), opt-in touch virtual joystick & skill buttons (`touch-controls.js`), declarative DOM red-dot badge binder (`red-dot-dom.js`), `camera3d.js` (`createSpringArm3D`, `createCameraRig3D`), frustum/occlusion culling & GPU instancing (`culling3d.js`), sky/light pool (`sky3d.js`), WebGL2 HDR post-processing (`post3d.js`: `ueFilmic`, SSGI/SSR, contact shadows, GPU eye adaptation, `createPostProcessVolumeStack`), clustered many-light & `SH L1` irradiance probes (`lighting3d.js`: `createMegaLights3D`, `createIrradianceProbeVolume3D`), world-aligned materials (`specularAA`, `anisotropy`, `shiftOffset`), rigged model provider, `AnimNotify`, `createAnimationBudgetAllocator` & VAT crowds (`model3d.js`), unified `low`/`medium`/`high`/`ultra` quality presets (`quality3d.js`), DOM, modular levels, optional 3D input |
| `ui/` | Commercial hierarchical Trie + DAG Red Dot engine (`red-dot.js`: `createRedDotSystem`, value/rule, persistent `NEW` unread, daily reset with timezone/reset-hour support, cooldown timers, diamond deduplication, unlock gating, anti-harassment muting, and `explain()`) |
| `physics/` | Rapier2D/3D adapters, rotation/angular velocity sync, `createCharacterController`, and shared physics wrapper |
| `vendor/` | Pinned deterministic Rapier ESM/WASM bundles and license notice |
| `animation/` | SpriteSheet (`fromGrid`, `inset`) and AnimationPlayer |
| `world/` | TileMap (`viewBounds` viewport culling and `SpriteSheet` rendering), binary-heap octile `findGridPath`, horde `SpatialHash2D` / `ObjectPool` (`spatial2d.js`), and open-world streaming / HLOD / floating origin (`open-world.js`: `createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin`) |
| `time/` | `TweenManager` & `EASING` (`yoyo`, `repeat`, `sequence`, `killTweensOf`, 2D motion presets), analytical `SpringDamper1D/2D/3D`, `damp`, `dampAngle` |
| `lockstep/` | Optional confirmed-frame scheduler |

All game-specific rules, AI, content, balance, renderer ownership, and save schemas remain in the game project.

## Profiles

| Profile | Renderer | Tick | Default features |
|---|---|---:|---|
| `2d` | `canvas2d` (default) or `webgl2d` | 60 Hz | `scene`, `input` |
| `3d` | `threejs` | 60 Hz | `scene`, `input` |
| `ui` | `dom` | 0 Hz | `scene` |

Physics and other optional modules are selected explicitly in `engine.config.json`. UI projects are command-driven and do not create an idle animation loop.

## Component lifecycle

Components may implement `awake`, `onEnable`, `start`, `fixedUpdate`, `update`, `lateUpdate`, `onDisable`, and `onDestroy`. The Application owns the only animation-frame scheduler and the fixed-step accumulator. Before each fixed step, the Application snapshots entity transforms and exposes `app.renderAlpha` in `[0, 1]` (`1` for UI profile) so renderers can smooth motion via `Entity.interpolatedWorldMatrixInto(alpha, out)` or `Entity.interpolatedWorldPosition(alpha, out)` (calling `entity.snapTransform()` after teleports to avoid trailing interpolation). Do not start a second RAF or advance the physics world from a renderer callback.

## Project configuration

`game.config.json` describes the game and optional Host-facing metadata. `engine.config.json` is the HGame runtime recipe: profile, renderer, physics backend, tick rate, and requested features. `defineProject()` validates incompatible combinations and `resolveFeatureGraph()` resolves feature dependencies.

## Create a project

```powershell
node scripts/create-game.mjs "D:\Games\demo-2d" --profile 2d
node scripts/create-game.mjs "D:\Games\demo-3d" --profile 3d --quality auto
node scripts/create-game.mjs "D:\Games\demo-ui" --profile ui
```

The generator refuses to overwrite an existing directory and creates a self-contained `vendor/hgame/` runtime copy. It includes only the selected Rapier dimension; projects without physics receive neither WASM bundle. Three.js files are copied only into 3D projects.

## Scripts & asset tooling

- `scripts/create-game.mjs`: generates standalone 2D / 3D / UI projects with `vendor/hgame/` and `scripts/package-game.mjs`.
- `scripts/package-game.mjs`: content-aware release bundler that traces active ES modules, verifies and packages only the active Rapier 2D/3D WASM (when enabled), prunes unused runtime/authoring files, and writes `build/<id>_<version>/` plus `build/<id>_<version>.zip` (also supports `--engine` for clean SDK archives).
- `scripts/preview.mjs`: ephemeral loopback HTTP fixture used internally by headless CI/QA tools (`snapshot.mjs`, `playtest.mjs`, benchmarks) or offline inspection of packaged `build/<id>_<version>` artifacts. Live development, management, and interactive browser QA must use **WebAsset** (`http://127.0.0.1:4174/#games` / `http://127.0.0.1:4175/local-games/<slug>/index.html`) without starting per-game HTTP servers.
- `scripts/build-physics.mjs`: rebuilds vendored Rapier2D/3D ESM + WASM bundles from pinned npm versions.
- `scripts/process-assets.mjs` (`npm run process:assets`): zero-dependency PNG `1x1`/`2x2`/`3x3` splitter, background removal (`transparent`/`green` with despill/`white` BFS flood-fill), sole-fringe cleanup, and tier resolution capping (shadow-free actors by default).
- `scripts/process-audio.mjs` (`npm run process:audio`): selects the 2–4 most consistent audio takes via `ffmpeg`, aligns RMS loudness and tail length, trims encoder silence, and exports clean MP3s (see [ASSET-AND-AUDIO-PIPELINE.md](../guides/ASSET-AND-AUDIO-PIPELINE.md) and [WASM-PROTECTION-AND-ANTI-CHEAT.md](../guides/WASM-PROTECTION-AND-ANTI-CHEAT.md)).

## Boundaries

- Fixed timestep is not proof of cross-platform deterministic lockstep.
- A Rapier snapshot is not a complete game snapshot.
- `model3d` is an optional integration slot; `integrations/model3d.js` accepts an injected loader such as `GLTFLoader` rather than bundling a GLTF/FBX parser into core.
- Complex animation trees, navmesh, IK, rollback, authoritative simulation, matchmaking, and production deployment remain separate systems.
- Existing games are not automatically migrated.

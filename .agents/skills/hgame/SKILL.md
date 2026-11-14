---
name: hgame
description: >-
  Complete workflow and API runbook for creating, building, optimizing, curating
  art/audio, testing, and packaging self-contained 2D, 3D, UI, and multiplayer
  HTML5 games with the HGame 1.0.0 engine. Activate whenever working in the
  HGame repository or building/packaging an HGame project.
---

# HGame 1.0.0 Agent Runbook

Use this skill as the primary execution manual whenever a user asks to create, extend, optimize, debug, or package a game with **HGame 1.0.0**.

## 0. Determine Workspace Context First

Check which folder the current workspace is in before running commands:

- **HGame Engine Source Repository**: contains `assets/runtime/VERSION` (`1.0.0`) and `scripts/create-game.mjs`.
  - Use this repo to generate new games, curate art/audio sheets, preview any game folder, build optional `network/` servers, or package external games (`npm run package:game -- <game-dir> --version <ver>`).
  - Never add game-specific rules or private assets here; edit `assets/runtime/` only when changing the engine itself (and follow [AGENTS.md](../../../AGENTS.md)).
- **Generated Standalone Game Project**: contains `engine.config.json`, `game.config.json`, `src/main.js`, and `vendor/hgame/VERSION`.
  - Keep all game logic, AI, levels, and save schemas in `src/` and `assets/`.
  - Treat `vendor/hgame/` as a vendored runtime copy (do not treat ad-hoc edits there as an engine source change).

---

## Step 1: Generate a New Project (Engine Repo)

From the HGame engine root (after `npm ci`):

```powershell
# 2D Canvas game
node scripts/create-game.mjs "<game-dir>" --profile 2d --with audio,save --name "Game Title"

# 2D High-Density Survivor / Bullet-Hell (5,000-10,000+ sprites, WebGL2 + auto Canvas2D fallback)
node scripts/create-game.mjs "<game-dir>" --profile 2d --renderer webgl2d --with audio,save --name "Horde Game"

# 3D Three.js game with adaptive quality and deterministic physics
node scripts/create-game.mjs "<game-dir>" --profile 3d --quality auto --with physics3d,model3d,audio,save --name "3D Game"

# UI / Card / Narrative game (tickHz: 0, no idle 60 Hz RAF)
node scripts/create-game.mjs "<game-dir>" --profile ui --with audio,save --name "Card Game"
```

- Folder basename must be an ASCII slug (`[A-Za-z0-9][A-Za-z0-9_-]{0,79}`); pass localized titles via `--name`.
- Optional `--with` flags: `scene`, `input`, `assets`, `audio`, `save`, `diagnostics`, `physics2d`, `animation2d`, `tilemap2d`, `pathfinding2d`, `physics3d`, `model3d`, `adaptiveQuality3d`.
- Explicit physics flags: `--physics rapier2d | rapier3d | none`; `--tick-hz <1..240>` (for `2d`/`3d`).
- Inspect output before writing via `--dry-run`.

---

## Step 2: Curate Art & Audio Sheets (Engine Repo)

1. **AI Art Sheet Slicing & Cutout** (`scripts/process-assets.mjs`):
   - Supports `1x1` (`--grid 1`), `2x2` (`--grid 2`), `3x3` (`--grid 3`) PNG sheets and `--bg transparent | green | white`.
   - Default `--mode actor` removes background/green spill, strips faint sole fringes, and exports **shadow-free** PNGs so runtime `Sprite2D.groundShadow` / `SpriteCrowd2D` draws dynamic shadows cleanly.
   ```powershell
   npm run process:assets -- --input sheet.png --grid 3 --bg green --mode actor --out-dir "<game-dir>/assets/actors"
   ```
2. **Audio Variant Selection & Normalization** (`scripts/process-audio.mjs`, requires `ffmpeg`):
   - Feed 4 generated MP3 takes per SFX cue; automatically selects the 2–4 most duration/RMS-consistent variants, trims MP3 silence, normalizes loudness, and exports mono 24 kHz MP3 (`96k`) or stereo 44.1 kHz BGM (`128k` with `--bgm`).
   ```powershell
   npm run process:audio -- --cue rifle_shot --inputs t1.mp3,t2.mp3,t3.mp3,t4.mp3 --out-dir "<game-dir>/assets/audio/sfx"
   ```

---

## Step 3: Implement Gameplay Using Built-in `vendor/hgame/` Modules

Read `engine.config.json` and `game.config.json` first. Import modules from `../vendor/hgame/...` inside `src/main.js` (`./vendor/hgame/...` from project root). **Always reuse existing runtime subsystems instead of reimplementing them:**

| Need | Exact Runtime Path | Key Exports & Conventions |
|---|---|---|
| **Core Loop & Tags** | `index.js`, `core/*` | `HGame.defineProject`, `createApplication`, `Scene`, `Entity` (`addTag`, `matchesTags`, `scene.queryTags`), `app.renderAlpha`, `app.hitStop`, `app.setTimeScale` |
| **Motion & Feel** | `time/tween.js` | `scene.tweens` (`idle`, `run`, `attackLunge`, `dieKnockback`), `EASING`, `damp`, `dampAngle`, `SpringDamper1D/2D/3D` |
| **2D Sprites & Pathfinding** | `integrations/canvas2d.js`, `animation/*`, `world/tilemap.js` | `createCanvas2DAdapter`, `Camera2D`, `Sprite2D` (`groundShadow: true`, `hitFlash`), `SpriteSheet.fromGrid`, `AnimationPlayer`, `TileMap`, `findGridPath` |
| **2D 5k–150k+ Swarms** | `integrations/webgl2d.js`, `world/spatial2d.js`, `world/swarm-ecs.js`, `world/gpu-swarm-webgl2.js` | `<1.5k` use `Entity`; `1.5k–15k` use `SpriteCrowd2D` + `SpatialHash2D`; `15k–150k+` use `createSwarmSimulation` (`FlowField2D`, `FlatSpatialHash2D`, `FlatCombatECS` 10m/12m, 3-tier separation) + `SpriteCrowd2D.bindSwarm` / `syncToSpriteCrowd2D` (`createWebGL2DAdapter`), or `createGpuSwarmWebGL2` (`bindGpuSwarm`) for pure-GPU FBO simulation |
| **3D Sky, MegaLights & Post** | `integrations/three.js`, `sky3d.js`, `lighting3d.js`, `post3d.js` | `createThreeAdapter` (`toneMapping: 'ueFilmic'`, `setSky`, `setExposure`, `setPostVolumes`), `createProceduralSky3D`, `createMegaLights3D`, `createIrradianceProbeVolume3D`, `createPostProcessVolumeStack` |
| **3D Culling, Camera & Crowd** | `integrations/culling3d.js`, `camera3d.js`, `model3d.js`, `world-aligned-material.js` | `createInstancedBatch3D`, `createSceneCuller3D`, `createCameraRig3D` / `createSpringArm3D`, `createModel3DProvider` (`<200` full rig), `createInstancedCrowd3D` (Vertex-VAT), `createBoneVatCrowd3D` (HalfFloat Bone-VAT + 16B packed 3-LOD + `syncFromSwarm` / `syncFromGpuSwarm`, offline `npm run bake:vat` -> `.vat.bin`), `createWorldMaterialPalette` |
| **Open World** | `world/open-world.js` | `createWorldPartition` (hysteresis streaming), `createHLODProxyGroup3D`, `createFloatingOrigin` (`Float64` precision + palette/physics sync) |
| **Unified Low/Med/High Quality** | `integrations/quality3d.js` | `renderer.setQuality('low' \| 'medium' \| 'high' \| 'ultra')`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`, `createAdaptiveQualityController` |
| **Touch / Arcade / Split-Screen** | `platform/input.js`, `integrations/touch-controls.js` | Touch-first `app.input.pointers`; optional HUD `HGame.createArcadeControls` + `createTouchControls` (`mode: 'touch-only'`); P1 `WASD` + `JKL UIO` (reserve `Q E`); P2 `Arrows` + `123456` (reserve `0 .`); `HGame.computeSplitScreenViews` + `renderer.setViews` |
| **Commercial Red Dot Tree** | `ui/red-dot.js`, `integrations/red-dot-dom.js` | `HGame.createRedDotSystem` (Trie + DAG `link`, `registerRule`, `markUnread`, `registerDaily`, `setReadyAt`, `setUnlocked`, `setMuted`, `explain`) + `bindRedDotDOM` (`data-red-dot`, `data-red-dot-ack`) |
| **Spatial & Variant Audio** | `platform/audio.js` (`app.services.audio`) | 4 buses + limiter, `registerCue`/`playCue` (2–4 variants), 3D `HRTF` (`position` + `updateListenerFromCamera`), 2D `position2D`, `handle.setPosition`, `setOcclusionProbe`, `registerSnapshot`/`applySnapshot` |
| **Deterministic Physics & Replay** | `physics/rapier2d.js`, `physics/rapier3d.js`, `integrations/trace.js` | Pinned Rapier `0.21.0`, `scene.physics.add`, `createCharacterController`, `takeSnapshot`/`restoreSnapshot`, `stateChecksum`, `HGame.createTraceRecorder` |
| **Multiplayer Foundation** | `lockstep/confirmed-frames.js`, `network/` | `createConfirmedFrameScheduler`, `StateSyncRoom` / `PredictedRoom` / `LockstepRoom` (isolated workspace under `network/`) |

### Mandatory Architecture Rules

1. **Single Scheduler**: `app.start()` owns the only RAF and fixed step. Never create a second RAF or step physics from render hooks.
2. **UI Projects**: Keep `tickHz: 0`; use `app.dispatch(...)` rather than an idle 60 Hz loop.
3. **3D Collision Separation**: Never derive collisions or authoritative gameplay state from visual PBR meshes (`model-slots.json` / `materials.json`); keep colliders explicit in `level.json`.
4. **Controls Standard**: Keep PC actions inside P1's `WASD + JKL UIO` (and P2's `Arrows + 123456` for 2P split-screen) unless genuinely exhausted, enabling `Q E` / `0 .` only via `extras` or `enableExtras: true`.
5. **Red Dot Standard**: Keep parent UI badges lit automatically via `createRedDotSystem` until every active child leaf has been handled; never hand-code flat boolean flags or manual DOM removals.
6. **Incremental Milestone Commits & Clean `main`**: Never pile up uncommitted changes on `main` across multiple stages. After each verified milestone (`npm run check` / `npm test`), commit immediately with a clear message and push to the configured remote (`git push`) right away; for multi-step features or optimizations, work on a short-lived topic branch (`feat/<topic>`, `perf/<topic>`, `fix/<topic>`), commit each milestone, and merge back to `main` once verified (pushing after each commit).

---

## Step 4: Preview & Verify

- Serve via loopback HTTP (ES modules fail on `file://`):
  ```powershell
  node scripts/preview.mjs "<game-dir>" --port 4176
  ```
- In a standalone game project:
  ```powershell
  npm test
  npm run check
  ```
- In the HGame engine repo:
  ```powershell
  npm test
  npm run check:physics
  npm run check:all
  ```
- Optional Chromium verification requires explicit `playwright-core` + Chrome paths (`node tests/browser-profiles.mjs --playwright <path> --chrome <exe>`). Report exact checks executed; never claim browser coverage when only Node checks ran.
- After verification passes for a milestone (new system, optimization pass, bug fix, or docs update), commit the verified milestone immediately and push to the configured remote (`git push`) rather than leaving dirty diffs stacked on `main`.

---

## Step 5: Build Lean Deliverable (`build/<id>_<version>/` + `.zip`)

Never archive the raw project directory (which leaks `.git/`, `tests/`, `scripts/`, `AGENTS.md`, authoring art, and unused modules). Always run `package-game.mjs`:

```powershell
# Inside a generated game directory (outputs build/<id>_<version>/ + .zip):
npm run release -- --version 1.1

# From the HGame engine repo targeting any external game directory:
npm run package:game -- "<game-dir>" --version 1.1

# Omit the outer folder wrapper in the ZIP if a hosting portal expects index.html at ZIP root:
node scripts/package-game.mjs --version 1.1 --flat-zip
```

- Automatically traces `index.html`, `src/`, CSS, ESM imports, `Three.js` transitive modules (preserving `MIT` license), and `engine.config.json` physics.
- Automatically provisions/validates `rapier2d.wasm` or `rapier3d.wasm` (`\0asm` magic + `Apache-2.0` notice) when enabled and removes all WASM when `physics` is `"none"`.
- In the HGame engine root, `npm run release` builds the complete SDK deliverable (`build/hgame_1_0/` + `build/hgame_1_0.zip`).

---

## Detailed Reference Guides

- Complete Chinese User & Agent Handbook: [USER-AND-AGENT-GUIDE.md](../../../docs/guides/USER-AND-AGENT-GUIDE.md)
- Engine Architecture & Platform API: [ENGINE-OVERVIEW.md](../../../docs/architecture/ENGINE-OVERVIEW.md), [PLATFORM-API.md](../../../docs/architecture/PLATFORM-API.md)
- Deterministic Physics & Multiplayer: [DETERMINISTIC-PHYSICS.md](../../../docs/architecture/DETERMINISTIC-PHYSICS.md), [NETWORK.md](../../../docs/architecture/NETWORK.md), [LOCKSTEP.md](../../../docs/architecture/LOCKSTEP.md)
- 3D Pipeline & World-Aligned PBR: [PIPELINE-3D.md](../../../docs/rendering/PIPELINE-3D.md), [WORLD-ALIGNED-PBR.md](../../../docs/rendering/WORLD-ALIGNED-PBR.md)
- Art Slicing, Audio Cues & QA: [ASSET-AND-AUDIO-PIPELINE.md](../../../docs/guides/ASSET-AND-AUDIO-PIPELINE.md), [GAME-ARCHITECTURE-AND-QA.md](../../../docs/guides/GAME-ARCHITECTURE-AND-QA.md)

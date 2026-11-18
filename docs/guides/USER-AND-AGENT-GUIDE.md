# HGame 1.0.0 AI Agent Execution Manual

> Pure AI-Native Contract: **Zero manual GUI editors**. Author all scenes, levels, balance tables, dialogue graphs, UI stacks, shaders, and audio parameters in code + declarative JSON, then verify via zero-dependency validators, `snapshot`, and `playtest`.

Start with a playable HTML game in WebAsset. Play its core loop and use the result to prioritize gameplay and engine improvements. Evaluate the game and the AI workflow against the [repository review criteria](../../AGENTS.md#product-scope-reviews-and-priorities). Add a publishing target when a specific game has a concrete release request for it.

## 1. Lookup First (Zero Blind Scan)

Run `npm run api` from the HGame repo root for engine-wide discovery:

```powershell
npm run api -- --map             # Capability router (Need -> Module -> Key APIs)
npm run api -- --recipe 2d       # Runnable wiring for: 2d | horde | 3d | ui | network
npm run api -- <keyword>         # Exact signatures, return fields & option keys
npm run api -- --module post2d   # Every export in one module
```

In a generated game, run `npm run api -- --module <name> --json` against the game's bundled API snapshot. Use `npm run api -- --recipe current` to read the current contents of its selected starter entry. Runtime TypeScript declarations live alongside the JavaScript under `vendor/hgame/`.

---

## 2. Two Directory Contexts

| Context | Key Files | Workflow |
|---|---|---|
| **HGame Engine Repo** | `assets/runtime/`, `scripts/create-game.mjs`, `docs/api/API-INDEX.json`, `.agents/skills/` | Create projects, slice AI art/audio, build `network/`, package any external game, run `npm run check:all` & `npm run release`. Never put game-specific rules/assets here. |
| **Standalone Game** | `engine.config.json`, `game.config.json`, `src/main.js`, `vendor/hgame/` | Author all rules, AI, levels, and save schemas in `src/` & `assets/`. Treat `vendor/hgame/` as a vendored copy. Run `npm test`, `npm run check`, `npm run release -- --version <ver>`. |

---

## 3. Project Generation Matrix (`scripts/create-game.mjs`)

| Game Type | Command (from HGame root; basename must be ASCII slug `[A-Za-z0-9_-]`) |
|---|---|
| **Standard 2D Action / Platformer** | `node scripts/create-game.mjs "<dir>" --preset 2d --name "Title"` |
| **2D Horde / Bullet-Hell** | `node scripts/create-game.mjs "<dir>" --preset horde --name "Horde"` |
| **3D Action / World** | `node scripts/create-game.mjs "<dir>" --preset 3d --name "3D"` |
| **Card / Narrative / Commercial UI** | `node scripts/create-game.mjs "<dir>" --preset ui --name "Title"` |
| **Blank Scaffold (no demo assets)** | Add `--bare` (`2d` or `3d`). Preview config without writing: `--dry-run`. |

Use `--preset horde` to start with HGame's CPU swarm simulation and a PixiJS particle layer. Its capacity, population and sprite dimensions are in `src/swarm.json`. The 3D preset selects adaptive quality and Rapier 3D. Pass `--physics none` when the design needs no physics backend.

New `2d` and `horde` presets use PixiJS. For `2d`, explicit `--renderer webgl2d` or `--renderer canvas2d` selects a legacy renderer; `horde` also supports explicit `--renderer webgl2d`. Existing games are not migrated.

Pixi projects open in WebAsset immediately from the seeded bundle. Run `npm run build:pixi` after editing the entry or its imports to refresh the WebAsset preview. Packaging a newly generated project rebuilds the entry when it detects source changes. If build dependencies are missing, run `npm ci` in the project. The release retains reachable chunks with their content-hashed filenames and original bytes.

Both 3D starters put camera, fog, lights, tone mapping and exposure in `src/presentation.json` under `renderer`. Use `quality` to choose the initial mode and `renderer.worldLighting` to tune fog, hemisphere light and sun. The populated starter uses `materials.json` for the PBR palette, `model-slots.json` for procedural props or replacement GLBs, and `level.json` for placements, spawn and collision. It supports keyboard and left-side touch movement, and scenes release presentation resources on unload.

Each 3D model slot may specify `"castShadow": true|false` and `"receiveShadow": true|false`. These settings apply to both individual clones and instanced batches without modifying shared model prototypes. When omitted, the source mesh settings are preserved; imported GLB meshes typically need explicit `true` values when shadows are desired. Disabling shadow casting for distant or decorative slots can reduce shadow-map work.

For an optional procedural sky, set `"sky": { "preset": "goldenHour", "environment": true }` in `presentation.json`. Presets include `day`, `goldenHour`, `overcast`, `dusk`, and `night`. The scene advances and disposes the sky automatically. `environment: true` bakes an environment reflection once at startup; it is not updated as clouds move and adds GPU memory and startup work. The default `null` leaves the previous background unchanged. Sky colors and sun direction do not automatically change the scene's directional or hemisphere lights; configure `renderer.worldLighting` to match.

`renderer.limitCameraDrawDistance` applies the quality tier's draw distance up to the configured camera far plane. `chunkCells` controls the grid region size for large static instance batches. Dense regions each get their own culling bounds. Small and scattered batches stay grouped. Set `chunkCells` to `0` to batch by slot across the whole level.

List model slots that must have their final art before the first playable frame in `presentation.startupModelSlots`. Other replacement slots start with their procedural geometry and upgrade after startup. Keep the fallback geometry coherent with separately authored collision. Enable `renderer.worldLighting.sun.shadow.adaptiveExtent` to cap the built-in sun's shadow coverage by the active quality tier.

Both 3D starters can load glTF geometry compressed with Meshopt. The same loader backs modular replacements and `--with model3d`, which exposes the rigged model provider as `app.services.model3d`. The decoder loads only when compressed geometry is requested.

The populated starter also supplies a lazy skeleton-aware clone for skinned GLB model slots. Slots accept skinned meshes only when the GLB contains no animation clips; they clone these meshes rather than flattening them into static instances, so each placement has independent bones. For models containing clips and animated characters, use `app.services.model3d` to manage loading and animation playback. Direct users of `createProceduralModelSlots` must provide `cloneSkeleton` (for example Three.js `SkeletonUtils.clone`) when a slot contains a skinned mesh.

The modular level renderer releases slot-owned cloned skeletons on level replacement or disposal. If using `models.instantiate()` or `models.instantiateBatch()` directly, call `models.releaseInstance(root)` after removing the instance; shared model geometry and materials remain owned by the model library. `models.dispose()` also releases any remaining cloned skeletons.

`engine.config.json` owns the active renderer and runtime feature selection. `hgame.project.json` records release policy for a preset project. `runtime: "entry-graph"` includes the active renderer and feature modules and traces scripts from the HTML entry and game imports. A wide `vendor/hgame/index.js` import still brings along its dependencies. Prefer leaf imports in new `src/` files. Add fully computed HGame module paths to `includeRuntime`, for example `["gameplay/quests.js"]`, and computed `src/` imports to `includeSource`, for example `["levels/intro.js"]`. The generated standalone packager uses the same rules.

---

## 4. Curate Art & Audio & Sync Off-Git CAS

- **Runtime asset IDs and scoped loading**: author `assets/catalog.json`, use `createAssetCatalog` and release a scope when its scene unloads. `assetMode: "catalog"` in `hgame.project.json` selects catalog assets for release. [Asset catalog workflow](ASSET-CATALOG.md)
- **2D Actor Cutout**: generate 1K pure white `#FFFFFF` `3x3` grid sheets, shadow-free:
  `npm run process:assets -- --input sheet.png --grid 3 --bg white --mode actor --out-dir "<dir>/assets/actors"`
- **2D Sprite Atlas**: group frequently co-rendered sprites and run `npm run process:assets -- --atlas-dir "<png-dir>" --atlas-out "<game-dir>/assets/atlases/world.png"`. Load the PNG once and use the matching `frames[name]` from the JSON as each `Sprite2D.sourceRect`.
- **Audio Normalization** (when using real `.mp3`; otherwise skip and use `playSynth` + `createBgm` 0-KB synth):
  `npm run process:audio -- --cue hit --inputs t1.mp3,t2.mp3,t3.mp3,t4.mp3 --out-dir "<dir>/assets/audio/sfx"`
- **Local 3D AI Modeling & Normalization** (ComfyUI Trellis2/UltraTex + headless Blender; paths in `.hgame.local.json`):
  `npm run process:model3d -- doctor | generate | inspect | normalize | texture | qa`
- **CAS Binary Store** (binaries stay out of Git via `assets.manifest.json`):
  `npm run assets -- push|pull|status|verify "<dir>"`

---

## 5. System Cards (Load On Demand Only)

| ID | Capability | Card |
|---|---|---|
| 01 | Core lifecycle, `renderAlpha`, `hitStop`, GameplayTags, `sim/` RNG/checksum | [systems/01-core-lifecycle-tags.md](systems/01-core-lifecycle-tags.md) |
| 02 | Tweens & `SpringDamper1D/2D/3D` | [systems/02-tween-spring.md](systems/02-tween-spring.md) |
| 03 | 2D Sprites, dynamic `groundShadow`, `SpriteSheet`, `TileMap` A* | [systems/03-sprite-2d-pathfinding.md](systems/03-sprite-2d-pathfinding.md) |
| 04 | 2D 5k–150k+ Swarms (`webgl2d`, `SpriteCrowd2D`, `swarm-ecs`, `gpu-swarm-webgl2`) | [systems/04-horde-2d.md](systems/04-horde-2d.md) |
| 05 | 3D `ueFilmic`, `sky3d`, `MegaLights3D`, `IrradianceProbeVolume3D` | [systems/05-render-3d-megalights.md](systems/05-render-3d-megalights.md) |
| 06 | 3D Post Stack, SSGI/SSR, Culling, GPU Instancing, `SpringArm3D` | [systems/06-post-culling-camera-3d.md](systems/06-post-culling-camera-3d.md) |
| 07 | 3D GLB Rigged Models, Bone-VAT Crowds, World-Aligned PBR, Open World | [systems/07-model-vat-open-world.md](systems/07-model-vat-open-world.md) |
| 08 | Unified Quality Tiers (`low` / `medium` / `high` / `ultra`) | [systems/08-quality-tiers.md](systems/08-quality-tiers.md) |
| 09 | Touch-First, Arcade P1 (`WASD+JKL UIO`) / P2 (`Arrows+123456`) & Split-Screen | [systems/09-touch-arcade-splitscreen.md](systems/09-touch-arcade-splitscreen.md) |
| 10 | Commercial Red Dot Tree (Trie + DAG + DOM Binder) | [systems/10-red-dot.md](systems/10-red-dot.md) |
| 11 | 2D Art Slicing, Spatial `HRTF` Audio & Multi-Variant Cues | [systems/11-art-audio-pipeline.md](systems/11-art-audio-pipeline.md) |
| 12 | Deterministic Rapier 2D/3D, `createTraceRecorder` & Multiplayer | [systems/12-physics-trace-network.md](systems/12-physics-trace-network.md) |
| 13 | AI Decision Kernel (`createStateMachine` HFSM, `createBehaviorTree`, `createNavMesh3D`) | [systems/13-ai-fsm-bt-navmesh.md](systems/13-ai-fsm-bt-navmesh.md) |
| 14 | 2D Atmospheric Lighting/Bloom (`post2d`), 3D Terrain (`terrain3d`) & 17 Props | [systems/14-post2d-terrain3d-props.md](systems/14-post2d-terrain3d-props.md) |
| 15 | Commercial UI Kit (`PanelStack`, `VirtualList`, `i18n`) & `createVersionedStore` | [systems/15-ui-kit-i18n-versioned-save.md](systems/15-ui-kit-i18n-versioned-save.md) |
| 16 | 0-KB Synth SFX (`playSynth`) & Adaptive BGM Sequencer (`createBgm`) | [systems/16-procedural-bgm.md](systems/16-procedural-bgm.md) |
| 17 | Attributes, Status Effects, Skills & Cooldowns (`GameplayComponent`, `createGameplayActor`) | [systems/17-gameplay.md](systems/17-gameplay.md) |
| 18 | Branching Dialogue & Quest Progression (`createStoryRunner`, `createQuestLog`) | [systems/18-story-and-quests.md](systems/18-story-and-quests.md) |
| 19 | Inventory, Equipment & Reward Admission (`createInventory`) | [systems/19-inventory-and-equipment.md](systems/19-inventory-and-equipment.md) |
| 20 | Weighted Loot & Crafting (`createLootSystem`, `createCraftingBook`) | [systems/20-loot-and-crafting.md](systems/20-loot-and-crafting.md) |
| 21 | Skill timing with animation, sound and effect cues (`AbilityDefinition.timeline`) | [systems/21-ability-timelines.md](systems/21-ability-timelines.md) |
| 22 | Staged Encounters, Spawn Waves & Checkpoints (`EncounterComponent`) | [systems/22-encounters.md](systems/22-encounters.md) |
| 23 | Prefab Placement, Spawn Points & Trigger Volumes (`mountLevel`) | [systems/23-level-assembly.md](systems/23-level-assembly.md) |
| 24 | Level Preload, Scene Switching & Resource Ownership (`createLevelFlow`) | [systems/24-level-flow.md](systems/24-level-flow.md) |

---

## 6. Mandatory Constraints & Verification Pipeline

1. **Direct `main` Only, Single-Conversation & Mandatory Stage Commits**: Develop **exclusively on `main` in the active workspace** (isolated workspaces/worktrees and non-`main` branches are strictly forbidden; only one conversation develops at a time). Every development conversation must verify, `git commit` its stage changes on `main` (never piling up diffs), and `git push` before finishing.
2. **Single RAF Loop**: `app.start()` owns the only RAF + fixed step. UI profile (`tickHz: 0`) must use `app.dispatch(...)`, never a 60 Hz idle loop.
3. **3D Collision Separation**: Never derive collisions or gameplay truth from PBR visual meshes; keep explicit colliders / Rapier heightfield.
4. **Never Zip Raw Project**: Always release with `npm run release -- --version <ver>` / `npm run package:game -- <dir> --version <ver>`.
5. **Unified WebAsset Game Management & Preview (No Standalone Websites)**: Register and preview all web games via **WebAsset** (`http://127.0.0.1:4174/#games` -> `http://127.0.0.1:4175/local-games/<slug>/<entry>` via `game.config.json`). **Never** launch per-game dev servers (`npm start`, `npm run serve`, `python -m http.server`, or manual `preview.mjs` websites) during development, playtesting, or browser QA; point browser QA directly at WebAsset. (`scripts/preview.mjs` is strictly an ephemeral internal harness for headless `snapshot`/`playtest`/CI.)
6. **Verification Commands**:
   - Logic + types + API index + physics: `npm run check` (or `npm run check:all` when touching `network/`)
   - Headless render PNG & state hook (`window.__hgameState`): `npm run snapshot -- <game-dir>`
   - Live input + FPS + pixel-change assertion: `npm run playtest -- <game-dir>`
   - Honesty: Never claim browser/device coverage unless Chromium/device checks actually executed.

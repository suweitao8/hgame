# Changelog

## Unreleased

- Add declarative level assembly with prefab hierarchies, named spawn points and tag-filtered trigger volumes in 2D and 3D. Level-owned entities and staged spawn batches clean up on failure. One-shot triggers can be restored from a save.

- Add fixed-step encounters with scheduled waves, spawn backpressure, clear/survival/signal gates, timeouts and stage-entry checkpoints. Encounter signals can drive quests and scene transitions.

- Add fixed-step ability timelines with animation clip hints, timed cues, a commit point and recovery. Presentation can share one start/cue/end/cancel contract across sprite and model animation.

- Add deterministic weighted loot tables, persistent per-source reward receipts and batch crafting with station and tag requirements. Loot claims and crafting use inventory transactions to preserve pending rewards and materials when the bag is full.

- Add slotted inventories with stack limits, atomic exchanges, equipment and attribute modifiers. Claim a complete quest's rewards only when its entire item bundle fits. Inventory snapshots retain slot layout and equipment.

- Run `story.json` graphs with conditional choices, variables, signals and resumable saves. Track prerequisite quests, consecutive stages and filtered objectives from the same signals, with explicit reward claims and JSON snapshots.

- Add an opt-in gameplay runtime with bounded attributes, source-owned modifiers, stackable and periodic effects, and abilities with costs, shared cooldowns, charges, casting, channeling and buffered input. Use `GameplayComponent` in fixed-step scenes or `createGameplayActor` for command-driven games. Actor snapshots persist attributes, effects and cooldown state.

- Keep readable save storage when writes are blocked or its quota is exhausted, preserving existing progress and surfacing explicit write errors. Probe availability without modifying storage. Successful migrated/recovered loads report automatic writeback failures through optional `writebackError` while keeping valid data readable; retry on the next load.

- Checksum versioned saves after JSON conversion so dates, optional fields, typed arrays and non-finite numbers remain readable. Validate serialization before changing the primary or backup slot, including migrated saves.

- Verify rendered 3D releases directly from standard and Toy ZIPs in Chromium CI. Capture nested entry paths and retain startup HTTP and JavaScript errors in snapshot reports.

- Minify the two vendored Three.js modules in standard and Toy game releases when esbuild is available. Preserve constructor names, module paths and the MIT notice. Use `--no-minify` to package the source files.

- Preload the vendored Three.js entry and core modules in 3D starters and Arena, so both downloads can start during HTML parsing.

- Start generated profiles and reference games from their required runtime modules, loading configuration and shared modules in parallel.
- Remove unused Rapier 3D from the Arena reference game's engine configuration. Its simulation uses its own ray and box collision code.

- Rebase application frame timing on browser visibility transitions. Hidden frames leave adaptive 3D quality alone, and the next visible frame starts a new diagnostic timing window.
- Skip recording a frame when an adaptive-quality callback disposes the application or resets its frame clock.
- Release touch gestures and discard buffered overlay button actions when the page becomes hidden or loses focus.

- Preserve starter and reference game state when a browser caches the document during navigation. Continue disposing resources on page exit. Report the current scene in the bare starter state hooks.

- Apply adaptive 3D resolution scaling to the capped drawing buffer. Keep the reduced scale when switching to a lower quality tier and honor the configured maximum on entry to auto mode.
- Size 3D post-processing targets to the canvas drawing buffer and combine size and preset changes into one rebuild. Skip repeated renderer and target sizing when the dimensions are unchanged.

- Keep Model3D resources from superseded owned asset revisions until provider disposal, then release shared resources once. Pending model requests reject during disposal, including requests for a superseded version.
- Release cloned Model3D component bone textures on destruction while keeping borrowed roots and shared asset geometry alive. Allow destruction before `awake()` and finish resource cleanup when a dispose listener throws.
- Report asynchronous feature disposal failures through diagnostics while keeping application disposal synchronous.

- Re-upload WebGL2D sprite images after context restoration and allow retry after a failed upload. Release GPU textures when text cache entries are evicted. Reuse one scratch canvas and GPU texture for `customDraw` sprites with a clean drawing state for every callback.

- Keep one pending animation frame when a ready or update callback pauses and resumes its application. Stopping the application cancels that frame.
- Roll back a failed startup if a ready callback or initial render throws so the application can be started again.

- Release input and the remaining platform services when a lifecycle disposal listener throws. Clear lifecycle subscriptions even on callback failure and report cleanup errors after teardown.

- Execute all API recipes against generated entry points in CI. Correct tick/locale getters, swarm capacity/spawn/step/count wiring, VFX adapter ownership, the optional model provider requirement, and the confirmed-frame scheduler's explicit subpath import.
- Prevent scene-transition callbacks from activating the next scene after application disposal, and reject entity reattachment or new roots during scene cleanup.
- Cancel the rest of an in-flight tween/timer update when its callback disposes the manager or application. Do not execute scene hooks, later timers or tween completion callbacks after teardown.

- Prevent asynchronous installation and ready callbacks from reviving disposed applications. Terminate in-flight update work after disposal and expose `app.disposed`.
- Complete entity, scene, service, renderer and owned-platform cleanup even when user cleanup callbacks throw, then report all errors with `AggregateError`. Preserve idempotent disposal and borrowed-platform ownership.
- Keep generated 3D quality settings in entry code so `game.config.json` conforms to WebAsset's discovery allowlist, including bare starters. Legacy quality metadata remains readable.
- Map the engine's `webgl2d` renderer to WebAsset's `webgl-custom` catalog value while preserving the selected backend in `engine.config.json`.
- Verify reference-game movement, combat, natural death under controlled pressure, three restart cycles, persistent best scores, input release and renderer/touch teardown in browser CI. Add serializable state hooks and compact HUDs with opt-in debug stats.
- Make automated playtests fail explicitly when a declared state hook throws or cannot serialize its result.

- Preserve multi-second and end-of-window stalls in automated playtest telemetry. Retain whole-run counters and extrema with bounded, explicitly labelled reservoir quantiles, and report requested and actual measurement durations.
- Replace best-only CPU timings with repeated median/tail distributions and repeatable swarm/VFX preparation. Add synchronized render measurements, explicit software/hardware modes, actual GPU/browser provenance, and target-frame versus software-health budget labels.
- Reject invalid numeric workload, viewport and timing options before starting browser or CPU work, including malformed input-action durations.

- Strengthen FSM, behavior-tree and versioned-save declarations with context/schema generics, typed methods and discriminated load results. Generate declarations with strict nullability and verify public consumers, including detached component getters. These type-level corrections expose invalid calls and unsafe historical-data assumptions in TypeScript consumers.
- Preserve imported type-query bindings in generated facades, validate declarations without skipping library checks, and correct inferred VFX options and panel payload types. Correct the 3D API recipe's VFX scene argument.
- Preserve each API export's implementation stability and declaration origin through root facades and aliases, and expose these fields in API query results.

- Make snapshot baseline updates failure-safe with atomic replacement after capture validation, including shared output/baseline paths. Keep failed candidate images as separate diagnostics.
- Capture frozen-clock snapshots without waiting for live element-stability frames and disable CSS animations during capture.
- Add `npm run check:visual` with a version-controlled accepted Git revision, same-environment reference/candidate rendering, and retained PNG/JSON diagnostics. CI now uses this check and browser baseline-safety tests in place of cache-dependent baseline acceptance.

- Unified WebAsset Game Management & Preview Standard (`AGENTS.md`, `assets/template/AGENTS.md`, `assets/template/README.md`, `.agents/skills/hgame/SKILL.md`, `docs/guides/USER-AND-AGENT-GUIDE.md`, `docs/architecture/ENGINE-OVERVIEW.md`, `README.md`):
  - Codify unified **WebAsset** management and preview (`http://127.0.0.1:4174/#games` lobby; `http://127.0.0.1:4175/local-games/<slug>/<entry>` runtime via `game.config.json`) across HGame engine rules, global/repo skills, and generated project templates, forbidding per-game dev servers (`npm start`, `npm run serve`, `python -m http.server`, manual `preview.mjs` preview ports) during development, playtesting, and browser QA while reserving `scripts/preview.mjs` strictly for ephemeral headless/CI/packaged harnesses.

- Bilibili Toy Platform SDK Integration, Packaging Standard & Skill (`integrations/bilibili-toy.js`, `scripts/package-game.mjs`, `scripts/toy-preflight.mjs`, `.agents/skills/hgame-bilibili-toy/`, `docs/guides/BILIBILI-TOY-STANDARD.md`):
  - Add `assets/runtime/integrations/bilibili-toy.js` (`createToyBridge`, `createToyCloudSaveAdapter`, `loadBilibiliToySdk`, `isBilibiliToyEnvironment`, `isToyRateLimitError`) wrapping `window.toy` with `307044` jittered exponential-backoff retries, key/score/byte validation, checkpoint-batched cloud/shared saves, App/Web fallbacks, and local preview storage fallbacks.
  - Add `--target toy` (plus `--toy-sdk`/`--no-toy-sdk`, `--slug`, `--poster`, `--icon`) to `scripts/package-game.mjs` and `npm run package:toy` / `npm run toy:check` via `scripts/toy-preflight.mjs`, enforcing flat ZIP root, `contenthash` entry JS/CSS renaming, `toy-sdk.js` head injection, <=1MB `index.html` gate, `<10000px` image limits, relative URL checks, rate-limit heuristics, and Toy capability advisories (`AUDIO_VIDEO_UPLOAD`, `EXTERNAL_SERVICE_ACCESS`, `USER_CONTENT_INPUT`, `CHARGE_UNLOCK`, `LARGE_PACKAGE_UPLOAD`).
  - Encapsulate the official Toy SDK (`types/toy.d.ts`), packaging standard, and `toy` CLI two-stage release workflow into `.agents/skills/hgame-bilibili-toy/` and wire `scripts/create-game.mjs` + `assets/template/package.json` with `package:toy` and `toy:check`.

- AI-Native Documentation & Query Tooling (`scripts/query-api.mjs`, `docs/`, `AGENTS.md`, `.agents/skills/hgame/SKILL.md`):
  - Upgrade `npm run api` with `--map` (intent-to-module capability router) and `--recipe <2d|horde|3d|ui|network>` (runnable boilerplate + `__hgameState` verification hook), plus `--json` output.
  - Rewrite `README.md` and `docs/guides/USER-AND-AGENT-GUIDE.md` into pure AI-Native execution specs, align `--bg white` default in `docs/guides/ASSET-AND-AUDIO-PIPELINE.md`, remove stale `docs/guides/ENGINE-GAPS.md`, add compact system cards `13..16`, and expose `__hgameState` + `data-engine-ready` in bare 2D/3D starters.

- Versioned Save Store & Automated AI Playtest Runner (`platform/storage.js`, `scripts/playtest.mjs`):
  - Add `createVersionedStore` wrapping `SaveStore` with sequential `v -> v + 1` schema migrations, FNV-1a envelope tamper detection, and automatic `.bak` backup slot recovery.
  - Add `npm run playtest -- <game-dir>` (`scripts/playtest.mjs`) to boot loopback preview + headless Chromium, drive scripted keyboard/pointer inputs, collect rAF FPS/stutter telemetry, and verify non-blank & reactive gameplay with zero JS/HTTP errors.

- 3D Procedural Heightfield Terrain & Expanded Props (`world/terrain3d.js`, `integrations/procedural-models.js`, `physics/rapier-world.js`):
  - Add `createHeightfieldTerrain3D` & `fbmNoise2D` with exact bilinear height/normal/slope/biome queries, Three.js vertex-colored mesh builder, deterministic prop scatter (`scatterPositions`), and direct Rapier3D heightfield physics (`attachPhysics`, exposing `world.RAPIER`).
  - Expand `createProceduralModelSlots` with 7 new shapes (`arch`, `crate`, `barrel`, `crystal`, `rock`, `pine`, `turret`).

- 2D Modern Atmospheric Lighting & Post-Processing (`integrations/post2d.js`, `integrations/webgl2d.js`, `integrations/canvas2d.js`):
  - Add zero-alloc `createLighting2DState` (ambient tint + up to 32 dynamic world-space point lights + `bloomIntensity`, `bloomThreshold`, `vignette`, `hitPulse`, `chromatic`, `saturation`, `contrast`) with automatic bypass when inactive.
  - Add WebGL2 offscreen scene FBO + half-res separable Bloom + composite shader in `createWebGL2DPostPass`, plus Canvas2D `'lighter'` radial fallback in `renderCanvas2DPostPass`.

- Zero-KB Procedural Adaptive BGM Sequencer (`platform/audio/bgm-synth.js`, `platform/audio.js`):
  - Add 6 built-in moods (`dungeon`, `cyber`, `boss`, `chill`, `adventure`, `victory`), deterministic step planner (`generateBgmStep`, `midiToHz`), intensity-scaled drums/arps (`setMood`, `setIntensity(0..1)`), WebAudio + headless fixed-step `update(dt)` support (`createProceduralBgm`, `audio.createBgm`).

- AI Decision Kernel & 3D NavMesh (`ai/fsm.js`, `ai/bt.js`, `ai/index.js`, `world/navmesh3d.js`):
  - Add zero-GC Hierarchical Finite State Machine (`createStateMachine` with LCA parent/child enter-exit, guarded/event transitions).
  - Add shared-definition Behavior Tree runner (`createBehaviorTree`, `BT_STATUS`, `sequence`, `selector`, `parallel`, `inverter`, `repeater`, `cooldown`, `condition`, `action`, `wait`) with priority preemption and per-instance typed memory.
  - Add height-aware 3D NavMesh + A* + LOS string-pulling smoother (`createNavMesh3D`), and allowlist `ai/` in `scripts/package-game.mjs`.

- Commercial UI Kit, i18n & AI-Native Zero-GUI Contract (`ui/panel-stack.js`, `ui/virtual-list.js`, `ui/i18n.js`, `ui/index.js`):
  - Add stack-based UI modal/overlay router (`createPanelStack` with Escape/cancel back-stack, exclusive/pinned modes, transition alphas, and optional `bindDom`).
  - Add zero-alloc virtualized list/grid window (`createVirtualList` with fixed-grid and variable-height prefix-sum scrolling + DOM row pooling).
  - Add localization helper (`createI18n` with nested keys, `{param}` interpolation, `_zero`/`_one`/`_other` plurals, and fallback locales).
  - Codify the AI-Native Zero-GUI-Editor contract in `AGENTS.md`, `assets/template/AGENTS.md`, and `.agents/skills/hgame/SKILL.md`.

- Unified off-Git art & audio asset management:
  - Expand `.gitignore` across the engine root, generated game template (`assets/template/.gitignore`), and examples (`examples/*/.gitignore`) to exclude large binary media (`png`, `jpg`, `webp`, `glb`, `gltf`, `vat.bin`, `mp3`, `ogg`, `wav`, fonts, video) and raw DCC sources (`.psd`, `.blend`, `.fbx`, `assets/raw/`), keeping Git repositories focused on code, configs, and lightweight `assets.manifest.json`.
  - Add `scripts/assets.mjs` (`npm run assets -- push|pull|status|verify|rm|prune-store`) for SHA-256 content-addressed storage (`HGAME_ASSET_STORE` / `~/.hgame/asset-store`, plus optional HTTP `--remote`) with `assets.manifest.json` scaffolded into every project by `scripts/create-game.mjs`.
  - Update `scripts/package-game.mjs` to skip `assets.manifest.json` in release bundles and automatically resolve any missing-locally manifest assets from the unified store (`resolvedFromStore`), failing clearly if neither disk nor store holds declared assets.

- Camera, Three shadow helper & CI verification (ENGINE-GAPS 5/6/7):
  - `integrations/camera3d.js`: add zero-GC `createBoxCollisionTest(boxes, { inflateByProbe })` supporting `{ minX..maxZ }`, `{ x, y, z, hx, hy, hz }`, and floor-standing `{ x, z, hx, hz, h, y? }` AABB obstacles for `createSpringArm3D` / `createCameraRig3D`.
  - `integrations/shadow3d.js` + `integrations/three.js`: extract `fitDirectionalShadowFrustum` into `shadow3d.js` (re-exported cleanly by `sky3d.js` without pulling sky shaders into minimal 3D builds) and expose `renderer.fitShadowToPreset(sun, target, options)` on the Three.js adapter using the active quality tier's `shadowDistance`.
  - `.github/workflows/ci.yml`: generate, zero-threshold verify, and cache OS-native snapshot baselines in `.ci-baselines/` via `actions/cache@v4` for `survivor-2d` and `arena-3d` with `--freeze-time`.
  - `ui/red-dot.js` & `platform/audio.js`: finish splitting graph/persistence (`ui/red-dot/graph.js`, `ui/red-dot/persistence.js`) and bus/voice playback (`platform/audio/buses.js`, `platform/audio/voice.js`) into focused sub-modules with identical public exports and behavior.

- Generator & packager (ENGINE-GAPS 1/2):
  - `create-game --bare` (2d/3d): emits only configs, a minimal empty-scene `src/main.js` and the vendored runtime — no demo `level.json`, `materials.json`, `model-slots.json`. Bare entries live in `assets/profiles/{2d,3d}-bare/`.
  - `package-game`: Rapier WASM is bundled only when `src/` uses `scene.physics`/Rapier modules (static scan) or `game.config.json` sets `physics.bundleWasm: true`. Declared-but-unused physics omits the WASM and strips the physics feature from the release `engine.config.json`; uncertain scans keep the safe default (bundle) with a note. Result adds `wasmSkipped` and `notes`.

- Deterministic sim helpers (sim/*.js, re-exported from `index.js` & `HGame`): `createSeededRng`, `hashState` / `createStateChecksum`, `runScripted`. Camera (`integrations/camera3d.js`): `createSpringArmRayProbe(castRay)` adapter for `collisionTest` and `cameraRelativeMove`; typed/documented the collision-test contract.

- High-Density 100k+ 2D/3D Crowd Pipeline Optimizations:
  - `SwarmSimulation` (`world/swarm-ecs.js`): add 3-tier distance-decimated neighbor separation (`< 25m` 60Hz + bilinear flow, `25m–65m` 4-frame staggered separation with `sepX`/`sepY` caching, `> 65m` cell density damping), module-level `buildSwarmStepGrid` / `stepSwarmSequential` kernels, coarse `32x32` spatial chunks (`ensureChunks`, chunk-accelerated `applyCircleDamage`), and zero-copy default `syncToSpriteCrowd2D`. Raise capacity limits to `262,144` across `SwarmSimulation`, `SpriteCrowd2D`, `WebGL2D`, and `BoneVatCrowd3D`.
  - 3D Coarse Chunk Frustum/LOD Fast-Path (`integrations/culling3d.js`, `integrations/model3d/bone-vat.js`): add 3-state `classifySphere` (`0` outside, `1` intersecting, `2` strictly inside) on `FrustumCuller3D` / `SceneCuller3D`; upgrade `BoneVatCrowd3D.syncFromSwarm` with coarse chunk culling, branch-free strictly-inside single-LOD loops, and flat clip lookup arrays.
  - 2D Zero-Relay `16-Byte` Instancing (`integrations/canvas2d.js`, `integrations/webgl2d.js`): add `SpriteCrowd2D.bindSwarm` / `bindGpuSwarm` / `unbindSwarm` plus a compact `16-Byte` (`vec4 aPacked2D`) GLSL3 instanced shader path and coarse chunk culling in `WebGL2D` (and Canvas2D fallback).
  - Pure-GPU Ping-Pong FBO Swarm (`world/gpu-swarm-webgl2.js`, re-exported as `createGpuSwarmWebGL2` from `index.js` & `HGame`): `RGBA32F` double-buffered GPU swarm stepping from `FlowField2D` `.rg8` textures, wired into `BoneVatCrowd3D.syncFromGpuSwarm` and `WebGL2D` via vertex-shader `texelFetch` (`0` bytes uploaded per frame), with automatic CPU fallback when WebGL2 is absent.
- Swarm & 3D Bone-VAT Crowd (`world/swarm-ecs.js`, `integrations/model3d/bone-vat.js`, `scripts/bake-bone-vat.mjs`):
  - Add renderer-neutral zero-GC swarm runtime in `assets/runtime/world/swarm-ecs.js` (re-exported via `index.js` & `HGame`): 1D intrusive linked-list `FlatSpatialHash2D` (`createFlatSpatialHash2D`), ring-buffer SPFA/Dijkstra `FlowField2D` (`createFlowField2D`, `setWallsFromTileMap`, `rg8`), fixed-slot SoA `FlatCombatECS` with 10m/12m hysteresis promote/demote and back-pressure-safe patch cleanup, and integrated `createSwarmSimulation` (`syncToSpriteCrowd2D`).
  - Add IEEE-754 Half-Float Bone-VAT (`bakeBoneVatData` with `bindMatrix` folding & antipodal quaternion hemisphere continuity, `"HVAT"` binary `encodeBoneVatBinary`/`decodeBoneVatBinary`, `buildSimplifiedLodGeometry` voxel-clustering + 1-bone collapse) and 16-byte packed 3-LOD GPU crowd `createBoneVatCrowd3D` (`LOD0` 4-bone / `LOD1` 1-bone / `LOD2` 8-direction azimuth billboard, `syncFromSwarm`) in `assets/runtime/integrations/model3d.js`.
  - Add offline Bone-VAT baker CLI `scripts/bake-bone-vat.mjs` (`npm run bake:vat`) and `.bin` MIME support in `scripts/preview.mjs`.
- Tooling: `npm run bench:render3d` (`benchmarks/render-bench-3d.mjs`) 3D stress benchmark (instanced batch + MegaLights + post3d + sky + camera rig) with frame stats, draw calls/triangles and non-blank check; wired into the CI browser job.

- Tooling: generated TypeScript declarations in `types/` (`build:types` / `check:types`, enforced in CI); performance budgets (`npm run bench`); e2e profile test (generate -> test -> package for 2d/3d/ui); CI browser smoke and benchmark jobs; `docs/guides/API-STABILITY.md`.
- Agent tooling: `npm run snapshot` (headless render PNG + JSON stats + baseline diff), `docs/api/API-INDEX.json` (machine-readable API with option-bag keys and returned members, `build:api-index` / `check:api-index`), `docs/guides/AI-VERIFICATION.md`, browser render benchmark (`bench:render`), and the USER-AND-AGENT guide split into `docs/guides/systems/*`.
- Diagnostics: `createDiagnostics().snapshot()` now also reports `frameTimeP95Ms`, `frameTimeMaxMs` and `longFrames`. Config validation errors list valid values and suggest the closest match.
- Physics: add `physics.addTileMap(scene, map, options)` (2D) generating merged fixed colliders from a TileMap with y-up conversion.
- Types: JSDoc typedefs for option bags and returned objects across core/platform/time/animation/2D/3D/physics/world/ui; generated `types/` now has no `any` in public signatures. Added `tests/genre-conformance.test.mjs` (platformer, horde, card/UI, 3D action, puzzle, lockstep) and `tests/browser-snapshot.mjs`; `bench:render` now includes the default 3D scene.
- Internal refactor (no API change): `post3d`, `model3d`, `input`, `audio` and `red-dot` split into sub-modules; original paths re-export the same public names.

## 1.0.0 - 2026-11-14

- Core & Deterministic Physics:
  - Establish the canonical standalone HGame runtime (`assets/runtime/`, version `1.0.0`), 2D/3D/UI starter profiles, standalone project generator (`scripts/create-game.mjs`), and loopback preview server (`scripts/preview.mjs`).
  - Add fixed-step transform snapshots with `app.renderAlpha`, zero-GC `Entity.worldMatrixInto` / `interpolatedWorldMatrixInto` / `snapTransform`, Rapier2D/3D 0.21.0 deterministic WASM bundles (`build-physics.mjs`), rotation & angular velocity synchronization (`enabledRotations`, `lockRotations`, `setRotation`, `setAngularVelocity`), snapshot-resilient `createCharacterController`, and lazy `scene.tweens` lifecycle management.
- Gameplay Systems, Camera, Budgets, Audio & Replication:
  - Add hierarchical, reference-counted gameplay tags (`core/tags.js`: `createTagRegistry`, `createTagContainer`, `matchGameplayTags`), lazy `Entity` tag APIs (`addTag`/`removeTag`/`hasTag`/`matchesTags`), and `Scene.findByTag` / `Scene.queryTags`.
  - Add frame-rate-independent exponential smoothing (`damp`, `dampAngle`) and analytical critically-damped springs (`LN2_CRIT`, `stepSpring1D`, `SpringDamper1D/2D/3D`) in `time/tween.js`, plus global time dilation and sub-frame hit-stop (`app.setTimeScale`, `app.hitStop`, `app.clearHitStop`, constant fixed physics step) in `core/application.js`.
  - Add priority-layered input mapping contexts, key consumption, chorded bindings, hold timers, and input buffering (`defineInputContext`, `createInputActionRouter`) in `platform/input.js`.
- 2D Horde Engine, Procedural Juice & WebGL2 Instancing:
  - Add `Camera2D` (`follow`, `bounds`, `shake`, `getViewBounds`), rotated AABB frustum culling, `Sprite2D` visual transform decoupling (`anchorX`/`anchorY` overrides, `offsetX`/`offsetY`, `scaleX`/`scaleY`, `rotation`/`visualRotation`, `tint`, `flash`, `hitFlash`), `'source-in'` silhouette tint/flash compositing, analytical floor-locked `groundShadow` rendering, SoA `SpriteCrowd2D` (`O(1)` swap-back recycling for 5,000–10,000+ horde instances), and `WeakMap` `tintCache` in `integrations/canvas2d.js`.
  - Add hardware-instanced WebGL2 2D renderer `integrations/webgl2d.js` (`createWebGL2DAdapter`, `renderer: 'webgl2d'` in `defineProject` & `create-game.mjs`) with automatic Canvas2D fallback.
  - Upgrade `SpriteSheet` (`SpriteSheet.fromGrid`, `inset`), `TileMap.draw()` `viewBounds` culling, `findGridPath` (binary `MinHeap` + octile diagonal movement), `TweenManager` & `EASING` (17 easing curves, `delay`, `repeat`, `yoyo`, `tag`, `overwrite`, `killTweensOf`, `sequence`, and 2D motion presets `idle`/`run`/`attackLunge`/`dieKnockback`), and zero-GC `ObjectPool` + `SpatialHash2D` (`world/spatial2d.js`).
- 3D Rendering, UE-Inspired Lighting/Post-Processing, Rigged Models & Open World:
  - Add `integrations/sky3d.js` (`SKY3D_PRESETS`, procedural sky dome, `bakeEnvironment`, `fitDirectionalShadowFrustum`, `createLightPool3D`, `setLinearOutput`) and `integrations/post3d.js` (WebGL2 MSAA HalfFloat HDR + DepthTexture, `ueFilmic` S-curve tone mapper, CIE Planckian white balance, ASC-CDL grading, SSGI/SSR with bilateral blur, full-res screen-space Contact Shadows, GPU Eye Adaptation downsample pyramid, Karis bloom, FXAA/sharpen/grain/IGN dither, and priority/distance-feathered `createPostProcessVolumeStack`).
  - Add `integrations/lighting3d.js` (`createMegaLights3D` clustered `16x8x16` log-Z many-light renderer for `1..1024` dynamic lights via IGN stochastic sampling + `createIrradianceProbeVolume3D` `SH L1` lattice probes), `integrations/culling3d.js` (frustum culling, 5-ray software occlusion, async WebGL2 hardware occlusion queries, `createInstancedBatch3D`), and `integrations/camera3d.js` (`createSpringArm3D` asymmetric collision probe + `createCameraRig3D` trauma/recoil/FOV).
  - Add opt-in `applyGeometricSpecularAA` / `specularAA` / `anisotropy` / `shiftOffset` in `world-aligned-material.js`, `integrations/model3d.js` (Unreal namespace/root-motion cleanup, bone sockets, `playOverlay`/`stopOverlay`, zero-miss `AnimNotify`, distance Animation LOD + `createAnimationBudgetAllocator`, and VAT RGBA float texture `createInstancedCrowd3D`), `integrations/three.js` (`calibrateGpu`, unified `setSky`/`setExposure`/`setPostVolumes`), and `world/open-world.js` (`createWorldPartition`, `createHLODProxyGroup3D`, `Float64` `createFloatingOrigin`).
  - Standardize `low`/`medium`/`high` (plus 3D `ultra`/`auto`) runtime quality presets (`QUALITY_TIERS`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`) in `integrations/quality3d.js`.
- Spatial & Multi-Variant Audio + Offline Asset/Audio Tooling:
  - Upgrade `platform/audio.js` with master `DynamicsCompressorNode` limiter across `sfx`/`spatial`/`music`/`ambience` buses, `duckBus`, 3D binaural `HRTF` `PannerNode`, `updateListenerFromCamera`, 2D `StereoPannerNode`, live `handle.setPosition`, per-voice acoustic low-pass occlusion (`setOcclusionProbe`/`updateOcclusion`), mix snapshots (`registerSnapshot`/`applySnapshot`/`clearSnapshot`), PCM silence trimming (`analyzeAudioBuffer`) for gapless MP3 loops and zero-latency one-shots, and `registerCue` / `playCue` (2–4 variant anti-repeat selector + loudness/duration alignment, `cooldownMs`, `pitchJitter`, loop-preserving `maxPolyphony`).
  - Add zero-dependency PNG `1x1`/`2x2`/`3x3` cutout script (`scripts/process-assets.mjs`), `ffmpeg`-backed variant curation script (`scripts/process-audio.mjs`), and `docs/guides/ASSET-AND-AUDIO-PIPELINE.md`.
- Mobile Touch-First, Virtual Joystick/Buttons & Local Split-Screen Controls:
  - Upgrade `createInputManager` (`platform/input.js`) with multi-pointer tracking (`pointers`, `pointerCount`, `getPointer`, `isPointerDown`, `wasPointerPressed`, `wasPointerReleased`, `pointercancel` cleanup, `preventKeys`) and add `setVirtualAction`/`setVirtualAxis1D`/`setVirtualAxis2D`/`clearVirtualInputs` on `createInputActionRouter`.
  - Add standardized `ARCADE_SLOTS`, `PLAYER_KEYMAPS`, `createArcadeControls`, and `computeSplitScreenViews` in `platform/input.js`: P1 (`WASD` + `J K L U I O`, opt-in extras `Q E`), P2 (`ArrowUp/Left/Down/Right` + `1..6`, opt-in extras `0 .`), enforcing 6-primary-button discipline by default.
  - Add opt-in `integrations/touch-controls.js` (`createTouchControls`, `applyRadialDeadzone`), `setViews`/`getViews` split-screen rendering & pane-aware picking across `canvas2d.js`/`webgl2d.js`/`three.js`, mobile hardening in `assets/template/style.css`, and template rule 12.
- Commercial Hierarchical Red Dot System:
  - Add renderer-neutral Trie + DAG Red Dot engine (`ui/red-dot.js`, re-exported via `index.js` / `HGame`) with `RED_DOT_STYLES`, `normalizeRedDotPath`, `splitRedDotAncestors`, `computeCommercialDayKey`, `formatRedDotBadge`, `createRedDotSystem` supporting condition count/rule (`99+`), persistent `NEW` unread items (`syncUnreadScope`), configurable daily reset hour/timezone reminders, cooldown `setReadyAt`, non-recursive vs recursive `acknowledge`, cross-entry DAG `link`/`unlink` with cycle rejection and diamond deduplication, `setUnlocked` ghost-dot gating, `setMuted`, `batch` dirty coalescing, and `explain()`.
  - Add declarative DOM badge binder `bindRedDotDOM` (`integrations/red-dot-dom.js`) supporting `[data-red-dot]`, `[data-red-dot-mode]`, `[data-red-dot-ack]`, dynamic `MutationObserver`/`refresh()`, and template rule 13.
- Lean Release Packaging, Multiplayer Synchronization & Repository Governance:
  - Add `scripts/package-game.mjs` (`npm run release` in generated games and `--engine` SDK release in engine repo) tracing exact HTML/importmap/ESM dependencies, verifying/bundling only the active Rapier 2D/3D WASM backend when enabled, stripping dev/raw files, and writing `build/<id>_<version>/` + upload-ready `build/<id>_<version>.zip`, plus template rule 14 and `scripts/preview.mjs` hardening.
  - Add isolated `network/` workspace features (`encodeTransformSnapshot`/`encodeTransformDelta`, `InterestGrid2D`, `LagCompensationHistory`, `ReplicationPriorityScheduler`, `SnapshotInterpolationBuffer`, `AdaptiveInputLeadController`, `TokenBucketRateLimiter`, anti-stall `NO_OP` + `LockstepRoom` catch-up), `docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md`, and `Apache-2.0` licensing (`LICENSE`) preserving bundled Rapier (`Apache-2.0`) and Three.js (`MIT`) notices.

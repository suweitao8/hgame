# HGame Repository Rules

HGame is a standalone, renderer-neutral HTML5 game runtime. This repository is the source of truth for the engine, starter templates, project generator, tests, and optional multiplayer foundation.

## Source of truth

- Canonical runtime: `assets/runtime/`.
- Runtime version: `assets/runtime/VERSION`; keep it consistent with `HGAME_VERSION` in `assets/runtime/index.js` and the root package version.
- New project generator: `scripts/create-game.mjs`.
- Lean release & WASM packager: `scripts/package-game.mjs` (`build/<id>_<version>/` + `.zip`).
- Offline media curation: `scripts/process-assets.mjs` and `scripts/process-audio.mjs`.
- Starter projects: `assets/template/` and `assets/profiles/`.
- Optional multiplayer workspace: `network/`; it owns its package manifest and lockfile.
- Global HGame Skill installations and game projects are downstream consumers. Do not silently edit them while changing this repository.

## Architecture boundaries

1. Keep the runtime modular. A project loads only the profile and optional features declared by `engine.config.json`.
2. `core/` owns Scene, Entity, Component, Prefab, and the single application scheduler.
3. `platform/` owns browser services and the optional WebAsset Host protocol adapter. Game rules, AI, content, and renderers remain game-owned.
4. `physics/` uses the pinned deterministic Rapier 0.21.0 packages. Offline/online mode never changes the selected physics backend.
5. `lockstep/` is an optional confirmed-frame scheduler, not a complete transport, authoritative simulation, rollback, or matchmaking implementation.
6. `network/` owns transport, room/session lifecycle, and synchronization primitives only. It must not absorb game-specific rules, AI, balance, or save data.

## Public repository safety

- Never add private material libraries, local Unreal exports, proprietary game assets, game dumps, reverse-engineering reports, secrets, or machine-specific paths.
- Keep only third-party runtime files with their corresponding license notices. HGame is licensed under `Apache-2.0` (`LICENSE`); preserve Rapier's `Apache-2.0` notice (`assets/runtime/vendor/LICENSE-rapier.txt`) and Three.js's `MIT` license (`assets/optional/three/LICENSE`) when distributing those files.
- Keep `.env.example`; never commit `.env` or credentials.

## Verification

- Runtime tests: `npm test`.
- Vendored physics parity: `npm run check:physics`.
- Network tests/check/build: run the corresponding npm command from `network/` or use the root forwarding scripts (`npm run check:all`).
- Package a game release (`build/<id>_<version>/` + `.zip`): `npm run package:game -- <game-dir> --version <ver>`.
- Full engine SDK release build (`build/hgame_1_0/` + `.zip`): `npm run release`.
- Browser profile smoke tests are optional and require `playwright-core` plus a Chromium executable.
- Machine-readable API index: `docs/api/API-INDEX.json` (regenerate with `npm run build:api-index`); generated declarations: `types/` (`npm run build:types`). `npm run check` fails when either is stale.
- Headless render verification for agents: `npm run snapshot -- <game-dir>` (PNG + JSON stats + baseline diff), see `docs/guides/AI-VERIFICATION.md`. Perf budgets: `npm run bench`, `npm run bench:render`, `npm run bench:render3d`.
- Run verification before committing. Do not claim browser/device coverage when only Node tests ran.

## Change discipline

- Preserve existing public APIs unless a breaking change is intentional and documented.
- Update tests and `CHANGELOG.md` for runtime behavior changes.
- Keep generated game projects self-contained; do not add CDN runtime dependencies.
- Do not automatically migrate or rewrite existing games.
- Never use destructive Git commands such as `reset --hard` or `clean -fd`.
- **Commit every verified milestone immediately**: Whenever a distinct milestone (new subsystem, internal refactor, optimization pass, bug fix, or docs/tooling update) passes verification (`npm run check`, or `npm run check:all` when touching `network/`), create a focused `git commit` right away. Never accumulate uncommitted changes across multiple stages or requests.
- **Do not pile up changes on `main`**: Keep `main`'s working tree clean. For multi-stage features, refactors, or performance experiments, create a short-lived topic branch (`feat/<topic>`, `perf/<topic>`, `fix/<topic>`), commit incrementally at each verified milestone on that branch, and merge back into `main` only after `npm run check` passes.
- **Push only on request**: Commit locally at each milestone; run `git push` only when the user explicitly asks to push/publish to a remote.

## Agent Workflow & Documentation Entry Points

- Workspace Agent skill / step-by-step runbook: `.agents/skills/hgame/SKILL.md`.
- Complete human & AI usage handbook (选型表、模块速查、代码示例与 Prompt 模板): `docs/guides/USER-AND-AGENT-GUIDE.md`.
- Standard 5-step game workflow:
  1. Generate a standalone project with `scripts/create-game.mjs` (`--profile 2d|3d|ui`, optional `--renderer webgl2d`, `--quality auto`, `--with audio,save,physics2d|physics3d`).
  2. Curate AI art sheets cleanly (`scripts/process-assets.mjs`, `--grid 1|2|3`, shadow-free actor PNGs) and filter 4-variant audio cues (`scripts/process-audio.mjs`).
  3. Build gameplay in the generated project's `src/` using `vendor/hgame/` subsystems instead of bespoke loops or boilerplate.
  4. Serve over loopback HTTP (`scripts/preview.mjs`) and run checks (`npm test` / `npm run check:all`).
  5. Package the uploadable deliverable (`scripts/package-game.mjs` -> `build/<id>_<version>/` + `.zip`).

## Built-in Runtime Subsystems (Reuse Instead of Reinventing)

- **Core, Interpolation & Tags**: `index.js`, `core/application.js` (`renderAlpha`, `hitStop`, `setTimeScale`), `core/entity.js` + `core/tags.js` (`addTag`, `matchesTags`, `scene.queryTags`), `time/tween.js` (`scene.tweens`, `SpringDamper1D/2D/3D`, `damp`).
- **2D Rendering & 10k+–150k+ Swarms**: `integrations/canvas2d.js` (`Camera2D`, `Sprite2D` with `groundShadow` + `hitFlash`, `SpriteCrowd2D` with `bindSwarm`/`bindGpuSwarm`), `integrations/webgl2d.js` (GPU-instanced 2D with 16B compact swarm shader + Canvas2D fallback), `animation/spritesheet.js` (`fromGrid`), `animation/player.js`, `world/tilemap.js` (`findGridPath`), `world/spatial2d.js` (`SpatialHash2D`, `ObjectPool`), `world/swarm-ecs.js` (`FlatSpatialHash2D`, `FlowField2D`, `FlatCombatECS`, `createSwarmSimulation` with 10m/12m ECS hysteresis & 3-tier separation), `world/gpu-swarm-webgl2.js` (`createGpuSwarmWebGL2` RGBA32F ping-pong FBO pure-GPU swarm).
- **3D Rendering, MegaLights & Open World**: `integrations/three.js` (`toneMapping: 'ueFilmic'`, `setSky`, `setExposure`, `setPostVolumes`), `integrations/sky3d.js`, `integrations/lighting3d.js` (`createMegaLights3D`, `createIrradianceProbeVolume3D`), `integrations/post3d.js` (SSGI/SSR, contact shadows, `createPostProcessVolumeStack`), `integrations/culling3d.js` (`createInstancedBatch3D`, `createSceneCuller3D` with 3-state `classifySphere`), `integrations/camera3d.js` (`createCameraRig3D`, `createSpringArm3D`), `integrations/model3d.js` (`createModel3DProvider`, `createInstancedCrowd3D` Vertex-VAT, `createBoneVatCrowd3D` HalfFloat Bone-VAT + 16B packed 3-LOD + `"HVAT"` `.vat.bin`, `syncFromSwarm` / `syncFromGpuSwarm`, `scripts/bake-bone-vat.mjs` / `npm run bake:vat`), `integrations/world-aligned-material.js`, `world/open-world.js` (`createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin`).
- **Unified Quality (`low` / `medium` / `high`)**: `integrations/quality3d.js` and `renderer.setQuality('low' | 'medium' | 'high' | 'ultra')`.
- **Cross-Platform Touch, Arcade & Split-Screen Input**: touch-first `app.input.pointers`; opt-in `HGame.createArcadeControls` + `integrations/touch-controls.js` (`mode: 'touch-only'`; P1 `WASD` + `J K L U I O` with optional `Q E`, P2 `Arrow` keys + `1..6` with optional `0 .`); split-screen via `HGame.computeSplitScreenViews` + `renderer.setViews(...)`.
- **Commercial Red Dot System**: `ui/red-dot.js` (`HGame.createRedDotSystem` Trie + DAG) + `integrations/red-dot-dom.js` (`bindRedDotDOM`, `data-red-dot`, `data-red-dot-ack`).
- **Spatial & Variant Audio**: `platform/audio.js` (4 buses + limiter, `registerCue`/`playCue` 2–4 variants, 3D `HRTF` + `updateListenerFromCamera`, 2D `position2D`, `setOcclusionProbe`, `registerSnapshot`/`applySnapshot`).

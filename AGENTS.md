# HGame Repository Rules

HGame is a standalone, renderer-neutral HTML5 game runtime. This repository is the source of truth for the engine, starter templates, project generator, tests, and optional multiplayer foundation.

## Source of truth

- Canonical runtime: `assets/runtime/`.
- Runtime version: `assets/runtime/VERSION`; keep it consistent with `HGAME_VERSION` in `assets/runtime/index.js` and the root package version.
- New project generator: `scripts/create-game.mjs`.
- Lean release & WASM packager: `scripts/package-game.mjs` (`build/<id>_<version>/` + `.zip`).
- Offline media curation: `scripts/process-assets.mjs` and `scripts/process-audio.mjs`.
- Unified off-Git asset management: `scripts/assets.mjs` (`npm run assets -- push|pull|status|verify`), storing content-addressed binaries in `HGAME_ASSET_STORE` (or `~/.hgame/asset-store`) and tracking `assets.manifest.json` in Git while `.gitignore` excludes heavy art/audio binaries.
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
7. **Minimalist Zero-Prose UI Rule**: Never add instructional copy ("操作说明 / 玩法介绍 / How to play / Powered by"), `<p>` prose blocks, subtitles, toast text bars, or nested `<button>` elements inside cards. Keep combat HUD `<= 1` icon-only pause button (`<= 10%` viewport), pause/gameover overlays `<= 2` buttons (`<= 4` hanzi), upgrade/shop cards whole-clickable (`<= 18` chars, symbolic `+25% 攻速`), and debug/bench toggles hidden behind `` ` `` or `?debug=1`. Verify via `node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --dir <game-dir>` and `npm run snapshot -- <game-dir>`.

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
- Headless render & automated playtest verification for agents: `npm run snapshot -- <game-dir>` (PNG + JSON stats + baseline diff) and `npm run playtest -- <game-dir>` (scripted WASD/action input, FPS/stutter metrics, pixel-change & error assertions), see `docs/guides/AI-VERIFICATION.md`. Perf budgets: `npm run bench`, `npm run bench:render`, `npm run bench:render3d`.
- Run verification before committing. Do not claim browser/device coverage when only Node tests ran.

## Change discipline

- Preserve existing public APIs unless a breaking change is intentional and documented.
- Update tests and `CHANGELOG.md` for runtime behavior changes.
- Keep generated game projects self-contained; do not add CDN runtime dependencies.
- Do not automatically migrate or rewrite existing games.
- Never use destructive Git commands such as `reset --hard` or `clean -fd`.
- **Develop directly on `main` (Zero Isolated Workspaces / Zero Branches)**: Develop **exclusively on `main` in the active workspace**. Creating topic/feature branches (`git checkout -b`, `git switch -c`, `git branch`) or isolated workspaces/worktrees (`git worktree`, subagent/swarm `Workspace: 'branch'` or `'share'`) is strictly **forbidden**; subagents must always use `Workspace: 'inherit'`.
- **Single-Conversation Lock**: Only **one conversation at a time** may develop on a repository or game project. Do not run parallel/concurrent coding conversations against the same workspace.
- **Mandatory End-of-Conversation Stage Commit**: Every conversation that performs development or modification work **must** run verification (`npm run check`, or `npm run check:all` when touching `network/`) and create a focused stage `git commit` on `main` before completing—never leave uncommitted changes piled up across stages or conversations.
- **Push to remote after every commit**: Whenever a remote is configured (e.g., `origin`), run `git push` immediately after each verified `git commit` on `main` so the remote stays synchronized at every milestone.

## Agent Workflow & Documentation Entry Points

> **Zero-Blind-Scan & Zero-GUI-Editor Contract (AI-Native)**:
> 1. **纯 AI 研发引擎 · 严禁引入人工可视化编辑器**：本引擎专为 AI Agent 自主研发设计，严禁构建或依赖人工拖拽式的 GUI 场景/关卡/材质/时间轴编辑器；所有关卡、平衡数值、剧情图、UI 栈与音画参数必须以纯文本代码、声明式 JSON 与零依赖 CLI 校验脚本表达。
> 2. **零盲扫 API 速查**：查询引擎能力、最小接线配方、参数签名与返回值**必须优先运行 `npm run api -- --map` / `npm run api -- --recipe <2d|horde|3d|ui|network>` / `npm run api -- <keyword>`**（或 `--module <name>`），严禁盲目通读 `assets/runtime/` 底层实现或 `assets/optional/three/` 源码。完成改动后优先使用 `npm run snapshot -- <game-dir>` 与 `npm run playtest -- <game-dir>` 进行无头画面与交互自检。

- Workspace Agent skill / step-by-step runbook: `.agents/skills/hgame/SKILL.md`.
- Clean-room reverse engineering entrypoint (read-only unencrypted data): `.agents/skills/hgame-reverse-engineering/SKILL.md` (`npm run re:extract`, `npm run re:spec`, `npm run re:eval`, `npm run re:forge`, `npm run re:doctor`, `npm run test:re`, `npm run sync:skills`; configure machine paths via gitignored `.hgame.local.json` from `.hgame.local.example.json`).
- Clean-room spec bridge (`*.clean-spec.json` firewall & scaffolder): `.agents/skills/hgame-spec-forge/SKILL.md`.
- **先做减法再做加法（1-1-2-1 最小切片毕业制 + 双门禁铁律）**：任何基于逆向的新游戏第一阶段只准交付 `1-1-2-1` 最小垂直切片（1 套角色与相机、1~2 把核心武器、2~3 种代表敌人、1 套 60 秒基础波次、最多 5 个核心升级）；在同时跑通 `npm run re:eval`（SI 单位归一化 + 4 项无量纲比值 + >=90 分）与 `npm run re:doctor`（30 秒实机四项生命体征全绿）之前，严禁扩充武器库、堆砌外围系统或盲目开启十万同屏二创。
- AI execution manual & compact system cards (`01..16`): `docs/guides/USER-AND-AGENT-GUIDE.md`.
- Standard 5-step game workflow:
  1. Generate a standalone project with `scripts/create-game.mjs` (`--profile 2d|3d|ui`, optional `--renderer webgl2d`, `--quality auto`, `--with audio,save,physics2d|physics3d`).
  2. Curate AI art sheets cleanly (`scripts/process-assets.mjs`, `--grid 1|2|3`, shadow-free actor PNGs) and filter 4-variant audio cues (`scripts/process-audio.mjs`).
  3. Build gameplay in the generated project's `src/` using `vendor/hgame/` subsystems instead of bespoke loops or boilerplate.
  4. Serve over loopback HTTP (`scripts/preview.mjs`) and run checks (`npm test` / `npm run check:all`).
  5. Package the uploadable deliverable (`scripts/package-game.mjs` -> `build/<id>_<version>/` + `.zip`).

## Built-in Runtime Subsystems (Reuse Instead of Reinventing)

- **Core, Interpolation & Tags**: `index.js`, `core/application.js` (`renderAlpha`, `hitStop`, `setTimeScale`), `core/entity.js` + `core/tags.js` (`addTag`, `matchesTags`, `scene.queryTags`), `time/tween.js` (`scene.tweens`, `SpringDamper1D/2D/3D`, `damp`).
- **2D Rendering, Lighting/Post & 10k+–150k+ Swarms**: `integrations/canvas2d.js` (`Camera2D`, `Sprite2D` with `groundShadow` + `hitFlash`, `SpriteCrowd2D` with `bindSwarm`/`bindGpuSwarm`), `integrations/webgl2d.js` (GPU-instanced 2D with 16B compact swarm shader + Canvas2D fallback), `integrations/post2d.js` (`createLighting2DState`, `setAmbientLight`, `addLight2D`/`setLights2D`, `setPost2D` offscreen Bloom/vignette/hitPulse/color grading), `animation/spritesheet.js` (`fromGrid`), `animation/player.js`, `world/tilemap.js` (`findGridPath`), `world/spatial2d.js` (`SpatialHash2D`, `ObjectPool`), `world/swarm-ecs.js` (`FlatSpatialHash2D`, `FlowField2D`, `FlatCombatECS`, `createSwarmSimulation` with 10m/12m ECS hysteresis & 3-tier separation), `world/gpu-swarm-webgl2.js` (`createGpuSwarmWebGL2` RGBA32F ping-pong FBO pure-GPU swarm).
- **3D Rendering, Terrain, NavMesh, MegaLights & Open World**: `integrations/three.js` (`toneMapping: 'ueFilmic'`, `setSky`, `setExposure`, `setPostVolumes`), `integrations/sky3d.js`, `integrations/lighting3d.js` (`createMegaLights3D`, `createIrradianceProbeVolume3D`), `integrations/post3d.js` (SSGI/SSR, contact shadows, `createPostProcessVolumeStack`), `integrations/culling3d.js` (`createInstancedBatch3D`, `createSceneCuller3D` with 3-state `classifySphere`), `integrations/camera3d.js` (`createCameraRig3D`, `createSpringArm3D`), `integrations/model3d.js` (`createModel3DProvider`, `createInstancedCrowd3D` Vertex-VAT, `createBoneVatCrowd3D` HalfFloat Bone-VAT + 16B packed 3-LOD + `"HVAT"` `.vat.bin`, `syncFromSwarm` / `syncFromGpuSwarm`, `scripts/bake-bone-vat.mjs` / `npm run bake:vat`), `integrations/procedural-models.js` (17 procedural PBR prop/architecture shapes), `integrations/world-aligned-material.js`, `world/terrain3d.js` (`createHeightfieldTerrain3D`, `fbmNoise2D`, Rapier heightfield physics, `scatterPositions`), `world/navmesh3d.js` (`createNavMesh3D` A* + LOS smoother), `world/open-world.js` (`createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin`).
- **AI Decision Kernel (`ai/`)**: `ai/fsm.js` (`createStateMachine` zero-GC HFSM with LCA enter/exit), `ai/bt.js` (`createBehaviorTree`, `BT_STATUS`, `sequence`, `selector`, `parallel`, `inverter`, `repeater`, `cooldown`, `condition`, `action`, `wait`).
- **Unified Quality (`low` / `medium` / `high`)**: `integrations/quality3d.js` and `renderer.setQuality('low' | 'medium' | 'high' | 'ultra')`.
- **Cross-Platform Touch, Arcade & Split-Screen Input**: touch-first `app.input.pointers`; opt-in `HGame.createArcadeControls` + `integrations/touch-controls.js` (`mode: 'touch-only'`; P1 `WASD` + `J K L U I O` with optional `Q E`, P2 `Arrow` keys + `1..6` with optional `0 .`); split-screen via `HGame.computeSplitScreenViews` + `renderer.setViews(...)`.
- **Commercial UI Kit & Red Dot System**: `ui/panel-stack.js` (`createPanelStack`), `ui/virtual-list.js` (`createVirtualList`), `ui/i18n.js` (`createI18n`), `ui/red-dot.js` (`HGame.createRedDotSystem` Trie + DAG) + `integrations/red-dot-dom.js` (`bindRedDotDOM`, `data-red-dot`, `data-red-dot-ack`).
- **Spatial/Variant Audio, 0-KB Synth & Adaptive BGM**: `platform/audio.js` (4 buses + limiter, `registerCue`/`playCue` 2–4 variants, `playSynth`, `createBgm`, 3D `HRTF` + `updateListenerFromCamera`, 2D `position2D`, `setOcclusionProbe`, `registerSnapshot`/`applySnapshot`), `platform/audio/synth.js` (`createSynthSfx`, `SYNTH_PRESETS`, `synthesizeSfxPcm`), `platform/audio/bgm-synth.js` (`createProceduralBgm`, `BGM_MOODS`, `generateBgmStep`, `midiToHz`).
- **Hardened Versioned Save Storage**: `platform/storage.js` (`createSaveStore`, `createVersionedStore` schema migrations + FNV-1a checksum tamper detection + `.bak` recovery).
- **Zero-GC VFX & Game-Feel**: `vfx/` (`createVfxSystem`, `emitHitImpact`, `burstParticles`, `slashArc`, `lightningBolt`, `spawnTelegraph`, `setShrinkZone`, `popupNumber`, `screenPulse`, `CROWD_STATUS`, `packCrowdAnimStatus`).
- **Deterministic Simulation Helpers**: `sim/` (`sim/rng.js` `createSeededRng`, `sim/checksum.js` `createStateChecksum` + `hashState`, `sim/script.js` `runScripted`).

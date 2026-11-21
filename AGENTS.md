# HGame Repository Rules

HGame is a standalone, renderer-neutral HTML5 game runtime. This repository is the source of truth for the engine, starter templates, project generator, tests, and optional multiplayer foundation.

## Product scope, reviews, and priorities

- HGame is built for AI agents to independently develop complete HTML games. Author gameplay and content in code and declarative data. Use CLI tools and browser playtests to build, inspect, and verify the game end to end.
- Compare HGame with Unity and Godot in [ENGINE-SCORECARD.md](docs/ENGINE-SCORECARD.md). Use the same browser-local scope and fixed architecture, performance design, and rendering weights for all three engines. Record AI authoring and acceptance separately. Keep plugin ecosystems, distribution platform support, and visual editor features outside the comparison and roadmap priorities.
- Prioritize making a good game. Play the core loop through WebAsset early and use the playable result to guide engine work. Evaluate controls, feedback, pacing, progression, and a complete play session as appropriate to the game.
- Add a publishing target only when a specific game has a concrete release request for that platform. Keep the game as HTML and handle target-specific requirements at the packaging or host integration boundary.

## Source of truth

- Canonical runtime: `assets/runtime/`.
- Runtime version: `assets/runtime/VERSION`; keep it consistent with `HGAME_VERSION` in `assets/runtime/index.js` and the root package version.
- New project generator: `scripts/create-game.mjs`.
- Engine-to-game sync: `scripts/sync-games.mjs` (`npm run sync:games -- --status|--game <slug>|--all`) syncs engine-managed files (`vendor/hgame/`, `assets/vendor/three/`, `docs/api/API-INDEX.json`, core `scripts/*.mjs`) into projects under `gamesRootDir` and records `.hgame-sync.json` without touching `src/`, `tests/`, or authored assets.
- Lean release & WASM packager: `scripts/package-game.mjs` (`build/<id>_<version>/` + `.zip`), plus Bilibili Toy standard packager & preflight (`--target toy` / `scripts/toy-preflight.mjs`, see `.agents/skills/hgame-bilibili-toy/SKILL.md` and `docs/guides/BILIBILI-TOY-STANDARD.md`).
- Offline media curation: `scripts/process-assets.mjs`, `scripts/process-audio.mjs`, and local 3D AI modeling/normalization (`scripts/process-model3d.mjs` + `scripts/blender-model3d.py`, configured via gitignored `.hgame.local.json`).
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
7. **Minimalist Anti-Bloat UI Rule**: Follow the 4 Anti-Bloat Rules in `.agents/skills/hgame-ui-ux/SKILL.md`: **Zero-Prose** (no sentences, `<p>`/`<footer>`/subtitles, toast text bars, or instructional copy; icon + number like `HP 3` / `×12`, labels `2–4` hanzi; feedback via `createVfxSystem` + `audio.playSynth`), **Hard Button Budget** (live-canvas title `<= 1` action button and no rules button; in-game `<= 1` icon-only pause/mute button or `0` for quick runs; result `再来一局` + `<= 1` icon button; `#debug` hidden behind `` ` `` / `?debug=1`), **No Modals** (no tutorial/rules/confirm dialogs or `alert`/`confirm`/`prompt`; edge HUD `<= 10%` canvas area; whole-card clickable `<= 18` chars if cards/choices are used), and **Subtract-First Check** (omit any text/badge/button the core loop does not require). Verify via `npm run check:ui -- --dir <game-dir>` and `npm run snapshot -- <game-dir> --check-ui`.

## Public repository safety

- Never add private material libraries, local Unreal exports, proprietary game assets, game dumps, reverse-engineering reports, secrets, or machine-specific paths.
- Keep only third-party runtime files with their corresponding license notices. HGame is licensed under `Apache-2.0` (`LICENSE`); preserve Rapier's `Apache-2.0` notice (`assets/runtime/vendor/LICENSE-rapier.txt`) and Three.js's `MIT` license (`assets/optional/three/LICENSE`) when distributing those files.
- Keep `.env.example`; never commit `.env` or credentials.

## Verification

- **Mandatory Self-Testing & Acceptance Gate (`npm run accept`)**: No game or feature may be marked complete without running real acceptance tests (`node scripts/accept.mjs . --webasset` inside a game project, or `npm run accept -- <game-dir> --webasset` from HGame). `accept.mjs` enforces fail-closed checks across 8 gates (`config` WebAsset allowlist & asset refs, `syntax` all `src/`/`tests/` + relative imports, `uiStatic` Anti-Bloat lint, `tests` zero-skip unit tests, `autoplay` multi-seed `bot` vs `idle` clear-rate & difficulty verifier via `check-autoplay.mjs` / `--require-autoplay`, `visual` 960×540 + 360×800 screenshots + UI/layout overflow/clipping/overlap, `playtest` real-input `tests/acceptance.mjs` scenario + multi-phase `context.auditUi(phase)` + non-finite/disposed state health, `doctor` 4 vital signs when wired, `webasset` live 4174/4175 runtime verification, optional `--package` release boot, and `tests/acceptance.json`/`build/task.json`). It stamps `build/acceptance-report.json` with `sourceDigest`; `--verify-fresh` rejects stale reports after any source edit.
- Task acceptance: translate each requested outcome into a named criterion before implementation. Use `npm run task:check -- <task.json>` (`test`, `playtest`, `ui`, `snapshot`, `doctor`, `accept`, `autoplay`, `review`) for task-specific checks, and review any visual or experiential criteria using fresh evidence. Re-run affected checks after fixes, then audit the original task against the results. See [AI-VERIFICATION.md](docs/guides/AI-VERIFICATION.md).
- Runtime tests: `npm test`.
- Vendored physics parity: `npm run check:physics`.
- Network tests/check/build: run the corresponding npm command from `network/` or use the root forwarding scripts (`npm run check:all`).
- Package a game release (`build/<id>_<version>/` + `.zip`): `npm run package:game -- <game-dir> --version <ver>`, or for Bilibili Toy platform: `npm run package:toy -- <game-dir> --version <ver> --slug <slug>` and `npm run toy:check -- <dir-or-zip>`.
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
- **Unified WebAsset Game Management & AI Self-Service Verification (Zero User Manual Ops, No Per-Game Websites)**: All HTML5/HGame web games must be registered, managed, and previewed centrally through **WebAsset** (`http://127.0.0.1:4174/#games` lobby; isolated game runtime at `http://127.0.0.1:4175/local-games/<game-slug>/<entry>`, auto-discovered from `game.config.json` inside `WEBASSET_HTML_GAMES_ROOT`).
  - **AI 亲自完成部署与实机核验（严禁要求用户动手操作）**：当开发、修改或交付需要试玩的游戏时，**必须由 AI 亲自执行并验证上线**——确保 `game.config.json` 严格符合 WebAsset 白名单（`id === 游戏目录名`，且仅含 `schemaVersion`、`id`、`name`、`version`、`entry`、`renderer`、`runtime`、`standalone`，禁止额外未授权键如 `quality3d` 导致 WebAsset 静默跳过）；确认 `http://127.0.0.1:4174/api/games` 已收录该游戏（若 WebAsset 未运行则由 AI 后台拉起）；并用无头浏览器实测 `http://127.0.0.1:4175/local-games/<game-slug>/<entry>` 加载就绪、零 404 与零报错。**严禁**让用户自己上传 `.zip`、拷贝文件、改配置或手动启动 WebAsset；汇报时直接给出已验证可直接点击试玩的 WebAsset 地址。
  - **Never** launch per-game dev servers or websites (`npm start`, `npm run serve`, `python -m http.server`, Vite, or manual `scripts/preview.mjs` preview ports) during development, playtesting, or interactive browser QA—just ensure WebAsset is running and open/refresh the WebAsset entry; never copy game code into WebAsset or add extra buttons/toolbars to WebAsset. (`scripts/preview.mjs` is reserved strictly as an ephemeral internal loopback fixture for headless automated tooling such as `snapshot.mjs`, `playtest.mjs`, benchmarks, or packaged `build/` inspection.)
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
  1. Generate a standalone project inside the WebAsset-managed HTML games root (`WEBASSET_HTML_GAMES_ROOT/<slug>`) with `scripts/create-game.mjs` (`--profile 2d|3d|ui`, optional `--renderer webgl2d`, `--quality auto`, `--with audio,save,physics2d|physics3d`) so `game.config.json` auto-registers it in WebAsset.
  2. Generate 2D concept/sprite art **exclusively with the active LLM/Agent host's built-in image generation** (e.g., Codex `imagegen` or Antigravity `image-generator` — **never** local ComfyUI txt2img), curate sheets cleanly (`scripts/process-assets.mjs`, `--grid 1|2|3`, shadow-free actor PNGs), filter 4-variant audio cues (`scripts/process-audio.mjs`), and convert approved front art to local 3D GLBs (`npm run process:model3d -- generate --normalize --remesh --preset low` enforcing a unified `<= 3,000` vertices character budget).
  3. Build gameplay in the generated project's `src/` using `vendor/hgame/` subsystems instead of bespoke loops or boilerplate.
  4. Verify & run browser QA directly through **WebAsset** (`http://127.0.0.1:4174/api/games` -> `http://127.0.0.1:4175/local-games/<slug>/<entry>`, ensuring `game.config.json` passes WebAsset discovery with `id === <slug>` and no disallowed keys, starting WebAsset if offline, and never asking the user to upload zips or start servers), alongside CLI checks (`npm test`, `npm run check:all`, `npm run snapshot`, `npm run playtest`).
  5. Package the uploadable deliverable only when explicitly requested for external distribution (`scripts/package-game.mjs` -> `build/<id>_<version>/` + `.zip`).

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

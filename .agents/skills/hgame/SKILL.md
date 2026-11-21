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

> **AI-Native Zero-GUI-Editor & Zero-Blind-Scan Rules**:
> 1. **纯 AI 研发 · 拒绝手工可视化编辑器**：HGame 是完全面向 AI 编写的 HTML5 引擎，严禁在项目或工具链中制作人工可视化场景/关卡/材质编辑器；一律采用声明式 JSON + 引擎运行时 API + Headless 自动化核验闭环。
> 2. **零盲扫 API 速查**：查询任何引擎 API、场景接线或参数签名时，**必须优先运行 `npm run api -- --map` / `npm run api -- --recipe <2d|horde|3d|ui|network>` / `npm run api -- <keyword>`**（或 `--module <name>`），严禁盲目通读 `assets/runtime/` 底层实现或 `assets/optional/three/` 源码。

## Sub-Skill Routing Table (子技能路由表)

| Trigger Scenario | Companion Skill | Verification Script / Action |
|---|---|---|
| 刀光、粒子、受击顿帧/闪白、技能预警圈、伤害跳字、屏幕脉冲 | `hgame-vfx-juice` | 统一使用 `createVfxSystem` (`vfx/index.js`) 与 `CROWD_STATUS`，禁止手写零散粒子/DOM飘字 |
| 修改武器伤害、攻速、角色属性、抽卡/掉落概率表 | `hgame-balance-sim` | `node .agents/skills/hgame-balance-sim/scripts/sim-balance.mjs --config <balance.json>`（强制千局统计胜率与 TTK） |
| 编写或修改 2D/3D 关卡地图、地牢或障碍物布局 (`level.json`) | `hgame-level-architect` | `node .agents/skills/hgame-level-architect/scripts/check-level.mjs --level <level.json>`（BFS 断言出生点到关键点 100% 可达） |
| 编写或修改分支剧情、Roguelike 事件卡 (`story.json`) | `hgame-narrative-branch` | `node .agents/skills/hgame-narrative-branch/scripts/check-story-graph.mjs --story <story.json>`（拦截死节点/不可达结局/长段废话） |
| 新建游戏、编写/修改 HUD、主菜单、商店、升级弹窗或结算界面 | `hgame-ui-ux` | `npm run check:ui -- --dir <game-dir>` + `npm run snapshot -- <game-dir> --check-ui`（零句原则、按钮配额、零阻断、`<= 10%` 边缘留白与做减法检查） |
| 对外部分析目标游戏做只读逆向取证并提炼数值/状态机/3C | `hgame-reverse-engineering` | `npm run re:extract -- "<game-dir>" --slug <slug>` + `npm run re:spec -- --slug <slug>` + `npm run re:eval -- --slug <slug>`（先达 1-1-2-1 毕业线再建工程） |
| 从外部净室玩法规格书（`*.clean-spec.json`）或全流程一键装配 HGame 工程 | `hgame-spec-forge` | `npm run re:forge -- --slug <slug> --out "<new-game-dir>"` + `npm run re:doctor -- "<new-game-dir>"`（双门禁全绿前严禁扩充武器库/外围系统/十万同屏二创） |
| 接入 B 站 Toy 平台 SDK（云存储/共享存档/排行榜/安全检测/充电解锁/容器/媒体）或发布到 B 站 Toy 平台 | `hgame-bilibili-toy` | `npm run package:toy -- "<game-dir>" --version <ver> --slug <slug>` + `npm run toy:check -- "<zip-or-dir>"` + `toy` CLI 两段式预览确认提交 |

## 0. Determine Workspace Context First

Check which folder the current workspace is in before running commands:

- **HGame Engine Source Repository**: contains `assets/runtime/VERSION` (`1.0.0`) and `scripts/create-game.mjs`.
  - Use this repo to generate new games, curate art/audio sheets, run headless verification (`snapshot.mjs` / `playtest.mjs`), build optional `network/` servers, or package external games (`npm run package:game -- <game-dir> --version <ver>`).
  - Never add game-specific rules or private assets here; edit `assets/runtime/` only when changing the engine itself (and follow [AGENTS.md](../../../AGENTS.md)).
- **Generated Standalone Game Project**: contains `engine.config.json`, `game.config.json`, `src/main.js`, and `vendor/hgame/VERSION`.
  - Keep all game logic, AI, levels, and save schemas in `src/` and `assets/`.
  - Treat `vendor/hgame/` as a vendored runtime copy (do not treat ad-hoc edits there as an engine source change).
  - Run `npm test`, `npm run check` (`node --check src/main.js`), and `npm run release -- --version <ver>` directly inside the game folder.
  - Because `docs/api/API-INDEX.json`, `types/`, and `.agents/skills/` live in the **HGame engine root (`<hgame-repo>`)**, call them via `<hgame-repo>` when working inside a standalone game directory so commands never fail:
    - API quick lookup: `node "<hgame-repo>/scripts/query-api.mjs" <keyword>` (or `npm --prefix "<hgame-repo>" run api -- <keyword>`)
    - Balance / Level / Narrative checks: `node "<hgame-repo>/.agents/skills/<skill>/scripts/<script>.mjs" ...`
    - Headless snapshot & AI playtest: `node "<hgame-repo>/scripts/snapshot.mjs" .` and `node "<hgame-repo>/scripts/playtest.mjs" .`
    - Task acceptance: `node "<hgame-repo>/scripts/task-check.mjs" build/task.json` from the game root. Derive observable outcomes from the request before editing. Bind each to a fresh test, WebAsset checkpoint, or visual review. Audit the original request before completing. See [AI-VERIFICATION.md](../../../docs/guides/AI-VERIFICATION.md#task-acceptance).
    - Live playtest & browser QA: open via **WebAsset** (`http://127.0.0.1:4174/#games` -> `http://127.0.0.1:4175/local-games/<game-slug>/index.html`); **never** start a separate per-game website or port.

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
- Clean minimal scaffold: pass `--bare` to skip starter demo entities and generate a blank `src/main.js` wiring.
- Explicit physics flags: `--physics rapier2d | rapier3d | none`; `--tick-hz <1..240>` (for `2d`/`3d`).
- Inspect output before writing via `--dry-run`.

---

## Step 2: Curate Art & Audio Sheets (Engine Repo)

1. **AI Art Sheet Slicing & Cutout** (`scripts/process-assets.mjs`):
   - Supports `1x1` (`--grid 1`), `2x2` (`--grid 2`), `3x3` (`--grid 3`) PNG sheets and `--bg white | green | transparent`.
   - **Recommended default**: generate a **1K pure white background (`#FFFFFF`) `3x3` grid** (`--grid 3 --bg white`) to eliminate green-screen color spill on character edges and soles.
   - Default `--mode actor` removes background/spill, strips faint sole fringes, and exports **shadow-free** PNGs so runtime `Sprite2D.groundShadow` / `SpriteCrowd2D` draws dynamic shadows cleanly.
   ```powershell
   npm run process:assets -- --input sheet.png --grid 3 --bg white --mode actor --out-dir "<game-dir>/assets/actors"
   ```
2. **Audio Variant Selection & Normalization** (`scripts/process-audio.mjs`, requires `ffmpeg`):
   - Feed 4 generated MP3 takes per SFX cue; automatically selects the 2–4 most duration/RMS-consistent variants, trims MP3 silence, normalizes loudness, and exports mono 24 kHz MP3 (`96k`) or stereo 44.1 kHz BGM (`128k` with `--bgm`).
   ```powershell
   npm run process:audio -- --cue rifle_shot --inputs t1.mp3,t2.mp3,t3.mp3,t4.mp3 --out-dir "<game-dir>/assets/audio/sfx"
   ```
3. **LLM-First 2D Image Gen & Local 12GB LowVRAM 3D Modeling (`scripts/process-model3d.mjs`)**:
   - **2D Concept / Sprite & T-Pose Fist Rule**: Always use the active LLM/Agent host's built-in image generation tool (e.g., Codex `imagegen`, Antigravity `image-generator`), **never** local ComfyUI txt2img/Z-Image/Flux — local ComfyUI is 3D-only. For 3D character 2:1 (`front + left`) T-pose turnaround sheets, humanoid/fingered characters **must use a relaxed semi-clenched weapon-grip fist (`轻微握拳 / 虚握剑柄姿态`, empty hands ready for socketed weapons)** with clear margins away from the center seam (because game rigs use single `hand_l`/`hand_r` without finger animation); rounded animal paws (cats, etc.) keep natural paws.
   - **Local ComfyUI (`TRELLIS.2-4B GGUF Q4_K_M`) is 3D-only**: Machine paths (`model3d.rootDir`, `comfyUiUrl`, `comfyUiDir`, `blenderPath`) live in gitignored `.hgame.local.json` or `HGAME_MODEL3D_*` env vars. Start ComfyUI with `--reserve-vram 4.8`.
   - Default `generate` runs fast 12GB single-view (`euler` 12 steps, `max_num_tokens=20480`, `1024_cascade` + 2K PBR) followed by Blender `normalize`, high/low `remesh-bake` (`--preset low`, `targetQuads=1750`, **≤ 3,000 vertices** regardless of NPC/player role), and automatic 21-bone humanoid rigging + looping `Run` animation (`--rig-run` enabled by default for `--low-out`, opt out via `--no-rig`).
   - **Frozen Standard Character Cleanup & Publish Pipeline (`character-pack`)**: Whenever normalizing raw AI/Hunyuan/multiview character high-poly GLBs into WebAsset, run `character-pack` (pre-remesh hole fill + whisker spike relaxation -> clean `16k`-quad 2K High + clean `<=3,000`-vert 1K rigged `Run` Low -> fail-closed `assertCleanTopology` gate `looseVerts=0, looseEdges=0, boundaryEdges=0, spatialIslands=1` -> atomic `/api/character-models` upload):
   ```powershell
   npm run process:model3d -- doctor
   npm run process:model3d -- character-pack --from-webasset --character-id <slug> --upload --qa-dir ".tmp/qa-<slug>"
   npm run process:model3d -- generate --input front.png --out high.glb --quality high --normalize --origin ground --target-height 1.0 --remesh --low-out low.glb --preset low
   npm run process:model3d -- remesh-bake --input norm.glb --out low.glb --preset low --rig-run
   npm run process:model3d -- rig-run --input low.glb --out low_run.glb --qa-dir qa_run
   ```
4. **Unified Off-Git Art & Audio Sync** (`scripts/assets.mjs`):
   - Both HGame and generated game `.gitignore` files exclude large art/audio binaries and raw authoring sources (`assets/**/*.png`, `.glb`, `.mp3`, `.vat.bin`, `.psd`, `.blend`, `.fbx`).
   - Git tracks only code, configs, and `<game-dir>/assets.manifest.json`. Store/restore actual binaries via the unified CAS store (`HGAME_ASSET_STORE` or `~/.hgame/asset-store`, optional `--remote <url>`):
   ```powershell
   npm run assets -- push "<game-dir>"
   npm run assets -- pull "<game-dir>"
   npm run assets -- verify "<game-dir>"
   ```

---

## Step 3: Implement Gameplay Using Built-in `vendor/hgame/` Modules

Read `engine.config.json` and `game.config.json` first. Import modules from `../vendor/hgame/...` inside `src/main.js` (`./vendor/hgame/...` from project root). **Always reuse existing runtime subsystems instead of reimplementing them:**

| Need | Exact Runtime Path | Key Exports & Conventions |
|---|---|---|
| **Core Loop & Tags** | `index.js`, `core/*` | `HGame.defineProject`, `createApplication`, `Scene`, `Entity` (`addTag`, `matchesTags`, `scene.queryTags`), `app.renderAlpha`, `app.hitStop`, `app.setTimeScale` |
| **Motion & Feel** | `time/tween.js` | `scene.tweens` (`idle`, `run`, `attackLunge`, `dieKnockback`), `EASING`, `damp`, `dampAngle`, `SpringDamper1D/2D/3D` |
| **2D Sprites, Lighting & Post** | `integrations/canvas2d.js`, `webgl2d.js`, `post2d.js`, `animation/*`, `world/tilemap.js` | `Camera2D`, `Sprite2D` (`groundShadow`, `hitFlash`), `setAmbientLight`, `addLight2D`/`setLights2D`, `setPost2D` (Bloom/vignette/hitPulse), `SpriteSheet.fromGrid`, `AnimationPlayer`, `TileMap`, `findGridPath` |
| **2D 5k–150k+ Swarms** | `integrations/webgl2d.js`, `world/spatial2d.js`, `world/swarm-ecs.js`, `world/gpu-swarm-webgl2.js` | `<1.5k` use `Entity`; `1.5k–15k` use `SpriteCrowd2D` + `SpatialHash2D`; `15k–50k` use `createSwarmSimulation` (`FlowField2D`, `FlatSpatialHash2D`, `FlatCombatECS`) + `SpriteCrowd2D.bindSwarm`; `50k–150k+` use `createGpuSwarmWebGL2` (`bindGpuSwarm`) for pure-GPU FBO simulation |
| **3D Terrain, NavMesh & Lighting** | `world/terrain3d.js`, `world/navmesh3d.js`, `integrations/three.js`, `sky3d.js`, `lighting3d.js`, `post3d.js` | `createHeightfieldTerrain3D` (`fbmNoise2D`, `attachPhysics`, `scatterPositions`), `createNavMesh3D` (A* + LOS smoothing), `createThreeAdapter` (`toneMapping: 'ueFilmic'`), `createProceduralSky3D`, `createMegaLights3D`, `createPostProcessVolumeStack` |
| **3D Culling, Camera & Crowd** | `integrations/culling3d.js`, `camera3d.js`, `model3d.js`, `procedural-models.js`, `world-aligned-material.js` | `createInstancedBatch3D`, `createSceneCuller3D`, `createCameraRig3D` / `createSpringArm3D`, `createProceduralModelSlots` (17 PBR prop shapes), `createModel3DProvider`, `createBoneVatCrowd3D`, `createWorldMaterialPalette` |
| **AI Decision Kernel** | `ai/index.js` (`ai/fsm.js`, `ai/bt.js`) | Zero-GC `createStateMachine` (HFSM LCA enter/exit), `createBehaviorTree` (`BT_STATUS`, `sequence`, `selector`, `parallel`, `inverter`, `repeater`, `cooldown`, `condition`, `action`, `wait`) |
| **Zero-GC VFX & Game-Feel** | `vfx/index.js` (also `index.js`) | `createVfxSystem` (`3d`/`webgl2d`/`canvas2d`/`headless`), `emitHitImpact`, `burstParticles`, `slashArc`, `lightningBolt`, `spawnTelegraph`, `setShrinkZone`, `popupNumber`, `screenPulse`, `CROWD_STATUS` / `packCrowdAnimStatus` |
| **Open World** | `world/open-world.js` | `createWorldPartition` (hysteresis streaming), `createHLODProxyGroup3D`, `createFloatingOrigin` (`Float64` precision + palette/physics sync) |
| **Unified Low/Med/High Quality** | `integrations/quality3d.js` | `renderer.setQuality('low' \| 'medium' \| 'high' \| 'ultra')`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`, `createAdaptiveQualityController` |
| **Touch / Arcade / Split-Screen** | `platform/input.js`, `integrations/touch-controls.js` | Touch-first `app.input.pointers`; optional HUD `HGame.createArcadeControls` + `createTouchControls` (`mode: 'touch-only'`); P1 `WASD` + `JKL UIO` (reserve `Q E`); P2 `Arrows` + `123456` (reserve `0 .`); `HGame.computeSplitScreenViews` + `renderer.setViews` |
| **Commercial UI Kit & Red Dot** | `ui/index.js` (`panel-stack.js`, `virtual-list.js`, `i18n.js`, `red-dot.js`), `integrations/red-dot-dom.js` | `createPanelStack`, `createVirtualList`, `createI18n`, `HGame.createRedDotSystem` (Trie + DAG `link`/`registerRule`/`markUnread`) + `bindRedDotDOM` (`data-red-dot`, `data-red-dot-ack`) |
| **0-KB Synth, BGM & Spatial Audio** | `platform/audio.js`, `platform/audio/synth.js`, `bgm-synth.js` | `audio.playSynth` (10 presets + `pitchJitter`), `audio.createBgm` / `createProceduralBgm` (6 `BGM_MOODS`, adaptive `setIntensity`), 4 buses + limiter, `registerCue`/`playCue`, 3D `HRTF`, `setOcclusionProbe` |
| **Sim, Physics & Versioned Save** | `sim/*`, `platform/storage.js`, `physics/rapier2d.js`, `physics/rapier3d.js`, `integrations/trace.js` | `createSeededRng`, `hashState`, `runScripted`, `createSaveStore`, `createVersionedStore` (migrations + tamper checksum + `.bak`); pinned Rapier `0.21.0`, `scene.physics.add`, `createCharacterController`, `takeSnapshot`/`restoreSnapshot` |
| **Multiplayer Foundation** | `lockstep/confirmed-frames.js`, `network/` | `createConfirmedFrameScheduler`, `StateSyncRoom` / `PredictedRoom` / `LockstepRoom` (isolated workspace under `network/`) |

### Mandatory Architecture Rules

1. **Single Scheduler**: `app.start()` owns the only RAF and fixed step. Never create a second RAF or step physics from render hooks.
2. **UI Projects**: Keep `tickHz: 0`; use `app.dispatch(...)` rather than an idle 60 Hz loop.
3. **3D Collision Separation**: Never derive collisions or authoritative gameplay state from visual PBR meshes (`model-slots.json` / `materials.json`); keep colliders explicit in `level.json`.
4. **Controls Standard**: Keep PC actions inside P1's `WASD + JKL UIO` (and P2's `Arrows + 123456` for 2P split-screen) unless genuinely exhausted, enabling `Q E` / `0 .` only via `extras` or `enableExtras: true`.
5. **Red Dot Standard**: Keep parent UI badges lit automatically via `createRedDotSystem` until every active child leaf has been handled; never hand-code flat boolean flags or manual DOM removals.
6. **Minimalist Anti-Bloat UI Standard**: Follow the 4 hard rules in `hgame-ui-ux` ([SKILL.md](.agents/skills/hgame-ui-ux/SKILL.md)):
   - **Zero-Prose**: Forbid full sentences, `<p>`/`<footer>`/subtitles, instructional copy (`"操作说明 / 玩法介绍 / 规则说明 / How to play / Powered by"`), toast bars, or unrequested reminder pills/quotes. Express HUD state as **icon + number** (`HP 3`, `×12`) with `2–4` hanzi labels, and convey feedback via `createVfxSystem` + `audio.playSynth`.
   - **Hard Button Budget**: Title screen shows live canvas with `<= 1` primary action button (no rules button); in-game HUD keeps `<= 1` icon-only pause/mute button (`0` for quick runs); pause/result overlays keep 「再来一局」 + `<= 1` icon button (`<= 4` hanzi); `#debug` defaults `hidden` behind `` ` `` / `?debug=1`.
   - **No Modals**: Forbid tutorial/rules/confirm modals (`alert`/`confirm`/`prompt` or custom dialogs) and multi-column HUD stacks; pin HUD to screen edges within `<= 10%` of canvas area.
   - **Subtract-First Check & Conditional Cards**: Omit any text, badge, or button the core loop does not need. When gameplay explicitly uses upgrade/shop/roster/event cards, follow `hgame-ui-ux` Section 3 (whole-card clickable `<= 18` chars, full-bleed media, HUD isolation, `选项` heading `<= 4` choices). Verify via `npm run check:ui -- --dir <game-dir>` and `npm run snapshot -- <game-dir> --check-ui`.
7. **RE 1-1-2-1 MVP Slice & Dual-Gate Discipline (先做减法再做加法)**: Any reverse-engineered game MUST deliver ONLY the `1-1-2-1` minimal vertical slice first (1 char+camera, 1~2 weapons, 2~3 enemies, 1 × 60s wave, `<= 5` upgrades). Until both `npm run re:eval` (SI units + 4 ratios + score >= 90) AND `npm run re:doctor` (30s 4-vital-sign live playability check) pass green, expanding the weapon arsenal, stacking peripheral systems, or enabling 100k-horde enhancements is strictly forbidden.
8. **Direct `main` Only, Single-Conversation Lock & Mandatory Stage Commits**: Develop **exclusively on `main` in the active workspace**—isolated workspaces/worktrees (`git worktree`, subagent/swarm `Workspace: 'branch'` / `'share'`) and non-`main` branches (`git checkout -b` / `git switch -c`) are strictly **forbidden**. Only **one conversation at a time** may develop on the repository. Every development conversation **must** verify (`npm run check` / `npm test`) and create a stage `git commit` on `main` (and `git push` if remote exists) before finishing, leaving zero piled-up uncommitted changes.
9. **Unified WebAsset Game Management & AI Self-Service Verification (Zero User Manual Ops, No Standalone Websites)**: Manage, list, and preview all HTML5 games centrally through **WebAsset** (`http://127.0.0.1:4174/#games` lobby; game runtime at `http://127.0.0.1:4175/local-games/<game-slug>/<entry>`, auto-discovered via `game.config.json` in `WEBASSET_HTML_GAMES_ROOT`).
   - **AI Must Deploy & Verify Live on WebAsset (Never Ask the User to Do It)**: Ensure `game.config.json` strictly satisfies WebAsset's allowlist (`id === <game-slug>` directory name, and ONLY keys `schemaVersion`, `id`, `name`, `version`, `entry`, `renderer`, `runtime`, `standalone` — never extra keys like `quality3d` that cause WebAsset to skip the game), verify `http://127.0.0.1:4174/api/games` lists the game (start WebAsset in the background if offline), and run browser verification directly against `http://127.0.0.1:4175/local-games/<game-slug>/<entry>` (ready selector, zero 404s, zero console errors). **Never** tell the user to manually upload `.zip` packages, copy files, edit configs, or start WebAsset themselves.
   - **Never** launch standalone per-game HTTP servers (`npm start`, `npm run serve`, `python -m http.server`, or manual `scripts/preview.mjs` preview ports) for development, playtesting, or browser QA; point browser QA directly at WebAsset's preview URL, and never copy game files into WebAsset or add extra buttons/toolbars there. (`scripts/preview.mjs` is internal-only for ephemeral headless tools `snapshot.mjs` / `playtest.mjs` / `tests/` or inspecting packaged `build/` outputs offline.)

---

## Step 4: Preview & Verify

- **Unified WebAsset Preview (Default for Dev, Playtesting & Browser QA)**:
  - Ensure WebAsset is running (`http://127.0.0.1:4174/#games`), confirm the game appears in `http://127.0.0.1:4174/api/games`, and verify its isolated runtime URL (`http://127.0.0.1:4175/local-games/<game-slug>/<entry>`) loads cleanly in headless Chromium before replying with the ready-to-play WebAsset URL.
  - Do **not** run `npm start`, `npm run serve`, `python -m http.server`, or manual `scripts/preview.mjs` servers to host a game project on another port. (Only `npm run snapshot` / `npm run playtest` spawn an ephemeral internal loopback fixture automatically while running headless checks.)
- Headless render snapshot & automated AI playtest checks:
  ```powershell
  npm run snapshot -- "<game-dir>"
  npm run playtest -- "<game-dir>"
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
- **Mandatory End-of-Conversation Stage Commit**: Never leave dirty diffs stacked across stages or conversations; after verification passes, commit the stage immediately on `main` (never on branches or isolated workspaces/worktrees) and push to the configured remote (`git push`).

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

# Bilibili Toy platform deliverable (flat ZIP + contenthash + toy-sdk.js injection + preflight gate):
npm run package:toy -- "<game-dir>" --version 1.1 --slug <slug> --poster cover.png --icon icon.png
npm run toy:check -- "<game-dir>/build/<id>_1_1.zip" --slug <slug>
```

- Automatically traces `index.html`, `src/`, CSS, ESM imports, `Three.js` transitive modules (preserving `MIT` license), and `engine.config.json` physics.
- Automatically provisions/validates `rapier2d.wasm` or `rapier3d.wasm` (`\0asm` magic + `Apache-2.0` notice) when enabled and removes all WASM when `physics` is `"none"`.
- In the HGame engine root, `npm run release` builds the complete SDK deliverable (`build/hgame_1_0/` + `build/hgame_1_0.zip`).

---

## Detailed Reference Guides

- **AI 能力雷达图与系统速查卡 (`01..16`)**：[USER-AND-AGENT-GUIDE.md](../../../docs/guides/USER-AND-AGENT-GUIDE.md)
- **底层机制与架构边界**：[ENGINE-OVERVIEW.md](../../../docs/architecture/ENGINE-OVERVIEW.md), [PLATFORM-API.md](../../../docs/architecture/PLATFORM-API.md), [DETERMINISTIC-PHYSICS.md](../../../docs/architecture/DETERMINISTIC-PHYSICS.md)
- **3D / PBR / 资产 / QA / 联机**：[PIPELINE-3D.md](../../../docs/rendering/PIPELINE-3D.md), [WORLD-ALIGNED-PBR.md](../../../docs/rendering/WORLD-ALIGNED-PBR.md), [ASSET-AND-AUDIO-PIPELINE.md](../../../docs/guides/ASSET-AND-AUDIO-PIPELINE.md), [AI-VERIFICATION.md](../../../docs/guides/AI-VERIFICATION.md), [NETWORK.md](../../../docs/architecture/NETWORK.md), [LOCKSTEP.md](../../../docs/architecture/LOCKSTEP.md)

# HGame Repository Rules

HGame is an **AI-Native Universal HTML5 Game Template & Production Kit**（5 支柱：`UI` / `策划 Design` / `Gameplay` / `美术 Art` / `音效 Audio`）built atop a standalone 2D/3D/UI runtime. Gameplay and content are authored in code and declarative JSON (`src/game.design.json`, `level.json`, `story.json`).

## 1. Execution, Context & Token Discipline

### 通信与输出
- 默认使用简洁中文回复，不复述用户需求或做无意义开场总结。
- 简单任务直接执行；复杂任务只输出简短计划与关键进度节点。
- 最终回复聚焦：**修改摘要、验证结果、未解决问题**；严禁粘贴已由工具展示的大段代码或完整日志，也不得以精简为由掩盖失败或未验证项。

### 上下文与工具调用
- **精确搜索、局部读取**：优先用 `rg`、`npm run api`、`npm run anim:kits` 精准定位，再按行范围读取直接相关文件；禁止盲扫全库、通读 `assets/runtime/` 底层源码或重复读取已知文件。
- **合并与去重**：合理合并相关操作，避免反复执行相同或等价命令；对大段日志做有选择的过滤，但必须保留关键错误、退出码与诊断信息。
- **阶段留痕**：大型任务分阶段推进，仅保留精简进度与关键约束/错误信息，不丢弃报错上下文。

### 自适应策略与编程质量
- **按复杂度自适应**：简单任务直接定位→修改→验证；中等任务简短分析后实施；复杂任务分步控制上下文增长。仅在并行有明显收益时启用多 Agent（必须 `Workspace: 'inherit'`），避免重复消耗 Token。
- **先证据后修改**：不确定时先取证再行动，不做无意义猜测。修改前理清依赖，保持既有架构与风格，做最小、精准、可维护的改动；不擅自删除必要测试、校验或错误处理。
- **风险匹配验证**：迭代期间仅跑与改动风险匹配的局部检查，避免无效重复跑测；交付前再过对应硬性门禁。

---

## 2. Product Scope & Source of Truth

- **5-Pillar Template Positioning**：`assets/runtime/kit/` + `assets/archetypes/` + `docs/guides/UNIVERSAL-GAME-TEMPLATE.md` 预置 5 支柱骨架。`docs/ENGINE-SCORECARD.md` 仅作为底层运行时基准（对标 Unity/Godot），不与上层模板混用。
- **Playable-First & Publishing Boundary**：尽早在 WebAsset 试玩核心循环并以此驱动迭代；仅在有明确发布需求时才在打包/宿主边界接入平台特性，保持游戏本体为纯 HTML。
- **核心路径**：
  - 运行时：`assets/runtime/`；版本文件 `assets/runtime/VERSION` 须与 `assets/runtime/index.js` 的 `HGAME_VERSION` 及根 `package.json` 一致。
  - 项目生成与同步：`scripts/create-game.mjs`；`scripts/sync-games.mjs`（`npm run sync:games -- --status|--game <slug>|--all` 同步 `vendor/hgame/`、`assets/vendor/three/`、`docs/api/API-INDEX.json`、核心 `scripts/*.mjs` 至 `gamesRootDir` 并记录 `.hgame-sync.json`，不触碰 `src/`、`tests/` 与自制资产）。
  - 打包与预检：`scripts/package-game.mjs`（`build/<id>_<version>/` + `.zip`）；Bilibili Toy 标准：`--target toy` / `scripts/toy-preflight.mjs`（见 `.agents/skills/hgame-bilibili-toy/SKILL.md`、`docs/guides/BILIBILI-TOY-STANDARD.md`）。
  - 媒体与 3D 资产：`scripts/process-assets.mjs`、`scripts/process-audio.mjs`、`scripts/process-model3d.mjs` + `scripts/blender-model3d.py`（路径由 gitignored `.hgame.local.json` 配置）。
  - 资产库与 WebAsset：`scripts/assets.mjs`（`npm run assets -- push|pull|status|verify`，`HGAME_ASSET_STORE` / `~/.hgame/asset-store`，`assets.manifest.json`）；`webasset/`（`npm run webasset`，`/runtime/hgame/` 直指 `assets/runtime/`）；SQLite 资产库 `webasset/data/assets.db`（`npm run assets:db -- sync|status|search|verify|export-json`）；热备份 `npm run assets:backup -- backup|verify|list|restore|prune`（`assetBackupDir`，默认 `D:/Backups/HGame-Assets`）。
  - 模板与联机：`assets/template/`、`assets/profiles/`；可选联机工作区 `network/`（独立 manifest 与 lockfile）。
  - **下游隔离**：修改 HGame 仓库时，禁止静默修改全局 Skill 安装目录或外部游戏项目。

---

## 3. Architecture, UI/UX & Safety Boundaries

1. **模块化边界**：按 `engine.config.json` 声明的 profile 与可选特性按需加载。
   - `core/`：Scene、Entity、Component、Prefab 与单应用调度器。
   - `platform/`：浏览器服务与可选 WebAsset Host 适配；玩法、AI、内容与渲染器归属游戏侧。
   - `physics/`：固定使用确定性 Rapier 0.21.0；离线/联机不得切换物理后端。
   - `lockstep/`：仅提供可选确认帧调度器，不承担传输、权威仿真、回滚或匹配。
   - `network/`：仅负责传输、房间/会话生命周期与同步原语，严禁吸收游戏规则、AI、数值或存档。
2. **极简反臃肿 UI 铁律**（`.agents/skills/hgame-ui-ux/SKILL.md`）：
   - **Zero-Prose**：禁止句子、`<p>`、`<footer>`、副标题、文字 Toast 或教学文案；仅用图标+数字（如 `HP 3` / `×12`）与 `2–4` 字短标签，反馈交由 `createVfxSystem` + `audio.playSynth`。
   - **Hard Button Budget**：标题画布 `<= 1` 按钮且无规则按钮；局内 `<= 1` 图标按钮（快速局 `0`）；结算页 `再来一局` + `<= 1` 图标按钮；`#debug` 隐藏于 `` ` `` / `?debug=1`。
   - **No Modals & Subtract-First**：禁止规则/确认弹窗与 `alert`/`confirm`/`prompt`；边缘 HUD `<= 10%` 画布面积；若用卡片选择则整卡可点且 `<= 18` 字。校验：`npm run check:ui -- --dir <game-dir>`、`npm run snapshot -- <game-dir> --check-ui`。
3. **竖屏单手右下角舒适区（Mobile-First Portrait）**：面向手机端 Bilibili Toy 竖屏玩家为主 UX（PC 仅用于开发测试）。主交互控件（`createThumbArcHud`、`createTouchControls({ buttonLayout: 'portrait-arc' })`、`mountGameShell({ portraitFirst: true })`）必须锚定在右下角同心弧区（`cy >= 0.52 * viewportHeight`，按钮直径 `>= 48px`）。上半屏严禁放置可点击按钮（极特殊情况除外），顶部边缘仅作只读遥测（`pointer-events: none`）。
4. **公共仓库安全**：严禁提交私有材质库、本地 Unreal 导出、专有游戏资产、游戏 dump、逆向报告、密钥或本机路径；保留 `LICENSE`（Apache-2.0）、Rapier（`assets/runtime/vendor/LICENSE-rapier.txt`）与 Three.js（`assets/optional/three/LICENSE`，MIT）声明；保留 `.env.example`，严禁提交 `.env` 或凭据。

---

## 4. Change Discipline, Git & WebAsset

- **API 与兼容**：除非是有意且已文档化的破坏性变更，否则保持公共 API 稳定；运行时行为变更需同步更新测试与 `CHANGELOG.md`。生成项目须自包含（禁止 CDN 运行时依赖）；禁止自动迁移或重写现有游戏。
- **严禁破坏性 Git 与分支隔离**：禁止 `git reset --hard`、`git clean -fd`。**仅在 `main` 活跃工作区直接开发**——严禁创建特性分支（`checkout -b` / `switch -c` / `branch`）、`git worktree` 或 subagent/swarm 的 `Workspace: 'branch'|'share'`（一律用 `'inherit'`）。同一时间仅允许一个会话在工作区开发（单会话锁）。
- **WebAsset 统一托管与 AI 自验（零用户手动操作）**：
  - 所有游戏统一由 WebAsset 注册与预览（`http://127.0.0.1:4174/#games` 大厅；运行时 `http://127.0.0.1:4175/local-games/<slug>/<entry>`，读取 `WEBASSET_HTML_GAMES_ROOT/<slug>/game.config.json`）。
  - **禁止启动单游戏 dev server**（`npm start`、`serve`、`http.server`、Vite 或手动 `scripts/preview.mjs`；`preview.mjs` 仅限无头自动化工具或 `build/` 产物自检）；禁止把游戏代码拷贝进 WebAsset 或给 WebAsset 增改多余工具栏。
  - **AI 亲自上线核验**：确保 `game.config.json` 中 `id === <slug>` 且仅含白名单键（`schemaVersion`、`id`、`name`、`version`、`entry`、`renderer`、`runtime`、`standalone`，严禁 `quality3d` 等未授权键导致静默跳过）；确认 `http://127.0.0.1:4174/api/games` 已收录（若离线则后台拉起 WebAsset）；无头浏览器实测 `http://127.0.0.1:4175/local-games/<slug>/<entry>` 加载就绪、零 404/报错后直接给出可玩地址。严禁让用户上传 `.zip`、拷贝文件、改配置或手动启服务。
- **阶段提交与推送**：开发类会话完成前须通过校验（`npm run check`，涉及 `network/` 时用 `npm run check:all`），在 `main` 创建聚焦的 `git commit`，若已配置远端（如 `origin`）立即执行 `git push`。

---

## 5. Verification Gates

- **游戏强制验收（`npm run accept`）**：任何游戏或功能完工前必须执行 `node scripts/accept.mjs . --webasset`（或根目录 `npm run accept -- <game-dir> --webasset`）。覆盖 8 项 fail-closed 门禁：`config`（WebAsset 白名单与资源引用）、`syntax`（`src/`/`tests/` 及相对导入）、`uiStatic`（反臃肿 lint）、`tests`（零跳过单测）、`autoplay`（`check-autoplay.mjs` / `--require-autoplay` 多随机种子通关率与难度）、`visual`（960×540 + 360×800 截图与溢出/裁切/重叠检查）、`playtest`（`tests/acceptance.mjs` 实机输入 + 多阶段 `context.auditUi(phase)` + 非有限/已销毁状态检查）、`doctor`（4 项生命体征）、`webasset`（4174/4175 实机校验）、可选 `--package` 与 `tests/acceptance.json`/`build/task.json`。产物写入 `build/acceptance-report.json`（含 `sourceDigest`，`--verify-fresh` 拒绝过期报告）。
- **任务级校验**：实施前将预期结果转为命名标准；用 `npm run task:check -- <task.json>`（`test|playtest|ui|snapshot|doctor|accept|autoplay|review`）与新鲜证据（`npm run snapshot -- <game-dir>`、`npm run playtest -- <game-dir>`，见 `docs/guides/AI-VERIFICATION.md`）验证。
- **仓库与发布命令**：
  - `npm test`、`npm run test:webasset`、`npm run check:physics`、`npm run check`（`docs/api/API-INDEX.json` 需 `build:api-index`，`types/` 需 `build:types`，过期则报错）、`npm run check:all`（含 `network/`）、`npm run bench` / `bench:render` / `bench:render3d`、`npm run release`。
  - 浏览器 profile 冒烟需 `playwright-core` + Chromium；仅跑 Node 测试时严禁宣称浏览器/真机已覆盖。
  - 打包发布：`npm run package:game -- <game-dir> --version <ver>`；Bilibili Toy：`npm run package:toy -- <game-dir> --version <ver> --slug <slug>` + `npm run toy:check -- <dir-or-zip>`。

---

## 6. AI Workflow, Design-First & Subsystem Map

- **Zero-GUI-Editor & Zero-Blind-Scan**：严禁构建或依赖拖拽式可视化编辑器。查引擎能力、最小接线配方与签名**必须先运行** `npm run api -- --map`、`npm run api -- --recipe <kit|2d|horde|3d|ui|network>` 或 `npm run api -- <keyword|--module <name>>`。
- **核心入口文档**：`docs/guides/UNIVERSAL-GAME-TEMPLATE.md`、`.agents/skills/hgame/SKILL.md`、`docs/guides/USER-AND-AGENT-GUIDE.md`（系统卡片 `01..25`）。逆向与洁净室规范：`.agents/skills/hgame-reverse-engineering/SKILL.md`（`npm run re:extract|spec|eval|forge|doctor`、`npm run test:re`、`npm run sync:skills`）、`.agents/skills/hgame-spec-forge/SKILL.md`。
- **1-1-2-1 最小切片门禁**：基于逆向的新游戏 Phase 1 只准交付 `1-1-2-1` 切片（1 套角色与相机、1~2 把核心武器、2~3 种敌人、1 套 60 秒波次、`<= 5` 核心升级）。在同时跑通 `npm run re:eval`（SI 单位归一化 + 4 项无量纲比值 + `>= 90` 分）与 `npm run re:doctor`（30s 四项生命体征全绿）前，严禁扩充系统或开启十万同屏二创。
- **Doc-First / Test-After（改前先改文档）**：每款游戏维护 `docs/design/{GDD,ART-AND-AUDIO,UI-UX,LEVEL}.md` 与 `src/game.design.json`。任何玩法、数值、美术、音效、UI/UX 或地编修改前，**先更新对应 `docs/design/*.md` 与 `GDD.md` 变更记录**，再改代码与资产，随后跑 `npm run check:design`、`npm test`、`npm run accept`。
- **5 步标准造游流**：
  1. 蓝图与脚手架：`createBlueprintFromIdea` / `npm run blueprint:check` → `scripts/create-game.mjs`（生成至 `WEBASSET_HTML_GAMES_ROOT/<slug>`，支持 `--archetype action-2d|horde-2d|arena-3d|card-ui --theme scifi|arcane|arcade|cyber|cozy|ink`、`--design` 或 `--profile 2d|3d|ui`）。
  2. 2D/3D/音频生产：2D 概念图与精灵表**仅使用宿主内置生图能力**（禁止本地 ComfyUI txt2img）→ `scripts/process-assets.mjs --grid 1|2|3`；4 变体音效 → `scripts/process-audio.mjs`；3D GLB → `npm run process:model3d -- generate --normalize --remesh --preset low`，严格遵守 T5 预算（`LOD0 <= 6,000` tris / `<= 7,500` verts [4w]，硬上限 `<= 8,000` tris / `<= 10,000` verts；`LOD1 ~1,600` [2w]；`LOD2 ~350` [1w]；`LOD3` 6–8 tris；`LOD4` `GL_POINTS`；16-bit 索引 `<= 65,535`；见 `docs/rendering/ASSET-MODEL-LOD-SPEC.md`）。
  3. 更新 `docs/design/*.md`，基于 `vendor/hgame/kit/` 与内建子系统开发 `src/`（避免自造轮子）。
  4. WebAsset 实机 QA（4174/4175）+ CLI 门禁（`check:design`、`test`、`blueprint:check`、`check:ui`、`accept`、`snapshot`、`playtest`）。
  5. 仅在明确外部发布时用 `scripts/package-game.mjs` 打包交付。

### 内建子系统索引（详细签名用 `npm run api` 查询）
- `kit/`：`blueprint.js`、`art-themes.js`、`audio-director.js`、`game-session.js`、`game-shell-dom.js`
- `core/` & `time/`：`index.js`、`core/application.js`（`renderAlpha`, `hitStop`, `setTimeScale`）、`core/entity.js` + `core/tags.js`、`time/tween.js`（`SpringDamper1D/2D/3D`, `damp`）
- `2D & Swarms`：`integrations/canvas2d.js`（`Camera2D`, `Sprite2D`, `SpriteCrowd2D`）、`integrations/webgl2d.js`、`integrations/post2d.js`、`animation/{spritesheet,player}.js`、`world/{tilemap,spatial2d,swarm-ecs,gpu-swarm-webgl2}.js`
- `3D & World`：`integrations/{three,sky3d,lighting3d,post3d,culling3d,camera3d,model3d,procedural-models,world-aligned-material,quality3d}.js`（`scripts/bake-bone-vat.mjs` / `npm run bake:vat`）、`world/{terrain3d,navmesh3d,open-world}.js`
- `ai/`：`ai/fsm.js`（`createStateMachine`）、`ai/bt.js`（`createBehaviorTree`）
- `Input & UI`：`app.input.pointers`、`createArcadeControls` + `integrations/touch-controls.js`（`mode: 'touch-only'`）、`computeSplitScreenViews`、`ui/{panel-stack,virtual-list,i18n,red-dot}.js`、`integrations/red-dot-dom.js`
- `Audio, Save, VFX & Sim`：`platform/audio.js`（+ `audio/synth.js`, `audio/bgm-synth.js`）、`platform/storage.js`（`createSaveStore`, `createVersionedStore`）、`vfx/`（`createVfxSystem`, `emitHitImpact`, `slashArc`, `lightningBolt`, `spawnTelegraph`, `popupNumber`, `screenPulse`）、`sim/{rng,checksum,script}.js`

### 3D 骨骼动画调用铁律
1. 禁止直读全量 `catalog.json`；编写角色状态机前先运行 `npm run anim:kits` 选定 L0 套件，再以 `npm run anim:kit -- <kitId>` 获取精确路径。
2. 仅当 L0 缺特定动作时用 `npm run anim:search` 查 L1，且必须匹配角色 `--style`（禁混 `realistic` 与 `anime`）。
3. 严禁声明或检索 `turn_left / turn_right / turn_in_place` 槽位；转向统一由 `yaw` 插值 + LookAt IK 驱动。
4. TPS/锁定视角必须用 2D BlendTree 驱动下半身 8 向平移（`strafe_walk / strafe_run`，全 IP）并用 `animator3d.js` Avatar Mask 叠加上半身武器动作；俯仰 `pitch` 按比例分配至 `spine_01/02/03`，左手双骨 IK 吸附 `leftHandGrip`。
5. 人形角色统一使用标准 23(+3) 骨无手指骨架，严禁硬编码 `spine_04/05`、`neck_02`、手指骨或 UE Twist 骨。

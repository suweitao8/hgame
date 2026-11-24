# HGame 游戏工程

这是一个由 HGame 生成的**完全自包含 HTML5 游戏工程**。运行时配置与按需特性记录在 `engine.config.json`，宿主与发布元数据记录在 `game.config.json`。

## 工程目录

- `src/main.js`：默认源码入口。Pixi 空白与群怪模板使用各自的入口，运行 `npm run api -- --recipe current` 可查看生成时选择的入口及当前代码。
- `docs/design/`：本游戏独立的整体设计文档集（**改前先改文档、改后必测**）：
  - `GDD.md`：策划案总纲（核心循环、3C 手感、黄金三角数值、成长经济与变更记录）
  - `ART-AND-AUDIO.md`：美术与音效设计文档（主题配色、光影、资产规范、VFX、BGM 与 SFX 事件映射）
  - `UI-UX.md`：UI 与 UX 交互设计文档（界面流转、HUD 配额、输入映射与动效）
  - `LEVEL.md`：关卡与地编设计文档（场地尺度、碰撞分离、出生/刷怪区拓扑与波次）
- `src/`：游戏规则、状态、AI、关卡与表现逻辑（含可选策划蓝图 `src/game.design.json`）。
- `vendor/hgame/`：内置 HGame 运行时和同版本的 TypeScript 声明，可直接从本目录导入。
- `assets/vendor/three/`：仅 3D 工程拷贝的 Three.js 运行时文件。
- `engine.config.json`：HGame Profile（`2d` / `3d` / `ui`）、渲染器、确定性物理后端与特性列表。
- `hgame.project.json`：使用 `--preset` 生成时会包含这个文件。`runtime: "entry-graph"` 按入口保留运行时代码。计算式导入可以通过 `includeRuntime`（相对 `vendor/hgame/`）和 `includeSource`（相对 `src/`）补充。
- `game.config.json`：游戏 `id`、名称、`version`、入口 HTML 与宿主协议元数据。
- `assets.manifest.json`：美术/音频资产清单（路径、SHA-256 与体积元数据，提交到 Git；二进制文件本身由 `.gitignore` 忽略，通过统一资产库同步）。
- `assets/catalog.json`：预设项目的逻辑资源 ID、文件和资源组。代码可按 ID 加载。将 `hgame.project.json` 中的 `assetMode` 改为 `catalog` 后，发布会收集目录列出的资源和脚本、HTML、CSS 直接引用的文件。
- `scripts/assets.mjs` & `scripts/package-game.mjs`：统一资产同步与精简依赖追踪打包脚本。
- `docs/api/API-INDEX.json`：项目自带的 API 索引，运行 `npm run api -- --map` 或 `npm run api -- --module <模块名> --json` 查询。

## 统一美术资产管理（Git 只维护代码与清单）

本工程 `.gitignore` 默认忽略 `assets/` 下的重型图片、模型、`.vat.bin`、音视频及 `PSD/Blend/FBX` 等工程源文件。团队与 AI 通过统一内容寻址仓库（默认 `~/.hgame/asset-store`，可通过环境变量 `HGAME_ASSET_STORE` 或 `--store <目录>` 指定共享盘，亦支持 `--remote <URL>`）同步美术资产：

```powershell
# 1. 新增/修改本地 assets/ 资产后，推送到统一资产库并更新 assets.manifest.json（提交 JSON 进 Git）：
npm run assets -- push

# 2. 新环境拉取代码后，按 assets.manifest.json 还原本地美术资产：
npm run assets -- pull

# 3. 检查本地资产与清单/仓库差异：
npm run assets -- status
npm run assets -- verify
```

游戏权威状态（伤害、冷却、货币、胜负、存档结构）必须独立于 DOM / Three.js 表现层。UI 通过指令驱动逻辑，渲染器只负责读取快照呈现。

## 交互、商业化与品质规范

- **移动端 + PC 触屏优先**：如需虚拟摇杆或技能按钮，复用 `HGame.createArcadeControls` + `vendor/hgame/integrations/touch-controls.js`（P1 `WASD + JKL UIO [+QE]`，双人分屏自动映射 P2 `方向键 + 123456 [+0.]` + `HGame.computeSplitScreenViews` + `renderer.setViews`）。
- **商业化分层红点**：多级菜单红点、新获得 `NEW`、每日提醒与可领取计数统一使用 `HGame.createRedDotSystem` + `vendor/hgame/integrations/red-dot-dom.js`。

## 统一预览（WebAsset）与自检

禁止直接用 `file://` 打开 ES 模块，也**不要在游戏项目里各自启动独立 HTTP 网站**（如 `npm start`、`python -m http.server` 或额外占用调试端口）。本工程通过 `game.config.json` 由 **WebAsset** 统一发现与托管预览：

- 统一大厅入口：`http://127.0.0.1:4174/#games`
- 游戏独立运行地址：`http://127.0.0.1:4175/local-games/<目录名>/index.html`

日常修改代码后直接刷新 WebAsset 预览即可；提交前运行基础自检：

```powershell
npm run check:design
npm test
npm run check
npm run accept
```

默认 Pixi 竞技场和三个动作原型的 `tests/acceptance.mjs` 会验证移动、主动攻击和暂停恢复。发布清单可用 `"mobileMultiTouch": true` 启用左摇杆加攻击的双指验收。修改玩法时同步更新这份场景和项目的发布预算。

## 一键精简发布打包（生成 `build/<id>_<version>` 与 `.zip`）

直接打包整个工程目录会带入 `.git/`、`tests/`、`scripts/`、原始美术文件及未使用的物理/渲染模块。请始终使用以下命令生成精简可上传包：

```powershell
# 读取 game.config.json 的 id 与当前版本（或显式指定 --version），例如 lol_1_1：
npm run release -- --version 1.1

# 如需直接把文件铺在压缩包根目录（不包一层 lol_1_1/ 目录）：
node scripts/package-game.mjs --version 1.1 --flat-zip
```

打包完成后会生成 `build/lol_1_1/` 与 `build/lol_1_1.zip`，仅保留入口、业务代码、实际引用的引擎模块、当前激活的 Rapier 2D/3D WASM（若开启物理）以及运行时美术音频资产。打包产物同样可直接用 HTTP 预览验证。

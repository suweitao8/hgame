# HGame 游戏工程

这是一个由 HGame 生成的**完全自包含 HTML5 游戏工程**。运行时配置与按需特性记录在 `engine.config.json`，宿主与发布元数据记录在 `game.config.json`。

## 工程目录

- `src/main.js`：当前选定 Profile 的入口文件。
- `src/`：游戏规则、状态、AI、关卡与表现逻辑。
- `vendor/hgame/`：内置精简版 HGame 运行时副本，无任何外部 CDN 依赖。
- `assets/vendor/three/`：仅 3D 工程拷贝的 Three.js 运行时文件。
- `engine.config.json`：HGame Profile（`2d` / `3d` / `ui`）、渲染器、确定性物理后端与特性列表。
- `game.config.json`：游戏 `id`、名称、`version`、入口 HTML 与宿主协议元数据。
- `scripts/package-game.mjs`：按需依赖追踪与 WASM 精简打包脚本。

游戏权威状态（伤害、冷却、货币、胜负、存档结构）必须独立于 DOM / Three.js 表现层。UI 通过指令驱动逻辑，渲染器只负责读取快照呈现。

## 交互、商业化与品质规范

- **移动端 + PC 触屏优先**：如需虚拟摇杆或技能按钮，复用 `HGame.createArcadeControls` + `vendor/hgame/integrations/touch-controls.js`（P1 `WASD + JKL UIO [+QE]`，双人分屏自动映射 P2 `方向键 + 123456 [+0.]` + `HGame.computeSplitScreenViews` + `renderer.setViews`）。
- **商业化分层红点**：多级菜单红点、新获得 `NEW`、每日提醒与可领取计数统一使用 `HGame.createRedDotSystem` + `vendor/hgame/integrations/red-dot-dom.js`。

## 本地预览与自检

不要直接用 `file://` 打开 ES 模块。可使用 HGame 仓库的 `scripts/preview.mjs` 或任意本地静态 HTTP 服务启动预览：

```powershell
npm test
npm run check
```

## 一键精简发布打包（生成 `build/<id>_<version>` 与 `.zip`）

直接打包整个工程目录会带入 `.git/`、`tests/`、`scripts/`、原始美术文件及未使用的物理/渲染模块。请始终使用以下命令生成精简可上传包：

```powershell
# 读取 game.config.json 的 id 与当前版本（或显式指定 --version），例如 lol_1_1：
npm run release -- --version 1.1

# 如需直接把文件铺在压缩包根目录（不包一层 lol_1_1/ 目录）：
node scripts/package-game.mjs --version 1.1 --flat-zip
```

打包完成后会生成 `build/lol_1_1/` 与 `build/lol_1_1.zip`，仅保留入口、业务代码、实际引用的引擎模块、当前激活的 Rapier 2D/3D WASM（若开启物理）以及运行时美术音频资产。打包产物同样可直接用 HTTP 预览验证。

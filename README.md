# HGame

HGame 是一个面向纯 AI 协同与模块化开发的独立 HTML5 游戏运行时与项目生成器，支持 **2D Canvas**、**3D Three.js** 和 **UI/卡牌** 类游戏。引擎采用统一的 `Scene / Entity / Component / Prefab` 核心调度，按 `engine.config.json` 按需加载渲染、确定性物理、动画、寻路、空间音频与平台服务。

当前运行时版本：**1.0.0**。

## 目录

```text
assets/
  runtime/          # 唯一运行时源码（1.0.0）
  template/         # 独立游戏工程模板
  profiles/         # 2D / 3D / UI 启动配置
  optional/three/   # 仅 3D 模板使用的 Three.js 文件及 MIT 许可
scripts/
  create-game.mjs   # 生成独立游戏项目
  package-game.mjs  # 按需依赖追踪、WASM 校验与精简版本打包（build/<id>_<ver> + .zip）
  preview.mjs       # 本机回环预览服务器
  build-physics.mjs # 从固定 npm 版本重建 Rapier ESM/WASM
  process-assets.mjs # 1x1 / 2x2 / 3x3 美术切图、去背与分级缩放工具
  process-audio.mjs  # 多变种音效筛选、静音裁剪与响度归一化工具
tests/              # Runtime / 管道单测与可选浏览器验收
network/            # 独立安装的多人联网基础设施（状态同步 / 预测 / 帧同步）
docs/               # 架构、物理、3D 渲染与资产管线文档
```

## 核心能力概览

- **核心调度与确定性物理**：单一 RAF 调度 + 固定步长累积器、`Scene` 零 GC 迭代遍历与原型生命周期跳过、`Entity` 无旋转零三角函数快速矩阵通道、`app.renderAlpha` 自动插值变换（`interpolatedWorldMatrixInto` / `snapTransform`），以及 pinned 的 `@dimforge/rapier2d-deterministic` / `@dimforge/rapier3d-deterministic` `0.21.0`（旋转同步、校验和、世界快照与 `createCharacterController`）。
- **2D 万级对象与纯 AI 工作流**：`Camera2D`（平滑跟随、死区、边界、抖动、视野裁剪）、`Sprite2D`（`offsetX`/`offsetY`/`visualRotation` 视觉解耦、`WeakMap` 剪影染色缓存、动态 `groundShadow`）、SoA 高密度批处理组件 `SpriteCrowd2D`（`O(1)` Swap-Back 回收，单屏可承载 5,000–10,000+ 对象）、硬件实例化 `integrations/webgl2d.js`（`renderer: 'webgl2d'`，贴地阴影与主体合批单次 DrawCall，无 WebGL2 自动回退 Canvas2D）、`SpriteSheet.fromGrid`、`scene.tweens`、`TileMap`、`findGridPath` 与 `SpatialHash2D`。
- **3D 渲染、光影与开放世界基础设施**：
  - `sky3d` + `three.js` + `post3d` 单一曝光/线性 HDR 管线去重（`setSky`、`setExposure`、`setLinearOutput`），提供 `ueFilmic` 电影级 S 曲线色调映射、CIE 普朗克白平衡、ASC-CDL 调色、全分辨率屏幕空间接触阴影（Contact Shadows）、半分辨率 HDR SSGI + 二分细化 SSR、GPU 自动曝光金字塔，以及按优先级与距离平滑混合的 `createPostProcessVolumeStack`。
  - `lighting3d` 提供集群化多光源系统 `createMegaLights3D`（基于 `16×8×16` 对数深度视锥分簇与分层 IGN 随机重要性采样，支持 `1..1024` 盏动态点光/聚光/瞬态闪光而不引发着色器重编译）以及三维球谐辐照探针体 `createIrradianceProbeVolume3D`（`SH L1` 三线性采样与着色器注入）。
  - `culling3d.js`（Gribb-Hartmann 视锥剔除、凸锥 5 射线软件 AABB 遮挡剔除、WebGL2 异步硬件遮挡查询池与动态 GPU `createInstancedBatch3D`）、世界坐标对齐 PBR 材质（含 `Specular AA` 与浮动原点偏移 `shiftOffset`），以及 `model3d`（GLB 自检、去命名空间/去根位移、骨骼挂点、动作叠加层、距离骨骼动画 LOD + 阴影距离截断，及 VAT 顶点动画纹理千人同屏 `createInstancedCrowd3D`）。
  - `world/open-world.js` 提供 `createWorldPartition`（距离/速度前瞻与滞回边界的流式单元加载，支持 `pinCell` 与帧预算）、`createHLODProxyGroup3D`（远景 `InstancedMesh` 代理合批）和 `createFloatingOrigin`（`Float64` 全局坐标保留、插值状态同步、粒子/探针/世界对齐材质偏移补偿）。
- **统一低 / 中 / 高三档画质**：`quality3d.js` 统一管理 2D（`Canvas2D` / `WebGL2D`）与 3D（`ThreeAdapter` + `post3d` + `culler3d` + 材质各向异性 + 阴影）的 **低 / 中 / 高**（`low` / `medium` / `high`，3D 保留 `ultra` 与 `auto` 动态缩放）运行时切换（`setQuality`）。
- **手机触屏优先 + 可选虚拟摇杆/技能键 + PC / 分屏双人操作**：`createInputManager` 原生追踪多指触控（`pointers` / `isPointerDown` / `wasPointerPressed` / `pointercancel`）；需要摇杆或技能键时使用 `HGame.createArcadeControls` + `integrations/touch-controls.js`（`createTouchControls`，默认 `touch-only` 仅触屏显示），标准化 P1 虚拟摇杆 ↔ `WASD` + 主技能 `J K L U I O`（默认尽量控制在 6 键内，确有需要可通过 `extras`/`enableExtras` 开启额外 `Q E`），分屏双人模式自动为 P2 映射 `上下左右` + `1 2 3 4 5 6`（额外 `0 .`），并由 `computeSplitScreenViews` + `canvas2d` / `webgl2d` / `three.js` 的 `setViews(...)` 统一提供 2D/3D 同屏分屏渲染与坐标拾取。
- **商业化分层红点系统（Trie + DAG + 声明式 DOM 绑定）**：`ui/red-dot.js`（`HGame.createRedDotSystem`）提供前缀树自动冒泡聚合 + 跨入口 DAG 钻石去重，内建 **条件计数 / `99+`**（未领奖励不灭）、**新获得 `NEW` 点击消除（持久化 + 过期清理 `syncUnreadScope`）**、**每日首登提醒（支持凌晨 5 点/跨区服刷新 `computeCommercialDayKey`）** 与 **冷却就绪时间戳** 四类触发源，叠加功能解锁拦截（`setUnlocked`）、防骚扰静音（`setMuted`）、脏标记合帧广播（`batch`）与 `explain()` 诊断；搭配 `integrations/red-dot-dom.js` 的 `bindRedDotDOM`（`data-red-dot` / `data-red-dot-ack`），实现“子页面全部处理完才自动熄灭父入口红点”。
- **空间音频与多变种音效**：Web Audio 四总线（`sfx` / `spatial` / `music` / `ambience`）与主限幅压缩器（`DynamicsCompressorNode`）、3D `HRTF` 双耳空间定位与相机同步（`updateListenerFromCamera`）、2D 立体声声像与实时声源追踪（`handle.setPosition`）、MP3 编码静音自动裁剪无缝循环（`analyzeAudioBuffer`）、以及 `registerCue` / `playCue`（2~4 变种防连重跳步轮转与响度/尾音一致性对齐）。
- **资产与音效离线管线**：纯 Node 零依赖切图去背脚本 `scripts/process-assets.mjs`（支持 `1x1` / `2x2` / `3x3`、`transparent` / `#00FF00` 绿幕溢色净化 / `white` 洪水填充去背、默认不烘焙地面阴影），以及基于系统 `ffmpeg` 的 `scripts/process-audio.mjs`。

## 环境

- Node.js `>=22.12.0`
- npm `>=10`
- 可选：`ffmpeg`（仅运行 `npm run process:audio` 批量处理原始音频时需要）
- Windows / macOS / Linux；浏览器端以现代 Chromium 为主要验收环境

## 创建游戏

```powershell
npm ci

# 2D Canvas 游戏
node scripts/create-game.mjs "D:\Games\my-2d-game" --profile 2d --name "我的 2D 游戏"

# 2D WebGL2 硬件实例化高密度怪潮游戏（无 WebGL2 自动回退 Canvas2D）
node scripts/create-game.mjs "D:\Games\my-2d-horde" --profile 2d --renderer webgl2d --name "幸存者 Demo"

# 3D Three.js 游戏
node scripts/create-game.mjs "D:\Games\my-3d-game" --profile 3d --name "我的 3D 游戏"

# UI / 卡牌 / 剧情游戏（不创建空转 RAF）
node scripts/create-game.mjs "D:\Games\my-ui-game" --profile ui --name "我的卡牌游戏"

# 显式启用确定性物理
node scripts/create-game.mjs "D:\Games\my-physics-game" --profile 3d --with physics3d
```

生成器拒绝覆盖已存在目录。每个游戏拥有自己的源码、配置和 Git；引擎运行时复制到游戏的 `vendor/hgame/`，只保留所选维度的 Rapier WASM。3D 项目才会复制 Three.js。

## 美术与音效批处理

```powershell
# 切分 3x3 绿幕角色表（导出无地面阴影 PNG，运行时由 Sprite2D.groundShadow 绘制）
npm run process:assets -- --input raw-sheet.png --grid 3 --bg green --mode actor --out-dir assets/actors

# 从 4 个生成变种中筛选最一致的 2~4 个，统一响度并裁剪首尾静音导出单声道 MP3
npm run process:audio -- --cue rifle_shot --inputs take1.mp3,take2.mp3,take3.mp3,take4.mp3 --out-dir assets/audio/sfx
```

## 游戏发布与精简打包（`build/<名称>_<版本>` 与 `.zip`）

直接压缩游戏仓库会把 `.git/`、`tests/`、`scripts/`、`AGENTS.md`、原始 PSD/Blend/raw 美术工程文件，以及未使用的渲染/物理 WASM 一起带进发布包。使用内置的 `package-game.mjs` 可以按当前游戏的真实依赖**只打包必需内容**到 `build/` 下：

```powershell
# 1. 在独立游戏目录内发布当前游戏（例：id 为 lol，版本为 1.1 -> build/lol_1_1/ + build/lol_1_1.zip）
npm run release -- --version 1.1

# 如上传平台要求压缩包根目录直接是 index.html（不包外层文件夹），加 --flat-zip：
node scripts/package-game.mjs --version 1.1 --flat-zip

# 2. 也可以从 HGame 引擎仓库直接打包任意外部游戏工程：
npm run package:game -- "D:\Games\lol" --version 1.1

# 3. 发布 HGame 引擎本体 SDK（重建 WASM + 运行全部检查 + 生成 build/hgame_1_0/ 与 build/hgame_1_0.zip）：
npm run release
```

打包器会自动完成以下精简与校验：
- **精确追踪依赖图**：从入口 HTML（`importmap`、`src`、样式资源）、`src/` 与 `engine.config.json` 出发，仅拷贝当前游戏用到的运行时 ESM（未用的 2D/3D/物理模块全部剔除；3D 工程按需追踪 Three.js 模块及传递依赖并保留 MIT 许可）。
- **确定性 WASM 按需随包校验**：开启 `rapier2d` 或 `rapier3d` 时自动打包并校验对应 `.wasm` 魔数与 Apache-2.0 许可（哪怕工程后期才修改配置开启物理，也能从引擎仓库自动补齐单维 WASM）；未启用物理的游戏体积保持零 WASM。
- **剔除冗余与开发期文件**：自动排除 `.git/`、`node_modules/`、`tests/`、`scripts/`、`AGENTS.md`、`assets/raw/` 与 `.psd`/`.blend`/`.fbx` 等源文件，并可选用 `esbuild` 做语法/空白压缩。

## 预览

```powershell
node scripts/preview.mjs "D:\Games\my-3d-game" --port 4176
# 也可以直接预览打包后的精简产物：
node scripts/preview.mjs "D:\Games\lol\build\lol_1_1" --port 4176
```

然后打开 `http://127.0.0.1:4176/`。预览服务仅监听回环地址，并拒绝访问 `.git`、环境文件和开发目录。

## 测试与构建

```powershell
npm test
npm run check:physics
npm run build:physics
npm ci --prefix network
npm run check:all
```

浏览器验收需要单独提供 `playwright-core` 和 Chromium：

```powershell
node tests/browser-profiles.mjs --playwright "C:\path\to\playwright-core" --chrome "C:\path\to\chrome.exe"
```

## 游戏行为轨迹

Runtime 提供可选的 renderer-neutral JSONL recorder：`createTraceRecorder()`。它只记录调用方传入的逻辑事件，不创建 RAF、Timer 或文件/网络服务。可用于原版与 HTML 复刻的同场景行为对比，详见 [`docs/guides/TRACE-RECORDER.md`](docs/guides/TRACE-RECORDER.md)。

## 多人联网（可选）

联网基础设施位于 `network/`，独立于 Runtime npm 依赖：

```powershell
cd network
npm ci
npm test
npm run check
npm run build
```

它提供 Colyseus 状态同步、预测输入与延迟补偿（`LagCompensationHistory`）、空间兴趣网格（`InterestGrid2D`）、带宽受限防饥饿复制调度（`ReplicationPriorityScheduler`）、快照插值与自适应预测提前量（`SnapshotInterpolationBuffer`、`AdaptiveInputLeadController`）、限流令牌桶、以及支持限帧防卡死 `NO_OP` 补帧与断线补帧回放的 `LockstepRoom`；游戏规则、完整回滚与持久化由具体游戏工程实现。详见 [`docs/architecture/NETWORK.md`](docs/architecture/NETWORK.md)。

## 文档索引

- 架构总览：[`docs/architecture/ENGINE-OVERVIEW.md`](docs/architecture/ENGINE-OVERVIEW.md)
- 平台服务 API：[`docs/architecture/PLATFORM-API.md`](docs/architecture/PLATFORM-API.md)
- 确定性物理：[`docs/architecture/DETERMINISTIC-PHYSICS.md`](docs/architecture/DETERMINISTIC-PHYSICS.md)
- 帧同步调度：[`docs/architecture/LOCKSTEP.md`](docs/architecture/LOCKSTEP.md)
- 网络同步架构：[`docs/architecture/NETWORK.md`](docs/architecture/NETWORK.md)
- 3D 渲染与模型管线：[`docs/rendering/PIPELINE-3D.md`](docs/rendering/PIPELINE-3D.md)
- 世界坐标对齐 PBR：[`docs/rendering/WORLD-ALIGNED-PBR.md`](docs/rendering/WORLD-ALIGNED-PBR.md)
- 2D 美术切图与空间音频管线：[`docs/guides/ASSET-AND-AUDIO-PIPELINE.md`](docs/guides/ASSET-AND-AUDIO-PIPELINE.md)
- WASM 防逆向与服务端防作弊：[`docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md`](docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md)
- 游戏架构与浏览器 QA 矩阵：[`docs/guides/GAME-ARCHITECTURE-AND-QA.md`](docs/guides/GAME-ARCHITECTURE-AND-QA.md)
- 行为轨迹录制器：[`docs/guides/TRACE-RECORDER.md`](docs/guides/TRACE-RECORDER.md)

## 重要边界

- 固定时间步不等于跨平台确定性帧同步。
- Rapier snapshot 不包含游戏 AI、输入、规则、RNG 和完整游戏状态。
- Renderer、AI、关卡和游戏规则由各个游戏决定；HGame 不会自动迁移旧项目。
- 运行时不依赖 CDN。未选择的物理维度不会进入游戏包体。
- 本仓库不包含本机精选 PBR 贴图库、Unreal 导出资源或原版游戏逆向资料。

## 许可

HGame 自有代码采用 [Apache License 2.0](LICENSE) 开源许可。仓库内附带的第三方运行时文件继续遵循各自许可证：

- `@dimforge/rapier2d-deterministic` / `@dimforge/rapier3d-deterministic` `0.21.0`：Apache-2.0（见 `assets/runtime/vendor/LICENSE-rapier.txt`）
- `Three.js`（仅随 `--profile 3d` 复制到独立 3D 游戏工程）：MIT（见 `assets/optional/three/LICENSE`）

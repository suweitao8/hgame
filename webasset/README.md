# WebAsset · 独立角色资产库

原 GameHub 的「角色」Tab 已迁移到独立项目 `C:\Users\su\Desktop\WebAsset`。

## 运行

直接双击 `start.bat`（首次启动自动安装依赖），或者在本目录先运行 `npm install`，再运行 `npm start`（Node.js 22.12+）。

访问 **http://127.0.0.1:4174/**。仅监听本机 `127.0.0.1`，不依赖 GameHub 的 4173 服务，也不需要 Vite。

### 游戏工作区

顶部「游戏」入口：`http://127.0.0.1:4174/#games`。左侧只有搜索框和游戏列表，右侧直接显示选中的网页游戏。

WebAsset 自动扫描相邻的 `C:\Users\su\Desktop\HTML` 目录（可用 `WEBASSET_HTML_GAMES_ROOT` 覆盖），优先读取项目的 `game.config.json`；没有配置的旧工程继续按原有入口规则发现。游戏使用 **4175 端口**提供运行所需的 HTML/JS/CSS/图像/音频/模型文件，**无需启动各项目自己的服务器**，也不复制、移动游戏源码。

所有新游戏共用 HGame 1.0：`platform/` 提供生命周期、输入、资源、存档、音频、诊断和 Host 通信；`core/` 提供 Scene/Entity/Component/Prefab、单一固定 Tick 与按需服务。平台层不接管游戏规则或 Renderer。新项目使用 `game.config.json` 声明入口和渲染类型，`engine.config.json` 声明 HGame profile 与模块；现有游戏保持各自的运行时，不强制迁移。

**HGame 物理**：运行时位于 `public/runtime/hgame/`。2D/3D 物理统一使用官方 `@dimforge/rapier2d-deterministic@0.21.0` / `@dimforge/rapier3d-deterministic@0.21.0`，不因单机/联网切换物理后端；物理模块按项目维度加载，本地 WASM，不使用 CDN。物理固定 Tick 与唯一游戏循环一致。V2 arcade 只为旧项目保留，不作为新项目选项；UI profile 不加载物理。完整规范见 [`docs/architecture/HGAME-DETERMINISTIC-PHYSICS.md`](docs/architecture/HGAME-DETERMINISTIC-PHYSICS.md)。

逆向与引擎的职责边界、目录分层和标准交付链见 [`docs/architecture/HGAME-OVERVIEW.md`](docs/architecture/HGAME-OVERVIEW.md)。

**多人确定性逻辑（按需）**：新增独立 `public/runtime/hgame/lockstep/confirmed-frames.js` 已确认封帧调度原型，借鉴 KingOfNinja 的 10Hz/20Hz 封帧、缺帧冻结与逐 Tick 验证经验。普通单机游戏不会加载；该模块不包含 WebSocket、权威整数世界、状态哈希、Rollback 或生产反作弊。详见全局 Skill `hgame/references/LOCKSTEP-OPTIONAL.md` 和 `game-reverse-engineering/references/KINGOFNINJA-LOCKSTEP-CASE.md`。

**HGame Network v1（独立前后端）**：`hgame-network/` 使用 Node.js 22、TypeScript、Colyseus 0.18、WebSocket 与 Vite，提供权威状态同步、原生客户端预测和严格确认帧三种网络底座。服务端和客户端包独立于 WebAsset 站点依赖；本机双标签验收页可运行 `npm run dev:server` 与 `npm run dev:lab` 启动。当前为内存型单进程基础设施，不包含 Toy SDK 正式接入、持久化、Redis 或生产部署。架构与协议见 `docs/architecture/HGAME-NETWORK-V1.md`。

已安装的独立 HTML 项目在此统一浏览；新增或移除 HTML 子目录后刷新游戏页面即可更新列表。WebAsset 仍保留原有 `assets/games/` 导入数据接口作为兼容能力，但**游戏工作区不提供导入、重载、移除、新窗口打开等多余按钮**。安全起见，4175 不开放原项目的 `.git/`、`analysis/`、`tools/`、本地私有配置和其他非运行时文件；游戏预览与角色资产 API 使用不同来源。

## 功能

- 角色搜索、仅填写名字即可新增角色、查看角色道具和性格。
- 最多 4 张参考图：本地上传、剪贴板粘贴、删除。
- 「默认形态 · 六视图」：原有 2:1 四栏六视图，注重角色外观细节。
- 「模型」：**只以当前「影视」AI 定稿图为唯一外观标准**，必要时将角色转成直立两足结构，生成 2:1 布局的全身前视图和严格侧视图供 3D 建模；没有影视图时不允许生成模型图。
- 两种形态的生图背景统一为纯色哑光深灰（`#333333`）；禁止白色、浅灰或透明背景。
- **所有 AI 生图只展示角色本体**：禁止武器、道具、工具、食物、容器、手持物、随身装备和周边独立物件；即使原始参考图中出现，也必须从生成图中移除。角色本身的服装、盔甲、毛发、固有装饰等外观保留。角色资料中的道具字段只作为文字资料，不参与生图。
- 各角色当前待生成的两种形态专属提示词集中整理在 `docs/CHARACTER_IMAGE_GENERATION_QUEUE.md`；角色资料或生成状态变化后运行 `npm run prompts:export` 刷新。
- 每种形态各保留一张 AI 生成图；单独替换，不会覆盖另一种。历史生成图自动归为「默认形态」。
- **角色设定左侧、3D 模型右侧**：设定与模型在宽屏并排显示，窄屏自动上下排列；模型区提供胶囊 Tab「高模 / 低模 / UV」，三维预览可拖动旋转、滚轮缩放；上传 GLB 后关联当前角色。
- **低模 Run 动画**：低模 GLB 内有名称包含 `Run` / `Running` / `跑步` / `奔跑` 的动画片段时自动播放，可暂停和继续；没有对应片段会显示「无 Run 动画」，不会模拟跑步。
- **UV 检查**：读取模型真实网格的 UV0 坐标，展示展开线框，并在可用时叠加模型贴图；支持多网格选择、切换高模/低模的 UV 数据。模型没有 UV 时明确提示。

角色索引位于 `assets/characters/index.json`，图片位于相应角色的 `images/` 和 `generated/` 目录。网站只允许通过本机 API 访问登记图片；`assets/` 原始目录不会作为静态网站公开。迁移时完整复制了 15 个角色、54 张已登记图片；原 GameHub 的历史文件不删除，作为可恢复副本，但后续**只编辑 WebAsset 中的数据**。

## 3D 模型导入与后续生成集成

只接收 **glTF 2.0 二进制 `.glb`**（每个文件最多 150MB），纹理和几何数据必须内嵌；暂不支持需要独立贴图/`.bin` 文件的 `.gltf`，也不内置 Draco 等专用压缩解码器。使用 Blender 等软件导出 GLB，保留 UV 和 Run 动画片段，上传到对应角色的「高模」或「低模」。高模与低模分别存储，上传新的同类型模型只会替换该类型的旧记录，不影响另一类型。

模型索引保存在 `assets/characters/index.json` 的各角色 `models.high` / `models.low` 中，实际文件在 `assets/characters/<角色ID>/models/`。上传接口供未来模型生成流程直接调用：

```text
POST /api/character-models?characterId=<角色ID>&mode=high|low&name=<文件名.glb>
Content-Type: model/gltf-binary
Body: GLB 二进制内容
```

上传后模型立即登记，刷新角色页即可查看。模型文件只通过已登记文件白名单下的 `/files/models/` 路由读取；目录本身不会作为静态网站公开。目前角色库没有预先生成的高模或低模，未上传之前会显示空状态，不展示虚构模型。

## AI 功能依赖

「AI 补充资料」和「AI 生图」沿用原有本地 Codex CLI 工作流。请先安装并登录 Codex CLI。生图依赖 Codex 内置 imagegen 能力；工具不可用时会报错，不会切换到第三方服务。生成结果通过原生流程导入 WebAsset 的角色目录。无需浏览器 API Key。

本仓库包含仅供本机研究使用的用户提供角色图像；不要默认认为素材具有公开再分发或商用授权。不要未经确认发布到公网。

## 验证

`npm test` 运行站点服务、角色索引、图片路由和双形态数据持久化的测试。

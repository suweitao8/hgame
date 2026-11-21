# HGame 通用游戏开发模板标准（五大通用规范与工程套件）

> **核心定位**：一般游戏引擎只提供渲染、物理、输入等基础底座，把 UI、策划数值、核心流程、美术风格和音效反馈全部留给每个项目重复摸索。**HGame 的定位是「AI-Native 通用游戏开发模板套件」**：在保留高性能 2D/3D/UI 引擎底座的同时，将 **UI、策划、Gameplay、美术、音效** 五大制作标准全部预设固化为开箱即用的模块与原型模板——开发新游戏时只需提供想法，即可由蓝图直接生成可玩、统一、带完整反馈的成品骨架。

---

## 一、从想法到可玩游戏的标准流水线

```text
想法 (Idea)
  │  一句话玩法 / 题材 / 风格
  ▼
1. 策划蓝图 (src/game.design.json)
  │  defineGameBlueprint / createBlueprintFromIdea + evaluateBlueprintBalance
  ▼
2. 一键脚手架 (scripts/create-game.mjs --archetype ... --theme ...)
  │  自动装配 5 大通用模块 + 主题 presentation.json + package/catalog
  ▼
3. 玩法与内容填充 (src/)
  │  专注写核心规则/敌人/卡牌/关卡，不再重写菜单、血条、存档、音效、VFX
  ▼
4. 自动化核验与 WebAsset 上线
     npm run blueprint:check + check:ui + snapshot + playtest -> WebAsset (:4174/:4175)
```

---

## 二、五大领域通用规范与标准件

### 1. UI 规范与通用壳（`kit/game-shell-dom.js` + `hgame-ui-ux` + `ui/*`）

- **硬约束**：严格执行 `hgame-ui-ux` 四大铁律——**零句原则**（只用图标 + 数字、2–4 字短标，禁止句子/教程/说明段落）、**按钮配额**（首屏 `<= 1`、局内 `<= 1` 图标、结算 `<= 2`）、**零阻断**（禁止弹窗教程与二次确认，HUD 贴边面积 `<= 10%`）、**做减法**（非核心循环所需元素一律不写）。
- **开箱即用标准件**：`mountGameShell({ root, session })` 自动提供：
  - 首屏实时画面 + 单按钮开局（`Title`）
  - 边缘 HUD：残影血条（`data-ui-bar`）、弹簧跳数指标（`data-ui-metric`）、单图标暂停键
  - 全卡可点击的三选一/四选一卡片层（`Choice`，自动遮蔽底层 HUD）
  - 暂停 / 结算层（`Pause` / `Result` + `再来一局`）
  - 默认隐藏的调试面板（`#debug`，按 `` ` `` 或 `?debug=1` 呼出）
  - 自带 3D 倾斜悬停、光泽扫过、键盘/手柄焦点环与跨主题 CSS Token。

### 2. 策划规范与数值防火墙（`kit/blueprint.js` + `hgame-balance-sim` + `hgame-level-architect`）

- **统一策划契约 (`src/game.design.json`)**：每个项目以结构化 JSON 锁定：
  - `meta`：游戏 ID、标题、原型（`action-2d | horde-2d | arena-3d | card-ui`）、视角、核心循环、单局目标时长
  - `design.feel`（3C 手感）：移速（m/s）、碰撞半径（m）、冲刺速度与冷却、顿帧毫秒、最大震屏创伤
  - `design.balance`（黄金三角）：玩家 HP、基础怪 HP/伤害、有效 DPS、场地跨度、单波时长、升级池上限
  - `design.progression`：波次表、升级卡池（短名 + 正负词条）、经济货币
- **自动数值体检（`evaluateBlueprintBalance` / `npm run blueprint:check`）**：
  - 速度/体型比 `[2.5, 15]`（防像素单位误当米）
  - 场地跨度/移速 `[6, 40]` 秒
  - 基础怪 TTK `gruntHp / weaponDps` `[0.1, 5.0]` 秒
  - 玩家抗击打 `playerHp / gruntDamage` `[3, 25]` 次
  - UI 配额与卡片上限联合门禁（`maxTitleButtons <= 1`、`cardChoices <= 4` 等）

### 3. Gameplay 规范与核心循环（`kit/game-session.js` + `gameplay/*` + `ai/*`）

- **统一对局生命周期**：`createGameSession` 固化 `title -> playing -> choice -> paused -> result` 五态流转，并将状态同步给 UI 导演、音效导演与版本化存档（`createVersionedStore`，含 FNV-1a 校验与 `.bak` 恢复）。
- **通用战斗/成长反馈 API**：
  - `recordHit()` / `recordKill()` / `damagePlayer()` / `healPlayer()` / `setWave()` / `presentChoices()` / `endRun()`
  - 自动处理连击、经验升级、最高分持久化、顿帧触发、`window.__hgameState` 遥测导出。
- **内置高频玩法原型（`assets/archetypes/`）**：
  - `action-2d`：2D 动作生存原型（WebGL2D + 冲刺 + 自动索敌/手动攻击 + 升级三选一）
  - `horde-2d`：2D 高密割草原型（`createSwarmSimulation` + `SpriteCrowd2D.bindSwarm` + 范围脉冲 + 连杀）
  - `arena-3d`：3D 动作竞技原型（Three.js + 程序地形 + 3D VFX + 近战/冲刺 + 物理）
  - `card-ui`：零空转指令驱动卡牌原型（`tickHz: 0` + 3D 悬停卡牌 + 回合攻防）

### 4. 美术规范与跨维度主题预设（`kit/art-themes.js` + `vfx/` + `scripts/process-*`）

- **六套开箱即用跨端主题 (`ART_THEMES`)**：`scifi`、`arcane`、`arcade`、`cyber`、`cozy`、`ink`。一套主题 ID 同时统管：
  - UI 面板配色与边框高光（`uiTheme`）
  - 2D 背景、环境光、Bloom、角色/敌人/子弹/伤害字配色
  - 3D 天空预设（`sky3d`）、雾效、半球光、太阳光、ACES `ueFilmic` 曝光（`resolvePresentationPreset`）
  - 打击特效（`createVfxSystem`）与震屏/顿帧强度
- **资产生产硬标准 (`STANDARD_ART_SPEC`)**：
  - 比例与锚点：`1 unit = 1m`（3D），锚点统一 `bottom-center` / 贴地。
  - 2D 角色图集：纯白 `#FFFFFF` 背景、无阴影切片（运行时统一画动态阴影）。
  - 3D 角色资产：统一 `<= 3,000` 顶点、2:1 虚握武器手势、`character-pack` 拓扑净门禁。

### 5. 音效规范与零 KB 导演矩阵（`kit/audio-director.js` + `platform/audio/*`）

- **21 个标准化游戏与 UI 音效事件 (`GAME_AUDIO_EVENTS`)**：
  - 玩法事件：`attack`, `hit`, `crit`, `kill`, `dash`, `hurt`, `pickup`, `levelup`, `waveStart`, `bossSpawn`, `victory`, `defeat`, `interact`
  - UI 事件：`uiHover`, `uiPress`, `uiConfirm`, `uiCancel`, `uiOpen`, `uiClose`, `uiReward`, `uiError`
- **零资源启动 + 无缝替换**：`createAudioDirector` 默认将全部事件映射到零 KB 合成预设（带防刷屏冷却 `cooldownMs` 与音高微扰 `pitchJitter`），并随游戏阶段与波次自动调度自适应 BGM（`title` 舒缓、`playing` 随连击/波次提速、`boss` 切高压、`paused` 降音、`result` 切胜利/余韵）；后续只需注册 `.mp3` Cue 即可无痛覆盖，玩法代码零修改。

---

## 三、单游戏整体设计文档与「先改文档、再改实现、改后必测」工作流

除了通用框架规范外，**每款具体游戏都必须维护自己独立、完整的设计文档集（位于游戏工程根目录 `docs/design/`，与引擎托管目录 `docs/hgame/` 彻底隔离）**：

| 文档 | 职责 | 改前同步原则 |
| --- | --- | --- |
| `docs/design/GDD.md` | 策划案总纲（核心循环、3C 手感、黄金三角数值、成长经济、胜负规则、变更记录） | 任何玩法/数值调整前先改表并记入 Change Log |
| `docs/design/ART-AND-AUDIO.md` | 美术与音效设计（主题色板、光影预设、角色/怪物/道具资产清单、VFX、BGM/SFX 映射） | 换主题、加资产或改打击反馈前先登记规格 |
| `docs/design/UI-UX.md` | UI 与 UX 交互（界面流转、HUD 配额、卡片规则、输入键位与动效反馈） | 新增 HUD、浮层或交互按键前先校对配额 |
| `docs/design/LEVEL.md` | 关卡与地编设计（空间尺度、碰撞分离、出生点/刷怪区/目标拓扑、波次节奏） | 改地图尺寸、障碍或刷怪规则前先更新拓扑 |

- **自动生成**：`scripts/create-game.mjs` 在创建新游戏时自动写入全部 4 份定制化文档（以及可选 `src/game.design.json`）。
- **硬性闭环校验**：每次修改遵循 **「更新 `docs/design/*.md`（及 `src/game.design.json`） -> 实现代码与资产 -> 运行 `npm run check:design`、`npm test`、`npm run accept`」**；`scripts/accept.mjs` 的 `designDocs` 门禁与源码摘要 `sourceDigest` 会将 `docs/design/` 纳入校验范围，确保文档与实现、测试始终一致。


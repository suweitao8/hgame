# 游戏逆向调查与独立重建：精简工作底稿

## A. 只读快拆与沙盒落盘

1. 运行 `npm run re:extract -- "<original-game-dir>" --slug <slug>`（或调用 `scripts/extract-fast.mjs`），在 `<reWorkspaceDir>/projects/<slug>/raw/` 自动完成初扫与通道分流（仅临时预览不落盘时用 `scripts/inventory.mjs`）。
2. 原游戏目录 100% 只读；所有解包产物与笔记必须落在 `<reWorkspaceDir>/projects/<slug>/`（通过 `.hgame.local.json` 或 `HGAME_RE_WORKSPACE` 配置）。
3. 严禁因看到引擎标志 DLL 就默认按 3D 立项；先核对相机（Ortho vs Perspective）、Collider 维度与控制方式。

## B. 机制取证表（按 80/0 原则聚焦核心玩法）

| 系统 | 提取焦点 (`seen` / `inferred`) | HGame 接管项 (`hgame-fallback`) |
|---|---|---|
| 数值与掉落 | 武器/角色属性表、伤害公式、商店刷新权重、波次导演曲线 | `sim-balance.mjs` 千局蒙特卡洛验算 |
| 状态与战斗 | 技能前摇/命中帧/后摇/打断规则、CD、硬直、输入缓冲 | `createStateMachine` / `createBehaviorTree` / `app.hitStop` |
| 3C 与手感 | 移速、加减速、转向阻尼、FOV、弹簧臂距离、相机边界 | `camera3d.js` / `Camera2D` / `SpringDamper` |
| 群集与寻路 | 刷怪密度、索敌半径、包围/逃跑策略 | `createSwarmSimulation` / `createNavMesh3D` / `TileMap` |
| 视觉与音频 | 触发时机、颜色编码、语义槽位（禁研究底层 Shader 与像素排版） | `createVfxSystem` / `audio.playSynth` / `hgame-ui-ux` |
| 联机（按需） | 权威模型、协议版本、封帧语义、状态哈希 | `createConfirmedFrameScheduler` + `compare-tick-traces.mjs` |

## C. 净室交接与 HGame 最小切片验证

1. 运行 `npm run re:spec -- --slug <slug> [--ip-terms "TermA,TermB"]` 导出 `<reWorkspaceDir>/specs-out/<slug>.clean-spec.json`（自动剥离本机路径、原版扩展名、IP 专有名词与源码片段）。
2. 运行 `npm run re:forge -- --slug <slug> --out "<new-game-dir>"`，经 `hgame-spec-forge` 校验规格并调用 `scripts/create-game.mjs --bare` 生成独立工程，`src/sim/` 承载纯数据逻辑。
3. 验证闭环：
   - 数值：`sim-balance.mjs` 核对胜率与 TTK；
   - 关卡：`check-level.mjs` 断言 100% 可达；
   - 画面与交互：`npm run snapshot` + `npm run playtest` + `check-ui.mjs`；
   - 行为一致：必要时用 `createTraceRecorder()` 与 `compare-game-traces.mjs` 比对关键事件轨迹。

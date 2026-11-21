# 新游戏（`new-game`）美术与音效设计文档

> 本文档定义 `新游戏` 的视觉主题、资产规范、VFX 打击感与自适应音频映射。新增或替换贴图、模型、特效、音效前，请先在此登记规格与逻辑 ID。

## 1. 美术风格与跨端主题（Theme: `scifi`）

- **美术主题**：`scifi`（联动 UI 主题：`scifi`，BGM 基调：`cyber`）
- **核心色板（Palette）**：
  - 背景 `bg`：`#09111e` · 容器 `surface`：`#102033`
  - 主色 `primary`：`#38bdf8` · 辅色 `secondary`：`#818cf8` · 强调 `accent`：`#34d399`
  - 主角 `player`：`#38bdf8` · 敌人 `enemy`：`#fb7185` · 弹道 `projectile`：`#67e8f9`
- **光影与色调映射**：
  - 2D：环境光 `#1e3a5f`（强度 `0.72`），Bloom `0.35`，暗角 `0.25`。
  - 3D：`ueFilmic`（曝光 `1.12`），天空预设 `night`，雾效 `20~64m`。

## 2. 资产制作与命名规范

- **比例与锚点**：3D 统一 `1 unit = 1m`，锚点 `bottom-center` 贴地；2D 角色使用纯白 `#FFFFFF` 无阴影切片，由运行时动态绘制地面阴影。
- **性能与拓扑预算**：3D 角色严格控制在 `<= 3,000` 顶点、半握武器手势；离线二进制资产由 `assets.manifest.json` 追踪，逻辑 ID 登记在 `assets/catalog.json`。
- **当前资产清单**：
  - `player`：主角表现载体（初始程序化几何/色块兜底，替换正式立绘/GLB 时保持碰撞分离）。
  - `enemy`：基础敌方单位（受击闪白 `hitFlash` + 统一配色区分）。
  - `projectile`：玩家攻击弹道/刀光表现。

## 3. VFX 与打击感

- **统一粒子与飘字**：使用 `createVfxSystem` 零 GC 粒子与 GPU 伤害跳字（预设：`normal`）。
- **视觉反馈色**：受击 `#67e8f9`，刀光 `#38bdf8`，拾取 `#34d399`。

## 4. 音效与自适应 BGM 矩阵

- **音效配置档**：`action`（主情绪：`cyber`）
- **阶段情绪流转**：
  - `title`：低强度舒缓铺底（`0.25`）
  - `playing`：随波次与连击动态提升强度；`bossActive` 切高压模式
  - `paused` / `choice`：自动压低背景音量避免干扰决策
  - `result`：胜利切 `victory`，失败切 `chill`
- **SFX 事件映射**：默认通过 `createAudioDirector` 走零 KB 合成预设（含冷却防刷屏），正式音频只需放入 `assets/audio/` 并通过 `registerCueOverrides` 替换对应事件键。

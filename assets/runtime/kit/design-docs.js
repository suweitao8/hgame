// Per-game holistic design document templates (GDD, Art & Audio, UI/UX, Level Design).
import { getArtTheme } from './art-themes.js';
import { defineGameBlueprint } from './blueprint.js';

/** Canonical per-game design document filenames under `docs/design/`. */
export const REQUIRED_DESIGN_DOCS = Object.freeze([
  'GDD.md',
  'ART-AND-AUDIO.md',
  'UI-UX.md',
  'LEVEL.md',
]);

/**
 * Render the 4 canonical per-game design documents from a game's config, engine recipe, and optional blueprint.
 * @param {{ gameConfig?: { id?: string, name?: string, version?: string }, recipe?: { profile?: string, renderer?: string, physics?: string | null, tickHz?: number }, blueprint?: object | null }} [options]
 * @returns {{ 'GDD.md': string, 'ART-AND-AUDIO.md': string, 'UI-UX.md': string, 'LEVEL.md': string }}
 */
export function renderGameDesignDocs(options = {}) {
  const gameConfig = options.gameConfig ?? {};
  const recipe = options.recipe ?? {};
  const id = String(gameConfig.id || options.blueprint?.meta?.id || 'new-game');
  const title = String(gameConfig.name || options.blueprint?.meta?.title || id);
  const version = String(gameConfig.version || '0.1.0');
  const profile = String(recipe.profile || options.blueprint?.meta?.perspective || '2d');
  const renderer = String(recipe.renderer || options.blueprint?.meta?.renderer || 'webgl2d');
  const physics = recipe.physics || (profile === '3d' ? 'rapier3d' : 'none');
  const tickHz = Number.isFinite(recipe.tickHz) ? recipe.tickHz : (profile === 'ui' ? 0 : 60);

  const defaultGenre = profile === '3d' ? 'arena-3d' : profile === 'ui' ? 'card-ui' : 'action-2d';
  const bp = options.blueprint
    ? defineGameBlueprint(options.blueprint)
    : defineGameBlueprint({ meta: { id, title, genre: defaultGenre, renderer, tickHz } });
  const theme = getArtTheme(bp.art.theme);
  const { feel, balance, progression } = bp.design;
  const upgradesText = progression.upgrades
    .map(u => `- \`${u.id}\` · **${u.label}**：${u.pos || '增益'} / ${u.neg || '无副作用'}`)
    .join('\n');
  const wavesText = progression.waves
    .map(w => `- \`${w.id}\`：时长 \`${w.durationSec}s\`，刷新率 \`${w.spawnRate}/s\`，敌种 \`${(w.enemyTypes || []).join(', ')}\``)
    .join('\n');

  const gdd = `# ${title}（\`${id}\`）策划案总纲（GDD）

> 本文档为 \`${title}\`（v${version}）的单一权威策划文档。**任何玩法、数值、系统或内容修改，必须先更新本文档与对应分卷文档，再改代码，并在实现后运行 \`npm run check:design\`、\`npm test\` 与 \`npm run accept\` 验证。**

## 1. 基础定位与核心循环

- **游戏 ID**：\`${id}\`
- **玩法原型（genre）**：\`${bp.meta.genre}\`（视角：\`${profile}\`，渲染器：\`${renderer}\`，物理：\`${physics}\`，固定步频：\`${tickHz} Hz\`）
- **核心循环（Core Loop）**：\`${bp.meta.coreLoop}\`
- **单局目标时长**：\`${bp.meta.sessionTargetSec}s\`
- **设计纲领**：以紧凑的「移动/决策 -> 交战反馈 -> 成长选择 -> 波次升级/胜负结算」形成高反馈短局循环；禁止偏离核心体验的冗余外围系统。

## 2. 3C 手感与操作规格

| 参数 | 数值 | 说明 |
| --- | --- | --- |
| 移动速度 \`playerSpeed\` | \`${feel.playerSpeed} m/s\` | 主角常规移动速率 |
| 碰撞半径 \`playerRadius\` | \`${feel.playerRadius} m\` | 角色受击与体型判定半径 |
| 冲刺速度 \`dashSpeed\` | \`${feel.dashSpeed} m/s\` | 瞬时位移爆发速度 |
| 冲刺冷却 \`dashCooldownSec\` | \`${feel.dashCooldownSec} s\` | 冲刺技能冷却间隔 |
| 顿帧时长 \`hitStopMs\` | \`${feel.hitStopMs} ms\` | 暴击/重击停顿感 |
| 最大震屏 \`traumaMax\` | \`${feel.traumaMax}\` | 相机创伤抖动上限 |

## 3. 核心数值平衡与黄金三角

| 指标 | 当前值 | 设计约束 / 依据 |
| --- | --- | --- |
| 玩家生命 \`playerHp\` | \`${balance.playerHp}\` | 抗击打次数 \`${balance.gruntDamage > 0 ? (balance.playerHp / balance.gruntDamage).toFixed(1) : 'N/A'}\` 次（建议 \`3~25\` 次） |
| 基础怪生命 \`gruntHp\` | \`${balance.gruntHp}\` | 基准 TTK \`${balance.weaponDps > 0 ? (balance.gruntHp / balance.weaponDps).toFixed(2) : 'N/A'}s\`（建议 \`0.1~5.0s\`） |
| 基础怪伤害 \`gruntDamage\` | \`${balance.gruntDamage}\` | 每次接触/攻击伤害 |
| 有效输出 \`weaponDps\` | \`${balance.weaponDps}\` | 初始武器基准秒伤 |
| 场地跨度 \`arenaSpan\` | \`${balance.arenaSpan} m\` | 穿场时间 \`${feel.playerSpeed > 0 ? (balance.arenaSpan / feel.playerSpeed).toFixed(1) : '0'}s\`（建议 \`6~40s\`） |
| 单波时长 \`waveDurationSec\` | \`${balance.waveDurationSec} s\` | 基础波次节奏 |

## 4. 成长、经济与胜负规则

- **核心货币**：\`${progression.economy.currency}\`（初始 \`${progression.economy.startingAmount}\`）
- **升级卡池上限**：\`${balance.maxUpgrades}\` 项（每次最多展示 \`${bp.ui.cardChoices}\` 张卡）
${upgradesText}

### 波次基线
${wavesText}

- **胜负与重开**：玩家生命归零进入 \`result\` 结算并持久化最高分（\`createVersionedStore\`），点击「再来一局」无刷新重置状态。

## 5. 变更记录（Change Log）

| 版本 | 日期 | 变更模块 | 变更内容与设计依据 | 验证命令 |
| --- | --- | --- | --- | --- |
| v${version} | 初始化 | 全盘基线 | 基于 \`${bp.meta.genre}\` 原型与 \`${theme.id}\` 主题建立初始策划案 | \`npm run check:design\` / \`npm test\` |
`;

  const artAudio = `# ${title}（\`${id}\`）美术与音效设计文档

> 本文档定义 \`${title}\` 的视觉主题、资产规范、VFX 打击感与自适应音频映射。新增或替换贴图、模型、特效、音效前，请先在此登记规格与逻辑 ID。

## 1. 美术风格与跨端主题（Theme: \`${theme.id}\`）

- **美术主题**：\`${theme.id}\`（联动 UI 主题：\`${theme.uiTheme}\`，BGM 基调：\`${bp.audio.mood}\`）
- **核心色板（Palette）**：
  - 背景 \`bg\`：\`${bp.art.palette.bg}\` · 容器 \`surface\`：\`${bp.art.palette.surface}\`
  - 主色 \`primary\`：\`${bp.art.palette.primary}\` · 辅色 \`secondary\`：\`${bp.art.palette.secondary}\` · 强调 \`accent\`：\`${bp.art.palette.accent}\`
  - 主角 \`player\`：\`${bp.art.palette.player}\` · 敌人 \`enemy\`：\`${bp.art.palette.enemy}\` · 弹道 \`projectile\`：\`${bp.art.palette.projectile}\`
- **光影与色调映射**：
  - 2D：环境光 \`${theme.lighting2d.ambient}\`（强度 \`${theme.lighting2d.ambientIntensity}\`），Bloom \`${theme.lighting2d.bloomStrength}\`，暗角 \`${theme.lighting2d.vignette}\`。
  - 3D：\`${theme.presentation3d.toneMapping}\`（曝光 \`${theme.presentation3d.exposure}\`），天空预设 \`${theme.presentation3d.skyPreset}\`，雾效 \`${theme.presentation3d.fog.near}~${theme.presentation3d.fog.far}m\`。

## 2. 资产制作与命名规范

- **比例与锚点**：3D 统一 \`1 unit = 1m\`，锚点 \`bottom-center\` 贴地；2D 角色使用纯白 \`#FFFFFF\` 无阴影切片，由运行时动态绘制地面阴影。
- **性能与拓扑预算**：3D 角色严格控制在 \`<= 3,000\` 顶点、半握武器手势；离线二进制资产由 \`assets.manifest.json\` 追踪，逻辑 ID 登记在 \`assets/catalog.json\`。
- **当前资产清单**：
  - \`player\`：主角表现载体（初始程序化几何/色块兜底，替换正式立绘/GLB 时保持碰撞分离）。
  - \`enemy\`：基础敌方单位（受击闪白 \`hitFlash\` + 统一配色区分）。
  - \`projectile\`：玩家攻击弹道/刀光表现。

## 3. VFX 与打击感

- **统一粒子与飘字**：使用 \`createVfxSystem\` 零 GC 粒子与 GPU 伤害跳字（预设：\`${bp.art.damagePreset}\`）。
- **视觉反馈色**：受击 \`${theme.vfx.hitColor}\`，刀光 \`${theme.vfx.slashColor}\`，拾取 \`${theme.vfx.pickupColor}\`。

## 4. 音效与自适应 BGM 矩阵

- **音效配置档**：\`${bp.audio.profile}\`（主情绪：\`${bp.audio.mood}\`）
- **阶段情绪流转**：
  - \`title\`：低强度舒缓铺底（\`0.25\`）
  - \`playing\`：随波次与连击动态提升强度；\`bossActive\` 切高压模式
  - \`paused\` / \`choice\`：自动压低背景音量避免干扰决策
  - \`result\`：胜利切 \`victory\`，失败切 \`chill\`
- **SFX 事件映射**：默认通过 \`createAudioDirector\` 走零 KB 合成预设（含冷却防刷屏），正式音频只需放入 \`assets/audio/\` 并通过 \`registerCueOverrides\` 替换对应事件键。
`;

  const uiUx = `# ${title}（\`${id}\`）UI 与 UX 交互设计文档

> 本文档定义 \`${title}\` 的界面状态机、信息配额与交互动效规范。严禁未经设计直接堆砌说明文字、规则弹窗或多余按钮。

## 1. 界面流转状态机（\`UI_PHASES\`）

\`title\`（首屏实时画面 + 开始） -> \`playing\`（边缘 HUD） <-> \`choice\`（升级/抉择卡） / \`paused\`（暂停） -> \`result\`（胜负结算 + 再来一局）

## 2. 防膨胀配额（Anti-Bloat Hard Limits）

| 检查项 | 设计上限 | 当前配置 |
| --- | --- | --- |
| 首屏行动按钮 \`maxTitleButtons\` | \`<= 1\` | \`${bp.ui.maxTitleButtons}\` |
| 局内常驻按钮 \`maxInGameButtons\` | \`<= 1\`（图标键） | \`${bp.ui.maxInGameButtons}\` |
| 结算层按钮 \`maxResultButtons\` | \`<= 2\` | \`${bp.ui.maxResultButtons}\` |
| 边缘 HUD 遮挡占比 \`hudMaxAreaRatio\` | \`<= 10%\` | \`${Math.round(bp.ui.hudMaxAreaRatio * 100)}%\` |
| 抉择卡数量 \`cardChoices\` | \`<= 4\` | \`${bp.ui.cardChoices}\` |
| HUD 指标 \`hudMetrics\` | \`<= 5\`（图标 + 数字） | \`${bp.ui.hudMetrics.join(', ')}\` |

- **零句原则**：界面禁用整句描述与教程弹窗，信息统一以「图标 + 数字」或 \`2~4\` 字短标签呈现。
- **弹窗隔离**：打开 \`#hg-title\`、\`#levelup\`、\`#gameover\` 任一浮层时，自动隐藏底层边缘 HUD 数值与按钮。
- **调试面板**：\`#debug\` 默认 \`hidden\`，仅通过键盘 \`\\\`\` 键或 \`?debug=1\` 呼出。

## 3. 输入映射与 UX 动效

- **PC 键鼠**：P1 统一 \`WASD\` 移动 + \`J K L U I O\` 技能/确认，\`Esc\` 暂停。
- **移动端触屏**：通过 \`createTouchControls({ mode: 'touch-only' })\` 仅在触屏操作时无侵入呼出。
- **触感反馈**：由 \`bindUiUxDOM\`（主题 \`${theme.uiTheme}\`）统一驱动 3D 卡片悬停倾斜、残影血条（\`data-ui-bar\`）、弹簧跳数（\`data-ui-metric\`）与交互音效。
`;

  const level = `# ${title}（\`${id}\`）关卡与地编设计文档

> 本文档定义 \`${title}\` 的空间尺度、出生点与刷怪拓扑、碰撞分离原则及波次推进节奏。调整地图结构、障碍物或刷怪区域前，须同步更新本文档与关卡数据文件。

## 1. 空间尺度与坐标约定

- **渲染维度**：\`${profile}\`（固定步频 \`${tickHz} Hz\`）
- **逻辑场地跨度（arenaSpan）**：\`${balance.arenaSpan} m\`（中心为原点 \`(0, 0)\`，有效活动半径约 \`${(balance.arenaSpan * 0.5).toFixed(1)} m\`）
- **单位规范**：逻辑数值统一采用 SI 制（米 / 秒 / 弧度）；2D 渲染映射时显式标定像素换算比例，禁止将像素坐标混入策划数值。

## 2. 地形、障碍与碰撞分离

- **视觉与碰撞分离**：表现层几何/贴图/材质（如 \`model-slots.json\`、装饰网格）不得直接充当权威碰撞或寻路依据；物理碰撞与障碍阻挡必须在关卡数据（如 \`level.json\`、\`TileMap\` 或 \`createHeightfieldTerrain3D\`）中显式声明。
- **可达性约束**：任何带有障碍物或房间/通道的地图修改后，必须使用 \`check-level.mjs\`（BFS 可达性校验）确保出生点到所有关键点 \`100%\` 连通且无孤岛。

## 3. 出生点、刷怪区与触发拓扑

- **玩家出生点**：场地中心 \`(0, 0)\`，开局保证安全视野与缓冲半径。
- **敌人刷新环带**：围绕玩家外围安全环带生成（避免贴脸瞬杀），并在波次推进时逐步缩短刷新间隔。
- **波次与事件编排**：
${wavesText}
`;

  return {
    'GDD.md': gdd,
    'ART-AND-AUDIO.md': artAudio,
    'UI-UX.md': uiUx,
    'LEVEL.md': level,
  };
}

---
name: hgame-ui-ux
description: Minimalist zero-prose game UI/UX standard & static linter for HGame. Enforces zero instructional copy, minimal clicks/buttons, whole-card selection with symbolic stat tags, and <=10% HUD footprint.
---

# HGame Minimalist Zero-Prose UI/UX (`hgame-ui-ux`)

Games are not websites or admin dashboards. Whenever creating a game or building/editing a HUD, title screen, shop, upgrade modal, or game-over overlay, follow these 4 non-negotiable rules and verify with `check-ui.mjs` + `npm run snapshot`.

## 1. Run Verification

```bash
node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --dir path/to/game
# Quick self-test demo:
node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --demo
```

## 2. Four Hard UI/UX Rules

1. **零说明文本铁律 (Zero-Prose Rule)**
   - 严禁在界面任何位置放置「操作说明 / 玩法介绍 / 游戏简介 / How to play / Instructions / Powered by / 副标题标语」等解释性文本或 `<p>` 段落。
   - 键鼠提示若需展示，仅允许在开局角色旁显示半透明按键图标，并在玩家首次移动后 `0.5s` 内自动淡出销毁；移动端统一使用 `createTouchControls({ mode: 'touch-only' })` 隐形呼出。

2. **最少点击与按钮配额 (Minimal Clicks & Button Quotas)**
   - 开局最多 `1` 次点击进入战斗（优先移动即开局或单颗纯开始键）。
   - 战斗态 HUD 可见按钮严格 `<= 1` 个（仅右上角纯图标暂停键）；严禁在战斗画面常驻「重开 / 返回 / 帮助 / 种子 / 调试」按钮。
   - 暂停与结算层按钮 `<= 2` 个，单个按钮文案严格 `<= 4` 个汉字（或纯图标）。
   - 所有压测/调试/FPS/种子开关必须隐藏在键盘 `` ` `` 键或 URL `?debug=1` 参数后，默认对玩家 100% 不可见。

3. **卡片即按钮 & 词条符号化 (Card-as-Button & Symbolic Tags)**
   - 三选一升级卡、商店物品、模式选择一律**点击整张卡片直接生效**（严禁卡片内再套 `<button>选择</button>` 等冗余按钮）。
   - 卡片内禁止写背景故事与完整长句（禁用句号 `。`），单卡总文本严格 `<= 18` 字，仅保留「图标 + 短名称 + 绿正/红负纯数值词条」。
   - 正例：`⚔️ 狂暴 +25% 攻速 / -10% 护甲`；反例：`这是一把古老的战斧，装备后可以大幅提升你的攻击速度。` + `[选择]`。

4. **画面留白红线 (<= 10% HUD & Non-Verbal Feedback)**
   - 战斗中所有 HUD 元素总占地面积不得超过视口面积的 `10%`，优先全屏画布 + 角落精简血条/数字。
   - 能用 `createVfxSystem`（受击闪白、预警圈、跳字、屏幕脉冲）与 `audio.playSynth` 传达的状态，一律禁止弹出 Toast 文字提示条。

5. **弹窗隔离、极简零冗余角标与铺满图片卡片铁律 (Modal Isolation, Zero Bloat Badges & Full-Bleed Cards)**
   - 居中事件/抉择弹窗打开时，必须隐藏或遮断底层 HUD 数值条、边角按钮与底部导航栏，严禁让背景场景文字/状态栏透出叠加在弹窗外围。
   - **严禁私自编造任何未被要求的状态角标、提醒标签、引导句或多余文字**（例如在物品格/卡片上贴「今晚自耗」「不可干预」「自动使用」「次日生效」「点击装备」等自以为是的提示胶囊；以及「第 N 天 · 突发事件」、角色外号胶囊 `.role-pill`、无意义台词 `quote`、“参考xx/请选择至少1人”废话）。用户没要求显示的提醒一律不准画在 UI 上！
   - **选人/出战/编队弹窗即信息面板**：可点选卡片必须复用完整角色属性与装备槽位信息（禁止退化为只剩名字与战力的空壳按钮）；未选中时禁用确认按钮、仅保留单一取消/关闭入口（严禁页头 `✕` 与底部 `取消` 重复堆砌），并支持点击外部黑色遮罩直接关闭。
   - **图片铺满容器与零多余行间留白铁律**：卡片内的主视觉/场景缩略图必须**无内边距贴边铺满容器高度（100% 高度）或顶部全宽（100% 宽度）**，严禁把图片缩在厚内边距卡片里留出大片死角；标题、属性/奖励、敌我数值与操作按钮必须紧凑排布（`2px~4px` 间距），严禁出现大块空白垂直间隔。
   - 选项区必须有清晰的 `选项` 标题并严格控制在 `<= 4` 项，每个选项按钮只保留**直接明了的单层选项内容**（必要时同行附简洁数值/成本），严禁拆成“主标题 + 装饰性副描述”两行堆叠。

## 3. Minimalist Card Pattern

```html
<!-- GOOD: whole card is clickable, <=18 chars, green/red stat tags -->
<button type="button" class="card" data-upgrade="frenzy">
  <span class="name">⚔️ 狂暴</span>
  <span class="pos">+25% 攻速</span>
  <span class="neg">-10% 护甲</span>
</button>
```

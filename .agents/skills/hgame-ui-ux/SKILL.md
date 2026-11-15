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

## 3. Minimalist Card Pattern

```html
<!-- GOOD: whole card is clickable, <=18 chars, green/red stat tags -->
<button type="button" class="card" data-upgrade="frenzy">
  <span class="name">⚔️ 狂暴</span>
  <span class="pos">+25% 攻速</span>
  <span class="neg">-10% 护甲</span>
</button>
```

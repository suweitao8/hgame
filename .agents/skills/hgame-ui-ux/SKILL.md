---
name: hgame-ui-ux
description: Minimalist Anti-Bloat UI/UX standard & static/runtime verifier for HGame. Enforces Zero-Prose (icon + number, 2-4 hanzi labels), Hard Button Budget (title <=1, in-game <=1, result <=2), No Modals (<=10% edge HUD, zero tutorials/confirm dialogs), Subtract-First Check, plus conditional whole-card/event-overlay rules.
---

# HGame Minimalist Anti-Bloat UI/UX (`hgame-ui-ux`)

Games are not websites, tutorials, or admin dashboards. Whenever creating a game or building/editing a HUD, title screen, pause/result overlay, shop, upgrade choice, or event modal, follow the 4 Anti-Bloat Hard Rules below and verify with `check-ui.mjs` + `snapshot.mjs --check-ui`.

## 1. Run Verification

```bash
# Static Anti-Bloat lint (from HGame root, or run check-ui.mjs directly):
npm run check:ui -- --dir <game-dir>
node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --demo

# Runtime HUD footprint (<= 10%), button budget & hidden debug check:
npm run snapshot -- <game-dir> --check-ui
```

## 2. Four Hard Anti-Bloat Rules (All Games)

1. **零句原则（Zero-Prose）**
   - 局内禁止出现任何完整句子（禁句号 `。` 等长句标点）或解释性段落（禁用 `<p>`、`<footer>`、`.subtitle`、`.instructions`、`.how-to-play`、`"操作说明 / 玩法介绍 / 规则说明 / Powered by"` 等）。
   - 信息只用 **「图标 + 数字」** 表达（如 `HP 3`、`×12`、`♥ 3`、`⚡ 50`），必要短标签严格控制在 **2–4 个汉字**（或 1–2 个短英文词）。
   - 凡是需要写字解释的机制，一律改为**视觉与音频反馈**：高亮、呼吸动画、虚线预览、预警圈、受击闪白、飘字与音效（`createVfxSystem` + `audio.playSynth`），严禁弹出 Toast 文字提示条。
   - 若开局需展示键鼠提示，仅允许在角色旁显示半透明按键图标，并在玩家首次移动后 `0.5s` 内自动淡出销毁；移动端统一使用 `createTouchControls({ mode: 'touch-only' })` 隐形呼出。

2. **按钮配额（Hard Button Budget）**
   - **首屏（Title）**：直接露出实时游戏画面，最多 **`1` 个主行动按钮**（或点击/移动任意位置直接开玩）；**严禁**放置独立「规则说明 / 玩法 / 帮助 / 教程」按钮。
   - **局内（In-Game）**：常驻非核心操作按钮**不超过 `1` 个**（最多角落放一个极简暂停或静音图标；单局短平快的直接 **`0` 按钮**）。严禁常驻「重开 / 返回 / 帮助 / 种子 / 调试」按钮。
   - **结算 / 暂停（Result / Pause）**：结算层主按钮保留「再来一局」，最多附带 **`1` 个次要图标按钮**（总按钮 `<= 2` 个，单个按钮文案 `<= 4` 个汉字或纯图标）。
   - **调试面板（Debug）**：所有压测 / FPS / 种子 / 调试面板默认必须带 `hidden` 隐藏，仅通过键盘 `` ` `` 键或 URL `?debug=1` 呼出。

3. **零阻断原则（No Modals）**
   - **禁止**任何新手教程弹窗、玩法说明弹窗、二次确认弹窗（同时禁止原生 `alert()` / `confirm()` / `prompt()` 与自定义 `"确定要…"` 弹窗）。
   - **禁止**在顶部或侧边堆砌多栏 HUD 卡片；所有常驻叠加 UI 仅贴屏边缘，总遮挡面积**不超过画布的 `10%`**（透明全屏定位壳如 `#hud { inset: 0; background: transparent }` 不计面积，只计实际可见元素与文本）。

4. **做减法检查（默认删光再加回）**
   - 生成任何 UI 前先自检：**删掉这段文字、这个角标或这个按钮，核心玩法还能不能跑通？能跑通就一律不准写。**
   - **严禁私自编造未被要求的状态角标、提醒标签、角色外号或台词**（例如 `"今晚自耗"`、`"不可干预"`、`"自动消耗"`、`"次日生效"`、`"点击装备"` 等胶囊，以及角色外号 `.role-pill`、无意义 `quote` 独白框、`"第 N 天 · 突发事件"` 眉标）。
5. **移动端竖屏优先 & 右下角半圆拇指舒适区（Portrait & Bottom-Right Thumb-Arc）**
   - **全面竖屏设计**：所有新游默认面向手机端 B站 Toy 竖屏单手/双手舒适持握体验设计（PC 端 Web 仅用于测试与开发）。
   - **交互重心下沉至右下角弧形半圆舒适区**：核心技能、主行动按钮、暂停/设置触发键、首屏开始与结算重开区，必须优先布局在以**屏幕右下角为圆心的 1/4 ~ 半圆弧形热区**（`centerY >= 0.5 * viewportHeight`，推荐使用引擎内置 `computeThumbArcLayout`、`createThumbArcHud`、`createTouchControls({ buttonLayout: 'portrait-arc' })` 与 `mountGameShell({ portraitFirst: true })`）。
   - **上半屏禁放高难触及按钮**：尽可能不把任何可点击按钮放在屏幕上半区（顶部边缘仅用于只读血条/分数展示，且 `pointer-events: none`），通过 `auditPortraitThumbZone` 自检验证零越界。

## 3. Conditional Rules（仅当玩法确实需要卡牌 / 商店 / 编队 / 抉择弹窗时）

1. **卡片即按钮 & 符号化词条（Whole-Card & Symbolic Tags）**
   - 三选一升级卡、商店物品、模式卡一律**整卡即按钮**（`<button type="button" class="card">...</button>`）；严禁卡片内再套 `<button>选择</button>`。
   - 卡面禁止背景故事与完整句（禁 `。`），单卡总字数 `<= 18` 字，仅保留「图标 + 短名 + 绿正/红负符号数值」（如 `⚔️ 狂暴` `+25% 攻速` `-10% 护甲`）。
2. **弹窗 HUD 隔离与单一关闭入口（Modal Isolation）**
   - 居中升级/事件/选人弹窗打开时，必须隐藏或遮断底层 HUD 数值条与边角按钮（推荐纯 CSS `#hud:has(#gameover:not([hidden]), #levelup:not([hidden])) :is(.bars, #readout) { visibility: hidden; }`），严禁背景数字透出叠加。
   - 关闭控件只留单一入口 + 点击黑色遮罩关闭（严禁页头 `✕` 与底部 `取消` 重复堆砌）。
3. **铺满图片卡片与实效信息面板（Full-Bleed Media & Rich Roster Cards）**
   - 卡片主视觉图/缩略图必须**无内边距贴边铺满容器高度（`100%`）或顶部全宽（`100%`）**，文本间距紧凑（`2px–4px`），严禁厚内边距留出大块垂直空白。
   - 选人/出战/编队卡必须直接复用真实属性与装备槽位信息（禁止退化为空壳姓名牌），未选中时确认键保持 `disabled`。
4. **抉择选项区规范（Direct Choice Buttons）**
   - 选项区必须有明确 `选项` 标题并控制为 `<= 4` 项；每个选项按钮只保留单层直白选项（必要时同行附简洁数值/成本），严禁拆成“主标题 + 装饰性副描述”两行堆叠。

## 4. Minimalist Reference Markup Patterns

```html
<!-- GOOD: edge HUD (<= 10%), <= 1 icon button, hidden debug -->
<canvas id="game" aria-label="游戏画面"></canvas>
<div id="hud" aria-live="polite">
  <div class="bars"><div id="hp" class="bar hp"><i></i></div></div>
  <div id="readout"><span>♥ 3</span><span>×12</span></div>
  <button id="pause" type="button" aria-label="暂停">⏸</button>
  <div id="debug" hidden></div>
  <div id="levelup" hidden>
    <button type="button" class="card" data-upgrade="frenzy">
      <span class="name">⚔️ 狂暴</span>
      <span class="pos">+25% 攻速</span>
      <span class="neg">-10% 护甲</span>
    </button>
  </div>
  <div id="gameover" hidden>
    <div id="result">×12</div>
    <button id="restart" type="button">再来一局</button>
  </div>
</div>
```

```css
/* Hide edge HUD cleanly whenever an overlay is active */
#hud:has(#levelup:not([hidden]), #gameover:not([hidden])) :is(.bars, #readout, #pause, #debug) {
  visibility: hidden;
}
```

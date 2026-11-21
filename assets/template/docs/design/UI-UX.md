# 新游戏（`new-game`）UI 与 UX 交互设计文档

> 本文档定义 `新游戏` 的界面状态机、信息配额与交互动效规范。严禁未经设计直接堆砌说明文字、规则弹窗或多余按钮。

## 1. 界面流转状态机（`UI_PHASES`）

`title`（首屏实时画面 + 开始） -> `playing`（边缘 HUD） <-> `choice`（升级/抉择卡） / `paused`（暂停） -> `result`（胜负结算 + 再来一局）

## 2. 防膨胀配额（Anti-Bloat Hard Limits）

| 检查项 | 设计上限 | 当前配置 |
| --- | --- | --- |
| 首屏行动按钮 `maxTitleButtons` | `<= 1` | `1` |
| 局内常驻按钮 `maxInGameButtons` | `<= 1`（图标键） | `1` |
| 结算层按钮 `maxResultButtons` | `<= 2` | `2` |
| 边缘 HUD 遮挡占比 `hudMaxAreaRatio` | `<= 10%` | `10%` |
| 抉择卡数量 `cardChoices` | `<= 4` | `3` |
| HUD 指标 `hudMetrics` | `<= 5`（图标 + 数字） | `hp, score, wave` |

- **零句原则**：界面禁用整句描述与教程弹窗，信息统一以「图标 + 数字」或 `2~4` 字短标签呈现。
- **弹窗隔离**：打开 `#hg-title`、`#levelup`、`#gameover` 任一浮层时，自动隐藏底层边缘 HUD 数值与按钮。
- **调试面板**：`#debug` 默认 `hidden`，仅通过键盘 `\`` 键或 `?debug=1` 呼出。

## 3. 输入映射与 UX 动效

- **PC 键鼠**：P1 统一 `WASD` 移动 + `J K L U I O` 技能/确认，`Esc` 暂停。
- **移动端触屏**：通过 `createTouchControls({ mode: 'touch-only' })` 仅在触屏操作时无侵入呼出。
- **触感反馈**：由 `bindUiUxDOM`（主题 `scifi`）统一驱动 3D 卡片悬停倾斜、残影血条（`data-ui-bar`）、弹簧跳数（`data-ui-metric`）与交互音效。

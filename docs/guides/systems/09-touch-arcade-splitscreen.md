# 4.9 手机触屏优先 + 虚拟摇杆/技能键 + PC 双人分屏标准（必读）

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/platform/input.js`、`vendor/hgame/integrations/touch-controls.js`
- **设计原则**：默认以**触屏直接操作为主**（使用 `app.input.pointers`、`isPointerDown`、`wasPointerPressed`），平时不在桌面端硬塞满屏虚拟按钮。只有当玩法确实需要摇杆或技能键时，统一接入 `HGame.createArcadeControls` + `createTouchControls`：

| 玩家 | 移动（摇杆 ↔ 键盘） | 6 个主技能键（尽量在这 6 键内完成玩法） | 额外备用键（默认不启用，仅操作过多时开启） |
|---|---|---|---|
| **P1（玩家 1）** | 左手虚拟摇杆 ↔ `W A S D` | `J` `K` `L` `U` `I` `O` | `Q` `E`（传 `extras` 或 `enableExtras: true` 开启） |
| **P2（分屏 `players: 2`）** | `↑` `↓` `←` `→` 方向键 | `1` `2` `3` `4` `5` `6`（同时兼容主键盘与小键盘） | `0` `.`（同时兼容主键盘与小键盘） |

```js
import { HGame } from '../vendor/hgame/index.js';
import { createTouchControls } from '../vendor/hgame/integrations/touch-controls.js';

const controls = HGame.createArcadeControls({
  input: app.input,
  players: 2, // 单人填 1，本地双人分屏填 2
  actions: [
    { name: 'attack', label: '攻击', slot: 'j' },
    { name: 'dash', label: '闪避', slot: 'k' },
    { name: 'skill1', label: '技能1', slot: 'l' },
  ],
  // 尽量在 j/k/l/u/i/o 内完成；只有按钮真的不够用时才传 extras 或 enableExtras: true：
  // extras: [{ name: 'bag', label: '背包', slot: 'q' }],
});

// 默认 mode: 'touch-only' 仅在触屏设备或触摸后自动显现虚拟摇杆与技能按钮
const touchHud = createTouchControls({ controls, container: document.body, mode: 'touch-only' });

// 分屏渲染视图划分（2D / WebGL2D / 3D 通用）：
const views = HGame.computeSplitScreenViews(2, { direction: 'auto', width: 960, height: 540, cameras: [cam1, cam2] });
renderer.setViews(views);

// fixedUpdate(dt) 中每帧同步：
controls.update(dt);
const { x, y } = controls.p1.move;
if (controls.p1.consumeBuffered('attack')) { /* P1 攻击（含输入缓冲） */ }
if (controls.p2?.wasPressed('dash')) { /* P2 闪避 */ }
```

# 4.3 2D 精灵、算法地面阴影、图集切帧与 A* 寻路

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/canvas2d.js`、`vendor/hgame/animation/spritesheet.js`、`vendor/hgame/animation/player.js`、`vendor/hgame/world/tilemap.js`
- **何时用**：常规 2D 游戏。`Sprite2D` 原生支持 `groundShadow: true`（即使玩家角色跳起、摇晃或做 `offsetY` 补间，地面阴影始终贴合实体逻辑底座，不浮空）、`hitFlash(0.08)`（全剪影闪白）、`Camera2D` 平滑跟随/死区/边界/震屏与视野剔除；`SpriteSheet.fromGrid` 自动适配 `2x2`/`3x3` 切图；`findGridPath` 提供带防穿墙角保护的 A* 寻路。

```js
import { createCanvas2DAdapter, Camera2D, Sprite2D } from '../vendor/hgame/integrations/canvas2d.js';
import { SpriteSheet } from '../vendor/hgame/animation/spritesheet.js';
import { AnimationPlayer } from '../vendor/hgame/animation/player.js';
import { TileMap, findGridPath } from '../vendor/hgame/world/tilemap.js';

const sheet = SpriteSheet.fromGrid(actorImg, { columns: 3, rows: 3, inset: 1 });
const anim = new AnimationPlayer({ clips: { walk: { frames: [0, 1, 2], fps: 8, loop: true } }, initial: 'walk' });
hero.addComponent(new Sprite2D({ sheet, animation: anim, width: 64, height: 64, groundShadow: true, ySort: true }));
sprite.hitFlash(0.08, '#ffffff');
```

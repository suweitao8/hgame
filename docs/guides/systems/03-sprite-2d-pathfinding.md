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

## 混排、裁剪与混合

Canvas2D 和 WebGL2D 先按 `layer` 排序，再比较 `z`。同层同 `z` 的队列里，只要有一项启用 `ySort`，这一组就统一按世界 Y 从小到大绘制。Y 相同时保留采集顺序，未启用深度排序的整组也保留采集顺序。普通精灵、文字、批绘群体与逐实例深度群体都使用这套规则。绑定 CPU 或 GPU 仿真的群体以整批的世界 Y 参与排序。

在 `Sprite2D` 或 `SpriteCrowd2D` 上设置 `blendMode: 'normal'` 或 `'add'`。可选的 `clipRect` 是相对于当前视口的归一化矩形，左上角为 `(0, 0)`，右下角为 `(1, 1)`。分屏时每个视口各自解释矩形。超出视口的部分在边界截断，零面积会隐藏绘制，`clipRect: null` 取消额外裁剪。矩形由引擎保存为只读快照，更新时给属性赋新值。

```js
const vfx = new SpriteCrowd2D({
  layer: 2, z: 1, blendMode: 'add',
  clipRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
});
```

WebGL2D 保留排序结果，在混合或裁剪变化前提交已积累的实例。相邻数值相同的裁剪域共享状态。画面中间穿插其他状态时按原顺序分批绘制。 [Pixi 绘制组](../PIXI2D-STARTER.md#ordered-draw-groups)

## 2D 光照遮挡、法线材质与质量分级降级（R1）

`Sprite2D` 支持可选 `normalMap`、`normalStrength`（默认 `1`）与 `roughness`（默认 `0.8`）；`createCanvas2DAdapter` 与 `createWebGL2DAdapter` 统一暴露 `addOccluder2D`、`setOccluders2D`、`clearOccluders2D`（最多 `MAX_2D_OCCLUDERS = 32` 条线段遮挡阴影投射）、`setNormalLighting2D` 与 `getQualityPolicy2D`。通过 `setQuality('low' | 'medium' | 'high')` 显式应用 `QUALITY2D_LIGHTING_PRESETS` 保留策略：

- `high`：全开 `32` 盏点光源、遮挡软阴影（`occluderShadows` + `softShadows`）、法线受光、Bloom、色彩分级、暗角与受击脉冲。
- `medium`：上限 `16` 盏点光源、保留硬遮挡阴影与 Bloom/色彩分级，关闭软阴影与法线贴图。
- `low`：上限 `8` 盏点光源，保留环境光、暗角与受击脉冲，关闭遮挡阴影、法线贴图、Bloom 与色彩分级，并同步通知 `retainedEffects` 清单。


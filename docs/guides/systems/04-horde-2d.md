# 4.4 2D 万怪同屏（1,500–50,000+ 对象：WebGL2D + SpriteCrowd2D + SwarmSimulation）

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/webgl2d.js`、`vendor/hgame/world/spatial2d.js`、`vendor/hgame/world/swarm-ecs.js`
- **选型规则**：常规 2D（含万级以下同屏）默认用 PixiJS 8（`--preset 2d`、`--preset horde`，见 `PIXI2D-STARTER.md`）。自研 WebGL2D 适配器（`--renderer webgl2d`）只用于万级同屏实例化精灵，以及 Pixi 起始模板没有的 2D 光照与后处理（`post2d.js`）。内置的 `action-2d`、`horde-2d` 原型仍在 WebGL2D 栈上，迁移到 Pixi 登记为后续项。
- **分层选型**（WebGL2D 栈）：
  - `< 1,500` 个体：直接用标准 `Entity + Sprite2D`。
  - `1,500–15,000` 个体：`renderer: 'webgl2d'` + `SpriteCrowd2D` + `SpatialHash2D`。
  - `15,000–100,000` 集群模拟：`createSwarmSimulation`（1D 扁平链式哈希 `FlatSpatialHash2D` + `FlowField2D` 流场寻路 + 近身 `10m/12m` 滞回 `FlatCombatECS`），每帧 `sim.step(dt, { heroX, heroY })` 后 `sim.syncToSpriteCrowd2D(crowd)` 提交一次 WebGL2 实例化绘制。

```js
import { createSwarmSimulation } from '../vendor/hgame/index.js';
import { createWebGL2DAdapter, SpriteCrowd2D } from '../vendor/hgame/integrations/webgl2d.js';

const renderer = createWebGL2DAdapter({ canvas, width: 1280, height: 720, quality: 'high', maxBatchInstances: 65536 });
const swarmHost = scene.add(new Entity({ name: 'enemies' }));
const crowd = swarmHost.addComponent(new SpriteCrowd2D({
  capacity: 50000, sheet, width: 32, height: 32, groundShadow: true,
}));

const sim = createSwarmSimulation({ capacity: 50000, promoteRadius: 10, demoteRadius: 12 });
sim.spawnWave({ count: 30000, centerX: 0, centerY: 0, minRadius: 20, maxRadius: 95 });
// update(dt):
sim.step(dt, { heroX, heroY });
sim.syncToSpriteCrowd2D(crowd, { frameCount: 4 });
```

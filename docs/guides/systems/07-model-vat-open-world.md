# 4.7 3D 骨骼角色（GLB）、HalfFloat Bone-VAT 万怪同屏、世界对齐 PBR 与开放世界

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/model3d.js`、`vendor/hgame/world/swarm-ecs.js`、`vendor/hgame/integrations/world-aligned-material.js`、`vendor/hgame/world/open-world.js`
- **分层选型**：
  - `< 200` 主角 / Boss / 交互 NPC：使用 `createModel3DProvider` + `createAnimationBudgetAllocator`（完整骨骼树、挂点与动作混合）。
  - `200–15,000` 固定顶点群集：`createInstancedCrowd3D`（Float 顶点 VAT + 64B `instanceMatrix`）。
  - `15,000–100,000` 3D 类幸存者 / 战场万人同屏：`createBoneVatCrowd3D`（IEEE-754 Half-Float Bone-VAT + `16 Byte` `vec4 aCrowdPacked` 实例属性 + 距离 3 级 LOD：`LOD0` 4 骨骼 / `LOD1` 简化 1 骨骼 / `LOD2` 8 方位广告牌），搭配 `createSwarmSimulation`（`syncFromSwarm`）与离线烘焙工具 `npm run bake:vat -- hero.glb --out assets/hero.vat.bin`（`decodeBoneVatBinary` 零卡顿秒开）。

```js
import { createSwarmSimulation } from '../vendor/hgame/index.js';
import { createBoneVatCrowd3D, decodeBoneVatBinary } from '../vendor/hgame/integrations/model3d.js';
import { createWorldPartition, createFloatingOrigin } from '../vendor/hgame/world/open-world.js';

const vatData = decodeBoneVatBinary(await (await fetch('./assets/hero.vat.bin')).arrayBuffer());
const crowd = createBoneVatCrowd3D(THREE, { asset: heroAsset, vatData, capacity: 50000, lod1Distance: 25, lod2Distance: 80 });
world.add(crowd.group);

const sim = createSwarmSimulation({ capacity: 50000, promoteRadius: 10, demoteRadius: 12 });
// update(dt):
sim.step(dt, { heroX: player.x, heroY: player.z });
crowd.syncFromSwarm(sim, { camera: renderer.camera, culler: renderer.culler3d });

const origin = createFloatingOrigin({ threshold: 4096, snapGrid: 64 });
origin.registerScene(scene);
origin.registerWorldPalette(materialPalette);

const partition = createWorldPartition({
  cellSize: 128, loadRadius: 256, unloadRadius: 320, hlodRadius: 640,
  loadCell: async (cell) => { /* 加载区域实体 */ },
  unloadCell: (cell) => { /* 卸载区域实体 */ },
});
```

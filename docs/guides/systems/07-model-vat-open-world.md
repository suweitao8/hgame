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
  loadCell: async (cell, { signal }) => { /* 使用信号加载区域实体 */ },
  unloadCell: (cell, data) => { /* 释放对应加载结果 */ },
});
```

## 角色距离切换

需要在同一角色上切换骨骼、群体实例和代理时，从 `integrations/model3d.js` 导入 `createModelLod3D`。`near` 可用 `model3d.acquire(url, { signal })` 获取模型，再用 `cloneObject3DWithSkins` 克隆骨骼。`sync(state)` 应把当前变换和循环动画时间应用到克隆和 `AnimationMixer`，按片段时长归一化播放时间，首次调用时才挂到场景。`dispose()` 卸下对象、释放独立骨骼和动画绑定，并释放模型引用。远景工厂可直接使用 `createHLODProxyGroup3D`，同样在 `sync` 里挂载，并把代理的 `dispose` 交给控制器。

```js
const lod = createModelLod3D({
  near: loadSkeletalSlot,
  crowd: standaloneCrowd,
  far: () => {
    const proxy = createHLODProxyGroup3D(THREE, { proxies: actorProxyParts });
    return {
      sync({ x, y, z, rotationY }) {
        proxy.group.position.set(x, y, z);
        proxy.group.rotation.y = rotationY;
        if (!proxy.group.parent) world.add(proxy.group);
      },
      dispose: proxy.dispose,
    };
  },
  crowdDistance: 25,
  farDistance: 80,
  signal: scene.activationSignal,
});

// 每次渲染更新。所有角色提交状态后，共享 crowd 更新一次。
lod.update(cameraDistance, { x, y, z, rotationY, clip, time });
standaloneCrowd.update(0, { camera });
```

三层共享同一坐标系，中景 Bone-VAT 使用群体配置的地平面高度。用于角色切换的群体通过 `update` 绘制，由控制器接管其角色槽位。玩法、动画事件和时间推进仍由游戏逻辑负责。场景取消后再销毁共享群体。

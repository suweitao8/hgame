# 4.6 3D 后处理体积栈、遮挡剔除、GPU 实例化与 3D 弹簧臂相机

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/post3d.js`、`vendor/hgame/integrations/culling3d.js`、`vendor/hgame/integrations/camera3d.js`
- **何时用**：需要按区域渐变曝光/白平衡/Bloom/SSGI/SSR 用 `createPostProcessVolumeStack` + `renderer.setPostVolumes(stack)`；需要 Unity 风格视锥剔除、凸锥软件 AABB 遮挡或 WebGL2 硬件异步遮挡与千级静态/动态同模型合批用 `createInstancedBatch3D` / `culler3d`；第三人称/第一人称/俯视角丝滑防穿墙相机用 `createCameraRig3D` 或 `createSpringArm3D`。

```js
import { createPostProcessVolumeStack } from '../vendor/hgame/integrations/post3d.js';
import { createInstancedBatch3D } from '../vendor/hgame/integrations/culling3d.js';
import { createCameraRig3D } from '../vendor/hgame/integrations/camera3d.js';

const volumes = createPostProcessVolumeStack([
  { id: 'global', unbound: true, priority: 0, settings: { exposure: 1.1, whiteTemp: 6500, ssgiIntensity: 0.5 } },
  { id: 'cave', shape: 'box', center: [30, 2, 0], extents: [12, 6, 12], blendRadius: 4, priority: 10, settings: { exposure: 0.75, bloomIntensity: 0.35 } },
]);
renderer.setPostVolumes(volumes);

const camRig = createCameraRig3D({ THREE, camera: renderer.camera, mode: 'thirdPerson' });
const props = createInstancedBatch3D(THREE, { geometry: boxGeo, material: rockMat, capacity: 2048 });
```

## 易错点:SpringArm3D 与物理射线 / AABB 碰撞 / 阴影视锥拟合
- `createSpringArm3D({ collisionTest })` 的 `collisionTest(pivot, desired, backVec, length, radius)` 可返回 `{ hit, distance }`、`{ distance }`、`{ toi }` 或数值。
- 若接 Rapier 物理世界，可用内置零 GC 适配器 `createSpringArmRayProbe((o, d, max) => world.castRay(o, d, max))`（自动跳过非正 `maxDistance`）。
- 若关卡只有静态方块障碍数组，无需物理世界即可直接用 `createBoxCollisionTest(boxes, { inflateByProbe })`（支持 `{ minX..maxZ }`、`{ x, y, z, hx, hy, hz }` 与落地柱 `{ x, z, hx, hz, h, y? }`）。
- 方向光阴影边界拟合请直接调用 `renderer.fitShadowToPreset(sunLight, targetPos, options)`，自动按当前画质预设的 `shadowDistance` 与贴图分辨率进行 texel-snapped 拟合。

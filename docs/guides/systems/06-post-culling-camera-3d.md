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

## 易错点:SpringArm3D 与物理射线
- `createSpringArm3D({ collisionTest })` 的 `collisionTest(pivot, desired, backVec, length, radius)` 必须返回 `{ distance }`。
- 物理世界的 `castRay` 返回 `timeOfImpact` 且 `maxDistance` 为负会抛错;需自行适配:调用 `castRay(pivot, backVec, length)`,把 `timeOfImpact` 作为 `distance`(未命中返回 `{ distance: length }`)。

# 4.5 3D 渲染、UE 电影级色调、程序化天空与 MegaLights 多光源

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/three.js`、`vendor/hgame/integrations/sky3d.js`、`vendor/hgame/integrations/lighting3d.js`
- **何时用**：3D 场景默认采用统一单一曝光管线（`three.js` + `sky3d` + `post3d` 不重复色调映射）。需要电影级 S 曲线时设 `toneMapping: 'ueFilmic'`；需要动态昼夜天空与 PMREM 环境反射用 `createProceduralSky3D` + `renderer.setSky(sky)`；需要同屏 1–1024 盏动态点光/聚光/瞬态火光而不卡顿重编译着色器时用 `createMegaLights3D`；需要间接光照体素采样用 `createIrradianceProbeVolume3D`。

```js
import { createProceduralSky3D, SKY3D_PRESETS } from '../vendor/hgame/integrations/sky3d.js';
import { createMegaLights3D } from '../vendor/hgame/integrations/lighting3d.js';

const sky = createProceduralSky3D(THREE, { ...SKY3D_PRESETS.day });
world.add(sky.mesh);
renderer.setSky(sky);
sky.bakeEnvironment(renderer.renderer, { targetScene: world });

const mega = createMegaLights3D(THREE, { maxLights: 256, samplesPerPixel: 3 });
mega.flash({ x: 2, y: 1.5, z: 0, color: 0xff9944, intensity: 8, range: 12, duration: 0.15 });
```

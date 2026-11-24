# HGame 粒子特效架构与制作管线指南

本指南总结 HGame 现有粒子特效运行时分层、Uber Shader 数据总线设计，以及两条高效生产工作流（Unity Prefab 一键转包 / 手写与 AI 声明式编写）。

---

## 1. 运行时架构分层

HGame 特效运行时位于 `assets/runtime/vfx/`，通过统一门面 `createVfxSystem()` 对外暴露，按职责分为 6 层：

1. **配方与编排层 (`vfx-recipes.js`)**
   - 解析声明式 `.vfx.json`（支持多图层、子发射器、延时/循环、Shuriken Shape/Burst/CustomData/Size/Color 曲线、`defineVfxRecipe` 校验与默认值补全、`loadVfxPack` 一键载入资源包，以及 `simulation: 'gpu'` / `turbulence` / `attractor` 自动路由）。
2. **有状态 GPU MRT 粒子池 (`vfx-gpu-particles.js`)**
   - 对标 Unity VFX Graph 的 WebGL2 双附件（`RGBA32F` / `RGBA16F`）Ping-Pong FBO 引擎（上限 `262,144` 粒子）：在 GPU 显存内闭环计算 3D Curl Noise 旋度湍流、Attractor/Vortex 力场、指数阻力、地面与屏幕深度图碰撞，配合顶点 `texelFetch` 零拷贝实例化合批与懒分配/空闲休眠（支持 `vfx.emitGpuParticles`、`vfx.setGpuField`）。
3. **GPU 实例化广告牌粒子池 (`vfx-atlas-particles.js`)**
   - Zero-GC RingBuffer + Instanced Quad，按混合模式分桶（`normal / additive / multiply / premultiply / distortion`）与 `Opaque` 路径合批，内置 Curve LUT（颜色/尺寸/速度曲线采样，WebGL2 2D 支持版本号脏行增量上传）。
4. **3D 网格粒子池 (`vfx-mesh.js`)**
   - 支持 `.glb` 多子网格（`__sub_<name>` 匹配与 `m_Mesh / m_Mesh1..3` 权重随机）、`m_Pivot` 偏移（`position + aInstPivot.xyz`）、镜像负缩放与奇次反射背面剔除纠正（`effFrontFacing`）、局部/世界空间变换。
5. **刀光、闪电与粒子拖尾 (`vfx-trails.js`)**
   - 支持 `slashArc`、`lightningBolt`、粒子追踪 Ribbon Trail 与点光辅助，共享 `VFX_UBER_FRAGMENT_GLSL` 材质求解。
6. **共享 Shader 与材料查找表 (`vfx-shader-chunks.js`, `vfx-shuriken-kernel.js`, `vfx-shader-profiles.js`)**
   - 提供 `VFX_COMMON_GLSL`、`VFX_UBER_LUT_GLSL`、`VFX_UBER_FRAGMENT_GLSL` 与紧凑活跃索引 Shuriken 内核 / 可插拔 ShaderProfile，保证粒子、网格、拖尾三端视觉一致。

---

## 2. Shader 与材质 LUT 优化要点

- **32×1024 RGBA32F Uber Material LUT**：最多容纳 `UBER_MAT_LUT_ROWS = 1024` 种独立材质配置，`createUberMaterialLut` 内建行级脏检查（内容未变时不置 `texture.needsUpdate = true`，避免无谓 GPU 纹理上传）。
- **Flag 门控惰性采样（Lazy LUT Fetch）**：`vfxEvalUberFragment`、`vfxEvalPilotoWarpFragment` 与 `vfxEvalPbrFxFragment` 先读取 Row 0 (`hdr`) 与 Row 31 (`meta31.w` 纹理掩码)，仅在对应开关激活时读取贴图 Rect/ST、Pan、Dissolve、Ramp 与 Fresnel 参数，常规发光/烟雾粒子每像素 LUT 采样从二十余次降至数次。
- **统一输出混合尾函数 `vfxFinalizeOutput`**：集中处理 `Opaque`、`Multiply`、`Premultiply` 与 `Additive HDR`（亮度溢出处 `boost = min(peak, 1.0 / outA)` 压色提透明），粒子、3D 网格与拖尾三端共用零分叉，避免后期调光各自漂移。
- **贴图与颜色空间铁律**：
  - Flipbook 序列帧格栅按从上到下切片，UV 在采样前统一执行 `topDownUv` 翻转；
  - `AlphaClip` 不透明粒子在 Unity `Surface=0` 时保持 `opaque: true` 与 `alphaTest`，不走半透丢弃深度；
  - Atlas 需带 4px 边缘外扩（edge bleed），避免双线性过滤在图块边缘采到透明黑边。

---

## 3. 工作流 A：Unity ParticleSystem 一键导入与热验证

适用于复用 Piloto Studio 或外部 Unity VFX 资源：

1. **一键增量打包**：
   ```bash
   npm run vfx:pack -- --unity-root "D:/UnityWorkspace/AssetTest/Assets/Piloto Studio" --prefab "Super Realistic FX Bundle/ARPG Realistic Bonemist/BonesSpikes.prefab" --out ./assets/vfx_pack
   ```
   - 也可用 `--dir <子目录>` 批量递归导出整套 `.prefab`；
   - 自动去重并打包 `atlas.png` + `atlas_regions.json`；
   - `.asset` 网格走纯 JS 反量化导出 `.glb`，`.fbx` 自动调用无头 Blender 并保留全部子网格名称；
   - 自带基于源文件路径与 mtime 的增量缓存（传 `--force` 可全量重编），并生成 `vfx-pack.manifest.json`。

2. **运行时一行加载注册**：
   ```js
   import { createVfxSystem, loadVfxPack } from './vendor/hgame/vfx/index.js';

   const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
   await loadVfxPack(vfx, './assets/vfx_pack/vfx-pack.manifest.json', { THREE, gltfLoader });
   vfx.playEffect('bones_spikes', { x: 0, y: 0, z: 0 });
   ```
   - `loadVfxPack` 自动完成 Atlas 挂载、`__sub_` 子网格按名抽取与所有 `.vfx.json` 配方注册，无需再手动编写资源收集或加载样板代码。

3. **保真度评估与实机验收**：
   - 运行 `npm run vfx:score` 对目标 Prefab 做定量保真度评分；
   - 通过 WebAsset (`http://127.0.0.1:4175`) 打开场景做无头截图与 Console/WebGL 零报错校验。

---

## 4. 工作流 B：手写 / AI 快速制作原创粒子

针对游戏原创技能或高频轻量复用，推荐使用 `createUberMaterialSpec` 与 `defineVfxRecipe`，避免手写几十个底层开关：

- **内置材质预设 (`VFX_MATERIAL_PRESETS`)**：
  - `'glow'`：叠加发光（Additive + SoftAlpha）
  - `'smoke'`：柔和烟尘（Alpha + 轻度去饱和 + 软粒子淡出）
  - `'dissolve'`：细节噪声侵蚀溶解（由 `custom1.y` 驱动溶解进度）
  - `'ribbon'`：双面预乘拖尾（Premultiply + DoubleSided）
  - `'warp'`：屏幕折射热浪（Piloto Warp，自动参与单 Pass 折射拷贝）
  - `'pbr'`：带法线/ORM/自发光/溶解的 3D 网格粒子材质（如骨刺、血晶）

```js
import { createUberMaterialSpec, defineVfxRecipe } from './vendor/hgame/vfx/index.js';

const fireHit = defineVfxRecipe({
  id: 'fire_slash_hit',
  duration: 0.6,
  layers: [
    {
      name: 'flash_core',
      region: 'spark_radial',
      bursts: [{ time: 0, count: 1 }],
      size: [1.4, 2.2],
      lifetime: 0.22,
      uberMat: createUberMaterialSpec('glow', {
        mainTexKey: 'spark_radial',
        whiteColor: [4, 2.2, 0.8, 1],
      }),
    },
    {
      name: 'ember_smoke',
      region: 'smoke_puff',
      rateOverTime: 24,
      lifetime: [0.35, 0.55],
      uberMat: 'smoke', // 也可直接填预设名字符串
    },
  ],
});

vfx.registerEffect(fireHit);
```

---

## 4.5 GPU 粒子与移动端 / 小游戏（btoy / 微信 / 抖音）TBDR 优化

对百万级爆发、Curl Noise 涡流、力场吸引与地表/深度碰撞，可在 `.vfx.json` 图层配置 `simulation: 'gpu'` 或直接调用 `vfx.gpuParticles` / `createGpuParticleSystem({ precision: 'auto' })`（WebGL2 MRT Ping-Pong，Canvas2D 自动降级）：

- **精度与默认上限自适应**：检测到手机端或小游戏环境（`isMobileOrMiniGameEnv()`，含 `wx`/`tt`/`my` 小游戏与移动端 UA/触控）时，`gpuParticles` 默认启用 `RGBA16F`（`HalfFloatType`）半精度 Ping-Pong 缓冲（显存与带宽减半，初始纹理保持 `RGBA32F` 保障精确位打包），默认粒子上限收束为 `16384`（桌面 `65536`），可通过 `precision: 'fp16'|'fp32'|'auto'` 与 `maxParticles` 显式覆盖。
- **TBDR Tile 与像素填充优化**：2D/3D 粒子网格改用切角八边形（`CHAMFERED_OCTAGON_TRIS_2D` / `createChamferedOctagonGeometry`，约减少 17% 透明角过绘制）；非深度写入透明粒子片元着色器移除 `discard` 以保留移动端 Early-Z / HSR；`gpuParticles` 通过 `uBaseInstance` + `256`-slot 硬件 `scissor` 行裁剪跳过已死亡区块。
- **零闲置 DrawCall 与画质降级**：全量 VFX 子系统（含 `gpuParticles`、`particles`、`atlasParticles`、`trails`、`telegraphs`、`floatingText`、`screenFeedback`）空闲及过期后自动置为 `visible = false` / `instanceCount = 0`；`vfx.setQualityTier('low'|'medium'|'high')` 同步缩放 GPU 爆发数量并关闭高开销特性。
- **无 DOM 离屏画布兼容**：程序化 Atlas 与伤害飘字图集烘焙统一走 `createOffscreen2dCanvas(w, h)`，依次适配 `document.createElement('canvas')`、`wx.createCanvas()`、`tt.createCanvas()` 与 `OffscreenCanvas`。

---

## 5. 交付前检查清单

- 修改特效 shader 或运行时后，执行：`npm run check` 与 `node tests/browser-vfx-material.mjs`；
- 变更 `assets/runtime/vfx/` 公开导出时同步更新类型与 API 索引：`npm run build:types && npm run build:api-index`；
- 涉及多子网格 FBX（如 `Bones_1.fbx`），确认导入日志与 manifest `aliases` 中均包含精确的 `__sub_<name>` 映射。

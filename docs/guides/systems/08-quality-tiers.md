# 4.8 低 / 中 / 高三档画质统一调节（2D & 3D）

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/integrations/quality3d.js`、各渲染器 `setQuality(...)`
- **何时用**：设置界面或性能自适应需要提供 **低 / 中 / 高** 三档画质（`low` / `medium` / `high`，3D 额外兼容 `ultra` 与 `auto` 自动升降档）时直接调用。`Canvas2D` / `WebGL2D` 会同步切换像素比、`groundShadows`、抗锯齿平滑与闪白精度；`ThreeAdapter` 会同步切换分辨率预算、阴影贴图、后处理 Pass、各向异性过滤、动画 LOD 与 MegaLights 采样预算。

```js
// 2D（Canvas2DAdapter / WebGL2DAdapter）或 3D（ThreeAdapter）统一调用：
renderer.setQuality('low');    // 低画质（关闭 2D 地面阴影/低像素比，3D 关闭实时阴影与重后处理）
renderer.setQuality('medium'); // 中画质
renderer.setQuality('high');   // 高画质
```

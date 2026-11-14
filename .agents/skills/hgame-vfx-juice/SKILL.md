---
name: hgame-vfx-juice
description: Zero-GC native VFX, hitstop, camera shake, SDF telegraphs, procedural slash/lightning trails, and GPU floating damage text for 2D/3D HGame projects.
---

# HGame VFX & Game-Feel (`createVfxSystem`)

Always use the engine-native `createVfxSystem` (`vendor/hgame/vfx/index.js` or `vendor/hgame/index.js`) instead of hand-rolled particle arrays, `material.clone()`, external VFX PNG sheets, or DOM floating damage numbers.

## 1. Initialization

```js
import { createVfxSystem, VFX_SHAPE, CROWD_STATUS } from '../vendor/hgame/index.js';

const vfx = createVfxSystem({
  mode: '3d', // '3d' | 'webgl2d' | 'canvas2d' | 'headless'
  sceneOrAdapter: scene3d,
  maxParticles: 65536,
  maxFloatingGlyphs: 16384,
  seed: 20261115,
});
```

## 2. Main Loop Integration

```js
const { visualDt, cameraOffset } = vfx.update(rawDt);
// Apply visualDt to VFX/animation interpolation only; keep fixed-step physics/lockstep untouched.
// Apply cameraOffset.{x, y, z, roll} to your camera rig.
```

For `canvas2d` / `webgl2d`, call `vfx.render(ctxOrCamera, width, height)` at the end of your render pass.

## 3. Common Recipes

- **Combined Hit Impact**: `vfx.emitHitImpact({ x, y, z, damage, isCrit, dirX, dirZ, element: 'lightning' })`
- **Burst Particles**: `vfx.burstParticles('fire')` or `vfx.burstParticles({ x, y, z, count: 16, shape: VFX_SHAPE.HIT_SPARK, color: 0xffd166 })`
- **Slash & Lightning**: `vfx.slashArc({ x, y, z, yawRad, sweepRad: 2.1, radius: 2.6 })`, `vfx.lightningBolt({ x0, y0, z0, x1, y1, z1 })`
- **Telegraphs & Shrink Zone**: `vfx.spawnTelegraph({ shape: 'sector', x, z, yawRad, radius: 6, angleRad: 1.2, duration: 1.1 })`, `vfx.setShrinkZone({ centerX: 0, centerZ: 0, safeRadius: 42 })`
- **Floating Numbers (Zero String Alloc)**: `vfx.popupNumber({ x, y, z, value: 1280, isCrit: true })`
- **Crowd Hit-Flash & Status Tint**: set `swarm.statusCode[id] = CROWD_STATUS.FROZEN` (or `FLASH_92` / `POISON` / `BURN`) without cloning materials.

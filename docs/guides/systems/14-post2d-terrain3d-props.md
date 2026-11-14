# 4.14 2D Lighting/Post (`post2d`), 3D Terrain (`terrain3d`) & Props (`procedural-models`)

> Zero-asset world lighting, procedural FBM terrain with Rapier heightfield physics, and 17 procedural 3D PBR shapes.

- **Files**: `integrations/post2d.js`, `world/terrain3d.js`, `integrations/procedural-models.js`
- **When**: 2D dark dungeons/bloom (`canvas2d` & `webgl2d`), 3D hills/islands with matched physics, zero-GLB 3D environments.

```js
// 2D Lighting & Post (identical API on createCanvas2DAdapter and createWebGL2DAdapter)
renderer.setAmbientLight('#1d2842', 0.75);
const torch = renderer.addLight2D({ x: 120, y: 80, radius: 180, color: '#ffae42', intensity: 1.2 });
renderer.setPost2D({ bloomIntensity: 0.35, vignette: 0.25, hitPulse: 0 });
renderer.clearLights2D(); // bypasses post pass completely when clear

// 3D Terrain + Rapier heightfield + deterministic scatter
import { createHeightfieldTerrain3D } from '../vendor/hgame/world/terrain3d.js';
const terrain = createHeightfieldTerrain3D({ width: 120, depth: 120, segmentsX: 48, segmentsZ: 48, edgeFalloff: 'island' });
world.add(terrain.createMesh(THREE).mesh);
terrain.attachPhysics(scene.physics); // exact heightfield collider parity
const trees = terrain.scatterPositions({ count: 40, minSpacing: 4, maxSlope: 0.22 });
```

## Procedural Shapes (17 built-in)
`box`, `slab`, `stair`, `column`, `foliage`, `fence`, `door`, `window`, `bench`, `lantern`, `arch`, `crate`, `barrel`, `crystal`, `rock`, `pine`, `turret` (`createProceduralModelSlots`).

## Pitfalls
- Pass `scene.physics` (with `physics3d` feature active) to `terrain.attachPhysics(scene.physics)`; `world/terrain3d.js` never statically bundles Rapier WASM.
- Call `renderer.clearLights2D()` / `setPost2D({ bloomIntensity: 0, vignette: 0, hitPulse: 0, saturation: 1, contrast: 1 })` if disabling post-processing mid-game to restore zero-overhead bypass.

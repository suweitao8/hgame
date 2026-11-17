# PixiJS 2D starter

Create a self-contained HGame project with `node scripts/create-game.mjs <new-game-dir> --preset 2d --name "My game"` (or `--preset pixi2d`). PixiJS is the default for new 2D projects, including `--profile 2d`; add `--bare` for an empty scene. An explicit `--renderer webgl2d` or `--renderer canvas2d` selects the legacy renderer. Existing games are not migrated. The generated project already contains its compiled PixiJS assets and HGame runtime, so it can be opened through WebAsset without installing dependencies. The initial arena uses procedural artwork; no external images are needed.

For changes, edit `src/sim/` for rules, `src/ui/` for DOM HUD, and use the interfaces in `src/engine/` for rendering, input, audio, and effects. Install the locked dependencies with `npm ci`, then run `npm run build:pixi` in the game directory. The command builds from `index.source.html` and updates the playable root entry and emitted JavaScript. `.hgame-pixi-build.json` records generated bundle hashes so later builds remove only unchanged, obsolete generated files; authored or modified assets are preserved. Package releases with the existing `npm run package:toy` workflow, which includes the PixiJS, pixi-filters and GSAP license notices when present.

PixiJS prefers WebGPU when available and falls back to WebGL. HGame's application controls the simulation and render loop; `JuiceSystem.update(dt)` advances hit easing, shockwaves and particles on that loop. Call `juice.dispose()` before `renderer.dispose()` when tearing down an owning scene. The renderer reuses removed crowd particles and destroys its pooled sprites, filter and atlas on disposal. The starter's 1,000-enemy arena includes opt-in buttons to add 10,000 enemies and to trigger 100, 1,000, or 10,000 simultaneous eight-particle explosions; FPS and on-screen particles are displayed in the debug panel. Actual capacity depends on device, resolution, effects and workload.

To replace the procedural characters with images, provide `assets/actors/player.png` and `assets/actors/enemy.png` and add `<meta name="hgame-character-images" content="true">` to `index.source.html` before rebuilding. Both images are baked into the shared runtime atlas. Keep artwork and usage rights appropriate for your project.

For games using HGame's `assets/catalog.json`, `createCatalogGameAtlas(catalog, frames, options)` loads image IDs through a temporary catalog scope and bakes them into the same Pixi texture source. The scope releases decoded images after baking; the returned atlas is owned by the renderer and released when the renderer is disposed. Specify `player_hero`, `enemy_chaser`, or `enemy_elite` to replace built-in characters, or any other unused name for an additional frame:

```js
import { createCatalogGameAtlas } from './engine/ProceduralAtlas.js';
import { Renderer2D } from './engine/Renderer2D.js';

// `catalog` is a createAssetCatalog(...) instance owned by the game/scene.
const atlas = await createCatalogGameAtlas(catalog, [
  { name: 'player_hero', asset: 'hero' },
  { name: 'sword', asset: 'weapon.sword', width: 96, height: 96 },
], { size: 2048 });
const renderer = new Renderer2D(atlas);
```

Catalog entries must have `kind: "image"`; extra frames use the image dimensions unless `width` and `height` are supplied. Frames get a `_white` silhouette by default; set `makeWhite: false` to omit it. The atlas has a fixed size and reports overflow instead of silently dropping a frame. `options.signal` can cancel loading. The built-in character slots retain their fixed atlas dimensions.

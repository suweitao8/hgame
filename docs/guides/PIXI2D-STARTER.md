# PixiJS 2D starter

Create a self-contained HGame project with `node scripts/create-game.mjs <new-game-dir> --preset 2d --name "My game"` (or `--preset pixi2d`). PixiJS is the default for new 2D projects, including `--profile 2d`; add `--bare` for an empty scene. An explicit `--renderer webgl2d` or `--renderer canvas2d` selects the legacy renderer. Existing games are not migrated. The generated project already contains its compiled PixiJS assets and HGame runtime, so it can be opened through WebAsset without installing dependencies. The initial arena uses procedural artwork; no external images are needed.

For changes, edit `src/sim/` for rules, `src/ui/` for DOM HUD, and use the interfaces in `src/engine/` for rendering, input, audio, and effects. Install the locked dependencies with `npm ci`, then run `npm run build:pixi` in the game directory. The command builds from `index.source.html` and updates the playable root entry and emitted JavaScript. `.hgame-pixi-build.json` records generated bundle hashes so later builds remove only unchanged, obsolete generated files; authored or modified assets are preserved. Package releases with the existing `npm run package:toy` workflow, which includes the PixiJS, pixi-filters and GSAP license notices when present.

PixiJS prefers WebGPU when available and falls back to WebGL. HGame's application controls the simulation and render loop; `JuiceSystem.update(dt)` advances hit easing, shockwaves and particles on that loop. Call `juice.dispose()` before `renderer.dispose()` when tearing down an owning scene. The renderer reuses removed crowd particles and destroys its pooled sprites, filter and atlas on disposal. The starter's 1,000-enemy arena includes opt-in buttons to add 10,000 enemies and to trigger 100, 1,000, or 10,000 simultaneous eight-particle explosions; FPS and on-screen particles are displayed in the debug panel. Actual capacity depends on device, resolution, effects and workload.

`new Renderer2D(atlas, { maxPixels, maxPixelRatio })` caps physical rendering resolution without changing CSS coordinates. Defaults are 2.3 million pixels and pixel ratio 2; lower them for fill-rate-constrained devices or increase them for sharper output. The renderer responds to its container's size and host resize events, and disconnects its observer on disposal. This is a fixed budget, not automatic FPS-based quality adjustment.

New Pixi starters bind to the HGame host lifecycle and suspend the application while hidden; they resume only if visibility caused the pause. The demo also clears its independent keyboard and touch state on host focus loss or hiding, so a held input is not replayed when returning.

The demo passes `app.platform.audio` to `InputAndAudio`, so synthesized cues use HGame's shared context, mixer and limiter. The input helper owns neither the audio manager nor its context; it stops its own active cues on reset and leaves service disposal to the application.

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

For frame animation, use the existing HGame `SpriteSheet` and `AnimationPlayer`. A catalog entry can provide a `sheet` factory; its cells are baked as `prefix/0`, `prefix/1`, and so on, including matching white hit-flash frames:

```js
import { SpriteSheet } from '../vendor/hgame/animation/spritesheet.js';
import { AnimationPlayer } from '../vendor/hgame/animation/player.js';

const atlas = await createCatalogGameAtlas(catalog, [{
  name: 'hero_walk', asset: 'hero.walk_sheet', width: 64, height: 64,
  sheet: image => SpriteSheet.fromGrid(image, { columns: 4, rows: 2 }),
}], { size: 2048 });
const walk = new AnimationPlayer().define('walk', { frames: [0, 1, 2, 3], fps: 8 }).play('walk');
// fixedUpdate(dt): walk.update(dt);
// update(): renderer.syncEntity('hero', { x, y, tex: `hero_walk/${walk.frame}` });
// On scene exit: walk.dispose(); renderer.dispose();
```

For an already decoded image, `atlas.registerSheet('hero_walk', sheet, options)` returns the generated frame names before `atlas.build()`. Supply integer output dimensions if a sheet uses fractional inset values. Packing checks the complete sheet before writing it, and reports duplicate names or overflow.

For larger CPU-simulated crowds, use the existing HGame `createSwarmSimulation` and a Pixi swarm layer. Call `swarm.step` in the scene's fixed update and synchronize once per visual update; no extra application loop or per-unit game objects are required:

`node scripts/create-game.mjs <new-game-dir> --preset horde` creates this combination with a configurable `src/swarm.json`. Add `--bare` for an empty Pixi scene, or `--renderer webgl2d` to retain the previous custom-renderer horde starter. Existing projects are not changed.

```js
const crowd = renderer.createSwarmLayer({ textures: ['enemy_chaser'], scale: 0.5 });
// fixedUpdate(dt): swarm.step(dt, { heroX, heroY });
// update(dt): renderer.update(dt); crowd.sync(swarm);
// On scene exit: crowd.dispose(); renderer disposal also releases attached layers.
```

The layer reads live IDs, positions, scale, rotation, clip IDs and hit-flash state from the CPU swarm. It uses Pixi `Particle` instances sharing the atlas, batches additions, and reuses particles as units enter or leave the view. `worldScale` scales simulation positions; `scale` scales sprites. Set `syncRotation`, `flipByDirection`, or `cull: false` when required. This adapter does not consume the GPU-only swarm texture and its per-frame CPU synchronization cost still depends on the number of active units.

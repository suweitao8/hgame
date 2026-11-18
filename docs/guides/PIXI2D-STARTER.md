# PixiJS 2D starter

Create a self-contained HGame project with `node scripts/create-game.mjs <new-game-dir> --preset 2d --name "My game"` (or `--preset pixi2d`). PixiJS is the default for new 2D projects, including `--profile 2d`; add `--bare` for an empty scene. An explicit `--renderer webgl2d` or `--renderer canvas2d` selects the legacy renderer. Existing games are not migrated. The generated project already contains its compiled PixiJS assets and HGame runtime, so it can be opened through WebAsset without installing dependencies. The initial arena uses procedural artwork; no external images are needed.

For changes, edit `src/sim/` for rules, `src/ui/` for DOM HUD, and use the interfaces in `src/engine/` for rendering, input, audio, and effects. Install the locked dependencies with `npm ci`, then run `npm run build:pixi` in the game directory. The command builds from `index.source.html` and updates the playable root entry and emitted JavaScript. `.hgame-pixi-build.json` records generated bundle hashes so later builds remove only unchanged, obsolete generated files; authored or modified assets are preserved. Package releases with the existing `npm run package:toy` workflow, which includes the PixiJS, pixi-filters and GSAP license notices when present.

From the HGame repository, `npm run api -- pixi`, `npm run api -- Renderer2D`, or `npm run api -- --module ProceduralAtlas` finds the generated Pixi starter interfaces alongside runtime APIs. Results marked `generated game` are copied into a new game under `src/engine/`; they are not `vendor/hgame` imports. Use `npm run api -- --recipe 2d` for the starter wiring.

PixiJS prefers WebGPU and retries with WebGL (then Pixi's Canvas renderer if needed) when WebGPU is unavailable or initialization fails. HGame's application controls the simulation and render loop; `JuiceSystem.update(dt)` advances hit easing, shockwaves and particles on that loop. Call `juice.dispose()` before `renderer.dispose()` when tearing down an owning scene. The renderer reuses removed crowd particles and destroys its pooled sprites, filter and atlas on disposal. The starter's 1,000-enemy arena includes opt-in buttons to add 10,000 enemies and to trigger 100, 1,000, or 10,000 simultaneous eight-particle explosions; FPS and on-screen particles are displayed in the debug panel. Actual capacity depends on device, resolution, effects and workload. Canvas uses a simple drawn slash and particles for shockwaves; GPU bloom and distortion filters are disabled on this fallback.

On the Canvas fallback, particles use their atlas frame colors instead of runtime `opts.color` tinting. The default explosion has precolored atlas frames; supply precolored frames for custom particle colors on that backend.

`new Renderer2D(atlas, { maxPixels, maxPixelRatio })` caps physical rendering resolution without changing CSS coordinates. Defaults are 2.3 million pixels and pixel ratio 2; lower them for fill-rate-constrained devices or increase them for sharper output. The renderer responds to its container's size and host resize events, and disconnects its observer on disposal. By default this is a fixed budget.

To opt into dynamic resolution, pass HGame's quality controller when creating the renderer:

```js
const { createAdaptiveQualityController } = await import(base + '/integrations/quality3d.js');
const quality = createAdaptiveQualityController({ mode: 'auto', minScale: 0.6, maxScale: 1 });
const renderer = new Renderer2D(atlas, { qualityController: quality });
// On visibility changes or after a manual pause: renderer.resetQualityMeasurements();
```

Pixi uses only the controller's dynamic resolution scale; 3D quality presets do not change Pixi materials or effects. The controller uses render-frame intervals, so it cannot distinguish GPU pressure from slow simulation or a browser-imposed frame cap. Changing resolution may not improve a CPU-bound scene. Call `resetQualityMeasurements()` after visibility changes or a manual pause, and call `renderer.resize()` after changing the controller's mode. For a fixed `tickHz: 0` scene, leave adaptive quality disabled.

After `await renderer.init(mount)`, use `renderer.setBloom({ enabled: true, threshold: 0.62, bloomScale: 0.4, brightness: 1, blur: 3 })` for persistent scene glow; all parameters except `enabled` are optional and retain their previous values. Call `renderer.setBloom({ enabled: false })` to disable persistent glow. Shockwaves temporarily use bloom as before and no longer cancel persistent glow when they end or when the juice system is disposed. Full-screen filters add GPU work, so use them according to the target scene and device.

New Pixi starters bind to the HGame host lifecycle and suspend the application while hidden; they resume only if visibility caused the pause. The demo reads keyboard state from HGame's input manager and clears its canvas pointer and touch state on host focus loss or hiding, so a held input is not replayed when returning.

The demo passes `app.platform.audio` and `app.input` to `InputAndAudio`, so keyboard state and synthesized cues use HGame's shared services. The input helper owns neither service; it unsubscribes and stops its own active cues on disposal.

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

The atlas copies frame edges into one pixel of the existing padding to reduce transparent seams from linear texture sampling. This adds canvas work while the atlas is built; it does not increase the allocated atlas dimensions.

`renderer.syncEntity(id, state)` creates a shadow only when `state.hasShadow !== false`; returned entries can therefore have `shadow: null`. If a frame has no `_white` silhouette, hit flash retains the base texture instead of substituting a white rectangle.

For tile-based maps, generate a 2D project with `--with tilemap2d`, bake tile images or sheet frames into the atlas, and connect the existing HGame `TileMap` to Pixi:

```js
const { TileMap, findGridPath } = await import(base + '/world/tilemap.js');
const map = new TileMap({ tiles: [[1, 1, 1], [1, 2, 1]], tileWidth: 32, tileHeight: 32, solid: [2] });
renderer.grid.visible = false;
const layer = renderer.createTilemapLayer(map, { frames: { 1: 'floor/0', 2: 'wall/0' }, chunkSize: 32 });
// layer.setTile(1, 1, 1); // updates map and the cached visual chunk
// layer.setTiles([{ x: 0, y: 0, value: 2 }, { x: 1, y: 0, value: 2 }]);
// findGridPath(map, { x: 0, y: 0 }, { x: 2, y: 1 });
// renderer.update(dt) updates chunk visibility; layer.dispose() releases it.
```

Map values absent from `frames` are transparent. All named frames must exist in the renderer's shared atlas. The layer creates static particle chunks as they enter the camera and retains up to `maxCachedChunks` chunks (default 128), evicting the least recently visible off-screen chunks. If the camera sees more than the limit, all visible chunks remain loaded. The underlying `TileMap` still holds the entire grid in memory. `setTile` updates one cell, reusing its particle when swapping between atlas frames. `setTiles` validates coordinates first and refreshes each affected cached particle container once. If the map is changed directly, call `refreshTile` for each affected chunk. An uncached chunk reads the latest data when it next appears. The `TileMap` governs collision and pathfinding. The renderer also disposes its tilemap layers on shutdown.

Use `{ layer: 'foreground' }` for a separate map drawn in front of all character and enemy sprites but behind trails and particles. The default is `'background'`, behind shadows and characters. These are whole-layer ordering choices, not automatic per-tile Y sorting; split art into background and foreground maps when needed.

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

In `src/swarm.json`, `capacity` limits total swarm units, `ecsSlots` limits simultaneously promoted combat units, `maxHitEvents` limits hits queued before the next simulation step, and `maxPatchesPerStep` limits combat-state patches flushed in one step. These budgets are independent: a 10,000-unit swarm does not imply 10,000 combat slots or successful hits. Increase them according to the game's workload and memory budget; `applyCircleDamage` returns the number of accepted hit events when either queue or combat slots are saturated.

```js
const crowd = renderer.createSwarmLayer({ textures: ['enemy_chaser'], scale: 0.5 });
// fixedUpdate(dt): swarm.step(dt, { heroX, heroY });
// update(dt): renderer.update(dt); crowd.sync(swarm);
// On scene exit: crowd.dispose(); renderer disposal also releases attached layers.
```

The layer reads live IDs, positions, scale, rotation, clip IDs and hit-flash state from the CPU swarm. It uses Pixi `Particle` instances sharing the atlas, batches additions, and reuses particles as units enter or leave the view. `worldScale` scales simulation positions; `scale` scales sprites. Set `syncRotation`, `flipByDirection`, or `cull: false` when required. This adapter does not consume the GPU-only swarm texture and its per-frame CPU synchronization cost still depends on the number of active units.

For animated crowds, bake sprite sheets into the same atlas and pass `clips` instead of `textures`:

```js
const crowd = renderer.createSwarmLayer({
  clips: [
    { frames: ['walk/0', 'walk/1', 'walk/2', 'walk/3'], fps: 8 },
    { frames: ['attack/0', 'attack/1', 'attack/2'], fps: 12, loop: false },
  ],
});
```

The swarm's `animClip[id]` selects the clip and `animTime[id]` selects its frame in seconds; time is owned by the simulation and is not reset automatically when the clip changes. For an unpromoted swarm unit, set `swarm.animTime[id] = 0` when switching clips if playback should restart. Units promoted into the combat ECS can have their clip overwritten by ECS synchronization; coordinate changes with the ECS. White hit-flash frames are used when available. Animated clips keep the same shared-atlas particle rendering and off-screen culling as static crowds.

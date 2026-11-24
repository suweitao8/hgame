# PixiJS 2D starter

Create a self-contained HGame project with `node scripts/create-game.mjs <new-game-dir> --preset 2d --name "My game"` (or `--preset pixi2d`). PixiJS is the default for new 2D projects, including `--profile 2d`; add `--bare` for an empty scene. An explicit `--renderer webgl2d` selects the in-house WebGL2D renderer, which is meant only for 10k+ on-screen instanced sprites and for the 2D lighting and post effects that the Pixi starter does not include; `--renderer canvas2d` is its fallback. Existing games are not migrated. The generated project already contains its compiled PixiJS assets and HGame runtime, so it can be opened through WebAsset without installing dependencies. The initial arena uses procedural artwork; no external images are needed.

For changes, edit `src/sim/` for rules, `src/ui/` for DOM HUD, and use the interfaces in `src/engine/` for rendering, input, audio, and effects. Install the locked dependencies with `npm ci`, then run `npm run build:pixi` in the game directory. Rolldown splits local JavaScript from `index.source.html` so the game can download the renderer it uses at startup. esbuild compiles imported CSS and handles builds that use CSS Modules. The playable root entry points to the hashed outputs, and `.hgame-pixi-build.json` records their hashes. Rebuilding preserves authored assets and removes unchanged, obsolete outputs. Standard and Toy packaging use the project's build tool, including esbuild or Vite in earlier HGame projects, and retain the third-party license notices.

From the HGame repository, `npm run api -- pixi`, `npm run api -- Renderer2D`, or `npm run api -- --module ProceduralAtlas` finds the generated Pixi starter interfaces alongside runtime APIs. Results marked `generated game` are copied into a new game under `src/engine/`; they are not `vendor/hgame` imports. Use `npm run api -- --recipe 2d` for the starter wiring.

The empty, arena, and horde entries use `startPixiGame` from `src/engine/startPixiGame.js`. Register a scene in its setup callback and return `{ scene: scene.name }`. The callback can be asynchronous and receives the renderer and application with its services installed. Attach game-owned cleanup to `scene.onDispose`. Options include `createAtlas` for custom art and `rendererOptions` for resolution settings.

For an optional engine module, prefer a literal path such as `loadRuntime('world/tilemap.js')`. Release packaging follows these paths in the built Pixi chunks reachable from the game's entry. For paths assembled at runtime, list the possible modules in `includeRuntime` in `hgame.project.json`.

PixiJS prefers WebGPU and retries with WebGL (then Pixi's Canvas renderer if needed) when WebGPU is unavailable or initialization fails. HGame's application controls the simulation and render loop; `JuiceSystem.update(dt)` advances hit easing, shockwaves and particles on that loop. Call `juice.dispose()` before `renderer.dispose()` when tearing down an owning scene. The renderer reuses removed crowd particles and destroys its pooled sprites, filter and atlas on disposal. The starter's 1,000-enemy arena includes opt-in buttons to add 10,000 enemies and to trigger 100, 1,000, or 10,000 simultaneous eight-particle explosions; FPS and on-screen particles are displayed in the debug panel. Actual capacity depends on device, resolution, effects and workload. Canvas uses a simple drawn slash and particles for shockwaves; GPU bloom and distortion filters are disabled on this fallback.

On the Canvas fallback, particles use their atlas frame colors instead of runtime `opts.color` tinting. The default explosion has precolored atlas frames; supply precolored frames for custom particle colors on that backend.

Juice simulates particles for their full lifetime and submits only quads intersecting the current camera viewport. `active` counts all living particles. `visibleParticles` counts the particles submitted in the latest draw. Static UV data is refreshed when visible membership or textures change.

The arena uses HGame's `SpatialHash2D.castSegment` for projectile hits. Insert targets at their current positions, then sweep from the previous projectile position to its next one. The sweep returns the first hit and accepts a reusable output object. In the dense arena, pursuit continues without rebuilding the index whenever no projectile needs it.

Pixi projects start in automatic quality mode. Set `--quality low|medium|high|ultra` at creation, edit `src/presentation.json`, or call `renderer.setQuality(mode)` during play. The mode sets a physical pixel-ratio cap from HGame's 2D presets (1, 1.5, 2, or 3). Set `rendererOptions.maxPixels` in `startPixiGame` to change the default 2.3-million-pixel ceiling. Resolution changes preserve logical camera and input coordinates. `renderer.getRenderBudget()` / `renderer.reclaimRenderResources(type, reason)` expose typed idle cache & target reclamation (`postTargets`, `lightingTargets`, `atlasCache`, `textCache`, `scratchBuffers`) with recorded trigger reasons (`memory-budget`, `frame-time`, `idle-ttl`, `manual`, `context-loss`), matching `createCanvas2DAdapter` and `createWebGL2DAdapter`.

Auto mode starts from device hints and adjusts resolution using HGame's unscaled frame intervals. Visibility changes reset the sample window. Frame intervals include CPU and GPU work. A CPU-bound scene may need fewer simulation or rendering tasks to improve frame rate.

After initialization, use `renderer.setBloom({ enabled: true, threshold: 0.62, bloomScale: 0.4, brightness: 1, blur: 3 })` for persistent scene glow. Call `renderer.setBloom({ enabled: false })` to remove the glow. Shockwave distortion follows the world-space impact point through camera movement and zoom. With the default filter frame, a shockwave continues aging offscreen and draws only while its ring overlaps the viewport. It uses up to three simultaneous GPU filters per juice system by default and plays sparks for additional impacts. Set `maxShockwaveFilters` in the third constructor argument of `JuiceSystem` to tune this limit or set it to zero for spark effects only. Full-screen filters use the render viewport at the current rendering resolution.

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

Disposal releases both the textures and the backing canvas. Create a new atlas for a new renderer after disposal.

When `Renderer2D` selects WebGPU, uploading an atlas uses a temporary RGBA readback to avoid retaining external-image copy allocations across renderer restarts. Large atlases incur a one-time readback and upload during initialization.

`renderer.syncEntity(id, state)` creates a shadow only when `state.hasShadow !== false`; returned entries can therefore have `shadow: null`. If a frame has no `_white` silhouette, hit flash retains the base texture instead of substituting a white rectangle.

## Ordered draw groups

Use `renderer.createDrawGroup({ layer, z, y, ySort, blendMode, clipRect })` to mix content in the managed world slot between the existing entity and foreground layers. Groups draw in ascending layer and z order. If any group at the same layer and z enables `ySort`, those groups draw in ascending `y` order. Ties preserve registration order. Supply `group.setOrder({ y })` when the group's depth changes. A tilemap or particle batch in a group moves as one unit.

```js
const clipRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const ground = renderer.createDrawGroup({ layer: 0, clipRect });
const actor = renderer.createDrawGroup({ layer: 1, y: player.y, ySort: true, clipRect });
const particles = renderer.createDrawGroup({ layer: 2, clipRect, blendMode: 'add' });
const tiles = renderer.createTilemapLayer(map, { frames, drawGroup: ground });
renderer.syncEntity('player', { x: player.x, y: player.y, tex: 'player_hero', drawGroup: actor });
actor.container.addChild(label);
renderer.createSwarmLayer({ textures: ['enemy_chaser'], drawGroup: particles });
```

The optional clip is normalized to the visible viewport and follows viewport resize. It stays fixed on screen during camera movement. Adjacent groups with equal clip rectangles share a mask, including when their blend modes differ. `normal` and `add` apply through Pixi blend inheritance. A child with an explicit Pixi blend mode uses its own setting.

`group.dispose()` releases entities, tilemap layers and swarm layers registered through the renderer for that group. Directly attached display objects are detached for their owner to reuse or destroy. An empty clip hides the group. [Native adapter ordering](systems/03-sprite-2d-pathfinding.md#混排裁剪与混合)

For tile-based maps, generate a 2D project with `--with tilemap2d`, bake tile images or sheet frames into the atlas, and connect the existing HGame `TileMap` to Pixi:

```js
const { TileMap, findGridPath } = await loadRuntime('world/tilemap.js');
const map = new TileMap({ tiles: [[1, 1, 1], [1, 2, 1]], tileWidth: 32, tileHeight: 32, solid: [2] });
renderer.grid.visible = false;
const layer = renderer.createTilemapLayer(map, { frames: { 1: 'floor/0', 2: 'wall/0' }, chunkSize: 32 });
// layer.setTile(1, 1, 1); // updates map and the cached visual chunk
// layer.setTiles([{ x: 0, y: 0, value: 2 }, { x: 1, y: 0, value: 2 }]);
// findGridPath(map, { x: 0, y: 0 }, { x: 2, y: 1 });
// renderer.update(dt) updates chunk visibility; layer.dispose() releases it.
```

Map values absent from `frames` are transparent. All named frames must exist in the renderer's shared atlas. The layer creates static particle chunks as they enter the camera and retains up to `maxCachedChunks` chunks (default 128), evicting the least recently visible off-screen chunks. If the camera sees more than the limit, all visible chunks remain loaded. The underlying `TileMap` still holds the entire grid in memory. `setTile` updates one cell, reusing its particle when swapping between atlas frames. `setTiles` validates coordinates first and refreshes each affected cached particle container once. If the map is changed directly, call `refreshTile` for each affected chunk. An uncached chunk reads the latest data when it next appears. The `TileMap` governs collision and pathfinding. The renderer also disposes its tilemap layers on shutdown.

When the camera crosses a chunk boundary, the tilemap updates only the entering and leaving chunks. An empty chunk stays out of rendering until a tile edit gives it a visible sprite.

Turn-based boards can generate a bare project with `--preset pixi2d --bare --tick-hz 0`. Handle moves in `scene.onCommand` and call `app.dispatch` from input listeners. Use `renderer.onBeforeRender` to update the board and recompute the camera for resize. HGame renders on start, dispatch, resize, and resume. Tiles, input, and saves are available with zero idle animation frames. Fixed-step physics requires a positive tick rate. See `examples/signal-vault/`.

Repeated `findGridPath` calls reuse search nodes for the same map. Each call checks current tile values, so terrain edits are reflected immediately. Use `maxNodes` to bound the number of grid cells processed per call.

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

`node scripts/create-game.mjs <new-game-dir> --preset horde` creates this combination with a configurable `src/swarm.json`. Add `--bare` for an empty Pixi scene, or `--renderer webgl2d` for the in-house WebGL2D horde starter, meant for 10k+ on-screen sprites. Existing projects are not changed.

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

The swarm layer keeps sprite quad vertices static when frames share the same geometry. It refreshes them when a visible unit changes scale or switches to a different quad. Clips with changing frame bounds and directional flips use dynamic vertices. Pass `dynamicScale: true` if the swarm animates `scale[id]` continuously.

The generated horde enables `chunkCull` for rendering and `prepareRenderChunks` in `swarm.step()`. For crowds of 512 or more units, the layer records its view bounds for the next step and can reuse a current chunk index. The step uses existing grid density to estimate whether the view can exclude most units. It then collects exact chunk bounds during movement when worthwhile. The layer expands each chunk by its largest sprite scale and keeps the active-instance draw order. The regular scan handles dirty indices and frames with at least half the units still in candidate chunks. For custom code that turns on `chunkCull` and writes directly to `posX`, `posY`, or `scale`, call `swarm.invalidateChunks()` after those writes.

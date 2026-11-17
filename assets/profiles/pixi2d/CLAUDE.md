# PixiJS v8 starter

Game rules live in `src/sim/`, DOM controls in `src/ui/`, and renderer integration in `src/engine/`.
This starter uses PixiJS for 2D. The generic HGame renderer entries in the shared project instructions describe optional legacy paths; do not mix their rendering components into this Pixi scene.
The simulation must not import PixiJS or access the DOM. Use the renderer and juice interfaces for presentation. HGame owns the application loop.

- Create `new Application()` and await `app.init()`, using `app.canvas`.
- Import core classes from `pixi.js` and effects from `pixi-filters`.
- Ticker callbacks receive a `Ticker`, with seconds from `deltaMS / 1000`. HGame owns the scheduler.
- Draw paths before `.fill()` and `.stroke()`.
- Add `Particle` objects using `ParticleContainer.addParticle`, using a shared texture source.
- Construct canvas textures with `CanvasSource` and `Texture`.
- Set world containers to `eventMode = 'none'` and disable `interactiveChildren`.
- Cache static containers using `cacheAsTexture(true)`.
- Use atlas `_white` frames for hit flashes and reserve filters for layers.
- Use `createCatalogGameAtlas(catalog, frames)` to bake catalog images into the shared atlas; let the renderer dispose the finished atlas.
- For sprite-sheet animation, bake HGame `SpriteSheet` frames using `registerSheet` or a catalog `sheet` factory; advance HGame `AnimationPlayer` in the existing loop.
- For HGame CPU swarms use `renderer.createSwarmLayer()` and call `sync(swarm)` once per visual update; release the layer on scene exit.
- Do not use `app.view`, `@pixi/*` v7 packages, `beginFill`/`drawCircle`, `BaseTexture`, `interactive`, `cacheAsBitmap`, or `addChild(Sprite)` on a `ParticleContainer`.
- After changing source, run `npm run build:pixi` in the generated game to update its playable entry and bundles. It preserves authored assets.

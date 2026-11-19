import { Application, Container, Sprite, TilingSprite, ParticleContainer, Particle, RendererType } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { PixiSwarmLayer } from './PixiSwarmLayer.js';
import { PixiTilemapLayer } from './PixiTilemapLayer.js';
import { loadRuntime } from './startPixiGame.js';

const RENDERER_BACKENDS = ['webgpu', 'webgl', 'canvas'];

export class Renderer2D {
  constructor(atlas, { backend = 'auto', maxPixels = 2300000, maxPixelRatio = 2, qualityController = null,
    qualityPresets = null, diagnostics2d = false } = {}) {
    if (backend !== 'auto' && !RENDERER_BACKENDS.includes(backend)) {
      throw new RangeError('Invalid Pixi renderer backend: ' + backend);
    }
    if (!Number.isFinite(maxPixels) || maxPixels < 1 || !Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0) {
      throw new RangeError('Renderer pixel budget and maximum pixel ratio must be positive');
    }
    this.atlas = atlas;
    this.maxPixels = maxPixels; this.maxPixelRatio = maxPixelRatio;
    this.backendPreference = backend;
    if (qualityController && (typeof qualityController.sampleFrame !== 'function' || typeof qualityController.resetMeasurements !== 'function')) {
      throw new TypeError('qualityController must support sampleFrame and resetMeasurements');
    }
    this.qualityController = qualityController;
    this.qualityPresets = qualityPresets;
    this.diagnosticsEnabled = diagnostics2d;
    this.lastFrameTime = null;
    this.app = new Application();
    this.entityMap = new Map();
    this.spritePool = [];
    this.enemyParticles = [];
    this.enemyPool = [];
    this.pendingEnemies = [];
    this.swarmLayers = new Set();
    this.tilemapLayers = new Set();
    this.effectChannels = new Map();
    this.beforeRenderCallbacks = new Set();
    this.camera = { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, shakeX: 0, shakeY: 0 };
  }
  async init(mount) {
    this.mount = mount;
    const { width, height, resolution } = this.planViewport();
    const options = { width, height, resolution, autoDensity: true, backgroundColor: 0x0b101b, autoStart: false };
    // Pixi does not retry the next backend if the selected renderer fails
    // during initialization. Try each backend with a fresh application.
    const errors = [];
    let initialized = false;
    const backends = this.backendPreference === 'auto' ? RENDERER_BACKENDS : [this.backendPreference];
    for (const backend of backends) {
      const app = this.app ??= new Application();
      try {
        await app.init({ ...options, preference: [backend] });
        initialized = true;
        this.backend = backend;
        break;
      } catch (error) {
        errors.push(error);
        this.app = null;
        try {
          if (app.renderer) app.destroy({ removeView: true }, { children: true });
          else app.stage?.destroy({ children: true });
        } catch (cleanupError) {
          errors.push(cleanupError);
          console.warn('Failed to clean up a Pixi renderer:', cleanupError);
        }
      }
    }
    if (!initialized) throw new AggregateError(errors, 'Unable to initialize a Pixi renderer');
    if (this.backend === 'webgpu') this.atlas.useWebGpuUpload?.();
    this.isCanvas = this.app.renderer.type === RendererType.CANVAS;
    if (this.diagnosticsEnabled) {
      const { createRenderDiagnostics2D } = await loadRuntime('integrations/render-diagnostics-2d.js');
      this.frameDiagnostics = createRenderDiagnostics2D({ pixiRenderer: this.app.renderer });
      this.resetFrameDiagnostics = () => this.frameDiagnostics.resetGpu(true);
      this.app.canvas.addEventListener('webglcontextlost', this.resetFrameDiagnostics);
      this.app.canvas.addEventListener('webglcontextrestored', this.resetFrameDiagnostics);
    }
    this.app.ticker.stop();
    this.app.canvas.id = 'game';
    this.app.canvas.setAttribute('aria-label', '游戏画面');
    this.app.canvas.dataset.rendererBackend = this.backend;
    this.updateQualityMarker();
    mount.appendChild(this.app.canvas);
    this.worldRoot = new Container();
    this.worldRoot.eventMode = 'none';
    this.worldRoot.interactiveChildren = false;
    this.bgLayer = new Container();
    const grid = new TilingSprite({ texture: this.atlas.get('ground_grid'), width: 4096, height: 4096 });
    this.grid = grid;
    grid.position.set(-2048, -2048);
    this.bgLayer.addChild(grid);
    this.shadowLayer = new Container();
    this.entityLayer = new Container({ sortableChildren: true });
    this.foregroundLayer = new Container();
    this.enemyLayer = new ParticleContainer({ dynamicProperties: { position: true, uvs: true, rotation: true, vertex: true } });
    this.trailLayer = new Container();
    this.particleLayer = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: true } });
    this.worldRoot.addChild(this.bgLayer, this.shadowLayer, this.enemyLayer, this.entityLayer, this.foregroundLayer, this.trailLayer, this.particleLayer);
    this.app.stage.addChild(this.worldRoot);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.62, bloomScale: 0.4, brightness: 1, blur: 3 });
    this.bloom.resolution = 'inherit';
    this.bloomEnabled = false;
    this.app.stage.filterArea = this.app.screen;
    this.applyFilters();
    this.viewport = { width, height, resolution };
    this.syncCameraView();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(mount);
    }
  }
  planViewport() {
    const width = Math.max(1, Math.floor(this.mount?.clientWidth || 1));
    const height = Math.max(1, Math.floor(this.mount?.clientHeight || 1));
    const deviceRatio = Number(globalThis.devicePixelRatio) || 1;
    const quality = this.qualityController?.state;
    const scale = quality?.dynamicScale ?? 1;
    const tierLimit = this.qualityPresets?.[quality?.tier]?.maxPixelRatio ?? this.maxPixelRatio;
    const resolution = Math.max(1 / Math.min(width, height),
      Math.min(deviceRatio, this.maxPixelRatio, tierLimit, Math.sqrt(this.maxPixels / (width * height))) * scale);
    return { width, height, resolution };
  }
  resize() {
    if (this.disposed || !this.app?.renderer) return false;
    this.updateQualityMarker();
    const next = this.planViewport(), prev = this.viewport;
    if (prev && prev.width === next.width && prev.height === next.height && prev.resolution === next.resolution) return false;
    this.app.renderer.resize(next.width, next.height, next.resolution);
    this.viewport = next;
    this.app.stage.filterArea = this.app.screen;
    this.syncCameraView();
    this.onResize?.();
    return true;
  }
  updateQualityMarker() {
    const tier = this.qualityController?.state?.tier;
    if (tier) this.app.canvas.dataset.qualityTier = tier;
  }
  renderDiagnostics() {
    const adapter = this.app.renderer.gpu?.adapter;
    const info = adapter?.info;
    return {
      backend: this.backend,
      ...this.getRenderDiagnostics(),
      adapter: adapter ? {
        vendor: info?.vendor || null,
        architecture: info?.architecture || null,
        device: info?.device || null,
        description: info?.description || null,
        fallback: info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
      } : null,
    };
  }
  getRenderDiagnostics() { return this.frameDiagnostics?.snapshot() ?? null; }
  resetQualityMeasurements() {
    this.lastFrameTime = null;
    this.qualityController?.resetMeasurements();
  }
  setQuality(mode) {
    if (typeof this.qualityController?.setMode !== 'function') throw new Error('Renderer2D has no configurable quality controller');
    if (!this.qualityController.setMode(mode)) return false;
    this.lastFrameTime = null;
    this.resize();
    return true;
  }
  /** Configure persistent bloom. Transient effect filters remain independently owned. */
  setBloom({ enabled = true, threshold, bloomScale, brightness, blur } = {}) {
    if (!this.bloom || this.disposed) throw new Error('Initialize Renderer2D before configuring bloom');
    for (const [key, value] of Object.entries({ threshold, bloomScale, brightness, blur })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new RangeError(`Bloom ${key} must be a finite non-negative number`);
    }
    if (threshold !== undefined) this.bloom.threshold = threshold;
    if (bloomScale !== undefined) this.bloom.bloomScale = bloomScale;
    if (brightness !== undefined) this.bloom.brightness = brightness;
    if (blur !== undefined) this.bloom.blur = blur;
    this.bloomEnabled = Boolean(enabled);
    this.applyFilters();
  }
  /** Set one owner's transient filters. An empty list removes that owner. */
  setEffectFilters(filters, { owner = this, beforeRender = null, bloom = true } = {}) {
    if (filters.length) this.effectChannels.set(owner, { filters, beforeRender, bloom });
    else this.effectChannels.delete(owner);
    this.applyFilters();
  }
  /** Run a callback after quality and camera updates, just before Pixi draws. */
  onBeforeRender(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a render preparation callback');
    this.beforeRenderCallbacks.add(callback);
    return () => this.beforeRenderCallbacks.delete(callback);
  }
  applyFilters() {
    const filters = [];
    if (!this.isCanvas) {
      let useBloom = this.bloomEnabled;
      for (const effect of this.effectChannels.values()) {
        filters.push(...effect.filters);
        useBloom ||= effect.bloom;
      }
      if (useBloom) filters.unshift(this.bloom);
    }
    this.app.stage.filters = filters;
  }
  createSwarmLayer(options) {
    const layer = new PixiSwarmLayer(this, options);
    this.swarmLayers.add(layer);
    return layer;
  }
  createTilemapLayer(map, options) {
    const layer = new PixiTilemapLayer(this, map, options);
    this.tilemapLayers.add(layer);
    return layer;
  }
  syncEnemies(enemies, time) {
    const frames = this.enemyTextures ??= ['enemy_chaser', 'enemy_chaser_white', 'enemy_elite', 'enemy_elite_white']
      .map(name => this.atlas.get(name));
    // Include the widest frame at its maximum wobble scale and any rotation.
    const radius = this.enemyCullRadius ??= Math.max(...frames.map(texture =>
      Math.hypot(texture.orig.width, texture.orig.height) * 0.525));
    const { x, y, zoom, shakeX, shakeY } = this.camera;
    const { width, height } = this.app.screen;
    const left = x + (-width / 2 - shakeX) / zoom - radius;
    const right = x + (width / 2 - shakeX) / zoom + radius;
    const top = y + (-height / 2 - shakeY) / zoom - radius;
    const bottom = y + (height / 2 - shakeY) / zoom + radius;
    let used = 0;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy.x < left || enemy.x > right || enemy.y < top || enemy.y > bottom) continue;
      const texture = frames[(enemy.elite ? 2 : 0) + (enemy.flash > 0 ? 1 : 0)];
      let particle = this.enemyParticles[used++];
      if (!particle) {
        particle = this.enemyPool.pop() ?? new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
        this.enemyParticles.push(particle);
        this.pendingEnemies.push(particle);
        if (this.pendingEnemies.length === 4096) this.flushEnemies();
      }
      if (particle.texture !== texture) particle.texture = texture;
      particle.x = enemy.x;
      particle.y = enemy.y;
      const phase = time * 7 + enemy.id * 0.37;
      particle.rotation = Math.sin(phase) * 0.09;
      const stride = Math.sin(phase * 2);
      particle.scaleX = 1 + stride * 0.035;
      particle.scaleY = 1 - stride * 0.05;
    }
    this.flushEnemies();
    if (used < this.enemyParticles.length) {
      for (let i = used; i < this.enemyParticles.length; i++) this.enemyPool.push(this.enemyParticles[i]);
      this.enemyParticles.length = used;
      this.enemyLayer.particleChildren.length = used;
      this.enemyLayer.update();
    }
  }
  flushEnemies() {
    if (this.pendingEnemies.length) this.enemyLayer.addParticle(...this.pendingEnemies);
    this.pendingEnemies.length = 0;
  }
  alloc(name) {
    const sprite = this.spritePool.pop() ?? new Sprite();
    sprite.texture = this.atlas.get(name); sprite.anchor.set(0.5); sprite.alpha = 1;
    sprite.tint = 0xffffff; sprite.scale.set(1); sprite.rotation = 0; sprite.visible = true;
    return sprite;
  }
  syncEntity(id, state) {
    let entry = this.entityMap.get(id);
    if (!entry) {
      entry = { sprite: this.alloc(state.tex), shadow: null, flashTimer: 0, animScaleX: 1, animScaleY: 1 };
      this.entityMap.set(id, entry);
      this.entityLayer.addChild(entry.sprite);
    }
    entry.baseTex = state.tex;
    const sprite = entry.sprite;
    const baseTexture = this.atlas.get(state.tex);
    sprite.texture = entry.flashTimer > 0 ? (this.atlas.textures.get(state.tex + '_white') ?? baseTexture) : baseTexture;
    sprite.position.set(state.x, state.y); sprite.rotation = state.rot ?? 0;
    sprite.scale.set((state.scaleX ?? 1) * entry.animScaleX, (state.scaleY ?? 1) * entry.animScaleY);
    sprite.tint = entry.flashTimer > 0 ? 0xffffff : (state.tint ?? 0xffffff);
    sprite.alpha = state.alpha ?? 1; sprite.zIndex = state.zIndex ?? state.y;
    if (state.hasShadow !== false) {
      if (!entry.shadow) {
        entry.shadow = this.alloc('shadow_oval');
        this.shadowLayer.addChild(entry.shadow);
      }
      entry.shadow.visible = true;
      entry.shadow.position.set(state.x, state.y + 18); entry.shadow.alpha = 0.35;
    } else if (entry.shadow) entry.shadow.visible = false;
    return entry;
  }
  releaseEntity(id) {
    const entry = this.entityMap.get(id);
    if (!entry) return;
    entry.sprite.removeFromParent(); this.spritePool.push(entry.sprite);
    if (entry.shadow) { entry.shadow.removeFromParent(); this.spritePool.push(entry.shadow); }
    this.entityMap.delete(id);
  }
  update(dt) {
    const c = this.camera, a = 1 - Math.exp(-10 * dt);
    c.x += (c.targetX - c.x) * a; c.y += (c.targetY - c.y) * a;
    this.syncCameraView();
    for (const entry of this.entityMap.values()) entry.flashTimer = Math.max(0, entry.flashTimer - dt);
  }
  syncCameraView() {
    const c = this.camera;
    this.worldRoot.scale.set(c.zoom);
    this.worldRoot.position.set(this.app.screen.width / 2 - c.x * c.zoom + c.shakeX, this.app.screen.height / 2 - c.y * c.zoom + c.shakeY);
    for (const layer of this.tilemapLayers) layer.update();
  }
  screenToWorld(x, y) { return { x: (x - this.app.screen.width / 2 - this.camera.shakeX) / this.camera.zoom + this.camera.x, y: (y - this.app.screen.height / 2 - this.camera.shakeY) / this.camera.zoom + this.camera.y }; }
  worldToScreen(x, y, out = { x: 0, y: 0 }) {
    out.x = (x - this.camera.x) * this.camera.zoom + this.app.screen.width / 2 + this.camera.shakeX;
    out.y = (y - this.camera.y) * this.camera.zoom + this.app.screen.height / 2 + this.camera.shakeY;
    return out;
  }
  /** @param {number | null} [frameIntervalMs] Pass null for redraws that do not advance the frame clock. */
  render(frameIntervalMs) {
    const report = this.frameDiagnostics;
    if (!report?.beginFrame()) return this.renderFrame(frameIntervalMs);
    let complete = false;
    try {
      this.renderFrame(frameIntervalMs, report);
      complete = true;
    } finally { report.endFrame(complete); }
  }
  renderFrame(frameIntervalMs, report = null) {
    let finish = report?.beginPass('prepare', null);
    try {
      if (this.qualityController && frameIntervalMs !== null) {
        if (frameIntervalMs === undefined) {
          const now = performance.now();
          frameIntervalMs = this.lastFrameTime === null ? 0 : now - this.lastFrameTime;
          this.lastFrameTime = now;
        } else if (frameIntervalMs === 0) {
          this.resetQualityMeasurements();
        }
        if (frameIntervalMs > 0 && this.qualityController.sampleFrame(frameIntervalMs)) this.resize();
      }
      for (const callback of this.beforeRenderCallbacks) callback();
      finish?.();
      finish = report?.beginPass('effects-prepare', null);
      if (!this.isCanvas) {
        for (const channel of this.effectChannels.values()) channel.beforeRender?.();
      }
      finish?.();
      finish = report?.beginPass('scene', null);
      this.app.renderer.render(this.app.stage);
    } finally { finish?.(); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.resetFrameDiagnostics) {
        this.app.canvas.removeEventListener('webglcontextlost', this.resetFrameDiagnostics);
        this.app.canvas.removeEventListener('webglcontextrestored', this.resetFrameDiagnostics);
        this.resetFrameDiagnostics();
      }
      this.resizeObserver?.disconnect(); this.resizeObserver = null; this.onResize = null;
      for (const layer of this.swarmLayers) layer.dispose();
      for (const layer of this.tilemapLayers) layer.dispose();
      for (const sprite of this.spritePool) sprite.destroy();
      this.spritePool.length = 0; this.enemyParticles.length = 0; this.enemyPool.length = 0; this.pendingEnemies.length = 0; this.entityMap.clear();
      const stage = this.app?.stage;
      if (stage) stage.filters = [];
      this.effectChannels.clear();
      this.beforeRenderCallbacks.clear();
      this.bloom?.destroy();
      if (this.app?.renderer) this.app.destroy({ removeView: true }, { children: true });
      else if (stage && !stage.destroyed) stage.destroy({ children: true });
    } finally { this.atlas.dispose(); }
  }
}

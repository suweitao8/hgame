import { Application, Container, Sprite, TilingSprite, ParticleContainer, Particle, RendererType } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { PixiSwarmLayer } from './PixiSwarmLayer.js';
import { PixiTilemapLayer } from './PixiTilemapLayer.js';

export class Renderer2D {
  constructor(atlas, { maxPixels = 2300000, maxPixelRatio = 2, qualityController = null, qualityPresets = null } = {}) {
    if (!Number.isFinite(maxPixels) || maxPixels < 1 || !Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0) {
      throw new RangeError('Renderer pixel budget and maximum pixel ratio must be positive');
    }
    this.atlas = atlas;
    this.maxPixels = maxPixels; this.maxPixelRatio = maxPixelRatio;
    if (qualityController && (typeof qualityController.sampleFrame !== 'function' || typeof qualityController.resetMeasurements !== 'function')) {
      throw new TypeError('qualityController must support sampleFrame and resetMeasurements');
    }
    this.qualityController = qualityController;
    this.qualityPresets = qualityPresets;
    this.lastFrameTime = null;
    this.app = new Application();
    this.entityMap = new Map();
    this.spritePool = [];
    this.swarmLayers = new Set();
    this.tilemapLayers = new Set();
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
    for (const backend of ['webgpu', 'webgl', 'canvas']) {
      try {
        await this.app.init({ ...options, preference: [backend] });
        initialized = true;
        break;
      } catch (error) {
        errors.push(error);
        try {
          if (this.app.renderer) this.app.destroy({ removeView: true }, { children: true });
          else this.app.stage?.destroy({ children: true });
        } catch (cleanupError) {
          errors.push(cleanupError);
          console.warn('Failed to clean up a Pixi renderer:', cleanupError);
        }
        if (backend !== 'canvas') this.app = new Application();
      }
    }
    if (!initialized) throw new AggregateError(errors, 'Unable to initialize a Pixi renderer');
    this.isCanvas = this.app.renderer.type === RendererType.CANVAS;
    this.app.ticker.stop();
    this.app.canvas.id = 'game';
    this.app.canvas.setAttribute('aria-label', '游戏画面');
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
    this.enemyParticles = [];
    this.enemyPool = [];
    this.pendingEnemies = [];
    this.trailLayer = new Container();
    this.particleLayer = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: true } });
    this.worldRoot.addChild(this.bgLayer, this.shadowLayer, this.enemyLayer, this.entityLayer, this.foregroundLayer, this.trailLayer, this.particleLayer);
    this.app.stage.addChild(this.worldRoot);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.62, bloomScale: 0.4, brightness: 1, blur: 3 });
    this.bloomEnabled = false;
    this.effectFilters = [];
    this.applyFilters();
    this.viewport = { width, height, resolution };
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
    if (this.disposed || !this.app.renderer) return false;
    const next = this.planViewport(), prev = this.viewport;
    if (prev && prev.width === next.width && prev.height === next.height && prev.resolution === next.resolution) return false;
    this.app.renderer.resize(next.width, next.height, next.resolution);
    this.viewport = next;
    this.onResize?.();
    return true;
  }
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
  setEffectFilters(filters) {
    this.effectFilters = filters;
    this.applyFilters();
  }
  applyFilters() {
    const effects = this.effectFilters;
    this.app.stage.filters = !this.isCanvas && (this.bloomEnabled || effects.length) ? [this.bloom, ...effects] : [];
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
    if (this.enemyParticles.length > enemies.length) {
      const removed = this.enemyLayer.removeParticles(enemies.length);
      this.enemyParticles.length = enemies.length;
      for (const particle of removed) this.enemyPool.push(particle);
    }
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      let particle = this.enemyParticles[i];
      const key = (enemy.elite ? 'enemy_elite' : 'enemy_chaser') + (enemy.flash > 0 ? '_white' : '');
      if (!particle) {
        particle = this.enemyPool.pop() ?? new Particle({ texture: this.atlas.get(key), anchorX: 0.5, anchorY: 0.5 });
        this.enemyParticles.push(particle);
        this.pendingEnemies.push(particle);
        if (this.pendingEnemies.length === 4096) this.flushEnemies();
      }
      const texture = this.atlas.get(key);
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
    this.worldRoot.scale.set(c.zoom);
    this.worldRoot.position.set(this.app.screen.width / 2 - c.x * c.zoom + c.shakeX, this.app.screen.height / 2 - c.y * c.zoom + c.shakeY);
    for (const layer of this.tilemapLayers) layer.update();
    for (const entry of this.entityMap.values()) entry.flashTimer = Math.max(0, entry.flashTimer - dt);
  }
  screenToWorld(x, y) { return { x: (x - this.app.screen.width / 2 - this.camera.shakeX) / this.camera.zoom + this.camera.x, y: (y - this.app.screen.height / 2 - this.camera.shakeY) / this.camera.zoom + this.camera.y }; }
  worldToScreen(x, y) { return { x: (x - this.camera.x) * this.camera.zoom + this.app.screen.width / 2 + this.camera.shakeX, y: (y - this.camera.y) * this.camera.zoom + this.app.screen.height / 2 + this.camera.shakeY }; }
  /** @param {number | null} [frameIntervalMs] Pass null for redraws that do not advance the frame clock. */
  render(frameIntervalMs) {
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
    this.app.renderer.render(this.app.stage);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect(); this.resizeObserver = null; this.onResize = null;
    for (const layer of this.swarmLayers) layer.dispose();
    for (const layer of this.tilemapLayers) layer.dispose();
    for (const sprite of this.spritePool) sprite.destroy();
    this.spritePool.length = 0; this.enemyParticles.length = 0; this.enemyPool.length = 0; this.pendingEnemies.length = 0; this.entityMap.clear();
    const stage = this.app.stage;
    try {
      if (stage) stage.filters = [];
      if (this.effectFilters) this.effectFilters.length = 0;
      this.bloom?.destroy();
      if (this.app.renderer) this.app.destroy({ removeView: true }, { children: true });
      else if (stage && !stage.destroyed) stage.destroy({ children: true });
    } finally { this.atlas.dispose(); }
  }
}

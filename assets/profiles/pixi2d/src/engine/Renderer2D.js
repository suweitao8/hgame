import { Application, Container, Sprite, TilingSprite, ParticleContainer, Particle } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';

export class Renderer2D {
  constructor(atlas) {
    this.atlas = atlas;
    this.app = new Application();
    this.entityMap = new Map();
    this.spritePool = [];
    this.camera = { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1, shakeX: 0, shakeY: 0 };
  }
  async init(mount) {
    await this.app.init({ preference: 'webgpu', resizeTo: mount, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true, backgroundColor: 0x0b101b, autoStart: false });
    this.app.ticker.stop();
    this.app.canvas.id = 'game';
    this.app.canvas.setAttribute('aria-label', '游戏画面');
    mount.appendChild(this.app.canvas);
    this.worldRoot = new Container();
    this.worldRoot.eventMode = 'none';
    this.worldRoot.interactiveChildren = false;
    this.bgLayer = new Container();
    const grid = new TilingSprite({ texture: this.atlas.get('ground_grid'), width: 4096, height: 4096 });
    grid.position.set(-2048, -2048);
    this.bgLayer.addChild(grid);
    this.shadowLayer = new Container();
    this.entityLayer = new Container({ sortableChildren: true });
    this.enemyLayer = new ParticleContainer({ dynamicProperties: { position: true, uvs: true, rotation: true, vertex: true } });
    this.enemyParticles = [];
    this.enemyPool = [];
    this.trailLayer = new Container();
    this.particleLayer = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: true } });
    this.worldRoot.addChild(this.bgLayer, this.shadowLayer, this.enemyLayer, this.entityLayer, this.trailLayer, this.particleLayer);
    this.app.stage.addChild(this.worldRoot);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.62, bloomScale: 0.4, brightness: 1, blur: 3 });
    this.app.stage.filters = [];
  }
  syncEnemies(enemies, time) {
    if (this.enemyParticles.length > enemies.length) {
      const removed = this.enemyParticles.splice(enemies.length);
      for (let i = 0; i < removed.length; i += 10000) this.enemyLayer.removeParticle(...removed.slice(i, i + 10000));
      for (const particle of removed) this.enemyPool.push(particle);
    }
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      let particle = this.enemyParticles[i];
      const key = (enemy.elite ? 'enemy_elite' : 'enemy_chaser') + (enemy.flash > 0 ? '_white' : '');
      if (!particle) {
        particle = this.enemyPool.pop() ?? new Particle({ texture: this.atlas.get(key), anchorX: 0.5, anchorY: 0.5 });
        this.enemyParticles.push(particle);
        this.enemyLayer.addParticle(particle);
      }
      particle.texture = this.atlas.get(key);
      particle.x = enemy.x;
      particle.y = enemy.y;
      const phase = time * 7 + enemy.id * 0.37;
      particle.rotation = Math.sin(phase) * 0.09;
      particle.scaleX = 1 + Math.sin(phase * 2) * 0.035;
      particle.scaleY = 1 - Math.sin(phase * 2) * 0.05;
    }
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
      entry = { sprite: this.alloc(state.tex), shadow: this.alloc('shadow_oval'), flashTimer: 0, animScaleX: 1, animScaleY: 1 };
      this.entityMap.set(id, entry);
      this.entityLayer.addChild(entry.sprite); this.shadowLayer.addChild(entry.shadow);
    }
    entry.baseTex = state.tex;
    const sprite = entry.sprite;
    sprite.texture = this.atlas.get(entry.flashTimer > 0 ? state.tex + '_white' : state.tex);
    sprite.position.set(state.x, state.y); sprite.rotation = state.rot ?? 0;
    sprite.scale.set((state.scaleX ?? 1) * entry.animScaleX, (state.scaleY ?? 1) * entry.animScaleY);
    sprite.tint = entry.flashTimer > 0 ? 0xffffff : (state.tint ?? 0xffffff);
    sprite.alpha = state.alpha ?? 1; sprite.zIndex = state.zIndex ?? state.y;
    entry.shadow.visible = state.hasShadow !== false;
    entry.shadow.position.set(state.x, state.y + 18); entry.shadow.alpha = 0.35;
    return entry;
  }
  releaseEntity(id) {
    const entry = this.entityMap.get(id);
    if (!entry) return;
    entry.sprite.removeFromParent(); entry.shadow.removeFromParent();
    this.spritePool.push(entry.sprite, entry.shadow); this.entityMap.delete(id);
  }
  update(dt) {
    const c = this.camera, a = 1 - Math.exp(-10 * dt);
    c.x += (c.targetX - c.x) * a; c.y += (c.targetY - c.y) * a;
    this.worldRoot.scale.set(c.zoom);
    this.worldRoot.position.set(this.app.screen.width / 2 - c.x * c.zoom + c.shakeX, this.app.screen.height / 2 - c.y * c.zoom + c.shakeY);
    for (const entry of this.entityMap.values()) entry.flashTimer = Math.max(0, entry.flashTimer - dt);
  }
  screenToWorld(x, y) { return { x: (x - this.app.screen.width / 2 - this.camera.shakeX) / this.camera.zoom + this.camera.x, y: (y - this.app.screen.height / 2 - this.camera.shakeY) / this.camera.zoom + this.camera.y }; }
  worldToScreen(x, y) { return { x: (x - this.camera.x) * this.camera.zoom + this.app.screen.width / 2 + this.camera.shakeX, y: (y - this.camera.y) * this.camera.zoom + this.app.screen.height / 2 + this.camera.shakeY }; }
  render() { this.app.renderer.render(this.app.stage); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const sprite of this.spritePool) sprite.destroy();
    this.spritePool.length = 0; this.enemyParticles.length = 0; this.enemyPool.length = 0; this.entityMap.clear();
    this.app.stage.filters = [];
    this.bloom.destroy();
    this.app.destroy({ removeView: true }, { children: true }); this.atlas.dispose();
  }
}

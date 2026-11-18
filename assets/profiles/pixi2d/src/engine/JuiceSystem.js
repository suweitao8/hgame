import { Particle, ParticleContainer, MeshRope, Point, Graphics } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters';
import { gsap } from 'gsap';

const hitEase = gsap.parseEase('elastic.out(1, 0.45)');
const explosionOptions = [0xff6622, 0xffbb33, 0xffed99].map(color => Object.freeze({
  speedMin: 25, speedMax: 110, lifeMin: 3, lifeMax: 3, scaleStart: 0.8, drag: 1.5, color,
}));
const canvasExplosionOptions = explosionOptions.map((options, index) => Object.freeze({
  ...options, tex: 'particle_fire_' + index, color: 0xffffff,
}));

function shockwaveIntersectsViewport(filter, width, height, margin) {
  const { x, y } = filter.center;
  const radius = filter.time * filter.speed;
  const halfWavelength = filter.wavelength / 2;
  const outer = radius + halfWavelength;
  const nearX = Math.max(0, -x, x - width);
  const nearY = Math.max(0, -y, y - height);
  if (nearX * nearX + nearY * nearY > (outer + margin) ** 2) return false;

  const inner = Math.max(0, radius - halfWavelength - margin);
  const farX = Math.max(Math.abs(x), Math.abs(x - width));
  const farY = Math.max(Math.abs(y), Math.abs(y - height));
  return !(farX * farX + farY * farY < inner * inner);
}

export class JuiceSystem {
  constructor(renderer, capacity = 10000, { maxShockwaveFilters = 3 } = {}) {
    if (!Number.isInteger(maxShockwaveFilters) || maxShockwaveFilters < 0 || maxShockwaveFilters > 16) {
      throw new RangeError('maxShockwaveFilters must be an integer from 0 to 16');
    }
    this.renderer = renderer; this.trauma = 0;
    this.hitStop = 0; this.simTimeScale = 1; this.clock = 0; this.active = 0; this.visibleParticles = 0;
    this.effects = []; this.liveParticles = []; this.shockwaves = new Set(); this.hitTweens = new Map();
    this.maxShockwaveFilters = maxShockwaveFilters;
    this.freeShockwaves = [];
    this.shockwaveChannel = {
      owner: this,
      bloom: false,
      beforeRender: () => this.syncShockwaveCenters(),
    };
    this.particleBatch = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    renderer.worldRoot.addChild(this.particleBatch);
    this.particleUvsDirty = false;
    this.freeParticles = Array.from({ length: capacity }, () => this.createParticle(renderer.atlas.get('particle_soft')));
    this.offBeforeRender = renderer.onBeforeRender(() => this.syncVisibleParticles());
    this.points = Array.from({ length: 12 }, () => new Point());
    this.trail = renderer.isCanvas ? new Graphics() : new MeshRope({ texture: renderer.atlas.get('slash_trail'), points: this.points });
    this.trail.visible = false; renderer.trailLayer.addChild(this.trail); this.trailTime = 0;
  }
  triggerHitJuice(id, { flashSec = 0.065, squashX = 1.35, squashY = 0.72 } = {}) {
    const entry = this.renderer.entityMap.get(id); if (!entry) return;
    entry.flashTimer = flashSec; entry.animScaleX = squashX; entry.animScaleY = squashY;
    this.hitTweens.set(id, { entry, squashX, squashY, elapsed: 0 });
  }
  triggerHitStop(duration = 0.045, scale = 0.04) { this.hitStop = Math.max(this.hitStop, duration); this.simTimeScale = scale; }
  addTrauma(amount = 0.4) { this.trauma = Math.min(1, this.trauma + amount); }
  spawnShockwave(x, y) {
    if (this.renderer.isCanvas || this.shockwaves.size >= this.maxShockwaveFilters) {
      this.burstParticles(x, y, 24, { tex: 'particle_spark', speedMin: 100, speedMax: 180, lifeMin: 0.2, lifeMax: 0.45 });
      return;
    }
    let wave = this.freeShockwaves.pop();
    if (!wave) {
      const filter = new ShockwaveFilter({ center: { x: 0, y: 0 } });
      filter.resolution = 'inherit';
      wave = { filter, x: 0, y: 0 };
    }
    wave.x = x;
    wave.y = y;
    wave.filter.time = 0;
    wave.filter.enabled = true;
    this.shockwaves.add(wave);
    this.syncShockwaveFilters();
  }
  syncShockwaveFilters() {
    this.renderer.setEffectFilters(Array.from(this.shockwaves, wave => wave.filter), this.shockwaveChannel);
  }
  syncShockwaveCenters() {
    const { app, viewport } = this.renderer;
    const { screen, stage } = app;
    // Only bypass passes when all filters use the standard viewport target.
    const usesViewport = stage.filterArea === screen && stage.filters.every(
      filter => filter.clipToViewport && filter.padding === 0
        && filter.resolution === 'inherit' && filter.antialias === 'off',
    );
    // Pixi rounds the filter frame outward at the backing resolution.
    const margin = 1 + Math.SQRT2 / viewport.resolution;
    for (const { filter, x, y } of this.shockwaves) {
      this.renderer.worldToScreen(x, y, filter.center);
      filter.enabled = !usesViewport || shockwaveIntersectsViewport(filter, screen.width, screen.height, margin);
    }
  }
  createParticle(texture) {
    const particle = new Particle({ texture, anchorX: 0, anchorY: 0, rotation: 0 });
    return { particle, life: 0, duration: 0, vx: 0, vy: 0, start: 1, end: 0, drag: 0, width: 0, height: 0 };
  }
  burstParticles(x, y, count, opts = {}) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Particle count must be a non-negative safe integer');
    const texture = this.renderer.atlas.get(opts.tex ?? 'particle_soft');
    const speedMin = opts.speedMin ?? 80, speedRange = (opts.speedMax ?? 300) - speedMin;
    const lifeMin = opts.lifeMin ?? 0.3, lifeRange = (opts.lifeMax ?? 0.9) - lifeMin;
    const scaleStart = opts.scaleStart ?? 0.7, scaleEnd = opts.scaleEnd ?? 0, drag = opts.drag ?? 1;
    const { width, height } = texture.orig;
    // Canvas particle tinting crops the source and misaligns atlas UVs.
    const tint = this.renderer.isCanvas ? 0xffffff : (opts.color ?? 0xffffff);
    for (let i = 0; i < count; i++) {
      const p = this.freeParticles.pop() ?? this.createParticle(texture);
      this.liveParticles.push(p);
      const angle = Math.random() * Math.PI * 2, speed = speedMin + Math.random() * speedRange;
      p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
      p.duration = p.life = lifeMin + Math.random() * lifeRange;
      p.start = scaleStart; p.end = scaleEnd; p.drag = drag;
      if (p.particle.texture !== texture) {
        p.particle.texture = texture;
        this.particleUvsDirty = true;
      }
      p.width = width; p.height = height;
      p.particle.x = x; p.particle.y = y; p.particle.alpha = 1;
      p.particle.scaleX = p.particle.scaleY = p.start;
      p.particle.tint = tint;
    }
    this.active = this.liveParticles.length;
  }
  syncVisibleParticles() {
    const layer = this.particleBatch, children = layer.particleChildren;
    const camera = this.renderer.camera, screen = this.renderer.app.screen;
    const left = camera.x + (-screen.width / 2 - camera.shakeX) / camera.zoom;
    const right = camera.x + (screen.width / 2 - camera.shakeX) / camera.zoom;
    const top = camera.y + (-screen.height / 2 - camera.shakeY) / camera.zoom;
    const bottom = camera.y + (screen.height / 2 - camera.shakeY) / camera.zoom;
    let changed = this.particleUvsDirty;
    let write = 0;
    for (const p of this.liveParticles) {
      const particle = p.particle;
      const scale = particle.scaleX;
      if (scale === 0 || particle.alpha <= 0) continue;
      const x = particle.x, y = particle.y;
      const farX = x + scale * p.width, farY = y + scale * p.height;
      if (scale > 0 ? farX <= left || x >= right || farY <= top || y >= bottom
        : x <= left || farX >= right || y <= top || farY >= bottom) continue;
      if (children[write] !== particle) {
        children[write] = particle;
        changed = true;
      }
      write++;
    }
    if (write !== children.length) {
      children.length = write;
      changed = true;
    }
    if (changed) layer.update();
    this.visibleParticles = write;
    this.particleUvsDirty = false;
  }
  spawnExplosions(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Explosion count must be a non-negative safe integer');
    const screen = this.renderer.app.screen, camera = this.renderer.camera;
    const presets = this.renderer.isCanvas
      ? canvasExplosionOptions.map((option, index) => this.renderer.atlas.textures.has(option.tex) ? option : explosionOptions[index])
      : explosionOptions;
    const width = screen.width / camera.zoom, height = screen.height / camera.zoom;
    const left = camera.x - width / 2 - camera.shakeX / camera.zoom;
    const top = camera.y - height / 2 - camera.shakeY / camera.zoom;
    for (let i = 0; i < count; i++) {
      this.effects.push(3);
      this.burstParticles(left + Math.random() * width, top + Math.random() * height, 8, presets[i % presets.length]);
    }
  }
  update(dt) {
    this.clock += dt; this.hitStop = Math.max(0, this.hitStop - dt); if (!this.hitStop) this.simTimeScale = 1;
    for (const [id, tween] of this.hitTweens) {
      if (this.renderer.entityMap.get(id) !== tween.entry) { this.hitTweens.delete(id); continue; }
      tween.elapsed = Math.min(0.22, tween.elapsed + dt);
      const eased = hitEase(tween.elapsed / 0.22);
      tween.entry.animScaleX = tween.squashX + (1 - tween.squashX) * eased;
      tween.entry.animScaleY = tween.squashY + (1 - tween.squashY) * eased;
      if (tween.elapsed >= 0.22) this.hitTweens.delete(id);
    }
    let filtersChanged = false;
    for (const wave of this.shockwaves) {
      wave.filter.time += dt;
      if (wave.filter.time >= 0.45) {
        this.shockwaves.delete(wave);
        this.freeShockwaves.push(wave);
        filtersChanged = true;
      }
    }
    if (filtersChanged) this.syncShockwaveFilters();
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = 15 * this.trauma * this.trauma;
    this.renderer.camera.shakeX = Math.sin(this.clock * 67) * shake; this.renderer.camera.shakeY = Math.cos(this.clock * 83) * shake;
    let effectWrite = 0;
    for (const life of this.effects) if (life > dt) this.effects[effectWrite++] = life - dt;
    this.effects.length = effectWrite;
    let write = 0;
    let previousDrag = NaN, damping = 1;
    for (const p of this.liveParticles) {
      p.life -= dt;
      if (p.life <= 0) { this.freeParticles.push(p); continue; }
      const t = p.life / p.duration;
      p.particle.x += p.vx * dt; p.particle.y += p.vy * dt;
      if (p.drag !== previousDrag) { previousDrag = p.drag; damping = Math.exp(-p.drag * dt); }
      p.vx *= damping; p.vy *= damping;
      p.particle.alpha = t; p.particle.scaleX = p.particle.scaleY = p.end + (p.start - p.end) * t;
      this.liveParticles[write++] = p;
    }
    this.liveParticles.length = write; this.active = write;
    if (this.trailTime > 0) { this.trailTime -= dt; this.trail.visible = this.trailTime > 0; }
  }
  slash(x, y, angle) {
    for (let i = 0; i < this.points.length; i++) {
      const a = angle - 0.8 + i * 1.6 / (this.points.length - 1);
      this.points[i].set(x + Math.cos(a) * 90, y + Math.sin(a) * 90);
    }
    if (this.renderer.isCanvas) {
      this.trail.clear().moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) this.trail.lineTo(this.points[i].x, this.points[i].y);
      this.trail.stroke({ width: 8, color: 0xc6ffff, alpha: 0.85 });
    }
    this.trail.visible = true; this.trailTime = 0.14;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offBeforeRender();
    this.renderer.setEffectFilters([], this.shockwaveChannel);
    for (const wave of this.shockwaves) wave.filter.destroy();
    for (const wave of this.freeShockwaves) wave.filter.destroy();
    this.freeShockwaves.length = 0;
    this.shockwaves.clear(); this.hitTweens.clear();
    this.particleBatch.removeFromParent();
    this.particleBatch.particleChildren.length = 0;
    this.particleBatch.destroy();
    this.trail.removeFromParent(); this.trail.destroy();
    this.liveParticles.length = 0; this.freeParticles.length = 0;
    this.effects.length = 0; this.active = 0; this.visibleParticles = 0;
  }
}

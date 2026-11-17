import { Particle, MeshRope, Point } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters';
import { gsap } from 'gsap';

const hitEase = gsap.parseEase('elastic.out(1, 0.45)');

export class JuiceSystem {
  constructor(renderer, capacity = 10000) {
    this.renderer = renderer; this.trauma = 0;
    this.hitStop = 0; this.simTimeScale = 1; this.clock = 0; this.active = 0; this.visibleParticles = 0;
    this.effects = []; this.liveParticles = []; this.shockwaves = new Set(); this.hitTweens = new Map();
    this.expiredParticles = [];
    this.particles = Array.from({ length: capacity }, () => {
      const particle = new Particle({ texture: renderer.atlas.get('particle_soft'), x: 0, y: 0, alpha: 0 });
      return { particle, life: 0, duration: 0, vx: 0, vy: 0, start: 1, end: 0, drag: 0 };
    });
    this.freeParticles = this.particles.slice();
    this.points = Array.from({ length: 12 }, () => new Point());
    this.trail = new MeshRope({ texture: renderer.atlas.get('slash_trail'), points: this.points });
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
    const center = this.renderer.worldToScreen(x, y);
    const filter = new ShockwaveFilter({ center, time: 0 });
    this.shockwaves.add(filter); this.syncShockwaveFilters();
  }
  syncShockwaveFilters() {
    this.renderer.app.stage.filters = this.shockwaves.size ? [this.renderer.bloom, ...this.shockwaves] : [];
  }
  burstParticles(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.freeParticles.pop() ?? { particle: new Particle({ texture: this.renderer.atlas.get('particle_soft') }) };
      this.liveParticles.push(p);
      this.renderer.particleLayer.addParticle(p.particle);
      const angle = Math.random() * Math.PI * 2, speed = (opts.speedMin ?? 80) + Math.random() * ((opts.speedMax ?? 300) - (opts.speedMin ?? 80));
      p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
      p.duration = p.life = (opts.lifeMin ?? 0.3) + Math.random() * ((opts.lifeMax ?? 0.9) - (opts.lifeMin ?? 0.3));
      p.start = opts.scaleStart ?? 0.7; p.end = opts.scaleEnd ?? 0; p.drag = opts.drag ?? 1;
      p.particle.texture = this.renderer.atlas.get(opts.tex ?? 'particle_soft');
      p.particle.x = x; p.particle.y = y; p.particle.alpha = 1; p.particle.tint = opts.color ?? 0xffffff;
    }
  }
  spawnExplosions(count) {
    const screen = this.renderer.app.screen;
    for (let i = 0; i < count; i++) {
      const pos = this.renderer.screenToWorld(Math.random() * screen.width, Math.random() * screen.height);
      this.effects.push(3);
      this.burstParticles(pos.x, pos.y, 8, { speedMin: 25, speedMax: 110, lifeMin: 3, lifeMax: 3,
        scaleStart: 0.8, drag: 1.5, color: [0xff6622, 0xffbb33, 0xffed99][i % 3] });
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
    for (const filter of this.shockwaves) {
      filter.time += dt;
      if (filter.time >= 0.45) { this.shockwaves.delete(filter); filter.destroy(); filtersChanged = true; }
    }
    if (filtersChanged) this.syncShockwaveFilters();
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = 15 * this.trauma * this.trauma;
    this.renderer.camera.shakeX = Math.sin(this.clock * 67) * shake; this.renderer.camera.shakeY = Math.cos(this.clock * 83) * shake;
    let effectWrite = 0;
    for (const life of this.effects) if (life > dt) this.effects[effectWrite++] = life - dt;
    this.effects.length = effectWrite;
    let write = 0; this.visibleParticles = 0; const expired = this.expiredParticles; expired.length = 0;
    const camera = this.renderer.camera, screen = this.renderer.app.screen;
    for (const p of this.liveParticles) {
      p.life = Math.max(0, p.life - dt); const t = p.life / p.duration;
      p.particle.x += p.vx * dt; p.particle.y += p.vy * dt;
      const damping = Math.exp(-p.drag * dt); p.vx *= damping; p.vy *= damping;
      p.particle.alpha = t; p.particle.scaleX = p.particle.scaleY = p.end + (p.start - p.end) * t;
      if (p.life <= 0) { expired.push(p.particle); this.freeParticles.push(p); }
      else {
        this.liveParticles[write++] = p;
        const sx = (p.particle.x - camera.x) * camera.zoom + screen.width / 2 + camera.shakeX;
        const sy = (p.particle.y - camera.y) * camera.zoom + screen.height / 2 + camera.shakeY;
        if (sx >= 0 && sx < screen.width && sy >= 0 && sy < screen.height) this.visibleParticles++;
      }
    }
    this.liveParticles.length = write; this.active = write;
    for (let i = 0; i < expired.length; i += 10000) this.renderer.particleLayer.removeParticle(...expired.slice(i, i + 10000));
    if (this.trailTime > 0) { this.trailTime -= dt; this.trail.visible = this.trailTime > 0; }
  }
  slash(x, y, angle) {
    for (let i = 0; i < this.points.length; i++) {
      const a = angle - 0.8 + i * 1.6 / (this.points.length - 1);
      this.points[i].set(x + Math.cos(a) * 90, y + Math.sin(a) * 90);
    }
    this.trail.visible = true; this.trailTime = 0.14;
  }
  dispose() {
    this.renderer.app.stage.filters = [];
    for (const filter of this.shockwaves) filter.destroy();
    this.shockwaves.clear(); this.hitTweens.clear();
    this.liveParticles.length = 0; this.freeParticles.length = 0; this.particles.length = 0;
    this.expiredParticles.length = 0; this.effects.length = 0;
  }
}

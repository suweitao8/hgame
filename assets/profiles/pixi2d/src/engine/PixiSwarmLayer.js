import { Particle, ParticleContainer } from 'pixi.js';

/** Render an HGame CPU SwarmSimulation without allocating per-unit game objects. */
export class PixiSwarmLayer {
  constructor(renderer, { textures = ['enemy_chaser'], scale = 1, worldScale = 1, offsetX = 0, offsetY = 0,
    syncRotation = false, flipByDirection = false, cull = true } = {}) {
    if (!renderer?.worldRoot || !renderer?.atlas?.textures) throw new TypeError('Initialize Renderer2D before creating a swarm layer');
    if (!Array.isArray(textures) || textures.length === 0 || textures.some(name => typeof name !== 'string' || !renderer.atlas.textures.has(name))) {
      throw new TypeError('Swarm textures must be existing atlas frame names');
    }
    if (![scale, worldScale, offsetX, offsetY].every(Number.isFinite) || scale <= 0 || worldScale <= 0) {
      throw new RangeError('Swarm scale and worldScale must be positive and offsets must be finite');
    }
    this.renderer = renderer; this.scale = scale; this.worldScale = worldScale;
    this.offsetX = offsetX; this.offsetY = offsetY; this.syncRotation = Boolean(syncRotation);
    this.flipByDirection = Boolean(flipByDirection); this.cull = Boolean(cull);
    this.frames = textures.map(name => {
      const texture = renderer.atlas.textures.get(name);
      return { texture, white: renderer.atlas.textures.get(name + '_white') ?? texture,
        radius: Math.hypot(texture.orig.width, texture.orig.height) * 0.5 };
    });
    this.layer = new ParticleContainer({ dynamicProperties: { position: true, uvs: true, rotation: true, vertex: true } });
    renderer.worldRoot.addChildAt(this.layer, renderer.worldRoot.getChildIndex(renderer.entityLayer));
    this.particles = []; this.pool = []; this.visibleCount = 0; this.disposed = false;
  }

  sync(swarm) {
    if (this.disposed) throw new Error('Swarm layer is disposed');
    if (!swarm?.activeIds || !swarm.posX || !swarm.posY || !Number.isInteger(swarm.count)) {
      throw new TypeError('sync requires an HGame CPU SwarmSimulation');
    }
    const count = swarm.count;
    if (count < 0 || count > swarm.activeIds.length) throw new RangeError('Swarm count exceeds active ID capacity');
    const camera = this.renderer.camera, screen = this.renderer.app.screen;
    const halfW = screen.width / 2, halfH = screen.height / 2, zoom = camera.zoom;
    if (!(zoom > 0) || !Number.isFinite(zoom)) throw new RangeError('Camera zoom must be finite and positive');
    let used = 0;
    for (let i = 0; i < count; i++) {
      const id = swarm.activeIds[i], x = swarm.posX[id] * this.worldScale + this.offsetX;
      const y = swarm.posY[id] * this.worldScale + this.offsetY;
      const frame = this.frames[(swarm.animClip?.[id] ?? 0) % this.frames.length];
      const size = (swarm.scale?.[id] ?? 1) * this.scale;
      if (this.cull) {
        const sx = (x - camera.x) * zoom + halfW + camera.shakeX;
        const sy = (y - camera.y) * zoom + halfH + camera.shakeY;
        const radius = frame.radius * Math.abs(size) * zoom;
        if (sx + radius < 0 || sx - radius > screen.width || sy + radius < 0 || sy - radius > screen.height) continue;
      }
      let particle = this.particles[used];
      const texture = swarm.flash?.[id] > 0 ? frame.white : frame.texture;
      if (!particle) {
        particle = this.pool.pop() ?? new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
        this.particles.push(particle); this.layer.addParticle(particle);
      }
      if (particle.texture !== texture) particle.texture = texture;
      particle.x = x; particle.y = y;
      const rotation = swarm.rot?.[id] ?? 0;
      particle.rotation = this.syncRotation ? rotation : 0;
      particle.scaleX = this.flipByDirection && Math.sin(rotation) < 0 ? -size : size;
      particle.scaleY = size;
      used++;
    }
    if (used < this.particles.length) {
      const removed = this.particles.splice(used);
      for (let i = 0; i < removed.length; i += 10000) this.layer.removeParticle(...removed.slice(i, i + 10000));
      for (const particle of removed) this.pool.push(particle);
    }
    this.visibleCount = used;
    return used;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.layer.removeFromParent(); this.layer.destroy();
    this.particles.length = 0; this.pool.length = 0; this.visibleCount = 0;
    this.renderer.swarmLayers.delete(this);
  }
}

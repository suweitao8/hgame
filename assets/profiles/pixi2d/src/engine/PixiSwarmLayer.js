import { Particle, ParticleContainer } from 'pixi.js';

/** Render an HGame CPU SwarmSimulation without allocating per-unit game objects. */
export class PixiSwarmLayer {
  constructor(renderer, { textures = ['enemy_chaser'], clips = null, scale = 1, worldScale = 1, offsetX = 0, offsetY = 0,
    syncRotation = false, flipByDirection = false, cull = true } = {}) {
    if (!renderer?.worldRoot || !renderer?.atlas?.textures) throw new TypeError('Initialize Renderer2D before creating a swarm layer');
    const definitions = clips ?? (Array.isArray(textures) ? textures.map(name => ({ frames: [name] })) : null);
    if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('Swarm clips or textures must be a non-empty array');
    if (![scale, worldScale, offsetX, offsetY].every(Number.isFinite) || scale <= 0 || worldScale <= 0) {
      throw new RangeError('Swarm scale and worldScale must be positive and offsets must be finite');
    }
    this.renderer = renderer; this.scale = scale; this.worldScale = worldScale;
    this.offsetX = offsetX; this.offsetY = offsetY; this.syncRotation = Boolean(syncRotation);
    this.flipByDirection = Boolean(flipByDirection); this.cull = Boolean(cull);
    this.clips = definitions.map(clip => {
      if (!clip || !Array.isArray(clip.frames) || clip.frames.length === 0 ||
          clip.frames.some(name => typeof name !== 'string' || !renderer.atlas.textures.has(name))) {
        throw new TypeError('Swarm clip frames must be existing atlas frame names');
      }
      const fps = clip.fps ?? 8;
      if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('Swarm clip fps must be positive');
      const frames = clip.frames.map(name => {
        const texture = renderer.atlas.textures.get(name);
        return { texture, white: renderer.atlas.textures.get(name + '_white') ?? texture,
          radius: Math.hypot(texture.orig.width, texture.orig.height) * 0.5 };
      });
      return { frames, fps, loop: clip.loop !== false, radius: Math.max(...frames.map(frame => frame.radius)) };
    });
    this.dynamicUvs = this.clips.some(clip => clip.frames.length > 1);
    this.dynamicRotation = this.syncRotation;
    this.layer = new ParticleContainer({
      dynamicProperties: { position: true, uvs: this.dynamicUvs, rotation: this.dynamicRotation, vertex: true },
    });
    renderer.worldRoot.addChildAt(this.layer, renderer.worldRoot.getChildIndex(renderer.entityLayer));
    this.particles = []; this.pool = []; this.pendingParticles = []; this.visibleCount = 0; this.disposed = false;
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
    // Transform the viewport once, rather than each unit into screen space.
    const left = camera.x + (-halfW - camera.shakeX) / zoom;
    const right = camera.x + (halfW - camera.shakeX) / zoom;
    const top = camera.y + (-halfH - camera.shakeY) / zoom;
    const bottom = camera.y + (halfH - camera.shakeY) / zoom;
    const clips = this.clips, singleClip = clips.length === 1 ? clips[0] : null;
    const positionsX = swarm.posX, positionsY = swarm.posY, activeIds = swarm.activeIds;
    const animClips = swarm.animClip, scales = swarm.scale, rotations = swarm.rot;
    const animTimes = swarm.animTime, flashes = swarm.flash;
    const worldScale = this.worldScale, offsetX = this.offsetX, offsetY = this.offsetY;
    const renderScale = this.scale, cull = this.cull, syncRotation = this.syncRotation, flipByDirection = this.flipByDirection;
    const dynamicUvs = this.dynamicUvs, dynamicRotation = this.dynamicRotation;
    let staticDirty = false;
    let used = 0;
    for (let i = 0; i < count; i++) {
      const id = activeIds[i], x = positionsX[id] * worldScale + offsetX;
      const y = positionsY[id] * worldScale + offsetY;
      const clip = singleClip ?? clips[(animClips?.[id] ?? 0) % clips.length];
      const size = (scales?.[id] ?? 1) * renderScale;
      if (cull) {
        const radius = clip.radius * Math.abs(size);
        if (x + radius < left || x - radius > right || y + radius < top || y - radius > bottom) continue;
      }
      let frameIndex = 0;
      if (clip.frames.length > 1) {
        const time = animTimes?.[id] ?? 0;
        const elapsedFrames = Number.isFinite(time) ? Math.max(0, Math.floor(time * clip.fps)) : 0;
        frameIndex = clip.loop ? elapsedFrames % clip.frames.length : Math.min(elapsedFrames, clip.frames.length - 1);
      }
      const frame = clip.frames[frameIndex];
      let particle = this.particles[used];
      const texture = flashes?.[id] > 0 ? frame.white : frame.texture;
      if (!particle) {
        particle = this.pool.pop() ?? new Particle({ texture, anchorX: 0.5, anchorY: 0.5 });
        this.particles.push(particle); this.pendingParticles.push(particle);
        if (this.pendingParticles.length === 4096) this.flushPending();
      }
      if (particle.texture !== texture) {
        particle.texture = texture;
        if (!dynamicUvs) staticDirty = true;
      }
      particle.x = x; particle.y = y;
      const rotation = syncRotation || flipByDirection ? (rotations?.[id] ?? 0) : 0;
      const renderRotation = syncRotation ? rotation : 0;
      if (particle.rotation !== renderRotation) {
        particle.rotation = renderRotation;
        if (!dynamicRotation) staticDirty = true;
      }
      particle.scaleX = flipByDirection && Math.sin(rotation) < 0 ? -size : size;
      particle.scaleY = size;
      used++;
    }
    this.flushPending();
    if (used < this.particles.length) {
      for (let i = used; i < this.particles.length; i++) this.pool.push(this.particles[i]);
      this.particles.length = used;
      this.layer.particleChildren.length = used;
      staticDirty = true;
    }
    if (staticDirty) this.layer.update();
    this.visibleCount = used;
    return used;
  }

  flushPending() {
    if (this.pendingParticles.length) this.layer.addParticle(...this.pendingParticles);
    this.pendingParticles.length = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.layer.removeFromParent(); this.layer.destroy();
    this.particles.length = 0; this.pool.length = 0; this.pendingParticles.length = 0; this.visibleCount = 0;
    this.renderer.swarmLayers.delete(this);
  }
}

import { createEmitter } from '../platform/events.js';

/** Frame-index animation state; attach to a sprite's frame property as needed. */
export class AnimationPlayer {
  constructor() {
    this.animations = new Map();
    this.events = createEmitter();
    this.name = null;
    this.index = 0;
    this.frame = 0;
    this.elapsed = 0;
    this.playing = false;
  }
  on(type, listener) { return this.events.on(type, listener); }
  define(name, { frames, fps = 8, loop = true } = {}) {
    if (!name || !Array.isArray(frames) || frames.length === 0 || !Number.isFinite(fps) || fps <= 0) {
      throw new TypeError('Animation requires name, frames and fps > 0');
    }
    this.animations.set(name, { frames: [...frames], fps, loop: Boolean(loop) });
    return this;
  }
  play(name, { restart = false } = {}) {
    if (!this.animations.has(name)) throw new Error('Unknown animation: ' + name);
    if (this.name === name && this.playing && !restart) return this;
    this.name = name;
    this.index = 0;
    this.elapsed = 0;
    this.frame = this.animations.get(name).frames[0];
    this.playing = true;
    return this;
  }
  pause() { this.playing = false; }
  resume() { if (this.name) this.playing = true; }
  update(dt) {
    if (!this.playing || !this.name) return this.frame;
    const animation = this.animations.get(this.name);
    this.elapsed += Math.max(0, dt);
    const frameDuration = 1 / animation.fps;
    let advances = Math.floor(this.elapsed / frameDuration + 1e-9);
    if (!advances) return this.frame;
    advances = Math.min(advances, 10000);
    this.elapsed -= advances * frameDuration;
    const nextIndex = this.index + advances;
    if (animation.loop) this.index = nextIndex % animation.frames.length;
    else {
      this.index = Math.min(animation.frames.length - 1, nextIndex);
      if (nextIndex >= animation.frames.length) {
        this.playing = false;
        this.events.emit('complete', this.name);
      }
    }
    this.frame = animation.frames[this.index];
    return this.frame;
  }
  dispose() { this.animations.clear(); this.events.clear(); }
}

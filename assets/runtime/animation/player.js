import { createEmitter } from '../platform/events.js';

/**
 * @typedef {object} AnimationDefinition
 * @property {readonly number[]} frames Frame indices (non-empty).
 * @property {number} [fps=8] Frames per second (> 0).
 * @property {boolean} [loop=true]
 */

/**
 * @typedef {object} AnimationClip Stored clip.
 * @property {number[]} frames
 * @property {number} fps Frames per second.
 * @property {boolean} loop
 */

/** @typedef {{ complete: string }} AnimationEvents `complete` carries the finished animation name. */

/**
 * @typedef {object} AnimationPlayOptions
 * @property {boolean} [restart=false] Restart even if the clip is already playing.
 */
/** Frame-index animation state; attach to a sprite's frame property as needed. */
export class AnimationPlayer {
  /** Create an empty player. */
  constructor() {
    /** @type {Map<string, AnimationClip>} */
    this.animations = new Map();
    /** @type {import('../platform/events.js').Emitter<AnimationEvents>} */
    this.events = createEmitter();
    /** Current clip name. @type {string | null} */
    this.name = null;
    /** Index into the current clip's frames. @type {number} */
    this.index = 0;
    /** Current frame value. @type {number} */
    this.frame = 0;
    /** Seconds accumulated toward the next frame. @type {number} */
    this.elapsed = 0;
    this.playing = false;
  }
  /**
   * Subscribe to player events.
   * @param {'complete'} type
   * @param {(name: string) => void} listener
   * @returns {() => boolean} Unsubscribe.
   */
  on(type, listener) { return this.events.on(type, listener); }
  /**
   * @param {string} name
   * @param {AnimationDefinition} definition
   * @returns {this}
   */
  define(name, { frames, fps = 8, loop = true } = {}) {
    if (!name || !Array.isArray(frames) || frames.length === 0 || !Number.isFinite(fps) || fps <= 0) {
      throw new TypeError('Animation requires name, frames and fps > 0');
    }
    this.animations.set(name, { frames: [...frames], fps, loop: Boolean(loop) });
    return this;
  }
  /**
   * @param {string} name
   * @param {AnimationPlayOptions} [options]
   * @returns {this}
   */
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
  /** @returns {void} */
  pause() { this.playing = false; }
  /** @returns {void} */
  resume() { if (this.name) this.playing = true; }
  /**
   * Advance playback.
   * @param {number} dt Seconds.
   * @returns {number} Current frame value.
   */
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
  /** @returns {void} */
  dispose() { this.animations.clear(); this.events.clear(); }
}

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
    /** @type {Map<string, AnimationClip>} */
    animations: Map<string, AnimationClip>;
    /** @type {import('../platform/events.js').Emitter<AnimationEvents>} */
    events: import("../platform/events.js").Emitter<AnimationEvents>;
    /** Current clip name. @type {string | null} */
    name: string | null;
    /** Index into the current clip's frames. @type {number} */
    index: number;
    /** Current frame value. @type {number} */
    frame: number;
    /** Seconds accumulated toward the next frame. @type {number} */
    elapsed: number;
    playing: boolean;
    /**
     * Subscribe to player events.
     * @param {'complete'} type
     * @param {(name: string) => void} listener
     * @returns {() => boolean} Unsubscribe.
     */
    on(type: "complete", listener: (name: string) => void): () => boolean;
    /**
     * @param {string} name
     * @param {AnimationDefinition} definition
     * @returns {this}
     */
    define(name: string, { frames, fps, loop }?: AnimationDefinition): this;
    /**
     * @param {string} name
     * @param {AnimationPlayOptions} [options]
     * @returns {this}
     */
    play(name: string, { restart }?: AnimationPlayOptions): this;
    /** @returns {void} */
    pause(): void;
    /** @returns {void} */
    resume(): void;
    /**
     * Advance playback.
     * @param {number} dt Seconds.
     * @returns {number} Current frame value.
     */
    update(dt: number): number;
    /** @returns {void} */
    dispose(): void;
}
export type AnimationDefinition = {
    /**
     * Frame indices (non-empty).
     */
    frames: readonly number[];
    /**
     * Frames per second (> 0).
     */
    fps?: number;
    loop?: boolean;
};
/**
 * Stored clip.
 */
export type AnimationClip = {
    frames: number[];
    /**
     * Frames per second.
     */
    fps: number;
    loop: boolean;
};
/**
 * `complete` carries the finished animation name.
 */
export type AnimationEvents = {
    complete: string;
};
export type AnimationPlayOptions = {
    /**
     * Restart even if the clip is already playing.
     */
    restart?: boolean;
};

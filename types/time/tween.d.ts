/**
 * Frame-rate-independent exponential smoothing toward `target` with exact
 * `halfLife` decay (time in seconds for remaining error to halve).
 *
 * @param {number} current
 * @param {number} target
 * @param {number} halfLife
 * @param {number} dt
 * @returns {number}
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number;
/**
 * Frame-rate-independent shortest-arc exponential angular smoothing in radians.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} halfLife
 * @param {number} dt
 * @returns {number}
 */
export function dampAngle(current: number, target: number, halfLife: number, dt: number): number;
/**
 * Advances a 1D critically damped spring `{ value, velocity }` in place using
 * the exact closed-form analytical solution (frame-rate independent).
 *
 * @param {SpringState1D} state
 * @param {number} target
 * @param {number | SpringHalfLifeOptions} halfLifeOrOptions Half-life in seconds, or options.
 * @param {number} dt Seconds.
 * @param {number} [maxSpeed=Infinity] Units/second.
 * @returns {SpringState1D} `state`
 */
export function stepSpring1D(state: SpringState1D, target: number, halfLifeOrOptions: number | SpringHalfLifeOptions, dt: number, maxSpeed?: number | undefined): SpringState1D;
/** @typedef {(t: number) => number} EaseFunction Maps normalized time 0..1 to eased progress. */
/** @typedef {'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic' | 'easeInSine' | 'easeOutSine' | 'easeInOutSine' | 'easeInExpo' | 'easeOutExpo' | 'easeInBack' | 'easeOutBack' | 'easeInOutBack' | 'easeOutElastic' | 'easeOutBounce'} EaseName */
/** @typedef {EaseName | EaseFunction} Ease Built-in easing name or custom function. */
/**
 * Numeric properties of `T` that may be tweened.
 * @template T
 * @typedef {{ [K in keyof T]?: T[K] extends number ? number : never }} TweenValues
 */
/**
 * @template {object} T
 * @typedef {object} TweenOptions
 * @property {number} [duration=0.3] Seconds per cycle (>= 0; 0 applies immediately).
 * @property {number} [delay=0] Seconds before starting (>= 0).
 * @property {Ease} [ease='linear']
 * @property {number} [repeat=0] Extra cycles (integer >= 0, `Infinity` or `-1` loops forever).
 * @property {boolean} [yoyo=false] Reverse every other cycle.
 * @property {string | null} [tag=null] Group name for {@link TweenManager#killTweensOf} / `overwrite`.
 * @property {boolean} [overwrite=false] Cancel existing tweens on the same target sharing a key or tag.
 * @property {((target: T, t: number) => void) | null} [onUpdate=null] Called after each step with eased-input progress 0..1.
 * @property {(() => void) | null} [onComplete=null]
 */
/**
 * @template {object} T
 * @typedef {object} TweenHandle Active tween record; call `cancel()` to stop it.
 * @property {T} target
 * @property {string[]} keys Tweened property names.
 * @property {number} count Number of tweened properties.
 * @property {Float64Array} from Start values.
 * @property {Float64Array} to End values.
 * @property {number} duration Seconds per cycle.
 * @property {number} delayRemaining Seconds.
 * @property {boolean} started
 * @property {EaseFunction} ease
 * @property {number} maxCycles Total cycles (Infinity when looping).
 * @property {boolean} yoyo
 * @property {string | null} tag
 * @property {number} elapsed Seconds since the delay ended.
 * @property {((target: T, t: number) => void) | null} onUpdate
 * @property {(() => void) | null} onComplete
 * @property {() => boolean} cancel Remove the tween; false if it was already gone.
 */
/**
 * @template {object} T
 * @typedef {object} SequenceStep
 * @property {TweenValues<T>} [values={}] Target values for this step.
 * @property {number} [duration=0.2] Seconds.
 * @property {number} [delay=0] Seconds.
 * @property {number} [wait=0] Extra pause in seconds (a value-less step with `wait` and no `duration` is a pure wait).
 * @property {Ease} [ease='linear']
 * @property {number} [repeat=0]
 * @property {boolean} [yoyo=false]
 * @property {((target: T) => void) | null} [onStart=null]
 * @property {((target: T) => void) | null} [onComplete=null]
 */
/**
 * @template {object} T
 * @typedef {object} SequenceOptions
 * @property {string | null} [tag=null]
 * @property {(() => void) | null} [onComplete=null]
 */
/**
 * @template {object} T
 * @typedef {object} SequenceHandle
 * @property {T} target
 * @property {string | null} tag
 * @property {boolean} finished True once every step completed.
 * @property {() => void} cancel
 */
/** @typedef {{ cancel: () => void }} LoopHandle Cancelable handle of a looping effect. */
/**
 * @typedef {object} VisualTweenTarget Decoupled Sprite2D visual fields (missing fields are initialised).
 * @property {number} [offsetX] Pixels.
 * @property {number} [offsetY] Pixels.
 * @property {number} [scaleX]
 * @property {number} [scaleY]
 * @property {number} [rotation] Radians.
 * @property {number} [opacity] 0..1.
 */
/**
 * @typedef {object} IdleOptions
 * @property {number} [scaleAmt=0.06] Breathing scale amplitude (ratio).
 * @property {number} [duration=0.55] Half-cycle seconds.
 */
/**
 * @typedef {object} RunOptions
 * @property {number} [bobHeight=5] Vertical bob, pixels.
 * @property {number} [tiltRad=0.12] Waddle tilt, radians.
 * @property {number} [squashAmt=0.08] Squash/stretch amplitude (ratio).
 * @property {number} [duration=0.18] Bob half-cycle, seconds.
 */
/**
 * @typedef {object} AttackLungeOptions
 * @property {number} [distance=18] Strike distance, pixels.
 * @property {number} [windup=0.05] Seconds.
 * @property {number} [strike=0.08] Seconds.
 * @property {number} [recover=0.14] Seconds.
 * @property {number} [stretch=0.18] Squash/stretch amplitude (ratio).
 * @property {((target: VisualTweenTarget) => void) | null} [onApex=null] Called at the end of the strike step.
 * @property {(() => void) | null} [onComplete=null]
 */
/**
 * @typedef {object} DieKnockbackOptions
 * @property {number} [distance=24] Knockback distance, pixels.
 * @property {number} [duration=0.32] Seconds.
 * @property {number} [spinRad=0.35] Added rotation, radians.
 * @property {number} [endScale=0.72] Final scale (ratio).
 * @property {(() => void) | null} [onComplete=null]
 */
/**
 * @typedef {object} TimerEntry
 * @property {number} delay Seconds.
 * @property {number} remaining Seconds.
 * @property {() => void} callback
 * @property {boolean} repeat
 */
/** Built-in easing curves. @type {Readonly<Record<EaseName, EaseFunction>>} */
export const EASING: Readonly<Record<EaseName, EaseFunction>>;
/** Scene-local tweens, sequences and logical timers; updated by the application scheduler. */
export class TweenManager {
    /** @type {Set<TweenHandle<object>>} */
    tweens: Set<TweenHandle<object>>;
    /** @type {Map<number, TimerEntry>} */
    timers: Map<number, TimerEntry>;
    /** Last issued timer id. @type {number} */
    id: number;
    /** @type {Set<SequenceHandle<object>>} */
    _sequences: Set<SequenceHandle<object>>;
    /** @type {TweenHandle<object>[]} */
    _tweenStep: TweenHandle<object>[];
    /** @type {[number, TimerEntry][]} */
    _timerStep: [number, TimerEntry][];
    _generation: number;
    /**
     * Tween numeric properties of `target` to `values`.
     * @template {object} T
     * @param {T} target
     * @param {TweenValues<T>} values End values (finite numbers).
     * @param {TweenOptions<T>} [options]
     * @returns {TweenHandle<T>}
     */
    add<T extends unknown>(target: T, values: TweenValues<T>, { duration, delay, ease, repeat, yoyo, tag, overwrite, onUpdate, onComplete, }?: TweenOptions<T> | undefined): TweenHandle<T>;
    /**
     * Cancel tweens and sequences on `target`.
     * @param {object} target
     * @param {string | null} [tag=null] Only those with this tag.
     * @returns {number} Number removed.
     */
    killTweensOf(target: object, tag?: string | null | undefined): number;
    /**
     * Run tween steps one after another.
     * @template {object} T
     * @param {T} target
     * @param {readonly SequenceStep<T>[]} steps
     * @param {SequenceOptions<T>} [options]
     * @returns {SequenceHandle<T>}
     */
    sequence<T extends unknown>(target: T, steps: readonly SequenceStep<T>[], { tag, onComplete }?: SequenceOptions<T> | undefined): SequenceHandle<T>;
    /**
     * Continuous breathing idle loop on decoupled Sprite2D visual properties.
     * @param {VisualTweenTarget} target
     * @param {IdleOptions} [options]
     * @returns {TweenHandle<VisualTweenTarget>}
     */
    idle(target: VisualTweenTarget, { scaleAmt, duration }?: IdleOptions | undefined): TweenHandle<VisualTweenTarget>;
    /**
     * Continuous procedural run bob + squash + waddle tilt loop.
     * @param {VisualTweenTarget} target
     * @param {RunOptions} [options]
     * @returns {LoopHandle}
     */
    run(target: VisualTweenTarget, { bobHeight, tiltRad, squashAmt, duration }?: RunOptions | undefined): LoopHandle;
    /**
     * Three-stage windup -> strike -> recover lunge toward (dirX, dirY).
     * @param {VisualTweenTarget} target
     * @param {number} [dirX=1] Direction x (normalized internally).
     * @param {number} [dirY=0] Direction y.
     * @param {AttackLungeOptions} [options]
     * @returns {SequenceHandle<VisualTweenTarget>}
     */
    attackLunge(target: VisualTweenTarget, dirX?: number | undefined, dirY?: number | undefined, { distance, windup, strike, recover, stretch, onApex, onComplete, }?: AttackLungeOptions | undefined): SequenceHandle<VisualTweenTarget>;
    /**
     * Knockback slide, tilt, shrink, and fade-out for defeated entities.
     * @param {VisualTweenTarget} target
     * @param {number} [dirX=-1] Direction x (normalized internally).
     * @param {number} [dirY=0] Direction y.
     * @param {DieKnockbackOptions} [options]
     * @returns {TweenHandle<VisualTweenTarget>}
     */
    dieKnockback(target: VisualTweenTarget, dirX?: number | undefined, dirY?: number | undefined, { distance, duration, spinRad, endScale, onComplete, }?: DieKnockbackOptions | undefined): TweenHandle<VisualTweenTarget>;
    /** Run `callback` once after `seconds` of tween time. @param {number} seconds (> 0) @param {() => void} callback @returns {number} Timer id for {@link TweenManager#cancel}. */
    after(seconds: number, callback: () => void): number;
    /** Run `callback` every `seconds` of tween time. @param {number} seconds (> 0) @param {() => void} callback @returns {number} Timer id for {@link TweenManager#cancel}. */
    every(seconds: number, callback: () => void): number;
    /** @param {number} seconds @param {() => void} callback @param {boolean} repeat @returns {number} */
    _timer(seconds: number, callback: () => void, repeat: boolean): number;
    /** Cancel a timer. @param {number} id @returns {boolean} False if unknown. */
    cancel(id: number): boolean;
    /** Advance tweens and timers. @param {number} dt Seconds (>= 0). @returns {void} */
    update(dt: number): void;
    /** Cancel everything. @returns {void} */
    dispose(): void;
}
/**
 * Solution to `(1 + u) * exp(-u) = 0.5`, relating critically damped
 * angular frequency `omega = LN2_CRIT / halfLife` to scalar half-life.
 */
export const LN2_CRIT: 1.6783469900166605;
/**
 * Stateful 1D analytical critically damped spring.
 */
export class SpringDamper1D {
    /** @param {SpringDamper1DOptions} [options] */
    constructor({ value, velocity, target, halfLife, maxSpeed }?: SpringDamper1DOptions | undefined);
    value: number;
    velocity: number;
    target: number;
    halfLife: number;
    maxSpeed: number;
    /** @param {number} target @returns {this} */
    setTarget(target: number): this;
    /** Jump to `value` and stop (units / units-per-second). @param {number} [value] @param {number} [velocity=0] @returns {this} */
    snap(value?: number | undefined, velocity?: number | undefined): this;
    /** Advance by `dt` seconds. @param {number} dt @param {number} [target] @returns {number} The new value. */
    step(dt: number, target?: number | undefined): number;
    /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
    isSettled(epsilon?: number | undefined, velocityEpsilon?: number | undefined): boolean;
}
/**
 * Stateful 2D analytical critically damped spring (zero per-step allocations).
 */
export class SpringDamper2D {
    /** @param {SpringDamper2DOptions} [options] */
    constructor({ x, y, vx, vy, targetX, targetY, halfLife, maxSpeed, }?: SpringDamper2DOptions | undefined);
    x: number;
    y: number;
    vx: number;
    vy: number;
    targetX: number;
    targetY: number;
    halfLife: number;
    maxSpeed: number;
    /** @param {number} x @param {number} y @returns {this} */
    setTarget(x: number, y: number): this;
    /** Jump to (x, y) with the given velocity (units/second). @param {number} [x] @param {number} [y] @param {number} [vx=0] @param {number} [vy=0] @returns {this} */
    snap(x?: number | undefined, y?: number | undefined, vx?: number | undefined, vy?: number | undefined): this;
    /** Advance by `dt` seconds. @param {number} dt @param {number} [targetX] @param {number} [targetY] @returns {this} */
    step(dt: number, targetX?: number | undefined, targetY?: number | undefined): this;
    /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
    isSettled(epsilon?: number | undefined, velocityEpsilon?: number | undefined): boolean;
}
/**
 * Stateful 3D analytical critically damped spring (zero per-step allocations).
 */
export class SpringDamper3D {
    /** @param {SpringDamper3DOptions} [options] */
    constructor({ x, y, z, vx, vy, vz, targetX, targetY, targetZ, halfLife, maxSpeed, }?: SpringDamper3DOptions | undefined);
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    halfLife: number;
    maxSpeed: number;
    /** @param {number} x @param {number} y @param {number} z @returns {this} */
    setTarget(x: number, y: number, z: number): this;
    /** Jump to (x, y, z) with the given velocity (units/second). @param {number} [x] @param {number} [y] @param {number} [z] @param {number} [vx=0] @param {number} [vy=0] @param {number} [vz=0] @returns {this} */
    snap(x?: number | undefined, y?: number | undefined, z?: number | undefined, vx?: number | undefined, vy?: number | undefined, vz?: number | undefined): this;
    /** Advance by `dt` seconds. @param {number} dt @param {number} [targetX] @param {number} [targetY] @param {number} [targetZ] @returns {this} */
    step(dt: number, targetX?: number | undefined, targetY?: number | undefined, targetZ?: number | undefined): this;
    /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
    isSettled(epsilon?: number | undefined, velocityEpsilon?: number | undefined): boolean;
}
/**
 * Maps normalized time 0..1 to eased progress.
 */
export type EaseFunction = (t: number) => number;
export type EaseName = "linear" | "easeInQuad" | "easeOutQuad" | "easeInOutQuad" | "easeInCubic" | "easeOutCubic" | "easeInOutCubic" | "easeInSine" | "easeOutSine" | "easeInOutSine" | "easeInExpo" | "easeOutExpo" | "easeInBack" | "easeOutBack" | "easeInOutBack" | "easeOutElastic" | "easeOutBounce";
/**
 * Built-in easing name or custom function.
 */
export type Ease = EaseName | EaseFunction;
/**
 * Numeric properties of `T` that may be tweened.
 */
export type TweenValues<T> = { [K in keyof T]?: T[K] extends number ? number : never; };
export type TweenOptions<T extends unknown> = {
    /**
     * Seconds per cycle (>= 0; 0 applies immediately).
     */
    duration?: number | undefined;
    /**
     * Seconds before starting (>= 0).
     */
    delay?: number | undefined;
    ease?: Ease | undefined;
    /**
     * Extra cycles (integer >= 0, `Infinity` or `-1` loops forever).
     */
    repeat?: number | undefined;
    /**
     * Reverse every other cycle.
     */
    yoyo?: boolean | undefined;
    /**
     * Group name for {@link TweenManager#killTweensOf} / `overwrite`.
     */
    tag?: string | null | undefined;
    /**
     * Cancel existing tweens on the same target sharing a key or tag.
     */
    overwrite?: boolean | undefined;
    /**
     * Called after each step with eased-input progress 0..1.
     */
    onUpdate?: ((target: T, t: number) => void) | null | undefined;
    onComplete?: (() => void) | null | undefined;
};
/**
 * Active tween record; call `cancel()` to stop it.
 */
export type TweenHandle<T extends unknown> = {
    target: T;
    /**
     * Tweened property names.
     */
    keys: string[];
    /**
     * Number of tweened properties.
     */
    count: number;
    /**
     * Start values.
     */
    from: Float64Array;
    /**
     * End values.
     */
    to: Float64Array;
    /**
     * Seconds per cycle.
     */
    duration: number;
    /**
     * Seconds.
     */
    delayRemaining: number;
    started: boolean;
    ease: EaseFunction;
    /**
     * Total cycles (Infinity when looping).
     */
    maxCycles: number;
    yoyo: boolean;
    tag: string | null;
    /**
     * Seconds since the delay ended.
     */
    elapsed: number;
    onUpdate: ((target: T, t: number) => void) | null;
    onComplete: (() => void) | null;
    /**
     * Remove the tween; false if it was already gone.
     */
    cancel: () => boolean;
};
export type SequenceStep<T extends unknown> = {
    /**
     * Target values for this step.
     */
    values?: TweenValues<T> | undefined;
    /**
     * Seconds.
     */
    duration?: number | undefined;
    /**
     * Seconds.
     */
    delay?: number | undefined;
    /**
     * Extra pause in seconds (a value-less step with `wait` and no `duration` is a pure wait).
     */
    wait?: number | undefined;
    ease?: Ease | undefined;
    repeat?: number | undefined;
    yoyo?: boolean | undefined;
    onStart?: ((target: T) => void) | null | undefined;
    onComplete?: ((target: T) => void) | null | undefined;
};
export type SequenceOptions<T extends unknown> = {
    tag?: string | null | undefined;
    onComplete?: (() => void) | null | undefined;
};
export type SequenceHandle<T extends unknown> = {
    target: T;
    tag: string | null;
    /**
     * True once every step completed.
     */
    finished: boolean;
    cancel: () => void;
};
/**
 * Cancelable handle of a looping effect.
 */
export type LoopHandle = {
    cancel: () => void;
};
/**
 * Decoupled Sprite2D visual fields (missing fields are initialised).
 */
export type VisualTweenTarget = {
    /**
     * Pixels.
     */
    offsetX?: number | undefined;
    /**
     * Pixels.
     */
    offsetY?: number | undefined;
    scaleX?: number | undefined;
    scaleY?: number | undefined;
    /**
     * Radians.
     */
    rotation?: number | undefined;
    /**
     * 0..1.
     */
    opacity?: number | undefined;
};
export type IdleOptions = {
    /**
     * Breathing scale amplitude (ratio).
     */
    scaleAmt?: number | undefined;
    /**
     * Half-cycle seconds.
     */
    duration?: number | undefined;
};
export type RunOptions = {
    /**
     * Vertical bob, pixels.
     */
    bobHeight?: number | undefined;
    /**
     * Waddle tilt, radians.
     */
    tiltRad?: number | undefined;
    /**
     * Squash/stretch amplitude (ratio).
     */
    squashAmt?: number | undefined;
    /**
     * Bob half-cycle, seconds.
     */
    duration?: number | undefined;
};
export type AttackLungeOptions = {
    /**
     * Strike distance, pixels.
     */
    distance?: number | undefined;
    /**
     * Seconds.
     */
    windup?: number | undefined;
    /**
     * Seconds.
     */
    strike?: number | undefined;
    /**
     * Seconds.
     */
    recover?: number | undefined;
    /**
     * Squash/stretch amplitude (ratio).
     */
    stretch?: number | undefined;
    /**
     * Called at the end of the strike step.
     */
    onApex?: ((target: VisualTweenTarget) => void) | null | undefined;
    onComplete?: (() => void) | null | undefined;
};
export type DieKnockbackOptions = {
    /**
     * Knockback distance, pixels.
     */
    distance?: number | undefined;
    /**
     * Seconds.
     */
    duration?: number | undefined;
    /**
     * Added rotation, radians.
     */
    spinRad?: number | undefined;
    /**
     * Final scale (ratio).
     */
    endScale?: number | undefined;
    onComplete?: (() => void) | null | undefined;
};
export type TimerEntry = {
    /**
     * Seconds.
     */
    delay: number;
    /**
     * Seconds.
     */
    remaining: number;
    callback: () => void;
    repeat: boolean;
};
export type SpringHalfLifeOptions = {
    /**
     * Seconds for the remaining error to halve.
     */
    halfLife?: number | undefined;
    /**
     * Overrides `halfLife` (rad/s).
     */
    angularFrequency?: number | undefined;
    /**
     * Velocity cap (units/second).
     */
    maxSpeed?: number | undefined;
};
/**
 * Mutable 1D spring state.
 */
export type SpringState1D = {
    value: number;
    velocity: number;
};
export type SpringDamper1DOptions = {
    value?: number | undefined;
    /**
     * Units/second.
     */
    velocity?: number | undefined;
    target?: number | undefined;
    /**
     * Seconds.
     */
    halfLife?: number | undefined;
    /**
     * Units/second.
     */
    maxSpeed?: number | undefined;
};
export type SpringDamper2DOptions = {
    x?: number | undefined;
    y?: number | undefined;
    /**
     * Units/second.
     */
    vx?: number | undefined;
    /**
     * Units/second.
     */
    vy?: number | undefined;
    targetX?: number | undefined;
    targetY?: number | undefined;
    /**
     * Seconds.
     */
    halfLife?: number | undefined;
    /**
     * Speed cap, units/second.
     */
    maxSpeed?: number | undefined;
};
export type SpringDamper3DOptions = {
    x?: number | undefined;
    y?: number | undefined;
    z?: number | undefined;
    /**
     * Units/second.
     */
    vx?: number | undefined;
    /**
     * Units/second.
     */
    vy?: number | undefined;
    /**
     * Units/second.
     */
    vz?: number | undefined;
    targetX?: number | undefined;
    targetY?: number | undefined;
    targetZ?: number | undefined;
    /**
     * Seconds.
     */
    halfLife?: number | undefined;
    /**
     * Speed cap, units/second.
     */
    maxSpeed?: number | undefined;
};

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
export const EASING = Object.freeze({
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: t => t * t * t,
  easeOutCubic: t => 1 - (1 - t) ** 3,
  easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),
  easeInSine: t => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: t => Math.sin((t * Math.PI) / 2),
  easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInExpo: t => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: t => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInBack: t => {
    const c1 = 1.70158;
    return (c1 + 1) * t * t * t - c1 * t * t;
  },
  easeOutBack: t => {
    const c1 = 1.70158;
    const u = t - 1;
    return 1 + (c1 + 1) * u * u * u + c1 * u * u;
  },
  easeInOutBack: t => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    if (t < 0.5) return (((2 * t) ** 2) * ((c2 + 1) * 2 * t - c2)) / 2;
    return ((((2 * t - 2) ** 2) * ((c2 + 1) * (t * 2 - 2) + c2)) + 2) / 2;
  },
  easeOutElastic: t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return (2 ** (-10 * t)) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeOutBounce: t => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) {
      const u = t - 1.5 / d1;
      return n1 * u * u + 0.75;
    }
    if (t < 2.5 / d1) {
      const u = t - 2.25 / d1;
      return n1 * u * u + 0.9375;
    }
    const u = t - 2.625 / d1;
    return n1 * u * u + 0.984375;
  },
});

/** @param {Ease} ease @returns {EaseFunction} */
function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  const fn = EASING[ease];
  if (!fn) throw new Error('Unknown easing: ' + ease);
  return fn;
}

/** @param {number} repeat @returns {number} */
function normalizeRepeat(repeat) {
  if (repeat === Infinity || repeat === -1) return Infinity;
  if (!Number.isInteger(repeat) || repeat < 0) throw new RangeError('Tween repeat must be >= 0 or Infinity');
  return repeat;
}

/** @param {number} dx @param {number} dy @param {number} fallbackX @param {number} fallbackY @returns {[number, number]} */
function normalizeDir(dx, dy, fallbackX, fallbackY) {
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) return [dx / len, dy / len];
  return [fallbackX, fallbackY];
}

/** @param {VisualTweenTarget} target @param {boolean} [includeOpacity] @returns {void} */
function ensureVisualFields(target, includeOpacity = false) {
  if (!target || typeof target !== 'object') throw new TypeError('Tween target must be an object');
  if (!Number.isFinite(target.offsetX)) target.offsetX = 0;
  if (!Number.isFinite(target.offsetY)) target.offsetY = 0;
  if (!Number.isFinite(target.scaleX)) target.scaleX = 1;
  if (!Number.isFinite(target.scaleY)) target.scaleY = 1;
  if (!Number.isFinite(target.rotation)) target.rotation = 0;
  if (includeOpacity && !Number.isFinite(target.opacity)) target.opacity = 1;
}

/** Scene-local tweens, sequences and logical timers; updated by the application scheduler. */
export class TweenManager {
  constructor() {
    /** @type {Set<TweenHandle<object>>} */
    this.tweens = new Set();
    /** @type {Map<number, TimerEntry>} */
    this.timers = new Map();
    /** Last issued timer id. @type {number} */
    this.id = 0;
    /** @type {Set<SequenceHandle<object>>} */
    this._sequences = new Set();
    /** @type {TweenHandle<object>[]} */
    this._tweenStep = [];
    /** @type {[number, TimerEntry][]} */
    this._timerStep = [];
    this._generation = 0;
  }

  /**
   * Tween numeric properties of `target` to `values`.
   * @template {object} T
   * @param {T} target
   * @param {TweenValues<T>} values End values (finite numbers).
   * @param {TweenOptions<T>} [options]
   * @returns {TweenHandle<T>}
   */
  add(target, values, {
    duration = 0.3,
    delay = 0,
    ease = 'linear',
    repeat = 0,
    yoyo = false,
    tag = null,
    overwrite = false,
    onUpdate = null,
    onComplete = null,
  } = {}) {
    if (!target || typeof target !== 'object') throw new TypeError('Tween target must be an object');
    if (!values || typeof values !== 'object') throw new TypeError('Tween values must be an object');
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Tween duration must be >= 0');
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Tween delay must be >= 0');
    const easeFn = resolveEase(ease);
    const maxCycles = duration > 0 ? normalizeRepeat(repeat) + 1 : 1;

    const keys = Object.keys(values);
    const count = keys.length;
    const from = new Float64Array(count);
    const to = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const key = keys[i];
      const val = values[key];
      if (!Number.isFinite(val) || !Number.isFinite(target[key])) {
        throw new TypeError('Tween fields must be finite numbers');
      }
      from[i] = target[key];
      to[i] = val;
    }

    if (overwrite && (count > 0 || tag !== null)) {
      for (const existing of [...this.tweens]) {
        if (existing.target !== target) continue;
        if (tag !== null && existing.tag === tag) {
          this.tweens.delete(existing);
          continue;
        }
        let sharesKey = false;
        for (let i = 0; i < existing.count; i++) {
          if (Object.hasOwn(values, existing.keys[i])) {
            sharesKey = true;
            break;
          }
        }
        if (sharesKey) this.tweens.delete(existing);
      }
    }

    const tween = {
      target,
      keys,
      count,
      from,
      to,
      duration,
      delayRemaining: delay,
      started: delay === 0,
      ease: easeFn,
      maxCycles,
      yoyo: Boolean(yoyo),
      tag,
      elapsed: 0,
      onUpdate,
      onComplete,
      cancel: () => this.tweens.delete(tween),
    };
    this.tweens.add(tween);
    return tween;
  }

  /**
   * Cancel tweens and sequences on `target`.
   * @param {object} target
   * @param {string | null} [tag=null] Only those with this tag.
   * @returns {number} Number removed.
   */
  killTweensOf(target, tag = null) {
    let removed = 0;
    for (const seq of [...this._sequences]) {
      if (seq.target === target && (tag === null || seq.tag === tag)) {
        seq.cancel();
        removed++;
      }
    }
    for (const tween of [...this.tweens]) {
      if (tween.target === target && (tag === null || tween.tag === tag)) {
        this.tweens.delete(tween);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Run tween steps one after another.
   * @template {object} T
   * @param {T} target
   * @param {readonly SequenceStep<T>[]} steps
   * @param {SequenceOptions<T>} [options]
   * @returns {SequenceHandle<T>}
   */
  sequence(target, steps, { tag = null, onComplete = null } = {}) {
    if (!target || typeof target !== 'object') throw new TypeError('Sequence target must be an object');
    if (!Array.isArray(steps)) throw new TypeError('Sequence steps must be an array');
    if (steps.length === 0) {
      onComplete?.();
      return { target, tag, cancel() {}, get finished() { return true; } };
    }

    let index = 0;
    let activeTween = null;
    let cancelled = false;
    let finished = false;

    const handle = {
      target,
      tag,
      get finished() { return finished; },
      cancel: () => {
        if (cancelled || finished) return;
        cancelled = true;
        this._sequences.delete(handle);
        activeTween?.cancel?.();
        activeTween = null;
      },
    };
    this._sequences.add(handle);

    const runNext = () => {
      if (cancelled) return;
      if (index >= steps.length) {
        finished = true;
        this._sequences.delete(handle);
        activeTween = null;
        onComplete?.();
        return;
      }
      const step = steps[index++];
      const {
        values = {},
        duration = 0.2,
        delay = 0,
        wait = 0,
        ease = 'linear',
        repeat = 0,
        yoyo = false,
        onStart = null,
        onComplete: stepComplete = null,
      } = step ?? {};
      onStart?.(target);
      if (cancelled) return;
      const totalDelay = Math.max(0, Number(delay) || 0) + Math.max(0, Number(wait) || 0);
      const effectiveDuration = Object.keys(values).length === 0 && wait > 0 && step?.duration === undefined
        ? 0
        : duration;
      activeTween = this.add(target, values, {
        duration: effectiveDuration,
        delay: totalDelay,
        ease,
        repeat,
        yoyo,
        tag,
        onComplete: () => {
          if (cancelled) return;
          stepComplete?.(target);
          if (!cancelled) runNext();
        },
      });
    };

    runNext();
    return handle;
  }

  /**
   * Continuous breathing idle loop on decoupled Sprite2D visual properties.
   * @param {VisualTweenTarget} target
   * @param {IdleOptions} [options]
   * @returns {TweenHandle<VisualTweenTarget>}
   */
  idle(target, { scaleAmt = 0.06, duration = 0.55 } = {}) {
    ensureVisualFields(target);
    this.killTweensOf(target, 'motion');
    target.offsetX = 0;
    target.offsetY = 0;
    target.rotation = 0;
    target.scaleX = 1;
    target.scaleY = 1;
    return this.add(
      target,
      { scaleX: 1 + scaleAmt, scaleY: 1 - scaleAmt },
      { duration, ease: 'easeInOutSine', repeat: Infinity, yoyo: true, tag: 'motion' },
    );
  }

  /**
   * Continuous procedural run bob + squash + waddle tilt loop.
   * @param {VisualTweenTarget} target
   * @param {RunOptions} [options]
   * @returns {LoopHandle}
   */
  run(target, { bobHeight = 5, tiltRad = 0.12, squashAmt = 0.08, duration = 0.18 } = {}) {
    ensureVisualFields(target);
    this.killTweensOf(target, 'motion');
    target.offsetX = 0;
    target.offsetY = 0;
    target.scaleX = 1;
    target.scaleY = 1;
    target.rotation = -tiltRad;
    const bob = this.add(
      target,
      { offsetY: -Math.abs(bobHeight), scaleX: 1 + squashAmt, scaleY: 1 - squashAmt },
      { duration, ease: 'easeInOutSine', repeat: Infinity, yoyo: true, tag: 'motion' },
    );
    const tilt = this.add(
      target,
      { rotation: tiltRad },
      { duration: duration * 2, ease: 'easeInOutSine', repeat: Infinity, yoyo: true, tag: 'motion' },
    );
    return {
      cancel: () => {
        bob.cancel();
        tilt.cancel();
      },
    };
  }

  /**
   * Three-stage windup -> strike -> recover lunge toward (dirX, dirY).
   * @param {VisualTweenTarget} target
   * @param {number} [dirX=1] Direction x (normalized internally).
   * @param {number} [dirY=0] Direction y.
   * @param {AttackLungeOptions} [options]
   * @returns {SequenceHandle<VisualTweenTarget>}
   */
  attackLunge(target, dirX = 1, dirY = 0, {
    distance = 18,
    windup = 0.05,
    strike = 0.08,
    recover = 0.14,
    stretch = 0.18,
    onApex = null,
    onComplete = null,
  } = {}) {
    ensureVisualFields(target);
    const [nx, ny] = normalizeDir(dirX, dirY, 1, 0);
    this.killTweensOf(target, 'motion');
    target.offsetX = 0;
    target.offsetY = 0;
    target.scaleX = 1;
    target.scaleY = 1;
    return this.sequence(target, [
      {
        duration: windup,
        ease: 'easeOutQuad',
        values: {
          offsetX: -nx * distance * 0.25,
          offsetY: -ny * distance * 0.25,
          scaleX: 1 - stretch * 0.5,
          scaleY: 1 + stretch * 0.5,
        },
      },
      {
        duration: strike,
        ease: 'easeOutBack',
        values: {
          offsetX: nx * distance,
          offsetY: ny * distance,
          scaleX: 1 + stretch,
          scaleY: 1 - stretch * 0.6,
        },
        onComplete: onApex,
      },
      {
        duration: recover,
        ease: 'easeOutQuad',
        values: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
      },
    ], { tag: 'motion', onComplete });
  }

  /**
   * Knockback slide, tilt, shrink, and fade-out for defeated entities.
   * @param {VisualTweenTarget} target
   * @param {number} [dirX=-1] Direction x (normalized internally).
   * @param {number} [dirY=0] Direction y.
   * @param {DieKnockbackOptions} [options]
   * @returns {TweenHandle<VisualTweenTarget>}
   */
  dieKnockback(target, dirX = -1, dirY = 0, {
    distance = 24,
    duration = 0.32,
    spinRad = 0.35,
    endScale = 0.72,
    onComplete = null,
  } = {}) {
    ensureVisualFields(target, true);
    const [nx, ny] = normalizeDir(dirX, dirY, -1, 0);
    this.killTweensOf(target);
    return this.add(
      target,
      {
        offsetX: nx * distance,
        offsetY: ny * distance,
        rotation: target.rotation + spinRad,
        scaleX: endScale,
        scaleY: endScale,
        opacity: 0,
      },
      { duration, ease: 'easeOutCubic', tag: 'death', onComplete },
    );
  }

  /** Run `callback` once after `seconds` of tween time. @param {number} seconds (> 0) @param {() => void} callback @returns {number} Timer id for {@link TweenManager#cancel}. */
  after(seconds, callback) { return this._timer(seconds, callback, false); }
  /** Run `callback` every `seconds` of tween time. @param {number} seconds (> 0) @param {() => void} callback @returns {number} Timer id for {@link TweenManager#cancel}. */
  every(seconds, callback) { return this._timer(seconds, callback, true); }

  /** @param {number} seconds @param {() => void} callback @param {boolean} repeat @returns {number} */
  _timer(seconds, callback, repeat) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('Timer delay must be > 0');
    if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function');
    const id = ++this.id;
    this.timers.set(id, { delay: seconds, remaining: seconds, callback, repeat });
    return id;
  }

  /** Cancel a timer. @param {number} id @returns {boolean} False if unknown. */
  cancel(id) { return this.timers.delete(id); }

  /** Advance tweens and timers. @param {number} dt Seconds (>= 0). @returns {void} */
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Tween delta must be >= 0');
    const generation = this._generation;

    const tweenList = this._tweenStep;
    tweenList.length = 0;
    for (const tween of this.tweens) tweenList.push(tween);

    for (let i = 0, len = tweenList.length; i < len; i++) {
      const tween = tweenList[i];
      if (!this.tweens.has(tween)) continue;

      let stepDt = dt;
      if (tween.delayRemaining > 0) {
        if (stepDt + 1e-9 < tween.delayRemaining) {
          tween.delayRemaining -= stepDt;
          continue;
        }
        stepDt = Math.max(0, stepDt - tween.delayRemaining);
        tween.delayRemaining = 0;
      }

      if (!tween.started) {
        tween.started = true;
        for (let k = 0; k < tween.count; k++) {
          const cur = tween.target[tween.keys[k]];
          if (Number.isFinite(cur)) tween.from[k] = cur;
        }
      }

      if (tween.duration === 0) {
        for (let k = 0; k < tween.count; k++) {
          tween.target[tween.keys[k]] = tween.to[k];
        }
        this.tweens.delete(tween);
        tween.onUpdate?.(tween.target, 1);
        if (generation !== this._generation) return;
        tween.onComplete?.();
        if (generation !== this._generation) return;
        continue;
      }

      tween.elapsed += stepDt;
      const cycleIndex = Math.floor((tween.elapsed + 1e-9) / tween.duration);
      if (cycleIndex >= tween.maxCycles) {
        const endT = tween.yoyo && (tween.maxCycles % 2 === 0) ? 0 : 1;
        const easedEnd = tween.ease(endT);
        for (let k = 0; k < tween.count; k++) {
          tween.target[tween.keys[k]] = tween.from[k] + (tween.to[k] - tween.from[k]) * easedEnd;
        }
        this.tweens.delete(tween);
        tween.onUpdate?.(tween.target, endT);
        if (generation !== this._generation) return;
        tween.onComplete?.();
        if (generation !== this._generation) return;
        continue;
      }

      const localT = (tween.elapsed - cycleIndex * tween.duration) / tween.duration;
      const evalT = tween.yoyo && (cycleIndex % 2 === 1) ? 1 - localT : localT;
      const eased = tween.ease(evalT);
      for (let k = 0; k < tween.count; k++) {
        tween.target[tween.keys[k]] = tween.from[k] + (tween.to[k] - tween.from[k]) * eased;
      }
      tween.onUpdate?.(tween.target, evalT);
      if (generation !== this._generation) return;
    }
    tweenList.length = 0;

    const timerList = this._timerStep;
    timerList.length = 0;
    for (const entry of this.timers) timerList.push(entry);

    for (let i = 0, len = timerList.length; i < len; i++) {
      const id = timerList[i][0];
      const timer = timerList[i][1];
      if (!this.timers.has(id)) continue;
      timer.remaining -= dt;
      let count = 0;
      while (this.timers.has(id) && timer.remaining <= 0) {
        if (!timer.repeat) this.timers.delete(id);
        timer.callback();
        if (generation !== this._generation) return;
        if (!timer.repeat) break;
        timer.remaining += timer.delay;
        // Avoid enormous bursts when clients manually advance many seconds.
        if (++count >= 100) {
          timer.remaining = timer.delay;
          break;
        }
      }
    }
    timerList.length = 0;
  }

  /** Cancel everything. @returns {void} */
  dispose() {
    this._generation++;
    for (const seq of [...this._sequences]) seq.cancel();
    this._sequences.clear();
    this.tweens.clear();
    this.timers.clear();
    this._tweenStep.length = 0;
    this._timerStep.length = 0;
  }
}

/**
 * @typedef {object} SpringHalfLifeOptions
 * @property {number} [halfLife] Seconds for the remaining error to halve.
 * @property {number} [angularFrequency] Overrides `halfLife` (rad/s).
 * @property {number} [maxSpeed] Velocity cap (units/second).
 */

/** @typedef {{ value: number, velocity: number }} SpringState1D Mutable 1D spring state. */

/**
 * @typedef {object} SpringDamper1DOptions
 * @property {number} [value=0]
 * @property {number} [velocity=0] Units/second.
 * @property {number} [target=value]
 * @property {number} [halfLife=0.12] Seconds.
 * @property {number} [maxSpeed=Infinity] Units/second.
 */

/**
 * @typedef {object} SpringDamper2DOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [vx=0] Units/second.
 * @property {number} [vy=0] Units/second.
 * @property {number} [targetX=x]
 * @property {number} [targetY=y]
 * @property {number} [halfLife=0.12] Seconds.
 * @property {number} [maxSpeed=Infinity] Speed cap, units/second.
 */

/**
 * @typedef {object} SpringDamper3DOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {number} [vx=0] Units/second.
 * @property {number} [vy=0] Units/second.
 * @property {number} [vz=0] Units/second.
 * @property {number} [targetX=x]
 * @property {number} [targetY=y]
 * @property {number} [targetZ=z]
 * @property {number} [halfLife=0.12] Seconds.
 * @property {number} [maxSpeed=Infinity] Speed cap, units/second.
 */

const SPRING_TAU = Math.PI * 2;
/**
 * Solution to `(1 + u) * exp(-u) = 0.5`, relating critically damped
 * angular frequency `omega = LN2_CRIT / halfLife` to scalar half-life.
 */
export const LN2_CRIT = 1.6783469900166605;
const SPRING_SCRATCH = [0, 0];

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
export function damp(current, target, halfLife, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  if (!Number.isFinite(halfLife) || halfLife <= 0) return target;
  return target + (current - target) * Math.exp((-Math.LN2 * dt) / halfLife);
}

/**
 * Frame-rate-independent shortest-arc exponential angular smoothing in radians.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} halfLife
 * @param {number} dt
 * @returns {number}
 */
export function dampAngle(current, target, halfLife, dt) {
  let delta = (target - current) % SPRING_TAU;
  if (delta > Math.PI) delta -= SPRING_TAU;
  else if (delta < -Math.PI) delta += SPRING_TAU;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  if (!Number.isFinite(halfLife) || halfLife <= 0) return current + delta;
  return current + delta * (1 - Math.exp((-Math.LN2 * dt) / halfLife));
}

/** @param {number} value @param {number} velocity @param {number} target @param {number | SpringHalfLifeOptions} halfLifeOrOptions @param {number} dt @param {number} maxSpeed @param {number[]} out @returns {number[]} */
function evalCritSpringScalar(value, velocity, target, halfLifeOrOptions, dt, maxSpeed, out) {
  if (!Number.isFinite(dt) || dt <= 0) {
    out[0] = value;
    out[1] = velocity;
    return out;
  }

  let omega = -1;
  let speedCap = maxSpeed;
  if (halfLifeOrOptions && typeof halfLifeOrOptions === 'object') {
    if (Number.isFinite(halfLifeOrOptions.angularFrequency) && halfLifeOrOptions.angularFrequency > 0) {
      omega = halfLifeOrOptions.angularFrequency;
    } else if (Number.isFinite(halfLifeOrOptions.halfLife) && halfLifeOrOptions.halfLife > 0) {
      omega = LN2_CRIT / halfLifeOrOptions.halfLife;
    }
    if (halfLifeOrOptions.maxSpeed !== undefined) {
      speedCap = halfLifeOrOptions.maxSpeed;
    }
  } else if (Number.isFinite(halfLifeOrOptions) && halfLifeOrOptions > 0) {
    omega = LN2_CRIT / halfLifeOrOptions;
  }

  if (omega <= 0) {
    out[0] = target;
    out[1] = 0;
    return out;
  }

  const y0 = value - target;
  const c2 = velocity + omega * y0;
  const exp = Math.exp(-omega * dt);
  const nextValue = target + (y0 + c2 * dt) * exp;
  let nextVelocity = (velocity - omega * c2 * dt) * exp;

  if (Number.isFinite(speedCap) && speedCap >= 0 && Math.abs(nextVelocity) > speedCap) {
    nextVelocity = Math.sign(nextVelocity) * speedCap;
  }

  out[0] = nextValue;
  out[1] = nextVelocity;
  return out;
}

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
export function stepSpring1D(state, target, halfLifeOrOptions, dt, maxSpeed = Infinity) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('stepSpring1D expects a mutable { value, velocity } state object');
  }
  evalCritSpringScalar(
    Number(state.value) || 0,
    Number(state.velocity) || 0,
    target,
    halfLifeOrOptions,
    dt,
    maxSpeed,
    SPRING_SCRATCH,
  );
  state.value = SPRING_SCRATCH[0];
  state.velocity = SPRING_SCRATCH[1];
  return state;
}

/**
 * Stateful 1D analytical critically damped spring.
 */
export class SpringDamper1D {
  /** @param {SpringDamper1DOptions} [options] */
  constructor({ value = 0, velocity = 0, target = value, halfLife = 0.12, maxSpeed = Infinity } = {}) {
    this.value = value;
    this.velocity = velocity;
    this.target = target;
    this.halfLife = halfLife;
    this.maxSpeed = maxSpeed;
  }

  /** @param {number} target @returns {this} */
  setTarget(target) {
    this.target = target;
    return this;
  }

  /** Jump to `value` and stop (units / units-per-second). @param {number} [value] @param {number} [velocity=0] @returns {this} */
  snap(value = this.target, velocity = 0) {
    this.value = value;
    this.velocity = velocity;
    this.target = value;
    return this;
  }

  /** Advance by `dt` seconds. @param {number} dt @param {number} [target] @returns {number} The new value. */
  step(dt, target = this.target) {
    this.target = target;
    evalCritSpringScalar(this.value, this.velocity, target, this.halfLife, dt, this.maxSpeed, SPRING_SCRATCH);
    this.value = SPRING_SCRATCH[0];
    this.velocity = SPRING_SCRATCH[1];
    return this.value;
  }

  /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
  isSettled(epsilon = 1e-4, velocityEpsilon = 1e-3) {
    return Math.abs(this.target - this.value) <= epsilon && Math.abs(this.velocity) <= velocityEpsilon;
  }
}

/**
 * Stateful 2D analytical critically damped spring (zero per-step allocations).
 */
export class SpringDamper2D {
  /** @param {SpringDamper2DOptions} [options] */
  constructor({
    x = 0, y = 0,
    vx = 0, vy = 0,
    targetX = x, targetY = y,
    halfLife = 0.12,
    maxSpeed = Infinity,
  } = {}) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.targetX = targetX; this.targetY = targetY;
    this.halfLife = halfLife;
    this.maxSpeed = maxSpeed;
  }

  /** @param {number} x @param {number} y @returns {this} */
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
    return this;
  }

  /** Jump to (x, y) with the given velocity (units/second). @param {number} [x] @param {number} [y] @param {number} [vx=0] @param {number} [vy=0] @returns {this} */
  snap(x = this.targetX, y = this.targetY, vx = 0, vy = 0) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.targetX = x; this.targetY = y;
    return this;
  }

  /** Advance by `dt` seconds. @param {number} dt @param {number} [targetX] @param {number} [targetY] @returns {this} */
  step(dt, targetX = this.targetX, targetY = this.targetY) {
    this.targetX = targetX;
    this.targetY = targetY;
    evalCritSpringScalar(this.x, this.vx, targetX, this.halfLife, dt, Infinity, SPRING_SCRATCH);
    this.x = SPRING_SCRATCH[0];
    const nextVx = SPRING_SCRATCH[1];
    evalCritSpringScalar(this.y, this.vy, targetY, this.halfLife, dt, Infinity, SPRING_SCRATCH);
    this.y = SPRING_SCRATCH[0];
    const nextVy = SPRING_SCRATCH[1];

    if (Number.isFinite(this.maxSpeed) && this.maxSpeed >= 0) {
      const speedSq = nextVx * nextVx + nextVy * nextVy;
      if (speedSq > this.maxSpeed * this.maxSpeed) {
        const scale = this.maxSpeed / Math.sqrt(speedSq);
        this.vx = nextVx * scale;
        this.vy = nextVy * scale;
        return this;
      }
    }
    this.vx = nextVx;
    this.vy = nextVy;
    return this;
  }

  /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
  isSettled(epsilon = 1e-4, velocityEpsilon = 1e-3) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    return (
      dx * dx + dy * dy <= epsilon * epsilon &&
      this.vx * this.vx + this.vy * this.vy <= velocityEpsilon * velocityEpsilon
    );
  }
}

/**
 * Stateful 3D analytical critically damped spring (zero per-step allocations).
 */
export class SpringDamper3D {
  /** @param {SpringDamper3DOptions} [options] */
  constructor({
    x = 0, y = 0, z = 0,
    vx = 0, vy = 0, vz = 0,
    targetX = x, targetY = y, targetZ = z,
    halfLife = 0.12,
    maxSpeed = Infinity,
  } = {}) {
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.targetX = targetX; this.targetY = targetY; this.targetZ = targetZ;
    this.halfLife = halfLife;
    this.maxSpeed = maxSpeed;
  }

  /** @param {number} x @param {number} y @param {number} z @returns {this} */
  setTarget(x, y, z) {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;
    return this;
  }

  /** Jump to (x, y, z) with the given velocity (units/second). @param {number} [x] @param {number} [y] @param {number} [z] @param {number} [vx=0] @param {number} [vy=0] @param {number} [vz=0] @returns {this} */
  snap(x = this.targetX, y = this.targetY, z = this.targetZ, vx = 0, vy = 0, vz = 0) {
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.targetX = x; this.targetY = y; this.targetZ = z;
    return this;
  }

  /** Advance by `dt` seconds. @param {number} dt @param {number} [targetX] @param {number} [targetY] @param {number} [targetZ] @returns {this} */
  step(dt, targetX = this.targetX, targetY = this.targetY, targetZ = this.targetZ) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.targetZ = targetZ;
    evalCritSpringScalar(this.x, this.vx, targetX, this.halfLife, dt, Infinity, SPRING_SCRATCH);
    this.x = SPRING_SCRATCH[0];
    const nextVx = SPRING_SCRATCH[1];
    evalCritSpringScalar(this.y, this.vy, targetY, this.halfLife, dt, Infinity, SPRING_SCRATCH);
    this.y = SPRING_SCRATCH[0];
    const nextVy = SPRING_SCRATCH[1];
    evalCritSpringScalar(this.z, this.vz, targetZ, this.halfLife, dt, Infinity, SPRING_SCRATCH);
    this.z = SPRING_SCRATCH[0];
    const nextVz = SPRING_SCRATCH[1];

    if (Number.isFinite(this.maxSpeed) && this.maxSpeed >= 0) {
      const speedSq = nextVx * nextVx + nextVy * nextVy + nextVz * nextVz;
      if (speedSq > this.maxSpeed * this.maxSpeed) {
        const scale = this.maxSpeed / Math.sqrt(speedSq);
        this.vx = nextVx * scale;
        this.vy = nextVy * scale;
        this.vz = nextVz * scale;
        return this;
      }
    }
    this.vx = nextVx;
    this.vy = nextVy;
    this.vz = nextVz;
    return this;
  }

  /** @param {number} [epsilon=1e-4] Position tolerance. @param {number} [velocityEpsilon=1e-3] Velocity tolerance. @returns {boolean} */
  isSettled(epsilon = 1e-4, velocityEpsilon = 1e-3) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dz = this.targetZ - this.z;
    return (
      dx * dx + dy * dy + dz * dz <= epsilon * epsilon &&
      this.vx * this.vx + this.vy * this.vy + this.vz * this.vz <= velocityEpsilon * velocityEpsilon
    );
  }
}

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

function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  const fn = EASING[ease];
  if (!fn) throw new Error('Unknown easing: ' + ease);
  return fn;
}

function normalizeRepeat(repeat) {
  if (repeat === Infinity || repeat === -1) return Infinity;
  if (!Number.isInteger(repeat) || repeat < 0) throw new RangeError('Tween repeat must be >= 0 or Infinity');
  return repeat;
}

function normalizeDir(dx, dy, fallbackX, fallbackY) {
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) return [dx / len, dy / len];
  return [fallbackX, fallbackY];
}

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
    this.tweens = new Set();
    this.timers = new Map();
    this.id = 0;
    this._sequences = new Set();
    this._tweenStep = [];
    this._timerStep = [];
  }

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

  /** Continuous breathing idle loop on decoupled Sprite2D visual properties. */
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

  /** Continuous procedural run bob + squash + waddle tilt loop. */
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

  /** Three-stage windup -> strike -> recover lunge toward (dirX, dirY). */
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

  /** Knockback slide, tilt, shrink, and fade-out for defeated entities. */
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

  after(seconds, callback) { return this._timer(seconds, callback, false); }
  every(seconds, callback) { return this._timer(seconds, callback, true); }

  _timer(seconds, callback, repeat) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('Timer delay must be > 0');
    if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function');
    const id = ++this.id;
    this.timers.set(id, { delay: seconds, remaining: seconds, callback, repeat });
    return id;
  }

  cancel(id) { return this.timers.delete(id); }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Tween delta must be >= 0');

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
        tween.onComplete?.();
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
        tween.onComplete?.();
        continue;
      }

      const localT = (tween.elapsed - cycleIndex * tween.duration) / tween.duration;
      const evalT = tween.yoyo && (cycleIndex % 2 === 1) ? 1 - localT : localT;
      const eased = tween.ease(evalT);
      for (let k = 0; k < tween.count; k++) {
        tween.target[tween.keys[k]] = tween.from[k] + (tween.to[k] - tween.from[k]) * eased;
      }
      tween.onUpdate?.(tween.target, evalT);
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

  dispose() {
    for (const seq of [...this._sequences]) seq.cancel();
    this._sequences.clear();
    this.tweens.clear();
    this.timers.clear();
    this._tweenStep.length = 0;
    this._timerStep.length = 0;
  }
}

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
 * @param {{ value: number, velocity: number }} state
 * @param {number} target
 * @param {number | { halfLife?: number, angularFrequency?: number, maxSpeed?: number }} halfLifeOrOptions
 * @param {number} dt
 * @param {number} [maxSpeed=Infinity]
 * @returns {{ value: number, velocity: number }}
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
  constructor({ value = 0, velocity = 0, target = value, halfLife = 0.12, maxSpeed = Infinity } = {}) {
    this.value = value;
    this.velocity = velocity;
    this.target = target;
    this.halfLife = halfLife;
    this.maxSpeed = maxSpeed;
  }

  setTarget(target) {
    this.target = target;
    return this;
  }

  snap(value = this.target, velocity = 0) {
    this.value = value;
    this.velocity = velocity;
    this.target = value;
    return this;
  }

  step(dt, target = this.target) {
    this.target = target;
    evalCritSpringScalar(this.value, this.velocity, target, this.halfLife, dt, this.maxSpeed, SPRING_SCRATCH);
    this.value = SPRING_SCRATCH[0];
    this.velocity = SPRING_SCRATCH[1];
    return this.value;
  }

  isSettled(epsilon = 1e-4, velocityEpsilon = 1e-3) {
    return Math.abs(this.target - this.value) <= epsilon && Math.abs(this.velocity) <= velocityEpsilon;
  }
}

/**
 * Stateful 2D analytical critically damped spring (zero per-step allocations).
 */
export class SpringDamper2D {
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

  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
    return this;
  }

  snap(x = this.targetX, y = this.targetY, vx = 0, vy = 0) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.targetX = x; this.targetY = y;
    return this;
  }

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

  setTarget(x, y, z) {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;
    return this;
  }

  snap(x = this.targetX, y = this.targetY, z = this.targetZ, vx = 0, vy = 0, vz = 0) {
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.targetX = x; this.targetY = y; this.targetZ = z;
    return this;
  }

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

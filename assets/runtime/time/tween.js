const EASING = Object.freeze({
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOutCubic: t => 1 - (1 - t) ** 3,
});

/** Scene-local tweens and logical timers; updated by the fixed timestep. */
export class TweenManager {
  constructor() {
    this.tweens = new Set();
    this.timers = new Map();
    this.id = 0;
  }

  add(target, values, { duration = 0.3, ease = 'linear', onComplete = null } = {}) {
    if (!target || typeof target !== 'object') throw new TypeError('Tween target must be an object');
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Tween duration must be >= 0');
    if (!EASING[ease]) throw new Error('Unknown easing: ' + ease);
    const from = {};
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value) || !Number.isFinite(target[key])) throw new TypeError('Tween fields must be finite numbers');
      from[key] = target[key];
    }
    const tween = {
      target, from, values, duration, ease: EASING[ease], elapsed: 0, onComplete,
      cancel: () => this.tweens.delete(tween),
    };
    this.tweens.add(tween);
    return tween;
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
    for (const tween of [...this.tweens]) {
      if (!this.tweens.has(tween)) continue;
      tween.elapsed += dt;
      const t = tween.duration ? Math.min(1, tween.elapsed / tween.duration) : 1;
      const eased = tween.ease(t);
      for (const [key, value] of Object.entries(tween.values)) {
        tween.target[key] = tween.from[key] + (value - tween.from[key]) * eased;
      }
      if (t === 1) {
        this.tweens.delete(tween);
        tween.onComplete?.();
      }
    }
    for (const [id, timer] of [...this.timers]) {
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
  }
  dispose() { this.tweens.clear(); this.timers.clear(); }
}

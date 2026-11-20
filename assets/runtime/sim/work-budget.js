/**
 * @typedef {object} SimulationWorkBudgetOptions
 * @property {import('../core/application.js').GameApplication} app Owns the update phase.
 * @property {number} [unitsPerTick=256] Maximum iterator advances per fixed tick.
 * @property {number} [unitsPerSlice=16] Maximum consecutive advances for one task.
 * @property {number} [maxPending=128] Maximum accepted tasks.
 */
/**
 * @template T
 * @typedef {object} SimulationWorkHandle
 * @property {'pending'|'completed'|'failed'|'cancelled'} state
 * @property {T | undefined} value Available on completion.
 * @property {unknown} error Available on failure or cancellation.
 * @property {(reason?: unknown) => boolean} cancel
 */
/** @typedef {SimulationWorkHandle<unknown>['state']} WorkState */
/** @typedef {{iterator: Generator<unknown, unknown, void> | null, state: WorkState, value: unknown, error: unknown, signal: AbortSignal | null, onAbort: (() => void) | null}} WorkEntry */

/**
 * Advance cooperative work in fixed-tick order and bound the pending queue.
 * Each generator advance is one unit and should perform bounded synchronous work.
 * @param {SimulationWorkBudgetOptions} options
 */
export function createSimulationWorkBudget({ app, unitsPerTick = 256, unitsPerSlice = Math.min(16, unitsPerTick), maxPending = 128 }) {
  for (const value of [unitsPerTick, unitsPerSlice, maxPending]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Simulation work limits must be positive integers');
  }
  if (!app || app.disposed) throw new Error('Simulation work requires a live application');

  /** @type {Map<Generator<unknown, unknown, void>, WorkEntry>} */
  const pending = new Map();
  const owned = new Set();
  const stats = { used: 0, completed: 0, cancelled: 0, failed: 0, rejected: 0 };
  /** @type {WorkEntry | null} */
  let advancing = null;
  let disposed = false;

  /** @param {WorkEntry} entry @param {'completed'|'cancelled'|'failed'} state */
  function settle(entry, state) {
    entry.state = state;
    stats[state]++;
    pending.delete(entry.iterator);
    if (entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
    entry.onAbort = null;
    entry.signal = null;
  }

  /** @param {WorkEntry} entry */
  function close(entry) {
    const iterator = entry.iterator;
    entry.iterator = null;
    try {
      const result = iterator.return?.();
      if (result && !result.done) throw new Error('Simulation work must not yield during cancellation');
    } catch (error) {
      entry.error = new AggregateError([entry.error, error], 'Simulation work cancellation failed');
    } finally { owned.delete(iterator); }
  }

  /** @param {WorkEntry} entry @param {unknown} [reason] */
  function cancel(entry, reason = new DOMException('Simulation work cancelled', 'AbortError')) {
    if (entry.state !== 'pending') return false;
    entry.error = reason;
    settle(entry, 'cancelled');
    if (advancing !== entry) close(entry);
    return true;
  }

  /**
   * @template T
   * @param {Generator<unknown, T, void>} iterator
   * @param {{signal?: AbortSignal | null}} [options] Defaults to the current scene activation. Pass null for application lifetime.
   * @returns {SimulationWorkHandle<T> | null} Null when the queue is full.
   */
  function enqueue(iterator, { signal = app.scenes.current?.activationSignal ?? null } = {}) {
    if (disposed || app.disposed) throw new Error('Simulation work budget is disposed');
    if (typeof iterator?.next !== 'function' || iterator[Symbol.asyncIterator]) throw new TypeError('Simulation work requires a synchronous generator');
    if (owned.has(iterator)) throw new Error('Simulation work is already queued');
    if (!signal?.aborted && pending.size === maxPending) {
      stats.rejected++;
      return null;
    }
    /** @type {WorkEntry} */
    const entry = { iterator, state: 'pending', value: undefined, error: undefined, signal, onAbort: null };
    owned.add(iterator);
    if (signal?.aborted) cancel(entry, signal.reason);
    else {
      if (signal) {
        entry.onAbort = () => cancel(entry, signal.reason);
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      pending.set(iterator, entry);
    }
    return {
      get state() { return entry.state; },
      get value() { return /** @type {T | undefined} */ (entry.value); },
      get error() { return entry.error; },
      cancel: reason => cancel(entry, reason),
    };
  }

  /** @param {WorkEntry} entry */
  function advance(entry) {
    advancing = entry;
    stats.used++;
    try {
      const next = entry.iterator.next();
      if (entry.state !== 'pending') return;
      if (typeof next?.done !== 'boolean') throw new TypeError('Simulation work must advance synchronously');
      if (next.done) {
        entry.value = next.value;
        settle(entry, 'completed');
        owned.delete(entry.iterator);
        entry.iterator = null;
      }
    } catch (error) {
      if (entry.state === 'pending') {
        entry.error = error;
        settle(entry, 'failed');
        owned.delete(entry.iterator);
        entry.iterator = null;
      }
    } finally {
      advancing = null;
      if (entry.state === 'cancelled') close(entry);
    }
  }

  /** @param {import('../core/internal/frame-phases.js').FramePhaseContext} context */
  function step({ signal }) {
    stats.used = 0;
    while (pending.size && !disposed && !signal.aborted && stats.used < unitsPerTick) {
      const [iterator, entry] = pending.entries().next().value;
      pending.delete(iterator);
      pending.set(iterator, entry);
      const stopAt = Math.min(stats.used + unitsPerSlice, unitsPerTick);
      while (entry.state === 'pending' && !signal.aborted && stats.used < stopAt) {
        if (entry.signal?.aborted) cancel(entry, entry.signal.reason);
        else advance(entry);
      }
    }
  }

  const offPhase = app.onPhase(app.project.tickHz > 0 ? 'afterPhysics' : 'beforeUpdate', step);
  const offDispose = app.scenes.onDispose(dispose);
  function dispose() {
    if (disposed) return;
    disposed = true;
    offPhase();
    offDispose();
    for (const entry of pending.values()) cancel(entry);
  }

  return { enqueue, snapshot: () => ({ ...stats, pending: pending.size, capacity: maxPending }), dispose };
}

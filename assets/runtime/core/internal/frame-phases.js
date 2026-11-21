/** @typedef {'beforeFixedUpdate' | 'afterPhysics' | 'beforeUpdate' | 'beforeLateUpdate' | 'beforeRender' | 'afterRender'} FramePhase */
/**
 * @typedef {object} FramePhaseContext
 * @property {FramePhase} phase
 * @property {import('../application.js').GameApplication} app
 * @property {import('../scene.js').Scene} scene
 * @property {AbortSignal} signal The current scene activation.
 * @property {number} deltaSeconds Fixed or scaled frame seconds. Render-only calls use zero.
 */
/** @typedef {(context: FramePhaseContext) => void} FramePhaseCallback */
/** @typedef {{order?: number, signal?: AbortSignal}} FramePhaseOptions */
/** @typedef {{order: number, callback: FramePhaseCallback, active: boolean, signal?: AbortSignal, remove: () => boolean}} PhaseListener */

const phases = ['beforeFixedUpdate', 'afterPhysics', 'beforeUpdate', 'beforeLateUpdate', 'beforeRender', 'afterRender'];
const alreadyRemoved = () => false;

export function createFramePhases() {
  /** @type {Map<string, PhaseListener[]>} */
  const listeners = new Map(phases.map(phase => [phase, []]));

  /** @param {FramePhase} phase @param {FramePhaseCallback} callback @param {FramePhaseOptions} [options] */
  function on(phase, callback, { order = 0, signal } = {}) {
    if (!listeners.has(phase)) throw new RangeError('Unknown frame phase: ' + phase);
    if (typeof callback !== 'function' || !Number.isFinite(order)) throw new TypeError('Frame phase requires a callback and finite order');
    if (signal?.aborted) return alreadyRemoved;
    const entry = { order, callback, active: true, signal, remove };
    function remove() {
      if (!entry.active) return false;
      entry.active = false;
      listeners.set(phase, listeners.get(phase).filter(listener => listener !== entry));
      signal?.removeEventListener('abort', remove);
      return true;
    }
    // Replacing the ordered array gives an in-flight dispatch a stable view.
    signal?.addEventListener('abort', remove, { once: true });
    listeners.set(phase, [...listeners.get(phase), entry].sort((a, b) => a.order - b.order));
    return remove;
  }

  /**
   * @param {FramePhase} phase
   * @param {import('../application.js').GameApplication} app
   * @param {import('../scene.js').Scene} scene
   * @param {AbortSignal} signal
   * @param {number} deltaSeconds
   */
  function run(phase, app, scene, signal, deltaSeconds) {
    if (signal.aborted || app.scenes.current !== scene || app.disposed) return false;
    const snapshot = listeners.get(phase);
    if (snapshot.length === 0) return true;
    const context = Object.freeze({ phase, app, scene, signal, deltaSeconds });
    for (const entry of snapshot) {
      if (!entry.active) continue;
      if (entry.signal?.aborted) {
        entry.remove();
        continue;
      }
      if (app._runTrackedPhase) {
        app._runTrackedPhase(`phaseHook:${phase}`, scene?.name ?? null, () => entry.callback(context), {
          hookPhase: phase,
          hookOrder: entry.order,
        });
      } else {
        entry.callback(context);
      }
      if (signal.aborted || app.scenes.current !== scene || app.disposed) return false;
    }
    return true;
  }

  function dispose() {
    for (const entries of listeners.values()) {
      for (const entry of entries) entry.remove();
    }
  }

  return { on, run, dispose };
}

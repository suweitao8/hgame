import { TileMap, findGridPath } from '../world/tilemap.js';

function runBuiltInKernel(type, payload) {
  if (type === 'grid-path') {
    const map = new TileMap({
      tiles: payload.tiles,
      solid: payload.solid ?? [1],
      tileWidth: payload.tileWidth ?? 1,
      tileHeight: payload.tileHeight ?? 1,
    });
    return findGridPath(map, payload.start, payload.goal, payload.options);
  }
  if (type === 'navmesh-step' || type === 'batch-eval') {
    if (Array.isArray(payload?.items)) {
      return payload.items.map(item => (typeof item === 'number' ? item * 2 : item));
    }
    return payload;
  }
  throw new Error('Unknown simulation worker kernel: ' + type);
}

/**
 * Coordinates simulation jobs across an optional Web Worker pool and a deterministic
 * main-thread fallback, staging worker outputs and committing results in deterministic
 * `(submitTick, priority, id)` order during `flushTick(tickIndex)`.
 * @param {object} [options]
 * @param {((index: number) => { postMessage: (msg: unknown, transfer?: unknown[]) => void, terminate?: () => void, addEventListener?: (t: string, fn: (e: { data: any }) => void) => void, removeEventListener?: (t: string, fn: (e: { data: any }) => void) => void, onmessage?: ((e: { data: any }) => void) | null, onerror?: ((e: unknown) => void) | null }) | null} [options.workerFactory=null]
 * @param {string | URL | null} [options.workerUrl=null]
 * @param {number} [options.workerCount=1]
 * @param {number} [options.maxJobsPerTick=32]
 * @param {number} [options.maxPending=256]
 * @param {Record<string, (payload: any) => any>} [options.kernels]
 * @param {((entry: { id: number, type: string, submitTick: number, status: 'completed' | 'failed', value: unknown, error: unknown }) => void) | null} [options.onCommit=null]
 */
export function createSimWorkerRunner({
  workerFactory = null,
  workerUrl = null,
  workerCount = 1,
  maxJobsPerTick = 32,
  maxPending = 256,
  kernels = {},
  onCommit = null,
} = {}) {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new RangeError('workerCount must be a positive integer');
  }
  if (!Number.isSafeInteger(maxJobsPerTick) || maxJobsPerTick < 1 || !Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new RangeError('maxJobsPerTick and maxPending must be positive integers');
  }

  const registry = new Map(Object.entries(kernels));
  const workers = [];
  const canUseWorkers = typeof workerFactory === 'function' ||
    (workerUrl && typeof globalThis.Worker === 'function');
  const mode = canUseWorkers ? 'worker' : 'main-thread';

  let nextJobId = 1;
  let currentTick = 0;
  let disposed = false;
  /** @type {Map<number, { id: number, type: string, payload: unknown, submitTick: number, priority: number, state: 'queued' | 'running' | 'staged' | 'completed' | 'failed' | 'cancelled', value: unknown, error: unknown, workerIndex: number, signal: AbortSignal | null, onAbort: (() => void) | null }>} */
  const jobs = new Map();
  const mainQueue = [];
  const staged = [];
  const stats = {
    submitted: 0,
    committed: 0,
    cancelled: 0,
    failed: 0,
    rejected: 0,
    droppedLate: 0,
  };

  function handleWorkerMessage(event) {
    if (disposed) return;
    const msg = event?.data ?? event;
    if (!msg || typeof msg.id !== 'number') return;
    const entry = jobs.get(msg.id);
    if (!entry || entry.state === 'cancelled') {
      stats.droppedLate++;
      return;
    }
    entry.payload = null;
    entry.state = 'staged';
    if (msg.ok) {
      entry.value = msg.result;
    } else {
      entry.error = msg.error instanceof Error ? msg.error : new Error(String(msg.error ?? 'Worker simulation failed'));
    }
    staged.push(entry);
  }

  if (mode === 'worker') {
    for (let i = 0; i < workerCount; i++) {
      const worker = typeof workerFactory === 'function'
        ? workerFactory(i)
        : new globalThis.Worker(workerUrl, { type: 'module' });
      if (typeof worker.addEventListener === 'function') {
        worker.addEventListener('message', handleWorkerMessage);
      } else {
        worker.onmessage = handleWorkerMessage;
      }
      workers.push(worker);
    }
  }

  function registerKernel(type, fn) {
    if (typeof type !== 'string' || !type || typeof fn !== 'function') {
      throw new TypeError('registerKernel requires a non-empty type and function');
    }
    registry.set(type, fn);
  }

  function executeLocally(type, payload) {
    const custom = registry.get(type);
    if (custom) return custom(payload);
    return runBuiltInKernel(type, payload);
  }

  function cleanupSignal(entry) {
    if (entry.onAbort && entry.signal) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    entry.onAbort = null;
    entry.signal = null;
  }

  function cancel(id, reason = new DOMException('Simulation job cancelled', 'AbortError')) {
    const entry = jobs.get(id);
    if (!entry || entry.state === 'completed' || entry.state === 'failed' || entry.state === 'cancelled') {
      return false;
    }
    const wasInWorker = entry.state === 'running' && entry.workerIndex >= 0;
    entry.state = 'cancelled';
    entry.error = reason;
    entry.payload = null;
    entry.value = undefined;
    cleanupSignal(entry);
    jobs.delete(id);
    stats.cancelled++;
    if (wasInWorker && workers[entry.workerIndex]) {
      workers[entry.workerIndex].postMessage({ op: 'cancel', id });
    }
    return true;
  }

  function submit(type, payload, { tick = currentTick, signal = null, priority = 0, transferables = [] } = {}) {
    if (disposed) throw new Error('Simulation worker runner is disposed');
    if (typeof type !== 'string' || !type) throw new TypeError('Job type must be a non-empty string');
    if (signal?.aborted) {
      stats.cancelled++;
      return {
        id: -1,
        get state() { return 'cancelled'; },
        get value() { return undefined; },
        get error() { return signal.reason; },
        cancel: () => false,
      };
    }
    if (jobs.size >= maxPending) {
      stats.rejected++;
      return null;
    }
    const id = nextJobId++;
    const entry = {
      id,
      type,
      payload,
      submitTick: tick,
      priority: Number(priority) || 0,
      state: /** @type {const} */ ('queued'),
      value: undefined,
      error: undefined,
      workerIndex: -1,
      signal,
      onAbort: null,
    };
    if (signal) {
      entry.onAbort = () => cancel(id, signal.reason);
      signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    jobs.set(id, entry);
    stats.submitted++;

    if (mode === 'worker') {
      const workerIndex = (id - 1) % workers.length;
      entry.workerIndex = workerIndex;
      entry.state = 'running';
      workers[workerIndex].postMessage({ op: 'run', id, type, payload }, transferables);
    } else {
      mainQueue.push(entry);
    }

    return {
      id,
      get state() { return entry.state; },
      get value() { return entry.value; },
      get error() { return entry.error; },
      cancel: reason => cancel(id, reason),
    };
  }

  function flushTick(tickIndex = currentTick) {
    currentTick = Math.max(currentTick, tickIndex);
    if (disposed) return [];

    if (mode === 'main-thread' && mainQueue.length > 0) {
      // Deterministic execution order up to maxJobsPerTick
      mainQueue.sort((a, b) => (a.submitTick - b.submitTick) || (b.priority - a.priority) || (a.id - b.id));
      let ran = 0;
      for (let i = 0; i < mainQueue.length && ran < maxJobsPerTick; ) {
        const entry = mainQueue[i];
        if (entry.state === 'cancelled') {
          mainQueue.splice(i, 1);
          continue;
        }
        if (entry.submitTick > tickIndex) {
          i++;
          continue;
        }
        mainQueue.splice(i, 1);
        ran++;
        try {
          entry.value = executeLocally(entry.type, entry.payload);
        } catch (err) {
          entry.error = err;
        }
        entry.payload = null;
        entry.state = 'staged';
        staged.push(entry);
      }
    }

    staged.sort((a, b) => (a.submitTick - b.submitTick) || (b.priority - a.priority) || (a.id - b.id));
    const committed = [];
    const remaining = [];
    for (const entry of staged) {
      if (entry.state === 'cancelled') continue;
      if (entry.submitTick <= tickIndex) {
        cleanupSignal(entry);
        jobs.delete(entry.id);
        if (entry.error !== undefined) {
          entry.state = 'failed';
          stats.failed++;
        } else {
          entry.state = 'completed';
          stats.committed++;
        }
        const record = Object.freeze({
          id: entry.id,
          type: entry.type,
          submitTick: entry.submitTick,
          status: entry.state,
          value: entry.value,
          error: entry.error,
        });
        committed.push(record);
        onCommit?.(record);
      } else {
        remaining.push(entry);
      }
    }
    staged.length = 0;
    staged.push(...remaining);
    return committed;
  }

  function cancelAll(reason = new DOMException('Simulation runner cleared', 'AbortError')) {
    for (const id of [...jobs.keys()]) cancel(id, reason);
    mainQueue.length = 0;
    staged.length = 0;
  }

  function dispose() {
    if (disposed) return false;
    cancelAll(new DOMException('Simulation runner disposed', 'AbortError'));
    disposed = true;
    for (const worker of workers) {
      if (typeof worker.removeEventListener === 'function') {
        worker.removeEventListener('message', handleWorkerMessage);
      } else {
        worker.onmessage = null;
      }
      worker.terminate?.();
    }
    workers.length = 0;
    registry.clear();
    return true;
  }

  return {
    get mode() { return mode; },
    get workerCount() { return workers.length; },
    registerKernel,
    submit,
    flushTick,
    cancel,
    cancelAll,
    getStats() {
      return Object.freeze({
        mode,
        workerCount: workers.length,
        queued: mainQueue.length,
        inFlight: [...jobs.values()].filter(j => j.state === 'running').length,
        staged: staged.length,
        ...stats,
      });
    },
    dispose,
  };
}

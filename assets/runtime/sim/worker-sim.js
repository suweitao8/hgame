import { TileMap, findGridPath } from '../world/tilemap.js';

function computeFlowFieldKernel(payload) {
  const cols = Math.max(1, payload.cols | 0);
  const rows = Math.max(1, payload.rows | 0);
  const total = cols * rows;
  const cost = payload.cost instanceof Uint8Array ? payload.cost : new Uint8Array(payload.cost || total);
  const goalX = Math.max(0, Math.min(cols - 1, payload.goalX | 0));
  const goalY = Math.max(0, Math.min(rows - 1, payload.goalY | 0));

  const dist = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let qh = 0;
  let qt = 0;
  const startIdx = goalY * cols + goalX;
  dist[startIdx] = 0;
  queue[qt++] = startIdx;

  while (qh < qt) {
    const idx = queue[qh++];
    const x = idx % cols;
    const y = (idx / cols) | 0;
    const nextDist = dist[idx] + 1;

    if (x > 0) {
      const n = idx - 1;
      if (cost[n] !== 255 && dist[n] === -1) { dist[n] = nextDist; queue[qt++] = n; }
    }
    if (x + 1 < cols) {
      const n = idx + 1;
      if (cost[n] !== 255 && dist[n] === -1) { dist[n] = nextDist; queue[qt++] = n; }
    }
    if (y > 0) {
      const n = idx - cols;
      if (cost[n] !== 255 && dist[n] === -1) { dist[n] = nextDist; queue[qt++] = n; }
    }
    if (y + 1 < rows) {
      const n = idx + cols;
      if (cost[n] !== 255 && dist[n] === -1) { dist[n] = nextDist; queue[qt++] = n; }
    }
  }

  const dirX = new Float32Array(total);
  const dirY = new Float32Array(total);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const d0 = dist[idx];
      if (d0 <= 0) continue;
      let bestIdx = -1;
      let bestDist = d0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= cols) continue;
          const n = ny * cols + nx;
          const nd = dist[n];
          if (nd >= 0 && nd < bestDist) {
            bestDist = nd;
            bestIdx = n;
          }
        }
      }
      if (bestIdx >= 0) {
        const bx = (bestIdx % cols) - x;
        const by = ((bestIdx / cols) | 0) - y;
        const inv = 1 / Math.hypot(bx, by);
        dirX[idx] = bx * inv;
        dirY[idx] = by * inv;
      }
    }
  }
  return { dirX, dirY };
}

function computeSwarmSeparateKernel(payload) {
  const count = Math.max(0, payload.count | 0);
  const posX = payload.posX;
  const posY = payload.posY;
  const activeIds = payload.activeIds;
  const sepRadius = Number(payload.sepRadius) || 0.9;
  const sepStrength = Number(payload.sepStrength) || 2.5;
  const maxNeighbors = Math.max(1, payload.maxNeighbors | 0);
  const cols = Math.max(1, payload.gridCols | 0);
  const rows = Math.max(1, payload.gridRows | 0);
  const invCell = 1 / (Number(payload.cellSize) || 2);
  const ox = Number(payload.originX) || 0;
  const oy = Number(payload.originY) || 0;
  const capacity = Math.max(posX?.length ?? 0, count);

  const head = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(capacity).fill(-1);
  for (let a = 0; a < count; a++) {
    const id = activeIds[a];
    const cx = Math.max(0, Math.min(cols - 1, ((posX[id] - ox) * invCell) | 0));
    const cy = Math.max(0, Math.min(rows - 1, ((posY[id] - oy) * invCell) | 0));
    const cell = cy * cols + cx;
    next[id] = head[cell];
    head[cell] = id;
  }

  const sepX = new Float32Array(capacity);
  const sepY = new Float32Array(capacity);
  const sepSq = sepRadius * sepRadius;
  const invSepR = 1 / sepRadius;

  for (let a = 0; a < count; a++) {
    const id = activeIds[a];
    const px = posX[id];
    const py = posY[id];
    const cx = Math.max(0, Math.min(cols - 1, ((px - ox) * invCell) | 0));
    const cy = Math.max(0, Math.min(rows - 1, ((py - oy) * invCell) | 0));
    let sx = 0;
    let sy = 0;
    let checked = 0;

    for (let dy = -1; dy <= 1 && checked < maxNeighbors; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= rows) continue;
      for (let dx = -1; dx <= 1 && checked < maxNeighbors; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= cols) continue;
        let other = head[ny * cols + nx];
        while (other !== -1 && checked < maxNeighbors) {
          if (other !== id) {
            checked++;
            const ddx = px - posX[other];
            const ddy = py - posY[other];
            const dSq = ddx * ddx + ddy * ddy;
            if (dSq > 1e-6 && dSq < sepSq) {
              const w = 1 / Math.sqrt(dSq) - invSepR;
              sx += ddx * w;
              sy += ddy * w;
            }
          }
          other = next[other];
        }
      }
    }
    sepX[id] = sx;
    sepY[id] = sy;
  }
  return { sepX, sepY };
}

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
  if (type === 'flow-field') {
    return computeFlowFieldKernel(payload);
  }
  if (type === 'swarm-separate') {
    return computeSwarmSeparateKernel(payload);
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

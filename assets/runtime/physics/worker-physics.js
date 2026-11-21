import { createPhysicsKernel } from './physics-worker-kernel.js';

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2));
  if (diff < 0) diff += Math.PI * 2;
  diff -= Math.PI;
  return a + diff * t;
}

function clonePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clonePlain);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'function' && v !== undefined) {
      out[k] = clonePlain(v);
    }
  }
  return out;
}

function capturePose(entity) {
  const pos = typeof entity.worldPosition === 'function' ? entity.worldPosition() : entity;
  return {
    x: Number(pos?.x) || 0,
    y: Number(pos?.y) || 0,
    z: Number(pos?.z) || 0,
    rotationX: Number(entity.rotationX) || 0,
    rotationY: Number(entity.rotationY) || 0,
    rotationZ: Number(entity.rotationZ) || 0,
  };
}

/**
 * Create a deterministic physics world facade backed by a module Web Worker (with automatic
 * non-COOP/COEP inline fallback using the identical deterministic physics kernel).
 *
 * @param {{
 *   dimension?: 2 | 3,
 *   tickHz?: number,
 *   gravity?: { x?: number, y?: number, z?: number },
 *   worker?: 'auto' | 'worker' | 'inline' | object,
 *   WorldClass?: import('./rapier-world.js').RapierPhysicsWorldConstructor | null,
 *   workerUrl?: string | URL | null,
 *   WorkerCtor?: typeof Worker | null,
 * }} [options]
 */
export function createWorkerPhysicsWorld({
  dimension = 3,
  tickHz = 60,
  gravity,
  worker = 'auto',
  WorldClass = null,
  workerUrl = null,
  WorkerCtor = globalThis.Worker,
} = {}) {
  const dim = dimension === 2 ? 2 : 3;
  if (!Number.isInteger(tickHz) || tickHz < 1 || tickHz > 240) {
    throw new RangeError('Rapier tickHz must be an integer from 1 to 240');
  }
  const fixedDt = 1 / tickHz;

  let mode = 'inline';
  let fallbackReason = null;
  let workerInstance = null;
  let ownsWorker = false;
  let inlineKernel = null;
  let inlineLoadPromise = null;
  let initPromise = null;
  let disposed = false;

  let nextBodyId = 1;
  let nextRequestId = 1;
  let currentTick = 0;

  /** @type {Map<number, { id: number, entity: object, syncRotation: boolean, prev: object, curr: object }>} */
  const entries = new Map();
  /** @type {Map<object, number>} */
  const entityToId = new Map();
  /** @type {Array<object>} */
  const pendingCommands = [];
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const inflightRequests = new Map();

  function assertAlive() {
    if (disposed) {
      throw new Error('Worker physics world is disposed');
    }
  }

  function applyTransforms(stepPayload, writeEntities = true) {
    if (!stepPayload || !stepPayload.ids || !stepPayload.transforms) return;
    currentTick = stepPayload.tick ?? currentTick;
    const { ids, transforms } = stepPayload;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const entry = entries.get(id);
      if (!entry || entry.entity.destroyed) continue;
      const base = i * 7;
      entry.prev.x = entry.curr.x;
      entry.prev.y = entry.curr.y;
      entry.prev.z = entry.curr.z;
      entry.prev.rotationX = entry.curr.rotationX;
      entry.prev.rotationY = entry.curr.rotationY;
      entry.prev.rotationZ = entry.curr.rotationZ;

      entry.curr.x = transforms[base];
      entry.curr.y = transforms[base + 1];
      entry.curr.z = transforms[base + 2];
      entry.curr.rotationX = transforms[base + 3];
      entry.curr.rotationY = transforms[base + 4];
      entry.curr.rotationZ = transforms[base + 5];

      if (writeEntities) {
        entry.entity.x = entry.curr.x;
        entry.entity.y = entry.curr.y;
        if (dim === 3) entry.entity.z = entry.curr.z;
        if (entry.syncRotation) {
          if (dim === 2) {
            entry.entity.rotationZ = entry.curr.rotationZ;
          } else {
            entry.entity.rotationX = entry.curr.rotationX;
            entry.entity.rotationY = entry.curr.rotationY;
            entry.entity.rotationZ = entry.curr.rotationZ;
          }
        }
      }
    }
  }

  function handleWorkerMessage(rawEvent) {
    const msg = rawEvent?.data ?? rawEvent;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'batch' && msg.step) {
      applyTransforms(msg.step, true);
    } else if ((msg.type === 'step' || msg.type === 'restore') && msg.ids && msg.transforms) {
      applyTransforms(msg, true);
    }
    if (msg.requestId !== undefined && inflightRequests.has(msg.requestId)) {
      const pending = inflightRequests.get(msg.requestId);
      inflightRequests.delete(msg.requestId);
      if (msg.type === 'error') {
        pending.reject(new Error(msg.message || 'Physics worker error'));
      } else {
        pending.resolve(msg);
      }
    }
  }

  function sendWorkerRequest(msg) {
    const requestId = nextRequestId++;
    const payload = { ...msg, requestId };
    return new Promise((resolve, reject) => {
      inflightRequests.set(requestId, { resolve, reject });
      try {
        workerInstance.postMessage(payload);
      } catch (err) {
        inflightRequests.delete(requestId);
        reject(err);
      }
    });
  }

  function attachWorker(instance, owned) {
    mode = 'worker';
    workerInstance = instance;
    ownsWorker = owned;
    if (typeof workerInstance.addEventListener === 'function') {
      workerInstance.addEventListener('message', handleWorkerMessage);
      workerInstance.addEventListener('error', (err) => {
        for (const pending of inflightRequests.values()) {
          pending.reject(new Error(err?.message || 'Physics worker failure'));
        }
        inflightRequests.clear();
      });
    } else {
      workerInstance.onmessage = handleWorkerMessage;
    }
    workerInstance.start?.();
    initPromise = sendWorkerRequest({
      type: 'init',
      dimension: dim,
      tickHz,
      gravity: gravity !== undefined ? clonePlain(gravity) : undefined,
    });
  }

  function setupInline(reason) {
    mode = 'inline';
    fallbackReason = reason;
    if (typeof WorldClass === 'function') {
      inlineKernel = createPhysicsKernel(WorldClass, { tickHz, gravity });
    }
  }

  async function ensureInlineKernel() {
    if (inlineKernel) return inlineKernel;
    if (!inlineLoadPromise) {
      inlineLoadPromise = (async () => {
        const mod = dim === 2 ? await import('./rapier2d.js') : await import('./rapier3d.js');
        const LoadedWorld = dim === 2 ? mod.RapierPhysicsWorld2D : mod.RapierPhysicsWorld3D;
        inlineKernel = createPhysicsKernel(LoadedWorld, { tickHz, gravity });
        return inlineKernel;
      })();
    }
    return inlineLoadPromise;
  }

  if (worker && typeof worker === 'object' && typeof worker.postMessage === 'function') {
    attachWorker(worker, false);
  } else if (worker === 'inline') {
    setupInline('Explicit inline mode requested');
  } else if (worker === 'auto' && typeof WorldClass === 'function') {
    setupInline('WorldClass supplied; using inline deterministic physics kernel');
  } else if (typeof WorkerCtor === 'function') {
    try {
      const resolvedUrl = workerUrl ?? new URL('./physics-worker.js', import.meta.url);
      const instance = new WorkerCtor(resolvedUrl, { type: 'module' });
      attachWorker(instance, true);
    } catch (err) {
      if (worker === 'worker') {
        throw err;
      }
      setupInline(err?.message || 'Worker creation failed; falling back to inline physics kernel');
    }
  } else {
    if (worker === 'worker') {
      throw new Error('Global Worker constructor unavailable');
    }
    setupInline('Global Worker constructor unavailable; using inline physics kernel');
  }

  function add(entity, options = {}) {
    assertAlive();
    if (!entity || typeof entity.worldPosition !== 'function' || entity.destroyed) {
      throw new TypeError('Worker physics requires a live HGame Entity');
    }
    if (entity.parent) throw new Error('Rapier physics bodies must be root Entities');
    if (entityToId.has(entity)) throw new Error('Entity already has a physics body');

    const id = nextBodyId++;
    const pose = capturePose(entity);
    entries.set(id, {
      id,
      entity,
      syncRotation: options.syncRotation !== false,
      prev: { ...pose },
      curr: { ...pose },
    });
    entityToId.set(entity, id);

    pendingCommands.push({
      type: 'add',
      id,
      init: {
        ...pose,
        width: entity.width,
        height: entity.height,
        depth: entity.depth,
      },
      options: clonePlain(options),
    });
    return id;
  }

  function requireEntityId(entity, op) {
    const id = entityToId.get(entity);
    if (id === undefined) {
      throw new Error(`Unknown physics entity for ${op}`);
    }
    return id;
  }

  function remove(entity) {
    assertAlive();
    const id = entityToId.get(entity);
    if (id === undefined) return false;
    entries.delete(id);
    entityToId.delete(entity);
    pendingCommands.push({ type: 'remove', id });
    return true;
  }

  function setVelocity(entity, velocity) {
    assertAlive();
    const id = requireEntityId(entity, 'setVelocity');
    pendingCommands.push({ type: 'setVelocity', id, velocity: clonePlain(velocity) });
  }

  function setPosition(entity, position) {
    assertAlive();
    const id = requireEntityId(entity, 'setPosition');
    const plain = clonePlain(position);
    const entry = entries.get(id);
    if (entry) {
      const nx = Number(plain?.x) ?? entry.curr.x;
      const ny = Number(plain?.y) ?? entry.curr.y;
      const nz = dim === 3 ? (Number(plain?.z) ?? entry.curr.z) : entry.curr.z;
      entry.prev.x = entry.curr.x = entry.entity.x = nx;
      entry.prev.y = entry.curr.y = entry.entity.y = ny;
      if (dim === 3) {
        entry.prev.z = entry.curr.z = entry.entity.z = nz;
      }
    }
    pendingCommands.push({ type: 'setPosition', id, position: plain });
  }

  function setAngularVelocity(entity, omega) {
    assertAlive();
    const id = requireEntityId(entity, 'setAngularVelocity');
    pendingCommands.push({ type: 'setAngularVelocity', id, omega: clonePlain(omega) });
  }

  function drainPendingToInline(kernel) {
    if (pendingCommands.length === 0) return null;
    const cmds = pendingCommands.splice(0, pendingCommands.length);
    const rep = kernel.handle({ type: 'batch', commands: cmds });
    if (rep.step) {
      applyTransforms(rep.step, true);
    }
    return rep;
  }

  let lastBatchPromise = null;

  function step(dt = fixedDt) {
    assertAlive();
    if (!Number.isFinite(dt) || Math.abs(dt - fixedDt) > 1e-9) {
      throw new RangeError(`HGame Rapier requires fixed ${tickHz}Hz steps (${fixedDt}s)`);
    }

    pendingCommands.push({ type: 'step', ticks: 1 });

    if (mode === 'inline') {
      if (inlineKernel) {
        drainPendingToInline(inlineKernel);
      } else {
        lastBatchPromise = ensureInlineKernel().then((k) => drainPendingToInline(k));
      }
      return currentTick;
    }

    const cmds = pendingCommands.splice(0, pendingCommands.length);
    lastBatchPromise = sendWorkerRequest({ type: 'batch', commands: cmds });
    return currentTick;
  }

  function getInterpolated(entity, alpha = 1, out = {}) {
    const id = typeof entity === 'number' ? entity : entityToId.get(entity);
    const entry = id !== undefined ? entries.get(id) : null;
    if (!entry) return null;
    const t = Math.max(0, Math.min(1, Number(alpha) || 0));
    out.x = entry.prev.x + (entry.curr.x - entry.prev.x) * t;
    out.y = entry.prev.y + (entry.curr.y - entry.prev.y) * t;
    out.z = entry.prev.z + (entry.curr.z - entry.prev.z) * t;
    out.rotationX = lerpAngle(entry.prev.rotationX, entry.curr.rotationX, t);
    out.rotationY = lerpAngle(entry.prev.rotationY, entry.curr.rotationY, t);
    out.rotationZ = lerpAngle(entry.prev.rotationZ, entry.curr.rotationZ, t);
    return out;
  }

  async function flush() {
    assertAlive();
    if (mode === 'inline') {
      const k = await ensureInlineKernel();
      if (lastBatchPromise) {
        await lastBatchPromise;
        lastBatchPromise = null;
      }
      drainPendingToInline(k);
      return;
    }

    if (initPromise) {
      await initPromise;
    }
    if (pendingCommands.length > 0) {
      const cmds = pendingCommands.splice(0, pendingCommands.length);
      lastBatchPromise = sendWorkerRequest({ type: 'batch', commands: cmds });
    }
    if (lastBatchPromise) {
      await lastBatchPromise;
      lastBatchPromise = null;
    } else {
      await sendWorkerRequest({ type: 'ping' });
    }
  }

  async function stateChecksum() {
    await flush();
    if (mode === 'inline') {
      const k = await ensureInlineKernel();
      return k.handle({ type: 'checksum' }).checksum;
    }
    const rep = await sendWorkerRequest({ type: 'checksum' });
    return rep.checksum;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    pendingCommands.length = 0;
    for (const pending of inflightRequests.values()) {
      pending.reject(new Error('Worker physics world disposed'));
    }
    inflightRequests.clear();
    if (inlineKernel) {
      inlineKernel.handle({ type: 'dispose' });
      inlineKernel = null;
    }
    if (workerInstance) {
      try {
        workerInstance.postMessage({ type: 'dispose' });
      } catch {}
      if (ownsWorker) {
        workerInstance.terminate?.();
      }
      workerInstance = null;
    }
    entries.clear();
    entityToId.clear();
    return true;
  }

  return {
    get mode() {
      return mode;
    },
    get fallbackReason() {
      return fallbackReason;
    },
    get tickHz() {
      return tickHz;
    },
    get fixedDt() {
      return fixedDt;
    },
    get tick() {
      return currentTick;
    },
    get dimension() {
      return dim;
    },
    add,
    remove,
    setVelocity,
    setPosition,
    setAngularVelocity,
    step,
    getInterpolated,
    flush,
    stateChecksum,
    dispose,
  };
}

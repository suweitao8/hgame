import { createPhysicsKernel } from './physics-worker-kernel.js';

let kernel = null;
let initPromise = null;
const pendingQueue = [];

function collectTransferables(reply) {
  const seen = new Set();
  const list = [];
  const addBuf = (arr) => {
    if (arr && arr.buffer instanceof ArrayBuffer && !seen.has(arr.buffer)) {
      seen.add(arr.buffer);
      list.push(arr.buffer);
    }
  };
  if (reply?.transforms) addBuf(reply.transforms);
  if (reply?.ids) addBuf(reply.ids);
  if (reply?.step) {
    addBuf(reply.step.transforms);
    addBuf(reply.step.ids);
  }
  return list;
}

function processMessage(msg) {
  if (!kernel) {
    throw new Error('Physics worker received command before init completed');
  }
  const reply = kernel.handle(msg);
  const transfers = collectTransferables(reply);
  self.postMessage(reply, transfers);
}

self.onmessage = async (event) => {
  const msg = event?.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    const requestId = msg.requestId;
    initPromise = (async () => {
      const dimension = msg.dimension === 2 ? 2 : 3;
      const mod = dimension === 2 ? await import('./rapier2d.js') : await import('./rapier3d.js');
      const WorldClass = dimension === 2 ? mod.RapierPhysicsWorld2D : mod.RapierPhysicsWorld3D;
      kernel = createPhysicsKernel(WorldClass, {
        tickHz: msg.tickHz ?? 60,
        gravity: msg.gravity,
      });
      self.postMessage({ type: 'init', requestId, ok: true, dimension });
      while (pendingQueue.length > 0) {
        const queued = pendingQueue.shift();
        processMessage(queued);
      }
    })();
    try {
      await initPromise;
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId,
        message: err?.message || String(err),
      });
    }
    return;
  }

  if (!kernel) {
    pendingQueue.push(msg);
    if (initPromise) {
      await initPromise;
    }
    return;
  }

  try {
    processMessage(msg);
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: err?.message || String(err),
    });
  }
};

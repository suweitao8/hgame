/**
 * Authoritative multiplayer state synchronization helpers:
 *  - Quantized component/entity delta compression & decompression
 *  - Client-side prediction history & server authoritative reconciliation
 *  - Snapshot jitter buffer interpolation & historical lag-compensation rewind
 */

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function quantizeValue(key, value, quantizePos, quantizeRot) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const k = key.toLowerCase();
  if (k === 'rot' || k === 'yaw' || k === 'pitch' || k === 'roll' || k.includes('angle') || k.includes('rotation')) {
    return Math.round(value * quantizeRot) / quantizeRot;
  }
  return Math.round(value * quantizePos) / quantizePos;
}

function quantizeEntity(entity, quantizePos, quantizeRot) {
  if (!isPlainObject(entity)) return entity;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(entity)) {
    if (isPlainObject(v)) out[k] = quantizeEntity(v, quantizePos, quantizeRot);
    else if (Array.isArray(v)) out[k] = v.map(item => (typeof item === 'number' ? quantizeValue(k, item, quantizePos, quantizeRot) : item));
    else out[k] = quantizeValue(k, v, quantizePos, quantizeRot);
  }
  return out;
}

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const out = {};
  for (const [id, entity] of Object.entries(snapshot)) {
    out[id] = isPlainObject(entity) ? quantizeEntity(entity, 1e9, 1e9) : entity;
  }
  return out;
}

function lerpNumber(a, b, alpha) {
  return a + (b - a) * alpha;
}

function interpolateEntity(a, b, alpha) {
  if (!isPlainObject(a) || !isPlainObject(b)) return alpha < 0.5 ? a : b;
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb)) {
      out[k] = lerpNumber(va, vb, alpha);
    } else if (isPlainObject(va) && isPlainObject(vb)) {
      out[k] = interpolateEntity(va, vb, alpha);
    } else if (vb !== undefined) {
      out[k] = vb;
    } else {
      out[k] = va;
    }
  }
  return out;
}

/**
 * Create a network state synchronization controller for delta compression,
 * client prediction + server reconciliation, snapshot interpolation, and lag-compensation rewind.
 * @param {object} [options]
 * @param {number} [options.quantizePos=100] Position/scalar quantization precision (100 = 0.01 units).
 * @param {number} [options.quantizeRot=1000] Rotation quantization precision.
 * @param {number} [options.maxHistoryFrames=128] Maximum retained history snapshots for prediction & rewind.
 * @param {number} [options.interpolationDelayMs=100] Jitter buffer delay for `sampleInterpolated()`.
 */
export function createNetworkStateSync({
  quantizePos = 100,
  quantizeRot = 1000,
  maxHistoryFrames = 128,
  interpolationDelayMs = 100,
} = {}) {
  const qPos = Math.max(1, Number(quantizePos) || 100);
  const qRot = Math.max(1, Number(quantizeRot) || 1000);
  const historyCap = Math.max(4, Math.floor(Number(maxHistoryFrames) || 128));
  const interpDelayMs = Math.max(0, Number(interpolationDelayMs) || 100);

  /** @type {{ tick: number, input: unknown, predictedState: Record<string, unknown> }[]} */
  const pendingInputs = [];
  /** @type {{ timestampMs: number, state: Record<string, unknown> }[]} */
  const snapshotBuffer = [];

  /**
   * Encode only quantized changed entity fields between `prevSnapshot` and `nextSnapshot`.
   * @param {Record<string, Record<string, unknown>>} prevSnapshot
   * @param {Record<string, Record<string, unknown>>} nextSnapshot
   */
  function encodeDelta(prevSnapshot = {}, nextSnapshot = {}) {
    /** @type {Record<string, { mask: number, keys: string[], values: unknown[] }>} */
    const changed = {};
    const removed = [];

    for (const id of Object.keys(prevSnapshot)) {
      if (!(id in nextSnapshot)) removed.push(id);
    }

    for (const [id, nextEntRaw] of Object.entries(nextSnapshot)) {
      const prevEnt = prevSnapshot[id];
      const nextEnt = quantizeEntity(nextEntRaw, qPos, qRot);
      if (!prevEnt || !isPlainObject(prevEnt) || !isPlainObject(nextEnt)) {
        changed[id] = { mask: -1, keys: Object.keys(nextEnt || {}), values: Object.values(nextEnt || {}) };
        continue;
      }
      const prevQuant = quantizeEntity(prevEnt, qPos, qRot);
      const keys = Object.keys(nextEnt);
      const changedKeys = [];
      const changedValues = [];
      let mask = 0;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (JSON.stringify(prevQuant[k]) !== JSON.stringify(nextEnt[k])) {
          if (i < 31) mask |= (1 << i);
          changedKeys.push(k);
          changedValues.push(nextEnt[k]);
        }
      }
      if (changedKeys.length > 0) {
        changed[id] = { mask, keys: changedKeys, values: changedValues };
      }
    }

    return {
      changed,
      removed,
      changedCount: Object.keys(changed).length + removed.length,
    };
  }

  /**
   * Reconstruct full snapshot from a base snapshot and a delta packet produced by `encodeDelta`.
   * @param {Record<string, Record<string, unknown>>} baseSnapshot
   * @param {{ changed: Record<string, { mask: number, keys: string[], values: unknown[] }>, removed: string[] }} delta
   */
  function decodeDelta(baseSnapshot = {}, delta = { changed: {}, removed: [] }) {
    const out = cloneSnapshot(baseSnapshot);
    if (Array.isArray(delta?.removed)) {
      for (const id of delta.removed) delete out[id];
    }
    if (delta?.changed && typeof delta.changed === 'object') {
      for (const [id, patch] of Object.entries(delta.changed)) {
        const target = isPlainObject(out[id]) ? { ...out[id] } : {};
        const keys = patch?.keys ?? [];
        const values = patch?.values ?? [];
        for (let i = 0; i < keys.length; i++) {
          target[keys[i]] = values[i];
        }
        out[id] = target;
      }
    }
    return out;
  }

  function pushLocalInput(tick, input, predictedState = null) {
    pendingInputs.push({
      tick: Number(tick) || 0,
      input,
      predictedState: predictedState ? cloneSnapshot(predictedState) : {},
    });
    while (pendingInputs.length > historyCap) pendingInputs.shift();
    return pendingInputs.length;
  }

  /**
   * Acknowledge server tick and replay all unacknowledged client inputs atop authoritative state.
   * @param {number} serverTick
   * @param {Record<string, unknown>} authoritativeState
   * @param {(state: Record<string, unknown>, input: unknown, tick: number) => Record<string, unknown>} replayFn
   */
  function reconcileServerState(serverTick, authoritativeState, replayFn) {
    const ack = Number(serverTick) || 0;
    while (pendingInputs.length > 0 && pendingInputs[0].tick <= ack) {
      pendingInputs.shift();
    }
    let state = cloneSnapshot(authoritativeState);
    if (typeof replayFn === 'function') {
      for (const entry of pendingInputs) {
        state = replayFn(cloneSnapshot(state), entry.input, entry.tick);
      }
    }
    return {
      state,
      replayedInputs: pendingInputs.length,
    };
  }

  function pushServerSnapshot(timestampMs, state) {
    const ts = Number(timestampMs) || 0;
    const entry = { timestampMs: ts, state: cloneSnapshot(state) };
    if (snapshotBuffer.length === 0 || ts >= snapshotBuffer[snapshotBuffer.length - 1].timestampMs) {
      snapshotBuffer.push(entry);
    } else {
      const idx = snapshotBuffer.findIndex(s => s.timestampMs > ts);
      snapshotBuffer.splice(idx < 0 ? snapshotBuffer.length : idx, 0, entry);
    }
    while (snapshotBuffer.length > historyCap) snapshotBuffer.shift();
    return snapshotBuffer.length;
  }

  function sampleAt(targetTimeMs) {
    if (snapshotBuffer.length === 0) return null;
    if (snapshotBuffer.length === 1 || targetTimeMs <= snapshotBuffer[0].timestampMs) {
      return cloneSnapshot(snapshotBuffer[0].state);
    }
    const last = snapshotBuffer[snapshotBuffer.length - 1];
    if (targetTimeMs >= last.timestampMs) {
      return cloneSnapshot(last.state);
    }
    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
      const a = snapshotBuffer[i];
      const b = snapshotBuffer[i + 1];
      if (targetTimeMs >= a.timestampMs && targetTimeMs <= b.timestampMs) {
        const span = b.timestampMs - a.timestampMs;
        const alpha = span > 1e-6 ? (targetTimeMs - a.timestampMs) / span : 0;
        const out = {};
        const ids = new Set([...Object.keys(a.state), ...Object.keys(b.state)]);
        for (const id of ids) {
          if (id in a.state && id in b.state) {
            out[id] = interpolateEntity(a.state[id], b.state[id], alpha);
          } else if (id in b.state && alpha >= 0.5) {
            out[id] = b.state[id];
          } else if (id in a.state && alpha < 0.5) {
            out[id] = a.state[id];
          }
        }
        return out;
      }
    }
    return cloneSnapshot(last.state);
  }

  function sampleInterpolated(renderTimeMs) {
    return sampleAt((Number(renderTimeMs) || 0) - interpDelayMs);
  }

  function getHistoricalState(targetTimestampMs) {
    return sampleAt(Number(targetTimestampMs) || 0);
  }

  function getStats() {
    return Object.freeze({
      pendingInputs: pendingInputs.length,
      bufferedSnapshots: snapshotBuffer.length,
      interpolationDelayMs: interpDelayMs,
    });
  }

  function clear() {
    pendingInputs.length = 0;
    snapshotBuffer.length = 0;
  }

  return Object.freeze({
    encodeDelta,
    decodeDelta,
    pushLocalInput,
    reconcileServerState,
    pushServerSnapshot,
    sampleInterpolated,
    getHistoricalState,
    getStats,
    clear,
  });
}

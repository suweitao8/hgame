/**
 * Authoritative multiplayer state synchronization helpers:
 *  - Quantized component/entity delta compression (object delta + compact binary Uint8Array codec)
 *  - Client-side prediction history & server authoritative reconciliation
 *  - Snapshot jitter buffer interpolation & historical lag-compensation rewind
 *  - Scene/Entity binary replicator binding directly to HGame Scene & transport channels
 */

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      const k = ka[i];
      if (!Object.hasOwn(b, k) || !valuesEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function isRotationKey(key) {
  const k = key.toLowerCase();
  return k === 'rot' || k === 'yaw' || k === 'pitch' || k === 'roll' || k.includes('angle') || k.includes('rotation');
}

function quantizeValue(key, value, quantizePos, quantizeRot) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scale = isRotationKey(key) ? quantizeRot : quantizePos;
  return Math.round(value * scale) / scale;
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

// Binary Wire Format Constants
const MAGIC_0 = 0x48; // 'H'
const MAGIC_1 = 0x47; // 'G'
const WIRE_VERSION = 1;
const VAL_TAG_POS_I32 = 0; // Zigzag varint fixed-point using qPos
const VAL_TAG_ROT_I32 = 1; // Zigzag varint fixed-point using qRot
const VAL_TAG_F64 = 2;     // Full IEEE754 float64
const VAL_TAG_BOOL = 3;
const VAL_TAG_STRING = 4;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class ByteWriter {
  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }
  u8(v) { this.ensure(1); this.buf[this.pos++] = v & 0xff; }
  u16(v) { this.ensure(2); this.view.setUint16(this.pos, v >>> 0, true); this.pos += 2; }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  varUint(v) {
    let n = v >>> 0;
    while (n >= 0x80) {
      this.u8((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.u8(n);
  }
  varInt(v) {
    // ZigZag 32-bit signed encoding
    const zz = ((v << 1) ^ (v >> 31)) >>> 0;
    this.varUint(zz);
  }
  str(s) {
    const bytes = textEncoder.encode(String(s));
    this.varUint(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }
  finish() {
    return this.buf.slice(0, this.pos);
  }
}

class ByteReader {
  constructor(bytes) {
    this.buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.pos = 0;
  }
  u8() { return this.buf[this.pos++]; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  varUint() {
    let res = 0;
    let shift = 0;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++];
      res |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return res >>> 0;
      shift += 7;
    }
    throw new Error('Truncated binary delta varint');
  }
  varInt() {
    const zz = this.varUint();
    return (zz >>> 1) ^ -(zz & 1);
  }
  str() {
    const len = this.varUint();
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return textDecoder.decode(slice);
  }
}

/**
 * Create a network state synchronization controller for delta compression (object + binary Uint8Array),
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
        if (!valuesEqual(prevQuant[k], nextEnt[k])) {
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

  /**
   * Encode snapshot delta into a compact binary `Uint8Array` frame with quantized varint values.
   * @param {Record<string, Record<string, unknown>>} prevSnapshot
   * @param {Record<string, Record<string, unknown>>} nextSnapshot
   * @param {{ tick?: number, timestampMs?: number, isKeyframe?: boolean }} [meta]
   * @returns {Uint8Array}
   */
  function encodeDeltaBinary(prevSnapshot = {}, nextSnapshot = {}, { tick = 0, timestampMs = 0, isKeyframe = false } = {}) {
    const delta = isKeyframe ? encodeDelta({}, nextSnapshot) : encodeDelta(prevSnapshot, nextSnapshot);
    const w = new ByteWriter(256);
    w.u8(MAGIC_0);
    w.u8(MAGIC_1);
    w.u8(WIRE_VERSION);
    w.u8(isKeyframe ? 1 : 0);
    w.u32(tick);
    w.f64(Number(timestampMs) || 0);

    w.u16(delta.removed.length);
    for (const id of delta.removed) w.str(id);

    const changedEntries = Object.entries(delta.changed);
    w.u16(changedEntries.length);
    for (const [id, patch] of changedEntries) {
      w.str(id);
      const keys = patch.keys;
      const values = patch.values;
      w.varUint(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = values[i];
        w.str(k);
        if (typeof v === 'number' && Number.isFinite(v)) {
          const isRot = isRotationKey(k);
          const scale = isRot ? qRot : qPos;
          const quantizedInt = Math.round(v * scale);
          if (Math.abs(quantizedInt) <= 0x3fffffff) {
            w.u8(isRot ? VAL_TAG_ROT_I32 : VAL_TAG_POS_I32);
            w.varInt(quantizedInt);
          } else {
            w.u8(VAL_TAG_F64);
            w.f64(v);
          }
        } else if (typeof v === 'boolean') {
          w.u8(VAL_TAG_BOOL);
          w.u8(v ? 1 : 0);
        } else {
          w.u8(VAL_TAG_STRING);
          w.str(v ?? '');
        }
      }
    }
    return w.finish();
  }

  /**
   * Decode a binary `Uint8Array` frame produced by `encodeDeltaBinary` atop `baseSnapshot`.
   * @param {Record<string, Record<string, unknown>>} baseSnapshot
   * @param {Uint8Array} bytes
   */
  function decodeDeltaBinary(baseSnapshot = {}, bytes) {
    const r = new ByteReader(bytes);
    const m0 = r.u8();
    const m1 = r.u8();
    if (m0 !== MAGIC_0 || m1 !== MAGIC_1) {
      throw new Error('Invalid HGame binary delta packet magic');
    }
    const version = r.u8();
    if (version !== WIRE_VERSION) {
      throw new Error(`Unsupported binary delta packet version: ${version}`);
    }
    const flags = r.u8();
    const isKeyframe = (flags & 1) !== 0;
    const tick = r.u32();
    const timestampMs = r.f64();

    const state = isKeyframe ? {} : cloneSnapshot(baseSnapshot);
    const removedCount = r.u16();
    const removed = [];
    for (let i = 0; i < removedCount; i++) {
      const id = r.str();
      removed.push(id);
      delete state[id];
    }

    const changedCount = r.u16();
    for (let e = 0; e < changedCount; e++) {
      const id = r.str();
      const target = isPlainObject(state[id]) ? { ...state[id] } : {};
      const fieldCount = r.varUint();
      for (let f = 0; f < fieldCount; f++) {
        const k = r.str();
        const tag = r.u8();
        if (tag === VAL_TAG_POS_I32) {
          target[k] = r.varInt() / qPos;
        } else if (tag === VAL_TAG_ROT_I32) {
          target[k] = r.varInt() / qRot;
        } else if (tag === VAL_TAG_F64) {
          target[k] = r.f64();
        } else if (tag === VAL_TAG_BOOL) {
          target[k] = r.u8() !== 0;
        } else {
          target[k] = r.str();
        }
      }
      state[id] = target;
    }

    return {
      tick,
      timestampMs,
      isKeyframe,
      state,
      removed,
      changedCount: changedCount + removedCount,
    };
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
    encodeDeltaBinary,
    decodeDeltaBinary,
    pushLocalInput,
    reconcileServerState,
    pushServerSnapshot,
    sampleInterpolated,
    getHistoricalState,
    getStats,
    clear,
  });
}

/**
 * Bind an HGame Scene & transport channel into automatic binary delta replication,
 * snapshot interpolation for remote entities, and local prediction reconciliation.
 * @param {object} options
 * @param {import('../core/scene.js').Scene} options.scene
 * @param {ReturnType<typeof createNetworkStateSync>} [options.stateSync]
 * @param {{ send: (bytes: Uint8Array) => void, onMessage?: (fn: (bytes: Uint8Array) => void) => (() => void) | void }} options.transport
 * @param {'host' | 'client'} [options.role='client']
 * @param {string[]} [options.fields=['x', 'y', 'z', 'rotationY']]
 * @param {string | null} [options.localEntityId=null]
 * @param {((state: Record<string, unknown>, input: unknown, tick: number) => Record<string, unknown>) | null} [options.replayFn=null]
 * @param {((info: { tick: number, timestampMs: number, state: Record<string, unknown> }) => void) | null} [options.onReconcile=null]
 */
export function createSceneReplicator({
  scene,
  stateSync = createNetworkStateSync(),
  transport,
  role = 'client',
  fields = ['x', 'y', 'z', 'rotationY'],
  localEntityId = null,
  replayFn = null,
  onReconcile = null,
} = {}) {
  if (!scene || !Array.isArray(scene.objects)) throw new TypeError('createSceneReplicator requires a valid HGame Scene');
  if (!transport || typeof transport.send !== 'function') throw new TypeError('createSceneReplicator requires a transport with send()');

  let baseSnapshot = {};
  let latestReceivedTick = -1;
  let lastBytesSent = 0;
  let totalBytesSent = 0;
  let totalBytesReceived = 0;
  let packetsSent = 0;
  let packetsReceived = 0;
  let packetsDroppedOutOfOrder = 0;

  function captureSceneSnapshot() {
    /** @type {Record<string, Record<string, unknown>>} */
    const snap = {};
    for (const ent of scene.objects) {
      if (!ent || ent.destroyed) continue;
      const key = ent.name || String(ent.id ?? '');
      if (!key) continue;
      const record = {};
      for (const f of fields) {
        if (f in ent) record[f] = ent[f];
      }
      snap[key] = record;
    }
    return snap;
  }

  function applyStateToScene(state, skipLocalId = null) {
    if (!state || typeof state !== 'object') return 0;
    let updated = 0;
    for (const [key, patch] of Object.entries(state)) {
      if (skipLocalId && key === skipLocalId) continue;
      const ent = scene.find(key);
      if (!ent || !patch || typeof patch !== 'object') continue;
      for (const f of fields) {
        if (f in patch && typeof patch[f] === 'number' && Number.isFinite(patch[f])) {
          ent[f] = patch[f];
        }
      }
      updated++;
    }
    return updated;
  }

  function sendSnapshot(tick, timestampMs, { isKeyframe = false } = {}) {
    if (role !== 'host') return null;
    const current = captureSceneSnapshot();
    const bytes = stateSync.encodeDeltaBinary(baseSnapshot, current, {
      tick,
      timestampMs,
      isKeyframe: isKeyframe || packetsSent === 0,
    });
    baseSnapshot = current;
    lastBytesSent = bytes.byteLength;
    totalBytesSent += lastBytesSent;
    packetsSent++;
    transport.send(bytes);
    return bytes;
  }

  function receivePacket(bytes) {
    if (!(bytes instanceof Uint8Array)) return null;
    totalBytesReceived += bytes.byteLength;
    packetsReceived++;
    const decoded = stateSync.decodeDeltaBinary(baseSnapshot, bytes);
    stateSync.pushServerSnapshot(decoded.timestampMs, decoded.state);
    if (decoded.tick >= latestReceivedTick || decoded.isKeyframe) {
      latestReceivedTick = decoded.tick;
      baseSnapshot = decoded.state;
      if (localEntityId) {
        const recon = stateSync.reconcileServerState(decoded.tick, decoded.state, replayFn);
        applyStateToScene({ [localEntityId]: recon.state[localEntityId] }, null);
        onReconcile?.({ tick: decoded.tick, timestampMs: decoded.timestampMs, state: recon.state });
      }
    } else {
      packetsDroppedOutOfOrder++;
    }
    return decoded;
  }

  const unsubTransport = typeof transport.onMessage === 'function'
    ? transport.onMessage(msg => {
      if (role === 'client') receivePacket(msg);
    })
    : null;

  function stepClient(renderTimeMs) {
    const interpolated = stateSync.sampleInterpolated(renderTimeMs);
    if (!interpolated) return 0;
    return applyStateToScene(interpolated, localEntityId);
  }

  function dispose() {
    if (typeof unsubTransport === 'function') unsubTransport();
  }

  return Object.freeze({
    role,
    stateSync,
    captureSceneSnapshot,
    sendSnapshot,
    receivePacket,
    stepClient,
    getStats() {
      return Object.freeze({
        role,
        packetsSent,
        packetsReceived,
        packetsDroppedOutOfOrder,
        lastBytesSent,
        totalBytesSent,
        totalBytesReceived,
        latestReceivedTick,
        ...stateSync.getStats(),
      });
    },
    dispose,
  });
}

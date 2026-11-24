import { cleanupAll } from '../internal/cleanup.js';
import { releaseScopedImage, retainScopedImage } from '../internal/scoped-image.js';

/** @typedef {'image' | 'json' | 'text' | 'bytes' | 'blob' | 'audio' | 'model' | 'url'} AssetKind */
/** @typedef {{kind: AssetKind, path: string, files?: readonly string[]}} AssetCatalogEntry */
/** @typedef {{schemaVersion: 1, assets: Record<string, AssetCatalogEntry>, groups?: Record<string, readonly string[]>}} AssetCatalogDefinition */
/** @typedef {{kind: AssetKind, path: string, files: readonly string[]}} AssetDescriptor */
/** @typedef {{key: string, entryKind?: AssetKind, refs: number, controller: AbortController, promise: Promise<unknown>, ready: boolean, value: unknown, image: boolean, releaseValue: (() => void) | null}} Acquisition */
/** @typedef {{acquire: (path: string, options: {signal: AbortSignal, resolvedUrl: string}) => Promise<{asset: unknown, release: () => void}>}} CatalogModelProvider */
/**
 * @typedef {object} AssetScope
 * @property {(id: string, options?: {signal?: AbortSignal}) => Promise<unknown>} load Abort the caller's wait without invalidating shared acquisitions.
 * @property {(group: string) => Promise<Record<string, unknown>>} loadGroup
 * @property {() => void} dispose
 */

const KINDS = new Set(['image', 'json', 'text', 'bytes', 'blob', 'audio', 'model', 'url']);
const LOAD_KIND = { audio: 'bytes', model: 'url' };

/** @param {unknown} value @returns {string} */
function normalizeAssetPath(value) {
  if (typeof value !== 'string' || !value || /[\\:%?#<>"|*\x00-\x1f]/.test(value) ||
      value.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part))) {
    throw new TypeError('Expected a file path relative to assets/: ' + String(value));
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function entries(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object');
  return Object.entries(value);
}

/**
 * Normalize a logical asset catalog. The release packager uses the same rules as the browser.
 * @param {AssetCatalogDefinition} data
 */
export function normalizeAssetCatalog(data) {
  if (data?.schemaVersion !== 1) throw new Error('Asset catalog requires schemaVersion 1');
  /** @type {Record<string, AssetDescriptor>} */
  const assets = Object.create(null);
  for (const [id, record] of entries(data.assets, 'assets')) {
    if (!id.trim() || !record || !KINDS.has(record.kind)) throw new Error('Invalid catalog asset: ' + id);
    const siblings = record.files ?? [];
    if (!Array.isArray(siblings)) throw new TypeError('Asset files must be an array: ' + id);
    const primary = normalizeAssetPath(record.path);
    const files = Object.freeze([...new Set(siblings.map(normalizeAssetPath))].filter(file => file !== primary));
    assets[id] = Object.freeze({ kind: record.kind, path: primary, files });
  }
  /** @type {Record<string, readonly string[]>} */
  const groups = Object.create(null);
  for (const [id, members] of entries(data.groups ?? {}, 'groups')) {
    if (!id.trim() || !Array.isArray(members) || members.some(asset => typeof asset !== 'string' || !Object.prototype.hasOwnProperty.call(assets, asset))) {
      throw new Error('Invalid group or unknown member: ' + id);
    }
    groups[id] = Object.freeze([...new Set(members)]);
  }
  return Object.freeze({ schemaVersion: /** @type {const} */ (1), assets: Object.freeze(assets), groups: Object.freeze(groups) });
}

/** @param {AssetCatalogDefinition} data @returns {string[]} */
export function listCatalogFiles(data) {
  const { assets } = normalizeAssetCatalog(data);
  return [...new Set(Object.values(assets).flatMap(entry => [entry.path, ...entry.files]))].sort();
}

function aborted() { return new DOMException('Asset scope released', 'AbortError'); }

/** @param {Promise<unknown>} promise @param {AbortSignal | undefined} signal @param {Set<() => void>} waiters */
function waitForAsset(promise, signal, waiters) {
  return new Promise((resolve, reject) => {
    function finish() {
      if (!waiters.delete(release)) return false;
      signal?.removeEventListener('abort', abort);
      return true;
    }
    function release() { if (finish()) reject(aborted()); }
    function abort() { if (finish()) reject(signal.reason); }
    waiters.add(release);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
    if (signal?.aborted) abort();
  });
}

/**
 * Load assets by logical ID and deduplicate downloads/decodes across active scopes.
 * @param {AssetCatalogDefinition} data
 * @param {{loader: import('./assets.js').AssetLoader, modelProvider?: CatalogModelProvider, maxConcurrentLoads?: number, streamingPolicy?: { getStats?: () => { residentBytes?: number, withinBudget?: boolean, evictions?: number } } | null}} options Queue distinct downloads and decodes together across scopes (default 6). With a model provider, model entries acquire decoded assets.
 */
export function createAssetCatalog(data, { loader, modelProvider, maxConcurrentLoads = 6, streamingPolicy = null }) {
  if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 1) {
    throw new RangeError('Asset catalog maxConcurrentLoads must be a positive integer');
  }
  const definition = normalizeAssetCatalog(data);
  /** @type {Map<string, Acquisition>} */
  const acquired = new Map();
  /** @type {Set<AssetScope>} */
  const scopes = new Set();
  /** @type {Map<Acquisition, {entry: AssetDescriptor, resolve: (value: unknown) => void, reject: (reason: unknown) => void}>} */
  const queue = new Map();
  let running = 0;
  let disposed = false;
  let abortedRequests = 0;
  let disposedLateResources = 0;

  /** @param {string} id @returns {AssetDescriptor} */
  function get(id) {
    const entry = definition.assets[id];
    if (!entry) throw new Error('Unknown catalog asset: ' + id);
    return entry;
  }

  /** @param {AssetDescriptor} entry @param {Acquisition} record @returns {Promise<unknown>} */
  function request(entry, record) {
    const { signal } = record.controller;
    switch (entry.kind) {
      case 'image': return loader.image(entry.path, { signal });
      case 'json': return loader.json(entry.path, { signal });
      case 'text': return loader.text(entry.path, { signal });
      case 'blob': return loader.blob(entry.path, { signal });
      case 'audio': case 'bytes': return loader.arrayBuffer(entry.path, { signal });
      case 'model': {
        if (!modelProvider) return Promise.resolve(loader.resolve(entry.path));
        return modelProvider.acquire('assets/' + entry.path, { signal, resolvedUrl: loader.resolve(entry.path) }).then(lease => {
          record.releaseValue = lease.release;
          return lease.asset;
        });
      }
      case 'url': return Promise.resolve(loader.resolve(entry.path));
    }
  }

  function drainQueue() {
    while (running < maxConcurrentLoads && queue.size > 0) {
      const [record, job] = queue.entries().next().value;
      queue.delete(record);
      running++;
      const signal = record.controller.signal;
      void Promise.resolve().then(() => {
        signal.throwIfAborted();
        return request(job.entry, record);
      }).then(job.resolve, job.reject).finally(() => {
        running--;
        drainQueue();
      });
    }
  }

  /** @param {Acquisition} record @param {AssetDescriptor} entry */
  function schedule(record, entry) {
    // Resolving a URL does not download or decode anything.
    if (entry.kind === 'url' || (entry.kind === 'model' && !modelProvider)) {
      return Promise.resolve().then(() => {
        record.controller.signal.throwIfAborted();
        return request(entry, record);
      });
    }
    return new Promise((resolve, reject) => {
      queue.set(record, { entry, resolve, reject });
      drainQueue();
    });
  }

  /** @param {Acquisition} record */
  function close(record) {
    if (!record.ready) return;
    record.ready = false;
    const image = record.value;
    record.value = undefined;
    const releaseValue = record.releaseValue;
    record.releaseValue = null;
    if (releaseValue) releaseValue();
    if (record.image) releaseScopedImage(image);
  }

  /** @param {Acquisition} record */
  function drop(record) {
    record.refs--;
    if (record.refs !== 0) return;
    if (acquired.get(record.key) === record) acquired.delete(record.key);
    const reason = aborted();
    if (!record.ready) abortedRequests++;
    record.controller.abort(reason);
    const queued = queue.get(record);
    if (queued) {
      queue.delete(record);
      queued.reject(reason);
    }
    close(record);
  }

  /** @param {string} key @param {AssetDescriptor} entry @returns {Acquisition} */
  function makeAcquisition(key, entry) {
    const controller = new AbortController();
    /** @type {Acquisition} */
    const record = { key, entryKind: entry.kind, refs: 0, controller, promise: Promise.resolve(), ready: false, value: undefined, image: entry.kind === 'image', releaseValue: null };
    record.promise = schedule(record, entry).then(result => {
      record.ready = true;
      record.value = result;
      if (record.image) retainScopedImage(result);
      if (record.refs === 0) {
        disposedLateResources++;
        close(record);
        throw aborted();
      }
      return result;
    }, error => {
      if (acquired.get(key) === record) acquired.delete(key);
      throw error;
    });
    acquired.set(key, record);
    return record;
  }

  function estimateAssetValueBytes(kind, value) {
    if (!value) return 0;
    if (kind === 'image') {
      const w = value.width ?? value.naturalWidth ?? value.videoWidth ?? 0;
      const h = value.height ?? value.naturalHeight ?? value.videoHeight ?? 0;
      return w > 0 && h > 0 ? w * h * 4 : 0;
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value?.size === 'number') return value.size;
    return 0;
  }

  function getResidencyStats() {
    let imageBytes = 0;
    let audioBytes = 0;
    let bytesBytes = 0;
    let otherBytes = 0;
    let activeAcquisitions = 0;
    for (const record of acquired.values()) {
      if (!record.ready) continue;
      activeAcquisitions++;
      const kind = record.entryKind ?? record.key.split(':', 1)[0];
      const bytes = estimateAssetValueBytes(kind, record.value);
      if (kind === 'image') imageBytes += bytes;
      else if (kind === 'audio') audioBytes += bytes;
      else if (kind === 'bytes') bytesBytes += bytes;
      else if (kind !== 'model') otherBytes += bytes;
    }
    const modelStats = modelProvider?.residency?.getStats?.() ?? null;
    const modelBytes = modelStats?.residentBytes ?? modelProvider?.residency?.readBytes?.() ?? 0;
    const streamingStats = streamingPolicy?.getStats?.() ?? null;
    return Object.freeze({
      modelBytes,
      imageBytes,
      audioBytes,
      bytesBytes,
      otherBytes,
      totalBytes: modelBytes + imageBytes + audioBytes + bytesBytes + otherBytes,
      streamingBytes: streamingStats?.residentBytes ?? 0,
      streamingWithinBudget: streamingStats?.withinBudget ?? true,
      streamingEvictions: streamingStats?.evictions ?? 0,
      activeAcquisitions,
      queuedLoads: queue.size,
      runningLoads: running,
      abortedRequests: abortedRequests + (modelStats?.abortedRequests ?? 0),
      abortedDependencies: modelStats?.abortedDependencies ?? 0,
      disposedLateResources: disposedLateResources + (modelStats?.disposedLateResources ?? 0),
    });
  }

  return {
    definition, get, getResidencyStats,
    /** @param {string} id @returns {string} */
    url(id) { return loader.resolve(get(id).path); },
    /** @param {string} id @returns {string} */
    projectPath(id) { return 'assets/' + get(id).path; },
    /** @returns {AssetScope} */
    openScope() {
      if (disposed) throw new Error('Asset catalog is disposed');
      /** @type {Map<string, Acquisition>} */
      const held = new Map();
      /** @type {Set<() => void>} */
      const waiters = new Set();
      let released = false;
      /** @type {AssetScope} */
      const scope = {
        async load(id, { signal } = {}) {
          if (released) throw aborted();
          signal?.throwIfAborted();
          const entry = get(id);
          const kind = entry.kind === 'model' && modelProvider ? 'model' : LOAD_KIND[entry.kind] ?? entry.kind;
          const key = kind + ':' + entry.path;
          let record = held.get(key);
          if (!record) {
            record = acquired.get(key) ?? makeAcquisition(key, entry);
            held.set(key, record);
            record.refs++;
          }
          try {
            const result = await waitForAsset(record.promise, signal, waiters);
            if (released) throw aborted();
            return result;
          } catch (error) {
            if (!signal?.aborted && held.get(key) === record) { held.delete(key); drop(record); }
            else if (signal?.aborted) {
              // A cancelled waiter still holds its acquisition until the scope ends.
              // Remove a failed record so other callers can retry it.
              void record.promise.catch(() => {
                if (held.get(key) === record) { held.delete(key); drop(record); }
              });
            }
            throw error;
          }
        },
        async loadGroup(group) {
          if (released) throw aborted();
          const members = definition.groups[group];
          if (!members) throw new Error('Unknown asset group: ' + group);
          const values = await Promise.all(members.map(id => scope.load(id)));
          return Object.fromEntries(members.map((id, index) => [id, values[index]]));
        },
        dispose() {
          if (released) return;
          released = true;
          scopes.delete(scope);
          for (const release of waiters) release();
          const records = [...held.values()];
          held.clear();
          cleanupAll(records.map(record => () => drop(record)), 'Asset scope disposal failed');
        },
      };
      scopes.add(scope);
      return scope;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupAll([...scopes].map(scope => () => scope.dispose()), 'Asset catalog disposal failed');
    },
  };
}

/**
 * Distance- and budget-driven mip/bundle streaming residency policy.
 * Upgrades nearby assets to mip bias 0, downgrades distant assets (mip 1..3),
 * and evicts lowest-priority / farthest assets when exceeding `maxBytes`.
 */
export function createStreamingResidencyPolicy({
  maxBytes = 64 * 1024 * 1024,
  nearDistance = 20,
  midDistance = 50,
  farDistance = 100,
} = {}) {
  const budgetBytes = Math.max(1024, Number(maxBytes) || 64 * 1024 * 1024);
  const nearD = Math.max(0.1, Number(nearDistance) || 20);
  const midD = Math.max(nearD, Number(midDistance) || 50);
  const farD = Math.max(midD, Number(farDistance) || 100);
  const entries = new Map();
  let residentBytes = 0;
  let totalEvictions = 0;
  let totalUpgrades = 0;
  let totalDowngrades = 0;
  let lastWithinBudget = true;
  let globalMipBias = 0;

  function setGlobalMipBias(bias = 0) {
    globalMipBias = Math.max(0, Math.min(3, Math.floor(Number(bias) || 0)));
    return globalMipBias;
  }

  function computeEffectiveBytes(baseBytes, mipBias, evicted) {
    if (evicted) return 0;
    return Math.max(1, Math.round(baseBytes / (1 << (mipBias * 2))));
  }

  function register(id, {
    position = { x: 0, y: 0, z: 0 },
    baseBytes = 1024 * 1024,
    priority = 0,
    onMipChange = null,
    onEvict = null,
  } = {}) {
    if (!id) throw new Error('Streaming entry id is required');
    const entry = {
      id: String(id),
      position: { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 },
      baseBytes: Math.max(1, Math.round(Number(baseBytes) || 1)),
      priority: Number(priority) || 0,
      mipBias: 3,
      evicted: false,
      distance: Infinity,
      residentBytes: 0,
      onMipChange: typeof onMipChange === 'function' ? onMipChange : null,
      onEvict: typeof onEvict === 'function' ? onEvict : null,
    };
    entry.residentBytes = computeEffectiveBytes(entry.baseBytes, entry.mipBias, false);
    entries.set(entry.id, entry);
    return entry;
  }

  function unregister(id) {
    return entries.delete(String(id));
  }

  function setPosition(id, position) {
    const entry = entries.get(String(id));
    if (!entry || !position) return false;
    entry.position.x = Number(position.x) || 0;
    entry.position.y = Number(position.y) || 0;
    entry.position.z = Number(position.z) || 0;
    return true;
  }

  function update(viewerPos = { x: 0, y: 0, z: 0 }) {
    const vx = Number(viewerPos?.x) || 0;
    const vy = Number(viewerPos?.y) || 0;
    const vz = Number(viewerPos?.z) || 0;
    let upgrades = 0;
    let downgrades = 0;
    let evictions = 0;
    const ordered = [];

    for (const entry of entries.values()) {
      const dx = entry.position.x - vx;
      const dy = entry.position.y - vy;
      const dz = entry.position.z - vz;
      const dist = Math.hypot(dx, dy, dz);
      entry.distance = dist;
      const baseMip = dist <= nearD ? 0 : dist <= midD ? 1 : dist <= farD ? 2 : 3;
      const desiredMip = Math.min(3, baseMip + globalMipBias);
      const prevMip = entry.mipBias;
      const wasEvicted = entry.evicted;
      entry.evicted = false;
      entry.mipBias = desiredMip;
      if (!wasEvicted && desiredMip < prevMip) upgrades++;
      else if (!wasEvicted && desiredMip > prevMip) downgrades++;
      entry.residentBytes = computeEffectiveBytes(entry.baseBytes, desiredMip, false);
      ordered.push({ entry, prevMip, wasEvicted });
    }

    // Sort descending eviction order: lowest priority first, then farthest distance
    ordered.sort((a, b) => {
      if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
      return b.entry.distance - a.entry.distance;
    });

    let total = ordered.reduce((sum, item) => sum + item.entry.residentBytes, 0);
    // 1. Downgrade lower-priority / distant assets before touching near high-priority hero assets
    for (let i = 0; i < ordered.length && total > budgetBytes; i++) {
      const item = ordered[i];
      if (item.entry.priority > 0 && item.entry.distance <= nearD) continue;
      if (item.entry.mipBias < 3) {
        const nextBytes = computeEffectiveBytes(item.entry.baseBytes, 3, false);
        total -= item.entry.residentBytes - nextBytes;
        item.entry.mipBias = 3;
        item.entry.residentBytes = nextBytes;
        if (item.entry.mipBias > item.prevMip) downgrades++;
      }
    }
    // 2. Evict lowest-priority / farthest assets while preserving near hero assets if possible
    for (let i = 0; i < ordered.length && total > budgetBytes; i++) {
      const item = ordered[i];
      if (item.entry.priority > 0 && item.entry.distance <= nearD) continue;
      if (!item.entry.evicted) {
        total -= item.entry.residentBytes;
        item.entry.evicted = true;
        item.entry.residentBytes = 0;
        evictions++;
      }
    }
    // 3. Fallback: if still over budget, downgrade/evict remaining entries in order
    for (let i = 0; i < ordered.length && total > budgetBytes; i++) {
      const item = ordered[i];
      if (item.entry.evicted) continue;
      if (item.entry.mipBias < 3) {
        const nextBytes = computeEffectiveBytes(item.entry.baseBytes, 3, false);
        total -= item.entry.residentBytes - nextBytes;
        item.entry.mipBias = 3;
        item.entry.residentBytes = nextBytes;
        if (item.entry.mipBias > item.prevMip) downgrades++;
      }
      if (total > budgetBytes) {
        total -= item.entry.residentBytes;
        item.entry.evicted = true;
        item.entry.residentBytes = 0;
        evictions++;
      }
    }

    for (const item of ordered) {
      if (item.entry.evicted && !item.wasEvicted) {
        item.entry.onEvict?.(item.entry);
      } else if (!item.entry.evicted && (item.entry.mipBias !== item.prevMip || item.wasEvicted)) {
        item.entry.onMipChange?.(item.entry.mipBias, item.prevMip, item.entry);
      }
    }

    residentBytes = total;
    lastWithinBudget = residentBytes <= budgetBytes;
    totalUpgrades += upgrades;
    totalDowngrades += downgrades;
    totalEvictions += evictions;

    return {
      residentBytes,
      maxBytes: budgetBytes,
      withinBudget: lastWithinBudget,
      activeCount: ordered.filter((item) => !item.entry.evicted).length,
      evictedCount: ordered.filter((item) => item.entry.evicted).length,
      upgrades,
      downgrades,
      evictions,
    };
  }

  function getEntry(id) {
    return entries.get(String(id)) ?? null;
  }

  function getStats() {
    let activeCount = 0;
    let evictedCount = 0;
    for (const entry of entries.values()) {
      if (entry.evicted) evictedCount++;
      else activeCount++;
    }
    return Object.freeze({
      maxBytes: budgetBytes,
      residentBytes,
      withinBudget: lastWithinBudget,
      totalEntries: entries.size,
      activeCount,
      evictedCount,
      upgrades: totalUpgrades,
      downgrades: totalDowngrades,
      evictions: totalEvictions,
    });
  }

  function dispose() {
    entries.clear();
    residentBytes = 0;
  }

  return Object.freeze({
    register,
    unregister,
    setPosition,
    setGlobalMipBias,
    update,
    getEntry,
    getStats,
    dispose,
  });
}

/**
 * VRAM Anti-OOM Mip Guard that dynamically shifts streaming mip bias down (lowering texture VRAM
 * by 4x-16x) when allocated device/texture bytes approach mobile WebView soft/hard thresholds.
 */
export function createVramMipGuard({
  streamingPolicy = null,
  budgetBytes = 128 * 1024 * 1024,
  softRatio = 0.8,
  hardRatio = 0.92,
  onMipBiasChange = null,
} = {}) {
  const defaultBudget = Math.max(1024, Number(budgetBytes) || 128 * 1024 * 1024);
  const soft = Math.max(0.1, Math.min(0.95, Number(softRatio) || 0.8));
  const hard = Math.max(soft + 0.01, Math.min(1.0, Number(hardRatio) || 0.92));
  let mipBiasOffset = 0;
  let state = 'healthy';
  let lastRatio = 0;

  function step(usedBytes, overrideBudget = defaultBudget) {
    const budget = Math.max(1024, Number(overrideBudget) || defaultBudget);
    const ratio = Math.max(0, (Number(usedBytes) || 0) / budget);
    lastRatio = ratio;

    let nextOffset = mipBiasOffset;
    let nextState = state;
    if (ratio >= hard) {
      nextOffset = 2;
      nextState = 'hard-degrade';
    } else if (ratio >= soft) {
      nextOffset = Math.max(mipBiasOffset === 2 && ratio >= soft * 0.9 ? 2 : 1, 1);
      nextState = 'soft-degrade';
    } else if (ratio < soft * 0.85) {
      nextOffset = 0;
      nextState = 'healthy';
    }

    const changed = nextOffset !== mipBiasOffset || nextState !== state;
    mipBiasOffset = nextOffset;
    state = nextState;
    if (changed) {
      streamingPolicy?.setGlobalMipBias?.(mipBiasOffset);
      onMipBiasChange?.({ mipBiasOffset, state, ratio });
    }
    return { mipBiasOffset, state, ratio, changed };
  }

  function getState() {
    return Object.freeze({ mipBiasOffset, state, ratio: lastRatio, budgetBytes: defaultBudget });
  }

  return Object.freeze({ step, getState });
}

/**
 * Progressive 3-stage boot asset loader (`P0` splash-interactive <1.5s critical assets,
 * `P1` background gameplay stage 1, `P2` deferred waves/late-stage assets).
 * @param {{ p0?: string[], p1?: string[], p2?: string[], loadAsset?: (id: string) => Promise<any>, onStageComplete?: ((stage: 'p0'|'p1'|'p2', info: { durationMs: number, count: number }) => void)|null }} [options]
 */
export function createProgressiveBootLoader({
  p0 = [],
  p1 = [],
  p2 = [],
  loadAsset = async (id) => id,
  onStageComplete = null,
} = {}) {
  let aborted = false;
  let backgroundPromise = null;
  const completedStages = [];
  const timings = { p0Ms: 0, p1Ms: 0, p2Ms: 0 };

  async function runStage(name, list) {
    const t0 = performance.now();
    const items = Array.isArray(list) ? list : [];
    for (let i = 0; i < items.length; i++) {
      if (aborted) return false;
      await loadAsset(items[i]);
    }
    if (aborted) return false;
    const durationMs = Number(Math.max(0, performance.now() - t0).toFixed(3));
    timings[`${name}Ms`] = durationMs;
    completedStages.push(name);
    onStageComplete?.(name, { durationMs, count: items.length });
    return true;
  }

  async function start() {
    aborted = false;
    completedStages.length = 0;
    await runStage('p0', p0);
    backgroundPromise = (async () => {
      if (!aborted) await runStage('p1', p1);
      if (!aborted) await runStage('p2', p2);
    })();
    return Object.freeze({
      interactiveReady: !aborted,
      p0Ms: timings.p0Ms,
      p0Count: Array.isArray(p0) ? p0.length : 0,
    });
  }

  async function whenAllReady() {
    if (backgroundPromise) await backgroundPromise;
    return Object.freeze({
      aborted,
      completedStages: [...completedStages],
      timings: { ...timings },
    });
  }

  function abort() {
    aborted = true;
  }

  return Object.freeze({
    start,
    whenAllReady,
    abort,
    getState: () => Object.freeze({ aborted, completedStages: [...completedStages], timings: { ...timings } }),
  });
}

/**
 * Bind an actual Three.js / Image texture object into `createStreamingResidencyPolicy`
 * so mip upgrades/downgrades automatically swap backing resolution/image sources and mark `needsUpdate`.
 */
export function bindTextureMipStreaming(policy, id, texture, {
  position = { x: 0, y: 0, z: 0 },
  baseBytes = 4 * 1024 * 1024,
  priority = 0,
  mipSources = [],
  anisotropies = [16, 8, 4, 1],
  onSwap = null,
} = {}) {
  if (!policy || typeof policy.register !== 'function' || !texture || typeof texture !== 'object') {
    throw new TypeError('bindTextureMipStreaming requires a residency policy and target texture');
  }
  let swaps = 0;
  let lastAppliedMip = -1;
  let evictedCount = 0;

  const entry = policy.register(id, {
    position,
    baseBytes,
    priority,
    onMipChange(nextMip) {
      const src = mipSources[nextMip] ?? mipSources[mipSources.length - 1] ?? null;
      if (src !== null && src !== undefined && texture.image !== src) {
        texture.image = src;
      }
      if ('anisotropy' in texture && anisotropies[nextMip] !== undefined) {
        texture.anisotropy = anisotropies[nextMip];
      }
      if (texture.userData) texture.userData.streamingMipBias = nextMip;
      else texture.userData = { streamingMipBias: nextMip };
      texture.needsUpdate = true;
      lastAppliedMip = nextMip;
      swaps++;
      onSwap?.(nextMip, texture);
    },
    onEvict() {
      evictedCount++;
      texture.image = mipSources[mipSources.length - 1] ?? null;
      if ('anisotropy' in texture) texture.anisotropy = 1;
      texture.needsUpdate = true;
      texture.dispose?.();
    },
  });

  return Object.freeze({
    entry,
    get swaps() { return swaps; },
    get lastAppliedMip() { return lastAppliedMip; },
    get evictedCount() { return evictedCount; },
    unbind() { return policy.unregister(id); },
  });
}

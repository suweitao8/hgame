import { cleanupAll } from '../internal/cleanup.js';
import { releaseScopedImage, retainScopedImage } from '../internal/scoped-image.js';

/** @typedef {'image' | 'json' | 'text' | 'bytes' | 'blob' | 'audio' | 'model' | 'url'} AssetKind */
/** @typedef {{kind: AssetKind, path: string, files?: readonly string[]}} AssetCatalogEntry */
/** @typedef {{schemaVersion: 1, assets: Record<string, AssetCatalogEntry>, groups?: Record<string, readonly string[]>}} AssetCatalogDefinition */
/** @typedef {{kind: AssetKind, path: string, files: readonly string[]}} AssetDescriptor */
/** @typedef {{key: string, refs: number, controller: AbortController, promise: Promise<unknown>, ready: boolean, value: unknown, image: boolean, releaseValue: (() => void) | null}} Acquisition */
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
    if (!id.trim() || !Array.isArray(members) || members.some(asset => typeof asset !== 'string' || !Object.hasOwn(assets, asset))) {
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
 * @param {{loader: import('./assets.js').AssetLoader, modelProvider?: CatalogModelProvider, maxConcurrentLoads?: number}} options Queue distinct downloads and decodes together across scopes (default 6). With a model provider, model entries acquire decoded assets.
 */
export function createAssetCatalog(data, { loader, modelProvider, maxConcurrentLoads = 6 }) {
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
    const record = { key, refs: 0, controller, promise: Promise.resolve(), ready: false, value: undefined, image: entry.kind === 'image', releaseValue: null };
    record.promise = schedule(record, entry).then(result => {
      record.ready = true;
      record.value = result;
      if (record.image) retainScopedImage(result);
      if (record.refs === 0) { close(record); throw aborted(); }
      return result;
    }, error => {
      if (acquired.get(key) === record) acquired.delete(key);
      throw error;
    });
    acquired.set(key, record);
    return record;
  }

  return {
    definition, get,
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

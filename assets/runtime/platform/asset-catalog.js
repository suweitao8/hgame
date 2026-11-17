import { cleanupAll } from '../internal/cleanup.js';

/** @typedef {'image' | 'json' | 'text' | 'bytes' | 'blob' | 'audio' | 'model' | 'url'} AssetKind */
/** @typedef {{kind: AssetKind, path: string, files?: readonly string[]}} AssetCatalogEntry */
/** @typedef {{schemaVersion: 1, assets: Record<string, AssetCatalogEntry>, groups?: Record<string, readonly string[]>}} AssetCatalogDefinition */
/** @typedef {{kind: AssetKind, path: string, files: readonly string[]}} AssetDescriptor */
/** @typedef {{key: string, refs: number, controller: AbortController, promise: Promise<unknown>, ready: boolean, value: unknown, image: boolean}} Acquisition */
/**
 * @typedef {object} AssetScope
 * @property {(id: string) => Promise<unknown>} load
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

/**
 * Load assets by logical ID and deduplicate downloads/decodes across active scopes.
 * @param {AssetCatalogDefinition} data
 * @param {{loader: import('./assets.js').AssetLoader}} options
 */
export function createAssetCatalog(data, { loader }) {
  const definition = normalizeAssetCatalog(data);
  /** @type {Map<string, Acquisition>} */
  const acquired = new Map();
  /** @type {Set<AssetScope>} */
  const scopes = new Set();
  let disposed = false;

  /** @param {string} id @returns {AssetDescriptor} */
  function get(id) {
    const entry = definition.assets[id];
    if (!entry) throw new Error('Unknown catalog asset: ' + id);
    return entry;
  }

  /** @param {AssetDescriptor} entry @param {AbortSignal} signal @returns {Promise<unknown>} */
  function request(entry, signal) {
    switch (entry.kind) {
      case 'image': return loader.image(entry.path, { signal });
      case 'json': return loader.json(entry.path, { signal });
      case 'text': return loader.text(entry.path, { signal });
      case 'blob': return loader.blob(entry.path, { signal });
      case 'audio': case 'bytes': return loader.arrayBuffer(entry.path, { signal });
      case 'model': case 'url': return Promise.resolve(loader.resolve(entry.path));
    }
  }

  /** @param {Acquisition} record */
  function close(record) {
    if (!record.ready) return;
    record.ready = false;
    const image = /** @type {{close?: () => void} | null} */ (record.value);
    record.value = undefined;
    if (record.image) image?.close?.();
  }

  /** @param {Acquisition} record */
  function drop(record) {
    record.refs--;
    if (record.refs !== 0) return;
    if (acquired.get(record.key) === record) acquired.delete(record.key);
    record.controller.abort(aborted());
    close(record);
  }

  /** @param {string} key @param {AssetDescriptor} entry @returns {Acquisition} */
  function makeAcquisition(key, entry) {
    const controller = new AbortController();
    /** @type {Acquisition} */
    const record = { key, refs: 0, controller, promise: Promise.resolve(), ready: false, value: undefined, image: entry.kind === 'image' };
    record.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return request(entry, controller.signal);
    }).then(result => {
      record.ready = true;
      record.value = result;
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
      let released = false;
      /** @type {AssetScope} */
      const scope = {
        async load(id) {
          if (released) throw aborted();
          const entry = get(id);
          const key = (LOAD_KIND[entry.kind] ?? entry.kind) + ':' + entry.path;
          let record = held.get(key);
          if (!record) {
            record = acquired.get(key) ?? makeAcquisition(key, entry);
            held.set(key, record);
            record.refs++;
          }
          try {
            const result = await record.promise;
            if (released) throw aborted();
            return result;
          } catch (error) {
            if (held.get(key) === record) { held.delete(key); drop(record); }
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

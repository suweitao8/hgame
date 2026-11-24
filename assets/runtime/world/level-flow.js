import { Scene } from '../core/scene.js';
import { mountLevel } from './level.js';
import { identifier } from '../internal/gameplay.js';

/** @typedef {import('./level.js').LevelDefinition} LevelDefinition */
/** @typedef {'json' | 'text' | 'arrayBuffer' | 'blob' | 'image'} LevelAssetKind */
/** @typedef {ReturnType<typeof import('../platform/asset-catalog.js').createAssetCatalog>} AssetCatalog */
/** @typedef {{level: LevelDefinition | string, assets?: Record<string, {kind: LevelAssetKind, path: string}>, assetGroups?: readonly string[]}} LevelRoute */
/** @typedef {{id: string, scene: Scene, level: ReturnType<typeof mountLevel>, assets: Readonly<Record<string, unknown>>}} LevelSession */
/** @typedef {(release: () => unknown) => void} DeferRelease */
/** @typedef {{session: LevelSession, cleanupErrors: unknown[]}} LevelTransition */
/** @typedef {{id: string, controller: AbortController, scene: Scene | null, session: LevelSession | null, promise: Promise<LevelSession> | null, releases: (() => unknown)[], releasing: Promise<unknown[]> | null}} PreparedLevel */
/**
 * @typedef {object} LevelFlowOptions
 * @property {import('../core/scene.js').SceneManager} scenes
 * @property {import('../core/prefab.js').PrefabRegistry} prefabs
 * @property {import('../platform/assets.js').AssetLoader} [assets]
 * @property {AssetCatalog} [catalog] Shared media catalog. The caller owns it.
 * @property {Record<string, LevelRoute>} routes
 * @property {(name: string, id: string) => Scene} [createScene] Return a new, inactive and unregistered scene.
 * @property {(session: LevelSession, signal: AbortSignal, deferRelease: DeferRelease) => void | Promise<void>} [prepare]
 * @property {(id: string, event: import('./trigger-volumes.js').TriggerEvent) => void} [onTrigger]
 * @property {(error: unknown) => void} [onCleanupError] For cancellation and application teardown.
 */

let nextFlow = 1;
const kinds = new Set(['json', 'text', 'arrayBuffer', 'blob', 'image']);
function aborted() { return new DOMException('Level transition cancelled', 'AbortError'); }
/** @param {unknown} value @param {WeakMap<object, unknown>} [seen] @returns {any} */
function cloneData(value, seen) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  if (value === null || typeof value !== 'object') return value;
  const memo = seen ?? new WeakMap();
  if (memo.has(value)) return memo.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (ArrayBuffer.isView(value)) {
    return value instanceof DataView
      ? new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength)
      : new /** @type {any} */ (value.constructor)(value);
  }
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof Map) {
    const out = new Map();
    memo.set(value, out);
    value.forEach((v, k) => out.set(cloneData(k, memo), cloneData(v, memo)));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    memo.set(value, out);
    value.forEach(v => out.add(cloneData(v, memo)));
    return out;
  }
  /** @type {any} */
  const out = Array.isArray(value) ? [] : {};
  memo.set(value, out);
  for (const key of Object.keys(value)) {
    out[key] = cloneData(/** @type {any} */ (value)[key], memo);
  }
  return out;
}

/**
 * Preload, prepare and switch between game-owned levels on the existing SceneManager.
 * The current scene remains live through loading and candidate activation.
 * @param {LevelFlowOptions} options
 */
export function createLevelFlow({ scenes, prefabs, assets, catalog, routes, createScene, prepare, onTrigger, onCleanupError }) {
  const definitions = new Map();
  for (const [id, route] of Object.entries(routes)) {
    identifier(id, 'route id');
    const requests = Object.entries(route.assets ?? {}).map(([key, request]) => {
      if (!kinds.has(request.kind)) throw new Error('Unknown level asset kind: ' + request.kind);
      return { key: identifier(key, 'asset key'), kind: request.kind, path: identifier(request.path, 'asset path') };
    });
    const level = typeof route.level === 'string' ? identifier(route.level, 'level path') : cloneData(route.level);
    if (!assets && (typeof level === 'string' || requests.length)) throw new Error('Asset loader required for route: ' + id);
    const keys = new Set(requests.map(request => request.key));
    const media = new Set();
    for (const group of route.assetGroups ?? []) {
      const members = catalog?.definition.groups[group];
      if (!members) throw new Error('Unknown asset group ' + group + ' for route: ' + id);
      for (const asset of members) {
        if (keys.has(asset)) throw new Error('Duplicate route asset: ' + asset);
        media.add(asset);
      }
    }
    definitions.set(id, { level, requests, media: [...media] });
  }

  /** @type {Map<string, PreparedLevel>} */
  const staged = new Map();
  /** @type {Set<Promise<void>>} */
  const discards = new Set();
  /** @type {Set<Promise<unknown[]>>} */
  const retiring = new Set();
  const namespace = 'hgame-level:' + nextFlow++ + ':';
  let sceneNumber = 0;
  /** @type {PreparedLevel | null} */
  let active = null;
  /** @type {{entry: PreparedLevel} | null} */
  let navigation = null;
  let closed = false;
  let managerClosing = false;
  /** @type {Promise<void> | null} */
  let closing = null;

  function live() { if (closed || scenes.app.disposed) throw new Error('Level flow is disposed'); }

  /** @param {PreparedLevel} entry @returns {Promise<unknown[]>} */
  function release(entry) {
    if (entry.releasing) return entry.releasing;
    entry.releasing = Promise.resolve().then(async () => {
      const errors = [];
      const scene = entry.scene;
      if (scene && !managerClosing) {
        try {
          if (scenes.get(scene.name) === scene) scenes.remove(scene.name);
          else if (!scene.app && (scene.objects.length || scene.physics)) scene.dispose();
        } catch (error) { errors.push(error); }
      }
      for (const dispose of entry.releases.splice(0).reverse()) {
        try { await dispose(); } catch (error) { errors.push(error); }
      }
      entry.scene = null;
      entry.session = null;
      return errors;
    });
    retiring.add(entry.releasing);
    void entry.releasing.then(() => retiring.delete(entry.releasing), () => retiring.delete(entry.releasing));
    return entry.releasing;
  }

  /** @param {PreparedLevel} entry */
  async function load(entry) {
    const route = definitions.get(entry.id);
    const { signal } = entry.controller;
    const resources = Object.create(null);
    let scopeOpen = true;
    /** @type {DeferRelease} */
    const deferRelease = callback => {
      if (!scopeOpen || typeof callback !== 'function') throw new Error('Register resource cleanup while preparing the scene');
      entry.releases.push(callback);
    };
    try {
      const scope = route.media.length ? catalog.openScope() : null;
      if (scope) deferRelease(() => scope.dispose());
      let firstFailure;
      let failed = false;
      /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
      async function capture(task) {
        try { signal.throwIfAborted(); return await task(); }
        catch (error) {
          if (!failed) { failed = true; firstFailure = error; entry.controller.abort(error); }
          throw error;
        }
      }
      let cursor = 0;
      const workCount = route.requests.length + route.media.length;
      async function worker() {
        while (cursor < workCount && !signal.aborted) {
          const index = cursor++;
          if (index >= route.requests.length) {
            const id = route.media[index - route.requests.length];
            resources[id] = await scope.load(id, { signal });
            continue;
          }
          const request = route.requests[index];
          const value = await assets[request.kind](request.path, { signal });
          if (request.kind === 'image' && value && typeof value.close === 'function') deferRelease(() => value.close());
          resources[request.key] = value;
        }
      }
      const definitionTask = capture(async () => typeof route.level === 'string' ? assets.json(route.level, { signal }) : route.level);
      const tasks = [definitionTask, ...Array.from({ length: Math.min(4, workCount) }, () => capture(worker))];
      await Promise.allSettled(tasks);
      if (failed) throw firstFailure;
      signal.throwIfAborted(); live();
      const definition = await definitionTask;
      signal.throwIfAborted(); live();
      const name = namespace + ++sceneNumber + ':' + entry.id;
      const scene = createScene ? createScene(name, entry.id) : new Scene(name);
      if (!(scene instanceof Scene) || scene.name !== name || scene.app || scene.active) {
        throw new Error('Level scene factory must return a fresh inactive Scene with the provided name');
      }
      entry.scene = scene;
      scenes.add(scene);
      signal.throwIfAborted(); live();
      const level = mountLevel(scene, prefabs, /** @type {LevelDefinition} */ (definition), {
        onTrigger(event) { onTrigger?.(entry.id, event); },
      });
      const session = { id: entry.id, scene, level, assets: Object.freeze(resources) };
      await prepare?.(session, signal, deferRelease);
      signal.throwIfAborted(); live();
      if (scenes.get(scene.name) !== scene || scene.active) throw new Error('Preparation must leave its scene registered and inactive');
      entry.session = session;
      return session;
    } catch (error) {
      scopeOpen = false;
      const errors = await release(entry);
      if (staged.get(entry.id) === entry) staged.delete(entry.id);
      if (errors.length) throw new AggregateError([error, ...errors], 'Level preparation and cleanup failed');
      throw error;
    } finally { scopeOpen = false; }
  }

  /** @param {string} id @returns {PreparedLevel} */
  function getOrPrepare(id) {
    live();
    if (!definitions.has(id)) throw new Error('Unknown level route: ' + id);
    if (active?.id === id && active.scene === scenes.current) return active;
    const previous = staged.get(id);
    if (previous) return previous;
    /** @type {PreparedLevel} */
    const entry = { id, controller: new AbortController(), scene: null, session: null, promise: null, releases: [], releasing: null };
    staged.set(id, entry);
    entry.promise = load(entry);
    return entry;
  }

  /** @param {PreparedLevel} entry */
  function discardEntry(entry) {
    if (staged.get(entry.id) === entry) staged.delete(entry.id);
    entry.controller.abort(aborted());
    const pending = entry.promise.then(() => {}, () => {}).then(async () => {
      const errors = await release(entry);
      if (errors.length) throw new AggregateError(errors, 'Prepared level cleanup failed');
    });
    discards.add(pending);
    void pending.then(() => discards.delete(pending), () => discards.delete(pending));
    return pending;
  }

  /** @param {Promise<unknown>} promise */
  function background(promise) {
    void promise.catch(error => {
      try {
        if (onCleanupError) onCleanupError(error);
        else console.error('Level flow cleanup failed:', error);
      } catch (reportError) { console.error('Level flow cleanup reporting failed:', reportError); }
    });
  }

  function dispose() {
    if (closing) return closing;
    closed = true;
    navigation = null;
    offDispose();
    const old = active;
    active = null;
    const candidates = [...staged.values()];
    staged.clear();
    closing = Promise.resolve().then(async () => {
      const releases = new Set(retiring);
      if (old) releases.add(release(old));
      const pending = [...releases].map(task => task.then(errors => {
        if (errors.length) throw new AggregateError(errors, 'Level cleanup failed');
      }));
      for (const entry of candidates) discardEntry(entry);
      const results = await Promise.allSettled([...discards, ...pending]);
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Level flow disposal failed');
    });
    return closing;
  }
  const offDispose = scenes.onDispose(() => { managerClosing = true; background(dispose()); });

  return {
    /** Prepare the route without activating it. @param {string} id @returns {Promise<void>} */
    async prefetch(id) { await getOrPrepare(id).promise; },
    /** @param {string} id @param {unknown} [data] @returns {Promise<LevelTransition>} */
    async go(id, data) {
      const entry = getOrPrepare(id);
      if (navigation && navigation.entry !== entry && navigation.entry !== active &&
          (!navigation.entry.scene || navigation.entry.scene !== scenes.current)) {
        background(discardEntry(navigation.entry));
      }
      const intent = { entry };
      navigation = intent;
      try {
        const session = await entry.promise;
        if (closed || navigation !== intent || entry.controller.signal.aborted) throw aborted();
        if (entry === active && scenes.current === session.scene) return { session, cleanupErrors: [] };
        let switched;
        try {
          switched = scenes.activatePrepared(session.scene.name, data,
            () => !closed && navigation === intent && !entry.controller.signal.aborted);
          if (!switched.changed || closed || scenes.current !== session.scene) throw aborted();
        } catch (error) {
          if (staged.get(id) === entry) staged.delete(id);
          const errors = await release(entry);
          if (errors.length) throw new AggregateError([error, ...errors], 'Level switch and cleanup failed');
          throw error;
        }
        if (staged.get(id) === entry) staged.delete(id);
        const old = active;
        active = entry;
        // Publish the committed transition before yielding to asynchronous resource cleanup.
        if (navigation === intent) navigation = null;
        const cleanupErrors = [...switched.cleanupErrors];
        if (old && old !== entry) cleanupErrors.push(...await release(old));
        return { session, cleanupErrors };
      } finally { if (navigation === intent) navigation = null; }
    },
    /** Cancel the pending activation. The current scene stays available. */
    cancel() {
      if (!navigation || navigation.entry === active ||
          (navigation.entry.scene && navigation.entry.scene === scenes.current)) return false;
      const entry = navigation.entry;
      navigation = null;
      background(discardEntry(entry));
      return true;
    },
    /** Drop an unused prefetch and release what it owns. @param {string} id */
    async discard(id) {
      const entry = staged.get(id);
      if (!entry || (entry.scene && entry.scene === scenes.current)) return false;
      if (navigation?.entry === entry) navigation = null;
      await discardEntry(entry);
      return true;
    },
    /** @returns {LevelSession | null} */
    getCurrent() { return active?.scene === scenes.current ? active?.session ?? null : null; },
    dispose,
  };
}

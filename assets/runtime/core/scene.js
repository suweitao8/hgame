import { Component } from './component.js';
import { Entity } from './entity.js';
import { TweenManager } from '../time/tween.js';
import { cleanupAll } from '../internal/cleanup.js';

/**
 * @typedef {{ type: string } & Record<string, unknown>} GameCommand Command delivered to {@link Scene#onCommand}.
 */

/**
 * @typedef {object} ScenePhysicsWorld Per-scene physics world contract (provided by the physics modules).
 * @property {(dtSeconds: number) => void} [step]
 * @property {(entity: import('./entity.js').Entity) => void} [remove]
 * @property {() => void} [dispose]
 */

/** @typedef {{ exact?: boolean, activeOnly?: boolean }} SceneTagFindOptions */
const SCRATCH_WALK = [];
const SCRATCH_COMPS = [];
let walkDepth = 0;
let compDepth = 0;
const PROTO_HOOKS = Component.prototype;

/** @param {readonly Entity[]} roots @param {(entity: Entity) => void} action @returns {void} */
function walk(roots, action) {
  const len = roots.length;
  if (len === 0) return;
  const depth = walkDepth++;
  const buf = SCRATCH_WALK[depth] ?? (SCRATCH_WALK[depth] = []);
  let i = 0;
  try {
    for (let k = 0; k < len; k++) buf[k] = roots[k];
    for (; i < len; i++) {
      const entity = buf[i];
      buf[i] = null;
      if (!entity.destroyed) {
        action(entity);
        if (!entity.destroyed && entity.children.length > 0) {
          walk(entity.children, action);
        }
      }
    }
  } finally {
    while (i < len) buf[i++] = null;
    walkDepth--;
  }
}

/** @param {readonly Entity[]} roots @returns {void} */
function captureTransformsOnRoots(roots) {
  for (let i = 0, n = roots.length; i < n; i++) {
    const entity = roots[i];
    if (!entity.destroyed && entity.active) {
      entity._capturePreviousTransform();
      if (entity.children.length > 0) captureTransformsOnRoots(entity.children);
    }
  }
}

/** @param {Component} component @param {Entity} entity @param {'fixedUpdate' | 'update' | 'lateUpdate'} phase @param {number} dt @param {import('./application.js').GameApplication} app @param {Scene} scene */
function runComponentPhase(component, entity, phase, dt, app, scene) {
  if (component._destroyed || !component._running || entity.scene !== scene || !scene.active) return;
  if (!component._started) {
    component._started = true;
    component.start();
    if (!component._running || entity.scene !== scene || !scene.active) return;
  }
  const hook = component[phase];
  if (typeof hook === 'function' && hook !== PROTO_HOOKS[phase]) hook.call(component, dt, app);
}

/** @param {readonly Entity[]} roots @param {'fixedUpdate' | 'update' | 'lateUpdate'} phase @param {number} dt @param {import('./application.js').GameApplication} app @param {Scene} scene @param {Entity | null} [parent] @returns {void} */
function runPhaseOnRoots(roots, phase, dt, app, scene, parent = null) {
  const len = roots.length;
  if (len === 0 || !scene.active) return;
  const depth = walkDepth++;
  const buf = SCRATCH_WALK[depth] ?? (SCRATCH_WALK[depth] = []);
  let i = 0;
  try {
    for (let k = 0; k < len; k++) buf[k] = roots[k];
    for (; i < len; i++) {
      const entity = buf[i];
      buf[i] = null;
      if (!scene.active || entity.destroyed || entity.scene !== scene || entity.parent !== parent || !entity.activeInHierarchy) continue;
      const comps = entity.components;
      const clen = comps.length;
      if (clen === 1) {
        runComponentPhase(comps[0], entity, phase, dt, app, scene);
      } else if (clen > 1) {
        const cdepth = compDepth++;
        const cbuf = SCRATCH_COMPS[cdepth] ?? (SCRATCH_COMPS[cdepth] = []);
        let ci = 0;
        try {
          for (let k = 0; k < clen; k++) cbuf[k] = comps[k];
          for (; ci < clen; ci++) {
            const component = cbuf[ci];
            cbuf[ci] = null;
            runComponentPhase(component, entity, phase, dt, app, scene);
          }
        } finally {
          while (ci < clen) cbuf[ci++] = null;
          compDepth--;
        }
      }
      if (!entity.destroyed && entity.scene === scene && entity.children.length > 0 && scene.active) {
        runPhaseOnRoots(entity.children, phase, dt, app, scene, entity);
      }
    }
  } finally {
    while (i < len) buf[i++] = null;
    walkDepth--;
  }
}

/** Logic Scene. The Renderer and physics are per-project optional services. */
export class Scene {
  /** @param {string} name Unique scene name. */
  constructor(name) {
    if (!name || typeof name !== 'string') throw new TypeError('Scene needs a name');
    this.name = name;
    /** Root entities. @type {Entity[]} */
    this.objects = [];
    this.active = false;
    /** @type {import('./application.js').GameApplication | null} */
    this.app = null;
    /** @type {ScenePhysicsWorld | null} */
    this.physics = null;
    /** @type {TweenManager | null} */
    this._tweens = null;
    this._disposing = false;
    /** @type {Set<() => void>} */
    this._disposeListeners = new Set();
  }
  /** Lazily created per-scene tween manager. @returns {TweenManager} */
  get tweens() {
    return (this._tweens ??= new TweenManager());
  }
  /** Add a root entity. @template {Entity} T @param {T} entity @returns {T} */
  add(entity) {
    if (this._disposing || this.app?.disposed) throw new Error('Scene is disposing or application disposed');
    if (!(entity instanceof Entity) || entity.destroyed || entity._destroying) throw new TypeError('Scene needs an Entity that is not being destroyed');
    entity.detach();
    this.objects.push(entity);
    entity.parent = null;
    entity._bindScene(this);
    return entity;
  }
  /** Depth-first search by name. @param {string} name @returns {Entity | null} */
  find(name) {
    let found = null;
    walk(this.objects, entity => { if (!found && entity.name === name) found = entity; });
    return found;
  }
  /** @param {string} tag @param {SceneTagFindOptions} [options] @returns {Entity[]} */
  findByTag(tag, { exact = false, activeOnly = false } = {}) {
    const matches = [];
    walk(this.objects, entity => {
      if (activeOnly && !entity.activeInHierarchy) return;
      if (entity.hasTag(tag, { exact })) matches.push(entity);
    });
    return matches;
  }
  /** @param {import('./tags.js').TagQuery} query @param {{ activeOnly?: boolean }} [options] @returns {Entity[]} */
  queryTags(query, { activeOnly = false } = {}) {
    const matches = [];
    walk(this.objects, entity => {
      if (activeOnly && !entity.activeInHierarchy) return;
      if (entity.matchesTags(query)) matches.push(entity);
    });
    return matches;
  }
  /** Called when the scene becomes current. @param {import('./application.js').GameApplication} _app @param {unknown} [_data] Value passed to `scenes.start`. @returns {void} */
  enter(_app, _data) {}
  /** Called when the scene stops being current. @param {import('./application.js').GameApplication} _app @returns {void} */
  exit(_app) {}
  /** @param {number} _dt Seconds (1 / tickHz). @param {import('./application.js').GameApplication} _app @returns {void} */
  fixedUpdate(_dt, _app) {}
  /** @param {number} _dt Scaled seconds. @param {import('./application.js').GameApplication} _app @returns {void} */
  update(_dt, _app) {}
  /** @param {number} _dt Scaled seconds. @param {import('./application.js').GameApplication} _app @returns {void} */
  lateUpdate(_dt, _app) {}
  /** @param {GameCommand} _command @param {import('./application.js').GameApplication} _app @returns {void} */
  onCommand(_command, _app) {}
  /** @param {boolean} value @returns {void} */
  _setActive(value) {
    if (this.active === value) return;
    this.active = value;
    // Entity synchronizes its own descendants. Do not recursively synchronize
    // the same child twice for every ancestor level (quadratic in deep trees).
    for (const entity of [...this.objects]) {
      if (!entity.destroyed) entity._syncComponents();
    }
  }
  /** @returns {void} */
  _capturePreviousTransforms() {
    if (!this.active) return;
    captureTransformsOnRoots(this.objects);
  }
  /** @param {'fixedUpdate' | 'update' | 'lateUpdate'} phase @param {number} dt @param {import('./application.js').GameApplication} app @returns {void} */
  _run(phase, dt, app) {
    if (!this.active) return;
    if (this._tweens) {
      const fixedDriven = (app?.project?.tickHz ?? 0) > 0;
      if ((phase === 'fixedUpdate' && fixedDriven) || (phase === 'update' && !fixedDriven)) {
        this._tweens.update(dt);
      }
    }
    if (!this.active || app?.disposed) return;
    this[phase]?.(dt, app);
    runPhaseOnRoots(this.objects, phase, dt, app, this);
  }
  /**
   * Run a scene-owned cleanup after entities and physics are disposed.
   * @param {() => void} listener
   * @returns {() => boolean} Unregister the cleanup.
   */
  onDispose(listener) {
    if (this._disposing || this.app?.disposed) throw new Error('Scene is disposing or application disposed');
    if (typeof listener !== 'function') throw new TypeError('Disposal listener must be a function');
    this._disposeListeners.add(listener);
    return () => this._disposeListeners.delete(listener);
  }
  /** Deactivate and destroy all entities, tweens, physics and scene-owned resources. @returns {void} */
  dispose() {
    if (this._disposing) return;
    this._disposing = true;
    try {
      cleanupAll([
        () => this._setActive(false),
        () => this._tweens?.dispose?.(),
        ...this.objects.map(object => () => object.destroy()),
        () => this.physics?.dispose?.(),
        ...[...this._disposeListeners].reverse(),
      ], 'Scene disposal failed');
    } finally {
      this.objects.length = 0;
      this._tweens = null;
      this.physics = null;
      this.app = null;
      this._disposeListeners.clear();
      this._disposing = false;
    }
  }
}

/** Registry and switcher of {@link Scene}s. */
export class SceneManager {
  /**
   * @param {import('./application.js').GameApplication} app
   * @param {(scene: Scene) => void} [onScene] Called for every added scene.
   */
  constructor(app, onScene) {
    this.app = app;
    this.onScene = onScene;
    /** @type {Map<string, Scene>} */
    this.registry = new Map();
    /** @type {Scene | null} */
    this.current = null;
    this._disposing = false;
    this._switching = false;
    /** @type {Set<() => void>} */
    this._disposeListeners = new Set();
  }
  /** Register a uniquely named scene. @template {Scene} T @param {T} scene @returns {T} */
  add(scene) {
    if (this._disposing || this.app.disposed) throw new Error('Application disposed or disposing');
    if (!(scene instanceof Scene) || this.registry.has(scene.name)) {
      throw new Error('A unique Scene is required');
    }
    this.registry.set(scene.name, scene);
    scene.app = this.app;
    try { this.onScene?.(scene); }
    catch (error) {
      if (this.registry.get(scene.name) === scene) {
        this.registry.delete(scene.name);
        try { scene.dispose(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Scene registration failed'); }
      }
      throw error;
    }
    return scene;
  }
  /** @param {string} name @returns {Scene | null} */
  get(name) { return this.registry.get(name) ?? null; }
  /** Switch to a registered scene. @param {string} name @param {unknown} [data] Forwarded to `Scene#enter`. @returns {boolean} False if already current. */
  start(name, data) {
    if (this._disposing || this.app.disposed) throw new Error('Application disposed or disposing');
    if (this._switching) throw new Error('A prepared scene switch is in progress');
    const scene = this.get(name);
    if (!scene) throw new Error('Unknown Scene: ' + name);
    if (scene === this.current) return false;
    const old = this.current;
    this._switching = true;
    try {
      if (old) {
        old._setActive(false);
        if (this.app.disposed || this.get(name) !== scene) return false;
        old.exit(this.app);
        if (this.app.disposed || this.get(name) !== scene) return false;
      }
      this.current = scene;
      scene._setActive(true);
      if (this.app.disposed) return false;
      scene.enter(this.app, data);
      return this.current === scene;
    } finally { this._switching = false; }
  }
  /**
   * Activate a prepared scene before retiring the previous one. The previous scene remains
   * current through candidate activation. Enter hooks should only modify candidate state.
   * @param {string} name
   * @param {unknown} [data]
   * @param {() => boolean} [canCommit] Checked after lifecycle hooks to honor a cancelled transition.
   * @returns {{changed: boolean, cleanupErrors: unknown[]}}
   */
  activatePrepared(name, data, canCommit) {
    if (this._disposing || this.app.disposed || this._switching) throw new Error('Scene manager is unavailable for a prepared switch');
    const next = this.get(name);
    if (!next) throw new Error('Unknown Scene: ' + name);
    const old = this.current;
    if (old === next) return { changed: false, cleanupErrors: [] };
    const owned = () => !this.app.disposed && this.get(name) === next;
    let attemptedEnter = false;
    this._switching = true;
    try {
      try {
        next._setActive(true);
        if (!owned()) return { changed: false, cleanupErrors: [] };
        if (canCommit && !canCommit()) throw new DOMException('Scene activation cancelled', 'AbortError');
        attemptedEnter = true;
        next.enter(this.app, data);
        if (owned() && canCommit && !canCommit()) throw new DOMException('Scene activation cancelled', 'AbortError');
      } catch (error) {
        if (owned()) {
          try {
            cleanupAll([
              () => next._setActive(false),
              () => { if (attemptedEnter && owned()) next.exit(this.app); },
            ], 'Candidate scene rollback failed');
          } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Prepared scene activation failed'); }
        }
        throw error;
      }
      if (!owned()) return { changed: false, cleanupErrors: [] };
      this.current = next;
      const cleanupErrors = [];
      try { old?._setActive(false); } catch (error) { cleanupErrors.push(error); }
      if (old && owned() && this.registry.get(old.name) === old) {
        try { old.exit(this.app); } catch (error) { cleanupErrors.push(error); }
      }
      return { changed: this.current === next, cleanupErrors };
    } finally { this._switching = false; }
  }
  /** Remove and dispose an owned scene. @param {string} name @returns {boolean} */
  remove(name) {
    if (this._disposing || this.app.disposed) return false;
    if (this._switching) throw new Error('A prepared scene switch is in progress');
    const scene = this.get(name);
    if (!scene) return false;
    const wasCurrent = this.current === scene;
    this.registry.delete(name);
    if (wasCurrent) this.current = null;
    this._switching = true;
    try {
      cleanupAll([
        () => scene._setActive(false),
        () => { if (wasCurrent && !this.app.disposed) scene.exit(this.app); },
        () => scene.dispose(),
      ], 'Scene removal failed');
    } finally { this._switching = false; }
    return true;
  }
  /** @param {() => void} listener @returns {() => boolean} */
  onDispose(listener) {
    if (this._disposing || this.app.disposed) throw new Error('Application disposed or disposing');
    if (typeof listener !== 'function') throw new TypeError('Disposal listener must be a function');
    this._disposeListeners.add(listener);
    return () => this._disposeListeners.delete(listener);
  }
  dispose() {
    if (this._disposing) return;
    this._disposing = true;
    const current = this.current;
    try {
      cleanupAll([
        () => current?._setActive(false),
        () => current?.exit(this.app),
        ...[...this.registry.values()].map(scene => () => scene.dispose()),
        ...[...this._disposeListeners],
      ], 'Scene manager disposal failed');
    } finally {
      this.registry.clear();
      this._disposeListeners.clear();
      this.current = null;
      this._disposing = false;
    }
  }
}

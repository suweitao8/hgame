import { Component } from './component.js';
import { Entity } from './entity.js';
import { TweenManager } from '../time/tween.js';

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

/** @param {readonly Entity[]} roots @param {'fixedUpdate' | 'update' | 'lateUpdate'} phase @param {number} dt @param {import('./application.js').GameApplication} app @param {Scene} scene @returns {void} */
function runPhaseOnRoots(roots, phase, dt, app, scene) {
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
      if (entity.destroyed || !entity.activeInHierarchy || !scene.active) continue;
      const comps = entity.components;
      const clen = comps.length;
      if (clen > 0) {
        const cdepth = compDepth++;
        const cbuf = SCRATCH_COMPS[cdepth] ?? (SCRATCH_COMPS[cdepth] = []);
        let ci = 0;
        try {
          for (let k = 0; k < clen; k++) cbuf[k] = comps[k];
          for (; ci < clen; ci++) {
            const component = cbuf[ci];
            cbuf[ci] = null;
            if (component._destroyed || !component._running) continue;
            if (!component._started) {
              component._started = true;
              component.start();
            }
            if (component._running && scene.active) {
              const hook = component[phase];
              if (typeof hook === 'function' && hook !== PROTO_HOOKS[phase]) {
                hook.call(component, dt, app);
              }
            }
          }
        } finally {
          while (ci < clen) cbuf[ci++] = null;
          compDepth--;
        }
      }
      if (!entity.destroyed && entity.children.length > 0 && scene.active) {
        runPhaseOnRoots(entity.children, phase, dt, app, scene);
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
  }
  /** Lazily created per-scene tween manager. @returns {TweenManager} */
  get tweens() {
    return (this._tweens ??= new TweenManager());
  }
  /** Add a root entity. @template {Entity} T @param {T} entity @returns {T} */
  add(entity) {
    if (!(entity instanceof Entity) || entity.destroyed) throw new TypeError('Scene needs an Entity');
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
    this[phase]?.(dt, app);
    runPhaseOnRoots(this.objects, phase, dt, app, this);
  }
  /** Deactivate and destroy all entities, tweens and physics. @returns {void} */
  dispose() {
    this._setActive(false);
    this._tweens?.dispose?.();
    this._tweens = null;
    for (const object of [...this.objects]) object.destroy();
    this.physics?.dispose?.();
    this.physics = null;
    this.app = null;
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
  }
  /** Register a uniquely named scene. @template {Scene} T @param {T} scene @returns {T} */
  add(scene) {
    if (!(scene instanceof Scene) || this.registry.has(scene.name)) {
      throw new Error('A unique Scene is required');
    }
    this.registry.set(scene.name, scene);
    scene.app = this.app;
    this.onScene?.(scene);
    return scene;
  }
  /** @param {string} name @returns {Scene | null} */
  get(name) { return this.registry.get(name) ?? null; }
  /** Switch to a registered scene. @param {string} name @param {unknown} [data] Forwarded to `Scene#enter`. @returns {boolean} False if already current. */
  start(name, data) {
    const scene = this.get(name);
    if (!scene) throw new Error('Unknown Scene: ' + name);
    if (scene === this.current) return false;
    const old = this.current;
    if (old) {
      old._setActive(false);
      old.exit(this.app);
    }
    this.current = scene;
    scene._setActive(true);
    scene.enter(this.app, data);
    return true;
  }
  dispose() {
    if (this.current) {
      this.current._setActive(false);
      this.current.exit(this.app);
    }
    for (const scene of this.registry.values()) scene.dispose();
    this.registry.clear();
    this.current = null;
  }
}

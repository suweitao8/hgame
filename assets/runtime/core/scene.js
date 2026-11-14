import { Component } from './component.js';
import { Entity } from './entity.js';
import { TweenManager } from '../time/tween.js';

const SCRATCH_WALK = [];
const SCRATCH_COMPS = [];
let walkDepth = 0;
let compDepth = 0;
const PROTO_HOOKS = Component.prototype;

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

function captureTransformsOnRoots(roots) {
  for (let i = 0, n = roots.length; i < n; i++) {
    const entity = roots[i];
    if (!entity.destroyed && entity.active) {
      entity._capturePreviousTransform();
      if (entity.children.length > 0) captureTransformsOnRoots(entity.children);
    }
  }
}

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
  constructor(name) {
    if (!name || typeof name !== 'string') throw new TypeError('Scene needs a name');
    this.name = name;
    this.objects = [];
    this.active = false;
    this.app = null;
    this.physics = null;
    this._tweens = null;
  }
  get tweens() {
    return (this._tweens ??= new TweenManager());
  }
  add(entity) {
    if (!(entity instanceof Entity) || entity.destroyed) throw new TypeError('Scene needs an Entity');
    entity.detach();
    this.objects.push(entity);
    entity.parent = null;
    entity._bindScene(this);
    return entity;
  }
  find(name) {
    let found = null;
    walk(this.objects, entity => { if (!found && entity.name === name) found = entity; });
    return found;
  }
  findByTag(tag, { exact = false, activeOnly = false } = {}) {
    const matches = [];
    walk(this.objects, entity => {
      if (activeOnly && !entity.activeInHierarchy) return;
      if (entity.hasTag(tag, { exact })) matches.push(entity);
    });
    return matches;
  }
  queryTags(query, { activeOnly = false } = {}) {
    const matches = [];
    walk(this.objects, entity => {
      if (activeOnly && !entity.activeInHierarchy) return;
      if (entity.matchesTags(query)) matches.push(entity);
    });
    return matches;
  }
  enter(_app, _data) {}
  exit(_app) {}
  fixedUpdate(_dt, _app) {}
  update(_dt, _app) {}
  lateUpdate(_dt, _app) {}
  onCommand(_command, _app) {}
  _setActive(value) {
    if (this.active === value) return;
    this.active = value;
    // Entity synchronizes its own descendants. Do not recursively synchronize
    // the same child twice for every ancestor level (quadratic in deep trees).
    for (const entity of [...this.objects]) {
      if (!entity.destroyed) entity._syncComponents();
    }
  }
  _capturePreviousTransforms() {
    if (!this.active) return;
    captureTransformsOnRoots(this.objects);
  }
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

export class SceneManager {
  constructor(app, onScene) {
    this.app = app;
    this.onScene = onScene;
    this.registry = new Map();
    this.current = null;
  }
  add(scene) {
    if (!(scene instanceof Scene) || this.registry.has(scene.name)) {
      throw new Error('A unique Scene is required');
    }
    this.registry.set(scene.name, scene);
    scene.app = this.app;
    this.onScene?.(scene);
    return scene;
  }
  get(name) { return this.registry.get(name) ?? null; }
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

import { Entity } from './entity.js';

function walk(roots, action) {
  for (const entity of [...roots]) {
    if (!entity.destroyed) {
      action(entity);
      if (!entity.destroyed) walk(entity.children, action);
    }
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
  _run(phase, dt, app) {
    if (!this.active) return;
    this[phase]?.(dt, app);
    walk(this.objects, entity => {
      if (!this.active || !entity.activeInHierarchy) return;
      for (const component of [...entity.components]) {
        if (component._destroyed || !component._running) continue;
        if (!component._started) {
          component._started = true;
          component.start();
        }
        if (component._running && this.active) component[phase]?.(dt, app);
      }
    });
  }
  dispose() {
    this._setActive(false);
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

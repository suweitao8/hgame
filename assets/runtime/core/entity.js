import { Component } from './component.js';

let nextEntityId = 1;

// View-layer TRS using Three.js-compatible XYZ Euler order, column-major 4x4.
// This uses floating point: NEVER feed it back into a deterministic sim.
function localMatrix(entity) {
  const a = Math.cos(entity.rotationX), b = Math.sin(entity.rotationX);
  const c = Math.cos(entity.rotationY), d = Math.sin(entity.rotationY);
  const e = Math.cos(entity.rotationZ), f = Math.sin(entity.rotationZ);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return new Float64Array([
    c * e * entity.scaleX, (af + be * d) * entity.scaleX, (bf - ae * d) * entity.scaleX, 0,
    -c * f * entity.scaleY, (ae - bf * d) * entity.scaleY, (be + af * d) * entity.scaleY, 0,
    d * entity.scaleZ, -b * c * entity.scaleZ, a * c * entity.scaleZ, 0,
    entity.x, entity.y, entity.z, 1,
  ]);
}

function multiplyMatrix(a, b) {
  const result = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      result[col * 4 + row] = sum;
    }
  }
  return result;
}

/** Independent of Canvas, Three.js, DOM and any physics implementation. */
export class Entity {
  constructor({ name = '', x = 0, y = 0, z = 0, active = true,
    width = 0, height = 0, depth = 0, anchorX = 0.5, anchorY = 0.5,
    rotationX = 0, rotationY = 0, rotationZ = 0,
    scaleX = 1, scaleY = 1, scaleZ = 1 } = {}) {
    this.id = nextEntityId++;
    this.name = name;
    this.x = x; this.y = y; this.z = z;
    this.width = width; this.height = height; this.depth = depth;
    this.anchorX = anchorX; this.anchorY = anchorY;
    this.rotationX = rotationX; this.rotationY = rotationY; this.rotationZ = rotationZ;
    this.scaleX = scaleX; this.scaleY = scaleY; this.scaleZ = scaleZ;
    this._active = Boolean(active);
    this.children = [];
    this.components = [];
    this.parent = null;
    this.scene = null;
    this.destroyed = false;
  }
  get active() { return this._active; }
  set active(value) {
    this._active = Boolean(value);
    this._syncComponents();
  }
  get activeInHierarchy() {
    if (!this.active || this.destroyed) return false;
    for (let current = this.parent; current; current = current.parent) {
      if (!current.active || current.destroyed) return false;
    }
    return Boolean(this.scene?.active);
  }
  add(child) {
    if (!(child instanceof Entity) || child.destroyed || this.destroyed) {
      throw new TypeError('Cannot attach a destroyed or non-Entity child');
    }
    for (let node = this; node; node = node.parent) {
      if (node === child) throw new Error('Cannot create an ancestor transform cycle');
    }
    if (child.parent === this) return child;
    child.detach();
    this.children.push(child);
    child.parent = this;
    child._bindScene(this.scene);
    return child;
  }
  addComponent(component) {
    if (!(component instanceof Component) || component.entity || this.destroyed) {
      throw new TypeError('Cannot attach a non-Component, already owned, or destroyed component');
    }
    this.components.push(component);
    component.entity = this;
    this._syncComponents();
    return component;
  }
  getComponent(Type) { return this.components.find(component => component instanceof Type) ?? null; }
  getComponents(Type) { return this.components.filter(component => component instanceof Type); }
  _bindScene(scene) {
    if (this.scene === scene) { this._syncComponents(); return; }
    this._deactivate();
    this.scene = scene;
    this._syncComponents();
    for (const child of [...this.children]) child._bindScene(scene);
  }
  _deactivate() {
    for (const component of this.components) {
      if (component._running) {
        component._running = false;
        component.onDisable();
      }
    }
  }
  _syncComponents() {
    if (this.destroyed) return;
    const active = this.activeInHierarchy;
    for (const component of [...this.components]) {
      if (component._destroyed) continue;
      const shouldRun = active && component.enabled;
      if (shouldRun && !component._awake) {
        component._awake = true;
        component.awake();
      }
      // Awake may disable or destroy itself. Re-read the current state rather
      // than using the stale shouldRun value from before user callbacks.
      if (component._destroyed) continue;
      const stillActive = this.activeInHierarchy && component.enabled;
      if (stillActive && !component._running) {
        component._running = true;
        component.onEnable();
      } else if (!stillActive && component._running) {
        component._running = false;
        component.onDisable();
      }
    }
    for (const child of [...this.children]) child._syncComponents();
  }
  worldMatrix() {
    let result = localMatrix(this);
    for (let node = this.parent; node; node = node.parent) {
      result = multiplyMatrix(localMatrix(node), result);
    }
    return result;
  }
  worldPosition() {
    const world = this.worldMatrix();
    return { x: world[12], y: world[13], z: world[14] };
  }
  detach() {
    this.scene?.physics?.remove?.(this);
    if (this.parent) {
      const at = this.parent.children.indexOf(this);
      if (at !== -1) this.parent.children.splice(at, 1);
      this.parent = null;
    } else if (this.scene) {
      const at = this.scene.objects.indexOf(this);
      if (at !== -1) this.scene.objects.splice(at, 1);
    }
    if (this.scene) this._bindScene(null);
    return this;
  }
  destroy() {
    if (this.destroyed) return false;
    for (const child of [...this.children]) child.destroy();
    this.scene?.physics?.remove?.(this);
    this._deactivate();
    for (const component of [...this.components]) {
      if (!component._destroyed) {
        component._destroyed = true;
        component.onDestroy();
        component.entity = null;
      }
    }
    this.components.length = 0;
    this.detach();
    this.destroyed = true;
    return true;
  }
}

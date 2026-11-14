import { Component } from './component.js';
import { createTagContainer, matchGameplayTags } from './tags.js';

let nextEntityId = 1;
const TAU = Math.PI * 2;
const SCRATCH_LOCAL = new Float64Array(16);
const SCRATCH_ACC = new Float64Array(16);
const SCRATCH_PROD = new Float64Array(16);
const SCRATCH_POS_MAT = new Float64Array(16);

function lerpAngle(a, b, t) {
  if (a === b) return b;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}

// View-layer TRS using Three.js-compatible XYZ Euler order, column-major 4x4.
// This uses floating point: NEVER feed it back into a deterministic sim.
function writeLocalMatrix(out, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (rx === 0 && ry === 0) {
    if (rz === 0) {
      out[0] = sx; out[1] = 0;  out[2] = 0;  out[3] = 0;
      out[4] = 0;  out[5] = sy; out[6] = 0;  out[7] = 0;
      out[8] = 0;  out[9] = 0;  out[10] = sz; out[11] = 0;
      out[12] = x; out[13] = y; out[14] = z;  out[15] = 1;
      return out;
    }
    const e = Math.cos(rz), f = Math.sin(rz);
    out[0] = e * sx;  out[1] = f * sx; out[2] = 0;  out[3] = 0;
    out[4] = -f * sy; out[5] = e * sy; out[6] = 0;  out[7] = 0;
    out[8] = 0;       out[9] = 0;      out[10] = sz; out[11] = 0;
    out[12] = x;      out[13] = y;     out[14] = z;  out[15] = 1;
    return out;
  }
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  out[0] = c * e * sx;
  out[1] = (af + be * d) * sx;
  out[2] = (bf - ae * d) * sx;
  out[3] = 0;
  out[4] = -c * f * sy;
  out[5] = (ae - bf * d) * sy;
  out[6] = (be + af * d) * sy;
  out[7] = 0;
  out[8] = d * sz;
  out[9] = -b * c * sz;
  out[10] = a * c * sz;
  out[11] = 0;
  out[12] = x;
  out[13] = y;
  out[14] = z;
  out[15] = 1;
  return out;
}

function multiplyMatrixInto(out, a, b) {
  for (let col = 0; col < 4; col++) {
    const colOffset = col * 4;
    const b0 = b[colOffset], b1 = b[colOffset + 1], b2 = b[colOffset + 2], b3 = b[colOffset + 3];
    out[colOffset]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[colOffset + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[colOffset + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[colOffset + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function composeWorldMatrix(entity, out, useInterpolation, alpha) {
  const writeNode = (node, target) => {
    if (useInterpolation && alpha < 1) {
      const t = alpha <= 0 ? 0 : alpha;
      return writeLocalMatrix(
        target,
        node._prevX + (node.x - node._prevX) * t,
        node._prevY + (node.y - node._prevY) * t,
        node._prevZ + (node.z - node._prevZ) * t,
        lerpAngle(node._prevRotationX, node.rotationX, t),
        lerpAngle(node._prevRotationY, node.rotationY, t),
        lerpAngle(node._prevRotationZ, node.rotationZ, t),
        node.scaleX, node.scaleY, node.scaleZ,
      );
    }
    return writeLocalMatrix(
      target,
      node.x, node.y, node.z,
      node.rotationX, node.rotationY, node.rotationZ,
      node.scaleX, node.scaleY, node.scaleZ,
    );
  };
  if (!entity.parent) return writeNode(entity, out);
  let current = writeNode(entity, SCRATCH_ACC);
  let scratch = SCRATCH_PROD;
  for (let node = entity.parent; node; node = node.parent) {
    writeNode(node, SCRATCH_LOCAL);
    if (!node.parent) return multiplyMatrixInto(out, SCRATCH_LOCAL, current);
    multiplyMatrixInto(scratch, SCRATCH_LOCAL, current);
    const swap = current;
    current = scratch;
    scratch = swap;
  }
  return out;
}

/** Independent of Canvas, Three.js, DOM and any physics implementation. */
export class Entity {
  constructor({ name = '', x = 0, y = 0, z = 0, active = true,
    width = 0, height = 0, depth = 0, anchorX = 0.5, anchorY = 0.5,
    rotationX = 0, rotationY = 0, rotationZ = 0,
    scaleX = 1, scaleY = 1, scaleZ = 1, interpolate = false, tags = null } = {}) {
    this.id = nextEntityId++;
    this.name = name;
    this.x = x; this.y = y; this.z = z;
    this.width = width; this.height = height; this.depth = depth;
    this.anchorX = anchorX; this.anchorY = anchorY;
    this.rotationX = rotationX; this.rotationY = rotationY; this.rotationZ = rotationZ;
    this.scaleX = scaleX; this.scaleY = scaleY; this.scaleZ = scaleZ;
    this.interpolate = Boolean(interpolate);
    this._prevX = x; this._prevY = y; this._prevZ = z;
    this._prevRotationX = rotationX; this._prevRotationY = rotationY; this._prevRotationZ = rotationZ;
    this._active = Boolean(active);
    this.children = [];
    this.components = [];
    this.parent = null;
    this.scene = null;
    this.destroyed = false;
    this._tags = tags != null ? createTagContainer(tags) : null;
  }
  get tags() {
    return (this._tags ??= createTagContainer());
  }
  addTag(tagOrTags, count = 1) {
    this.tags.add(tagOrTags, count);
    return this;
  }
  removeTag(tagOrTags, count = 1) {
    return this._tags ? this._tags.remove(tagOrTags, count) : false;
  }
  hasTag(tag, { exact = false } = {}) {
    if (!this._tags) return false;
    return exact ? this._tags.hasExact(tag) : this._tags.has(tag);
  }
  matchesTags(query) {
    return matchGameplayTags(this._tags, query);
  }
  snapTransform() {
    this._prevX = this.x;
    this._prevY = this.y;
    this._prevZ = this.z;
    this._prevRotationX = this.rotationX;
    this._prevRotationY = this.rotationY;
    this._prevRotationZ = this.rotationZ;
    return this;
  }
  _capturePreviousTransform() {
    this._prevX = this.x;
    this._prevY = this.y;
    this._prevZ = this.z;
    this._prevRotationX = this.rotationX;
    this._prevRotationY = this.rotationY;
    this._prevRotationZ = this.rotationZ;
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
  worldMatrixInto(out = new Float64Array(16)) {
    return composeWorldMatrix(this, out, false, 1);
  }
  worldMatrix() {
    return this.worldMatrixInto(new Float64Array(16));
  }
  worldPosition(out = null) {
    const world = this.worldMatrixInto(SCRATCH_POS_MAT);
    if (out) {
      out.x = world[12];
      out.y = world[13];
      out.z = world[14];
      return out;
    }
    return { x: world[12], y: world[13], z: world[14] };
  }
  interpolatedWorldMatrixInto(alpha = 1, out = new Float64Array(16)) {
    return composeWorldMatrix(this, out, true, alpha);
  }
  interpolatedWorldPosition(alpha = 1, out = null) {
    const world = this.interpolatedWorldMatrixInto(alpha, SCRATCH_POS_MAT);
    if (out) {
      out.x = world[12];
      out.y = world[13];
      out.z = world[14];
      return out;
    }
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
    this._tags?.clear();
    this._tags = null;
    this.detach();
    this.destroyed = true;
    return true;
  }
}

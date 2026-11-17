import { Component } from './component.js';
import { cleanupAll } from '../internal/cleanup.js';
import { multiplyMatrixInto, writeEntityLocalMatrix } from '../internal/entity-transform.js';
import { createTagContainer, matchGameplayTags } from './tags.js';

let nextEntityId = 1;
const SCRATCH_LOCAL = new Float64Array(16);
const SCRATCH_ACC = new Float64Array(16);
const SCRATCH_PROD = new Float64Array(16);
const SCRATCH_POS_MAT = new Float64Array(16);

/** @param {Entity} entity @param {Float64Array} out @param {boolean} useInterpolation @param {number} alpha @returns {Float64Array} */
function composeWorldMatrix(entity, out, useInterpolation, alpha) {
  const sample = useInterpolation ? alpha : 1;
  if (!entity.parent) return writeEntityLocalMatrix(entity, out, sample);
  let current = writeEntityLocalMatrix(entity, SCRATCH_ACC, sample);
  let scratch = SCRATCH_PROD;
  for (let node = entity.parent; node; node = node.parent) {
    writeEntityLocalMatrix(node, SCRATCH_LOCAL, sample);
    if (!node.parent) return multiplyMatrixInto(out, SCRATCH_LOCAL, current);
    multiplyMatrixInto(scratch, SCRATCH_LOCAL, current);
    const swap = current;
    current = scratch;
    scratch = swap;
  }
  return out;
}

/**
 * @typedef {object} EntityOptions
 * @property {string} [name=''] Lookup name used by {@link Scene#find}.
 * @property {number} [x=0] Local position, world units.
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {boolean} [active=true]
 * @property {number} [width=0] Size in world units (pixels for 2D).
 * @property {number} [height=0]
 * @property {number} [depth=0]
 * @property {number} [anchorX=0.5] Normalized pivot (0..1).
 * @property {number} [anchorY=0.5] Normalized pivot (0..1).
 * @property {number} [rotationX=0] Euler rotation, radians (XYZ order).
 * @property {number} [rotationY=0] Radians.
 * @property {number} [rotationZ=0] Radians.
 * @property {number} [scaleX=1]
 * @property {number} [scaleY=1]
 * @property {number} [scaleZ=1]
 * @property {boolean} [interpolate=false] Render-interpolate between fixed ticks.
 * @property {import('./tags.js').TagInput | Record<string, number> | null} [tags=null] Initial gameplay tags.
 */

/** @typedef {{ x: number, y: number, z: number }} Vec3Like Mutable 3D point. */
/** Independent of Canvas, Three.js, DOM and any physics implementation. */
export class Entity {
  /** @param {EntityOptions} [options] */
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
    /** @type {Entity[]} */
    this.children = [];
    /** @type {Component[]} */
    this.components = [];
    /** @type {Entity | null} */
    this.parent = null;
    /** @type {import('./scene.js').Scene | null} */
    this.scene = null;
    this.destroyed = false;
    this._destroying = false;
    /** @type {import('./tags.js').TagContainer | null} */
    this._tags = tags != null ? createTagContainer(tags) : null;
  }
  /** Lazily created tag container. @returns {import('./tags.js').TagContainer} */
  get tags() {
    return (this._tags ??= createTagContainer());
  }
  /**
   * @param {import('./tags.js').TagInput} tagOrTags
   * @param {number} [count=1] Stack count to add.
   * @returns {this}
   */
  addTag(tagOrTags, count = 1) {
    this.tags.add(tagOrTags, count);
    return this;
  }
  /**
   * @param {import('./tags.js').TagInput} tagOrTags
   * @param {number | boolean | { all?: boolean }} [count=1] Stacks to remove (`Infinity` / `true` removes all).
   * @returns {boolean} True when something was removed.
   */
  removeTag(tagOrTags, count = 1) {
    return this._tags ? this._tags.remove(tagOrTags, count) : false;
  }
  /**
   * @param {string} tag
   * @param {{ exact?: boolean }} [options] `exact` disables hierarchical matching.
   * @returns {boolean}
   */
  hasTag(tag, { exact = false } = {}) {
    if (!this._tags) return false;
    return exact ? this._tags.hasExact(tag) : this._tags.has(tag);
  }
  /** @param {import('./tags.js').TagQuery} query @returns {boolean} */
  matchesTags(query) {
    return matchGameplayTags(this._tags, query);
  }
  /** Reset interpolation history to the current transform (use after teleporting). @returns {this} */
  snapTransform() {
    this._prevX = this.x;
    this._prevY = this.y;
    this._prevZ = this.z;
    this._prevRotationX = this.rotationX;
    this._prevRotationY = this.rotationY;
    this._prevRotationZ = this.rotationZ;
    return this;
  }
  /** @returns {void} */
  _capturePreviousTransform() {
    this._prevX = this.x;
    this._prevY = this.y;
    this._prevZ = this.z;
    this._prevRotationX = this.rotationX;
    this._prevRotationY = this.rotationY;
    this._prevRotationZ = this.rotationZ;
  }
  /** Local active flag. @type {boolean} */
  get active() { return this._active; }
  /** @param {boolean} value */
  set active(value) {
    this._active = Boolean(value);
    this._syncComponents();
  }
  /** True when this entity, every ancestor and its Scene are active. @type {boolean} */
  get activeInHierarchy() {
    if (!this.active || this.destroyed || this._destroying) return false;
    for (let current = this.parent; current; current = current.parent) {
      if (!current.active || current.destroyed || current._destroying) return false;
    }
    return Boolean(this.scene?.active);
  }
  /** Attach a child entity (re-parenting if needed). @param {Entity} child @returns {Entity} */
  add(child) {
    if (!(child instanceof Entity) || child.destroyed || child._destroying || this.destroyed || this._destroying) {
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
  /**
   * Attach a component instance.
   * @template {Component} T
   * @param {T} component
   * @returns {T}
   */
  addComponent(component) {
    if (!(component instanceof Component) || component.entity || this.destroyed || this._destroying) {
      throw new TypeError('Cannot attach a non-Component, already owned, or destroyed component');
    }
    this.components.push(component);
    component.entity = this;
    this._syncComponents();
    return component;
  }
  /**
   * @template {Component} T
   * @param {abstract new (...args: never[]) => T} Type
   * @returns {T | null}
   */
  getComponent(Type) { return this.components.find(component => component instanceof Type) ?? null; }
  /**
   * @template {Component} T
   * @param {abstract new (...args: never[]) => T} Type
   * @returns {T[]}
   */
  getComponents(Type) { return this.components.filter(component => component instanceof Type); }
  /** @param {import('./scene.js').Scene | null} scene @returns {void} */
  _bindScene(scene) {
    if (this.scene === scene) { this._syncComponents(); return; }
    this._deactivate();
    this.scene = scene;
    this._syncComponents();
    for (const child of [...this.children]) child._bindScene(scene);
  }
  /** @returns {void} */
  _deactivate() {
    cleanupAll(this.components.map(component => () => {
      if (component._running) {
        component._running = false;
        component.onDisable();
      }
    }), 'Component deactivation failed');
  }
  /** @returns {void} */
  _syncComponents() {
    if (this.destroyed || this._destroying) return;
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
  /**
   * Column-major 4x4 world matrix (XYZ Euler TRS). View-layer only; never feed back into deterministic sims.
   * @param {Float64Array} [out] 16-element destination (allocated when omitted).
   * @returns {Float64Array} `out`
   */
  worldMatrixInto(out = new Float64Array(16)) {
    return composeWorldMatrix(this, out, false, 1);
  }
  /** Newly allocated world matrix. @returns {Float64Array} */
  worldMatrix() {
    return this.worldMatrixInto(new Float64Array(16));
  }
  /**
   * @template {Vec3Like} [T=Vec3Like]
   * @param {T | null} [out] Destination to fill (allocation-free).
   * @returns {T | Vec3Like}
   */
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
  /**
   * World matrix blended between the previous and current fixed tick.
   * @param {number} [alpha=1] 0..1 blend factor (`app.renderAlpha`).
   * @param {Float64Array} [out]
   * @returns {Float64Array}
   */
  interpolatedWorldMatrixInto(alpha = 1, out = new Float64Array(16)) {
    return composeWorldMatrix(this, out, true, alpha);
  }
  /**
   * @template {Vec3Like} [T=Vec3Like]
   * @param {number} [alpha=1] 0..1 blend factor.
   * @param {T | null} [out]
   * @returns {T | Vec3Like}
   */
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
  /** Remove from the parent / Scene without destroying. @returns {this} */
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
  /** Destroy the entity, its children and components. @returns {boolean} False if already destroyed. */
  destroy() {
    if (this.destroyed || this._destroying) return false;
    this._destroying = true;
    try {
      cleanupAll([
        ...this.children.map(child => () => child.destroy()),
        () => this.scene?.physics?.remove?.(this),
        () => this._deactivate(),
        ...this.components.map(component => () => {
          if (!component._destroyed) {
            component._destroyed = true;
            try { component.onDestroy(); } finally { component.entity = null; }
          }
        }),
        () => this._tags?.clear(),
      ], 'Entity destruction failed');
    } finally {
      const siblings = this.parent?.children ?? this.scene?.objects;
      const index = siblings?.indexOf(this) ?? -1;
      if (index >= 0) siblings.splice(index, 1);
      this.parent = null;
      this.scene = null;
      this.children.length = 0;
      this.components.length = 0;
      this._tags = null;
      this.destroyed = true;
      this._destroying = false;
    }
    return true;
  }
}

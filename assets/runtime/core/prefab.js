import { Component } from './component.js';
import { Entity } from './entity.js';
import { cleanupAll } from '../internal/cleanup.js';

/**
 * @typedef {Partial<Record<'x' | 'y' | 'z' | 'width' | 'height' | 'depth' | 'anchorX' | 'anchorY' | 'rotationX' | 'rotationY' | 'rotationZ' | 'scaleX' | 'scaleY' | 'scaleZ', number>>} PrefabTransform
 *   Finite-number Entity transform fields (world units / radians).
 */

/**
 * @typedef {object} PrefabComponentDescriptor
 * @property {string} type Name registered with {@link PrefabRegistry#registerComponent}.
 * @property {Record<string, unknown>} [properties] Cloned (structuredClone) and passed to the factory.
 */

/**
 * @typedef {object} PrefabDescriptor Data-only prefab node.
 * @property {string} [name]
 * @property {boolean} [active=true]
 * @property {PrefabTransform} [transform]
 * @property {PrefabComponentDescriptor[]} [components]
 * @property {PrefabDescriptor[]} [children] Nesting limited to 32 levels.
 */

/**
 * @typedef {object} PrefabOverrides Per-instance overrides.
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {string} [name]
 * @property {boolean} [active]
 */

/** @typedef {(properties: Record<string, unknown>) => import('./component.js').Component} PrefabComponentFactory */

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

/** @param {unknown} value @returns {boolean} */
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
/** @param {PrefabDescriptor} node @param {number} [depth] @returns {void} */
function validate(node, depth = 0) {
  if (depth > 32 || !plain(node)) throw new TypeError('Invalid prefab: expected a plain object with limited nesting');
  for (const key of Object.keys(node)) {
    if (!['name', 'active', 'transform', 'components', 'children'].includes(key)) throw new Error('Unknown prefab property: ' + key);
  }
  if (node.transform !== undefined) {
    if (!plain(node.transform)) throw new TypeError('Invalid prefab transform properties');
    for (const [key, value] of Object.entries(node.transform)) {
      if (!['x', 'y', 'z', 'width', 'height', 'depth', 'anchorX', 'anchorY',
        'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'].includes(key) ||
          !Number.isFinite(value)) throw new Error('Invalid prefab transform property: ' + key);
    }
  }
  if (node.components !== undefined) {
    if (!Array.isArray(node.components)) throw new TypeError('Invalid prefab components');
    for (const component of node.components) {
      if (!plain(component) || typeof component.type !== 'string' ||
          !plain(component.properties ?? {})) throw new Error('Invalid prefab component properties');
    }
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw new TypeError('Invalid prefab children');
    for (const child of node.children) validate(child, depth + 1);
  }
}

/** Data-only Prefabs: no eval, class names or executable code in JSON. */
export class PrefabRegistry {
  constructor() {
    /** @type {Map<string, PrefabComponentFactory>} */
    this.components = new Map();
    /** @type {Map<string, PrefabDescriptor>} */
    this.prefabs = new Map();
  }
  /**
   * @param {string} type Unique component type name.
   * @param {PrefabComponentFactory} factory
   * @returns {this}
   */
  registerComponent(type, factory) {
    if (!type || typeof factory !== 'function' || this.components.has(type)) throw new TypeError('Unique component factory required');
    this.components.set(type, factory);
    return this;
  }
  /**
   * Validate and store a clone of a descriptor.
   * @param {string} name Unique prefab name.
   * @param {PrefabDescriptor} descriptor
   * @returns {this}
   */
  register(name, descriptor) {
    if (typeof name !== 'string' || !name || this.prefabs.has(name)) throw new Error('Unique prefab name required');
    validate(descriptor);
    const clone = cloneData(descriptor);
    this.prefabs.set(name, clone);
    return this;
  }
  /**
   * Build a fresh Entity tree from a registered prefab.
   * @param {string} name
   * @param {PrefabOverrides} [overrides]
   * @returns {import('./entity.js').Entity}
   */
  instantiate(name, overrides = {}) {
    const descriptor = this.prefabs.get(name);
    if (!descriptor) throw new Error('Unknown prefab: ' + name);
    if (!plain(overrides)) throw new TypeError('Prefab overrides must be a plain object');
    for (const key of Object.keys(overrides)) {
      if (!['x', 'y', 'z', 'name', 'active'].includes(key)) throw new Error('Invalid prefab override: ' + key);
    }
    /** @type {Entity[]} */
    const created = [];
    /** @param {PrefabDescriptor} node @returns {import('./entity.js').Entity} */
    const build = node => {
      const entity = new Entity({ name: node.name ?? '', active: node.active ?? true,
        ...node.transform });
      created.push(entity);
      for (const item of node.components ?? []) {
        const factory = this.components.get(item.type);
        if (!factory) throw new Error('Unregistered prefab component: ' + item.type);
        const component = factory(cloneData(item.properties ?? {}));
        if (!(component instanceof Component)) throw new TypeError('Prefab factory must return a Component');
        entity.addComponent(component);
      }
      for (const child of node.children ?? []) entity.add(build(child));
      return entity;
    };
    try { return Object.assign(build(descriptor), overrides); }
    catch (error) {
      try { cleanupAll(created.reverse().map(entity => () => entity.destroy()), 'Prefab cleanup failed'); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Prefab construction failed'); }
      throw error;
    }
  }
}

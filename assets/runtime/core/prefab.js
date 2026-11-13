import { Component } from './component.js';
import { Entity } from './entity.js';

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
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
    this.components = new Map();
    this.prefabs = new Map();
  }
  registerComponent(type, factory) {
    if (!type || typeof factory !== 'function' || this.components.has(type)) throw new TypeError('Unique component factory required');
    this.components.set(type, factory);
    return this;
  }
  register(name, descriptor) {
    if (typeof name !== 'string' || !name || this.prefabs.has(name)) throw new Error('Unique prefab name required');
    validate(descriptor);
    const clone = structuredClone(descriptor);
    this.prefabs.set(name, clone);
    return this;
  }
  instantiate(name, overrides = {}) {
    const descriptor = this.prefabs.get(name);
    if (!descriptor) throw new Error('Unknown prefab: ' + name);
    if (!plain(overrides)) throw new TypeError('Prefab overrides must be a plain object');
    for (const key of Object.keys(overrides)) {
      if (!['x', 'y', 'z', 'name', 'active'].includes(key)) throw new Error('Invalid prefab override: ' + key);
    }
    const build = node => {
      const entity = new Entity({ name: node.name ?? '', active: node.active ?? true,
        ...node.transform });
      for (const item of node.components ?? []) {
        const factory = this.components.get(item.type);
        if (!factory) throw new Error('Unregistered prefab component: ' + item.type);
        const component = factory(structuredClone(item.properties ?? {}));
        if (!(component instanceof Component)) throw new TypeError('Prefab factory must return a Component');
        entity.addComponent(component);
      }
      for (const child of node.children ?? []) entity.add(build(child));
      return entity;
    };
    return Object.assign(build(descriptor), overrides);
  }
}

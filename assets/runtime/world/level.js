import { Entity } from '../core/entity.js';
import { Component } from '../core/component.js';
import { normalizeGameplayTag } from '../core/tags.js';
import { cleanupAll } from '../internal/cleanup.js';
import { finite, identifier, positiveInteger } from '../internal/gameplay.js';
import { createTriggerVolumes } from './trigger-volumes.js';

/** @typedef {import('../core/prefab.js').PrefabTransform} PrefabTransform */
/** @typedef {import('./trigger-volumes.js').LevelPoint} LevelPoint */
/** @typedef {{id: string, prefab?: string, parent?: string, active?: boolean, transform?: PrefabTransform, tags?: readonly string[]}} LevelPlacement */
/** @typedef {{position: LevelPoint, rotation?: readonly [number, number, number]}} SpawnPointDefinition */
/** @typedef {{x: number, y: number, z: number, rotationX?: number, rotationY?: number, rotationZ?: number}} SpawnTransform */
/** @typedef {{schemaVersion: 1, id: string, dimensions: 2 | 3, entities?: readonly LevelPlacement[], spawns?: Record<string, SpawnPointDefinition>, triggers?: Record<string, import('./trigger-volumes.js').TriggerVolume>}} LevelDefinition */
/** @typedef {{schemaVersion: 1, levelId: string, usedTriggers: string[]}} LevelSnapshot */
/** @typedef {{name?: string, active?: boolean, tags?: readonly string[]}} LevelSpawnOptions */

const TRANSFORM_KEYS = new Set(['x', 'y', 'z', 'width', 'height', 'depth', 'anchorX', 'anchorY',
  'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ']);

/** @param {PrefabTransform | undefined} source @returns {PrefabTransform} */
function transform(source) {
  const values = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!TRANSFORM_KEYS.has(key)) throw new Error('Unknown level transform field: ' + key);
    values[key] = finite(value, key);
  }
  return values;
}

/** @param {readonly LevelPlacement[]} source @param {import('../core/prefab.js').PrefabRegistry} registry */
function compilePlacements(source, registry) {
  const byId = new Map();
  for (const item of source) {
    const id = identifier(item.id, 'entity id');
    if (byId.has(id)) throw new Error('Duplicate level entity: ' + id);
    const prefab = item.prefab === undefined ? null : identifier(item.prefab, 'prefab');
    if (prefab !== null && !registry.prefabs.has(prefab)) throw new Error('Unknown level prefab: ' + prefab);
    byId.set(id, { id, prefab, parent: item.parent === undefined ? null : identifier(item.parent, 'parent'),
      active: item.active, transform: transform(item.transform), tags: (item.tags ?? []).map(normalizeGameplayTag) });
  }
  const depthById = new Map();
  const visiting = new Set();
  const ordered = [];
  /** @param {string} id @returns {number} */
  function visit(id) {
    const known = depthById.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new Error('Cyclic level hierarchy at ' + id);
    if (visiting.size >= 64) throw new Error('Level hierarchy exceeds 64 entities deep');
    const item = byId.get(id);
    if (!item) throw new Error('Unknown level parent: ' + id);
    visiting.add(id);
    const depth = item.parent === null ? 1 : visit(item.parent) + 1;
    if (depth > 64) throw new Error('Level hierarchy exceeds 64 entities deep');
    visiting.delete(id);
    depthById.set(id, depth);
    ordered.push(item);
    return depth;
  }
  for (const id of byId.keys()) visit(id);
  return ordered;
}

/** @param {SpawnPointDefinition} point @param {2 | 3} dimensions @returns {SpawnTransform} */
function spawnTransform(point, dimensions) {
  const p = point.position;
  if (!Array.isArray(p) || p.length !== dimensions) throw new Error('Spawn point needs ' + dimensions + ' coordinates');
  const basis = { x: finite(p[0], 'spawn x'), y: finite(p[1], 'spawn y'), z: dimensions === 3 ? finite(p[2], 'spawn z') : 0 };
  if (point.rotation === undefined) return basis;
  if (!Array.isArray(point.rotation) || point.rotation.length !== 3) throw new Error('Spawn rotation needs XYZ radians');
  return { ...basis, rotationX: finite(point.rotation[0], 'rotation x'), rotationY: finite(point.rotation[1], 'rotation y'), rotationZ: finite(point.rotation[2], 'rotation z') };
}

/** @param {unknown} error @param {Iterable<() => unknown>} actions @returns {never} */
function rollback(error, actions) {
  try { cleanupAll(actions, 'Level cleanup failed'); }
  catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Level creation failed'); }
  throw error;
}

/**
 * Assemble a scoped level from registered prefab trees and named spawn/trigger data.
 * Construct the hierarchy off-scene, then attach one owner root. Dispose it to unload the level.
 * @param {import('../core/scene.js').Scene} scene
 * @param {import('../core/prefab.js').PrefabRegistry} registry
 * @param {LevelDefinition} data
 * @param {{onTrigger?: (event: import('./trigger-volumes.js').TriggerEvent) => void}} [options]
 */
export function mountLevel(scene, registry, data, { onTrigger } = {}) {
  if (data.schemaVersion !== 1) throw new Error('Unsupported level schema version');
  const id = identifier(data.id, 'level id');
  const dimensions = data.dimensions;
  if (dimensions !== 2 && dimensions !== 3) throw new RangeError('Level dimensions must be 2 or 3');
  const ordered = compilePlacements(data.entities ?? [], registry);
  const spawns = new Map(Object.entries(data.spawns ?? {}).map(([key, point]) => [identifier(key, 'spawn id'), spawnTransform(point, dimensions)]));
  const triggers = createTriggerVolumes(data.triggers ?? {}, { dimensions, onEvent: onTrigger });
  const root = new Entity({ name: 'level:' + id });
  /** @type {Map<string, Entity>} */
  const instances = new Map();
  let closed = false;
  root.addComponent(new class extends Component {
    onDestroy() { closed = true; triggers.dispose(); instances.clear(); }
  }());

  /** @type {Entity[]} */
  const staged = [];
  try {
    for (const placement of ordered) {
      const entity = placement.prefab === null ? new Entity() : registry.instantiate(placement.prefab);
      staged.push(entity);
      entity.name = placement.id;
      Object.assign(entity, placement.transform);
      if (placement.active !== undefined) entity.active = placement.active;
      if (placement.tags.length) entity.addTag(placement.tags);
      entity.snapTransform();
      const parent = placement.parent === null ? root : instances.get(placement.parent);
      parent.add(entity);
      instances.set(placement.id, entity);
    }
    scene.add(root);
    if (closed || root.scene !== scene) throw new Error('Level root was detached during activation: ' + id);
  } catch (error) {
    rollback(error, [() => root.destroy(), ...staged.reverse().map(entity => () => entity.destroy())]);
  }

  function live() {
    if (closed || root.scene !== scene) throw new Error('Level is not mounted: ' + id);
  }
  /** @param {string} key @returns {SpawnTransform | null} */
  function getSpawnPoint(key) { const point = spawns.get(key); return point ? { ...point } : null; }

  /** @param {string} prefab @param {string} point @param {number} count @param {LevelSpawnOptions} [options] @returns {Entity[]} */
  function spawnBatch(prefab, point, count, options = {}) {
    live();
    positiveInteger(count, 'spawn count');
    if (count > 4096) throw new RangeError('Level prefab batches are limited to 4096 entities');
    const placement = getSpawnPoint(point);
    if (!placement) throw new Error('Unknown spawn point: ' + point);
    const tags = (options.tags ?? []).map(normalizeGameplayTag);
    const name = options.name === undefined ? undefined : identifier(options.name, 'spawned entity name');
    /** @type {Entity[]} */
    const created = [];
    try {
      for (let i = 0; i < count; i++) {
        const entity = registry.instantiate(prefab);
        created.push(entity);
        Object.assign(entity, placement);
        if (name !== undefined) entity.name = name;
        if (options.active !== undefined) entity.active = options.active;
        if (tags.length) entity.addTag(tags);
        entity.snapTransform();
      }
      for (const entity of created) {
        root.add(entity);
        if (closed || entity.destroyed || entity.parent !== root) throw new Error('Spawned entity detached during activation: ' + prefab);
      }
      return created;
    } catch (error) {
      return rollback(error, created.reverse().map(entity => () => entity.destroy()));
    }
  }

  return {
    id, root, getSpawnPoint,
    /** @param {string} key @returns {Entity | null} */
    getEntity(key) {
      const entity = instances.get(key);
      if (!entity || entity.destroyed) return null;
      for (let owner = entity.parent; owner; owner = owner.parent) if (owner === root) return entity;
      return null;
    },
    /** Instantiate a fresh prefab at a named point. @param {string} prefab @param {string} point @param {LevelSpawnOptions} [options] @returns {Entity} */
    spawn(prefab, point, options) { return spawnBatch(prefab, point, 1, options)[0]; },
    spawnBatch,
    /** @param {Iterable<import('./trigger-volumes.js').TriggerSample>} samples */
    updateTriggers(samples) { live(); return triggers.update(samples); },
    /** Sample the true world positions of selected active scene entities. @param {Iterable<Entity>} entities */
    updateEntityTriggers(entities) {
      live();
      return triggers.update((function *() {
        const position = { x: 0, y: 0, z: 0 };
        for (const entity of entities) {
          if (entity.scene !== scene || !entity.activeInHierarchy) continue;
          entity.worldPosition(position);
          yield { id: String(entity.id), position: dimensions === 2 ? [position.x, position.y] : [position.x, position.y, position.z], tags: entity.tags };
        }
      })());
    },
    contains: triggers.contains,
    subscribe: triggers.subscribe,
    /** @returns {LevelSnapshot} */
    snapshot() { live(); return { schemaVersion: 1, levelId: id, usedTriggers: triggers.snapshot() }; },
    /** @param {LevelSnapshot} snapshot */
    restore(snapshot) {
      live();
      if (snapshot?.schemaVersion !== 1 || snapshot.levelId !== id) throw new Error('Incompatible level snapshot');
      triggers.restore(snapshot.usedTriggers);
    },
    dispose() { if (!closed) root.destroy(); },
  };
}

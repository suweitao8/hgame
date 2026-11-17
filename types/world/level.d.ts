/**
 * Assemble a scoped level from registered prefab trees and named spawn/trigger data.
 * Construct the hierarchy off-scene, then attach one owner root. Dispose it to unload the level.
 * @param {import('../core/scene.js').Scene} scene
 * @param {import('../core/prefab.js').PrefabRegistry} registry
 * @param {LevelDefinition} data
 * @param {{onTrigger?: (event: import('./trigger-volumes.js').TriggerEvent) => void}} [options]
 */
export function mountLevel(scene: import("../core/scene.js").Scene, registry: import("../core/prefab.js").PrefabRegistry, data: LevelDefinition, { onTrigger }?: {
    onTrigger?: (event: import("./trigger-volumes.js").TriggerEvent) => void;
} | undefined): {
    id: string;
    root: Entity;
    getSpawnPoint: (key: string) => SpawnTransform | null;
    /** @param {string} key @returns {Entity | null} */
    getEntity(key: string): Entity | null;
    /** Instantiate a fresh prefab at a named point. @param {string} prefab @param {string} point @param {LevelSpawnOptions} [options] @returns {Entity} */
    spawn(prefab: string, point: string, options?: LevelSpawnOptions | undefined): Entity;
    spawnBatch: (prefab: string, point: string, count: number, options?: LevelSpawnOptions | undefined) => Entity[];
    /** @param {Iterable<import('./trigger-volumes.js').TriggerSample>} samples */
    updateTriggers(samples: Iterable<import("./trigger-volumes.js").TriggerSample>): import("./trigger-volumes.js").TriggerEvent[];
    /** Sample the true world positions of selected active scene entities. @param {Iterable<Entity>} entities */
    updateEntityTriggers(entities: Iterable<Entity>): import("./trigger-volumes.js").TriggerEvent[];
    contains: (volume: string, actor: string) => boolean;
    subscribe: (listener: (event: TriggerEvent) => void) => (() => void);
    /** @returns {LevelSnapshot} */
    snapshot(): LevelSnapshot;
    /** @param {LevelSnapshot} snapshot */
    restore(snapshot: LevelSnapshot): void;
    dispose(): void;
};
export type PrefabTransform = import("../core/prefab.js").PrefabTransform;
export type LevelPoint = import("./trigger-volumes.js").LevelPoint;
export type LevelPlacement = {
    id: string;
    prefab?: string;
    parent?: string;
    active?: boolean;
    transform?: PrefabTransform;
    tags?: readonly string[];
};
export type SpawnPointDefinition = {
    position: LevelPoint;
    rotation?: readonly [number, number, number];
};
export type SpawnTransform = {
    x: number;
    y: number;
    z: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
};
export type LevelDefinition = {
    schemaVersion: 1;
    id: string;
    dimensions: 2 | 3;
    entities?: readonly LevelPlacement[];
    spawns?: Record<string, SpawnPointDefinition>;
    triggers?: Record<string, import("./trigger-volumes.js").TriggerVolume>;
};
export type LevelSnapshot = {
    schemaVersion: 1;
    levelId: string;
    usedTriggers: string[];
};
export type LevelSpawnOptions = {
    name?: string;
    active?: boolean;
    tags?: readonly string[];
};
import { Entity } from '../core/entity.js';

/**
 * Stateful per-observer AOI + Priority/Starvation + Delta replication planner.
 * Composes `InterestGrid2D` and `ReplicationPriorityScheduler` to produce exact
 * full snapshots and incremental per-observer delta plans, including seamless
 * spectator AOI target switching.
 */

import { InterestGrid2D, type AoiObserverDiffOptions } from './aoi-grid.js';
import {
  ReplicationPriorityScheduler,
  type ReplicationBudget,
  type ReplicationCandidate,
  type ReplicationObserver,
  type ReplicationSchedulerOptions,
} from './replication-scheduler.js';

export interface ReplicatedTransformEntity {
  id: number;
  x: number;
  y: number;
  z?: number;
  yaw?: number;
  flags?: number;
  basePriority?: number;
  alwaysRelevant?: boolean;
  dormant?: boolean;
  estimatedBytes?: number;
}

export interface AoiObserverConfig {
  x: number;
  y: number;
  enterRadius: number;
  exitRadius?: number;
  followEntityId?: number | null;
  maxEntities?: number;
  maxBytes?: number;
  viewDirX?: number;
  viewDirY?: number;
  viewConeCos?: number;
  viewConeBoost?: number;
  distanceFalloff?: number;
}

export interface AoiFullSnapshotPlan {
  kind: 'snapshot';
  tick: number;
  entities: ReplicatedTransformEntity[];
  visibleCount: number;
  deferredCount: number;
}

export interface AoiDeltaPlan {
  kind: 'delta';
  tick: number;
  baseTick: number;
  prevEntities: ReplicatedTransformEntity[];
  upserts: ReplicatedTransformEntity[];
  removedIds: number[];
  visibleCount: number;
  deferredCount: number;
}

export type ObserverReplicationPlan = AoiFullSnapshotPlan | AoiDeltaPlan;

interface InternalObserverState {
  config: AoiObserverConfig;
  visibleSet: Set<number>;
  lastSentEntities: Map<number, ReplicatedTransformEntity>;
  lastSentTick: number;
  needsSnapshot: boolean;
}

function cloneEntity(entity: ReplicatedTransformEntity): ReplicatedTransformEntity {
  const copy: ReplicatedTransformEntity = {
    id: entity.id,
    x: entity.x,
    y: entity.y,
    z: entity.z ?? 0,
    yaw: entity.yaw ?? 0,
    flags: entity.flags ?? 0,
  };
  if (entity.basePriority !== undefined) copy.basePriority = entity.basePriority;
  if (entity.alwaysRelevant !== undefined) copy.alwaysRelevant = entity.alwaysRelevant;
  if (entity.dormant !== undefined) copy.dormant = entity.dormant;
  if (entity.estimatedBytes !== undefined) copy.estimatedBytes = entity.estimatedBytes;
  return copy;
}

function entityTransformChanged(a: ReplicatedTransformEntity, b: ReplicatedTransformEntity): boolean {
  return a.x !== b.x
    || a.y !== b.y
    || (a.z ?? 0) !== (b.z ?? 0)
    || (a.yaw ?? 0) !== (b.yaw ?? 0)
    || (a.flags ?? 0) !== (b.flags ?? 0);
}

export interface AoiDeltaPlannerOptions extends ReplicationSchedulerOptions {
  cellSize?: number;
}

export class AoiDeltaPlanner {
  private readonly grid: InterestGrid2D<number>;
  private readonly scheduler: ReplicationPriorityScheduler<number>;
  private readonly entities = new Map<number, ReplicatedTransformEntity>();
  private readonly alwaysRelevantIds = new Set<number>();
  private readonly observers = new Map<string, InternalObserverState>();

  constructor(options: AoiDeltaPlannerOptions = {}) {
    const { cellSize = 64, ...schedulerOptions } = options;
    this.grid = new InterestGrid2D<number>(cellSize);
    this.scheduler = new ReplicationPriorityScheduler<number>(schedulerOptions);
  }

  get entityCount(): number {
    return this.entities.size;
  }

  get observerCount(): number {
    return this.observers.size;
  }

  upsertEntity(entity: ReplicatedTransformEntity): void {
    if (!Number.isInteger(entity.id) || entity.id < 0 || entity.id > 0xffff_ffff) {
      throw new RangeError('Replicated entity id must be a UInt32');
    }
    const copy = cloneEntity(entity);
    this.entities.set(copy.id, copy);
    this.grid.upsert(copy.id, copy.x, copy.y);
    if (copy.alwaysRelevant) this.alwaysRelevantIds.add(copy.id);
    else this.alwaysRelevantIds.delete(copy.id);
  }

  removeEntity(id: number): boolean {
    const removed = this.entities.delete(id);
    this.alwaysRelevantIds.delete(id);
    this.grid.remove(id);
    this.scheduler.removeEntity(id);
    return removed;
  }

  setObserver(observerId: string, config: AoiObserverConfig): void {
    if (!Number.isFinite(config.x) || !Number.isFinite(config.y)) {
      throw new RangeError('Observer coordinates must be finite');
    }
    if (!Number.isFinite(config.enterRadius) || config.enterRadius <= 0) {
      throw new RangeError('enterRadius must be > 0');
    }
    const existing = this.observers.get(observerId);
    if (existing) {
      existing.config = { ...config };
      return;
    }
    this.observers.set(observerId, {
      config: { ...config },
      visibleSet: new Set(),
      lastSentEntities: new Map(),
      lastSentTick: 0,
      needsSnapshot: true,
    });
  }

  setObserverFollow(observerId: string, followEntityId: number | null): void {
    const observer = this.observers.get(observerId);
    if (!observer) return;
    if (observer.config.followEntityId !== followEntityId) {
      observer.config.followEntityId = followEntityId;
      observer.visibleSet.clear();
      observer.lastSentEntities.clear();
      observer.needsSnapshot = true;
      this.scheduler.removeObserver(observerId);
    }
  }

  resetObserver(observerId: string): void {
    const observer = this.observers.get(observerId);
    if (!observer) return;
    observer.visibleSet.clear();
    observer.lastSentEntities.clear();
    observer.needsSnapshot = true;
    this.scheduler.removeObserver(observerId);
  }

  removeObserver(observerId: string): boolean {
    this.scheduler.removeObserver(observerId);
    return this.observers.delete(observerId);
  }

  planForObserver(
    observerId: string,
    tick: number,
    dtSeconds: number,
  ): ObserverReplicationPlan | null {
    const observer = this.observers.get(observerId);
    if (!observer) return null;

    const { config } = observer;
    const followed = config.followEntityId != null ? this.entities.get(config.followEntityId) : undefined;
    const ox = followed ? followed.x : config.x;
    const oy = followed ? followed.y : config.y;

    const diffOptions: AoiObserverDiffOptions<number> = {
      x: ox,
      y: oy,
      enterRadius: config.enterRadius,
      currentlyVisible: observer.visibleSet,
    };
    if (config.exitRadius !== undefined) diffOptions.exitRadius = config.exitRadius;

    const diff = this.grid.computeObserverDiff(diffOptions);
    const visibleIds = diff.visible;
    for (const id of this.alwaysRelevantIds) {
      visibleIds.add(id);
    }
    if (followed) {
      visibleIds.add(followed.id);
    }
    observer.visibleSet = visibleIds;

    const removedIds: number[] = [];
    if (!observer.needsSnapshot) {
      for (const prevId of observer.lastSentEntities.keys()) {
        if (!visibleIds.has(prevId) || !this.entities.has(prevId)) {
          removedIds.push(prevId);
        }
      }
      for (const id of removedIds) {
        observer.lastSentEntities.delete(id);
      }
    }

    const candidates: Array<ReplicationCandidate<number>> = [];
    for (const id of visibleIds) {
      const entity = this.entities.get(id);
      if (!entity) continue;
      const prev = observer.lastSentEntities.get(id);
      const isNew = prev === undefined;
      const dirty = observer.needsSnapshot || isNew || entityTransformChanged(prev, entity);
      if (!dirty) continue;

      const candidate: ReplicationCandidate<number> = {
        id: entity.id,
        x: entity.x,
        y: entity.y,
        alwaysRelevant: Boolean(entity.alwaysRelevant || followed?.id === entity.id),
        dirty: true,
      };
      if (entity.z !== undefined) candidate.z = entity.z;
      const basePriority = followed && entity.id === followed.id ? 10 : entity.basePriority;
      if (basePriority !== undefined) candidate.basePriority = basePriority;
      if (entity.dormant !== undefined) candidate.dormant = entity.dormant;
      if (entity.estimatedBytes !== undefined) candidate.estimatedBytes = entity.estimatedBytes;
      candidates.push(candidate);
    }

    const obsSpec: ReplicationObserver = { x: ox, y: oy };
    if (config.viewDirX !== undefined) obsSpec.viewDirX = config.viewDirX;
    if (config.viewDirY !== undefined) obsSpec.viewDirY = config.viewDirY;
    if (config.viewConeCos !== undefined) obsSpec.viewConeCos = config.viewConeCos;
    if (config.viewConeBoost !== undefined) obsSpec.viewConeBoost = config.viewConeBoost;
    if (config.distanceFalloff !== undefined) obsSpec.distanceFalloff = config.distanceFalloff;

    const budget: ReplicationBudget = { allowOversizeFirst: true };
    if (config.maxEntities !== undefined) budget.maxEntities = config.maxEntities;
    if (config.maxBytes !== undefined) budget.maxBytes = config.maxBytes;

    const scheduled = this.scheduler.schedule(
      observerId,
      candidates,
      obsSpec,
      budget,
      dtSeconds,
    );

    const selectedEntities: ReplicatedTransformEntity[] = [];
    for (const item of scheduled.selected) {
      const current = this.entities.get(item.id);
      if (current) selectedEntities.push(cloneEntity(current));
    }

    if (observer.needsSnapshot) {
      observer.needsSnapshot = false;
      observer.lastSentTick = tick;
      observer.lastSentEntities.clear();
      for (const entity of selectedEntities) {
        observer.lastSentEntities.set(entity.id, cloneEntity(entity));
      }
      return {
        kind: 'snapshot',
        tick,
        entities: selectedEntities,
        visibleCount: visibleIds.size,
        deferredCount: scheduled.deferred.length,
      };
    }

    if (selectedEntities.length === 0 && removedIds.length === 0) {
      return null;
    }

    const prevEntities = Array.from(observer.lastSentEntities.values()).map(cloneEntity);
    const baseTick = observer.lastSentTick;
    observer.lastSentTick = tick;
    for (const entity of selectedEntities) {
      observer.lastSentEntities.set(entity.id, cloneEntity(entity));
    }

    return {
      kind: 'delta',
      tick,
      baseTick,
      prevEntities,
      upserts: selectedEntities,
      removedIds,
      visibleCount: visibleIds.size,
      deferredCount: scheduled.deferred.length,
    };
  }
}

/**
 * Clean-room Priority × Starvation network replication scheduler.
 * Ranks dirty entities per observer per tick using base priority, distance
 * falloff, view-cone alignment, and accumulated time-since-last-send so
 * packet bandwidth caps (`maxEntities`, `maxBytes`) are never exceeded while
 * low-priority entities remain guaranteed against permanent starvation.
 */

export type ReplicationEntityId = string | number;
export type ObserverId = string | number;

export interface ReplicationCandidate<T extends ReplicationEntityId = ReplicationEntityId> {
  id: T;
  x?: number;
  y?: number;
  z?: number;
  basePriority?: number;
  alwaysRelevant?: boolean;
  dirty?: boolean;
  dormant?: boolean;
  estimatedBytes?: number;
}

export interface ReplicationObserver {
  x: number;
  y: number;
  z?: number;
  viewDirX?: number;
  viewDirY?: number;
  viewDirZ?: number;
  maxRelevantDistance?: number;
  viewConeCos?: number;
  viewConeBoost?: number;
  distanceFalloff?: number;
}

export interface ReplicationBudget {
  maxEntities?: number;
  maxBytes?: number;
  allowOversizeFirst?: boolean;
}

export interface ReplicationSchedulerOptions {
  defaultEntityBytes?: number;
  distanceFalloff?: number;
  viewConeBoost?: number;
  viewConeCos?: number;
  minPriorityFloor?: number;
  starvationRate?: number;
}

export interface ScheduledEntity<T extends ReplicationEntityId = ReplicationEntityId> {
  id: T;
  score: number;
  distance: number;
  estimatedBytes: number;
  waitTimeSeconds: number;
  inViewCone: boolean;
}

export interface ReplicationScheduleResult<T extends ReplicationEntityId = ReplicationEntityId> {
  selected: ScheduledEntity<T>[];
  deferred: T[];
  skippedDormant: number;
  bytesUsed: number;
  candidateCount: number;
}

interface EntityStarvationRecord {
  waitSeconds: number;
  lastSentTick: number;
}

export class ReplicationPriorityScheduler<T extends ReplicationEntityId = ReplicationEntityId> {
  private readonly defaultEntityBytes: number;
  private readonly distanceFalloff: number;
  private readonly viewConeBoost: number;
  private readonly viewConeCos: number;
  private readonly minPriorityFloor: number;
  private readonly starvationRate: number;
  private readonly observerStates = new Map<ObserverId, Map<T, EntityStarvationRecord>>();
  private tickCounter = 0;

  constructor({
    defaultEntityBytes = 48,
    distanceFalloff = 32,
    viewConeBoost = 1.5,
    viewConeCos = 0.5,
    minPriorityFloor = 0.05,
    starvationRate = 1,
  }: ReplicationSchedulerOptions = {}) {
    if (!Number.isFinite(defaultEntityBytes) || defaultEntityBytes <= 0) {
      throw new RangeError('defaultEntityBytes must be a positive finite number');
    }
    if (!Number.isFinite(distanceFalloff) || distanceFalloff <= 0) {
      throw new RangeError('distanceFalloff must be a positive finite number');
    }
    this.defaultEntityBytes = defaultEntityBytes;
    this.distanceFalloff = distanceFalloff;
    this.viewConeBoost = Math.max(1, Number(viewConeBoost) || 1);
    this.viewConeCos = Number.isFinite(viewConeCos) ? viewConeCos : 0.5;
    this.minPriorityFloor = Math.max(0.001, Number(minPriorityFloor) || 0.05);
    this.starvationRate = Math.max(0.01, Number(starvationRate) || 1);
  }

  private getObserverMap(observerId: ObserverId): Map<T, EntityStarvationRecord> {
    let map = this.observerStates.get(observerId);
    if (!map) {
      map = new Map();
      this.observerStates.set(observerId, map);
    }
    return map;
  }

  getWaitTime(observerId: ObserverId, entityId: T): number {
    return this.observerStates.get(observerId)?.get(entityId)?.waitSeconds ?? 0;
  }

  resetWaitTime(observerId: ObserverId, entityId: T): void {
    const rec = this.observerStates.get(observerId)?.get(entityId);
    if (rec) rec.waitSeconds = 0;
  }

  removeObserver(observerId: ObserverId): boolean {
    return this.observerStates.delete(observerId);
  }

  removeEntity(entityId: T): void {
    for (const map of this.observerStates.values()) {
      map.delete(entityId);
    }
  }

  pruneObserver(observerId: ObserverId, activeIds: ReadonlySet<T>): void {
    const map = this.observerStates.get(observerId);
    if (!map) return;
    for (const id of map.keys()) {
      if (!activeIds.has(id)) map.delete(id);
    }
  }

  clear(): void {
    this.observerStates.clear();
    this.tickCounter = 0;
  }

  schedule(
    observerId: ObserverId,
    candidates: Iterable<ReplicationCandidate<T>>,
    observer: ReplicationObserver,
    budget: ReplicationBudget = {},
    dt = 1 / 20,
  ): ReplicationScheduleResult<T> {
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 20;
    const tick = ++this.tickCounter;
    const obsMap = this.getObserverMap(observerId);

    const maxEntities = budget.maxEntities !== undefined && Number.isFinite(budget.maxEntities)
      ? Math.max(0, Math.floor(budget.maxEntities))
      : Infinity;
    const maxBytes = budget.maxBytes !== undefined && Number.isFinite(budget.maxBytes)
      ? Math.max(0, budget.maxBytes)
      : Infinity;
    const allowOversizeFirst = budget.allowOversizeFirst !== false;

    const falloff = observer.distanceFalloff && observer.distanceFalloff > 0
      ? observer.distanceFalloff
      : this.distanceFalloff;
    const coneCos = observer.viewConeCos ?? this.viewConeCos;
    const coneBoost = observer.viewConeBoost ?? this.viewConeBoost;
    const hasViewDir =
      Number.isFinite(observer.viewDirX) ||
      Number.isFinite(observer.viewDirY) ||
      Number.isFinite(observer.viewDirZ);
    const vxRaw = observer.viewDirX ?? 0;
    const vyRaw = observer.viewDirY ?? 0;
    const vzRaw = observer.viewDirZ ?? 0;
    const vLen = hasViewDir ? Math.hypot(vxRaw, vyRaw, vzRaw) : 0;
    const vx = vLen > 1e-6 ? vxRaw / vLen : 0;
    const vy = vLen > 1e-6 ? vyRaw / vLen : 0;
    const vz = vLen > 1e-6 ? vzRaw / vLen : 0;

    const ox = Number(observer.x) || 0;
    const oy = Number(observer.y) || 0;
    const oz = Number(observer.z) || 0;

    const scored: ScheduledEntity<T>[] = [];
    const seenIds = new Set<T>();
    let skippedDormant = 0;
    let candidateCount = 0;

    for (const candidate of candidates) {
      candidateCount++;
      seenIds.add(candidate.id);
      let rec = obsMap.get(candidate.id);
      if (!rec) {
        rec = { waitSeconds: 0, lastSentTick: -1 };
        obsMap.set(candidate.id, rec);
      }

      if (candidate.dormant || candidate.dirty === false) {
        skippedDormant++;
        continue;
      }

      const waitTimeSeconds = rec.waitSeconds + stepDt * this.starvationRate;
      rec.waitSeconds = waitTimeSeconds;

      const cx = candidate.x !== undefined ? candidate.x : ox;
      const cy = candidate.y !== undefined ? candidate.y : oy;
      const cz = candidate.z !== undefined ? candidate.z : oz;
      const dx = cx - ox;
      const dy = cy - oy;
      const dz = cz - oz;
      const distance = Math.hypot(dx, dy, dz);

      if (
        !candidate.alwaysRelevant &&
        observer.maxRelevantDistance !== undefined &&
        Number.isFinite(observer.maxRelevantDistance) &&
        distance > observer.maxRelevantDistance
      ) {
        // Out of cutoff range: skip this tick without discarding record
        continue;
      }

      let inViewCone = false;
      if (vLen > 1e-6 && distance > 1e-6) {
        const dot = (dx * vx + dy * vy + dz * vz) / distance;
        inViewCone = dot >= coneCos;
      }

      const basePriority = candidate.basePriority !== undefined
        ? Math.max(this.minPriorityFloor, candidate.basePriority)
        : 1;
      const distAttenuation = candidate.alwaysRelevant ? 1 : (1 / (1 + distance / falloff));
      const viewMultiplier = inViewCone ? coneBoost : 1;
      const relevantMultiplier = candidate.alwaysRelevant ? 10 : 1;
      const estimatedBytes = candidate.estimatedBytes && candidate.estimatedBytes > 0
        ? candidate.estimatedBytes
        : this.defaultEntityBytes;

      const score =
        basePriority *
        relevantMultiplier *
        distAttenuation *
        viewMultiplier *
        waitTimeSeconds;

      scored.push({
        id: candidate.id,
        score,
        distance,
        estimatedBytes,
        waitTimeSeconds,
        inViewCone,
      });
    }

    scored.sort((a, b) => (b.score - a.score) || (a.distance - b.distance));

    const selected: ScheduledEntity<T>[] = [];
    const deferred: T[] = [];
    let bytesUsed = 0;

    for (const item of scored) {
      const entityLimitReached = selected.length >= maxEntities;
      const fitsBytes =
        bytesUsed + item.estimatedBytes <= maxBytes ||
        (allowOversizeFirst && selected.length === 0 && maxEntities > 0 && maxBytes > 0);

      if (!entityLimitReached && fitsBytes) {
        selected.push(item);
        bytesUsed += item.estimatedBytes;
        const rec = obsMap.get(item.id);
        if (rec) {
          rec.waitSeconds = 0;
          rec.lastSentTick = tick;
        }
      } else {
        deferred.push(item.id);
      }
    }

    // Prune vanished entities automatically so per-observer starvation state stays bounded
    for (const knownId of obsMap.keys()) {
      if (!seenIds.has(knownId)) {
        obsMap.delete(knownId);
      }
    }

    return {
      selected,
      deferred,
      skippedDormant,
      bytesUsed,
      candidateCount,
    };
  }
}

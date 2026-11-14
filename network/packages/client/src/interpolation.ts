/**
 * Client-side snapshot interpolation buffer (with shortest-arc angle wrap
 * and bounded linear dead-reckoning) plus adaptive lockstep lead controller.
 */

const TWO_PI = Math.PI * 2;

function wrapAngleRad(angle: number): number {
  let wrapped = (angle + Math.PI) % TWO_PI;
  if (wrapped < 0) wrapped += TWO_PI;
  return wrapped - Math.PI;
}

function lerpAngleRad(a: number, b: number, alpha: number): number {
  return a + wrapAngleRad(b - a) * alpha;
}

export interface SnapshotInterpolationOptions {
  interpolationDelayMs?: number;
  maxSnapshots?: number;
  maxExtrapolationMs?: number;
  angleFields?: readonly string[];
}

interface StoredSnapshot<TEntity extends Record<string, number>> {
  timestampMs: number;
  entities: Map<string, TEntity>;
}

function cloneEntityRecord<TEntity extends Record<string, number>>(entity: TEntity): TEntity {
  return { ...entity };
}

function cloneEntityMap<TEntity extends Record<string, number>>(source: ReadonlyMap<string, TEntity>): Map<string, TEntity> {
  const copy = new Map<string, TEntity>();
  for (const [id, entity] of source) copy.set(id, cloneEntityRecord(entity));
  return copy;
}

export class SnapshotInterpolationBuffer<
  TEntity extends Record<string, number> = { x: number; y: number; z?: number },
> {
  private readonly interpolationDelayMs: number;
  private readonly maxSnapshots: number;
  private readonly maxExtrapolationMs: number;
  private readonly angleFields: ReadonlySet<string>;
  private readonly snapshots: Array<StoredSnapshot<TEntity>> = [];

  constructor(options: SnapshotInterpolationOptions = {}) {
    const {
      interpolationDelayMs = 100,
      maxSnapshots = 32,
      maxExtrapolationMs = 80,
      angleFields = [],
    } = options;
    if (!Number.isFinite(interpolationDelayMs) || interpolationDelayMs < 0) {
      throw new RangeError('interpolationDelayMs must be >= 0');
    }
    if (!Number.isInteger(maxSnapshots) || maxSnapshots < 2 || maxSnapshots > 256) {
      throw new RangeError('maxSnapshots must be an integer from 2 to 256');
    }
    if (!Number.isFinite(maxExtrapolationMs) || maxExtrapolationMs < 0) {
      throw new RangeError('maxExtrapolationMs must be >= 0');
    }
    this.interpolationDelayMs = interpolationDelayMs;
    this.maxSnapshots = maxSnapshots;
    this.maxExtrapolationMs = maxExtrapolationMs;
    this.angleFields = new Set(angleFields);
  }

  get size(): number {
    return this.snapshots.length;
  }

  clear(): void {
    this.snapshots.length = 0;
  }

  push(timestampMs: number, entities: ReadonlyMap<string, TEntity> | Record<string, TEntity>): void {
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('timestampMs must be finite');
    }
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest && timestampMs <= latest.timestampMs) return;

    const map = new Map<string, TEntity>();
    const entries = entities instanceof Map ? entities.entries() : Object.entries(entities);
    for (const [id, record] of entries) {
      map.set(id, cloneEntityRecord(record));
    }
    this.snapshots.push({ timestampMs, entities: map });
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  sample(nowMs: number): Map<string, TEntity> {
    if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
    if (this.snapshots.length === 0) return new Map();

    const oldest = this.snapshots[0]!;
    const latest = this.snapshots[this.snapshots.length - 1]!;
    const renderTime = nowMs - this.interpolationDelayMs;

    if (this.snapshots.length === 1 || renderTime <= oldest.timestampMs) {
      return cloneEntityMap(oldest.entities);
    }

    if (renderTime < latest.timestampMs) {
      let idx = 0;
      for (let i = this.snapshots.length - 2; i >= 0; i--) {
        if (this.snapshots[i]!.timestampMs <= renderTime) {
          idx = i;
          break;
        }
      }
      const s0 = this.snapshots[idx]!;
      const s1 = this.snapshots[idx + 1]!;
      const span = Math.max(1e-6, s1.timestampMs - s0.timestampMs);
      const alpha = Math.max(0, Math.min(1, (renderTime - s0.timestampMs) / span));

      const out = new Map<string, TEntity>();
      for (const [id, b] of s1.entities) {
        const a = s0.entities.get(id);
        if (!a) {
          out.set(id, cloneEntityRecord(b));
          continue;
        }
        const blended: Record<string, number> = {};
        for (const [key, bVal] of Object.entries(b)) {
          const aVal = a[key];
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            blended[key] = this.angleFields.has(key)
              ? lerpAngleRad(aVal, bVal, alpha)
              : aVal + (bVal - aVal) * alpha;
          } else if (typeof bVal === 'number') {
            blended[key] = bVal;
          }
        }
        out.set(id, blended as TEntity);
      }
      return out;
    }

    const prev = this.snapshots[this.snapshots.length - 2]!;
    const dt = latest.timestampMs - prev.timestampMs;
    const extMs = Math.min(this.maxExtrapolationMs, Math.max(0, renderTime - latest.timestampMs));
    if (!(dt > 0) || extMs <= 0) {
      return cloneEntityMap(latest.entities);
    }

    const factor = extMs / dt;
    const out = new Map<string, TEntity>();
    for (const [id, curr] of latest.entities) {
      const prior = prev.entities.get(id);
      if (!prior) {
        out.set(id, cloneEntityRecord(curr));
        continue;
      }
      const extrapolated: Record<string, number> = {};
      for (const [key, currVal] of Object.entries(curr)) {
        const prevVal = prior[key];
        if (typeof prevVal === 'number' && typeof currVal === 'number') {
          const delta = this.angleFields.has(key) ? wrapAngleRad(currVal - prevVal) : (currVal - prevVal);
          extrapolated[key] = currVal + delta * factor;
        } else if (typeof currVal === 'number') {
          extrapolated[key] = currVal;
        }
      }
      out.set(id, extrapolated as TEntity);
    }
    return out;
  }
}

export interface AdaptiveInputLeadOptions {
  minLeadTicks?: number;
  maxLeadTicks?: number;
  safetyMarginMs?: number;
  smoothing?: number;
}

export class AdaptiveInputLeadController {
  private readonly minLeadTicks: number;
  private readonly maxLeadTicks: number;
  private readonly safetyMarginMs: number;
  private readonly smoothing: number;
  private srtt = 0;
  private rttVar = 0;
  private sampleCount = 0;

  constructor(options: AdaptiveInputLeadOptions = {}) {
    const {
      minLeadTicks = 1,
      maxLeadTicks = 8,
      safetyMarginMs = 12,
      smoothing = 0.15,
    } = options;
    if (!Number.isInteger(minLeadTicks) || minLeadTicks < 1 || minLeadTicks > 16) {
      throw new RangeError('minLeadTicks must be an integer from 1 to 16');
    }
    if (!Number.isInteger(maxLeadTicks) || maxLeadTicks < minLeadTicks || maxLeadTicks > 32) {
      throw new RangeError('maxLeadTicks must be an integer from minLeadTicks to 32');
    }
    if (!Number.isFinite(safetyMarginMs) || safetyMarginMs < 0) {
      throw new RangeError('safetyMarginMs must be >= 0');
    }
    if (!Number.isFinite(smoothing) || smoothing <= 0 || smoothing > 1) {
      throw new RangeError('smoothing must be in (0, 1]');
    }
    this.minLeadTicks = minLeadTicks;
    this.maxLeadTicks = maxLeadTicks;
    this.safetyMarginMs = safetyMarginMs;
    this.smoothing = smoothing;
  }

  get srttMs(): number { return this.srtt; }
  get jitterMs(): number { return this.rttVar; }
  get samples(): number { return this.sampleCount; }

  reset(): void {
    this.srtt = 0;
    this.rttVar = 0;
    this.sampleCount = 0;
  }

  recordRttSample(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) {
      throw new RangeError('rttMs must be a nonnegative finite number');
    }
    if (this.sampleCount === 0) {
      this.srtt = rttMs;
      this.rttVar = 0;
    } else {
      const error = Math.abs(rttMs - this.srtt);
      this.rttVar = (1 - this.smoothing) * this.rttVar + this.smoothing * error;
      this.srtt = (1 - this.smoothing) * this.srtt + this.smoothing * rttMs;
    }
    this.sampleCount++;
  }

  recommendLeadTicks(netHz: number): number {
    if (!Number.isFinite(netHz) || netHz <= 0) {
      throw new RangeError('netHz must be > 0');
    }
    if (this.sampleCount === 0) return this.minLeadTicks;
    const tickMs = 1000 / netHz;
    const budgetMs = this.srtt * 0.5 + this.rttVar * 2 + this.safetyMarginMs;
    const needed = Math.ceil(budgetMs / tickMs);
    return Math.max(this.minLeadTicks, Math.min(this.maxLeadTicks, needed));
  }
}

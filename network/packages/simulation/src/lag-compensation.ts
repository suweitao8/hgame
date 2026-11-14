/**
 * Authoritative server-side lag compensation snapshot ring buffer and
 * bounded rewind ray-circle hit verifier for action/shooter netcode.
 */

export interface LagCompensatedPose {
  x: number;
  y: number;
  z?: number;
  radius?: number;
}

export interface LagCompensationSnapshot<TPose extends LagCompensatedPose = LagCompensatedPose> {
  tick: number;
  timestampMs: number;
  poses: Map<string, TPose>;
}

export interface SampledWorldState<TPose extends LagCompensatedPose = LagCompensatedPose> {
  timestampMs: number;
  clamped: boolean;
  poses: Map<string, TPose>;
}

export interface Ray2D {
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
  maxDistance: number;
}

export interface VerifyHit2DOptions {
  shooterId?: string;
  targetTimestampMs: number;
  nowTimestampMs?: number;
  maxRewindMs?: number;
  ray: Ray2D;
  defaultRadius?: number;
}

export interface HitVerificationResult {
  hit: boolean;
  actorId: string | null;
  distance: number;
  hitX: number;
  hitY: number;
  rewoundMs: number;
}

function toPoseMap<TPose extends LagCompensatedPose>(
  input: ReadonlyMap<string, TPose> | Record<string, TPose>,
): Map<string, TPose> {
  const out = new Map<string, TPose>();
  const entries = input instanceof Map ? input.entries() : Object.entries(input);
  for (const [id, pose] of entries) {
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
      throw new RangeError(`Invalid lag-compensation pose for actor ${id}`);
    }
    out.set(id, { ...pose });
  }
  return out;
}

function clonePoseMap<TPose extends LagCompensatedPose>(source: ReadonlyMap<string, TPose>): Map<string, TPose> {
  const out = new Map<string, TPose>();
  for (const [id, pose] of source) out.set(id, { ...pose });
  return out;
}

function interpolatePose<TPose extends LagCompensatedPose>(a: TPose, b: TPose, alpha: number): TPose {
  const pose: TPose = {
    ...b,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
  };
  if (typeof a.z === 'number' && typeof b.z === 'number') {
    pose.z = a.z + (b.z - a.z) * alpha;
  }
  if (typeof a.radius === 'number' && typeof b.radius === 'number') {
    pose.radius = a.radius + (b.radius - a.radius) * alpha;
  }
  return pose;
}

export class LagCompensationHistory<TPose extends LagCompensatedPose = LagCompensatedPose> {
  private readonly snapshots: Array<LagCompensationSnapshot<TPose>> = [];

  constructor(private readonly maxSnapshots = 64) {
    if (!Number.isInteger(maxSnapshots) || maxSnapshots < 2 || maxSnapshots > 1024) {
      throw new RangeError('maxSnapshots must be an integer from 2 to 1024');
    }
  }

  get size(): number {
    return this.snapshots.length;
  }

  clear(): void {
    this.snapshots.length = 0;
  }

  record(
    tick: number,
    timestampMs: number,
    poses: ReadonlyMap<string, TPose> | Record<string, TPose>,
  ): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new RangeError('tick must be a nonnegative integer');
    }
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('timestampMs must be finite');
    }
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest) {
      if (timestampMs < latest.timestampMs) return;
      if (timestampMs === latest.timestampMs) {
        this.snapshots[this.snapshots.length - 1] = {
          tick,
          timestampMs,
          poses: toPoseMap(poses),
        };
        return;
      }
    }
    this.snapshots.push({ tick, timestampMs, poses: toPoseMap(poses) });
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  sampleAt(
    targetTimestampMs: number,
    nowTimestampMs?: number,
    maxRewindMs = 250,
  ): SampledWorldState<TPose> | null {
    if (!Number.isFinite(targetTimestampMs)) {
      throw new RangeError('targetTimestampMs must be finite');
    }
    if (!Number.isFinite(maxRewindMs) || maxRewindMs < 0) {
      throw new RangeError('maxRewindMs must be nonnegative');
    }
    if (this.snapshots.length === 0) return null;

    const oldest = this.snapshots[0]!;
    const latest = this.snapshots[this.snapshots.length - 1]!;
    const referenceNow = nowTimestampMs ?? latest.timestampMs;
    const earliestAllowed = referenceNow - maxRewindMs;
    const boundedTarget = Math.max(earliestAllowed, Math.min(referenceNow, targetTimestampMs));

    if (boundedTarget <= oldest.timestampMs) {
      return {
        timestampMs: oldest.timestampMs,
        clamped: boundedTarget !== targetTimestampMs || oldest.timestampMs !== targetTimestampMs,
        poses: clonePoseMap(oldest.poses),
      };
    }
    if (boundedTarget >= latest.timestampMs) {
      return {
        timestampMs: latest.timestampMs,
        clamped: boundedTarget !== targetTimestampMs,
        poses: clonePoseMap(latest.poses),
      };
    }

    let beforeIndex = 0;
    for (let i = this.snapshots.length - 2; i >= 0; i--) {
      if (this.snapshots[i]!.timestampMs <= boundedTarget) {
        beforeIndex = i;
        break;
      }
    }
    const before = this.snapshots[beforeIndex]!;
    const after = this.snapshots[beforeIndex + 1]!;
    const span = Math.max(1e-6, after.timestampMs - before.timestampMs);
    const alpha = Math.max(0, Math.min(1, (boundedTarget - before.timestampMs) / span));

    const poses = new Map<string, TPose>();
    for (const [id, afterPose] of after.poses) {
      const beforePose = before.poses.get(id);
      poses.set(id, beforePose ? interpolatePose(beforePose, afterPose, alpha) : { ...afterPose });
    }
    return {
      timestampMs: boundedTarget,
      clamped: boundedTarget !== targetTimestampMs,
      poses,
    };
  }

  verifyHit2D(options: VerifyHit2DOptions): HitVerificationResult {
    const {
      shooterId,
      targetTimestampMs,
      nowTimestampMs,
      maxRewindMs = 250,
      ray,
      defaultRadius = 0.5,
    } = options;

    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      return { hit: false, actorId: null, distance: 0, hitX: ray.originX, hitY: ray.originY, rewoundMs: 0 };
    }
    const sample = this.sampleAt(targetTimestampMs, nowTimestampMs, maxRewindMs);
    const referenceNow = nowTimestampMs ?? latest.timestampMs;
    const rewoundMs = sample ? Math.max(0, referenceNow - sample.timestampMs) : 0;

    const dirLen = Math.hypot(ray.dirX, ray.dirY);
    if (!sample || !(dirLen > 0) || !(ray.maxDistance > 0)) {
      return { hit: false, actorId: null, distance: 0, hitX: ray.originX, hitY: ray.originY, rewoundMs };
    }
    const dx = ray.dirX / dirLen;
    const dy = ray.dirY / dirLen;

    let bestActorId: string | null = null;
    let bestT = Infinity;

    for (const [actorId, pose] of sample.poses) {
      if (shooterId !== undefined && actorId === shooterId) continue;
      const radius = pose.radius ?? defaultRadius;
      if (!(radius > 0)) continue;

      const fx = ray.originX - pose.x;
      const fy = ray.originY - pose.y;
      const c = fx * fx + fy * fy - radius * radius;
      let t = Infinity;
      if (c <= 0) {
        t = 0;
      } else {
        const b = fx * dx + fy * dy;
        if (b <= 0) {
          const disc = b * b - c;
          if (disc >= 0) {
            const candidate = -b - Math.sqrt(disc);
            if (candidate >= 0 && candidate <= ray.maxDistance) t = candidate;
          }
        }
      }
      if (t < bestT) {
        bestT = t;
        bestActorId = actorId;
      }
    }

    if (bestActorId === null || !Number.isFinite(bestT)) {
      return { hit: false, actorId: null, distance: 0, hitX: ray.originX, hitY: ray.originY, rewoundMs };
    }
    return {
      hit: true,
      actorId: bestActorId,
      distance: bestT,
      hitX: ray.originX + dx * bestT,
      hitY: ray.originY + dy * bestT,
      rewoundMs,
    };
  }
}

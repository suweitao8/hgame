/**
 * Spatial Interest Management (Area of Interest, AOI) grid for 2D or 3D XZ ground planes.
 * Keeps per-observer visibility sets small and prevents boundary flicker via enter/exit hysteresis.
 */

export type AoiEntityId = string | number;

export interface AoiEntityEntry<T extends AoiEntityId = AoiEntityId> {
  id: T;
  x: number;
  y: number;
  cellKey: string;
}

export interface AoiObserverDiffOptions<T extends AoiEntityId = AoiEntityId> {
  x: number;
  y: number;
  enterRadius: number;
  exitRadius?: number;
  currentlyVisible?: ReadonlySet<T>;
  excludeId?: T;
}

export interface AoiObserverDiff<T extends AoiEntityId = AoiEntityId> {
  entered: T[];
  exited: T[];
  visible: Set<T>;
}

export interface AoiNeighbor<T extends AoiEntityId = AoiEntityId> {
  id: T;
  distSq: number;
}

export class InterestGrid2D<T extends AoiEntityId = AoiEntityId> {
  readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly entities = new Map<T, AoiEntityEntry<T>>();
  private readonly cells = new Map<string, Set<T>>();

  constructor(cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('cellSize must be a positive finite number');
    }
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  get size(): number {
    return this.entities.size;
  }

  private cellCoord(value: number): number {
    return Math.floor(value * this.invCellSize);
  }

  private keyFor(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  upsert(id: T, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('AOI entity coordinates must be finite');
    }
    const cx = this.cellCoord(x);
    const cy = this.cellCoord(y);
    const nextKey = this.keyFor(cx, cy);

    const existing = this.entities.get(id);
    if (existing) {
      if (existing.cellKey !== nextKey) {
        const oldBucket = this.cells.get(existing.cellKey);
        if (oldBucket) {
          oldBucket.delete(id);
          if (oldBucket.size === 0) this.cells.delete(existing.cellKey);
        }
        let nextBucket = this.cells.get(nextKey);
        if (!nextBucket) {
          nextBucket = new Set<T>();
          this.cells.set(nextKey, nextBucket);
        }
        nextBucket.add(id);
        existing.cellKey = nextKey;
      }
      existing.x = x;
      existing.y = y;
      return;
    }

    let bucket = this.cells.get(nextKey);
    if (!bucket) {
      bucket = new Set<T>();
      this.cells.set(nextKey, bucket);
    }
    bucket.add(id);
    this.entities.set(id, { id, x, y, cellKey: nextKey });
  }

  remove(id: T): boolean {
    const existing = this.entities.get(id);
    if (!existing) return false;
    const bucket = this.cells.get(existing.cellKey);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.cells.delete(existing.cellKey);
    }
    this.entities.delete(id);
    return true;
  }

  clear(): void {
    this.entities.clear();
    this.cells.clear();
  }

  has(id: T): boolean {
    return this.entities.has(id);
  }

  getPosition(id: T): { x: number; y: number } | null {
    const e = this.entities.get(id);
    return e ? { x: e.x, y: e.y } : null;
  }

  queryRadius(x: number, y: number, radius: number, outIds: T[] = []): T[] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      throw new RangeError('queryRadius requires finite coordinates and non-negative radius');
    }
    const rSq = radius * radius;
    const minCx = this.cellCoord(x - radius);
    const maxCx = this.cellCoord(x + radius);
    const minCy = this.cellCoord(y - radius);
    const maxCy = this.cellCoord(y + radius);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.keyFor(cx, cy));
        if (!bucket) continue;
        for (const id of bucket) {
          const entry = this.entities.get(id);
          if (!entry) continue;
          const dx = entry.x - x;
          const dy = entry.y - y;
          if (dx * dx + dy * dy <= rSq) {
            outIds.push(id);
          }
        }
      }
    }
    return outIds;
  }

  queryNeighborsSorted(x: number, y: number, radius: number, limit = Infinity): AoiNeighbor<T>[] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      throw new RangeError('queryNeighborsSorted requires finite coordinates and non-negative radius');
    }
    const rSq = radius * radius;
    const minCx = this.cellCoord(x - radius);
    const maxCx = this.cellCoord(x + radius);
    const minCy = this.cellCoord(y - radius);
    const maxCy = this.cellCoord(y + radius);

    const neighbors: AoiNeighbor<T>[] = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.keyFor(cx, cy));
        if (!bucket) continue;
        for (const id of bucket) {
          const entry = this.entities.get(id);
          if (!entry) continue;
          const dx = entry.x - x;
          const dy = entry.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= rSq) {
            neighbors.push({ id, distSq });
          }
        }
      }
    }

    neighbors.sort((a, b) => a.distSq - b.distSq);
    if (Number.isFinite(limit) && limit >= 0 && neighbors.length > limit) {
      neighbors.length = Math.floor(limit);
    }
    return neighbors;
  }

  computeObserverDiff(options: AoiObserverDiffOptions<T>): AoiObserverDiff<T> {
    const {
      x,
      y,
      enterRadius,
      exitRadius = enterRadius * 1.25,
      currentlyVisible,
      excludeId,
    } = options;

    if (!Number.isFinite(enterRadius) || enterRadius < 0 || !Number.isFinite(exitRadius) || exitRadius < enterRadius) {
      throw new RangeError('exitRadius must be >= enterRadius >= 0');
    }

    const exitSq = exitRadius * exitRadius;
    const visible = new Set<T>();
    const entered: T[] = [];
    const exited: T[] = [];

    if (currentlyVisible) {
      for (const id of currentlyVisible) {
        if (id === excludeId) continue;
        const entry = this.entities.get(id);
        if (!entry) {
          exited.push(id);
          continue;
        }
        const dx = entry.x - x;
        const dy = entry.y - y;
        if (dx * dx + dy * dy <= exitSq) {
          visible.add(id);
        } else {
          exited.push(id);
        }
      }
    }

    const candidates = this.queryRadius(x, y, enterRadius);
    for (const id of candidates) {
      if (id === excludeId || visible.has(id)) continue;
      visible.add(id);
      entered.push(id);
    }

    return { entered, exited, visible };
  }
}

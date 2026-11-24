import { guardNavigationWork, reversePath } from './internal/path-work.js';

/**
 * @typedef {object} HeapNode
 * @property {number} id Cell id (y * width + x).
 * @property {number} x
 * @property {number} y
 * @property {number} f A* priority (g + heuristic).
 * @property {number} seq Insertion sequence for stable tie-breaking.
 */

/** @typedef {HeapNode & {g: number, heapIndex: number, parent: SearchNode | null}} SearchNode */

class MinHeap {
  constructor() {
    /** @type {SearchNode[]} */
    this.items = [];
  }
  /** @returns {number} */
  get size() { return this.items.length; }
  /** @param {SearchNode} node @returns {void} */
  push(node) {
    node.heapIndex = this.items.length;
    this.items.push(node);
    this.moveUp(node);
  }
  /** @param {SearchNode} node */
  moveUp(node) {
    const items = this.items;
    let index = node.heapIndex;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const pNode = items[parent];
      if (node.f > pNode.f || (node.f === pNode.f && node.seq >= pNode.seq)) break;
      items[index] = pNode;
      pNode.heapIndex = index;
      index = parent;
    }
    items[index] = node;
    node.heapIndex = index;
  }
  /** @returns {SearchNode} */
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    top.heapIndex = -1;
    if (items.length > 0 && last) {
      let index = 0;
      const half = items.length >> 1;
      while (index < half) {
        let best = (index << 1) + 1;
        const right = best + 1;
        if (right < items.length) {
          const rNode = items[right], lNode = items[best];
          if (rNode.f < lNode.f || (rNode.f === lNode.f && rNode.seq < lNode.seq)) best = right;
        }
        const bNode = items[best];
        if (last.f < bNode.f || (last.f === bNode.f && last.seq <= bNode.seq)) break;
        items[index] = bNode;
        bNode.heapIndex = index;
        index = best;
      }
      items[index] = last;
      last.heapIndex = index;
    }
    return top;
  }
}

// Keep common repeated searches allocation-light without keeping the
// working set of an unusually large search alive for the map's lifetime.
const RETAINED_PATH_NODES = 8192;
class GridSearchWorkspace {
  constructor() {
    /** @type {Map<number, SearchNode>} */
    this.byId = new Map();
    /** @type {SearchNode[]} */
    this.pool = [];
    this.open = new MinHeap();
    this.inUse = false;
  }

  /** @param {number} id @param {number} x @param {number} y @param {number} g @param {number} f @param {number} seq @param {SearchNode | null} parent */
  add(id, x, y, g, f, seq, parent) {
    const slot = this.byId.size;
    let node = this.pool[slot];
    if (!node) {
      node = { id, x, y, g, f, seq, heapIndex: -1, parent };
      if (slot < RETAINED_PATH_NODES) this.pool.push(node);
    } else {
      node.id = id; node.x = x; node.y = y;
      node.g = g; node.f = f; node.seq = seq; node.parent = parent;
    }
    this.byId.set(id, node);
    this.open.push(node);
  }

  clear() {
    const used = Math.min(this.byId.size, this.pool.length);
    for (let i = 0; i < used; i++) this.pool[i].parent = null;
    this.byId.clear();
    this.open.items.length = 0;
    this.inUse = false;
  }
}

/** @type {WeakMap<object, GridSearchWorkspace>} */
const gridSearchByMap = new WeakMap();
/** @type {WeakMap<object, number>} */
const navigationRevisions = new WeakMap();

/**
 * @template [T=number]
 * @typedef {object} TileMapOptions
 * @property {T[][]} tiles Rectangular row-major grid (tiles[y][x]); rows are copied.
 * @property {number} [tileWidth=32] Tile width in world units (> 0).
 * @property {number} [tileHeight=32] Tile height in world units (> 0).
 * @property {Iterable<T>} [solid=[]] Tile values that block movement.
 */

/**
 * Minimal frame-lookup contract used by TileMap#draw (e.g. a SpriteSheet).
 * @typedef {object} TileSheetLike
 * @property {CanvasImageSource | null} [image] Source image for the sheet.
 * @property {(index: number) => { x: number, y: number, width: number, height: number }} frame Returns the source rectangle (pixels) of a frame index.
 */

/**
 * World-space visible rectangle used for culling.
 * @typedef {object} TileViewBounds
 * @property {number} minX
 * @property {number} minY
 * @property {number} maxX
 * @property {number} maxY
 */

/**
 * @template [T=number]
 * @typedef {object} TileMapDrawOptions
 * @property {Record<string, string>} [palette={}] Fill style per tile value (flat-colour fallback).
 * @property {number} [originX=0] World X of the map's top-left corner.
 * @property {number} [originY=0] World Y of the map's top-left corner.
 * @property {TileSheetLike | null} [sheet=null] Sprite sheet providing tile frames.
 * @property {CanvasImageSource | null} [image=null] Override image; defaults to sheet.image.
 * @property {Record<string, number | null | undefined> | null} [tileFrames=null] Tile value to frame index; when omitted, non-negative integer tile values are used as frame indices.
 * @property {TileViewBounds | null} [viewBounds=null] Cull to this world-space rectangle.
 */

/**
 * A grid cell coordinate.
 * @typedef {object} TileCoord
 * @property {number} x Column.
 * @property {number} y Row.
 */

/**
 * Compact map grid with an explicit solid-tile palette and optional tileset/culling support.
 * @template [T=number]
 */
export class TileMap {
  /** @param {TileMapOptions<T>} [options] */
  constructor({ tiles, tileWidth = 32, tileHeight = 32, solid = [] } = {}) {
    if (!Array.isArray(tiles) || !tiles.length || !Array.isArray(tiles[0])) throw new TypeError('tiles must be a rectangular 2D array');
    const width = tiles[0].length;
    if (width < 1 || tiles.some(row => !Array.isArray(row) || row.length !== width)) throw new Error('tile rows must be rectangular');
    if (!(tileWidth > 0 && tileHeight > 0)) throw new RangeError('tile dimensions must be > 0');
    /** Row-major tile values (tiles[y][x]). @type {T[][]} */
    this.tiles = tiles.map(row => [...row]);
    /** Columns. @type {number} */
    this.width = width;
    /** Rows. @type {number} */
    this.height = tiles.length;
    /** Tile width in world units. @type {number} */
    this.tileWidth = tileWidth;
    /** Tile height in world units. @type {number} */
    this.tileHeight = tileHeight;
    /** Tile values that block movement. @type {Set<T>} */
    this.solid = new Set(solid);
  }
  /**
   * True when (x, y) is an integer cell inside the grid.
   * @param {number} x Column.
   * @param {number} y Row.
   * @returns {boolean}
   */
  within(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height && Number.isInteger(x) && Number.isInteger(y); }
  /**
   * Tile value at a cell, or undefined outside the grid.
   * @param {number} x Column.
   * @param {number} y Row.
   * @returns {T | undefined}
   */
  get(x, y) { return this.within(x, y) ? this.tiles[y][x] : undefined; }
  /**
   * Replace a tile; throws RangeError outside the grid.
   * @param {number} x Column.
   * @param {number} y Row.
   * @param {T} value
   * @returns {void}
   */
  set(x, y, value) {
    if (!this.within(x, y)) throw new RangeError('Tile outside map');
    if (!Object.is(this.tiles[y][x], value)) this.invalidateNavigation();
    this.tiles[y][x] = value;
  }
  /** Invalidate sliced searches after editing tile rows or the solid palette directly. */
  invalidateNavigation() {
    navigationRevisions.set(this, (navigationRevisions.get(this) ?? 0) + 1);
  }
  /**
   * Solid test; out-of-bounds cells count as solid.
   * @param {number} x Column.
   * @param {number} y Row.
   * @returns {boolean}
   */
  isSolid(x, y) { return !this.within(x, y) || this.solid.has(this.get(x, y)); }
  /**
   * Convert a world position to the containing cell.
   * @param {number} x World X relative to the map origin.
   * @param {number} y World Y relative to the map origin.
   * @param {TileCoord} [out] Optional reusable result.
   * @returns {TileCoord}
   */
  worldToTile(x, y, out = { x: 0, y: 0 }) {
    out.x = Math.floor(x / this.tileWidth); out.y = Math.floor(y / this.tileHeight);
    return out;
  }
  /**
   * World-space centre of a cell.
   * @param {number} x Column.
   * @param {number} y Row.
   * @returns {{ x: number, y: number }}
   */
  tileToWorld(x, y) { return { x: (x + 0.5) * this.tileWidth, y: (y + 0.5) * this.tileHeight }; }
  /**
   * Draw visible tiles with a sprite sheet or flat palette colours.
   * @param {CanvasRenderingContext2D} ctx
   * @param {TileMapDrawOptions<T>} [options]
   * @returns {void}
   */
  draw(ctx, { palette = {}, originX = 0, originY = 0, sheet = null, image = null, tileFrames = null, viewBounds = null } = {}) {
    const startX = viewBounds ? Math.max(0, Math.floor((viewBounds.minX - originX) / this.tileWidth)) : 0;
    const endX = viewBounds ? Math.min(this.width - 1, Math.floor((viewBounds.maxX - originX) / this.tileWidth)) : this.width - 1;
    const startY = viewBounds ? Math.max(0, Math.floor((viewBounds.minY - originY) / this.tileHeight)) : 0;
    const endY = viewBounds ? Math.min(this.height - 1, Math.floor((viewBounds.maxY - originY) / this.tileHeight)) : this.height - 1;
    if (startX > endX || startY > endY) return;

    const tileImage = image ?? sheet?.image ?? null;
    for (let y = startY; y <= endY; y++) {
      const dy = originY + y * this.tileHeight;
      const row = this.tiles[y];
      for (let x = startX; x <= endX; x++) {
        const type = row[x];
        const dx = originX + x * this.tileWidth;
        if (sheet && tileImage) {
          const frameIndex = tileFrames ? tileFrames[/** @type {any} */ (type)] : (Number.isInteger(type) && type >= 0 ? type : undefined);
          if (frameIndex !== undefined && frameIndex !== null) {
            const rect = sheet.frame(frameIndex);
            ctx.drawImage(tileImage, rect.x, rect.y, rect.width, rect.height, dx, dy, this.tileWidth, this.tileHeight);
            continue;
          }
        }
        const paint = palette[/** @type {any} */ (type)];
        if (!paint) continue;
        ctx.fillStyle = paint;
        ctx.fillRect(dx, dy, this.tileWidth, this.tileHeight);
      }
    }
  }
}

const DIRS_4 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
const DIRS_8 = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function octile(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return ax < ay ? (Math.SQRT2 - 1) * ax + ay : (Math.SQRT2 - 1) * ay + ax;
}

/**
 * @typedef {object} FindGridPathOptions
 * @property {number} [maxNodes=20000] Maximum expanded nodes before giving up (returns []).
 * @property {boolean} [allowDiagonal=false] Allow 8-way movement (octile heuristic).
 * @property {boolean} [preventCornerCutting=true] Disallow diagonal steps past solid orthogonal neighbours.
 */

/**
 * O(N log N) A* over a TileMap, with optional diagonal movement and corner-cutting guard.
 * @template [T=number]
 * @param {TileMap<T>} map
 * @param {TileCoord} start Start cell.
 * @param {TileCoord} goal Goal cell.
 * @param {FindGridPathOptions} [options]
 * @returns {TileCoord[]} Cells from start to goal inclusive, or [] when blocked/unreachable.
 */
export function findGridPath(map, start, goal, {
  maxNodes = 20000,
  allowDiagonal = false,
  preventCornerCutting = true,
} = {}) {
  const sx = start.x, sy = start.y, gx = goal.x, gy = goal.y;
  if (map.isSolid(sx, sy) || map.isSolid(gx, gy)) return [];
  let workspace = gridSearchByMap.get(map);
  if (!workspace) {
    workspace = new GridSearchWorkspace();
    gridSearchByMap.set(map, workspace);
  } else if (workspace.inUse) {
    // Custom isSolid implementations can call back into pathfinding.
    workspace = new GridSearchWorkspace();
  }
  workspace.inUse = true;
  try {
    return searchGridPath(map, workspace, sx, sy, gx, gy, maxNodes, allowDiagonal, preventCornerCutting, false).next().value;
  } finally {
    workspace.clear();
  }
}

/**
 * Create a budgetable A* search over the current map revision.
 * @template [T=number]
 * @param {TileMap<T>} map
 * @param {TileCoord} start
 * @param {TileCoord} goal
 * @param {FindGridPathOptions} [options]
 * @returns {Generator<undefined, TileCoord[], void>}
 */
export function createGridPathWork(map, start, goal, {
  maxNodes = 20000,
  allowDiagonal = false,
  preventCornerCutting = true,
} = {}) {
  const sx = start.x, sy = start.y, gx = goal.x, gy = goal.y;
  const revision = navigationRevisions.get(map);
  function* work() {
    if (map.isSolid(sx, sy) || map.isSolid(gx, gy)) return [];
    return yield* searchGridPath(map, new GridSearchWorkspace(), sx, sy, gx, gy, maxNodes, allowDiagonal, preventCornerCutting, true);
  }
  return guardNavigationWork(work(), () => navigationRevisions.get(map) === revision);
}

function* searchGridPath(map, workspace, sx, sy, gx, gy, maxNodes, allowDiagonal, preventCornerCutting, sliced) {
  const width = map.width;
  const startId = sy * width + sx, goalId = gy * width + gx;
  const { byId, open } = workspace;
  let seq = 0;
  const heuristic = allowDiagonal
    ? (x, y) => octile(x - gx, y - gy)
    : (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  workspace.add(startId, sx, sy, 0, heuristic(sx, sy), seq++, null);
  const dirs = allowDiagonal ? DIRS_8 : DIRS_4;
  let visited = 0;
  while (open.size && visited++ < maxNodes) {
    if (sliced) yield;
    const current = open.pop();
    if (current.id === goalId) {
      /** @type {TileCoord[]} */
      const result = [];
      /** @type {SearchNode | null} */
      let node = current;
      while (node) {
        if (sliced) yield;
        result.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      if (!sliced) return result.reverse();
      yield* reversePath(result);
      return result;
    }
    for (let i = 0; i < dirs.length; i++) {
      const dx = dirs[i][0], dy = dirs[i][1], stepCost = dirs[i][2];
      const x = current.x + dx, y = current.y + dy;
      if (map.isSolid(x, y)) continue;
      if (dx !== 0 && dy !== 0 && preventCornerCutting &&
          (map.isSolid(current.x + dx, current.y) || map.isSolid(current.x, current.y + dy))) {
        continue;
      }
      const key = y * width + x;
      const node = byId.get(key);
      const cost = current.g + stepCost;
      if (!node) {
        workspace.add(key, x, y, cost, cost + heuristic(x, y), seq++, current);
      } else if (node.heapIndex >= 0 && cost < node.g) {
        node.g = cost;
        node.parent = current;
        const priority = cost + heuristic(x, y);
        if (priority < node.f) {
          node.f = priority;
          node.seq = seq++;
          open.moveUp(node);
        }
      }
    }
  }
  return [];
}

/**
 * Resolve Auto-Tiling rule bitmasks across a `TileMap` so connected floor/wall/platform tiles
 * automatically pick edge, corner, and inner fill variants without manual per-cell painting.
 *
 * Neighbor bits:
 * - Cardinal (4-way): N=1, E=2, S=4, W=8
 * - 8-way optional bits: NE=16, SE=32, SW=64, NW=128 (or fallback to `mask4` when no 8-way rule matches).
 *
 * @template T
 * @param {TileMap<T>} tileMap
 * @param {object} options
 * @param {T | T[]} options.sourceTile Tile value(s) to evaluate and replace.
 * @param {Record<number, T> | Map<number, T>} options.rules Bitmask-to-tile lookup table.
 * @param {T} [options.defaultTile] Fallback tile ID when a mask has no entry in `rules`.
 * @param {'4-way' | '8-way'} [options.mode='4-way']
 * @param {boolean} [options.treatBorderAsMatched=true] Whether outside-map neighbors count as matching.
 * @returns {number} Count of modified cells.
 */
export function applyAutoTileRules(tileMap, {
  sourceTile,
  rules,
  defaultTile = undefined,
  mode = '4-way',
  treatBorderAsMatched = true,
} = {}) {
  if (!(tileMap instanceof TileMap)) throw new TypeError('applyAutoTileRules requires a TileMap instance');
  if (!rules) throw new TypeError('applyAutoTileRules requires a rules map or object');
  const sourceSet = new Set(Array.isArray(sourceTile) ? sourceTile : [sourceTile]);
  const snapshot = tileMap.tiles.map(row => [...row]);
  const w = tileMap.width;
  const h = tileMap.height;
  const use8 = mode === '8-way';
  const lookup = rules instanceof Map
    ? mask => (rules.has(mask) ? rules.get(mask) : undefined)
    : mask => (Object.prototype.hasOwnProperty.call(rules, mask) ? rules[mask] : undefined);

  const isMatch = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return Boolean(treatBorderAsMatched);
    return sourceSet.has(snapshot[y][x]);
  };

  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const current = snapshot[y][x];
      if (!sourceSet.has(current)) continue;
      const n = isMatch(x, y - 1);
      const e = isMatch(x + 1, y);
      const s = isMatch(x, y + 1);
      const wSide = isMatch(x - 1, y);
      let mask4 = 0;
      if (n) mask4 |= 1;
      if (e) mask4 |= 2;
      if (s) mask4 |= 4;
      if (wSide) mask4 |= 8;

      let resolved;
      if (use8) {
        let mask8 = mask4;
        if (n && e && isMatch(x + 1, y - 1)) mask8 |= 16;
        if (e && s && isMatch(x + 1, y + 1)) mask8 |= 32;
        if (s && wSide && isMatch(x - 1, y + 1)) mask8 |= 64;
        if (wSide && n && isMatch(x - 1, y - 1)) mask8 |= 128;
        resolved = lookup(mask8);
        if (resolved === undefined) resolved = lookup(mask4);
      } else {
        resolved = lookup(mask4);
      }
      if (resolved === undefined) resolved = defaultTile !== undefined ? defaultTile : current;
      if (!Object.is(resolved, tileMap.get(x, y))) {
        tileMap.set(x, y, resolved);
        changed++;
      }
    }
  }
  return changed;
}

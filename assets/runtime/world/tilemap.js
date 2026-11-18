/**
 * @typedef {object} HeapNode
 * @property {number} id Cell id (y * width + x).
 * @property {number} x
 * @property {number} y
 * @property {number} f A* priority (g + heuristic).
 * @property {number} seq Insertion sequence for stable tie-breaking.
 */

class MinHeap {
  constructor() {
    /** @type {HeapNode[]} */
    this.items = [];
  }
  /** @returns {number} */
  get size() { return this.items.length; }
  /** @param {HeapNode} node @returns {void} */
  push(node) {
    const items = this.items;
    let index = items.length;
    items.push(node);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const pNode = items[parent];
      if (node.f > pNode.f || (node.f === pNode.f && node.seq >= pNode.seq)) break;
      items[index] = pNode;
      index = parent;
    }
    items[index] = node;
  }
  /** @returns {HeapNode} */
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
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
        index = best;
      }
      items[index] = last;
    }
    return top;
  }
}

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
    this.tiles[y][x] = value;
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
  const width = map.width;
  const id = (x, y) => y * width + x;
  const startId = id(sx, sy), goalId = id(gx, gy);
  /** @type {Map<number, number>} */
  const g = new Map([[startId, 0]]);
  /** @type {Map<number, number>} */
  const prev = new Map();
  const open = new MinHeap();
  let seq = 0;
  const heuristic = allowDiagonal
    ? (x, y) => octile(x - gx, y - gy)
    : (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  open.push({ id: startId, x: sx, y: sy, f: heuristic(sx, sy), seq: seq++ });
  const closed = new Set();
  const dirs = allowDiagonal ? DIRS_8 : DIRS_4;
  let visited = 0;
  while (open.size && visited++ < maxNodes) {
    const current = open.pop();
    if (closed.has(current.id)) continue;
    if (current.id === goalId) {
      /** @type {TileCoord[]} */
      const result = [];
      /** @type {number | undefined} */
      let key = goalId;
      while (key !== undefined) {
        result.push({ x: key % width, y: Math.floor(key / width) });
        key = prev.get(key);
      }
      return result.reverse();
    }
    closed.add(current.id);
    const currentG = /** @type {number} */ (g.get(current.id));
    for (let i = 0; i < dirs.length; i++) {
      const dx = dirs[i][0], dy = dirs[i][1], stepCost = dirs[i][2];
      const x = current.x + dx, y = current.y + dy;
      if (map.isSolid(x, y)) continue;
      if (dx !== 0 && dy !== 0 && preventCornerCutting &&
          (map.isSolid(current.x + dx, current.y) || map.isSolid(current.x, current.y + dy))) {
        continue;
      }
      const key = id(x, y);
      if (closed.has(key)) continue;
      const cost = currentG + stepCost;
      if (cost >= (g.get(key) ?? Infinity)) continue;
      g.set(key, cost);
      prev.set(key, current.id);
      open.push({ id: key, x, y, f: cost + heuristic(x, y), seq: seq++ });
    }
  }
  return [];
}

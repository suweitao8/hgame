/** Compact map grid with an explicit solid-tile palette. */
export class TileMap {
  constructor({ tiles, tileWidth = 32, tileHeight = 32, solid = [] } = {}) {
    if (!Array.isArray(tiles) || !tiles.length || !Array.isArray(tiles[0])) throw new TypeError('tiles must be a rectangular 2D array');
    const width = tiles[0].length;
    if (width < 1 || tiles.some(row => !Array.isArray(row) || row.length !== width)) throw new Error('tile rows must be rectangular');
    if (!(tileWidth > 0 && tileHeight > 0)) throw new RangeError('tile dimensions must be > 0');
    this.tiles = tiles.map(row => [...row]);
    this.width = width;
    this.height = tiles.length;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
    this.solid = new Set(solid);
  }
  within(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height && Number.isInteger(x) && Number.isInteger(y); }
  get(x, y) { return this.within(x, y) ? this.tiles[y][x] : undefined; }
  set(x, y, value) {
    if (!this.within(x, y)) throw new RangeError('Tile outside map');
    this.tiles[y][x] = value;
  }
  isSolid(x, y) { return !this.within(x, y) || this.solid.has(this.get(x, y)); }
  worldToTile(x, y) { return { x: Math.floor(x / this.tileWidth), y: Math.floor(y / this.tileHeight) }; }
  tileToWorld(x, y) { return { x: (x + 0.5) * this.tileWidth, y: (y + 0.5) * this.tileHeight }; }
  draw(ctx, { palette = {}, originX = 0, originY = 0 } = {}) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const type = this.tiles[y][x];
        const paint = palette[type];
        if (!paint) continue;
        ctx.fillStyle = paint;
        ctx.fillRect(originX + x * this.tileWidth, originY + y * this.tileHeight, this.tileWidth, this.tileHeight);
      }
    }
  }
}

/** Four-direction A* over a TileMap, with capped work to avoid runaway AI. */
export function findGridPath(map, start, goal, { maxNodes = 20000 } = {}) {
  const sx = start.x, sy = start.y, gx = goal.x, gy = goal.y;
  if (map.isSolid(sx, sy) || map.isSolid(gx, gy)) return [];
  const width = map.width;
  const id = (x, y) => y * width + x;
  const startId = id(sx, sy), goalId = id(gx, gy);
  const g = new Map([[startId, 0]]);
  const prev = new Map();
  const open = [{ id: startId, x: sx, y: sy, f: Math.abs(sx - gx) + Math.abs(sy - gy) }];
  const closed = new Set();
  let visited = 0;
  while (open.length && visited++ < maxNodes) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    if (closed.has(current.id)) continue;
    if (current.id === goalId) {
      const result = [];
      let key = goalId;
      while (key !== undefined) {
        result.push({ x: key % width, y: Math.floor(key / width) });
        key = prev.get(key);
      }
      return result.reverse();
    }
    closed.add(current.id);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, y = current.y + dy;
      if (map.isSolid(x, y)) continue;
      const key = id(x, y);
      if (closed.has(key)) continue;
      const cost = g.get(current.id) + 1;
      if (cost >= (g.get(key) ?? Infinity)) continue;
      g.set(key, cost);
      prev.set(key, current.id);
      open.push({ id: key, x, y, f: cost + Math.abs(x - gx) + Math.abs(y - gy) });
    }
  }
  return [];
}

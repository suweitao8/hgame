import { Container, Particle, ParticleContainer } from 'pixi.js';

/** Draw an HGame TileMap from frames already baked into the renderer's atlas. */
export class PixiTilemapLayer {
  constructor(renderer, map, { frames, layer = 'background', chunkSize = 32, maxCachedChunks = 128, originX = 0, originY = 0 } = {}) {
    if (!renderer?.bgLayer || !renderer?.atlas?.textures) throw new TypeError('Initialize Renderer2D before creating a tilemap layer');
    if (!map || typeof map.get !== 'function' || !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
        map.width < 1 || map.height < 1 || !Number.isFinite(map.tileWidth) || !Number.isFinite(map.tileHeight) || !(map.tileWidth > 0) || !(map.tileHeight > 0)) {
      throw new TypeError('A rectangular HGame TileMap with positive tile dimensions is required');
    }
    if (!frames || typeof frames !== 'object' || Array.isArray(frames)) throw new TypeError('frames must map tile values to atlas frame names');
    if (layer !== 'background' && layer !== 'foreground') throw new RangeError('Tilemap layer must be background or foreground');
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 128) throw new RangeError('chunkSize must be an integer from 1 to 128');
    if (!Number.isInteger(maxCachedChunks) || maxCachedChunks < 1 || maxCachedChunks > 4096) throw new RangeError('maxCachedChunks must be an integer from 1 to 4096');
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) throw new RangeError('Tilemap origin must be finite');
    this.renderer = renderer; this.map = map; this.frames = new Map();
    for (const [value, name] of Object.entries(frames)) {
      if (name == null) continue;
      const texture = renderer.atlas.textures.get(name);
      if (!texture) throw new Error('Unknown tilemap atlas frame: ' + name);
      this.frames.set(value, texture);
    }
    this.chunkSize = chunkSize; this.maxCachedChunks = maxCachedChunks; this.originX = originX; this.originY = originY;
    this.cols = Math.ceil(map.width / chunkSize); this.rows = Math.ceil(map.height / chunkSize);
    this.root = new Container(); this.root.eventMode = 'none'; this.root.interactiveChildren = false;
    this.chunks = new Map(); this.visibleRange = null; this.disposed = false;
    try {
      (layer === 'foreground' ? renderer.foregroundLayer : renderer.bgLayer).addChild(this.root);
      this.update();
    } catch (error) {
      this.root.destroy({ children: true });
      throw error;
    }
  }
  buildChunk(cx, cy) {
    const index = cy * this.cols + cx;
    const x0 = cx * this.chunkSize, y0 = cy * this.chunkSize;
    const x1 = Math.min(this.map.width, x0 + this.chunkSize), y1 = Math.min(this.map.height, y0 + this.chunkSize);
    const view = new ParticleContainer({ dynamicProperties: { position: false, vertex: false, uvs: false, rotation: false, color: false } });
    const record = { view, x0, y0, x1, y1, cells: new Array((x1 - x0) * (y1 - y0)).fill(null) };
    this.chunks.set(index, record);
    this.root.addChild(view);
    this.refreshChunk(record);
    return record;
  }

  // 0 = unchanged, 1 = static attributes changed, 2 = membership changed.
  updateCell(record, x, y) {
    const cell = (y - record.y0) * (record.x1 - record.x0) + x - record.x0;
    const current = record.cells[cell];
    const texture = this.frames.get(String(this.map.get(x, y)));
    if (!texture) {
      if (!current) return 0;
      record.cells[cell] = null;
      return 2;
    }
    const particleX = this.originX + x * this.map.tileWidth;
    const particleY = this.originY + y * this.map.tileHeight;
    const scaleX = this.map.tileWidth / texture.orig.width;
    const scaleY = this.map.tileHeight / texture.orig.height;
    if (current && current.texture === texture && current.x === particleX && current.y === particleY &&
        current.scaleX === scaleX && current.scaleY === scaleY) return 0;
    const particle = current ?? new Particle({ texture });
    particle.texture = texture;
    particle.x = particleX; particle.y = particleY;
    particle.scaleX = scaleX; particle.scaleY = scaleY;
    record.cells[cell] = particle;
    return current ? 1 : 2;
  }

  commitChunkChanges(record, change) {
    if (change === 2) {
      const particles = record.view.particleChildren;
      particles.length = 0;
      for (const particle of record.cells) if (particle) particles.push(particle);
    }
    if (change > 0) record.view.update();
  }

  refreshChunk(record) {
    let change = 0;
    for (let y = record.y0; y < record.y1; y++) for (let x = record.x0; x < record.x1; x++) {
      change = Math.max(change, this.updateCell(record, x, y));
    }
    this.commitChunkChanges(record, change);
  }

  cachedChunkAt(x, y) {
    return this.chunks.get(Math.floor(y / this.chunkSize) * this.cols + Math.floor(x / this.chunkSize));
  }
  /** Refresh the chunk containing a tile after map.set(x, y, value). */
  refreshTile(x, y) {
    if (this.disposed) throw new Error('Tilemap layer is disposed');
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) throw new RangeError('Tile is outside the map');
    const record = this.cachedChunkAt(x, y);
    if (record) this.refreshChunk(record);
  }
  /** Update gameplay data and its cached visual chunk together. */
  setTile(x, y, value) {
    if (this.disposed) throw new Error('Tilemap layer is disposed');
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) throw new RangeError('Tile is outside the map');
    if (typeof this.map.set !== 'function') throw new TypeError('Tilemap must support set');
    if (Object.is(this.map.get(x, y), value)) return;
    this.map.set(x, y, value);
    const record = this.cachedChunkAt(x, y);
    if (record) this.commitChunkChanges(record, this.updateCell(record, x, y));
  }
  /** Apply edits and refresh each affected particle container at most once. */
  setTiles(edits) {
    if (this.disposed) throw new Error('Tilemap layer is disposed');
    if (!Array.isArray(edits)) throw new TypeError('Tile edits must be an array');
    if (typeof this.map.set !== 'function') throw new TypeError('Tilemap must support set');
    for (const edit of edits) {
      if (!edit || !Object.hasOwn(edit, 'value') || !Number.isInteger(edit.x) || !Number.isInteger(edit.y) ||
          edit.x < 0 || edit.y < 0 || edit.x >= this.map.width || edit.y >= this.map.height) throw new RangeError('Each tile edit needs an in-bounds x, y, and value');
    }
    const changed = new Map();
    try {
      for (const { x, y, value } of edits) {
        if (Object.is(this.map.get(x, y), value)) continue;
        this.map.set(x, y, value);
        const record = this.cachedChunkAt(x, y);
        if (!record) continue;
        const change = this.updateCell(record, x, y);
        if (change > 0) changed.set(record, Math.max(change, changed.get(record) ?? 0));
      }
    } finally {
      for (const [record, change] of changed) this.commitChunkChanges(record, change);
    }
  }
  update() {
    if (this.disposed) return;
    const camera = this.renderer.camera, screen = this.renderer.app.screen, zoom = camera.zoom;
    if (!(zoom > 0) || !Number.isFinite(zoom)) throw new RangeError('Camera zoom must be finite and positive');
    const left = camera.x + (-screen.width / 2 - camera.shakeX) / zoom;
    const right = camera.x + (screen.width / 2 - camera.shakeX) / zoom;
    const top = camera.y + (-screen.height / 2 - camera.shakeY) / zoom;
    const bottom = camera.y + (screen.height / 2 - camera.shakeY) / zoom;
    const cw = this.chunkSize * this.map.tileWidth, ch = this.chunkSize * this.map.tileHeight;
    const x0 = Math.max(0, Math.ceil((left - this.originX) / cw) - 1);
    const x1 = Math.min(this.cols - 1, Math.floor((right - this.originX) / cw));
    const y0 = Math.max(0, Math.ceil((top - this.originY) / ch) - 1);
    const y1 = Math.min(this.rows - 1, Math.floor((bottom - this.originY) / ch));
    const previous = this.visibleRange;
    if (previous && previous.x0 === x0 && previous.x1 === x1 && previous.y0 === y0 && previous.y1 === y1) return;
    if (previous) {
      for (let y = previous.y0; y <= previous.y1; y++) for (let x = previous.x0; x <= previous.x1; x++) {
        if (x < x0 || x > x1 || y < y0 || y > y1) {
          this.chunks.get(y * this.cols + x).view.visible = false;
        }
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = y * this.cols + x;
      const record = this.chunks.get(key) ?? this.buildChunk(x, y);
      record.view.visible = true;
      // Map iteration order places all visible chunks after the unseen ones.
      this.chunks.delete(key);
      this.chunks.set(key, record);
    }
    for (const [key, record] of this.chunks) {
      if (this.chunks.size <= this.maxCachedChunks || record.view.visible) break;
      record.view.removeFromParent(); record.view.destroy(); this.chunks.delete(key);
    }
    this.visibleRange = { x0, x1, y0, y1 };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.root.removeFromParent(); this.root.destroy({ children: true });
    this.chunks.clear(); this.visibleRange = null; this.renderer.tilemapLayers.delete(this);
  }
}

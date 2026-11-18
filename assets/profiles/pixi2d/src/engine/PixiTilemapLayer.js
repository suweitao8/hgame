import { Container, Particle, ParticleContainer } from 'pixi.js';

/** Draw an HGame TileMap from frames already baked into the renderer's atlas. */
export class PixiTilemapLayer {
  constructor(renderer, map, { frames, chunkSize = 32, originX = 0, originY = 0 } = {}) {
    if (!renderer?.bgLayer || !renderer?.atlas?.textures) throw new TypeError('Initialize Renderer2D before creating a tilemap layer');
    if (!map || typeof map.get !== 'function' || !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
        map.width < 1 || map.height < 1 || !(map.tileWidth > 0) || !(map.tileHeight > 0)) {
      throw new TypeError('A rectangular HGame TileMap with positive tile dimensions is required');
    }
    if (!frames || typeof frames !== 'object' || Array.isArray(frames)) throw new TypeError('frames must map tile values to atlas frame names');
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 128) throw new RangeError('chunkSize must be an integer from 1 to 128');
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) throw new RangeError('Tilemap origin must be finite');
    this.renderer = renderer; this.map = map; this.frames = new Map();
    for (const [value, name] of Object.entries(frames)) {
      if (name == null) continue;
      const texture = renderer.atlas.textures.get(name);
      if (!texture) throw new Error('Unknown tilemap atlas frame: ' + name);
      this.frames.set(value, texture);
    }
    this.chunkSize = chunkSize; this.originX = originX; this.originY = originY;
    this.cols = Math.ceil(map.width / chunkSize); this.rows = Math.ceil(map.height / chunkSize);
    this.root = new Container(); this.root.eventMode = 'none'; this.root.interactiveChildren = false;
    this.chunks = new Array(this.cols * this.rows); this.disposed = false;
    try {
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) this.buildChunk(x, y);
      renderer.bgLayer.addChild(this.root);
      this.update();
    } catch (error) {
      this.root.destroy({ children: true });
      throw error;
    }
  }
  buildChunk(cx, cy) {
    const index = cy * this.cols + cx;
    let chunk = this.chunks[index];
    if (!chunk) {
      chunk = new ParticleContainer({ dynamicProperties: { position: false, vertex: false, uvs: false, rotation: false, color: false } });
      this.chunks[index] = chunk; this.root.addChild(chunk);
    } else chunk.removeParticles();
    const x0 = cx * this.chunkSize, y0 = cy * this.chunkSize;
    const x1 = Math.min(this.map.width, x0 + this.chunkSize), y1 = Math.min(this.map.height, y0 + this.chunkSize);
    const pending = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const texture = this.frames.get(String(this.map.get(x, y)));
      if (!texture) continue;
      const particle = new Particle({ texture, x: this.originX + x * this.map.tileWidth, y: this.originY + y * this.map.tileHeight });
      particle.scaleX = this.map.tileWidth / texture.orig.width;
      particle.scaleY = this.map.tileHeight / texture.orig.height;
      pending.push(particle);
      if (pending.length === 4096) { chunk.addParticle(...pending); pending.length = 0; }
    }
    if (pending.length) chunk.addParticle(...pending);
  }
  /** Refresh the chunk containing a tile after map.set(x, y, value). */
  refreshTile(x, y) {
    if (this.disposed) throw new Error('Tilemap layer is disposed');
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) throw new RangeError('Tile is outside the map');
    this.buildChunk(Math.floor(x / this.chunkSize), Math.floor(y / this.chunkSize));
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
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const x0 = this.originX + x * cw, y0 = this.originY + y * ch;
      this.chunks[y * this.cols + x].visible = !(x0 + cw < left || x0 > right || y0 + ch < top || y0 > bottom);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.root.removeFromParent(); this.root.destroy({ children: true });
    this.chunks.length = 0; this.renderer.tilemapLayers.delete(this);
  }
}

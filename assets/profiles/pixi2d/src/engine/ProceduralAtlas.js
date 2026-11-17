import { CanvasSource, Rectangle, Texture } from 'pixi.js';

export class ProceduralAtlas {
  constructor(size = 1024) {
    if (!Number.isInteger(size) || size < 8) throw new RangeError('Atlas size must be an integer of at least 8 pixels');
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.x = this.y = 2;
    this.rowHeight = 0;
    this.frames = new Map();
    this.textures = new Map();
    this.source = null;
  }

  register(name, width, height, draw, { makeWhite = true } = {}) {
    if (typeof name !== 'string' || !name || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || typeof draw !== 'function') {
      throw new TypeError('Atlas frames require a name, positive integer dimensions and a draw function');
    }
    if (this.frames.has(name + '_white')) throw new Error('Invalid or duplicate atlas frame: ' + name);
    this.checkCapacity([{ name, width, height }, ...(makeWhite ? [{ name: name + '_white', width, height }] : [])]);
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d');
    draw(ctx, width, height);
    this.pack(name, scratch);
    if (makeWhite) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      this.pack(name + '_white', scratch);
    }
  }

  /** Reserve-check before writing so overflow or name collisions do not leave partial frames. */
  checkCapacity(items) {
    if (this.source) throw new Error('Cannot add frames to a built atlas');
    let x = this.x, y = this.y, rowHeight = this.rowHeight;
    const names = new Set();
    for (const { name, width, height } of items) {
      if (typeof name !== 'string' || !name || names.has(name) || this.frames.has(name)) throw new Error('Invalid or duplicate atlas frame: ' + name);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError('Atlas dimensions must be positive integers');
      names.add(name);
      if (width + 4 > this.size || height + 4 > this.size) throw new RangeError('Atlas frame too large: ' + name);
      if (x + width + 2 > this.size) { x = 2; y += rowHeight + 4; rowHeight = 0; }
      if (y + height + 2 > this.size) throw new RangeError('Procedural atlas is full');
      x += width + 4; rowHeight = Math.max(rowHeight, height);
    }
  }

  registerImage(name, image, { width = image?.width, height = image?.height, makeWhite = true } = {}) {
    if (!(image?.width > 0 && image?.height > 0)) throw new TypeError('Atlas image must be decoded and have positive dimensions: ' + name);
    this.register(name, width, height, (ctx, w, h) => {
      const scale = Math.min(w / image.width, h / image.height);
      const dw = image.width * scale, dh = image.height * scale;
      ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }, { makeWhite });
  }

  /** Bake a HGame SpriteSheet as prefix/0, prefix/1, ... and matching white frames. */
  registerSheet(prefix, sheet, { width, height, makeWhite = true } = {}) {
    const image = sheet?.image;
    if (typeof prefix !== 'string' || !prefix || !image || !(image.width > 0 && image.height > 0) ||
        !Number.isSafeInteger(sheet.length) || sheet.length < 1 || typeof sheet.frame !== 'function') {
      throw new TypeError('registerSheet requires a name and a decoded HGame SpriteSheet');
    }
    const frames = [], plan = [];
    for (let index = 0; index < sheet.length; index++) {
      const rect = sheet.frame(index), name = `${prefix}/${index}`;
      if (![rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 ||
          rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > image.width || rect.y + rect.height > image.height) {
        throw new RangeError('SpriteSheet frame is outside the image: ' + name);
      }
      const w = width ?? rect.width, h = height ?? rect.height;
      if (this.frames.has(name + '_white')) throw new Error('Invalid or duplicate atlas frame: ' + name);
      frames.push({ name, rect, width: w, height: h });
      plan.push({ name, width: w, height: h });
      if (makeWhite) plan.push({ name: name + '_white', width: w, height: h });
    }
    this.checkCapacity(plan);
    for (const frame of frames) {
      const r = frame.rect;
      this.register(frame.name, frame.width, frame.height, (ctx, w, h) => {
        ctx.drawImage(image, r.x, r.y, r.width, r.height, 0, 0, w, h);
      }, { makeWhite });
    }
    return frames.map(frame => frame.name);
  }

  pack(name, image) {
    const { width, height } = image;
    if (width + 4 > this.size || height + 4 > this.size) throw new RangeError('Atlas frame too large: ' + name);
    if (this.x + width + 2 > this.size) {
      this.x = 2;
      this.y += this.rowHeight + 4;
      this.rowHeight = 0;
    }
    if (this.y + height + 2 > this.size) throw new RangeError('Procedural atlas is full');
    const x = this.x, y = this.y, ctx = this.ctx;
    ctx.drawImage(image, x, y);
    // Duplicate the outer texels into the existing padding. Linear sampling
    // near a frame boundary then sees that frame's edge rather than empty atlas.
    ctx.drawImage(image, 0, 0, width, 1, x, y - 1, width, 1);
    ctx.drawImage(image, 0, height - 1, width, 1, x, y + height, width, 1);
    ctx.drawImage(image, 0, 0, 1, height, x - 1, y, 1, height);
    ctx.drawImage(image, width - 1, 0, 1, height, x + width, y, 1, height);
    ctx.drawImage(image, 0, 0, 1, 1, x - 1, y - 1, 1, 1);
    ctx.drawImage(image, width - 1, 0, 1, 1, x + width, y - 1, 1, 1);
    ctx.drawImage(image, 0, height - 1, 1, 1, x - 1, y + height, 1, 1);
    ctx.drawImage(image, width - 1, height - 1, 1, 1, x + width, y + height, 1, 1);
    this.frames.set(name, new Rectangle(x, y, width, height));
    this.x += width + 4;
    this.rowHeight = Math.max(this.rowHeight, height);
  }

  build() {
    if (this.source) return this;
    this.source = new CanvasSource({ resource: this.canvas, scaleMode: 'linear' });
    for (const [name, frame] of this.frames) this.textures.set(name, new Texture({ source: this.source, frame }));
    return this;
  }

  get(name) { return this.textures.get(name) ?? Texture.WHITE; }
  dispose() {
    for (const texture of this.textures.values()) texture.destroy();
    this.textures.clear();
    this.source?.destroy();
    this.source = null;
  }
}

export function createDefaultGameAtlas({ playerImage = null, enemyImage = null, eliteImage = enemyImage, extraFrames = [], size = 1024 } = {}) {
  const atlas = new ProceduralAtlas(size);
  const circle = (color, radius = 0.4) => (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const character = image => (ctx, width, height) => {
    if (!(image?.width > 0 && image?.height > 0)) throw new TypeError('Character image must be decoded and have positive dimensions');
    const scale = Math.min(width / image.width, height / image.height);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  };
  atlas.register('player_hero', 64, 64, playerImage ? character(playerImage) : circle('#53eccc'));
  atlas.register('enemy_chaser', 40, 40, enemyImage ? character(enemyImage) : circle('#fa536e'));
  atlas.register('enemy_elite', 56, 56, eliteImage ? character(eliteImage) : circle('#ffad53'));
  atlas.register('bullet_orb', 20, 20, circle('#92faff'));
  atlas.register('particle_soft', 20, 20, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
  atlas.register('particle_spark', 12, 12, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w, h / 2); ctx.lineTo(w / 2, h); ctx.lineTo(0, h / 2); ctx.closePath(); ctx.fill();
  });
  atlas.register('slash_trail', 128, 16, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#ffffff00'); gradient.addColorStop(1, '#ffffffff');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  });
  atlas.register('shadow_oval', 48, 20, (ctx, w, h) => {
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  }, { makeWhite: false });
  atlas.register('ground_grid', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#101b2a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#244256'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, { makeWhite: false });
  for (const frame of extraFrames) {
    if (typeof frame.sheet === 'function') atlas.registerSheet(frame.name, frame.sheet(frame.image), frame);
    else atlas.registerImage(frame.name, frame.image, frame);
  }
  return atlas.build();
}

/** Bake named catalog images into the shared atlas, then release their decoded sources. */
export async function createCatalogGameAtlas(catalog, frames, { size = 1024, signal } = {}) {
  if (!catalog || typeof catalog.openScope !== 'function' || typeof catalog.get !== 'function' || !Array.isArray(frames)) {
    throw new TypeError('A HGame asset catalog and an array of frame definitions are required');
  }
  const names = new Set();
  for (const frame of frames) {
    if (!frame || typeof frame.name !== 'string' || !frame.name || typeof frame.asset !== 'string' || !frame.asset || names.has(frame.name)) {
      throw new TypeError('Each atlas frame needs a unique name and a catalog image ID');
    }
    names.add(frame.name);
    if (frame.sheet !== undefined && typeof frame.sheet !== 'function') throw new TypeError('Atlas sheet must be a function that creates a SpriteSheet');
    if (frame.sheet && ['player_hero', 'enemy_chaser', 'enemy_elite'].includes(frame.name)) throw new TypeError('Sprite sheets require a separate frame prefix');
    if (catalog.get(frame.asset).kind !== 'image') throw new TypeError('Atlas frame must refer to a catalog image: ' + frame.asset);
  }
  const scope = catalog.openScope();
  let atlas;
  try {
    const loaded = [];
    for (let offset = 0; offset < frames.length; offset += 4) {
      signal?.throwIfAborted();
      const batch = frames.slice(offset, offset + 4);
      const results = await Promise.allSettled(batch.map(frame => scope.load(frame.asset, { signal })));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      for (let i = 0; i < batch.length; i++) loaded.push({ ...batch[i], image: results[i].value });
    }
    signal?.throwIfAborted();
    const playerImage = loaded.find(frame => frame.name === 'player_hero')?.image ?? null;
    const enemyImage = loaded.find(frame => frame.name === 'enemy_chaser')?.image ?? null;
    const eliteImage = loaded.find(frame => frame.name === 'enemy_elite')?.image ?? enemyImage;
    const extraFrames = loaded.filter(frame => !['player_hero', 'enemy_chaser', 'enemy_elite'].includes(frame.name));
    atlas = createDefaultGameAtlas({ playerImage, enemyImage, eliteImage, extraFrames, size });
  } catch (error) {
    try { scope.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Atlas creation and asset cleanup failed'); }
    throw error;
  }
  try { scope.dispose(); } catch (error) { atlas.dispose(); throw error; }
  return atlas;
}

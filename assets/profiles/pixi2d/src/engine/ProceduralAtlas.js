import { CanvasSource, Rectangle, Texture } from 'pixi.js';

export class ProceduralAtlas {
  constructor(size = 1024) {
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
    if (this.source || this.frames.has(name) || this.frames.has(name + '_white')) throw new Error('Invalid or duplicate atlas frame: ' + name);
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

  pack(name, image) {
    const { width, height } = image;
    if (width + 4 > this.size || height + 4 > this.size) throw new RangeError('Atlas frame too large: ' + name);
    if (this.x + width + 2 > this.size) {
      this.x = 2;
      this.y += this.rowHeight + 4;
      this.rowHeight = 0;
    }
    if (this.y + height + 2 > this.size) throw new RangeError('Procedural atlas is full');
    this.ctx.drawImage(image, this.x, this.y);
    this.frames.set(name, new Rectangle(this.x, this.y, width, height));
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

export function createDefaultGameAtlas({ playerImage = null, enemyImage = null } = {}) {
  const atlas = new ProceduralAtlas();
  const circle = (color, radius = 0.4) => (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const character = image => (ctx, width, height) => {
    const scale = Math.min(width / image.width, height / image.height);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  };
  atlas.register('player_hero', 64, 64, playerImage ? character(playerImage) : circle('#53eccc'));
  atlas.register('enemy_chaser', 40, 40, enemyImage ? character(enemyImage) : circle('#fa536e'));
  atlas.register('enemy_elite', 56, 56, enemyImage ? character(enemyImage) : circle('#ffad53'));
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
  return atlas.build();
}

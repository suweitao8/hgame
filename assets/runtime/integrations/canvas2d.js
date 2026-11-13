import { Component } from '../core/component.js';

export class Sprite2D extends Component {
  constructor({ shape = 'rect', width = 32, height = 32, color = '#80e2c2', text = '', font = '20px sans-serif', z = 0 } = {}) {
    super();
    this.shape = shape;
    this.width = width; this.height = height;
    this.color = color; this.text = text; this.font = font; this.z = z;
  }
}

/** Optional Canvas renderer; not imported by a 3D or UI-only game. */
export function createCanvas2DAdapter({ canvas, width = 960, height = 540, background = '#101820', pixelRatio = globalThis.devicePixelRatio || 1 } = {}) {
  if (!canvas?.getContext) throw new TypeError('Canvas adapter needs a canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  let viewport = null;
  function resize() {
    const vw = Math.max(1, canvas.clientWidth || width), vh = Math.max(1, canvas.clientHeight || height);
    const dpr = Math.max(1, Math.min(3, pixelRatio));
    const targetW = Math.round(vw * dpr), targetH = Math.round(vh * dpr);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    const scale = Math.min(vw / width, vh / height);
    viewport = { vw, vh, dpr, scale, x: (vw - width * scale) / 2, y: (vh - height * scale) / 2 };
  }
  function paint(entity) {
    if (!entity.active || entity.destroyed) return;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.rotationZ);
    ctx.scale(entity.scaleX, entity.scaleY);
    const sprites = entity.components.filter(component => component instanceof Sprite2D && component._running)
      .sort((a, b) => a.z - b.z);
    for (const sprite of sprites) {
      ctx.fillStyle = sprite.color;
      if (sprite.shape === 'circle') {
        ctx.beginPath(); ctx.arc(0, 0, sprite.width / 2, 0, Math.PI * 2); ctx.fill();
      } else if (sprite.shape === 'text') {
        ctx.font = sprite.font;
        ctx.textAlign = 'center';
        ctx.fillText(sprite.text, 0, 0);
      } else {
        ctx.fillRect(-sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
      }
    }
    for (const child of [...entity.children]) paint(child);
    ctx.restore();
  }
  function render(scene) {
    if (!viewport) resize();
    const { vw, vh, dpr, scale, x, y } = viewport;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, x * dpr, y * dpr);
    ctx.translate(width / 2, height / 2);
    for (const entity of [...scene.objects]) paint(entity);
    ctx.restore();
  }
  resize();
  return { render, resize, dispose() {} };
}

import { Component } from '../core/component.js';
import { resolveQualityPreset } from './quality3d.js';
import { normalizeSplitViews, pickSplitView } from '../platform/input.js';

const SCRATCH_WORLD = new Float64Array(16);
const SCRATCH_RGBA = [1, 1, 1, 1];

/** Parses CSS hex (`#rgb`, `#rrggbb`, `#rrggbbaa`) or `rgb()/rgba()` into 0..1 floats. */
export function parseColorRgba(color, out = null) {
  const dst = out ?? [1, 1, 1, 1];
  dst[0] = 1; dst[1] = 1; dst[2] = 1; dst[3] = 1;
  if (typeof color !== 'string') return dst;
  const s = color.trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
      if (Number.isFinite(r + g + b + a)) {
        dst[0] = r / 255; dst[1] = g / 255; dst[2] = b / 255; dst[3] = a / 255;
      }
      return dst;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      if (Number.isFinite(r + g + b + a)) {
        dst[0] = r / 255; dst[1] = g / 255; dst[2] = b / 255; dst[3] = a / 255;
      }
      return dst;
    }
    return dst;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(s);
  if (m) {
    dst[0] = Math.max(0, Math.min(1, Number(m[1]) / 255));
    dst[1] = Math.max(0, Math.min(1, Number(m[2]) / 255));
    dst[2] = Math.max(0, Math.min(1, Number(m[3]) / 255));
    dst[3] = m[4] !== undefined ? Math.max(0, Math.min(1, Number(m[4]))) : 1;
  }
  return dst;
}

function finiteNumber(value, name, fallback) {
  const result = value ?? fallback;
  if (!Number.isFinite(result)) throw new TypeError(`${name} must be finite`);
  return result;
}

/** 2D camera supporting smooth follow, deadzones, bounds clamping, zoom, rotation and shake. */
export class Camera2D {
  constructor({ x = 0, y = 0, zoom = 1, rotation = 0, bounds = null } = {}) {
    this.x = finiteNumber(x, 'x', 0);
    this.y = finiteNumber(y, 'y', 0);
    this._zoom = 1;
    this.zoom = finiteNumber(zoom, 'zoom', 1);
    this.rotation = finiteNumber(rotation, 'rotation', 0);
    this.bounds = bounds ?? null;
    this._shakeIntensity = 0;
    this._shakeDuration = 0;
    this._shakeTime = 0;
    this._shakePhase = 0;
    this._offsetX = 0;
    this._offsetY = 0;
    this._clampToBounds();
  }

  get zoom() { return this._zoom; }
  set zoom(value) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Camera2D zoom must be > 0');
    this._zoom = value;
  }

  get offsetX() { return this._offsetX; }
  get offsetY() { return this._offsetY; }

  _clampToBounds() {
    const b = this.bounds;
    if (!b) return;
    if (Number.isFinite(b.minX) && this.x < b.minX) this.x = b.minX;
    if (Number.isFinite(b.maxX) && this.x > b.maxX) this.x = b.maxX;
    if (Number.isFinite(b.minY) && this.y < b.minY) this.y = b.minY;
    if (Number.isFinite(b.maxY) && this.y > b.maxY) this.y = b.maxY;
  }

  follow(target, { lerp = 1, offsetX = 0, offsetY = 0, deadzoneX = 0, deadzoneY = 0 } = {}) {
    if (!target) return this;
    const pos = typeof target.worldPosition === 'function' ? target.worldPosition() : target;
    const tx = finiteNumber(pos.x, 'target.x', 0) + offsetX;
    const ty = finiteNumber(pos.y, 'target.y', 0) + offsetY;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const goalX = Math.abs(dx) > deadzoneX ? tx - Math.sign(dx) * deadzoneX : this.x;
    const goalY = Math.abs(dy) > deadzoneY ? ty - Math.sign(dy) * deadzoneY : this.y;
    const t = Math.max(0, Math.min(1, lerp));
    this.x += (goalX - this.x) * t;
    this.y += (goalY - this.y) * t;
    this._clampToBounds();
    return this;
  }

  shake(intensity, duration = 0.25) {
    if (!Number.isFinite(intensity) || intensity < 0) throw new RangeError('shake intensity must be >= 0');
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('shake duration must be >= 0');
    if (intensity === 0 || duration === 0) {
      this._shakeIntensity = 0;
      this._shakeDuration = 0;
      this._shakeTime = 0;
      this._offsetX = 0;
      this._offsetY = 0;
      return this;
    }
    this._shakeIntensity = intensity;
    this._shakeDuration = duration;
    this._shakeTime = duration;
    return this;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Camera2D.update dt must be >= 0');
    if (this._shakeTime > 0 && this._shakeDuration > 0) {
      this._shakeTime = Math.max(0, this._shakeTime - dt);
      const ratio = this._shakeTime / this._shakeDuration;
      const decay = ratio * ratio;
      this._shakePhase += dt * 48;
      this._offsetX = Math.sin(this._shakePhase * 1.13) * this._shakeIntensity * decay;
      this._offsetY = Math.cos(this._shakePhase * 1.47) * this._shakeIntensity * decay;
      if (this._shakeTime === 0) {
        this._offsetX = 0;
        this._offsetY = 0;
      }
    }
    this._clampToBounds();
    return this;
  }

  getViewBounds(viewportWidth, viewportHeight) {
    const hw = (viewportWidth * 0.5) / this._zoom;
    const hh = (viewportHeight * 0.5) / this._zoom;
    const cos = Math.abs(Math.cos(this.rotation));
    const sin = Math.abs(Math.sin(this.rotation));
    const rx = hw * cos + hh * sin;
    const ry = hw * sin + hh * cos;
    const cx = this.x + this._offsetX;
    const cy = this.y + this._offsetY;
    return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
  }
}

export class Sprite2D extends Component {
  constructor({
    shape = 'rect', width = 32, height = 32, color = '#80e2c2',
    text = '', font = '20px sans-serif', z = 0,
    layer = 0, ySort = false, visible = true, opacity = 1,
    flipX = false, flipY = false, image = null, sheet = null,
    frame = 0, sourceRect = null, animation = null, customDraw = null,
    anchorX = null, anchorY = null, offsetX = 0, offsetY = 0,
    scaleX = 1, scaleY = 1, rotation = 0, tint = null,
    flash = 0, flashColor = '#ffffff', groundShadow = false,
  } = {}) {
    super();
    this.shape = shape;
    this.width = width; this.height = height;
    this.color = color; this.text = text; this.font = font; this.z = z;
    this.layer = layer;
    this.ySort = Boolean(ySort);
    this.visible = Boolean(visible);
    this.opacity = opacity;
    this.flipX = Boolean(flipX);
    this.flipY = Boolean(flipY);
    this.image = image;
    this.sheet = sheet;
    this.frame = frame;
    this.sourceRect = sourceRect;
    this.animation = animation;
    this.customDraw = customDraw;
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.rotation = rotation;
    this.tint = tint;
    this.flash = flash;
    this.flashColor = flashColor;
    this.groundShadow = groundShadow;
    this._flashDuration = 0;
    this._flashRemaining = 0;
  }

  get visualRotation() { return this.rotation; }
  set visualRotation(value) { this.rotation = value; }

  hitFlash(duration = 0.08, color = '#ffffff') {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError('hitFlash duration must be >= 0');
    }
    this.flashColor = color;
    this._flashDuration = duration;
    this._flashRemaining = duration;
    this.flash = duration > 0 ? 1 : 0;
    return this;
  }

  update(dt) {
    if (this._flashRemaining > 0) {
      this._flashRemaining = Math.max(0, this._flashRemaining - dt);
      this.flash = this._flashDuration > 0 ? (this._flashRemaining / this._flashDuration) : 0;
    }
  }
}

/**
 * High-density Struct-of-Arrays (SoA) 2D sprite batch component for survivor hordes,
 * projectiles, and pickups (10,000+ instances without per-entity JS allocation overhead).
 */
export class SpriteCrowd2D extends Component {
  constructor({
    capacity = 4096,
    shape = 'rect',
    width = 32,
    height = 32,
    color = '#80e2c2',
    image = null,
    sheet = null,
    sourceRect = null,
    anchorX = 0.5,
    anchorY = 0.5,
    layer = 0,
    z = 0,
    ySort = false,
    visible = true,
    groundShadow = false,
    flashColor = '#ffffff',
  } = {}) {
    super();
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
      throw new RangeError('SpriteCrowd2D capacity must be an integer in 1..100000');
    }
    this.capacity = capacity;
    this.shape = shape;
    this.width = width;
    this.height = height;
    this.color = color;
    this.image = image;
    this.sheet = sheet;
    this.sourceRect = sourceRect;
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.layer = layer;
    this.z = z;
    this.ySort = Boolean(ySort);
    this.visible = Boolean(visible);
    this.groundShadow = groundShadow;
    this.flashColor = flashColor;

    this.active = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.offsetX = new Float32Array(capacity);
    this.offsetY = new Float32Array(capacity);
    this.rotation = new Float32Array(capacity);
    this.scaleX = new Float32Array(capacity).fill(1);
    this.scaleY = new Float32Array(capacity).fill(1);
    this.opacity = new Float32Array(capacity).fill(1);
    this.flash = new Float32Array(capacity);
    this.flashRate = new Float32Array(capacity);
    this.frame = new Uint16Array(capacity);
    this.flipX = new Uint8Array(capacity);
    this.tintR = new Float32Array(capacity).fill(1);
    this.tintG = new Float32Array(capacity).fill(1);
    this.tintB = new Float32Array(capacity).fill(1);
    this.hasTint = new Uint8Array(capacity);

    this._freeStack = new Int32Array(capacity);
    this._freeTop = capacity;
    for (let i = 0; i < capacity; i++) this._freeStack[i] = capacity - 1 - i;
    this._activeIndices = new Int32Array(capacity);
    this._indexInActive = new Int32Array(capacity).fill(-1);
    this._activeCount = 0;
    this._flashingCount = 0;
  }

  get count() { return this._activeCount; }

  spawn({
    x = 0,
    y = 0,
    offsetX = 0,
    offsetY = 0,
    rotation = 0,
    scaleX = 1,
    scaleY = 1,
    opacity = 1,
    frame = 0,
    flipX = false,
    tint = null,
  } = {}) {
    if (this._freeTop <= 0) return -1;
    const idx = this._freeStack[--this._freeTop];
    const activeSlot = this._activeCount++;
    this._activeIndices[activeSlot] = idx;
    this._indexInActive[idx] = activeSlot;
    this.active[idx] = 1;
    this.x[idx] = x;
    this.y[idx] = y;
    this.offsetX[idx] = offsetX;
    this.offsetY[idx] = offsetY;
    this.rotation[idx] = rotation;
    this.scaleX[idx] = scaleX;
    this.scaleY[idx] = scaleY;
    this.opacity[idx] = opacity;
    this.flash[idx] = 0;
    this.flashRate[idx] = 0;
    this.frame[idx] = frame;
    this.flipX[idx] = flipX ? 1 : 0;
    if (tint) {
      parseColorRgba(tint, SCRATCH_RGBA);
      this.tintR[idx] = SCRATCH_RGBA[0];
      this.tintG[idx] = SCRATCH_RGBA[1];
      this.tintB[idx] = SCRATCH_RGBA[2];
      this.hasTint[idx] = 1;
    } else {
      this.hasTint[idx] = 0;
      this.tintR[idx] = 1;
      this.tintG[idx] = 1;
      this.tintB[idx] = 1;
    }
    return idx;
  }

  setTransform(index, x, y, rotation = 0, scaleX = 1, scaleY = 1) {
    if (index < 0 || index >= this.capacity || !this.active[index]) return false;
    this.x[index] = x;
    this.y[index] = y;
    this.rotation[index] = rotation;
    this.scaleX[index] = scaleX;
    this.scaleY[index] = scaleY;
    return true;
  }

  hitFlash(index, duration = 0.08) {
    if (index < 0 || index >= this.capacity || !this.active[index]) return false;
    if (!Number.isFinite(duration) || duration <= 0) {
      if (this.flashRate[index] > 0) this._flashingCount = Math.max(0, this._flashingCount - 1);
      this.flash[index] = 0;
      this.flashRate[index] = 0;
      return true;
    }
    if (this.flashRate[index] === 0) this._flashingCount++;
    this.flash[index] = 1;
    this.flashRate[index] = 1 / duration;
    return true;
  }

  kill(index) {
    if (index < 0 || index >= this.capacity || !this.active[index]) return false;
    this.active[index] = 0;
    if (this.flashRate[index] > 0) {
      this._flashingCount = Math.max(0, this._flashingCount - 1);
      this.flash[index] = 0;
      this.flashRate[index] = 0;
    }
    const slot = this._indexInActive[index];
    const lastSlot = --this._activeCount;
    if (slot !== lastSlot) {
      const movedIdx = this._activeIndices[lastSlot];
      this._activeIndices[slot] = movedIdx;
      this._indexInActive[movedIdx] = slot;
    }
    this._indexInActive[index] = -1;
    this._freeStack[this._freeTop++] = index;
    return true;
  }

  clear() {
    for (let i = 0; i < this._activeCount; i++) {
      const idx = this._activeIndices[i];
      this.active[idx] = 0;
      this._indexInActive[idx] = -1;
      this.flash[idx] = 0;
      this.flashRate[idx] = 0;
      this._freeStack[this._freeTop++] = idx;
    }
    this._activeCount = 0;
    this._flashingCount = 0;
  }

  update(dt) {
    if (this._flashingCount <= 0 || !(dt > 0)) return;
    for (let i = 0; i < this._activeCount; i++) {
      const idx = this._activeIndices[i];
      const rate = this.flashRate[idx];
      if (rate > 0) {
        const next = this.flash[idx] - rate * dt;
        if (next <= 0) {
          this.flash[idx] = 0;
          this.flashRate[idx] = 0;
          this._flashingCount = Math.max(0, this._flashingCount - 1);
        } else {
          this.flash[idx] = next;
        }
      }
    }
  }
}

function spriteBoundsVisible(sprite, entity, mat, viewBounds) {
  if ((sprite.shape === 'text' || sprite.customDraw) && !(sprite.width > 0 && sprite.height > 0)) {
    return true;
  }
  const w = Math.abs(sprite.width);
  const h = Math.abs(sprite.height);
  const ax = sprite.anchorX ?? entity.anchorX ?? 0.5;
  const ay = sprite.anchorY ?? entity.anchorY ?? 0.5;
  const shadowCfg = sprite.groundShadow
    ? (typeof sprite.groundShadow === 'object' ? sprite.groundShadow : {})
    : null;
  const shadowHalfW = shadowCfg ? (w * (shadowCfg.widthRatio ?? 0.72)) * 0.5 : 0;
  const lx0 = shadowCfg ? Math.min(-w * ax, -shadowHalfW + (shadowCfg.offsetX || 0)) : -w * ax;
  const lx1 = shadowCfg ? Math.max(-w * ax + w, shadowHalfW + (shadowCfg.offsetX || 0)) : (-w * ax + w);
  const ly0 = -h * ay;
  const shadowBottom = shadowCfg
    ? h * (1 - ay) - h * (shadowCfg.tuckRatio ?? 0.032) + (shadowCfg.offsetY || 0) + (h * (shadowCfg.heightRatio ?? 0.18)) * 0.5
    : ly0 + h;
  const ly1 = shadowCfg ? Math.max(ly0 + h, shadowBottom) : (ly0 + h);
  const a = mat[0], b = mat[1], c = mat[4], d = mat[5], e = mat[12], f = mat[13];
  const rot = sprite.rotation || 0;
  const cos = rot ? Math.cos(rot) : 1;
  const sin = rot ? Math.sin(rot) : 0;
  const sx = (sprite.flipX ? -1 : 1) * (sprite.scaleX ?? 1);
  const sy = (sprite.flipY ? -1 : 1) * (sprite.scaleY ?? 1);
  const ox = sprite.offsetX || 0;
  const oy = sprite.offsetY || 0;
  const m00 = a * (cos * sx) + c * (sin * sx);
  const m01 = b * (cos * sx) + d * (sin * sx);
  const m10 = a * (-sin * sy) + c * (cos * sy);
  const m11 = b * (-sin * sy) + d * (cos * sy);
  const tx = a * ox + c * oy + e;
  const ty = b * ox + d * oy + f;
  const x0 = m00 * lx0 + m10 * ly0 + tx, y0 = m01 * lx0 + m11 * ly0 + ty;
  const x1 = m00 * lx1 + m10 * ly0 + tx, y1 = m01 * lx1 + m11 * ly0 + ty;
  const x2 = m00 * lx1 + m10 * ly1 + tx, y2 = m01 * lx1 + m11 * ly1 + ty;
  const x3 = m00 * lx0 + m10 * ly1 + tx, y3 = m01 * lx0 + m11 * ly1 + ty;
  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  return !(maxX < viewBounds.minX || minX > viewBounds.maxX || maxY < viewBounds.minY || minY > viewBounds.maxY);
}

function compareDrawItems(lhs, rhs) {
  return (
    lhs.layer - rhs.layer ||
    lhs.z - rhs.z ||
    ((lhs.ySort || rhs.ySort) ? (lhs.f - rhs.f) : 0) ||
    lhs.order - rhs.order
  );
}

/** Optional Canvas renderer; not imported by a 3D or UI-only game. */
export function createCanvas2DAdapter({
  canvas, width = 960, height = 540, background = '#101820',
  pixelRatio = globalThis.devicePixelRatio || 1,
  imageSmoothing = true, interpolate = false, cull = true,
  quality = null, createBufferCanvas = null,
} = {}) {
  if (!canvas?.getContext) throw new TypeError('Canvas adapter needs a canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const camera = new Camera2D();
  const drawPool = [];
  const sortQueue = [];
  let drawCount = 0;
  let needsSort = false;
  let prevLayer = -Infinity;
  let prevZ = -Infinity;
  let prevYSort = false;
  let viewport = null;
  let activeViews = null;
  let viewDividerColor = 'rgba(255,255,255,0.22)';
  let viewDividerWidth = 2;
  let shadowBuffer = null;
  let qualityTier = quality ? (resolveQualityPreset(quality, '2d'), quality) : null;
  let qualityPreset = qualityTier ? resolveQualityPreset(qualityTier, '2d') : null;
  const tintCache = new WeakMap();
  const ownedTintCanvases = [];
  const stats = { drawnSprites: 0, drawnCrowds: 0, culled: 0, sorted: false, backend: 'canvas2d' };

  const allocBuffer = createBufferCanvas ?? ((w, h) => {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    if (typeof globalThis.document?.createElement === 'function') {
      const el = globalThis.document.createElement('canvas');
      el.width = w;
      el.height = h;
      return el;
    }
    return null;
  });

  function getCachedTintedSilhouette(img, rect, fillColor, bw, bh) {
    let perImage = tintCache.get(img);
    if (!perImage) {
      perImage = new Map();
      tintCache.set(img, perImage);
    }
    const key = rect
      ? `${rect.x},${rect.y},${rect.width},${rect.height}|${fillColor}|${bw}x${bh}`
      : `full|${fillColor}|${bw}x${bh}`;
    const existing = perImage.get(key);
    if (existing) return existing;

    const bufCanvas = allocBuffer(bw, bh);
    const bctx = bufCanvas?.getContext?.('2d') ?? null;
    if (!bufCanvas || !bctx) return null;
    bctx.globalCompositeOperation = 'source-over';
    bctx.clearRect(0, 0, bw, bh);
    if (rect) bctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, bw, bh);
    else bctx.drawImage(img, 0, 0, bw, bh);
    bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = fillColor;
    bctx.fillRect(0, 0, bw, bh);
    bctx.globalCompositeOperation = 'source-over';

    if (perImage.size >= 48) {
      const oldestKey = perImage.keys().next().value;
      const oldest = perImage.get(oldestKey);
      perImage.delete(oldestKey);
      if (oldest) {
        oldest.width = 0;
        oldest.height = 0;
      }
    }
    perImage.set(key, bufCanvas);
    ownedTintCanvases.push(bufCanvas);
    return bufCanvas;
  }

  function getShadowBuffer() {
    if (shadowBuffer) return shadowBuffer;
    const bufCanvas = allocBuffer(64, 64);
    const bctx = bufCanvas?.getContext?.('2d') ?? null;
    if (!bufCanvas || !bctx) return null;
    if (typeof bctx.createRadialGradient === 'function') {
      const grad = bctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.45, 'rgba(0,0,0,0.68)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, 64, 64);
      shadowBuffer = { canvas: bufCanvas, ctx: bctx };
      return shadowBuffer;
    }
    if (typeof bctx.createImageData === 'function' && typeof bctx.putImageData === 'function') {
      const imgData = bctx.createImageData(64, 64);
      const data = imgData.data;
      for (let y = 0; y < 64; y++) {
        const dy = (y + 0.5 - 32) / 32;
        for (let x = 0; x < 64; x++) {
          const dx = (x + 0.5 - 32) / 32;
          const d2 = dx * dx + dy * dy;
          const idx = (y * 64 + x) * 4;
          if (d2 < 1) {
            data[idx + 3] = Math.round(Math.pow(1 - d2, 1.5) * 255);
          }
        }
      }
      bctx.putImageData(imgData, 0, 0);
      shadowBuffer = { canvas: bufCanvas, ctx: bctx };
      return shadowBuffer;
    }
    return null;
  }

  function resize() {
    const vw = Math.max(1, canvas.clientWidth || width), vh = Math.max(1, canvas.clientHeight || height);
    const maxPr = qualityPreset ? qualityPreset.maxPixelRatio : 3;
    const dpr = Math.max(1, Math.min(maxPr, pixelRatio));
    const targetW = Math.round(vw * dpr), targetH = Math.round(vh * dpr);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    const scale = Math.min(vw / width, vh / height);
    viewport = { vw, vh, dpr, scale, x: (vw - width * scale) / 2, y: (vh - height * scale) / 2 };
  }

  function setQuality(nextTier) {
    if (nextTier === null || nextTier === undefined) {
      qualityTier = null;
      qualityPreset = null;
    } else {
      qualityPreset = resolveQualityPreset(nextTier, '2d');
      qualityTier = nextTier;
    }
    resize();
    return qualityPreset;
  }

  function getQuality() {
    return qualityTier;
  }

  function setViews(views, options = {}) {
    const res = normalizeSplitViews(views, options);
    activeViews = res.views;
    viewDividerColor = res.dividerColor;
    viewDividerWidth = res.dividerWidth;
    return getViews();
  }

  function getViews() {
    return activeViews ? activeViews.map(v => ({ ...v })) : null;
  }

  function screenToWorld(clientX, clientY, viewIndex = null) {
    if (!viewport) resize();
    const rect = canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: viewport.vw, height: viewport.vh };
    const elemX = (clientX - rect.left) * (viewport.vw / Math.max(1, rect.width || viewport.vw));
    const elemY = (clientY - rect.top) * (viewport.vh / Math.max(1, rect.height || viewport.vh));
    const lx = (elemX - viewport.x) / viewport.scale;
    const ly = (elemY - viewport.y) / viewport.scale;
    const targetView = activeViews ? pickSplitView(activeViews, lx / width, ly / height, viewIndex) : null;
    const cam = targetView ? targetView.camera : camera;
    const cx = targetView ? (targetView.x + targetView.width * 0.5) * width : width * 0.5;
    const cy = targetView ? (targetView.y + targetView.height * 0.5) * height : height * 0.5;
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    const rx = (lx - cx) / zoom;
    const ry = (ly - cy) / zoom;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
      x: cam.x + (cam.offsetX || 0) + (rx * cos - ry * sin),
      y: cam.y + (cam.offsetY || 0) + (rx * sin + ry * cos),
    };
  }

  function worldToScreen(worldX, worldY, viewIndex = 0) {
    if (!viewport) resize();
    const rect = canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: viewport.vw, height: viewport.vh };
    const targetView = activeViews ? (activeViews[viewIndex] ?? activeViews[0]) : null;
    const cam = targetView ? targetView.camera : camera;
    const cx = targetView ? (targetView.x + targetView.width * 0.5) * width : width * 0.5;
    const cy = targetView ? (targetView.y + targetView.height * 0.5) * height : height * 0.5;
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    const dx = worldX - (cam.x + (cam.offsetX || 0));
    const dy = worldY - (cam.y + (cam.offsetY || 0));
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    const lx = cx + rx * zoom;
    const ly = cy + ry * zoom;
    const elemX = viewport.x + lx * viewport.scale;
    const elemY = viewport.y + ly * viewport.scale;
    return {
      x: rect.left + elemX * ((rect.width || viewport.vw) / viewport.vw),
      y: rect.top + elemY * ((rect.height || viewport.vh) / viewport.vh),
    };
  }

  function pushQueueItem(kind, entity, sprite, agentIndex, a, b, c, d, e, f, layer, z, ySort) {
    let slot;
    if (drawCount < drawPool.length) {
      slot = drawPool[drawCount];
    } else {
      slot = {
        kind: 0, entity: null, sprite: null, agentIndex: -1,
        a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
        layer: 0, z: 0, ySort: false, order: 0,
      };
      drawPool.push(slot);
    }
    slot.kind = kind;
    slot.entity = entity;
    slot.sprite = sprite;
    slot.agentIndex = agentIndex;
    slot.a = a; slot.b = b; slot.c = c; slot.d = d; slot.e = e; slot.f = f;
    slot.layer = layer;
    slot.z = z;
    slot.ySort = Boolean(ySort);
    slot.order = drawCount++;
    if (slot.order > 0 && (layer < prevLayer || (layer === prevLayer && z < prevZ) || slot.ySort || prevYSort)) {
      needsSort = true;
    }
    prevLayer = layer;
    prevZ = z;
    prevYSort = slot.ySort;
  }

  function collect(entity, alpha, viewBounds, useInterpolation) {
    if (!entity.active || entity.destroyed) return;
    const comps = entity.components;
    let computed = false;
    for (let ci = 0, cn = comps.length; ci < cn; ci++) {
      const comp = comps[ci];
      if (!comp._running || !comp.visible) continue;
      if (comp instanceof Sprite2D) {
        if (!(comp.opacity > 0)) continue;
        if (!computed) {
          if (useInterpolation || entity.interpolate) entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD);
          else entity.worldMatrixInto(SCRATCH_WORLD);
          computed = true;
        }
        if (cull && !spriteBoundsVisible(comp, entity, SCRATCH_WORLD, viewBounds)) {
          stats.culled++;
          continue;
        }
        pushQueueItem(
          0, entity, comp, -1,
          SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
          SCRATCH_WORLD[5], SCRATCH_WORLD[12], SCRATCH_WORLD[13],
          comp.layer, comp.z, comp.ySort,
        );
      } else if (comp instanceof SpriteCrowd2D) {
        if (comp.count <= 0) continue;
        if (!computed) {
          if (useInterpolation || entity.interpolate) entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD);
          else entity.worldMatrixInto(SCRATCH_WORLD);
          computed = true;
        }
        if (!comp.ySort) {
          pushQueueItem(
            1, entity, comp, -1,
            SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
            SCRATCH_WORLD[5], SCRATCH_WORLD[12], SCRATCH_WORLD[13],
            comp.layer, comp.z, false,
          );
        } else {
          const halfPad = Math.max(Math.abs(comp.width), Math.abs(comp.height)) * 2;
          const baseTx = SCRATCH_WORLD[12];
          const baseTy = SCRATCH_WORLD[13];
          for (let i = 0; i < comp._activeCount; i++) {
            const idx = comp._activeIndices[i];
            if (!(comp.opacity[idx] > 0)) continue;
            const lx = comp.x[idx], ly = comp.y[idx];
            const wx = baseTx + SCRATCH_WORLD[0] * lx + SCRATCH_WORLD[4] * ly;
            const wy = baseTy + SCRATCH_WORLD[1] * lx + SCRATCH_WORLD[5] * ly;
            if (cull && (
              wx + halfPad < viewBounds.minX || wx - halfPad > viewBounds.maxX ||
              wy + halfPad < viewBounds.minY || wy - halfPad > viewBounds.maxY
            )) {
              stats.culled++;
              continue;
            }
            pushQueueItem(
              2, entity, comp, idx,
              SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
              SCRATCH_WORLD[5], wx, wy,
              comp.layer, comp.z, true,
            );
          }
        }
      }
    }
    const children = entity.children;
    for (let i = 0, n = children.length; i < n; i++) {
      collect(children[i], alpha, viewBounds, useInterpolation);
    }
  }

  function drawGroundShadow2D(w, h, ax, ay, spriteOffsetX, spriteOffsetY, baseAlpha, groundShadow) {
    const cfg = typeof groundShadow === 'object' ? groundShadow : {};
    const widthRatio = cfg.widthRatio ?? 0.72;
    const heightRatio = cfg.heightRatio ?? 0.18;
    const maxAlpha = cfg.alpha ?? 0.45;
    const tuckRatio = cfg.tuckRatio ?? 0.032;
    const jumpScale = cfg.jumpScale !== false;
    const shadowColor = cfg.color || '#000000';
    const soleY = h * (1 - ay);
    const groundY = soleY - h * tuckRatio + (cfg.offsetY || 0);
    const groundX = (spriteOffsetX || 0) + (cfg.offsetX || 0);
    let scaleFactor = 1;
    let alphaFactor = 1;
    if (jumpScale && (spriteOffsetY || 0) < 0) {
      const lift = Math.min(0.6, Math.abs(spriteOffsetY) / Math.max(16, Math.abs(h)));
      scaleFactor = 1 - lift * 0.35;
      alphaFactor = 1 - lift * 0.45;
    }
    const sw = Math.max(2, Math.abs(w) * widthRatio * scaleFactor);
    const sh = Math.max(1, Math.abs(h) * heightRatio * scaleFactor);
    const finalAlpha = Math.max(0, Math.min(1, baseAlpha * maxAlpha * alphaFactor));
    if (finalAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = finalAlpha;
      const sbuf = shadowColor === '#000000' ? getShadowBuffer() : null;
      if (sbuf) {
        ctx.drawImage(sbuf.canvas, groundX - sw * 0.5, groundY - sh * 0.5, sw, sh);
      } else {
        ctx.fillStyle = shadowColor;
        ctx.translate(groundX, groundY);
        ctx.scale(sw * 0.5, sh * 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawTintedImageOverlay(img, rect, fillColor, overlayAlpha, dx, dy, w, h, baseAlpha) {
    if (!(overlayAlpha > 0)) return;
    const bw = Math.max(1, Math.ceil(Math.abs(w)));
    const bh = Math.max(1, Math.ceil(Math.abs(h)));
    const buf = getCachedTintedSilhouette(img, rect, fillColor, bw, bh);
    if (!buf) return;
    ctx.save();
    ctx.globalAlpha = baseAlpha * overlayAlpha;
    ctx.drawImage(buf, 0, 0, bw, bh, dx, dy, w, h);
    ctx.restore();
  }

  function drawSprite(item, allowShadows) {
    const { entity, sprite } = item;
    ctx.save();
    if (typeof ctx.transform === 'function') {
      ctx.transform(item.a, item.b, item.c, item.d, item.e, item.f);
    } else {
      ctx.translate(item.e, item.f);
      ctx.rotate(entity.rotationZ);
      ctx.scale(entity.scaleX, entity.scaleY);
    }
    if (sprite.opacity < 1) ctx.globalAlpha *= Math.max(0, sprite.opacity);
    const baseAlpha = ctx.globalAlpha;

    const w = sprite.width;
    const h = sprite.height;
    const ax = sprite.anchorX ?? entity.anchorX ?? 0.5;
    const ay = sprite.anchorY ?? entity.anchorY ?? 0.5;
    const dx = -w * ax;
    const dy = -h * ay;

    // Render grounded procedural elliptical shadow BEFORE visual bounce/rotation/hit-flash
    // so the shadow stays anchored on the floor during movement and never flashes white.
    if (allowShadows && sprite.groundShadow) {
      drawGroundShadow2D(w, h, ax, ay, sprite.offsetX, sprite.offsetY, baseAlpha, sprite.groundShadow);
    }

    if (sprite.offsetX || sprite.offsetY) ctx.translate(sprite.offsetX || 0, sprite.offsetY || 0);
    if (sprite.rotation) ctx.rotate(sprite.rotation);
    const sx = (sprite.flipX ? -1 : 1) * (sprite.scaleX ?? 1);
    const sy = (sprite.flipY ? -1 : 1) * (sprite.scaleY ?? 1);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);

    if (typeof sprite.customDraw === 'function') {
      sprite.customDraw(ctx, entity, sprite);
    } else if (sprite.image || sprite.sheet?.image) {
      const img = sprite.image ?? sprite.sheet.image;
      const rect = sprite.sourceRect ?? (sprite.sheet
        ? sprite.sheet.frame(sprite.animation ? sprite.animation.frame : sprite.frame)
        : null);
      if (rect) ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, dx, dy, w, h);
      else ctx.drawImage(img, dx, dy, w, h);
      if (sprite.tint) drawTintedImageOverlay(img, rect, sprite.tint, 0.55, dx, dy, w, h, baseAlpha);
      if (sprite.flash > 0) drawTintedImageOverlay(img, rect, sprite.flashColor || '#ffffff', Math.min(1, sprite.flash), dx, dy, w, h, baseAlpha);
    } else if (sprite.shape === 'circle') {
      ctx.fillStyle = sprite.tint ?? sprite.color;
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fill();
      if (sprite.flash > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * Math.min(1, sprite.flash);
        ctx.fillStyle = sprite.flashColor || '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (sprite.shape === 'text') {
      ctx.fillStyle = sprite.tint ?? sprite.color;
      ctx.font = sprite.font;
      ctx.textAlign = 'center';
      ctx.fillText(sprite.text, 0, 0);
    } else {
      ctx.fillStyle = sprite.tint ?? sprite.color;
      ctx.fillRect(dx, dy, w, h);
      if (sprite.flash > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * Math.min(1, sprite.flash);
        ctx.fillStyle = sprite.flashColor || '#ffffff';
        ctx.fillRect(dx, dy, w, h);
        ctx.restore();
      }
    }
    ctx.restore();
    stats.drawnSprites++;
  }

  function drawCrowdAgent(crowd, idx, baseAlpha, ax, ay, dx, dy, w, h, allowShadows, wx, wy) {
    const op = crowd.opacity[idx];
    if (!(op > 0)) return;
    ctx.save();
    ctx.translate(wx, wy);
    const agentAlpha = op < 1 ? baseAlpha * Math.max(0, op) : baseAlpha;
    if (op < 1) ctx.globalAlpha = agentAlpha;
    if (allowShadows && crowd.groundShadow) {
      drawGroundShadow2D(w, h, ax, ay, crowd.offsetX[idx], crowd.offsetY[idx], agentAlpha, crowd.groundShadow);
    }
    const ox = crowd.offsetX[idx], oy = crowd.offsetY[idx];
    if (ox || oy) ctx.translate(ox, oy);
    const rot = crowd.rotation[idx];
    if (rot) ctx.rotate(rot);
    const sx = (crowd.flipX[idx] ? -1 : 1) * crowd.scaleX[idx];
    const sy = crowd.scaleY[idx];
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);

    const flash = crowd.flash[idx];
    if (crowd.image || crowd.sheet?.image) {
      const img = crowd.image ?? crowd.sheet.image;
      const rect = crowd.sourceRect ?? (crowd.sheet ? crowd.sheet.frame(crowd.frame[idx]) : null);
      if (rect) ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, dx, dy, w, h);
      else ctx.drawImage(img, dx, dy, w, h);
      if (flash > 0) {
        drawTintedImageOverlay(img, rect, crowd.flashColor || '#ffffff', Math.min(1, flash), dx, dy, w, h, agentAlpha);
      }
    } else if (crowd.shape === 'circle') {
      ctx.fillStyle = crowd.hasTint[idx]
        ? `rgb(${Math.round(crowd.tintR[idx] * 255)},${Math.round(crowd.tintG[idx] * 255)},${Math.round(crowd.tintB[idx] * 255)})`
        : crowd.color;
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = crowd.hasTint[idx]
        ? `rgb(${Math.round(crowd.tintR[idx] * 255)},${Math.round(crowd.tintG[idx] * 255)},${Math.round(crowd.tintB[idx] * 255)})`
        : crowd.color;
      ctx.fillRect(dx, dy, w, h);
    }
    ctx.restore();
    stats.drawnSprites++;
  }

  function drawCrowdBatch(item, viewBounds, allowShadows) {
    const crowd = item.sprite;
    const w = crowd.width, h = crowd.height;
    const ax = crowd.anchorX ?? 0.5, ay = crowd.anchorY ?? 0.5;
    const dx = -w * ax, dy = -h * ay;
    const halfPad = Math.max(Math.abs(w), Math.abs(h)) * 2;
    ctx.save();
    if (typeof ctx.transform === 'function') {
      ctx.transform(item.a, item.b, item.c, item.d, item.e, item.f);
    } else {
      ctx.translate(item.e, item.f);
    }
    const baseAlpha = ctx.globalAlpha;
    for (let i = 0; i < crowd._activeCount; i++) {
      const idx = crowd._activeIndices[i];
      const lx = crowd.x[idx], ly = crowd.y[idx];
      if (cull && item.a === 1 && item.d === 1 && item.b === 0 && item.c === 0) {
        const wx = item.e + lx, wy = item.f + ly;
        if (wx + halfPad < viewBounds.minX || wx - halfPad > viewBounds.maxX ||
            wy + halfPad < viewBounds.minY || wy - halfPad > viewBounds.maxY) {
          stats.culled++;
          continue;
        }
      }
      drawCrowdAgent(crowd, idx, baseAlpha, ax, ay, dx, dy, w, h, allowShadows, lx, ly);
    }
    ctx.restore();
    stats.drawnCrowds++;
  }

  function renderCameraView(scene, alpha, cam, subX, subY, subW, subH, allowShadows, clipToView) {
    ctx.save();
    if (clipToView && typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
      ctx.beginPath();
      ctx.rect(subX, subY, subW, subH);
      ctx.clip();
    }
    ctx.translate(subX + subW * 0.5, subY + subH * 0.5);
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    if (zoom !== 1) ctx.scale(zoom, zoom);
    if (rot !== 0) ctx.rotate(-rot);
    const camX = cam.x + (cam.offsetX || 0);
    const camY = cam.y + (cam.offsetY || 0);
    if (camX !== 0 || camY !== 0) ctx.translate(-camX, -camY);

    drawCount = 0;
    needsSort = false;
    prevLayer = -Infinity;
    prevZ = -Infinity;
    prevYSort = false;

    const viewBounds = typeof cam.getViewBounds === 'function'
      ? cam.getViewBounds(subW, subH)
      : {
          minX: camX - subW / (2 * zoom),
          maxX: camX + subW / (2 * zoom),
          minY: camY - subH / (2 * zoom),
          maxY: camY + subH / (2 * zoom),
        };
    for (let i = 0, n = scene.objects.length; i < n; i++) {
      collect(scene.objects[i], alpha, viewBounds, interpolate);
    }
    let items = drawPool;
    if (needsSort && drawCount > 1) {
      stats.sorted = true;
      sortQueue.length = drawCount;
      for (let i = 0; i < drawCount; i++) sortQueue[i] = drawPool[i];
      sortQueue.sort(compareDrawItems);
      items = sortQueue;
    }
    for (let i = 0; i < drawCount; i++) {
      const item = items[i];
      if (item.kind === 0) drawSprite(item, allowShadows);
      else if (item.kind === 1) drawCrowdBatch(item, viewBounds, allowShadows);
      else {
        const crowd = item.sprite;
        const w = crowd.width, h = crowd.height;
        const ax = crowd.anchorX ?? 0.5, ay = crowd.anchorY ?? 0.5;
        drawCrowdAgent(crowd, item.agentIndex, ctx.globalAlpha, ax, ay, -w * ax, -h * ay, w, h, allowShadows, item.e, item.f);
      }
      item.entity = null;
      item.sprite = null;
    }
    sortQueue.length = 0;
    drawCount = 0;
    ctx.restore();
  }

  function render(scene, app = null) {
    if (!viewport) resize();
    const { vw, vh, dpr, scale, x, y } = viewport;
    const allowSmoothing = qualityPreset ? qualityPreset.imageSmoothing : imageSmoothing;
    const allowShadows = qualityPreset ? qualityPreset.groundShadows : true;
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = Boolean(allowSmoothing);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, x * dpr, y * dpr);

    stats.drawnSprites = 0;
    stats.drawnCrowds = 0;
    stats.culled = 0;
    stats.sorted = false;

    const alpha = app?.renderAlpha ?? 1;
    if (activeViews && activeViews.length > 0) {
      for (let i = 0; i < activeViews.length; i++) {
        const v = activeViews[i];
        renderCameraView(
          scene, alpha, v.camera,
          v.x * width, v.y * height, v.width * width, v.height * height,
          allowShadows, true,
        );
      }
      if (activeViews.length > 1 && viewDividerWidth > 0 && typeof ctx.strokeRect === 'function') {
        ctx.strokeStyle = viewDividerColor;
        ctx.lineWidth = viewDividerWidth / Math.max(0.01, scale);
        for (let i = 0; i < activeViews.length; i++) {
          const v = activeViews[i];
          ctx.strokeRect(v.x * width, v.y * height, v.width * width, v.height * height);
        }
      }
    } else {
      renderCameraView(scene, alpha, camera, 0, 0, width, height, allowShadows, false);
    }

    ctx.restore();
  }

  resize();
  return {
    camera,
    ctx,
    render,
    resize,
    setViews,
    getViews,
    screenToWorld,
    worldToScreen,
    setQuality,
    getQuality,
    get qualityPreset() { return qualityPreset; },
    get stats() { return { ...stats }; },
    getViewport: () => ({ ...viewport }),
    dispose() {
      drawPool.length = 0;
      sortQueue.length = 0;
      drawCount = 0;
      for (let i = 0; i < ownedTintCanvases.length; i++) {
        ownedTintCanvases[i].width = 0;
        ownedTintCanvases[i].height = 0;
      }
      ownedTintCanvases.length = 0;
      if (shadowBuffer) {
        shadowBuffer.canvas.width = 0;
        shadowBuffer.canvas.height = 0;
        shadowBuffer = null;
      }
    },
  };
}

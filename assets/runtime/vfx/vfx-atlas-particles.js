import {
  VFX_RENDER_ORDERS,
  createVisualPrng,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';

export const VFX_RENDER_MODE = Object.freeze({
  BILLBOARD: 0,
  HORIZONTAL: 1,
  STRETCHED: 2,
  MESH: 3,
  VERTICAL: 4,
});

const LUT_HALF = 32;
const LUT_WIDTH = 64;
const LUT_ROWS = 256;
const SIZE_CURVE_MAX = 8.0;

/**
 * Evaluates a piecewise-linear RGBA color curve at normalized lifetime `t` [0..1].
 * @param {Array<[number, number[]]> | null | undefined} stops
 * @param {number} t
 * @param {Float32Array | number[]} [out]
 * @returns {Float32Array | number[]}
 */
export function evaluateColorCurve(stops, t, out = [1, 1, 1, 1]) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  if (!Array.isArray(stops) || stops.length === 0) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    out[3] = 1 - u * u;
    return out;
  }
  if (stops.length === 1 || u <= stops[0][0]) {
    const c = stops[0][1];
    out[0] = c[0] ?? 1;
    out[1] = c[1] ?? 1;
    out[2] = c[2] ?? 1;
    out[3] = c[3] ?? 1;
    return out;
  }
  const last = stops[stops.length - 1];
  if (u >= last[0]) {
    const c = last[1];
    out[0] = c[0] ?? 1;
    out[1] = c[1] ?? 1;
    out[2] = c[2] ?? 1;
    out[3] = c[3] ?? 1;
    return out;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const t0 = stops[i][0];
    const t1 = stops[i + 1][0];
    if (u <= t1) {
      const span = Math.max(1e-6, t1 - t0);
      const f = Math.max(0, Math.min(1, (u - t0) / span));
      const c0 = stops[i][1];
      const c1 = stops[i + 1][1];
      out[0] = (c0[0] ?? 1) + ((c1[0] ?? 1) - (c0[0] ?? 1)) * f;
      out[1] = (c0[1] ?? 1) + ((c1[1] ?? 1) - (c0[1] ?? 1)) * f;
      out[2] = (c0[2] ?? 1) + ((c1[2] ?? 1) - (c0[2] ?? 1)) * f;
      out[3] = (c0[3] ?? 1) + ((c1[3] ?? 1) - (c0[3] ?? 1)) * f;
      return out;
    }
  }
  return out;
}

/**
 * Evaluates a piecewise-linear scalar size curve at normalized lifetime `t` [0..1].
 * @param {Array<[number, number]> | null | undefined} keys
 * @param {number} t
 * @returns {number}
 */
export function evaluateSizeCurve(keys, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  if (!Array.isArray(keys) || keys.length === 0) return 1.0;
  if (keys.length === 1 || u <= keys[0][0]) return Number(keys[0][1] ?? 1);
  const last = keys[keys.length - 1];
  if (u >= last[0]) return Number(last[1] ?? 1);
  for (let i = 0; i < keys.length - 1; i++) {
    const t0 = keys[i][0];
    const t1 = keys[i + 1][0];
    if (u <= t1) {
      const span = Math.max(1e-6, t1 - t0);
      const f = Math.max(0, Math.min(1, (u - t0) / span));
      const v0 = Number(keys[i][1] ?? 1);
      const v1 = Number(keys[i + 1][1] ?? 1);
      return v0 + (v1 - v0) * f;
    }
  }
  return 1.0;
}

function normalizeStops(stops, isColor) {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  const copy = stops.slice(0, 8).map((item) => {
    const t = Math.max(0, Math.min(1, Number(item?.[0]) || 0));
    if (isColor) {
      const c = Array.isArray(item?.[1]) ? item[1] : [1, 1, 1, 1];
      return [t, [
        Math.max(0, Math.min(1, Number(c[0] ?? 1))),
        Math.max(0, Math.min(1, Number(c[1] ?? 1))),
        Math.max(0, Math.min(1, Number(c[2] ?? 1))),
        Math.max(0, Math.min(1, Number(c[3] ?? 1))),
      ]];
    }
    return [t, Math.max(0, Math.min(SIZE_CURVE_MAX, Number(item?.[1] ?? 1)))];
  });
  copy.sort((a, b) => a[0] - b[0]);
  return copy;
}

function buildCurveKey(colorCurve, sizeCurve) {
  let k = '';
  if (colorCurve) {
    for (let i = 0; i < colorCurve.length; i++) {
      const s = colorCurve[i];
      k += `c${s[0].toFixed(3)}:${s[1][0].toFixed(3)},${s[1][1].toFixed(3)},${s[1][2].toFixed(3)},${s[1][3].toFixed(3)};`;
    }
  } else {
    k += 'cDef;';
  }
  if (sizeCurve) {
    for (let i = 0; i < sizeCurve.length; i++) {
      const s = sizeCurve[i];
      k += `s${s[0].toFixed(3)}:${s[1].toFixed(3)};`;
    }
  } else {
    k += 'sDef;';
  }
  return k;
}

/**
 * Compiles color/size curves into a zero-GC 64x256 RGBA8 lookup table + DataTexture.
 * Left 32 texels encode RGBA colorCurve; right 32 texels encode 16-bit sizeCurve [0..8].
 */
export function createCurveLutTable(THREE = /** @type {object | null} */ (null)) {
  const bytes = new Uint8Array(LUT_WIDTH * LUT_ROWS * 4);
  const keyToRow = new Map();
  let rowCount = 0;
  let dirty = false;
  const scratchRgba = new Float32Array(4);

  /** @type {object | null} */
  let threeTexture = null;
  if (THREE && THREE.DataTexture && THREE.RGBAFormat && THREE.UnsignedByteType) {
    threeTexture = new THREE.DataTexture(bytes, LUT_WIDTH, LUT_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (THREE.NearestFilter) {
      threeTexture.minFilter = THREE.NearestFilter;
      threeTexture.magFilter = THREE.NearestFilter;
    }
    threeTexture.generateMipmaps = false;
    threeTexture.flipY = false;
    threeTexture.needsUpdate = true;
  }

  function compile(colorCurveRaw, sizeCurveRaw) {
    const colorCurve = normalizeStops(colorCurveRaw, true);
    const sizeCurve = normalizeStops(sizeCurveRaw, false);
    const key = buildCurveKey(colorCurve, sizeCurve);
    const cached = keyToRow.get(key);
    if (cached !== undefined) return cached;

    const row = rowCount < LUT_ROWS ? rowCount++ : (LUT_ROWS - 1);
    keyToRow.set(key, row);

    const rowBase = row * LUT_WIDTH * 4;
    for (let i = 0; i < LUT_HALF; i++) {
      const t = i / (LUT_HALF - 1);
      evaluateColorCurve(colorCurve, t, scratchRgba);
      const cOff = rowBase + i * 4;
      bytes[cOff] = Math.max(0, Math.min(255, Math.round(scratchRgba[0] * 255)));
      bytes[cOff + 1] = Math.max(0, Math.min(255, Math.round(scratchRgba[1] * 255)));
      bytes[cOff + 2] = Math.max(0, Math.min(255, Math.round(scratchRgba[2] * 255)));
      bytes[cOff + 3] = Math.max(0, Math.min(255, Math.round(scratchRgba[3] * 255)));

      const sz = Math.max(0, Math.min(SIZE_CURVE_MAX, evaluateSizeCurve(sizeCurve, t)));
      const q = Math.round((sz / SIZE_CURVE_MAX) * 65535);
      const sOff = rowBase + (LUT_HALF + i) * 4;
      bytes[sOff] = (q >> 8) & 255;
      bytes[sOff + 1] = q & 255;
      bytes[sOff + 2] = 0;
      bytes[sOff + 3] = 255;
    }
    dirty = true;
    return row;
  }

  // Row 0 is always the default smooth white fade + unit scale.
  compile(null, null);

  function flush() {
    if (!dirty) return;
    if (threeTexture) threeTexture.needsUpdate = true;
    dirty = false;
  }

  function sampleColor(row, t, out = scratchRgba) {
    const r = Math.max(0, Math.min(LUT_ROWS - 1, row | 0));
    const s = Math.max(0, Math.min(1, t)) * (LUT_HALF - 1);
    const i0 = Math.floor(s);
    const i1 = Math.min(LUT_HALF - 1, i0 + 1);
    const f = s - i0;
    const base = r * LUT_WIDTH * 4;
    const p0 = base + i0 * 4;
    const p1 = base + i1 * 4;
    out[0] = (bytes[p0] + (bytes[p1] - bytes[p0]) * f) / 255;
    out[1] = (bytes[p0 + 1] + (bytes[p1 + 1] - bytes[p0 + 1]) * f) / 255;
    out[2] = (bytes[p0 + 2] + (bytes[p1 + 2] - bytes[p0 + 2]) * f) / 255;
    out[3] = (bytes[p0 + 3] + (bytes[p1 + 3] - bytes[p0 + 3]) * f) / 255;
    return out;
  }

  function sampleSize(row, t) {
    const r = Math.max(0, Math.min(LUT_ROWS - 1, row | 0));
    const s = Math.max(0, Math.min(1, t)) * (LUT_HALF - 1);
    const i0 = Math.floor(s);
    const i1 = Math.min(LUT_HALF - 1, i0 + 1);
    const f = s - i0;
    const base = r * LUT_WIDTH * 4;
    const p0 = base + (LUT_HALF + i0) * 4;
    const p1 = base + (LUT_HALF + i1) * 4;
    const v0 = ((bytes[p0] << 8) | bytes[p0 + 1]) / 65535 * SIZE_CURVE_MAX;
    const v1 = ((bytes[p1] << 8) | bytes[p1 + 1]) / 65535 * SIZE_CURVE_MAX;
    return v0 + (v1 - v0) * f;
  }

  function dispose() {
    if (threeTexture && typeof threeTexture.dispose === 'function') {
      threeTexture.dispose();
    }
    threeTexture = null;
  }

  return {
    bytes,
    width: LUT_WIDTH,
    height: LUT_ROWS,
    texture: threeTexture,
    get rowCount() { return rowCount; },
    compile,
    flush,
    sampleColor,
    sampleSize,
    dispose,
  };
}

/**
 * Default UV region map for the built-in 512x512 procedural VFX atlas.
 * Coordinates are top-left normalized `[u0, v0, u1, v1]`.
 */
export const PROCEDURAL_VFX_ATLAS_REGIONS = Object.freeze({
  glow: Object.freeze([0.0, 0.0, 0.25, 0.25]),
  spark: Object.freeze([0.25, 0.0, 0.5, 0.25]),
  ring: Object.freeze([0.5, 0.0, 0.75, 0.25]),
  wave: Object.freeze([0.75, 0.0, 1.0, 0.25]),
  smoke: Object.freeze([0.0, 0.25, 0.25, 0.5]),
  shard: Object.freeze([0.25, 0.25, 0.5, 0.5]),
  rune_ring: Object.freeze([0.5, 0.25, 0.75, 0.5]),
  trail: Object.freeze([0.75, 0.25, 1.0, 0.5]),
  fireball_flipbook: Object.freeze([0.0, 0.5, 1.0, 0.625]),
  shield_hex: Object.freeze([0.0, 0.75, 0.25, 1.0]),
  snowflake: Object.freeze([0.25, 0.75, 0.5, 1.0]),
});

/**
 * Generates a self-contained procedural 512x512 VFX texture atlas (sprites + 8x1 fireball flipbook).
 * @param {object | null} [THREE=null]
 * @returns {{ canvas: HTMLCanvasElement | OffscreenCanvas | null, texture: object | null, regions: Record<string, readonly number[]> }}
 */
export function createProceduralVfxAtlas(THREE = /** @type {object | null} */ (null)) {
  /** @type {HTMLCanvasElement | OffscreenCanvas | null} */
  let canvas = null;
  if (typeof document !== 'undefined' && document.createElement) {
    const el = document.createElement('canvas');
    el.width = 512;
    el.height = 512;
    canvas = el;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(512, 512);
  }
  if (!canvas) {
    return { canvas: null, texture: null, regions: PROCEDURAL_VFX_ATLAS_REGIONS };
  }

  const ctx = /** @type {CanvasRenderingContext2D | null} */ (canvas.getContext('2d'));
  if (!ctx) {
    return { canvas: null, texture: null, regions: PROCEDURAL_VFX_ATLAS_REGIONS };
  }

  ctx.clearRect(0, 0, 512, 512);

  // Cell (0,0): glow
  {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }

  // Cell (1,0): spark (4-point star)
  {
    const cx = 192;
    const cy = 64;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 48);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(128, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 54);
    ctx.lineTo(cx + 8, cy - 8);
    ctx.lineTo(cx + 54, cy);
    ctx.lineTo(cx + 8, cy + 8);
    ctx.lineTo(cx, cy + 54);
    ctx.lineTo(cx - 8, cy + 8);
    ctx.lineTo(cx - 54, cy);
    ctx.lineTo(cx - 8, cy - 8);
    ctx.closePath();
    ctx.fill();
  }

  // Cell (2,0): ring
  {
    const cx = 320;
    const cy = 64;
    const g = ctx.createRadialGradient(cx, cy, 34, cx, cy, 58);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cell (3,0): wave (soft wispy shockwave)
  {
    const cx = 448;
    const cy = 64;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const rx = cx + Math.cos(a) * 38;
      const ry = cy + Math.sin(a) * 38;
      const g = ctx.createRadialGradient(rx, ry, 2, rx, ry, 22);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rx, ry, 22, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cell (0,1): smoke (multi-lobe soft puff)
  {
    const lobes = [
      [64, 192, 42, 0.65],
      [48, 180, 28, 0.55],
      [82, 182, 26, 0.55],
      [54, 208, 28, 0.5],
      [78, 204, 26, 0.5],
    ];
    for (let i = 0; i < lobes.length; i++) {
      const [lx, ly, lr, la] = lobes[i];
      const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, lr);
      g.addColorStop(0, `rgba(255,255,255,${la})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cell (1,1): shard (diamond crystal)
  {
    const cx = 192;
    const cy = 192;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 52);
    ctx.lineTo(cx + 22, cy);
    ctx.lineTo(cx, cy + 52);
    ctx.lineTo(cx - 22, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Cell (2,1): rune_ring (geometric magic circle)
  {
    const cx = 320;
    const cy = 192;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 42, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i * 2 * Math.PI) / 3 + k * (Math.PI / 3);
        const px = cx + Math.cos(a) * 42;
        const py = cy + Math.sin(a) * 42;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
      ctx.lineTo(cx + Math.cos(a) * 51, cy + Math.sin(a) * 51);
      ctx.stroke();
    }
  }

  // Cell (3,1): trail (horizontal tapered streak)
  {
    const g = ctx.createLinearGradient(388, 192, 508, 192);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.85, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(448, 192, 58, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Row 2 (y=256..320): 8x1 fireball flipbook (square 64x64 cells, strictly bounded inside 29px radius)
  for (let f = 0; f < 8; f++) {
    const t = f / 7;
    const cx = f * 64 + 32;
    const cy = 288;
    const puffs = 7;
    for (let p = 0; p < puffs; p++) {
      const ang = (p / puffs) * Math.PI * 2 + f * 0.7;
      const dist = p === 0 ? 0 : (3 + t * 7);
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist * 0.85 - t * 2;
      const maxR = Math.max(4, 29 - Math.hypot(px - cx, py - cy));
      const pr = Math.min(maxR, (p === 0 ? 18 : 11) + t * 5);
      const alpha = (1 - t * 0.55) * (p === 0 ? 0.95 : 0.65);
      const g = ctx.createRadialGradient(px, py, 1, px, py, pr);
      g.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cell (0,3): shield_hex
  {
    const cx = 64;
    const cy = 448;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = cx + Math.cos(a) * 48;
      const py = cy + Math.sin(a) * 48;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Cell (1,3): snowflake
  {
    const cx = 192;
    const cy = 448;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
      ctx.stroke();
    }
  }

  /** @type {object | null} */
  let texture = null;
  if (THREE && THREE.CanvasTexture) {
    texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.needsUpdate = true;
  }
  return { canvas, texture, regions: PROCEDURAL_VFX_ATLAS_REGIONS };
}

export const ATLAS_PARTICLE_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 aAtlasP0; // x0, y0, z0, spawnTime
attribute vec4 aAtlasP1; // vx, vy, vz, duration
attribute vec4 aAtlasP2; // sizeStart, gravity, drag, curveRow
attribute vec4 aAtlasP3; // rot0, angularVel, hdr, renderMode (0=billboard, 1=horizontal, 2=stretched)
attribute vec4 aAtlasP4; // u0, v0, u1, v1
attribute vec4 aAtlasP5; // cols, rows, cycles, blendFlag
attribute vec4 aAtlasP6; // noiseStrength, noiseFreq, stretch, phase
attribute vec4 aAtlasP7; // tintRgb24, orbitalY, centerOffX, centerOffZ

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D uCurveLut;
uniform float uTime;
uniform float uIs2D;

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

float sampleSizeCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 255.0) + 0.5) / 256.0;
  float s = clamp(t, 0.0, 1.0) * 31.0;
  float i0 = floor(s);
  float i1 = min(31.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture2D(uCurveLut, vec2((32.0 + i0 + 0.5) / 64.0, rowV));
  vec4 t1 = texture2D(uCurveLut, vec2((32.0 + i1 + 0.5) / 64.0, rowV));
  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;
  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;
  return mix(s0, s1, f);
}

void main() {
  float age = uTime - aAtlasP0.w;
  float dur = aAtlasP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = age / dur;
  vLifeRatio = t;
  vUv = uv;
  vCurveRow = aAtlasP2.w;
  vHdr = aAtlasP3.z;
  vUvRect = aAtlasP4;
  vFlipbook = aAtlasP5;
  vTint = unpackRgb24(aAtlasP7.x);

  float k = aAtlasP2.z;
  vec3 worldPos;
  vec3 curVel;
  if (k < -0.5) {
    worldPos = aAtlasP0.xyz;
    curVel = aAtlasP1.xyz;
  } else {
    float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
    float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;
    vec3 gVec = (uIs2D > 0.5) ? vec3(0.0, aAtlasP2.y, 0.0) : vec3(0.0, -aAtlasP2.y, 0.0);
    worldPos = aAtlasP0.xyz + aAtlasP1.xyz * dispFactor + 0.5 * gVec * (age * age);
    curVel = aAtlasP1.xyz * velDecay + gVec * age;

    float orb = aAtlasP7.y;
    if (abs(orb) > 0.0001 && uIs2D < 0.5) {
      vec2 cxz = aAtlasP0.xz - aAtlasP7.zw;
      vec2 rel = worldPos.xz - cxz;
      float oa = orb * age;
      float oc = cos(oa);
      float os = sin(oa);
      worldPos.xz = cxz + vec2(rel.x * oc - rel.y * os, rel.x * os + rel.y * oc);
      curVel.xz = vec2(curVel.x * oc - curVel.z * os, curVel.x * os + curVel.z * oc);
    }

    float nStr = aAtlasP6.x;
    if (nStr > 0.001) {
      float nFreq = max(0.05, aAtlasP6.y);
      float ph = aAtlasP6.w * 6.2831853;
      float wt = age * nFreq * 3.14159265;
      float rm = aAtlasP3.w;
      float yScale = (rm > 1.5 && rm < 2.5) ? 1.0 : aAtlasP6.z;
      vec3 noiseOff = vec3(
        sin(wt + ph) * cos(wt * 0.73 + ph * 1.3),
        sin(wt * 1.17 + ph * 2.1) * yScale,
        cos(wt * 0.89 + ph * 1.7)
      ) * (nStr * min(1.0, age * 1.5) * 0.45);
      worldPos += noiseOff;
    }
  }

  float curSize = aAtlasP2.x * sampleSizeCurve(aAtlasP2.w, t);
  float rot = aAtlasP3.x + aAtlasP3.y * age;
  float renderMode = aAtlasP3.w;

  if (uIs2D > 0.5) {
    float c = cos(rot);
    float s = sin(rot);
    vec2 axisX = vec2(c, s);
    vec2 axisY = vec2(-s, c);
    float lenScale = curSize;
    if (renderMode > 1.5 && renderMode < 2.5) {
      float spd = length(curVel.xy);
      if (spd > 0.001) {
        axisX = curVel.xy / spd;
        axisY = vec2(-axisX.y, axisX.x);
      }
      lenScale = curSize * (1.0 + aAtlasP6.z * min(spd * 0.015, 4.0));
    }
    vec2 p2 = worldPos.xy + axisX * (position.x * lenScale) + axisY * (position.y * curSize);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, worldPos.z, 1.0);
  } else if (renderMode > 0.5 && renderMode < 1.5) {
    float c = cos(rot);
    float s = sin(rot);
    vec3 worldQuad = worldPos + vec3(
      (position.x * c - position.y * s) * curSize,
      0.0,
      (position.x * s + position.y * c) * curSize
    );
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);
  } else if (renderMode > 3.5) {
    vec3 camRight = vec3(modelViewMatrix[0][0], 0.0, modelViewMatrix[2][0]);
    float rLen = length(camRight);
    camRight = rLen > 0.0001 ? (camRight / rLen) : vec3(1.0, 0.0, 0.0);
    vec3 upW = vec3(0.0, 1.0, 0.0);
    float c = cos(rot);
    float s = sin(rot);
    vec2 rPos = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * curSize;
    vec3 worldQuad = worldPos + camRight * rPos.x + upW * rPos.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);
  } else {
    vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);
    vec2 rightAxis;
    float major = curSize;
    if (renderMode > 1.5 && renderMode < 2.5) {
      vec3 viewVel = mat3(modelViewMatrix) * curVel;
      float spd = length(viewVel.xy);
      rightAxis = spd > 0.001 ? (viewVel.xy / spd) : vec2(cos(rot), sin(rot));
      major = curSize * (1.0 + aAtlasP6.z * min(spd * 0.08, 4.5));
    } else {
      rightAxis = vec2(cos(rot), sin(rot));
    }
    vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);
    mvCenter.xy += rightAxis * (position.x * major) + upAxis * (position.y * curSize);
    gl_Position = projectionMatrix * mvCenter;
  }
}
`;

export const ATLAS_PARTICLE_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uCurveLut;
uniform sampler2D uAtlasTex;
uniform sampler2D uSoftDepthTex;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasSoftDepth;
uniform float uSoftFade;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;

float linearizeDepth(float zNdc) {
  float z = zNdc * 2.0 - 1.0;
  float n = uCamNearFar.x;
  float f = uCamNearFar.y;
  return (2.0 * n * f) / max(0.0001, f + n - z * (f - n));
}

vec4 sampleColorCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 255.0) + 0.5) / 256.0;
  float s = clamp(t, 0.0, 1.0) * 31.0;
  float i0 = floor(s);
  float i1 = min(31.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture2D(uCurveLut, vec2((i0 + 0.5) / 64.0, rowV));
  vec4 c1 = texture2D(uCurveLut, vec2((i1 + 0.5) / 64.0, rowV));
  return mix(c0, c1, f);
}

vec4 sampleAtlasFrame(float frameIdx, vec2 localUv) {
  float cols = max(1.0, floor(vFlipbook.x + 0.5));
  float rows = max(1.0, floor(vFlipbook.y + 0.5));
  float col = mod(frameIdx, cols);
  float row = floor(frameIdx / cols);
  vec2 cellUv = vec2((col + localUv.x) / cols, (row + localUv.y) / rows);
  vec2 mapped = vec2(
    mix(vUvRect.x, vUvRect.z, cellUv.x),
    mix(vUvRect.y, vUvRect.w, cellUv.y)
  );
  if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
  return texture2D(uAtlasTex, mapped);
}

void main() {
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
  if (curveCol.a < 0.005) discard;

  vec4 texCol = vec4(1.0);
  if (uHasAtlas > 0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      float total = max(1.0, floor(vFlipbook.x + 0.5) * floor(vFlipbook.y + 0.5));
      float cycles = max(0.01, vFlipbook.z);
      float framePos = clamp(fract(vLifeRatio * cycles), 0.0, 0.9999) * total;
      if (vLifeRatio * cycles >= 1.0 && cycles <= 1.001) {
        framePos = total - 0.001;
      }
      float f0 = floor(framePos);
      texCol = sampleAtlasFrame(f0, topDownUv);
      if (vFlipbook.w > 0.5) {
        float f1 = min(total - 1.0, f0 + 1.0);
        vec4 nextCol = sampleAtlasFrame(f1, topDownUv);
        texCol = mix(texCol, nextCol, fract(framePos));
      }
    } else {
      vec2 mapped = vec2(
        mix(vUvRect.x, vUvRect.z, topDownUv.x),
        mix(vUvRect.y, vUvRect.w, topDownUv.y)
      );
      if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
      texCol = texture2D(uAtlasTex, mapped);
    }
  } else {
    float r = length(vUv * 2.0 - 1.0);
    if (r > 1.0) discard;
    texCol.a = exp(-3.6 * r * r);
  }

  float softMul = 1.0;
  if (uHasSoftDepth > 0.5 && uSoftFade > 0.001) {
    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;
    float sceneZ = linearizeDepth(sceneDepthRaw);
    float partZ = linearizeDepth(gl_FragCoord.z);
    softMul = clamp((sceneZ - partZ) / uSoftFade, 0.0, 1.0);
  }

  float alpha = texCol.a * curveCol.a * softMul;
  if (alpha < 0.0005) discard;
  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);
  gl_FragColor = vec4(rgb, alpha);
}
`;

export const ATLAS_PARTICLE_WEBGL2_2D_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuadPos;
layout(location = 1) in vec4 aAtlasP0;
layout(location = 2) in vec4 aAtlasP1;
layout(location = 3) in vec4 aAtlasP2;
layout(location = 4) in vec4 aAtlasP3;
layout(location = 5) in vec4 aAtlasP4;
layout(location = 6) in vec4 aAtlasP5;
layout(location = 7) in vec4 aAtlasP6;
layout(location = 8) in vec4 aAtlasP7;

uniform sampler2D uCurveLut;
uniform float uTime;
uniform vec2 uCamPos;
uniform float uCamZoom;
uniform vec2 uViewSize;

out vec2 vUv;
out float vLifeRatio;
out float vCurveRow;
out float vHdr;
out vec4 vUvRect;
out vec4 vFlipbook;
out vec3 vTint;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

float sampleSizeCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 255.0) + 0.5) / 256.0;
  float s = clamp(t, 0.0, 1.0) * 31.0;
  float i0 = floor(s);
  float i1 = min(31.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture(uCurveLut, vec2((32.0 + i0 + 0.5) / 64.0, rowV));
  vec4 t1 = texture(uCurveLut, vec2((32.0 + i1 + 0.5) / 64.0, rowV));
  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;
  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;
  return mix(s0, s1, f);
}

void main() {
  float age = uTime - aAtlasP0.w;
  float dur = aAtlasP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = age / dur;
  vLifeRatio = t;
  vUv = aQuadPos + 0.5;
  vCurveRow = aAtlasP2.w;
  vHdr = aAtlasP3.z;
  vUvRect = aAtlasP4;
  vFlipbook = aAtlasP5;
  vTint = unpackRgb24(aAtlasP7.x);

  float k = aAtlasP2.z;
  vec2 worldPos;
  vec2 curVel;
  if (k < -0.5) {
    worldPos = aAtlasP0.xy;
    curVel = aAtlasP1.xy;
  } else {
    float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
    float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;
    vec2 gVec = vec2(0.0, aAtlasP2.y);
    worldPos = aAtlasP0.xy + aAtlasP1.xy * dispFactor + 0.5 * gVec * (age * age);
    curVel = aAtlasP1.xy * velDecay + gVec * age;

    float nStr = aAtlasP6.x;
    if (nStr > 0.001) {
      float nFreq = max(0.05, aAtlasP6.y);
      float ph = aAtlasP6.w * 6.2831853;
      float wt = age * nFreq * 3.14159265;
      worldPos += vec2(sin(wt + ph) * cos(wt * 0.73 + ph), cos(wt * 1.17 + ph)) * (nStr * min(1.0, age * 1.5) * 12.0);
    }
  }

  float curSize = aAtlasP2.x * sampleSizeCurve(aAtlasP2.w, t);
  float rot = aAtlasP3.x + aAtlasP3.y * age;
  vec2 axisX = vec2(cos(rot), sin(rot));
  vec2 axisY = vec2(-axisX.y, axisX.x);
  float lenScale = curSize;
  if (aAtlasP3.w > 1.5 && aAtlasP3.w < 2.5) {
    float spd = length(curVel);
    if (spd > 0.001) {
      axisX = curVel / spd;
      axisY = vec2(-axisX.y, axisX.x);
    }
    lenScale = curSize * (1.0 + aAtlasP6.z * min(spd * 0.015, 4.0));
  }

  vec2 p = worldPos + axisX * (aQuadPos.x * lenScale) + axisY * (aQuadPos.y * curSize);
  vec2 screenPx = (p - uCamPos) * uCamZoom + uViewSize * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,
    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const ATLAS_PARTICLE_WEBGL2_2D_FS = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uCurveLut;
uniform sampler2D uAtlasTex;
uniform float uHasAtlas;

in vec2 vUv;
in float vLifeRatio;
in float vCurveRow;
in float vHdr;
in vec4 vUvRect;
in vec4 vFlipbook;
in vec3 vTint;

out vec4 fragColor;

vec4 sampleColorCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 255.0) + 0.5) / 256.0;
  float s = clamp(t, 0.0, 1.0) * 31.0;
  float i0 = floor(s);
  float i1 = min(31.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture(uCurveLut, vec2((i0 + 0.5) / 64.0, rowV));
  vec4 c1 = texture(uCurveLut, vec2((i1 + 0.5) / 64.0, rowV));
  return mix(c0, c1, f);
}

vec4 sampleAtlasFrame(float frameIdx, vec2 localUv) {
  float cols = max(1.0, floor(vFlipbook.x + 0.5));
  float rows = max(1.0, floor(vFlipbook.y + 0.5));
  float col = mod(frameIdx, cols);
  float row = floor(frameIdx / cols);
  vec2 cellUv = vec2((col + localUv.x) / cols, (row + localUv.y) / rows);
  vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, cellUv.x), mix(vUvRect.y, vUvRect.w, cellUv.y));
  return texture(uAtlasTex, mapped);
}

void main() {
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
  if (curveCol.a < 0.005) discard;

  vec4 texCol = vec4(1.0);
  if (uHasAtlas > 0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      float total = max(1.0, floor(vFlipbook.x + 0.5) * floor(vFlipbook.y + 0.5));
      float cycles = max(0.01, vFlipbook.z);
      float framePos = clamp(fract(vLifeRatio * cycles), 0.0, 0.9999) * total;
      float f0 = floor(framePos);
      texCol = sampleAtlasFrame(f0, topDownUv);
      if (vFlipbook.w > 0.5) {
        float f1 = min(total - 1.0, f0 + 1.0);
        texCol = mix(texCol, sampleAtlasFrame(f1, topDownUv), fract(framePos));
      }
    } else {
      vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, topDownUv.x), mix(vUvRect.y, vUvRect.w, topDownUv.y));
      texCol = texture(uAtlasTex, mapped);
    }
  } else {
    float r = length(vUv * 2.0 - 1.0);
    if (r > 1.0) discard;
    texCol.a = exp(-3.6 * r * r);
  }

  float alpha = texCol.a * curveCol.a;
  if (alpha < 0.0005) discard;
  fragColor = vec4(texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr), alpha);
}
`;

function createAtlasChannel(capacity, additive) {
  return {
    capacity,
    additive,
    p0: new Float32Array(capacity * 4),
    p1: new Float32Array(capacity * 4),
    p2: new Float32Array(capacity * 4),
    p3: new Float32Array(capacity * 4),
    p4: new Float32Array(capacity * 4),
    p5: new Float32Array(capacity * 4),
    p6: new Float32Array(capacity * 4),
    p7: new Float32Array(capacity * 4),
    cursor: 0,
    totalEmitted: 0,
    dirtyStart: 0,
    dirtyCount: 0,
    wrapCount: 0,
    /** @type {Array<{offset:number,count:number}>} */
    lastDirtyRanges: [],
    /** @type {object | null} */
    threeMesh: null,
    /** @type {object[] | null} */
    threeAttrs: null,
    /** @type {object | null} */
    threeMat: null,
    /** @type {WebGLVertexArrayObject | null} */
    glVao: null,
    /** @type {WebGLBuffer[] | null} */
    glVbos: null,
  };
}

function compileWebGL2Program(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'Atlas VFX shader compile error';
      gl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'Atlas VFX program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

/**
 * Computes analytical + GPU-matched particle position at `age` seconds for trail/follow sync.
 * @param {number} x0
 * @param {number} y0
 * @param {number} z0
 * @param {number} vx
 * @param {number} vy
 * @param {number} vz
 * @param {number} gravity
 * @param {number} drag
 * @param {number} noiseStrength
 * @param {number} noiseFreq
 * @param {number} phase
 * @param {number} age
 * @param {boolean} is2D
 * @param {Float32Array | number[]} outPos
 * @param {number} [orbitalY=0]
 * @param {number} [centerOffX=0]
 * @param {number} [centerOffZ=0]
 */
export function evaluateAtlasParticlePosition(
  x0, y0, z0,
  vx, vy, vz,
  gravity, drag,
  noiseStrength, noiseFreq, phase,
  age, is2D, outPos,
  orbitalY = 0, centerOffX = 0, centerOffZ = 0,
  noiseYScale = 1,
) {
  const disp = drag > 0.001 ? ((1 - Math.exp(-drag * age)) / drag) : age;
  const gY = is2D ? gravity : -gravity;
  let px = x0 + vx * disp;
  let py = y0 + vy * disp + 0.5 * gY * age * age;
  let pz = z0 + vz * disp;
  if (!is2D && Math.abs(orbitalY) > 0.0001) {
    const cx = x0 - centerOffX;
    const cz = z0 - centerOffZ;
    const rx = px - cx;
    const rz = pz - cz;
    const oa = orbitalY * age;
    const oc = Math.cos(oa);
    const os = Math.sin(oa);
    px = cx + rx * oc - rz * os;
    pz = cz + rx * os + rz * oc;
  }
  if (noiseStrength > 0.001) {
    const nf = Math.max(0.05, noiseFreq);
    const ph = phase * 6.283185307179586;
    const wt = age * nf * 3.141592653589793;
    const env = noiseStrength * Math.min(1.0, age * 1.5) * (is2D ? 12.0 : 0.45);
    if (is2D) {
      px += Math.sin(wt + ph) * Math.cos(wt * 0.73 + ph) * env;
      py += Math.cos(wt * 1.17 + ph) * env * noiseYScale;
    } else {
      px += Math.sin(wt + ph) * Math.cos(wt * 0.73 + ph * 1.3) * env;
      py += Math.sin(wt * 1.17 + ph * 2.1) * env * noiseYScale;
      pz += Math.cos(wt * 0.89 + ph * 1.7) * env;
    }
  }
  outPos[0] = px;
  outPos[1] = py;
  outPos[2] = pz;
  return outPos;
}

/**
 * Textured, flipbook, and curve-driven zero-GC GPU particle pool supporting
 * billboard, horizontal ground, and velocity-stretched modes across 3D/WebGL2/Canvas2D/Headless.
 * @param {object} [options]
 * @param {string} [options.mode='headless']
 * @param {object | null} [options.THREE=null]
 * @param {object | null} [options.scene=null]
 * @param {WebGL2RenderingContext | null} [options.gl=null]
 * @param {number} [options.maxParticles]
 * @param {boolean} [options.is2D]
 * @param {ReturnType<typeof createVisualPrng>} [options.prng]
 * @param {object | null} [options.atlasTexture=null]
 * @param {Record<string, readonly number[]> | null} [options.atlasRegions=null]
 */
export function createAtlasParticlePool({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  gl = /** @type {WebGL2RenderingContext | null} */ (null),
  maxParticles = mode === 'canvas2d' ? 512 : 8192,
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  prng = createVisualPrng(0x9e3779b9),
  atlasTexture = /** @type {object | null} */ (null),
  atlasRegions = /** @type {Record<string, readonly number[]> | null} */ (null),
} = {}) {
  const capacity = Math.max(1, maxParticles | 0);
  const normalPool = createAtlasChannel(capacity, false);
  const additivePool = createAtlasChannel(capacity, true);
  const channels = [normalPool, additivePool];
  const lut = createCurveLutTable(THREE);

  /** @type {Record<string, readonly number[]>} */
  let regions = atlasRegions ? { ...atlasRegions } : { ...PROCEDURAL_VFX_ATLAS_REGIONS };
  /** @type {object | null} */
  let activeAtlasTex = atlasTexture;
  /** @type {HTMLCanvasElement | OffscreenCanvas | null} */
  let activeAtlasCanvas = null;

  if (!activeAtlasTex && (mode === '3d' || mode === 'webgl2d' || mode === 'canvas2d')) {
    const proc = createProceduralVfxAtlas(THREE);
    activeAtlasTex = proc.texture;
    activeAtlasCanvas = proc.canvas;
    if (!atlasRegions) regions = { ...proc.regions };
  }

  let simTime = 0;
  let glProg = /** @type {WebGLProgram | null} */ (null);
  let glQuadVbo = /** @type {WebGLBuffer | null} */ (null);
  let glLutTex = /** @type {WebGLTexture | null} */ (null);
  let glAtlasTex = /** @type {WebGLTexture | null} */ (null);
  let glUniforms = /** @type {Record<string, WebGLUniformLocation | null> | null} */ (null);
  let disposed = false;
  const scratchRgba = new Float32Array(4);
  const scratchTint = new Float32Array(3);
  const scratchPos = new Float32Array(3);

  function updateThreeAtlasUniforms(ch) {
    if (!ch.threeMat) return;
    ch.threeMat.uniforms.uAtlasTex.value = activeAtlasTex;
    ch.threeMat.uniforms.uHasAtlas.value = activeAtlasTex ? 1.0 : 0.0;
    ch.threeMat.uniforms.uFlipV.value = activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0;
  }

  function initThreeChannel(ch) {
    if (!THREE || !scene || !THREE.InstancedBufferGeometry || !THREE.PlaneGeometry) return;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = capacity;

    const arrays = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7];
    const attrs = [];
    for (let i = 0; i < arrays.length; i++) {
      const attr = new THREE.InstancedBufferAttribute(arrays[i], 4);
      if (THREE.DynamicDrawUsage) attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(`aAtlasP${i}`, attr);
      attrs.push(attr);
    }

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    const mat = new MatCtor({
      vertexShader: ATLAS_PARTICLE_VERTEX_GLSL,
      fragmentShader: ATLAS_PARTICLE_FRAGMENT_GLSL,
      uniforms: {
        uTime: { value: 0 },
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uCurveLut: { value: lut.texture },
        uAtlasTex: { value: activeAtlasTex },
        uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
        uFlipV: { value: activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0 },
        uSoftDepthTex: { value: null },
        uHasSoftDepth: { value: 0.0 },
        uSoftFade: { value: 0.45 },
        uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } },
        uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: ch.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.PARTICLES;
    mesh.name = ch.additive ? 'HGameVfxAtlasAdditive' : 'HGameVfxAtlasNormal';
    scene.add(mesh);

    ch.threeMesh = mesh;
    ch.threeAttrs = attrs;
    ch.threeMat = mat;
  }

  function uploadWebGL2Atlas(src) {
    if (!gl || !src) return;
    if (!glAtlasTex) glAtlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glAtlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function initWebGL2() {
    if (!gl || typeof gl.createVertexArray !== 'function') return;
    glProg = compileWebGL2Program(gl, ATLAS_PARTICLE_WEBGL2_2D_VS, ATLAS_PARTICLE_WEBGL2_2D_FS);
    glUniforms = {
      uTime: gl.getUniformLocation(glProg, 'uTime'),
      uCamPos: gl.getUniformLocation(glProg, 'uCamPos'),
      uCamZoom: gl.getUniformLocation(glProg, 'uCamZoom'),
      uViewSize: gl.getUniformLocation(glProg, 'uViewSize'),
      uCurveLut: gl.getUniformLocation(glProg, 'uCurveLut'),
      uAtlasTex: gl.getUniformLocation(glProg, 'uAtlasTex'),
      uHasAtlas: gl.getUniformLocation(glProg, 'uHasAtlas'),
    };
    glLutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glLutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.width, lut.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.bytes);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (activeAtlasCanvas) uploadWebGL2Atlas(activeAtlasCanvas);

    const quadVerts = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]);
    glQuadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7];
      const vbos = [];
      for (let i = 0; i < dataArrs.length; i++) {
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, dataArrs[i], gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(i + 1);
        gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(i + 1, 1);
        vbos.push(vbo);
      }
      ch.glVao = vao;
      ch.glVbos = vbos;
    }
    gl.bindVertexArray(null);
  }

  if (mode === '3d' && THREE && scene) {
    initThreeChannel(normalPool);
    initThreeChannel(additivePool);
  } else if (mode === 'webgl2d' && gl) {
    initWebGL2();
  }

  /**
   * Binds a custom atlas texture/canvas and region UV dictionary `[u0, v0, u1, v1]`.
   * @param {object | null} textureOrCanvas
   * @param {Record<string, readonly number[]>} [newRegions]
   */
  function setAtlas(textureOrCanvas, newRegions) {
    if (textureOrCanvas && textureOrCanvas.isTexture) {
      activeAtlasTex = textureOrCanvas;
      activeAtlasCanvas = textureOrCanvas.image ?? null;
    } else {
      activeAtlasCanvas = textureOrCanvas;
      if (THREE && THREE.CanvasTexture && textureOrCanvas) {
        activeAtlasTex = new THREE.CanvasTexture(textureOrCanvas);
        activeAtlasTex.flipY = false;
        activeAtlasTex.needsUpdate = true;
      } else {
        activeAtlasTex = textureOrCanvas;
      }
    }
    if (newRegions) regions = { ...newRegions };
    updateThreeAtlasUniforms(normalPool);
    updateThreeAtlasUniforms(additivePool);
    if (gl && activeAtlasCanvas) uploadWebGL2Atlas(activeAtlasCanvas);
  }

  function resolveUvRect(opts) {
    if (Array.isArray(opts.uvRect) && opts.uvRect.length >= 4) return opts.uvRect;
    const regionKey = opts.flipbook?.region || opts.sprite;
    if (regionKey && regions[regionKey]) return regions[regionKey];
    return [0, 0, 1, 1];
  }

  function setDepthTexture(depthTexture, { near = 0.1, far = 200, width = 1280, height = 720, softFade = 0.45 } = {}) {
    for (let c = 0; c < channels.length; c++) {
      const mat = channels[c].threeMat;
      if (!mat) continue;
      mat.uniforms.uSoftDepthTex.value = depthTexture;
      mat.uniforms.uHasSoftDepth.value = depthTexture ? 1.0 : 0.0;
      mat.uniforms.uSoftFade.value = softFade;
      mat.uniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      mat.uniforms.uCamNearFar.value.set(near, far);
    }
  }

  /**
   * Emits a single textured/curve particle and returns its slot index.
   * @param {object} [opts]
   * @returns {number} Slot index in its channel
   */
  function emit(opts = {}) {
    const additive = opts.blend === 'additive' || Boolean(opts.additive);
    const ch = additive ? additivePool : normalPool;
    const idx = ch.cursor;
    const i4 = idx * 4;

    const curveRow = opts.curveRow !== undefined
      ? opts.curveRow
      : lut.compile(opts.colorCurve, opts.sizeCurve);
    const uv = resolveUvRect(opts);
    const fb = opts.flipbook;
    const renderMode = typeof opts.renderMode === 'number'
      ? opts.renderMode
      : opts.renderMode === 'horizontal'
        ? VFX_RENDER_MODE.HORIZONTAL
        : opts.renderMode === 'stretched'
          ? VFX_RENDER_MODE.STRETCHED
          : opts.renderMode === 'vertical'
            ? VFX_RENDER_MODE.VERTICAL
            : VFX_RENDER_MODE.BILLBOARD;

    const tintRgb24 = opts.tintRgb24 !== undefined
      ? opts.tintRgb24
      : opts.tint !== undefined
        ? packRgb24(
          Math.round((opts.tint[0] ?? 1) * 255),
          Math.round((opts.tint[1] ?? 1) * 255),
          Math.round((opts.tint[2] ?? 1) * 255),
        )
        : 0xffffff;

    ch.p0[i4] = opts.x ?? 0;
    ch.p0[i4 + 1] = opts.y ?? 0;
    ch.p0[i4 + 2] = opts.z ?? 0;
    ch.p0[i4 + 3] = simTime - Math.max(0, opts.initialAge ?? 0);

    ch.p1[i4] = opts.vx ?? 0;
    ch.p1[i4 + 1] = opts.vy ?? 0;
    ch.p1[i4 + 2] = opts.vz ?? 0;
    ch.p1[i4 + 3] = opts.duration ?? 0.5;

    ch.p2[i4] = opts.sizeStart ?? 1.0;
    ch.p2[i4 + 1] = opts.gravity ?? 0;
    ch.p2[i4 + 2] = opts.staticPos ? -1.0 : (opts.drag ?? 0);
    ch.p2[i4 + 3] = curveRow;

    ch.p3[i4] = opts.rotation ?? 0;
    ch.p3[i4 + 1] = opts.angularVel ?? 0;
    ch.p3[i4 + 2] = opts.hdr ?? 1.0;
    ch.p3[i4 + 3] = renderMode;

    ch.p4[i4] = uv[0] ?? 0;
    ch.p4[i4 + 1] = uv[1] ?? 0;
    ch.p4[i4 + 2] = uv[2] ?? 1;
    ch.p4[i4 + 3] = uv[3] ?? 1;

    ch.p5[i4] = fb ? Math.max(1, fb.cols | 0) : 1;
    ch.p5[i4 + 1] = fb ? Math.max(1, fb.rows | 0) : 1;
    ch.p5[i4 + 2] = fb ? (fb.cycles ?? 1) : 1;
    ch.p5[i4 + 3] = fb && fb.blend !== false ? 1.0 : 0.0;

    const nStr = opts.noiseStrength ?? 0;
    const nYScale = renderMode === VFX_RENDER_MODE.STRETCHED
      ? (opts.stretch ?? 0.8)
      : (opts.noiseYScale ?? 1.0);
    ch.p6[i4] = nStr;
    ch.p6[i4 + 1] = opts.noiseFreq ?? 0.5;
    ch.p6[i4 + 2] = nYScale;
    ch.p6[i4 + 3] = opts.phase !== undefined ? opts.phase : prng.nextFloat();

    ch.p7[i4] = tintRgb24;
    ch.p7[i4 + 1] = opts.orbitalY ?? 0;
    ch.p7[i4 + 2] = opts.centerOffX ?? 0;
    ch.p7[i4 + 3] = opts.centerOffZ ?? 0;

    if (ch.dirtyCount === 0) ch.dirtyStart = idx;
    ch.dirtyCount = Math.min(ch.capacity, ch.dirtyCount + 1);

    const next = idx + 1;
    if (next >= ch.capacity) {
      ch.cursor = 0;
      ch.wrapCount += 1;
    } else {
      ch.cursor = next;
    }
    ch.totalEmitted += 1;
    return idx;
  }

  function markSlotDirty(ch, idx) {
    if (ch.dirtyCount === 0) {
      ch.dirtyStart = idx;
      ch.dirtyCount = 1;
      return;
    }
    if (idx >= ch.dirtyStart && idx < ch.dirtyStart + ch.dirtyCount) return;
    // Expand conservatively or flush via full-range upload when random-access update occurs.
    ch.dirtyStart = 0;
    ch.dirtyCount = Math.min(ch.capacity, Math.max(ch.totalEmitted, idx + 1));
  }

  function updateSlot(additive, idx, x, y, z, vx, vy, vz) {
    const ch = additive ? additivePool : normalPool;
    if (idx < 0 || idx >= ch.capacity) return;
    const i4 = idx * 4;
    ch.p0[i4] = x;
    ch.p0[i4 + 1] = y;
    ch.p0[i4 + 2] = z;
    ch.p1[i4] = vx;
    ch.p1[i4 + 1] = vy;
    ch.p1[i4 + 2] = vz;
    markSlotDirty(ch, idx);
  }

  function killSlot(additive, idx) {
    const ch = additive ? additivePool : normalPool;
    if (idx < 0 || idx >= ch.capacity) return;
    ch.p1[idx * 4 + 3] = 0;
    markSlotDirty(ch, idx);
  }

  function flushChannel(ch) {
    if (ch.dirtyCount <= 0) return;
    if (ch.threeAttrs) {
      for (let i = 0; i < ch.threeAttrs.length; i++) {
        submitRingBufferRanges(
          ch.threeAttrs[i],
          ch.dirtyStart,
          ch.dirtyCount,
          ch.capacity,
          4,
          i === 0 ? ch.lastDirtyRanges : null,
        );
      }
    } else {
      submitRingBufferRanges(null, ch.dirtyStart, ch.dirtyCount, ch.capacity, 4, ch.lastDirtyRanges);
      if (gl && ch.glVbos) {
        const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7];
        for (let r = 0; r < ch.lastDirtyRanges.length; r++) {
          const range = ch.lastDirtyRanges[r];
          const byteOff = range.offset * 16;
          const floatStart = range.offset * 4;
          const floatEnd = floatStart + range.count * 4;
          for (let a = 0; a < dataArrs.length; a++) {
            gl.bindBuffer(gl.ARRAY_BUFFER, ch.glVbos[a]);
            gl.bufferSubData(gl.ARRAY_BUFFER, byteOff, dataArrs[a].subarray(floatStart, floatEnd));
          }
        }
      }
    }
    ch.dirtyCount = 0;
  }

  function flushDirty() {
    lut.flush();
    flushChannel(normalPool);
    flushChannel(additivePool);
  }

  function update(visualDt) {
    simTime += Math.max(0, visualDt);
    flushDirty();
    if (normalPool.threeMat) normalPool.threeMat.uniforms.uTime.value = simTime;
    if (additivePool.threeMat) additivePool.threeMat.uniforms.uTime.value = simTime;
  }

  function renderWebGL2(camera, viewWidth, viewHeight) {
    if (!gl || !glProg || disposed) return;
    flushDirty();
    if (glLutTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glLutTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, lut.width, lut.height, gl.RGBA, gl.UNSIGNED_BYTE, lut.bytes);
    }

    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(glProg);
    gl.uniform1f(glUniforms.uTime, simTime);
    gl.uniform2f(glUniforms.uCamPos, camera?.x ?? 0, camera?.y ?? 0);
    gl.uniform1f(glUniforms.uCamZoom, camera?.zoom ?? 1);
    gl.uniform2f(glUniforms.uViewSize, viewWidth, viewHeight);
    gl.uniform1i(glUniforms.uCurveLut, 0);
    gl.uniform1i(glUniforms.uAtlasTex, 1);
    gl.uniform1f(glUniforms.uHasAtlas, glAtlasTex ? 1.0 : 0.0);

    if (glAtlasTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glAtlasTex);
    }

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const activeCount = Math.min(ch.totalEmitted, ch.capacity);
      if (activeCount <= 0 || !ch.glVao) continue;
      gl.blendFunc(gl.SRC_ALPHA, ch.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(ch.glVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);
    }

    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (!prevBlend) gl.disable(gl.BLEND);
    if (prevDepth) gl.enable(gl.DEPTH_TEST);
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const count = Math.min(ch.totalEmitted, ch.capacity);
      if (count <= 0) continue;
      ctx.globalCompositeOperation = ch.additive ? 'lighter' : 'source-over';
      for (let i = 0; i < count; i++) {
        const i4 = i * 4;
        const age = simTime - ch.p0[i4 + 3];
        const dur = ch.p1[i4 + 3];
        if (dur <= 0 || age < 0 || age >= dur) continue;
        const t = age / dur;
        const curveRow = ch.p2[i4 + 3];
        lut.sampleColor(curveRow, t, scratchRgba);
        if (scratchRgba[3] < 0.01) continue;

        evaluateAtlasParticlePosition(
          ch.p0[i4], ch.p0[i4 + 1], ch.p0[i4 + 2],
          ch.p1[i4], ch.p1[i4 + 1], ch.p1[i4 + 2],
          ch.p2[i4 + 1], ch.p2[i4 + 2],
          ch.p6[i4], ch.p6[i4 + 1], ch.p6[i4 + 3],
          age, true, scratchPos,
        );

        const sx = (scratchPos[0] - camX) * zoom + halfW;
        const sy = (scratchPos[1] - camY) * zoom + halfH;
        const size = ch.p2[i4] * lut.sampleSize(curveRow, t) * zoom;
        if (size <= 0.5) continue;

        ctx.globalAlpha = Math.max(0, Math.min(1, scratchRgba[3]));
        unpackRgb24Into(ch.p7[i4], scratchTint);
        const r8 = (Math.min(1, scratchRgba[0] * scratchTint[0] * ch.p3[i4 + 2]) * 255) | 0;
        const g8 = (Math.min(1, scratchRgba[1] * scratchTint[1] * ch.p3[i4 + 2]) * 255) | 0;
        const b8 = (Math.min(1, scratchRgba[2] * scratchTint[2] * ch.p3[i4 + 2]) * 255) | 0;

        if (activeAtlasCanvas && typeof ctx.drawImage === 'function') {
          const cols = Math.max(1, ch.p5[i4] | 0);
          const rows = Math.max(1, ch.p5[i4 + 1] | 0);
          const cycles = Math.max(0.01, ch.p5[i4 + 2]);
          const total = cols * rows;
          const frame = total > 1 ? Math.min(total - 1, Math.floor(((t * cycles) % 1) * total)) : 0;
          const col = frame % cols;
          const row = (frame / cols) | 0;
          const aw = activeAtlasCanvas.width || 512;
          const ah = activeAtlasCanvas.height || 512;
          const rx = ch.p4[i4] * aw;
          const ry = ch.p4[i4 + 1] * ah;
          const rw = (ch.p4[i4 + 2] - ch.p4[i4]) * aw;
          const rh = (ch.p4[i4 + 3] - ch.p4[i4 + 1]) * ah;
          const cw = rw / cols;
          const chPx = rh / rows;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(ch.p3[i4] + ch.p3[i4 + 1] * age);
          ctx.drawImage(
            activeAtlasCanvas,
            rx + col * cw, ry + row * chPx, cw, chPx,
            -size * 0.5, -size * 0.5, size, size,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = `rgb(${r8},${g8},${b8})`;
          ctx.beginPath();
          ctx.arc(sx, sy, size * 0.5, 0, 6.2831853);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      ch.cursor = 0;
      ch.totalEmitted = 0;
      ch.dirtyStart = 0;
      ch.dirtyCount = 0;
      ch.wrapCount = 0;
      ch.lastDirtyRanges.length = 0;
      ch.p0.fill(0);
      ch.p1.fill(0);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (ch.threeMesh) {
        scene?.remove?.(ch.threeMesh);
        ch.threeMesh.geometry?.dispose?.();
        ch.threeMat?.dispose?.();
      }
      if (gl && ch.glVao) {
        gl.deleteVertexArray(ch.glVao);
        if (ch.glVbos) {
          for (let i = 0; i < ch.glVbos.length; i++) gl.deleteBuffer(ch.glVbos[i]);
        }
      }
    }
    if (gl && glQuadVbo) gl.deleteBuffer(glQuadVbo);
    if (gl && glLutTex) gl.deleteTexture(glLutTex);
    if (gl && glAtlasTex) gl.deleteTexture(glAtlasTex);
    if (gl && glProg) gl.deleteProgram(glProg);
    lut.dispose();
  }

  return {
    capacity,
    lut,
    regions,
    compileCurves: lut.compile,
    setAtlas,
    setDepthTexture,
    emit,
    updateSlot,
    killSlot,
    flushDirty,
    update,
    renderWebGL2,
    renderCanvas2D,
    reset,
    dispose,
    get time() { return simTime; },
    getStats() {
      return {
        capacity,
        curveRows: lut.rowCount,
        normalCursor: normalPool.cursor,
        additiveCursor: additivePool.cursor,
        normalTotal: normalPool.totalEmitted,
        additiveTotal: additivePool.totalEmitted,
      };
    },
  };
}

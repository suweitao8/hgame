import {
  VFX_RENDER_ORDERS,
  createVisualPrng,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';
import { applyVfxDepthState, DEFAULT_VFX_DEPTH_TEST, getVfxDepthTestIndex, VFX_DEPTH_TESTS } from './vfx-depth-state.js';
import { VFX_FLIPBOOK_GLSL } from './vfx-flipbook.js';
import {
  VFX_COMMON_GLSL,
  VFX_UBER_LUT_GLSL,
  VFX_UBER_FRAGMENT_GLSL,
  createUberMaterialLut,
  compileCustomDataCurves,
  evaluateCustomDataChannel,
} from './vfx-shader-chunks.js';

const TWO_PI = Math.PI * 2;

function wrapAngle02Pi(rad) {
  const r = Number(rad) || 0;
  return ((r % TWO_PI) + TWO_PI) % TWO_PI;
}

function wrapAngleSignedPi(rad) {
  let r = wrapAngle02Pi(rad);
  if (r > Math.PI) r -= TWO_PI;
  return r;
}

function pack2x12Pos(a, b, maxA, maxB) {
  const qa = Math.max(0, Math.min(4095, Math.round((Math.max(0, Math.min(maxA, Number(a) || 0)) / maxA) * 4095)));
  const qb = Math.max(0, Math.min(4095, Math.round((Math.max(0, Math.min(maxB, Number(b) || 0)) / maxB) * 4095)));
  return qa * 4096 + qb;
}

function pack2x12Sym(a, b, absA, absB) {
  const ca = Math.max(-absA, Math.min(absA, Number(a) || 0));
  const cb = Math.max(-absB, Math.min(absB, Number(b) || 0));
  const qa = Math.max(0, Math.min(4094, Math.round(((ca + absA) / (2 * absA)) * 4094)));
  const qb = Math.max(0, Math.min(4094, Math.round(((cb + absB) / (2 * absB)) * 4094)));
  return qa * 4096 + qb;
}

function pack2x12Mixed(a, b, maxA, absB) {
  const qa = Math.max(0, Math.min(4095, Math.round((Math.max(0, Math.min(maxA, Number(a) || 0)) / maxA) * 4095)));
  const cb = Math.max(-absB, Math.min(absB, Number(b) || 0));
  const qb = Math.max(0, Math.min(4094, Math.round(((cb + absB) / (2 * absB)) * 4094)));
  return qa * 4096 + qb;
}

function packUvPair(u, v) {
  const qu = Math.max(0, Math.min(3840, Math.round(Math.max(0, Math.min(1, Number(u) || 0)) * 3840)));
  const qv = Math.max(0, Math.min(3840, Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 3840)));
  return qu * 4096 + qv;
}

function unpack2x12Pos(packed, maxA, maxB, out = [0, 0]) {
  const v = Math.max(0, Math.min(16777215, Math.floor((Number(packed) || 0) + 0.5)));
  const qa = Math.floor(v / 4096);
  const qb = v - qa * 4096;
  out[0] = (qa / 4095) * maxA;
  out[1] = (qb / 4095) * maxB;
  return out;
}

function unpack2x12Sym(packed, absA, absB, out = [0, 0]) {
  const v = Math.max(0, Math.min(16777215, Math.floor((Number(packed) || 0) + 0.5)));
  const qa = Math.floor(v / 4096);
  const qb = v - qa * 4096;
  out[0] = (qa / 4094) * (2 * absA) - absA;
  out[1] = (qb / 4094) * (2 * absB) - absB;
  return out;
}

function unpack2x12Mixed(packed, maxA, absB, out = [0, 0]) {
  const v = Math.max(0, Math.min(16777215, Math.floor((Number(packed) || 0) + 0.5)));
  const qa = Math.floor(v / 4096);
  const qb = v - qa * 4096;
  out[0] = (qa / 4095) * maxA;
  out[1] = (qb / 4094) * (2 * absB) - absB;
  return out;
}

function unpackUvPair(packed, out = [0, 0]) {
  const v = Math.max(0, Math.min(16777215, Math.floor((Number(packed) || 0) + 0.5)));
  const qu = Math.floor(v / 4096);
  const qv = v - qu * 4096;
  out[0] = Math.min(1, qu / 3840);
  out[1] = Math.min(1, qv / 3840);
  return out;
}

export {
  unpack2x12Pos,
  unpack2x12Sym,
  unpack2x12Mixed,
  unpackUvPair,
};

export const VFX_RENDER_MODE = Object.freeze({
  BILLBOARD: 0,
  HORIZONTAL: 1,
  STRETCHED: 2,
  MESH: 3,
  VERTICAL: 4,
});

const LUT_HALF = 128;
const LUT_WIDTH = 256;
const LUT_ROWS = 1024;
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
  const copy = stops.slice(0, 64).map((item) => {
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

function buildCurveKey(colorCurve, sizeCurve, sizeYCurve = null, velCurve = null) {
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
  if (Array.isArray(sizeYCurve) && sizeYCurve.length > 0) {
    for (let i = 0; i < sizeYCurve.length; i++) {
      const s = sizeYCurve[i];
      k += `y${Number(s[0]).toFixed(3)}:${Number(s[1]).toFixed(3)};`;
    }
  }
  if (Array.isArray(velCurve) && velCurve.length > 0) {
    for (let i = 0; i < velCurve.length; i++) {
      const s = velCurve[i];
      k += `v${Number(s[0]).toFixed(3)}:${Number(s[1]).toFixed(3)};`;
    }
  }
  return k;
}

/**
 * Compiles color/size/velocity curves into a zero-GC 256x1024 RGBA8 lookup table + DataTexture.
 * Left 128 texels encode RGBA colorCurve; right 128 texels encode 16-bit sizeX (.rg),
 * 8-bit sizeY (.b), and 8-bit integrated velocity displacement (.a).
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

  function evalSignedCurve(stops, t) {
    if (stops.length === 0) return 1;
    if (t <= stops[0][0]) return stops[0][1];
    const last = stops[stops.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        const span = Math.max(1e-6, stops[i + 1][0] - stops[i][0]);
        const f = (t - stops[i][0]) / span;
        return stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f;
      }
    }
    return last[1];
  }

  function compile(colorCurveRaw, sizeCurveRaw, sizeYCurveRaw = null, velocityCurveRaw = null) {
    const colorCurve = normalizeStops(colorCurveRaw, true);
    const sizeCurve = normalizeStops(sizeCurveRaw, false);
    const sizeYCurve = Array.isArray(sizeYCurveRaw) && sizeYCurveRaw.length > 0
      ? normalizeStops(sizeYCurveRaw, false)
      : null;
    const velCurve = Array.isArray(velocityCurveRaw) && velocityCurveRaw.length > 0
      ? velocityCurveRaw
        .filter((k) => Array.isArray(k) && k.length >= 2)
        .map((k) => [Math.max(0, Math.min(1, Number(k[0]) || 0)), Number(k[1]) || 0])
        .sort((a, b) => a[0] - b[0])
      : null;

    const key = buildCurveKey(colorCurve, sizeCurve, sizeYCurve, velCurve);
    const cached = keyToRow.get(key);
    if (cached !== undefined) return cached;

    const row = rowCount < LUT_ROWS ? rowCount++ : (LUT_ROWS - 1);
    keyToRow.set(key, row);

    const rowBase = row * LUT_WIDTH * 4;
    let velIntegral = 0;
    const dtStep = 1 / (LUT_HALF - 1);
    for (let i = 0; i < LUT_HALF; i++) {
      const t = i * dtStep;
      evaluateColorCurve(colorCurve, t, scratchRgba);
      const cOff = rowBase + i * 4;
      bytes[cOff] = Math.max(0, Math.min(255, Math.round(scratchRgba[0] * 255)));
      bytes[cOff + 1] = Math.max(0, Math.min(255, Math.round(scratchRgba[1] * 255)));
      bytes[cOff + 2] = Math.max(0, Math.min(255, Math.round(scratchRgba[2] * 255)));
      bytes[cOff + 3] = Math.max(0, Math.min(255, Math.round(scratchRgba[3] * 255)));

      const sz = Math.max(0, Math.min(SIZE_CURVE_MAX, evaluateSizeCurve(sizeCurve, t)));
      const q = Math.round((sz / SIZE_CURVE_MAX) * 65535);
      const szY = sizeYCurve
        ? Math.max(0, Math.min(SIZE_CURVE_MAX, evaluateSizeCurve(sizeYCurve, t)))
        : sz;
      if (velCurve && i > 0) {
        velIntegral += evalSignedCurve(velCurve, (i - 0.5) * dtStep) * dtStep;
      }
      const encodedVelDisp = velCurve
        ? Math.max(0, Math.min(255, Math.round(((velIntegral + 4.0) / 8.0) * 255)))
        : Math.max(0, Math.min(255, Math.round(((t + 4.0) / 8.0) * 255)));
      const sOff = rowBase + (LUT_HALF + i) * 4;
      bytes[sOff] = (q >> 8) & 255;
      bytes[sOff + 1] = q & 255;
      bytes[sOff + 2] = Math.max(0, Math.min(255, Math.round((szY / SIZE_CURVE_MAX) * 255)));
      bytes[sOff + 3] = encodedVelDisp;
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

  function sampleSizeY(row, t) {
    const r = Math.max(0, Math.min(LUT_ROWS - 1, row | 0));
    const s = Math.max(0, Math.min(1, t)) * (LUT_HALF - 1);
    const i0 = Math.floor(s);
    const i1 = Math.min(LUT_HALF - 1, i0 + 1);
    const f = s - i0;
    const base = r * LUT_WIDTH * 4;
    const v0 = (bytes[base + (LUT_HALF + i0) * 4 + 2] / 255) * SIZE_CURVE_MAX;
    const v1 = (bytes[base + (LUT_HALF + i1) * 4 + 2] / 255) * SIZE_CURVE_MAX;
    return v0 + (v1 - v0) * f;
  }

  function sampleVelDisp(row, t) {
    const r = Math.max(0, Math.min(LUT_ROWS - 1, row | 0));
    const s = Math.max(0, Math.min(1, t)) * (LUT_HALF - 1);
    const i0 = Math.floor(s);
    const i1 = Math.min(LUT_HALF - 1, i0 + 1);
    const f = s - i0;
    const base = r * LUT_WIDTH * 4;
    const v0 = (bytes[base + (LUT_HALF + i0) * 4 + 3] / 255) * 8.0 - 4.0;
    const v1 = (bytes[base + (LUT_HALF + i1) * 4 + 3] / 255) * 8.0 - 4.0;
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
    sampleSizeY,
    sampleVelDisp,
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
attribute vec4 aAtlasP2; // sizeStart, gravity, drag, packedRowAndFlags
attribute vec4 aAtlasP3; // packedRotZ, packedHdrEmission, packedPivot, packedStretchScales
attribute vec4 aAtlasP4; // packedUv0, packedUv1, packedFlipbook, tintRgb24
attribute vec4 aAtlasP5; // packedNoise, packedScaleY, orbitalY, packedPhaseSpaceFlags
attribute vec4 aAtlasP6; // packedCenterOffXZ, packedAccelXZ, packedRotXY, packedSpinXY
attribute vec4 aAtlasP7; // packedCutoffCamFade, packedUvScaleOffX, packedUvOffYAndDissolve, uberMatRow (-1 = legacy)
attribute vec4 aCustom1;
attribute vec4 aCustom2;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D uCurveLut;
uniform sampler2D uMaterialLut;
uniform sampler2D uAtlasTex;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uTime;
uniform float uIs2D;
uniform vec3 uWind;
uniform vec3 uEffectDeltas[32];

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;
varying vec4 vMatParams;   // alphaCutoff, emissionBoost, dissolveStart, cullFlag
varying vec4 vUvTransform; // scaleX, scaleY, offX, offY
varying vec3 vFadesAndTexture; // camera fade, disable soft depth, use white base
varying vec4 vCustom1;
varying float vUberMatRow;
varying vec3 vNormalView;
varying vec3 vViewDirView;

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

vec2 unpack2x12Pos(float packedVal, float maxA, float maxB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4095.0) * maxA, (qb / 4095.0) * maxB);
}

vec2 unpack2x12Sym(float packedVal, float absA, float absB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4094.0) * (2.0 * absA) - absA, (qb / 4094.0) * (2.0 * absB) - absB);
}

vec2 unpack2x12Mixed(float packedVal, float maxA, float absB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4095.0) * maxA, (qb / 4094.0) * (2.0 * absB) - absB);
}

vec2 unpackUvPair(float packedVal) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qu = floor(v / 4096.0);
  float qv = v - qu * 4096.0;
  return clamp(vec2(qu, qv) / 3840.0, 0.0, 1.0);
}

float sampleSizeCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture2D(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture2D(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;
  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;
  return mix(s0, s1, f);
}

float sampleSizeYCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture2D(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture2D(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  return mix(t0.b, t1.b, f) * 8.0;
}

float sampleVelDispCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture2D(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture2D(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  return mix(t0.a, t1.a, f) * 8.0 - 4.0;
}

mat3 euler3D(float rx, float ry, float rz) {
  float cx = cos(rx), sx = sin(rx);
  float cy = cos(ry), sy = sin(ry);
  float cz = cos(rz), sz = sin(rz);
  return mat3(
    cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,
    sy * cx, -sx, cy * cx
  );
}

void main() {
  float age = uTime - aAtlasP0.w;
  float dur = aAtlasP1.w;
  float rowWord = floor(max(0.0, aAtlasP2.w) + 0.5);
  float materialFlags = floor(rowWord / 1048576.0); rowWord -= materialFlags * 1048576.0;
  float cullFlag = floor(rowWord / 262144.0); rowWord -= cullFlag * 262144.0;
  float hasSizeSep = step(131071.5, rowWord); rowWord -= hasSizeSep * 131072.0;
  float noiseDamp = step(65535.5, rowWord); rowWord -= noiseDamp * 65536.0;
  float hasVelCurve = step(32767.5, rowWord); rowWord -= hasVelCurve * 32768.0;
  float renderMode = floor(rowWord / 4096.0); rowWord -= renderMode * 4096.0;
  float rawCurve = rowWord;
  bool isPersistent = rawCurve >= 1023.5;
  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
  float curveRow = mod(rawCurve, 1024.0);
  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 rotZPair = unpack2x12Mixed(aAtlasP3.x, 6.2831853, 64.0);
  vec2 hdrEmPair = unpack2x12Pos(aAtlasP3.y, 35.0, 35.0);
  vec2 pivotPair = unpack2x12Sym(aAtlasP3.z, 2.0, 2.0);
  vec2 stretchScales = unpack2x12Pos(aAtlasP3.w, 15.0, 15.0);

  vec2 uv0 = unpackUvPair(aAtlasP4.x);
  vec2 uv1 = unpackUvPair(aAtlasP4.y);
  float fbWord = floor(max(0.0, aAtlasP4.z) + 0.5);
  float cyclesQ = floor(fbWord / 8192.0); fbWord -= cyclesQ * 8192.0;
  float fbBlend = step(4095.5, fbWord); fbWord -= fbBlend * 4096.0;
  float fbRows = floor(fbWord / 64.0) + 1.0;
  float fbCols = mod(fbWord, 64.0) + 1.0;

  vec2 noisePair = unpack2x12Pos(aAtlasP5.x, 35.0, 15.0);
  vec2 scaleYPair = unpack2x12Pos(aAtlasP5.y, 15.0, 15.0);
  float orbitalY = aAtlasP5.z;
  float psWord = floor(max(0.0, aAtlasP5.w) + 0.5);
  float scrollQ = floor(psWord / 262144.0); psWord -= scrollQ * 262144.0;
  float windQ = floor(psWord / 8192.0); psWord -= windQ * 8192.0;
  int slotIdx = int(floor(psWord / 256.0));
  float phaseVal = (psWord - float(slotIdx) * 256.0) / 255.0;
  float noiseScroll = scrollQ * 0.25;
  float windMul = windQ * 0.25;

  vec2 centerOffXZ = unpack2x12Sym(aAtlasP6.x, 64.0, 64.0);
  vec2 accelXZ = unpack2x12Sym(aAtlasP6.y, 64.0, 64.0);
  vec2 rotXY0 = unpack2x12Sym(aAtlasP6.z, 3.14159265, 3.14159265);
  vec2 spinXY = unpack2x12Sym(aAtlasP6.w, 32.0, 32.0);

  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);
  vLifeRatio = t;
  vUv = uv;
  vCurveRow = curveRow;
  vHdr = hdrEmPair.x;
  vUvRect = vec4(uv0, uv1);
  vFlipbook = vec4(fbCols, fbRows, cyclesQ / 32.0, fbBlend);
  vTint = unpackRgb24(aAtlasP4.w);

  vec3 cutCam = unpackRgb24(aAtlasP7.x);
  vec3 uvS = unpackRgb24(aAtlasP7.y);
  vec3 uvOD = unpackRgb24(aAtlasP7.z);
  float alphaCutoff = cutCam.x;
  float camFadeNear = cutCam.y * 16.0;
  float camFadeFar = cutCam.z * 32.0;
  float uvScaleX = max(0.01, uvS.x * 8.0);
  float uvScaleY = max(0.01, uvS.y * 8.0);
  float uvOffX = uvS.z;
  float uvOffY = uvOD.x;
  float dissolveStart = uvOD.y;
  vMatParams = vec4(alphaCutoff, max(0.0, hdrEmPair.y), dissolveStart, cullFlag);
  vUvTransform = vec4(uvScaleX, uvScaleY, uvOffX, uvOffY);
  vFadesAndTexture.yz = vec2(mod(materialFlags, 2.0), floor(materialFlags / 2.0));

  vec3 effDelta = vec3(0.0);
  if (slotIdx > 0) {
    for (int i = 1; i < 32; i++) {
      if (i == slotIdx) effDelta = uEffectDeltas[i];
    }
  }

  float k = aAtlasP2.z;
  vec3 worldPos;
  vec3 curVel;
  if (k < -0.5) {
    worldPos = aAtlasP0.xyz;
    curVel = aAtlasP1.xyz;
  } else {
    float dispFactor;
    float velDecay;
    if (hasVelCurve > 0.5) {
      float vInt = sampleVelDispCurve(curveRow, t);
      dispFactor = vInt * dur;
      float dtStep = 0.015;
      float t1 = min(1.0, t + dtStep);
      float t0 = max(0.0, t - dtStep);
      velDecay = (sampleVelDispCurve(curveRow, t1) - sampleVelDispCurve(curveRow, t0)) / max(0.001, t1 - t0);
    } else {
      dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
      velDecay = (k > 0.001) ? exp(-k * age) : 1.0;
    }
    vec3 gVec = (uIs2D > 0.5)
      ? vec3(accelXZ.x, aAtlasP2.y, accelXZ.y) + uWind * windMul
      : vec3(accelXZ.x, -aAtlasP2.y, accelXZ.y) + uWind * windMul;
    worldPos = aAtlasP0.xyz + aAtlasP1.xyz * dispFactor + 0.5 * gVec * (age * age);
    curVel = aAtlasP1.xyz * velDecay + gVec * age;

    if (abs(orbitalY) > 0.0001 && uIs2D < 0.5) {
      vec2 cxz = aAtlasP0.xz - centerOffXZ;
      vec2 rel = worldPos.xz - cxz;
      float oa = orbitalY * age;
      float oc = cos(oa);
      float os = sin(oa);
      worldPos.xz = cxz + vec2(rel.x * oc - rel.y * os, rel.x * os + rel.y * oc);
      curVel.xz = vec2(curVel.x * oc - curVel.z * os, curVel.x * os + curVel.z * oc);
    }

    float nStr = noisePair.x;
    if (nStr > 0.001) {
      float nFreq = max(0.08, noisePair.y);
      float ph = phaseVal * 6.2831853 + noiseScroll * age * 1.7;
      float ph0 = phaseVal * 6.2831853;
      float travelSpd = length(aAtlasP1.xyz) + abs(orbitalY) * length(centerOffXZ);
      float spatialRate = 1.0 + clamp((travelSpd - 2.2) * 0.25, 0.0, 5.5);
      float w1 = nFreq * 2.5 * spatialRate;
      float w2 = nFreq * 4.2 * spatialRate;
      float yScale = (renderMode > 1.5 && renderMode < 2.5) ? 1.0 : scaleYPair.x;
      vec3 disp1 = vec3(
        (sin(w1 * age + ph) - sin(ph0)) / w1,
        (sin(w1 * age * 1.13 + ph * 2.1) - sin(ph0 * 2.1)) / (w1 * 1.13),
        (cos(ph0 * 1.7) - cos(w1 * age + ph * 1.7)) / w1
      );
      vec3 disp2 = vec3(
        (cos(ph0 * 2.9) - cos(w2 * age + ph * 2.9)) / w2,
        (sin(w2 * age * 0.91 + ph * 1.4) - sin(ph0 * 1.4)) / (w2 * 0.91),
        (sin(w2 * age + ph * 2.3) - sin(ph0 * 2.3)) / w2
      );
      float dampScale = (noiseDamp > 0.5) ? clamp(length(curVel) * 0.3, 0.15, 2.0) : 1.0;
      vec3 noiseOff = (disp1 + 0.45 * disp2) * nStr * 1.18 * dampScale * (spatialRate > 1.01 ? (0.45 + 0.55 * spatialRate) : 1.0);
      noiseOff.y *= yScale;
      worldPos += noiseOff;
    }
  }

  worldPos += effDelta;
  vCustom1 = aCustom1;
  vUberMatRow = aAtlasP7.w;
  vNormalView = vec3(0.0, 0.0, 1.0);
  vViewDirView = vec3(0.0, 0.0, 1.0);

  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);
  float curSizeY = (hasSizeSep > 0.5) ? (aAtlasP2.x * sampleSizeYCurve(curveRow, t)) : curSize;
  float aspectY = max(0.05, scaleYPair.y);
  float rot = rotZPair.x + rotZPair.y * age;
  bool hasRot3D = (abs(rotXY0.x) + abs(rotXY0.y) + abs(spinXY.x) + abs(spinXY.y)) > 0.001;
  vec2 posLocal = position.xy - pivotPair;
  vec3 offLocal = vec3(posLocal, 0.0);
  if (aAtlasP7.w > -0.5 && abs(aCustom2.x) > 1e-5) {
    vec2 uv0TopDown = vec2(uv.x, 1.0 - uv.y);
    vec2 vtxUv0 = uv0TopDown;
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 fbG = vfxFlipbookGrid(vFlipbook.xy);
      float fPos = vfxFlipbookFramePosition(t, fbG, vFlipbook.z);
      vtxUv0 = vfxFlipbookFrameUv(floor(fPos), uv0TopDown, fbG);
    }
    offLocal = vfxEvalUberVertexOffset(
      uMaterialLut, uAtlasTex, uHasAtlas, uFlipV, aAtlasP7.w,
      vtxUv0, offLocal, vec3(0.0, 0.0, 1.0), aCustom2.x, uTime
    );
  }
  posLocal = offLocal.xy;

  if (uIs2D > 0.5) {
    vFadesAndTexture.x = 1.0;
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
      lenScale = (stretchScales.x > 0.0001 || stretchScales.y > 0.0001)
        ? (curSize * max(0.05, stretchScales.y) + spd * stretchScales.x * 0.015)
        : (curSize * (1.0 + scaleYPair.x * min(spd * 0.015, 4.0)));
    }
    vec2 p2 = worldPos.xy + axisX * (posLocal.x * lenScale) + axisY * (posLocal.y * curSizeY * aspectY);
    vec4 mvPos2 = modelViewMatrix * vec4(p2, worldPos.z + offLocal.z * curSize, 1.0);
    vViewDirView = -mvPos2.xyz;
    gl_Position = projectionMatrix * mvPos2;
  } else {
    vec4 mvPosCheck = modelViewMatrix * vec4(worldPos, 1.0);
    vFadesAndTexture.x = (camFadeFar > camFadeNear + 0.001)
      ? clamp((abs(mvPosCheck.z) - camFadeNear) / (camFadeFar - camFadeNear), 0.0, 1.0)
      : 1.0;

    if (hasRot3D && (renderMode < 1.5 || renderMode > 3.5)) {
      mat3 rotMat = euler3D(rotXY0.x + spinXY.x * age, rotXY0.y + spinXY.y * age, rot);
      vec3 localQ = vec3(posLocal.x * curSize, posLocal.y * curSizeY * aspectY, offLocal.z * curSize);
      vec3 localN = vec3(0.0, 0.0, 1.0);
      if (renderMode > 0.5 && renderMode < 1.5) {
        localQ = vec3(posLocal.x * curSize, offLocal.z * curSize, posLocal.y * curSizeY * aspectY);
        localN = vec3(0.0, 1.0, 0.0);
      }
      vec3 worldQuad = worldPos + rotMat * localQ;
      vec4 mvQuad = modelViewMatrix * vec4(worldQuad, 1.0);
      vNormalView = mat3(modelViewMatrix) * (rotMat * localN);
      vViewDirView = -mvQuad.xyz;
      gl_Position = projectionMatrix * mvQuad;
    } else if (renderMode > 0.5 && renderMode < 1.5) {
      float c = cos(rot);
      float s = sin(rot);
      vec3 worldQuad = worldPos + vec3(
        (posLocal.x * c - posLocal.y * s) * curSize,
        offLocal.z * curSize,
        (posLocal.x * s + posLocal.y * c) * curSizeY * aspectY
      );
      vec4 mvQuad = modelViewMatrix * vec4(worldQuad, 1.0);
      vNormalView = mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0);
      vViewDirView = -mvQuad.xyz;
      gl_Position = projectionMatrix * mvQuad;
    } else if (renderMode > 3.5) {
      vec3 camRight = vec3(modelViewMatrix[0][0], 0.0, modelViewMatrix[2][0]);
      float rLen = length(camRight);
      camRight = rLen > 0.0001 ? (camRight / rLen) : vec3(1.0, 0.0, 0.0);
      vec3 upW = vec3(0.0, 1.0, 0.0);
      float c = cos(rot);
      float s = sin(rot);
      vec2 rPos = vec2(
        (posLocal.x * c - posLocal.y * s) * curSize,
        (posLocal.x * s + posLocal.y * c) * curSizeY * aspectY
      );
      vec3 worldQuad = worldPos + camRight * rPos.x + upW * rPos.y + cross(camRight, upW) * (offLocal.z * curSize);
      vec4 mvQuad = modelViewMatrix * vec4(worldQuad, 1.0);
      vNormalView = mat3(modelViewMatrix) * cross(camRight, upW);
      vViewDirView = -mvQuad.xyz;
      gl_Position = projectionMatrix * mvQuad;
    } else {
      vec4 mvCenter = mvPosCheck;
      vec2 rightAxis;
      float major = curSize;
      if (renderMode > 1.5 && renderMode < 2.5) {
        vec3 viewVel = mat3(modelViewMatrix) * curVel;
        float spd = length(viewVel.xy);
        rightAxis = spd > 0.001 ? (viewVel.xy / spd) : vec2(cos(rot), sin(rot));
        major = (stretchScales.x > 0.0001 || stretchScales.y > 0.0001)
          ? (curSize * max(0.05, stretchScales.y) + min(spd * stretchScales.x, curSize * 8.0))
          : (curSize * (1.0 + scaleYPair.x * min(spd * 0.08, 4.5)));
      } else {
        rightAxis = vec2(cos(rot), sin(rot));
      }
      vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);
      float billH = (renderMode < 0.5) ? (curSizeY * aspectY) : curSizeY;
      float minBill = (renderMode < 0.5 && curSize > 0.001) ? abs(mvCenter.z) * 0.0042 : 0.0;
      mvCenter.xy += rightAxis * (posLocal.x * max(major, minBill)) + upAxis * (posLocal.y * max(billH, minBill));
      mvCenter.z += offLocal.z * curSize;
      vViewDirView = -mvCenter.xyz;
      gl_Position = projectionMatrix * mvCenter;
    }
  }
}
`;

export const ATLAS_PARTICLE_FRAGMENT_GLSL = /* glsl */ `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

uniform sampler2D uCurveLut;
uniform sampler2D uAtlasTex;
uniform sampler2D uMaterialLut;
uniform sampler2D uSoftDepthTex;
uniform float uTime;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasSoftDepth;
uniform float uSoftFade;
uniform float uIsMultiply;
uniform float uIsPremultiply;
uniform float uIsAdditive;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;
varying vec4 vMatParams;
varying vec4 vUvTransform;
varying vec3 vFadesAndTexture;
varying vec4 vCustom1;
varying float vUberMatRow;
varying vec3 vNormalView;
varying vec3 vViewDirView;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

vec4 sampleColorCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture2D(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));
  vec4 c1 = texture2D(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));
  return mix(c0, c1, f);
}

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}
${VFX_UBER_FRAGMENT_GLSL}

vec4 sampleAtlasFrame(float frameIdx, vec2 localUv, vec2 grid) {
  vec2 cellUv = vfxFlipbookFrameUv(frameIdx, localUv, grid);
  vec2 mapped = vec2(
    mix(vUvRect.x, vUvRect.z, cellUv.x),
    mix(vUvRect.y, vUvRect.w, cellUv.y)
  );
  if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
  return texture2D(uAtlasTex, mapped);
}

void main() {
  if (vUberMatRow > -0.5) {
    vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
#ifndef HGAME_OPAQUE_PARTICLE
    if (curveCol.a < 0.001) discard;
#endif
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 uv0 = topDownUv;
    vec2 uvBlend = topDownUv;
    float flipBlend = 0.0;
    bool hasFlipBlend = false;
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);
      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);
      float f0 = floor(framePos);
      uv0 = vfxFlipbookFrameUv(f0, topDownUv, grid);
      if (vFlipbook.w > 0.5) {
        float f1 = min(grid.x * grid.y - 1.0, f0 + 1.0);
        uvBlend = vfxFlipbookFrameUv(f1, topDownUv, grid);
        flipBlend = fract(framePos);
        hasFlipBlend = true;
      }
    }
    vec4 vCol = vec4(curveCol.rgb * vTint * max(0.0, vHdr), curveCol.a * vFadesAndTexture.x);
    float allowSoft = vFadesAndTexture.y < 0.5 ? uHasSoftDepth : 0.0;
    vec4 uHdrMeta = vfxReadMatTexel(uMaterialLut, vUberMatRow, 0.0);
    vec4 uRes;
    if (uHdrMeta.x > 2.5) {
      uRes = vfxEvalPbrFxFragment(
        uMaterialLut,
        uAtlasTex,
        uHasAtlas,
        uFlipV,
        vUberMatRow,
        uv0,
        vCol,
        vCustom1,
        uTime,
        vViewDirView,
        vNormalView,
        vec3(0.45, 0.82, 0.35),
        gl_FrontFacing
      );
    } else {
      uRes = vfxEvalUberFragment(
        uMaterialLut,
        uAtlasTex,
        uHasAtlas,
        uFlipV,
        vUberMatRow,
        uv0,
        uvBlend,
        flipBlend,
        hasFlipBlend,
        vCol,
        vCustom1,
        uTime,
        vViewDirView,
        vNormalView,
        gl_FrontFacing,
        uSoftDepthTex,
        allowSoft,
        gl_FragCoord.xy,
        uInvViewport,
        uCamNearFar
      );
    }
#ifdef HGAME_OPAQUE_PARTICLE
    gl_FragColor = vec4(uRes.rgb, 1.0);
#else
    if (uIsMultiply > 0.5) {
      gl_FragColor = vec4(mix(vec3(1.0), uRes.rgb, clamp(uRes.a, 0.0, 1.0)), 1.0);
      return;
    }
    if (uIsPremultiply > 0.5) {
      gl_FragColor = uRes;
      return;
    }
    vec3 outRgb = uRes.rgb;
    float outA = uRes.a;
    float uPeak = max(outRgb.r, max(outRgb.g, outRgb.b));
    if (uIsAdditive > 0.5 && uPeak > 1.0 && outA > 0.0 && outA < 1.0) {
      float boost = min(uPeak, 1.0 / outA);
      outRgb /= boost;
      outA *= boost;
    }
    gl_FragColor = vec4(outRgb, outA);
#endif
    return;
  }

  if ((vMatParams.w > 0.5 && vMatParams.w < 1.5 && !gl_FrontFacing) || (vMatParams.w > 1.5 && gl_FrontFacing)) {
    discard;
  }
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
#ifndef HGAME_OPAQUE_PARTICLE
  if (curveCol.a < 0.001) discard;
#endif

  vec2 uvBase = vec2(vUv.x, 1.0 - vUv.y);
  bool hasCustomUv = (abs(vUvTransform.x - 1.0) > 0.02 || abs(vUvTransform.y - 1.0) > 0.02 || vUvTransform.z > 0.005 || vUvTransform.w > 0.005);
  vec2 topDownUv = hasCustomUv ? fract(uvBase * vUvTransform.xy + vUvTransform.zw) : uvBase;

  vec4 texCol = vec4(1.0);
  if (uHasAtlas > 0.5 && vFadesAndTexture.z < 0.5) {
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);
      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);
      float f0 = floor(framePos);
      texCol = sampleAtlasFrame(f0, topDownUv, grid);
      if (vFlipbook.w > 0.5) {
        float f1 = min(grid.x * grid.y - 1.0, f0 + 1.0);
        vec4 nextCol = sampleAtlasFrame(f1, topDownUv, grid);
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
  } else if (vFadesAndTexture.z < 0.5) {
    float r = length(vUv * 2.0 - 1.0);
    if (r > 1.0) discard;
    texCol.a = exp(-3.6 * r * r);
  }

  float alpha = texCol.a * curveCol.a;
  if (alpha < vMatParams.x) discard;
#ifndef HGAME_OPAQUE_PARTICLE
  float softMul = 1.0;
  if (uHasSoftDepth > 0.5 && uSoftFade > 0.001 && vFadesAndTexture.y < 0.5) {
    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;
    float sceneZ = vfxLinearizeDepth(sceneDepthRaw, uCamNearFar);
    float partZ = vfxLinearizeDepth(gl_FragCoord.z, uCamNearFar);
    softMul = clamp((sceneZ - partZ) / uSoftFade, 0.0, 1.0);
  }

  alpha *= softMul * vFadesAndTexture.x;
  if (alpha < 0.0005) discard;
#endif

  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr) + texCol.rgb * vMatParams.y * vTint;

  if (vMatParams.z > 0.002 && vLifeRatio > vMatParams.z) {
    float n = valueNoise2(topDownUv * 6.5 + vec2(vCurveRow * 0.37, 0.0));
    float cut = (vLifeRatio - vMatParams.z) / max(0.02, 1.0 - vMatParams.z);
    if (n < cut) discard;
    float edge = 1.0 - smoothstep(cut, cut + 0.08, n);
    rgb = mix(rgb, vTint * max(2.0, vHdr * 1.5), edge);
  }

#ifdef HGAME_OPAQUE_PARTICLE
  gl_FragColor = vec4(rgb, 1.0);
#else
  if (uIsMultiply > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), rgb, clamp(alpha, 0.0, 1.0)), 1.0);
    return;
  }
  if (uIsPremultiply > 0.5) {
    gl_FragColor = vec4(rgb, alpha);
    return;
  }

  // Preserve HDR hue and intensity on additive passes while keeping alpha opacity accurate on Alpha blend.
  float peak = max(rgb.r, max(rgb.g, rgb.b));
  if (uIsAdditive > 0.5 && peak > 1.0 && alpha > 0.0 && alpha < 1.0) {
    float boost = min(peak, 1.0 / alpha);
    rgb /= boost;
    alpha *= boost;
  }
  gl_FragColor = vec4(rgb, alpha);
#endif
}
`;

export const ATLAS_PARTICLE_DISTORTION_FS = /* glsl */ `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

uniform sampler2D uCurveLut;
uniform sampler2D uAtlasTex;
uniform sampler2D uMaterialLut;
uniform sampler2D uSceneTex;
uniform sampler2D uSoftDepthTex;
uniform float uTime;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasSceneTex;
uniform float uHasSoftDepth;
uniform float uDistortionStrength;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;
varying vec4 vMatParams;
varying vec3 vFadesAndTexture;
varying float vUberMatRow;

vec4 sampleColorCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture2D(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));
  vec4 c1 = texture2D(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));
  return mix(c0, c1, f);
}

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}
${VFX_UBER_FRAGMENT_GLSL}

vec4 sampleAtlasFrame(float frameIdx, vec2 localUv, vec2 grid) {
  vec2 cellUv = vfxFlipbookFrameUv(frameIdx, localUv, grid);
  vec2 mapped = vec2(
    mix(vUvRect.x, vUvRect.z, cellUv.x),
    mix(vUvRect.y, vUvRect.w, cellUv.y)
  );
  if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
  return texture2D(uAtlasTex, mapped);
}

void main() {
  if (uHasSceneTex < 0.5) discard;
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
  if (curveCol.a < 0.002) discard;

  if (vUberMatRow > -0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 uv0 = topDownUv;
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);
      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);
      uv0 = vfxFlipbookFrameUv(floor(framePos), topDownUv, grid);
    }
    vec4 vCol = vec4(curveCol.rgb * vTint, curveCol.a * vFadesAndTexture.x);
    float allowSoft = vFadesAndTexture.y < 0.5 ? uHasSoftDepth : 0.0;
    gl_FragColor = vfxEvalPilotoWarpFragment(
      uMaterialLut,
      uAtlasTex,
      uSceneTex,
      uHasAtlas,
      uHasSceneTex,
      uFlipV,
      vUberMatRow,
      uv0,
      vCol,
      uTime,
      uSoftDepthTex,
      allowSoft,
      gl_FragCoord.xy,
      uInvViewport,
      uCamNearFar
    );
    return;
  }

  vec2 centered = vUv * 2.0 - 1.0;
  float rad = length(centered);
  vec2 nOffset = vec2(0.0);
  float maskAlpha = curveCol.a;
  float sourceAlpha = curveCol.a;

  if (uHasAtlas > 0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 texCol;
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);
      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);
      float f0 = floor(framePos);
      texCol = sampleAtlasFrame(f0, topDownUv, grid);
      if (vFlipbook.w > 0.5) {
        float f1 = min(grid.x * grid.y - 1.0, f0 + 1.0);
        texCol = mix(texCol, sampleAtlasFrame(f1, topDownUv, grid), fract(framePos));
      }
    } else {
      vec2 mapped = vec2(
        mix(vUvRect.x, vUvRect.z, topDownUv.x),
        mix(vUvRect.y, vUvRect.w, topDownUv.y)
      );
      if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
      texCol = texture2D(uAtlasTex, mapped);
    }
    nOffset = texCol.rg * 2.0 - 1.0;
    sourceAlpha *= texCol.a;
    float radialFade = clamp(1.0 - rad * rad, 0.0, 1.0);
    float edgeAlpha = (texCol.a < 0.995) ? texCol.a : radialFade;
    maskAlpha *= edgeAlpha;
  } else {
    if (rad > 1.0) discard;
    float falloff = exp(-3.4 * rad * rad);
    nOffset = centered * falloff;
    maskAlpha *= falloff;
    sourceAlpha *= falloff;
  }

  if (sourceAlpha < vMatParams.x || maskAlpha < 0.002) discard;
  vec2 screenUv = gl_FragCoord.xy * uInvViewport;
  vec2 refractedUv = clamp(screenUv + nOffset * uDistortionStrength * maskAlpha, vec2(0.002), vec2(0.998));
  vec3 refracted = texture2D(uSceneTex, refractedUv).rgb;
  gl_FragColor = vec4(refracted, clamp(maskAlpha * 1.15, 0.0, 1.0));
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
uniform vec2 uWind2D;
uniform vec2 uEffectDeltas2D[32];

out vec2 vUv;
out float vLifeRatio;
out float vCurveRow;
out float vHdr;
out vec4 vUvRect;
out vec4 vFlipbook;
out vec3 vTint;
flat out float vAlphaCutoff;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

vec2 unpack2x12Pos(float packedVal, float maxA, float maxB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4095.0) * maxA, (qb / 4095.0) * maxB);
}

vec2 unpack2x12Sym(float packedVal, float absA, float absB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4094.0) * (2.0 * absA) - absA, (qb / 4094.0) * (2.0 * absB) - absB);
}

vec2 unpack2x12Mixed(float packedVal, float maxA, float absB) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qa = floor(v / 4096.0);
  float qb = v - qa * 4096.0;
  return vec2((qa / 4095.0) * maxA, (qb / 4094.0) * (2.0 * absB) - absB);
}

vec2 unpackUvPair(float packedVal) {
  float v = floor(clamp(packedVal, 0.0, 16777215.0) + 0.5);
  float qu = floor(v / 4096.0);
  float qv = v - qu * 4096.0;
  return clamp(vec2(qu, qv) / 3840.0, 0.0, 1.0);
}

float sampleSizeCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;
  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;
  return mix(s0, s1, f);
}

float sampleSizeYCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  return mix(t0.b, t1.b, f) * 8.0;
}

float sampleVelDispCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));
  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));
  return mix(t0.a, t1.a, f) * 8.0 - 4.0;
}

void main() {
  float age = uTime - aAtlasP0.w;
  float dur = aAtlasP1.w;
  float rowWord = floor(max(0.0, aAtlasP2.w) + 0.5);
  float materialFlags = floor(rowWord / 1048576.0); rowWord -= materialFlags * 1048576.0;
  float cullFlag = floor(rowWord / 262144.0); rowWord -= cullFlag * 262144.0;
  float hasSizeSep = step(131071.5, rowWord); rowWord -= hasSizeSep * 131072.0;
  float noiseDamp = step(65535.5, rowWord); rowWord -= noiseDamp * 65536.0;
  float hasVelCurve = step(32767.5, rowWord); rowWord -= hasVelCurve * 32768.0;
  float renderMode = floor(rowWord / 4096.0); rowWord -= renderMode * 4096.0;
  float rawCurve = rowWord;
  bool isPersistent = rawCurve >= 1023.5;
  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
  float curveRow = mod(rawCurve, 1024.0);
  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec2 rotZPair = unpack2x12Mixed(aAtlasP3.x, 6.2831853, 64.0);
  vec2 hdrEmPair = unpack2x12Pos(aAtlasP3.y, 35.0, 35.0);
  vec2 pivotPair = unpack2x12Sym(aAtlasP3.z, 2.0, 2.0);
  vec2 stretchScales = unpack2x12Pos(aAtlasP3.w, 15.0, 15.0);

  vec2 uv0 = unpackUvPair(aAtlasP4.x);
  vec2 uv1 = unpackUvPair(aAtlasP4.y);
  float fbWord = floor(max(0.0, aAtlasP4.z) + 0.5);
  float cyclesQ = floor(fbWord / 8192.0); fbWord -= cyclesQ * 8192.0;
  float fbBlend = step(4095.5, fbWord); fbWord -= fbBlend * 4096.0;
  float fbRows = floor(fbWord / 64.0) + 1.0;
  float fbCols = mod(fbWord, 64.0) + 1.0;

  vec2 noisePair = unpack2x12Pos(aAtlasP5.x, 35.0, 15.0);
  vec2 scaleYPair = unpack2x12Pos(aAtlasP5.y, 15.0, 15.0);
  float psWord = floor(max(0.0, aAtlasP5.w) + 0.5);
  float scrollQ = floor(psWord / 262144.0); psWord -= scrollQ * 262144.0;
  float windQ = floor(psWord / 8192.0); psWord -= windQ * 8192.0;
  int slotIdx = int(floor(psWord / 256.0));
  float phaseVal = (psWord - float(slotIdx) * 256.0) / 255.0;
  float noiseScroll = scrollQ * 0.25;
  float windMul = windQ * 0.25;
  vec2 accelXZ = unpack2x12Sym(aAtlasP6.y, 64.0, 64.0);

  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);
  vLifeRatio = t;
  vUv = aQuadPos + 0.5;
  vCurveRow = curveRow;
  vHdr = hdrEmPair.x;
  vUvRect = vec4(uv0, uv1);
  vFlipbook = vec4(fbCols, fbRows, cyclesQ / 32.0, fbBlend);
  vTint = unpackRgb24(aAtlasP4.w);

  vAlphaCutoff = unpackRgb24(aAtlasP7.x).x;

  float k = aAtlasP2.z;
  vec2 worldPos;
  vec2 curVel;
  if (k < -0.5) {
    worldPos = aAtlasP0.xy;
    curVel = aAtlasP1.xy;
  } else {
    float dispFactor;
    float velDecay;
    if (hasVelCurve > 0.5) {
      dispFactor = sampleVelDispCurve(curveRow, t) * dur;
      float dtStep = 0.015;
      float t1 = min(1.0, t + dtStep);
      float t0 = max(0.0, t - dtStep);
      velDecay = (sampleVelDispCurve(curveRow, t1) - sampleVelDispCurve(curveRow, t0)) / max(0.001, t1 - t0);
    } else {
      dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
      velDecay = (k > 0.001) ? exp(-k * age) : 1.0;
    }
    vec2 gVec = vec2(accelXZ.x, aAtlasP2.y) + uWind2D * windMul;
    worldPos = aAtlasP0.xy + aAtlasP1.xy * dispFactor + 0.5 * gVec * (age * age);
    curVel = aAtlasP1.xy * velDecay + gVec * age;

    float nStr = noisePair.x;
    if (nStr > 0.001) {
      float nFreq = max(0.05, noisePair.y);
      float ph = phaseVal * 6.2831853 + noiseScroll * age * 1.7;
      float wt = age * nFreq * 3.14159265;
      float dampScale = (noiseDamp > 0.5) ? clamp(length(curVel) * 0.03, 0.15, 2.0) : 1.0;
      worldPos += vec2(sin(wt + ph) * cos(wt * 0.73 + ph), cos(wt * 1.17 + ph)) * (nStr * min(1.0, age * 1.5) * 12.0 * dampScale);
    }
  }
  if (slotIdx > 0 && slotIdx < 32) {
    worldPos += uEffectDeltas2D[slotIdx];
  }

  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);
  float curSizeY = (hasSizeSep > 0.5) ? (aAtlasP2.x * sampleSizeYCurve(curveRow, t)) : curSize;
  float aspectY = max(0.05, scaleYPair.y);
  float rot = rotZPair.x + rotZPair.y * age;
  vec2 axisX = vec2(cos(rot), sin(rot));
  vec2 axisY = vec2(-axisX.y, axisX.x);
  float lenScale = curSize;
  if (renderMode > 1.5 && renderMode < 2.5) {
    float spd = length(curVel);
    if (spd > 0.001) {
      axisX = curVel / spd;
      axisY = vec2(-axisX.y, axisX.x);
    }
    lenScale = (stretchScales.x > 0.0001 || stretchScales.y > 0.0001)
      ? (curSize * max(0.05, stretchScales.y) + spd * stretchScales.x * 0.015)
      : (curSize * (1.0 + scaleYPair.x * min(spd * 0.015, 4.0)));
  }

  float billH = (renderMode < 0.5) ? (curSizeY * aspectY) : curSizeY;
  vec2 posLocal = aQuadPos - pivotPair;
  vec2 p = worldPos + axisX * (posLocal.x * lenScale) + axisY * (posLocal.y * billH);
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
uniform int uBlendMode; // Straight RGB (0), multiply (1), premultiplied source (2).

in vec2 vUv;
in float vLifeRatio;
in float vCurveRow;
in float vHdr;
in vec4 vUvRect;
in vec4 vFlipbook;
in vec3 vTint;
flat in float vAlphaCutoff;

out vec4 fragColor;

vec4 sampleColorCurve(float row, float t) {
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));
  vec4 c1 = texture(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));
  return mix(c0, c1, f);
}

${VFX_FLIPBOOK_GLSL}

vec4 sampleAtlasFrame(float frameIdx, vec2 localUv, vec2 grid) {
  vec2 cellUv = vfxFlipbookFrameUv(frameIdx, localUv, grid);
  vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, cellUv.x), mix(vUvRect.y, vUvRect.w, cellUv.y));
  return texture(uAtlasTex, mapped);
}

void main() {
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
  if (curveCol.a < 0.001) discard;

  vec4 texCol = vec4(1.0);
  if (uHasAtlas > 0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {
      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);
      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);
      float f0 = floor(framePos);
      texCol = sampleAtlasFrame(f0, topDownUv, grid);
      if (vFlipbook.w > 0.5) {
        float f1 = min(grid.x * grid.y - 1.0, f0 + 1.0);
        texCol = mix(texCol, sampleAtlasFrame(f1, topDownUv, grid), fract(framePos));
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
  if (alpha < max(0.0005, vAlphaCutoff)) discard;
  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);
  if (uBlendMode == 1) {
    fragColor = vec4(mix(vec3(1.0), rgb, clamp(alpha, 0.0, 1.0)), 1.0);
    return;
  }
  if (uBlendMode == 2) {
    fragColor = vec4(rgb, alpha);
    return;
  }
  float peak = max(rgb.r, max(rgb.g, rgb.b));
  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {
    float boost = min(peak, 1.0 / alpha);
    rgb /= boost;
    alpha *= boost;
  }
  fragColor = vec4(rgb, alpha);
}
`;

function createAtlasChannel(capacity, blendMode = 'alpha') {
  const additive = blendMode === 'additive';
  const distortion = blendMode === 'distortion';
  const p7 = new Float32Array(capacity * 4);
  for (let i = 0; i < capacity; i++) p7[i * 4 + 3] = -1;
  return {
    capacity,
    blendMode,
    additive,
    distortion,
    p0: new Float32Array(capacity * 4),
    p1: new Float32Array(capacity * 4),
    p2: new Float32Array(capacity * 4),
    p3: new Float32Array(capacity * 4),
    p4: new Float32Array(capacity * 4),
    p5: new Float32Array(capacity * 4),
    p6: new Float32Array(capacity * 4),
    p7,
    custom1: new Float32Array(capacity * 4),
    custom2: new Float32Array(capacity * 4),
    slotGen: new Uint32Array(capacity),
    dynamicSlots: [],
    cursor: 0,
    slotCount: 0,
    latestDeath: -Infinity,
    rescanDeath: false,
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

function atlasSlotDeath(ch, offset) {
  const duration = ch.p1[offset + 3];
  if (!(duration > 0)) return -Infinity;
  const rawCurve = Math.floor((ch.p2[offset + 3] || 0) + 0.5) % 4096;
  return rawCurve >= 1024 ? Infinity : ch.p0[offset + 3] + duration;
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
  ext = null,
) {
  const hasVelCurve = Boolean(ext && ext.hasVelCurve);
  const disp = hasVelCurve
    ? (ext.velDispIntegral ?? 0) * (ext.duration ?? 1)
    : (drag > 0.001 ? ((1 - Math.exp(-drag * age)) / drag) : age);
  const velDecay = hasVelCurve
    ? (ext.velMul ?? 1)
    : (drag > 0.001 ? Math.exp(-drag * age) : 1);
  const ax = (ext?.accelX ?? 0) + (ext?.windX ?? 0) * (ext?.windMul ?? 0);
  const ay = (is2D ? gravity : -gravity) + (ext?.windY ?? 0) * (ext?.windMul ?? 0);
  const az = (ext?.accelZ ?? 0) + (ext?.windZ ?? 0) * (ext?.windMul ?? 0);

  let px = x0 + vx * disp + 0.5 * ax * age * age;
  let py = y0 + vy * disp + 0.5 * ay * age * age;
  let pz = z0 + vz * disp + 0.5 * az * age * age;
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
    const nf = Math.max(0.08, noiseFreq);
    const ph0 = phase * 6.283185307179586;
    const noiseScroll = ext?.noiseScroll ?? 0;
    const ph = ph0 + noiseScroll * age * 1.7;
    const noiseDamp = Boolean(ext?.noiseDamp);
    const cvx = vx * velDecay + ax * age;
    const cvy = vy * velDecay + ay * age;
    const cvz = vz * velDecay + az * age;
    if (is2D) {
      const wt = age * nf * 3.141592653589793;
      const dampScale = noiseDamp ? Math.max(0.15, Math.min(2.0, Math.hypot(cvx, cvy) * 0.03)) : 1.0;
      const env = noiseStrength * Math.min(1.0, age * 1.5) * 12.0 * dampScale;
      px += Math.sin(wt + ph) * Math.cos(wt * 0.73 + ph) * env;
      py += Math.cos(wt * 1.17 + ph) * env * noiseYScale;
    } else {
      const travelSpd = Math.hypot(vx, vy, vz) + Math.abs(orbitalY) * Math.hypot(centerOffX, centerOffZ);
      const spatialRate = 1.0 + Math.max(0, Math.min(5.5, (travelSpd - 2.2) * 0.25));
      const w1 = nf * 2.5 * spatialRate;
      const w2 = nf * 4.2 * spatialRate;
      const d1x = (Math.sin(w1 * age + ph) - Math.sin(ph0)) / w1;
      const d1y = (Math.sin(w1 * age * 1.13 + ph * 2.1) - Math.sin(ph0 * 2.1)) / (w1 * 1.13);
      const d1z = (Math.cos(ph0 * 1.7) - Math.cos(w1 * age + ph * 1.7)) / w1;
      const d2x = (Math.cos(ph0 * 2.9) - Math.cos(w2 * age + ph * 2.9)) / w2;
      const d2y = (Math.sin(w2 * age * 0.91 + ph * 1.4) - Math.sin(ph0 * 1.4)) / (w2 * 0.91);
      const d2z = (Math.sin(w2 * age + ph * 2.3) - Math.sin(ph0 * 2.3)) / w2;
      const dampScale = noiseDamp ? Math.max(0.15, Math.min(2.0, Math.hypot(cvx, cvy, cvz) * 0.3)) : 1.0;
      const s = noiseStrength * 1.18 * dampScale * (spatialRate > 1.01 ? (0.45 + 0.55 * spatialRate) : 1.0);
      px += (d1x + 0.45 * d2x) * s;
      py += (d1y + 0.45 * d2y) * s * noiseYScale;
      pz += (d1z + 0.45 * d2z) * s;
    }
  }
  if (ext) {
    px += ext.effectOffX ?? 0;
    py += ext.effectOffY ?? 0;
    pz += ext.effectOffZ ?? 0;
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
  const subCap = Math.max(128, (capacity >> 2) | 0);
  const normalPool = createAtlasChannel(capacity, 'alpha');
  const additivePool = createAtlasChannel(capacity, 'additive');
  const multiplyPool = createAtlasChannel(subCap, 'multiply');
  const premultiplyPool = createAtlasChannel(subCap, 'premultiply');
  const distortionPool = createAtlasChannel(subCap, 'distortion');
  const channels = [normalPool, additivePool, multiplyPool, premultiplyPool, distortionPool];
  const renderStateChannels = new Map();
  const lut = createCurveLutTable(THREE);
  const uberLut = THREE && THREE.DataTexture ? createUberMaterialLut(THREE) : null;
  const uberMatCache = new Map();
  let atlasRevision = 0;
  let qualityTier = 'high';

  /** @type {Record<string, readonly number[]>} */
  let regions = atlasRegions ? { ...atlasRegions } : { ...PROCEDURAL_VFX_ATLAS_REGIONS };
  /** @type {object | null} */
  let activeAtlasTex = atlasTexture;
  /** @type {HTMLCanvasElement | OffscreenCanvas | null} */
  let activeAtlasCanvas = null;
  const windVec = new Float32Array([0, 0, 0]);
  const timeUniform = { value: 0 };
  const windUniform = { value: THREE?.Vector3 ? new THREE.Vector3() : { set() {} } };
  const invViewportUniform = () => ({ value: THREE?.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } });
  const softDepthUniforms = {
    uSoftDepthTex: { value: null },
    uHasSoftDepth: { value: 0.0 },
    uSoftFade: { value: 0.45 },
    uInvViewport: invViewportUniform(),
    uCamNearFar: { value: THREE?.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } },
  };
  const sceneColorUniforms = {
    uSceneTex: { value: null },
    uHasSceneTex: { value: 0.0 },
    uDistortionStrength: { value: 0.045 },
    uInvViewport: invViewportUniform(),
  };
  const effectDeltas = new Float32Array(32 * 3);
  const effectDeltas2D = new Float32Array(32 * 2);
  const threeEffectVecs = Array.from({ length: 32 }, () => (THREE && THREE.Vector3 ? new THREE.Vector3() : { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }));

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
  const scratchC1 = new Float32Array(4);
  const scratchC2 = new Float32Array(4);

  let atlasFlipVOverride = null;

  function registerUberMaterial(matSpec) {
    if (!uberLut || !matSpec || typeof matSpec !== 'object') return -1;
    let entry = uberMatCache.get(matSpec);
    if (entry && entry.rev === atlasRevision) return entry.row;
    const key = entry ? entry.key : (matSpec.key || matSpec.name || `uber_${uberMatCache.size}`);
    const row = uberLut.allocateRow(key, matSpec, regions);
    uberMatCache.set(matSpec, { row, rev: atlasRevision, key });
    return row;
  }

  function updateThreeAtlasUniforms(ch) {
    if (!ch.threeMat) return;
    ch.threeMat.uniforms.uAtlasTex.value = activeAtlasTex;
    ch.threeMat.uniforms.uHasAtlas.value = activeAtlasTex ? 1.0 : 0.0;
    ch.threeMat.uniforms.uFlipV.value = atlasFlipVOverride !== null
      ? (atlasFlipVOverride ? 1.0 : 0.0)
      : (activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0);
  }

  function initThreeChannel(ch, depthTest = DEFAULT_VFX_DEPTH_TEST, depthWrite = false, opaque = false) {
    if (!THREE || !scene || !THREE.InstancedBufferGeometry || !THREE.PlaneGeometry) return;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = 0;

    const arrays = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7];
    const attrs = [];
    for (let i = 0; i < arrays.length; i++) {
      const attr = new THREE.InstancedBufferAttribute(arrays[i], 4);
      if (THREE.DynamicDrawUsage) attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(`aAtlasP${i}`, attr);
      attrs.push(attr);
    }
    const extraNames = ['aCustom1', 'aCustom2'];
    const extraArrs = [ch.custom1, ch.custom2];
    for (let i = 0; i < extraArrs.length; i++) {
      const attr = new THREE.InstancedBufferAttribute(extraArrs[i], 4);
      if (THREE.DynamicDrawUsage) attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(extraNames[i], attr);
      attrs.push(attr);
    }

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    const uniforms = {
      uTime: timeUniform,
      uIs2D: { value: is2D ? 1.0 : 0.0 },
      uIsMultiply: { value: ch.blendMode === 'multiply' && THREE.CustomBlending ? 1.0 : 0.0 },
      uIsPremultiply: { value: ch.blendMode === 'premultiply' && THREE.CustomBlending ? 1.0 : 0.0 },
      uIsAdditive: { value: ch.additive ? 1.0 : 0.0 },
      uCurveLut: { value: lut.texture },
      uMaterialLut: { value: uberLut ? uberLut.texture : null },
      uAtlasTex: { value: activeAtlasTex },
      uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
      uFlipV: {
        value: atlasFlipVOverride !== null
          ? (atlasFlipVOverride ? 1.0 : 0.0)
          : (activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0),
      },
      uWind: windUniform,
      uEffectDeltas: { value: threeEffectVecs },
      ...(ch.distortion ? { ...softDepthUniforms, ...sceneColorUniforms } : softDepthUniforms),
    };

    const blendCfg = ch.blendMode === 'multiply' && THREE.CustomBlending
      ? {
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.DstColorFactor,
          blendDst: THREE.ZeroFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
        }
      : ch.blendMode === 'premultiply' && THREE.CustomBlending
        ? {
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
          }
        : {
            blending: ch.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
          };

    const mat = new MatCtor({
      vertexShader: ATLAS_PARTICLE_VERTEX_GLSL,
      fragmentShader: ch.distortion ? ATLAS_PARTICLE_DISTORTION_FS : ATLAS_PARTICLE_FRAGMENT_GLSL,
      uniforms,
      transparent: !opaque,
      side: THREE.DoubleSide,
      ...(opaque ? { blending: THREE.NoBlending, defines: { HGAME_OPAQUE_PARTICLE: 1 } } : blendCfg),
    });
    applyVfxDepthState(mat, THREE, depthTest, depthWrite);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = ch.distortion ? (VFX_RENDER_ORDERS.PARTICLES + 2) : VFX_RENDER_ORDERS.PARTICLES;
    mesh.visible = ch.distortion ? (qualityTier !== 'low' && Boolean(sceneColorUniforms.uSceneTex.value)) : true;
    mesh.name = ch.distortion
      ? 'HGameVfxAtlasDistortion'
      : ch.blendMode === 'multiply'
        ? 'HGameVfxAtlasMultiply'
        : ch.blendMode === 'premultiply'
          ? 'HGameVfxAtlasPremultiply'
          : (ch.additive ? 'HGameVfxAtlasAdditive' : 'HGameVfxAtlasNormal');
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
      uBlendMode: gl.getUniformLocation(glProg, 'uBlendMode'),
      uWind2D: gl.getUniformLocation(glProg, 'uWind2D'),
      uEffectDeltas2D: gl.getUniformLocation(glProg, 'uEffectDeltas2D'),
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
      if (ch.distortion) continue;
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
    for (let c = 0; c < channels.length; c++) initThreeChannel(channels[c]);
  } else if (mode === 'webgl2d' && gl) {
    initWebGL2();
  }

  /**
   * Binds a custom atlas texture/canvas (including KTX2 CompressedTexture/WebP)
   * and region UV dictionary `[u0, v0, u1, v1]`.
   * @param {object | null} textureOrCanvas
   * @param {Record<string, readonly number[]>} [newRegions]
   * @param {{ flipV?: boolean | null }} [options]
   */
  function setAtlas(textureOrCanvas, newRegions, options = {}) {
    atlasFlipVOverride = typeof options?.flipV === 'boolean' ? options.flipV : null;
    if (textureOrCanvas && (textureOrCanvas.isTexture || textureOrCanvas.isCompressedTexture)) {
      activeAtlasTex = textureOrCanvas;
      const img = textureOrCanvas.image ?? null;
      const isDrawable = Boolean(img && typeof img === 'object' && ('width' in img) && ('height' in img) && !textureOrCanvas.isCompressedTexture);
      activeAtlasCanvas = isDrawable && typeof img.data === 'undefined' ? img : null;
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
    atlasRevision += 1;
    if (uberLut && uberMatCache.size > 0) {
      for (const [spec, entry] of uberMatCache) {
        uberLut.packRow(entry.row, spec, regions);
        entry.rev = atlasRevision;
      }
      uberLut.texture.needsUpdate = true;
    }
    for (let c = 0; c < channels.length; c++) updateThreeAtlasUniforms(channels[c]);
    if (gl && activeAtlasCanvas) uploadWebGL2Atlas(activeAtlasCanvas);
  }

  function resolveUvRect(opts) {
    if (Array.isArray(opts.uvRect) && opts.uvRect.length >= 4) return opts.uvRect;
    const regionKey = opts.flipbook?.region || opts.sprite;
    if (regionKey && regions[regionKey]) return regions[regionKey];
    return [0, 0, 1, 1];
  }

  function setDepthTexture(depthTexture, { near = 0.1, far = 200, width = 1280, height = 720, softFade = 0.45 } = {}) {
    softDepthUniforms.uSoftDepthTex.value = depthTexture;
    softDepthUniforms.uHasSoftDepth.value = depthTexture && qualityTier !== 'low' ? 1.0 : 0.0;
    softDepthUniforms.uSoftFade.value = softFade;
    softDepthUniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    softDepthUniforms.uCamNearFar.value.set(near, far);
  }

  /**
   * Binds a background scene color texture for screen-space refraction distortion particles.
   * @param {object | null} sceneTexture
   * @param {{ width?: number, height?: number, strength?: number }} [opts]
   */
  function setSceneTexture(sceneTexture, { width = 1280, height = 720, strength = 0.045 } = {}) {
    sceneColorUniforms.uSceneTex.value = sceneTexture || null;
    sceneColorUniforms.uHasSceneTex.value = sceneTexture && qualityTier !== 'low' ? 1.0 : 0.0;
    sceneColorUniforms.uDistortionStrength.value = Math.max(0, Number(strength) || 0.045);
    sceneColorUniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    for (const ch of channels) {
      if (ch.distortion && ch.threeMesh) ch.threeMesh.visible = qualityTier !== 'low' && Boolean(sceneTexture);
    }
  }

  function setQualityTier(tier = 'high') {
    qualityTier = tier === 'low' ? 'low' : (tier === 'medium' ? 'medium' : 'high');
    softDepthUniforms.uHasSoftDepth.value = softDepthUniforms.uSoftDepthTex.value && qualityTier !== 'low' ? 1.0 : 0.0;
    sceneColorUniforms.uHasSceneTex.value = sceneColorUniforms.uSceneTex.value && qualityTier !== 'low' ? 1.0 : 0.0;
    for (const ch of channels) {
      if (ch.distortion && ch.threeMesh) ch.threeMesh.visible = qualityTier !== 'low' && Boolean(sceneColorUniforms.uSceneTex.value);
    }
  }

  function hasActiveDistortion() {
    if (disposed || qualityTier === 'low') return false;
    const now = Math.fround(simTime);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (!ch.distortion || ch.slotCount <= 0) continue;
      if (ch.rescanDeath) {
        ch.latestDeath = -Infinity;
        for (let i = 0; i < ch.slotCount; i++) {
          ch.latestDeath = Math.max(ch.latestDeath, atlasSlotDeath(ch, i * 4));
        }
        ch.rescanDeath = false;
      }
      if (now <= ch.latestDeath) return true;
    }
    return false;
  }

  /**
   * Sets global wind vector `(wx, wy, wz)` affecting particles with non-zero `windMul`.
   * @param {number} wx
   * @param {number} wy
   * @param {number} wz
   */
  function setWind(wx = 0, wy = 0, wz = 0) {
    windVec[0] = wx;
    windVec[1] = wy;
    windVec[2] = wz;
    windUniform.value.set(wx, wy, wz);
  }

  /**
   * Updates active local-space effect anchor offset (`slotIdx` in `1..31`).
   * @param {number} slotIdx
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  function setEffectOffset(slotIdx, x = 0, y = 0, z = 0) {
    const idx = slotIdx | 0;
    if (idx <= 0 || idx >= 32) return;
    effectDeltas[idx * 3] = x;
    effectDeltas[idx * 3 + 1] = y;
    effectDeltas[idx * 3 + 2] = z;
    effectDeltas2D[idx * 2] = x;
    effectDeltas2D[idx * 2 + 1] = y;
    threeEffectVecs[idx].set(x, y, z);
  }

  function pickBlendChannel(opts) {
    if (opts.blend === 'distortion') return distortionPool;
    if (opts.blend === 'multiply') return multiplyPool;
    if (opts.blend === 'premultiply') return premultiplyPool;
    return (opts.blend === 'additive' || Boolean(opts.additive)) ? additivePool : normalPool;
  }

  function pickChannel(opts, create = false) {
    const base = pickBlendChannel(opts);
    if (!base.threeMesh || (!opts.opaque && opts.depthTest === undefined && opts.depthWrite === undefined)) return base;

    const opaque = !base.distortion && Boolean(opts.opaque);
    const blendChannel = opaque ? normalPool : base;
    const depthTest = getVfxDepthTestIndex(opts.depthTest);
    const depthWrite = depthTest !== 0 && (opts.depthWrite ?? opaque);
    if (!opaque && depthTest === DEFAULT_VFX_DEPTH_TEST && !depthWrite) return base;

    const key = (channels.indexOf(blendChannel) * VFX_DEPTH_TESTS.length + depthTest) * 4
      + (depthWrite ? 2 : 0) + (opaque ? 1 : 0);
    let channel = renderStateChannels.get(key);
    if (!channel && create) {
      channel = createAtlasChannel(blendChannel.capacity, blendChannel.blendMode);
      initThreeChannel(channel, depthTest, depthWrite, opaque);
      renderStateChannels.set(key, channel);
      channels.push(channel);
    }
    return channel;
  }

  const customCurveCache = new WeakMap();
  function resolveCompiledCustomData(customData) {
    if (!customData || typeof customData !== 'object') return null;
    if (customCurveCache.has(customData)) return customCurveCache.get(customData);
    const compiled = compileCustomDataCurves(customData);
    customCurveCache.set(customData, compiled);
    return compiled;
  }

  function hasDynamicCustomCurve(compiled) {
    if (!compiled) return false;
    for (const chKey of ['custom1', 'custom2']) {
      const ch = compiled[chKey];
      if (!ch) continue;
      for (let i = 0; i < ch.comps.length; i++) {
        const k = ch.comps[i].kind;
        if (k === 'lut' || k === 'lutRange') return true;
      }
    }
    return false;
  }

  /**
   * Emits a single textured/curve particle and returns its slot index.
   * @param {object} [opts]
   * @returns {number} Slot index in its channel, or -1 after disposal
   */
  function emit(opts = {}) {
    if (disposed || opts.renderMode === 'none') return -1;
    const ch = pickChannel(opts, true);
    const idx = ch.cursor;
    const i4 = idx * 4;
    const prevDeath = ch.threeMesh && idx < ch.slotCount ? atlasSlotDeath(ch, i4) : -Infinity;
    const gen = (ch.slotGen[idx] = (ch.slotGen[idx] + 1) >>> 0);

    const curveRow = opts.curveRow !== undefined
      ? opts.curveRow
      : lut.compile(opts.colorCurve, opts.sizeCurve, opts.sizeYCurve ?? null, opts.velCurve ?? null);
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

    const persistent = Boolean(opts.persistent);
    const curveCycle = Number(opts.curveCycle ?? 0);
    const packedRow = persistent
      ? (curveRow + (curveCycle > 0 ? 1024 : 2048))
      : curveRow;
    const storedDur = persistent
      ? (curveCycle > 0 ? curveCycle : 1e6)
      : (opts.duration ?? 0.5);

    const slotIdx = Math.max(0, Math.min(31, (opts.space === 'local' ? (opts.effectSlotIdx | 0) : 0)));
    let px0 = opts.x ?? 0;
    let py0 = opts.y ?? 0;
    let pz0 = opts.z ?? 0;
    if (slotIdx > 0) {
      px0 -= effectDeltas[slotIdx * 3];
      py0 -= effectDeltas[slotIdx * 3 + 1];
      pz0 -= effectDeltas[slotIdx * 3 + 2];
    }

    const nStr = opts.noiseStrength ?? 0;
    const nYScale = renderMode === VFX_RENDER_MODE.STRETCHED
      ? (opts.stretch ?? 0.8)
      : renderMode === VFX_RENDER_MODE.VERTICAL
        ? 1.0
        : (nStr > 0.001 && opts.noiseYScale !== undefined ? opts.noiseYScale : 1.0);
    const phaseVal = opts.phase !== undefined ? opts.phase : prng.nextFloat();

    const hasVelCurve = Boolean(opts.hasVelCurve || opts.velCurve);
    const hasSizeSep = Boolean(opts.hasSizeSep || opts.sizeYCurve);
    const noiseDamp = Boolean(opts.noiseDamp);
    const windQ = Math.round(Math.max(0, Math.min(7, Number(opts.windMul ?? 0))) * 4);
    const scrollQ = Math.round(Math.max(0, Math.min(15, Number(opts.noiseScroll ?? 0))) * 4);
    const cullFlag = opts.cullMode === 'back' ? 1 : opts.cullMode === 'front' ? 2 : 0;
    const materialFlags = (opts.softParticles === false ? 1 : 0) + (opts.useTexture === false ? 2 : 0);

    const clampVelCfg = opts.clampVelocity && Number(opts.clampVelocity.limit) > 0 ? opts.clampVelocity : null;
    const rotSpeedCfg = opts.rotationBySpeed && opts.rotationBySpeed.enabled ? opts.rotationBySpeed : null;
    const useCpuMotion = Boolean(clampVelCfg);

    const spawnTime = simTime - Math.max(0, opts.initialAge ?? 0);
    ch.p0[i4] = px0;
    ch.p0[i4 + 1] = py0;
    ch.p0[i4 + 2] = pz0;
    ch.p0[i4 + 3] = spawnTime;

    ch.p1[i4] = opts.vx ?? 0;
    ch.p1[i4 + 1] = opts.vy ?? 0;
    ch.p1[i4 + 2] = opts.vz ?? 0;
    ch.p1[i4 + 3] = storedDur;

    ch.p2[i4] = opts.sizeStart ?? 1.0;
    ch.p2[i4 + 1] = opts.gravity ?? 0;
    ch.p2[i4 + 2] = (opts.staticPos || useCpuMotion) ? -1.0 : (opts.drag ?? 0);
    ch.p2[i4 + 3] = packedRow
      + (renderMode & 7) * 4096
      + (hasVelCurve ? 32768 : 0)
      + (noiseDamp ? 65536 : 0)
      + (hasSizeSep ? 131072 : 0)
      + cullFlag * 262144
      + materialFlags * 1048576;

    ch.p3[i4] = pack2x12Mixed(wrapAngle02Pi(opts.rotation ?? 0), opts.angularVel ?? 0, TWO_PI, 64);
    ch.p3[i4 + 1] = pack2x12Pos(opts.hdr ?? 1.0, opts.emissionBoost ?? 0, 35, 35);
    ch.p3[i4 + 2] = pack2x12Sym(opts.pivot?.[0] ?? 0, opts.pivot?.[1] ?? 0, 2, 2);
    ch.p3[i4 + 3] = pack2x12Pos(opts.velocityScale ?? 0, opts.lengthScale ?? 0, 15, 15);

    const fbCols = fb ? Math.max(1, Math.min(64, fb.cols | 0)) : 1;
    const fbRows = fb ? Math.max(1, Math.min(64, fb.rows | 0)) : 1;
    const fbBlend = fb && fb.blend !== false ? 1 : 0;
    const fbCyclesQ = Math.max(1, Math.min(2047, Math.round((fb ? (fb.cycles ?? 1) : 1) * 32)));
    ch.p4[i4] = packUvPair(uv[0] ?? 0, uv[1] ?? 0);
    ch.p4[i4 + 1] = packUvPair(uv[2] ?? 1, uv[3] ?? 1);
    ch.p4[i4 + 2] = (fbCols - 1) + (fbRows - 1) * 64 + fbBlend * 4096 + fbCyclesQ * 8192;
    ch.p4[i4 + 3] = tintRgb24;

    const aspectY = opts.aspectY ?? ((renderMode === VFX_RENDER_MODE.BILLBOARD || renderMode === VFX_RENDER_MODE.VERTICAL) && nStr <= 0.001 ? (opts.stretch ?? 1.0) : 1.0);
    const phaseByte = Math.max(0, Math.min(255, Math.round((((phaseVal % 1) + 1) % 1) * 255)));
    ch.p5[i4] = pack2x12Pos(nStr, opts.noiseFreq ?? 0.5, 35, 15);
    ch.p5[i4 + 1] = pack2x12Pos(nYScale, aspectY, 15, 15);
    ch.p5[i4 + 2] = opts.orbitalY ?? 0;
    ch.p5[i4 + 3] = phaseByte + slotIdx * 256 + windQ * 8192 + scrollQ * 262144;

    ch.p6[i4] = pack2x12Sym(opts.centerOffX ?? 0, opts.centerOffZ ?? 0, 64, 64);
    ch.p6[i4 + 1] = pack2x12Sym(opts.accelX ?? 0, opts.accelZ ?? 0, 64, 64);
    ch.p6[i4 + 2] = pack2x12Sym(wrapAngleSignedPi(opts.rotX ?? 0), wrapAngleSignedPi(opts.rotY ?? 0), Math.PI, Math.PI);
    ch.p6[i4 + 3] = pack2x12Sym(opts.spinX ?? 0, opts.spinY ?? 0, 32, 32);

    const cutByte = Math.max(0, Math.min(255, Math.round((opts.alphaCutoff ?? 0) * 255)));
    const camNearByte = Math.max(0, Math.min(255, Math.round(((opts.cameraFade?.[0] ?? 0) / 16) * 255)));
    const camFarByte = Math.max(0, Math.min(255, Math.round(((opts.cameraFade?.[1] ?? 0) / 32) * 255)));
    const uvSxByte = Math.max(1, Math.min(255, Math.round(((opts.uvScale?.[0] ?? 1) / 8) * 255)));
    const uvSyByte = Math.max(1, Math.min(255, Math.round(((opts.uvScale?.[1] ?? 1) / 8) * 255)));
    const uvOxByte = Math.max(0, Math.min(255, Math.round((((opts.uvOffset?.[0] ?? 0) % 1 + 1) % 1) * 255)));
    const uvOyByte = Math.max(0, Math.min(255, Math.round((((opts.uvOffset?.[1] ?? 0) % 1 + 1) % 1) * 255)));
    const disStartByte = opts.dissolve?.start !== undefined
      ? Math.max(1, Math.min(255, Math.round(opts.dissolve.start * 255)))
      : 0;
    const uberRow = opts.uberMat ? registerUberMaterial(opts.uberMat) : (Number.isFinite(opts.uberMatRow) ? opts.uberMatRow : -1);
    ch.p7[i4] = packRgb24(cutByte, camNearByte, camFarByte);
    ch.p7[i4 + 1] = packRgb24(uvSxByte, uvSyByte, uvOxByte);
    ch.p7[i4 + 2] = packRgb24(uvOyByte, disStartByte, 0);
    ch.p7[i4 + 3] = uberRow;

    const compiledCustom = resolveCompiledCustomData(opts.customData);
    const initLife = storedDur > 0 ? Math.max(0, Math.min(1, (opts.initialAge ?? 0) / storedDur)) : 0;
    if (compiledCustom) {
      evaluateCustomDataChannel(compiledCustom.custom1, initLife, phaseVal, ch.custom1, i4);
      evaluateCustomDataChannel(compiledCustom.custom2, initLife, phaseVal, ch.custom2, i4);
    } else if (Array.isArray(opts.custom1) || Array.isArray(opts.custom2)) {
      ch.custom1[i4] = opts.custom1?.[0] ?? 0;
      ch.custom1[i4 + 1] = opts.custom1?.[1] ?? 0;
      ch.custom1[i4 + 2] = opts.custom1?.[2] ?? 0;
      ch.custom1[i4 + 3] = opts.custom1?.[3] ?? 0;
      ch.custom2[i4] = opts.custom2?.[0] ?? 0;
      ch.custom2[i4 + 1] = opts.custom2?.[1] ?? 0;
      ch.custom2[i4 + 2] = opts.custom2?.[2] ?? 0;
      ch.custom2[i4 + 3] = opts.custom2?.[3] ?? 0;
    } else {
      ch.custom1[i4] = 0; ch.custom1[i4 + 1] = 0; ch.custom1[i4 + 2] = 0; ch.custom1[i4 + 3] = 0;
      ch.custom2[i4] = 0; ch.custom2[i4 + 1] = 0; ch.custom2[i4 + 2] = 0; ch.custom2[i4 + 3] = 0;
    }

    if (hasDynamicCustomCurve(compiledCustom) || clampVelCfg || rotSpeedCfg) {
      ch.dynamicSlots.push({
        idx,
        gen,
        spawnTime,
        dur: storedDur,
        isPersistent: persistent,
        compiledCustom: hasDynamicCustomCurve(compiledCustom) ? compiledCustom : null,
        randSeed: phaseVal,
        px: px0,
        py: py0,
        pz: pz0,
        vx: opts.vx ?? 0,
        vy: opts.vy ?? 0,
        vz: opts.vz ?? 0,
        gravity: opts.gravity ?? 0,
        drag: opts.drag ?? 0,
        accelX: opts.accelX ?? 0,
        accelZ: opts.accelZ ?? 0,
        windMul: Number(opts.windMul ?? 0),
        clampVel: clampVelCfg,
        rotBySpeed: rotSpeedCfg,
        rotAcc: wrapAngle02Pi(opts.rotation ?? 0),
      });
    }

    ch.slotCount = Math.max(ch.slotCount, idx + 1);
    if (ch.threeMesh) {
      const death = atlasSlotDeath(ch, i4);
      if (death >= ch.latestDeath) {
        ch.latestDeath = death;
        ch.rescanDeath = false;
      } else if (prevDeath === ch.latestDeath) {
        ch.rescanDeath = true;
      }
    }

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

  function stepChannelDynamicSlots(ch, dt) {
    const list = ch.dynamicSlots;
    if (!list || list.length === 0) return;
    for (let s = list.length - 1; s >= 0; s--) {
      const d = list[s];
      if (ch.slotGen[d.idx] !== d.gen) {
        list[s] = list[list.length - 1];
        list.pop();
        continue;
      }
      const age = simTime - d.spawnTime;
      if (!d.isPersistent && age >= d.dur) {
        list[s] = list[list.length - 1];
        list.pop();
        continue;
      }
      const t = d.dur > 0
        ? (d.isPersistent ? (((age / d.dur) % 1 + 1) % 1) : Math.max(0, Math.min(1, age / d.dur)))
        : 0;
      const i4 = d.idx * 4;
      if (d.compiledCustom) {
        evaluateCustomDataChannel(d.compiledCustom.custom1, t, d.randSeed, ch.custom1, i4);
        evaluateCustomDataChannel(d.compiledCustom.custom2, t, d.randSeed, ch.custom2, i4);
      }
      if (d.clampVel && dt > 0) {
        const ax = d.accelX + windVec[0] * d.windMul;
        const ay = (is2D ? d.gravity : -d.gravity) + windVec[1] * d.windMul;
        const az = d.accelZ + windVec[2] * d.windMul;
        const damp = Math.exp(-Math.max(0, d.drag) * dt);
        d.vx = d.vx * damp + ax * dt;
        d.vy = d.vy * damp + ay * dt;
        d.vz = d.vz * damp + az * dt;
        const lim = Number(d.clampVel.limit) || 0;
        const cDampen = Math.max(0, Math.min(1, Number(d.clampVel.dampen ?? 1)));
        const spd = Math.hypot(d.vx, d.vy, d.vz);
        if (lim > 0 && spd > lim) {
          const nextSpd = spd - (spd - lim) * cDampen;
          const scale = nextSpd / spd;
          d.vx *= scale;
          d.vy *= scale;
          d.vz *= scale;
        }
        d.px += d.vx * dt;
        d.py += d.vy * dt;
        d.pz += d.vz * dt;
        ch.p0[i4] = d.px;
        ch.p0[i4 + 1] = d.py;
        ch.p0[i4 + 2] = d.pz;
        ch.p1[i4] = d.vx;
        ch.p1[i4 + 1] = d.vy;
        ch.p1[i4 + 2] = d.vz;
      }
      if (d.rotBySpeed && dt > 0) {
        const vx = d.clampVel ? d.vx : d.vx;
        const spd = Math.hypot(vx, d.vy, d.vz);
        const minS = Number(d.rotBySpeed.minSpeed ?? 0);
        const maxS = Math.max(minS + 1e-4, Number(d.rotBySpeed.maxSpeed ?? 10));
        const rFrac = Math.max(0, Math.min(1, (spd - minS) / (maxS - minS)));
        const minW = Number(d.rotBySpeed.minAngularVel ?? 0);
        const maxW = Number(d.rotBySpeed.maxAngularVel ?? 0);
        const w = minW + (maxW - minW) * rFrac;
        d.rotAcc = wrapAngle02Pi(d.rotAcc + w * dt);
        ch.p3[i4] = pack2x12Mixed(d.rotAcc, 0, TWO_PI, 64);
      }
      markSlotDirty(ch, d.idx);
    }
  }

  function markSlotDirty(ch, idx) {
    if (ch.dirtyCount === 0) {
      ch.dirtyStart = idx;
      ch.dirtyCount = 1;
      return;
    }
    if (idx >= ch.dirtyStart && idx < ch.dirtyStart + ch.dirtyCount) return;
    ch.dirtyStart = 0;
    ch.dirtyCount = ch.slotCount;
  }

  function resolveChannelArg(blendOrAdditive) {
    if (blendOrAdditive && typeof blendOrAdditive === 'object') return pickChannel(blendOrAdditive);
    if (blendOrAdditive === 'alpha') return normalPool;
    if (blendOrAdditive === 'distortion') return distortionPool;
    if (blendOrAdditive === 'multiply') return multiplyPool;
    if (blendOrAdditive === 'premultiply') return premultiplyPool;
    return blendOrAdditive ? additivePool : normalPool;
  }

  function updateSlot(blendOrState, idx, x, y, z, vx, vy, vz) {
    const ch = resolveChannelArg(blendOrState);
    if (!ch || idx < 0 || idx >= ch.slotCount) return;
    const i4 = idx * 4;
    ch.p0[i4] = x;
    ch.p0[i4 + 1] = y;
    ch.p0[i4 + 2] = z;
    ch.p1[i4] = vx;
    ch.p1[i4 + 1] = vy;
    ch.p1[i4 + 2] = vz;
    markSlotDirty(ch, idx);
  }

  function killSlot(blendOrState, idx) {
    const ch = resolveChannelArg(blendOrState);
    if (!ch || idx < 0 || idx >= ch.slotCount) return;
    if (ch.threeMesh && atlasSlotDeath(ch, idx * 4) === ch.latestDeath) ch.rescanDeath = true;
    ch.p1[idx * 4 + 3] = 0;
    markSlotDirty(ch, idx);
  }

  function retireExpiredThreeBatch(ch) {
    if (ch.rescanDeath) {
      ch.latestDeath = -Infinity;
      for (let i = 0; i < ch.slotCount; i++) {
        ch.latestDeath = Math.max(ch.latestDeath, atlasSlotDeath(ch, i * 4));
      }
      ch.rescanDeath = false;
    }
    // A CPU-tracked particle may still own an expired visual slot. Preserve
    // the ring order when the batch goes idle so the slot isn't reused early.
    ch.threeMesh.geometry.instanceCount = Math.fround(simTime) <= ch.latestDeath ? ch.slotCount : 0;
  }

  function flushChannel(ch) {
    if (ch.threeMesh) retireExpiredThreeBatch(ch);
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
    for (let c = 0; c < channels.length; c++) flushChannel(channels[c]);
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);
    simTime += dt;
    timeUniform.value = simTime;
    for (let c = 0; c < channels.length; c++) stepChannelDynamicSlots(channels[c], dt);
    flushDirty();
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
    if (glUniforms.uWind2D) gl.uniform2f(glUniforms.uWind2D, windVec[0], windVec[1]);
    if (glUniforms.uEffectDeltas2D) gl.uniform2fv(glUniforms.uEffectDeltas2D, effectDeltas2D);

    if (glAtlasTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glAtlasTex);
    }

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (ch.distortion) continue;
      const activeCount = Math.min(ch.totalEmitted, ch.capacity);
      if (activeCount <= 0 || !ch.glVao) continue;
      if (ch.blendMode === 'multiply') {
        gl.uniform1i(glUniforms.uBlendMode, 1);
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
      } else if (ch.blendMode === 'premultiply') {
        gl.uniform1i(glUniforms.uBlendMode, 2);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.uniform1i(glUniforms.uBlendMode, 0);
        const dst = ch.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA;
        gl.blendFuncSeparate(gl.SRC_ALPHA, dst, gl.ONE, dst);
      }
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
    const evalExt = {
      accelX: 0,
      accelZ: 0,
      windX: windVec[0],
      windY: windVec[1],
      windZ: windVec[2],
      windMul: 0,
      noiseScroll: 0,
      noiseDamp: false,
      hasVelCurve: false,
      velDispIntegral: 0,
      velMul: 1,
      duration: 0,
      effectOffX: 0,
      effectOffY: 0,
      effectOffZ: 0,
    };

    ctx.save();
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (ch.distortion) continue;
      const count = Math.min(ch.totalEmitted, ch.capacity);
      if (count <= 0) continue;
      ctx.globalCompositeOperation = ch.blendMode === 'multiply' ? 'multiply' : (ch.additive ? 'lighter' : 'source-over');
      const decRotZ = [0, 0];
      const decHdr = [1, 0];
      const decUv0 = [0, 0];
      const decUv1 = [1, 1];
      const decNoise = [0, 0.5];
      const decScaleY = [1, 1];
      const decAccel = [0, 0];
      for (let i = 0; i < count; i++) {
        const i4 = i * 4;
        const age = simTime - ch.p0[i4 + 3];
        const dur = ch.p1[i4 + 3];
        let rowWord = Math.floor(Math.max(0, ch.p2[i4 + 3]) + 0.5);
        rowWord %= 1048576;
        rowWord %= 262144;
        const hasSizeSep = rowWord >= 131072; if (hasSizeSep) rowWord -= 131072;
        const noiseDamp = rowWord >= 65536; if (noiseDamp) rowWord -= 65536;
        const hasVelCurve = rowWord >= 32768; if (hasVelCurve) rowWord -= 32768;
        const rawCurve = rowWord % 4096;
        const isPersistent = rawCurve >= 1023.5;
        const isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
        const curveRow = rawCurve % 1024;
        if (dur <= 0 || age < 0 || (!isPersistent && age >= dur)) continue;
        const t = isLoopCurve ? ((age / Math.max(0.001, dur)) % 1) : (isPersistent ? 0 : age / dur);
        lut.sampleColor(curveRow, t, scratchRgba);
        if (scratchRgba[3] < 0.01) continue;

        let psWord = Math.floor(Math.max(0, ch.p5[i4 + 3]) + 0.5);
        const scrollQ = Math.floor(psWord / 262144); psWord -= scrollQ * 262144;
        const windQ = Math.floor(psWord / 8192); psWord -= windQ * 8192;
        const slotIdx = Math.floor(psWord / 256);
        const phaseVal = (psWord - slotIdx * 256) / 255;

        unpack2x12Sym(ch.p6[i4 + 1], 64, 64, decAccel);
        unpack2x12Pos(ch.p5[i4], 35, 15, decNoise);
        unpack2x12Pos(ch.p5[i4 + 1], 15, 15, decScaleY);
        unpack2x12Mixed(ch.p3[i4], TWO_PI, 64, decRotZ);
        unpack2x12Pos(ch.p3[i4 + 1], 35, 35, decHdr);

        evalExt.accelX = decAccel[0];
        evalExt.accelZ = decAccel[1];
        evalExt.windMul = windQ * 0.25;
        evalExt.noiseScroll = scrollQ * 0.25;
        evalExt.noiseDamp = noiseDamp;
        evalExt.hasVelCurve = hasVelCurve;
        evalExt.duration = dur;
        if (hasVelCurve) {
          evalExt.velDispIntegral = lut.sampleVelDisp(curveRow, t);
          const t1 = Math.min(1, t + 0.015);
          const t0 = Math.max(0, t - 0.015);
          evalExt.velMul = (lut.sampleVelDisp(curveRow, t1) - lut.sampleVelDisp(curveRow, t0)) / Math.max(0.001, t1 - t0);
        }
        evalExt.effectOffX = slotIdx > 0 ? effectDeltas[slotIdx * 3] : 0;
        evalExt.effectOffY = slotIdx > 0 ? effectDeltas[slotIdx * 3 + 1] : 0;
        evalExt.effectOffZ = slotIdx > 0 ? effectDeltas[slotIdx * 3 + 2] : 0;

        evaluateAtlasParticlePosition(
          ch.p0[i4], ch.p0[i4 + 1], ch.p0[i4 + 2],
          ch.p1[i4], ch.p1[i4 + 1], ch.p1[i4 + 2],
          ch.p2[i4 + 1], ch.p2[i4 + 2],
          decNoise[0], decNoise[1], phaseVal,
          age, true, scratchPos,
          0, 0, 0, decScaleY[0], evalExt,
        );

        const sx = (scratchPos[0] - camX) * zoom + halfW;
        const sy = (scratchPos[1] - camY) * zoom + halfH;
        const sizeX = ch.p2[i4] * lut.sampleSize(curveRow, t) * zoom;
        const sizeY = (hasSizeSep ? ch.p2[i4] * lut.sampleSizeY(curveRow, t) * zoom : sizeX) * Math.max(0.05, decScaleY[1]);
        if (sizeX <= 0.5 && sizeY <= 0.5) continue;

        ctx.globalAlpha = Math.max(0, Math.min(1, scratchRgba[3]));
        unpackRgb24Into(ch.p4[i4 + 3], scratchTint);
        const r8 = (Math.min(1, scratchRgba[0] * scratchTint[0] * decHdr[0]) * 255) | 0;
        const g8 = (Math.min(1, scratchRgba[1] * scratchTint[1] * decHdr[0]) * 255) | 0;
        const b8 = (Math.min(1, scratchRgba[2] * scratchTint[2] * decHdr[0]) * 255) | 0;

        if (activeAtlasCanvas && typeof ctx.drawImage === 'function') {
          let fbWord = Math.floor(Math.max(0, ch.p4[i4 + 2]) + 0.5);
          const cyclesQ = Math.floor(fbWord / 8192); fbWord -= cyclesQ * 8192;
          if (fbWord >= 4096) fbWord -= 4096;
          const rows = Math.max(1, Math.floor(fbWord / 64) + 1);
          const cols = Math.max(1, (fbWord % 64) + 1);
          const cycles = Math.max(0.01, cyclesQ / 32);
          const total = cols * rows;
          const frame = total > 1 ? Math.min(total - 1, Math.floor(((t * cycles) % 1) * total)) : 0;
          const col = frame % cols;
          const row = (frame / cols) | 0;
          const aw = activeAtlasCanvas.width || 512;
          const ah = activeAtlasCanvas.height || 512;
          unpackUvPair(ch.p4[i4], decUv0);
          unpackUvPair(ch.p4[i4 + 1], decUv1);
          const rx = decUv0[0] * aw;
          const ry = decUv0[1] * ah;
          const rw = (decUv1[0] - decUv0[0]) * aw;
          const rh = (decUv1[1] - decUv0[1]) * ah;
          const cw = rw / cols;
          const chPx = rh / rows;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(decRotZ[0] + decRotZ[1] * age);
          ctx.drawImage(
            activeAtlasCanvas,
            rx + col * cw, ry + row * chPx, cw, chPx,
            -sizeX * 0.5, -sizeY * 0.5, sizeX, sizeY,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = `rgb(${r8},${g8},${b8})`;
          ctx.beginPath();
          ctx.ellipse ? ctx.ellipse(sx, sy, sizeX * 0.5, sizeY * 0.5, decRotZ[0] + decRotZ[1] * age, 0, 6.2831853) : ctx.arc(sx, sy, sizeX * 0.5, 0, 6.2831853);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    timeUniform.value = 0;
    effectDeltas.fill(0);
    effectDeltas2D.fill(0);
    for (let i = 0; i < 32; i++) threeEffectVecs[i].set(0, 0, 0);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      ch.cursor = 0;
      ch.slotCount = 0;
      ch.latestDeath = -Infinity;
      ch.rescanDeath = false;
      ch.totalEmitted = 0;
      ch.dirtyStart = 0;
      ch.dirtyCount = ch.capacity;
      ch.wrapCount = 0;
      ch.lastDirtyRanges.length = 0;
      ch.dynamicSlots.length = 0;
      ch.p0.fill(0);
      ch.p1.fill(0);
      ch.custom1.fill(0);
      ch.custom2.fill(0);
      for (let i = 0; i < ch.capacity; i++) ch.p7[i * 4 + 3] = -1;
      if (ch.threeAttrs) {
        submitRingBufferRanges(ch.threeAttrs[0], 0, ch.capacity, ch.capacity, 4);
        submitRingBufferRanges(ch.threeAttrs[1], 0, ch.capacity, ch.capacity, 4);
      }
      if (ch.threeMesh) ch.threeMesh.geometry.instanceCount = 0;
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
    channels.length -= renderStateChannels.size;
    renderStateChannels.clear();
    uberMatCache.clear();
    softDepthUniforms.uSoftDepthTex.value = null;
    sceneColorUniforms.uSceneTex.value = null;
    lut.dispose();
    uberLut?.dispose?.();
  }

  return {
    get texture() { return activeAtlasTex; },
    capacity,
    lut,
    uberLut,
    get regions() { return regions; },
    compileCurves: lut.compile,
    registerUberMaterial,
    setAtlas,
    setDepthTexture,
    setSceneTexture,
    setQualityTier,
    hasActiveDistortion,
    setWind,
    setEffectOffset,
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
      let renderStateTotal = 0;
      for (const ch of renderStateChannels.values()) renderStateTotal += ch.totalEmitted;
      return {
        capacity,
        curveRows: lut.rowCount,
        normalCursor: normalPool.cursor,
        additiveCursor: additivePool.cursor,
        multiplyCursor: multiplyPool.cursor,
        premultiplyCursor: premultiplyPool.cursor,
        distortionCursor: distortionPool.cursor,
        normalTotal: normalPool.totalEmitted,
        additiveTotal: additivePool.totalEmitted,
        multiplyTotal: multiplyPool.totalEmitted,
        premultiplyTotal: premultiplyPool.totalEmitted,
        distortionTotal: distortionPool.totalEmitted,
        renderStateChannels: renderStateChannels.size,
        renderStateTotal,
      };
    },
  };
}

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
attribute vec4 aAtlasP2; // sizeStart, gravity, drag, curveRow
attribute vec4 aAtlasP3; // rot0, angularVel, hdr, renderMode (0=billboard, 1=horizontal, 2=stretched, 4=vertical)
attribute vec4 aAtlasP4; // u0, v0, u1, v1
attribute vec4 aAtlasP5; // cols, rows, cycles, blendFlag
attribute vec4 aAtlasP6; // noiseStrength, noiseFreq, stretchOrYScale, phase
attribute vec4 aAtlasP7; // tintRgb24, orbitalY, centerOffX, centerOffZ
attribute vec4 aAtlasP8; // accelX, accelZ, aspectY, packedFlags
attribute vec4 aAtlasP9; // rotX0, rotY0, spinX, spinY

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D uCurveLut;
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

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
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
  float rawCurve = aAtlasP2.w;
  bool isPersistent = rawCurve >= 1023.5;
  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
  float curveRow = mod(rawCurve, 1024.0);
  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);
  vLifeRatio = t;
  vUv = uv;
  vCurveRow = curveRow;
  vHdr = aAtlasP3.z;
  vUvRect = aAtlasP4;
  vFlipbook = aAtlasP5;
  vTint = unpackRgb24(aAtlasP7.x);

  float fl = floor(max(0.0, aAtlasP8.w) + 0.5);
  float scrollQ = floor(fl / 8192.0); fl -= scrollQ * 8192.0;
  float windQ = floor(fl / 256.0); fl -= windQ * 256.0;
  float hasSizeSep = step(127.5, fl); fl -= hasSizeSep * 128.0;
  float noiseDamp = step(63.5, fl); fl -= noiseDamp * 64.0;
  float hasVelCurve = step(31.5, fl); fl -= hasVelCurve * 32.0;
  int slotIdx = int(fl + 0.5);
  float noiseScroll = scrollQ * 0.25;
  float windMul = windQ * 0.25;

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
      ? vec3(aAtlasP8.x, aAtlasP2.y, aAtlasP8.y) + uWind * windMul
      : vec3(aAtlasP8.x, -aAtlasP2.y, aAtlasP8.y) + uWind * windMul;
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
      float nFreq = max(0.08, aAtlasP6.y);
      float ph = aAtlasP6.w * 6.2831853 + noiseScroll * age * 1.7;
      float ph0 = aAtlasP6.w * 6.2831853;
      float travelSpd = length(aAtlasP1.xyz) + abs(aAtlasP7.y) * length(aAtlasP7.zw);
      float spatialRate = 1.0 + clamp((travelSpd - 2.2) * 0.25, 0.0, 5.5);
      float w1 = nFreq * 2.5 * spatialRate;
      float w2 = nFreq * 4.2 * spatialRate;
      float rm = aAtlasP3.w;
      float yScale = (rm > 1.5 && rm < 2.5) ? 1.0 : aAtlasP6.z;
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

  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);
  float curSizeY = (hasSizeSep > 0.5) ? (aAtlasP2.x * sampleSizeYCurve(curveRow, t)) : curSize;
  float aspectY = max(0.05, aAtlasP8.z);
  float rot = aAtlasP3.x + aAtlasP3.y * age;
  float renderMode = aAtlasP3.w;
  bool hasRot3D = (abs(aAtlasP9.x) + abs(aAtlasP9.y) + abs(aAtlasP9.z) + abs(aAtlasP9.w)) > 0.001;

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
    vec2 p2 = worldPos.xy + axisX * (position.x * lenScale) + axisY * (position.y * curSizeY * aspectY);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, worldPos.z, 1.0);
  } else if (hasRot3D && (renderMode < 1.5 || renderMode > 3.5)) {
    mat3 rotMat = euler3D(aAtlasP9.x + aAtlasP9.z * age, aAtlasP9.y + aAtlasP9.w * age, rot);
    vec3 localQ = vec3(position.x * curSize, position.y * curSizeY * aspectY, 0.0);
    if (renderMode > 0.5 && renderMode < 1.5) {
      localQ = vec3(position.x * curSize, 0.0, position.y * curSizeY * aspectY);
    }
    vec3 worldQuad = worldPos + rotMat * localQ;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);
  } else if (renderMode > 0.5 && renderMode < 1.5) {
    float c = cos(rot);
    float s = sin(rot);
    vec3 worldQuad = worldPos + vec3(
      (position.x * c - position.y * s) * curSize,
      0.0,
      (position.x * s + position.y * c) * curSizeY * aspectY
    );
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);
  } else if (renderMode > 3.5) {
    vec3 camRight = vec3(modelViewMatrix[0][0], 0.0, modelViewMatrix[2][0]);
    float rLen = length(camRight);
    camRight = rLen > 0.0001 ? (camRight / rLen) : vec3(1.0, 0.0, 0.0);
    vec3 upW = vec3(0.0, 1.0, 0.0);
    float c = cos(rot);
    float s = sin(rot);
    vec2 rPos = vec2(
      (position.x * c - position.y * s) * curSize,
      (position.x * s + position.y * c) * curSizeY * aspectY
    );
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
    float billH = (renderMode < 0.5) ? (curSizeY * aspectY) : curSizeY;
    float minBill = (renderMode < 0.5 && curSize > 0.001) ? abs(mvCenter.z) * 0.0042 : 0.0;
    mvCenter.xy += rightAxis * (position.x * max(major, minBill)) + upAxis * (position.y * max(billH, minBill));
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
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture2D(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));
  vec4 c1 = texture2D(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));
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
  if (curveCol.a < 0.001) discard;

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
  // Preserve HDR hue and intensity on fixed-point RGBA8 framebuffers before hardware clamp.
  float peak = max(rgb.r, max(rgb.g, rgb.b));
  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {
    float boost = min(peak, 1.0 / alpha);
    rgb /= boost;
    alpha *= boost;
  }
  gl_FragColor = vec4(rgb, alpha);
}
`;

export const ATLAS_PARTICLE_DISTORTION_FS = /* glsl */ `
precision highp float;

uniform sampler2D uCurveLut;
uniform sampler2D uAtlasTex;
uniform sampler2D uSceneTex;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasSceneTex;
uniform float uDistortionStrength;
uniform vec2 uInvViewport;

varying vec2 vUv;
varying float vLifeRatio;
varying float vCurveRow;
varying float vHdr;
varying vec4 vUvRect;
varying vec4 vFlipbook;
varying vec3 vTint;

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
  if (uHasSceneTex < 0.5) discard;
  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);
  if (curveCol.a < 0.002) discard;

  vec2 centered = vUv * 2.0 - 1.0;
  float rad = length(centered);
  vec2 nOffset = vec2(0.0);
  float maskAlpha = curveCol.a;

  if (uHasAtlas > 0.5) {
    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 texCol;
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
      vec2 mapped = vec2(
        mix(vUvRect.x, vUvRect.z, topDownUv.x),
        mix(vUvRect.y, vUvRect.w, topDownUv.y)
      );
      if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;
      texCol = texture2D(uAtlasTex, mapped);
    }
    nOffset = texCol.rg * 2.0 - 1.0;
    float radialFade = clamp(1.0 - rad * rad, 0.0, 1.0);
    float edgeAlpha = (texCol.a < 0.995) ? texCol.a : radialFade;
    maskAlpha *= edgeAlpha;
  } else {
    if (rad > 1.0) discard;
    float falloff = exp(-3.4 * rad * rad);
    nOffset = centered * falloff;
    maskAlpha *= falloff;
  }

  if (maskAlpha < 0.002) discard;
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
layout(location = 9) in vec4 aAtlasP8;

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

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
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
  float rawCurve = aAtlasP2.w;
  bool isPersistent = rawCurve >= 1023.5;
  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
  float curveRow = mod(rawCurve, 1024.0);
  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);
  vLifeRatio = t;
  vUv = aQuadPos + 0.5;
  vCurveRow = curveRow;
  vHdr = aAtlasP3.z;
  vUvRect = aAtlasP4;
  vFlipbook = aAtlasP5;
  vTint = unpackRgb24(aAtlasP7.x);

  float fl = floor(max(0.0, aAtlasP8.w) + 0.5);
  float scrollQ = floor(fl / 8192.0); fl -= scrollQ * 8192.0;
  float windQ = floor(fl / 256.0); fl -= windQ * 256.0;
  float hasSizeSep = step(127.5, fl); fl -= hasSizeSep * 128.0;
  float noiseDamp = step(63.5, fl); fl -= noiseDamp * 64.0;
  float hasVelCurve = step(31.5, fl); fl -= hasVelCurve * 32.0;
  int slotIdx = int(fl + 0.5);
  float noiseScroll = scrollQ * 0.25;
  float windMul = windQ * 0.25;

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
    vec2 gVec = vec2(aAtlasP8.x, aAtlasP2.y) + uWind2D * windMul;
    worldPos = aAtlasP0.xy + aAtlasP1.xy * dispFactor + 0.5 * gVec * (age * age);
    curVel = aAtlasP1.xy * velDecay + gVec * age;

    float nStr = aAtlasP6.x;
    if (nStr > 0.001) {
      float nFreq = max(0.05, aAtlasP6.y);
      float ph = aAtlasP6.w * 6.2831853 + noiseScroll * age * 1.7;
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
  float aspectY = max(0.05, aAtlasP8.z);
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

  float billH = (aAtlasP3.w < 0.5) ? (curSizeY * aspectY) : curSizeY;
  vec2 p = worldPos + axisX * (aQuadPos.x * lenScale) + axisY * (aQuadPos.y * billH);
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
  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;
  float s = clamp(t, 0.0, 1.0) * 127.0;
  float i0 = floor(s);
  float i1 = min(127.0, i0 + 1.0);
  float f = s - i0;
  vec4 c0 = texture(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));
  vec4 c1 = texture(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));
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
  if (curveCol.a < 0.001) discard;

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
  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);
  float peak = max(rgb.r, max(rgb.g, rgb.b));
  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {
    float boost = min(peak, 1.0 / alpha);
    rgb /= boost;
    alpha *= boost;
  }
  fragColor = vec4(rgb, alpha);
}
`;

function createAtlasChannel(capacity, additive, distortion = false) {
  return {
    capacity,
    additive,
    distortion,
    p0: new Float32Array(capacity * 4),
    p1: new Float32Array(capacity * 4),
    p2: new Float32Array(capacity * 4),
    p3: new Float32Array(capacity * 4),
    p4: new Float32Array(capacity * 4),
    p5: new Float32Array(capacity * 4),
    p6: new Float32Array(capacity * 4),
    p7: new Float32Array(capacity * 4),
    p8: new Float32Array(capacity * 4),
    p9: new Float32Array(capacity * 4),
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
  const normalPool = createAtlasChannel(capacity, false, false);
  const additivePool = createAtlasChannel(capacity, true, false);
  const distortionPool = createAtlasChannel(Math.max(128, (capacity >> 2) | 0), false, true);
  const channels = [normalPool, additivePool, distortionPool];
  const lut = createCurveLutTable(THREE);

  /** @type {Record<string, readonly number[]>} */
  let regions = atlasRegions ? { ...atlasRegions } : { ...PROCEDURAL_VFX_ATLAS_REGIONS };
  /** @type {object | null} */
  let activeAtlasTex = atlasTexture;
  /** @type {HTMLCanvasElement | OffscreenCanvas | null} */
  let activeAtlasCanvas = null;
  /** @type {object | null} */
  let activeSceneTex = null;
  let distortionStrength = 0.045;
  const windVec = new Float32Array([0, 0, 0]);
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
    geo.instanceCount = ch.capacity;

    const arrays = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7, ch.p8, ch.p9];
    const attrs = [];
    for (let i = 0; i < arrays.length; i++) {
      const attr = new THREE.InstancedBufferAttribute(arrays[i], 4);
      if (THREE.DynamicDrawUsage) attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(`aAtlasP${i}`, attr);
      attrs.push(attr);
    }

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    const uniforms = {
      uTime: { value: 0 },
      uIs2D: { value: is2D ? 1.0 : 0.0 },
      uCurveLut: { value: lut.texture },
      uAtlasTex: { value: activeAtlasTex },
      uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
      uFlipV: { value: activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0 },
      uWind: { value: THREE.Vector3 ? new THREE.Vector3() : { set() {} } },
      uEffectDeltas: { value: threeEffectVecs },
      uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } },
      ...(ch.distortion
        ? {
            uSceneTex: { value: activeSceneTex },
            uHasSceneTex: { value: activeSceneTex ? 1.0 : 0.0 },
            uDistortionStrength: { value: distortionStrength },
          }
        : {
            uSoftDepthTex: { value: null },
            uHasSoftDepth: { value: 0.0 },
            uSoftFade: { value: 0.45 },
            uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } },
          }),
    };

    const mat = new MatCtor({
      vertexShader: ATLAS_PARTICLE_VERTEX_GLSL,
      fragmentShader: ch.distortion ? ATLAS_PARTICLE_DISTORTION_FS : ATLAS_PARTICLE_FRAGMENT_GLSL,
      uniforms,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: ch.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = ch.distortion ? (VFX_RENDER_ORDERS.PARTICLES + 2) : VFX_RENDER_ORDERS.PARTICLES;
    mesh.visible = ch.distortion ? Boolean(activeSceneTex) : true;
    mesh.name = ch.distortion ? 'HGameVfxAtlasDistortion' : (ch.additive ? 'HGameVfxAtlasAdditive' : 'HGameVfxAtlasNormal');
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

      const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7, ch.p8];
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
    initThreeChannel(distortionPool);
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
    updateThreeAtlasUniforms(distortionPool);
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
      if (!mat || !mat.uniforms.uSoftDepthTex) continue;
      mat.uniforms.uSoftDepthTex.value = depthTexture;
      mat.uniforms.uHasSoftDepth.value = depthTexture ? 1.0 : 0.0;
      mat.uniforms.uSoftFade.value = softFade;
      mat.uniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      mat.uniforms.uCamNearFar.value.set(near, far);
    }
  }

  /**
   * Binds a background scene color texture for screen-space refraction distortion particles.
   * @param {object | null} sceneTexture
   * @param {{ width?: number, height?: number, strength?: number }} [opts]
   */
  function setSceneTexture(sceneTexture, { width = 1280, height = 720, strength = 0.045 } = {}) {
    activeSceneTex = sceneTexture || null;
    distortionStrength = Math.max(0, Number(strength) || 0.045);
    const mat = distortionPool.threeMat;
    if (mat) {
      mat.uniforms.uSceneTex.value = activeSceneTex;
      mat.uniforms.uHasSceneTex.value = activeSceneTex ? 1.0 : 0.0;
      mat.uniforms.uDistortionStrength.value = distortionStrength;
      mat.uniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }
    if (distortionPool.threeMesh) {
      distortionPool.threeMesh.visible = Boolean(activeSceneTex);
    }
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
    for (let c = 0; c < channels.length; c++) {
      const mat = channels[c].threeMat;
      if (mat && mat.uniforms.uWind) mat.uniforms.uWind.value.set(wx, wy, wz);
    }
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

  /**
   * Emits a single textured/curve particle and returns its slot index.
   * @param {object} [opts]
   * @returns {number} Slot index in its channel
   */
  function pickChannel(opts) {
    if (opts.blend === 'distortion') return distortionPool;
    return (opts.blend === 'additive' || Boolean(opts.additive)) ? additivePool : normalPool;
  }

  function emit(opts = {}) {
    const ch = pickChannel(opts);
    const idx = ch.cursor;
    const i4 = idx * 4;

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

    ch.p0[i4] = px0;
    ch.p0[i4 + 1] = py0;
    ch.p0[i4 + 2] = pz0;
    ch.p0[i4 + 3] = simTime - Math.max(0, opts.initialAge ?? 0);

    ch.p1[i4] = opts.vx ?? 0;
    ch.p1[i4 + 1] = opts.vy ?? 0;
    ch.p1[i4 + 2] = opts.vz ?? 0;
    ch.p1[i4 + 3] = storedDur;

    ch.p2[i4] = opts.sizeStart ?? 1.0;
    ch.p2[i4 + 1] = opts.gravity ?? 0;
    ch.p2[i4 + 2] = opts.staticPos ? -1.0 : (opts.drag ?? 0);
    ch.p2[i4 + 3] = packedRow;

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
      : renderMode === VFX_RENDER_MODE.VERTICAL
        ? 1.0
        : (nStr > 0.001 && opts.noiseYScale !== undefined ? opts.noiseYScale : 1.0);
    ch.p6[i4] = nStr;
    ch.p6[i4 + 1] = opts.noiseFreq ?? 0.5;
    ch.p6[i4 + 2] = nYScale;
    ch.p6[i4 + 3] = opts.phase !== undefined ? opts.phase : prng.nextFloat();

    ch.p7[i4] = tintRgb24;
    ch.p7[i4 + 1] = opts.orbitalY ?? 0;
    ch.p7[i4 + 2] = opts.centerOffX ?? 0;
    ch.p7[i4 + 3] = opts.centerOffZ ?? 0;

    const hasVelCurve = Boolean(opts.hasVelCurve || opts.velCurve);
    const hasSizeSep = Boolean(opts.hasSizeSep || opts.sizeYCurve);
    const noiseDamp = Boolean(opts.noiseDamp);
    const windQ = Math.round(Math.max(0, Math.min(7, Number(opts.windMul ?? 0))) * 4);
    const scrollQ = Math.round(Math.max(0, Math.min(15, Number(opts.noiseScroll ?? 0))) * 4);
    const packedFlags = slotIdx
      + (hasVelCurve ? 32 : 0)
      + (noiseDamp ? 64 : 0)
      + (hasSizeSep ? 128 : 0)
      + windQ * 256
      + scrollQ * 8192;

    ch.p8[i4] = opts.accelX ?? 0;
    ch.p8[i4 + 1] = opts.accelZ ?? 0;
    ch.p8[i4 + 2] = opts.aspectY ?? ((renderMode === VFX_RENDER_MODE.BILLBOARD || renderMode === VFX_RENDER_MODE.VERTICAL) && nStr <= 0.001 ? (opts.stretch ?? 1.0) : 1.0);
    ch.p8[i4 + 3] = packedFlags;

    ch.p9[i4] = opts.rotX ?? 0;
    ch.p9[i4 + 1] = opts.rotY ?? 0;
    ch.p9[i4 + 2] = opts.spinX ?? 0;
    ch.p9[i4 + 3] = opts.spinY ?? 0;

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
    ch.dirtyStart = 0;
    ch.dirtyCount = Math.min(ch.capacity, Math.max(ch.totalEmitted, idx + 1));
  }

  function resolveChannelArg(blendOrAdditive) {
    if (blendOrAdditive === 'distortion') return distortionPool;
    return blendOrAdditive ? additivePool : normalPool;
  }

  function updateSlot(additive, idx, x, y, z, vx, vy, vz) {
    const ch = resolveChannelArg(additive);
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
    const ch = resolveChannelArg(additive);
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
        const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3, ch.p4, ch.p5, ch.p6, ch.p7, ch.p8];
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
    flushChannel(distortionPool);
  }

  function update(visualDt) {
    simTime += Math.max(0, visualDt);
    flushDirty();
    if (normalPool.threeMat) normalPool.threeMat.uniforms.uTime.value = simTime;
    if (additivePool.threeMat) additivePool.threeMat.uniforms.uTime.value = simTime;
    if (distortionPool.threeMat) distortionPool.threeMat.uniforms.uTime.value = simTime;
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
      ctx.globalCompositeOperation = ch.additive ? 'lighter' : 'source-over';
      for (let i = 0; i < count; i++) {
        const i4 = i * 4;
        const age = simTime - ch.p0[i4 + 3];
        const dur = ch.p1[i4 + 3];
        const rawCurve = ch.p2[i4 + 3];
        const isPersistent = rawCurve >= 1023.5;
        const isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;
        const curveRow = rawCurve % 1024;
        if (dur <= 0 || age < 0 || (!isPersistent && age >= dur)) continue;
        const t = isLoopCurve ? ((age / Math.max(0.001, dur)) % 1) : (isPersistent ? 0 : age / dur);
        lut.sampleColor(curveRow, t, scratchRgba);
        if (scratchRgba[3] < 0.01) continue;

        let fl = Math.floor(Math.max(0, ch.p8[i4 + 3]) + 0.5);
        const scrollQ = Math.floor(fl / 8192); fl -= scrollQ * 8192;
        const windQ = Math.floor(fl / 256); fl -= windQ * 256;
        const hasSizeSep = fl >= 128; if (hasSizeSep) fl -= 128;
        const noiseDamp = fl >= 64; if (noiseDamp) fl -= 64;
        const hasVelCurve = fl >= 32; if (hasVelCurve) fl -= 32;
        const slotIdx = fl | 0;

        evalExt.accelX = ch.p8[i4];
        evalExt.accelZ = ch.p8[i4 + 1];
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
          ch.p6[i4], ch.p6[i4 + 1], ch.p6[i4 + 3],
          age, true, scratchPos,
          0, 0, 0, ch.p6[i4 + 2], evalExt,
        );

        const sx = (scratchPos[0] - camX) * zoom + halfW;
        const sy = (scratchPos[1] - camY) * zoom + halfH;
        const sizeX = ch.p2[i4] * lut.sampleSize(curveRow, t) * zoom;
        const sizeY = (hasSizeSep ? ch.p2[i4] * lut.sampleSizeY(curveRow, t) * zoom : sizeX) * Math.max(0.05, ch.p8[i4 + 2]);
        if (sizeX <= 0.5 && sizeY <= 0.5) continue;

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
            -sizeX * 0.5, -sizeY * 0.5, sizeX, sizeY,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = `rgb(${r8},${g8},${b8})`;
          ctx.beginPath();
          ctx.ellipse ? ctx.ellipse(sx, sy, sizeX * 0.5, sizeY * 0.5, ch.p3[i4] + ch.p3[i4 + 1] * age, 0, 6.2831853) : ctx.arc(sx, sy, sizeX * 0.5, 0, 6.2831853);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    effectDeltas.fill(0);
    effectDeltas2D.fill(0);
    for (let i = 0; i < 32; i++) threeEffectVecs[i].set(0, 0, 0);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      ch.cursor = 0;
      ch.totalEmitted = 0;
      ch.dirtyStart = 0;
      ch.dirtyCount = ch.capacity;
      ch.wrapCount = 0;
      ch.lastDirtyRanges.length = 0;
      ch.p0.fill(0);
      ch.p1.fill(0);
      if (ch.threeAttrs) {
        submitRingBufferRanges(ch.threeAttrs[0], 0, ch.capacity, ch.capacity, 4);
        submitRingBufferRanges(ch.threeAttrs[1], 0, ch.capacity, ch.capacity, 4);
      }
      if (ch.threeMat) ch.threeMat.uniforms.uTime.value = 0;
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
    setSceneTexture,
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
      return {
        capacity,
        curveRows: lut.rowCount,
        normalCursor: normalPool.cursor,
        additiveCursor: additivePool.cursor,
        distortionCursor: distortionPool.cursor,
        normalTotal: normalPool.totalEmitted,
        additiveTotal: additivePool.totalEmitted,
        distortionTotal: distortionPool.totalEmitted,
      };
    },
  };
}

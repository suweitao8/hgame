/**
 * Shared GLSL chunks, packing constants, unified vertex data bus,
 * MinMaxCurve / MinMaxGradient 16-point LUT compilers, and Material LUT / CustomData compilers
 * shared across HGame's VFX subsystems (vfx-shader-profiles, vfx-shuriken-kernel,
 * vfx-atlas-particles, vfx-mesh, vfx-trails).
 */

import { VFX_FLIPBOOK_GLSL } from './vfx-flipbook.js';

export const VFX_CURVE_LUT_SAMPLES = 16;

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compiles either `[v0, v1, ...]` uniform samples or `[[t0, v0], [t1, v1], ...]` keyframes
 * into a fixed 16-point `Float32Array` Curve LUT for O(1) runtime interpolation.
 * @param {number[] | Array<[number, number]> | number | null | undefined} curveRaw
 * @param {number} [scalar=1.0]
 * @param {number} [defaultVal=1.0]
 * @returns {Float32Array}
 */
export function compileCurveLut16(curveRaw, scalar = 1.0, defaultVal = 1.0) {
  const s = isFiniteNum(Number(scalar)) ? Number(scalar) : 1.0;
  const lut = new Float32Array(VFX_CURVE_LUT_SAMPLES);
  if (isFiniteNum(curveRaw)) {
    lut.fill(curveRaw * s);
    return lut;
  }
  if (!Array.isArray(curveRaw) || curveRaw.length === 0) {
    lut.fill(defaultVal * s);
    return lut;
  }

  /** @type {Array<[number, number]>} */
  let keys;
  if (Array.isArray(curveRaw[0])) {
    keys = curveRaw
      .filter((k) => Array.isArray(k) && k.length >= 2 && isFiniteNum(Number(k[0])) && isFiniteNum(Number(k[1])))
      .map((k) => [Math.max(0, Math.min(1, Number(k[0]))), Number(k[1]) * s])
      .sort((a, b) => a[0] - b[0]);
  } else {
    const n = curveRaw.length;
    keys = curveRaw.map((v, i) => [
      n === 1 ? 0 : i / (n - 1),
      (isFiniteNum(Number(v)) ? Number(v) : defaultVal) * s,
    ]);
  }

  if (keys.length === 0) {
    lut.fill(defaultVal * s);
    return lut;
  }

  for (let i = 0; i < VFX_CURVE_LUT_SAMPLES; i++) {
    const t = i / (VFX_CURVE_LUT_SAMPLES - 1);
    if (keys.length === 1 || t <= keys[0][0]) {
      lut[i] = keys[0][1];
      continue;
    }
    const last = keys[keys.length - 1];
    if (t >= last[0]) {
      lut[i] = last[1];
      continue;
    }
    for (let j = 0; j < keys.length - 1; j++) {
      const t0 = keys[j][0];
      const t1 = keys[j + 1][0];
      if (t <= t1) {
        const span = Math.max(1e-6, t1 - t0);
        const f = (t - t0) / span;
        lut[i] = keys[j][1] + (keys[j + 1][1] - keys[j][1]) * f;
        break;
      }
    }
  }
  return lut;
}

/**
 * O(1) linear interpolation on a precompiled 16-point Curve LUT.
 * @param {Float32Array} lut
 * @param {number} t
 * @returns {number}
 */
export function sampleCurveLut16(lut, t) {
  if (!lut || lut.length === 0) return 0;
  const clamped = t < 0 ? 0 : (t > 1 ? 1 : t);
  const pos = clamped * (lut.length - 1);
  const i0 = pos | 0;
  const i1 = i0 + 1 < lut.length ? i0 + 1 : i0;
  const f = pos - i0;
  return lut[i0] + (lut[i1] - lut[i0]) * f;
}

/**
 * Compiles a Unity Shuriken MinMaxCurve descriptor (`Constant`, `TwoConstants`, `Curve`, `TwoCurves`)
 * into zero-GC 16-point `Float32Array` LUTs.
 * @param {number | number[] | object | null | undefined} cfg
 * @param {number} [defaultVal=0]
 */
export function compileMinMaxCurve(cfg, defaultVal = 0) {
  if (cfg === null || cfg === undefined) return { kind: 'const', v: defaultVal };
  if (typeof cfg === 'number') {
    return { kind: 'const', v: Number.isFinite(cfg) ? cfg : defaultVal };
  }
  if (Array.isArray(cfg)) {
    if (cfg.length === 2 && typeof cfg[0] === 'number' && typeof cfg[1] === 'number') {
      const lo = cfg[0];
      const hi = cfg[1];
      return lo === hi ? { kind: 'const', v: lo } : { kind: 'range', min: lo, max: hi };
    }
    if (cfg.length > 0) {
      return { kind: 'lut', lut: compileCurveLut16(cfg, 1, defaultVal) };
    }
    return { kind: 'const', v: defaultVal };
  }
  if (typeof cfg === 'object') {
    const mode = cfg.mode;
    const scalar = Number.isFinite(cfg.scalar) ? cfg.scalar : 1;
    const hasMaxCurve = Array.isArray(cfg.curve) && cfg.curve.length > 0;
    const hasMinCurve = Array.isArray(cfg.minCurve) && cfg.minCurve.length > 0;
    if ((mode === 'twoCurves' || (hasMaxCurve && hasMinCurve)) && hasMaxCurve) {
      const minScalar = Number.isFinite(cfg.minScalar) ? cfg.minScalar : scalar;
      return {
        kind: 'lutRange',
        lutMin: compileCurveLut16(hasMinCurve ? cfg.minCurve : cfg.curve, minScalar, defaultVal),
        lutMax: compileCurveLut16(cfg.curve, scalar, defaultVal),
      };
    }
    if (mode === 'curve' || hasMaxCurve) {
      return {
        kind: 'lut',
        lut: compileCurveLut16(cfg.curve, scalar, defaultVal),
      };
    }
    const min = Number.isFinite(cfg.min)
      ? cfg.min
      : (Number.isFinite(cfg.minScalar)
        ? cfg.minScalar
        : (Number.isFinite(cfg.value)
          ? cfg.value
          : (Number.isFinite(cfg.scalar) ? cfg.scalar : defaultVal)));
    const max = Number.isFinite(cfg.max)
      ? cfg.max
      : (Number.isFinite(cfg.minScalar) && Number.isFinite(cfg.scalar) ? cfg.scalar : min);
    return min !== max ? { kind: 'range', min, max } : { kind: 'const', v: min };
  }
  return { kind: 'const', v: defaultVal };
}

/**
 * Evaluates a compiled MinMaxCurve in O(1) using birth-locked `randSeed` [0..1].
 */
export function evaluateMinMaxCurve(compiled, t, randSeed = 0.5) {
  if (!compiled || compiled.kind === 'const') return compiled ? compiled.v : 0;
  if (compiled.kind === 'range') return compiled.min + (compiled.max - compiled.min) * randSeed;
  if (compiled.kind === 'lut') return sampleCurveLut16(compiled.lut, t);
  const a = sampleCurveLut16(compiled.lutMin, t);
  const b = sampleCurveLut16(compiled.lutMax, t);
  return a + (b - a) * randSeed;
}

/**
 * Converts a single sRGB channel [0..1+] to Linear space.
 */
export function srgbToLinear(c) {
  const v = Math.max(0, Number(c) || 0);
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

function compileSingleGradientLut16(stops, isLinear = true) {
  const lut = new Float32Array(VFX_CURVE_LUT_SAMPLES * 4);
  if (!Array.isArray(stops) || stops.length === 0) {
    for (let i = 0; i < VFX_CURVE_LUT_SAMPLES; i++) {
      const o = i * 4;
      lut[o] = 1; lut[o + 1] = 1; lut[o + 2] = 1; lut[o + 3] = 1;
    }
    return lut;
  }
  const sorted = stops
    .filter((s) => Array.isArray(s) && s.length >= 2 && Array.isArray(s[1]))
    .map((s) => {
      const c = s[1];
      const r = Number(c[0] ?? 1);
      const g = Number(c[1] ?? 1);
      const b = Number(c[2] ?? 1);
      const a = Number(c[3] ?? 1);
      return [
        Math.max(0, Math.min(1, Number(s[0]) || 0)),
        isLinear ? [r, g, b, a] : [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a],
      ];
    })
    .sort((a, b) => a[0] - b[0]);

  if (sorted.length === 0) {
    for (let i = 0; i < VFX_CURVE_LUT_SAMPLES; i++) {
      const o = i * 4;
      lut[o] = 1; lut[o + 1] = 1; lut[o + 2] = 1; lut[o + 3] = 1;
    }
    return lut;
  }

  for (let i = 0; i < VFX_CURVE_LUT_SAMPLES; i++) {
    const t = i / (VFX_CURVE_LUT_SAMPLES - 1);
    let r = 1, g = 1, b = 1, a = 1;
    if (sorted.length === 1 || t <= sorted[0][0]) {
      [r, g, b, a] = sorted[0][1];
    } else if (t >= sorted[sorted.length - 1][0]) {
      [r, g, b, a] = sorted[sorted.length - 1][1];
    } else {
      for (let j = 0; j < sorted.length - 1; j++) {
        const t0 = sorted[j][0];
        const t1 = sorted[j + 1][0];
        if (t <= t1) {
          const f = (t - t0) / Math.max(1e-6, t1 - t0);
          const c0 = sorted[j][1];
          const c1 = sorted[j + 1][1];
          r = c0[0] + (c1[0] - c0[0]) * f;
          g = c0[1] + (c1[1] - c0[1]) * f;
          b = c0[2] + (c1[2] - c0[2]) * f;
          a = c0[3] + (c1[3] - c0[3]) * f;
          break;
        }
      }
    }
    const o = i * 4;
    lut[o] = r; lut[o + 1] = g; lut[o + 2] = b; lut[o + 3] = a;
  }
  return lut;
}

/**
 * Compiles a Unity MinMaxGradient into Linear-space 16-point RGBA LUTs.
 * Supports constant color, two colors, gradient, and two gradients.
 */
export function compileMinMaxGradient(cfg, isLinear = true) {
  if (!cfg) return { kind: 'const', rgba: [1, 1, 1, 1] };
  if (Array.isArray(cfg)) {
    if (typeof cfg[0] === 'number' && cfg.length >= 3) {
      const r = Number(cfg[0] ?? 1), g = Number(cfg[1] ?? 1), b = Number(cfg[2] ?? 1), a = Number(cfg[3] ?? 1);
      return { kind: 'const', rgba: isLinear ? [r, g, b, a] : [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a] };
    }
    if (Array.isArray(cfg[0]) && typeof cfg[0][0] === 'number' && Array.isArray(cfg[0][1])) {
      return { kind: 'lut', lut: compileSingleGradientLut16(cfg, isLinear) };
    }
    if (Array.isArray(cfg[0]) && typeof cfg[0][0] === 'number' && cfg.length === 2) {
      const toL = (c) => isLinear
        ? [Number(c[0] ?? 1), Number(c[1] ?? 1), Number(c[2] ?? 1), Number(c[3] ?? 1)]
        : [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), Number(c[3] ?? 1)];
      return { kind: 'range', min: toL(cfg[0]), max: toL(cfg[1]) };
    }
  }
  if (typeof cfg === 'object') {
    const lin = cfg.linear !== undefined ? Boolean(cfg.linear) : isLinear;
    if (Array.isArray(cfg.minGradient) && Array.isArray(cfg.maxGradient)) {
      return {
        kind: 'lutRange',
        lutMin: compileSingleGradientLut16(cfg.minGradient, lin),
        lutMax: compileSingleGradientLut16(cfg.maxGradient, lin),
      };
    }
    if (Array.isArray(cfg.gradient)) {
      return { kind: 'lut', lut: compileSingleGradientLut16(cfg.gradient, lin) };
    }
    if (Array.isArray(cfg.minColor) && Array.isArray(cfg.maxColor)) {
      const toL = (c) => lin
        ? [Number(c[0] ?? 1), Number(c[1] ?? 1), Number(c[2] ?? 1), Number(c[3] ?? 1)]
        : [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), Number(c[3] ?? 1)];
      return { kind: 'range', min: toL(cfg.minColor), max: toL(cfg.maxColor) };
    }
  }
  return { kind: 'const', rgba: [1, 1, 1, 1] };
}

function sampleRgbaLut16(lut, t, out) {
  const clamped = t < 0 ? 0 : (t > 1 ? 1 : t);
  const pos = clamped * (VFX_CURVE_LUT_SAMPLES - 1);
  const i0 = pos | 0;
  const i1 = i0 + 1 < VFX_CURVE_LUT_SAMPLES ? i0 + 1 : i0;
  const f = pos - i0;
  const o0 = i0 * 4;
  const o1 = i1 * 4;
  out[0] = lut[o0] + (lut[o1] - lut[o0]) * f;
  out[1] = lut[o0 + 1] + (lut[o1 + 1] - lut[o0 + 1]) * f;
  out[2] = lut[o0 + 2] + (lut[o1 + 2] - lut[o0 + 2]) * f;
  out[3] = lut[o0 + 3] + (lut[o1 + 3] - lut[o0 + 3]) * f;
  return out;
}

const _gradScratchA = [1, 1, 1, 1];
const _gradScratchB = [1, 1, 1, 1];

/**
 * Evaluates a compiled MinMaxGradient into `out` Linear RGBA array.
 */
export function evaluateMinMaxGradient(compiled, t, randSeed = 0.5, out = [1, 1, 1, 1]) {
  if (!compiled || compiled.kind === 'const') {
    const c = compiled ? compiled.rgba : [1, 1, 1, 1];
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
    return out;
  }
  if (compiled.kind === 'range') {
    const a = compiled.min;
    const b = compiled.max;
    out[0] = a[0] + (b[0] - a[0]) * randSeed;
    out[1] = a[1] + (b[1] - a[1]) * randSeed;
    out[2] = a[2] + (b[2] - a[2]) * randSeed;
    out[3] = a[3] + (b[3] - a[3]) * randSeed;
    return out;
  }
  if (compiled.kind === 'lut') {
    return sampleRgbaLut16(compiled.lut, t, out);
  }
  sampleRgbaLut16(compiled.lutMin, t, _gradScratchA);
  sampleRgbaLut16(compiled.lutMax, t, _gradScratchB);
  out[0] = _gradScratchA[0] + (_gradScratchB[0] - _gradScratchA[0]) * randSeed;
  out[1] = _gradScratchA[1] + (_gradScratchB[1] - _gradScratchA[1]) * randSeed;
  out[2] = _gradScratchA[2] + (_gradScratchB[2] - _gradScratchA[2]) * randSeed;
  out[3] = _gradScratchA[3] + (_gradScratchB[3] - _gradScratchA[3]) * randSeed;
  return out;
}

export const UBER_MAT_LUT_WIDTH = 32;
export const UBER_MAT_LUT_ROWS = 1024;

export const UBER_SHADER_KIND = Object.freeze({
  LEGACY: 0,
  UBER_FX: 1,
  PILOTO_WARP: 2,
  PBR_FX: 3,
});

export const UBER_FLAG_USE_SOFT_ALPHA = 1;
export const UBER_FLAG_USE_ALPHA_OVERRIDE = 2;
export const UBER_FLAG_USE_RAMP = 4;
export const UBER_FLAG_USE_UV_OFFSET = 8;
export const UBER_FLAG_FRESNEL = 16;
export const UBER_FLAG_INVERT_FRESNEL = 32;
export const UBER_FLAG_TINT_FRESNEL = 64;
export const UBER_FLAG_DISABLE_EROSION = 128;
export const UBER_FLAG_ALPHA_TEST = 256;
export const UBER_FLAG_POLAR_COORDS = 512;
export const UBER_FLAG_UNPACK_NORMALS = 1024;
export const UBER_FLAG_IS_PARTICLE = 2048;
export const UBER_FLAG_USE_BASE_AS_NORMAL = 4096;
export const UBER_FLAG_DOUBLE_SIDED = 8192;
export const UBER_FLAG_USE_MULTIPLY = 16384;
export const UBER_FLAG_USE_ADDITIVE = 32768;
export const UBER_FLAG_FLIPBOOK_MAIN = 65536;
export const UBER_FLAG_USE_DETAIL_VERTEX_OFFSET = 131072;
export const UBER_FLAG_MAIN_SRGB = 262144;
export const UBER_FLAG_DETAIL_SRGB = 524288;
export const UBER_FLAG_ALPHA_OV_SRGB = 1048576;
export const UBER_FLAG_CULL_FRONT = 2097152;

export const UBER_TEX_BIT_MAIN = 1;
export const UBER_TEX_BIT_DETAIL = 2;
export const UBER_TEX_BIT_ALPHA_OV = 4;
export const UBER_TEX_BIT_NORMAL = 8;
export const UBER_TEX_BIT_ORM = 16;
export const UBER_TEX_BIT_EMISSION = 32;
export const UBER_TEX_BIT_DISSOLVE = 64;
export const UBER_CLAMP_BIT_MAIN_U = 128;
export const UBER_CLAMP_BIT_MAIN_V = 256;
export const UBER_CLAMP_BIT_DETAIL_U = 512;
export const UBER_CLAMP_BIT_DETAIL_V = 1024;
export const UBER_CLAMP_BIT_ALPHA_OV_U = 2048;
export const UBER_CLAMP_BIT_ALPHA_OV_V = 4096;

const FULL_RECT = [0, 0, 1, 1];
const DEFAULT_ST = [1, 1, 0, 0];

function asVec4(v, d0 = 0, d1 = 0, d2 = 0, d3 = 0) {
  if (Array.isArray(v)) {
    return [
      Number.isFinite(v[0]) ? v[0] : d0,
      Number.isFinite(v[1]) ? v[1] : d1,
      Number.isFinite(v[2]) ? v[2] : d2,
      Number.isFinite(v[3]) ? v[3] : d3,
    ];
  }
  return [d0, d1, d2, d3];
}

function asVec2(v, d0 = 0, d1 = 0) {
  if (Array.isArray(v)) {
    return [
      Number.isFinite(v[0]) ? v[0] : d0,
      Number.isFinite(v[1]) ? v[1] : d1,
    ];
  }
  return [d0, d1];
}

function writeTexel(data, rowOffset, texelIdx, x, y, z, w) {
  const i = (rowOffset + texelIdx) * 4;
  const p0 = data[i];
  const p1 = data[i + 1];
  const p2 = data[i + 2];
  const p3 = data[i + 3];
  data[i] = x;
  data[i + 1] = y;
  data[i + 2] = z;
  data[i + 3] = w;
  return data[i] !== p0 || data[i + 1] !== p1 || data[i + 2] !== p2 || data[i + 3] !== p3;
}

/**
 * Resolve shaderKind float ID from normalized material spec.
 */
export function resolveUberShaderKindId(shaderKind) {
  if (shaderKind === 'uber_fx' || shaderKind === 1) return UBER_SHADER_KIND.UBER_FX;
  if (shaderKind === 'piloto_warp' || shaderKind === 2) return UBER_SHADER_KIND.PILOTO_WARP;
  if (shaderKind === 'pbr_fx' || shaderKind === 3) return UBER_SHADER_KIND.PBR_FX;
  return UBER_SHADER_KIND.LEGACY;
}

/**
 * Pack a Piloto ShaderGraph material specification (UberFXSG / Piloto Warp / PBR FX)
 * into a 32-texel RGBA32F row of `uMaterialLut`.
 * Returns `true` if any Float32 value in the row changed.
 */
export function packUberMaterialRow(data, rowIndex, mat = {}, texRects = null) {
  const maxRows = data ? Math.floor(data.length / (UBER_MAT_LUT_WIDTH * 4)) : 0;
  if (!data || rowIndex < 0 || rowIndex >= maxRows) return false;
  const rowOffset = rowIndex * UBER_MAT_LUT_WIDTH;
  const kind = resolveUberShaderKindId(mat.shaderKind);

  const kw = new Set(Array.isArray(mat.keywords) ? mat.keywords : []);
  let flags = 0;
  if (mat.useSoftAlpha || kw.has('_USESOFTALPHA') || kw.has('_USE_SOFT_ALPHA')) flags |= UBER_FLAG_USE_SOFT_ALPHA;
  if (mat.useAlphaOverride || kw.has('_USEALPHAOVERRIDE')) flags |= UBER_FLAG_USE_ALPHA_OVERRIDE;
  if (mat.useRamp || kw.has('_USERAMP')) flags |= UBER_FLAG_USE_RAMP;
  if (mat.useUvOffset || kw.has('_USEUVOFFSET')) flags |= UBER_FLAG_USE_UV_OFFSET;
  if (mat.useFresnel || kw.has('_FRESNEL')) flags |= UBER_FLAG_FRESNEL;
  if (mat.invertFresnel) flags |= UBER_FLAG_INVERT_FRESNEL;
  if (mat.tintFresnel) flags |= UBER_FLAG_TINT_FRESNEL;
  if (mat.disableErosion || kw.has('_DISABLEEROSION')) flags |= UBER_FLAG_DISABLE_EROSION;
  if (mat.alphaTest !== false && (mat.alphaTest || kw.has('_ALPHATEST_ON') || mat.alphaClipping)) flags |= UBER_FLAG_ALPHA_TEST;
  if (mat.polarCoordinates) flags |= UBER_FLAG_POLAR_COORDS;
  if (mat.unpackNormals) flags |= UBER_FLAG_UNPACK_NORMALS;
  if (mat.isParticle || kw.has('_ISPARTICLE')) flags |= UBER_FLAG_IS_PARTICLE;
  if (mat.useBaseAsNormal) flags |= UBER_FLAG_USE_BASE_AS_NORMAL;
  const isDoubleSided = Boolean(mat.doubleSided || mat.cull === 0 || mat.cull === 'none' || mat.cull === 'off' || mat.cullMode === 'none');
  if (isDoubleSided) {
    flags |= UBER_FLAG_DOUBLE_SIDED;
  } else if (mat.cull === 1 || mat.cull === 'front' || mat.cullMode === 'front') {
    flags |= UBER_FLAG_CULL_FRONT;
  }
  if (mat.mainSrgb !== false) flags |= UBER_FLAG_MAIN_SRGB;
  if (mat.detailSrgb) flags |= UBER_FLAG_DETAIL_SRGB;
  if (mat.alphaOvSrgb) flags |= UBER_FLAG_ALPHA_OV_SRGB;

  const detMul = asVec4(mat.detailMultiplyChannel, 0, 0, 0, 0);
  const detAdd = asVec4(mat.detailAdditiveChannel, 0, 0, 0, 0);
  const detVtx = asVec4(mat.detailVertexOffsetChannel, 0, 0, 0, 0);
  if (detMul[0] + detMul[1] + detMul[2] + detMul[3] > 0.0001) flags |= UBER_FLAG_USE_MULTIPLY;
  if (detAdd[0] + detAdd[1] + detAdd[2] + detAdd[3] > 0.0001) flags |= UBER_FLAG_USE_ADDITIVE;
  if (detVtx[0] + detVtx[1] + detVtx[2] + detVtx[3] > 0.0001) flags |= UBER_FLAG_USE_DETAIL_VERTEX_OFFSET;

  const rectOf = (key, directRect) => {
    if (Array.isArray(directRect) && directRect.length === 4) return directRect;
    if (texRects && Array.isArray(texRects[key]) && texRects[key].length === 4) return texRects[key];
    return FULL_RECT;
  };

  const mainTexKey = mat.mainTexKey || mat.baseColorMapKey || mat.distortionTextureKey || null;
  const detailTexKey = mat.detailNoiseKey || mat.detailMapKey || mat.alphaTextureKey || null;
  const alphaOvKey = mat.alphaOverrideKey || mat.dissolveMapKey || null;
  const normalKey = mat.normalMapKey || null;
  const ormKey = mat.ormMapKey || null;
  const emissionKey = mat.emissionMapKey || null;

  const mainRect = rectOf(mainTexKey, mat.mainRect);
  const detailRect = rectOf(detailTexKey, mat.detailRect);
  const alphaOvRect = rectOf(alphaOvKey, mat.alphaOverrideRect);
  const normalRect = rectOf(normalKey, mat.normalRect);
  const ormRect = rectOf(ormKey, mat.ormRect);
  const emissionRect = rectOf(emissionKey, mat.emissionRect);

  let texMask = 0;
  if (mainTexKey || mat.hasMainTex) texMask |= UBER_TEX_BIT_MAIN;
  if (detailTexKey || mat.hasDetailTex) texMask |= UBER_TEX_BIT_DETAIL;
  if (alphaOvKey || mat.hasAlphaOverrideTex) texMask |= UBER_TEX_BIT_ALPHA_OV;
  if (normalKey || mat.hasNormalTex) texMask |= UBER_TEX_BIT_NORMAL;
  if (ormKey || mat.hasOrmTex) texMask |= UBER_TEX_BIT_ORM;
  if (emissionKey || mat.hasEmissionTex) texMask |= UBER_TEX_BIT_EMISSION;
  if (mat.dissolveMapKey || mat.hasDissolveTex) texMask |= UBER_TEX_BIT_DISSOLVE;
  const mainCl = Array.isArray(mat.mainClamp) ? mat.mainClamp : null;
  const detCl = Array.isArray(mat.detailClamp) ? mat.detailClamp : null;
  const ovCl = Array.isArray(mat.alphaOvClamp) ? mat.alphaOvClamp : null;
  if (mainCl?.[0]) texMask |= UBER_CLAMP_BIT_MAIN_U;
  if (mainCl?.[1]) texMask |= UBER_CLAMP_BIT_MAIN_V;
  if (detCl?.[0]) texMask |= UBER_CLAMP_BIT_DETAIL_U;
  if (detCl?.[1]) texMask |= UBER_CLAMP_BIT_DETAIL_V;
  if (ovCl?.[0]) texMask |= UBER_CLAMP_BIT_ALPHA_OV_U;
  if (ovCl?.[1]) texMask |= UBER_CLAMP_BIT_ALPHA_OV_V;

  const blendIdx = mat.blend === 'additive' ? 2 : (mat.blend === 'multiply' ? 3 : (mat.blend === 'distortion' ? 4 : 0));
  const alphaCutoff = Number.isFinite(mat.alphaClipThreshold) ? mat.alphaClipThreshold : 0.0;

  const mainST = asVec4(mat.mainTexST || mat.baseColorMapST || mat.distortionTextureST, 1, 1, 0, 0);
  const detailST = asVec4(mat.detailNoiseST || mat.detailMapST || mat.alphaTextureST, 1, 1, 0, 0);
  const alphaOvST = asVec4(mat.alphaOverrideST || mat.dissolveMapST, 1, 1, 0, 0);
  const normalST = asVec4(mat.normalMapST, 1, 1, 0, 0);
  const ormST = asVec4(mat.ormMapST, 1, 1, 0, 0);
  const emissionST = asVec4(mat.emissionMapST, 1, 1, 0, 0);

  const mainChan = asVec4(mat.mainTextureChannel, 1, 1, 1, 0);
  const mainAlphaChan = asVec4(mat.mainAlphaChannel || mat.alphaChannelPicker, 0, 0, 0, 1);
  const alphaOvChan = asVec4(mat.alphaOverrideChannel, 1, 0, 0, 0);
  const detDistChan = asVec4(mat.detailDistortionChannel, 0, 0, 0, 0);
  const detDissChan = asVec4(mat.detailDissolveChannel, 1, 0, 0, 0);

  const mainPan = asVec2(mat.mainTexPanning || mat.baseColorMapPanning || mat.distortionPanning, 0, 0);
  const detailPan = asVec2(mat.detailNoisePanning || mat.detailMapPanning || mat.alphaPanning, 0, 0);
  const alphaOvPan = asVec2(mat.alphaOverridePanning || mat.dissolveMapPanning || mat.emissionPanning, 0, 0);

  const desat = Number.isFinite(mat.desaturate) ? mat.desaturate : 0;
  const mulDesat = Number.isFinite(mat.multiplyNoiseDesaturation) ? mat.multiplyNoiseDesaturation : 1;
  const distIntensity = Number.isFinite(mat.distortionIntensity)
    ? mat.distortionIntensity
    : (Number.isFinite(mat.distortionStrength) ? mat.distortionStrength : 0);
  const softFade = Number.isFinite(mat.softFadeFactor) ? mat.softFadeFactor : 0.1;

  const dissRange = asVec2(mat.dissolveFadeRange, -0.25, 1.0);
  const midHigh = Number.isFinite(mat.middlePointPos) ? mat.middlePointPos : 0.5;
  const midLow = Number.isFinite(mat.middlePointPos1) ? mat.middlePointPos1 : 0.0;

  const whiteCol = asVec4(mat.whiteColor || mat.baseColorTint, 1, 1, 1, 1);
  const midCol = asVec4(mat.midColor || mat.emissiveTint, 1, 1, 1, 1);
  if (kind === UBER_SHADER_KIND.PBR_FX && Number.isFinite(mat.intensity)) {
    midCol[3] = mat.intensity;
  }
  const lastCol = asVec4(mat.lastColor, 0, 0, 0, 1);
  const fresnelCol = asVec4(mat.fresnelColor, 1, 1, 1, 1);

  const fresPow = Number.isFinite(mat.fresnelPower) ? mat.fresnelPower : 1.0;
  const fresScale = Number.isFinite(mat.fresnelScale) ? mat.fresnelScale : 1.0;
  const normScale = Number.isFinite(mat.normalScale) ? mat.normalScale : 1.0;
  const occScale = Number.isFinite(mat.occlusionScale) ? mat.occlusionScale : 1.0;

  const smoothScale = Number.isFinite(mat.smoothnessScale) ? mat.smoothnessScale : 0.5;
  const metalScale = Number.isFinite(mat.metallicScale) ? mat.metallicScale : 0.0;
  const selfIllum = Number.isFinite(mat.selfIlluminationIntensity) ? mat.selfIlluminationIntensity : 0.0;
  const pbrDistStr = Number.isFinite(mat.distortionStrength) ? mat.distortionStrength : distIntensity;

  const baseNormStrOrPan = kind === UBER_SHADER_KIND.PBR_FX
    ? (Number.isFinite(mat.baseNormalStrength) ? mat.baseNormalStrength : 1.0)
    : mainPan[0];
  const dissolveAmt = Number.isFinite(mat.dissolveAmount) ? mat.dissolveAmount : 0.0;
  const pbrDistMain = Number.isFinite(mat.distortionMainIntensity) ? mat.distortionMainIntensity : 0.0;
  const pbrDistDiss = Number.isFinite(mat.distortionDissolveIntensity) ? mat.distortionDissolveIntensity : 0.0;
  const pbrVertStr = Number.isFinite(mat.vertexOffsetIntensity) ? mat.vertexOffsetIntensity : 1.0;

  let changed = false;
  changed = writeTexel(data, rowOffset, 0, kind, flags, blendIdx, alphaCutoff) || changed;
  changed = writeTexel(data, rowOffset, 1, mainRect[0], mainRect[1], mainRect[2], mainRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 2, mainST[0], mainST[1], mainST[2], mainST[3]) || changed;
  changed = writeTexel(data, rowOffset, 3, detailRect[0], detailRect[1], detailRect[2], detailRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 4, detailST[0], detailST[1], detailST[2], detailST[3]) || changed;
  changed = writeTexel(data, rowOffset, 5, alphaOvRect[0], alphaOvRect[1], alphaOvRect[2], alphaOvRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 6, alphaOvST[0], alphaOvST[1], alphaOvST[2], alphaOvST[3]) || changed;
  changed = writeTexel(data, rowOffset, 7, mainChan[0], mainChan[1], mainChan[2], mainChan[3]) || changed;
  changed = writeTexel(data, rowOffset, 8, mainAlphaChan[0], mainAlphaChan[1], mainAlphaChan[2], mainAlphaChan[3]) || changed;
  changed = writeTexel(data, rowOffset, 9, alphaOvChan[0], alphaOvChan[1], alphaOvChan[2], alphaOvChan[3]) || changed;
  changed = writeTexel(data, rowOffset, 10, detDistChan[0], detDistChan[1], detDistChan[2], detDistChan[3]) || changed;
  changed = writeTexel(data, rowOffset, 11, detMul[0], detMul[1], detMul[2], detMul[3]) || changed;
  changed = writeTexel(data, rowOffset, 12, detAdd[0], detAdd[1], detAdd[2], detAdd[3]) || changed;
  changed = writeTexel(data, rowOffset, 13, detDissChan[0], detDissChan[1], detDissChan[2], detDissChan[3]) || changed;
  changed = writeTexel(data, rowOffset, 14, detVtx[0], detVtx[1], detVtx[2], detVtx[3]) || changed;
  changed = writeTexel(data, rowOffset, 15, mainPan[0], mainPan[1], detailPan[0], detailPan[1]) || changed;
  changed = writeTexel(data, rowOffset, 16, alphaOvPan[0], alphaOvPan[1], baseNormStrOrPan, dissolveAmt) || changed;
  changed = writeTexel(data, rowOffset, 17, desat, mulDesat, distIntensity, softFade) || changed;
  changed = writeTexel(data, rowOffset, 18, dissRange[0], dissRange[1], midHigh, midLow) || changed;
  changed = writeTexel(data, rowOffset, 19, whiteCol[0], whiteCol[1], whiteCol[2], whiteCol[3]) || changed;
  changed = writeTexel(data, rowOffset, 20, midCol[0], midCol[1], midCol[2], midCol[3]) || changed;
  changed = writeTexel(data, rowOffset, 21, lastCol[0], lastCol[1], lastCol[2], lastCol[3]) || changed;
  changed = writeTexel(data, rowOffset, 22, fresnelCol[0], fresnelCol[1], fresnelCol[2], fresnelCol[3]) || changed;
  changed = writeTexel(data, rowOffset, 23, fresPow, fresScale, normScale, occScale) || changed;
  changed = writeTexel(data, rowOffset, 24, normalRect[0], normalRect[1], normalRect[2], normalRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 25, normalST[0], normalST[1], normalST[2], normalST[3]) || changed;
  changed = writeTexel(data, rowOffset, 26, ormRect[0], ormRect[1], ormRect[2], ormRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 27, ormST[0], ormST[1], ormST[2], ormST[3]) || changed;
  changed = writeTexel(data, rowOffset, 28, emissionRect[0], emissionRect[1], emissionRect[2], emissionRect[3]) || changed;
  changed = writeTexel(data, rowOffset, 29, emissionST[0], emissionST[1], emissionST[2], emissionST[3]) || changed;
  changed = writeTexel(data, rowOffset, 30, smoothScale, metalScale, selfIllum, pbrDistStr) || changed;
  changed = writeTexel(data, rowOffset, 31, pbrDistMain, pbrDistDiss, pbrVertStr, texMask) || changed;
  return changed;
}

/**
 * Create a RGBA32F DataTexture holding Piloto material rows.
 */
export function createUberMaterialLut(THREE, maxRows = UBER_MAT_LUT_ROWS) {
  const width = UBER_MAT_LUT_WIDTH;
  const height = Math.max(1, maxRows | 0);
  const data = new Float32Array(width * height * 4);
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  let nextRow = 0;
  const cache = new Map();

  function allocateRow(cacheKey, matSpec, texRects) {
    const key = cacheKey || null;
    if (key && cache.has(key)) {
      const idx = cache.get(key);
      if (packUberMaterialRow(data, idx, matSpec, texRects)) {
        texture.needsUpdate = true;
      }
      return idx;
    }
    const idx = Math.min(nextRow++, height - 1);
    if (key) cache.set(key, idx);
    packUberMaterialRow(data, idx, matSpec, texRects);
    texture.needsUpdate = true;
    return idx;
  }

  function clear() {
    nextRow = 0;
    cache.clear();
    data.fill(0);
    texture.needsUpdate = true;
  }

  function dispose() {
    cache.clear();
    texture.dispose();
  }

  return {
    texture,
    data,
    width,
    height,
    allocateRow,
    packRow: (rowIdx, matSpec, texRects) => {
      if (packUberMaterialRow(data, rowIdx, matSpec, texRects)) {
        texture.needsUpdate = true;
      }
    },
    clear,
    dispose,
  };
}

/**
 * Compile Shuriken CustomDataModule channel definition (Vector4 / 4-curve / constant / random / color)
 * into fast 16-sample LUT arrays for CPU per-frame evaluation.
 */
export function compileCustomDataCurves(customDataCfg) {
  if (!customDataCfg || typeof customDataCfg !== 'object') return null;

  const compileChannel = (chCfg) => {
    if (!chCfg || typeof chCfg !== 'object') return null;
    const mode = chCfg.mode || 'disabled';
    if (mode === 'disabled') return null;
    if (mode === 'color' && chCfg.color !== undefined) {
      const grad = compileMinMaxGradient(chCfg.color, true);
      return { kind: 'color', grad };
    }
    const compNames = ['x', 'y', 'z', 'w'];
    const comps = compNames.map((k) => compileMinMaxCurve(chCfg[k], 0));
    return { kind: 'vector', comps };
  };

  const c1 = compileChannel(customDataCfg.custom1);
  const c2 = compileChannel(customDataCfg.custom2);
  if (!c1 && !c2) return null;
  return { custom1: c1, custom2: c2 };
}

const _customColorScratch = [0, 0, 0, 0];

export function evaluateCustomDataChannel(compiledChannel, lifeRatio, randSeed, out4, offset = 0) {
  if (!compiledChannel) {
    out4[offset] = 0;
    out4[offset + 1] = 0;
    out4[offset + 2] = 0;
    out4[offset + 3] = 0;
    return;
  }
  const t = lifeRatio < 0 ? 0 : (lifeRatio > 1 ? 1 : lifeRatio);
  if (compiledChannel.kind === 'color') {
    evaluateMinMaxGradient(compiledChannel.grad, t, randSeed, _customColorScratch);
    out4[offset] = _customColorScratch[0];
    out4[offset + 1] = _customColorScratch[1];
    out4[offset + 2] = _customColorScratch[2];
    out4[offset + 3] = _customColorScratch[3];
    return;
  }
  const comps = compiledChannel.comps;
  for (let i = 0; i < 4; i++) {
    const r = ((randSeed * (1 + i * 0.3719)) % 1 + 1) % 1;
    out4[offset + i] = evaluateMinMaxCurve(comps[i], t, r);
  }
}

export { VFX_FLIPBOOK_GLSL };

/**
 * Shared GLSL primitive helpers (Depth, SoftFade, ChannelPicker, Desaturate, SafeSmoothstep, Polar, Ramp, Flipbook).
 */
export const VFX_COMMON_GLSL = /* glsl */ `
float vfxLinearizeDepth(float zNdc, vec2 camNearFar) {
  float z = zNdc * 2.0 - 1.0;
  float n = camNearFar.x;
  float f = camNearFar.y;
  return (2.0 * n * f) / max(0.0001, f + n - z * (f - n));
}

float vfxComputeSoftFade(
  sampler2D depthTex,
  float hasDepth,
  vec2 fragCoord,
  vec2 invViewport,
  vec2 camNearFar,
  float fragDepthZ,
  float softFade
) {
  if (hasDepth < 0.5 || softFade <= 0.0001) return 1.0;
  float sceneDepthRaw = texture2D(depthTex, fragCoord * invViewport).r;
  float sceneZ = vfxLinearizeDepth(sceneDepthRaw, camNearFar);
  float partZ = vfxLinearizeDepth(fragDepthZ, camNearFar);
  return clamp((sceneZ - partZ) / max(0.0001, softFade), 0.0, 1.0);
}

vec4 vfxChannelPicker(vec4 rgba, vec4 mask) {
  return rgba * mask;
}

float vfxChannelPickerAdd(vec4 rgba, vec4 mask) {
  return clamp(dot(rgba, mask), 0.0, 1.0);
}

float vfxChannelPickerClamped(vec4 rgba, vec4 mask) {
  return clamp(dot(clamp(rgba * mask, 0.0, 1.0), vec4(1.0)), 0.0, 1.0);
}

vec3 vfxSrgbToLinear3(vec3 c) {
  vec3 linLo = c / 12.92;
  vec3 linHi = pow(max((c + vec3(0.055)) / 1.055, vec3(1e-5)), vec3(2.4));
  vec3 mask = step(vec3(0.04045), c);
  return mix(linLo, linHi, mask);
}

vec3 vfxDesaturate(vec3 rgb, float amt) {
  const vec3 lumaW = vec3(0.2126729, 0.7151522, 0.0721750);
  float luma = dot(rgb, lumaW);
  return mix(rgb, vec3(luma), clamp(amt, 0.0, 1.0));
}

float vfxSafeSmoothstep(float e0, float e1, float x) {
  float d = e1 - e0;
  float sd = abs(d) < 1e-5 ? (d < 0.0 ? -1e-5 : 1e-5) : d;
  float t = clamp((x - e0) / sd, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

bool vfxHasFlag(float flags, float bitVal) {
  float cleanFlags = floor(flags + 0.5);
  return mod(floor(cleanFlags / bitVal), 2.0) > 0.5;
}

vec2 vfxPolarCoords(vec2 uv, vec2 center) {
  vec2 d = uv - center;
  float r = length(d) * 2.0;
  float ang = atan(d.y, d.x) * 0.15915494309 + 0.5;
  return vec2(r, ang);
}

vec4 vfxSampleAtlasRectWrapped(sampler2D atlasTex, vec4 rect, vec2 uv, float flipV, bool clampU, bool clampV) {
  vec2 halfTex = clamp(vec2(0.5) / max(vec2(1.0), abs(rect.zw - rect.xy) * 4096.0), vec2(0.001), vec2(0.25));
  vec2 tiled = vec2(
    clampU ? clamp(uv.x, halfTex.x, 1.0 - halfTex.x) : fract(uv.x),
    clampV ? clamp(uv.y, halfTex.y, 1.0 - halfTex.y) : fract(uv.y)
  );
  vec2 mapped = vec2(
    mix(rect.x, rect.z, tiled.x),
    mix(rect.y, rect.w, tiled.y)
  );
  if (flipV > 0.5) mapped.y = 1.0 - mapped.y;
  return texture2D(atlasTex, mapped);
}

vec4 vfxSampleAtlasRect(sampler2D atlasTex, vec4 rect, vec2 uv, float flipV) {
  return vfxSampleAtlasRectWrapped(atlasTex, rect, uv, flipV, false, false);
}

${VFX_FLIPBOOK_GLSL}

// Splits uv0 into flipbook cell coordinates (supports top-down grid + rowMode random/custom).
// Returns (uvA, uvB) packed in vec4; meta.z = frame index, meta.w = next-frame blend.
vec4 vfxComputeFlipbookUvPair(vec2 uv0, vec4 flipbookGridInfo, float frameIndex) {
  vec2 grid = max(vec2(1.0), floor(flipbookGridInfo.xy + 0.5));
  if (grid.x <= 1.0 && grid.y <= 1.0) {
    return vec4(uv0, uv0);
  }
  float total = grid.x * grid.y;
  float f0 = clamp(floor(frameIndex), 0.0, total - 1.0);
  float f1 = min(f0 + 1.0, total - 1.0);
  float col0 = mod(f0, grid.x);
  float row0 = floor(f0 / grid.x);
  float col1 = mod(f1, grid.x);
  float row1 = floor(f1 / grid.x);
  // Flip V inside cell so Unity top-left flipbook grid maps cleanly to OpenGL UV (bottom-up).
  vec2 cellUvA = vec2((col0 + uv0.x) / grid.x, 1.0 - (row0 + 1.0 - uv0.y) / grid.y);
  vec2 cellUvB = vec2((col1 + uv0.x) / grid.x, 1.0 - (row1 + 1.0 - uv0.y) / grid.y);
  return vec4(cellUvA, cellUvB);
}

vec3 vfxEvalUberRamp(
  vec3 satMain,
  vec3 lastColor,
  vec3 midColor,
  vec3 whiteColor,
  float midHigh,
  float midLow
) {
  float v = clamp(satMain.r, 0.0, 1.0);
  float denom = max(1e-5, abs(1.0 - midHigh)) * (1.0 - midHigh < 0.0 ? -1.0 : 1.0);
  float remappedHigh = clamp(v - midHigh, 0.0, 1.0) / denom;
  float remappedLow = (v * (remappedHigh - midLow)) / denom;
  vec3 lo = mix(lastColor, midColor, remappedLow);
  vec3 hi = mix(midColor, whiteColor, remappedHigh);
  return max(vec3(0.0), mix(lo, hi, v));
}

vec4 vfxFinalizeOutput(vec4 res, float isOpaque, float isMultiply, float isPremultiply, float isAdditive) {
  if (isOpaque > 0.5) {
    return vec4(res.rgb, 1.0);
  }
  if (isMultiply > 0.5) {
    return vec4(mix(vec3(1.0), res.rgb, clamp(res.a, 0.0, 1.0)), 1.0);
  }
  if (isPremultiply > 0.5) {
    return res;
  }
  vec3 outRgb = res.rgb;
  float outA = res.a;
  float peak = max(outRgb.r, max(outRgb.g, outRgb.b));
  if (isAdditive > 0.5 && peak > 1.0 && outA > 0.0 && outA < 1.0) {
    float boost = min(peak, 1.0 / outA);
    outRgb /= boost;
    outA *= boost;
  }
  return vec4(outRgb, outA);
}
`;

/**
 * Unified VFX Vertex Data Bus attributes & varyings shared by all Shader Profiles
 * across Billboard / Stretched / Horizontal / Vertical / Mesh / Trail renderers.
 */
export const VFX_VERTEX_BUS_ATTRS_GLSL = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv1;

attribute vec4 aColor;   // Linear RGBA (StartColor * ColorOverLifetime)
attribute vec4 aCustom1; // Shuriken Custom1.xyzw (or AgePercent in .x)
attribute vec4 aCustom2; // Shuriken Custom2.xyzw
attribute vec4 aMeta;    // x=age01, y=stableRandom, z=flipbookFrame, w=flipbookNextBlend

attribute vec4 aInstPos;      // xyz = world/local origin, w = active (>0.5)
attribute vec4 aInstRot;      // xyz = euler/rot (rad), w = stretchLengthScale
attribute vec4 aInstScale;    // xyz = 3D scale, w = stretchVelocityScale
attribute vec4 aInstVel;      // xyz = current velocity, w = pivotOffsetY

varying vec2 vUv0;
varying vec2 vUv0Blend;
varying vec2 vUv2;
varying vec4 vColor;
varying vec4 vCustom1;
varying vec4 vCustom2;
varying vec4 vMeta;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec4 vScreenPos;
varying float vEyeZ;
`;

/**
 * Unified Vertex Shell executing:
 *  1) Flipbook UV0 grid split (before any texture sampling so Main/Detail/AlphaOverride share it)
 *  2) Pluggable vec3 evalVertexOffset(VfxVertIn vin) hook (e.g. DetailNoise * Custom2.x)
 *  3) RenderMode vertex transform (0=Billboard, 1=Horizontal, 2=Stretched, 3=Mesh, 4=Vertical)
 *  4) Standard unified varyings output
 */
export const VFX_VERTEX_SHELL_GLSL = /* glsl */ `
struct VfxVertIn {
  vec3 pos;
  vec3 normal;
  vec2 uv0;
  vec2 uv2;
  vec4 color;
  vec4 custom1;
  vec4 custom2;
  vec4 meta;
};

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
uniform float uRenderMode; // 0=billboard, 1=horizontal, 2=stretched, 3=mesh, 4=vertical
uniform vec4 uFlipbookGrid; // x=cols, y=rows, z=blendEnabled, w=unused
uniform vec2 uPivot2D;
uniform float uHasUv2;

mat3 vfxEulerXYZ(vec3 r) {
  float cx = cos(r.x), sx = sin(r.x);
  float cy = cos(r.y), sy = sin(r.y);
  float cz = cos(r.z), sz = sin(r.z);
  return mat3(
    cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,
    sy * cx, -sx, cy * cx
  );
}

mat3 vfxQuatFromAlign(vec3 fwd, vec3 dir) {
  float d = dot(fwd, dir);
  if (d > 0.9999) return mat3(1.0);
  if (d < -0.9999) {
    vec3 ortho = abs(fwd.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 ax = normalize(cross(fwd, ortho));
    return mat3(
      2.0 * ax.x * ax.x - 1.0, 2.0 * ax.x * ax.y, 2.0 * ax.x * ax.z,
      2.0 * ax.x * ax.y, 2.0 * ax.y * ax.y - 1.0, 2.0 * ax.y * ax.z,
      2.0 * ax.x * ax.z, 2.0 * ax.y * ax.z, 2.0 * ax.z * ax.z - 1.0
    );
  }
  vec3 c = cross(fwd, dir);
  float s = sqrt((1.0 + d) * 2.0);
  float invS = 1.0 / s;
  vec4 q = vec4(c * invS, s * 0.5);
  float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
  float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
  float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
  return mat3(
    1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy),
    2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),
    2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)
  );
}

vec3 evalVertexOffset(VfxVertIn vin);

void vfxExecuteVertexShell(vec3 rawPos, vec3 rawNormal, vec2 rawUv0, vec2 rawUv2) {
  if (aInstPos.w < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv0 = vec2(0.0);
    vUv0Blend = vec2(0.0);
    vUv2 = vec2(0.0);
    vColor = vec4(0.0);
    vCustom1 = vec4(0.0);
    vCustom2 = vec4(0.0);
    vMeta = vec4(0.0);
    vNormalW = vec3(0.0, 1.0, 0.0);
    vViewDirW = vec3(0.0, 0.0, 1.0);
    vScreenPos = vec4(0.0);
    vEyeZ = 0.0;
    return;
  }

  vec4 fbUv = vfxComputeFlipbookUvPair(rawUv0, uFlipbookGrid, aMeta.z);
  vUv0 = fbUv.xy;
  vUv0Blend = fbUv.zw;
  vUv2 = uHasUv2 > 0.5 ? rawUv2 : rawUv0;
  vColor = aColor;
  vCustom1 = aCustom1;
  vCustom2 = aCustom2;
  vMeta = aMeta;

  VfxVertIn vin;
  vin.pos = rawPos;
  vin.normal = length(rawNormal) > 0.0001 ? normalize(rawNormal) : vec3(0.0, 0.0, 1.0);
  vin.uv0 = vUv0;
  vin.uv2 = vUv2;
  vin.color = aColor;
  vin.custom1 = aCustom1;
  vin.custom2 = aCustom2;
  vin.meta = aMeta;

  vec3 localPos = evalVertexOffset(vin);
  vec3 worldPos;
  vec3 worldNormal;

  if (uRenderMode > 2.5 && uRenderMode < 3.5) {
    // Mesh mode (3D Euler + optional velocity alignment + 3D scale)
    vec3 scaled = localPos * aInstScale.xyz;
    mat3 rotM = vfxEulerXYZ(aInstRot.xyz);
    if (aInstScale.w > 0.5 && dot(aInstVel.xyz, aInstVel.xyz) > 1e-6) {
      rotM = vfxQuatFromAlign(vec3(0.0, 1.0, 0.0), normalize(aInstVel.xyz)) * rotM;
    }
    vec3 relW = rotM * scaled;
    worldPos = aInstPos.xyz + relW;
    worldNormal = normalize(rotM * (vin.normal / max(vec3(0.001), abs(aInstScale.xyz))));
  } else {
    vec2 quadLocal = localPos.xy - uPivot2D;
    vec3 scaled2D = vec3(quadLocal * aInstScale.xy, localPos.z * aInstScale.z);
    if (uRenderMode > 0.5 && uRenderMode < 1.5) {
      // Horizontal billboard (XZ plane)
      float c = cos(aInstRot.z), s = sin(aInstRot.z);
      vec3 flatP = vec3(scaled2D.x * c - scaled2D.y * s, scaled2D.z, scaled2D.x * s + scaled2D.y * c);
      worldPos = aInstPos.xyz + flatP;
      worldNormal = vec3(0.0, 1.0, 0.0);
    } else if (uRenderMode > 3.5) {
      // Vertical billboard (Y-up facing camera horizontally)
      vec3 camFwd = normalize(vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]));
      vec3 camRight = normalize(cross(vec3(0.0, 1.0, 0.0), camFwd));
      float c = cos(aInstRot.z), s = sin(aInstRot.z);
      vec2 rotP = vec2(scaled2D.x * c - scaled2D.y * s, scaled2D.x * s + scaled2D.y * c);
      worldPos = aInstPos.xyz + camRight * rotP.x + vec3(0.0, 1.0, 0.0) * rotP.y;
      worldNormal = camFwd;
    } else if (uRenderMode > 1.5 && uRenderMode < 2.5) {
      // Stretched billboard along world velocity
      vec3 velW = aInstVel.xyz;
      float spd = length(velW);
      vec3 camDir = normalize(cameraPosition - aInstPos.xyz);
      vec3 axisX = spd > 0.001 ? (velW / spd) : vec3(1.0, 0.0, 0.0);
      vec3 axisY = cross(camDir, axisX);
      float yLen = length(axisY);
      axisY = yLen > 0.001 ? (axisY / yLen) : vec3(0.0, 1.0, 0.0);
      vec3 axisZ = cross(axisX, axisY);
      float signedLenScale = (aInstScale.w <= 0.0001 && abs(aInstRot.w) < 0.05)
        ? (aInstRot.w < 0.0 ? -0.05 : 0.05)
        : aInstRot.w;
      float major = aInstScale.y * signedLenScale + spd * aInstScale.w;
      vec2 p2 = vec2((quadLocal.x - 0.5) * major, quadLocal.y * aInstScale.x);
      worldPos = aInstPos.xyz + axisX * p2.x + axisY * p2.y + axisZ * scaled2D.z;
      worldNormal = camDir;
    } else {
      // Camera-facing Billboard
      vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 camFwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      float c = cos(aInstRot.z), s = sin(aInstRot.z);
      vec2 rotP = vec2(scaled2D.x * c - scaled2D.y * s, scaled2D.x * s + scaled2D.y * c);
      worldPos = aInstPos.xyz + camRight * rotP.x + camUp * rotP.y + camFwd * scaled2D.z;
      worldNormal = camFwd;
    }
  }

  vec4 wPos4 = modelMatrix * vec4(worldPos, 1.0);
  vec4 mvPos = viewMatrix * wPos4;
  vNormalW = normalize(mat3(modelMatrix) * worldNormal);
  vViewDirW = cameraPosition - wPos4.xyz;
  vEyeZ = -mvPos.z;
  vec4 clipPos = projectionMatrix * mvPos;
  vScreenPos = clipPos;
  gl_Position = clipPos;
}
`;


export const VFX_UBER_LUT_GLSL = /* glsl */ `
const float UBER_LUT_W = ${UBER_MAT_LUT_WIDTH.toFixed(1)};
const float UBER_LUT_H = ${UBER_MAT_LUT_ROWS.toFixed(1)};

vec4 vfxReadMatTexel(sampler2D lutTex, float rowIdx, float texelIdx) {
  vec2 uv = vec2((texelIdx + 0.5) / UBER_LUT_W, (rowIdx + 0.5) / UBER_LUT_H);
  return texture2D(lutTex, uv);
}

vec3 vfxEvalUberVertexOffset(
  sampler2D matLut,
  sampler2D atlasTex,
  float hasAtlas,
  float flipV,
  float rowIdx,
  vec2 uv0,
  vec3 pos,
  vec3 normalOs,
  float custom2x,
  float timeSec
) {
  if (rowIdx < -0.5 || hasAtlas < 0.5 || abs(custom2x) < 1e-7) return pos;
  vec4 hdr = vfxReadMatTexel(matLut, rowIdx, 0.0);
  if (!vfxHasFlag(hdr.y, ${UBER_FLAG_USE_DETAIL_VERTEX_OFFSET.toFixed(1)})) return pos;
  vec4 detVtxChan = vfxReadMatTexel(matLut, rowIdx, 14.0);
  vec4 detRect = vfxReadMatTexel(matLut, rowIdx, 3.0);
  vec4 detST = vfxReadMatTexel(matLut, rowIdx, 4.0);
  vec4 pan0 = vfxReadMatTexel(matLut, rowIdx, 15.0);
  vec2 uUv0 = vec2(uv0.x, 1.0 - uv0.y);
  vec2 detUvU = fract(uUv0 * detST.xy + detST.zw + pan0.zw * timeSec);
  vec2 detUv = vec2(detUvU.x, 1.0 - detUvU.y);
  vec2 mapped = vec2(mix(detRect.x, detRect.z, detUv.x), mix(detRect.y, detRect.w, detUv.y));
  if (flipV > 0.5) mapped.y = 1.0 - mapped.y;
  vec4 nSample = texture2D(atlasTex, mapped);
  float disp = vfxChannelPickerClamped(nSample, detVtxChan);
  return pos + normalize(normalOs) * (custom2x * disp);
}
`;

export const VFX_UBER_FRAGMENT_GLSL = /* glsl */ `
mat3 vfxComputeCotangentFrame(vec3 N, vec3 p, vec2 uv) {
#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives) || defined(USE_DERIVATIVES)
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float maxLen = max(dot(T, T), dot(B, B));
  if (maxLen > 1e-8) {
    float invmax = inversesqrt(maxLen);
    return mat3(T * invmax, B * invmax, N);
  }
#endif
  vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T0 = normalize(cross(up, N));
  vec3 B0 = cross(N, T0);
  return mat3(T0, B0, N);
}

vec4 vfxEvalUberFragment(
  sampler2D matLut,
  sampler2D atlasTex,
  float hasAtlas,
  float flipV,
  float rowIdx,
  vec2 uv0,
  vec2 uvBlend,
  float flipBlend,
  bool hasFlipBlend,
  vec4 vColor,
  vec4 custom1,
  float timeSec,
  vec3 viewDirWs,
  vec3 normalWs,
  bool isFrontFacing,
  sampler2D depthTex,
  float hasDepth,
  vec2 fragCoord,
  vec2 invViewport,
  vec2 camNearFar
) {
  vec4 hdr = vfxReadMatTexel(matLut, rowIdx, 0.0);
  float flags = hdr.y;
  float alphaCutoff = hdr.w;

  if (!vfxHasFlag(flags, ${UBER_FLAG_DOUBLE_SIDED.toFixed(1)})) {
    bool cullFront = vfxHasFlag(flags, ${UBER_FLAG_CULL_FRONT.toFixed(1)});
    if (cullFront ? isFrontFacing : !isFrontFacing) {
      discard;
    }
  }

  vec4 meta31 = vfxReadMatTexel(matLut, rowIdx, 31.0);
  float texMask = meta31.w;

  bool hasMainTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_MAIN.toFixed(1)});
  bool hasDetailTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_DETAIL.toFixed(1)});
  bool useRamp = vfxHasFlag(flags, ${UBER_FLAG_USE_RAMP.toFixed(1)});
  bool useErosion = hasDetailTex && !vfxHasFlag(flags, ${UBER_FLAG_DISABLE_EROSION.toFixed(1)});
  bool useAlphaOv = vfxHasFlag(flags, ${UBER_FLAG_USE_ALPHA_OVERRIDE.toFixed(1)}) && hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_ALPHA_OV.toFixed(1)});
  bool useFresnel = isFrontFacing && vfxHasFlag(flags, ${UBER_FLAG_FRESNEL.toFixed(1)});

  vec4 params0 = vfxReadMatTexel(matLut, rowIdx, 17.0);
  vec4 pan0 = (hasMainTex || hasDetailTex) ? vfxReadMatTexel(matLut, rowIdx, 15.0) : vec4(0.0);
  vec4 dissParams = (useRamp || useErosion) ? vfxReadMatTexel(matLut, rowIdx, 18.0) : vec4(0.0);

  vec2 uUv0 = vec2(uv0.x, 1.0 - uv0.y);
  vec2 uUvB = vec2(uvBlend.x, 1.0 - uvBlend.y);

  vec4 detailSample = vec4(1.0);
  float distortAmt = 0.0;
  if (hasDetailTex) {
    vec4 detailRect = vfxReadMatTexel(matLut, rowIdx, 3.0);
    vec4 detailST = vfxReadMatTexel(matLut, rowIdx, 4.0);
    vec4 detDistChan = vfxReadMatTexel(matLut, rowIdx, 10.0);
    bool clampDetU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_DETAIL_U.toFixed(1)});
    bool clampDetV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_DETAIL_V.toFixed(1)});
    vec2 detUvU = (uUv0 + pan0.zw * timeSec) * detailST.xy + detailST.zw;
    detailSample = vfxSampleAtlasRectWrapped(atlasTex, detailRect, vec2(detUvU.x, 1.0 - detUvU.y), flipV, clampDetU, clampDetV);
    if (vfxHasFlag(flags, ${UBER_FLAG_DETAIL_SRGB.toFixed(1)})) {
      detailSample.rgb = vfxSrgbToLinear3(detailSample.rgb);
    }
    distortAmt = vfxChannelPickerClamped(detailSample, detDistChan) * params0.z;
  }

  vec4 mainTex = vec4(1.0);
  if (hasMainTex) {
    vec4 mainRect = vfxReadMatTexel(matLut, rowIdx, 1.0);
    vec4 mainST = vfxReadMatTexel(matLut, rowIdx, 2.0);
    bool clampMainU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_U.toFixed(1)});
    bool clampMainV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_V.toFixed(1)});
    vec2 uvOff = vfxHasFlag(flags, ${UBER_FLAG_USE_UV_OFFSET.toFixed(1)}) ? custom1.zw : vec2(0.0);
    vec2 mainUvU = (uUv0 + uvOff + vec2(distortAmt) + pan0.xy * timeSec) * mainST.xy + mainST.zw;
    mainTex = vfxSampleAtlasRectWrapped(atlasTex, mainRect, vec2(mainUvU.x, 1.0 - mainUvU.y), flipV, clampMainU, clampMainV);
    if (hasFlipBlend) {
      vec2 mainUvBU = (uUvB + uvOff + vec2(distortAmt) + pan0.xy * timeSec) * mainST.xy + mainST.zw;
      vec4 mainTexB = vfxSampleAtlasRectWrapped(atlasTex, mainRect, vec2(mainUvBU.x, 1.0 - mainUvBU.y), flipV, clampMainU, clampMainV);
      mainTex = mix(mainTex, mainTexB, flipBlend);
    }
    if (vfxHasFlag(flags, ${UBER_FLAG_MAIN_SRGB.toFixed(1)})) {
      mainTex.rgb = vfxSrgbToLinear3(mainTex.rgb);
    }
  } else if (!vfxHasFlag(flags, ${UBER_FLAG_USE_ALPHA_OVERRIDE.toFixed(1)})) {
    // Unity Default-Particle (steep radial Gaussian disc) when _MainTex is Default-Particle / null
    vec2 dp = (uv0 - vec2(0.5)) * 2.0;
    float r2 = dot(dp, dp);
    float radialA = r2 >= 1.0 ? 0.0 : exp(-r2 * 6.5) * (1.0 - r2);
    mainTex = vec4(vec3(radialA), radialA);
  }

  vec4 mainChan = vfxReadMatTexel(matLut, rowIdx, 7.0);
  vec4 mainAlphaChan = vfxReadMatTexel(matLut, rowIdx, 8.0);
  vec3 maskedMainRgb = vfxChannelPicker(mainTex, mainChan).rgb;
  vec3 satMain = vfxDesaturate(maskedMainRgb, params0.x);

  vec3 baseCol;
  if (useRamp) {
    vec4 whiteCol = vfxReadMatTexel(matLut, rowIdx, 19.0);
    vec4 midCol = vfxReadMatTexel(matLut, rowIdx, 20.0);
    vec4 lastCol = vfxReadMatTexel(matLut, rowIdx, 21.0);
    baseCol = vfxEvalUberRamp(
      satMain,
      lastCol.rgb,
      midCol.rgb,
      whiteCol.rgb,
      dissParams.z,
      dissParams.w
    );
  } else {
    vec3 mulFactor = vec3(1.0);
    if (hasDetailTex && vfxHasFlag(flags, ${UBER_FLAG_USE_MULTIPLY.toFixed(1)})) {
      vec4 detMulChan = vfxReadMatTexel(matLut, rowIdx, 11.0);
      vec3 detMulRgb = vfxChannelPicker(detailSample, detMulChan).rgb;
      mulFactor = vfxDesaturate(detMulRgb, params0.y);
    }
    float addFactor = 0.0;
    if (hasDetailTex && vfxHasFlag(flags, ${UBER_FLAG_USE_ADDITIVE.toFixed(1)})) {
      vec4 detAddChan = vfxReadMatTexel(matLut, rowIdx, 12.0);
      addFactor = dot(detailSample.rgb * detAddChan.rgb, vec3(0.2126729, 0.7151522, 0.0721750));
    }
    baseCol = satMain * mulFactor + vec3(addFactor);
  }

  vec3 litCol = baseCol * vColor.rgb * max(0.0, custom1.x + 1.0);

  float erosion = 1.0;
  if (useErosion) {
    vec4 detDissChan = vfxReadMatTexel(matLut, rowIdx, 13.0);
    float eInput = custom1.y - 1.0;
    float edge1 = mix(dissParams.x, dissParams.y, eInput);
    float edge2 = edge1 - dissParams.x;
    float dissNoise = vfxChannelPickerClamped(detailSample, detDissChan);
    erosion = vfxSafeSmoothstep(edge1, edge2, dissNoise);
  }

  float alphaOv = 1.0;
  if (useAlphaOv) {
    vec4 alphaOvRect = vfxReadMatTexel(matLut, rowIdx, 5.0);
    vec4 alphaOvST = vfxReadMatTexel(matLut, rowIdx, 6.0);
    vec4 alphaOvChan = vfxReadMatTexel(matLut, rowIdx, 9.0);
    vec4 pan1 = vfxReadMatTexel(matLut, rowIdx, 16.0);
    bool clampOvU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_ALPHA_OV_U.toFixed(1)});
    bool clampOvV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_ALPHA_OV_V.toFixed(1)});
    vec2 ovUvU = (uUv0 + pan1.xy * timeSec) * alphaOvST.xy + alphaOvST.zw;
    vec4 ovSample = vfxSampleAtlasRectWrapped(atlasTex, alphaOvRect, vec2(ovUvU.x, 1.0 - ovUvU.y), flipV, clampOvU, clampOvV);
    if (hasFlipBlend) {
      vec2 ovUvBU = (uUvB + pan1.xy * timeSec) * alphaOvST.xy + alphaOvST.zw;
      vec4 ovSampleB = vfxSampleAtlasRectWrapped(atlasTex, alphaOvRect, vec2(ovUvBU.x, 1.0 - ovUvBU.y), flipV, clampOvU, clampOvV);
      ovSample = mix(ovSample, ovSampleB, flipBlend);
    }
    if (vfxHasFlag(flags, ${UBER_FLAG_ALPHA_OV_SRGB.toFixed(1)})) {
      ovSample.rgb = vfxSrgbToLinear3(ovSample.rgb);
    }
    alphaOv = vfxChannelPickerAdd(ovSample, alphaOvChan);
  }

  float softMul = 1.0;
  if (vfxHasFlag(flags, ${UBER_FLAG_USE_SOFT_ALPHA.toFixed(1)})) {
    softMul = vfxComputeSoftFade(depthTex, hasDepth, fragCoord, invViewport, camNearFar, gl_FragCoord.z, params0.w);
  }

  float mainA = vfxChannelPickerAdd(mainTex, mainAlphaChan);
  float finalAlpha = clamp(erosion * softMul * alphaOv * mainA * vColor.a, 0.0, 1.0);

  if (vfxHasFlag(flags, ${UBER_FLAG_ALPHA_TEST.toFixed(1)}) && finalAlpha < alphaCutoff) {
    discard;
  }

  if (useFresnel) {
    vec4 fresCol = vfxReadMatTexel(matLut, rowIdx, 22.0);
    vec4 fresParams = vfxReadMatTexel(matLut, rowIdx, 23.0);
    float ndv = clamp(dot(normalize(normalWs), normalize(viewDirWs)), 0.0, 1.0);
    float fres = pow(max(0.0, 1.0 - ndv), max(0.05, fresParams.x)) * fresParams.y;
    if (vfxHasFlag(flags, ${UBER_FLAG_INVERT_FRESNEL.toFixed(1)})) {
      fres = 1.0 - clamp(fres, 0.0, 1.0);
    }
    vec3 fCol = fresCol.rgb;
    if (vfxHasFlag(flags, ${UBER_FLAG_TINT_FRESNEL.toFixed(1)})) {
      fCol *= vColor.rgb;
    }
    litCol = mix(litCol, fCol * max(0.0, custom1.x + 1.0), clamp(fres, 0.0, 1.0));
  }

  if (finalAlpha < 0.0005) discard;
  return vec4(litCol, finalAlpha);
}

vec4 vfxEvalPilotoWarpFragment(
  sampler2D matLut,
  sampler2D atlasTex,
  sampler2D sceneTex,
  float hasAtlas,
  float hasSceneTex,
  float flipV,
  float rowIdx,
  vec2 uv0,
  vec4 vColor,
  float timeSec,
  sampler2D depthTex,
  float hasDepth,
  vec2 fragCoord,
  vec2 invViewport,
  vec2 camNearFar
) {
  if (hasSceneTex < 0.5) discard;
  vec4 hdr = vfxReadMatTexel(matLut, rowIdx, 0.0);
  float flags = hdr.y;
  vec4 meta31 = vfxReadMatTexel(matLut, rowIdx, 31.0);
  float texMask = meta31.w;
  bool hasDistTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_MAIN.toFixed(1)});
  bool hasAlphaTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_DETAIL.toFixed(1)});
  vec4 params0 = vfxReadMatTexel(matLut, rowIdx, 17.0);
  vec4 pan0 = (hasDistTex || hasAlphaTex) ? vfxReadMatTexel(matLut, rowIdx, 15.0) : vec4(0.0);

  vec2 coordBase = vfxHasFlag(flags, ${UBER_FLAG_POLAR_COORDS.toFixed(1)})
    ? vfxPolarCoords(uv0, vec2(0.5))
    : uv0;

  vec2 nOffset = vec2(0.0);
  if (hasDistTex) {
    vec4 distRect = vfxReadMatTexel(matLut, rowIdx, 1.0);
    vec4 distST = vfxReadMatTexel(matLut, rowIdx, 2.0);
    bool clampDistU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_U.toFixed(1)});
    bool clampDistV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_V.toFixed(1)});
    vec2 dUv = coordBase * distST.xy + distST.zw + pan0.xy * timeSec;
    vec4 nSamp = vfxSampleAtlasRectWrapped(atlasTex, distRect, dUv, flipV, clampDistU, clampDistV);
    if (vfxHasFlag(flags, ${UBER_FLAG_UNPACK_NORMALS.toFixed(1)})) {
      nOffset = nSamp.xy * 2.0 - 1.0;
    } else {
      // Non-normal distortion textures (rings/noise masks) have 0..1 intensity: sample slope gradient so flat/zero areas stay unshifted.
      float hC = dot(nSamp.rg, vec2(0.5));
      float hU = dot(vfxSampleAtlasRectWrapped(atlasTex, distRect, dUv + vec2(0.01, 0.0), flipV, clampDistU, clampDistV).rg, vec2(0.5));
      float hV = dot(vfxSampleAtlasRectWrapped(atlasTex, distRect, dUv + vec2(0.0, 0.01), flipV, clampDistU, clampDistV).rg, vec2(0.5));
      nOffset = clamp(vec2(hC - hU, hC - hV) * 4.0, vec2(-1.0), vec2(1.0));
    }
  }

  float maskA = 1.0;
  if (hasAlphaTex) {
    vec4 alphaRect = vfxReadMatTexel(matLut, rowIdx, 3.0);
    vec4 alphaST = vfxReadMatTexel(matLut, rowIdx, 4.0);
    vec4 alphaChan = vfxReadMatTexel(matLut, rowIdx, 8.0);
    bool clampAlphaU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_ALPHA_OV_U.toFixed(1)});
    bool clampAlphaV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_ALPHA_OV_V.toFixed(1)});
    vec2 aUv = coordBase * alphaST.xy + alphaST.zw + pan0.zw * timeSec;
    vec4 aSamp = vfxSampleAtlasRectWrapped(atlasTex, alphaRect, aUv, flipV, clampAlphaU, clampAlphaV);
    maskA = vfxChannelPickerAdd(aSamp, alphaChan);
  } else {
    float r = length(uv0 * 2.0 - 1.0);
    maskA = smoothstep(1.0, 0.15, r);
  }

  float softMul = 1.0;
  if (vfxHasFlag(flags, ${UBER_FLAG_USE_SOFT_ALPHA.toFixed(1)})) {
    softMul = vfxComputeSoftFade(depthTex, hasDepth, fragCoord, invViewport, camNearFar, gl_FragCoord.z, params0.w);
  }

  float alpha = clamp(maskA * clamp(vColor.a, 0.0, 1.0) * softMul, 0.0, 1.0);
  if (alpha < 0.01) discard;

  float normStr = params0.z / (1.0 + abs(params0.z) * 35.0);
  float strength = normStr * maskA * clamp(vColor.a, 0.0, 1.0) * softMul;
  vec2 screenUv = fragCoord * invViewport;
  vec2 refrUv = clamp(screenUv + nOffset * strength, vec2(0.002), vec2(0.998));
  vec3 sceneCol = texture2D(sceneTex, refrUv).rgb;
  return vec4(sceneCol, alpha);
}

vec4 vfxEvalPbrFxFragment(
  sampler2D matLut,
  sampler2D atlasTex,
  float hasAtlas,
  float flipV,
  float rowIdx,
  vec2 uv0,
  vec4 vColor,
  vec4 custom1,
  float timeSec,
  vec3 viewDirWs,
  vec3 normalWs,
  vec3 lightDirWs,
  bool isFrontFacing
) {
  vec4 hdr = vfxReadMatTexel(matLut, rowIdx, 0.0);
  float flags = hdr.y;
  float alphaCutoff = hdr.w;
  if (!vfxHasFlag(flags, ${UBER_FLAG_DOUBLE_SIDED.toFixed(1)})) {
    bool cullFront = vfxHasFlag(flags, ${UBER_FLAG_CULL_FRONT.toFixed(1)});
    if (cullFront ? isFrontFacing : !isFrontFacing) {
      discard;
    }
  }

  vec4 baseTint = vfxReadMatTexel(matLut, rowIdx, 19.0);
  vec4 emisTintInt = vfxReadMatTexel(matLut, rowIdx, 20.0);
  vec4 pbrScalars = vfxReadMatTexel(matLut, rowIdx, 30.0);
  vec4 meta31 = vfxReadMatTexel(matLut, rowIdx, 31.0);
  float texMask = meta31.w;

  bool hasBaseTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_MAIN.toFixed(1)});
  bool hasDetTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_DETAIL.toFixed(1)});
  bool hasNormTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_NORMAL.toFixed(1)});
  bool useBaseAsNormal = !hasNormTex && hasBaseTex && vfxHasFlag(flags, ${UBER_FLAG_USE_BASE_AS_NORMAL.toFixed(1)});
  bool hasOrmTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_ORM.toFixed(1)});
  bool hasEmisTex = hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_EMISSION.toFixed(1)});
  bool useErosion = !vfxHasFlag(flags, ${UBER_FLAG_DISABLE_EROSION.toFixed(1)});
  bool hasDissTex = useErosion && hasAtlas > 0.5 && vfxHasFlag(texMask, ${UBER_TEX_BIT_DISSOLVE.toFixed(1)});
  bool useFresnel = vfxHasFlag(flags, ${UBER_FLAG_FRESNEL.toFixed(1)});

  bool clampMainU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_U.toFixed(1)});
  bool clampMainV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_MAIN_V.toFixed(1)});
  bool clampDetU = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_DETAIL_U.toFixed(1)});
  bool clampDetV = vfxHasFlag(texMask, ${UBER_CLAMP_BIT_DETAIL_V.toFixed(1)});

  vec4 pan0 = (hasBaseTex || hasDetTex) ? vfxReadMatTexel(matLut, rowIdx, 15.0) : vec4(0.0);
  vec4 pan1 = (hasEmisTex || useBaseAsNormal || hasDissTex || (useErosion && !vfxHasFlag(flags, ${UBER_FLAG_IS_PARTICLE.toFixed(1)})))
    ? vfxReadMatTexel(matLut, rowIdx, 16.0)
    : vec4(0.0);
  vec4 fresNormOcc = (hasNormTex || hasOrmTex || useFresnel)
    ? vfxReadMatTexel(matLut, rowIdx, 23.0)
    : vec4(1.0, 1.0, 1.0, 1.0);

  vec2 uUv0 = vec2(uv0.x, 1.0 - uv0.y);

  vec4 detSample = vec4(1.0);
  if (hasDetTex) {
    vec4 detRect = vfxReadMatTexel(matLut, rowIdx, 3.0);
    vec4 detST = vfxReadMatTexel(matLut, rowIdx, 4.0);
    vec2 duv = uUv0 * detST.xy + detST.zw + pan0.zw * timeSec;
    detSample = vfxSampleAtlasRectWrapped(atlasTex, detRect, vec2(duv.x, 1.0 - duv.y), flipV, clampDetU, clampDetV);
    if (vfxHasFlag(flags, ${UBER_FLAG_DETAIL_SRGB.toFixed(1)})) {
      detSample.rgb = vfxSrgbToLinear3(detSample.rgb);
    }
  }

  float distSignal = (hasDetTex || abs(meta31.x) > 1e-6 || abs(meta31.y) > 1e-6)
    ? vfxChannelPickerClamped(detSample, vfxReadMatTexel(matLut, rowIdx, 10.0))
    : 0.0;

  vec4 albedoSamp = vec4(1.0);
  vec4 baseRect = vec4(0.0, 0.0, 1.0, 1.0);
  vec2 mainUvFlip = vec2(uUv0.x, 1.0 - uUv0.y);
  if (hasBaseTex) {
    baseRect = vfxReadMatTexel(matLut, rowIdx, 1.0);
    vec4 baseST = vfxReadMatTexel(matLut, rowIdx, 2.0);
    vec2 uvOff = vfxHasFlag(flags, ${UBER_FLAG_USE_UV_OFFSET.toFixed(1)}) ? custom1.zw : vec2(0.0);
    vec2 mainUv = (uUv0 + uvOff + vec2(distSignal * meta31.x)) * baseST.xy + baseST.zw + pan0.xy * timeSec;
    mainUvFlip = vec2(mainUv.x, 1.0 - mainUv.y);
    albedoSamp = vfxSampleAtlasRectWrapped(atlasTex, baseRect, mainUvFlip, flipV, clampMainU, clampMainV);
    if (vfxHasFlag(flags, ${UBER_FLAG_MAIN_SRGB.toFixed(1)})) {
      albedoSamp.rgb = vfxSrgbToLinear3(albedoSamp.rgb);
    }
  }
  float hdrScale = max(0.0, custom1.x + 1.0);
  vec3 baseUnlit = albedoSamp.rgb * baseTint.rgb;
  vec3 albedo = baseUnlit * pbrScalars.z * vColor.rgb * hdrScale;
  float baseAlpha = albedoSamp.a * baseTint.a * vColor.a;

  // Normal perturbation via screen-space derivative cotangent frame (Mikkelsen/Schuler)
  vec3 N = normalize(normalWs);
  if (!isFrontFacing) N = -N;
  if (hasNormTex) {
    vec4 normRect = vfxReadMatTexel(matLut, rowIdx, 24.0);
    vec4 normST = vfxReadMatTexel(matLut, rowIdx, 25.0);
    vec2 nuv = uUv0 * normST.xy + normST.zw;
    vec2 nuvFlip = vec2(nuv.x, 1.0 - nuv.y);
    vec3 nm = vfxSampleAtlasRectWrapped(atlasTex, normRect, nuvFlip, flipV, clampMainU, clampMainV).xyz * 2.0 - 1.0;
    mat3 tbn = vfxComputeCotangentFrame(N, -viewDirWs, nuvFlip);
    N = normalize(tbn * vec3(nm.x * fresNormOcc.z, nm.y * fresNormOcc.z, max(0.05, nm.z)));
  } else if (useBaseAsNormal) {
    vec2 eps = vec2(0.004, 0.0);
    float hL = dot(vfxSampleAtlasRectWrapped(atlasTex, baseRect, mainUvFlip - eps.xy, flipV, clampMainU, clampMainV).rgb, vec3(0.333));
    float hR = dot(vfxSampleAtlasRectWrapped(atlasTex, baseRect, mainUvFlip + eps.xy, flipV, clampMainU, clampMainV).rgb, vec3(0.333));
    float hD = dot(vfxSampleAtlasRectWrapped(atlasTex, baseRect, mainUvFlip - eps.yx, flipV, clampMainU, clampMainV).rgb, vec3(0.333));
    float hU = dot(vfxSampleAtlasRectWrapped(atlasTex, baseRect, mainUvFlip + eps.yx, flipV, clampMainU, clampMainV).rgb, vec3(0.333));
    mat3 tbn = vfxComputeCotangentFrame(N, -viewDirWs, mainUvFlip);
    N = normalize(tbn[2] + (tbn[0] * (hL - hR) + tbn[1] * (hD - hU)) * pan1.z * 2.0);
  }

  float ao = 1.0;
  float roughness = clamp(1.0 - pbrScalars.x, 0.06, 1.0);
  float metallic = clamp(pbrScalars.y, 0.0, 1.0);
  if (hasOrmTex) {
    vec4 ormRect = vfxReadMatTexel(matLut, rowIdx, 26.0);
    vec4 ormST = vfxReadMatTexel(matLut, rowIdx, 27.0);
    vec2 ormUv = uUv0 * ormST.xy + ormST.zw;
    vec4 orm = vfxSampleAtlasRectWrapped(atlasTex, ormRect, vec2(ormUv.x, 1.0 - ormUv.y), flipV, clampMainU, clampMainV);
    ao = mix(1.0, orm.r, clamp(fresNormOcc.w, 0.0, 1.0));
    roughness = clamp(1.0 - clamp(1.0 - orm.g, 0.0, 1.0) * pbrScalars.x, 0.06, 1.0);
    metallic = clamp(orm.b * pbrScalars.y, 0.0, 1.0);
  }

  // Cook-Torrance GGX BRDF + procedural hemisphere/specular IBL
  vec3 L = normalize(lightDirWs);
  vec3 V = normalize(viewDirWs);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 0.0);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  vec3 F = F0 + (vec3(1.0) - F0) * pow(1.0 - vdh, 5.0);
  float a = roughness * roughness;
  float a2 = a * a;
  float dDen = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / max(3.14159265 * dDen * dDen, 1e-5);
  float k = (roughness + 1.0);
  k = (k * k) * 0.125;
  float gV = ndv / (ndv * (1.0 - k) + k);
  float gL = ndl / (ndl * (1.0 - k) + k);
  float G = gV * gL;
  vec3 specDirect = (D * G * F) / max(4.0 * ndv * max(ndl, 1e-4), 1e-4);

  vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
  vec3 directCol = (kD * albedo * 0.31830989 + specDirect) * ndl * 1.45;

  float hemi = 0.5 + 0.5 * N.y;
  vec3 envDiff = mix(vec3(0.14, 0.16, 0.22), vec3(0.42, 0.48, 0.58), hemi);
  vec3 R = reflect(-V, N);
  float rHemi = 0.5 + 0.5 * R.y;
  vec3 envSpec = mix(vec3(0.18, 0.20, 0.26), vec3(0.75, 0.82, 0.95), pow(rHemi, mix(3.0, 0.7, roughness)));
  vec3 F_ibl = F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - ndv, 5.0);
  vec3 kD_ibl = (vec3(1.0) - F_ibl) * (1.0 - metallic);
  vec3 iblCol = (kD_ibl * albedo * envDiff + envSpec * F_ibl * mix(0.85, 0.25, roughness)) * ao;

  vec3 litCol = directCol + iblCol;

  // Emission + Self illumination (PBR FX.shadergraph: custom1.x boosts BaseColor, not Emission)
  if (hasEmisTex) {
    vec4 emisRect = vfxReadMatTexel(matLut, rowIdx, 28.0);
    vec4 emisST = vfxReadMatTexel(matLut, rowIdx, 29.0);
    vec2 eUv = uUv0 * emisST.xy + emisST.zw + pan1.xy * timeSec;
    vec3 emSamp = vfxSampleAtlasRectWrapped(atlasTex, emisRect, vec2(eUv.x, 1.0 - eUv.y), flipV, clampMainU, clampMainV).rgb;
    if (vfxHasFlag(flags, ${UBER_FLAG_MAIN_SRGB.toFixed(1)})) {
      emSamp = vfxSrgbToLinear3(emSamp);
    }
    litCol += emSamp * emisTintInt.rgb * max(0.0, emisTintInt.a);
  } else if (dot(emisTintInt.rgb, vec3(1.0)) > 0.001) {
    litCol += albedo * emisTintInt.rgb * max(0.0, emisTintInt.a) * 0.35;
  }
  litCol += baseUnlit * pbrScalars.z;

  // Dissolve
  float erosion = 1.0;
  if (useErosion) {
    vec4 dissParams = vfxReadMatTexel(matLut, rowIdx, 18.0);
    vec4 detDissChan = vfxReadMatTexel(matLut, rowIdx, 13.0);
    float dissAmt = vfxHasFlag(flags, ${UBER_FLAG_IS_PARTICLE.toFixed(1)}) ? (custom1.y - 1.0) : pan1.w;
    float edge1 = mix(dissParams.x, dissParams.y, dissAmt);
    float edge2 = edge1 - dissParams.x;
    float dissVal = 1.0;
    if (hasDissTex) {
      vec4 dissRect = vfxReadMatTexel(matLut, rowIdx, 5.0);
      vec4 dissST = vfxReadMatTexel(matLut, rowIdx, 6.0);
      vec2 duv = (uUv0 + vec2(distSignal * meta31.y)) * dissST.xy + dissST.zw + pan1.xy * timeSec;
      vec4 dissSample = vfxSampleAtlasRectWrapped(atlasTex, dissRect, vec2(duv.x, 1.0 - duv.y), flipV, clampDetU, clampDetV);
      if (vfxHasFlag(flags, ${UBER_FLAG_ALPHA_OV_SRGB.toFixed(1)}) || vfxHasFlag(flags, ${UBER_FLAG_DETAIL_SRGB.toFixed(1)})) {
        dissSample.rgb = vfxSrgbToLinear3(dissSample.rgb);
      }
      dissVal = vfxChannelPickerClamped(dissSample, detDissChan);
    } else {
      dissVal = vfxChannelPickerClamped(detSample, detDissChan);
    }
    erosion = vfxSafeSmoothstep(edge1, edge2, dissVal);
  }

  float finalAlpha = clamp(baseAlpha * erosion, 0.0, 1.0);
  if (vfxHasFlag(flags, ${UBER_FLAG_ALPHA_TEST.toFixed(1)}) && finalAlpha < alphaCutoff) {
    discard;
  }

  if (useFresnel) {
    vec4 fresCol = vfxReadMatTexel(matLut, rowIdx, 22.0);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(max(0.0, 1.0 - ndv), max(0.05, fresNormOcc.x)) * fresNormOcc.y;
    litCol += fresCol.rgb * fres * hdrScale;
  }

  if (finalAlpha < 0.0005) discard;
  return vec4(litCol, finalAlpha);
}
`;

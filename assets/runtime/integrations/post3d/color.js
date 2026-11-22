/** Color / tone-curve / eye-adaptation math helpers. */
/**
 * @typedef {[number, number, number]} RGBTuple Linear RGB triple.
 */

/**
 * Clamps a value into [lo, hi].
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clampRange(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Approximate linear sRGB of a Planckian radiator (Y = 1).
 * @param {number} tempK Color temperature in Kelvin (clamped to 1667..25000, default 6500 if non-finite).
 * @returns {RGBTuple}
 */
export function ciePlanckianLinearRgb(tempK) {
  const t = clampRange(Number.isFinite(tempK) ? tempK : 6500, 1667, 25000);
  const invT = 1 / t;
  const invT2 = invT * invT;
  const invT3 = invT2 * invT;
  const x = t <= 4000
    ? (-0.2661239e9 * invT3 - 0.2343589e6 * invT2 + 0.8776956e3 * invT + 0.179910)
    : (-3.0258469e9 * invT3 + 2.1070379e6 * invT2 + 0.2226347e3 * invT + 0.240390);
  const x2 = x * x;
  const x3 = x2 * x;
  const y = t <= 2222
    ? (-1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683)
    : (t <= 4000
      ? (-0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867)
      : (3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483));
  const Y = 1;
  const X = x / Math.max(1e-4, y);
  const Z = Math.max(0, 1 - x - y) / Math.max(1e-4, y);
  return [
    Math.max(1e-4, 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    Math.max(1e-4, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z),
    Math.max(1e-4, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  ];
}

export const D65_PLANCKIAN_REF = ciePlanckianLinearRgb(6500);

/**
 * Computes luminance-preserving camera white-balance RGB multipliers relative
 * to 6500K neutral daylight (`whiteTemp > 6500` warms, `< 6500` cools).
 * @param {number} [whiteTemp=6500] Kelvin, clamped 1667..25000.
 * @param {number} [whiteTint=0] Green/magenta tint, clamped -1..1.
 * @param {RGBTuple} [out=[1,1,1]] Receives the multipliers (mutated and returned).
 * @returns {RGBTuple} `out`.
 */
export function computeWhiteBalanceRGB(whiteTemp = 6500, whiteTint = 0, out = [1, 1, 1]) {
  const temp = clampRange(Number.isFinite(whiteTemp) ? whiteTemp : 6500, 1667, 25000);
  const tint = clampRange(Number.isFinite(whiteTint) ? whiteTint : 0, -1, 1);
  if (temp === 6500 && tint === 0) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  const src = ciePlanckianLinearRgb(temp);
  let r = D65_PLANCKIAN_REF[0] / src[0];
  let g = (D65_PLANCKIAN_REF[1] / src[1]) * Math.exp(-tint * 0.25);
  let b = D65_PLANCKIAN_REF[2] / src[2];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const invLuma = luma > 1e-6 ? 1 / luma : 1;
  out[0] = r * invLuma;
  out[1] = g * invLuma;
  out[2] = b * invLuma;
  return out;
}

/**
 * Clean-room monotonic parametric filmic tone curve for a single linear HDR channel.
 * @typedef {object} FilmicCurveParams
 * @property {number} [slope=0.88] Mid-tone contrast slope.
 * @property {number} [toe=0.55] Toe strength 0..1.
 * @property {number} [shoulder=0.26] Shoulder strength 0..1.
 * @property {number} [blackClip=0] Black clip 0..0.5.
 * @property {number} [whiteClip=0.04] White clip 0..0.5.
 */

/**
 * Evaluates the filmic curve for one channel.
 * @param {number} x Linear HDR value (>= 0).
 * @param {FilmicCurveParams} [params]
 * @returns {number} Mapped value in 0..1.
 */
export function evaluateFilmicCurveChannel(x, {
  slope = 0.88,
  toe = 0.55,
  shoulder = 0.26,
  blackClip = 0.0,
  whiteClip = 0.04,
} = {}) {
  const lin = Math.max(0, Number.isFinite(x) ? x : 0);
  if (lin <= 0) return 0;
  const xScaled = lin / 0.18;
  const contrastPow = 0.55 + Math.max(0.05, Number.isFinite(slope) ? slope : 0.88) * 0.65;
  const toeClamp = clampRange(Number.isFinite(toe) ? toe : 0.55, 0, 1);
  const shoulderClamp = clampRange(Number.isFinite(shoulder) ? shoulder : 0.26, 0, 1);
  const blackClamp = clampRange(Number.isFinite(blackClip) ? blackClip : 0, 0, 0.5);
  const whiteClamp = clampRange(Number.isFinite(whiteClip) ? whiteClip : 0.04, 0, 0.5);

  const shapedScale = xScaled < 1
    ? Math.pow(xScaled, contrastPow * (1 + toeClamp * 0.45 * (1 - xScaled)))
    : Math.pow(xScaled, contrastPow);
  const h = 0.18 * shapedScale;
  const whitePt = 1.0 + whiteClamp * 0.85;
  const u = h * (1.0 + shoulderClamp * 0.5);
  let mapped = (u * whitePt) / (u + 0.82 + shoulderClamp * 0.35);
  if (blackClamp > 0) {
    const floorPt = blackClamp * 0.06;
    mapped = Math.max(0, mapped - floorPt) / Math.max(1e-4, 1.0 - floorPt);
  }
  return clampRange(mapped, 0, 1);
}

/**
 * Evaluates the parametric filmic curve with subtle highlight crosstalk desaturation.
 * @param {ArrayLike<number>} rgb Linear HDR RGB input.
 * @param {FilmicCurveParams} [params={}]
 * @param {RGBTuple} [out=[0,0,0]] Receives the result (mutated and returned).
 * @returns {RGBTuple} `out`.
 */
export function evaluateFilmicCurveRGB(rgb, params = {}, out = [0, 0, 0]) {
  const r = Math.max(0, Number(rgb[0]) || 0);
  const g = Math.max(0, Number(rgb[1]) || 0);
  const b = Math.max(0, Number(rgb[2]) || 0);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.max(0, Math.min(1, (luma - 0.5) / 3.5));
  const smooth = t * t * (3 - 2 * t);
  const desat = smooth * 0.22 + 0.05;
  out[0] = evaluateFilmicCurveChannel(r + (luma - r) * desat, params);
  out[1] = evaluateFilmicCurveChannel(g + (luma - g) * desat, params);
  out[2] = evaluateFilmicCurveChannel(b + (luma - b) * desat, params);
  return out;
}

/**
 * Eye-adaptation tuning.
 * @typedef {object} EyeAdaptationParams
 * @property {number} [keyValue=0.18] Target middle-grey key.
 * @property {number} [minExposure=0.35] Minimum exposure multiplier.
 * @property {number} [maxExposure=2.6] Maximum exposure multiplier.
 * @property {number} [adaptSpeedUp=3.0] Adaptation rate (1/s) when target exposure decreases (scene brightens).
 * @property {number} [adaptSpeedDown=1.4] Adaptation rate (1/s) when target exposure increases (scene darkens).
 * @property {number} [exposureCompensation=1.0] Exposure compensation multiplier.
 */

/**
 * Computes one asymmetric temporal eye-adaptation step from scene average luminance.
 * @param {number} currentExposure Current exposure multiplier.
 * @param {number} avgLuminance Scene average luminance (clamped 1e-4..1e4).
 * @param {EyeAdaptationParams} [params]
 * @param {number} [dt=1/60] Time step in seconds.
 * @returns {number} New exposure multiplier.
 */
export function stepEyeAdaptation(currentExposure, avgLuminance, {
  keyValue = 0.18,
  minExposure = 0.35,
  maxExposure = 2.6,
  adaptSpeedUp = 3.0,
  adaptSpeedDown = 1.4,
  exposureCompensation = 1.0,
} = {}, dt = 1 / 60) {
  const cur = Number.isFinite(currentExposure) ? clampRange(currentExposure, minExposure, maxExposure) : 1.0;
  const luma = clampRange(Number.isFinite(avgLuminance) ? avgLuminance : 0.18, 1e-4, 1e4);
  const target = clampRange((keyValue / luma) * exposureCompensation, minExposure, maxExposure);
  const speed = target > cur ? adaptSpeedDown : adaptSpeedUp;
  const alpha = 1 - Math.exp(-Math.max(0, Number.isFinite(dt) ? dt : 0) * Math.max(0.05, speed));
  return cur + (target - cur) * alpha;
}

/** Supported built-in 3D color-grading LUT preset names. */
export const COLOR_LUT_PRESETS = Object.freeze(['neutral', 'cinematic', 'vibrant', 'cool-scifi', 'warm-sunset']);

function evaluateLutPresetColor(preset, r, g, b) {
  if (preset === 'neutral') return [r, g, b];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (preset === 'cinematic') {
    const cr = r * r * (3 - 2 * r) * 0.22 + r * 0.78;
    const cg = g * g * (3 - 2 * g) * 0.16 + g * 0.84;
    const cb = b * b * (3 - 2 * b) * 0.14 + b * 0.86;
    const coolShadow = Math.max(0, 1 - luma * 1.8) * 0.045;
    const warmHi = Math.max(0, luma - 0.55) * 0.06;
    return [
      clampRange(cr - coolShadow * 0.5 + warmHi, 0, 1),
      clampRange(cg + coolShadow * 0.2 + warmHi * 0.45, 0, 1),
      clampRange(cb + coolShadow - warmHi * 0.5, 0, 1),
    ];
  }
  if (preset === 'vibrant') {
    const sat = 1.24;
    const vr = clampRange(luma + (r - luma) * sat, 0, 1);
    const vg = clampRange(luma + (g - luma) * sat, 0, 1);
    const vb = clampRange(luma + (b - luma) * sat, 0, 1);
    return [
      clampRange(vr * 0.92 + vr * vr * (3 - 2 * vr) * 0.08, 0, 1),
      clampRange(vg * 0.92 + vg * vg * (3 - 2 * vg) * 0.08, 0, 1),
      clampRange(vb * 0.92 + vb * vb * (3 - 2 * vb) * 0.08, 0, 1),
    ];
  }
  if (preset === 'cool-scifi') {
    return [
      clampRange(r * 0.90 + Math.max(0, luma - 0.75) * 0.05, 0, 1),
      clampRange(g * 0.99 + Math.max(0, 1 - luma) * 0.025, 0, 1),
      clampRange(b * 1.07 + 0.03, 0, 1),
    ];
  }
  if (preset === 'warm-sunset') {
    return [
      clampRange(r * 1.08 + 0.025, 0, 1),
      clampRange(g * 1.01 + luma * 0.015, 0, 1),
      clampRange(b * 0.88 - Math.max(0, luma - 0.4) * 0.03, 0, 1),
    ];
  }
  return [r, g, b];
}

/**
 * Generate a baked 2D strip 3D LUT (`size^2 x size`, RGBA8) for low-cost mobile color grading.
 * @param {object|null} [THREE]
 * @param {string|((r: number, g: number, b: number) => [number, number, number])} [presetOrFn='cinematic']
 * @param {number} [size=16]
 */
export function createColorLutTexture3D(THREE = null, presetOrFn = 'cinematic', size = 16) {
  const s = Math.max(4, Math.min(32, Math.floor(Number(size) || 16)));
  const width = s * s;
  const height = s;
  const data = new Uint8Array(width * height * 4);
  const customFn = typeof presetOrFn === 'function' ? presetOrFn : null;
  const presetName = typeof presetOrFn === 'string' && COLOR_LUT_PRESETS.includes(presetOrFn)
    ? presetOrFn
    : 'cinematic';
  const invMax = 1 / (s - 1);

  for (let b = 0; b < s; b++) {
    const fb = b * invMax;
    for (let g = 0; g < s; g++) {
      const fg = g * invMax;
      for (let r = 0; r < s; r++) {
        const fr = r * invMax;
        const [or, og, ob] = customFn ? customFn(fr, fg, fb) : evaluateLutPresetColor(presetName, fr, fg, fb);
        const x = b * s + r;
        const idx = (g * width + x) * 4;
        data[idx] = Math.round(clampRange(or, 0, 1) * 255);
        data[idx + 1] = Math.round(clampRange(og, 0, 1) * 255);
        data[idx + 2] = Math.round(clampRange(ob, 0, 1) * 255);
        data[idx + 3] = 255;
      }
    }
  }

  if (THREE?.DataTexture) {
    const tex = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    if (THREE.LinearFilter !== undefined) {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
    }
    if (THREE.ClampToEdgeWrapping !== undefined) {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    tex.userData = {
      ...(tex.userData || {}),
      hgameLutSize: s,
      preset: customFn ? 'custom' : presetName,
    };
    return tex;
  }

  return Object.freeze({
    data,
    width,
    height,
    size: s,
    preset: customFn ? 'custom' : presetName,
    isDataTexture: false,
  });
}

/**
 * Configure any loaded 256x16 strip LUT texture (`size^2 x size`) for lossless WebGL2 sampling:
 * LinearFilter, no mipmaps, ClampToEdgeWrapping, NoColorSpace, and flipY=false.
 * @param {object} tex Three.js Texture instance.
 * @param {object|null} [THREE]
 * @param {{ size?: number, srgbInput?: boolean, preset?: string }} [options]
 */
export function configureStripLutTexture(tex, THREE = null, { size = 16, srgbInput = true, preset = 'custom' } = {}) {
  if (!tex || typeof tex !== 'object') return tex;
  const s = Math.max(4, Math.min(32, Math.floor(Number(size) || 16)));
  if (THREE?.LinearFilter !== undefined) {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
  }
  if (THREE?.ClampToEdgeWrapping !== undefined) {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  if (THREE?.NoColorSpace !== undefined) {
    tex.colorSpace = THREE.NoColorSpace;
  }
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.userData = {
    ...(tex.userData || {}),
    hgameLutSize: s,
    hgameLutSrgb: Boolean(srgbInput),
    preset,
  };
  tex.needsUpdate = true;
  return tex;
}

/**
 * Async load a lossless 256x16 PNG strip LUT (e.g. AmplifyLUTPack) with strict WebGL2 flags.
 * @param {object} THREE
 * @param {string} url
 * @param {{ size?: number, srgbInput?: boolean, preset?: string }} [options]
 */
export async function loadStripLutTexture(THREE, url, { size = 16, srgbInput = true, preset = 'custom' } = {}) {
  if (!THREE?.TextureLoader || typeof url !== 'string' || !url) {
    throw new Error('loadStripLutTexture requires THREE.TextureLoader and a valid URL.');
  }
  const loader = new THREE.TextureLoader();
  const tex = await loader.loadAsync(url);
  return configureStripLutTexture(tex, THREE, { size, srgbInput, preset });
}



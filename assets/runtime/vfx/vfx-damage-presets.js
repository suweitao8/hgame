// Clean-room damage number formatting, presets, and numeric color/scale curves.
// Zero-allocation fast paths for runtime popup formatting.

export const DAMAGE_ATLAS_CHARS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '-', '+', '!', '暴', '闪', '盾',
  '.', ',', '%', 'x', '/', ':', '(', ')', ' ',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '格', '挡', '免', '疫', '吸', '收', '连', '击', '毒', '火', '冰', '雷', '伤',
]);

const CHAR_TO_GLYPH = new Map();
for (let i = 0; i < DAMAGE_ATLAS_CHARS.length; i++) {
  const ch = DAMAGE_ATLAS_CHARS[i];
  CHAR_TO_GLYPH.set(ch, i);
  const lower = ch.toLowerCase();
  if (lower !== ch) CHAR_TO_GLYPH.set(lower, i);
}

/**
 * Looks up a character's glyph index in the 64-glyph damage atlas, or -1 if absent.
 * @param {string} ch
 * @returns {number}
 */
export function lookupDamageGlyph(ch) {
  const idx = CHAR_TO_GLYPH.get(ch);
  return idx === undefined ? -1 : idx;
}

const DEFAULT_SUFFIXES = Object.freeze(['K', 'M', 'B', 'T']);
const DEFAULT_SUFFIX_DIGITS = Object.freeze([3, 3, 3, 3]);

function stripTrailingZeros(fracStr, decimalChar) {
  let end = fracStr.length;
  while (end > 0 && fracStr[end - 1] === '0') end--;
  if (end === 0) return '';
  return decimalChar + fracStr.slice(0, end);
}

function insertGroupSeparators(intStr, distance, sepChar) {
  if (distance <= 0 || intStr.length <= distance) return intStr;
  let out = '';
  let count = 0;
  for (let i = intStr.length - 1; i >= 0; i--) {
    if (count > 0 && count % distance === 0) out = sepChar + out;
    out = intStr[i] + out;
    count++;
  }
  return out;
}

/**
 * Formats a numeric damage/heal/currency value according to digit display rules
 * (decimals, trailing-zero trimming, grouping separators, and suffix shortening).
 * @param {number} value
 * @param {object} [opts]
 * @returns {string}
 */
export function formatDamageValue(value, opts = {}) {
  const num = Number.isFinite(value) ? value : 0;
  const isNeg = num < 0;
  const abs = Math.abs(num);

  const shorten = opts.suffixShorten === true
    ? { enabled: true }
    : (opts.suffixShorten && opts.suffixShorten.enabled !== false ? opts.suffixShorten : null);

  if (shorten) {
    const suffixes = Array.isArray(shorten.suffixes) && shorten.suffixes.length > 0 ? shorten.suffixes : DEFAULT_SUFFIXES;
    const suffixDigits = Array.isArray(shorten.suffixDigits) && shorten.suffixDigits.length === suffixes.length
      ? shorten.suffixDigits
      : DEFAULT_SUFFIX_DIGITS;
    const maxDigits = Math.max(1, (shorten.maxDigits ?? 3) | 0);
    const sDec = Math.max(0, Math.min(3, (shorten.decimals ?? shorten.suffixDecimals ?? 1) | 0));
    const sDecChar = shorten.decimalChar ?? shorten.suffixDecimalChar ?? opts.decimalChar ?? '.';
    const sHideZeros = shorten.hideZeros ?? shorten.suffixHideZeros ?? true;

    let chosenSuffix = '';
    let divisor = 1;
    let totalExp = 0;
    const intDigits = abs < 1 ? 1 : Math.floor(Math.log10(abs)) + 1;
    if (intDigits > maxDigits) {
      for (let i = 0; i < suffixes.length; i++) {
        totalExp += Math.max(1, suffixDigits[i] | 0);
        const nextDiv = 10 ** totalExp;
        if (abs < nextDiv) break;
        divisor = nextDiv;
        chosenSuffix = suffixes[i];
        const reducedDigits = Math.floor(Math.log10(abs / divisor)) + 1;
        if (reducedDigits <= maxDigits) break;
      }
    }

    if (chosenSuffix) {
      const scaled = abs / divisor;
      const factor = 10 ** sDec;
      const rounded = Math.round(scaled * factor) / factor;
      const fixed = rounded.toFixed(sDec);
      const dotIdx = fixed.indexOf('.');
      const intPart = dotIdx >= 0 ? fixed.slice(0, dotIdx) : fixed;
      const fracPart = dotIdx >= 0 ? fixed.slice(dotIdx + 1) : '';
      const fracOut = fracPart
        ? (sHideZeros ? stripTrailingZeros(fracPart, sDecChar) : sDecChar + fracPart)
        : '';
      return (isNeg ? '-' : '') + intPart + fracOut + chosenSuffix;
    }
  }

  const decimals = Math.max(0, Math.min(3, (opts.decimals ?? 0) | 0));
  const decimalChar = opts.decimalChar ?? '.';
  const hideZeros = Boolean(opts.hideZeros);
  const factor = 10 ** decimals;
  const rounded = Math.round(abs * factor) / factor;
  const fixed = rounded.toFixed(decimals);
  const dotIdx = fixed.indexOf('.');
  let intPart = dotIdx >= 0 ? fixed.slice(0, dotIdx) : fixed;
  const fracPart = dotIdx >= 0 ? fixed.slice(dotIdx + 1) : '';

  if (opts.dotSeparation) {
    intPart = insertGroupSeparators(intPart, Math.max(1, (opts.dotDistance ?? 3) | 0), opts.dotChar ?? ',');
  }

  const fracOut = fracPart
    ? (hideZeros ? stripTrailingZeros(fracPart, decimalChar) : decimalChar + fracPart)
    : '';
  return (isNeg ? '-' : '') + intPart + fracOut;
}

function lerpRgb(c0, c1, t) {
  const u = Math.max(0, Math.min(1, t));
  const r0 = (c0 >> 16) & 255;
  const g0 = (c0 >> 8) & 255;
  const b0 = c0 & 255;
  const r1 = (c1 >> 16) & 255;
  const g1 = (c1 >> 8) & 255;
  const b1 = c1 & 255;
  const r = Math.round(r0 + (r1 - r0) * u);
  const g = Math.round(g0 + (g1 - g0) * u);
  const b = Math.round(b0 + (b1 - b0) * u);
  return (r << 16) | (g << 8) | b;
}

/**
 * Computes an RGB24 color for a damage magnitude using either a 2-color range or multi-stop gradient.
 * @param {number} value
 * @param {object} cfg
 * @returns {number} 0xRRGGBB
 */
export function evaluateColorByNumber(value, cfg) {
  const fromNum = cfg.fromNumber ?? 0;
  const toNum = cfg.toNumber ?? 100;
  const span = toNum - fromNum;
  const t = span > 1e-6 ? Math.max(0, Math.min(1, (Math.abs(value) - fromNum) / span)) : 0;

  if (Array.isArray(cfg.stops) && cfg.stops.length > 0) {
    if (t <= cfg.stops[0].t) return cfg.stops[0].color & 0xffffff;
    for (let i = 1; i < cfg.stops.length; i++) {
      const prev = cfg.stops[i - 1];
      const curr = cfg.stops[i];
      if (t <= curr.t) {
        const seg = curr.t - prev.t;
        return lerpRgb(prev.color, curr.color, seg > 1e-6 ? (t - prev.t) / seg : 1);
      }
    }
    return cfg.stops[cfg.stops.length - 1].color & 0xffffff;
  }

  return lerpRgb(cfg.fromColor ?? 0xffcc80, cfg.toColor ?? 0xff2a2a, t);
}

/**
 * Computes a scale multiplier for a damage magnitude across `[fromNumber, toNumber]`.
 * @param {number} value
 * @param {object} cfg
 * @returns {number}
 */
export function evaluateScaleByNumber(value, cfg) {
  const fromNum = cfg.fromNumber ?? 0;
  const toNum = cfg.toNumber ?? 1000;
  const fromScale = cfg.fromScale ?? 1;
  const toScale = cfg.toScale ?? 1.8;
  const span = toNum - fromNum;
  const t = span > 1e-6 ? Math.max(0, Math.min(1, (Math.abs(value) - fromNum) / span)) : 0;
  return fromScale + (toScale - fromScale) * t;
}

/**
 * Built-in clean-room damage number presets (2D/3D normalized; distances/offsets scale cleanly per mode).
 */
export const DAMAGE_NUMBER_PRESETS = Object.freeze({
  normal: Object.freeze({
    color: 0xffffff,
    lifetime: 0.7,
    durationFadeIn: 0.14,
    durationFadeOut: 0.22,
    scaleFadeIn: Object.freeze([1.45, 1.45]),
    offsetFadeIn: Object.freeze([0.16, 0]),
    offsetFadeOut: Object.freeze([0.16, 0]),
    lerp: Object.freeze({ minX: -0.45, maxX: 0.45, minY: 0.55, maxY: 1.0, speed: 6.5 }),
    collision: Object.freeze({ radius: 0.45, pushFactor: 1.0 }),
  }),
  crit: Object.freeze({
    color: 0xfacc15,
    isCrit: true,
    scaleMultiplier: 1.38,
    lifetime: 0.92,
    durationFadeIn: 0.16,
    durationFadeOut: 0.24,
    scaleFadeIn: Object.freeze([2.15, 2.15]),
    crossScaleFadeIn: Object.freeze([1.0, 1.45]),
    offsetFadeIn: Object.freeze([0.22, 0]),
    offsetFadeOut: Object.freeze([0.18, 0]),
    lerp: Object.freeze({ minX: 0.3, maxX: 0.75, minY: 0.75, maxY: 1.25, speed: 5.5, randomFlip: true }),
    shake: Object.freeze({ offsetX: 0.04, offsetY: 0.04, frequency: 52 }),
    startRotation: Object.freeze([-7, 7]),
    colorByNumber: Object.freeze({ fromNumber: 150, toNumber: 2500, fromColor: 0xfacc15, toColor: 0xff3b30 }),
    scaleByNumber: Object.freeze({ fromNumber: 150, toNumber: 2500, fromScale: 1.0, toScale: 1.5 }),
    collision: Object.freeze({ radius: 0.55, pushFactor: 1.15 }),
  }),
  heal: Object.freeze({
    color: 0x4ade80,
    isHeal: true,
    leftText: '+',
    lifetime: 0.85,
    durationFadeIn: 0.16,
    durationFadeOut: 0.26,
    scaleFadeIn: Object.freeze([1.35, 1.35]),
    offsetFadeIn: Object.freeze([0, -0.25]),
    lerp: Object.freeze({ minX: -0.25, maxX: 0.25, minY: 0.95, maxY: 1.35, speed: 3.8 }),
  }),
  miss: Object.freeze({
    color: 0x94a3b8,
    isMiss: true,
    enableNumber: false,
    leftText: 'MISS',
    lifetime: 0.65,
    durationFadeIn: 0.12,
    durationFadeOut: 0.2,
    scaleFadeIn: Object.freeze([1.25, 1.25]),
    lerp: Object.freeze({ minX: 0.35, maxX: 0.65, minY: 0.35, maxY: 0.65, speed: 6.0, randomFlip: true }),
  }),
  block: Object.freeze({
    color: 0x60a5fa,
    enableNumber: false,
    leftText: '格挡',
    lifetime: 0.72,
    durationFadeIn: 0.12,
    durationFadeOut: 0.22,
    scaleFadeIn: Object.freeze([1.4, 1.4]),
    shakeFadeIn: Object.freeze({ offsetX: 0.18, offsetY: 0, frequency: 28 }),
    lerp: Object.freeze({ minX: -0.2, maxX: 0.2, minY: 0.55, maxY: 0.85, speed: 5.0 }),
  }),
  immune: Object.freeze({
    color: 0xcbd5e1,
    enableNumber: false,
    leftText: '免疫',
    lifetime: 0.7,
    durationFadeIn: 0.12,
    durationFadeOut: 0.22,
    scaleFadeIn: Object.freeze([1.3, 1.3]),
    lerp: Object.freeze({ minX: -0.15, maxX: 0.15, minY: 0.6, maxY: 0.85, speed: 4.5 }),
  }),
  combo: Object.freeze({
    color: 0xfb923c,
    topText: '连击',
    topColor: 0xfef08a,
    topScale: 0.68,
    scaleMultiplier: 1.22,
    lifetime: 1.05,
    durationFadeIn: 0.14,
    durationFadeOut: 0.25,
    scaleFadeIn: Object.freeze([1.6, 1.6]),
    lerp: Object.freeze({ minX: -0.18, maxX: 0.18, minY: 0.75, maxY: 1.0, speed: 4.0 }),
    combination: Object.freeze({
      method: 'absorbNew',
      maxDistance: 2.2,
      bonusLifetime: 0.45,
      spawnDelay: 0.05,
      absorbDuration: 0.22,
      moveToAbsorber: true,
      instantGain: false,
      absorberScaleFactor: 1.42,
      absorberScaleFade: 12,
    }),
    colorByNumber: Object.freeze({ fromNumber: 100, toNumber: 5000, fromColor: 0xfb923c, toColor: 0xef4444 }),
    scaleByNumber: Object.freeze({ fromNumber: 100, toNumber: 5000, fromScale: 1.0, toScale: 1.45 }),
  }),
  fire: Object.freeze({
    color: 0xf97316,
    lifetime: 0.75,
    durationFadeIn: 0.1,
    durationFadeOut: 0.22,
    velocity: Object.freeze({ minX: 0.45, maxX: 1.15, minY: 2.4, maxY: 3.4, randomFlip: true, dragX: 0.4, dragY: 0.8, gravity: 5.5 }),
    shake: Object.freeze({ offsetX: 0.025, offsetY: 0.025, frequency: 44 }),
  }),
  ice: Object.freeze({
    color: 0x38bdf8,
    lifetime: 0.78,
    durationFadeIn: 0.12,
    durationFadeOut: 0.22,
    scaleFadeIn: Object.freeze([1.5, 1.5]),
    lerp: Object.freeze({ minX: 0.35, maxX: 0.75, minY: 0.5, maxY: 0.9, speed: 5.2, randomFlip: true }),
  }),
  lightning: Object.freeze({
    color: 0xa5f3fc,
    lifetime: 0.7,
    durationFadeIn: 0.08,
    durationFadeOut: 0.18,
    scaleFadeIn: Object.freeze([1.75, 1.75]),
    shake: Object.freeze({ offsetX: 0.055, offsetY: 0.035, frequency: 65 }),
    lerp: Object.freeze({ minX: -0.5, maxX: 0.5, minY: 0.65, maxY: 1.15, speed: 7.5 }),
  }),
  poison: Object.freeze({
    color: 0x84cc16,
    scaleMultiplier: 0.88,
    lifetime: 0.88,
    durationFadeIn: 0.15,
    durationFadeOut: 0.28,
    lerp: Object.freeze({ minX: -0.25, maxX: 0.25, minY: 0.85, maxY: 1.25, speed: 2.8 }),
  }),
  gold: Object.freeze({
    color: 0xfbbf24,
    leftText: '+',
    rightText: 'G',
    digits: Object.freeze({ suffixShorten: true }),
    lifetime: 0.95,
    durationFadeIn: 0.14,
    durationFadeOut: 0.25,
    lerp: Object.freeze({ minX: -0.2, maxX: 0.2, minY: 0.9, maxY: 1.25, speed: 4.0 }),
  }),
  xp: Object.freeze({
    color: 0xc084fc,
    leftText: '+',
    rightText: 'XP',
    digits: Object.freeze({ suffixShorten: true }),
    lifetime: 0.95,
    durationFadeIn: 0.14,
    durationFadeOut: 0.25,
    lerp: Object.freeze({ minX: -0.2, maxX: 0.2, minY: 0.9, maxY: 1.25, speed: 4.0 }),
  }),
});

const customPresets = new Map();

/**
 * Registers or overrides a named damage number preset for reuse across `popupNumber({ preset })`.
 * @param {string} name
 * @param {object} config
 */
export function registerDamagePreset(name, config) {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Preset name must be a non-empty string');
  }
  if (!config || typeof config !== 'object') {
    throw new TypeError('Preset config must be an object');
  }
  customPresets.set(name, Object.freeze({ ...config }));
}

/**
 * Retrieves a registered or built-in damage number preset by name.
 * @param {string} name
 * @returns {object | null}
 */
export function getDamagePreset(name) {
  if (!name || typeof name !== 'string') return null;
  return customPresets.get(name) ?? DAMAGE_NUMBER_PRESETS[name] ?? null;
}

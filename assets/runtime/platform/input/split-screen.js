/**
 * @typedef {object} SplitScreenOptions
 * @property {'auto' | 'vertical' | 'horizontal'} [direction='auto'] Two-player layout (`auto` picks by aspect ratio).
 * @property {number} [width=960] Surface width in pixels (used for `aspect`).
 * @property {number} [height=540] Surface height in pixels (used for `aspect`).
 * @property {readonly unknown[]} [cameras=[]] Camera object per view index.
 */

/**
 * @template [TCamera=unknown]
 * @typedef {object} SplitScreenView Normalized `[0..1]` top-left viewport.
 * @property {number} index
 * @property {string} playerId `'p1'`..`'p4'`.
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} aspect Pixel aspect ratio of this viewport.
 * @property {TCamera | null} camera
 */

/**
 * @template [TCamera=unknown]
 * @typedef {object} NormalizedSplitView
 * @property {number} index
 * @property {string | null} playerId
 * @property {TCamera} camera
 * @property {number} x Normalized 0..1.
 * @property {number} y Normalized 0..1.
 * @property {number} width Normalized 0..1.
 * @property {number} height Normalized 0..1.
 */

/**
 * @typedef {object} SplitViewInput
 * @property {number} [index]
 * @property {string | null} [playerId]
 * @property {object} camera Required camera object.
 * @property {number} [x=0] Normalized 0..1.
 * @property {number} [y=0]
 * @property {number} [width=1]
 * @property {number} [height=1]
 */

/**
 * @typedef {object} SplitViewOptions
 * @property {string} [dividerColor='rgba(255,255,255,0.22)'] CSS color.
 * @property {number} [dividerWidth=2] Pixels (>= 0).
 */

/**
 * @typedef {object} NormalizedSplitViews
 * @property {readonly NormalizedSplitView<object>[] | null} views Null when split-screen is off.
 * @property {string} dividerColor
 * @property {number} dividerWidth Pixels.
 */

/**
 * Computes normalized `[0..1]` top-left split-screen viewport descriptors
 * compatible with `canvas2d.setViews`, `webgl2d.setViews`, and `three.setViews`.
 *
 * @param {number} [playerCount=2] Integer 1..4.
 * @param {SplitScreenOptions} [options]
 * @returns {SplitScreenView[]}
 */
export function computeSplitScreenViews(playerCount = 2, {
  direction = 'auto',
  width = 960,
  height = 540,
  cameras = [],
} = {}) {
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 4) {
    throw new RangeError('computeSplitScreenViews supports playerCount in 1..4');
  }
  const safeW = Number.isFinite(width) && width > 0 ? width : 960;
  const safeH = Number.isFinite(height) && height > 0 ? height : 540;

  /** @type {{ x: number, y: number, width: number, height: number }[]} */
  let rects;
  if (playerCount === 1) {
    rects = [{ x: 0, y: 0, width: 1, height: 1 }];
  } else if (playerCount === 2) {
    const split = direction === 'auto' ? (safeW >= safeH ? 'vertical' : 'horizontal') : direction;
    if (split !== 'vertical' && split !== 'horizontal') {
      throw new RangeError('Split-screen direction must be "auto", "vertical", or "horizontal"');
    }
    rects = split === 'vertical'
      ? [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }]
      : [{ x: 0, y: 0, width: 1, height: 0.5 }, { x: 0, y: 0.5, width: 1, height: 0.5 }];
  } else if (playerCount === 3) {
    rects = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ];
  } else {
    rects = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ];
  }

  return rects.map((r, index) => ({
    index,
    playerId: `p${index + 1}`,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    aspect: (safeW * r.width) / Math.max(1, safeH * r.height),
    camera: Array.isArray(cameras) ? (cameras[index] ?? null) : null,
  }));
}

/**
 * Validates normalized `[0..1]` multi-viewport descriptors for `setViews(...)`.
 *
 * @param {readonly SplitViewInput[] | null | undefined} views
 * @param {SplitViewOptions} [options]
 * @returns {NormalizedSplitViews}
 */
export function normalizeSplitViews(views, {
  dividerColor = 'rgba(255,255,255,0.22)',
  dividerWidth = 2,
} = {}) {
  const safeDividerWidth = Number.isFinite(dividerWidth) && dividerWidth >= 0 ? dividerWidth : 0;
  if (views === null || views === undefined) {
    return { views: null, dividerColor, dividerWidth: safeDividerWidth };
  }
  if (!Array.isArray(views)) {
    throw new TypeError('setViews requires an array of view descriptors or null');
  }
  if (views.length === 0) {
    return { views: null, dividerColor, dividerWidth: safeDividerWidth };
  }
  const normalized = views.map((v, i) => {
    if (!v || !v.camera || typeof v.camera !== 'object') {
      throw new TypeError(`View at index ${i} requires a camera object`);
    }
    const x = Number(v.x ?? 0);
    const y = Number(v.y ?? 0);
    const width = Number(v.width ?? 1);
    const height = Number(v.height ?? 1);
    if (
      !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      x < -1e-6 || y < -1e-6 || width <= 0 || height <= 0 ||
      x + width > 1 + 1e-6 || y + height > 1 + 1e-6
    ) {
      throw new RangeError(`View rect at index ${i} must have finite positive dimensions within [0..1]`);
    }
    return Object.freeze({
      index: i,
      playerId: v.playerId ?? null,
      camera: v.camera,
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(1, width),
      height: Math.min(1, height),
    });
  });
  return { views: Object.freeze(normalized), dividerColor, dividerWidth: safeDividerWidth };
}

/**
 * Find the view containing a normalized point.
 * @template {{ x: number, y: number, width: number, height: number }} V
 * @param {readonly V[] | null | undefined} views
 * @param {number} nx Normalized x (0..1).
 * @param {number} ny Normalized y (0..1).
 * @param {number | null} [viewIndex] Force a view by index.
 * @returns {V | null} Falls back to the first view.
 */
export function pickSplitView(views, nx, ny, viewIndex = null) {
  if (!views || views.length === 0) return null;
  if (Number.isInteger(viewIndex)) {
    return views[viewIndex] ?? views[0];
  }
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    if (nx >= v.x - 1e-6 && nx <= v.x + v.width + 1e-6 &&
        ny >= v.y - 1e-6 && ny <= v.y + v.height + 1e-6) {
      return v;
    }
  }
  return views[0];
}

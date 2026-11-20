/** @typedef {'normal' | 'add'} BlendMode2D */
/** @typedef {{ x: number, y: number, width: number, height: number }} ClipRect2D A rectangle in normalized viewport coordinates. */
/** @typedef {{ layer: number, z: number, ySort: boolean }} DrawOrder2D */

/** @param {BlendMode2D} mode @returns {BlendMode2D} */
export function normalizeBlend2D(mode) {
  if (mode !== 'normal' && mode !== 'add') throw new RangeError('2D blend mode must be normal or add');
  return mode;
}

const clamp01 = value => Math.min(1, Math.max(0, value));

/** @param {ClipRect2D | null} rect @returns {Readonly<ClipRect2D> | null} */
export function normalizeClipRect2D(rect) {
  if (rect === null) return null;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new RangeError('2D clip rectangle requires finite bounds and nonnegative dimensions');
  }
  const left = clamp01(x), top = clamp01(y);
  const right = clamp01(x + width), bottom = clamp01(y + height);
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

/** @param {Readonly<ClipRect2D> | null} a @param {Readonly<ClipRect2D> | null} b */
export function sameClipRect2D(a, b) {
  return a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

/** @param {DrawOrder2D} a @param {DrawOrder2D} b */
function compareLayer(a, b) { return a.layer - b.layer || a.z - b.z; }

/**
 * Resolve stable layer, sublayer, and world Y order using reusable scratch.
 * All items sharing a layer and sublayer use depth when any one opts in.
 * @template {DrawOrder2D} T
 * @param {(item: T) => number} depthOf
 */
export function createDrawOrder2D(depthOf) {
  /** @type {T[]} */
  const ordered = [];
  /** @type {T[]} */
  const group = [];
  /** @type {(a: T, b: T) => number} */
  const compareDepth = (a, b) => depthOf(a) - depthOf(b);

  /** @param {T[]} items @param {number} count @param {boolean} sortLayers @param {boolean} sortDepth @returns {T[]} */
  function apply(items, count, sortLayers, sortDepth) {
    if (count < 2 || (!sortLayers && !sortDepth)) return items;
    let result = items;
    if (sortLayers) {
      for (let i = 0; i < count; i++) ordered[i] = items[i];
      ordered.length = count;
      ordered.sort(compareLayer);
      result = ordered;
    }
    if (!sortDepth) return result;
    for (let first = 0; first < count;) {
      const head = result[first];
      let last = first + 1;
      let enabled = head.ySort;
      let needsSort = false;
      while (last < count && compareLayer(head, result[last]) === 0) {
        enabled ||= result[last].ySort;
        needsSort ||= compareDepth(result[last - 1], result[last]) > 0;
        last++;
      }
      if (enabled && needsSort) {
        if (result === items) {
          for (let i = 0; i < count; i++) ordered[i] = items[i];
          ordered.length = count;
          result = ordered;
        }
        group.length = last - first;
        for (let i = first; i < last; i++) group[i - first] = result[i];
        group.sort(compareDepth);
        for (let i = first; i < last; i++) result[i] = group[i - first];
      }
      first = last;
    }
    group.length = 0;
    return result;
  }

  return { apply, clear() { ordered.length = 0; group.length = 0; } };
}

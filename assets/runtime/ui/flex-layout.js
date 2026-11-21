/**
 * Lightweight deterministic Flexbox-lite layout solver for 2D/Canvas/WebGL/HUD UI trees.
 * Runs headlessly in Node, Canvas2D, WebGL2D, or Three.js HUD overlays with zero DOM dependencies.
 */

function resolveSize(spec, available, fallback = 0) {
  if (typeof spec === 'number' && Number.isFinite(spec)) return Math.max(0, spec);
  if (typeof spec === 'string' && spec.endsWith('%')) {
    const pct = parseFloat(spec.slice(0, -1));
    if (Number.isFinite(pct)) return Math.max(0, (available * pct) / 100);
  }
  return fallback;
}

function clampDim(val, minSpec, maxSpec, available) {
  let out = Math.max(0, val);
  if (minSpec !== undefined && minSpec !== null) {
    out = Math.max(out, resolveSize(minSpec, available, 0));
  }
  if (maxSpec !== undefined && maxSpec !== null) {
    out = Math.min(out, resolveSize(maxSpec, available, Infinity));
  }
  return out;
}

function parsePadding(padding) {
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    const p = Math.max(0, padding);
    return { top: p, right: p, bottom: p, left: p };
  }
  if (Array.isArray(padding)) {
    const t = Math.max(0, Number(padding[0]) || 0);
    const r = Math.max(0, Number(padding[1] ?? t) || 0);
    const b = Math.max(0, Number(padding[2] ?? t) || 0);
    const l = Math.max(0, Number(padding[3] ?? r) || 0);
    return { top: t, right: r, bottom: b, left: l };
  }
  if (padding && typeof padding === 'object') {
    return {
      top: Math.max(0, Number(padding.top) || 0),
      right: Math.max(0, Number(padding.right) || 0),
      bottom: Math.max(0, Number(padding.bottom) || 0),
      left: Math.max(0, Number(padding.left) || 0),
    };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * @typedef {object} FlexLayoutNode
 * @property {string} [id]
 * @property {'row' | 'column'} [direction='column']
 * @property {'row' | 'column'} [flexDirection]
 * @property {number} [gap=0]
 * @property {number | number[] | { top?: number, right?: number, bottom?: number, left?: number }} [padding=0]
 * @property {'start' | 'center' | 'end' | 'stretch'} [alignItems='stretch']
 * @property {'start' | 'center' | 'end' | 'space-between' | 'space-around'} [justifyContent='start']
 * @property {number} [flexGrow=0]
 * @property {number} [flexShrink=1]
 * @property {number | string} [width]
 * @property {number | string} [height]
 * @property {number | string} [minWidth]
 * @property {number | string} [maxWidth]
 * @property {number | string} [minHeight]
 * @property {number | string} [maxHeight]
 * @property {FlexLayoutNode[]} [children]
 */

/**
 * @typedef {object} ComputedFlexRect
 * @property {string | null} id
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {ComputedFlexRect[]} children
 */

/**
 * Compute resolved pixel coordinates and sizes for a declarative Flex node tree.
 * @param {FlexLayoutNode} node
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @param {number} [offsetX=0]
 * @param {number} [offsetY=0]
 * @returns {ComputedFlexRect}
 */
export function computeFlexLayout(node, containerWidth, containerHeight, offsetX = 0, offsetY = 0) {
  const safeW = Math.max(0, Number(containerWidth) || 0);
  const safeH = Math.max(0, Number(containerHeight) || 0);
  const w = clampDim(
    node?.width !== undefined ? resolveSize(node.width, safeW, safeW) : safeW,
    node?.minWidth,
    node?.maxWidth,
    safeW,
  );
  const h = clampDim(
    node?.height !== undefined ? resolveSize(node.height, safeH, safeH) : safeH,
    node?.minHeight,
    node?.maxHeight,
    safeH,
  );

  const rawChildren = Array.isArray(node?.children) ? node.children : [];
  if (rawChildren.length === 0) {
    return { id: node?.id ?? null, x: offsetX, y: offsetY, width: w, height: h, children: [] };
  }

  const dir = (node.direction ?? node.flexDirection) === 'row' ? 'row' : 'column';
  const isRow = dir === 'row';
  const pad = parsePadding(node.padding);
  const gap = Math.max(0, Number(node.gap) || 0);
  const alignItems = node.alignItems ?? 'stretch';
  const justifyContent = node.justifyContent ?? 'start';

  const innerW = Math.max(0, w - pad.left - pad.right);
  const innerH = Math.max(0, h - pad.top - pad.bottom);
  const mainAvail = isRow ? innerW : innerH;
  const crossAvail = isRow ? innerH : innerW;
  const totalGap = gap * Math.max(0, rawChildren.length - 1);

  const measured = rawChildren.map(child => {
    const grow = Math.max(0, Number(child?.flexGrow) || 0);
    const shrink = Number.isFinite(child?.flexShrink) ? Math.max(0, Number(child.flexShrink)) : 1;
    const baseMain = isRow
      ? (child?.width !== undefined ? resolveSize(child.width, innerW, 0) : 0)
      : (child?.height !== undefined ? resolveSize(child.height, innerH, 0) : 0);
    const explicitCross = isRow ? child?.height : child?.width;
    const baseCross = explicitCross !== undefined
      ? resolveSize(explicitCross, crossAvail, crossAvail)
      : (alignItems === 'stretch' ? crossAvail : 0);
    return { child, grow, shrink, main: baseMain, cross: baseCross, hasExplicitCross: explicitCross !== undefined };
  });

  const usedBaseMain = measured.reduce((acc, m) => acc + m.main, 0) + totalGap;
  const freeSpace = mainAvail - usedBaseMain;

  if (freeSpace > 0) {
    const totalGrow = measured.reduce((acc, m) => acc + m.grow, 0);
    if (totalGrow > 0) {
      for (const m of measured) {
        if (m.grow > 0) m.main += (freeSpace * m.grow) / totalGrow;
      }
    }
  } else if (freeSpace < 0) {
    const overflow = -freeSpace;
    const weightedShrink = measured.reduce((acc, m) => acc + m.shrink * Math.max(1, m.main), 0);
    if (weightedShrink > 0) {
      for (const m of measured) {
        if (m.shrink > 0) {
          const share = (m.shrink * Math.max(1, m.main)) / weightedShrink;
          m.main = Math.max(0, m.main - overflow * share);
        }
      }
    }
  }

  for (const m of measured) {
    const minM = isRow ? m.child?.minWidth : m.child?.minHeight;
    const maxM = isRow ? m.child?.maxWidth : m.child?.maxHeight;
    const minC = isRow ? m.child?.minHeight : m.child?.minWidth;
    const maxC = isRow ? m.child?.maxHeight : m.child?.maxWidth;
    m.main = clampDim(m.main, minM, maxM, mainAvail);
    m.cross = clampDim(m.cross, minC, maxC, crossAvail);
  }

  const finalMainTotal = measured.reduce((acc, m) => acc + m.main, 0) + totalGap;
  const remainingMain = Math.max(0, mainAvail - finalMainTotal);

  let cursor = isRow ? offsetX + pad.left : offsetY + pad.top;
  let extraGap = gap;
  if (justifyContent === 'center') {
    cursor += remainingMain * 0.5;
  } else if (justifyContent === 'end') {
    cursor += remainingMain;
  } else if (justifyContent === 'space-between' && measured.length > 1) {
    extraGap = gap + remainingMain / (measured.length - 1);
  } else if (justifyContent === 'space-around' && measured.length > 0) {
    const step = remainingMain / measured.length;
    cursor += step * 0.5;
    extraGap = gap + step;
  }

  const computedChildren = [];
  for (const m of measured) {
    const childW = isRow ? m.main : m.cross;
    const childH = isRow ? m.cross : m.main;
    let crossOffset = 0;
    const freeCross = Math.max(0, crossAvail - m.cross);
    if (alignItems === 'center') crossOffset = freeCross * 0.5;
    else if (alignItems === 'end') crossOffset = freeCross;

    const childX = isRow ? cursor : offsetX + pad.left + crossOffset;
    const childY = isRow ? offsetY + pad.top + crossOffset : cursor;
    computedChildren.push(computeFlexLayout(m.child, childW, childH, childX, childY));
    cursor += m.main + extraGap;
  }

  return {
    id: node?.id ?? null,
    x: offsetX,
    y: offsetY,
    width: w,
    height: h,
    children: computedChildren,
  };
}

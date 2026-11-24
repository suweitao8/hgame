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
 * @property {number | string} [width] Percentage sizes resolve against the parent's inner size.
 * @property {number | string} [height]
 * @property {number | string} [minWidth]
 * @property {number | string} [maxWidth]
 * @property {number | string} [minHeight]
 * @property {number | string} [maxHeight]
 * @property {'nowrap' | 'wrap'} [flexWrap='nowrap'] Children that do not fit start a new line.
 * @property {'stretch' | 'start' | 'center' | 'end' | 'space-between' | 'space-around'} [alignContent='stretch'] Wrapped lines only; `stretch` gives every line an equal share of the spare cross size.
 * @property {'flex' | 'grid'} [display='flex'] `grid` places the children in equal cells across a fixed number of columns.
 * @property {number} [columns=4] Grid only: column count.
 * @property {number | string} [rowHeight] Grid only: fixed row height. Default shares the height between the rows.
 * @property {'start' | 'center' | 'end' | 'stretch'} [justifyItems='stretch'] Grid only: horizontal placement of a child that has its own `width`.
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
 * Compute resolved pixel coordinates and sizes for a declarative Flex or Grid node tree.
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
  return layoutResolved(node, safeW, safeH, offsetX, offsetY, safeW, safeH);
}

/**
 * Lays out `node` in the box `w × h` at (offsetX, offsetY). `baseW` / `baseH` are the inner size of
 * the parent, against which the node's own sizes and limits resolve.
 */
function layoutResolved(node, w, h, offsetX, offsetY, baseW, baseH) {
  w = clampDim(
    node?.width !== undefined ? resolveSize(node.width, baseW, baseW) : w,
    node?.minWidth,
    node?.maxWidth,
    baseW,
  );
  h = clampDim(
    node?.height !== undefined ? resolveSize(node.height, baseH, baseH) : h,
    node?.minHeight,
    node?.maxHeight,
    baseH,
  );
  const rawChildren = Array.isArray(node?.children) ? node.children : [];
  const rect = { id: node?.id ?? null, x: offsetX, y: offsetY, width: w, height: h, children: [] };
  if (rawChildren.length === 0) return rect;

  const pad = parsePadding(node.padding);
  const gap = Math.max(0, Number(node.gap) || 0);
  const innerW = Math.max(0, w - pad.left - pad.right);
  const innerH = Math.max(0, h - pad.top - pad.bottom);
  const originX = offsetX + pad.left;
  const originY = offsetY + pad.top;

  if (node?.display === 'grid') {
    rect.children = layoutGrid(node, rawChildren, { innerW, innerH, gap, originX, originY });
    return rect;
  }

  const isRow = (node.direction ?? node.flexDirection) === 'row';
  const alignItems = node.alignItems ?? 'stretch';
  const measured = measureFlexChildren(rawChildren, { isRow, innerW, innerH, alignItems });
  rect.children = node.flexWrap === 'wrap'
    ? layoutWrappedLines(measured, { isRow, innerW, innerH, gap, alignItems, justifyContent: node.justifyContent ?? 'start', alignContent: node.alignContent ?? 'stretch', originX, originY })
    : layoutSingleLine(measured, { isRow, innerW, innerH, gap, alignItems, justifyContent: node.justifyContent ?? 'start', originX, originY });
  return rect;
}

/** Resolves the base main and cross size of every child together with the constraints that clamp them. */
function measureFlexChildren(rawChildren, { isRow, innerW, innerH, alignItems }) {
  const mainAvail = isRow ? innerW : innerH;
  const crossAvail = isRow ? innerH : innerW;
  return rawChildren.map(child => {
    const grow = Math.max(0, Number(child?.flexGrow) || 0);
    const shrink = Number.isFinite(child?.flexShrink) ? Math.max(0, Number(child.flexShrink)) : 1;
    const baseMain = isRow
      ? (child?.width !== undefined ? resolveSize(child.width, innerW, 0) : 0)
      : (child?.height !== undefined ? resolveSize(child.height, innerH, 0) : 0);
    const explicitCross = isRow ? child?.height : child?.width;
    const hasExplicitCross = explicitCross !== undefined;
    return {
      child,
      grow,
      shrink,
      main: baseMain,
      cross: hasExplicitCross
        ? resolveSize(explicitCross, crossAvail, crossAvail)
        : (alignItems === 'stretch' ? crossAvail : 0),
      // What a wrapped line can be tall (or wide) without stretching.
      naturalCross: clampDim(hasExplicitCross ? resolveSize(explicitCross, crossAvail, crossAvail) : 0, isRow ? child?.minHeight : child?.minWidth, isRow ? child?.maxHeight : child?.maxWidth, crossAvail),
      minM: isRow ? child?.minWidth : child?.minHeight,
      maxM: isRow ? child?.maxWidth : child?.maxHeight,
      minC: isRow ? child?.minHeight : child?.minWidth,
      maxC: isRow ? child?.maxHeight : child?.maxWidth,
      hasExplicitCross,
    };
  });
}

/** Grows or shrinks `items` along the main axis so that they absorb `freeSpace` (negative when overflowing). */
function distributeFreeSpace(items, freeSpace) {
  if (freeSpace > 0) {
    const totalGrow = items.reduce((acc, m) => acc + m.grow, 0);
    if (totalGrow > 0) {
      for (const m of items) {
        if (m.grow > 0) m.main += (freeSpace * m.grow) / totalGrow;
      }
    }
  } else if (freeSpace < 0) {
    const overflow = -freeSpace;
    const weightedShrink = items.reduce((acc, m) => acc + m.shrink * Math.max(1, m.main), 0);
    if (weightedShrink > 0) {
      for (const m of items) {
        if (m.shrink > 0) {
          const share = (m.shrink * Math.max(1, m.main)) / weightedShrink;
          m.main = Math.max(0, m.main - overflow * share);
        }
      }
    }
  }
}

/** Where the first item starts and how much `justifyContent` adds to the gap between items. */
function resolveJustify(justifyContent, remainingMain, count) {
  if (justifyContent === 'center') return { offset: remainingMain * 0.5, extraGap: 0 };
  if (justifyContent === 'end') return { offset: remainingMain, extraGap: 0 };
  if (justifyContent === 'space-between' && count > 1) return { offset: 0, extraGap: remainingMain / (count - 1) };
  if (justifyContent === 'space-around' && count > 0) {
    const step = remainingMain / count;
    return { offset: step * 0.5, extraGap: step };
  }
  return { offset: 0, extraGap: 0 };
}

/** Positions one line of items and recurses into each child. */
function placeLine(items, { isRow, mainStart, crossStart, lineCross, gap, alignItems, justifyContent, mainAvail, innerW, innerH }) {
  const count = items.length;
  const used = items.reduce((acc, m) => acc + m.main, 0) + gap * Math.max(0, count - 1);
  const justify = resolveJustify(justifyContent, Math.max(0, mainAvail - used), count);
  let cursor = mainStart + justify.offset;
  const extraGap = gap + justify.extraGap;
  const out = [];
  for (const m of items) {
    const freeCross = Math.max(0, lineCross - m.cross);
    const crossOffset = alignItems === 'center' ? freeCross * 0.5 : (alignItems === 'end' ? freeCross : 0);
    const childW = isRow ? m.main : m.cross;
    const childH = isRow ? m.cross : m.main;
    const childX = isRow ? cursor : crossStart + crossOffset;
    const childY = isRow ? crossStart + crossOffset : cursor;
    out.push(layoutResolved(m.child, childW, childH, childX, childY, innerW, innerH));
    cursor += m.main + extraGap;
  }
  return out;
}

function layoutSingleLine(measured, { isRow, innerW, innerH, gap, alignItems, justifyContent, originX, originY }) {
  const mainAvail = isRow ? innerW : innerH;
  const crossAvail = isRow ? innerH : innerW;
  distributeFreeSpace(measured, mainAvail - (measured.reduce((acc, m) => acc + m.main, 0) + gap * Math.max(0, measured.length - 1)));

  for (const m of measured) {
    m.main = clampDim(m.main, m.minM, m.maxM, mainAvail);
    m.cross = clampDim(m.cross, m.minC, m.maxC, crossAvail);
  }
  return placeLine(measured, { isRow, mainStart: isRow ? originX : originY, crossStart: isRow ? originY : originX, lineCross: crossAvail, gap, alignItems, justifyContent, mainAvail, innerW, innerH });
}

/**
 * Flex `flexWrap: 'wrap'`: items fill a line until the next one would overflow it, then continue on
 * a new line. `flexGrow` and `flexShrink` act within a line, `justifyContent` positions the items of
 * each line and `alignContent` the lines themselves.
 */
function layoutWrappedLines(measured, { isRow, innerW, innerH, gap, alignItems, justifyContent, alignContent, originX, originY }) {
  const mainAvail = isRow ? innerW : innerH;
  const crossAvail = isRow ? innerH : innerW;

  // Lines break on the clamped base sizes, so an item wider than a line sits alone on its own.
  const lines = [];
  let line = { items: [], main: 0, cross: 0 };
  for (const m of measured) {
    m.main = clampDim(m.main, m.minM, m.maxM, mainAvail);
    if (line.items.length > 0 && line.main + gap + m.main > mainAvail + 1e-6) {
      lines.push(line);
      line = { items: [], main: 0, cross: 0 };
    }
    line.items.push(m);
    line.main += (line.items.length > 1 ? gap : 0) + m.main;
  }
  lines.push(line);

  let totalCross = 0;
  for (const entry of lines) {
    distributeFreeSpace(entry.items, mainAvail - entry.main);
    for (const m of entry.items) {
      m.main = clampDim(m.main, m.minM, m.maxM, mainAvail);
      entry.cross = Math.max(entry.cross, m.naturalCross);
    }
    totalCross += entry.cross;
  }

  // A line stretches by taking an equal share of the spare cross size, so one wrapped line fills the
  // container exactly like an unwrapped one.
  const spareCross = Math.max(0, crossAvail - totalCross - gap * Math.max(0, lines.length - 1));
  let lineStart = isRow ? originY : originX;
  let lineGap = gap;
  if (alignContent === 'stretch') {
    for (const entry of lines) entry.cross += spareCross / lines.length;
  } else if (alignContent === 'center') {
    lineStart += spareCross * 0.5;
  } else if (alignContent === 'end') {
    lineStart += spareCross;
  } else if (alignContent === 'space-between' && lines.length > 1) {
    lineGap = gap + spareCross / (lines.length - 1);
  } else if (alignContent === 'space-around' && lines.length > 0) {
    const step = spareCross / lines.length;
    lineStart += step * 0.5;
    lineGap = gap + step;
  }

  const children = [];
  for (const entry of lines) {
    for (const m of entry.items) {
      m.cross = m.hasExplicitCross || alignItems !== 'stretch'
        ? m.naturalCross
        : clampDim(entry.cross, m.minC, m.maxC, crossAvail);
    }
    children.push(...placeLine(entry.items, { isRow, mainStart: isRow ? originX : originY, crossStart: lineStart, lineCross: entry.cross, gap, alignItems, justifyContent, mainAvail, innerW, innerH }));
    lineStart += entry.cross + lineGap;
  }
  return children;
}

/**
 * `display: 'grid'`: children fill equal cells row by row across `columns` columns. A child keeps
 * the cell size unless it has its own `width` / `height`, which `justifyItems` / `alignItems` place
 * inside the cell.
 */
function layoutGrid(node, rawChildren, { innerW, innerH, gap, originX, originY }) {
  const columns = Math.max(1, Math.floor(Number(node?.columns) || 4));
  const rows = Math.max(1, Math.ceil(rawChildren.length / columns));
  const cellW = Math.max(0, (innerW - gap * (columns - 1)) / columns);
  const cellH = node?.rowHeight !== undefined
    ? clampDim(resolveSize(node.rowHeight, innerH, innerH), undefined, undefined, innerH)
    : Math.max(0, (innerH - gap * (rows - 1)) / rows);
  const justifyItems = node?.justifyItems ?? 'stretch';
  const alignItems = node?.alignItems ?? 'stretch';

  return rawChildren.map((child, index) => {
    const cellX = originX + (index % columns) * (cellW + gap);
    const cellY = originY + Math.floor(index / columns) * (cellH + gap);
    const childW = clampDim(
      child?.width !== undefined ? resolveSize(child.width, innerW, 0) : cellW,
      child?.minWidth,
      child?.maxWidth,
      innerW,
    );
    const childH = clampDim(
      child?.height !== undefined ? resolveSize(child.height, innerH, 0) : cellH,
      child?.minHeight,
      child?.maxHeight,
      innerH,
    );
    return layoutResolved(
      child,
      childW,
      childH,
      cellX + (justifyItems === 'center' ? (cellW - childW) * 0.5 : (justifyItems === 'end' ? cellW - childW : 0)),
      cellY + (alignItems === 'center' ? (cellH - childH) * 0.5 : (alignItems === 'end' ? cellH - childH : 0)),
      innerW,
      innerH,
    );
  });
}

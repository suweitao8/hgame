/**
 * @typedef {object} VirtualListOptions
 * @property {number} [itemHeight=48] Default row height (or cell height when columns > 1) in pixels.
 * @property {number} [columns=1] Number of grid columns per row (>= 1).
 * @property {number} [viewportHeight=320] Visible viewport height in pixels.
 * @property {number} [overscan=2] Extra rows rendered above and below the viewport.
 * @property {(index: number) => number} [getItemHeight] Optional variable-height callback (valid when columns === 1).
 * @property {number} [gap=0] Vertical gap in pixels between rows.
 */

/**
 * @typedef {object} VirtualVisibleRange
 * @property {number} startIndex Inclusive item index.
 * @property {number} endIndex Exclusive item index.
 * @property {number} startRow Inclusive row index.
 * @property {number} endRow Exclusive row index.
 * @property {number} offsetY Top pixel offset of startRow.
 * @property {number} totalHeight Total scrollable content height in pixels.
 * @property {number} scrollTop Clamped scroll offset in pixels.
 */

/**
 * Zero-allocation virtualized viewport window for large inventories, logs, leaderboards, and gacha histories.
 * Supports both fixed-height grids and variable-height single-column lists.
 * @param {VirtualListOptions} [options={}]
 */
export function createVirtualList(options = {}) {
  const defaultItemHeight = Number.isFinite(options.itemHeight) && options.itemHeight > 0 ? options.itemHeight : 48;
  const columns = Number.isInteger(options.columns) && options.columns >= 1 ? options.columns : 1;
  const overscan = Number.isInteger(options.overscan) && options.overscan >= 0 ? options.overscan : 2;
  const gap = Number.isFinite(options.gap) && options.gap >= 0 ? options.gap : 0;
  const variableHeightFn = columns === 1 && typeof options.getItemHeight === 'function' ? options.getItemHeight : null;

  let viewportHeight = Number.isFinite(options.viewportHeight) && options.viewportHeight >= 0 ? options.viewportHeight : 320;
  let totalCount = 0;
  let scrollTop = 0;
  /** @type {readonly unknown[] | null} */
  let itemsRef = null;
  /** @type {Float64Array} Prefix sums of item bottom Y coordinates when variableHeightFn is active. */
  let prefixBottoms = new Float64Array(0);
  let totalHeight = 0;

  /** @type {VirtualVisibleRange} */
  const scratchRange = {
    startIndex: 0,
    endIndex: 0,
    startRow: 0,
    endRow: 0,
    offsetY: 0,
    totalHeight: 0,
    scrollTop: 0,
  };

  function rowCount() {
    return totalCount === 0 ? 0 : Math.ceil(totalCount / columns);
  }

  function rebuildLayout() {
    const rows = rowCount();
    if (rows === 0) {
      totalHeight = 0;
      scrollTop = 0;
      return;
    }
    if (!variableHeightFn) {
      totalHeight = rows * defaultItemHeight + Math.max(0, rows - 1) * gap;
    } else {
      if (prefixBottoms.length < totalCount) {
        prefixBottoms = new Float64Array(Math.max(totalCount, prefixBottoms.length * 2 || 64));
      }
      let y = 0;
      for (let i = 0; i < totalCount; i++) {
        const h = variableHeightFn(i);
        const safeH = Number.isFinite(h) && h > 0 ? h : defaultItemHeight;
        y += safeH;
        prefixBottoms[i] = y;
        if (i < totalCount - 1) y += gap;
      }
      totalHeight = y;
    }
    clampScroll();
  }

  function clampScroll() {
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    if (scrollTop < 0) scrollTop = 0;
    else if (scrollTop > maxScroll) scrollTop = maxScroll;
  }

  function setCount(count) {
    const next = Number.isInteger(count) && count >= 0 ? count : 0;
    totalCount = next;
    rebuildLayout();
  }

  function setItems(items) {
    itemsRef = Array.isArray(items) ? items : null;
    setCount(itemsRef ? itemsRef.length : 0);
  }

  function setViewportSize(heightPx) {
    if (!Number.isFinite(heightPx) || heightPx < 0) {
      throw new TypeError('viewportHeight must be a non-negative number.');
    }
    viewportHeight = heightPx;
    clampScroll();
  }

  function scrollTo(offsetPx) {
    scrollTop = Number.isFinite(offsetPx) ? offsetPx : 0;
    clampScroll();
    return scrollTop;
  }

  function scrollBy(deltaPx) {
    return scrollTo(scrollTop + (Number.isFinite(deltaPx) ? deltaPx : 0));
  }

  function getRowOffset(row) {
    if (row <= 0) return 0;
    if (!variableHeightFn) return row * (defaultItemHeight + gap);
    return prefixBottoms[row - 1] + gap;
  }

  function getRowHeight(row) {
    if (!variableHeightFn) return defaultItemHeight;
    const top = row === 0 ? 0 : prefixBottoms[row - 1] + gap;
    return prefixBottoms[row] - top;
  }

  function findRowAtY(y) {
    const rows = rowCount();
    if (rows === 0) return 0;
    if (!variableHeightFn) {
      const stride = defaultItemHeight + gap;
      return Math.max(0, Math.min(rows - 1, Math.floor(y / stride)));
    }
    let lo = 0;
    let hi = rows - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (prefixBottoms[mid] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * @param {number} index
   * @param {'nearest' | 'start' | 'center' | 'end'} [align='nearest']
   */
  function scrollToIndex(index, align = 'nearest') {
    if (totalCount === 0) return 0;
    const clamped = Math.max(0, Math.min(totalCount - 1, Math.floor(index)));
    const row = Math.floor(clamped / columns);
    const rowTop = getRowOffset(row);
    const rowH = getRowHeight(row);
    const rowBottom = rowTop + rowH;

    if (align === 'start') {
      return scrollTo(rowTop);
    }
    if (align === 'end') {
      return scrollTo(rowBottom - viewportHeight);
    }
    if (align === 'center') {
      return scrollTo(rowTop - (viewportHeight - rowH) * 0.5);
    }
    if (rowTop < scrollTop) return scrollTo(rowTop);
    if (rowBottom > scrollTop + viewportHeight) return scrollTo(rowBottom - viewportHeight);
    return scrollTop;
  }

  /**
   * Computes visible index window into `out` (or internal scratch object) without heap allocation.
   * @param {VirtualVisibleRange} [out=scratchRange]
   * @returns {VirtualVisibleRange}
   */
  function getVisibleRange(out = scratchRange) {
    const rows = rowCount();
    if (rows === 0) {
      out.startIndex = 0;
      out.endIndex = 0;
      out.startRow = 0;
      out.endRow = 0;
      out.offsetY = 0;
      out.totalHeight = 0;
      out.scrollTop = 0;
      return out;
    }

    const firstVisibleRow = findRowAtY(scrollTop);
    const lastVisibleRow = findRowAtY(Math.max(0, scrollTop + viewportHeight - 1e-3));
    const startRow = Math.max(0, firstVisibleRow - overscan);
    const endRow = Math.min(rows, lastVisibleRow + 1 + overscan);

    out.startRow = startRow;
    out.endRow = endRow;
    out.startIndex = startRow * columns;
    out.endIndex = Math.min(totalCount, endRow * columns);
    out.offsetY = getRowOffset(startRow);
    out.totalHeight = totalHeight;
    out.scrollTop = scrollTop;
    return out;
  }

  /**
   * Attaches pooled row DOM elements inside a scrollable viewport element.
   * @param {{ viewportEl: HTMLElement, contentEl: HTMLElement, createRow: () => HTMLElement, renderItem: (el: HTMLElement, index: number, item: unknown) => void }} domOpts
   */
  function attachDom(domOpts) {
    const { viewportEl, contentEl, createRow, renderItem } = domOpts;
    if (!viewportEl || !contentEl || typeof createRow !== 'function' || typeof renderItem !== 'function') {
      throw new TypeError('attachDom requires viewportEl, contentEl, createRow, and renderItem.');
    }
    const pool = [];

    const refresh = () => {
      if (viewportEl.clientHeight > 0 && viewportEl.clientHeight !== viewportHeight) {
        setViewportSize(viewportEl.clientHeight);
      }
      contentEl.style.position = 'relative';
      contentEl.style.height = `${totalHeight}px`;

      const range = getVisibleRange();
      const needed = range.endIndex - range.startIndex;
      while (pool.length < needed) {
        const el = createRow();
        el.style.position = 'absolute';
        contentEl.appendChild(el);
        pool.push(el);
      }
      for (let i = 0; i < pool.length; i++) {
        const el = pool[i];
        if (i >= needed) {
          el.hidden = true;
          continue;
        }
        const itemIndex = range.startIndex + i;
        const row = Math.floor(itemIndex / columns);
        const col = itemIndex % columns;
        const y = getRowOffset(row);
        const h = getRowHeight(row);
        el.hidden = false;
        el.style.top = `${y}px`;
        el.style.height = `${h}px`;
        if (columns > 1) {
          el.style.width = `${100 / columns}%`;
          el.style.left = `${(col * 100) / columns}%`;
        } else {
          el.style.width = '100%';
          el.style.left = '0';
        }
        renderItem(el, itemIndex, itemsRef ? itemsRef[itemIndex] : undefined);
      }
    };

    const onScroll = () => {
      scrollTo(viewportEl.scrollTop);
      refresh();
    };
    viewportEl.addEventListener?.('scroll', onScroll);
    refresh();

    return {
      refresh,
      dispose() {
        viewportEl.removeEventListener?.('scroll', onScroll);
        for (const el of pool) el.remove?.();
        pool.length = 0;
      },
    };
  }

  return Object.freeze({
    setCount,
    setItems,
    setViewportSize,
    scrollTo,
    scrollBy,
    scrollToIndex,
    getVisibleRange,
    getTotalCount: () => totalCount,
    getTotalHeight: () => totalHeight,
    getScrollTop: () => scrollTop,
    getViewportHeight: () => viewportHeight,
    attachDom,
  });
}

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
export function createVirtualList(options?: VirtualListOptions): Readonly<{
    setCount: (count: any) => void;
    setItems: (items: any) => void;
    setViewportSize: (heightPx: any) => void;
    scrollTo: (offsetPx: any) => number;
    scrollBy: (deltaPx: any) => number;
    scrollToIndex: (index: number, align?: "nearest" | "start" | "center" | "end") => number;
    getVisibleRange: (out?: VirtualVisibleRange) => VirtualVisibleRange;
    getTotalCount: () => number;
    getTotalHeight: () => number;
    getScrollTop: () => number;
    getViewportHeight: () => number;
    attachDom: (domOpts: {
        viewportEl: HTMLElement;
        contentEl: HTMLElement;
        createRow: () => HTMLElement;
        renderItem: (el: HTMLElement, index: number, item: unknown) => void;
    }) => {
        refresh: () => void;
        dispose(): void;
    };
}>;
export type VirtualListOptions = {
    /**
     * Default row height (or cell height when columns > 1) in pixels.
     */
    itemHeight?: number;
    /**
     * Number of grid columns per row (>= 1).
     */
    columns?: number;
    /**
     * Visible viewport height in pixels.
     */
    viewportHeight?: number;
    /**
     * Extra rows rendered above and below the viewport.
     */
    overscan?: number;
    /**
     * Optional variable-height callback (valid when columns === 1).
     */
    getItemHeight?: (index: number) => number;
    /**
     * Vertical gap in pixels between rows.
     */
    gap?: number;
};
export type VirtualVisibleRange = {
    /**
     * Inclusive item index.
     */
    startIndex: number;
    /**
     * Exclusive item index.
     */
    endIndex: number;
    /**
     * Inclusive row index.
     */
    startRow: number;
    /**
     * Exclusive row index.
     */
    endRow: number;
    /**
     * Top pixel offset of startRow.
     */
    offsetY: number;
    /**
     * Total scrollable content height in pixels.
     */
    totalHeight: number;
    /**
     * Clamped scroll offset in pixels.
     */
    scrollTop: number;
};

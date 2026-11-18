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
/** @typedef {'nearest' | 'start' | 'center' | 'end'} VirtualListAlignment */
/**
 * Zero-allocation virtualized viewport window for large inventories, logs, leaderboards, and gacha histories.
 * Supports both fixed-height grids and variable-height single-column lists.
 * @param {VirtualListOptions} [options={}]
 */
export function createVirtualList(options?: VirtualListOptions | undefined): Readonly<{
    setCount: (count: any) => void;
    setItems: (items: any) => void;
    setViewportSize: (heightPx: any) => void;
    scrollTo: (offsetPx: any) => number;
    scrollBy: (deltaPx: any) => number;
    scrollToIndex: (index: number, align?: VirtualListAlignment | undefined) => number;
    getVisibleRange: (out?: VirtualVisibleRange | undefined) => VirtualVisibleRange;
    getTotalCount: () => number;
    getTotalHeight: () => number;
    getScrollTop: () => number;
    getViewportHeight: () => number | undefined;
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
    itemHeight?: number | undefined;
    /**
     * Number of grid columns per row (>= 1).
     */
    columns?: number | undefined;
    /**
     * Visible viewport height in pixels.
     */
    viewportHeight?: number | undefined;
    /**
     * Extra rows rendered above and below the viewport.
     */
    overscan?: number | undefined;
    /**
     * Optional variable-height callback (valid when columns === 1).
     */
    getItemHeight?: ((index: number) => number) | undefined;
    /**
     * Vertical gap in pixels between rows.
     */
    gap?: number | undefined;
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
export type VirtualListAlignment = "nearest" | "start" | "center" | "end";

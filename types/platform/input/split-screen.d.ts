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
export function computeSplitScreenViews(playerCount?: number | undefined, { direction, width, height, cameras, }?: SplitScreenOptions | undefined): SplitScreenView[];
/**
 * Validates normalized `[0..1]` multi-viewport descriptors for `setViews(...)`.
 *
 * @param {readonly SplitViewInput[] | null | undefined} views
 * @param {SplitViewOptions} [options]
 * @returns {NormalizedSplitViews}
 */
export function normalizeSplitViews(views: readonly SplitViewInput[] | null | undefined, { dividerColor, dividerWidth, }?: SplitViewOptions | undefined): NormalizedSplitViews;
/**
 * Find the view containing a normalized point.
 * @template {{ x: number, y: number, width: number, height: number }} V
 * @param {readonly V[] | null | undefined} views
 * @param {number} nx Normalized x (0..1).
 * @param {number} ny Normalized y (0..1).
 * @param {number | null} [viewIndex] Force a view by index.
 * @returns {V | null} Falls back to the first view.
 */
export function pickSplitView<V extends {
    x: number;
    y: number;
    width: number;
    height: number;
}>(views: readonly V[] | null | undefined, nx: number, ny: number, viewIndex?: number | null | undefined): V | null;
export type SplitScreenOptions = {
    /**
     * Two-player layout (`auto` picks by aspect ratio).
     */
    direction?: "auto" | "vertical" | "horizontal" | undefined;
    /**
     * Surface width in pixels (used for `aspect`).
     */
    width?: number | undefined;
    /**
     * Surface height in pixels (used for `aspect`).
     */
    height?: number | undefined;
    /**
     * Camera object per view index.
     */
    cameras?: readonly unknown[] | undefined;
};
/**
 * Normalized `[0..1]` top-left viewport.
 */
export type SplitScreenView<TCamera = unknown> = {
    index: number;
    /**
     * `'p1'`..`'p4'`.
     */
    playerId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * Pixel aspect ratio of this viewport.
     */
    aspect: number;
    camera: TCamera | null;
};
export type NormalizedSplitView<TCamera = unknown> = {
    index: number;
    playerId: string | null;
    camera: TCamera;
    /**
     * Normalized 0..1.
     */
    x: number;
    /**
     * Normalized 0..1.
     */
    y: number;
    /**
     * Normalized 0..1.
     */
    width: number;
    /**
     * Normalized 0..1.
     */
    height: number;
};
export type SplitViewInput = {
    index?: number | undefined;
    playerId?: string | null | undefined;
    /**
     * Required camera object.
     */
    camera: object;
    /**
     * Normalized 0..1.
     */
    x?: number | undefined;
    y?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
};
export type SplitViewOptions = {
    /**
     * CSS color.
     */
    dividerColor?: string | undefined;
    /**
     * Pixels (>= 0).
     */
    dividerWidth?: number | undefined;
};
export type NormalizedSplitViews = {
    /**
     * Null when split-screen is off.
     */
    views: readonly NormalizedSplitView<object>[] | null;
    dividerColor: string;
    /**
     * Pixels.
     */
    dividerWidth: number;
};

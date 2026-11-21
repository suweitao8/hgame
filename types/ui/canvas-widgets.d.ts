/**
 * Render sharp multi-scale typography onto a Canvas2D context using an SDF glyph atlas when
 * provided (`atlas: { image, glyphSize, scale, glyphs: Record<string, { x, y, w, h, advance }> }`),
 * or supersampled HiDPI outlined vector text fallback otherwise.
 *
 * @param {any} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {object} [options]
 * @param {number} [options.fontSize=14]
 * @param {string} [options.color='#f8fafc']
 * @param {string} [options.outlineColor='rgba(2, 6, 23, 0.85)']
 * @param {number} [options.outlineWidth=2.5]
 * @param {string | null} [options.shadowColor=null]
 * @param {string} [options.fontFamily='system-ui, sans-serif']
 * @param {string} [options.weight='600']
 * @param {string} [options.align='left']
 * @param {string} [options.baseline='middle']
 * @param {number} [options.dpr=1]
 * @param {any} [options.atlas=null]
 */
export function renderSdfText(ctx: any, text: string, x: number, y: number, { fontSize, color, outlineColor, outlineWidth, shadowColor, fontFamily, weight, align, baseline, dpr, atlas, }?: {
    fontSize?: number | undefined;
    color?: string | undefined;
    outlineColor?: string | undefined;
    outlineWidth?: number | undefined;
    shadowColor?: string | null | undefined;
    fontFamily?: string | undefined;
    weight?: string | undefined;
    align?: string | undefined;
    baseline?: string | undefined;
    dpr?: number | undefined;
    atlas?: any;
} | undefined): boolean;
/**
 * Lay out styled rich-text spans (`string | { text, color?, fontSize?, weight?, italic?, outlineColor?, outlineWidth?, underline? }`)
 * into wrapped visual lines constrained by `maxWidth`, breaking on CJK character boundaries and ASCII word boundaries.
 *
 * @param {any} ctx
 * @param {string | Array<string | { text?: string, color?: string, fontSize?: number, weight?: string | number, italic?: boolean, outlineColor?: string, outlineWidth?: number, underline?: boolean }>} spans
 * @param {number} maxWidth
 * @param {object} [defaultOpts]
 * @returns {{ segments: { text: string, style: Record<string, any>, width: number, fontSize: number }[], width: number, height: number }[]}
 */
export function layoutRichTextLines(ctx: any, spans: string | Array<string | {
    text?: string;
    color?: string;
    fontSize?: number;
    weight?: string | number;
    italic?: boolean;
    outlineColor?: string;
    outlineWidth?: number;
    underline?: boolean;
}>, maxWidth: number, defaultOpts?: object): {
    segments: {
        text: string;
        style: Record<string, any>;
        width: number;
        fontSize: number;
    }[];
    width: number;
    height: number;
}[];
/**
 * Create a visually-hidden semantic DOM ARIA mirror for a Canvas UI tree so screen
 * readers and keyboard navigation can inspect and activate buttons, inputs, sliders,
 * scroll regions, and rich-text/label nodes without shifting canvas layout.
 *
 * @param {any} container Host DOM element receiving the visually-hidden ARIA container.
 * @returns {{ sync: (hitNodes: readonly any[], widgetState?: any) => number, getElementCount: () => number, getRoot: () => any, dispose: () => boolean }}
 */
export function createCanvasAriaBridge(container: any): {
    sync: (hitNodes: readonly any[], widgetState?: any) => number;
    getElementCount: () => number;
    getRoot: () => any;
    dispose: () => boolean;
};
/**
 * @param {object} [options]
 * @param {string} [options.fontFamily='system-ui, sans-serif']
 * @param {number} [options.dpr=1]
 */
export function createCanvasUiRenderer({ fontFamily, dpr, }?: {
    fontFamily?: string | undefined;
    dpr?: number | undefined;
} | undefined): Readonly<{
    layout: (tree: any, width: any, height: any) => import("./flex-layout.js").ComputedFlexRect;
    render: (ctx: any, tree: any, width: any, height: any) => import("./flex-layout.js").ComputedFlexRect;
    hitTest: (px: any, py: any) => {
        id: string;
        node: object;
        rect: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        scrollParentId?: string | null;
        clipRect?: {
            x: number;
            y: number;
            width: number;
            height: number;
        } | null;
    } | null;
    pointerMove: (px: any, py: any) => null;
    pointerDown: (px: any, py: any) => {
        id: string;
        node: object;
        rect: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        scrollParentId?: string | null;
        clipRect?: {
            x: number;
            y: number;
            width: number;
            height: number;
        } | null;
    } | null;
    pointerUp: (px: any, py: any) => string | null;
    keyDown: (key: any) => boolean;
    compositionUpdate: (text: any) => boolean;
    compositionEnd: (text: any) => boolean;
    scroll: (deltaY: any, px: any, py: any) => number;
    syncAriaTree: (container?: any) => any;
    dispose: () => void;
    getState: () => {
        hoveredId: null;
        pressedId: null;
        focusedId: null;
        composingText: string;
        hitCount: number;
    };
}>;

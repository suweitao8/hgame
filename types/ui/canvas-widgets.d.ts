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
    } | null;
    pointerUp: (px: any, py: any) => string | null;
    keyDown: (key: any) => boolean;
    scroll: (deltaY: any, px: any, py: any) => number;
    getState: () => {
        hoveredId: null;
        pressedId: null;
        focusedId: null;
        hitCount: number;
    };
}>;

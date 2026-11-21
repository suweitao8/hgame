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
    scroll: (deltaY: any, px: any, py: any) => number;
    getState: () => {
        hoveredId: null;
        pressedId: null;
        focusedId: null;
        hitCount: number;
    };
}>;

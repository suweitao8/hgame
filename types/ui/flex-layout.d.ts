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
export function computeFlexLayout(node: FlexLayoutNode, containerWidth: number, containerHeight: number, offsetX?: number | undefined, offsetY?: number | undefined): ComputedFlexRect;
export type FlexLayoutNode = {
    id?: string | undefined;
    direction?: "column" | "row" | undefined;
    flexDirection?: "column" | "row" | undefined;
    gap?: number | undefined;
    padding?: number | number[] | {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    } | undefined;
    alignItems?: "start" | "stretch" | "end" | "center" | undefined;
    justifyContent?: "start" | "end" | "center" | "space-between" | "space-around" | undefined;
    flexGrow?: number | undefined;
    flexShrink?: number | undefined;
    width?: string | number | undefined;
    height?: string | number | undefined;
    minWidth?: string | number | undefined;
    maxWidth?: string | number | undefined;
    minHeight?: string | number | undefined;
    maxHeight?: string | number | undefined;
    children?: FlexLayoutNode[] | undefined;
};
export type ComputedFlexRect = {
    id: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    children: ComputedFlexRect[];
};

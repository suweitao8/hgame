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
    alignItems?: "center" | "start" | "stretch" | "end" | undefined;
    justifyContent?: "center" | "start" | "end" | "space-between" | "space-around" | undefined;
    flexGrow?: number | undefined;
    flexShrink?: number | undefined;
    /**
     * Percentage sizes resolve against the parent's inner size.
     */
    width?: string | number | undefined;
    height?: string | number | undefined;
    minWidth?: string | number | undefined;
    maxWidth?: string | number | undefined;
    minHeight?: string | number | undefined;
    maxHeight?: string | number | undefined;
    /**
     * Children that do not fit start a new line.
     */
    flexWrap?: "nowrap" | "wrap" | undefined;
    /**
     * Wrapped lines only; `stretch` gives every line an equal share of the spare cross size.
     */
    alignContent?: "center" | "start" | "stretch" | "end" | "space-between" | "space-around" | undefined;
    /**
     * `grid` places the children in equal cells across a fixed number of columns.
     */
    display?: "flex" | "grid" | undefined;
    /**
     * Grid only: column count.
     */
    columns?: number | undefined;
    /**
     * Grid only: fixed row height. Default shares the height between the rows.
     */
    rowHeight?: string | number | undefined;
    /**
     * Grid only: horizontal placement of a child that has its own `width`.
     */
    justifyItems?: "center" | "start" | "stretch" | "end" | undefined;
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

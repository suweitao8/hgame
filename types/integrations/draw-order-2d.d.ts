/** @typedef {'normal' | 'add'} BlendMode2D */
/** @typedef {{ x: number, y: number, width: number, height: number }} ClipRect2D A rectangle in normalized viewport coordinates. */
/** @typedef {{ layer: number, z: number, ySort: boolean }} DrawOrder2D */
/** @param {BlendMode2D} mode @returns {BlendMode2D} */
export function normalizeBlend2D(mode: BlendMode2D): BlendMode2D;
/** @param {ClipRect2D | null} rect @returns {Readonly<ClipRect2D> | null} */
export function normalizeClipRect2D(rect: ClipRect2D | null): Readonly<ClipRect2D> | null;
/** @param {Readonly<ClipRect2D> | null} a @param {Readonly<ClipRect2D> | null} b */
export function sameClipRect2D(a: Readonly<ClipRect2D> | null, b: Readonly<ClipRect2D> | null): boolean;
/**
 * Resolve stable layer, sublayer, and world Y order using reusable scratch.
 * All items sharing a layer and sublayer use depth when any one opts in.
 * @template {DrawOrder2D} T
 * @param {(item: T) => number} depthOf
 */
export function createDrawOrder2D<T extends DrawOrder2D>(depthOf: (item: T) => number): {
    apply: (items: T[], count: number, sortLayers: boolean, sortDepth: boolean) => T[];
    clear(): void;
};
export type BlendMode2D = "normal" | "add";
/**
 * A rectangle in normalized viewport coordinates.
 */
export type ClipRect2D = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type DrawOrder2D = {
    layer: number;
    z: number;
    ySort: boolean;
};

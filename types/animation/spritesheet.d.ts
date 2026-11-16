/**
 * @typedef {object} SpriteSheetImage Anything with pixel dimensions (HTMLImageElement, ImageBitmap, canvas).
 * @property {number} width Pixels.
 * @property {number} height Pixels.
 */
/**
 * @typedef {object} SpriteSheetOptions
 * @property {SpriteSheetImage} image Source image.
 * @property {number} frameWidth Cell width in pixels (> 0).
 * @property {number} frameHeight Cell height in pixels (> 0).
 * @property {number} [margin=0] Outer margin, pixels.
 * @property {number} [spacing=0] Gap between cells, pixels.
 * @property {number} [inset=0] Per-cell inset against bleeding, pixels (< half a cell).
 */
/**
 * @typedef {object} SpriteSheetGridOptions
 * @property {number} [columns=3] Integer >= 1.
 * @property {number} [rows=columns] Integer >= 1.
 * @property {number} [margin=0] Pixels.
 * @property {number} [spacing=0] Pixels.
 * @property {number} [inset=0] Pixels.
 */
/**
 * @typedef {object} SpriteFrameRect Source rectangle in pixels.
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */
/** Coordinates within a packed uniform-cell sprite sheet. */
export class SpriteSheet {
    /**
     * Builds a SpriteSheet directly from uniform grid divisions (e.g. 2x2 or 3x3).
     * @param {SpriteSheetImage} image
     * @param {SpriteSheetGridOptions} [options]
     * @returns {SpriteSheet}
     */
    static fromGrid(image: SpriteSheetImage, { columns, rows, margin, spacing, inset }?: SpriteSheetGridOptions | undefined): SpriteSheet;
    /** @param {SpriteSheetOptions} options */
    constructor({ image, frameWidth, frameHeight, margin, spacing, inset }?: SpriteSheetOptions);
    /** @type {SpriteSheetImage} */
    image: SpriteSheetImage;
    frameWidth: number;
    frameHeight: number;
    margin: number;
    spacing: number;
    inset: number;
    columns: number;
    rows: number;
    length: number;
    /**
     * Source rectangle of a frame (row-major order).
     * @param {number} index Integer 0..length-1.
     * @returns {SpriteFrameRect}
     */
    frame(index: number): SpriteFrameRect;
}
/**
 * Anything with pixel dimensions (HTMLImageElement, ImageBitmap, canvas).
 */
export type SpriteSheetImage = {
    /**
     * Pixels.
     */
    width: number;
    /**
     * Pixels.
     */
    height: number;
};
export type SpriteSheetOptions = {
    /**
     * Source image.
     */
    image: SpriteSheetImage;
    /**
     * Cell width in pixels (> 0).
     */
    frameWidth: number;
    /**
     * Cell height in pixels (> 0).
     */
    frameHeight: number;
    /**
     * Outer margin, pixels.
     */
    margin?: number | undefined;
    /**
     * Gap between cells, pixels.
     */
    spacing?: number | undefined;
    /**
     * Per-cell inset against bleeding, pixels (< half a cell).
     */
    inset?: number | undefined;
};
export type SpriteSheetGridOptions = {
    /**
     * Integer >= 1.
     */
    columns?: number | undefined;
    /**
     * Integer >= 1.
     */
    rows?: number | undefined;
    /**
     * Pixels.
     */
    margin?: number | undefined;
    /**
     * Pixels.
     */
    spacing?: number | undefined;
    /**
     * Pixels.
     */
    inset?: number | undefined;
};
/**
 * Source rectangle in pixels.
 */
export type SpriteFrameRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

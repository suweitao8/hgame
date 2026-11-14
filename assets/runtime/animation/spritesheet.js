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
  /** @param {SpriteSheetOptions} options */
  constructor({ image, frameWidth, frameHeight, margin = 0, spacing = 0, inset = 0 } = {}) {
    if (!image || !(frameWidth > 0 && frameHeight > 0)) throw new TypeError('SpriteSheet requires an image and positive cell size');
    if (!Number.isFinite(inset) || inset < 0 || inset * 2 >= frameWidth || inset * 2 >= frameHeight) {
      throw new RangeError('SpriteSheet inset must be >= 0 and smaller than half cell size');
    }
    /** @type {SpriteSheetImage} */
    this.image = image;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.margin = margin;
    this.spacing = spacing;
    this.inset = inset;
    this.columns = Math.floor((image.width - margin * 2 + spacing) / (frameWidth + spacing));
    this.rows = Math.floor((image.height - margin * 2 + spacing) / (frameHeight + spacing));
    if (!this.columns || !this.rows) throw new RangeError('Sprite cells do not fit the supplied image');
    this.length = this.columns * this.rows;
  }

  /**
   * Builds a SpriteSheet directly from uniform grid divisions (e.g. 2x2 or 3x3).
   * @param {SpriteSheetImage} image
   * @param {SpriteSheetGridOptions} [options]
   * @returns {SpriteSheet}
   */
  static fromGrid(image, { columns = 3, rows = columns, margin = 0, spacing = 0, inset = 0 } = {}) {
    if (!image || !(image.width > 0 && image.height > 0)) {
      throw new TypeError('SpriteSheet.fromGrid requires an image with positive width and height');
    }
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new RangeError('SpriteSheet.fromGrid columns and rows must be positive integers');
    }
    const frameWidth = Math.floor((image.width - margin * 2 - spacing * (columns - 1)) / columns);
    const frameHeight = Math.floor((image.height - margin * 2 - spacing * (rows - 1)) / rows);
    return new SpriteSheet({ image, frameWidth, frameHeight, margin, spacing, inset });
  }

  /**
   * Source rectangle of a frame (row-major order).
   * @param {number} index Integer 0..length-1.
   * @returns {SpriteFrameRect}
   */
  frame(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Sprite frame out of bounds');
    const col = index % this.columns, row = Math.floor(index / this.columns);
    return {
      x: this.margin + col * (this.frameWidth + this.spacing) + this.inset,
      y: this.margin + row * (this.frameHeight + this.spacing) + this.inset,
      width: this.frameWidth - this.inset * 2,
      height: this.frameHeight - this.inset * 2,
    };
  }
}

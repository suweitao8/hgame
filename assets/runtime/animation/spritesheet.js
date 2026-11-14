/** Coordinates within a packed uniform-cell sprite sheet. */
export class SpriteSheet {
  constructor({ image, frameWidth, frameHeight, margin = 0, spacing = 0, inset = 0 } = {}) {
    if (!image || !(frameWidth > 0 && frameHeight > 0)) throw new TypeError('SpriteSheet requires an image and positive cell size');
    if (!Number.isFinite(inset) || inset < 0 || inset * 2 >= frameWidth || inset * 2 >= frameHeight) {
      throw new RangeError('SpriteSheet inset must be >= 0 and smaller than half cell size');
    }
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

  /** Builds a SpriteSheet directly from uniform grid divisions (e.g. 2x2 or 3x3). */
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

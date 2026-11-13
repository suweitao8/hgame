/** Coordinates within a packed uniform-cell sprite sheet. */
export class SpriteSheet {
  constructor({ image, frameWidth, frameHeight, margin = 0, spacing = 0 } = {}) {
    if (!image || !(frameWidth > 0 && frameHeight > 0)) throw new TypeError('SpriteSheet requires an image and positive cell size');
    this.image = image;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.margin = margin;
    this.spacing = spacing;
    this.columns = Math.floor((image.width - margin * 2 + spacing) / (frameWidth + spacing));
    this.rows = Math.floor((image.height - margin * 2 + spacing) / (frameHeight + spacing));
    if (!this.columns || !this.rows) throw new RangeError('Sprite cells do not fit the supplied image');
    this.length = this.columns * this.rows;
  }
  frame(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Sprite frame out of bounds');
    const col = index % this.columns, row = Math.floor(index / this.columns);
    return {
      x: this.margin + col * (this.frameWidth + this.spacing),
      y: this.margin + row * (this.frameHeight + this.spacing),
      width: this.frameWidth,
      height: this.frameHeight,
    };
  }
}

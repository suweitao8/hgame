const COMPONENTS_PER_TEXEL = 4;
const MAX_ROW_UPLOADS = 24;

/** @typedef {{mode: 'idle' | 'full' | 'ranges', queuedBytes: number, ranges: number}} FloatTextureUploadStats */

/**
 * Keeps pending dirty ranges until the renderer consumes their texture version.
 * Range uploads require a renderer that initializes new GPU backing in full.
 */
export function createFloatTextureUpdates(texture, data, width, height, partial) {
  const packed = new Float32Array(data.length);
  const currentBits = new Uint32Array(data.buffer, data.byteOffset, data.length);
  const packedBits = new Uint32Array(packed.buffer);
  const rowSize = width * COMPONENTS_PER_TEXEL;
  const min = new Int32Array(height).fill(rowSize);
  const max = new Int32Array(height);
  const canPatch = partial && typeof texture.addUpdateRange === 'function' &&
    typeof texture.clearUpdateRanges === 'function' && 'onUpdate' in texture && texture.userData &&
    Number.isInteger(texture.source?.version);
  let rangeBaseVersion = null;
  /** @type {FloatTextureUploadStats} */
  let pending = { mode: 'full', queuedBytes: data.byteLength, ranges: 1 };

  if ('onUpdate' in texture) {
    const previous = texture.onUpdate;
    texture.onUpdate = function (uploaded) {
      min.fill(rowSize);
      max.fill(0);
      if (canPatch) rangeBaseVersion = texture.source.version;
      pending = { mode: 'idle', queuedBytes: 0, ranges: 0 };
      previous?.call(this, uploaded);
    };
  }

  function publish(rowCount = height, dirtyStarts = null, dirtyEnds = null) {
    let changed = false;
    for (let row = 0; row < rowCount; row++) {
      const offset = row * rowSize;
      let first = rowSize;
      let last = 0;
      const start = dirtyStarts ? dirtyStarts[row] : 0;
      const end = dirtyEnds ? dirtyEnds[row] : rowSize;
      for (let i = start; i < end; i++) {
        if (currentBits[offset + i] === packedBits[offset + i]) continue;
        currentBits[offset + i] = packedBits[offset + i];
        if (first === rowSize) first = i;
        last = i + 1;
      }
      if (!last) continue;
      changed = true;
      min[row] = Math.min(min[row], first - first % COMPONENTS_PER_TEXEL);
      max[row] = Math.max(max[row], Math.ceil(last / COMPONENTS_PER_TEXEL) * COMPONENTS_PER_TEXEL);
    }
    if (!changed) return;

    let ranges = 0;
    let components = 0;
    if (canPatch && pending.mode !== 'full') {
      for (let row = 0; row < height; row++) {
        if (min[row] >= max[row]) continue;
        ranges++;
        components += max[row] - min[row];
      }
    }
    texture.clearUpdateRanges?.();
    if (ranges > 0 && ranges <= MAX_ROW_UPLOADS && components < data.length / 2) {
      for (let row = 0; row < height; row++) {
        if (min[row] < max[row]) texture.addUpdateRange(row * rowSize + min[row], max[row] - min[row]);
      }
      pending = { mode: 'ranges', queuedBytes: components * data.BYTES_PER_ELEMENT, ranges };
      texture.userData.hgameDataTextureRangeBaseVersion = rangeBaseVersion;
    } else {
      pending = { mode: 'full', queuedBytes: data.byteLength, ranges: 1 };
      if (canPatch) delete texture.userData.hgameDataTextureRangeBaseVersion;
    }
    texture.needsUpdate = true;
  }

  return { packed, publish, stats: () => ({ ...pending }) };
}

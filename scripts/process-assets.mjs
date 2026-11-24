import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { encodeKtx2WithToktx, isToktxRequired, missingToktxMessage, resolveToktxBin, TOKTX_INSTALL_HINT } from './lib/toktx.mjs';

const KTX2_MAGIC_BYTES = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function makeChunk(type, data) {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Decodes an 8-bit or 16-bit non-interlaced PNG buffer into RGBA8 pixel data. */
export function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new TypeError('Invalid PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filterMethod = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idatChunks = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) throw new RangeError(`Truncated PNG chunk: ${type}`);
    const data = buf.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filterMethod = data[11];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!(width > 0 && height > 0)) throw new TypeError('PNG missing valid IHDR');
  if (compression !== 0 || filterMethod !== 0) throw new TypeError('Unsupported PNG compression or filter method');
  if (interlace !== 0) throw new TypeError('Interlaced PNG is not supported');
  if (bitDepth !== 8 && bitDepth !== 16) throw new TypeError(`Unsupported PNG bit depth: ${bitDepth}`);

  const channelCount = colorType === 6 ? 4
    : colorType === 2 ? 3
    : colorType === 4 ? 2
    : (colorType === 0 || colorType === 3) ? 1
    : 0;
  if (!channelCount) throw new TypeError(`Unsupported PNG color type: ${colorType}`);
  if (colorType === 3 && (!palette || bitDepth !== 8)) throw new TypeError('Indexed PNG requires 8-bit PLTE');

  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = channelCount * bytesPerSample;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  if (inflated.length < height * (stride + 1)) {
    throw new RangeError('Corrupt PNG IDAT length');
  }

  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const srcRow = y * (stride + 1);
    const filter = inflated[srcRow];
    const dstRow = y * stride;
    const prevRow = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const byte = inflated[srcRow + 1 + x];
      const a = x >= bpp ? raw[dstRow + x - bpp] : 0;
      const b = y > 0 ? raw[prevRow + x] : 0;
      const c = (x >= bpp && y > 0) ? raw[prevRow + x - bpp] : 0;
      let recon = byte;
      if (filter === 1) recon = (byte + a) & 0xff;
      else if (filter === 2) recon = (byte + b) & 0xff;
      else if (filter === 3) recon = (byte + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (byte + paethPredictor(a, b, c)) & 0xff;
      else if (filter !== 0) throw new TypeError(`Invalid PNG scanline filter: ${filter}`);
      raw[dstRow + x] = recon;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    for (let x = 0; x < width; x++) {
      const pOff = rowOff + x * bpp;
      const outOff = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[outOff] = raw[pOff];
        rgba[outOff + 1] = raw[pOff + bytesPerSample];
        rgba[outOff + 2] = raw[pOff + bytesPerSample * 2];
        rgba[outOff + 3] = raw[pOff + bytesPerSample * 3];
      } else if (colorType === 2) {
        const r = raw[pOff];
        const g = raw[pOff + bytesPerSample];
        const b = raw[pOff + bytesPerSample * 2];
        let a = 255;
        if (trns && trns.length >= 6) {
          const kr = trns.readUInt16BE(0) >> (bitDepth === 16 ? 8 : 0);
          const kg = trns.readUInt16BE(2) >> (bitDepth === 16 ? 8 : 0);
          const kb = trns.readUInt16BE(4) >> (bitDepth === 16 ? 8 : 0);
          if (r === kr && g === kg && b === kb) a = 0;
        }
        rgba[outOff] = r;
        rgba[outOff + 1] = g;
        rgba[outOff + 2] = b;
        rgba[outOff + 3] = a;
      } else if (colorType === 4) {
        const v = raw[pOff];
        rgba[outOff] = v;
        rgba[outOff + 1] = v;
        rgba[outOff + 2] = v;
        rgba[outOff + 3] = raw[pOff + bytesPerSample];
      } else if (colorType === 0) {
        const v = raw[pOff];
        let a = 255;
        if (trns && trns.length >= 2) {
          const kv = trns.readUInt16BE(0) >> (bitDepth === 16 ? 8 : 0);
          if (v === kv) a = 0;
        }
        rgba[outOff] = v;
        rgba[outOff + 1] = v;
        rgba[outOff + 2] = v;
        rgba[outOff + 3] = a;
      } else if (colorType === 3) {
        const idx = raw[pOff];
        const p = idx * 3;
        rgba[outOff] = palette[p] ?? 0;
        rgba[outOff + 1] = palette[p + 1] ?? 0;
        rgba[outOff + 2] = palette[p + 2] ?? 0;
        rgba[outOff + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
      }
    }
  }

  return { width, height, data: rgba };
}

/** Encodes RGBA8 pixel data into a lossless PNG buffer. */
export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('encodePng requires positive integer width and height');
  }
  if (!data || data.length < width * height * 4) {
    throw new TypeError('encodePng data length does not match width * height * 4');
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const outRow = y * (stride + 1);
    const inRow = y * stride;
    raw[outRow] = 1; // Sub filter improves compression cleanly
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[inRow + x - 4] : 0;
      raw[outRow + 1 + x] = (data[inRow + x] - left) & 0xff;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function cropSubImage(image, x0, y0, x1, y1) {
  const cw = Math.max(0, x1 - x0);
  const ch = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * image.width + x0) * 4;
    const dstStart = y * cw * 4;
    data.set(image.data.subarray(srcStart, srcStart + cw * 4), dstStart);
  }
  return { width: cw, height: ch, data };
}

/** Splits a single, 2x2, or 3x3 RGBA sheet evenly into row-major cells. */
export function splitRgbaGrid(image, { grid = 3, columns = null, rows = null } = {}) {
  const cols = columns ?? grid;
  const rowCount = rows ?? grid;
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rowCount) || rowCount < 1) {
    throw new RangeError('splitRgbaGrid grid/columns/rows must be positive integers');
  }
  const { width, height } = image;
  const cells = [];
  for (let r = 0; r < rowCount; r++) {
    const y0 = Math.round((r * height) / rowCount);
    const y1 = Math.round(((r + 1) * height) / rowCount);
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round((c * width) / cols);
      const x1 = Math.round(((c + 1) * width) / cols);
      cells.push({
        row: r,
        col: c,
        ...cropSubImage(image, x0, y0, x1, y1),
      });
    }
  }
  return cells;
}

function computeChromaAlpha(r, g, b, preserveInteriorGreen) {
  const maxRb = Math.max(r, b);
  const meanRb = 0.5 * (r + b);
  const greenExcess = g - maxRb;
  const greenRatio = g / Math.max(meanRb, 1);
  const distGreen = Math.hypot(r / 255, (255 - g) / 255, b / 255);
  let alpha = Math.max(0, Math.min(1, (distGreen - 0.25) / (0.46 - 0.25)));

  if (preserveInteriorGreen) {
    const isPureGreenHue = r < 60 && b < 65 && g > 115 && greenRatio > 2.1;
    const alphaExcess = 1 - Math.max(0, Math.min(1, (greenExcess - 35) / (95 - 35)));
    if (isPureGreenHue) alpha = Math.min(alpha, alphaExcess);
    const nonGreen = greenExcess <= 22 || greenRatio <= 1.25 || r > 88 || g < 145;
    if (nonGreen && distGreen > 0.30) alpha = 1;
  } else {
    const alphaExcess = 1 - Math.max(0, Math.min(1, (greenExcess - 24) / (80 - 24)));
    alpha = Math.min(alpha, alphaExcess);
    if (greenExcess <= 18 || greenRatio <= 1.18) alpha = 1;
  }
  return alpha;
}

/**
 * Extracts transparent cutouts from native alpha, #00FF00 green-screen with despill,
 * or white backgrounds (via corner/perimeter flood-fill preserving interior white highlights).
 */
export function removeBackgroundRgba(image, {
  mode = 'transparent',
  preserveInteriorGreen = true,
  whiteThreshold = 240,
  softFeatherThreshold = 215,
  clearEnclosedWhiteHoles = false,
} = {}) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data);
  const pixelCount = width * height;

  if (mode === 'transparent') {
    for (let i = 0; i < pixelCount; i++) {
      const aIdx = i * 4 + 3;
      if (out[aIdx] < 12) out[aIdx] = 0;
    }
    return { width, height, data: out };
  }

  if (mode === 'green') {
    const alpha = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const off = i * 4;
      const a = Math.round(computeChromaAlpha(out[off], out[off + 1], out[off + 2], preserveInteriorGreen) * 255);
      alpha[i] = a < 12 ? 0 : a;
    }

    // Detect 3px outer boundary band adjacent to semi-transparent background pixels
    const bgMask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      if (alpha[i] < 245) bgMask[i] = 1;
    }
    const dilatedBg = new Uint8Array(pixelCount);
    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - 3);
      const yMax = Math.min(height - 1, y + 3);
      for (let x = 0; x < width; x++) {
        const xMin = Math.max(0, x - 3);
        const xMax = Math.min(width - 1, x + 3);
        let hit = 0;
        for (let yy = yMin; yy <= yMax && !hit; yy++) {
          const rowOff = yy * width;
          for (let xx = xMin; xx <= xMax; xx++) {
            if (bgMask[rowOff + xx]) {
              hit = 1;
              break;
            }
          }
        }
        dilatedBg[y * width + x] = hit;
      }
    }

    // Despill edges & neon green specks without muddying natural green interior details
    for (let i = 0; i < pixelCount; i++) {
      const a = alpha[i];
      if (a === 0) {
        out[i * 4 + 3] = 0;
        continue;
      }
      const off = i * 4;
      const r = out[off];
      let g = out[off + 1];
      const b = out[off + 2];
      const rbSum = r + b;
      const gClamped = Math.floor(rbSum * 0.5);
      const neonSpeck = r < 55 && b < 60 && g > 175 && g > rbSum * 1.15;
      const applyDespill = preserveInteriorGreen
        ? ((dilatedBg[i] || neonSpeck) && g > rbSum * 0.55)
        : (g > rbSum * 0.55);
      if (applyDespill) g = gClamped;
      if (a < 245 && g > Math.max(r, b)) g = gClamped;
      out[off + 1] = g;
    }

    // Inward 1px erosion + soft alpha smoothing
    const eroded = new Uint8Array(pixelCount);
    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - 1);
      const yMax = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const xMin = Math.max(0, x - 1);
        const xMax = Math.min(width - 1, x + 1);
        let minA = 255;
        for (let yy = yMin; yy <= yMax; yy++) {
          const rowOff = yy * width;
          for (let xx = xMin; xx <= xMax; xx++) {
            if (alpha[rowOff + xx] < minA) minA = alpha[rowOff + xx];
          }
        }
        eroded[y * width + x] = minA;
      }
    }

    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - 1);
      const yMax = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (alpha[idx] === 0) {
          out[idx * 4 + 3] = 0;
          continue;
        }
        const xMin = Math.max(0, x - 1);
        const xMax = Math.min(width - 1, x + 1);
        let sum = 0;
        let count = 0;
        for (let yy = yMin; yy <= yMax; yy++) {
          const rowOff = yy * width;
          for (let xx = xMin; xx <= xMax; xx++) {
            sum += eroded[rowOff + xx];
            count++;
          }
        }
        const avg = Math.round(sum / count);
        out[idx * 4 + 3] = avg < 8 ? 0 : avg;
      }
    }
    return { width, height, data: out };
  }

  if (mode === 'white') {
    const visited = new Uint8Array(pixelCount);
    const bgMask = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    const isNearWhite = (idx) => {
      const off = idx * 4;
      const r = out[off];
      const g = out[off + 1];
      const b = out[off + 2];
      const minRgb = Math.min(r, g, b);
      const sat = Math.max(r, g, b) - minRgb;
      return minRgb >= whiteThreshold || (minRgb >= whiteThreshold - 10 && sat <= 18);
    };

    const enqueue = (idx) => {
      if (!visited[idx] && isNearWhite(idx)) {
        visited[idx] = 1;
        bgMask[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < width; x++) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      enqueue(y * width);
      enqueue(y * width + (width - 1));
    }

    while (head < tail) {
      const cur = queue[head++];
      const cy = Math.floor(cur / width);
      const cx = cur - cy * width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            if (isNearWhite(nIdx)) {
              bgMask[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
      }
    }

    for (let i = 0; i < pixelCount; i++) {
      if (bgMask[i]) {
        out[i * 4 + 3] = 0;
      } else if (clearEnclosedWhiteHoles) {
        const off = i * 4;
        const r = out[off];
        const g = out[off + 1];
        const b = out[off + 2];
        const minRgb = Math.min(r, g, b);
        const sat = Math.max(r, g, b) - minRgb;
        if (minRgb >= 232 && sat <= 18) {
          bgMask[i] = 1;
          out[off + 3] = 0;
        }
      }
    }

    // 1px soft halo feathering on exterior border only
    const denom = Math.max(1, whiteThreshold - softFeatherThreshold);
    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - 1);
      const yMax = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (bgMask[idx]) continue;
        const xMin = Math.max(0, x - 1);
        const xMax = Math.min(width - 1, x + 1);
        let touchesBg = false;
        for (let yy = yMin; yy <= yMax && !touchesBg; yy++) {
          const rowOff = yy * width;
          for (let xx = xMin; xx <= xMax; xx++) {
            if (bgMask[rowOff + xx]) {
              touchesBg = true;
              break;
            }
          }
        }
        if (!touchesBg) continue;
        const off = idx * 4;
        const r = out[off];
        const g = out[off + 1];
        const b = out[off + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma > softFeatherThreshold && sat <= 35) {
          const factor = Math.max(0, Math.min(1, (whiteThreshold - luma) / denom));
          out[off + 3] = Math.round(out[off + 3] * factor);
        }
      }
    }
    return { width, height, data: out };
  }

  throw new TypeError(`Unknown background removal mode: ${mode}`);
}

/** Strips faint semi-transparent shadow wisps along the lowest 1.5% sole band while preserving outlines. */
export function cleanSoleFringeRgba(image) {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data);
  let yMin = height;
  let yMax = -1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (out[(rowOff + x) * 4 + 3] > 15) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  if (yMax < 0) return { width, height, data: out };
  const bh = yMax - yMin + 1;
  const soleBandTop = Math.max(yMin, yMax - Math.max(3, Math.round(bh * 0.015)));
  for (let y = soleBandTop; y <= yMax; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const off = (rowOff + x) * 4;
      const a = out[off + 3];
      if (a > 0 && a < 95) {
        const luma = 0.299 * out[off] + 0.587 * out[off + 1] + 0.114 * out[off + 2];
        if (luma < 22) out[off + 3] = 0;
      }
    }
  }
  return { width, height, data: out };
}

function findOpaqueBounds(image, alphaThreshold = 15) {
  const { width, height, data } = image;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(rowOff + x) * 4 + 3] > alphaThreshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function resampleRgbaPremultiplied(image, targetW, targetH) {
  const { width: sw, height: sh, data: src } = image;
  if (sw === targetW && sh === targetH) return { width: sw, height: sh, data: new Uint8ClampedArray(src) };
  const dst = new Uint8ClampedArray(targetW * targetH * 4);
  const scaleX = sw / targetW;
  const scaleY = sh / targetH;

  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const a00 = src[i00 + 3] / 255;
      const a10 = src[i10 + 3] / 255;
      const a01 = src[i01 + 3] / 255;
      const a11 = src[i11 + 3] / 255;

      const aOut = w00 * a00 + w10 * a10 + w01 * a01 + w11 * a11;
      const outOff = (y * targetW + x) * 4;
      if (aOut > 1e-5) {
        const pr = w00 * src[i00] * a00 + w10 * src[i10] * a10 + w01 * src[i01] * a01 + w11 * src[i11] * a11;
        const pg = w00 * src[i00 + 1] * a00 + w10 * src[i10 + 1] * a10 + w01 * src[i01 + 1] * a01 + w11 * src[i11 + 1] * a11;
        const pb = w00 * src[i00 + 2] * a00 + w10 * src[i10 + 2] * a10 + w01 * src[i01 + 2] * a01 + w11 * src[i11 + 2] * a11;
        dst[outOff] = Math.round(pr / aOut);
        dst[outOff + 1] = Math.round(pg / aOut);
        dst[outOff + 2] = Math.round(pb / aOut);
        dst[outOff + 3] = Math.round(aOut * 255);
      }
    }
  }
  return { width: targetW, height: targetH, data: dst };
}

/** Generates an analytical smooth radial-gradient elliptical ground shadow layer in RGBA. */
export function renderGroundShadowRgba({
  width,
  height,
  footCenterX = width * 0.5,
  footBottomY = height * 0.94,
  footSpanW = 0,
  charHeight = height,
  maxAlpha = 155,
  widthRatio = 0.72,
  heightRatio = 0.16,
  tuckRatio = 0.032,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const shadowW = Math.max(24, charHeight * widthRatio, footSpanW * 1.15);
  const shadowH = Math.max(10, charHeight * heightRatio, shadowW * 0.19);
  const rx = shadowW * 0.5;
  const ry = shadowH * 0.5;
  const cy = footBottomY - charHeight * tuckRatio;

  for (let y = 0; y < height; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const dy2 = dy * dy;
    if (dy2 >= 1) continue;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - footCenterX) / rx;
      const d2 = dx * dx + dy2;
      if (d2 < 1) {
        data[(rowOff + x) * 4 + 3] = Math.round(Math.pow(1 - d2, 1.5) * maxAlpha);
      }
    }
  }
  return { width, height, data };
}

function compositeOver(base, fg, pasteX = 0, pasteY = 0) {
  const out = new Uint8ClampedArray(base.data);
  for (let y = 0; y < fg.height; y++) {
    const dy = pasteY + y;
    if (dy < 0 || dy >= base.height) continue;
    for (let x = 0; x < fg.width; x++) {
      const dx = pasteX + x;
      if (dx < 0 || dx >= base.width) continue;
      const sOff = (y * fg.width + x) * 4;
      const dOff = (dy * base.width + dx) * 4;
      const sa = fg.data[sOff + 3] / 255;
      if (sa <= 0) continue;
      const da = out[dOff + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;
      out[dOff] = Math.round((fg.data[sOff] * sa + out[dOff] * da * (1 - sa)) / outA);
      out[dOff + 1] = Math.round((fg.data[sOff + 1] * sa + out[dOff + 1] * da * (1 - sa)) / outA);
      out[dOff + 2] = Math.round((fg.data[sOff + 2] * sa + out[dOff + 2] * da * (1 - sa)) / outA);
      out[dOff + 3] = Math.round(outA * 255);
    }
  }
  return { width: base.width, height: base.height, data: out };
}

const TIER_CAPS = Object.freeze({
  '3x3': 341,
  '2x2': 512,
  '1x1': 768,
});

/**
 * Crops excess transparent padding, enforces tier resolution caps without upscaling,
 * strips sole shadow fringes, and keeps actor sprites shadow-free by default so runtime
 * dynamic shadows stay decoupled from Tween movement (or bakes static shadows via bakeShadow).
 */
export function cropAndNormalizeRgba(image, {
  tier = '3x3',
  mode = 'actor',
  paddingRatio = 0.04,
  bakeShadow = false,
  maxDimension = null,
} = {}) {
  const defaultCap = mode === 'background' && tier === '1x1' ? 1280 : (TIER_CAPS[tier] ?? 341);
  const cap = Number.isFinite(maxDimension) && maxDimension > 0 ? Math.round(maxDimension) : defaultCap;

  if (mode === 'background') {
    const scale = Math.min(1, cap / Math.max(1, image.width, image.height));
    const tw = Math.max(1, Math.round(image.width * scale));
    const th = Math.max(1, Math.round(image.height * scale));
    return resampleRgbaPremultiplied(image, tw, th);
  }

  const bounds = findOpaqueBounds(image, 15);
  if (!bounds) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }

  let cropped = cropSubImage(image, bounds.x0, bounds.y0, bounds.x1, bounds.y1);
  if (mode === 'actor') {
    cropped = cleanSoleFringeRgba(cropped);
    const tightened = findOpaqueBounds(cropped, 15);
    if (tightened) {
      cropped = cropSubImage(cropped, tightened.x0, tightened.y0, tightened.x1, tightened.y1);
    }
  }

  const maxSide = Math.max(1, cropped.width, cropped.height);
  const padFactor = mode === 'icon' ? Math.max(0, Math.min(0.25, paddingRatio)) : 0;
  const maxContentSide = Math.max(1, Math.floor(cap * (1 - 2 * padFactor)));
  const downScale = Math.min(1, maxContentSide / maxSide);
  const nw = Math.max(1, Math.round(cropped.width * downScale));
  const nh = Math.max(1, Math.round(cropped.height * downScale));
  const scaled = resampleRgbaPremultiplied(cropped, nw, nh);

  if (mode === 'icon') {
    const side = Math.min(cap, Math.max(nw, nh) + Math.round(Math.max(nw, nh) * padFactor * 2));
    const cw = Math.max(nw, side);
    const ch = Math.max(nh, side);
    const canvas = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
    return compositeOver(canvas, scaled, Math.floor((cw - nw) * 0.5), Math.floor((ch - nh) * 0.5));
  }

  // Actor mode: shadow-free tight sprite by default; optional static ground shadow when requested
  if (!bakeShadow) return scaled;

  const extraBottom = Math.max(4, Math.round(nh * 0.06));
  const canvasW = Math.min(cap, Math.max(nw, Math.round(nh * 0.78)));
  const canvasH = Math.min(cap, nh + extraBottom);
  const pasteX = Math.floor((canvasW - nw) * 0.5);
  const pasteY = canvasH - extraBottom - nh;
  const shadow = renderGroundShadowRgba({
    width: canvasW,
    height: canvasH,
    footCenterX: canvasW * 0.5,
    footBottomY: canvasH - extraBottom,
    footSpanW: nw * 0.65,
    charHeight: nh,
  });
  return compositeOver(shadow, scaled, Math.max(0, pasteX), Math.max(0, pasteY));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function writeSpriteAtlas(inputDir, output, maxSize) {
  if (typeof inputDir !== 'string' || typeof output !== 'string' || !/\.png$/i.test(output)) {
    throw new Error('Usage: node scripts/process-assets.mjs --atlas-dir <sprites-dir> --atlas-out <atlas.png> [--max-size 2048]');
  }
  if (!Number.isInteger(maxSize) || maxSize < 16 || maxSize > 4096) {
    throw new RangeError('--max-size must be an integer from 16 to 4096');
  }
  const target = path.resolve(output);
  const sources = fs.readdirSync(inputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.png$/i.test(entry.name))
    .map(entry => path.resolve(inputDir, entry.name))
    .filter(file => file !== target)
    .sort();
  if (sources.length === 0) throw new Error('No PNG sprites found in ' + inputDir);
  const names = new Set();
  const sprites = sources.map(file => {
    const name = path.basename(file).slice(0, -4);
    if (names.has(name.toLowerCase())) throw new Error('Duplicate sprite name: ' + name);
    names.add(name.toLowerCase());
    const image = decodePng(fs.readFileSync(file));
    if (image.width + 2 > maxSize || image.height + 2 > maxSize) {
      throw new Error('Sprite exceeds atlas dimensions: ' + name);
    }
    return { ...image, name, x: 0, y: 0 };
  }).sort((a, b) => b.height - a.height || b.width - a.width);

  let rowX = 0, rowY = 0, rowHeight = 0, width = 0;
  for (const sprite of sprites) {
    if (rowX + sprite.width + 2 > maxSize) {
      rowY += rowHeight;
      rowX = 0;
      rowHeight = 0;
    }
    if (rowY + sprite.height + 2 > maxSize) {
      throw new Error('Sprites do not fit in one atlas. Pack smaller scene or animation groups.');
    }
    sprite.x = rowX + 1;
    sprite.y = rowY + 1;
    rowX += sprite.width + 2;
    rowHeight = Math.max(rowHeight, sprite.height + 2);
    width = Math.max(width, rowX);
  }
  const height = rowY + rowHeight;
  const rgba = Buffer.alloc(width * height * 4);
  const frames = Object.create(null);
  for (const sprite of sprites) {
    const { name, x, y, width: w, height: h, data } = sprite;
    frames[name] = { x, y, width: w, height: h };
    // Extrude the outer texels to avoid sampling a neighboring sprite.
    for (let v = -1; v <= h; v++) {
      const sourceRow = Math.max(0, Math.min(h - 1, v)) * w * 4;
      const destination = ((y + v) * width + x) * 4;
      rgba.set(data.subarray(sourceRow, sourceRow + w * 4), destination);
      rgba.set(data.subarray(sourceRow, sourceRow + 4), destination - 4);
      rgba.set(data.subarray(sourceRow + (w - 1) * 4, sourceRow + w * 4), destination + w * 4);
    }
  }
  const metadata = target.slice(0, -4) + '.json';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encodePng({ width, height, data: rgba }));
  fs.writeFileSync(metadata, JSON.stringify({
    schemaVersion: 1, image: path.basename(target), width, height, frames,
  }, null, 2) + '\n');
  return { image: target, metadata, width, height, count: sprites.length };
}

/**
 * Pack raw RGBA8 pixels into a compliant KTX2 v2 container (80-byte header + 24-byte level index + mip0 payload).
 */
export function encodeKtx2Container({ width, height, data, vkFormat = 37 }) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const expectedLen = w * h * 4;
  if (raw.length < expectedLen) {
    throw new RangeError(`encodeKtx2Container expected >= ${expectedLen} bytes, got ${raw.length}`);
  }

  const headerAndIndexBytes = 80 + 24;
  const out = Buffer.alloc(headerAndIndexBytes + expectedLen);
  KTX2_MAGIC_BYTES.copy(out, 0);
  out.writeUInt32LE(vkFormat, 12);     // vkFormat (37 = R8G8B8A8_UNORM)
  out.writeUInt32LE(1, 16);            // typeSize
  out.writeUInt32LE(w, 20);            // pixelWidth
  out.writeUInt32LE(h, 24);            // pixelHeight
  out.writeUInt32LE(0, 28);            // pixelDepth
  out.writeUInt32LE(0, 32);            // layerCount
  out.writeUInt32LE(1, 36);            // faceCount
  out.writeUInt32LE(1, 40);            // levelCount
  out.writeUInt32LE(0, 44);            // supercompressionScheme (uncompressed)
  // Bytes 48..79 are dfd/kvd/sgd offsets/lengths (left 0 when raw).
  // Level 0 index entry (3 x uint64 little-endian: byteOffset, byteLength, uncompressedByteLength)
  out.writeBigUInt64LE(BigInt(headerAndIndexBytes), 80);
  out.writeBigUInt64LE(BigInt(expectedLen), 88);
  out.writeBigUInt64LE(BigInt(expectedLen), 96);
  raw.copy(out, headerAndIndexBytes, 0, expectedLen);
  return out;
}

/**
 * Offline PNG-to-KTX2 converter. KTX-Software `toktx` is the default encoder: colour maps become
 * ETC1S and normal / roughness-metallic maps UASTC, both with a complete mip chain. Without toktx
 * the pure-JS container writer is used, which is uncompressed with a single level and therefore
 * rejected by the release packaging audit; that fallback is announced, and is an error when
 * `requireToktx` is set (also read from `HGAME_REQUIRE_TOKTX=1`).
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {{ preferToktx?: boolean, requireToktx?: boolean, kind?: 'color' | 'normal_rm', toktxBin?: string | null, warn?: (message: string) => void, exec?: typeof import('node:child_process').spawnSync }} [options]
 */
export function convertPngToKtx2(inputPath, outputPath, {
  preferToktx = true,
  requireToktx = isToktxRequired(),
  kind = 'color',
  toktxBin,
  warn = (message) => console.warn(message),
  exec,
} = {}) {
  const pngBuf = fs.readFileSync(inputPath);
  const decoded = decodePng(pngBuf);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let encoder = 'built-in-ktx2';
  let warning = null;
  if (preferToktx) {
    const bin = toktxBin === undefined ? resolveToktxBin() : toktxBin;
    if (bin) {
      encodeKtx2WithToktx(bin, { input: inputPath, output: outputPath, kind, exec });
      encoder = 'toktx';
    } else if (requireToktx) {
      throw new Error(missingToktxMessage(path.basename(outputPath)));
    } else {
      warning = `[process-assets] toktx not found: ${path.basename(outputPath)} is an uncompressed single-level `
        + `KTX2 container, which release packaging rejects. ${TOKTX_INSTALL_HINT}`;
      warn(warning);
    }
  }
  if (encoder === 'built-in-ktx2') {
    const ktx2Buf = encodeKtx2Container({ width: decoded.width, height: decoded.height, data: decoded.data });
    fs.writeFileSync(outputPath, ktx2Buf);
  }
  const stat = fs.statSync(outputPath);
  return { outputPath, width: decoded.width, height: decoded.height, bytes: stat.size, encoder, warning };
}

/** CLI helper for processing single, 2x2, or 3x3 generated artwork sheets. */
export function runAssetCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.ktx2 !== undefined) {
    const inFile = String(args.ktx2);
    const outFile = String(args.out || inFile.replace(/\.png$/i, '.ktx2'));
    const kind = args['normal-rm'] ? 'normal_rm' : 'color';
    return convertPngToKtx2(inFile, outFile, {
      preferToktx: !args['no-toktx'],
      requireToktx: args['require-toktx'] === true || isToktxRequired(),
      kind,
    });
  }
  if (args['atlas-dir'] !== undefined || args['atlas-out'] !== undefined) {
    return writeSpriteAtlas(args['atlas-dir'], args['atlas-out'], Number(args['max-size'] ?? 2048));
  }
  if (!args.input || !args['out-dir']) {
    throw new Error('Usage: node scripts/process-assets.mjs --input <sheet.png> --out-dir <dir> [--grid 1|2|3] [--bg transparent|green|white] [--mode actor|icon|background] [--names a,b,c] [--bake-shadow]');
  }
  const grid = Number(args.grid ?? 3);
  const bg = String(args.bg ?? 'transparent');
  const mode = String(args.mode ?? 'actor');
  const bakeShadow = Boolean(args['bake-shadow']);
  const names = typeof args.names === 'string' && args.names.trim()
    ? args.names.split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const tier = grid === 1 ? '1x1' : (grid === 2 ? '2x2' : '3x3');

  const decoded = decodePng(fs.readFileSync(args.input));
  const cells = splitRgbaGrid(decoded, { grid });
  fs.mkdirSync(args['out-dir'], { recursive: true });

  const outputs = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const cutout = removeBackgroundRgba(cell, { mode: bg });
    const processed = cropAndNormalizeRgba(cutout, { tier, mode, bakeShadow });
    const bounds = findOpaqueBounds(processed, 15);
    if (!bounds) continue;
    const baseName = names?.[i] || `cell_${cell.row}_${cell.col}`;
    const outPath = path.join(args['out-dir'], `${baseName}.png`);
    fs.writeFileSync(outPath, encodePng(processed));
    outputs.push({ name: baseName, width: processed.width, height: processed.height, file: outPath });
  }
  return { input: args.input, tier, bg, mode, bakeShadow, count: outputs.length, outputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runAssetCli();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

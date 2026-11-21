import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'foliage.manifest.json');
const OUT_DIR = path.join(ROOT, 'built', 'foliage');

function dilateAlphaEdges(rgba, width, height, iterations = 16) {
  let src = new Uint8Array(rgba);
  let dst = new Uint8Array(rgba);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = src[i * 4 + 3] >= 128 ? 1 : 0;

  for (let pass = 0; pass < iterations; pass++) {
    dst.set(src);
    const nextFilled = new Uint8Array(filled);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (filled[idx]) continue;
        let r = 0, g = 0, b = 0, cnt = 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (!filled[nIdx]) continue;
          const p = nIdx * 4;
          r += src[p];
          g += src[p + 1];
          b += src[p + 2];
          cnt++;
        }
        if (cnt > 0) {
          const p = idx * 4;
          dst[p] = Math.round(r / cnt);
          dst[p + 1] = Math.round(g / cnt);
          dst[p + 2] = Math.round(b / cnt);
          nextFilled[idx] = 1;
          changed = true;
        }
      }
    }
    src.set(dst);
    filled.set(nextFilled);
    if (!changed) break;
  }
  rgba.set(src);
}

function drawBlade(parts, x0, y0, cx, cy, x1, y1, wBase, color, stroke = '#2c4b22') {
  parts.push(`<path d="M${x0 - wBase},${y0} Q${cx - wBase * 0.4},${cy} ${x1},${y1} Q${cx + wBase * 0.4},${cy} ${x0 + wBase},${y0} Z" fill="${color}" stroke="${stroke}" stroke-width="1.5"/>`);
}

function buildSlotSvg(slot, tileSize) {
  const s = tileSize;
  const parts = [];
  if (slot.kind === 'grass' || slot.kind === 'weed') {
    const count = slot.id === 'grass_short' ? 11 : slot.id === 'grass_tall' ? 13 : 15;
    const maxH = slot.id === 'grass_short' ? 0.58 : slot.id === 'grass_tall' ? 0.9 : 0.78;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const bx = s * (0.2 + t * 0.6);
      const lean = (t - 0.5) * s * (slot.kind === 'weed' ? 0.55 : 0.38);
      const tipY = s * (1 - maxH + Math.abs(t - 0.5) * 0.22 + ((i * 19) % 7) * 0.015);
      const col = slot.id === 'grass_tall' ? (i % 2 ? '#788642' : '#5f7438') : (i % 2 ? '#4d7c34' : '#3d692a');
      drawBlade(parts, bx, s, bx + lean * 0.45, (s + tipY) * 0.52, bx + lean, tipY, s * 0.028, col);
    }
  } else if (slot.kind === 'flower') {
    const [pr, pg, pb] = slot.petalColor || [240, 240, 232];
    const petalHex = `rgb(${pr},${pg},${pb})`;
    for (let i = 0; i < 6; i++) {
      const bx = s * (0.3 + i * 0.08);
      drawBlade(parts, bx, s, bx + (i - 2.5) * 14, s * 0.72, bx + (i - 2.5) * 32, s * 0.52, s * 0.022, '#43702e');
    }
    const heads = [[0.34, 0.34], [0.64, 0.28], [0.5, 0.44]];
    for (const [hxNorm, hyNorm] of heads) {
      const hx = s * hxNorm;
      const hy = s * hyNorm;
      parts.push(`<path d="M${s * 0.5},${s} Q${(s * 0.5 + hx) * 0.5},${(s + hy) * 0.55} ${hx},${hy}" fill="none" stroke="#3c6b29" stroke-width="${s * 0.02}"/>`);
      for (let p = 0; p < 8; p++) {
        const ang = (p * Math.PI) / 4;
        const px = hx + Math.cos(ang) * s * 0.065;
        const py = hy + Math.sin(ang) * s * 0.065;
        parts.push(`<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${s * 0.04}" ry="${s * 0.025}" transform="rotate(${(ang * 180) / Math.PI} ${px.toFixed(1)} ${py.toFixed(1)})" fill="${petalHex}"/>`);
      }
      parts.push(`<circle cx="${hx}" cy="${hy}" r="${s * 0.032}" fill="#e6aa20"/>`);
    }
  } else if (slot.kind === 'reed') {
    for (let i = 0; i < 7; i++) {
      const bx = s * (0.28 + i * 0.072);
      const tx = bx + (i - 3) * 28;
      const ty = s * (0.1 + (i % 3) * 0.07);
      parts.push(`<path d="M${bx},${s} Q${(bx + tx) * 0.5},${s * 0.55} ${tx},${ty}" fill="none" stroke="#62783a" stroke-width="${s * 0.016}"/>`);
      parts.push(`<ellipse cx="${tx}" cy="${ty + s * 0.06}" rx="${s * 0.028}" ry="${s * 0.09}" fill="#9c7e4c"/>`);
    }
  } else if (slot.kind === 'vine') {
    // Root at top (y = 0) hanging downwards
    for (let i = 0; i < 4; i++) {
      const sx = s * (0.2 + i * 0.2);
      const len = s * (0.72 + (i % 2) * 0.22);
      parts.push(`<path d="M${sx},0 Q${sx + 18},${len * 0.5} ${sx - 10},${len}" fill="none" stroke="#3b5e28" stroke-width="${s * 0.014}"/>`);
      for (let k = 1; k <= 7; k++) {
        const ly = (k / 7.5) * len;
        const lx = sx + (k % 2 ? 22 : -22);
        parts.push(`<ellipse cx="${lx}" cy="${ly}" rx="${s * 0.048}" ry="${s * 0.032}" transform="rotate(${k % 2 ? 24 : -24} ${lx} ${ly})" fill="${k % 2 ? '#42722f' : '#355f25'}"/>`);
      }
    }
  } else if (slot.kind === 'crop') {
    const stage = slot.stage || 0;
    const height = [0.35, 0.58, 0.78, 0.88][stage];
    const col = ['#689f38', '#4f8b2d', '#7da036', '#c89d32'][stage];
    for (let i = 0; i < 12; i++) {
      const bx = s * (0.24 + (i / 11) * 0.52);
      const lean = (i - 5.5) * (stage >= 2 ? 18 : 10);
      const ty = s * (1 - height + ((i * 13) % 5) * 0.03);
      drawBlade(parts, bx, s, bx + lean * 0.4, (s + ty) * 0.52, bx + lean, ty, s * 0.022, col);
      if (stage >= 2) {
        parts.push(`<ellipse cx="${bx + lean}" cy="${ty + 18}" rx="${s * 0.018}" ry="${s * 0.055}" fill="${stage === 3 ? '#d4a638' : '#9bb349'}"/>`);
      }
    }
  } else if (slot.kind === 'veg') {
    if (slot.variant === 'cabbage') {
      for (let i = 0; i < 7; i++) {
        const ang = -50 + i * 16;
        parts.push(`<ellipse cx="${s * 0.5}" cy="${s * 0.72}" rx="${s * 0.22}" ry="${s * 0.14}" transform="rotate(${ang} ${s * 0.5} ${s * 0.85})" fill="${i % 2 ? '#5a8f3d' : '#4a7d31'}"/>`);
      }
      parts.push(`<circle cx="${s * 0.5}" cy="${s * 0.76}" r="${s * 0.14}" fill="#7db356"/>`);
    } else if (slot.variant === 'scallion') {
      for (let i = 0; i < 8; i++) {
        const bx = s * (0.35 + i * 0.042);
        drawBlade(parts, bx, s, bx + (i - 3.5) * 10, s * 0.58, bx + (i - 3.5) * 18, s * 0.22, s * 0.025, '#4c8c38');
      }
    } else if (slot.variant === 'tomato') {
      parts.push(`<rect x="${s * 0.48}" y="${s * 0.28}" width="${s * 0.04}" height="${s * 0.72}" fill="#446d2b"/>`);
      for (let i = 0; i < 6; i++) {
        const lx = s * (i % 2 ? 0.62 : 0.38);
        const ly = s * (0.35 + i * 0.09);
        parts.push(`<ellipse cx="${lx}" cy="${ly}" rx="${s * 0.12}" ry="${s * 0.05}" fill="#4b7f30"/>`);
      }
      parts.push(`<circle cx="${s * 0.42}" cy="${s * 0.52}" r="${s * 0.045}" fill="#d83828"/>`);
      parts.push(`<circle cx="${s * 0.58}" cy="${s * 0.64}" r="${s * 0.04}" fill="#e24a32"/>`);
    } else {
      for (let i = 0; i < 8; i++) {
        const bx = s * (0.3 + i * 0.055);
        drawBlade(parts, bx, s, bx + (i - 3.5) * 18, s * 0.72, bx + (i - 3.5) * 32, s * 0.42, s * 0.04, '#477b31');
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${parts.join('')}</svg>`;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  await mkdir(OUT_DIR, { recursive: true });

  const atlasSize = manifest.pcSize || 2048;
  const cols = manifest.gridCols || 4;
  const rows = manifest.gridRows || 4;
  const tileSize = Math.floor(atlasSize / cols);

  const atlasRgba = new Uint8Array(atlasSize * atlasSize * 4);
  for (const slot of manifest.slots) {
    const svg = buildSlotSvg(slot, tileSize);
    const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const col = slot.index % cols;
    const row = Math.floor(slot.index / cols);
    const ox = col * tileSize;
    const oy = row * tileSize;
    for (let y = 0; y < tileSize; y++) {
      const srcRow = y * tileSize * 4;
      const dstRow = ((oy + y) * atlasSize + ox) * 4;
      atlasRgba.set(data.subarray(srcRow, srcRow + tileSize * 4), dstRow);
    }
  }

  dilateAlphaEdges(atlasRgba, atlasSize, atlasSize, manifest.alphaDilationPasses || 16);

  await sharp(atlasRgba, { raw: { width: atlasSize, height: atlasSize, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, 'foliage_albedo.png'));

  const table = {
    version: manifest.version,
    pcSize: atlasSize,
    mobileSize: manifest.mobileSize || 1024,
    gridCols: cols,
    gridRows: rows,
    alphaDilationPasses: manifest.alphaDilationPasses || 16,
    file: 'foliage_albedo.png',
    slots: manifest.slots,
  };
  await writeFile(path.join(OUT_DIR, 'foliage_table.json'), JSON.stringify(table, null, 2));
  console.log(`[foliage:bake] Baked ${manifest.slots.length} foliage slots (${atlasSize}x${atlasSize}, ${manifest.alphaDilationPasses} dilation passes)`);
}

main().catch((err) => {
  console.error('[foliage:bake] FAILED:', err);
  process.exit(1);
});

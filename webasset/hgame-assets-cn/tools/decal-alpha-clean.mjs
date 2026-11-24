import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Remove opaque islands / leaves / splatters clipped by the texture quad border
 * so decals and foliage cards sit cleanly on surfaces without hard rectangular cutoffs.
 *
 * Strategy:
 * 1. Pass 1 (Exact 4-connected component border pruning): any opaque component touching the outer
 *    2px border whose area is below `maxAreaRatio` of total opaque pixels is zeroed cleanly.
 * 2. Pass 2 (Adaptive watershed for dense overlapping clusters, e.g. Swiss Cheese Plant): when a
 *    large cluster (>40%) still touches the border, erode by r=6..9px to disconnect border-cut
 *    leaves from interior leaf cores and watershed back inside the original mask.
 * 3. Fallback for thin needles / fine splatters (`p75 < 7` or unable to separate by erosion) and
 *    dense edge-to-edge floor stains (`softFloorStain`): apply an organic noise-perturbed margin
 *    & corner fade so droplets dissolve naturally instead of terminating in a square silhouette.
 */
function applyOrganicMarginFade(rgba, isOp, w, h, { marginFrac = 0.09, noiseAmp = 0.7, cutThresh = 0.45, fadeTop = 0.95, radialWeight = 0 } = {}) {
  const margin = Math.round(Math.min(w, h) * marginFrac);
  const hash2 = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const vn = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (
      hash2(ix, iy) * (1 - ux) * (1 - uy) +
      hash2(ix + 1, iy) * ux * (1 - uy) +
      hash2(ix, iy + 1) * (1 - ux) * uy +
      hash2(ix + 1, iy + 1) * ux * uy
    );
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isOp[i]) continue;
      const dE = Math.min(x, w - 1 - x, y, h - 1 - y);
      const rNorm = Math.hypot((x / w - 0.5) * 2, (y / h - 0.5) * 2);
      const radDist = Math.max(0, 1 - rNorm);
      const boxDist = Math.min(1, dE / Math.max(1, margin));
      const baseDist = radialWeight > 0 ? boxDist * (1 - radialWeight) + (radDist / Math.max(0.05, marginFrac * 2)) * radialWeight : boxDist;
      if (dE < margin || (radialWeight > 0 && baseDist < 1.25)) {
        const nz = 0.65 * vn((x / w) * 14, (y / h) * 14) + 0.35 * vn((x / w) * 31, (y / h) * 31);
        const f = baseDist + (nz - 0.5) * noiseAmp;
        if (dE <= 3 || f < cutThresh) {
          isOp[i] = 0;
          rgba[i * 4 + 3] = 0;
        } else if (f < fadeTop) {
          const wAlpha = (f - cutThresh) / Math.max(1e-4, fadeTop - cutThresh);
          rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * wAlpha);
        }
      }
    }
  }
}

export function cleanBorderClippedAlpha(
  rgba,
  w,
  h,
  { allowWatershed = true, allowMarginFallback = true, softFloorStain = false } = {},
) {
  const n = w * h;
  const isOp = new Uint8Array(n);
  let totalOp = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] >= 28) {
      isOp[i] = 1;
      totalOp++;
    }
  }
  if (totalOp === 0) return { removedPct: 0, method: 'empty' };

  const q = new Int32Array(n);
  const labelComps = (mask, borderPad) => {
    const cidArr = new Int32Array(n);
    const sizes = [0];
    const touches = [false];
    const minMargin = [Infinity];
    let cid = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i] || cidArr[i]) continue;
      cid++;
      let qh = 0;
      let qt = 0;
      let tb = false;
      let mm = Infinity;
      cidArr[i] = cid;
      q[qt++] = i;
      while (qh < qt) {
        const c = q[qh++];
        const cx = c % w;
        const cy = (c / w) | 0;
        const dE = Math.min(cx, w - 1 - cx, cy, h - 1 - cy);
        if (dE < mm) mm = dE;
        if (dE <= borderPad) tb = true;
        if (cx > 0 && mask[c - 1] && !cidArr[c - 1]) { cidArr[c - 1] = cid; q[qt++] = c - 1; }
        if (cx + 1 < w && mask[c + 1] && !cidArr[c + 1]) { cidArr[c + 1] = cid; q[qt++] = c + 1; }
        if (cy > 0 && mask[c - w] && !cidArr[c - w]) { cidArr[c - w] = cid; q[qt++] = c - w; }
        if (cy + 1 < h && mask[c + w] && !cidArr[c + w]) { cidArr[c + w] = cid; q[qt++] = c + w; }
      }
      sizes.push(qt);
      touches.push(tb);
      minMargin.push(mm);
    }
    return { cidArr, sizes, touches, minMargin, count: cid };
  };

  const p1 = labelComps(isOp, 2);
  let bigBorderCount = 0;
  let removedP1 = 0;
  const killMax = totalOp * (allowWatershed ? 0.40 : 0.25);
  for (let c = 1; c <= p1.count; c++) {
    if (p1.touches[c]) {
      if (p1.sizes[c] < killMax) {
        p1.touches[c] = -1;
        removedP1 += p1.sizes[c];
      } else {
        bigBorderCount++;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const c = p1.cidArr[i];
    if (c && p1.touches[c] === -1) {
      isOp[i] = 0;
      rgba[i * 4 + 3] = 0;
    }
  }
  if (bigBorderCount === 0) {
    if (softFloorStain) {
      applyOrganicMarginFade(rgba, isOp, w, h, {
        marginFrac: 0.16,
        noiseAmp: 0.78,
        cutThresh: 0.28,
        fadeTop: 1.05,
        radialWeight: 0.55,
      });
      let keptStain = 0;
      for (let i = 0; i < n; i++) if (isOp[i]) keptStain++;
      return { removedPct: +(((totalOp - keptStain) / totalOp) * 100).toFixed(1), method: 'pass1_cc+soft_stain' };
    }
    return { removedPct: +((removedP1 / totalOp) * 100).toFixed(1), method: 'pass1_cc' };
  }
  if (!allowWatershed) {
    return { removedPct: +((removedP1 / totalOp) * 100).toFixed(1), method: 'pass1_only_kept_big' };
  }

  const distBg = new Uint16Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if (!isOp[i]) {
      distBg[i] = 0;
      q[qt++] = i;
    } else {
      distBg[i] = 65535;
    }
  }
  while (qh < qt) {
    const c = q[qh++];
    const d = distBg[c] + 1;
    const cx = c % w;
    const cy = (c / w) | 0;
    if (cx > 0 && distBg[c - 1] > d) { distBg[c - 1] = d; q[qt++] = c - 1; }
    if (cx + 1 < w && distBg[c + 1] > d) { distBg[c + 1] = d; q[qt++] = c + 1; }
    if (cy > 0 && distBg[c - w] > d) { distBg[c - w] = d; q[qt++] = c - w; }
    if (cy + 1 < h && distBg[c + w] > d) { distBg[c + w] = d; q[qt++] = c + w; }
  }

  const hist = new Uint32Array(64);
  let remOp = 0;
  for (let i = 0; i < n; i++) {
    if (isOp[i]) {
      hist[Math.min(63, distBg[i])]++;
      remOp++;
    }
  }
  let acc = 0;
  let p75 = 0;
  for (let b = 0; b < 64; b++) {
    acc += hist[b];
    if (acc >= remOp * 0.75) {
      p75 = b;
      break;
    }
  }

  if (p75 >= 7) {
    for (const r of [6, 7, 8, 9]) {
      const core = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (isOp[i] && distBg[i] > r) core[i] = 1;
      const cc = labelComps(core, r + 4);
      const owner = new Int8Array(n);
      qh = 0;
      qt = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!isOp[i]) continue;
          const id = cc.cidArr[i];
          if (id > 0) {
            owner[i] = cc.touches[id] ? -1 : 1;
            q[qt++] = i;
          } else if (x <= 3 || x >= w - 4 || y <= 3 || y >= h - 4) {
            owner[i] = -1;
            q[qt++] = i;
          }
        }
      }
      while (qh < qt) {
        const c = q[qh++];
        const ow = owner[c];
        const cx = c % w;
        const cy = (c / w) | 0;
        if (cx > 0 && isOp[c - 1] && owner[c - 1] === 0) { owner[c - 1] = ow; q[qt++] = c - 1; }
        if (cx + 1 < w && isOp[c + 1] && owner[c + 1] === 0) { owner[c + 1] = ow; q[qt++] = c + 1; }
        if (cy > 0 && isOp[c - w] && owner[c - w] === 0) { owner[c - w] = ow; q[qt++] = c - w; }
        if (cy + 1 < h && isOp[c + w] && owner[c + w] === 0) { owner[c + w] = ow; q[qt++] = c + w; }
      }
      let keptTmp = 0;
      for (let i = 0; i < n; i++) if (isOp[i] && owner[i] === 1) keptTmp++;
      if (keptTmp >= remOp * 0.45) {
        for (let i = 0; i < n; i++) {
          if (isOp[i] && owner[i] !== 1) {
            isOp[i] = 0;
            rgba[i * 4 + 3] = 0;
          }
        }
        const p3 = labelComps(isOp, 4);
        const outerBand = Math.round(Math.min(w, h) * 0.16);
        const tinyCut = totalOp * 0.006;
        for (let c = 1; c <= p3.count; c++) {
          if (p3.touches[c] || (p3.minMargin[c] < outerBand && p3.sizes[c] < tinyCut)) {
            p3.touches[c] = -1;
          }
        }
        let finalKept = 0;
        for (let i = 0; i < n; i++) {
          const c = p3.cidArr[i];
          if (c && p3.touches[c] === -1) {
            isOp[i] = 0;
            rgba[i * 4 + 3] = 0;
          } else if (isOp[i]) {
            finalKept++;
          }
        }
        return { removedPct: +(((totalOp - finalKept) / totalOp) * 100).toFixed(1), method: `watershed_r${r}` };
      }
    }
  }

  if (!allowMarginFallback) return { removedPct: 0, method: 'skipped' };

  applyOrganicMarginFade(rgba, isOp, w, h, {
    marginFrac: 0.09,
    noiseAmp: 0.7,
    cutThresh: 0.45,
    fadeTop: 0.95,
    radialWeight: 0,
  });
  const p3 = labelComps(isOp, 3);
  const outerBand = Math.round(Math.min(w, h) * 0.10);
  for (let c = 1; c <= p3.count; c++) {
    if (p3.touches[c] || (p3.minMargin[c] < outerBand && p3.sizes[c] < totalOp * 0.002)) {
      p3.touches[c] = -1;
    }
  }
  let finalKept = 0;
  for (let i = 0; i < n; i++) {
    const c = p3.cidArr[i];
    if (c && p3.touches[c] === -1) {
      isOp[i] = 0;
      rgba[i * 4 + 3] = 0;
    } else if (isOp[i]) {
      finalKept++;
    }
  }
  return { removedPct: +(((totalOp - finalKept) / totalOp) * 100).toFixed(1), method: 'thin_margin' };
}

export function dilateAlphaEdgesLocal(rgba, width, height, iterations = 16) {
  let src = new Uint8Array(rgba);
  let dst = new Uint8Array(rgba);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = src[i * 4 + 3] >= 32 ? 1 : 0;
  for (let pass = 0; pass < iterations; pass++) {
    dst.set(src);
    const nextFilled = new Uint8Array(filled);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (filled[idx]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let cnt = 0;
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

async function applyBuilt() {
  const ROOT = fileURLToPath(new URL('../', import.meta.url));
  const folDir = path.join(ROOT, 'built', 'pbr_foliage');
  const decDir = path.join(ROOT, 'built', 'pbr_decals');
  const folTbl = JSON.parse(await readFile(path.join(folDir, 'pbr_foliage_table.json'), 'utf8'));
  const decTbl = JSON.parse(await readFile(path.join(decDir, 'pbr_decals_table.json'), 'utf8'));

  let folModified = 0;
  for (const it of folTbl.items || []) {
    const colPath = path.join(folDir, it.id, 'color.png');
    const { data, info } = await sharp(colPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const buf = new Uint8Array(data);
    const res = cleanBorderClippedAlpha(buf, info.width, info.height, {
      allowWatershed: true,
      allowMarginFallback: true,
    });
    if (res.removedPct > 0) {
      dilateAlphaEdgesLocal(buf, info.width, info.height, 16);
      await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(colPath);
      folModified++;
      console.log(`[foliage] ${it.id} (${res.method}): pruned ${res.removedPct}%`);
    }
  }

  let decModified = 0;
  for (const it of decTbl.items || []) {
    if (it.placement === 'wall' || it.category === 'leak' || it.category === 'tire_skid') continue;
    const colPath = path.join(decDir, it.id, 'color.png');
    const { data, info } = await sharp(colPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const buf = new Uint8Array(data);
    const res = cleanBorderClippedAlpha(buf, info.width, info.height, {
      allowWatershed: false,
      allowMarginFallback: false,
      softFloorStain: it.id === 'decal_mud_stain',
    });
    if (res.removedPct > 0) {
      dilateAlphaEdgesLocal(buf, info.width, info.height, 16);
      await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(colPath);
      decModified++;
      console.log(`[decal] ${it.id} (${res.method}): pruned ${res.removedPct}%`);
    }
  }
  console.log(`[decal:alpha-clean] Done: foliage=${folModified}/${folTbl.items.length}, decals=${decModified}/${decTbl.items.length}`);
}

if (process.argv.includes('--apply-built')) {
  applyBuilt().catch((err) => {
    console.error('[decal:alpha-clean] FAILED:', err);
    process.exit(1);
  });
}

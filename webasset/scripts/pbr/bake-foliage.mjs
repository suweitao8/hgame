import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import AdmZip from 'adm-zip';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'assets', 'foliage', 'foliage.manifest.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'pbr-raw', '_foliage');
const UA = { 'User-Agent': 'WebAsset-Foliage-Pipeline/2.0' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAmbientCgSheet(assetId) {
  const dir = path.join(CACHE_DIR, assetId);
  const metaPath = path.join(dir, 'meta.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (meta.color && existsSync(path.join(dir, meta.color))) {
      return { dir, meta, cached: true };
    }
  }
  await mkdir(dir, { recursive: true });
  const detail = await fetchJson(
    `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(assetId)}&include=downloadData`
  );
  const downloads = detail?.foundAssets?.[0]?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads || [];
  const chosen =
    downloads.find(d => d.attribute === '1K-PNG') ||
    downloads.find(d => d.attribute === '1K-JPG') ||
    downloads[0];
  if (!chosen) throw new Error(`No 1K zip for ambientCG foliage ${assetId}`);

  const res = await fetch(chosen.downloadLink, { headers: UA });
  if (!res.ok) throw new Error(`Zip download failed HTTP ${res.status} for ${assetId}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const saved = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const base = path.basename(entry.entryName);
    const extMatch = /\.(png|jpg|jpeg)$/i.exec(base);
    if (!extMatch) continue;
    const ext = extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase();
    if (/_Color\.(png|jpg|jpeg)$/i.test(base)) {
      const f = `color.${ext}`;
      await writeFile(path.join(dir, f), entry.getData());
      saved.color = f;
    } else if (/_Opacity\.(png|jpg|jpeg)$/i.test(base)) {
      const f = `opacity.${ext}`;
      await writeFile(path.join(dir, f), entry.getData());
      saved.opacity = f;
    }
  }
  if (!saved.color) throw new Error(`No _Color map inside ${assetId}`);
  const meta = {
    assetId,
    source: 'ambientcg',
    license: 'CC0',
    sourceUrl: `https://ambientcg.com/view?id=${assetId}`,
    ...saved,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  await sleep(150);
  return { dir, meta, cached: false };
}

async function loadSheetRgba(dir, meta) {
  const { data: colBuf, info } = await sharp(path.join(dir, meta.color))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(colBuf.buffer, colBuf.byteOffset, colBuf.byteLength);
  if (meta.opacity && existsSync(path.join(dir, meta.opacity))) {
    const { data: opBuf } = await sharp(path.join(dir, meta.opacity))
      .resize(info.width, info.height, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let p = 0; p < info.width * info.height; p++) {
      rgba[p * 4 + 3] = opBuf[p];
    }
  } else {
    // Fallback mask if an asset omitted separate _Opacity: key near-black empty void
    for (let p = 0; p < info.width * info.height; p++) {
      const i = p * 4;
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (rgba[i + 3] === 255 && lum < 12) rgba[i + 3] = 0;
    }
  }
  return { rgba, width: info.width, height: info.height };
}

function findOpaqueBounds(rgba, w, h, threshold = 96) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { left: 0, top: 0, width: w, height: h };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function extractSpriteRegion(rgba, srcW, srcH, tileSize, slotDef, slotIdx) {
  // Check if asset has grid of discrete sprites (like FlowerSet001, LeafSet030, LeafSet029)
  // or dense continuous clump (Foliage001, Foliage003, Foliage008, LeafSet019).
  let rx = 0, ry = 0, rw = srcW, rh = srcH;
  if (slotDef.slot.startsWith('flower_')) {
    // FlowerSet001 has 3x2 daisy flower heads; grab top-left flower head and mount onto upright green stem!
    const fw = Math.floor(srcW * 0.34), fh = Math.floor(srcH * 0.48);
    const fx = (slotIdx % 3) * Math.floor(srcW * 0.33);
    const fy = Math.floor(srcH * 0.02);
    const flowerRaw = await sharp(Buffer.from(rgba), { raw: { width: srcW, height: srcH, channels: 4 } })
      .extract({ left: Math.min(srcW - fw, fx), top: fy, width: fw, height: fh })
      .raw().toBuffer({ resolveWithObject: true });
    const fBounds = findOpaqueBounds(flowerRaw.data, flowerRaw.info.width, flowerRaw.info.height, 80);
    const headSize = Math.round(tileSize * 0.44);
    const headBuf = await sharp(flowerRaw.data, { raw: { width: flowerRaw.info.width, height: flowerRaw.info.height, channels: 4 } })
      .extract(fBounds)
      .resize(headSize, headSize, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
      .raw().toBuffer({ resolveWithObject: true });

    const out = new Uint8Array(tileSize * tileSize * 4);
    // Tint flower petals while preserving golden center
    const [tr, tg, tb] = slotDef.petalTint || [1, 1, 1];
    const hw = headBuf.info.width, hh = headBuf.info.height;
    // Draw upright organic stem + two leaves first, bottom rooted to y = tileSize - 1
    const stemTopY = Math.round(tileSize * 0.34);
    const cx = Math.round(tileSize * 0.5);
    for (let y = stemTopY; y < tileSize; y++) {
      const t = (y - stemTopY) / Math.max(1, tileSize - stemTopY);
      const sx = cx + Math.sin(t * 2.5) * 4;
      for (let dx = -4; dx <= 4; dx++) {
        const px = Math.round(sx + dx);
        if (px < 0 || px >= tileSize) continue;
        const idx = (y * tileSize + px) * 4;
        out[idx] = 56; out[idx + 1] = Math.round(112 + (1 - t) * 24); out[idx + 2] = 40; out[idx + 3] = 255;
      }
      // Small side leaves near bottom third
      if (t > 0.52 && t < 0.78) {
        const span = Math.round(Math.sin((t - 0.52) / 0.26 * Math.PI) * tileSize * 0.14);
        for (let k = 0; k <= span; k++) {
          const lx = Math.round(sx + (t < 0.65 ? k : -k));
          if (lx >= 0 && lx < tileSize) {
            const idx = (y * tileSize + lx) * 4;
            out[idx] = 64; out[idx + 1] = 132; out[idx + 2] = 48; out[idx + 3] = 255;
          }
        }
      }
    }
    const offX = Math.floor((tileSize - hw) * 0.5);
    const offY = Math.max(4, stemTopY - Math.round(hh * 0.52));
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const si = (y * hw + x) * 4;
        const a = headBuf.data[si + 3];
        if (a < 32) continue;
        let r = headBuf.data[si], g = headBuf.data[si + 1], b = headBuf.data[si + 2];
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        if (maxC > 130 && sat < 0.38) {
          r = Math.min(255, Math.round(r * tr));
          g = Math.min(255, Math.round(g * tg));
          b = Math.min(255, Math.round(b * tb));
        }
        const di = ((offY + y) * tileSize + (offX + x)) * 4;
        out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
      }
    }
    return out;
  }

  // Rotate horizontal strand textures (Foliage008 / LeafSet019) upright by -90 deg
  let workRgba = rgba;
  let wW = srcW, wH = srcH;
  if (slotDef.slot === 'grass_tall' || slotDef.slot === 'fern') {
    const rot = await sharp(Buffer.from(rgba), { raw: { width: srcW, height: srcH, channels: 4 } })
      .rotate(-90)
      .raw()
      .toBuffer({ resolveWithObject: true });
    workRgba = new Uint8Array(rot.data.buffer, rot.data.byteOffset, rot.data.byteLength);
    wW = rot.info.width;
    wH = rot.info.height;
  }

  // Crop single representative botanical stem/clump sub-tile for sheets with spaced sprigs
  if (slotDef.slot === 'fern' || slotDef.slot === 'vine_hanging' || slotDef.slot === 'dead_bush') {
    rx = Math.floor(wW * 0.05); ry = Math.floor(wH * 0.05);
    rw = Math.floor(wW * 0.45); rh = Math.floor(wH * 0.55);
  } else if (slotDef.slot.startsWith('crop_wheat_') || slotDef.slot === 'bush_berry') {
    rx = Math.floor(wW * 0.18); ry = Math.floor(wH * 0.05);
    rw = Math.floor(wW * 0.62); rh = Math.floor(wH * 0.90);
  } else {
    rx = Math.floor(wW * 0.10); ry = Math.floor(wH * 0.08);
    rw = Math.floor(wW * 0.80); rh = Math.floor(wH * 0.88);
  }

  const cropped = await sharp(Buffer.from(workRgba), { raw: { width: wW, height: wH, channels: 4 } })
    .extract({ left: rx, top: ry, width: rw, height: rh })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tighten = findOpaqueBounds(cropped.data, cropped.info.width, cropped.info.height, 70);
  const padX = Math.round(tileSize * 0.05);
  const maxDrawW = tileSize - padX * 2;
  const maxDrawH = Math.round(tileSize * 0.94);
  const scale = Math.min(maxDrawW / Math.max(1, tighten.width), maxDrawH / Math.max(1, tighten.height));
  const dw = Math.max(8, Math.round(tighten.width * scale));
  const dh = Math.max(8, Math.round(tighten.height * scale));

  const resized = await sharp(cropped.data, { raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 } })
    .extract(tighten)
    .resize(dw, dh, { kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer();

  const out = new Uint8Array(tileSize * tileSize * 4);
  const anchor = slotDef.anchor || 'bottom';
  const offX = Math.floor((tileSize - dw) * 0.5);
  const offY = anchor === 'top' ? 0 : tileSize - dh;

  for (let y = 0; y < dh; y++) {
    const dy = offY + y;
    if (dy < 0 || dy >= tileSize) continue;
    for (let x = 0; x < dw; x++) {
      const dx = offX + x;
      if (dx < 0 || dx >= tileSize) continue;
      const si = (y * dw + x) * 4;
      const di = (dy * tileSize + dx) * 4;
      out[di] = resized[si];
      out[di + 1] = resized[si + 1];
      out[di + 2] = resized[si + 2];
      out[di + 3] = resized[si + 3];
    }
  }
  return out;
}

function buildMushroomTile(slotDef, tileSize) {
  const out = new Uint8Array(tileSize * tileSize * 4);
  const [cr, cg, cb] = slotDef.capColor || [160, 100, 65];
  const stemW = tileSize * 0.13;
  const capRx = tileSize * 0.34;
  const capRy = tileSize * 0.21;
  const capCy = Math.round(tileSize * 0.62);
  const cx = tileSize * 0.5;

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const i = (y * tileSize + x) * 4;
      const dx = x - cx;
      // Stem (bottom rooted cleanly to y = tileSize - 1)
      if (y >= capCy && Math.abs(dx) <= stemW * (1 + (y - capCy) / (tileSize - capCy) * 0.15)) {
        const shade = 0.85 - 0.25 * Math.abs(dx / stemW);
        out[i] = Math.round(224 * shade);
        out[i + 1] = Math.round(212 * shade);
        out[i + 2] = Math.round(192 * shade);
        out[i + 3] = 255;
      }
      // Dome cap
      const ny = (y - capCy) / capRy;
      const nx = dx / capRx;
      if (ny <= 0.15 && (nx * nx + ny * ny) <= 1.0) {
        const light = 0.85 + 0.25 * (-ny) - 0.2 * (nx * nx);
        let r = cr * light;
        let g = cg * light;
        let b = cb * light;
        if (slotDef.spots) {
          const spot =
            Math.hypot(nx - 0.36, ny + 0.42) < 0.14 ||
            Math.hypot(nx + 0.42, ny + 0.30) < 0.12 ||
            Math.hypot(nx - 0.05, ny + 0.66) < 0.11;
          if (spot) { r = 238; g = 234; b = 224; }
        }
        out[i] = Math.max(0, Math.min(255, Math.round(r)));
        out[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
        out[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

function applyBotanicalGrading(tile, slotDef, size) {
  if (Array.isArray(slotDef.petalTint)) {
    const [tr, tg, tb] = slotDef.petalTint;
    for (let i = 0; i < tile.length; i += 4) {
      if (tile[i + 3] < 20) continue;
      const r = tile[i], g = tile[i + 1], b = tile[i + 2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      // Only re-tint bright neutral/white petals, leaving green foliage intact
      if (maxC > 135 && sat < 0.36 && g <= r * 1.08) {
        tile[i] = Math.min(255, Math.round(r * tr));
        tile[i + 1] = Math.min(255, Math.round(g * tg));
        tile[i + 2] = Math.min(255, Math.round(b * tb));
      }
    }
  }

  if (slotDef.cropStage !== undefined) {
    const stage = slotDef.cropStage;
    const hKeepFrac = [0.42, 0.66, 0.88, 1.0][stage] ?? 1.0;
    const scaleY = Math.max(0.35, hKeepFrac);
    const rescaled = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const sy = Math.round(size - 1 - (size - 1 - y) / scaleY);
      if (sy < 0 || sy >= size) continue;
      const yFrac = 1 - y / size; // 0 bottom, 1 top
      for (let x = 0; x < size; x++) {
        const si = (sy * size + x) * 4;
        const di = (y * size + x) * 4;
        if (tile[si + 3] < 20) continue;
        const ripen = stage >= 2 ? (stage === 3 ? 0.92 : 0.45 * yFrac) : 0.0;
        const r = tile[si] * (1 - ripen) + Math.min(230, tile[si] * 1.45 + 65) * ripen;
        const g = tile[si + 1] * (1 - ripen) + Math.min(210, tile[si + 1] * 1.2 + 45) * ripen;
        const b = tile[si + 2] * (1 - ripen) + tile[si + 2] * 0.48 * ripen;
        rescaled[di] = Math.min(255, Math.round(r));
        rescaled[di + 1] = Math.min(255, Math.round(g));
        rescaled[di + 2] = Math.min(255, Math.round(b));
        rescaled[di + 3] = tile[si + 3];
      }
    }
    tile.set(rescaled);
  }

  if (slotDef.berries) {
    const berryPts = [
      [0.28, 0.34], [0.44, 0.25], [0.64, 0.31], [0.72, 0.48],
      [0.36, 0.56], [0.55, 0.46], [0.24, 0.68], [0.66, 0.64],
    ];
    for (const [bxn, byn] of berryPts) {
      const bx = Math.round(bxn * size), by = Math.round(byn * size);
      const rPx = Math.max(4, Math.round(size * 0.025));
      for (let dy = -rPx; dy <= rPx; dy++) {
        for (let dx = -rPx; dx <= rPx; dx++) {
          const dist = Math.hypot(dx, dy);
          if (dist > rPx) continue;
          const x = bx + dx, y = by + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const i = (y * size + x) * 4;
          if (tile[i + 3] < 120) continue;
          const hi = dist < rPx * 0.45 ? 1.15 : 0.85;
          tile[i] = Math.min(255, Math.round(196 * hi));
          tile[i + 1] = Math.min(255, Math.round(36 * hi));
          tile[i + 2] = Math.min(255, Math.round(48 * hi));
        }
      }
    }
  }

  if (Array.isArray(slotDef.tint)) {
    const [tr, tg, tb] = slotDef.tint;
    for (let i = 0; i < tile.length; i += 4) {
      if (tile[i + 3] < 10) continue;
      tile[i] = Math.min(255, Math.round(tile[i] * tr));
      tile[i + 1] = Math.min(255, Math.round(tile[i + 1] * tg));
      tile[i + 2] = Math.min(255, Math.round(tile[i + 2] * tb));
    }
  }
}

function dilateAlphaEdges(rgba, w, h, iterations = 16) {
  let curr = new Uint8Array(rgba);
  let next = new Uint8Array(rgba);
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  // Mask of "has valid RGB color" starts with alpha > 24
  let valid = new Uint8Array(w * h);
  let nextValid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (curr[p * 4 + 3] > 24) valid[p] = 1;
  }

  for (let it = 0; it < iterations; it++) {
    next.set(curr);
    nextValid.set(valid);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (valid[p]) continue;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (const [ox, oy] of neighbors) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const np = ny * w + nx;
          if (!valid[np]) continue;
          const ni = np * 4;
          sr += curr[ni];
          sg += curr[ni + 1];
          sb += curr[ni + 2];
          cnt++;
        }
        if (cnt > 0) {
          const di = p * 4;
          next[di] = Math.round(sr / cnt);
          next[di + 1] = Math.round(sg / cnt);
          next[di + 2] = Math.round(sb / cnt);
          // Keep original alpha === 0 untouched so cutout stays cutout, only fill RGB halo!
          nextValid[p] = 1;
        }
      }
    }
    [curr, next] = [next, curr];
    [valid, nextValid] = [nextValid, valid];
  }
  rgba.set(curr);
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const tileSize = manifest.tileSize || 256;
  const cols = manifest.gridCols || 4;
  const rows = manifest.gridRows || 4;
  const dilationIters = manifest.dilationIterations ?? 16;

  const sheetCache = new Map();
  const licenses = [];
  for (const s of manifest.slots) {
    if (s.shapeMode === 'mushroom') continue;
    if (!sheetCache.has(s.assetId)) {
      const { dir, meta } = await fetchAmbientCgSheet(s.assetId);
      const sheet = await loadSheetRgba(dir, meta);
      sheetCache.set(s.assetId, { meta, sheet });
      licenses.push({ assetId: s.assetId, source: meta.source, license: meta.license, sourceUrl: meta.sourceUrl });
    }
  }

  const atlasW = cols * tileSize;
  const atlasH = rows * tileSize;
  const atlas = new Uint8Array(atlasW * atlasH * 4);
  const tableSlots = [];

  for (let i = 0; i < manifest.slots.length; i++) {
    const slotDef = manifest.slots[i];
    let tile;
    if (slotDef.shapeMode === 'mushroom') {
      tile = buildMushroomTile(slotDef, tileSize);
    } else {
      const { sheet } = sheetCache.get(slotDef.assetId);
      tile = await extractSpriteRegion(sheet.rgba, sheet.width, sheet.height, tileSize, slotDef, i);
      if (!slotDef.slot.startsWith('flower_')) {
        applyBotanicalGrading(tile, slotDef, tileSize);
      }
    }

    dilateAlphaEdges(tile, tileSize, tileSize, dilationIters);

    const col = i % cols;
    const row = Math.floor(i / cols);
    for (let y = 0; y < tileSize; y++) {
      const srcRow = y * tileSize * 4;
      const dstIdx = ((row * tileSize + y) * atlasW + col * tileSize) * 4;
      atlas.set(tile.subarray(srcRow, srcRow + tileSize * 4), dstIdx);
    }

    tableSlots.push({
      index: i,
      slot: slotDef.slot,
      name: slotDef.name,
      assetId: slotDef.assetId,
      anchor: slotDef.anchor || 'bottom',
      mesh: slotDef.mesh || 'cross_quad',
      heightScale: slotDef.heightScale ?? 1.0,
      uvRect: [col / cols, 1 - (row + 1) / rows, 1 / cols, 1 / rows],
      gridCol: col,
      gridRow: row,
    });
  }

  const outAtlasPath = path.join(ROOT, manifest.outputAtlas);
  const outTablePath = path.join(ROOT, manifest.outputTable);
  await mkdir(path.dirname(outAtlasPath), { recursive: true });

  await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 4 } })
    .webp({ lossless: true, effort: 4 })
    .toFile(outAtlasPath);

  const tableJson = {
    version: manifest.version,
    atlasUrl: '/assets/pbr/foliage/foliage_albedo.webp',
    tileSize,
    gridCols: cols,
    gridRows: rows,
    dilationIterations: dilationIters,
    allCC0: true,
    licenses,
    slots: tableSlots,
  };
  await writeFile(outTablePath, JSON.stringify(tableJson, null, 2) + '\n');

  const kb = ((await import('node:fs/promises')).stat(outAtlasPath).then(s => (s.size / 1024).toFixed(1)));
  console.log(`[bake-foliage] Wrote ${manifest.outputAtlas} (${atlasW}x${atlasH}, ${tableSlots.length} slots, ${await kb} KB)`);
}

main().catch(err => {
  console.error('[bake-foliage] FAILED:', err);
  process.exit(1);
});

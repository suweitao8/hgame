import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm as fsRm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'assets', 'pbr', 'materials.manifest.json');
const CACHE_RAW = path.join(ROOT, '.cache', 'pbr-raw');
const HDRI_CACHE = path.join(CACHE_RAW, '_hdri');
const PUBLIC_PBR = path.join(ROOT, 'public', 'assets', 'pbr');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function createMissingLayer(size) {
  const count = size * size;
  const albedo = new Uint8Array(count * 4);
  const normal = new Uint8Array(count * 4);
  const rm = new Uint8Array(count * 4);
  const cell = Math.max(4, Math.floor(size / 8));

  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell);
      const isMagenta = ((cx + cy) & 1) === 0;
      const i = (y * size + x) * 4;
      albedo[i] = isMagenta ? 255 : 20;
      albedo[i + 1] = isMagenta ? 0 : 20;
      albedo[i + 2] = isMagenta ? 255 : 20;
      albedo[i + 3] = 255;

      normal[i] = 128;
      normal[i + 1] = 128;
      normal[i + 2] = 255;
      normal[i + 3] = 255;

      // RM: R=Roughness(220), G=Metallic(0), B=0, A=255
      rm[i] = 220;
      rm[i + 1] = 0;
      rm[i + 2] = 0;
      rm[i + 3] = 255;
    }
  }
  return { albedo, normal, rm };
}

async function resizeToroidal(filePath, size, { grayscale = false } = {}) {
  // Always resize as RGBA (4ch) so single-channel opacity/roughness maps use identical toroidal filter & alignment as albedo.
  let pipeline = sharp(filePath);
  if (grayscale) pipeline = pipeline.removeAlpha().grayscale().toColorspace('srgb');
  pipeline = pipeline.ensureAlpha();
  const { data: src, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const padX = Math.min(32, Math.max(8, Math.round(w / 32)));
  const padY = Math.min(32, Math.max(8, Math.round(h / 32)));
  const pw = w + padX * 2;
  const ph = h + padY * 2;
  const padded = Buffer.allocUnsafe(pw * ph * ch);

  for (let y = 0; y < ph; y++) {
    const sy = ((y - padY) % h + h) % h;
    for (let x = 0; x < pw; x++) {
      const sx = ((x - padX) % w + w) % w;
      const si = (sy * w + sx) * ch;
      const di = (y * pw + x) * ch;
      for (let c = 0; c < ch; c++) padded[di + c] = src[si + c];
    }
  }

  const outPadX = Math.round((padX * size) / w);
  const outPadY = Math.round((padY * size) / h);
  const outW = size + outPadX * 2;
  const outH = size + outPadY * 2;

  const { data } = await sharp(padded, { raw: { width: pw, height: ph, channels: ch } })
    .resize(outW, outH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .extract({ left: outPadX, top: outPadY, width: size, height: size })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (grayscale) {
    const out = new Uint8Array(size * size);
    for (let p = 0; p < size * size; p++) out[p] = data[p * ch];
    return out;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function resizeRgba(filePath, size) {
  return resizeToroidal(filePath, size, { grayscale: false });
}

async function resizeGray(filePath, size) {
  return resizeToroidal(filePath, size, { grayscale: true });
}

function equalizePeriodicLighting(albedo, size, strength = 0.65) {
  // Periodic toroidal box blur (2 passes) cancels only broad photo-scan lighting drift
  // while keeping 100% of real scanned micro-texture crisp and seamless.
  const n = size * size;
  const lum = new Float32Array(n);
  let meanLum = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const l = 0.2126 * albedo[p] + 0.7152 * albedo[p + 1] + 0.0722 * albedo[p + 2];
    lum[i] = l;
    meanLum += l;
  }
  meanLum /= Math.max(1, n);
  if (meanLum < 12) return;

  const r = Math.max(8, Math.floor(size / 5));
  const diam = r * 2 + 1;
  const tmp = new Float32Array(n);
  const blur = new Float32Array(n);

  const passH = (src, dst) => {
    for (let y = 0; y < size; y++) {
      let acc = 0;
      const row = y * size;
      for (let k = -r; k <= r; k++) acc += src[row + ((k + size) % size)];
      for (let x = 0; x < size; x++) {
        dst[row + x] = acc / diam;
        const addX = (x + r + 1) % size;
        const subX = (x - r + size) % size;
        acc += src[row + addX] - src[row + subX];
      }
    }
  };
  const passV = (src, dst) => {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[((k + size) % size) * size + x];
      for (let y = 0; y < size; y++) {
        dst[y * size + x] = acc / diam;
        const addY = (y + r + 1) % size;
        const subY = (y - r + size) % size;
        acc += src[addY * size + x] - src[subY * size + x];
      }
    }
  };

  passH(lum, tmp);
  passV(tmp, blur);
  passH(blur, tmp);
  passV(tmp, blur);

  for (let i = 0; i < n; i++) {
    const local = Math.max(8, blur[i]);
    const ratio = Math.max(0.74, Math.min(1.34, meanLum / local));
    const gain = 1 + (ratio - 1) * strength;
    const p = i * 4;
    albedo[p] = Math.min(255, Math.max(0, Math.round(albedo[p] * gain)));
    albedo[p + 1] = Math.min(255, Math.max(0, Math.round(albedo[p + 1] * gain)));
    albedo[p + 2] = Math.min(255, Math.max(0, Math.round(albedo[p + 2] * gain)));
  }
}

function normalizeNormalBuffer(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    let nx = buf[i] / 127.5 - 1;
    let ny = buf[i + 1] / 127.5 - 1;
    let nz = buf[i + 2] / 127.5 - 1;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-4) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }
    buf[i] = Math.round(clamp01((nx + 1) * 0.5) * 255);
    buf[i + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);
    buf[i + 2] = Math.round(clamp01((nz + 1) * 0.5) * 255);
    buf[i + 3] = 255;
  }
}

function dilateAlphaEdges(rgba, size, iterations = 12) {
  let src = new Uint8Array(rgba);
  let dst = new Uint8Array(rgba);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < filled.length; i++) {
    filled[i] = src[i * 4 + 3] >= 128 ? 1 : 0;
  }
  for (let pass = 0; pass < iterations; pass++) {
    dst.set(src);
    const nextFilled = new Uint8Array(filled);
    let changed = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (filled[idx]) continue;
        let r = 0, g = 0, b = 0, cnt = 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const nIdx = ny * size + nx;
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

async function bakeSingleSlot(entry, size) {
  const slotDir = path.join(CACHE_RAW, entry.slot);
  const metaPath = path.join(slotDir, 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`Missing raw cache for slot "${entry.slot}" (${metaPath}). Run npm run tex:fetch first.`);
  }
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const files = meta.files || {};

  const albedo = await resizeRgba(path.join(slotDir, files.albedo), size);
  if ((entry.tiling === 'stochastic' || entry.slot.startsWith('bark_')) && !entry.alphaCutout) {
    equalizePeriodicLighting(albedo, size, entry.slot.startsWith('bark_') ? 0.78 : 0.68);
  }
  if (entry.alphaCutout === true && files.opacity) {
    const op = await resizeGray(path.join(slotDir, files.opacity), size);
    for (let p = 0; p < size * size; p++) {
      albedo[p * 4 + 3] = op[p];
    }
  } else if (!entry.alphaCutout) {
    for (let p = 0; p < size * size; p++) {
      albedo[p * 4 + 3] = 255;
    }
  }
  if (entry.alphaCutout === true) {
    dilateAlphaEdges(albedo, size, 12);
  }

  let normal;
  if (files.normal) {
    normal = await resizeRgba(path.join(slotDir, files.normal), size);
    normalizeNormalBuffer(normal);
  } else {
    normal = new Uint8Array(size * size * 4);
    for (let i = 0; i < normal.length; i += 4) {
      normal[i] = 128;
      normal[i + 1] = 128;
      normal[i + 2] = 255;
      normal[i + 3] = 255;
    }
  }

  let rm;
  if (files.arm) {
    const arm = await resizeRgba(path.join(slotDir, files.arm), size);
    rm = new Uint8Array(size * size * 4);
    for (let i = 0; i < rm.length; i += 4) {
      rm[i] = arm[i + 1];     // Roughness
      rm[i + 1] = arm[i + 2]; // Metallic
      rm[i + 2] = 0;
      rm[i + 3] = 255;
    }
  } else {
    const rough = files.rough ? await resizeGray(path.join(slotDir, files.rough), size) : null;
    const metal = files.metal ? await resizeGray(path.join(slotDir, files.metal), size) : null;
    rm = new Uint8Array(size * size * 4);
    for (let p = 0; p < size * size; p++) {
      const i = p * 4;
      rm[i] = rough ? rough[p] : 215;
      rm[i + 1] = metal ? metal[p] : 0;
      rm[i + 2] = 0;
      rm[i + 3] = 255;
    }
  }

  return { albedo, normal, rm, meta };
}

function blendLayersByMask(baseLayer, topLayer, mask, size, aoMod = null) {
  const count = size * size;
  const albedo = new Uint8Array(count * 4);
  const normal = new Uint8Array(count * 4);
  const rm = new Uint8Array(count * 4);

  for (let p = 0; p < count; p++) {
    const m = mask[p];
    const inv = 1 - m;
    const i = p * 4;

    const shade = aoMod ? aoMod[p] : 1;
    albedo[i] = Math.round((baseLayer.albedo[i] * inv + topLayer.albedo[i] * m) * shade);
    albedo[i + 1] = Math.round((baseLayer.albedo[i + 1] * inv + topLayer.albedo[i + 1] * m) * shade);
    albedo[i + 2] = Math.round((baseLayer.albedo[i + 2] * inv + topLayer.albedo[i + 2] * m) * shade);
    albedo[i + 3] = 255;

    const bnx = baseLayer.normal[i] / 127.5 - 1;
    const bny = baseLayer.normal[i + 1] / 127.5 - 1;
    const bnz = baseLayer.normal[i + 2] / 127.5 - 1;
    const tnx = topLayer.normal[i] / 127.5 - 1;
    const tny = topLayer.normal[i + 1] / 127.5 - 1;
    const tnz = topLayer.normal[i + 2] / 127.5 - 1;
    let nx = bnx * inv + tnx * m;
    let ny = bny * inv + tny * m;
    let nz = bnz * inv + tnz * m;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    normal[i] = Math.round(clamp01((nx + 1) * 0.5) * 255);
    normal[i + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);
    normal[i + 2] = Math.round(clamp01((nz + 1) * 0.5) * 255);
    normal[i + 3] = 255;

    rm[i] = Math.round(baseLayer.rm[i] * inv + topLayer.rm[i] * m);
    rm[i + 1] = Math.round(baseLayer.rm[i + 1] * inv + topLayer.rm[i + 1] * m);
    rm[i + 2] = 0;
    rm[i + 3] = 255;
  }

  return { albedo, normal, rm };
}

function bakeTopOverSide(comp, layerBySlot, size) {
  const topLayer = layerBySlot.get(comp.top);
  const bottomLayer = layerBySlot.get(comp.bottom);
  if (!topLayer || !bottomLayer) {
    throw new Error(`Composite "${comp.slot}" references missing slot "${comp.top}" or "${comp.bottom}"`);
  }
  const coverage = comp.coverage ?? 0.30;
  const waveAmp = comp.waveAmp ?? 0.08;
  const feather = 0.035;
  const mask = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const yNorm = y / Math.max(1, size - 1);
    for (let x = 0; x < size; x++) {
      const xNorm = x / size;
      // Periodic harmonic wave ensures left-right seamless tiling
      const wave =
        0.55 * Math.sin(xNorm * Math.PI * 2 * 3) +
        0.30 * Math.sin(xNorm * Math.PI * 2 * 5 + 1.3) +
        0.15 * Math.cos(xNorm * Math.PI * 2 * 8 + 2.7);
      const edge = coverage + wave * waveAmp;
      mask[y * size + x] = smoothstep(edge + feather, edge - feather, yNorm);
    }
  }
  return blendLayersByMask(bottomLayer, topLayer, mask, size);
}

function bakeOreVein(comp, layerBySlot, size) {
  const baseLayer = layerBySlot.get(comp.base);
  const veinLayer = layerBySlot.get(comp.vein);
  if (!baseLayer || !veinLayer) {
    throw new Error(`Composite "${comp.slot}" references missing slot "${comp.base}" or "${comp.vein}"`);
  }
  const rng = mulberry32(comp.seed ?? 101);
  const blotches = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    blotches.push({
      cx: 0.1 + rng() * 0.8,
      cy: 0.1 + rng() * 0.8,
      rx: 0.055 + rng() * 0.05,
      ry: 0.045 + rng() * 0.05,
      rot: rng() * Math.PI * 2,
      a2: 0.14 + rng() * 0.16,
      p2: rng() * Math.PI * 2,
      a3: 0.08 + rng() * 0.14,
      p3: rng() * Math.PI * 2,
    });
  }

  const mask = new Float32Array(size * size);
  const aoMod = new Float32Array(size * size);
  aoMod.fill(1);
  const aaWidth = Math.max(0.06, 2.0 / size);

  for (let y = 0; y < size; y++) {
    const py = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      let maxVein = 0;
      let minRim = 1;
      for (const b of blotches) {
        // Toroidal wrap distance so ore patches remain tileable
        let dx = px - b.cx;
        let dy = py - b.cy;
        if (dx > 0.5) dx -= 1;
        else if (dx < -0.5) dx += 1;
        if (dy > 0.5) dy -= 1;
        else if (dy < -0.5) dy += 1;

        const cos = Math.cos(b.rot);
        const sin = Math.sin(b.rot);
        const lx = (dx * cos + dy * sin) / b.rx;
        const ly = (-dx * sin + dy * cos) / b.ry;
        const dist = Math.hypot(lx, ly);
        if (dist > 1.8) continue;

        const ang = Math.atan2(ly, lx);
        const radMod = 1 + b.a2 * Math.cos(2 * ang + b.p2) + b.a3 * Math.sin(3 * ang + b.p3);
        const r = dist / Math.max(0.4, radMod);
        const v = smoothstep(1.0 + aaWidth, 0.88 - aaWidth, r);
        if (v > maxVein) maxVein = v;

        const rimDist = Math.abs(r - 1.04);
        if (rimDist < 0.24) {
          const dip = 1 - 0.34 * Math.exp(-(rimDist * rimDist) / (0.11 * 0.11));
          if (dip < minRim) minRim = dip;
        }
      }
      const idx = y * size + x;
      mask[idx] = maxVein;
      aoMod[idx] = Math.min(1, minRim + maxVein * 0.25);
    }
  }
  return blendLayersByMask(baseLayer, veinLayer, mask, size, aoMod);
}

function blitTile(atlas, atlasW, tile, size, col, row) {
  const ox = col * size;
  const oy = row * size;
  for (let y = 0; y < size; y++) {
    const srcStart = y * size * 4;
    const dstStart = ((oy + y) * atlasW + ox) * 4;
    atlas.set(tile.subarray(srcStart, srcStart + size * 4), dstStart);
  }
}

async function copyHdriAssets(manifest) {
  const hdriOutDir = path.join(PUBLIC_PBR, 'hdri');
  await mkdir(hdriOutDir, { recursive: true });
  const hdriTable = [];
  for (const h of manifest.hdri || []) {
    const srcHdr = path.join(HDRI_CACHE, `${h.slot}.hdr`);
    if (!existsSync(srcHdr)) {
      throw new Error(`Missing cached HDRI "${srcHdr}". Run npm run tex:fetch first.`);
    }
    const dstHdr = path.join(hdriOutDir, `${h.slot}.hdr`);
    await copyFile(srcHdr, dstHdr);
    hdriTable.push({
      slot: h.slot,
      source: h.source,
      assetId: h.assetId,
      url: `/assets/pbr/hdri/${h.slot}.hdr`,
    });
  }
  return hdriTable;
}

function buildPreviewHtml(materialTable) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>CC0 实拍 PBR 材质图集验收台 (${materialTable.layerCount} 层)</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; padding: 20px; background: #111512; color: #e4ece2; }
    header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 18px; border-bottom: 1px solid #2b362d; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 18px; }
    .controls { display: flex; gap: 10px; align-items: center; font-size: 13px; }
    select, input { background: #1b221c; color: #e4ece2; border: 1px solid #354437; border-radius: 6px; padding: 5px 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
    .card { background: #181e19; border: 1px solid #2a342c; border-radius: 8px; padding: 10px; }
    .card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; font-size: 12px; }
    .card-head strong { font-size: 14px; color: #b9e29c; }
    .card-meta { color: #95a594; font-size: 11px; margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
    .badge { background: #243026; border: 1px solid #38493b; border-radius: 4px; padding: 1px 6px; }
    .maps { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 6px; align-items: start; }
    .map-box { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #9db09a; }
    canvas { width: 100%; height: auto; aspect-ratio: 1; border-radius: 4px; border: 1px solid #2c372e; background: repeating-conic-gradient(#262b27 0% 25%, #1a1e1b 0% 50%) 50% / 14px 14px; display: block; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>CC0 实拍 PBR 材质图集验收台 · <span id="summary"></span></h1>
    </div>
    <div class="controls">
      <label>档位 <select id="res">
        <option value="256" selected>256 px (游戏标准)</option>
        <option value="1024">1024 px (原版设计)</option>
        <option value="128">128 px (Mipmap L1)</option>
        <option value="64">64 px (4× Mipmap)</option>
        <option value="16">16 px (16× Mipmap)</option>
      </select></label>
      <label>筛选 <input id="filter" type="search" placeholder="slot / assetId / tiling..."></label>
    </div>
  </header>
  <main id="grid" class="grid"></main>
  <script type="module">
    const resSel = document.getElementById('res');
    const filterEl = document.getElementById('filter');
    const gridEl = document.getElementById('grid');
    const summaryEl = document.getElementById('summary');
    const table = await fetch('./material_table.json').then(r => r.json());
    const gameRes = table.gameResolution || 256;
    summaryEl.textContent = table.layerCount + ' 层 · ' + table.gridCols + '列网格图集 · 游戏打包 ' + gameRes + 'px · RM (RG8)';

    async function loadBitmap(url) {
      const blob = await fetch(url).then(r => r.blob());
      return createImageBitmap(blob);
    }

    let currentData = null;
    async function render() {
      const targetSize = Number(resSel.value);
      const srcSize = (table.resolutions || [1024, 256]).includes(targetSize) ? targetSize : gameRes;
      if (!currentData || currentData.srcSize !== srcSize) {
        const [alb, nrm, rm] = await Promise.all([
          loadBitmap('./' + srcSize + '/albedo_atlas.webp'),
          loadBitmap('./' + srcSize + '/normal_atlas.webp'),
          loadBitmap('./' + srcSize + '/rm_atlas.webp'),
        ]);
        currentData = { srcSize, alb, nrm, rm };
      }
      const scale = targetSize / srcSize;
      const drawTile = (ctx, bmp, sx, sy, dx, dy) => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, sx, sy, srcSize, srcSize, dx, dy, targetSize, targetSize);
      };
      const q = filterEl.value.trim().toLowerCase();
      const cols = table.gridCols;
      gridEl.replaceChildren();
      for (const m of table.materials) {
        const hay = (m.slot + ' ' + m.assetId + ' ' + m.source + ' ' + m.tiling).toLowerCase();
        if (q && !hay.includes(q)) continue;
        const col = m.layer % cols;
        const row = Math.floor(m.layer / cols);
        const sx = col * srcSize;
        const sy = row * srcSize;

        const card = document.createElement('section');
        card.className = 'card';
        const isHorizOnly = m.assetId === 'top_over_side';
        const modeTag = scale < 1 ? ' [256→' + targetSize + ' Mip]' : '';
        card.innerHTML =
          '<div class="card-head"><strong>' + m.slot + '</strong><span>layer #' + m.layer + modeTag + '</span></div>' +
          '<div class="card-meta">' +
            '<span class="badge">' + m.source + ': ' + m.assetId + '</span>' +
            '<span class="badge">' + m.tiling + '</span>' +
            (m.alphaCutout ? '<span class="badge">alphaCutout</span>' : '') +
            (m.tintable ? '<span class="badge">tintable</span>' : '') +
          '</div>' +
          '<div class="maps">' +
            '<div class="map-box"><span>' + (isHorizOnly ? 'Albedo (3×1 水平平铺)' : 'Albedo (3×3 平铺)') + '</span><canvas class="c-alb"></canvas></div>' +
            '<div class="map-box"><span>Normal (+Y)</span><canvas class="c-nrm"></canvas></div>' +
            '<div class="map-box"><span>RM (R:Rough G:Metal)</span><canvas class="c-rm"></canvas></div>' +
          '</div>';

        const cAlb = card.querySelector('.c-alb');
        const ctxA = cAlb.getContext('2d');
        if (isHorizOnly) {
          cAlb.width = targetSize * 3;
          cAlb.height = targetSize;
          cAlb.style.aspectRatio = '3 / 1';
          for (let tx = 0; tx < 3; tx++) {
            drawTile(ctxA, currentData.alb, sx, sy, tx * targetSize, 0);
          }
        } else {
          cAlb.width = targetSize * 3;
          cAlb.height = targetSize * 3;
          for (let ty = 0; ty < 3; ty++) {
            for (let tx = 0; tx < 3; tx++) {
              drawTile(ctxA, currentData.alb, sx, sy, tx * targetSize, ty * targetSize);
            }
          }
        }

        const cNrm = card.querySelector('.c-nrm');
        cNrm.width = targetSize;
        cNrm.height = targetSize;
        drawTile(cNrm.getContext('2d'), currentData.nrm, sx, sy, 0, 0);

        const cRm = card.querySelector('.c-rm');
        cRm.width = targetSize;
        cRm.height = targetSize;
        drawTile(cRm.getContext('2d'), currentData.rm, sx, sy, 0, 0);

        gridEl.appendChild(card);
      }
    }
    resSel.addEventListener('change', render);
    filterEl.addEventListener('input', render);
    render();
  </script>
</body>
</html>
`;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  await mkdir(PUBLIC_PBR, { recursive: true });

  const hdriTable = await copyHdriAssets(manifest);
  const cols = manifest.gridCols || 8;
  const resolutions = manifest.resolutions || [1024, 256];
  const gameResolution = manifest.gameResolution || 256;
  const runtimeMipTiers = manifest.runtimeMipTiers || [128, 64, 16];

  // Clean up obsolete numeric resolution directories (e.g. removed 128/)
  for (const existing of await readdir(PUBLIC_PBR)) {
    if (/^\d+$/.test(existing) && !resolutions.includes(Number(existing))) {
      await fsRm(path.join(PUBLIC_PBR, existing), { recursive: true, force: true });
    }
  }

  const layerEntries = [
    {
      slot: '__missing__',
      layer: 0,
      tiling: 'grid',
      uvScale: 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      source: 'builtin',
      assetId: '__missing__',
    },
  ];

  const metaBySlot = new Map();
  for (const entry of manifest.materials) {
    const metaPath = path.join(CACHE_RAW, entry.slot, 'meta.json');
    const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : {};
    metaBySlot.set(entry.slot, meta);
    layerEntries.push({
      slot: entry.slot,
      layer: layerEntries.length,
      tiling: entry.tiling || 'grid',
      uvScale: entry.uvScale ?? 1.0,
      blendMode: entry.blendMode || (entry.alphaCutout ? 'cutout' : 'opaque'),
      opacity: entry.opacity ?? 1.0,
      tintable: Boolean(entry.tintable),
      alphaCutout: Boolean(entry.alphaCutout),
      emissiveColor: Array.isArray(entry.emissiveColor) ? entry.emissiveColor : [0, 0, 0],
      emissiveStrength: entry.emissiveStrength ?? 0,
      source: entry.source,
      assetId: meta.assetId || entry.assetId || '',
    });
  }

  for (const comp of manifest.composites || []) {
    layerEntries.push({
      slot: comp.slot,
      layer: layerEntries.length,
      tiling: comp.tiling || 'grid',
      uvScale: comp.uvScale ?? 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      source: 'composite',
      assetId: comp.type,
    });
  }

  const totalLayers = layerEntries.length;
  const rows = Math.ceil(totalLayers / cols);

  for (const size of resolutions) {
    const t0 = performance.now();
    const layerBySlot = new Map();
    const bakedOrdered = [];

    const missing = createMissingLayer(size);
    layerBySlot.set('__missing__', missing);
    bakedOrdered.push(missing);

    for (const entry of manifest.materials) {
      const baked = await bakeSingleSlot(entry, size);
      layerBySlot.set(entry.slot, baked);
      bakedOrdered.push(baked);
    }

    for (const comp of manifest.composites || []) {
      let baked;
      if (comp.type === 'top_over_side') {
        baked = bakeTopOverSide(comp, layerBySlot, size);
      } else if (comp.type === 'ore_vein') {
        baked = bakeOreVein(comp, layerBySlot, size);
      } else {
        throw new Error(`Unsupported composite type "${comp.type}"`);
      }
      layerBySlot.set(comp.slot, baked);
      bakedOrdered.push(baked);
    }

    const atlasW = cols * size;
    const atlasH = rows * size;
    const pixelCount = atlasW * atlasH;
    const albedoAtlas = new Uint8Array(pixelCount * 4);
    const normalAtlas = new Uint8Array(pixelCount * 4);
    const rmAtlas = new Uint8Array(pixelCount * 4);

    for (let i = 0; i < pixelCount * 4; i += 4) {
      albedoAtlas[i + 3] = 255;
      normalAtlas[i] = 128;
      normalAtlas[i + 1] = 128;
      normalAtlas[i + 2] = 255;
      normalAtlas[i + 3] = 255;
      rmAtlas[i] = 220;
      rmAtlas[i + 1] = 0;
      rmAtlas[i + 2] = 0;
      rmAtlas[i + 3] = 255;
    }

    for (let layer = 0; layer < bakedOrdered.length; layer++) {
      const col = layer % cols;
      const row = Math.floor(layer / cols);
      const b = bakedOrdered[layer];
      blitTile(albedoAtlas, atlasW, b.albedo, size, col, row);
      blitTile(normalAtlas, atlasW, b.normal, size, col, row);
      blitTile(rmAtlas, atlasW, b.rm, size, col, row);
    }

    const outDir = path.join(PUBLIC_PBR, String(size));
    await mkdir(outDir, { recursive: true });
    const legacyOrm = path.join(outDir, 'orm_atlas.webp');
    if (existsSync(legacyOrm)) {
      await fsRm(legacyOrm, { force: true });
    }

    const albPath = path.join(outDir, 'albedo_atlas.webp');
    const nrmPath = path.join(outDir, 'normal_atlas.webp');
    const rmPath = path.join(outDir, 'rm_atlas.webp');

    await Promise.all([
      sharp(albedoAtlas, { raw: { width: atlasW, height: atlasH, channels: 4 } })
        .webp({ lossless: true, effort: 4 })
        .toFile(albPath),
      sharp(normalAtlas, { raw: { width: atlasW, height: atlasH, channels: 4 } })
        .webp({ lossless: true, effort: 4 })
        .toFile(nrmPath),
      sharp(rmAtlas, { raw: { width: atlasW, height: atlasH, channels: 4 } })
        .webp({ lossless: true, effort: 4 })
        .toFile(rmPath),
    ]);

    const [sA, sN, sR] = await Promise.all([stat(albPath), stat(nrmPath), stat(rmPath)]);
    const totalMb = (sA.size + sN.size + sR.size) / (1024 * 1024);
    const dt = (performance.now() - t0).toFixed(0);
    console.log(
      `[bake-pbr] ${size}px (${atlasW}x${atlasH}, ${totalLayers} layers) in ${dt}ms -> ` +
      `albedo ${(sA.size / 1024 / 1024).toFixed(2)}MB + normal ${(sN.size / 1024 / 1024).toFixed(2)}MB + rm ${(sR.size / 1024 / 1024).toFixed(2)}MB = ${totalMb.toFixed(2)}MB`
    );
  }

  const materialTable = {
    version: manifest.version,
    gridCols: cols,
    layerCount: totalLayers,
    resolutions,
    gameResolution,
    runtimeMipTiers,
    channels: { albedo: 'RGB(A)', normal: 'XYZ(+Y)', rm: 'R:Roughness,G:Metallic' },
    hdri: hdriTable,
    materials: layerEntries,
  };

  await writeFile(path.join(PUBLIC_PBR, 'material_table.json'), JSON.stringify(materialTable, null, 2) + '\n');
  await writeFile(path.join(PUBLIC_PBR, 'preview.html'), buildPreviewHtml(materialTable));
  console.log(`[bake-pbr] Wrote material_table.json & preview.html (${totalLayers} layers).`);
}

main().catch(err => {
  console.error('[bake-pbr] FAILED:', err);
  process.exit(1);
});

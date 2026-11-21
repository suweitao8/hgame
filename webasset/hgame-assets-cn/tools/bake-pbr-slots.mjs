import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPEC_PATH = path.join(ROOT, 'manifests', 'asset_spec.json');
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'materials.manifest.json');
const RAW_PBR_CACHE = path.join(ROOT, 'raw', 'pbr_cache');
const RAW_MANUAL_DIR = path.join(ROOT, 'raw', 'cn_textures_manual');
const BUILT_MATERIALS = path.join(ROOT, 'built', 'materials');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);

async function resizeToroidal(filePath, size, { grayscale = false } = {}) {
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

function equalizePeriodicLighting(albedo, size, strength = 0.68) {
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
        acc += src[row + ((x + r + 1) % size)] - src[row + ((x - r + size) % size)];
      }
    }
  };
  const passV = (src, dst) => {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[((k + size) % size) * size + x];
      for (let y = 0; y < size; y++) {
        dst[y * size + x] = acc / diam;
        acc += src[((y + r + 1) % size) * size + x] - src[((y - r + size) % size) * size + x];
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

function dilateAlphaEdges(rgba, size, iterations = 16) {
  let src = new Uint8Array(rgba);
  let dst = new Uint8Array(rgba);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < filled.length; i++) filled[i] = src[i * 4 + 3] >= 128 ? 1 : 0;
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

function createMissingLayer(size) {
  const color = new Uint8Array(size * size * 4);
  const normalRm = new Uint8Array(size * size * 4);
  const cell = Math.max(8, Math.floor(size / 8));
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell);
      const isMagenta = ((cx + cy) & 1) === 0;
      const i = (y * size + x) * 4;
      color[i] = isMagenta ? 255 : 20;
      color[i + 1] = isMagenta ? 0 : 20;
      color[i + 2] = isMagenta ? 255 : 20;
      color[i + 3] = 255;

      // Normal_RM flat: R=128, G=128, B=215 (roughness), A=0 (metallic)
      normalRm[i] = 128;
      normalRm[i + 1] = 128;
      normalRm[i + 2] = 215;
      normalRm[i + 3] = 0;
    }
  }
  return { color, normalRm };
}

async function bakeStandardSlot(entry, size, spec) {
  const srcDir =
    entry.source === 'manual'
      ? path.join(RAW_MANUAL_DIR, entry.assetId)
      : path.join(RAW_PBR_CACHE, entry.slot);
  const metaPath = path.join(srcDir, 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`Missing raw meta for "${entry.slot}" at ${metaPath}. Run npm run pbr:fetch first.`);
  }
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const files = meta.files || {};

  const color = await resizeToroidal(path.join(srcDir, files.albedo), size, { grayscale: false });
  if ((entry.tiling === 'stochastic' || entry.slot.startsWith('bark_')) && !entry.alphaCutout && entry.blendMode !== 'translucent') {
    equalizePeriodicLighting(color, size, entry.slot.startsWith('bark_') ? 0.78 : 0.72);
  }
  if (entry.alphaCutout && files.opacity) {
    const op = await resizeToroidal(path.join(srcDir, files.opacity), size, { grayscale: true });
    for (let p = 0; p < size * size; p++) color[p * 4 + 3] = op[p];
  } else if (entry.blendMode === 'translucent') {
    const alphaByte = Math.round(clamp01(entry.opacity ?? 0.35) * 255);
    for (let p = 0; p < size * size; p++) {
      if (color[p * 4 + 3] === 255) color[p * 4 + 3] = alphaByte;
    }
  } else {
    for (let p = 0; p < size * size; p++) color[p * 4 + 3] = 255;
  }

  let normal = null;
  if (files.normal) {
    normal = await resizeToroidal(path.join(srcDir, files.normal), size, { grayscale: false });
  }

  let aoMap = null;
  let roughMap = null;
  let metalMap = null;
  if (files.arm) {
    const arm = await resizeToroidal(path.join(srcDir, files.arm), size, { grayscale: false });
    aoMap = new Uint8Array(size * size);
    roughMap = new Uint8Array(size * size);
    metalMap = new Uint8Array(size * size);
    for (let p = 0; p < size * size; p++) {
      aoMap[p] = arm[p * 4];
      roughMap[p] = arm[p * 4 + 1];
      metalMap[p] = arm[p * 4 + 2];
    }
  } else {
    aoMap = files.ao ? await resizeToroidal(path.join(srcDir, files.ao), size, { grayscale: true }) : null;
    roughMap = files.rough ? await resizeToroidal(path.join(srcDir, files.rough), size, { grayscale: true }) : null;
    metalMap = files.metal ? await resizeToroidal(path.join(srcDir, files.metal), size, { grayscale: true }) : null;
  }

  const aoAlbedoWeight = spec.texturePipeline?.aoBakeIntoAlbedoWeight ?? 0.35;
  const aoMetalWeight = spec.texturePipeline?.aoBakeIntoMetalWeight ?? 0.15;
  const minNonMetalRoughByte = Math.round((spec.globalRules?.nonMetalMinRoughness ?? 0.25) * 255);

  const normalRm = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const i = p * 4;
    const metallic = metalMap ? metalMap[p] / 255 : 0.0;
    const ao = aoMap ? aoMap[p] / 255 : 1.0;
    const weight = mix(aoAlbedoWeight, aoMetalWeight, metallic);
    const aoFactor = mix(1.0, ao, weight);

    // 35% AO micro-bake into albedo in linear space
    for (let c = 0; c < 3; c++) {
      const lin = srgbToLinear(color[i + c] / 255) * aoFactor;
      color[i + c] = Math.round(clamp01(linearToSrgb(lin)) * 255);
    }

    // Normal XY (OpenGL +Y) normalized
    let nx = 0, ny = 0;
    if (normal) {
      let rx = normal[i] / 127.5 - 1;
      let ry = normal[i + 1] / 127.5 - 1;
      let rz = normal[i + 2] / 127.5 - 1;
      const len = Math.hypot(rx, ry, rz);
      if (len > 1e-4) {
        nx = rx / len;
        ny = ry / len;
      }
    }
    normalRm[i] = Math.round(clamp01((nx + 1) * 0.5) * 255);
    normalRm[i + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);

    const rawRough = roughMap ? roughMap[p] : 215;
    const isMetal = metallic >= 0.5;
    const minRough = isMetal ? 10 : entry.blendMode === 'translucent' ? 10 : minNonMetalRoughByte;
    normalRm[i + 2] = Math.max(minRough, rawRough);
    normalRm[i + 3] = Math.round(clamp01(metallic) * 255);
  }

  if (entry.alphaCutout) {
    dilateAlphaEdges(color, size, 16);
  }

  return { color, normalRm, meta };
}

function buildHallwayGreenDado(baseBufs, entry, size) {
  const color = new Uint8Array(baseBufs.color);
  const normalRm = new Uint8Array(baseBufs.normalRm);
  const dadoRatio = entry.dadoRatio ?? 0.45;
  const stripeRatio = entry.stripeRatio ?? 0.02;
  const [gr, gg, gb] = entry.dadoColor || [52, 92, 68];

  const stripeTopY = Math.round(size * (1 - dadoRatio - stripeRatio));
  const dadoTopY = Math.round(size * (1 - dadoRatio));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (y >= dadoTopY) {
        // Bottom 45%: semi-gloss Chinese hallway green oil paint over plaster texture
        const lum = (0.299 * color[i] + 0.587 * color[i + 1] + 0.114 * color[i + 2]) / 255;
        const texVar = 0.88 + lum * 0.16;
        color[i] = Math.min(255, Math.round(gr * texVar));
        color[i + 1] = Math.min(255, Math.round(gg * texVar));
        color[i + 2] = Math.min(255, Math.round(gb * texVar));
        normalRm[i + 2] = Math.max(96, Math.round(normalRm[i + 2] * 0.55));
      } else if (y >= stripeTopY) {
        // 2% dark green waist stripe + subtle crevice normal
        color[i] = Math.round(gr * 0.58);
        color[i + 1] = Math.round(gg * 0.58);
        color[i + 2] = Math.round(gb * 0.58);
        normalRm[i + 1] = y < (stripeTopY + dadoTopY) / 2 ? 156 : 100;
        normalRm[i + 2] = 110;
      }
    }
  }
  return {
    color,
    normalRm,
    meta: { source: 'composite', assetId: 'cn_hallway_green_dado', license: 'CC0' },
  };
}

async function writeSlotOutputs(slotName, color, normalRm, size) {
  const dir = path.join(BUILT_MATERIALS, slotName);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    sharp(color, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(dir, 'color.png')),
    sharp(normalRm, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(dir, 'normal_rm.png')),
  ]);
}

async function main() {
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const masterSize = spec.tiers?.T0?.texSize?.master || 1024;

  await mkdir(BUILT_MATERIALS, { recursive: true });

  // Layer 0: __missing__ checkerboard
  const missing = createMissingLayer(masterSize);
  await writeSlotOutputs('__missing__', missing.color, missing.normalRm, masterSize);

  const tableEntries = [
    {
      slot: '__missing__',
      layer: 0,
      category: '0_builtin',
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
  const licenses = [];
  const bakedCache = new Map();

  // First pass: non-composite slots
  let layerIdx = 1;
  for (const entry of manifest.materials) {
    const thisLayer = layerIdx++;
    if (entry.source === 'composite') {
      continue;
    }
    const { color, normalRm, meta } = await bakeStandardSlot(entry, masterSize, spec);
    bakedCache.set(entry.slot, { color, normalRm });
    await writeSlotOutputs(entry.slot, color, normalRm, masterSize);
    tableEntries.push({
      slot: entry.slot,
      layer: thisLayer,
      category: entry.category,
      tiling: entry.tiling || 'grid',
      uvScale: entry.uvScale ?? 1.0,
      blendMode: entry.blendMode || (entry.alphaCutout ? 'cutout' : 'opaque'),
      opacity: entry.opacity ?? 1.0,
      tintable: Boolean(entry.tintable),
      alphaCutout: Boolean(entry.alphaCutout),
      emissiveColor: entry.emissiveColor || [0, 0, 0],
      emissiveStrength: entry.emissiveStrength || 0,
      source: entry.source,
      assetId: entry.assetId,
    });
    licenses.push({
      slot: entry.slot,
      source: meta.source || entry.source,
      assetId: meta.assetId || entry.assetId,
      license: meta.license || 'CC0',
      sourceUrl: meta.sourceUrl || '',
    });
  }

  // Second pass: composite slots (preserve original manifest layer order!)
  layerIdx = 1;
  for (const entry of manifest.materials) {
    const thisLayer = layerIdx++;
    if (entry.source !== 'composite') continue;
    const base = bakedCache.get(entry.base);
    if (!base) throw new Error(`Composite slot "${entry.slot}" missing base "${entry.base}"`);
    const { color, normalRm, meta } = buildHallwayGreenDado(base, entry, masterSize);
    await writeSlotOutputs(entry.slot, color, normalRm, masterSize);
    tableEntries.push({
      slot: entry.slot,
      layer: thisLayer,
      category: entry.category,
      tiling: entry.tiling || 'grid',
      uvScale: entry.uvScale ?? 1.0,
      blendMode: entry.blendMode || 'opaque',
      opacity: entry.opacity ?? 1.0,
      tintable: Boolean(entry.tintable),
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      source: 'composite',
      assetId: entry.compositeType,
    });
    licenses.push({ slot: entry.slot, ...meta });
  }

  tableEntries.sort((a, b) => a.layer - b.layer);

  // Copy HDRIs and water_normal
  const hdriOutDir = path.join(BUILT_MATERIALS, 'hdri');
  await mkdir(hdriOutDir, { recursive: true });
  const hdriList = [];
  for (const h of manifest.hdri || []) {
    const srcHdr = path.join(RAW_PBR_CACHE, '_hdri', `${h.slot}.hdr`);
    if (existsSync(srcHdr)) {
      await copyFile(srcHdr, path.join(hdriOutDir, `${h.slot}.hdr`));
      hdriList.push({ slot: h.slot, path: `hdri/${h.slot}.hdr`, assetId: h.assetId, license: 'CC0' });
    }
  }

  const waterSrc = path.join(RAW_MANUAL_DIR, 'water_normal.png');
  if (existsSync(waterSrc)) {
    await copyFile(waterSrc, path.join(BUILT_MATERIALS, 'water_normal.png'));
  }

  const materialTable = {
    version: manifest.version,
    pipeline: '2-map-pbr',
    maps: ['color', 'normal_rm'],
    masterResolution: masterSize,
    resolutions: [512, 256],
    gameResolution: 512,
    gridCols: 8,
    layerCount: tableEntries.length,
    hdri: hdriList,
    waterNormal: 'water_normal.png',
    materials: tableEntries,
  };

  // Also pack 512px & 256px 2-map grid atlases for WebGL2 TEXTURE_2D_ARRAY runtime preview
  const gridCols = 8;
  const rows = Math.max(1, Math.ceil(tableEntries.length / gridCols));
  for (const resSize of [512, 256]) {
    const resDir = path.join(BUILT_MATERIALS, String(resSize));
    await mkdir(resDir, { recursive: true });
    const w = gridCols * resSize;
    const h = rows * resSize;
    const albAtlas = Buffer.alloc(w * h * 4);
    const nrmAtlas = Buffer.alloc(w * h * 4);
    for (const entry of tableEntries) {
      const col = entry.layer % gridCols;
      const row = Math.floor(entry.layer / gridCols);
      const ox = col * resSize;
      const oy = row * resSize;
      const slotDir = path.join(BUILT_MATERIALS, entry.slot);
      const [cTile, nTile] = await Promise.all([
        sharp(path.join(slotDir, 'color.png')).resize(resSize, resSize, { kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer(),
        sharp(path.join(slotDir, 'normal_rm.png')).resize(resSize, resSize, { kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer(),
      ]);
      for (let y = 0; y < resSize; y++) {
        const srcRow = y * resSize * 4;
        const dstRow = ((oy + y) * w + ox) * 4;
        cTile.copy(albAtlas, dstRow, srcRow, srcRow + resSize * 4);
        nTile.copy(nrmAtlas, dstRow, srcRow, srcRow + resSize * 4);
      }
    }
    await Promise.all([
      sharp(albAtlas, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: spec.texturePipeline?.webpFallback?.colorQuality ?? 80 }).toFile(path.join(resDir, 'albedo_array.webp')),
      sharp(nrmAtlas, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: spec.texturePipeline?.webpFallback?.normalRmQuality ?? 92 }).toFile(path.join(resDir, 'normal_rm_array.webp')),
    ]);
  }

  await writeFile(path.join(BUILT_MATERIALS, 'material_table.json'), JSON.stringify(materialTable, null, 2));
  await writeFile(path.join(BUILT_MATERIALS, 'LICENSES.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items: licenses }, null, 2));
  console.log(`[pbr:bake] Baked ${tableEntries.length} layers (1024x1024 color.png + normal_rm.png), ${hdriList.length} HDRIs`);
}

main().catch((err) => {
  console.error('[pbr:bake] FAILED:', err);
  process.exit(1);
});

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CN_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(CN_ROOT, '..', '..');
const MANIFESTS_DIR = path.join(CN_ROOT, 'manifests');
const SPEC_PATH = path.join(MANIFESTS_DIR, 'asset_spec.json');
const MATERIALS_MANIFEST_PATH = path.join(MANIFESTS_DIR, 'materials.manifest.json');
const DECALS_MANIFEST_PATH = path.join(MANIFESTS_DIR, 'decals.manifest.json');
const FOLIAGE_MANIFEST_PATH = path.join(MANIFESTS_DIR, 'foliage.manifest.json');

const RAW_PBR_CACHE = path.join(CN_ROOT, 'raw', 'pbr_cache');
const RAW_MANUAL_DIR = path.join(CN_ROOT, 'raw', 'cn_textures_manual');

const BUILT_MATERIALS = path.join(CN_ROOT, 'built', 'materials');
const BUILT_PBR_DECALS = path.join(CN_ROOT, 'built', 'pbr_decals');
const BUILT_PBR_FOLIAGE = path.join(CN_ROOT, 'built', 'pbr_foliage');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

function parseArgs(argv) {
  let vaultDir = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault' && argv[i + 1]) vaultDir = path.resolve(argv[++i]);
  }
  return { vaultDir };
}

async function resolveVaultDir(explicit) {
  if (explicit) return explicit;
  if (process.env.HGAME_VAULT_DIR?.trim()) return path.resolve(process.env.HGAME_VAULT_DIR.trim());
  const localCfgPath = path.join(REPO_ROOT, '.hgame.local.json');
  if (existsSync(localCfgPath)) {
    const cfg = JSON.parse(await readFile(localCfgPath, 'utf8'));
    if (typeof cfg?.vaultCacheDir === 'string' && cfg.vaultCacheDir.trim()) {
      return path.resolve(cfg.vaultCacheDir.trim());
    }
    if (typeof cfg?.fabLibraryDir === 'string' && cfg.fabLibraryDir.trim()) {
      return path.dirname(path.resolve(cfg.fabLibraryDir.trim()));
    }
  }
  throw new Error('Missing VaultCache directory. Pass --vault <dir> or set HGAME_VAULT_DIR.');
}

async function resizeBufferNoPremultiply(buf, srcW, srcH, ch, dstW, dstH, kernel = sharp.kernel.lanczos3) {
  if (srcW === dstW && srcH === dstH) {
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
  if (ch !== 4) {
    return sharp(buf, { raw: { width: srcW, height: srcH, channels: ch } })
      .resize(dstW, dstH, { kernel, fit: 'fill' })
      .raw()
      .toBuffer();
  }
  const pxCount = srcW * srcH;
  const rgb = Buffer.allocUnsafe(pxCount * 3);
  const alpha = Buffer.allocUnsafe(pxCount);
  for (let p = 0, r3 = 0, r4 = 0; p < pxCount; p++, r3 += 3, r4 += 4) {
    rgb[r3] = buf[r4];
    rgb[r3 + 1] = buf[r4 + 1];
    rgb[r3 + 2] = buf[r4 + 2];
    alpha[p] = buf[r4 + 3];
  }
  const [outRgb, outAlpha] = await Promise.all([
    sharp(rgb, { raw: { width: srcW, height: srcH, channels: 3 } })
      .resize(dstW, dstH, { kernel, fit: 'fill' })
      .raw()
      .toBuffer(),
    sharp(alpha, { raw: { width: srcW, height: srcH, channels: 1 } })
      .resize(dstW, dstH, { kernel, fit: 'fill' })
      .raw()
      .toBuffer(),
  ]);
  const outCount = dstW * dstH;
  const out = Buffer.allocUnsafe(outCount * 4);
  for (let p = 0, r3 = 0, r4 = 0; p < outCount; p++, r3 += 3, r4 += 4) {
    out[r4] = outRgb[r3];
    out[r4 + 1] = outRgb[r3 + 1];
    out[r4 + 2] = outRgb[r3 + 2];
    out[r4 + 3] = outAlpha[p];
  }
  return out;
}

async function resizeStraightRgba(filePath, targetW, targetH) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return resizeBufferNoPremultiply(data, info.width, info.height, 4, targetW, targetH, sharp.kernel.lanczos3);
}

async function loadRawRgb(filePath, targetW, targetH, tileToSquare = false) {
  const { data, info } = await sharp(filePath).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.width === targetW && info.height === targetH) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (tileToSquare) {
    const out = new Uint8Array(targetW * targetH * 3);
    for (let y = 0; y < targetH; y++) {
      const sy = y % info.height;
      for (let x = 0; x < targetW; x++) {
        const sx = x % info.width;
        const si = (sy * info.width + sx) * 3;
        const di = (y * targetW + x) * 3;
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
      }
    }
    return out;
  }
  const resized = await resizeBufferNoPremultiply(data, info.width, info.height, 3, targetW, targetH);
  return new Uint8Array(resized.buffer, resized.byteOffset, resized.byteLength);
}

async function loadRawGray(filePath, targetW, targetH, tileToSquare = false) {
  const { data, info } = await sharp(filePath).removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });
  if (info.width === targetW && info.height === targetH) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (tileToSquare) {
    const out = new Uint8Array(targetW * targetH);
    for (let y = 0; y < targetH; y++) {
      const sy = y % info.height;
      for (let x = 0; x < targetW; x++) {
        const sx = x % info.width;
        out[y * targetW + x] = data[sy * info.width + sx];
      }
    }
    return out;
  }
  const resized = await resizeBufferNoPremultiply(data, info.width, info.height, 1, targetW, targetH);
  return new Uint8Array(resized.buffer, resized.byteOffset, resized.byteLength);
}

function dilateAlphaEdges(rgba, width, height, iterations = 16) {
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

      normalRm[i] = 128;
      normalRm[i + 1] = 128;
      normalRm[i + 2] = 215;
      normalRm[i + 3] = 0;
    }
  }
  return { color, normalRm };
}

async function discoverSourceMaps(vaultRoot, sourcePath) {
  const full = path.join(vaultRoot, sourcePath);
  if (!existsSync(full)) {
    throw new Error(`Missing source asset directory: ${sourcePath}`);
  }
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) await walk(fp);
      else files.push(fp);
    }
  };
  await walk(full);

  const maps = {};
  for (const fp of files) {
    const base = path.basename(fp);
    if (base.toLowerCase() === 'thumbnail.jpeg' || !/\.(jpg|jpeg|png)$/i.test(base)) continue;
    if (/_(BaseColor|Color)\./i.test(base)) maps.albedo = fp;
    else if (/_(NormalGL|Normal)\./i.test(base)) maps.normal = fp;
    else if (/_Roughness\./i.test(base)) maps.rough = fp;
    else if (/_Metalness\./i.test(base)) maps.metal = fp;
    else if (/_(AmbientOcclusion|AO)\./i.test(base)) maps.ao = fp;
    else if (/_Opacity\./i.test(base)) maps.opacity = fp;
  }
  if (!maps.albedo) {
    throw new Error(`Missing albedo/BaseColor/Color map in ${sourcePath}`);
  }
  const meta = await sharp(maps.albedo).metadata();
  return {
    maps,
    nativeWidth: meta.width || 1024,
    nativeHeight: meta.height || 1024,
  };
}

async function bakePbrAsset({
  vaultRoot,
  entry,
  targetW,
  targetH,
  tileToSquare = false,
  keepOpacity = false,
  aoWeight = 0.25,
}) {
  const { maps } = await discoverSourceMaps(vaultRoot, entry.sourcePath);
  const nPix = targetW * targetH;

  const albedoRgb = await loadRawRgb(maps.albedo, targetW, targetH, tileToSquare);
  const aoMap = maps.ao ? await loadRawGray(maps.ao, targetW, targetH, tileToSquare) : null;
  const normalRgb = maps.normal ? await loadRawRgb(maps.normal, targetW, targetH, tileToSquare) : null;
  const roughMap = maps.rough ? await loadRawGray(maps.rough, targetW, targetH, tileToSquare) : null;
  const metalMap = maps.metal ? await loadRawGray(maps.metal, targetW, targetH, tileToSquare) : null;
  const opacityMap = keepOpacity && maps.opacity ? await loadRawGray(maps.opacity, targetW, targetH, tileToSquare) : null;

  const color = new Uint8Array(nPix * 4);
  const normalRm = new Uint8Array(nPix * 4);
  const defaultRoughByte = Math.round(clamp01(entry.defaultRoughness ?? 0.75) * 255);
  const defaultMetalByte = entry.surfaceType === 'metal' ? 210 : 0;

  for (let p = 0; p < nPix; p++) {
    const i3 = p * 3;
    const i4 = p * 4;
    const ao = aoMap ? aoMap[p] / 255 : 1.0;
    const aoFactor = mix(1.0, ao, aoWeight);

    let rLin = srgbToLinear(albedoRgb[i3] / 255) * aoFactor;
    let gLin = srgbToLinear(albedoRgb[i3 + 1] / 255) * aoFactor;
    let bLin = srgbToLinear(albedoRgb[i3 + 2] / 255) * aoFactor;

    if (entry.tintableGrayscale) {
      const lum = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
      // Lift blood/stain contrast into [0.18..1.0] grayscale so runtime color tinting stays clean
      const boosted = clamp01(Math.sqrt(clamp01(lum)) * 1.15);
      rLin = boosted;
      gLin = boosted;
      bLin = boosted;
    }

    color[i4] = Math.round(clamp01(linearToSrgb(rLin)) * 255);
    color[i4 + 1] = Math.round(clamp01(linearToSrgb(gLin)) * 255);
    color[i4 + 2] = Math.round(clamp01(linearToSrgb(bLin)) * 255);
    color[i4 + 3] = opacityMap ? opacityMap[p] : 255;

    // Normal: both ambientCG NormalGL and FabLibrary Normal are OpenGL (+Y); normalize XY
    let nx = 0;
    let ny = 0;
    if (normalRgb) {
      const rx = normalRgb[i3] / 127.5 - 1;
      const ry = normalRgb[i3 + 1] / 127.5 - 1;
      const rz = normalRgb[i3 + 2] / 127.5 - 1;
      const len = Math.hypot(rx, ry, rz);
      if (len > 1e-4) {
        nx = rx / len;
        ny = ry / len;
      }
    }
    normalRm[i4] = Math.round(clamp01((nx + 1) * 0.5) * 255);
    normalRm[i4 + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);
    normalRm[i4 + 2] = roughMap ? roughMap[p] : defaultRoughByte;
    normalRm[i4 + 3] = metalMap ? metalMap[p] : defaultMetalByte;
  }

  if (keepOpacity && opacityMap) {
    dilateAlphaEdges(color, targetW, targetH, 16);
  }

  return { color, normalRm, width: targetW, height: targetH };
}

function buildProceduralDerivedSlot(entry, baseBufs, size) {
  const nPix = size * size;
  const color = new Uint8Array(baseBufs.color);
  const normalRm = new Uint8Array(baseBufs.normalRm);

  if (entry.id === 'cn_corrugated_blue' || entry.id === 'cn_corrugated_red') {
    const targetRgb = entry.id === 'cn_corrugated_blue' ? [34, 92, 174] : [162, 48, 42];
    for (let p = 0; p < nPix; p++) {
      const i = p * 4;
      const lum = (0.299 * color[i] + 0.587 * color[i + 1] + 0.114 * color[i + 2]) / 255;
      const shade = 0.65 + lum * 0.55;
      color[i] = Math.min(255, Math.round(targetRgb[0] * shade));
      color[i + 1] = Math.min(255, Math.round(targetRgb[1] * shade));
      color[i + 2] = Math.min(255, Math.round(targetRgb[2] * shade));
      normalRm[i + 2] = Math.max(96, Math.min(148, Math.round(normalRm[i + 2] * 0.7 + 36)));
      normalRm[i + 3] = 140;
    }
  } else if (entry.id === 'cn_epoxy_green') {
    for (let p = 0; p < nPix; p++) {
      const i = p * 4;
      const lum = (0.299 * color[i] + 0.587 * color[i + 1] + 0.114 * color[i + 2]) / 255;
      const shade = 0.72 + lum * 0.42;
      color[i] = Math.min(255, Math.round(36 * shade));
      color[i + 1] = Math.min(255, Math.round(112 * shade));
      color[i + 2] = Math.min(255, Math.round(74 * shade));
      normalRm[i + 2] = Math.max(72, Math.min(115, Math.round(normalRm[i + 2] * 0.45)));
      normalRm[i + 3] = 0;
    }
  } else {
    throw new Error(`Unknown procedural slot "${entry.id}"`);
  }

  return { color, normalRm, width: size, height: size };
}

function validateMaterialRule(entry, spec) {
  const rules = spec.materialRules || {};
  const blendMode = entry.blendMode || (entry.alphaCutout ? 'cutout' : 'opaque');
  if (rules.forbidAlphaCutout !== false && (entry.alphaCutout || blendMode === 'cutout')) {
    throw new Error(`Material "${entry.id}" uses forbidden alphaCutout/cutout.`);
  }
  if (blendMode === 'translucent') {
    const isGlass = entry.surfaceType === 'glass' || /glass/i.test(entry.id || '');
    if (rules.translucentOnlyForGlass !== false && !isGlass) {
      throw new Error(`Material "${entry.id}" uses translucent outside glass.`);
    }
  } else if (blendMode !== 'opaque') {
    throw new Error(`Material "${entry.id}" has unsupported blendMode "${blendMode}".`);
  }
}

async function cleanDirExcept(rootDir, keepSet) {
  await mkdir(rootDir, { recursive: true });
  for (const e of await readdir(rootDir, { withFileTypes: true })) {
    if (e.isDirectory() && !keepSet.has(e.name)) {
      await rm(path.join(rootDir, e.name), { recursive: true, force: true });
    }
  }
}

async function writeUnpremultipliedPair(outDir, color, normalRm, width, height) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    sharp(color, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'color.png')),
    sharp(normalRm, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'normal_rm.png')),
  ]);
}

async function verifyBakedCollection(label, baseDir, items, { requireSquare1024 = false } = {}) {
  let zeroAlphaZeroRgb = 0;
  let checkedZeroAlpha = 0;
  for (const item of items) {
    const id = item.id || item.slot;
    const colPath = path.join(baseDir, id, 'color.png');
    const nrmPath = path.join(baseDir, id, 'normal_rm.png');
    if (!existsSync(colPath) || !existsSync(nrmPath)) {
      throw new Error(`[verify:${label}] Missing output PNG for "${id}"`);
    }
    const [cs, ns] = await Promise.all([stat(colPath), stat(nrmPath)]);
    if (cs.size <= 0 || ns.size <= 0) {
      throw new Error(`[verify:${label}] Empty output PNG for "${id}"`);
    }
    const [cMeta, nRaw] = await Promise.all([
      sharp(colPath).metadata(),
      sharp(nrmPath).raw().toBuffer({ resolveWithObject: true }),
    ]);
    const w = nRaw.info.width;
    const h = nRaw.info.height;
    if (cMeta.width !== w || cMeta.height !== h) {
      throw new Error(`[verify:${label}] Dimension mismatch for "${id}": color ${cMeta.width}x${cMeta.height} vs normal_rm ${w}x${h}`);
    }
    if (!isPow2(w) || !isPow2(h)) {
      throw new Error(`[verify:${label}] Non-pow2 dimension for "${id}": ${w}x${h}`);
    }
    if (requireSquare1024 && (w !== 1024 || h !== 1024)) {
      throw new Error(`[verify:${label}] Expected 1024x1024 for material "${id}", got ${w}x${h}`);
    }
    const d = nRaw.data;
    for (let p = 0; p < w * h; p += 17) {
      const i = p * 4;
      if (d[i + 3] === 0) {
        checkedZeroAlpha++;
        if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) {
          zeroAlphaZeroRgb++;
        }
      }
    }
  }
  if (zeroAlphaZeroRgb > 0) {
    throw new Error(`[verify:${label}] Found ${zeroAlphaZeroRgb} pixels with A=0 & RGB=(0,0,0) in normal_rm.png!`);
  }
  return { count: items.length, checkedZeroAlpha, zeroAlphaZeroRgb };
}

async function main() {
  const { vaultDir } = parseArgs(process.argv.slice(2));
  const vaultRoot = await resolveVaultDir(vaultDir);
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const matManifest = JSON.parse(await readFile(MATERIALS_MANIFEST_PATH, 'utf8'));
  const decalManifest = JSON.parse(await readFile(DECALS_MANIFEST_PATH, 'utf8'));
  const foliageManifest = JSON.parse(await readFile(FOLIAGE_MANIFEST_PATH, 'utf8'));
  const masterSize = spec.tiers?.T0?.texSize?.master || 1024;

  // 1. Bake 90 Universal Opaque Materials (+ layer 0 __missing__)
  for (const entry of matManifest.materials || []) {
    validateMaterialRule(entry, spec);
  }
  await cleanDirExcept(
    BUILT_MATERIALS,
    new Set(['512', '256', 'hdri', '__missing__', ...(matManifest.materials || []).map((m) => m.id)]),
  );

  const missing = createMissingLayer(masterSize);
  await writeUnpremultipliedPair(path.join(BUILT_MATERIALS, '__missing__'), missing.color, missing.normalRm, masterSize, masterSize);

  const tableEntries = [
    {
      id: '__missing__',
      slot: '__missing__',
      layer: 0,
      category: '0_builtin',
      surfaceType: 'concrete',
      tiling: 'grid',
      scanSizeMeters: 1.0,
      uvScale: 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      source: 'builtin',
      assetId: '__missing__',
      width: masterSize,
      height: masterSize,
    },
  ];

  const bakedCache = new Map();
  let layerIdx = 1;
  for (const entry of matManifest.materials || []) {
    const thisLayer = layerIdx++;
    if (entry.sourcePath?.startsWith('procedural/')) continue;
    const baked = await bakePbrAsset({
      vaultRoot,
      entry,
      targetW: masterSize,
      targetH: masterSize,
      tileToSquare: Boolean(entry.tileToSquare),
      keepOpacity: false,
      aoWeight: 0.25,
    });
    bakedCache.set(entry.id, baked);
    await writeUnpremultipliedPair(path.join(BUILT_MATERIALS, entry.id), baked.color, baked.normalRm, masterSize, masterSize);
    tableEntries.push({
      id: entry.id,
      slot: entry.id,
      layer: thisLayer,
      category: entry.category,
      surfaceType: entry.surfaceType,
      sourcePath: entry.sourcePath,
      tiling: entry.surfaceType === 'dirt' || entry.surfaceType === 'grass' || entry.surfaceType === 'asphalt' ? 'stochastic' : 'grid',
      scanSizeMeters: entry.scanSizeMeters,
      uvScale: entry.uvScale ?? 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      hasMetalness: Boolean(entry.hasMetalness || entry.surfaceType === 'metal'),
      source: entry.sourcePath.startsWith('ambientcg/') ? 'ambientcg' : 'fablibrary',
      assetId: path.basename(entry.sourcePath),
      width: masterSize,
      height: masterSize,
    });
  }

  layerIdx = 1;
  for (const entry of matManifest.materials || []) {
    const thisLayer = layerIdx++;
    if (!entry.sourcePath?.startsWith('procedural/')) continue;
    const base = bakedCache.get(entry.derivedFrom);
    if (!base) throw new Error(`Procedural slot "${entry.id}" missing derivedFrom "${entry.derivedFrom}"`);
    const baked = buildProceduralDerivedSlot(entry, base, masterSize);
    await writeUnpremultipliedPair(path.join(BUILT_MATERIALS, entry.id), baked.color, baked.normalRm, masterSize, masterSize);
    tableEntries.push({
      id: entry.id,
      slot: entry.id,
      layer: thisLayer,
      category: entry.category,
      surfaceType: entry.surfaceType,
      sourcePath: entry.sourcePath,
      derivedFrom: entry.derivedFrom,
      tiling: 'grid',
      scanSizeMeters: entry.scanSizeMeters,
      uvScale: entry.uvScale ?? 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      hasMetalness: entry.surfaceType === 'metal',
      source: 'procedural',
      assetId: entry.id,
      width: masterSize,
      height: masterSize,
    });
  }
  tableEntries.sort((a, b) => a.layer - b.layer);

  // Copy HDRIs & water_normal if cached
  const hdriOutDir = path.join(BUILT_MATERIALS, 'hdri');
  await mkdir(hdriOutDir, { recursive: true });
  const hdriList = [];
  for (const h of matManifest.hdri || []) {
    const dst = path.join(hdriOutDir, `${h.slot}.hdr`);
    const srcHdr = path.join(RAW_PBR_CACHE, '_hdri', `${h.slot}.hdr`);
    if (existsSync(srcHdr)) await copyFile(srcHdr, dst);
    if (existsSync(dst)) hdriList.push({ slot: h.slot, path: `hdri/${h.slot}.hdr`, assetId: h.assetId, license: 'CC0' });
  }
  const waterSrc = path.join(RAW_MANUAL_DIR, 'water_normal.png');
  if (existsSync(waterSrc)) await copyFile(waterSrc, path.join(BUILT_MATERIALS, 'water_normal.png'));

  const materialTable = {
    version: '5.0.0',
    pipeline: '2-map-pbr',
    normalConvention: 'OpenGL (+Y)',
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

  // Also pack 512px & 256px 2-map grid atlases for #tests and game bundling (91 <= 128)
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
      const slotDir = path.join(BUILT_MATERIALS, entry.id);
      const [cTile, nTile] = await Promise.all([
        resizeStraightRgba(path.join(slotDir, 'color.png'), resSize, resSize),
        resizeStraightRgba(path.join(slotDir, 'normal_rm.png'), resSize, resSize),
      ]);
      for (let y = 0; y < resSize; y++) {
        const srcRow = y * resSize * 4;
        const dstRow = ((oy + y) * w + ox) * 4;
        cTile.copy(albAtlas, dstRow, srcRow, srcRow + resSize * 4);
        nTile.copy(nrmAtlas, dstRow, srcRow, srcRow + resSize * 4);
      }
    }
    await Promise.all([
      sharp(albAtlas, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: spec.texturePipeline?.webpFallback?.colorQuality ?? 80, exact: true }).toFile(path.join(resDir, 'albedo_array.webp')),
      sharp(nrmAtlas, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: spec.texturePipeline?.webpFallback?.normalRmQuality ?? 92, exact: true }).toFile(path.join(resDir, 'normal_rm_array.webp')),
    ]);
  }
  await writeFile(path.join(BUILT_MATERIALS, 'material_table.json'), JSON.stringify(materialTable, null, 2));

  // 2. Bake 36 PBR Decals (preserve native aspect ratio & power-of-2 dimensions)
  const pbrDecals = decalManifest.pbrDecals || [];
  await cleanDirExcept(BUILT_PBR_DECALS, new Set(pbrDecals.map((d) => d.id)));
  const decalTableEntries = [];
  for (const entry of pbrDecals) {
    const { nativeWidth, nativeHeight } = await discoverSourceMaps(vaultRoot, entry.sourcePath);
    const baked = await bakePbrAsset({
      vaultRoot,
      entry,
      targetW: nativeWidth,
      targetH: nativeHeight,
      tileToSquare: false,
      keepOpacity: true,
      aoWeight: 0.25,
    });
    await writeUnpremultipliedPair(path.join(BUILT_PBR_DECALS, entry.id), baked.color, baked.normalRm, baked.width, baked.height);
    decalTableEntries.push({
      id: entry.id,
      slot: entry.id,
      category: entry.category,
      sourcePath: entry.sourcePath,
      width: baked.width,
      height: baked.height,
      aspectRatio: Number((baked.width / baked.height).toFixed(4)),
      physicalSizeMeters: entry.scanSizeMeters,
      scanSizeMeters: entry.scanSizeMeters,
      uvScale: entry.uvScale ?? 1.0,
      tintableGrayscale: Boolean(entry.tintableGrayscale),
      missingNormal: Boolean(entry.missingNormal),
      missingRoughness: Boolean(entry.missingRoughness),
      defaultRoughness: entry.defaultRoughness ?? null,
    });
  }
  await writeFile(
    path.join(BUILT_PBR_DECALS, 'pbr_decals_table.json'),
    JSON.stringify({ version: '5.0.0', normalConvention: 'OpenGL (+Y)', count: decalTableEntries.length, items: decalTableEntries }, null, 2),
  );

  // 3. Bake 20 PBR Foliage Sets (preserve native aspect ratio & power-of-2 dimensions)
  const pbrFoliage = foliageManifest.pbrFoliage || [];
  await cleanDirExcept(BUILT_PBR_FOLIAGE, new Set(pbrFoliage.map((f) => f.id)));
  const foliageTableEntries = [];
  for (const entry of pbrFoliage) {
    const { nativeWidth, nativeHeight } = await discoverSourceMaps(vaultRoot, entry.sourcePath);
    const baked = await bakePbrAsset({
      vaultRoot,
      entry,
      targetW: nativeWidth,
      targetH: nativeHeight,
      tileToSquare: false,
      keepOpacity: true,
      aoWeight: 0.25,
    });
    await writeUnpremultipliedPair(path.join(BUILT_PBR_FOLIAGE, entry.id), baked.color, baked.normalRm, baked.width, baked.height);
    foliageTableEntries.push({
      id: entry.id,
      slot: entry.id,
      category: entry.category,
      sourcePath: entry.sourcePath,
      width: baked.width,
      height: baked.height,
      aspectRatio: Number((baked.width / baked.height).toFixed(4)),
      physicalSizeMeters: entry.scanSizeMeters,
      scanSizeMeters: entry.scanSizeMeters,
      missingNormal: Boolean(entry.missingNormal),
      missingRoughness: Boolean(entry.missingRoughness),
    });
  }
  await writeFile(
    path.join(BUILT_PBR_FOLIAGE, 'pbr_foliage_table.json'),
    JSON.stringify({ version: '5.0.0', normalConvention: 'OpenGL (+Y)', count: foliageTableEntries.length, items: foliageTableEntries }, null, 2),
  );

  // 4. Verify all outputs & A=0 straight-alpha integrity
  const [vMat, vDec, vFol] = await Promise.all([
    verifyBakedCollection('materials', BUILT_MATERIALS, tableEntries, { requireSquare1024: true }),
    verifyBakedCollection('pbr_decals', BUILT_PBR_DECALS, decalTableEntries, { requireSquare1024: false }),
    verifyBakedCollection('pbr_foliage', BUILT_PBR_FOLIAGE, foliageTableEntries, { requireSquare1024: false }),
  ]);

  console.log('=== v5.0 2-Texture PBR Bake & Verification Report ===');
  console.log(`Normal Convention: OpenGL (+Y) [empirical 228/233 FabLibrary + ambientCG NormalGL]`);
  console.log(`Universal Materials : ${vMat.count - 1} + __missing__ (${vMat.count} layers, 1024x1024, A=0 checked: ${vMat.checkedZeroAlpha}, zeroedRGB: ${vMat.zeroAlphaZeroRgb}) [PASS]`);
  console.log(`PBR Decals          : ${vDec.count} sets (native aspect ratio, A=0 checked: ${vDec.checkedZeroAlpha}, zeroedRGB: ${vDec.zeroAlphaZeroRgb}) [PASS]`);
  console.log(`PBR Foliage         : ${vFol.count} sets (native aspect ratio, A=0 checked: ${vFol.checkedZeroAlpha}, zeroedRGB: ${vFol.zeroAlphaZeroRgb}) [PASS]`);
}

main().catch((err) => {
  console.error('[pbr:bake] FAILED:', err);
  process.exit(1);
});

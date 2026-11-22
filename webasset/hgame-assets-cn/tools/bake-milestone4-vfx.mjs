/**
 * Bake & Curate Milestone 4 VFX Assets from Unreal read-only staging:
 *   D:/UnrealWorkspace/Anim58/Saved/WebAssetExport/vfx_staging
 * into webasset/hgame-assets-cn/built/:
 *   1. shader_maps/vfx_noise/  (~60 curated VFXNoiseTexPack textures, 256/512, Straight RGBA, DX->GL normal checked)
 *   2. vfx/textures/           (curated flipbooks <=1024 + sprites <=512, auto alpha extraction, grayscale RealisticBlood)
 *   3. vfx_meshes/             (curated <=4,000 tris unit-normalized clean GLBs + Milestone 2 glass shards ref)
 *   4. vfx_presets/            (36 validated VfxPresetV2 Golden Presets, DrawCall <= 6 each, 10 surfaceType impacts)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validateVfxPresetV2 } from '../../../assets/runtime/vfx/vfx-v2-presets.js';

const TOOLS_DIR = fileURLToPath(new URL('./', import.meta.url));
const CN_ROOT = path.resolve(TOOLS_DIR, '..');
const BUILT_DIR = path.join(CN_ROOT, 'built');

const STAGING_ROOT = path.resolve(
  process.env.HGAME_VFX_STAGING || 'D:/UnrealWorkspace/Anim58/Saved/WebAssetExport/vfx_staging',
);
const MANIFEST_PATH = path.join(STAGING_ROOT, 'vfx_extract_manifest.json');

const OUT_NOISE_DIR = path.join(BUILT_DIR, 'shader_maps', 'vfx_noise');
const OUT_TEX_DIR = path.join(BUILT_DIR, 'vfx', 'textures');
const OUT_MESH_DIR = path.join(BUILT_DIR, 'vfx_meshes');
const OUT_PRESETS_DIR = path.join(BUILT_DIR, 'vfx_presets');
const OUT_REPORT_PATH = path.join(BUILT_DIR, 'milestone4_bake_report.json');

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// Same empirical DX (-Y) vs OpenGL (+Y) normal check from bake-milestone2.mjs
function measureNormalConvention(normRgba, width, height) {
  let sumProd = 0;
  let weight = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const a = normRgba[idx + 3];
      if (a < 20) continue;
      const nxRight = (normRgba[(y * width + x + 1) * 4] / 255) * 2 - 1;
      const nxLeft = (normRgba[(y * width + x - 1) * 4] / 255) * 2 - 1;
      const nxTop = (normRgba[((y - 1) * width + x) * 4] / 255) * 2 - 1;
      const nxBot = (normRgba[((y + 1) * width + x) * 4] / 255) * 2 - 1;
      const nyRight = (normRgba[(y * width + x + 1) * 4 + 1] / 255) * 2 - 1;
      const nyLeft = (normRgba[(y * width + x - 1) * 4 + 1] / 255) * 2 - 1;
      const nyTop = (normRgba[((y - 1) * width + x) * 4 + 1] / 255) * 2 - 1;
      const nyBot = (normRgba[((y + 1) * width + x) * 4 + 1] / 255) * 2 - 1;
      const dNxDx = (nxRight - nxLeft) * 0.5;
      const dNxDyDown = (nxBot - nyTop + nxBot - nxTop) * 0.25; // weighted slope check
      const dNxDy = (nxBot - nxTop) * 0.5;
      const dNyDx = (nyRight - nyLeft) * 0.5;
      void dNxDyDown;
      if (Math.hypot(dNxDx, (nyBot - nyTop) * 0.5) > 0.002) {
        sumProd += dNxDy * dNyDx;
        weight += 1;
      }
    }
  }
  const avg = weight > 0 ? sumProd / weight : 0;
  const convention = avg > 0.0005 ? 'DX_-Y' : avg < -0.0005 ? 'GL_+Y' : 'FLAT';
  return { avg, convention, weight };
}

function flipGreenChannel(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i + 1] = 255 - rgba[i + 1];
  }
}

async function detectFlipbookGrid(filePath, declaredCols = null, declaredRows = null) {
  if (declaredCols && declaredRows) return [declaredCols, declaredRows];
  const meta = await sharp(filePath).metadata();
  const w = meta.width || 512;
  const h = meta.height || 512;
  const { data } = await sharp(filePath).resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scoreGrid = (cols, rows) => {
    let sum = 0;
    let cnt = 0;
    for (let c = 1; c < cols; c++) {
      const x = Math.min(255, Math.round((c * 256) / cols));
      for (let y = 0; y < 256; y++) {
        const p = (y * 256 + x) * 4;
        sum += (data[p] + data[p + 1] + data[p + 2]) * (data[p + 3] / 255);
        cnt += 1;
      }
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.min(255, Math.round((r * 256) / rows));
      for (let x = 0; x < 256; x++) {
        const p = (y * 256 + x) * 4;
        sum += (data[p] + data[p + 1] + data[p + 2]) * (data[p + 3] / 255);
        cnt += 1;
      }
    }
    return cnt > 0 ? sum / cnt : 999;
  };
  if (w === h * 2) return [4, 2];
  if (h === w * 2) return [4, 8];
  const s8 = scoreGrid(8, 8);
  const s6 = scoreGrid(6, 6);
  const s4 = scoreGrid(4, 4);
  if (s8 <= s6 && s8 <= s4 && s8 < 18) return [8, 8];
  if (s6 <= s8 && s6 <= s4 && s6 < 18) return [6, 6];
  return [4, 4];
}

async function bakePngTexture(srcPath, dstPath, {
  maxWidth = 512,
  maxHeight = 512,
  mode = 'sprite', // 'noise_data' | 'normal_noise' | 'sprite' | 'flipbook' | 'blood_grayscale'
} = {}) {
  const meta = await sharp(srcPath).metadata();
  let targetW = Math.min(maxWidth, meta.width || maxWidth);
  let targetH = Math.min(maxHeight, meta.height || maxHeight);
  // Keep aspect ratio cleanly
  if ((meta.width || 0) > maxWidth || (meta.height || 0) > maxHeight) {
    const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height);
    targetW = Math.max(8, Math.round(meta.width * scale));
    targetH = Math.max(8, Math.round(meta.height * scale));
  }

  const { data, info } = await sharp(srcPath)
    .resize(targetW, targetH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  let minA = 255;
  let sumA = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < minA) minA = a;
    sumA += a;
  }
  const meanA = sumA / (pixels.length / 4);
  const hasRealAlpha = minA < 245 && meanA < 252;

  let normalAudit = null;
  if (mode === 'normal_noise') {
    const check = measureNormalConvention(pixels, info.width, info.height);
    let flipped = false;
    if (check.convention === 'DX_-Y') {
      flipGreenChannel(pixels);
      flipped = true;
    }
    const after = flipped ? measureNormalConvention(pixels, info.width, info.height) : check;
    normalAudit = {
      before: check.convention,
      after: after.convention,
      flipped,
    };
  } else if (mode === 'blood_grayscale') {
    // Convert reddish or monochrome blood splatters into clean grayscale mask + alpha for LUT tinting
    let maxL = 1;
    const lums = new Float32Array(pixels.length / 4);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const l = Math.max(r, 0.35 * r + 0.45 * g + 0.2 * b);
      lums[p] = l;
      if (l > maxL) maxL = l;
    }
    const gain = maxL < 220 ? Math.min(2.2, 235 / Math.max(1, maxL)) : 1.0;
    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const v = clampByte(lums[p] * gain);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      if (!hasRealAlpha) {
        // Black-backed blood/splatter: smooth threshold alpha from luminance
        pixels[i + 3] = v < 12 ? 0 : clampByte((v - 10) * 1.15);
      }
    }
  } else if (mode === 'sprite' || mode === 'flipbook') {
    if (!hasRealAlpha) {
      // Black-backed additive or opaque RGB sprite -> derive smooth luminance alpha
      for (let i = 0; i < pixels.length; i += 4) {
        const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        pixels[i + 3] = peak < 6 ? 0 : clampByte(peak * 1.15);
      }
    }
  }
  // 'noise_data': preserve RGBA straight values verbatim!

  await mkdir(path.dirname(dstPath), { recursive: true });
  await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(dstPath);

  return {
    width: info.width,
    height: info.height,
    hasRealAlpha,
    normalAudit,
  };
}

/**
 * Strips textures/images/excess material data and normalizes vertices of a GLB mesh
 * to ~1.0m unit bounding extent (centered in XZ, base or center in Y).
 */
async function bakeNormalizedGlb(srcPath, dstPath, { baseAtZeroY = false } = {}) {
  const buf = await readFile(srcPath);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'glTF') throw new Error(`Not a valid GLB: ${srcPath}`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binHeaderOffset = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeaderOffset);
  const binChunk = Buffer.from(buf.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binLen));

  const mesh = json.meshes?.[0];
  const prim = mesh?.primitives?.[0];
  const posIdx = prim?.attributes?.POSITION;
  if (posIdx === undefined) throw new Error(`GLB missing POSITION: ${srcPath}`);

  const posAcc = json.accessors[posIdx];
  const posBv = json.bufferViews[posAcc.bufferView];
  const byteOffset = (posBv.byteOffset || 0) + (posAcc.byteOffset || 0);
  const stride = posBv.byteStride || 12;
  const count = posAcc.count;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = byteOffset + i * stride;
    const x = binChunk.readFloatLE(o);
    const y = binChunk.readFloatLE(o + 4);
    const z = binChunk.readFloatLE(o + 8);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = baseAtZeroY ? minY : (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const span = Math.max(1e-5, maxX - minX, maxY - minY, maxZ - minZ);
  const scale = 1.0 / span;

  let nMinX = Infinity, nMinY = Infinity, nMinZ = Infinity;
  let nMaxX = -Infinity, nMaxY = -Infinity, nMaxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = byteOffset + i * stride;
    const x = (binChunk.readFloatLE(o) - cx) * scale;
    const y = (binChunk.readFloatLE(o + 4) - cy) * scale;
    const z = (binChunk.readFloatLE(o + 8) - cz) * scale;
    binChunk.writeFloatLE(x, o);
    binChunk.writeFloatLE(y, o + 4);
    binChunk.writeFloatLE(z, o + 8);
    if (x < nMinX) nMinX = x; if (x > nMaxX) nMaxX = x;
    if (y < nMinY) nMinY = y; if (y > nMaxY) nMaxY = y;
    if (z < nMinZ) nMinZ = z; if (z > nMaxZ) nMaxZ = z;
  }
  posAcc.min = [Number(nMinX.toFixed(6)), Number(nMinY.toFixed(6)), Number(nMinZ.toFixed(6))];
  posAcc.max = [Number(nMaxX.toFixed(6)), Number(nMaxY.toFixed(6)), Number(nMaxZ.toFixed(6))];

  // Strip textures/images/samplers & minimize material slot so VFX Master Shader v2 drives cleanly
  delete json.textures;
  delete json.images;
  delete json.samplers;
  json.materials = [{ name: 'vfx_v2_clean', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], roughnessFactor: 0.8, metallicFactor: 0.0 } }];
  prim.material = 0;

  const nextJsonStr = JSON.stringify(json);
  const jsonPad = (4 - (Buffer.byteLength(nextJsonStr, 'utf8') % 4)) % 4;
  const nextJsonBuf = Buffer.concat([Buffer.from(nextJsonStr, 'utf8'), Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (binChunk.length % 4)) % 4;
  const nextBinBuf = Buffer.concat([binChunk, Buffer.alloc(binPad, 0x00)]);

  const totalLen = 12 + 8 + nextJsonBuf.length + 8 + nextBinBuf.length;
  const out = Buffer.alloc(totalLen);
  out.write('glTF', 0, 4, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(nextJsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // JSON
  nextJsonBuf.copy(out, 20);
  const bOff = 20 + nextJsonBuf.length;
  out.writeUInt32LE(nextBinBuf.length, bOff);
  out.writeUInt32LE(0x004e4942, bOff + 4); // BIN
  nextBinBuf.copy(out, bOff + 8);

  await mkdir(path.dirname(dstPath), { recursive: true });
  await writeFile(dstPath, out);

  const idxAcc = prim.indices !== undefined ? json.accessors[prim.indices] : null;
  return {
    tris: idxAcc ? Math.floor(idxAcc.count / 3) : Math.floor(count / 3),
    verts: count,
    bytes: out.length,
    normalizedScale: Number(scale.toFixed(4)),
    boundsMin: posAcc.min,
    boundsMax: posAcc.max,
  };
}

// ---------------------------------------------------------------------------
// Curated Selections
// ---------------------------------------------------------------------------
const NOISE_PICKS = [
  // 20 Packed 3/4-channel masks
  { pack: 'VFXNoiseTexPack', name: 'T_LMagic_Water_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Clouds_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Clouds_Masks_02', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Clouds_Masks_03', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Detail_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_FireBeam_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Fire_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Fire_Masks_02', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Fire_Masks_03', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Lightning_Beam_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Lightning_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Nebula_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Nebula_Masks_02', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Scanline_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Thruster_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Water_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_LParticle_Wind_Masks_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_NoiseMask_Merged_01', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_NoiseMask_Merged_02', role: 'packed', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_TornadoTex_01', role: 'packed', max: 512 },
  // 16 Sprite shapes from VFXNoiseTexPack
  { pack: 'VFXNoiseTexPack', name: 'T_BlastHalf', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_BlastWave', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Effect_Ring', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_FireRing', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Flash_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_GlowIceShimmer01', role: 'sprite', max: 256 },
  { pack: 'VFXNoiseTexPack', name: 'T_KH_ThickRing_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Lightning_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_MFBigSpark_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_MFSpark_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Ring', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Spark_Base_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_SpiralMask', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_Star', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_WindLine', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_VFX_4StarSprite_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_VFX_LensFlare_01', role: 'sprite', max: 512 },
  { pack: 'VFXNoiseTexPack', name: 'T_VFX_ShineSpark_01', role: 'sprite', max: 512 },
  // 8 NoiseNormals
  ...['00', '01', '02', '04', '06', '08', '10', '12'].map((n) => ({
    pack: 'VFXNoiseTexPack',
    name: `T_NoiseNormal_${n}`,
    role: 'normal_noise',
    max: 512,
  })),
  // 16 Tileable single noise masks
  ...['01', '02', '04', '06', '08', '10', '12', '15', '18', '22', '26', '30', '35', '40', '45', '50'].map((n) => ({
    pack: 'VFXNoiseTexPack',
    name: `T_NoiseMask_${n}`,
    role: 'noise',
    max: 256,
  })),
]; // total 62 curated VFXNoiseTexPack textures

const VFX_TEX_PICKS = [
  // Vol1 + Vol2 Cascade (must retain Vol2!)
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Epxlosion_F', outName: 'vol1_explosion_f_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Explosion_E', outName: 'vol1_explosion_e_6x6.png', kind: 'flipbook', cols: 6, rows: 6, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Smoke_A', outName: 'vol1_smoke_a_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Muzzleflash_A', outName: 'vol1_muzzleflash_a.png', kind: 'sprite', max: 512 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Dirt_A', outName: 'vol1_dirt_a.png', kind: 'sprite', max: 512 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Dust', outName: 'vol1_dust.png', kind: 'sprite', max: 256 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Glass', outName: 'vol1_glass_shard.png', kind: 'sprite', max: 256 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Wood', outName: 'vol1_wood_splinter.png', kind: 'sprite', max: 256 },
  { pack: 'Realistic_Starter_VFX_Pack', name: 'T_Rock', outName: 'vol1_rock_chip.png', kind: 'sprite', max: 256 },
  { pack: 'Realistic_Starter_VFX_Pack_Vol2', name: 'T_Epxlosion_G', outName: 'vol2_explosion_g_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Vol2', name: 'T_Explosion_Air', outName: 'vol2_explosion_air_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Vol2', name: 'T_Smoke_G', outName: 'vol2_smoke_g_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Vol2', name: 'T_Steam_A', outName: 'vol2_steam_a_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Vol2', name: 'T_Droplets_A', outName: 'vol2_droplets_a.png', kind: 'sprite', max: 512 },
  // Niagara Vol2
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_Fire_camp_1', outName: 'nv2_fire_camp_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_Fire_torch', outName: 'nv2_fire_torch_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_Smoke_poison', outName: 'nv2_smoke_poison_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_Smoke_tornado', outName: 'nv2_smoke_tornado_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_Lighnting_1', outName: 'nv2_lightning_1.png', kind: 'sprite', max: 512 },
  { pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'T_spark', outName: 'nv2_spark.png', kind: 'sprite', max: 256 },
  // NiagaraExplosion01
  { pack: 'NiagaraExplosion01', name: 'T_Explosion_SubUV_8x8_000', outName: 'nx_explosion_000_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'NiagaraExplosion01', name: 'T_Explosion_SubUV_8x8_005', outName: 'nx_explosion_005_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'NiagaraExplosion01', name: 'T_Smoke_SubUV_8x8_000', outName: 'nx_smoke_000_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'NiagaraExplosion01', name: 'T_Flare_001', outName: 'nx_flare_001.png', kind: 'sprite', max: 512 },
  { pack: 'NiagaraExplosion01', name: 'T_Glow_006', outName: 'nx_glow_006.png', kind: 'sprite', max: 512 },
  { pack: 'NiagaraExplosion01', name: 'T_Ring_002', outName: 'nx_ring_002.png', kind: 'sprite', max: 512 },
  // UltimateFirePackVol1
  { pack: 'UltimateFirePackVol1', name: 'T_FireLarge_01', outName: 'uf_fire_large_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'UltimateFirePackVol1', name: 'T_FireMedium_01', outName: 'uf_fire_medium_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'UltimateFirePackVol1', name: 'T_ExplosionGas_01_D', outName: 'uf_explosion_gas_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'UltimateFirePackVol1', name: 'T_EmbersDotBokeh', outName: 'uf_embers_bokeh.png', kind: 'sprite', max: 512 },
  { pack: 'UltimateFirePackVol1', name: 'T_SmokeSmallRising_01', outName: 'uf_smoke_rising_4x8.png', kind: 'flipbook', cols: 4, rows: 8, max: 1024 },
  // RealisticBlood (converted to tintable grayscale + clean alpha!)
  { pack: 'RealisticBlood', name: 'T_BloodSplatter_01', outName: 'blood_splatter_01.png', kind: 'blood_grayscale', max: 512 },
  { pack: 'RealisticBlood', name: 'T_BloodSplatter_Directional_01', outName: 'blood_directional_01.png', kind: 'blood_grayscale', max: 512 },
  { pack: 'RealisticBlood', name: 'T_BloodSplotch_01', outName: 'blood_splotch_01.png', kind: 'blood_grayscale', max: 512 },
  { pack: 'RealisticBlood', name: 'T_Splat_04', outName: 'blood_splat_04.png', kind: 'blood_grayscale', max: 512 },
  // Vefects Water
  { pack: 'Vefects_Water', name: 'T_VFX_WaterMistFlip', outName: 'water_mist_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Vefects_Water', name: 'T_VFX_WaterSplashNonDir', outName: 'water_splash_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Vefects_Water', name: 'T_VFX_Caustics', outName: 'water_caustics.png', kind: 'sprite', max: 512 },
  { pack: 'Vefects_Water', name: 'T_VFX_Bubble', outName: 'water_bubble.png', kind: 'sprite', max: 256 },
  { pack: 'Vefects_Water', name: 'T_VFX_WaterDropsMask', outName: 'water_drops_mask.png', kind: 'sprite', max: 512 },
  { pack: 'Vefects_Water', name: 'T_VFX_WaterfallMask', outName: 'water_fall_mask.png', kind: 'sprite', max: 512 },
  { pack: 'Vefects_Water', name: 'T_VFX_WavesNormal', outName: 'water_waves_normal.png', kind: 'normal_noise', max: 512 },
  // TrailMaster
  { pack: 'TrailMaster', name: 'T_Slash_03', outName: 'tm_slash_03.png', kind: 'sprite', max: 512 },
  { pack: 'TrailMaster', name: 'T_Trail_002', outName: 'tm_trail_002.png', kind: 'sprite', max: 512 },
  { pack: 'TrailMaster', name: 'T_Ribbon_01', outName: 'tm_ribbon_01.png', kind: 'sprite', max: 512 },
  { pack: 'TrailMaster', name: 'T_Thunder_001', outName: 'tm_thunder_001.png', kind: 'sprite', max: 512 },
  { pack: 'TrailMaster', name: 'T_Flower_0001', outName: 'tm_flower_0001.png', kind: 'sprite', max: 512 },
  { pack: 'TrailMaster', name: 'T_Leaf_0001', outName: 'tm_leaf_0001.png', kind: 'sprite', max: 512 },
  // Shield_FX_Niagara
  { pack: 'Shield_FX_Niagara', name: 'T_Shield_Octagon_01_UV', outName: 'shield_octagon_uv.png', kind: 'sprite', max: 512 },
  { pack: 'Shield_FX_Niagara', name: 'T_Electric_4x4', outName: 'shield_electric_4x4.png', kind: 'flipbook', cols: 4, rows: 4, max: 512 },
  { pack: 'Shield_FX_Niagara', name: 'T_Smoke_8x8_01', outName: 'shield_smoke_8x8.png', kind: 'flipbook', cols: 8, rows: 8, max: 1024 },
  { pack: 'Shield_FX_Niagara', name: 'T_Ripple_02', outName: 'shield_ripple_02.png', kind: 'sprite', max: 512 },
  // InteractFx & Lightning_Element_VFX
  { pack: 'InteractFx', name: 'T_Fx_Lightning01', outName: 'interact_lightning_01.png', kind: 'sprite', max: 512 },
  { pack: 'InteractFx', name: 'T_Fx_Shape01', outName: 'interact_shape_01.png', kind: 'sprite', max: 512 },
  { pack: 'Lightning_Element_VFX', name: 'T_Crack_1', outName: 'lightning_crack_1.png', kind: 'sprite', max: 512 },
];

const MESH_PICKS = [
  { id: 'sm_slash_arc', pack: 'ARPGVFXPack02', name: 'SM_Slash_0007V2_FlipUV', baseAtZeroY: false },
  { id: 'sm_slash_ground', pack: 'ARPGVFXPack02', name: 'SM_GroundSlashPlane_01', baseAtZeroY: false },
  { id: 'sm_half_torus', pack: 'InteractFx', name: 'SM_Fx_HalfTorus', baseAtZeroY: false },
  { id: 'sm_ring', pack: 'ARPGVFXPack02', name: 'SM_Ring_0001', baseAtZeroY: false },
  { id: 'sm_torus', pack: 'InteractFx', name: 'SM_Fx_Torus', baseAtZeroY: false },
  { id: 'sm_shield_dome', pack: 'Shield_FX_Niagara', name: 'SM_Half_Sphere', baseAtZeroY: true },
  { id: 'sm_rune_sphere', pack: 'ARPGVFXPack02', name: 'SM_RuneSphere', baseAtZeroY: false },
  { id: 'sm_fx_sphere', pack: 'InteractFx', name: 'SM_Fx_Sphere', baseAtZeroY: false },
  { id: 'sm_chunks_02', pack: 'NiagaraExplosion01', name: 'SM_Chunks02', baseAtZeroY: false },
  { id: 'sm_chunks_03', pack: 'NiagaraExplosion01', name: 'SM_Chunks03', baseAtZeroY: false },
  { id: 'sm_debris_rock', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Debris_Rock_1', baseAtZeroY: false },
  { id: 'sm_debris_wood', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Debris_Wood_2', baseAtZeroY: false },
  { id: 'sm_debris_glass', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Debris_Glass_1', baseAtZeroY: false },
  { id: 'sm_debris_flat', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Debris_01', baseAtZeroY: false },
  { id: 'sm_ice_shard', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Ice_1', baseAtZeroY: false },
  { id: 'sm_leaf', pack: 'Realistic_Starter_VFX_Pack_Niagara_Vol2', name: 'SM_Leaves', baseAtZeroY: false },
  { id: 'sm_shock_cone', pack: 'NiagaraExplosion01', name: 'SM_Cones03', baseAtZeroY: true },
  { id: 'sm_shock_disc', pack: 'Vefects_Water', name: 'SM_VFX_Disc_Open_Slightly', baseAtZeroY: true },
  { id: 'sm_twist_cylinder', pack: 'InteractFx', name: 'SM_Fx_TwistCylinder', baseAtZeroY: true },
  { id: 'sm_whirlpool', pack: 'InteractFx', name: 'SM_Fx_Whirlpool', baseAtZeroY: false },
  { id: 'sm_water_splash', pack: 'Vefects_Water', name: 'SM_VFX_Splash', baseAtZeroY: true },
  { id: 'sm_water_strip', pack: 'Vefects_Water', name: 'SM_VFX_Subdivided_Strip', baseAtZeroY: false },
  { id: 'sm_lightning_bolt', pack: 'Lightning_Element_VFX', name: 'SM_5', baseAtZeroY: false },
  { id: 'sm_ray_beam', pack: 'ARPGVFXPack02', name: 'SM_Ray', baseAtZeroY: true },
];

function evFlashShakeDecal({ color = [1, 0.65, 0.25], intensity = 6.0, radius = 7.0, duration = 0.16, shake = 0.22, decalId = null, decalScale = [1.5, 1.5], cue = null } = {}) {
  const ev = {};
  if (intensity > 0) ev.pointLightFlash = { color, intensity, radius, duration };
  if (shake > 0) ev.cameraShake = { intensity: shake, duration: Math.min(0.35, shake + 0.12) };
  if (decalId) ev.spawnDecal = { decalId, scale: decalScale, randomRotation: true };
  if (cue) ev.playCue = cue;
  return {
    id: 'fx_event',
    renderer: 'event',
    delay: 0,
    minQuality: 'low',
    events: ev,
  };
}

function buildGoldenPresets() {
  const noiseFire = 'shader_maps/vfx_noise/T_LParticle_Fire_Masks_01.png';
  const noiseCloud = 'shader_maps/vfx_noise/T_LParticle_Clouds_Masks_01.png';
  const noiseMerged = 'shader_maps/vfx_noise/T_NoiseMask_Merged_01.png';
  const noiseWater = 'shader_maps/vfx_noise/T_LMagic_Water_01.png';
  const noiseNebula = 'shader_maps/vfx_noise/T_LParticle_Nebula_Masks_01.png';
  const noiseBolt = 'shader_maps/vfx_noise/T_LParticle_Lightning_Masks_01.png';
  const texSpark = 'shader_maps/vfx_noise/T_MFSpark_01.png';
  const texStar = 'shader_maps/vfx_noise/T_VFX_4StarSprite_01.png';
  const texRing = 'shader_maps/vfx_noise/T_Ring.png';
  const texThickRing = 'shader_maps/vfx_noise/T_KH_ThickRing_01.png';
  const texBlast = 'shader_maps/vfx_noise/T_BlastWave.png';

  const presets = [
    // ==================== 1. Benchmarks (3, upgraded to real UE assets) ====================
    {
      schemaVersion: 2,
      id: 'vfx_bench_explosion',
      name: '写实手雷爆炸 (UE 8x8 Fire->Smoke + 碎块)',
      category: 'v2 标杆预设',
      benchmark: true,
      duration: 2.2,
      loop: false,
      boundsRadius: 6.0,
      emitters: [
        {
          id: 'fireball_to_smoke',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 28,
          spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
          lifetime: [0.85, 1.35],
          sizeStart: [0.95, 1.25],
          shape: { type: 'sphere', radius: 0.35 },
          velocity: { speed: [1.4, 3.6], inherit: 0 },
          motion: { gravity: -1.6, drag: 2.3, curlNoise: { strength: 1.35, frequency: 0.9, speed: 0.7 } },
          curves: {
            size: [0.45, 1.15, 1.65, 2.05],
            alpha: [0.0, 1.0, 0.85, 0.0],
            dissolve: [0.0, 0.0, 0.35, 0.95],
            additive: [1.0, 0.78, 0.14, 0.0],
          },
          material: {
            blendMode: 'pma',
            mainTex: 'vfx/textures/nx_explosion_000_8x8.png',
            noiseTex: noiseFire,
            flipbook: { cols: 8, rows: 8, fps: 42, frameBlend: true, randomStart: false, loop: false },
            noiseScroll: [0.18, -0.35],
            distortionStrength: 0.06,
            dissolveEdgeWidth: 0.12,
            dissolveEdgeColor: [4.5, 1.4, 0.25],
            emissiveBoost: 3.4,
            lutRow: 0,
            tint: [1, 1, 1],
            softParticleDepth: 0.4,
            cameraOffset: 0.15,
          },
        },
        {
          id: 'sparks_burst',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 36,
          spawn: { burst: [{ time: 0, count: 22 }], rate: 0 },
          lifetime: [0.42, 0.9],
          sizeStart: [0.14, 0.24],
          shape: { type: 'hemisphere', radius: 0.25 },
          velocity: { speed: [4.5, 10.5], alignVelocity: true, stretchFactor: 0.22 },
          motion: { gravity: 12.0, drag: 1.2, groundBounce: { enabled: true, groundY: 0, restitution: 0.45, friction: 0.65 } },
          curves: { size: [1, 0.85, 0.45, 0.1], alpha: [1, 1, 0.7, 0] },
          material: { blendMode: 'additive', mainTex: texSpark, emissiveBoost: 3.6, lutRow: 0, tint: [1.0, 0.78, 0.35], cameraOffset: 0.08 },
        },
        {
          id: 'debris_chunks',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.85, 1.35],
          sizeStart: [0.18, 0.32],
          shape: { type: 'hemisphere', radius: 0.3 },
          velocity: { speed: [3.2, 7.8] },
          motion: { gravity: 16.0, drag: 0.6, angularVel: [6, 9, 5], groundBounce: { enabled: true, groundY: 0, restitution: 0.38, friction: 0.55 } },
          curves: { size: [1, 1, 0.85, 0], alpha: [1, 1, 1, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_chunks_02', mainTex: 'vfx/textures/vol1_rock_chip.png', lutRow: 1, tint: [0.6, 0.56, 0.52] },
        },
        {
          id: 'shockwave_ring',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'med',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.38, 0.38],
          sizeStart: [1.0, 1.0],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.35, 2.2, 3.6, 4.4], alpha: [0.85, 0.55, 0.2, 0.0] },
          material: { blendMode: 'additive', meshKind: 'sm_ring', mainTex: texRing, fresnelPower: 1.6, emissiveBoost: 2.6, tint: [1.0, 0.72, 0.32], doubleSided: true },
        },
        evFlashShakeDecal({ intensity: 8.0, radius: 8.0, shake: 0.35, decalId: 'decal_scorch_01', decalScale: [2.2, 2.2], cue: 'sfx_explosion_mid' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_bench_slash_shield',
      name: 'ARPG 噪声刀光 + 能量护盾 (UE GLB + 八边形防护)',
      category: 'v2 标杆预设',
      benchmark: true,
      duration: 1.5,
      loop: false,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'arc_slash',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 4,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.45, 0.45],
          sizeStart: [2.3, 2.3],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          motion: { angularVel: [0, 3.2, 0] },
          curves: { size: [0.85, 1.05, 1.15, 1.2], alpha: [0.0, 1.0, 0.85, 0.0], dissolve: [0.02, 0.12, 0.55, 0.98] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_slash_arc',
            mainTex: 'vfx/textures/tm_slash_03.png',
            noiseTex: noiseMerged,
            uvScroll: [1.1, 0.0],
            noiseScroll: [0.55, -0.75],
            distortionStrength: 0.08,
            dissolveEdgeWidth: 0.14,
            dissolveEdgeColor: [3.2, 1.4, 5.0],
            emissiveBoost: 3.2,
            tint: [0.65, 0.45, 1.0],
            fresnelPower: 1.5,
            doubleSided: true,
          },
        },
        {
          id: 'energy_shield',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [1.25, 1.25],
          sizeStart: [1.8, 1.8],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.75, 1.02, 1.0, 0.92], alpha: [0, 0.9, 0.72, 0], dissolve: [0, 0, 0.15, 0.92] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_rune_sphere',
            mainTex: 'vfx/textures/shield_octagon_uv.png',
            noiseTex: noiseNebula,
            noiseScroll: [0.22, 0.35],
            dissolveEdgeWidth: 0.12,
            dissolveEdgeColor: [0.4, 3.2, 4.5],
            emissiveBoost: 2.5,
            lutRow: 6,
            tint: [0.35, 0.88, 1.0],
            fresnelPower: 2.8,
            doubleSided: true,
          },
        },
        {
          id: 'arc_lightning',
          renderer: 'ribbon',
          delay: 0.02,
          minQuality: 'med',
          maxParticles: 6,
          spawn: { burst: [{ time: 0, count: 3 }], rate: 0 },
          lifetime: [0.28, 0.42],
          sizeStart: [0.12, 0.18],
          shape: { type: 'ring', radius: 1.45 },
          velocity: { speed: [1.5, 3.5] },
          material: { blendMode: 'additive', lightningJitter: 0.3, ribbonLength: 2.1, tint: [0.45, 0.85, 1.0], emissiveBoost: 3.0 },
        },
        {
          id: 'slash_sparks',
          renderer: 'sprite',
          delay: 0.04,
          minQuality: 'low',
          maxParticles: 20,
          spawn: { burst: [{ time: 0.04, count: 14 }], rate: 0 },
          lifetime: [0.28, 0.55],
          sizeStart: [0.14, 0.22],
          shape: { type: 'ring', radius: 1.35 },
          velocity: { speed: [3.0, 6.5], alignVelocity: true, stretchFactor: 0.2 },
          motion: { gravity: 6.0, drag: 2.5 },
          curves: { size: [1, 0.7, 0.3, 0], alpha: [1, 0.9, 0.4, 0] },
          material: { blendMode: 'additive', mainTex: texSpark, emissiveBoost: 3.2, lutRow: 2, tint: [0.7, 0.85, 1.0] },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_bench_blood_splash',
      name: '可染色血浆/果汁喷溅 (RealisticBlood 灰度LUT+落地贴花)',
      category: 'v2 标杆预设',
      benchmark: true,
      duration: 1.4,
      loop: false,
      boundsRadius: 4.0,
      emitters: [
        {
          id: 'blood_droplets',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 40,
          spawn: { burst: [{ time: 0, count: 24 }], rate: 0 },
          lifetime: [0.45, 0.9],
          sizeStart: [0.24, 0.42],
          shape: { type: 'cone', radius: 0.18, angle: 36 },
          velocity: { speed: [3.0, 7.2], alignVelocity: true, stretchFactor: 0.25 },
          motion: { gravity: 15.0, drag: 1.0, groundBounce: { enabled: true, groundY: 0, restitution: 0.15, friction: 0.45 } },
          curves: { size: [0.85, 1.15, 0.95, 0.4], alpha: [0.95, 0.95, 0.8, 0], additive: [0, 0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/blood_splotch_01.png', lutRow: 3, tint: [1, 1, 1], emissiveBoost: 1.0 },
          subEmitters: { onCollision: 'decal_drop' },
        },
        {
          id: 'blood_mist',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'med',
          maxParticles: 12,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 0 },
          lifetime: [0.5, 0.85],
          sizeStart: [0.65, 1.05],
          shape: { type: 'sphere', radius: 0.28 },
          velocity: { speed: [0.8, 2.0] },
          motion: { gravity: 1.2, drag: 3.5, curlNoise: { strength: 0.9, frequency: 1.1, speed: 0.6 } },
          curves: { size: [0.5, 1.1, 1.5, 1.8], alpha: [0, 0.78, 0.45, 0], dissolve: [0.05, 0.25, 0.65, 1], additive: [0, 0, 0, 0] },
          material: {
            blendMode: 'alpha',
            mainTex: 'vfx/textures/blood_splatter_01.png',
            noiseTex: noiseCloud,
            dissolveEdgeWidth: 0.1,
            dissolveEdgeColor: [0.6, 0.08, 0.08],
            lutRow: 3,
            tint: [1, 1, 1],
          },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0, decalId: 'decal_blood_01', decalScale: [1.1, 1.1], cue: 'sfx_blood_splash' }),
      ],
    },

    // ==================== 2. Combat & Explosions (11 -> 12 total w/ benchmark) ====================
    {
      schemaVersion: 2,
      id: 'vfx_molotov_burst',
      name: '燃烧瓶爆燃 (Cascade Vol2 烈火+碎玻璃)',
      category: '战斗与爆破',
      duration: 2.5,
      loop: false,
      boundsRadius: 5.5,
      emitters: [
        {
          id: 'molotov_fire_core',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 6 },
          lifetime: [0.8, 1.4],
          sizeStart: [0.8, 1.3],
          shape: { type: 'ring', radius: 1.1 },
          velocity: { speed: [0.8, 2.2] },
          motion: { gravity: -1.4, drag: 1.8, curlNoise: { strength: 0.9, frequency: 1.0, speed: 0.9 } },
          curves: { size: [0.6, 1.2, 1.4, 0.5], alpha: [0, 0.95, 0.7, 0], dissolve: [0, 0.1, 0.4, 0.95], additive: [1, 0.85, 0.3, 0] },
          material: {
            blendMode: 'pma',
            mainTex: 'vfx/textures/vol2_explosion_g_8x8.png',
            noiseTex: noiseFire,
            flipbook: { cols: 8, rows: 8, fps: 36, frameBlend: true },
            emissiveBoost: 3.2,
            lutRow: 0,
            cameraOffset: 0.12,
          },
        },
        {
          id: 'molotov_glass',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.7, 1.1],
          sizeStart: [0.14, 0.24],
          shape: { type: 'hemisphere', radius: 0.2 },
          velocity: { speed: [2.8, 6.4] },
          motion: { gravity: 15.0, angularVel: [9, 11, 8], groundBounce: { enabled: true, groundY: 0, restitution: 0.35, friction: 0.6 } },
          curves: { size: [1, 1, 0.9, 0], alpha: [1, 1, 0.8, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_glass', mainTex: 'vfx/textures/vol1_glass_shard.png', tint: [0.78, 0.92, 0.86], emissiveBoost: 1.2 },
        },
        evFlashShakeDecal({ color: [1, 0.52, 0.14], intensity: 6.5, radius: 6.5, shake: 0.22, decalId: 'decal_scorch_01', decalScale: [2.0, 2.0], cue: 'sfx_explosion_small' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_flamethrower_jet',
      name: '喷火器烈焰射流 (UltimateFire + Cascade 浓烟)',
      category: '战斗与爆破',
      duration: 2.0,
      loop: false,
      boundsRadius: 6.0,
      emitters: [
        {
          id: 'flame_cone_jet',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 32,
          spawn: { burst: [{ time: 0, count: 4 }], rate: 28 },
          lifetime: [0.5, 0.78],
          sizeStart: [0.35, 0.65],
          shape: { type: 'cone', radius: 0.12, angle: 16 },
          velocity: { speed: [6.5, 9.5], alignVelocity: false },
          motion: { gravity: -2.2, drag: 1.9, curlNoise: { strength: 1.1, frequency: 1.3, speed: 1.2 } },
          curves: { size: [0.4, 1.3, 1.9, 2.3], alpha: [0, 0.95, 0.65, 0], additive: [1, 0.85, 0.25, 0], dissolve: [0, 0.1, 0.5, 1] },
          material: {
            blendMode: 'pma',
            mainTex: 'vfx/textures/uf_fire_medium_8x8.png',
            noiseTex: 'shader_maps/vfx_noise/T_LParticle_FireBeam_Masks_01.png',
            flipbook: { cols: 8, rows: 8, fps: 48, frameBlend: true },
            emissiveBoost: 3.4,
            lutRow: 0,
          },
        },
        {
          id: 'jet_smoke',
          renderer: 'sprite',
          delay: 0.08,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [], rate: 12 },
          lifetime: [0.7, 1.1],
          sizeStart: [0.6, 1.0],
          shape: { type: 'cone', radius: 0.2, angle: 22 },
          velocity: { speed: [3.2, 5.2] },
          motion: { gravity: -1.8, drag: 2.4 },
          curves: { size: [0.6, 1.2, 1.7, 2.0], alpha: [0, 0.5, 0.35, 0], additive: [0, 0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol2_smoke_g_8x8.png', flipbook: { cols: 8, rows: 8, fps: 28, frameBlend: true }, lutRow: 1, tint: [0.7, 0.72, 0.75] },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_muzzle_flash',
      name: '步枪枪口焰与弹道火星',
      category: '战斗与爆破',
      duration: 0.55,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'muzzle_star',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 4,
          spawn: { burst: [{ time: 0, count: 2 }], rate: 0 },
          lifetime: [0.09, 0.13],
          sizeStart: [0.65, 0.9],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0.2], dir: [1, 0, 0] },
          curves: { size: [0.6, 1.25, 0.8], alpha: [1, 0.9, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/vol1_muzzleflash_a.png', emissiveBoost: 4.0, lutRow: 0 },
        },
        {
          id: 'muzzle_sparks',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 0 },
          lifetime: [0.16, 0.32],
          sizeStart: [0.09, 0.15],
          shape: { type: 'cone', radius: 0.05, angle: 18 },
          velocity: { speed: [7.5, 14.0], alignVelocity: true, stretchFactor: 0.24 },
          motion: { gravity: 4.0, drag: 3.0 },
          curves: { size: [1, 0.6, 0], alpha: [1, 0.7, 0] },
          material: { blendMode: 'additive', mainTex: texSpark, emissiveBoost: 3.5, lutRow: 0 },
        },
        {
          id: 'muzzle_smoke',
          renderer: 'sprite',
          delay: 0.02,
          minQuality: 'med',
          maxParticles: 6,
          spawn: { burst: [{ time: 0.02, count: 4 }], rate: 0 },
          lifetime: [0.35, 0.55],
          sizeStart: [0.25, 0.45],
          shape: { type: 'cone', radius: 0.06, angle: 16 },
          velocity: { speed: [1.5, 3.0] },
          motion: { gravity: -0.9, drag: 3.0 },
          curves: { size: [0.5, 1.3, 1.8], alpha: [0, 0.45, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_smoke_a_8x8.png', flipbook: { cols: 8, rows: 8, fps: 24, frameBlend: true }, lutRow: 1 },
        },
        evFlashShakeDecal({ color: [1, 0.8, 0.45], intensity: 5.0, radius: 4.5, duration: 0.07, shake: 0.06, cue: 'sfx_rifle_shot' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_rocket_plume',
      name: '火箭弹尾焰与涡流气浪',
      category: '战斗与爆破',
      duration: 1.6,
      loop: false,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'thruster_fire',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 18 },
          lifetime: [0.35, 0.55],
          sizeStart: [0.45, 0.7],
          shape: { type: 'cone', radius: 0.14, angle: 14 },
          velocity: { speed: [4.5, 7.5], dir: [-0.8, -0.1, 0] },
          motion: { drag: 2.0, curlNoise: { strength: 1.0, frequency: 1.2, speed: 1.0 } },
          curves: { size: [0.6, 1.3, 1.8], alpha: [1, 0.85, 0], additive: [1, 0.5, 0] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/uf_explosion_gas_8x8.png', noiseTex: 'shader_maps/vfx_noise/T_LParticle_Thruster_Masks_01.png', flipbook: { cols: 8, rows: 8, fps: 42, frameBlend: true }, emissiveBoost: 3.3, lutRow: 0 },
        },
        {
          id: 'rocket_ribbon',
          renderer: 'ribbon',
          delay: 0,
          minQuality: 'med',
          maxParticles: 4,
          spawn: { burst: [{ time: 0, count: 2 }], rate: 0 },
          lifetime: [0.55, 0.85],
          sizeStart: [0.16, 0.24],
          shape: { type: 'ring', radius: 0.3 },
          velocity: { speed: [3.2, 5.2] },
          material: { blendMode: 'additive', lightningJitter: 0.08, ribbonLength: 2.5, tint: [1.0, 0.75, 0.35], emissiveBoost: 2.8 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_arpg_heavy_slash',
      name: '重击双段剑气斩 (ARPG 斜劈+地裂)',
      category: '战斗与爆破',
      duration: 1.1,
      loop: false,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'main_slash',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.36, 0.36],
          sizeStart: [2.6, 2.6],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          motion: { angularVel: [0, 4.5, 0] },
          curves: { size: [0.75, 1.1, 1.25], alpha: [0, 1, 0], dissolve: [0, 0.15, 0.98] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_slash_arc',
            mainTex: 'vfx/textures/tm_slash_03.png',
            noiseTex: noiseMerged,
            uvScroll: [1.4, 0],
            dissolveEdgeWidth: 0.16,
            dissolveEdgeColor: [4.8, 2.2, 0.4],
            emissiveBoost: 3.5,
            lutRow: 7,
            doubleSided: true,
          },
        },
        {
          id: 'ground_cleave_crack',
          renderer: 'mesh',
          delay: 0.06,
          minQuality: 'med',
          maxParticles: 2,
          spawn: { burst: [{ time: 0.06, count: 1 }], rate: 0 },
          lifetime: [0.75, 0.75],
          sizeStart: [2.1, 2.1],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.5, 1.05, 1.1], alpha: [0, 0.9, 0], dissolve: [0, 0.1, 0.95] },
          material: { blendMode: 'additive', meshKind: 'sm_slash_ground', mainTex: 'vfx/textures/lightning_crack_1.png', noiseTex: noiseFire, emissiveBoost: 3.0, lutRow: 7, doubleSided: true },
        },
        evFlashShakeDecal({ color: [1, 0.85, 0.35], intensity: 5.5, radius: 5.0, shake: 0.25, cue: 'sfx_sword_heavy' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_lightning_strike',
      name: '天降落雷霹雳 (3D雷柱 + 电弧序列帧 + 焦痕)',
      category: '战斗与爆破',
      duration: 1.4,
      loop: false,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'thunder_bolt_mesh',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 4,
          spawn: { burst: [{ time: 0, count: 2 }], rate: 0 },
          lifetime: [0.35, 0.45],
          sizeStart: [3.2, 3.6],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.8, 1.15, 0.6], alpha: [1, 0.95, 0], dissolve: [0, 0.15, 0.95] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_lightning_bolt',
            mainTex: 'vfx/textures/tm_thunder_001.png',
            noiseTex: noiseBolt,
            uvScroll: [0, -2.5],
            emissiveBoost: 4.0,
            lutRow: 2,
            doubleSided: true,
          },
        },
        {
          id: 'electric_arcs_flipbook',
          renderer: 'sprite',
          delay: 0.02,
          minQuality: 'low',
          maxParticles: 16,
          spawn: { burst: [{ time: 0.02, count: 10 }], rate: 0 },
          lifetime: [0.32, 0.55],
          sizeStart: [0.95, 1.45],
          shape: { type: 'ring', radius: 0.65 },
          velocity: { speed: [0.5, 1.5] },
          curves: { size: [0.7, 1.2, 0.8], alpha: [1, 0.9, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/shield_electric_4x4.png', flipbook: { cols: 4, rows: 4, fps: 32, frameBlend: true }, emissiveBoost: 3.6, lutRow: 2 },
        },
        {
          id: 'arc_ribbons',
          renderer: 'ribbon',
          delay: 0,
          minQuality: 'med',
          maxParticles: 6,
          spawn: { burst: [{ time: 0, count: 4 }], rate: 0 },
          lifetime: [0.25, 0.4],
          sizeStart: [0.1, 0.18],
          shape: { type: 'ring', radius: 0.9 },
          velocity: { speed: [3.2, 6.0] },
          material: { blendMode: 'additive', lightningJitter: 0.42, ribbonLength: 2.2, tint: [0.45, 0.85, 1.0], emissiveBoost: 3.4 },
        },
        evFlashShakeDecal({ color: [0.45, 0.85, 1.0], intensity: 9.0, radius: 9.0, duration: 0.14, shake: 0.3, decalId: 'decal_scorch_01', decalScale: [1.8, 1.8], cue: 'sfx_thunder_strike' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_lightning_chain',
      name: '连锁闪电跳跃弧线 (高频抖动 Ribbon + 节点星芒)',
      category: '战斗与爆破',
      duration: 1.0,
      loop: false,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'chain_ribbons',
          renderer: 'ribbon',
          delay: 0,
          minQuality: 'low',
          maxParticles: 8,
          spawn: { burst: [{ time: 0, count: 5 }], rate: 0 },
          lifetime: [0.35, 0.55],
          sizeStart: [0.14, 0.22],
          shape: { type: 'sphere', radius: 0.35 },
          velocity: { speed: [5.5, 9.5] },
          material: { blendMode: 'additive', lightningJitter: 0.48, ribbonLength: 3.0, tint: [0.5, 0.88, 1.0], emissiveBoost: 3.5 },
        },
        {
          id: 'chain_star_nodes',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 12,
          spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
          lifetime: [0.25, 0.45],
          sizeStart: [0.55, 0.85],
          shape: { type: 'sphere', radius: 0.9 },
          velocity: { speed: [0.5, 1.5] },
          curves: { size: [0.4, 1.3, 0.2], alpha: [1, 0.9, 0] },
          material: { blendMode: 'additive', mainTex: texStar, emissiveBoost: 3.8, lutRow: 2 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_plasma_burst',
      name: '科幻等离子脉冲炸裂 (菲涅尔护盾波 + 星云噪点)',
      category: '战斗与爆破',
      duration: 1.4,
      loop: false,
      boundsRadius: 5.0,
      emitters: [
        {
          id: 'plasma_core',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.75, 0.75],
          sizeStart: [2.2, 2.2],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.25, 1.15, 1.45, 1.6], alpha: [0, 0.95, 0.55, 0], dissolve: [0, 0.1, 0.55, 1] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_fx_sphere',
            mainTex: texBlast,
            noiseTex: noiseNebula,
            noiseScroll: [0.4, -0.35],
            dissolveEdgeWidth: 0.14,
            dissolveEdgeColor: [0.4, 3.8, 4.8],
            fresnelPower: 2.6,
            emissiveBoost: 3.4,
            lutRow: 6,
            doubleSided: true,
          },
        },
        {
          id: 'plasma_streaks',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 16 }], rate: 0 },
          lifetime: [0.35, 0.65],
          sizeStart: [0.22, 0.36],
          shape: { type: 'sphere', radius: 0.25 },
          velocity: { speed: [4.2, 8.5], alignVelocity: true, stretchFactor: 0.28 },
          motion: { drag: 2.2 },
          curves: { size: [1, 0.7, 0.1], alpha: [1, 0.85, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/nx_glow_006.png', emissiveBoost: 3.6, lutRow: 6 },
        },
        evFlashShakeDecal({ color: [0.3, 0.88, 1.0], intensity: 7.0, radius: 7.0, shake: 0.22, cue: 'sfx_plasma_burst' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_ice_shatter',
      name: '寒冰新星碎裂 (3D冰晶体 + 寒霜波动)',
      category: '战斗与爆破',
      duration: 1.5,
      loop: false,
      boundsRadius: 5.0,
      emitters: [
        {
          id: 'ice_crystals',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.75, 1.2],
          sizeStart: [0.32, 0.55],
          shape: { type: 'hemisphere', radius: 0.35 },
          velocity: { speed: [3.2, 6.8] },
          motion: { gravity: 13.0, angularVel: [7, 8, 6], groundBounce: { enabled: true, groundY: 0, restitution: 0.3, friction: 0.6 } },
          curves: { size: [0.4, 1.1, 0.9, 0], alpha: [1, 0.95, 0.7, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_ice_shard', mainTex: 'shader_maps/vfx_noise/T_GlowIceShimmer01.png', fresnelPower: 2.2, emissiveBoost: 2.4, lutRow: 6, doubleSided: true },
        },
        {
          id: 'frost_mist',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 0 },
          lifetime: [0.65, 1.05],
          sizeStart: [0.8, 1.25],
          shape: { type: 'ring', radius: 0.6 },
          velocity: { speed: [1.5, 3.2] },
          motion: { drag: 2.5 },
          curves: { size: [0.6, 1.35, 1.7], alpha: [0, 0.7, 0], additive: [0.4, 0.2, 0] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/vol2_steam_a_8x8.png', flipbook: { cols: 8, rows: 8, fps: 30, frameBlend: true }, lutRow: 6, tint: [0.7, 0.92, 1.0] },
        },
        evFlashShakeDecal({ color: [0.55, 0.9, 1.0], intensity: 4.5, radius: 5.5, shake: 0.18, cue: 'sfx_ice_shatter' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_sonic_shockwave',
      name: '震荡冲击波与环形气浪 (圆锥波罩 + 地面扩散环)',
      category: '战斗与爆破',
      duration: 1.2,
      loop: false,
      boundsRadius: 5.5,
      emitters: [
        {
          id: 'shock_dome',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.42, 0.42],
          sizeStart: [1.2, 1.2],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0], dir: [0, 0, 0] },
          curves: { size: [0.25, 2.1, 3.8], alpha: [0.9, 0.55, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_shock_disc', mainTex: texThickRing, fresnelPower: 1.8, emissiveBoost: 2.6, tint: [0.95, 0.9, 0.8], doubleSided: true },
        },
        {
          id: 'dust_ring',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 20,
          spawn: { burst: [{ time: 0, count: 16 }], rate: 0 },
          lifetime: [0.55, 0.95],
          sizeStart: [0.65, 1.0],
          shape: { type: 'ring', radius: 0.45 },
          velocity: { speed: [3.8, 6.2] },
          motion: { gravity: -0.5, drag: 3.4 },
          curves: { size: [0.5, 1.3, 1.8], alpha: [0, 0.65, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', lutRow: 1, tint: [0.85, 0.82, 0.78] },
        },
        evFlashShakeDecal({ intensity: 3.5, radius: 5.0, shake: 0.3, cue: 'sfx_shockwave' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_c4_demolition',
      name: '重型爆破坍塌烟柱 (8x8冲天火柱+巨石碎块)',
      category: '战斗与爆破',
      duration: 2.6,
      loop: false,
      boundsRadius: 7.0,
      emitters: [
        {
          id: 'demolition_fire_pillar',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 0 },
          lifetime: [1.0, 1.7],
          sizeStart: [1.3, 1.8],
          shape: { type: 'cone', radius: 0.45, angle: 24 },
          velocity: { speed: [2.5, 5.2] },
          motion: { gravity: -2.2, drag: 2.0, curlNoise: { strength: 1.5, frequency: 0.8, speed: 0.6 } },
          curves: { size: [0.5, 1.3, 2.0, 2.4], alpha: [0, 1, 0.8, 0], dissolve: [0, 0.05, 0.4, 0.98], additive: [1, 0.7, 0.1, 0] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/nx_explosion_005_8x8.png', noiseTex: noiseFire, flipbook: { cols: 8, rows: 8, fps: 38, frameBlend: true }, emissiveBoost: 3.6, lutRow: 0, softParticleDepth: 0.45 },
        },
        {
          id: 'demolition_rock_chunks',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.95, 1.6],
          sizeStart: [0.24, 0.44],
          shape: { type: 'cone', radius: 0.4, angle: 38 },
          velocity: { speed: [4.5, 9.2] },
          motion: { gravity: 17.0, angularVel: [5, 7, 4], groundBounce: { enabled: true, groundY: 0, restitution: 0.32, friction: 0.6 } },
          curves: { size: [1, 1, 0.9, 0], alpha: [1, 1, 0.85, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_chunks_03', mainTex: 'vfx/textures/vol1_rock_chip.png', lutRow: 1, tint: [0.5, 0.47, 0.44] },
        },
        evFlashShakeDecal({ intensity: 10.0, radius: 10.0, duration: 0.22, shake: 0.45, decalId: 'decal_scorch_01', decalScale: [3.2, 3.2], cue: 'sfx_explosion_heavy' }),
      ],
    },

    // ==================== 3. All 10 surfaceType Impacts + Juice (11 -> 12 w/ benchmark) ====================
    {
      schemaVersion: 2,
      id: 'vfx_impact_concrete',
      name: '受击·混凝土飞溅 (surface: concrete)',
      category: '全材质受击',
      surfaceType: 'concrete',
      duration: 1.0,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'concrete_chips',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 12,
          spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
          lifetime: [0.45, 0.8],
          sizeStart: [0.09, 0.18],
          shape: { type: 'cone', radius: 0.08, angle: 32 },
          velocity: { speed: [2.8, 5.8] },
          motion: { gravity: 15.0, angularVel: [8, 10, 7], groundBounce: { enabled: true, groundY: 0, restitution: 0.35, friction: 0.6 } },
          curves: { size: [1, 1, 0.8, 0], alpha: [1, 1, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_rock', mainTex: 'vfx/textures/vol1_rock_chip.png', tint: [0.72, 0.72, 0.7] },
        },
        {
          id: 'concrete_dust',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 10,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 0 },
          lifetime: [0.4, 0.75],
          sizeStart: [0.35, 0.6],
          shape: { type: 'cone', radius: 0.1, angle: 28 },
          velocity: { speed: [1.0, 2.4] },
          motion: { drag: 3.5 },
          curves: { size: [0.5, 1.3, 1.7], alpha: [0, 0.6, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/nx_smoke_000_8x8.png', flipbook: { cols: 8, rows: 8, fps: 36, frameBlend: true }, lutRow: 1, tint: [0.85, 0.85, 0.83] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.04, decalId: 'decal_bullet_concrete', decalScale: [0.35, 0.35], cue: 'impact_concrete' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_asphalt',
      name: '受击·柏油路面 (surface: asphalt)',
      category: '全材质受击',
      surfaceType: 'asphalt',
      duration: 1.0,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'asphalt_gravel',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 12,
          spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
          lifetime: [0.4, 0.75],
          sizeStart: [0.08, 0.15],
          shape: { type: 'cone', radius: 0.08, angle: 34 },
          velocity: { speed: [3.0, 6.2] },
          motion: { gravity: 15.5, angularVel: [9, 8, 9], groundBounce: { enabled: true, groundY: 0, restitution: 0.3, friction: 0.65 } },
          curves: { size: [1, 1, 0], alpha: [1, 1, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_rock', mainTex: 'vfx/textures/vol1_rock_chip.png', tint: [0.35, 0.36, 0.38] },
        },
        {
          id: 'asphalt_smoke',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 8,
          spawn: { burst: [{ time: 0, count: 5 }], rate: 0 },
          lifetime: [0.4, 0.7],
          sizeStart: [0.32, 0.55],
          shape: { type: 'cone', radius: 0.1, angle: 25 },
          velocity: { speed: [1.0, 2.2] },
          motion: { drag: 3.6 },
          curves: { size: [0.5, 1.3, 1.7], alpha: [0, 0.55, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', tint: [0.45, 0.45, 0.47] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.04, decalId: 'decal_bullet_asphalt', decalScale: [0.35, 0.35], cue: 'impact_asphalt' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_metal',
      name: '受击·金属跳弹火星 (surface: metal)',
      category: '全材质受击',
      surfaceType: 'metal',
      duration: 0.85,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'metal_sparks',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 18 }], rate: 0 },
          lifetime: [0.28, 0.62],
          sizeStart: [0.1, 0.18],
          shape: { type: 'cone', radius: 0.05, angle: 36 },
          velocity: { speed: [5.5, 11.5], alignVelocity: true, stretchFactor: 0.28 },
          motion: { gravity: 13.0, drag: 1.4, groundBounce: { enabled: true, groundY: 0, restitution: 0.55, friction: 0.7 } },
          curves: { size: [1, 0.75, 0.25], alpha: [1, 0.9, 0] },
          material: { blendMode: 'additive', mainTex: texSpark, emissiveBoost: 4.0, lutRow: 0, tint: [1.0, 0.85, 0.45] },
        },
        {
          id: 'metal_flare',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.12, 0.12],
          sizeStart: [0.55, 0.55],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          curves: { size: [0.6, 1.3, 0.2], alpha: [1, 0.8, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/nx_flare_001.png', emissiveBoost: 3.8, lutRow: 7 },
        },
        evFlashShakeDecal({ color: [1, 0.82, 0.4], intensity: 4.5, radius: 4.0, duration: 0.08, shake: 0.05, decalId: 'decal_bullet_metal', decalScale: [0.3, 0.3], cue: 'impact_metal' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_wood',
      name: '受击·木屑爆裂 (surface: wood)',
      category: '全材质受击',
      surfaceType: 'wood',
      duration: 1.0,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'wood_splinters',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 14,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 0 },
          lifetime: [0.5, 0.85],
          sizeStart: [0.18, 0.3],
          shape: { type: 'cone', radius: 0.08, angle: 34 },
          velocity: { speed: [3.2, 6.8] },
          motion: { gravity: 14.0, angularVel: [10, 12, 9], groundBounce: { enabled: true, groundY: 0, restitution: 0.3, friction: 0.6 } },
          curves: { size: [1, 1, 0], alpha: [1, 1, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_wood', mainTex: 'vfx/textures/vol1_wood_splinter.png', tint: [0.76, 0.54, 0.34] },
        },
        {
          id: 'sawdust',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 8,
          spawn: { burst: [{ time: 0, count: 5 }], rate: 0 },
          lifetime: [0.35, 0.65],
          sizeStart: [0.28, 0.48],
          shape: { type: 'cone', radius: 0.08, angle: 25 },
          velocity: { speed: [1.0, 2.2] },
          motion: { drag: 3.2 },
          curves: { size: [0.6, 1.3, 1.6], alpha: [0, 0.6, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', tint: [0.8, 0.64, 0.44] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.04, decalId: 'decal_bullet_wood', decalScale: [0.32, 0.32], cue: 'impact_wood' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_glass',
      name: '受击·玻璃碎裂飞片 (surface: glass + glass_piece_01)',
      category: '全材质受击',
      surfaceType: 'glass',
      duration: 1.2,
      loop: false,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'glass_shards_3d',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 18,
          spawn: { burst: [{ time: 0, count: 14 }], rate: 0 },
          lifetime: [0.65, 1.05],
          sizeStart: [0.16, 0.3],
          shape: { type: 'cone', radius: 0.15, angle: 42 },
          velocity: { speed: [3.2, 7.2] },
          motion: { gravity: 14.5, angularVel: [10, 12, 11], groundBounce: { enabled: true, groundY: 0, restitution: 0.35, friction: 0.5 } },
          curves: { size: [1, 1, 0.9, 0], alpha: [0.95, 0.9, 0.65, 0] },
          material: { blendMode: 'additive', meshKind: 'glass_piece_01', mainTex: 'vfx/textures/vol1_glass_shard.png', fresnelPower: 2.2, emissiveBoost: 1.9, tint: [0.78, 0.94, 1.0], doubleSided: true },
        },
        {
          id: 'glass_glints',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'med',
          maxParticles: 10,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 0 },
          lifetime: [0.3, 0.55],
          sizeStart: [0.18, 0.3],
          shape: { type: 'sphere', radius: 0.25 },
          velocity: { speed: [1.5, 3.8] },
          curves: { size: [0.4, 1.2, 0], alpha: [1, 0.8, 0] },
          material: { blendMode: 'additive', mainTex: texStar, emissiveBoost: 2.8, tint: [0.85, 0.97, 1.0] },
        },
        evFlashShakeDecal({ color: [0.85, 0.96, 1.0], intensity: 2.5, radius: 3.5, duration: 0.08, shake: 0.05, decalId: 'decal_glass_crack', decalScale: [0.9, 0.9], cue: 'impact_glass' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_tile',
      name: '受击·瓷砖脆裂 (surface: tile)',
      category: '全材质受击',
      surfaceType: 'tile',
      duration: 0.95,
      loop: false,
      boundsRadius: 3.0,
      emitters: [
        {
          id: 'tile_shards',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 14,
          spawn: { burst: [{ time: 0, count: 10 }], rate: 0 },
          lifetime: [0.5, 0.85],
          sizeStart: [0.16, 0.28],
          shape: { type: 'cone', radius: 0.08, angle: 36 },
          velocity: { speed: [3.2, 6.5] },
          motion: { gravity: 15.0, angularVel: [11, 9, 10], groundBounce: { enabled: true, groundY: 0, restitution: 0.35, friction: 0.55 } },
          curves: { size: [1, 1, 0], alpha: [1, 0.9, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_flat', mainTex: 'vfx/textures/vol1_rock_chip.png', tint: [0.92, 0.91, 0.88] },
        },
        {
          id: 'tile_powder',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 8,
          spawn: { burst: [{ time: 0, count: 5 }], rate: 0 },
          lifetime: [0.35, 0.6],
          sizeStart: [0.3, 0.5],
          shape: { type: 'cone', radius: 0.08, angle: 24 },
          velocity: { speed: [0.8, 2.0] },
          motion: { drag: 3.5 },
          curves: { size: [0.5, 1.3, 1.6], alpha: [0, 0.65, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', tint: [0.96, 0.96, 0.94] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.04, decalId: 'decal_bullet_tile', decalScale: [0.32, 0.32], cue: 'impact_tile' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_dirt',
      name: '受击·泥土飞扬 (surface: dirt)',
      category: '全材质受击',
      surfaceType: 'dirt',
      duration: 1.1,
      loop: false,
      boundsRadius: 3.2,
      emitters: [
        {
          id: 'dirt_clumps',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 18,
          spawn: { burst: [{ time: 0, count: 14 }], rate: 0 },
          lifetime: [0.45, 0.85],
          sizeStart: [0.16, 0.3],
          shape: { type: 'cone', radius: 0.12, angle: 28 },
          velocity: { speed: [2.8, 6.0] },
          motion: { gravity: 14.0, drag: 1.0, groundBounce: { enabled: true, groundY: 0, restitution: 0.18, friction: 0.7 } },
          curves: { size: [0.8, 1.1, 0.5], alpha: [1, 0.9, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dirt_a.png', tint: [0.52, 0.38, 0.26] },
        },
        {
          id: 'dirt_plume',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 10,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 0 },
          lifetime: [0.55, 0.95],
          sizeStart: [0.45, 0.75],
          shape: { type: 'cone', radius: 0.12, angle: 22 },
          velocity: { speed: [1.5, 3.2] },
          motion: { drag: 3.2 },
          curves: { size: [0.5, 1.3, 1.8], alpha: [0, 0.62, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', tint: [0.58, 0.45, 0.32] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.03, cue: 'impact_dirt' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_grass',
      name: '受击·草皮碎叶飞散 (surface: grass)',
      category: '全材质受击',
      surfaceType: 'grass',
      duration: 1.1,
      loop: false,
      boundsRadius: 3.2,
      emitters: [
        {
          id: 'grass_blades',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.6, 1.05],
          sizeStart: [0.22, 0.36],
          shape: { type: 'cone', radius: 0.14, angle: 34 },
          velocity: { speed: [2.6, 5.4] },
          motion: { gravity: 9.5, drag: 2.2, angularVel: [6, 8, 7], curlNoise: { strength: 1.2, frequency: 1.5, speed: 1.0 } },
          curves: { size: [1, 1, 0.5], alpha: [1, 0.95, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_leaf', mainTex: 'vfx/textures/tm_leaf_0001.png', tint: [0.48, 0.78, 0.32], doubleSided: true },
        },
        {
          id: 'grass_dirt',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 10,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 0 },
          lifetime: [0.4, 0.75],
          sizeStart: [0.28, 0.48],
          shape: { type: 'cone', radius: 0.1, angle: 24 },
          velocity: { speed: [1.4, 2.8] },
          motion: { drag: 3.2 },
          curves: { size: [0.5, 1.3, 1.7], alpha: [0, 0.55, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dirt_a.png', tint: [0.46, 0.36, 0.24] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.02, cue: 'impact_grass' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_water',
      name: '受击·水面浪花水柱 (surface: water)',
      category: '全材质受击',
      surfaceType: 'water',
      duration: 1.2,
      loop: false,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'water_plume_flip',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 8,
          spawn: { burst: [{ time: 0, count: 5 }], rate: 0 },
          lifetime: [0.55, 0.85],
          sizeStart: [0.75, 1.1],
          shape: { type: 'cone', radius: 0.12, angle: 16 },
          velocity: { speed: [2.4, 4.4] },
          motion: { gravity: 6.5, drag: 1.4 },
          curves: { size: [0.55, 1.15, 1.4], alpha: [0.95, 0.85, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/water_splash_8x8.png', flipbook: { cols: 8, rows: 8, fps: 42, frameBlend: true }, tint: [0.85, 0.94, 1.0] },
        },
        {
          id: 'water_ripple_ring',
          renderer: 'mesh',
          delay: 0.04,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0.04, count: 1 }], rate: 0 },
          lifetime: [0.7, 0.7],
          sizeStart: [1.0, 1.0],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          curves: { size: [0.35, 1.6, 2.4], alpha: [0.85, 0.45, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_ring', mainTex: 'vfx/textures/shield_ripple_02.png', tint: [0.75, 0.92, 1.0], emissiveBoost: 1.6, doubleSided: true },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.02, cue: 'impact_water' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_fabric',
      name: '受击·织物棉絮散落 (surface: fabric)',
      category: '全材质受击',
      surfaceType: 'fabric',
      duration: 0.95,
      loop: false,
      boundsRadius: 2.5,
      emitters: [
        {
          id: 'fabric_tufts',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 16,
          spawn: { burst: [{ time: 0, count: 12 }], rate: 0 },
          lifetime: [0.45, 0.85],
          sizeStart: [0.16, 0.28],
          shape: { type: 'cone', radius: 0.1, angle: 34 },
          velocity: { speed: [1.8, 4.2] },
          motion: { gravity: 3.5, drag: 3.8, curlNoise: { strength: 1.1, frequency: 1.6, speed: 1.0 } },
          curves: { size: [0.6, 1.1, 0.8], alpha: [0.9, 0.8, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol1_dust.png', tint: [0.88, 0.84, 0.78] },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.02, cue: 'impact_fabric' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_impact_juice_lime',
      name: '受击·青柠果汁/毒液爆溅 (过审可染色预设)',
      category: '全材质受击',
      duration: 1.2,
      loop: false,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'lime_droplets',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 32,
          spawn: { burst: [{ time: 0, count: 22 }], rate: 0 },
          lifetime: [0.45, 0.85],
          sizeStart: [0.22, 0.38],
          shape: { type: 'cone', radius: 0.16, angle: 36 },
          velocity: { speed: [3.2, 7.0], alignVelocity: true, stretchFactor: 0.24 },
          motion: { gravity: 15.0, drag: 1.0, groundBounce: { enabled: true, groundY: 0, restitution: 0.2, friction: 0.5 } },
          curves: { size: [0.9, 1.15, 0.5], alpha: [0.95, 0.9, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/blood_splat_04.png', lutRow: 5, tint: [1, 1, 1], emissiveBoost: 1.15 },
          subEmitters: { onCollision: 'decal_drop' },
        },
        evFlashShakeDecal({ intensity: 0, shake: 0.04, decalId: 'decal_blood_01', decalScale: [0.9, 0.9], cue: 'sfx_blood_splash' }),
      ],
    },

    // ==================== 4. Environment & Interaction (11 -> 12 w/ benchmark) ====================
    {
      schemaVersion: 2,
      id: 'vfx_campfire_loop',
      name: '营地篝火与余烬上升 (loop + 8x8火焰)',
      category: '环境与交互',
      duration: 2.0,
      loop: true,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'campfire_flames',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 20,
          spawn: { burst: [{ time: 0, count: 4 }], rate: 10 },
          lifetime: [0.65, 1.05],
          sizeStart: [0.75, 1.1],
          shape: { type: 'ring', radius: 0.25 },
          velocity: { speed: [0.5, 1.1] },
          motion: { gravity: -1.4, drag: 0.8 },
          curves: { size: [0.65, 1.1, 0.8], alpha: [0, 0.95, 0], additive: [1, 0.7, 0.1] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/nv2_fire_camp_8x8.png', flipbook: { cols: 8, rows: 8, fps: 36, frameBlend: true }, emissiveBoost: 2.8, lutRow: 0 },
        },
        {
          id: 'campfire_embers',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'med',
          maxParticles: 24,
          spawn: { burst: [], rate: 12 },
          lifetime: [0.9, 1.6],
          sizeStart: [0.06, 0.12],
          shape: { type: 'ring', radius: 0.35 },
          velocity: { speed: [0.8, 1.8] },
          motion: { gravity: -1.6, curlNoise: { strength: 1.4, frequency: 1.2, speed: 0.9 } },
          curves: { size: [1, 0.8, 0.2], alpha: [0, 1, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/uf_embers_bokeh.png', emissiveBoost: 3.2, lutRow: 0 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_torch_flame',
      name: '火把摇曳焰苗 (8x8火焰 + 微烟)',
      category: '环境与交互',
      duration: 1.8,
      loop: true,
      boundsRadius: 2.5,
      emitters: [
        {
          id: 'torch_fire',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 12,
          spawn: { burst: [{ time: 0, count: 3 }], rate: 8 },
          lifetime: [0.55, 0.85],
          sizeStart: [0.42, 0.6],
          shape: { type: 'point', radius: 0.06 },
          velocity: { speed: [0.4, 0.9] },
          motion: { gravity: -1.3 },
          curves: { size: [0.7, 1.1, 0.6], alpha: [0, 0.95, 0], additive: [1, 0.6, 0] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/nv2_fire_torch_8x8.png', flipbook: { cols: 8, rows: 8, fps: 42, frameBlend: true }, emissiveBoost: 3.0, lutRow: 0 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_water_fountain_splash',
      name: '喷泉水花涌动 (3D水花网格 + 水雾翻滚)',
      category: '环境与交互',
      duration: 1.6,
      loop: false,
      boundsRadius: 4.0,
      emitters: [
        {
          id: 'water_splash_mesh',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 3,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.9, 0.9],
          sizeStart: [1.6, 1.6],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          motion: { angularVel: [0, 0.8, 0] },
          curves: { size: [0.45, 1.15, 1.35], alpha: [0, 0.85, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_water_splash', mainTex: 'vfx/textures/water_caustics.png', noiseTex: noiseWater, uvScroll: [0, 0.8], emissiveBoost: 1.8, tint: [0.7, 0.9, 1.0], fresnelPower: 1.5, doubleSided: true },
        },
        {
          id: 'water_mist_puffs',
          renderer: 'sprite',
          delay: 0.05,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [{ time: 0.05, count: 10 }], rate: 0 },
          lifetime: [0.7, 1.2],
          sizeStart: [0.65, 1.0],
          shape: { type: 'ring', radius: 0.45 },
          velocity: { speed: [1.2, 2.8] },
          motion: { gravity: 2.2, drag: 2.2 },
          curves: { size: [0.6, 1.2, 1.6], alpha: [0, 0.65, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/water_mist_8x8.png', flipbook: { cols: 8, rows: 8, fps: 36, frameBlend: true }, tint: [0.88, 0.96, 1.0] },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_waterfall_mist',
      name: '蒸汽喷口 / 瀑布白雾 (Cascade Vol2 8x8 Steam)',
      category: '环境与交互',
      duration: 2.0,
      loop: true,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'steam_stream',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 4 }], rate: 12 },
          lifetime: [0.9, 1.5],
          sizeStart: [0.65, 1.05],
          shape: { type: 'cone', radius: 0.25, angle: 24 },
          velocity: { speed: [1.8, 3.6] },
          motion: { gravity: -0.9, drag: 1.8, curlNoise: { strength: 1.1, frequency: 0.9, speed: 0.7 } },
          curves: { size: [0.5, 1.2, 1.8], alpha: [0, 0.65, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/vol2_steam_a_8x8.png', flipbook: { cols: 8, rows: 8, fps: 28, frameBlend: true }, tint: [0.9, 0.95, 1.0], softParticleDepth: 0.4 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_rain_splashes',
      name: '雨滴砸地水花涟漪 (Vefects Droplets + 地面波纹)',
      category: '环境与交互',
      duration: 2.0,
      loop: true,
      boundsRadius: 5.0,
      emitters: [
        {
          id: 'rain_streaks',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 40,
          spawn: { burst: [{ time: 0, count: 8 }], rate: 26 },
          lifetime: [0.35, 0.55],
          sizeStart: [0.16, 0.24],
          shape: { type: 'box', size: [3.2, 0.2, 3.2] },
          velocity: { speed: [7.5, 9.5], dir: [0.08, -1.0, 0], alignVelocity: true, stretchFactor: 0.32 },
          motion: { gravity: 4.0, groundBounce: { enabled: true, groundY: 0, restitution: 0.1, friction: 0.5 } },
          curves: { size: [1, 1, 0.5], alpha: [0.7, 0.8, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/vol2_droplets_a.png', tint: [0.75, 0.9, 1.0], emissiveBoost: 1.4 },
          subEmitters: { onCollision: 'decal_drop' },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_poison_cloud',
      name: '剧毒沼气浓雾区 (Niagara Vol2 毒烟 8x8 + LUT 5)',
      category: '环境与交互',
      duration: 2.2,
      loop: false,
      boundsRadius: 5.0,
      emitters: [
        {
          id: 'toxic_gas',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 14 }], rate: 6 },
          lifetime: [1.1, 1.8],
          sizeStart: [0.9, 1.4],
          shape: { type: 'ring', radius: 1.1 },
          velocity: { speed: [0.4, 1.2] },
          motion: { gravity: -0.35, drag: 2.4, curlNoise: { strength: 1.2, frequency: 0.8, speed: 0.5 } },
          curves: { size: [0.6, 1.25, 1.65], alpha: [0, 0.8, 0], additive: [0, 0.1, 0] },
          material: { blendMode: 'pma', mainTex: 'vfx/textures/nv2_smoke_poison_8x8.png', noiseTex: noiseCloud, flipbook: { cols: 8, rows: 8, fps: 24, frameBlend: true }, lutRow: 5, emissiveBoost: 1.6 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_magic_portal_vortex',
      name: '传送门漩涡法阵 (Whirlpool网格 + 螺旋溶解 + 吸积粒子)',
      category: '环境与交互',
      duration: 2.4,
      loop: true,
      boundsRadius: 4.5,
      emitters: [
        {
          id: 'portal_vortex_mesh',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [2.2, 2.2],
          sizeStart: [2.2, 2.2],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          motion: { angularVel: [0, 1.4, 0] },
          curves: { size: [0.9, 1.05, 1.0, 0.9], alpha: [0, 0.92, 0.88, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_whirlpool', mainTex: 'shader_maps/vfx_noise/T_SpiralMask.png', noiseTex: noiseNebula, uvScroll: [0.35, 0.15], emissiveBoost: 3.0, lutRow: 6, fresnelPower: 1.8, doubleSided: true },
        },
        {
          id: 'portal_motes',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'med',
          maxParticles: 24,
          spawn: { burst: [], rate: 12 },
          lifetime: [0.8, 1.4],
          sizeStart: [0.12, 0.2],
          shape: { type: 'ring', radius: 1.3 },
          velocity: { speed: [0.5, 1.2] },
          motion: { vortex: { strength: 3.2, axis: [0, 1, 0], pull: 1.4 } },
          curves: { size: [0.4, 1.1, 0.1], alpha: [0, 1, 0] },
          material: { blendMode: 'additive', mainTex: texStar, emissiveBoost: 3.2, lutRow: 6 },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_arcane_aura_buff',
      name: '角色奥术增益光柱 (TwistCylinder + 扫描流光)',
      category: '环境与交互',
      duration: 1.8,
      loop: false,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'aura_pillar',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [1.4, 1.4],
          sizeStart: [1.7, 1.7],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          motion: { angularVel: [0, 2.2, 0] },
          curves: { size: [0.7, 1.05, 1.1, 0.85], alpha: [0, 0.9, 0.65, 0], dissolve: [0, 0.1, 0.5, 0.95] },
          material: {
            blendMode: 'additive',
            meshKind: 'sm_twist_cylinder',
            mainTex: 'vfx/textures/interact_shape_01.png',
            noiseTex: 'shader_maps/vfx_noise/T_LParticle_Scanline_Masks_01.png',
            uvScroll: [0, 1.4],
            dissolveEdgeWidth: 0.12,
            dissolveEdgeColor: [3.8, 3.0, 0.6],
            emissiveBoost: 3.0,
            lutRow: 7,
            fresnelPower: 1.4,
            doubleSided: true,
          },
        },
        {
          id: 'aura_ring_base',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [1.2, 1.2],
          sizeStart: [1.8, 1.8],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          curves: { size: [0.5, 1.15, 1.3], alpha: [0, 0.85, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_ring', mainTex: texRing, emissiveBoost: 2.8, lutRow: 7, doubleSided: true },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_heal_bloom',
      name: '圣光治愈爆发 (花瓣星芒 + 金色光环 LUT 7)',
      category: '环境与交互',
      duration: 1.5,
      loop: false,
      boundsRadius: 3.5,
      emitters: [
        {
          id: 'heal_stars',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 16 }], rate: 0 },
          lifetime: [0.7, 1.25],
          sizeStart: [0.24, 0.4],
          shape: { type: 'ring', radius: 0.8 },
          velocity: { speed: [1.0, 2.2] },
          motion: { gravity: -1.8, curlNoise: { strength: 0.9, frequency: 1.4, speed: 0.8 } },
          curves: { size: [0.4, 1.2, 0.2], alpha: [0, 1, 0] },
          material: { blendMode: 'additive', mainTex: 'vfx/textures/tm_flower_0001.png', emissiveBoost: 2.8, lutRow: 7 },
        },
        {
          id: 'heal_ring',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 2,
          spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
          lifetime: [0.85, 0.85],
          sizeStart: [1.5, 1.5],
          shape: { type: 'point', radius: 0 },
          velocity: { speed: [0, 0] },
          curves: { size: [0.4, 1.4, 1.9], alpha: [0, 0.9, 0] },
          material: { blendMode: 'additive', meshKind: 'sm_ring', mainTex: texRing, emissiveBoost: 3.0, lutRow: 7, doubleSided: true },
        },
        evFlashShakeDecal({ color: [1.0, 0.9, 0.45], intensity: 5.0, radius: 5.5, duration: 0.25, shake: 0, cue: 'sfx_heal_cast' }),
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_falling_leaves',
      name: '风吹落叶飘零 (3D树叶Mesh + CurlNoise 飘摆)',
      category: '环境与交互',
      duration: 2.6,
      loop: true,
      boundsRadius: 5.0,
      emitters: [
        {
          id: 'drifting_leaves',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 6 }], rate: 10 },
          lifetime: [1.6, 2.4],
          sizeStart: [0.22, 0.36],
          shape: { type: 'box', size: [2.8, 0.4, 2.8] },
          velocity: { speed: [0.8, 1.6], dir: [0.8, -0.7, 0.2] },
          motion: { gravity: 0.9, drag: 1.5, angularVel: [2.5, 3.2, 2.2], curlNoise: { strength: 2.2, frequency: 0.9, speed: 0.8 }, groundBounce: { enabled: true, groundY: 0, restitution: 0.05, friction: 0.9 } },
          curves: { size: [0.8, 1.05, 1.0, 0.4], alpha: [0, 0.95, 0.9, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_leaf', mainTex: 'vfx/textures/tm_leaf_0001.png', tint: [0.85, 0.58, 0.24], doubleSided: true },
        },
      ],
    },
    {
      schemaVersion: 2,
      id: 'vfx_tornado_whirlwind',
      name: '旋风龙卷涡流 (8x8 Tornado + 涡流碎屑)',
      category: '环境与交互',
      duration: 2.4,
      loop: true,
      boundsRadius: 5.5,
      emitters: [
        {
          id: 'tornado_funnel',
          renderer: 'sprite',
          delay: 0,
          minQuality: 'low',
          maxParticles: 24,
          spawn: { burst: [{ time: 0, count: 4 }], rate: 14 },
          lifetime: [1.0, 1.5],
          sizeStart: [0.9, 1.4],
          shape: { type: 'ring', radius: 0.5 },
          velocity: { speed: [0.6, 1.4] },
          motion: { gravity: -2.0, vortex: { strength: 5.5, axis: [0, 1, 0], pull: 1.2 } },
          curves: { size: [0.65, 1.25, 1.75], alpha: [0, 0.72, 0], additive: [0, 0, 0] },
          material: { blendMode: 'alpha', mainTex: 'vfx/textures/nv2_smoke_tornado_8x8.png', noiseTex: 'shader_maps/vfx_noise/T_TornadoTex_01.png', flipbook: { cols: 8, rows: 8, fps: 36, frameBlend: true }, lutRow: 1, tint: [0.82, 0.8, 0.76] },
        },
        {
          id: 'tornado_debris',
          renderer: 'mesh',
          delay: 0,
          minQuality: 'med',
          maxParticles: 16,
          spawn: { burst: [], rate: 8 },
          lifetime: [1.1, 1.6],
          sizeStart: [0.16, 0.28],
          shape: { type: 'ring', radius: 0.9 },
          velocity: { speed: [1.0, 2.0] },
          motion: { gravity: -1.8, angularVel: [6, 7, 5], vortex: { strength: 6.2, axis: [0, 1, 0], pull: 0.8 } },
          curves: { size: [0.7, 1.0, 0.3], alpha: [0, 0.95, 0] },
          material: { blendMode: 'alpha', meshKind: 'sm_debris_flat', mainTex: 'vfx/textures/vol1_dirt_a.png', tint: [0.65, 0.56, 0.44] },
        },
      ],
    },
  ];

  // Validate all 36 presets strictly & count visual emitters (= max theoretical DrawCalls per preset)
  for (const preset of presets) {
    const chk = validateVfxPresetV2(preset);
    if (!chk.ok) {
      throw new Error(`Invalid golden preset "${preset.id}": ${chk.errors.join('; ')}`);
    }
    const visualCount = preset.emitters.filter((e) => e.renderer !== 'event').length;
    if (visualCount > 6) {
      throw new Error(`Golden preset "${preset.id}" exceeds 6 DrawCalls (${visualCount})`);
    }
  }
  return presets;
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing staging manifest: ${MANIFEST_PATH}. Run ue_extract_vfx.py first.`);
  }
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  // Clean output dirs for idempotence (preserve vfx_meshes/glass from Milestone 2!)
  await mkdir(OUT_NOISE_DIR, { recursive: true });
  await mkdir(OUT_TEX_DIR, { recursive: true });
  await mkdir(OUT_MESH_DIR, { recursive: true });
  await mkdir(OUT_PRESETS_DIR, { recursive: true });

  const findTex = (pack, name) => manifest.textures.find((t) => t.pack === pack && t.name === name);
  const findMesh = (pack, name) => manifest.meshes.find((x) => x.pack === pack && x.name === name);

  // 1. VFXNoiseTexPack (~60 curated textures)
  const noiseItems = [];
  let normalFlippedCount = 0;
  for (const pick of NOISE_PICKS) {
    const rec = findTex(pick.pack, pick.name);
    if (!rec) throw new Error(`Missing noise texture: ${pick.pack}/${pick.name}`);
    const src = path.join(STAGING_ROOT, rec.fileRel);
    const outFile = `${pick.name}.png`;
    const dst = path.join(OUT_NOISE_DIR, outFile);
    const mode = pick.role === 'normal_noise'
      ? 'normal_noise'
      : pick.role === 'sprite'
        ? 'sprite'
        : 'noise_data';
    const baked = await bakePngTexture(src, dst, { maxWidth: pick.max, maxHeight: pick.max, mode });
    if (baked.normalAudit?.flipped) normalFlippedCount += 1;
    noiseItems.push({
      id: `vfx_noise__${pick.name}`,
      name: pick.name,
      role: pick.role,
      path: `shader_maps/vfx_noise/${outFile}`,
      url: `/assets/cn/shader_maps/vfx_noise/${outFile}`,
      width: baked.width,
      height: baked.height,
      normalAudit: baked.normalAudit,
    });
  }
  await writeFile(
    path.join(OUT_NOISE_DIR, 'vfx_noise_table.json'),
    JSON.stringify({ version: 1, count: noiseItems.length, normalFlippedCount, items: noiseItems }, null, 2),
  );

  // 2. Curated Flipbooks & Sprites -> built/vfx/textures/
  const texItems = [];
  for (const pick of VFX_TEX_PICKS) {
    const rec = findTex(pick.pack, pick.name);
    if (!rec) throw new Error(`Missing VFX texture: ${pick.pack}/${pick.name}`);
    const src = path.join(STAGING_ROOT, rec.fileRel);
    const dst = path.join(OUT_TEX_DIR, pick.outName);
    const baked = await bakePngTexture(src, dst, {
      maxWidth: pick.max,
      maxHeight: pick.max,
      mode: pick.kind,
    });
    if (baked.normalAudit?.flipped) normalFlippedCount += 1;
    const grid = pick.kind === 'flipbook' ? await detectFlipbookGrid(src, pick.cols, pick.rows) : [1, 1];
    texItems.push({
      id: `vfx_tex__${pick.outName.replace(/\.png$/, '')}`,
      name: pick.name,
      pack: pick.pack,
      kind: pick.kind,
      cols: grid[0],
      rows: grid[1],
      key: `vfx/textures/${pick.outName}`,
      path: `vfx/textures/${pick.outName}`,
      url: `/assets/cn/vfx/textures/${pick.outName}`,
      width: baked.width,
      height: baked.height,
      normalAudit: baked.normalAudit,
    });
  }
  await writeFile(
    path.join(OUT_TEX_DIR, 'vfx_textures_table.json'),
    JSON.stringify({ version: 1, count: texItems.length, items: texItems }, null, 2),
  );

  // 3. Curated VFX Low-Poly Meshes -> built/vfx_meshes/
  const meshItems = [];
  for (const pick of MESH_PICKS) {
    const rec = findMesh(pick.pack, pick.name);
    if (!rec) throw new Error(`Missing VFX mesh: ${pick.pack}/${pick.name}`);
    const src = path.join(STAGING_ROOT, rec.fileRel);
    const outFile = `${pick.id}.glb`;
    const dst = path.join(OUT_MESH_DIR, outFile);
    const baked = await bakeNormalizedGlb(src, dst, { baseAtZeroY: pick.baseAtZeroY });
    if (baked.tris > 4000) {
      throw new Error(`Mesh ${pick.id} exceeds 4,000 tris budget (${baked.tris})`);
    }
    meshItems.push({
      id: pick.id,
      name: pick.name,
      pack: pick.pack,
      path: `vfx_meshes/${outFile}`,
      url: `/assets/cn/vfx_meshes/${outFile}`,
      ...baked,
    });
  }
  // Include existing Milestone 2 glass shards (glass/glass_piece_01..09.glb)
  for (let gi = 1; gi <= 9; gi++) {
    const gid = `glass_piece_${String(gi).padStart(2, '0')}`;
    const gPath = path.join(OUT_MESH_DIR, 'glass', `${gid}.glb`);
    if (existsSync(gPath)) {
      meshItems.push({
        id: gid,
        name: gid,
        pack: 'AdvancedGlassPack',
        path: `vfx_meshes/glass/${gid}.glb`,
        url: `/assets/cn/vfx_meshes/glass/${gid}.glb`,
        tris: 12,
        verts: 12,
      });
    }
  }
  await writeFile(
    path.join(OUT_MESH_DIR, 'vfx_meshes_table.json'),
    JSON.stringify({ version: 1, count: meshItems.length, items: meshItems }, null, 2),
  );

  // 4. 36 Golden VfxPresetV2 Presets -> built/vfx_presets/
  // Clear old .vfx.json files cleanly
  const presets = buildGoldenPresets();
  const noiseSet = new Set(noiseItems.map((n) => n.path));
  const texSet = new Set(texItems.map((t) => t.key));
  const meshSet = new Set(meshItems.map((m) => m.id));

  for (const preset of presets) {
    // Verify EVERY referenced mainTex, noiseTex, meshKind actually exists!
    for (const em of preset.emitters) {
      if (em.renderer === 'event') continue;
      const mTex = em.material?.mainTex;
      if (mTex && !mTex.startsWith('builtin:') && !noiseSet.has(mTex) && !texSet.has(mTex)) {
        throw new Error(`Preset "${preset.id}" emitter "${em.id}" references missing mainTex: ${mTex}`);
      }
      const nTex = em.material?.noiseTex;
      if (nTex && !nTex.startsWith('builtin:') && !noiseSet.has(nTex) && !texSet.has(nTex)) {
        throw new Error(`Preset "${preset.id}" emitter "${em.id}" references missing noiseTex: ${nTex}`);
      }
      const mKind = em.material?.meshKind;
      if (em.renderer === 'mesh' && mKind && !meshSet.has(mKind)) {
        throw new Error(`Preset "${preset.id}" emitter "${em.id}" references missing meshKind: ${mKind}`);
      }
    }
    await writeFile(path.join(OUT_PRESETS_DIR, `${preset.id}.vfx.json`), JSON.stringify(preset, null, 2));
  }

  const presetEntries = presets.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    benchmark: Boolean(p.benchmark),
    surfaceType: p.surfaceType || null,
    schemaVersion: 2,
    duration: p.duration,
    loop: Boolean(p.loop),
    visualEmitterCount: p.emitters.filter((e) => e.renderer !== 'event').length,
    path: `vfx_presets/${p.id}.vfx.json`,
    url: `/assets/cn/vfx_presets/${p.id}.vfx.json`,
    preset: p,
  }));

  await writeFile(
    path.join(OUT_PRESETS_DIR, 'vfx_presets_table.json'),
    JSON.stringify({
      version: 2,
      count: presetEntries.length,
      texturesTableUrl: '/assets/cn/vfx/textures/vfx_textures_table.json',
      noiseTableUrl: '/assets/cn/shader_maps/vfx_noise/vfx_noise_table.json',
      meshesTableUrl: '/assets/cn/vfx_meshes/vfx_meshes_table.json',
      items: presetEntries,
    }, null, 2),
  );

  const report = {
    milestone: 4,
    generatedAt: new Date().toISOString(),
    counts: {
      noisePackCurated: noiseItems.length,
      vfxTexturesCurated: texItems.length,
      vfxMeshesCurated: meshItems.length,
      goldenPresetsV2: presets.length,
    },
    normalFlippedCount,
    maxMeshTris: Math.max(...meshItems.map((x) => x.tris || 0)),
    maxVisualEmittersPerPreset: Math.max(...presetEntries.map((p) => p.visualEmitterCount)),
  };
  await writeFile(OUT_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('MILESTONE4_BAKE_DONE:', JSON.stringify(report));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

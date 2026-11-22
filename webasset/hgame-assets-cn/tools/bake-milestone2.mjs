/**
 * Bake & Unify Milestone 2 Assets (LUTs, AdvancedGlassPack, Unified v5.0 2-Texture Decals)
 * from Unreal read-only staging (D:/UnrealWorkspace/Anim58/Saved/WebAssetExport) into
 * webasset/hgame-assets-cn/built/ with full DX/GL normal correlation & Straight-RGBA verification.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const TOOLS_DIR = fileURLToPath(new URL('./', import.meta.url));
const CN_ROOT = path.resolve(TOOLS_DIR, '..');
const BUILT_DIR = path.join(CN_ROOT, 'built');
const MANIFESTS_DIR = path.join(CN_ROOT, 'manifests');

const BUILT_LUTS = path.join(BUILT_DIR, 'luts');
const BUILT_GLASS_MAPS = path.join(BUILT_DIR, 'shader_maps', 'glass');
const BUILT_GLASS_MESHES = path.join(BUILT_DIR, 'vfx_meshes', 'glass');
const BUILT_PBR_DECALS = path.join(BUILT_DIR, 'pbr_decals');

const STAGING_ROOT = path.resolve(
  process.env.HGAME_M2_STAGING || 'D:/UnrealWorkspace/Anim58/Saved/WebAssetExport/milestone2_staging',
);
const UNREAL_EXPORT_ROOT = path.resolve(
  process.env.HGAME_UNREAL_EXPORT_ROOT || 'D:/UnrealWorkspace/Anim58/Saved/WebAssetExport',
);
const OLD_DECALS_DIR = path.join(UNREAL_EXPORT_ROOT, 'decals');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);

// ---------------------------------------------------------------------------
// Empirical Normal Convention Verification (DX -Y vs OpenGL +Y)
// ---------------------------------------------------------------------------
/**
 * Measures discrete mixed-partial curl product sum(dNx/dy_down * dNy/dx) over non-transparent pixels.
 * Because heightfield partials satisfy d(-dh/dx)/dy_down = -d²h/dxdy:
 *   - OpenGL (+Y up): Ny = +dh/dy_down -> dNy/dx = +d²h/dxdy -> product < 0 (< -0.12)
 *   - DirectX (-Y up): Ny = -dh/dy_down -> dNy/dx = -d²h/dxdy -> product > 0 (> +0.12)
 */
function measureNormalConvention(normRgba, alphaBuf, width, height, { isNormalRm = false } = {}) {
  let curlSum = 0;
  let curlEnergy = 0;
  let invalidZ = 0;
  let active = 0;

  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const idx = y * width + x;
      if (alphaBuf && alphaBuf[idx * 4 + 3] < 24) continue;
      active++;
      const nIdx = idx * 4;
      if (!isNormalRm && normRgba[nIdx + 2] < 120) {
        invalidZ++;
        continue;
      }
      const nx = (px, py) => (normRgba[(py * width + px) * 4] / 127.5) - 1;
      const ny = (px, py) => (normRgba[(py * width + px) * 4 + 1] / 127.5) - 1;
      const a = nx(x, y + 1) - nx(x, y - 1);
      const b = ny(x + 1, y) - ny(x - 1, y);
      curlSum += a * b;
      curlEnergy += Math.abs(a * b);
    }
  }

  const ratio = curlEnergy > 0.25 ? curlSum / curlEnergy : 0;
  let convention = 'FLAT';
  if (active > 0 && invalidZ > active * 0.5) convention = 'INVALID_Z';
  else if (ratio > 0.12) convention = 'DX_-Y';
  else if (ratio < -0.12) convention = 'GL_+Y';

  return { convention, ratio: Number(ratio.toFixed(4)), invalidZ, active };
}

function flipAndRepairNormalRgba(normRgba, width, height, { flipY = false, power = 1.0 } = {}) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    const bz = normRgba[i4 + 2];
    if (bz < 120) {
      // Repair Unreal green unbaked / downward placeholder normals
      out[i4] = 128;
      out[i4 + 1] = 128;
      out[i4 + 2] = 255;
      out[i4 + 3] = 255;
      continue;
    }
    let rx = normRgba[i4] / 127.5 - 1;
    let ry = (flipY ? 255 - normRgba[i4 + 1] : normRgba[i4 + 1]) / 127.5 - 1;
    let rz = bz / 127.5 - 1;
    rx *= power;
    ry *= power;
    const len = Math.hypot(rx, ry, rz);
    if (len > 1e-4) {
      rx /= len;
      ry /= len;
      rz /= len;
    } else {
      rx = 0;
      ry = 0;
      rz = 1;
    }
    out[i4] = clampByte((rx + 1) * 0.5 * 255);
    out[i4 + 1] = clampByte((ry + 1) * 0.5 * 255);
    out[i4 + 2] = clampByte((rz + 1) * 0.5 * 255);
    out[i4 + 3] = 255;
  }
  return out;
}

function dilateAlphaEdges(rgba, w, h, passes = 10) {
  let tmp = new Uint8Array(rgba);
  for (let pass = 0; pass < passes; pass++) {
    let changed = 0;
    const next = new Uint8Array(tmp);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (tmp[i + 3] > 8) continue;
        let r = 0, g = 0, b = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const ni = (yy * w + xx) * 4;
            if (tmp[ni + 3] > 8) {
              r += tmp[ni];
              g += tmp[ni + 1];
              b += tmp[ni + 2];
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          next[i] = Math.round(r / cnt);
          next[i + 1] = Math.round(g / cnt);
          next[i + 2] = Math.round(b / cnt);
          changed++;
        }
      }
    }
    tmp = next;
    if (!changed) break;
  }
  rgba.set(tmp);
}

function toShadedGrayscaleBlood(colorRgba, width, height) {
  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    const r = srgbToLinear(colorRgba[i4] / 255);
    const g = srgbToLinear(colorRgba[i4 + 1] / 255);
    const b = srgbToLinear(colorRgba[i4 + 2] / 255);
    // Use dominant blood channel / luma with clot depth contrast in [0.16..1.0]
    const rawTone = Math.max(r * 0.72 + g * 0.18 + b * 0.1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const boosted = clamp01(0.16 + Math.sqrt(clamp01(rawTone)) * 0.84);
    const gray = clampByte(linearToSrgb(boosted) * 255);
    colorRgba[i4] = gray;
    colorRgba[i4 + 1] = gray;
    colorRgba[i4 + 2] = gray;
  }
}

async function writeStraightPair(outDir, colorBuf, normalRmBuf, w, h) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    sharp(colorBuf, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'color.png')),
    sharp(normalRmBuf, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(outDir, 'normal_rm.png')),
  ]);
}

function packNormalRm(normGlRgba, roughValFn, metalValFn, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    out[i4] = normGlRgba[i4];
    out[i4 + 1] = normGlRgba[i4 + 1];
    out[i4 + 2] = clampByte(roughValFn(i));
    out[i4 + 3] = clampByte(metalValFn(i));
  }
  return out;
}

function generateNormalFromMask(maskGray, width, height, strength = 2.4) {
  const norm = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y + 1 < height ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x + 1 < width ? x + 1 : width - 1;
      const dX = (maskGray[y * width + xp] - maskGray[y * width + xm]) / 255;
      // OpenGL +Y up: image y increases downward, so dh/dy_up = -(h(y+1) - h(y-1))
      const dY = (maskGray[ym * width + x] - maskGray[yp * width + x]) / 255;
      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i4 = (y * width + x) * 4;
      norm[i4] = clampByte((nx + 1) * 0.5 * 255);
      norm[i4 + 1] = clampByte((ny + 1) * 0.5 * 255);
      norm[i4 + 2] = clampByte((nz + 1) * 0.5 * 255);
      norm[i4 + 3] = 255;
    }
  }
  return norm;
}

// ---------------------------------------------------------------------------
// 1. AmplifyLUTPack (207 lossless 256x16 PNGs + Chinese scene preset aliases)
// ---------------------------------------------------------------------------
const LUT_CHINESE_PRESETS = [
  { id: 'cn_cbd_real', label: 'CBD 通透写实', lutId: 'Base__Normal', intensity: 0.35 },
  { id: 'cn_old_town_dusk', label: '老城黄昏', lutId: 'StylizedMisc__SettingSun', intensity: 0.72 },
  { id: 'cn_horror_cold', label: '中式微恐冷青', lutId: 'StylizedMisc__CyanHaze', intensity: 0.78 },
  { id: 'cn_storm_cold', label: '暴雨阴冷', lutId: 'Base__ColdM', intensity: 0.72 },
  { id: 'cn_night_alley', label: '深夜巷战冷蓝', lutId: 'StylizedMisc__Nightfall', intensity: 0.75 },
  { id: 'cn_moonlight', label: '月夜清冷', lutId: 'StylizedMisc__SrongMoonLight', intensity: 0.75 },
  { id: 'cn_film_high_contrast', label: '胶片高对比', lutId: 'Base__ContrastB', intensity: 0.8 },
  { id: 'cn_kodak_2383', label: '复古柯达胶片', lutId: 'StockFilmBase__K23A', intensity: 0.82 },
  { id: 'cn_old_film_warm', label: '怀旧老胶片', lutId: 'FilmColor__OldFilm', intensity: 0.78 },
  { id: 'cn_vintage_faded', label: '复古褪色纪实', lutId: 'StockFilmVintage__Vintage3', intensity: 0.75 },
  { id: 'cn_blockbuster_teal_orange', label: '商业大片青橙', lutId: 'PopularLooks__Blockbuster1', intensity: 0.78 },
  { id: 'cn_action_urban', label: '都市动作锐化', lutId: 'PopularLooks__Blockbuster3', intensity: 0.75 },
  { id: 'cn_summer_action', label: '盛夏高饱和动作', lutId: 'FilmColor__SummerAction', intensity: 0.75 },
  { id: 'cn_vibrant_arcade', label: '鲜明街机增艳', lutId: 'Base__VibranceB', intensity: 0.8 },
  { id: 'cn_warm_afternoon', label: '暖阳午后', lutId: 'Base__WarmM', intensity: 0.7 },
  { id: 'cn_wasteland', label: '末日废土风', lutId: 'PopularLooks__80sPost-ApocalypticAction', intensity: 0.8 },
  { id: 'cn_bleach_bypass', label: '银留漂白质感', lutId: 'Base__BleachL', intensity: 0.7 },
  { id: 'cn_bw_noir', label: '黑白硬派电影', lutId: 'FilmMono__B_WHighContrast', intensity: 0.9 },
  { id: 'cn_colorblind_deuteranopia', label: '色盲辅助 · 绿色弱', lutId: 'ColorBlindness__Deuteranopia', intensity: 1.0 },
  { id: 'cn_colorblind_protanopia', label: '色盲辅助 · 红色弱', lutId: 'ColorBlindness__Protanopia', intensity: 1.0 },
  { id: 'cn_colorblind_tritanopia', label: '色盲辅助 · 蓝黄弱', lutId: 'ColorBlindness__Tritanopia', intensity: 1.0 },
];

async function bakeLuts(manifest) {
  await mkdir(BUILT_LUTS, { recursive: true });
  const items = [];
  const categories = new Map();

  for (const src of manifest.luts) {
    const srcAbs = path.join(STAGING_ROOT, src.fileRel);
    const meta = await sharp(srcAbs).metadata();
    if (meta.width !== 256 || meta.height !== 16) {
      throw new Error(`Invalid LUT dimensions for ${src.name}: ${meta.width}x${meta.height}`);
    }
    const id = `${src.category}__${src.name}`;
    const relOut = `${src.category}/${src.name}.png`;
    const dstAbs = path.join(BUILT_LUTS, src.category, `${src.name}.png`);
    await mkdir(path.dirname(dstAbs), { recursive: true });
    // Lossless RGBA8 PNG output (no KTX2)
    await sharp(srcAbs).ensureAlpha().png({ compressionLevel: 9 }).toFile(dstAbs);
    items.push({
      id,
      name: src.name,
      category: src.category,
      path: relOut,
      width: 256,
      height: 16,
      lutSize: 16,
      srgbInput: true,
      flipY: false,
    });
    categories.set(src.category, (categories.get(src.category) || 0) + 1);
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(items.map((x) => [x.id, x]));
  const presets = LUT_CHINESE_PRESETS.filter((p) => {
    if (!byId.has(p.lutId)) {
      throw new Error(`Chinese LUT preset references missing LUT ID: ${p.lutId}`);
    }
    return true;
  }).map((p) => ({ ...p, path: byId.get(p.lutId).path }));

  const table = {
    version: '1.0.0',
    format: '256x16-png-lossless',
    lutSize: 16,
    srgbInput: true,
    flipY: false,
    count: items.length,
    categories: [...categories.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    presets,
    items,
  };
  await writeFile(path.join(BUILT_LUTS, 'luts_table.json'), JSON.stringify(table, null, 2));
  return { count: items.length, presets: presets.length, categories: table.categories.length };
}

// ---------------------------------------------------------------------------
// 2. AdvancedGlassPack (8 core 512x512 glass maps + 9 GlassPieces GLBs)
// ---------------------------------------------------------------------------
async function bakeGlass(manifest) {
  await mkdir(BUILT_GLASS_MAPS, { recursive: true });
  await mkdir(BUILT_GLASS_MESHES, { recursive: true });

  const glassTextureByName = new Map(manifest.glassTextures.map((t) => [t.name, t]));
  const GLASS_MAP_SPECS = [
    { id: 'glass_dirt_mask_01', src: 'T_DirtMask_01', kind: 'mask', desc: '窗户灰尘/脏污粗糙度遮罩 01' },
    { id: 'glass_dirt_mask_02', src: 'T_DirtMask_07', kind: 'mask', desc: '窗户水渍/泥垢粗糙度遮罩 02' },
    { id: 'glass_rain_mask', src: 'T_RainDroplets_M', kind: 'mask', desc: '玻璃雨滴/水痕粗糙度遮罩' },
    { id: 'glass_frost_mask', src: 'T_Frost_01', kind: 'mask', desc: '玻璃冰霜结晶遮罩' },
    { id: 'glass_shattered_mask', src: 'T_Glass_Shattered_01_M', kind: 'mask_maxrgb', desc: '蛛网碎裂玻璃遮罩' },
    { id: 'glass_pattern_01_normal_rm', src: 'T_Pattern_01_N', kind: 'normal_rm', roughness: 28, desc: '老小区压花磨砂玻璃法线 (OpenGL +Y)' },
    { id: 'glass_scratched_01_normal_rm', src: 'T_Scrachted_01_N', kind: 'normal_rm', roughness: 34, desc: '划痕老化玻璃法线 (OpenGL +Y)' },
    { id: 'glass_shattered_01_normal_rm', src: 'T_Glass_Shattered_01_N', kind: 'normal_rm', roughness: 22, desc: '蛛网碎裂玻璃法线 (OpenGL +Y)' },
  ];

  const mapEntries = [];
  const normalChecks = [];
  const size = 512;

  for (const spec of GLASS_MAP_SPECS) {
    const rec = glassTextureByName.get(spec.src);
    if (!rec) throw new Error(`Missing exported glass texture: ${spec.src}`);
    const srcAbs = path.join(STAGING_ROOT, rec.fileRel);
    const { data } = await sharp(srcAbs).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });

    const outPath = path.join(BUILT_GLASS_MAPS, `${spec.id}.png`);
    if (spec.kind === 'mask' || spec.kind === 'mask_maxrgb') {
      const out = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i++) {
        const i4 = i * 4;
        const v = spec.kind === 'mask_maxrgb'
          ? Math.max(data[i4], data[i4 + 1], data[i4 + 2])
          : data[i4]; // R holds single-channel mask in T_DirtMask / T_Frost
        out[i4] = v;
        out[i4 + 1] = v;
        out[i4 + 2] = v;
        out[i4 + 3] = 255;
      }
      await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outPath);
      mapEntries.push({
        id: spec.id,
        source: spec.src,
        kind: 'mask',
        path: `${spec.id}.png`,
        width: size,
        height: size,
        description: spec.desc,
      });
    } else {
      const conv = measureNormalConvention(data, null, size, size);
      const needsFlip = conv.convention === 'DX_-Y';
      const glNorm = flipAndRepairNormalRgba(data, size, size, { flipY: needsFlip });
      const packed = packNormalRm(glNorm, () => spec.roughness, () => 0, size, size);
      const afterCheck = measureNormalConvention(packed, null, size, size, { isNormalRm: true });
      await sharp(packed, { raw: { width: size, height: size, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outPath);
      normalChecks.push({ id: spec.id, before: conv.convention, flipped: needsFlip, after: afterCheck.convention });
      mapEntries.push({
        id: spec.id,
        source: spec.src,
        kind: 'normal_rm',
        normalConvention: 'OpenGL (+Y)',
        dxFlipped: needsFlip,
        path: `${spec.id}.png`,
        width: size,
        height: size,
        description: spec.desc,
      });
    }
  }

  await writeFile(
    path.join(BUILT_GLASS_MAPS, 'glass_maps_table.json'),
    JSON.stringify({ version: '1.0.0', resolution: size, count: mapEntries.length, items: mapEntries }, null, 2),
  );

  // Patch 9 GlassPieces GLBs with clean translucent glass PBR material & copy to built/vfx_meshes/glass/
  const meshEntries = [];
  for (let idx = 1; idx <= 9; idx++) {
    const num = String(idx).padStart(2, '0');
    const srcName = `SM_GlassPieces_Single_${num}.glb`;
    const dstName = `glass_piece_${num}.glb`;
    const srcAbs = path.join(STAGING_ROOT, 'glass_meshes', srcName);
    const dstAbs = path.join(BUILT_GLASS_MESHES, dstName);
    const buf = await readFile(srcAbs);
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
    const binStart = 20 + jsonLen;
    const binLen = buf.readUInt32LE(binStart);
    const binChunk = buf.subarray(binStart + 8, binStart + 8 + binLen);

    gltf.materials = [
      {
        name: 'M_GlassShard',
        pbrMetallicRoughness: {
          baseColorFactor: [0.85, 0.93, 0.99, 0.55],
          metallicFactor: 0.05,
          roughnessFactor: 0.08,
        },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
    ];
    const jsonBytesRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
    const padJson = (4 - (jsonBytesRaw.length % 4)) % 4;
    const jsonPadded = padJson ? Buffer.concat([jsonBytesRaw, Buffer.alloc(padJson, 0x20)]) : jsonBytesRaw;

    const totalLen = 12 + 8 + jsonPadded.length + 8 + binLen;
    const out = Buffer.allocUnsafe(totalLen);
    out.write('glTF', 0, 4, 'ascii');
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(totalLen, 8);
    out.writeUInt32LE(jsonPadded.length, 12);
    out.writeUInt32LE(0x4e4f534a, 16);
    jsonPadded.copy(out, 20);
    const bOff = 20 + jsonPadded.length;
    out.writeUInt32LE(binLen, bOff);
    out.writeUInt32LE(0x004e4942, bOff + 4);
    binChunk.copy(out, bOff + 8);
    await writeFile(dstAbs, out);

    const prim = gltf.meshes?.[0]?.primitives?.[0];
    const tris = prim?.indices !== undefined ? Math.round(gltf.accessors[prim.indices].count / 3) : 0;
    const verts = prim?.attributes?.POSITION !== undefined ? gltf.accessors[prim.attributes.POSITION].count : 0;
    meshEntries.push({
      id: `glass_piece_${num}`,
      source: `SM_GlassPieces_Single_${num}`,
      path: dstName,
      tris,
      verts,
      bytes: out.length,
    });
  }

  await writeFile(
    path.join(BUILT_GLASS_MESHES, 'glass_meshes_table.json'),
    JSON.stringify({ version: '1.0.0', count: meshEntries.length, items: meshEntries }, null, 2),
  );

  return { maps: mapEntries.length, meshes: meshEntries.length, normalChecks };
}

// ---------------------------------------------------------------------------
// 3. Curated Unified v5.0 2-Texture Decals (6 sources -> built/pbr_decals/)
// ---------------------------------------------------------------------------
const UWC_CURATED = [
  // Glass bullet holes & shattered panes (6)
  { src: 'MI_Glass_Common_1', id: 'decal_bullet_glass_01', category: 'bullet_glass', surfaceType: 'glass', size: 0.28 },
  { src: 'MI_Glass_Common_3', id: 'decal_bullet_glass_02', category: 'bullet_glass', surfaceType: 'glass', size: 0.28 },
  { src: 'MI_Glass_Common_5', id: 'decal_bullet_glass_03', category: 'bullet_glass', surfaceType: 'glass', size: 0.32 },
  { src: 'MI_Glass_Windshield_1', id: 'decal_bullet_windshield_01', category: 'bullet_glass', surfaceType: 'glass', size: 0.34 },
  { src: 'MI_Glass_Windshield_3', id: 'decal_bullet_windshield_02', category: 'bullet_glass', surfaceType: 'glass', size: 0.34 },
  { src: 'MI_Glass_Bulletproof_1', id: 'decal_bullet_glass_armored_01', category: 'bullet_glass', surfaceType: 'glass', size: 0.3 },
  // Metal bullet holes, armor dents, scratches (8)
  { src: 'MI_Metal_Solid_1', id: 'decal_bullet_metal_solid_01', category: 'bullet_metal', surfaceType: 'metal', size: 0.24 },
  { src: 'MI_Metal_Solid_3', id: 'decal_bullet_metal_solid_02', category: 'bullet_metal', surfaceType: 'metal', size: 0.24 },
  { src: 'MI_Metal_Thin_1', id: 'decal_bullet_metal_thin_01', category: 'bullet_metal', surfaceType: 'metal', size: 0.24 },
  { src: 'MI_Metal_Thin_3', id: 'decal_bullet_metal_thin_02', category: 'bullet_metal', surfaceType: 'metal', size: 0.25 },
  { src: 'MI_Metal_Thin_5', id: 'decal_bullet_metal_thin_03', category: 'bullet_metal', surfaceType: 'metal', size: 0.25 },
  { src: 'MI_Metal_Armored_1', id: 'decal_bullet_metal_armor_01', category: 'bullet_metal', surfaceType: 'metal', size: 0.26 },
  { src: 'MI_Metal_Armored_3', id: 'decal_bullet_metal_armor_02', category: 'bullet_metal', surfaceType: 'metal', size: 0.26 },
  { src: 'MI_Scratch_1', id: 'decal_melee_metal_scratch_01', category: 'melee_slash', surfaceType: 'metal', size: 0.35 },
  // Wood bullet holes & splits (4)
  { src: 'MI_Wood_1', id: 'decal_bullet_wood_01', category: 'bullet_wood', surfaceType: 'wood', size: 0.24 },
  { src: 'MI_Wood_3', id: 'decal_bullet_wood_02', category: 'bullet_wood', surfaceType: 'wood', size: 0.25 },
  { src: 'MI_Wood_5', id: 'decal_bullet_wood_03', category: 'bullet_wood', surfaceType: 'wood', size: 0.26 },
  { src: 'MI_Wood_7', id: 'decal_bullet_wood_04', category: 'bullet_wood', surfaceType: 'wood', size: 0.26 },
  // Brick, concrete, asphalt, crack, burnt, fabric (12)
  { src: 'MI_Concrete_1', id: 'decal_bullet_concrete_uwc_01', category: 'bullet_concrete', surfaceType: 'concrete', size: 0.26 },
  { src: 'MI_Concrete_3', id: 'decal_bullet_concrete_uwc_02', category: 'bullet_concrete', surfaceType: 'concrete', size: 0.26 },
  { src: 'MI_Concrete_5', id: 'decal_bullet_concrete_uwc_03', category: 'bullet_concrete', surfaceType: 'concrete', size: 0.28 },
  { src: 'MI_Brick_1', id: 'decal_bullet_brick_01', category: 'bullet_brick', surfaceType: 'brick', size: 0.26 },
  { src: 'MI_Brick_3', id: 'decal_bullet_brick_02', category: 'bullet_brick', surfaceType: 'brick', size: 0.26 },
  { src: 'MI_Brick_5', id: 'decal_bullet_brick_03', category: 'bullet_brick', surfaceType: 'brick', size: 0.28 },
  { src: 'MI_Asphalt_1', id: 'decal_bullet_asphalt_01', category: 'bullet_asphalt', surfaceType: 'asphalt', size: 0.26 },
  { src: 'MI_Asphalt_3', id: 'decal_bullet_asphalt_02', category: 'bullet_asphalt', surfaceType: 'asphalt', size: 0.28 },
  { src: 'MI_Crack_1', id: 'decal_impact_crack_uwc_01', category: 'crack', surfaceType: 'concrete', size: 0.34 },
  { src: 'MI_Crack_3', id: 'decal_impact_crack_uwc_02', category: 'crack', surfaceType: 'concrete', size: 0.35 },
  { src: 'MI_Burnt_1', id: 'decal_impact_burnt_01', category: 'scorch', surfaceType: 'concrete', size: 0.35 },
  { src: 'MI_Fabric_1', id: 'decal_bullet_fabric_01', category: 'bullet_fabric', surfaceType: 'fabric', size: 0.22 },
  // Axe & Knife melee slashes (6)
  { src: 'MI_Axe_1', id: 'decal_melee_axe_01', category: 'melee_slash', surfaceType: 'wood', size: 0.35 },
  { src: 'MI_Axe_2', id: 'decal_melee_axe_02', category: 'melee_slash', surfaceType: 'concrete', size: 0.35 },
  { src: 'MI_Axe_4', id: 'decal_melee_axe_03', category: 'melee_slash', surfaceType: 'metal', size: 0.35 },
  { src: 'MI_Knife_1', id: 'decal_melee_knife_01', category: 'melee_slash', surfaceType: 'wood', size: 0.32 },
  { src: 'MI_Knife_2', id: 'decal_melee_knife_02', category: 'melee_slash', surfaceType: 'concrete', size: 0.32 },
  { src: 'MI_Knife_4', id: 'decal_melee_knife_03', category: 'melee_slash', surfaceType: 'metal', size: 0.32 },
];

const RB_BLOOD_CURATED = [
  { file: 'T_Blood_Splatter_01.png', id: 'decal_blood_jet_01', size: 0.55 },
  { file: 'T_Blood_Splatter_04.png', id: 'decal_blood_jet_02', size: 0.55 },
  { file: 'T_Blood_Splatter_08.png', id: 'decal_blood_jet_03', size: 0.55 },
  { file: 'T_Blood_Splatter_12.png', id: 'decal_blood_jet_04', size: 0.55 },
  { file: 'T_Blood_Splatter_16.png', id: 'decal_blood_jet_05', size: 0.55 },
  { file: 'T_Blood_Splatter_19.png', id: 'decal_blood_jet_06', size: 0.55 },
];

const OLD_UNREAL_CURATED = [
  // VOL3_Blood deduplicated (18 -> + 6 RB jets = 24 blood decals total)
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_01a', id: 'decal_blood_splatter_01', category: 'combat_blood', size: 0.55, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_02b', id: 'decal_blood_splatter_02', category: 'combat_blood', size: 0.55, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_03b', id: 'decal_blood_splatter_03', category: 'combat_blood', size: 0.5, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_04b', id: 'decal_blood_drip_wall_01', category: 'combat_blood', size: 0.45, tintableGrayscale: true, placement: 'wall' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Splatter_01a', id: 'decal_blood_smear_01', category: 'combat_blood', size: 0.65, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Splatter_08a', id: 'decal_blood_mist_01', category: 'combat_blood', size: 0.6, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Pool_01a', id: 'decal_blood_pool_01', category: 'combat_blood', size: 1.25, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Pool_02a', id: 'decal_blood_pool_02', category: 'combat_blood', size: 1.15, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Pool_03a', id: 'decal_blood_pool_03', category: 'combat_blood', size: 1.35, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Pool_10a', id: 'decal_blood_pool_04', category: 'combat_blood', size: 1.2, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Pool_12a', id: 'decal_blood_pool_05', category: 'combat_blood', size: 1.3, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Footprint_06a', id: 'decal_blood_footprint_01', category: 'combat_blood', size: 0.32, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Footprint_08a', id: 'decal_blood_footprint_02', category: 'combat_blood', size: 0.32, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Footprint_10a', id: 'decal_blood_footprint_03', category: 'combat_blood', size: 0.35, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Footprint_Blood_01a', id: 'decal_blood_footprint_04', category: 'combat_blood', size: 0.34, tintableGrayscale: true, placement: 'floor' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Handprint_01a', id: 'decal_blood_handprint_01', category: 'combat_blood', size: 0.28, tintableGrayscale: true, placement: 'wall' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Handprint_02a', id: 'decal_blood_handprint_02', category: 'combat_blood', size: 0.28, tintableGrayscale: true, placement: 'wall' },
  { pack: 'VOL3_Blood', asset: 'MI_DECAL_Blood_Handprint_05a', id: 'decal_blood_handprint_03', category: 'combat_blood', size: 0.3, tintableGrayscale: true, placement: 'wall' },

  // Concrete_Decals (12: 8 bullet holes 0.25m + 4 cracked/damage 1.0m)
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_01', id: 'decal_concrete_bullet_01', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_02', id: 'decal_concrete_bullet_02', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_03', id: 'decal_concrete_bullet_03', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_04', id: 'decal_concrete_bullet_04', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_05', id: 'decal_concrete_bullet_05', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_06', id: 'decal_concrete_bullet_06', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_07', id: 'decal_concrete_bullet_07', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_bullet_impacts_conrete_08', id: 'decal_concrete_bullet_08', category: 'bullet_concrete', size: 0.25, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_Concrete_Cracked_01_Standard', id: 'decal_concrete_spall_01', category: 'damage_concrete', size: 1.0, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_Concrete_Cracked_05_Standard', id: 'decal_concrete_spall_02', category: 'damage_concrete', size: 1.0, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_Concrete_Damage_Mixed_01_Standard', id: 'decal_concrete_spall_03', category: 'damage_concrete', size: 1.0, placement: 'wall' },
  { pack: 'Concrete_Decals', asset: 'MI_Concrete_Damage_Mixed_04_Standard', id: 'decal_concrete_spall_04', category: 'damage_concrete', size: 1.0, placement: 'wall' },

  // Crater_Decals (15: concrete/bricks/dirt craters + scorch + embers)
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Concrete_01', id: 'decal_crater_concrete_01', category: 'crater', size: 1.8, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Concrete_03', id: 'decal_crater_concrete_02', category: 'crater', size: 2.0, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Concrete_06', id: 'decal_crater_concrete_03', category: 'crater', size: 2.2, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Bricks_01', id: 'decal_crater_brick_01', category: 'crater', size: 1.8, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Bricks_03', id: 'decal_crater_brick_02', category: 'crater', size: 2.0, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Bricks_05', id: 'decal_crater_brick_03', category: 'crater', size: 2.2, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Dirt_01', id: 'decal_crater_dirt_01', category: 'crater', size: 2.0, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Dirt_03', id: 'decal_crater_dirt_02', category: 'crater', size: 2.2, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Dirt_05', id: 'decal_crater_dirt_03', category: 'crater', size: 2.4, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Scorch_01', id: 'decal_scorch_01', category: 'scorch', size: 1.8, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Scorch_02', id: 'decal_scorch_02', category: 'scorch', size: 2.0, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Scorched_Dirt_01', id: 'decal_scorch_03', category: 'scorch', size: 2.2, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Embers_01', id: 'decal_crater_embers_01', category: 'scorch', size: 1.8, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Embers_03', id: 'decal_crater_embers_02', category: 'scorch', size: 2.0, res: 512 },
  { pack: 'Crater_Decals', asset: 'MI_Decal_Crater_Embers_Scattered_01', id: 'decal_crater_embers_03', category: 'scorch', size: 2.2, res: 512 },

  // VOL2_StreetsRoads (12: strictly physical road damage, asphalt patches, black rubber tire skids — ZERO English text/US markings)
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_01', id: 'decal_road_damage_01', category: 'road_damage', size: 1.8, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_04', id: 'decal_road_damage_02', category: 'road_damage', size: 1.8, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_07', id: 'decal_road_damage_03', category: 'road_damage', size: 2.0, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_10', id: 'decal_road_fissure_01', category: 'road_damage', size: 1.6, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_11', id: 'decal_road_damage_04', category: 'road_damage', size: 2.0, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_DamagedRoad_12', id: 'decal_road_fissure_02', category: 'road_damage', size: 1.6, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_ROAD_02a', id: 'decal_road_patch_01', category: 'road_patch', size: 1.5, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_ROAD_02c', id: 'decal_road_patch_02', category: 'road_patch', size: 1.6, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_Street_01c', id: 'decal_road_patch_03', category: 'road_patch', size: 1.8, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_ROAD_02f', id: 'decal_road_tire_skid_01', category: 'tire_skid', size: 2.6, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_ROAD_02g', id: 'decal_road_tire_skid_02', category: 'tire_skid', size: 2.8, res: 512 },
  { pack: 'VOL2_StreetsRoads', asset: 'MI_DECAL_ROAD_02i', id: 'decal_road_tire_skid_03', category: 'tire_skid', size: 2.8, res: 512 },
];

const VOL2_FORBIDDEN_RE = /(?:^|_)(?:Road_01|Road_04|STOP|SLOW|BUS|ARROW|CROSS|ONLY)(?:_|$)/i;

async function bakeUwcEntry(entry, uwcByName, size = 512) {
  const mi = uwcByName.get(entry.src);
  if (!mi) throw new Error(`Missing UWC MaterialInstance: ${entry.src}`);
  const normParam = mi.textures['Normal Map'] || Object.values(mi.textures).find((t) => /_N$/i.test(t.name));
  const maskParam = mi.textures['Mask'] || Object.values(mi.textures).find((t) => /_M$/i.test(t.name));
  const bcParam = mi.textures['Base Color'] || Object.values(mi.textures).find((t) => /_BC$/i.test(t.name));
  if (!normParam || !maskParam) throw new Error(`Incomplete UWC textures for ${entry.src}`);

  const [maskRaw, normRaw, bcRaw] = await Promise.all([
    sharp(path.join(STAGING_ROOT, maskParam.fileRel)).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer(),
    sharp(path.join(STAGING_ROOT, normParam.fileRel)).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer(),
    bcParam
      ? sharp(path.join(STAGING_ROOT, bcParam.fileRel)).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer()
      : Promise.resolve(null),
  ]);

  const nPix = size * size;
  const color = new Uint8Array(nPix * 4);
  const conv = measureNormalConvention(normRaw, null, size, size);
  const needsFlip = conv.convention === 'DX_-Y';
  const glNorm = flipAndRepairNormalRgba(normRaw, size, size, { flipY: needsFlip });

  const roughScalar = typeof mi.scalars?.Roughness === 'number' ? clamp01(mi.scalars.Roughness) : null;
  const isGlass = entry.surfaceType === 'glass';
  const isMetal = entry.surfaceType === 'metal';

  for (let i = 0; i < nPix; i++) {
    const i4 = i * 4;
    const maskVal = maskRaw[i4]; // grayscale mask
    const nz = glNorm[i4 + 2] / 255;
    if (bcRaw) {
      color[i4] = bcRaw[i4];
      color[i4 + 1] = bcRaw[i4 + 1];
      color[i4 + 2] = bcRaw[i4 + 2];
    } else if (isGlass) {
      const frost = 190 + Math.round((maskVal / 255) * 58);
      color[i4] = Math.min(255, frost - 12);
      color[i4 + 1] = Math.min(255, frost);
      color[i4 + 2] = Math.min(255, frost + 6);
    } else if (isMetal) {
      const cavity = Math.max(0, 1 - (maskVal / 255) * 0.72 - (1 - nz) * 0.35);
      const v = clampByte(35 + cavity * 135);
      color[i4] = v;
      color[i4 + 1] = v + 2;
      color[i4 + 2] = v + 6;
    } else {
      // Concrete/asphalt/wood/brick physical impact cavity shading
      const cavity = Math.max(0, 1 - (maskVal / 255) * 0.78 - (1 - nz) * 0.3);
      const base = entry.surfaceType === 'wood' ? [112, 86, 62] : entry.surfaceType === 'brick' ? [122, 74, 58] : [78, 76, 72];
      const f = 0.25 + cavity * 0.75;
      color[i4] = clampByte(base[0] * f);
      color[i4 + 1] = clampByte(base[1] * f);
      color[i4 + 2] = clampByte(base[2] * f);
    }
    color[i4 + 3] = maskVal;
  }
  dilateAlphaEdges(color, size, size, 12);

  const defaultRough = isGlass ? (roughScalar ?? 0.2) : isMetal ? 0.42 : 0.84;
  const defaultMetal = isGlass ? 16 : isMetal ? 185 : 0;
  const normRm = packNormalRm(
    glNorm,
    (i) => clamp01(defaultRough - (maskRaw[i * 4] / 255) * (isGlass ? 0.08 : 0.14)) * 255,
    (i) => (isMetal && maskRaw[i * 4] > 48 ? defaultMetal : 0),
    size,
    size,
  );

  await writeStraightPair(path.join(BUILT_PBR_DECALS, entry.id), color, normRm, size, size);
  return {
    meta: {
      id: entry.id,
      slot: entry.id,
      category: entry.category,
      sourcePack: 'UWC_Bullet_Holes',
      sourcePath: mi.objectPath,
      surfaceType: entry.surfaceType,
      placement: entry.surfaceType === 'asphalt' ? 'floor' : 'auto',
      width: size,
      height: size,
      aspectRatio: 1,
      physicalSizeMeters: entry.size,
      scanSizeMeters: entry.size,
      uvScale: Number((1 / entry.size).toFixed(3)),
      tintableGrayscale: false,
      normalConvention: 'OpenGL (+Y)',
    },
    dxFlipped: needsFlip,
    beforeConv: conv.convention,
  };
}

async function bakeRealisticBloodEntry(entry, size = 512) {
  const srcAbs = path.join(STAGING_ROOT, 'realistic_blood_textures', entry.file);
  const srcRaw = await sharp(srcAbs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = srcRaw.info.width;
  const h = srcRaw.info.height;
  const d = srcRaw.data;

  // Tight crop around opaque splatter bounding box (16:9 streak -> crisp square card)
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 14) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const boxW = Math.max(64, maxX - minX + 1);
  const boxH = Math.max(64, maxY - minY + 1);
  const side = Math.min(Math.max(w, h), Math.round(Math.max(boxW, boxH) * 1.12));
  const cx = Math.round((minX + maxX) * 0.5);
  const cy = Math.round((minY + maxY) * 0.5);
  const cropW = Math.min(w, side);
  const cropH = Math.min(h, side);
  const left = Math.max(0, Math.min(w - cropW, cx - Math.round(cropW * 0.5)));
  const top = Math.max(0, Math.min(h - cropH, cy - Math.round(cropH * 0.5)));

  const color = await sharp(srcAbs)
    .ensureAlpha()
    .extract({ left, top, width: cropW, height: cropH })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer();

  const rgba = new Uint8Array(color.buffer, color.byteOffset, color.byteLength);
  toShadedGrayscaleBlood(rgba, size, size);
  dilateAlphaEdges(rgba, size, size, 12);

  const alphaOnly = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) alphaOnly[i] = rgba[i * 4 + 3];
  const glNorm = generateNormalFromMask(alphaOnly, size, size, 1.8);
  const normRm = packNormalRm(glNorm, () => 34, () => 0, size, size);

  await writeStraightPair(path.join(BUILT_PBR_DECALS, entry.id), rgba, normRm, size, size);
  return {
    meta: {
      id: entry.id,
      slot: entry.id,
      category: 'combat_blood',
      sourcePack: 'RealisticBloodDecals',
      sourcePath: `RealisticBloodDecals/${entry.file}`,
      placement: 'floor',
      width: size,
      height: size,
      aspectRatio: 1,
      physicalSizeMeters: entry.size,
      scanSizeMeters: entry.size,
      uvScale: Number((1 / entry.size).toFixed(3)),
      tintableGrayscale: true,
      normalConvention: 'OpenGL (+Y)',
    },
    dxFlipped: false,
    beforeConv: 'SYNTH_GL_+Y',
  };
}

async function bakeOldUnrealEntry(entry, oldByKey) {
  if (entry.pack === 'VOL2_StreetsRoads' && VOL2_FORBIDDEN_RE.test(entry.asset)) {
    throw new Error(`Forbidden English road text asset selected: ${entry.asset}`);
  }
  const srcItem = oldByKey.get(`${entry.pack}__${entry.asset}`);
  if (!srcItem) throw new Error(`Missing old Unreal decal: ${entry.pack}__${entry.asset}`);
  const colPath = path.join(OLD_DECALS_DIR, path.basename(srcItem.color));
  const nrmPath = path.join(OLD_DECALS_DIR, path.basename(srcItem.normal));
  const ormPath = path.join(OLD_DECALS_DIR, path.basename(srcItem.orm));
  const size = entry.res || 512;

  const [colBuf, nrmBuf, ormBuf] = await Promise.all([
    sharp(colPath).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer(),
    sharp(nrmPath).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer(),
    sharp(ormPath).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer(),
  ]);

  const rgba = new Uint8Array(colBuf.buffer, colBuf.byteOffset, colBuf.byteLength);
  if (entry.tintableGrayscale) {
    toShadedGrayscaleBlood(rgba, size, size);
  }
  dilateAlphaEdges(rgba, size, size, 10);

  const conv = measureNormalConvention(nrmBuf, rgba, size, size);
  const needsFlip = conv.convention === 'DX_-Y';
  const glNorm = flipAndRepairNormalRgba(nrmBuf, size, size, { flipY: needsFlip });

  const normRm = packNormalRm(
    glNorm,
    (i) => (entry.tintableGrayscale ? Math.min(96, ormBuf[i * 4 + 1] || 38) : (ormBuf[i * 4 + 1] || 200)),
    (i) => ormBuf[i * 4 + 2] || 0,
    size,
    size,
  );

  await writeStraightPair(path.join(BUILT_PBR_DECALS, entry.id), rgba, normRm, size, size);
  return {
    meta: {
      id: entry.id,
      slot: entry.id,
      category: entry.category,
      sourcePack: entry.pack,
      sourcePath: `${entry.pack}/${entry.asset}`,
      placement: entry.placement || 'floor',
      width: size,
      height: size,
      aspectRatio: 1,
      physicalSizeMeters: entry.size,
      scanSizeMeters: entry.size,
      uvScale: Number((1 / entry.size).toFixed(3)),
      tintableGrayscale: Boolean(entry.tintableGrayscale),
      normalConvention: 'OpenGL (+Y)',
    },
    dxFlipped: needsFlip,
    beforeConv: conv.convention,
  };
}

async function bakeDecals(manifest) {
  await mkdir(BUILT_PBR_DECALS, { recursive: true });
  const decalsManifest = JSON.parse(await readFile(path.join(MANIFESTS_DIR, 'decals.manifest.json'), 'utf8'));
  const existingCn = decalsManifest.pbrDecals || [];
  let prevTable = { items: [] };
  if (existsSync(path.join(BUILT_PBR_DECALS, 'pbr_decals_table.json'))) {
    prevTable = JSON.parse(await readFile(path.join(BUILT_PBR_DECALS, 'pbr_decals_table.json'), 'utf8'));
  }
  const prevById = new Map((prevTable.items || []).map((it) => [it.id, it]));

  const items = [];
  const auditRows = [];
  const keepIds = new Set();

  // 1. Preserve existing CN Quixel decals (all verified PoT & Straight RGBA)
  for (const entry of existingCn) {
    const colAbs = path.join(BUILT_PBR_DECALS, entry.id, 'color.png');
    const nrmAbs = path.join(BUILT_PBR_DECALS, entry.id, 'normal_rm.png');
    if (!existsSync(colAbs) || !existsSync(nrmAbs)) {
      throw new Error(`Missing existing CN Quixel decal files for ${entry.id}; run bake-pbr-slots.mjs first.`);
    }
    const prev = prevById.get(entry.id) || {};
    const meta = await sharp(colAbs).metadata();
    const w = prev.width || meta.width || 1024;
    const h = prev.height || meta.height || 1024;
    keepIds.add(entry.id);
    items.push({
      id: entry.id,
      slot: entry.id,
      category: entry.category,
      sourcePack: 'Quixel_CN',
      sourcePath: entry.sourcePath,
      placement: entry.category === 'leak' || /(?:^|_)wall(?:_|$)/i.test(entry.id) ? 'wall' : 'floor',
      width: w,
      height: h,
      aspectRatio: prev.aspectRatio || Number((w / h).toFixed(4)),
      physicalSizeMeters: entry.scanSizeMeters,
      scanSizeMeters: entry.scanSizeMeters,
      uvScale: entry.uvScale ?? 1.0,
      tintableGrayscale: Boolean(entry.tintableGrayscale),
      normalConvention: 'OpenGL (+Y)',
    });
  }

  // 2. UWC_Bullet_Holes (36 curated)
  const uwcByName = new Map(manifest.uwcDecals.map((u) => [u.name, u]));
  for (const spec of UWC_CURATED) {
    if (keepIds.has(spec.id)) throw new Error(`Duplicate decal ID: ${spec.id}`);
    keepIds.add(spec.id);
    const res = await bakeUwcEntry(spec, uwcByName, 512);
    items.push(res.meta);
    auditRows.push({ id: spec.id, pack: 'UWC_Bullet_Holes', before: res.beforeConv, dxFlipped: res.dxFlipped });
  }

  // 3. RealisticBloodDecals (6 jets)
  for (const spec of RB_BLOOD_CURATED) {
    if (keepIds.has(spec.id)) throw new Error(`Duplicate decal ID: ${spec.id}`);
    keepIds.add(spec.id);
    const res = await bakeRealisticBloodEntry(spec, 512);
    items.push(res.meta);
    auditRows.push({ id: spec.id, pack: 'RealisticBloodDecals', before: res.beforeConv, dxFlipped: res.dxFlipped });
  }

  // 4. Old Unreal Decals (VOL3_Blood + Concrete_Decals + Crater_Decals + VOL2_StreetsRoads)
  const oldCatalog = JSON.parse(await readFile(path.join(UNREAL_EXPORT_ROOT, 'catalog.json'), 'utf8'));
  const oldByKey = new Map((oldCatalog.decals || []).map((d) => [d.id, d]));
  for (const spec of OLD_UNREAL_CURATED) {
    if (keepIds.has(spec.id)) throw new Error(`Duplicate decal ID: ${spec.id}`);
    keepIds.add(spec.id);
    const res = await bakeOldUnrealEntry(spec, oldByKey);
    items.push(res.meta);
    auditRows.push({ id: spec.id, pack: spec.pack, before: res.beforeConv, dxFlipped: res.dxFlipped });
  }

  // Clean stale dirs not in keepIds
  for (const d of await readdir(BUILT_PBR_DECALS, { withFileTypes: true })) {
    if (d.isDirectory() && !keepIds.has(d.name)) {
      await rm(path.join(BUILT_PBR_DECALS, d.name), { recursive: true, force: true });
    }
  }

  // Full post-bake verification across ALL unified decals:
  // - color.png + normal_rm.png exist, non-empty, identical PoT dims
  // - 0 pixels with A=0 && RGB=(0,0,0)
  // - 0 remaining DX_-Y normal maps!
  let checkedZeroAlpha = 0;
  let zeroAlphaZeroRgb = 0;
  let remainingDxCount = 0;
  const remainingDxIds = [];

  for (const it of items) {
    const colAbs = path.join(BUILT_PBR_DECALS, it.id, 'color.png');
    const nrmAbs = path.join(BUILT_PBR_DECALS, it.id, 'normal_rm.png');
    const [cs, ns] = await Promise.all([stat(colAbs), stat(nrmAbs)]);
    if (cs.size <= 0 || ns.size <= 0) throw new Error(`Empty decal PNG for ${it.id}`);
    const [cRaw, nRaw] = await Promise.all([
      sharp(colAbs).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(nrmAbs).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    const w = nRaw.info.width;
    const h = nRaw.info.height;
    if (cRaw.info.width !== w || cRaw.info.height !== h) {
      throw new Error(`Dimension mismatch for ${it.id}`);
    }
    if (!isPow2(w) || !isPow2(h)) {
      throw new Error(`Non-PoT decal ${it.id}: ${w}x${h}`);
    }
    const d = nRaw.data;
    for (let p = 0; p < w * h; p += 13) {
      const i = p * 4;
      if (d[i + 3] === 0) {
        checkedZeroAlpha++;
        if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) zeroAlphaZeroRgb++;
      }
    }
    const postConv = measureNormalConvention(d, cRaw.data, w, h, { isNormalRm: true });
    if (postConv.convention === 'DX_-Y') {
      remainingDxCount++;
      remainingDxIds.push({ id: it.id, ratio: postConv.ratio });
    }
    if (it.sourcePack === 'VOL2_StreetsRoads' && VOL2_FORBIDDEN_RE.test(it.sourcePath || '')) {
      throw new Error(`English road text leaked into built decals: ${it.id}`);
    }
  }

  if (zeroAlphaZeroRgb > 0) {
    throw new Error(`Found ${zeroAlphaZeroRgb} pixels with A=0 & RGB=(0,0,0) in normal_rm.png!`);
  }
  if (remainingDxCount > 0) {
    throw new Error(`Found ${remainingDxCount} decals still in DX_-Y after bake: ${JSON.stringify(remainingDxIds)}`);
  }

  await writeFile(
    path.join(BUILT_PBR_DECALS, 'pbr_decals_table.json'),
    JSON.stringify({
      version: '5.0.0',
      normalConvention: 'OpenGL (+Y)',
      count: items.length,
      items,
    }, null, 2),
  );

  const byPack = {};
  for (const it of items) byPack[it.sourcePack] = (byPack[it.sourcePack] || 0) + 1;

  return {
    totalDecals: items.length,
    byPack,
    checkedZeroAlpha,
    zeroAlphaZeroRgb,
    remainingDxCount,
    auditRows,
  };
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(STAGING_ROOT, 'milestone2_export_manifest.json'), 'utf8'));
  const lutReport = await bakeLuts(manifest);
  const glassReport = await bakeGlass(manifest);
  const decalReport = await bakeDecals(manifest);

  const report = {
    generatedAt: new Date().toISOString(),
    luts: lutReport,
    glass: glassReport,
    decals: {
      totalDecals: decalReport.totalDecals,
      byPack: decalReport.byPack,
      checkedZeroAlpha: decalReport.checkedZeroAlpha,
      zeroAlphaZeroRgb: decalReport.zeroAlphaZeroRgb,
      remainingDxCount: decalReport.remainingDxCount,
      flippedCount: decalReport.auditRows.filter((r) => r.dxFlipped).length,
      auditRows: decalReport.auditRows,
    },
  };
  await writeFile(path.join(BUILT_DIR, 'milestone2_bake_report.json'), JSON.stringify(report, null, 2));
  console.log('=== Milestone 2 Bake & Verification Report ===');
  console.log('LUTs:', lutReport);
  console.log('Glass:', glassReport);
  console.log('Decals:', report.decals.byPack, 'Total:', report.decals.totalDecals, 'DX->GL Flipped:', report.decals.flippedCount, 'Remaining DX:', report.decals.remainingDxCount, 'ZeroAlphaZeroRGB:', report.decals.zeroAlphaZeroRgb);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

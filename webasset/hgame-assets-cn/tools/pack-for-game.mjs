import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPEC_PATH = path.join(ROOT, 'manifests', 'asset_spec.json');
const CATALOG_PATH = path.join(ROOT, 'built', 'catalog.json');
const BUILT_DIR = path.join(ROOT, 'built');
const DEFAULT_OUT = path.join(ROOT, 'built', 'dist', 'sample_game');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { target: 'mobile', outDir: DEFAULT_OUT, gameConfig: null, webpFallback: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) out.target = args[++i];
    else if (args[i] === '--out' && args[i + 1]) out.outDir = path.resolve(args[++i]);
    else if (args[i] === '--game' && args[i + 1]) out.gameConfig = path.resolve(args[++i]);
    else if (args[i] === '--no-webp') out.webpFallback = false;
  }
  return out;
}

function findToktx() {
  if (process.env.TOKTX_BIN && existsSync(process.env.TOKTX_BIN)) return process.env.TOKTX_BIN;
  const probe = spawnSync('where.exe', ['toktx'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout?.trim()) {
    return probe.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

function encodeKtx2(toktxBin, pngPath, ktxPath, isNormalRm, spec) {
  const cfg = isNormalRm ? spec.texturePipeline.ktx2.normal_rm : spec.texturePipeline.ktx2.color;
  const args = isNormalRm
    ? [
        '--t2',
        '--encode', 'uastc',
        '--uastc_quality', String(cfg.uastcQuality ?? 2),
        '--zcmp', String(cfg.zcmp ?? 18),
        '--genmipmap',
        '--assign_oetf', 'linear',
        ktxPath,
        pngPath,
      ]
    : [
        '--t2',
        '--encode', 'etc1s',
        '--qlevel', String(cfg.qlevel ?? 160),
        '--clevel', String(cfg.clevel ?? 2),
        '--genmipmap',
        '--assign_oetf', 'srgb',
        ktxPath,
        pngPath,
      ];
  const res = spawnSync(toktxBin, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`toktx failed on ${pngPath}`);
  }
}

async function packAtlasGrid(slots, keyFile, tileSize, gridCols, outPng) {
  const rows = Math.max(1, Math.ceil(slots.length / gridCols));
  const w = gridCols * tileSize;
  const h = rows * tileSize;
  const buf = Buffer.alloc(w * h * 4);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const src = path.join(BUILT_DIR, 'materials', slot, keyFile);
    const tile = await sharp(src).resize(tileSize, tileSize, { kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer();
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const ox = col * tileSize;
    const oy = row * tileSize;
    for (let y = 0; y < tileSize; y++) {
      const srcRow = y * tileSize * 4;
      const dstRow = ((oy + y) * w + ox) * 4;
      tile.copy(buf, dstRow, srcRow, srcRow + tileSize * 4);
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outPng);
  return { width: w, height: h, rows };
}

async function main() {
  const opts = parseArgs();
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const target = opts.target === 'pc' ? 'pc' : 'mobile';
  const tileSize = target === 'pc' ? 512 : 256;
  const gridCols = 8;

  let gameCfg = null;
  if (opts.gameConfig && existsSync(opts.gameConfig)) {
    gameCfg = JSON.parse(await readFile(opts.gameConfig, 'utf8'));
  } else {
    // Default showcase subset across Q1_CBD + Q2_OLDTOWN + Q4_RURAL (~25 materials, ~40 models)
    const sampleModels = catalog.models.filter((m) =>
      m.group === 'l1_arch' || m.group === 'l1_road' || m.group === 'l1_backdrop',
    ).slice(0, 45);
    gameCfg = {
      name: 'sample_cn_showcase',
      modelIds: sampleModels.map((m) => m.id),
      extraMaterials: ['nature_lawn_grass', 'nature_soil_dirt', 'water_normal'],
      hdri: target === 'pc' ? 'cn_day_clear' : 'cn_overcast_haze',
    };
  }

  const modelById = new Map(catalog.models.map((m) => [m.id, m]));
  const matBySlot = new Map(catalog.materials.map((m) => [m.slot, m]));

  const usedModels = [];
  const usedSlots = new Set(['__missing__']);
  for (const mid of gameCfg.modelIds || []) {
    const m = modelById.get(mid);
    if (!m) continue;
    usedModels.push(m);
    if (m.materialMode === 'array_override') {
      for (const s of Object.values(m.materialSlots || {})) {
        if (matBySlot.has(s)) usedSlots.add(s);
      }
    }
  }
  for (const s of gameCfg.extraMaterials || []) {
    if (matBySlot.has(s)) usedSlots.add(s);
  }

  const orderedSlots = [...usedSlots];
  const packedMaterials = orderedSlots.map((s, layer) => ({
    ...matBySlot.get(s),
    layer,
  }));

  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(path.join(opts.outDir, 'pbr'), { recursive: true });
  await mkdir(path.join(opts.outDir, 'models'), { recursive: true });

  const colorPng = path.join(opts.outDir, 'pbr', 'albedo_array.png');
  const nrmPng = path.join(opts.outDir, 'pbr', 'normal_rm_array.png');
  const gridMeta = await packAtlasGrid(orderedSlots, 'color.png', tileSize, gridCols, colorPng);
  await packAtlasGrid(orderedSlots, 'normal_rm.png', tileSize, gridCols, nrmPng);

  const toktx = findToktx();
  let codecUsed = 'webp';
  if (toktx) {
    encodeKtx2(toktx, colorPng, path.join(opts.outDir, 'pbr', 'albedo_array.ktx2'), false, spec);
    encodeKtx2(toktx, nrmPng, path.join(opts.outDir, 'pbr', 'normal_rm_array.ktx2'), true, spec);
    codecUsed = 'ktx2+webp';
  }
  if (opts.webpFallback || !toktx) {
    await sharp(colorPng).webp({ quality: spec.texturePipeline.webpFallback.colorQuality ?? 80 }).toFile(path.join(opts.outDir, 'pbr', 'albedo_array.webp'));
    await sharp(nrmPng).webp({ quality: spec.texturePipeline.webpFallback.normalRmQuality ?? 92 }).toFile(path.join(opts.outDir, 'pbr', 'normal_rm_array.webp'));
  }
  await rm(colorPng, { force: true });
  await rm(nrmPng, { force: true });

  await writeFile(
    path.join(opts.outDir, 'pbr', 'material_table.json'),
    JSON.stringify({
      version: '4.1.0',
      pipeline: '2-map-pbr',
      tileSize,
      gridCols,
      rows: gridMeta.rows,
      layerCount: packedMaterials.length,
      codec: codecUsed,
      materials: packedMaterials,
    }, null, 2),
  );

  // Copy pruned single-GLB multi-LOD models & compute budget report
  const assetSizes = [];
  let totalBytes = 0;
  for (const m of usedModels) {
    const relPath = m.path || m.lods?.[0]?.path;
    if (!relPath) continue;
    const srcGlb = path.join(BUILT_DIR, relPath);
    const dstGlb = path.join(opts.outDir, relPath);
    await mkdir(path.dirname(dstGlb), { recursive: true });
    await copyFile(srcGlb, dstGlb);
    const sz = (await stat(dstGlb)).size;
    totalBytes += sz;
    assetSizes.push({ id: relPath, kb: +(sz / 1024).toFixed(2) });
  }

  for (const f of ['albedo_array.webp', 'normal_rm_array.webp', 'albedo_array.ktx2', 'normal_rm_array.ktx2']) {
    const fp = path.join(opts.outDir, 'pbr', f);
    if (existsSync(fp)) {
      const sz = (await stat(fp)).size;
      totalBytes += sz;
      assetSizes.push({ id: `pbr/${f}`, kb: +(sz / 1024).toFixed(2) });
    }
  }

  assetSizes.sort((a, b) => b.kb - a.kb);
  const totalMB = +(totalBytes / (1024 * 1024)).toFixed(3);
  // 2 textures * 4 bytes/px * 4/3 mip chain
  const estVramMB = +((tileSize * tileSize * 8 * packedMaterials.length * (4 / 3)) / (1024 * 1024)).toFixed(2);
  const budget = spec.sceneBudgets[target];

  const summary = {
    target,
    codec: codecUsed,
    toktxAvailable: Boolean(toktx),
    prunedModels: usedModels.length,
    prunedMaterialLayers: packedMaterials.length,
    totalDiskMB: totalMB,
    estimatedPbrVramMB: estVramMB,
    budget,
    top10Largest: assetSizes.slice(0, 10),
  };
  await writeFile(path.join(opts.outDir, 'pack_report.json'), JSON.stringify(summary, null, 2));

  console.log(`[game:pack] target=${target} codec=${codecUsed} models=${usedModels.length} mats=${packedMaterials.length} disk=${totalMB}MB estVram=${estVramMB}MB`);
  if (totalMB > budget.maxInitialPackMB || estVramMB > budget.maxVramMB) {
    console.error(`[game:pack] BUDGET EXCEEDED! Top 10:`, summary.top10Largest);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[game:pack] FAILED:', err);
  process.exit(1);
});

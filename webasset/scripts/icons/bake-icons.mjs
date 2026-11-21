import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { createWebAssetServer } from '../../server.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'ui');

const BLOCK_ICON_DEFS = [
  { id: 'grass_block', name: '草方块', top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  { id: 'snow_block', name: '雪块', top: 'snow', side: 'snow_side', bottom: 'dirt' },
  { id: 'oak_log', name: '橡木原木', top: 'log_top', side: 'bark_oak', bottom: 'log_top' },
  { id: 'birch_log', name: '白桦原木', top: 'log_top', side: 'bark_birch', bottom: 'log_top' },
  { id: 'pine_log', name: '松木原木', top: 'log_top', side: 'bark_pine', bottom: 'log_top' },
  { id: 'dirt', name: '泥土', slot: 'dirt' },
  { id: 'mud', name: '湿泥', slot: 'mud' },
  { id: 'sand', name: '沙子', slot: 'sand' },
  { id: 'red_sand', name: '红沙', slot: 'red_sand' },
  { id: 'gravel', name: '砾石', slot: 'gravel' },
  { id: 'stone', name: '石头', slot: 'stone' },
  { id: 'deepslate', name: '深板岩', slot: 'deepslate' },
  { id: 'bedrock', name: '基岩', slot: 'bedrock' },
  { id: 'clay', name: '黏土', slot: 'clay' },
  { id: 'cobblestone', name: '圆石', slot: 'cobblestone' },
  { id: 'mossy_cobble', name: '苔石', slot: 'mossy_cobble' },
  { id: 'stone_brick', name: '石砖', slot: 'stone_brick' },
  { id: 'brick_red', name: '红砖', slot: 'brick_red' },
  { id: 'planks_oak', name: '橡木板', slot: 'planks_oak' },
  { id: 'planks_spruce', name: '云杉木板', slot: 'planks_spruce' },
  { id: 'planks_birch', name: '白桦木板', slot: 'planks_birch' },
  { id: 'leaves_oak', name: '橡树叶', slot: 'leaves_oak' },
  { id: 'leaves_pine', name: '松树针叶', slot: 'leaves_pine' },
  { id: 'hay_bale', name: '干草捆', slot: 'hay_bale' },
  { id: 'glass_clear', name: '透明玻璃', slot: 'glass_clear' },
  { id: 'lava_crust', name: '熔岩岩壳', slot: 'lava_crust' },
  { id: 'glow_crystal', name: '荧光晶石', slot: 'glow_crystal' },
  { id: 'bookshelf_side', name: '书架方块', slot: 'bookshelf_side' },
  { id: 'ore_coal', name: '煤矿石', slot: 'ore_coal' },
  { id: 'ore_iron', name: '铁矿石', slot: 'ore_iron' },
  { id: 'ore_copper', name: '铜矿石', slot: 'ore_copper' },
  { id: 'ore_gold', name: '金矿石', slot: 'ore_gold' },
  { id: 'metal_iron', name: '铁块', slot: 'metal_iron' },
  { id: 'metal_copper', name: '铜块', slot: 'metal_copper' },
  { id: 'metal_gold', name: '金块', slot: 'metal_gold' },
  { id: 'wool_red', name: '红色羊毛', slot: 'fabric_wool', tint: [0.85, 0.16, 0.16] },
  { id: 'wool_blue', name: '蓝色羊毛', slot: 'fabric_wool', tint: [0.18, 0.36, 0.84] },
];

async function resolvePlaywright() {
  try {
    return await import('playwright');
  } catch { /* fallback global @playwright/cli */ }
  const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const candidates = [
    path.join(npmRoot, '@playwright', 'cli', 'node_modules', 'playwright', 'index.mjs'),
    path.join(npmRoot, 'playwright', 'index.mjs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return import(pathToFileURL(c).href);
  }
  throw new Error('Playwright not found locally or in global @playwright/cli');
}

function findBrowserExecutable() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find(p => existsSync(p));
}

async function main() {
  const { chromium } = await resolvePlaywright();
  const server = createWebAssetServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const exe = findBrowserExecutable();
  const browser = await chromium.launch({
    ...(exe ? { executablePath: exe } : {}),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    await page.goto(`${baseUrl}/icon-baker.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__ICON_BAKER_READY__ === true, null, { timeout: 20000 });
    const renderedIcons = await page.evaluate(defs => window.renderAllIcons(defs), BLOCK_ICON_DEFS);

    const cellSize = 128;
    const cols = 8;
    const foliageTable = JSON.parse(
      await readFile(path.join(ROOT, 'public', 'assets', 'pbr', 'foliage', 'foliage_table.json'), 'utf8')
    );
    const foliageAtlasPath = path.join(ROOT, 'public', 'assets', 'pbr', 'foliage', 'foliage_albedo.webp');
    const foliageTilePx = foliageTable.tileSize || 256;

    const totalCount = renderedIcons.length + foliageTable.slots.length;
    const rows = Math.ceil(totalCount / cols);
    const atlasW = cols * cellSize;
    const atlasH = rows * cellSize;
    const atlasBuf = new Uint8Array(atlasW * atlasH * 4);
    const entries = [];

    const blitCell = (rgba, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      for (let y = 0; y < cellSize; y++) {
        const srcRow = y * cellSize * 4;
        const dstIdx = ((row * cellSize + y) * atlasW + col * cellSize) * 4;
        atlasBuf.set(rgba.subarray(srcRow, srcRow + cellSize * 4), dstIdx);
      }
      return { col, row, uvRect: [col / cols, 1 - (row + 1) / rows, 1 / cols, 1 / rows] };
    };

    // 1. Pack rendered 3D isometric icons (blocks + GLBs)
    for (const item of renderedIcons) {
      const b64 = item.dataUrl.replace(/^data:image\/png;base64,/, '');
      const { data } = await sharp(Buffer.from(b64, 'base64'))
        .resize(cellSize, cellSize, { kernel: sharp.kernel.lanczos3 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const idx = entries.length;
      const pos = blitCell(data, idx);
      entries.push({ id: item.id, name: item.name, kind: item.kind, index: idx, ...pos });
    }

    // 2. Pack 2D foliage/crop sprites with 8% margin centered into 128x128
    const innerPad = Math.round(cellSize * 0.08);
    const innerSize = cellSize - innerPad * 2;
    for (const f of foliageTable.slots) {
      const fx = f.gridCol * foliageTilePx;
      const fy = f.gridRow * foliageTilePx;
      const { data: rawF } = await sharp(foliageAtlasPath)
        .extract({ left: fx, top: fy, width: foliageTilePx, height: foliageTilePx })
        .resize(innerSize, innerSize, { kernel: sharp.kernel.lanczos3 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const padded = new Uint8Array(cellSize * cellSize * 4);
      for (let y = 0; y < innerSize; y++) {
        for (let x = 0; x < innerSize; x++) {
          const si = (y * innerSize + x) * 4;
          const di = ((y + innerPad) * cellSize + (x + innerPad)) * 4;
          padded[di] = rawF[si];
          padded[di + 1] = rawF[si + 1];
          padded[di + 2] = rawF[si + 2];
          padded[di + 3] = rawF[si + 3];
        }
      }
      const idx = entries.length;
      const pos = blitCell(padded, idx);
      entries.push({ id: f.slot, name: f.name, kind: 'foliage', index: idx, ...pos });
    }

    await mkdir(OUT_DIR, { recursive: true });
    const outWebp = path.join(OUT_DIR, 'icons_atlas.webp');
    const outJson = path.join(OUT_DIR, 'icons_atlas.json');
    await sharp(atlasBuf, { raw: { width: atlasW, height: atlasH, channels: 4 } })
      .webp({ quality: 88, alphaQuality: 94 })
      .toFile(outWebp);

    const bytes = (await stat(outWebp)).size;
    await writeFile(outJson, JSON.stringify({
      version: '1.0.0',
      atlasUrl: '/assets/ui/icons_atlas.webp',
      cellSize,
      gridCols: cols,
      gridRows: rows,
      iconCount: entries.length,
      bytes,
      icons: entries,
    }, null, 2) + '\n');

    console.log(`[bake-icons] Packed ${entries.length} icons into ${atlasW}x${atlasH} WebP (${(bytes / 1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error('[bake-icons] FAILED:', err);
  process.exit(1);
});

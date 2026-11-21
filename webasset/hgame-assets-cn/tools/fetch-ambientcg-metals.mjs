import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import sharp from 'sharp';

const CN_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(CN_ROOT, '..', '..');
const DEFAULT_OUT_DIR = path.join(CN_ROOT, 'raw', 'ambientcg');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HGameAssetsCN/4.1';
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 3;

const TARGET_METALS = [
  { id: 'Metal009', role: '银色拉丝不锈钢（电梯门、扶手）' },
  { id: 'Metal049A', role: '极净光滑银色金属（铝合金窗框、镀铬件）' },
  { id: 'Metal032', role: '哑光灰光滑金属（现代门框、配电箱、家电外壳）' },
  { id: 'Metal034', role: '细磨砂颗粒金属（路灯杆、护栏）' },
  { id: 'Metal038', role: '微划痕钢板（铁皮门、管道、楼梯扶手）' },
  { id: 'Metal046B', role: '深色黑铁/铸铁（老小区防盗窗、铁艺栅栏）' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveOutDir(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      return path.resolve(argv[i + 1]);
    }
  }
  if (process.env.AMBIENTCG_OUT_DIR?.trim()) {
    return path.resolve(process.env.AMBIENTCG_OUT_DIR.trim());
  }
  const localCfgPath = path.join(REPO_ROOT, '.hgame.local.json');
  if (existsSync(localCfgPath)) {
    try {
      const cfg = JSON.parse(await readFile(localCfgPath, 'utf8'));
      if (typeof cfg?.ambientcgDir === 'string' && cfg.ambientcgDir.trim()) {
        return path.resolve(cfg.ambientcgDir.trim());
      }
      if (typeof cfg?.fabLibraryDir === 'string' && cfg.fabLibraryDir.trim()) {
        return path.join(path.dirname(path.resolve(cfg.fabLibraryDir.trim())), 'ambientcg');
      }
    } catch {
      // Ignore malformed local config and use project default.
    }
  }
  return DEFAULT_OUT_DIR;
}

async function fetchWithRetry(url, { asBuffer = false } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!asBuffer) {
        return await res.json();
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error(`Response is not a valid ZIP archive (${buf.length} bytes)`);
      }
      return buf;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    }
  }
  throw lastErr;
}

function findDownloadLinksRecursive(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) findDownloadLinksRecursive(item, out);
    return out;
  }
  if (typeof node.downloadLink === 'string' && typeof node.attribute === 'string') {
    out.push({ attribute: node.attribute, url: node.downloadLink });
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') findDownloadLinksRecursive(val, out);
  }
  return out;
}

async function downloadMetalZip(assetId) {
  const directUrl = `https://ambientcg.com/get?file=${encodeURIComponent(assetId)}_1K-JPG.zip`;
  try {
    const buf = await fetchWithRetry(directUrl, { asBuffer: true });
    return { buf, sourceUrl: directUrl, via: 'direct' };
  } catch (directErr) {
    const apiUrl = `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(assetId)}&include=downloadData`;
    const json = await fetchWithRetry(apiUrl, { asBuffer: false });
    const info = json?.foundAssets?.[0];
    if (!info) {
      throw new Error(`Direct failed (${directErr.message}); API foundAssets empty for ${assetId}`);
    }
    const links = findDownloadLinksRecursive(info.downloadFolders);
    const chosen = links.find((l) => l.attribute.toUpperCase() === '1K-JPG');
    if (!chosen?.url) {
      throw new Error(`Direct failed (${directErr.message}); API missing 1K-JPG link for ${assetId}`);
    }
    const buf = await fetchWithRetry(chosen.url, { asBuffer: true });
    return { buf, sourceUrl: chosen.url, via: 'api-fallback' };
  }
}

function classifyTextureRole(filename) {
  if (/_Color\.jpe?g$/i.test(filename)) return 'color';
  if (/_NormalGL\.jpe?g$/i.test(filename)) return 'normalGL';
  if (/_Roughness\.jpe?g$/i.test(filename)) return 'roughness';
  if (/_Metalness\.jpe?g$/i.test(filename)) return 'metalness';
  if (/_AmbientOcclusion\.jpe?g$/i.test(filename)) return 'ao';
  return null;
}

async function processOneMetal(outRoot, item) {
  const assetDir = path.join(outRoot, item.id);
  const zipPath = path.join(assetDir, `${item.id}_1K-JPG.zip`);
  await mkdir(assetDir, { recursive: true });

  const { buf, sourceUrl, via } = await downloadMetalZip(item.id);
  await writeFile(zipPath, buf);

  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(assetDir, true);
  } finally {
    await rm(zipPath, { force: true });
  }

  // Clean unwanted files/dirs and keep only required WebGL2 OpenGL PBR maps
  const entries = await readdir(assetDir, { withFileTypes: true });
  const kept = {};
  for (const entry of entries) {
    const fullPath = path.join(assetDir, entry.name);
    if (entry.isDirectory()) {
      await rm(fullPath, { recursive: true, force: true });
      continue;
    }
    const role = classifyTextureRole(entry.name);
    if (!role) {
      await rm(fullPath, { force: true });
      continue;
    }
    const info = await stat(fullPath);
    if (info.size <= 0) {
      throw new Error(`${item.id}/${entry.name} is empty (0 bytes)`);
    }
    const meta = await sharp(fullPath).metadata();
    if (meta.width !== 1024 || meta.height !== 1024) {
      throw new Error(`${item.id}/${entry.name} resolution is ${meta.width}x${meta.height}, expected 1024x1024`);
    }
    kept[role] = `${item.id}/${entry.name}`;
  }

  const required = ['color', 'normalGL', 'roughness', 'metalness'];
  const missing = required.filter((k) => !kept[k]);
  if (missing.length > 0) {
    throw new Error(`${item.id} missing required maps: ${missing.join(', ')}`);
  }

  return {
    id: item.id,
    role: item.role,
    license: 'CC0 1.0',
    surfaceType: 'metal',
    resolution: '1024x1024',
    via,
    sourceUrl,
    maps: kept,
    status: 'PASS',
  };
}

async function main() {
  const outRoot = await resolveOutDir(process.argv.slice(2));
  await mkdir(outRoot, { recursive: true });
  console.log(`[ambientcg-metals] Target directory: ${outRoot}`);

  const results = [];
  for (let i = 0; i < TARGET_METALS.length; i++) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    const item = TARGET_METALS[i];
    const res = await processOneMetal(outRoot, item);
    results.push(res);
    console.log(
      `[OK] ${res.id} (${res.via}) -> Color/NormalGL/Roughness/Metalness${res.maps.ao ? '/AO' : ''} [1024x1024]`,
    );
  }

  const manifest = {
    source: 'ambientCG',
    license: 'CC0 1.0',
    normalConvention: 'OpenGL (+Y)',
    generatedAt: new Date().toISOString(),
    materials: results.map(({ id, role, license, surfaceType, resolution, maps }) => ({
      id,
      role,
      license,
      surfaceType,
      resolution,
      maps,
    })),
  };

  const manifestPath = path.join(outRoot, 'ambientcg_metals.manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('\n=== Download & Validation Summary ===');
  console.table(
    results.map((r) => ({
      ID: r.id,
      Via: r.via,
      Resolution: r.resolution,
      Maps: Object.keys(r.maps).join(','),
      Status: r.status,
    })),
  );
  console.log(`Manifest written: ${manifestPath}`);
}

main().catch((err) => {
  console.error('[ambientcg-metals] FAILED:', err);
  process.exit(1);
});

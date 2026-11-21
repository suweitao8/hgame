import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { generateManualTextureSet, generateWaterNormalPng } from './generate-manual-pbr.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WEB_ASSET_CACHE = path.resolve(ROOT, '..', '.cache', 'pbr-raw');
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'materials.manifest.json');
const RAW_PBR_CACHE = path.join(ROOT, 'raw', 'pbr_cache');
const RAW_MANUAL_DIR = path.join(ROOT, 'raw', 'cn_textures_manual');
const HDRI_CACHE = path.join(RAW_PBR_CACHE, '_hdri');
const USER_AGENT = 'HGameAssetsCN/4.1';
const REQUEST_DELAY_MS = 200;

let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttledFetch(url, { asBuffer = false } = {}) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    const waitMs = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.json();
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function tryReuseLegacyCache(slotDir, source, assetId) {
  if (!existsSync(WEB_ASSET_CACHE)) return null;
  const dirs = await readdir(WEB_ASSET_CACHE, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const legacyDir = path.join(WEB_ASSET_CACHE, d.name);
    const metaPath = path.join(legacyDir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (meta.source === source && meta.assetId === assetId && meta.files?.albedo) {
        await mkdir(slotDir, { recursive: true });
        for (const f of Object.values(meta.files)) {
          const srcFile = path.join(legacyDir, f);
          if (existsSync(srcFile)) await copyFile(srcFile, path.join(slotDir, f));
        }
        const nextMeta = { ...meta, reusedFromLegacy: d.name };
        await writeFile(path.join(slotDir, 'meta.json'), JSON.stringify(nextMeta, null, 2));
        return nextMeta;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickPolyHavenMapFile(filesObj, keys, preferredExts = ['png', 'jpg']) {
  for (const key of keys) {
    const block = filesObj?.[key];
    if (!block) continue;
    for (const res of ['1k', '2k']) {
      const resObj = block[res];
      if (!resObj) continue;
      for (const ext of preferredExts) {
        if (resObj[ext]?.url) return { url: resObj[ext].url, ext, resolution: res, key };
      }
      const anyExt = Object.keys(resObj).find((k) => k !== 'exr' && resObj[k]?.url);
      if (anyExt) return { url: resObj[anyExt].url, ext: anyExt, resolution: res, key };
    }
  }
  return null;
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

async function fetchPolyHavenSlot(slotDir, entry) {
  const metaPath = path.join(slotDir, 'meta.json');
  if (existsSync(metaPath)) {
    const prev = JSON.parse(await readFile(metaPath, 'utf8'));
    if (prev.assetId === entry.assetId && prev.files?.albedo && existsSync(path.join(slotDir, prev.files.albedo))) {
      return { meta: prev, cached: true };
    }
  }
  const reused = await tryReuseLegacyCache(slotDir, 'polyhaven', entry.assetId);
  if (reused) return { meta: reused, cached: true };

  await mkdir(slotDir, { recursive: true });
  const filesJson = await throttledFetch(`https://api.polyhaven.com/files/${encodeURIComponent(entry.assetId)}`);
  const picks = {
    albedo: pickPolyHavenMapFile(filesJson, ['Diffuse', 'col_1', 'albedo', 'Color'], ['jpg', 'png']),
    normal: pickPolyHavenMapFile(filesJson, ['nor_gl'], ['png', 'jpg']),
    arm: pickPolyHavenMapFile(filesJson, ['arm'], ['jpg', 'png']),
  };
  if (!picks.arm) {
    picks.ao = pickPolyHavenMapFile(filesJson, ['AO', 'ao'], ['jpg', 'png']);
    picks.rough = pickPolyHavenMapFile(filesJson, ['Rough', 'roughness'], ['jpg', 'png']);
    picks.metal = pickPolyHavenMapFile(filesJson, ['Metal', 'metalness'], ['jpg', 'png']);
  }
  if (entry.alphaCutout) {
    picks.opacity = pickPolyHavenMapFile(filesJson, ['Alpha', 'Opacity', 'alpha', 'opacity'], ['png', 'jpg']);
  }
  if (!picks.albedo) throw new Error(`Poly Haven "${entry.assetId}" missing Diffuse/Albedo`);

  const files = {};
  for (const [role, pick] of Object.entries(picks)) {
    if (!pick) continue;
    const filename = `${role}.${pick.ext}`;
    const buf = await throttledFetch(pick.url, { asBuffer: true });
    await writeFile(path.join(slotDir, filename), buf);
    files[role] = filename;
  }
  const meta = {
    slot: entry.slot,
    source: 'polyhaven',
    assetId: entry.assetId,
    license: 'CC0',
    sourceUrl: `https://polyhaven.com/a/${entry.assetId}`,
    fetchedAt: new Date().toISOString(),
    files,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

async function fetchAmbientCgSlot(slotDir, entry) {
  const metaPath = path.join(slotDir, 'meta.json');
  if (existsSync(metaPath)) {
    const prev = JSON.parse(await readFile(metaPath, 'utf8'));
    if (prev.assetId === entry.assetId && prev.files?.albedo && existsSync(path.join(slotDir, prev.files.albedo))) {
      return { meta: prev, cached: true };
    }
  }
  const reused = await tryReuseLegacyCache(slotDir, 'ambientcg', entry.assetId);
  if (reused) return { meta: reused, cached: true };

  await mkdir(slotDir, { recursive: true });
  const detail = await throttledFetch(
    `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(entry.assetId)}&include=downloadData`,
  );
  const assetInfo = detail?.foundAssets?.[0];
  if (!assetInfo) throw new Error(`ambientCG asset "${entry.assetId}" not found`);
  const links = findDownloadLinksRecursive(assetInfo.downloadFolders);
  const chosen =
    links.find((l) => l.attribute === '1K-PNG') ||
    links.find((l) => l.attribute === '1K-JPG') ||
    links.find((l) => l.attribute === '2K-PNG') ||
    links.find((l) => l.attribute === '2K-JPG') ||
    links[0];
  if (!chosen) throw new Error(`ambientCG "${entry.assetId}" missing zip download`);

  const zipBuf = await throttledFetch(chosen.url, { asBuffer: true });
  const zip = new AdmZip(zipBuf);
  const files = {};
  for (const ze of zip.getEntries()) {
    if (ze.isDirectory) continue;
    const base = path.basename(ze.entryName);
    const extMatch = /\.(png|jpg|jpeg)$/i.exec(base);
    if (!extMatch) continue;
    const ext = extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase();
    let role = null;
    if (/_Color\./i.test(base)) role = 'albedo';
    else if (/_NormalGL\./i.test(base)) role = 'normal';
    else if (/_Roughness\./i.test(base)) role = 'rough';
    else if (/_Metalness\./i.test(base)) role = 'metal';
    else if (/_AmbientOcclusion\./i.test(base)) role = 'ao';
    else if (/_Opacity\./i.test(base)) role = 'opacity';
    if (!role) continue;
    const filename = `${role}.${ext}`;
    await writeFile(path.join(slotDir, filename), ze.getData());
    files[role] = filename;
  }
  if (!files.albedo) throw new Error(`ambientCG "${entry.assetId}" missing _Color map`);
  const meta = {
    slot: entry.slot,
    source: 'ambientcg',
    assetId: entry.assetId,
    license: 'CC0',
    sourceUrl: `https://ambientcg.com/view?id=${entry.assetId}`,
    attribute: chosen.attribute,
    fetchedAt: new Date().toISOString(),
    files,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

async function fetchHdri(hdriDef) {
  await mkdir(HDRI_CACHE, { recursive: true });
  const hdrPath = path.join(HDRI_CACHE, `${hdriDef.slot}.hdr`);
  const metaPath = path.join(HDRI_CACHE, `${hdriDef.slot}.meta.json`);
  if (existsSync(hdrPath) && existsSync(metaPath)) {
    return { cached: true };
  }
  if (hdriDef.slot === 'cn_day_clear') {
    const legacy = path.join(WEB_ASSET_CACHE, '_hdri', 'sky_day.hdr');
    if (existsSync(legacy)) {
      await copyFile(legacy, hdrPath);
      await writeFile(metaPath, JSON.stringify({ ...hdriDef, license: 'CC0', reused: true }, null, 2));
      return { cached: true };
    }
  }
  const filesJson = await throttledFetch(`https://api.polyhaven.com/files/${encodeURIComponent(hdriDef.assetId)}`);
  const hdrUrl = filesJson?.hdri?.['1k']?.hdr?.url || filesJson?.hdri?.['2k']?.hdr?.url;
  if (!hdrUrl) throw new Error(`Poly Haven HDRI "${hdriDef.assetId}" missing 1k/2k hdr`);
  const buf = await throttledFetch(hdrUrl, { asBuffer: true });
  await writeFile(hdrPath, buf);
  await writeFile(
    metaPath,
    JSON.stringify({
      ...hdriDef,
      license: 'CC0',
      sourceUrl: `https://polyhaven.com/a/${hdriDef.assetId}`,
      fetchedAt: new Date().toISOString(),
    }, null, 2),
  );
  return { cached: false };
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  await mkdir(RAW_PBR_CACHE, { recursive: true });
  await mkdir(RAW_MANUAL_DIR, { recursive: true });

  let okCount = 0;
  let cachedCount = 0;
  for (const entry of manifest.materials) {
    if (entry.source === 'composite') {
      okCount++;
      continue;
    }
    if (entry.source === 'manual') {
      const manualDir = path.join(RAW_MANUAL_DIR, entry.assetId);
      const res = await generateManualTextureSet(entry.assetId, manualDir, 1024);
      if (res.cached) cachedCount++;
      else console.log(`[pbr:fetch] manual generated ${entry.slot} (${entry.assetId})`);
      okCount++;
      continue;
    }
    const slotDir = path.join(RAW_PBR_CACHE, entry.slot);
    if (entry.source === 'polyhaven') {
      const res = await fetchPolyHavenSlot(slotDir, entry);
      if (res.cached) cachedCount++;
      else console.log(`[pbr:fetch] polyhaven fetched ${entry.slot} <- ${entry.assetId}`);
      okCount++;
    } else if (entry.source === 'ambientcg') {
      const res = await fetchAmbientCgSlot(slotDir, entry);
      if (res.cached) cachedCount++;
      else console.log(`[pbr:fetch] ambientcg fetched ${entry.slot} <- ${entry.assetId}`);
      okCount++;
    }
  }

  for (const hdriDef of manifest.hdri || []) {
    const res = await fetchHdri(hdriDef);
    if (!res.cached) console.log(`[pbr:fetch] hdri fetched ${hdriDef.slot} <- ${hdriDef.assetId}`);
  }

  const waterOut = path.join(RAW_MANUAL_DIR, 'water_normal.png');
  if (!existsSync(waterOut)) {
    await generateWaterNormalPng(waterOut, manifest.waterNormal?.size || 512);
    console.log('[pbr:fetch] generated water_normal.png');
  }

  console.log(`[pbr:fetch] Complete: ${okCount} materials (${cachedCount} cached/reused), ${(manifest.hdri || []).length} HDRIs`);
}

main().catch((err) => {
  console.error('[pbr:fetch] FAILED:', err);
  process.exit(1);
});

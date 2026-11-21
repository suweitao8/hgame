import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'assets', 'pbr', 'materials.manifest.json');
const CACHE_RAW = path.join(ROOT, '.cache', 'pbr-raw');
const HDRI_CACHE = path.join(CACHE_RAW, '_hdri');
const PUBLIC_PBR = path.join(ROOT, 'public', 'assets', 'pbr');
const LICENSES_PATH = path.join(PUBLIC_PBR, 'LICENSES.json');

const USER_AGENT = 'HGamePBRPipeline/1.0';
const REQUEST_DELAY_MS = 250;
const MAX_RETRIES = 2;

const SYNONYMS = {
  obsidian: ['black', 'smooth', 'dark', 'rock'],
  volcanic: ['black', 'dark', 'cliff', 'rock'],
  basalt: ['dark', 'black', 'cliff', 'rock', 'rough'],
  coal: ['black', 'dark', 'charcoal', 'rock', 'asphalt'],
  birch: ['bark', 'light', 'smooth', 'white'],
  foliage: ['leaf', 'leaves', 'leafset', 'green', 'tree'],
  leaves: ['leaf', 'leafset', 'foliage', 'green'],
  ceramic: ['tiles', 'bathroom', 'clean', 'white', 'square'],
  terracotta: ['clay', 'terracotta', 'orange', 'red'],
  oxidized: ['oxidized', 'patina', 'green', 'copper', 'rust', 'cobalt'],
  raw: ['iron', 'metal', 'rough', 'scratched'],
  red: ['red', 'orange', 'desert', 'brown', 'clay'],
  stump: ['treeend', 'stump', 'cut', 'end', 'rings', 'wood'],
  rings: ['treeend', 'end', 'cut', 'wood'],
};

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttledFetch(url, { asBuffer = false } = {}) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= MAX_RETRIES) {
    const waitMs = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      if (asBuffer) {
        return Buffer.from(await res.arrayBuffer());
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      attempt++;
      if (attempt <= MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    }
  }
  throw lastError;
}

function tokenizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 2);
}

function expandTokens(words) {
  const expanded = new Set(words);
  for (const w of words) {
    const syns = SYNONYMS[w];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return [...expanded];
}

async function getPolyHavenIndex() {
  const indexPath = path.join(CACHE_RAW, '_polyhaven_index.json');
  if (existsSync(indexPath)) {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  }
  console.log('[fetch-pbr] Fetching Poly Haven texture catalog...');
  const data = await throttledFetch('https://api.polyhaven.com/assets?t=textures');
  await writeFile(indexPath, JSON.stringify(data));
  return data;
}

async function getAmbientCgIndex() {
  const indexPath = path.join(CACHE_RAW, '_ambientcg_index.json');
  if (existsSync(indexPath)) {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  }
  console.log('[fetch-pbr] Fetching ambientCG Material & Atlas catalogs...');
  const assets = [];
  for (const type of ['Material', 'Atlas']) {
    let offset = 0;
    while (offset < 5000) {
      const url = `https://ambientcg.com/api/v2/full_json?type=${type}&sort=Popular&limit=250&offset=${offset}`;
      const page = await throttledFetch(url);
      const list = Array.isArray(page?.foundAssets) ? page.foundAssets : [];
      if (list.length === 0) break;
      for (const item of list) {
        assets.push({
          assetId: item.assetId,
          dataType: item.dataType || type,
          displayName: item.displayName || item.assetId,
          tags: Array.isArray(item.tags) ? item.tags : [],
          category: item.category || '',
          popularityRank: assets.length,
        });
      }
      offset += list.length;
      if (list.length < 250 || offset >= (page?.numberOfResults ?? offset)) break;
    }
  }
  await writeFile(indexPath, JSON.stringify({ fetchedAt: new Date().toISOString(), assets }));
  return { assets };
}

function tokenizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function makeWordSet(text) {
  const words = tokenizeWords(text);
  const set = new Set(words);
  // Also split alpha+digit tokens like "ice003" -> "ice", "rock031" -> "rock", "leafset024" -> "leafset"
  for (const w of words) {
    const m = /^([a-z]+)\d+[a-z]*$/.exec(w);
    if (m) set.add(m[1]);
  }
  return set;
}

function pickPolyHavenAsset(index, entry, usedIds) {
  if (entry.assetId) {
    if (!index[entry.assetId]) {
      throw new Error(`Poly Haven assetId "${entry.assetId}" not found for slot "${entry.slot}"`);
    }
    return entry.assetId;
  }
  const words = tokenizeQuery(entry.query);
  const candidates = Object.entries(index).map(([id, meta]) => {
    const idWords = makeWordSet(`${id} ${meta.name || ''}`);
    const tagWords = makeWordSet(`${(meta.tags || []).join(' ')} ${(meta.categories || []).join(' ')}`);
    const descWords = makeWordSet(meta.description || '');
    let score = 0;
    let primaryHits = 0;
    for (const w of words) {
      if (idWords.has(w)) {
        score += 4;
        primaryHits++;
      } else if (tagWords.has(w)) {
        score += 3;
        primaryHits++;
      } else if (descWords.has(w)) {
        score += 1;
      }
    }
    return {
      id,
      score,
      primaryHits,
      downloads: meta.download_count || 0,
      alreadyUsed: usedIds.has(id) ? 1 : 0,
    };
  }).filter(c => c.score > 0);

  candidates.sort((a, b) =>
    (b.score - a.score) ||
    (b.primaryHits - a.primaryHits) ||
    (a.alreadyUsed - b.alreadyUsed) ||
    (b.downloads - a.downloads)
  );
  if (!candidates.length) {
    throw new Error(`No Poly Haven match for slot "${entry.slot}" query "${entry.query}"`);
  }
  return candidates[0].id;
}

function pickAmbientCgAsset(index, entry, usedIds) {
  if (entry.assetId) return entry.assetId;
  const words = tokenizeQuery(entry.query);
  const expanded = expandTokens(words);

  const scoreItem = (item, useExpanded) => {
    const idWords = makeWordSet(`${item.assetId || ''} ${item.displayName || ''}`);
    const tagWords = makeWordSet(`${(item.tags || []).join(' ')} ${item.category || ''}`);
    const tokens = useExpanded ? expanded : words;
    let score = 0;
    let idHits = 0;
    for (const w of tokens) {
      const weight = words.includes(w) ? 1 : 0.45;
      if (idWords.has(w)) {
        score += 4 * weight;
        if (words.includes(w)) idHits++;
      } else if (tagWords.has(w)) {
        score += 2 * weight;
      }
    }
    let bonus = 0;
    if (entry.alphaCutout) {
      if (item.dataType === 'Atlas' || /^leafset/i.test(item.assetId)) bonus += 6;
      if (/scattered/i.test(item.assetId)) bonus -= 4;
    } else if (item.dataType === 'Atlas') {
      bonus -= 5;
    }
    return {
      assetId: item.assetId,
      score: score + bonus,
      idHits,
      alreadyUsed: usedIds.has(item.assetId) ? 1 : 0,
      rank: item.popularityRank ?? 9999,
    };
  };

  let scored = index.assets.map(item => scoreItem(item, false)).filter(c => c.score > 0);
  if (scored.length === 0 || (words.length >= 2 && scored.every(c => c.idHits === 0 && c.score < 4))) {
    const expScored = index.assets.map(item => scoreItem(item, true)).filter(c => c.score > 0);
    if (expScored.length > 0) scored = expScored;
  }

  scored.sort((a, b) =>
    (b.score - a.score) ||
    (b.idHits - a.idHits) ||
    (a.alreadyUsed - b.alreadyUsed) ||
    (a.rank - b.rank)
  );
  if (!scored.length) {
    throw new Error(`No ambientCG match for slot "${entry.slot}" query "${entry.query}"`);
  }
  return scored[0].assetId;
}

function pickPolyHavenMapFile(filesObj, keys, preferredExts = ['png', 'jpg']) {
  for (const key of keys) {
    const block = filesObj?.[key];
    if (!block) continue;
    for (const res of ['1k', '2k']) {
      const resObj = block[res];
      if (!resObj) continue;
      for (const ext of preferredExts) {
        if (resObj[ext]?.url) {
          return { url: resObj[ext].url, ext, resolution: res, key };
        }
      }
      const anyExt = Object.keys(resObj).find(k => k !== 'exr' && resObj[k]?.url);
      if (anyExt) {
        return { url: resObj[anyExt].url, ext: anyExt, resolution: res, key };
      }
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
    out.push({
      attribute: node.attribute,
      filetype: node.filetype || '',
      url: node.downloadLink,
      fileName: node.fileName || '',
    });
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') findDownloadLinksRecursive(val, out);
  }
  return out;
}

async function fetchPolyHavenSlot(slotDir, entry, index, usedIds) {
  const assetId = pickPolyHavenAsset(index, entry, usedIds);
  usedIds.add(assetId);
  const metaPath = path.join(slotDir, 'meta.json');
  if (existsSync(metaPath)) {
    try {
      const prev = JSON.parse(await readFile(metaPath, 'utf8'));
      if (prev.assetId === assetId && prev.source === 'polyhaven' && prev.files?.albedo && existsSync(path.join(slotDir, prev.files.albedo))) {
        return { meta: prev, cached: true };
      }
    } catch { /* re-fetch */ }
  }

  await mkdir(slotDir, { recursive: true });
  const filesJson = await throttledFetch(`https://api.polyhaven.com/files/${encodeURIComponent(assetId)}`);

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

  if (!picks.albedo) {
    throw new Error(`Poly Haven asset "${assetId}" for slot "${entry.slot}" has no Diffuse/albedo map`);
  }

  const savedFiles = {};
  for (const [kind, pick] of Object.entries(picks)) {
    if (!pick) continue;
    const filename = `${kind}.${pick.ext}`;
    const buf = await throttledFetch(pick.url, { asBuffer: true });
    await writeFile(path.join(slotDir, filename), buf);
    savedFiles[kind] = filename;
  }

  const assetInfo = index[assetId] || {};
  const meta = {
    slot: entry.slot,
    source: 'polyhaven',
    assetId,
    name: assetInfo.name || assetId,
    authors: Object.keys(assetInfo.authors || {}),
    license: 'CC0',
    sourceUrl: `https://polyhaven.com/a/${assetId}`,
    fetchedAt: new Date().toISOString(),
    files: savedFiles,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

async function fetchAmbientCgSlot(slotDir, entry, index, usedIds) {
  const assetId = pickAmbientCgAsset(index, entry, usedIds);
  usedIds.add(assetId);
  const metaPath = path.join(slotDir, 'meta.json');
  if (existsSync(metaPath)) {
    try {
      const prev = JSON.parse(await readFile(metaPath, 'utf8'));
      if (prev.assetId === assetId && prev.source === 'ambientcg' && prev.files?.albedo && existsSync(path.join(slotDir, prev.files.albedo))) {
        return { meta: prev, cached: true };
      }
    } catch { /* re-fetch */ }
  }

  await mkdir(slotDir, { recursive: true });
  const detail = await throttledFetch(
    `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(assetId)}&include=downloadData`
  );
  const found = detail?.foundAssets?.[0];
  if (!found) {
    throw new Error(`ambientCG asset "${assetId}" returned no details for slot "${entry.slot}"`);
  }

  const downloads = findDownloadLinksRecursive(found.downloadFolders || found);
  const preferredAttrs = entry.alphaCutout
    ? ['1K-PNG', '1K-JPG', '2K-PNG', '2K-JPG']
    : ['1K-JPG', '1K-PNG', '2K-JPG', '2K-PNG'];
  let chosen = null;
  for (const attr of preferredAttrs) {
    chosen = downloads.find(d => d.attribute === attr && (d.filetype === 'zip' || d.url.endsWith('.zip') || d.fileName.endsWith('.zip')));
    if (chosen) break;
  }
  if (!chosen) {
    chosen = downloads.find(d => /zip/i.test(d.filetype) || d.url.includes('.zip'));
  }
  if (!chosen) {
    throw new Error(`ambientCG asset "${assetId}" has no 1K zip download for slot "${entry.slot}"`);
  }

  const zipPath = path.join(slotDir, `${assetId}.zip`);
  const zipBuf = await throttledFetch(chosen.url, { asBuffer: true });
  await writeFile(zipPath, zipBuf);

  const savedFiles = {};
  try {
    const zip = new AdmZip(zipPath);
    for (const zipEntry of zip.getEntries()) {
      if (zipEntry.isDirectory) continue;
      const base = path.basename(zipEntry.entryName);
      const extMatch = /\.(jpg|jpeg|png)$/i.exec(base);
      if (!extMatch) continue;
      const ext = extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase();

      let kind = null;
      if (/_Color\.(jpg|jpeg|png)$/i.test(base)) kind = 'albedo';
      else if (/_NormalGL\.(jpg|jpeg|png)$/i.test(base)) kind = 'normal';
      else if (/_AmbientOcclusion\.(jpg|jpeg|png)$/i.test(base)) kind = 'ao';
      else if (/_Roughness\.(jpg|jpeg|png)$/i.test(base)) kind = 'rough';
      else if (/_Metalness\.(jpg|jpeg|png)$/i.test(base)) kind = 'metal';
      else if (/_Opacity\.(jpg|jpeg|png)$/i.test(base)) kind = 'opacity';

      if (kind) {
        const outName = `${kind}.${ext}`;
        await writeFile(path.join(slotDir, outName), zipEntry.getData());
        savedFiles[kind] = outName;
      }
    }
  } finally {
    await rm(zipPath, { force: true });
  }

  if (!savedFiles.albedo) {
    throw new Error(`ambientCG zip for "${assetId}" missing *_Color map`);
  }

  const meta = {
    slot: entry.slot,
    source: 'ambientcg',
    assetId,
    name: found.displayName || assetId,
    license: 'CC0',
    sourceUrl: `https://ambientcg.com/view?id=${assetId}`,
    attribute: chosen.attribute,
    fetchedAt: new Date().toISOString(),
    files: savedFiles,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

async function fetchHdriSlot(entry) {
  await mkdir(HDRI_CACHE, { recursive: true });
  const hdrPath = path.join(HDRI_CACHE, `${entry.slot}.hdr`);
  const metaPath = path.join(HDRI_CACHE, `${entry.slot}.meta.json`);
  if (existsSync(hdrPath) && existsSync(metaPath)) {
    try {
      const prev = JSON.parse(await readFile(metaPath, 'utf8'));
      if (prev.assetId === entry.assetId) {
        return { meta: prev, cached: true };
      }
    } catch { /* re-fetch */ }
  }
  const filesJson = await throttledFetch(`https://api.polyhaven.com/files/${encodeURIComponent(entry.assetId)}`);
  const hdrUrl = filesJson?.hdri?.['1k']?.hdr?.url || filesJson?.hdri?.['2k']?.hdr?.url;
  if (!hdrUrl) {
    throw new Error(`No 1k/2k HDRI url for "${entry.assetId}"`);
  }
  const buf = await throttledFetch(hdrUrl, { asBuffer: true });
  await writeFile(hdrPath, buf);

  let tonemappedFile = null;
  const tmUrl = filesJson?.tonemapped?.url;
  if (tmUrl) {
    try {
      const tmBuf = await throttledFetch(tmUrl, { asBuffer: true });
      tonemappedFile = `${entry.slot}_tonemapped.jpg`;
      await writeFile(path.join(HDRI_CACHE, tonemappedFile), tmBuf);
    } catch { /* optional */ }
  }

  const meta = {
    slot: entry.slot,
    source: 'polyhaven',
    assetId: entry.assetId,
    license: 'CC0',
    sourceUrl: `https://polyhaven.com/a/${entry.assetId}`,
    hdrFile: `${entry.slot}.hdr`,
    tonemappedFile,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  await mkdir(CACHE_RAW, { recursive: true });
  await mkdir(PUBLIC_PBR, { recursive: true });

  const phIndex = await getPolyHavenIndex();
  const acgIndex = await getAmbientCgIndex();

  const usedPh = new Set();
  const usedAcg = new Set();
  for (const entry of manifest.materials) {
    if (entry.assetId) {
      if (entry.source === 'polyhaven') usedPh.add(entry.assetId);
      if (entry.source === 'ambientcg') usedAcg.add(entry.assetId);
    }
  }

  if (dryRun) {
    for (let i = 0; i < manifest.materials.length; i++) {
      const entry = manifest.materials[i];
      const id = entry.source === 'polyhaven'
        ? pickPolyHavenAsset(phIndex, entry, usedPh)
        : pickAmbientCgAsset(acgIndex, entry, usedAcg);
      if (entry.source === 'polyhaven') usedPh.add(id);
      else usedAcg.add(id);
      console.log(`[dry-run ${String(i + 1).padStart(2, '0')}/${manifest.materials.length}] ${entry.slot} -> ${entry.source}:${id}`);
    }
    return;
  }

  const licenseEntries = [];
  const hdriEntries = [];

  for (const hdri of manifest.hdri || []) {
    const { meta, cached } = await fetchHdriSlot(hdri);
    console.log(`[hdri] ${hdri.slot} -> ${meta.assetId} (${cached ? 'cached' : 'downloaded'})`);
    hdriEntries.push({
      slot: hdri.slot,
      source: meta.source,
      assetId: meta.assetId,
      license: meta.license,
      sourceUrl: meta.sourceUrl,
      fetchedAt: meta.fetchedAt,
    });
  }

  for (let i = 0; i < manifest.materials.length; i++) {
    const entry = manifest.materials[i];
    const slotDir = path.join(CACHE_RAW, entry.slot);
    let result;
    if (entry.source === 'polyhaven') {
      result = await fetchPolyHavenSlot(slotDir, entry, phIndex, usedPh);
    } else if (entry.source === 'ambientcg') {
      result = await fetchAmbientCgSlot(slotDir, entry, acgIndex, usedAcg);
    } else {
      throw new Error(`Unsupported source "${entry.source}" for slot "${entry.slot}"`);
    }
    const { meta, cached } = result;
    const maps = Object.keys(meta.files).join(',');
    console.log(`[${String(i + 1).padStart(2, '0')}/${manifest.materials.length}] ${entry.slot} -> ${meta.source}:${meta.assetId} [${maps}] (${cached ? 'cached' : 'fetched'})`);
    licenseEntries.push({
      slot: entry.slot,
      source: meta.source,
      assetId: meta.assetId,
      license: meta.license,
      sourceUrl: meta.sourceUrl,
      fetchedAt: meta.fetchedAt,
    });
  }

  const licenses = {
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    allCC0: licenseEntries.every(e => e.license === 'CC0') && hdriEntries.every(e => e.license === 'CC0'),
    hdriCount: hdriEntries.length,
    materialCount: licenseEntries.length,
    hdri: hdriEntries,
    materials: licenseEntries,
  };
  await writeFile(LICENSES_PATH, JSON.stringify(licenses, null, 2) + '\n');
  console.log(`[fetch-pbr] Complete. Wrote ${LICENSES_PATH} (allCC0=${licenses.allCC0})`);
}

main().catch(err => {
  console.error('[fetch-pbr] FAILED:', err);
  process.exit(1);
});

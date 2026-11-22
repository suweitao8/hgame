#!/usr/bin/env node
/**
 * One-command headless setup for MPFB2 extension, MakeHuman official asset packs,
 * API probe verification, and full asset catalog indexing -> built/char_parts/mpfb-assets-index.json.
 *
 * Usage:
 *   node scripts/setup-mpfb2.mjs [--cc0-only] [--force] [--index-only] [--concurrency 4]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { resolveModel3dConfig } from './process-model3d.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const MPFB2_EXTENSION_ID = 'mpfb';
const MPFB2_FALLBACK_ZIP_URL =
  'https://extensions.blender.org/download/sha256:6b21a5b7334517a5ef7a0d0cc8e3a8aa39d5b1086e608fd8305a5d172e1e0e49/add-on-mpfb-v2.0.18.zip';
const MPFB2_FALLBACK_FILENAME = 'add-on-mpfb-v2.0.18.zip';

const PACK_MANIFEST = [
  // CC0 core system & outfit packs
  { pack: 'makehuman_system_assets', filename: 'makehuman_system_assets_cc0.zip', license: 'CC0', required: true },
  { pack: 'suits01', filename: 'suits01_cc0.zip', license: 'CC0' },
  { pack: 'suits02', filename: 'suits02_cc0.zip', license: 'CC0' },
  { pack: 'shirts01', filename: 'shirts01_cc0.zip', license: 'CC0' },
  { pack: 'pants01', filename: 'pants01_cc0.zip', license: 'CC0' },
  { pack: 'skirts01', filename: 'skirts01_cc0.zip', license: 'CC0' },
  { pack: 'dress01', filename: 'dress01_cc0.zip', license: 'CC0' },
  { pack: 'shoes01', filename: 'shoes01_cc0.zip', license: 'CC0' },
  { pack: 'hats01', filename: 'hats01_cc0.zip', license: 'CC0' },
  { pack: 'hats02', filename: 'hats02_cc0.zip', license: 'CC0' },
  { pack: 'glasses01', filename: 'glasses01_cc0.zip', license: 'CC0' },
  { pack: 'gloves01', filename: 'gloves01_cc0.zip', license: 'CC0' },
  { pack: 'masks01', filename: 'masks01_cc0.zip', license: 'CC0' },
  { pack: 'hair01', filename: 'hair01_cc0.zip', license: 'CC0' },
  { pack: 'equipment01', filename: 'equipment01_cc0.zip', license: 'CC0' },
  { pack: 'bodyparts01', filename: 'bodyparts01_cc0.zip', license: 'CC0' },
  { pack: 'skins01', filename: 'skins01_cc0.zip', license: 'CC0' },
  { pack: 'skins02', filename: 'skins02_cc0.zip', license: 'CC0' },
  { pack: 'system_clothes_materials01', filename: 'system_clothes_materials01_cc0.zip', license: 'CC0' },
  { pack: 'system_hair_materials01', filename: 'system_hair_materials01_cc0.zip', license: 'CC0' },

  // CC-BY extended packs (hyphenated _cc-by.zip)
  { pack: 'suits03', filename: 'suits03_cc-by.zip', license: 'CC-BY' },
  { pack: 'skirts02', filename: 'skirts02_cc-by.zip', license: 'CC-BY' },
  { pack: 'dress02', filename: 'dress02_cc-by.zip', license: 'CC-BY' },
  { pack: 'dress03', filename: 'dress03_cc-by.zip', license: 'CC-BY' },
  { pack: 'hats03', filename: 'hats03_cc-by.zip', license: 'CC-BY' },
  { pack: 'hats04', filename: 'hats04_cc-by.zip', license: 'CC-BY' },
  { pack: 'equipment02', filename: 'equipment02_cc-by.zip', license: 'CC-BY' },
  { pack: 'equipment03', filename: 'equipment03_cc-by.zip', license: 'CC-BY' },
  { pack: 'bodyparts02', filename: 'bodyparts02_cc-by.zip', license: 'CC-BY' },
  { pack: 'bodyparts03', filename: 'bodyparts03_cc-by.zip', license: 'CC-BY' },

  // CC-BY extended packs (_ccby.zip)
  { pack: 'shirts02', filename: 'shirts02_ccby.zip', license: 'CC-BY' },
  { pack: 'shirts03', filename: 'shirts03_ccby.zip', license: 'CC-BY' },
  { pack: 'pants02', filename: 'pants02_ccby.zip', license: 'CC-BY' },
  { pack: 'pants03', filename: 'pants03_ccby.zip', license: 'CC-BY' },
  { pack: 'shoes02', filename: 'shoes02_ccby.zip', license: 'CC-BY' },
  { pack: 'shoes03', filename: 'shoes03_ccby.zip', license: 'CC-BY' },
  { pack: 'glasses02', filename: 'glasses02_ccby.zip', license: 'CC-BY' },
  { pack: 'masks02', filename: 'masks02_ccby.zip', license: 'CC-BY' },
  { pack: 'hair02', filename: 'hair02_ccby.zip', license: 'CC-BY' },
  { pack: 'hair03', filename: 'hair03_ccby.zip', license: 'CC-BY' },
];

function parseArgs(argv) {
  const opts = {
    cc0Only: false,
    force: false,
    indexOnly: false,
    concurrency: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cc0-only') opts.cc0Only = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--index-only') opts.indexOnly = true;
    else if (a === '--concurrency' && argv[i + 1]) {
      opts.concurrency = Math.max(1, Math.min(8, Number(argv[++i]) || 4));
    }
  }
  return opts;
}

function runBlender(blenderPath, args) {
  const res = spawnSync(blenderPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return res;
}

function checkBlenderVersion(blenderPath) {
  const res = runBlender(blenderPath, ['--version']);
  if (res.status !== 0) {
    throw new Error(`Failed to execute Blender (${blenderPath}): ${res.stderr || res.error?.message}`);
  }
  const m = String(res.stdout).match(/Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) {
    throw new Error(`Could not parse Blender version from: ${res.stdout}`);
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < 4 || (major === 4 && minor < 2)) {
    throw new Error(`Blender >= 4.2 required for MPFB2, found ${m[0]}`);
  }
  return { major, minor, raw: m[0] };
}

function isZipSignatureValid(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 64) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  } catch {
    return false;
  }
}

async function downloadFileWithRetry(urls, destPath, retries = 3, label = '') {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.part`;
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const url = urls[(attempt - 1) % urls.length];
    const ctrl = new AbortController();
    let stallTimer = null;
    const resetStall = (ms = 45000) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ctrl.abort(new Error(`Stalled downloading ${url}`)), ms);
    };
    try {
      resetStall(25000);
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'HGame-MPFB2-Setup/1.0' },
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      const totalBytes = Number(resp.headers.get('content-length') || 0);
      const tag = label || path.basename(destPath);
      const mbStr = totalBytes ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : '? MB';
      console.log(`  [downloading] ${tag} (${mbStr})...`);

      let received = 0;
      const bodyStream = Readable.fromWeb(resp.body);
      bodyStream.on('data', (chunk) => {
        received += chunk.length;
        resetStall(45000);
      });
      const out = fs.createWriteStream(tmpPath);
      await pipeline(bodyStream, out);
      if (stallTimer) clearTimeout(stallTimer);

      if (totalBytes > 0 && received < totalBytes) {
        throw new Error(`Incomplete download (${received}/${totalBytes} bytes) for ${url}`);
      }
      if (!isZipSignatureValid(tmpPath)) {
        throw new Error(`Downloaded file is not a valid ZIP: ${url}`);
      }
      fs.renameSync(tmpPath, destPath);
      return destPath;
    } catch (err) {
      if (stallTimer) clearTimeout(stallTimer);
      lastErr = err;
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  throw lastErr;
}

async function ensureMpfb2Extension(blenderPath, downloadsDir, force) {
  const listRes = runBlender(blenderPath, ['--command', 'extension', 'list']);
  const alreadyInstalled =
    listRes.status === 0 && /\bmpfb\b/i.test(String(listRes.stdout || ''));
  if (alreadyInstalled && !force) {
    console.log('[setup-mpfb2] MPFB2 extension already enabled in Blender.');
    return;
  }

  let extZip = fs
    .readdirSync(downloadsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /^add-on-mpfb.*\.zip$/i.test(d.name))
    .map((d) => path.join(downloadsDir, d.name))
    .find((p) => isZipSignatureValid(p));

  if (!extZip) {
    extZip = path.join(downloadsDir, MPFB2_FALLBACK_FILENAME);
    console.log('[setup-mpfb2] Downloading MPFB2 extension zip...');
    const urls = [MPFB2_FALLBACK_ZIP_URL];
    try {
      const apiResp = await fetch('https://extensions.blender.org/api/v1/extensions/mpfb/');
      if (apiResp.ok) {
        const meta = await apiResp.json();
        const archiveUrl = meta?.archive_url || meta?.version?.archive_url;
        if (archiveUrl) urls.unshift(archiveUrl);
      }
    } catch {}
    await downloadFileWithRetry(urls, extZip, 3);
  }

  console.log(`[setup-mpfb2] Installing MPFB2 extension from ${path.basename(extZip)}...`);
  const inst = runBlender(blenderPath, [
    '--command',
    'extension',
    'install-file',
    '-r',
    'user_default',
    '-e',
    extZip,
  ]);
  if (inst.status !== 0) {
    throw new Error(`MPFB2 extension install failed:\n${inst.stdout}\n${inst.stderr}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = resolveModel3dConfig(REPO_ROOT);
  const blenderPath = cfg.blenderPath || 'blender';

  const ver = checkBlenderVersion(blenderPath);
  console.log(`[setup-mpfb2] Blender: ${ver.raw} (${blenderPath})`);

  const mpfbRoot = path.join(REPO_ROOT, 'vendor', 'mpfb2');
  const downloadsDir = path.join(mpfbRoot, 'downloads');
  const userDataDir = path.join(mpfbRoot, 'user_data');
  const indexOut = path.join(REPO_ROOT, 'built', 'char_parts', 'mpfb-assets-index.json');
  const probeOut = path.join(REPO_ROOT, 'built', 'char_parts', 'mpfb-api-probe.json');
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(indexOut), { recursive: true });

  await ensureMpfb2Extension(blenderPath, downloadsDir, false);

  const selectedPacks = PACK_MANIFEST.filter((p) => !opts.cc0Only || p.license === 'CC0');
  const downloadedZips = [];
  const warnings = [];

  if (!opts.indexOnly) {
    console.log(
      `[setup-mpfb2] Preparing ${selectedPacks.length} asset packs (${opts.cc0Only ? 'CC0 only' : 'CC0 + CC-BY'})...`,
    );

    const queue = [...selectedPacks];
    const workers = Array.from({ length: opts.concurrency }, async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;
        const zipPath = path.join(downloadsDir, entry.filename);
        const alreadyOk = !opts.force && isZipSignatureValid(zipPath);
        if (!alreadyOk) {
          const urls = [
            `https://files.makehumancommunity.org/asset_packs/${entry.pack}/${entry.filename}`,
            `https://files2.makehumancommunity.org/asset_packs/${entry.pack}/${entry.filename}`,
          ];
          try {
            await downloadFileWithRetry(urls, zipPath, 3);
            console.log(`  [downloaded] ${entry.filename} (${entry.license})`);
          } catch (err) {
            const msg = `${entry.pack}: ${err.message}`;
            if (entry.required) {
              throw new Error(`Required pack failed: ${msg}`);
            }
            warnings.push(msg);
            console.warn(`  [warn] ${msg}`);
            continue;
          }
        }
        downloadedZips.push({
          pack: entry.pack,
          zip: zipPath,
          license: entry.license,
        });
      }
    });
    await Promise.all(workers);
  }

  // Filter out packs already extracted unless --force
  const registryPath = path.join(userDataDir, '.pack_registry.json');
  let registry = {};
  if (!opts.force && fs.existsSync(registryPath)) {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
      registry = {};
    }
  }

  const toExtract = downloadedZips.filter((item) => opts.force || !registry[item.pack]);
  const extractListPath = path.join(mpfbRoot, '.extract_queue.json');
  const pyScript = path.join(REPO_ROOT, 'scripts', 'blender', 'index_mpfb_assets.py');
  const blenderArgs = [
    '--background',
    '--python',
    pyScript,
    '--',
    '--user-data',
    userDataDir,
    '--out',
    indexOut,
    '--probe-out',
    probeOut,
  ];
  if (toExtract.length > 0 && !opts.indexOnly) {
    fs.writeFileSync(extractListPath, JSON.stringify(toExtract, null, 2));
    blenderArgs.push('--extract-zips', extractListPath);
    console.log(`[setup-mpfb2] Extracting ${toExtract.length} pack(s) & indexing via Blender...`);
  } else {
    console.log('[setup-mpfb2] Indexing MPFB2 assets via Blender...');
  }

  const idxRes = runBlender(blenderPath, blenderArgs);
  try {
    if (fs.existsSync(extractListPath)) fs.unlinkSync(extractListPath);
  } catch {}

  if (idxRes.status !== 0) {
    throw new Error(`Blender asset indexing failed:\n${idxRes.stdout}\n${idxRes.stderr}`);
  }

  const summary = JSON.parse(fs.readFileSync(indexOut, 'utf8'));
  console.log(
    `[setup-mpfb2] Done! totalAssets=${summary.totalAssets}, gameReadyAssets=${summary.gameReadyAssets}`,
  );
  console.log('[setup-mpfb2] Slots:', JSON.stringify(summary.slotCounts));
  console.log('[setup-mpfb2] Licenses:', JSON.stringify(summary.licenseCounts));
  if (warnings.length > 0) {
    console.warn(`[setup-mpfb2] ${warnings.length} optional pack warnings:`, warnings);
  }
}

main().catch((err) => {
  console.error('[setup-mpfb2] ERROR:', err.message);
  process.exit(1);
});

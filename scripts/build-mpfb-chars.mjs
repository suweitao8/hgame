#!/usr/bin/env node
/**
 * Batch headless character builder & WebAsset registrar for MPFB2 recipes.
 *
 * Usage:
 *   node scripts/build-mpfb-chars.mjs [--recipe <path>] [--scope <scope>] [--force] [--no-webasset]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAssetDb, resolveDefaultDbPath } from '../webasset/lib/asset-db.mjs';
import { resolveModel3dConfig } from './process-model3d.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    recipe: '',
    scope: '',
    force: false,
    noWebasset: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recipe' && argv[i + 1]) opts.recipe = argv[++i];
    else if (a === '--scope' && argv[i + 1]) opts.scope = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--no-webasset') opts.noWebasset = true;
  }
  return opts;
}

function sha1File(filePath) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function sha1String(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function toWebAssetId(charId) {
  return String(charId)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function collectRecipeFiles(opts) {
  const recipesRoot = path.join(REPO_ROOT, 'char_recipes');
  if (opts.recipe) {
    const abs = path.resolve(REPO_ROOT, opts.recipe);
    if (!fs.existsSync(abs)) {
      throw new Error(`Recipe file not found: ${abs}`);
    }
    let scope = opts.scope;
    if (!scope) {
      const rel = path.relative(recipesRoot, path.dirname(abs)).replace(/\\/g, '/');
      scope = !rel.startsWith('..') && rel && rel !== '.' ? rel : 'universal';
    }
    return [{ filePath: abs, scope }];
  }

  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'textures') continue;
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.json') && !ent.name.endsWith('.resolved.json')) {
        const relDir = path.relative(recipesRoot, path.dirname(full)).replace(/\\/g, '/');
        const scope = relDir && relDir !== '.' ? relDir : 'universal';
        if (opts.scope && scope !== opts.scope) continue;
        found.push({ filePath: full, scope });
      }
    }
  };
  walk(recipesRoot);
  found.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return found;
}

function scoreAssetCandidate(asset, slot, keywords, phenotype) {
  let score = 0;
  if (asset.slot === slot) score += 400;
  else if (slot === 'bottom' && asset.slot === 'clothes') score += 50;
  else if (slot === 'top' && asset.slot === 'clothes') score += 50;
  else if (asset.slot === 'clothes') score += 20;

  if (asset.gameReady) score += 1000;
  if (!asset.hasAlphaCards) score += 500;
  if (!asset.highPoly) score += 200;
  score += Math.max(0, 120 - asset.tris / 80);

  const hay = `${asset.assetId} ${asset.name} ${asset.tags.join(' ')}`.toLowerCase();
  for (const kw of keywords) {
    if (!kw) continue;
    if (asset.tags.includes(kw)) score += 260;
    else if (hay.includes(kw)) score += 180;
  }

  const gender = Number(phenotype?.gender ?? 0.5);
  if (gender >= 0.72) {
    if (/\bfemale\b|\bwomen\b|\bwoman\b|\bgirl\b|\bher\b/.test(hay) && !/\bmale\b/.test(hay)) score -= 120;
    if (/\bmale\b|\bman\b|\bmen\b|\bboy\b/.test(hay)) score += 90;
  } else if (gender <= 0.28) {
    if (/\bmale\b|\bman\b|\bmen\b/.test(hay) && !/\bfemale\b/.test(hay)) score -= 120;
    if (/\bfemale\b|\bwomen\b|\bwoman\b|\bgirl\b/.test(hay)) score += 90;
  }

  if (asset.license === 'CC0') score += 5;
  return score;
}

function resolveCatalogAsset(indexData, userDataDir, slot, spec, phenotype, fallbackFilter = null) {
  const assets = indexData.assets || [];
  if (!spec) return null;

  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const specStr = typeof spec === 'string' ? spec.trim() : String(spec.assetId || spec.id || '').trim();
  if (!specStr) return null;

  if (!specStr.startsWith('auto:')) {
    const exact = byId.get(specStr) || assets.find((a) => a.relPath === specStr || a.name.toLowerCase() === specStr.toLowerCase());
    if (!exact) {
      throw new Error(`Asset "${specStr}" for slot "${slot}" not found in mpfb-assets-index.json`);
    }
    return {
      ...exact,
      absPath: path.join(userDataDir, exact.relPath),
    };
  }

  const kwRaw = specStr.slice(5).trim().toLowerCase();
  const keywords = kwRaw.split(/[\s,;+|]+/).filter(Boolean);

  let pool = assets.filter((a) => {
    if (slot === 'eye') return a.slot === 'eyes';
    if (slot === 'skin') return a.slot === 'skin';
    if (slot === 'hair') return a.slot === 'hair';
    if (['top', 'bottom', 'suit', 'dress', 'shoes', 'hat', 'glasses', 'gloves', 'mask', 'equipment', 'bodyparts'].includes(slot)) {
      return a.slot === slot || a.slot === 'clothes';
    }
    return a.slot === slot;
  });
  if (fallbackFilter) {
    const narrowed = pool.filter(fallbackFilter);
    if (narrowed.length > 0) pool = narrowed;
  }
  if (pool.length === 0) {
    throw new Error(`No assets available in index for auto slot "${slot}" (${specStr})`);
  }

  pool.sort((a, b) => scoreAssetCandidate(b, slot, keywords, phenotype) - scoreAssetCandidate(a, slot, keywords, phenotype));
  const best = pool[0];
  return {
    ...best,
    absPath: path.join(userDataDir, best.relPath),
  };
}

function resolveRecipe(recipePath, scope, indexData, userDataDir) {
  const raw = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  const charId = raw.charId || path.basename(recipePath, '.json');
  const phenotype = raw.phenotype || {};
  const assetsUsed = [];

  // 1. Resolve skin
  const skinSpec = raw.skin?.assetId || (phenotype.gender >= 0.7 ? 'auto:young caucasian male' : 'auto:young caucasian female');
  let resolvedSkin = null;
  try {
    resolvedSkin = resolveCatalogAsset(indexData, userDataDir, 'skin', skinSpec, phenotype);
  } catch {
    const anySkin = indexData.assets.find((a) => a.slot === 'skin');
    if (anySkin) resolvedSkin = { ...anySkin, absPath: path.join(userDataDir, anySkin.relPath) };
  }
  if (resolvedSkin) assetsUsed.push(toAttributionEntry(resolvedSkin, charId));

  // 2. Resolve eyes (prefer low-poly)
  const eyeSpec = raw.eye?.assetId || 'eyes/low-poly';
  let resolvedEye = null;
  try {
    resolvedEye = resolveCatalogAsset(indexData, userDataDir, 'eye', eyeSpec, phenotype);
  } catch {
    const fallbackEye = indexData.assets.find((a) => a.slot === 'eyes');
    if (fallbackEye) resolvedEye = { ...fallbackEye, absPath: path.join(userDataDir, fallbackEye.relPath) };
  }
  if (resolvedEye) assetsUsed.push(toAttributionEntry(resolvedEye, charId));

  // 3. Resolve wardrobe
  const wardrobe = raw.wardrobe || {};
  const wardrobeItems = [];
  const slotOrder = ['hair', 'dress', 'suit', 'top', 'bottom', 'shoes', 'gloves', 'hat', 'glasses', 'mask', 'equipment', 'bodyparts'];
  for (const slot of slotOrder) {
    const entry = wardrobe[slot];
    if (!entry) continue;
    const picked = resolveCatalogAsset(indexData, userDataDir, slot, entry, phenotype);
    const recolor = typeof entry === 'object' ? { ...(entry.recolor || {}) } : {};
    if (typeof entry === 'object' && entry.color && !recolor.color) {
      recolor.color = entry.color;
    }
    if (recolor.customTexture) {
      const cand1 = path.resolve(path.dirname(recipePath), recolor.customTexture);
      const cand2 = path.resolve(REPO_ROOT, 'char_recipes', recolor.customTexture);
      const cand3 = path.resolve(REPO_ROOT, recolor.customTexture);
      recolor.resolvedCustomTexture = [cand1, cand2, cand3].find((p) => fs.existsSync(p)) || '';
    }
    wardrobeItems.push({
      slot,
      assetId: picked.assetId,
      resolvedPath: picked.absPath,
      license: picked.license,
      author: picked.author,
      pack: picked.pack,
      recolor,
    });
    assetsUsed.push(toAttributionEntry(picked, charId));
  }

  return {
    charId,
    webassetId: toWebAssetId(raw.webassetId || charId),
    name: raw.name || charId,
    scope,
    stylePreset: raw.stylePreset || 'stylized_clean',
    phenotype,
    faceTweaks: raw.faceTweaks || {},
    skin: {
      ...(raw.skin || {}),
      resolvedPath: resolvedSkin?.absPath || '',
      assetId: resolvedSkin?.assetId || '',
    },
    eye: {
      ...(raw.eye || {}),
      resolvedPath: resolvedEye?.absPath || '',
      assetId: resolvedEye?.assetId || '',
    },
    lod: raw.lod || {},
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    wardrobeItems,
    assetsUsed,
  };
}

function toAttributionEntry(asset, charId) {
  return {
    assetId: asset.assetId,
    name: asset.name,
    slot: asset.slot,
    pack: asset.pack,
    license: asset.license || 'CC0',
    author: asset.author || '',
    charId,
  };
}

function computeRecipeSha1(resolvedPayload, builderScriptSha1) {
  const h = crypto.createHash('sha1');
  h.update(builderScriptSha1);
  h.update(JSON.stringify(resolvedPayload));
  for (const w of resolvedPayload.wardrobeItems) {
    if (w.recolor?.resolvedCustomTexture && fs.existsSync(w.recolor.resolvedCustomTexture)) {
      h.update(sha1File(w.recolor.resolvedCustomTexture));
    }
  }
  return h.digest('hex');
}

function checkOutputsExist(outDir, charId) {
  const req = ['lod0.glb', 'lod1.glb', 'lod2.glb', 'lod3.glb', 'lod3_atlas.png', `${charId}_packed.glb`, 'meta.json'];
  return req.every((f) => fs.existsSync(path.join(outDir, f)));
}

function writeAttributions(builtRoot, allMetas) {
  const byAsset = new Map();
  for (const m of allMetas) {
    for (const a of m.assetsUsed || []) {
      if (String(a.license || '').toUpperCase() !== 'CC-BY') continue;
      if (!byAsset.has(a.assetId)) {
        byAsset.set(a.assetId, {
          assetId: a.assetId,
          name: a.name || a.assetId,
          author: a.author || 'MakeHuman Community',
          pack: a.pack || 'unknown',
          license: 'CC-BY',
          chars: new Set(),
        });
      }
      byAsset.get(a.assetId).chars.add(m.charId);
    }
  }

  const outPath = path.join(builtRoot, 'ATTRIBUTIONS.md');
  if (byAsset.size === 0) {
    fs.writeFileSync(outPath, '', 'utf8');
    return 0;
  }

  const lines = [
    '# Character Asset Attributions (CC-BY)',
    '',
    'This file is auto-generated by `scripts/build-mpfb-chars.mjs` for CC-BY assets used in `built/chars/`.',
    '',
  ];
  const sorted = [...byAsset.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  for (const item of sorted) {
    const chars = [...item.chars].sort().join(', ');
    lines.push(`- **${item.name}** (\`${item.assetId}\`, pack: \`${item.pack}\`) — Author: ${item.author} — License: ${item.license} (used by: ${chars})`);
  }
  lines.push('');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return sorted.length;
}

function collectAllBuiltMetas(builtRoot) {
  const metas = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name === 'meta.json') {
        try {
          metas.push(JSON.parse(fs.readFileSync(full, 'utf8')));
        } catch {}
      }
    }
  };
  walk(builtRoot);
  metas.sort((a, b) => a.charId.localeCompare(b.charId));
  return metas;
}

function registerWebAssets(builtRoot, metas) {
  const webRoot = path.join(REPO_ROOT, 'webasset');
  const charsDir = path.join(webRoot, 'assets', 'characters');
  const catalogJsonPath = path.join(charsDir, 'index.json');
  const dbPath = resolveDefaultDbPath(webRoot);
  const db = openAssetDb(dbPath);
  const registered = [];

  try {
    for (const meta of metas) {
      const charId = meta.charId;
      const webassetId = toWebAssetId(meta.webassetId || charId);
      const packedSrc = path.join(builtRoot, meta.scope || 'universal', charId, meta.lods?.packed || `${charId}_packed.glb`);
      if (!fs.existsSync(packedSrc)) continue;

      const modelDir = path.join(charsDir, webassetId, 'models');
      fs.mkdirSync(modelDir, { recursive: true });
      const modelFileName = `low-${webassetId}.glb`;
      const modelDest = path.join(modelDir, modelFileName);
      fs.copyFileSync(packedSrc, modelDest);
      const stat = fs.statSync(modelDest);
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(modelDest)).digest('hex');
      const relPath = `characters/${webassetId}/models/${modelFileName}`;

      if (!db.getCharacter(webassetId)) {
        db.insertCharacter({
          id: webassetId,
          name: meta.name || charId,
          gender: '',
          keywords: ['mpfb2', meta.stylePreset || 'stylized_clean', ...(meta.tags || [])].slice(0, 12),
          aliases: [charId],
          props: [meta.scope || 'universal'],
          personality: [],
        });
      }
      db.upsertCharacterModel(webassetId, 'low', {
        name: modelFileName,
        relPath,
        sha256,
        bytes: stat.size,
      });
      registered.push({ charId, webassetId, relPath });
    }

    fs.mkdirSync(path.dirname(catalogJsonPath), { recursive: true });
    fs.writeFileSync(catalogJsonPath, JSON.stringify(db.exportCharacterCatalogJson(), null, 2), 'utf8');
  } finally {
    db.close();
  }
  return registered;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = resolveModel3dConfig(REPO_ROOT);
  const blenderPath = cfg.blenderPath || 'blender';

  const indexPath = path.join(REPO_ROOT, 'built', 'char_parts', 'mpfb-assets-index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing ${indexPath}. Run: node scripts/setup-mpfb2.mjs`);
  }
  const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const userDataDir = path.join(REPO_ROOT, 'vendor', 'mpfb2', 'user_data');
  const builtRoot = path.join(REPO_ROOT, 'built', 'chars');
  fs.mkdirSync(builtRoot, { recursive: true });

  const cachePath = path.join(builtRoot, '.char_cache.json');
  let cache = {};
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
      cache = {};
    }
  }

  const pyScript = path.join(REPO_ROOT, 'scripts', 'blender', 'build_mpfb_char.py');
  const builderScriptSha1 = sha1String(
    sha1File(pyScript) + sha1File(path.join(REPO_ROOT, 'scripts', 'blender-model3d.py')),
  );
  const animRunPath = path.join(REPO_ROOT, 'assets', 'anim23', '_AnimDaily', 'MaleLocomotionSet', 'A_INP_RunFwd_Loop.glb');

  const recipes = collectRecipeFiles(opts);
  if (recipes.length === 0) {
    console.log('[build-mpfb-chars] No recipe JSON files found under char_recipes/.');
    return;
  }

  let builtCount = 0;
  let cachedCount = 0;

  for (const { filePath, scope } of recipes) {
    const resolved = resolveRecipe(filePath, scope, indexData, userDataDir);
    const charId = resolved.charId;
    const outDir = path.join(builtRoot, scope, charId);
    const recipeSha1 = computeRecipeSha1(resolved, builderScriptSha1);
    resolved.recipeSha1 = recipeSha1;

    const cacheKey = `${scope}/${charId}`;
    if (!opts.force && cache[cacheKey] === recipeSha1 && checkOutputsExist(outDir, charId)) {
      cachedCount++;
      console.log(`[build-mpfb-chars] [cached] ${cacheKey} (${recipeSha1.slice(0, 8)})`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const resolvedPath = path.join(outDir, '.recipe.resolved.json');
    fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2), 'utf8');

    console.log(`[build-mpfb-chars] Building ${cacheKey}...`);
    const bArgs = [
      '--background',
      '--python',
      pyScript,
      '--',
      '--recipe-resolved',
      resolvedPath,
      '--out-dir',
      outDir,
      '--user-data',
      userDataDir,
    ];
    if (fs.existsSync(animRunPath)) {
      bArgs.push('--anim-run', animRunPath);
    }
    const res = spawnSync(blenderPath, bArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    try {
      fs.unlinkSync(resolvedPath);
    } catch {}

    if (res.status !== 0) {
      throw new Error(`Blender build failed for ${cacheKey}:\n${res.stdout}\n${res.stderr}`);
    }
    const outLines = String(res.stdout || '')
      .split(/\r?\n/)
      .filter((l) => l.includes('[build_mpfb_char]'));
    for (const l of outLines) console.log(`  ${l}`);

    cache[cacheKey] = recipeSha1;
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    builtCount++;
  }

  const allMetas = collectAllBuiltMetas(builtRoot);
  const ccbyCount = writeAttributions(builtRoot, allMetas);

  let regMap = new Map();
  if (!opts.noWebasset) {
    const regList = registerWebAssets(builtRoot, allMetas);
    regMap = new Map(regList.map((r) => [r.charId, r]));
  }

  const aiIndex = {
    schemaVersion: 1,
    totalCharacters: allMetas.length,
    ccByAttributions: ccbyCount,
    characters: allMetas.map((m) => {
      const reg = regMap.get(m.charId);
      const relBase = `built/chars/${m.scope}/${m.charId}`;
      return {
        charId: m.charId,
        webassetId: toWebAssetId(m.webassetId || m.charId),
        name: m.name,
        scope: m.scope,
        stylePreset: m.stylePreset,
        heightM: m.bounds?.heightM ?? m.targetHeightM,
        bones: m.bones?.bones || [],
        boneCount: m.bones?.boneCount || 0,
        lods: {
          lod0: `${relBase}/lod0.glb`,
          lod1: `${relBase}/lod1.glb`,
          lod2: `${relBase}/lod2.glb`,
          lod3: `${relBase}/lod3.glb`,
          packed: `${relBase}/${m.lods?.packed || `${m.charId}_packed.glb`}`,
        },
        tris: {
          lod0: m.lods?.lod0?.tris || 0,
          lod1: m.lods?.lod1?.tris || 0,
          lod2: m.lods?.lod2?.tris || 0,
          lod3: m.lods?.lod3?.tris || 0,
        },
        webassetModelPath: reg?.relPath || `characters/${toWebAssetId(m.charId)}/models/low-${toWebAssetId(m.charId)}.glb`,
      };
    }),
  };
  fs.writeFileSync(path.join(builtRoot, 'char-ai-index.json'), JSON.stringify(aiIndex, null, 2), 'utf8');

  console.log(
    `[build-mpfb-chars] Complete: built=${builtCount}, cached=${cachedCount}, totalIndexed=${allMetas.length}, ccByAttributions=${ccbyCount}`,
  );
}

main().catch((err) => {
  console.error('[build-mpfb-chars] ERROR:', err.message);
  process.exit(1);
});

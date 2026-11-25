#!/usr/bin/env node
/**
 * Batch exporter for all Piloto Studio FX packs into WebAsset `webasset/assets/vfx/`.
 * - Uses authoritative Unity BatchMode `.glb` meshes (`unity-vfx-oracle.mjs`) and `mesh_index.json` / `unity-mesh-manifest.json`.
 * - Converts every ParticleSystem prefab via `convertUnityPrefab` (passing cached `guidMap` & `meshManifest`).
 * - Packs per-pack textures (deduplicated by MD5) into `packs/<pack_slug>/atlas.png` + `atlas.json` (or skips via `--skip-atlas`).
 * - Supports `--packs`, `--all`, `--skip-atlas`, `--refresh-flagship-bench`, `--rebuild-meshes`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { convertUnityPrefab } from './import-unity-vfx.mjs';
import { runUnityVfxOracle } from './unity-vfx-oracle.mjs';
import { validateVfxRecipe } from '../assets/runtime/vfx/vfx-recipes.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'webasset/assets/vfx');

const BUILTIN_MESH_KEYS = new Set(['quad', 'cube', 'sphere', 'cylinder', 'crystal', 'conesmall_tophat']);

function resolveDefaultUnityRoot() {
  if (process.env.HGAME_PILOTO_ROOT) return process.env.HGAME_PILOTO_ROOT;
  const localCfg = path.join(REPO_ROOT, '.hgame.local.json');
  if (fs.existsSync(localCfg)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
      if (cfg.unityVfx?.pilotoRoot) return cfg.unityVfx.pilotoRoot;
    } catch {
      // ignore malformed local config
    }
  }
  return '';
}

function normKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function buildGuidIndexOnce(dir, rootDir, map = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) buildGuidIndexOnce(full, rootDir, map);
    else if (entry.name.endsWith('.meta')) {
      const txt = fs.readFileSync(full, 'utf8');
      const g = txt.match(/^guid:\s*([0-9a-f]+)/m);
      if (g) {
        const assetPath = full.slice(0, -5);
        const alphaUsage = Number((txt.match(/^\s*alphaUsage:\s*(\d+)/m) || [])[1] ?? 1);
        const alphaIsTransparency = /alphaIsTransparency:\s*1/.test(txt);
        const wrapU = Number((txt.match(/^\s*wrapU:\s*(-?\d+)/m) || [])[1] ?? 0) === 1;
        const wrapV = Number((txt.match(/^\s*wrapV:\s*(-?\d+)/m) || [])[1] ?? 0) === 1;
        const srgb = Number((txt.match(/^\s*sRGBTexture:\s*(\d+)/m) || [])[1] ?? 1) === 1;
        const globalScale = Number((txt.match(/^\s*globalScale:\s*([-\d.eE+]+)/m) || [])[1] ?? 1);
        map.set(g[1], {
          relPath: path.relative(rootDir, assetPath).replace(/\\/g, '/'),
          fullPath: assetPath,
          fromGrayScale: alphaUsage === 2,
          alphaIsTransparency,
          wrapU,
          wrapV,
          srgb,
          globalScale: Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1,
        });
      }
    }
  }
  return map;
}

function resolveBaseMeshKey(meshName, knownMeshKeys) {
  if (!meshName || BUILTIN_MESH_KEYS.has(meshName)) return null;
  const splitBase = meshName.split('__')[0];
  if (knownMeshKeys.has(splitBase)) return splitBase;
  let bestMatch = null;
  for (const k of knownMeshKeys) {
    if (meshName === k || meshName.startsWith(`${k}_`) || meshName.startsWith(`${k}__`)) {
      if (!bestMatch || k.length > bestMatch.length) bestMatch = k;
    }
  }
  return bestMatch || splitBase;
}

function collectRecipeMeshes(layers, outAliases, fallbackCounts, knownMeshKeys) {
  if (!Array.isArray(layers)) return;
  for (const l of layers) {
    const candidates = [];
    if (l.mesh) candidates.push(l.mesh);
    if (Array.isArray(l.meshes)) {
      for (const item of l.meshes) {
        if (typeof item === 'string') candidates.push(item);
        else if (item?.mesh) candidates.push(item.mesh);
      }
    }
    if (l.shape?.mesh) candidates.push(l.shape.mesh);
    for (const m of candidates) {
      if (typeof m !== 'string' || !m || BUILTIN_MESH_KEYS.has(m)) continue;
      const base = resolveBaseMeshKey(m, knownMeshKeys);
      if (!base) continue;
      outAliases[m] = base;
      fallbackCounts.meshRefs.add(base);
    }
    if (Array.isArray(l.subEmitters)) {
      for (const se of l.subEmitters) {
        if (se?.effect?.layers) collectRecipeMeshes(se.effect.layers, outAliases, fallbackCounts, knownMeshKeys);
      }
    }
  }
}

function packAtlasWithPython(atlasPngPath, atlasJsonPath, jobs, initialCap = 256) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piloto-pack-atlas-'));
  try {
    const cfgPath = path.join(tmpDir, 'cfg.json');
    const pyPath = path.join(tmpDir, 'pack.py');
    fs.writeFileSync(cfgPath, JSON.stringify({
      atlasPng: atlasPngPath,
      atlasJson: atlasJsonPath,
      width: 4096,
      height: 4096,
      initialCap,
      jobs,
    }), 'utf8');
    fs.writeFileSync(pyPath, [
      'import json, sys',
      'from PIL import Image',
      'cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))',
      'W, H = cfg["width"], cfg["height"]',
      'pad = 4',
      'caps = [512, 256, 128, 64] if cfg.get("initialCap", 256) >= 512 else [256, 128, 64]',
      'loaded = []',
      'warnings = []',
      'for job in cfg["jobs"]:',
      '    if job.get("synthetic") == "white":',
      '        im = Image.new("RGBA", (16, 16), (255, 255, 255, 255))',
      '    else:',
      '        try:',
      '            im = Image.open(job["fullPath"])',
      '            if im.mode in ("I;16", "I;16L", "I;16B", "I"):',
      '                im = im.point(lambda v: v * (1.0 / 257.0)).convert("L")',
      '            if im.mode == "L":',
      '                im = Image.merge("RGBA", (im, im, im, im))',
      '            else:',
      '                im = im.convert("RGBA")',
      '            if job.get("fromGrayScale"):',
      '                r, g, b, _ = im.split()',
      '                im = Image.merge("RGBA", (r, g, b, r))',
      '        except Exception as exc:',
      '            warnings.append(f"fallback {job[\'key\']}: {exc}")',
      '            im = Image.new("RGBA", (16, 16), (255, 255, 255, 255))',
      '    loaded.append((job["key"], im))',
      '',
      'def try_pack(cap_limit):',
      '    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))',
      '    regions = {}',
      '    cur_x, cur_y, row_h = 0, 0, 0',
      '    for key, orig_im in loaded:',
      '        ow, oh = orig_im.size',
      '        sc = min(1.0, cap_limit / max(1, max(ow, oh)))',
      '        tw = max(1, int(round(ow * sc)))',
      '        th = max(1, int(round(oh * sc)))',
      '        bw = tw + pad * 2',
      '        bh = th + pad * 2',
      '        if cur_x + bw > W:',
      '            cur_x = 0',
      '            cur_y += row_h',
      '            row_h = 0',
      '        if cur_y + bh > H:',
      '            return None',
      '        im = orig_im.resize((tw, th), Image.Resampling.LANCZOS) if (tw, th) != (ow, oh) else orig_im',
      '        px, py = cur_x + pad, cur_y + pad',
      '        atlas.paste(im, (px, py))',
      '        top_s = im.crop((0, 0, tw, 1))',
      '        bot_s = im.crop((0, th - 1, tw, th))',
      '        left_s = im.crop((0, 0, 1, th))',
      '        right_s = im.crop((tw - 1, 0, tw, th))',
      '        for k in range(1, pad + 1):',
      '            atlas.paste(top_s, (px, py - k))',
      '            atlas.paste(bot_s, (px, py + th - 1 + k))',
      '            atlas.paste(left_s, (px - k, py))',
      '            atlas.paste(right_s, (px + tw - 1 + k, py))',
      '        regions[key] = [round(px / W, 6), round(py / H, 6), round((px + tw) / W, 6), round((py + th) / H, 6)]',
      '        cur_x += bw',
      '        if bh > row_h:',
      '            row_h = bh',
      '    return atlas, regions, cap_limit',
      '',
      'res = None',
      'for cap in caps:',
      '    res = try_pack(cap)',
      '    if res is not None:',
      '        break',
      'if res is None:',
      '    raise RuntimeError("Atlas overflowed 4096x4096 even at cap=64")',
      'atlas_im, regions, used_cap = res',
      'atlas_im.save(cfg["atlasPng"], optimize=True)',
      'json.dump({"width": W, "height": H, "regions": regions}, open(cfg["atlasJson"], "w", encoding="utf-8"), indent=2)',
      'print(json.dumps({"packed": len(regions), "usedCap": used_cap, "warnings": warnings}))',
    ].join('\n'), 'utf8');
    const stdout = execFileSync('python', [pyPath, cfgPath], { encoding: 'utf8' });
    return JSON.parse(stdout.trim());
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadMeshManifest(explicitPath = '') {
  const candidates = [
    explicitPath,
    path.join(os.tmpdir(), 'hgame-unity-vfx-oracle', 'unity-mesh-manifest.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    }
  }
  return null;
}

function recordTexDep(dep, texByKey, md5Cache, texCollisions) {
  const key = normKey(path.basename(dep.relPath, path.extname(dep.relPath)));
  const getMd5 = (fp) => {
    if (!md5Cache.has(fp)) {
      md5Cache.set(fp, fs.existsSync(fp) ? crypto.createHash('md5').update(fs.readFileSync(fp)).digest('hex') : 'missing');
    }
    return md5Cache.get(fp);
  };
  if (texByKey.has(key)) {
    const prev = texByKey.get(key);
    if (prev.relPath !== dep.relPath && getMd5(prev.fullPath) !== getMd5(dep.fullPath)) {
      texCollisions.push({ key, first: prev.relPath, second: dep.relPath });
    }
  } else {
    texByKey.set(key, { key, relPath: dep.relPath, fullPath: dep.fullPath, fromGrayScale: Boolean(dep.fromGrayScale) });
  }
}

function ensurePackAtlas(atlasPngPath, atlasJsonPath, texByKey, skipAtlas) {
  let needsPack = !skipAtlas || !fs.existsSync(atlasPngPath) || !fs.existsSync(atlasJsonPath);
  if (!needsPack) {
    try {
      const meta = JSON.parse(fs.readFileSync(atlasJsonPath, 'utf8'));
      const regions = meta?.regions || {};
      for (const k of texByKey.keys()) {
        if (!regions[k]) {
          needsPack = true;
          break;
        }
      }
    } catch {
      needsPack = true;
    }
  }
  if (!needsPack) return { packed: 0, usedCap: 0, warnings: [] };
  const texJobs = [...texByKey.values()];
  if (!texByKey.has('white')) {
    texJobs.push({ key: 'white', synthetic: 'white' });
  }
  return packAtlasWithPython(atlasPngPath, atlasJsonPath, texJobs, texJobs.length <= 44 ? 512 : 256);
}

export function exportPilotoPacks({
  packNames = [],
  exportAll = false,
  refreshFlagshipBench = false,
  skipAtlas = false,
  unityRoot = resolveDefaultUnityRoot(),
  outDir = DEFAULT_OUT_DIR,
  rebuildMeshes = false,
  meshManifestPath = '',
} = {}) {
  if (!unityRoot || !fs.existsSync(unityRoot)) {
    throw new Error(`Piloto Studio root not found. Configure .hgame.local.json (unityVfx.pilotoRoot), HGAME_PILOTO_ROOT, or --unity. Resolved: "${unityRoot}"`);
  }

  const bundleDir = path.join(unityRoot, 'Super Realistic FX Bundle');
  const meshDir = path.join(outDir, 'meshes');
  const meshIndexPath = path.join(meshDir, 'mesh_index.json');
  const packsRoot = path.join(outDir, 'packs');
  const packsIndexPath = path.join(packsRoot, 'packs_index.json');

  fs.mkdirSync(meshDir, { recursive: true });
  fs.mkdirSync(packsRoot, { recursive: true });

  if (rebuildMeshes || !fs.existsSync(meshIndexPath)) {
    runUnityVfxOracle({
      pilotoRoot: unityRoot,
      outDir,
      exportMeshes: true,
      runCalibration: false,
      runOracle: false,
    });
  }

  const meshIndex = fs.existsSync(meshIndexPath)
    ? JSON.parse(fs.readFileSync(meshIndexPath, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  const meshManifest = loadMeshManifest(meshManifestPath);
  const packsIndex = fs.existsSync(packsIndexPath)
    ? JSON.parse(fs.readFileSync(packsIndexPath, 'utf8').replace(/^\uFEFF/, ''))
    : { schemaVersion: 1, packs: [] };

  const sharedGuidMap = buildGuidIndexOnce(unityRoot, unityRoot);
  const md5Cache = new Map();

  const resolvedPackNames = exportAll
    ? fs.readdirSync(bundleDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : packNames;

  const report = [];

  for (const packName of resolvedPackNames) {
    const packSrcDir = path.join(bundleDir, packName);
    if (!fs.existsSync(packSrcDir)) {
      throw new Error(`Pack folder not found: ${packSrcDir}`);
    }
    const packSlug = normKey(packName);
    const packOutDir = path.join(packsRoot, packSlug);
    const recipesDir = path.join(packOutDir, 'recipes');
    fs.mkdirSync(recipesDir, { recursive: true });

    const allPrefabs = walkFiles(packSrcDir)
      .filter((f) => f.toLowerCase().endsWith('.prefab'))
      .sort((a, b) => a.localeCompare(b));

    const texByKey = new Map();
    const texCollisions = [];
    const meshAliases = {};
    const effects = [];
    const usedIds = new Set();
    const skipped = [];
    const refTracker = { meshRefs: new Set() };
    const packRecipes = [];

    for (const pf of allPrefabs) {
      const yaml = fs.readFileSync(pf, 'utf8');
      if (!yaml.includes('ParticleSystem:')) continue;

      const relToPack = path.relative(packSrcDir, pf);
      const isComplex = /complex/i.test(relToPack);
      const baseSlug = normKey(path.basename(pf, '.prefab'));
      const parentSlug = normKey(path.basename(path.dirname(pf)));
      let effId = baseSlug;
      if (usedIds.has(effId)) effId = `${parentSlug}_${baseSlug}`;
      let suffix = 2;
      while (usedIds.has(effId)) {
        effId = `${parentSlug}_${baseSlug}_${suffix++}`;
      }
      usedIds.add(effId);

      let converted;
      try {
        converted = convertUnityPrefab({
          unityRoot,
          prefabPath: pf,
          id: effId,
          meshManifest,
          guidMap: sharedGuidMap,
        });
      } catch (err) {
        skipped.push({ file: relToPack, error: err?.message || String(err) });
        continue;
      }

      const { recipe, dependencies } = converted;
      const check = validateVfxRecipe(recipe);
      if (!check.ok) {
        skipped.push({ file: relToPack, error: `Invalid recipe: ${check.errors.join('; ')}` });
        continue;
      }

      for (const dep of dependencies.textures.values()) {
        recordTexDep(dep, texByKey, md5Cache, texCollisions);
      }

      const recipeRel = `packs/${packSlug}/recipes/${effId}.vfx.json`;
      fs.writeFileSync(path.join(recipesDir, `${effId}.vfx.json`), JSON.stringify(recipe, null, 2) + '\n', 'utf8');
      packRecipes.push(recipe);

      effects.push({
        id: effId,
        name: path.basename(pf, '.prefab'),
        relSource: relToPack.replace(/\\/g, '/'),
        complex: isComplex,
        file: recipeRel,
        duration: recipe.duration,
        loop: Boolean(recipe.loop),
        layerCount: recipe.layers.length,
      });
    }

    effects.sort((a, b) => (Number(b.complex) - Number(a.complex)) || a.name.localeCompare(b.name));
    effects.forEach((e, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const tag = e.complex ? 'Complex' : `${e.layerCount} PS`;
      e.label = `${num} ${e.name} (${tag})`;
    });

    const knownMeshKeys = new Set(Object.keys(meshIndex));
    for (const recipe of packRecipes) {
      collectRecipeMeshes(recipe.layers, meshAliases, refTracker, knownMeshKeys);
    }

    const atlasPngPath = path.join(packOutDir, 'atlas.png');
    const atlasJsonPath = path.join(packOutDir, 'atlas.json');
    const atlasStats = ensurePackAtlas(atlasPngPath, atlasJsonPath, texByKey, skipAtlas);

    const packIndexObj = {
      id: packSlug,
      name: packName,
      atlasImage: `packs/${packSlug}/atlas.png`,
      atlasMeta: `packs/${packSlug}/atlas.json`,
      effects,
      meshAliases,
    };
    const packIndexRel = `packs/${packSlug}/pack_index.json`;
    fs.writeFileSync(path.join(packOutDir, 'pack_index.json'), JSON.stringify(packIndexObj, null, 2) + '\n', 'utf8');

    const packEntry = {
      id: packSlug,
      name: packName,
      effectCount: effects.length,
      manifestFile: packIndexRel,
    };
    const existingIdx = packsIndex.packs.findIndex((p) => p.id === packSlug);
    if (existingIdx >= 0) packsIndex.packs[existingIdx] = packEntry;
    else packsIndex.packs.push(packEntry);

    report.push({
      pack: packName,
      packSlug,
      effectsExported: effects.length,
      skipped,
      texturesPacked: atlasStats.packed,
      atlasMaxSpritePx: atlasStats.usedCap,
      atlasWarnings: atlasStats.warnings,
      texCollisions,
      meshesReferenced: Object.keys(meshAliases).length,
    });
  }

  if (refreshFlagshipBench) {
    const fsOutDir = path.join(packsRoot, 'flagship_bench');
    const fsIndexPath = path.join(fsOutDir, 'pack_index.json');
    const fsRecipesDir = path.join(fsOutDir, 'recipes');
    if (fs.existsSync(fsIndexPath)) {
      const fsIndex = JSON.parse(fs.readFileSync(fsIndexPath, 'utf8'));
      const bundlePrefabs = walkFiles(bundleDir).filter((f) => f.toLowerCase().endsWith('.prefab'));
      const prefabByNorm = new Map();
      for (const pf of bundlePrefabs) {
        const k = normKey(path.basename(pf, '.prefab'));
        if (!prefabByNorm.has(k)) prefabByNorm.set(k, pf);
      }
      const fsAliases = {};
      const fsRefTracker = { meshRefs: new Set() };
      const knownMeshKeys = new Set(Object.keys(meshIndex));
      const texByKey = new Map();
      const texCollisions = [];
      let refreshedCount = 0;

      for (const ef of fsIndex.effects || []) {
        const pf = prefabByNorm.get(normKey(ef.id)) || prefabByNorm.get(normKey(ef.name));
        if (!pf) continue;
        const { recipe, dependencies } = convertUnityPrefab({
          unityRoot,
          prefabPath: pf,
          id: ef.id,
          meshManifest,
          guidMap: sharedGuidMap,
        });
        fs.writeFileSync(path.join(fsRecipesDir, `${ef.id}.vfx.json`), JSON.stringify(recipe, null, 2) + '\n', 'utf8');
        ef.layerCount = recipe.layers.length;
        ef.duration = recipe.duration;
        ef.loop = Boolean(recipe.loop);
        collectRecipeMeshes(recipe.layers, fsAliases, fsRefTracker, knownMeshKeys);
        for (const dep of dependencies.textures.values()) {
          recordTexDep(dep, texByKey, md5Cache, texCollisions);
        }
        refreshedCount++;
      }

      fsIndex.meshAliases = fsAliases;
      const atlasPngPath = path.join(fsOutDir, 'atlas.png');
      const atlasJsonPath = path.join(fsOutDir, 'atlas.json');
      const atlasStats = ensurePackAtlas(atlasPngPath, atlasJsonPath, texByKey, skipAtlas);
      fs.writeFileSync(fsIndexPath, JSON.stringify(fsIndex, null, 2) + '\n', 'utf8');
      report.push({
        pack: 'Piloto Flagship Bench',
        packSlug: 'flagship_bench',
        effectsExported: refreshedCount,
        skipped: [],
        texturesPacked: atlasStats.packed,
        atlasMaxSpritePx: atlasStats.usedCap,
        atlasWarnings: atlasStats.warnings,
        texCollisions,
        meshesReferenced: Object.keys(fsAliases).length,
      });
    }
  }

  fs.writeFileSync(packsIndexPath, JSON.stringify(packsIndex, null, 2) + '\n', 'utf8');

  return {
    totalGlbs: Object.keys(meshIndex).length,
    totalPacks: packsIndex.packs.length,
    report,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  let packsArg = '';
  let exportAll = false;
  let refreshFlagshipBench = false;
  let skipAtlas = false;
  let unityRoot = resolveDefaultUnityRoot();
  let outDir = DEFAULT_OUT_DIR;
  let rebuildMeshes = false;
  let meshManifestPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--packs' && args[i + 1]) packsArg = args[++i];
    else if (args[i] === '--pack' && args[i + 1]) packsArg = args[++i];
    else if (args[i] === '--all') exportAll = true;
    else if (args[i] === '--refresh-flagship-bench') refreshFlagshipBench = true;
    else if (args[i] === '--skip-atlas') skipAtlas = true;
    else if (args[i] === '--unity' && args[i + 1]) unityRoot = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outDir = args[++i];
    else if (args[i] === '--manifest' && args[i + 1]) meshManifestPath = args[++i];
    else if (args[i] === '--rebuild-meshes') rebuildMeshes = true;
  }
  const packNames = packsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (!exportAll && !refreshFlagshipBench && packNames.length === 0) {
    console.error('Usage: node scripts/export-piloto-pack.mjs (--all | --packs "Pack 1,Pack 2") [--refresh-flagship-bench] [--skip-atlas] [--unity <dir>] [--out <dir>] [--manifest <file>] [--rebuild-meshes]');
    process.exit(1);
  }
  const res = exportPilotoPacks({
    packNames,
    exportAll,
    refreshFlagshipBench,
    skipAtlas,
    unityRoot,
    outDir,
    rebuildMeshes,
    meshManifestPath,
  });
  console.log(JSON.stringify(res, null, 2));
}

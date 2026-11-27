#!/usr/bin/env node
/**
 * Generic Unity ParticleSystem Bundle -> HGame WebAsset VFX Pack exporter.
 *
 * Works with any Unity VFX asset folder (e.g. Epic Toon FX, Piloto Studio, custom packs):
 * - Exports `.fbx`/`.obj`/`.asset` meshes via Unity BatchMode (`runUnityVfxOracle` with `mergeMeshIndex: true`)
 *   so existing `mesh_index.json` entries from other bundles are preserved.
 * - Groups prefabs into isolated sub-packs (`--group-depth`, default 1) so each sub-pack has
 *   its own `atlas.png` + `atlas.json` + `pack_index.json` + `recipes/*.vfx.json`.
 * - Upserts bundle/pack metadata non-destructively into `webasset/assets/vfx/packs/packs_index.json`.
 *
 * Usage:
 *   node scripts/export-vfx-bundle.mjs --root "D:/UnityWorkspace/AssetTest/Assets/Epic Toon FX" --bundle-id epic_toon_fx --bundle-name "Epic Toon FX"
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
const BUILTIN_MESH_KEYS = new Set([
  'quad',
  'cube',
  'sphere',
  'hemisphere',
  'ring',
  'disc',
  'cone',
  'cylinder',
  'crystal',
  'conesmall_tophat',
]);
const DEMO_DIR_RE = /^(?:demo|demos|example|examples)$/i;

function countActiveEnabledPsInPrefab(yamlText) {
  const docs = String(yamlText || '').split(/^--- !u!/m).slice(1);
  const activeGo = new Set();
  for (const d of docs) {
    const nl = d.indexOf('\n');
    const [cls, fidPart] = d.slice(0, nl).trim().split(/\s+/);
    if (cls === '1') {
      const fid = fidPart.replace('&', '');
      if (!/^\s*m_IsActive:\s*0\b/m.test(d)) activeGo.add(fid);
    }
  }
  const activeSubTargets = new Set();
  const inactiveSubTargets = new Set();
  for (const d of docs) {
    if (!d.startsWith('198 ')) continue;
    const goId = d.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/)?.[1];
    const sub = d.match(/(?:^|\n)  SubModule:\r?\n([\s\S]*?)(?=\n  [A-Za-z_][A-Za-z0-9_]*:|$)/)?.[1] || '';
    if (!/^\s*enabled:\s*1\b/m.test(sub)) continue;
    const targetSet = goId && activeGo.has(goId) ? activeSubTargets : inactiveSubTargets;
    for (const em of sub.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}/g)) {
      if (em[1] !== '0') targetSet.add(em[1]);
    }
  }
  let count = 0;
  for (const d of docs) {
    if (!d.startsWith('198 ')) continue;
    const nl = d.indexOf('\n');
    const fid = d.slice(0, nl).trim().split(/\s+/)[1]?.replace('&', '');
    if (inactiveSubTargets.has(fid) && !activeSubTargets.has(fid)) continue;
    const goId = d.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/)?.[1];
    if (!goId || !activeGo.has(goId)) continue;
    const em = d.match(/(?:^|\n)  EmissionModule:\r?\n([\s\S]*?)(?=\n  [A-Za-z_][A-Za-z0-9_]*:|$)/)?.[1] || '';
    if (/^\s*enabled:\s*0\b/m.test(em)) continue;
    count += 1;
  }
  return count;
}

function countTotalRecipeLayers(recipe) {
  let total = 0;
  const walkLayers = (layers) => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) {
      total += 1;
      if (Array.isArray(l.subEmitters)) {
        for (const se of l.subEmitters) walkLayers(se?.effect?.layers);
      }
    }
  };
  walkLayers(recipe?.layers);
  return total;
}

/**
 * 5-invariant Parity Audit Gate for an exported VFX pack.
 */
export function auditVfxPackParity({
  prefabYamlById = null,
  recipes = [],
  atlasRegions = null,
  meshIndex = null,
  meshAliases = null,
} = {}) {
  const droppedPs = [];
  const missingAtlas = [];
  const missingMeshes = [];
  const staleBlends = [];
  const routingMismatches = [];

  const knownMeshKeys = new Set(Object.keys(meshIndex || {}));
  const regionMap = atlasRegions && Object.keys(atlasRegions).length > 0 ? atlasRegions : null;

  for (const recipe of recipes) {
    const eid = recipe?.id || 'unknown';
    const prefabYaml = prefabYamlById?.get ? prefabYamlById.get(eid) : prefabYamlById?.[eid];
    if (typeof prefabYaml === 'string') {
      const psCount = countActiveEnabledPsInPrefab(prefabYaml);
      const layerCount = countTotalRecipeLayers(recipe);
      if (layerCount < psCount) {
        droppedPs.push({ id: eid, psCount, layerCount });
      }
    }

    const inspectLayers = (layers) => {
      if (!Array.isArray(layers)) return;
      for (const l of layers) {
        if (regionMap) {
          const regKeys = [l.flipbook?.region, l.sprite, l.material?.mainTexKey].filter((k) => typeof k === 'string' && k.length > 0);
          for (const rk of regKeys) {
            if (!regionMap[rk]) {
              missingAtlas.push({ id: eid, layer: l.name || '-', region: rk });
            }
          }
        }

        if (l.renderMode === 'mesh' || l.kind === 'mesh') {
          const candidates = [];
          if (l.mesh) candidates.push(l.mesh);
          if (Array.isArray(l.meshes)) {
            for (const m of l.meshes) candidates.push(typeof m === 'string' ? m : m?.mesh);
          }
          for (const mk of candidates) {
            if (!mk || BUILTIN_MESH_KEYS.has(mk)) continue;
            const resolved = meshAliases?.[mk] || mk.split('__')[0];
            if (meshIndex && !knownMeshKeys.has(mk) && !knownMeshKeys.has(resolved)) {
              missingMeshes.push({ id: eid, layer: l.name || '-', mesh: mk });
            }
          }
        }

        const mat = l.material;
        if (mat && mat.surface === 1 && mat.srcBlend === 1 && mat.dstBlend === 0 && mat.depthWrite === true && l.opaque !== true) {
          staleBlends.push({ id: eid, layer: l.name || '-' });
        }

        const profile = l.shaderProfile || mat?.shaderProfile || null;
        const routesShuriken = !l.uberMat
          && l.trail?.mode !== 'ribbon'
          && !(Array.isArray(l.subEmitters) && l.subEmitters.length > 0)
          && profile !== 'unity_standard'
          && l.useShurikenKernel !== true
          && (Boolean(profile) || l.renderMode === 'none' || l.clampVelocity !== undefined || l.rotationBySpeed !== undefined || l.inheritVelocity !== undefined || l.size3D !== undefined || l.sizeZCurve !== undefined || l.sizeZ !== undefined || l.customData !== undefined || l.vertexStreams !== undefined);
        const hasUnsupportedFeature = Boolean(l.transformRot || l.unityMeshRot || l.collision || l.flip || l.particleLight);
        if (routesShuriken && hasUnsupportedFeature) {
          routingMismatches.push({ id: eid, layer: l.name || '-' });
        }

        if (Array.isArray(l.subEmitters)) {
          for (const se of l.subEmitters) inspectLayers(se?.effect?.layers);
        }
      }
    };
    inspectLayers(recipe?.layers);
  }

  return {
    ok: droppedPs.length === 0
      && missingAtlas.length === 0
      && missingMeshes.length === 0
      && staleBlends.length === 0
      && routingMismatches.length === 0,
    droppedPsCount: droppedPs.length,
    missingAtlasCount: missingAtlas.length,
    missingMeshCount: missingMeshes.length,
    staleBlendCount: staleBlends.length,
    routingMismatchCount: routingMismatches.length,
    samples: {
      droppedPs: droppedPs.slice(0, 5),
      missingAtlas: missingAtlas.slice(0, 5),
      missingMeshes: missingMeshes.slice(0, 5),
      staleBlends: staleBlends.slice(0, 5),
      routingMismatches: routingMismatches.slice(0, 5),
    },
  };
}

function normKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function walkFiles(dir, { includeDemo = false } = {}, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!includeDemo && DEMO_DIR_RE.test(entry.name)) continue;
      walkFiles(full, { includeDemo }, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function buildGuidIndexOnce(dir, rootDir, map = new Map()) {
  if (!fs.existsSync(dir)) return map;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      buildGuidIndexOnce(full, rootDir, map);
    } else if (entry.name.endsWith('.meta')) {
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-bundle-atlas-'));
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

function resolvePrefabsDir(rootDir, explicitRel = '') {
  if (explicitRel) {
    const candidate = path.isAbsolute(explicitRel) ? explicitRel : path.join(rootDir, explicitRel);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Prefabs directory not found: ${candidate}`);
    }
    return candidate;
  }
  for (const rel of ['Prefabs', 'Super Realistic FX Bundle']) {
    const candidate = path.join(rootDir, rel);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return rootDir;
}

export function exportVfxBundle({
  rootDir,
  bundleId = '',
  bundleName = '',
  prefabsDirRel = '',
  groupDepth = 1,
  outDir = DEFAULT_OUT_DIR,
  skipMeshes = false,
  rebuildMeshes = false,
  skipAtlas = false,
  prefabFilter = '',
  includeDemo = false,
  meshManifestPath = '',
} = {}) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new Error(`Unity VFX bundle root not found: "${rootDir}"`);
  }
  const absRoot = path.resolve(rootDir);
  const resolvedBundleName = (bundleName || path.basename(absRoot)).trim();
  const resolvedBundleId = normKey(bundleId || resolvedBundleName) || 'custom_vfx_bundle';
  const prefabsDir = resolvePrefabsDir(absRoot, prefabsDirRel);
  const depth = Math.max(0, Number.isFinite(Number(groupDepth)) ? Number(groupDepth) : 1);

  const meshDir = path.join(outDir, 'meshes');
  const meshIndexPath = path.join(meshDir, 'mesh_index.json');
  const packsRoot = path.join(outDir, 'packs');
  const packsIndexPath = path.join(packsRoot, 'packs_index.json');
  fs.mkdirSync(meshDir, { recursive: true });
  fs.mkdirSync(packsRoot, { recursive: true });

  const allRootFiles = walkFiles(absRoot, { includeDemo: true });
  const hasMeshAssets = allRootFiles.some((f) => /\.(fbx|obj|asset)$/i.test(f));
  const bundleWorkDir = path.join(os.tmpdir(), `hgame-unity-vfx-oracle-${resolvedBundleId}`);
  const defaultManifestPath = path.join(bundleWorkDir, 'unity-mesh-manifest.json');
  const resolvedManifestPath = meshManifestPath || defaultManifestPath;

  if (!skipMeshes && hasMeshAssets && (rebuildMeshes || !fs.existsSync(resolvedManifestPath))) {
    const assetFolderName = path.basename(absRoot);
    runUnityVfxOracle({
      assetRoot: absRoot,
      assetFolderName,
      bundleRootUnityPath: `Assets/${assetFolderName}`,
      mergeMeshIndex: true,
      workDir: bundleWorkDir,
      outDir,
      meshManifestPath: resolvedManifestPath,
      exportMeshes: true,
      runCalibration: false,
      runOracle: false,
    });
  }

  const meshIndex = fs.existsSync(meshIndexPath)
    ? JSON.parse(fs.readFileSync(meshIndexPath, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  const meshManifest = fs.existsSync(resolvedManifestPath)
    ? JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8').replace(/^\uFEFF/, ''))
    : null;
  const packsIndex = fs.existsSync(packsIndexPath)
    ? JSON.parse(fs.readFileSync(packsIndexPath, 'utf8').replace(/^\uFEFF/, ''))
    : { schemaVersion: 1, packs: [] };

  const sharedGuidMap = buildGuidIndexOnce(absRoot, absRoot);
  const md5Cache = new Map();

  const prefabFiles = walkFiles(prefabsDir, { includeDemo })
    .filter((f) => f.toLowerCase().endsWith('.prefab'))
    .sort((a, b) => a.localeCompare(b));

  const groups = new Map();
  for (const pf of prefabFiles) {
    const relToPrefabs = path.relative(prefabsDir, pf).replace(/\\/g, '/');
    const segments = relToPrefabs.split('/').filter(Boolean);
    const dirSegments = segments.slice(0, -1);
    const groupParts = depth > 0 ? dirSegments.slice(0, depth) : [];
    const groupLabel = groupParts.length > 0 ? groupParts.join(' / ') : 'General';
    const groupSlug = groupParts.length > 0 ? normKey(groupParts.join('_')) : 'general';
    const packSlug = depth === 0 ? resolvedBundleId : `${resolvedBundleId}__${groupSlug}`;
    if (!groups.has(packSlug)) {
      groups.set(packSlug, {
        packSlug,
        packName: depth === 0 ? resolvedBundleName : groupLabel,
        prefabs: [],
      });
    }
    groups.get(packSlug).prefabs.push({ pf, relToPrefabs, dirSegments });
  }

  const filterNorm = prefabFilter ? normKey(prefabFilter) : '';
  const filterLower = prefabFilter ? prefabFilter.trim().toLowerCase() : '';
  const knownMeshKeys = new Set(Object.keys(meshIndex));
  const report = [];

  for (const group of groups.values()) {
    const packOutDir = path.join(packsRoot, group.packSlug);
    const recipesDir = path.join(packOutDir, 'recipes');
    fs.mkdirSync(recipesDir, { recursive: true });

    const texByKey = new Map();
    const texCollisions = [];
    const packIndexPath = path.join(packOutDir, 'pack_index.json');
    const existingPackIndex = filterNorm && fs.existsSync(packIndexPath)
      ? JSON.parse(fs.readFileSync(packIndexPath, 'utf8').replace(/^\uFEFF/, ''))
      : null;
    const meshAliases = existingPackIndex?.meshAliases ? { ...existingPackIndex.meshAliases } : {};
    const effects = existingPackIndex?.effects ? existingPackIndex.effects.map((e) => ({ ...e })) : [];
    const usedIds = new Set();
    const skipped = [];
    const refTracker = { meshRefs: new Set() };
    const packRecipes = [];
    const prefabYamlById = new Map();
    let matchedCount = 0;

    for (const { pf, relToPrefabs, dirSegments } of group.prefabs) {
      const yaml = fs.readFileSync(pf, 'utf8');
      if (!yaml.includes('ParticleSystem:')) continue;

      const isComplex = /complex/i.test(relToPrefabs);
      const pfName = path.basename(pf, '.prefab');
      const baseSlug = normKey(pfName);
      const parentSlug = normKey(path.basename(path.dirname(pf)));
      let effId = baseSlug || 'vfx';
      if (usedIds.has(effId)) effId = `${parentSlug}_${baseSlug}`;
      let suffix = 2;
      while (usedIds.has(effId)) {
        effId = `${parentSlug}_${baseSlug}_${suffix++}`;
      }
      usedIds.add(effId);

      if (filterNorm) {
        const matches = pfName.toLowerCase() === filterLower || baseSlug === filterNorm || effId === filterNorm;
        if (!matches) continue;
        matchedCount += 1;
      }

      let converted;
      try {
        converted = convertUnityPrefab({
          unityRoot: absRoot,
          prefabPath: pf,
          id: effId,
          meshManifest,
          guidMap: sharedGuidMap,
        });
      } catch (err) {
        skipped.push({ file: relToPrefabs, error: err?.message || String(err) });
        continue;
      }

      const { recipe, dependencies } = converted;
      if (!recipe.layers || recipe.layers.length === 0) {
        skipped.push({ file: relToPrefabs, error: 'Empty recipe layers' });
        continue;
      }
      const check = validateVfxRecipe(recipe);
      if (!check.ok) {
        skipped.push({ file: relToPrefabs, error: `Invalid recipe: ${check.errors.join('; ')}` });
        continue;
      }

      for (const dep of dependencies.textures.values()) {
        recordTexDep(dep, texByKey, md5Cache, texCollisions);
      }

      const recipeRel = `packs/${group.packSlug}/recipes/${effId}.vfx.json`;
      fs.writeFileSync(path.join(recipesDir, `${effId}.vfx.json`), JSON.stringify(recipe, null, 2) + '\n', 'utf8');
      packRecipes.push(recipe);
      prefabYamlById.set(effId, yaml);

      const entryObj = {
        id: effId,
        name: pfName,
        relSource: relToPrefabs,
        categoryPath: dirSegments,
        complex: isComplex,
        file: recipeRel,
        duration: recipe.duration,
        loop: Boolean(recipe.loop),
        layerCount: recipe.layers.length,
      };
      if (filterNorm) {
        const idx = effects.findIndex((e) => e.id === effId);
        if (idx >= 0) {
          effects[idx] = { ...entryObj, label: effects[idx].label || '' };
        } else {
          effects.push(entryObj);
        }
      } else {
        effects.push(entryObj);
      }
    }

    if (effects.length === 0) {
      fs.rmSync(packOutDir, { recursive: true, force: true });
      continue;
    }

    effects.sort((a, b) => (Number(b.complex) - Number(a.complex)) || a.name.localeCompare(b.name));
    effects.forEach((e, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const tag = e.complex ? 'Complex' : `${e.layerCount} PS`;
      e.label = `${num} ${e.name} (${tag})`;
    });

    for (const recipe of packRecipes) {
      collectRecipeMeshes(recipe.layers, meshAliases, refTracker, knownMeshKeys);
    }

    const atlasPngPath = path.join(packOutDir, 'atlas.png');
    const atlasJsonPath = path.join(packOutDir, 'atlas.json');
    const atlasStats = ensurePackAtlas(atlasPngPath, atlasJsonPath, texByKey, skipAtlas);
    let packedRegions = null;
    if (fs.existsSync(atlasJsonPath)) {
      try {
        packedRegions = JSON.parse(fs.readFileSync(atlasJsonPath, 'utf8')).regions || null;
      } catch {
        packedRegions = null;
      }
    }
    const parity = auditVfxPackParity({
      prefabYamlById,
      recipes: packRecipes,
      atlasRegions: packedRegions,
      meshIndex,
      meshAliases,
    });

    const packIndexObj = {
      id: group.packSlug,
      name: group.packName,
      bundleId: resolvedBundleId,
      bundleName: resolvedBundleName,
      atlasImage: `packs/${group.packSlug}/atlas.png`,
      atlasMeta: `packs/${group.packSlug}/atlas.json`,
      effects,
      meshAliases,
    };
    const packIndexRel = `packs/${group.packSlug}/pack_index.json`;
    fs.writeFileSync(path.join(packOutDir, 'pack_index.json'), JSON.stringify(packIndexObj, null, 2) + '\n', 'utf8');

    const packEntry = {
      id: group.packSlug,
      name: group.packName,
      bundleId: resolvedBundleId,
      bundleName: resolvedBundleName,
      effectCount: effects.length,
      manifestFile: packIndexRel,
    };
    const existingIdx = packsIndex.packs.findIndex((p) => p.id === group.packSlug);
    if (existingIdx >= 0) packsIndex.packs[existingIdx] = packEntry;
    else packsIndex.packs.push(packEntry);

    report.push({
      pack: group.packName,
      packSlug: group.packSlug,
      effectsExported: filterNorm ? matchedCount : effects.length,
      skippedCount: skipped.length,
      skippedSample: skipped.slice(0, 5),
      texturesPacked: atlasStats.packed,
      atlasMaxSpritePx: atlasStats.usedCap,
      atlasWarnings: atlasStats.warnings,
      texCollisionsCount: texCollisions.length,
      meshesReferenced: Object.keys(meshAliases).length,
      parity,
    });
  }

  fs.writeFileSync(packsIndexPath, JSON.stringify(packsIndex, null, 2) + '\n', 'utf8');
  return {
    bundleId: resolvedBundleId,
    bundleName: resolvedBundleName,
    totalGlbs: Object.keys(meshIndex).length,
    totalPacks: packsIndex.packs.length,
    parityOk: report.every((r) => r.parity?.ok !== false),
    report,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  let rootDir = '';
  let bundleId = '';
  let bundleName = '';
  let prefabsDirRel = '';
  let groupDepth = 1;
  let outDir = DEFAULT_OUT_DIR;
  let skipMeshes = false;
  let rebuildMeshes = false;
  let skipAtlas = false;
  let prefabFilter = '';
  let includeDemo = false;
  let meshManifestPath = '';
  let strict = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root' && args[i + 1]) rootDir = args[++i];
    else if (a === '--bundle-id' && args[i + 1]) bundleId = args[++i];
    else if (a === '--bundle-name' && args[i + 1]) bundleName = args[++i];
    else if (a === '--prefabs-dir' && args[i + 1]) prefabsDirRel = args[++i];
    else if (a === '--group-depth' && args[i + 1]) groupDepth = Number(args[++i]);
    else if (a === '--out' && args[i + 1]) outDir = path.resolve(args[++i]);
    else if (a === '--skip-meshes') skipMeshes = true;
    else if (a === '--rebuild-meshes') rebuildMeshes = true;
    else if (a === '--skip-atlas') skipAtlas = true;
    else if (a === '--prefab' && args[i + 1]) prefabFilter = args[++i];
    else if (a === '--include-demo') includeDemo = true;
    else if (a === '--manifest' && args[i + 1]) meshManifestPath = args[++i];
    else if (a === '--strict') strict = true;
  }
  if (!rootDir) {
    console.error('Usage: node scripts/export-vfx-bundle.mjs --root <UnityAssetDir> [--bundle-id <slug>] [--bundle-name <name>] [--prefabs-dir <rel>] [--group-depth <n>] [--out <dir>] [--skip-meshes] [--rebuild-meshes] [--skip-atlas] [--prefab <name>] [--include-demo] [--strict]');
    process.exit(1);
  }
  const res = exportVfxBundle({
    rootDir,
    bundleId,
    bundleName,
    prefabsDirRel,
    groupDepth,
    outDir,
    skipMeshes,
    rebuildMeshes,
    skipAtlas,
    prefabFilter,
    includeDemo,
    meshManifestPath,
  });
  console.log(JSON.stringify(res, null, 2));
  if (strict && !res.parityOk) {
    process.exit(1);
  }
}

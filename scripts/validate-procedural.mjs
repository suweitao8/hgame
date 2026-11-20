#!/usr/bin/env node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pcgDir = path.join(root, 'src', 'modules', 'realistic-pcg');

const argv = process.argv.slice(2);
const dirIdx = argv.indexOf('--dir');
const explicitDir = dirIdx >= 0 ? argv[dirIdx + 1] : process.env.HGAME_PROCEDURAL_DIR;
const procDir = explicitDir ? path.resolve(explicitDir) : null;

function collectTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push({ path: path.relative(root, p).replaceAll('\\', '/'), content: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'hgame-pcg-val-'));
try {
  const bundlePath = path.join(tmpDir, 'pcg.mjs');
  await esbuild.build({
    entryPoints: [path.join(pcgDir, 'index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    alias: {
      three: path.join(root, 'assets', 'optional', 'three', 'three.module.js'),
      'three/examples/jsm': path.join(root, 'assets', 'optional', 'three', 'jsm'),
    },
    outfile: bundlePath,
  });

  const pcg = await import(pathToFileURL(bundlePath).href);
  const evalIssues = pcg.auditSourcesNoEval(collectTsFiles(pcgDir));
  const warnings = [];
  const errors = [...evalIssues];

  let matCount = 0;
  let meshCount = 0;

  if (procDir) {
    const manifestPath = path.join(procDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing manifest.json in ${procDir}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const materials = new Map();
    const meshes = new Map();

    for (const entry of manifest.materials) {
      const data = JSON.parse(readFileSync(path.join(procDir, entry.path), 'utf8'));
      materials.set(data.id, data);
    }
    for (const entry of manifest.meshes) {
      const data = JSON.parse(readFileSync(path.join(procDir, entry.path), 'utf8'));
      meshes.set(data.id, data);
    }

    matCount = materials.size;
    meshCount = meshes.size;

    const valResult = pcg.validateProceduralSet(manifest, materials, meshes);
    warnings.push(...valResult.warnings);
    errors.push(...valResult.errors);

    const matIdMap = new Map();
    let matIdx = 0;
    for (const [id, recipe] of materials.entries()) {
      matIdMap.set(id, matIdx++);
      const baked = pcg.evaluateMaterialGraphSync(recipe, 64);
      const roughContrast = baked.stats.maxRoughness - baked.stats.minRoughness;
      if (roughContrast < 0.02) {
        errors.push({
          severity: 'error',
          recipeId: id,
          path: 'outputs.roughness',
          message: `Roughness contrast (${roughContrast.toFixed(3)}) too flat; must have realistic surface variation`,
        });
      }
      const isNonMetal = typeof recipe.outputs.metalness === 'number' && recipe.outputs.metalness < 0.5;
      if (isNonMetal && (baked.stats.minLinearLuma < 0.039 || baked.stats.maxLinearLuma > 0.855)) {
        errors.push({
          severity: 'error',
          recipeId: id,
          path: 'outputs.albedo',
          message: `Baked linear luma [${baked.stats.minLinearLuma.toFixed(3)}, ${baked.stats.maxLinearLuma.toFixed(3)}] violates [0.04, 0.85]`,
        });
      }
    }

    for (const [id, recipe] of meshes.entries()) {
      const res = pcg.evaluateMeshRecipe(recipe, {
        recipes: meshes,
        resolveMaterialId: (name) => {
          if (!matIdMap.has(name)) throw new Error(`Unknown material "${name}"`);
          return matIdMap.get(name);
        },
      });
      const isComposite = recipe.parts.some((p) => p.op === 'ref');
      const budget = isComposite ? 25000 : 8000;
      if (res.triangleCount > budget) {
        warnings.push({
          severity: 'warning',
          recipeId: id,
          path: 'parts',
          message: `Triangle count (${res.triangleCount}) exceeds budget (${budget})`,
        });
      }
      for (const p of res.partTriangles) {
        if (p.triangles > 8000) {
          warnings.push({
            severity: 'warning',
            recipeId: id,
            path: p.id,
            message: `Part "${p.id}" triangle count (${p.triangles}) exceeds single-part budget (8000)`,
          });
        }
      }
      res.geometry.dispose();
    }
  }

  for (const w of warnings) {
    console.warn(`[WARN] (${w.recipeId}) ${w.path}: ${w.message}`);
  }
  for (const e of errors) {
    console.error(`[ERROR] (${e.recipeId}) ${e.path}: ${e.message}`);
  }

  if (procDir) {
    console.log(
      `Procedural validation (${procDir}): ${matCount} materials, ${meshCount} meshes, ${errors.length} errors, ${warnings.length} warnings.`
    );
  } else {
    console.log(
      `Procedural runtime audit: zero-eval check passed (${errors.length} errors). Pass --dir <path> to validate an external/WebAsset procedural recipe library.`
    );
  }
  if (errors.length > 0) process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

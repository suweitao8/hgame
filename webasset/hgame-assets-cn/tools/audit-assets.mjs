import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPEC_PATH = path.join(ROOT, 'manifests', 'asset_spec.json');
const BUILT_MODELS_DIR = path.join(ROOT, 'built', 'models');
const REPORT_PATH = path.join(ROOT, 'built', 'audit_report.json');

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

async function walkGlbs(dir, out = []) {
  if (!existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkGlbs(full, out);
    else if (e.isFile() && e.name.endsWith('.glb')) out.push(full);
  }
  return out;
}

async function auditOneGlb(glbPath, spec, io) {
  const relPath = path.relative(path.join(ROOT, 'built'), glbPath).replaceAll('\\', '/');
  const metaPath = glbPath.replace(/\.glb$/i, '.meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : {};
  const doc = await io.read(glbPath);
  const rootExtras = doc.getRoot().getExtras() || {};
  const tierName = meta.tier || rootExtras.tier || 'T0';
  const tierCfg = spec.tiers[tierName];

  const errors = [];
  if (!tierCfg) {
    errors.push(`Unknown tier "${tierName}"`);
    return { path: relPath, id: meta.id || path.basename(glbPath, '.glb'), tier: tierName, status: 'FAIL', errors };
  }

  const forbiddenSet = new Set(spec.globalRules.forbiddenAttributes || []);
  const forbiddenFound = new Set();
  let missingTexcoord = false;
  const byLevel = new Map();

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() || '';
    const extras = node.getExtras() || {};
    const lvl =
      typeof extras.lodLevel === 'number'
        ? extras.lodLevel
        : name === 'mesh_lod1' || name.endsWith('_lod1')
          ? 1
          : name === 'mesh_lod2' || name.endsWith('_lod2')
            ? 2
            : 0;
    const acc = byLevel.get(lvl) || { tris: 0, gpuVerts: 0, submeshes: 0 };
    for (const prim of mesh.listPrimitives()) {
      acc.submeshes++;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (!prim.getAttribute('TEXCOORD_0')) missingTexcoord = true;
      const vCount = pos ? pos.getCount() : 0;
      acc.gpuVerts += vCount;
      acc.tris += idx ? idx.getCount() / 3 : vCount / 3;
      for (const sem of prim.listSemantics()) {
        if (forbiddenSet.has(sem)) forbiddenFound.add(sem);
      }
    }
    byLevel.set(lvl, acc);
  }

  const lod0 = byLevel.get(0) || { tris: 0, gpuVerts: 0, submeshes: 0 };
  const lod1 = byLevel.get(1);
  const lod2 = byLevel.get(2);
  lod0.tris = Math.round(lod0.tris);

  if (doc.getRoot().listSkins().length > 0) errors.push('Contains skeletal skin (strictly 3D static only)');
  if (lod0.submeshes === 0) errors.push('Missing LOD0 mesh');
  if (missingTexcoord) errors.push('Missing required TEXCOORD_0 UV attribute');
  if (lod0.tris > tierCfg.maxTris) errors.push(`LOD0 tris ${lod0.tris} > tier ${tierName} maxTris ${tierCfg.maxTris}`);
  if (lod0.gpuVerts > tierCfg.maxGpuVerts) errors.push(`LOD0 gpuVerts ${lod0.gpuVerts} > tier ${tierName} maxGpuVerts ${tierCfg.maxGpuVerts}`);
  if (lod0.submeshes > tierCfg.maxSubmeshes) errors.push(`LOD0 submeshes ${lod0.submeshes} > tier ${tierName} maxSubmeshes ${tierCfg.maxSubmeshes}`);
  if (forbiddenFound.size > 0) errors.push(`Forbidden attributes: ${[...forbiddenFound].join(', ')}`);

  for (const [lvl, st] of byLevel) {
    if (st.gpuVerts > spec.globalRules.maxGpuVertsHardCap) {
      errors.push(`LOD${lvl} gpuVerts ${st.gpuVerts} > 65535 hard cap`);
    }
  }

  const lodCfg = tierCfg.lod || {};
  const lod1MinTris = lodCfg.lod1MinTris || 0;
  if (lod1 && Math.round(lod1.tris) > lod0.tris) {
    errors.push(`LOD1 tris (${Math.round(lod1.tris)}) > LOD0 tris (${lod0.tris})`);
  }
  if ((tierName === 'T2' || tierName === 'T3' || tierName === 'T4') && lod0.tris >= lod1MinTris && !lod1) {
    errors.push(`Expected embedded mesh_lod1 for ${tierName} (LOD0 tris=${lod0.tris} >= ${lod1MinTris})`);
  }
  if (tierName === 'T4' && !lod2) {
    errors.push('T4 asset missing embedded mesh_lod2');
  }
  if (lod2 && lodCfg.lod2MergeSubmeshes && lod2.submeshes > 1) {
    errors.push(`T4 LOD2 must merge into 1 submesh (found ${lod2.submeshes})`);
  }
  if (meta.kind === 'tree' && tierName === 'T3') {
    if (!lod2 || Math.round(lod2.tris) > 4) {
      errors.push(`T3 tree must have 4-tri impostor mesh_lod2 (found ${lod2 ? Math.round(lod2.tris) : 'none'})`);
    }
  }

  const textures = doc.getRoot().listTextures();
  const hasImpostor = doc.getRoot().listMaterials().some((m) => (m.getExtras() || {}).isImpostor);
  const maxAllowedTex = (meta.hasComplexEmissive ? 3 : 2) + (hasImpostor ? 1 : 0);
  if (textures.length > maxAllowedTex) {
    errors.push(`Embedded texture count ${textures.length} > ${maxAllowedTex}`);
  }
  for (const tex of textures) {
    const buf = tex.getImage();
    if (!buf) continue;
    const m = await sharp(Buffer.from(buf)).metadata();
    if (!isPow2(m.width || 0) || !isPow2(m.height || 0)) {
      errors.push(`Non-power-of-2 texture "${tex.getName()}" (${m.width}x${m.height})`);
    }
  }

  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (scene) {
    const b = getBounds(scene);
    const tol = spec.globalRules.originToleranceMeters ?? 0.02;
    if (Math.abs(b.min[1]) > tol) {
      errors.push(`Bottom origin minY=${b.min[1].toFixed(4)}m exceeds ±${tol}m`);
    }
  }

  const fstat = await stat(glbPath);
  const fileKB = +(fstat.size / 1024).toFixed(2);
  if (tierCfg.maxFileKB && fileKB > tierCfg.maxFileKB) {
    errors.push(`File size ${fileKB}KB > tier ${tierName} maxFileKB ${tierCfg.maxFileKB}KB`);
  }

  return {
    id: meta.id || path.basename(glbPath, '.glb'),
    path: relPath,
    tier: tierName,
    tris: lod0.tris,
    lod1Tris: lod1 ? Math.round(lod1.tris) : null,
    lod2Tris: lod2 ? Math.round(lod2.tris) : null,
    gpuVerts: lod0.gpuVerts,
    submeshes: lod0.submeshes,
    textures: textures.length,
    fileKB,
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    errors,
  };
}

async function main() {
  await MeshoptDecoder.ready;
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': { ready: Promise.resolve() }, 'meshopt.decoder': MeshoptDecoder });

  const glbs = await walkGlbs(BUILT_MODELS_DIR);
  const results = [];
  let failCount = 0;

  for (const glb of glbs) {
    const r = await auditOneGlb(glb, spec, io);
    results.push(r);
    if (r.status === 'FAIL') {
      failCount++;
      console.error(`[FAIL] ${r.path}: ${r.errors.join(' | ')}`);
    }
  }

  const report = {
    version: spec.version,
    auditedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failCount,
    failed: failCount,
    results,
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[assets:audit] Audited ${results.length} GLBs -> PASS: ${report.passed}, FAIL: ${report.failed}`);
  if (failCount > 0 || results.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error('[assets:audit] FAILED:', err);
  process.exit(1);
});

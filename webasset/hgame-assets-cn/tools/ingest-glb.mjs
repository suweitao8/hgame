import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { runBlender } from './run-blender.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPEC_PATH = path.join(ROOT, 'manifests', 'asset_spec.json');
const L1_MANIFEST_PATH = path.join(ROOT, 'manifests', 'l1_modular.manifest.json');
const MODELS_MANIFEST_PATH = path.join(ROOT, 'manifests', 'models.manifest.json');
const RAW_L1_DIR = path.join(ROOT, 'raw', 'models_l1');
const RAW_LOD0_READY_DIR = path.join(ROOT, 'raw', 'lod0_ready');
const RAW_HIGHPOLY_DIR = path.join(ROOT, 'raw', 'highpoly_raw');
const BUILT_MODELS_DIR = path.join(ROOT, 'built', 'models');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);

function pow2Clamped(v, minV = 128, maxV = 1024) {
  const p = 2 ** Math.round(Math.log2(Math.max(1, v)));
  return Math.max(minV, Math.min(maxV, p));
}

function measureNodeGroupStats(doc, level) {
  let tris = 0;
  let gpuVerts = 0;
  let submeshes = 0;
  const targetNodes = [];

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() || '';
    const extras = node.getExtras() || {};
    const nodeLevel =
      typeof extras.lodLevel === 'number'
        ? extras.lodLevel
        : name === 'mesh_lod1' || name.endsWith('_lod1')
          ? 1
          : name === 'mesh_lod2' || name.endsWith('_lod2')
            ? 2
            : 0;
    if (nodeLevel !== level) continue;
    targetNodes.push(name);
    for (const prim of mesh.listPrimitives()) {
      submeshes++;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const vCount = pos ? pos.getCount() : 0;
      gpuVerts += vCount;
      tris += idx ? idx.getCount() / 3 : vCount / 3;
    }
  }
  return { level, nodes: targetNodes, tris: Math.round(tris), gpuVerts, submeshes };
}

function stripForbiddenAttributes(doc, forbiddenList) {
  const forbidden = new Set(forbiddenList);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (forbidden.has(semantic)) prim.setAttribute(semantic, null);
      }
    }
  }
  for (const skin of [...doc.getRoot().listSkins()]) {
    skin.dispose();
  }
}

function computeBoundsWithSphere(doc) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  const size = [0, 1, 2].map((i) => +Math.max(1e-4, bounds.max[i] - bounds.min[i]).toFixed(4));
  const center = [0, 1, 2].map((i) => +((bounds.max[i] + bounds.min[i]) * 0.5).toFixed(4));
  const boundingSphereRadius = +Math.hypot(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5).toFixed(4);
  return {
    bounds: { size, center, boundingSphereRadius, minY: +bounds.min[1].toFixed(4) },
    collider: { type: 'box', size, pos: center },
  };
}

function stripArrayOverrideMaterials(doc, itemDef) {
  const slotMap = {};
  const declared = itemDef.materialSlots || {};
  const fallbackSlot = Object.values(declared)[0] || '__missing__';
  const keptImpostorTex = new Set();

  for (const mat of doc.getRoot().listMaterials()) {
    const extras = mat.getExtras() || {};
    const name = mat.getName() || '';
    if (extras.isImpostor || name.includes('Impostor')) {
      if (mat.getBaseColorTexture()) keptImpostorTex.add(mat.getBaseColorTexture());
      continue;
    }
    if (extras.emissivePure || name.startsWith('emissive::')) {
      mat.setBaseColorTexture(null);
      mat.setNormalTexture(null);
      mat.setMetallicRoughnessTexture(null);
      mat.setOcclusionTexture(null);
      mat.setEmissiveTexture(null);
      continue;
    }

    let slot = extras.pbrSlot || extras.pbrLayerSlot || '';
    if (!slot && name.startsWith('slot::')) slot = name.slice(6);
    if (!slot && itemDef.arrayMaterialMap) {
      for (const [k, v] of Object.entries(itemDef.arrayMaterialMap)) {
        if (k !== '*' && name.toLowerCase().includes(k.toLowerCase())) {
          slot = v;
          break;
        }
      }
      if (!slot) slot = itemDef.arrayMaterialMap[name] ?? itemDef.arrayMaterialMap['*'] ?? '';
    }
    if (!slot) slot = fallbackSlot;

    mat.setBaseColorTexture(null);
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    mat.setExtras({ ...extras, pbrSlot: slot });
    slotMap[name || slot] = slot;
  }

  for (const tex of [...doc.getRoot().listTextures()]) {
    if (!keptImpostorTex.has(tex)) tex.dispose();
  }

  doc.getRoot().setExtras({
    ...(doc.getRoot().getExtras() || {}),
    tier: itemDef.tier || 'T0',
    textureMode: itemDef.textureMode || 'array_override',
    pbrSlotMap: slotMap,
  });
}

async function calibrateUniquePbrMaterials(doc, spec, tierCfg, itemDef) {
  const targetSize = tierCfg?.texSize?.master || 512;
  const [minSrgb, maxSrgb] = spec.globalRules?.albedoSrgbClamp || [35, 230];
  const aoWeight = spec.texturePipeline?.aoBakeIntoAlbedoWeight ?? 0.35;
  const aoMetalWeight = spec.texturePipeline?.aoBakeIntoMetalWeight ?? 0.15;
  const minNonMetalRoughByte = Math.round((spec.globalRules?.nonMetalMinRoughness ?? 0.25) * 255);

  for (const mat of doc.getRoot().listMaterials()) {
    const extras = mat.getExtras() || {};
    if (extras.emissivePure || (mat.getName() || '').startsWith('emissive::') || (mat.getName() || '').startsWith('light_')) {
      mat.setBaseColorTexture(null);
      mat.setNormalTexture(null);
      mat.setMetallicRoughnessTexture(null);
      mat.setOcclusionTexture(null);
      mat.setEmissiveTexture(null);
      continue;
    }

    const baseTex = mat.getBaseColorTexture();
    const normTex = mat.getNormalTexture();
    const mrTex = mat.getMetallicRoughnessTexture();
    const occTex = mat.getOcclusionTexture();

    let w = targetSize;
    let h = targetSize;
    if (baseTex?.getImage()) {
      const meta = await sharp(Buffer.from(baseTex.getImage())).metadata();
      w = pow2Clamped(Math.min(targetSize, meta.width || targetSize), 128, targetSize);
      h = pow2Clamped(Math.min(targetSize, meta.height || targetSize), 128, targetSize);
    }
    const nPix = w * h;
    const mrData = mrTex?.getImage() ? await sharp(Buffer.from(mrTex.getImage())).resize(w, h).ensureAlpha().raw().toBuffer() : null;
    const aoData = occTex?.getImage() ? await sharp(Buffer.from(occTex.getImage())).resize(w, h).grayscale().raw().toBuffer() : null;
    const nrmData = normTex?.getImage() ? await sharp(Buffer.from(normTex.getImage())).resize(w, h).ensureAlpha().raw().toBuffer() : null;

    if (baseTex?.getImage()) {
      const colData = await sharp(Buffer.from(baseTex.getImage())).resize(w, h).ensureAlpha().raw().toBuffer();
      const outCol = new Uint8Array(colData);
      for (let p = 0; p < nPix; p++) {
        const i = p * 4;
        const metal = mrData ? mrData[i + 2] / 255 : (mat.getMetallicFactor() || 0);
        const ao = aoData ? aoData[p] / 255 : 1.0;
        const aoFactor = mix(1.0, ao, mix(aoWeight, aoMetalWeight, metal));
        for (let c = 0; c < 3; c++) {
          const lin = srgbToLinear(outCol[i + c] / 255) * aoFactor;
          const srgb = Math.round(clamp01(linearToSrgb(lin)) * 255);
          outCol[i + c] = Math.max(minSrgb, Math.min(maxSrgb, srgb));
        }
      }
      const pngCol = await sharp(outCol, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
      baseTex.setImage(pngCol).setMimeType('image/png').setName(`${mat.getName() || 'mat'}_color`);
    }

    const outNrmRm = new Uint8Array(nPix * 4);
    const defaultRough = Math.round(clamp01(mat.getRoughnessFactor() ?? 0.7) * 255);
    const defaultMetal = Math.round(clamp01(mat.getMetallicFactor() ?? 0.0) * 255);
    for (let p = 0; p < nPix; p++) {
      const i = p * 4;
      outNrmRm[i] = nrmData ? nrmData[i] : 128;
      outNrmRm[i + 1] = nrmData ? nrmData[i + 1] : 128;
      const rawRough = mrData ? mrData[i + 1] : defaultRough;
      const metalByte = mrData ? mrData[i + 2] : defaultMetal;
      outNrmRm[i + 2] = metalByte < 128 ? Math.max(minNonMetalRoughByte, rawRough) : Math.max(10, rawRough);
      outNrmRm[i + 3] = metalByte;
    }
    const pngNrmRm = await sharp(outNrmRm, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
    if (normTex) {
      normTex.setImage(pngNrmRm).setMimeType('image/png').setName(`${mat.getName() || 'mat'}_normal_rm`);
    } else {
      const newTex = doc.createTexture(`${mat.getName() || 'mat'}_normal_rm`).setImage(pngNrmRm).setMimeType('image/png');
      mat.setNormalTexture(newTex);
    }

    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    if (!itemDef.hasComplexEmissive) mat.setEmissiveTexture(null);
    mat.setExtras({ ...extras, normalRmPacked: true });
  }
}

async function processSingleGlb({ srcGlb, outGlb, itemDef, groupName, spec, io, rawMeta = null }) {
  const doc = await io.read(srcGlb);
  const tierName = itemDef.tier || 'T0';
  const tierCfg = spec.tiers[tierName] || spec.tiers.T0;

  stripForbiddenAttributes(doc, spec.globalRules.forbiddenAttributes || []);

  const mode = itemDef.textureMode || tierCfg.textureMode || 'array_override';
  if (mode === 'array_override' || mode === 'backdrop_atlas') {
    stripArrayOverrideMaterials(doc, itemDef);
  } else {
    await calibrateUniquePbrMaterials(doc, spec, tierCfg, itemDef);
  }

  await doc.transform(
    weld(),
    dedup(),
    prune({ keepAttributes: true }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  await mkdir(path.dirname(outGlb), { recursive: true });
  const glbBytes = await io.writeBinary(doc);
  await writeFile(outGlb, glbBytes);

  const fileKB = +(glbBytes.length / 1024).toFixed(2);
  const { bounds, collider } = computeBoundsWithSphere(doc);
  const thresholds = tierCfg.lod?.thresholds || [];
  const cullThreshold = tierCfg.lod?.cull ?? 0.01;

  const lods = [];
  for (const lvl of [0, 1, 2]) {
    const st = measureNodeGroupStats(doc, lvl);
    if (st.submeshes === 0) continue;
    const minScreenRatio =
      lvl < thresholds.length
        ? thresholds[lvl]
        : cullThreshold;
    lods.push({
      level: lvl,
      node: lvl === 0 ? 'mesh_lod0' : `mesh_lod${lvl}`,
      tris: st.tris,
      gpuVerts: st.gpuVerts,
      submeshes: st.submeshes,
      minScreenRatio,
    });
  }

  const pivots = [];
  const sockets = [];
  const emissiveSubmeshes = [];
  for (const node of doc.getRoot().listNodes()) {
    const n = node.getName() || '';
    if (n.startsWith('wheel_')) pivots.push({ node: n, type: 'rotate_x' });
    else if (n.startsWith('pivot_')) pivots.push({ node: n, type: 'rotate_y' });
    else if (n.startsWith('socket_')) sockets.push({ name: n.slice(7), pos: node.getTranslation().map((v) => +v.toFixed(4)), rot: [0, 0, 0] });
    else if (n.startsWith('light_')) emissiveSubmeshes.push(n);
  }

  const relGlbPath = path.relative(path.join(ROOT, 'built'), outGlb).replaceAll('\\', '/');
  const meta = {
    id: itemDef.id,
    group: groupName,
    tier: tierName,
    kind: itemDef.kind || '',
    quadrants: itemDef.quadrants || [],
    tags: itemDef.tags || [],
    materialMode: mode,
    materialSlots: itemDef.materialSlots || rawMeta?.materialSlots || {},
    hasComplexEmissive: Boolean(itemDef.hasComplexEmissive),
    bounds: rawMeta?.bounds || bounds,
    collider: rawMeta?.collider || collider,
    pivots: itemDef.pivots?.length ? itemDef.pivots : pivots,
    emissiveSubmeshes: rawMeta?.emissiveSubmeshes?.length ? rawMeta.emissiveSubmeshes : emissiveSubmeshes,
    sockets: itemDef.sockets?.length ? itemDef.sockets : sockets,
    path: relGlbPath,
    fileKB,
    lods,
    license: itemDef.license || 'CC0',
  };

  await writeFile(outGlb.replace(/\.glb$/i, '.meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  await MeshoptEncoder.ready;
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  const l1Manifest = JSON.parse(await readFile(L1_MANIFEST_PATH, 'utf8'));
  const modelsManifest = existsSync(MODELS_MANIFEST_PATH)
    ? JSON.parse(await readFile(MODELS_MANIFEST_PATH, 'utf8'))
    : { items: [] };

  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  let count = 0;

  // 1. Ingest all L1 Blender-generated GLBs (already contain mesh_lod0 + mesh_lod1)
  for (const grp of l1Manifest.groups) {
    for (const item of grp.items) {
      const srcGlb = path.join(RAW_L1_DIR, grp.group, `${item.id}.glb`);
      if (!existsSync(srcGlb)) throw new Error(`Missing raw L1 GLB: ${srcGlb}. Run npm run l1:gen first.`);
      const outGlb = path.join(BUILT_MODELS_DIR, grp.group, `${item.id}.glb`);
      await processSingleGlb({ srcGlb, outGlb, itemDef: item, groupName: grp.group, spec, io });
      count++;
    }
  }

  // 2. Ingest Layer P manifest models via Entry 1 (raw/lod0_ready/) or Entry 2 (raw/highpoly_raw/ / models_*)
  let skippedLayerP = 0;
  for (const item of modelsManifest.items || []) {
    const lod0ReadyPath = path.join(RAW_LOD0_READY_DIR, `${item.id}_lod0.glb`);
    const highPairPath = path.join(RAW_LOD0_READY_DIR, `${item.id}_high.glb`);
    let rawSrc = null;
    let isLod0Ready = false;

    if (existsSync(lod0ReadyPath)) {
      rawSrc = lod0ReadyPath;
      isLod0Ready = true;
    } else if (existsSync(path.join(RAW_HIGHPOLY_DIR, `${item.id}.glb`))) {
      rawSrc = path.join(RAW_HIGHPOLY_DIR, `${item.id}.glb`);
    } else if (item.source === 'polyhaven') {
      const p = path.join(ROOT, 'raw', 'models_polyhaven', item.polyhavenId, `${item.polyhavenId}_1k.gltf`);
      if (existsSync(p)) rawSrc = p;
    } else if (item.sourceFile) {
      const p = path.join(ROOT, 'raw', item.sourceFile);
      if (existsSync(p)) rawSrc = p;
    }

    if (!rawSrc) {
      skippedLayerP++;
      continue;
    }

    const cleanOut = path.join(ROOT, 'raw', 'models_cleaned', item.group, `${item.id}.glb`);
    const blenderArgs = [
      '--input', rawSrc,
      '--output', cleanOut,
      '--tier', item.tier || 'T2',
      '--targetHeight', String(item.targetHeight || 1.0),
    ];
    if (item.kind) blenderArgs.push('--kind', item.kind);
    if (isLod0Ready) {
      blenderArgs.push('--lod0Ready', 'true');
      if (existsSync(highPairPath)) blenderArgs.push('--highSource', highPairPath);
    }
    runBlender('blender/clean_and_lod.py', blenderArgs);

    const cleanMetaPath = cleanOut.replace(/\.glb$/i, '.meta.json');
    const cleanMeta = existsSync(cleanMetaPath) ? JSON.parse(await readFile(cleanMetaPath, 'utf8')) : null;
    const outGlb = path.join(BUILT_MODELS_DIR, item.group, `${item.id}.glb`);
    await processSingleGlb({ srcGlb: cleanOut, outGlb, itemDef: item, groupName: item.group, spec, io, rawMeta: cleanMeta });
    count++;
  }

  console.log(`[models:ingest] Ingested ${count} single-GLB multi-LOD assets into built/models (${skippedLayerP} Layer-P raw items pending)`);
}

main().catch((err) => {
  console.error('[models:ingest] FAILED:', err);
  process.exit(1);
});

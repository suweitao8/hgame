import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { generateRawPropGlb } from './build-sandbox-props.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'assets', 'models', 'models.manifest.json');
const RAW_CACHE = path.join(ROOT, '.cache', 'models-raw');
const UA = { 'User-Agent': 'WebAsset-Model-Pipeline/2.0' };

function pow2Clamped(v, minV = 128, maxV = 1024) {
  const p = Math.pow(2, Math.round(Math.log2(Math.max(1, v))));
  return Math.max(minV, Math.min(maxV, p));
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
    }
  }
  return Math.round(tris);
}

function hasSkin(doc) {
  return doc.getRoot().listSkins().length > 0;
}

async function fetchPolyHavenModelGltf(polyhavenId) {
  const dir = path.join(RAW_CACHE, `polyhaven_${polyhavenId}`);
  const gltfPath = path.join(dir, `${polyhavenId}_1k.gltf`);
  const metaPath = path.join(dir, 'meta.json');
  if (existsSync(gltfPath) && existsSync(metaPath)) {
    return gltfPath;
  }
  await mkdir(dir, { recursive: true });
  const filesRes = await fetch(`https://api.polyhaven.com/files/${polyhavenId}`, { headers: UA });
  if (!filesRes.ok) throw new Error(`Poly Haven model ${polyhavenId} HTTP ${filesRes.status}`);
  const filesJson = await filesRes.json();
  const gltfSpec = filesJson?.gltf?.['1k']?.gltf;
  if (!gltfSpec?.url) throw new Error(`Poly Haven model ${polyhavenId} missing 1k gltf`);

  const gltfBuf = Buffer.from(await (await fetch(gltfSpec.url, { headers: UA })).arrayBuffer());
  await writeFile(gltfPath, gltfBuf);

  for (const [rel, info] of Object.entries(gltfSpec.include || {})) {
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    const bin = Buffer.from(await (await fetch(info.url, { headers: UA })).arrayBuffer());
    await writeFile(dest, bin);
  }
  await writeFile(metaPath, JSON.stringify({
    assetId: polyhavenId,
    source: 'polyhaven',
    license: 'CC0',
    sourceUrl: `https://polyhaven.com/a/${polyhavenId}`,
    fetchedAt: new Date().toISOString(),
  }, null, 2));
  return gltfPath;
}

function normalizeOriginAndMetricScale(doc, targetHeight) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('GLB has no scene');
  const bounds = getBounds(scene);
  const rawW = Math.max(1e-4, bounds.max[0] - bounds.min[0]);
  const rawH = Math.max(1e-4, bounds.max[1] - bounds.min[1]);
  const rawD = Math.max(1e-4, bounds.max[2] - bounds.min[2]);
  const cx = (bounds.min[0] + bounds.max[0]) * 0.5;
  const minY = bounds.min[1];
  const cz = (bounds.min[2] + bounds.max[2]) * 0.5;
  const s = targetHeight / rawH;

  // Wrap existing root children inside a single calibrated root transform node so
  // hinged child pivots and skinned inverseBindMatrices remain mathematically intact.
  const wrapper = doc.createNode('ingest_root')
    .setTranslation([-cx * s, -minY * s, -cz * s])
    .setScale([s, s, s]);
  const existingChildren = [...scene.listChildren()];
  for (const child of existingChildren) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  const post = getBounds(scene);
  return {
    rawSize: [rawW, rawH, rawD].map(n => +n.toFixed(3)),
    aabb: {
      min: post.min.map(n => +n.toFixed(4)),
      max: post.max.map(n => +n.toFixed(4)),
    },
  };
}

function stripAndBindSharedMaterials(doc, arrayMaterialMap) {
  const boundSlots = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName() || '';
    const slot = arrayMaterialMap[name] ?? arrayMaterialMap['*'];
    if (!slot) continue;
    mat.setBaseColorTexture(null);
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    mat.setExtras({ ...(mat.getExtras() || {}), pbrLayerSlot: slot });
    if (!boundSlots.includes(slot)) boundSlots.push(slot);
  }
  doc.getRoot().setExtras({ ...(doc.getRoot().getExtras() || {}), pbrBoundSlots: boundSlots });
  return boundSlots;
}

async function calibrateEmbeddedTextures(doc, entry, defaults) {
  const texelsPerM = defaults.texelsPerMeter || 256;
  const targetTexSize = pow2Clamped((entry.targetHeight || 1.0) * texelsPerM, 128, 1024);
  const [minAlb, maxAlb] = defaults.albedoClamp || [35, 230];
  const minRoughByte = defaults.nonMetalMinRoughness ?? 64;

  const texRoles = new Map();
  const markRole = (tex, role) => {
    if (!tex) return;
    if (!texRoles.has(tex)) texRoles.set(tex, new Set());
    texRoles.get(tex).add(role);
  };

  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getMetallicFactor() < 0.5) {
      mat.setRoughnessFactor(Math.max(0.25, mat.getRoughnessFactor()));
    }
    markRole(mat.getBaseColorTexture(), 'albedo');
    markRole(mat.getMetallicRoughnessTexture(), 'mr');
    markRole(mat.getNormalTexture(), 'normal');
    markRole(mat.getOcclusionTexture(), 'occ');
  }

  let webpExtAdded = false;
  for (const [tex, roles] of texRoles.entries()) {
    const img = tex.getImage();
    if (!img || !img.byteLength) continue;
    const isAlbedo = roles.has('albedo');
    const isMr = roles.has('mr');
    const isNormal = roles.has('normal');

    const { data, info } = await sharp(Buffer.from(img))
      .resize(targetTexSize, targetTexSize, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const px = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (isAlbedo) {
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) continue;
        px[i] = Math.max(minAlb, Math.min(maxAlb, px[i]));
        px[i + 1] = Math.max(minAlb, Math.min(maxAlb, px[i + 1]));
        px[i + 2] = Math.max(minAlb, Math.min(maxAlb, px[i + 2]));
      }
    }
    if (isMr) {
      for (let i = 0; i < px.length; i += 4) {
        // glTF MR: G = Roughness, B = Metallic
        if (px[i + 2] < 128 && px[i + 1] < minRoughByte) {
          px[i + 1] = minRoughByte;
        }
      }
    }

    const q = isNormal ? 92 : isMr ? 85 : 82;
    const webpBuf = await sharp(Buffer.from(px), { raw: { width: info.width, height: info.height, channels: 4 } })
      .webp({ quality: q, alphaQuality: 90 })
      .toBuffer();

    tex.setImage(new Uint8Array(webpBuf));
    tex.setMimeType('image/webp');
    if (!webpExtAdded) {
      doc.createExtension(EXTTextureWebP).setRequired(false);
      webpExtAdded = true;
    }
  }
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const defaults = manifest.defaults || {};
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptEncoder,
    });

  await mkdir(RAW_CACHE, { recursive: true });
  const results = [];

  for (const entry of manifest.models) {
    let rawPath;
    if (entry.generator) {
      rawPath = path.join(RAW_CACHE, `${entry.id}.glb`);
      await generateRawPropGlb(entry.generator, rawPath);
    } else if (entry.polyhavenId) {
      rawPath = await fetchPolyHavenModelGltf(entry.polyhavenId);
    } else if (entry.sourceFile) {
      rawPath = path.join(ROOT, entry.sourceFile);
    } else {
      throw new Error(`Model "${entry.id}" missing generator/polyhavenId/sourceFile`);
    }

    const doc = await io.read(rawPath);
    const skinned = hasSkin(doc);
    const rawTris = countTriangles(doc);

    // Gate 1 & 2: Origin & Metric Normalization
    const { aabb } = normalizeOriginAndMetricScale(doc, entry.targetHeight || 1.0);

    // Gate 4: Strip & bind shared TEXTURE_2D_ARRAY materials before simplify/prune
    let boundSlots = [];
    if (entry.arrayMaterialMap) {
      boundSlots = stripAndBindSharedMaterials(doc, entry.arrayMaterialMap);
    } else {
      await calibrateEmbeddedTextures(doc, entry, defaults);
    }

    // Gate 3: Triangle budget & Simplify for static meshes
    if (!skinned && entry.maxTris && rawTris > entry.maxTris) {
      const ratio = Math.max(0.05, Math.min(0.95, (entry.maxTris * 0.90) / rawTris));
      await doc.transform(
        weld({ tolerance: 1e-4 }),
        simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05 })
      );
    }

    // Gate 6: Cleanup & Meshopt Compression (preserve TEXCOORD_0 & extras.pbrLayerSlot for array-bound GLBs)
    await doc.transform(
      dedup(),
      prune({ keepAttributes: true, keepExtras: true }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' })
    );

    const outSubDir = path.join(ROOT, manifest.outputRoot, entry.category);
    await mkdir(outSubDir, { recursive: true });
    const outFile = path.join(outSubDir, `${entry.id}.glb`);
    await io.write(outFile, doc);
    const tris = countTriangles(doc);
    const bytes = (await stat(outFile)).size;

    let lod1Url = null;
    let lod1Tris = null;
    if (!skinned && entry.generateLOD1) {
      const lodDoc = await io.read(rawPath);
      normalizeOriginAndMetricScale(lodDoc, entry.targetHeight || 1.0);
      if (entry.arrayMaterialMap) stripAndBindSharedMaterials(lodDoc, entry.arrayMaterialMap);
      await lodDoc.transform(
        weld({ tolerance: 2e-4 }),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.08 }),
        dedup(),
        prune({ keepAttributes: true, keepExtras: true }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' })
      );
      const lodFile = path.join(outSubDir, `${entry.id}_lod1.glb`);
      await io.write(lodFile, lodDoc);
      lod1Tris = countTriangles(lodDoc);
      lod1Url = `/assets/models/${entry.category}/${entry.id}_lod1.glb`;
    }

    console.log(
      `[ingest-glb] ${entry.id} (${entry.category}) | ${rawTris} -> ${tris} tris${lod1Tris ? ` (LOD1:${lod1Tris})` : ''} | ` +
      `${(bytes / 1024).toFixed(1)} KB | ${boundSlots.length ? `array:[${boundSlots.join(',')}]` : skinned ? 'skinned+calibrated' : 'unique+calibrated'}`
    );

    results.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      url: `/assets/models/${entry.category}/${entry.id}.glb`,
      lod1Url,
      skinned,
      aabb,
      tris,
      lod1Tris,
      bytes,
      collider: entry.collider || 'box',
      hinge: entry.hinge || null,
      emissiveNode: entry.emissiveNode || null,
      pbrSlots: boundSlots,
    });
  }

  const outManifest = path.join(ROOT, manifest.manifestOut);
  const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
  await writeFile(outManifest, JSON.stringify({
    version: manifest.version,
    modelCount: results.length,
    totalBytes,
    models: results,
  }, null, 2) + '\n');
  console.log(`[ingest-glb] Complete: ${results.length} models, total ${(totalBytes / 1048576).toFixed(2)} MB -> ${manifest.manifestOut}`);
}

main().catch(err => {
  console.error('[ingest-glb] FAILED:', err);
  process.exit(1);
});

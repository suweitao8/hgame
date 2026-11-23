#!/usr/bin/env node
/**
 * Automated QA validator for HGame LOD 0~3 character GLBs.
 * Usage: node scripts/verify-character-lods.mjs <character_low.glb> [...]
 */
import fs from 'node:fs';
import path from 'node:path';

function readPngDims(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function readAccessor(buf, binStart, gltf, accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const baseOff = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 0;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] || 1;
  const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] || 4;
  const step = stride > 0 ? stride : comps * compSize;
  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const rowOff = baseOff + i * step;
    const row = new Array(comps);
    for (let c = 0; c < comps; c++) {
      const p = rowOff + c * compSize;
      if (acc.componentType === 5126) row[c] = buf.readFloatLE(p);
      else if (acc.componentType === 5121) row[c] = buf.readUInt8(p);
      else if (acc.componentType === 5123) row[c] = buf.readUInt16LE(p);
      else if (acc.componentType === 5125) row[c] = buf.readUInt32LE(p);
      else row[c] = 0;
    }
    out[i] = row;
  }
  return out;
}

function getImageBytes(buf, binStart, gltf, imgIdx) {
  const img = gltf.images?.[imgIdx];
  if (!img) return null;
  if (img.bufferView !== undefined) {
    const bv = gltf.bufferViews[img.bufferView];
    const start = binStart + (bv.byteOffset || 0);
    return buf.subarray(start, start + bv.byteLength);
  }
  return null;
}

export function inspectAndVerifyCharacterGlb(glbPath) {
  const absPath = path.resolve(glbPath);
  const buf = fs.readFileSync(absPath);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`Not a valid GLB file: ${absPath}`);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;

  const errors = [];
  const levels = {};

  for (const node of gltf.nodes || []) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes[node.mesh];
    const prim = mesh?.primitives?.[0];
    if (!prim) continue;
    const extras = { ...(mesh.extras || {}), ...(node.extras || {}) };
    let lvl = Number(extras.lodLevel);
    if (!Number.isFinite(lvl)) {
      const m = /_lod([0-4])$/i.exec(String(node.name || mesh.name || ''));
      lvl = m ? Number(m[1]) : 0;
    }

    const posCount = gltf.accessors[prim.attributes.POSITION]?.count || 0;
    const tris = prim.indices !== undefined
      ? Math.floor(gltf.accessors[prim.indices].count / 3)
      : Math.floor(posCount / 3);

    const mat = prim.material !== undefined ? gltf.materials[prim.material] : null;
    const pbr = mat?.pbrMetallicRoughness || {};
    const bcTexIdx = pbr.baseColorTexture?.index;
    const bcImgIdx = bcTexIdx !== undefined ? gltf.textures?.[bcTexIdx]?.source : undefined;
    const bcBytes = bcImgIdx !== undefined ? getImageBytes(buf, binStart, gltf, bcImgIdx) : null;
    const bcDims = readPngDims(bcBytes);

    let maxNonZeroWeights = 0;
    let maxWeightErr = 0;
    if (prim.attributes.WEIGHTS_0 !== undefined) {
      const weights = readAccessor(buf, binStart, gltf, prim.attributes.WEIGHTS_0);
      for (const w of weights) {
        let nz = 0;
        let sum = 0;
        for (let k = 0; k < w.length; k++) {
          if (w[k] > 1e-6) nz++;
          sum += w[k];
        }
        if (nz > maxNonZeroWeights) maxNonZeroWeights = nz;
        const err = Math.abs(sum - 1.0);
        if (err > maxWeightErr) maxWeightErr = err;
      }
    }

    const texFlags = {
      hasBaseColor: bcTexIdx !== undefined,
      hasNormal: mat?.normalTexture !== undefined,
      hasMetallicRoughness: pbr.metallicRoughnessTexture !== undefined,
      hasOcclusion: mat?.occlusionTexture !== undefined,
      hasEmissive: mat?.emissiveTexture !== undefined,
    };

    levels[lvl] = {
      nodeName: node.name,
      tris,
      verts: posCount,
      extras,
      texDims: bcDims,
      texFlags,
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      maxNonZeroWeights,
      maxWeightErr,
    };

    if (lvl === 1 || lvl === 2) {
      if (texFlags.hasNormal || texFlags.hasMetallicRoughness || texFlags.hasOcclusion || texFlags.hasEmissive) {
        errors.push(`LOD${lvl} carries forbidden extra textures: ${JSON.stringify(texFlags)}`);
      }
      if (!texFlags.hasBaseColor || !bcDims) {
        errors.push(`LOD${lvl} missing valid baseColorTexture`);
      }
      if (maxWeightErr >= 1e-4) {
        errors.push(`LOD${lvl} vertex weight sum error ${maxWeightErr.toExponential(2)} >= 1e-4`);
      }
      if (lvl === 1) {
        if (tris < 1400 || tris > 3200) {
          errors.push(`LOD1 tris ${tris} out of [1400, 3200] range (target 1800..3000)`);
        }
        if (bcDims && (bcDims.width !== 256 || bcDims.height !== 256)) {
          errors.push(`LOD1 color texture ${bcDims.width}x${bcDims.height} !== 256x256`);
        }
        if (maxNonZeroWeights > 4) {
          errors.push(`LOD1 max non-zero bone weights ${maxNonZeroWeights} > 4`);
        }
      }
      if (lvl === 2) {
        if (tris < 500 || tris > 1550) {
          errors.push(`LOD2 tris ${tris} out of [500, 1550] range`);
        }
        if (bcDims && ![64, 128].includes(bcDims.width)) {
          errors.push(`LOD2 color texture width ${bcDims.width} not in [64, 128]`);
        }
        if (maxNonZeroWeights > 2) {
          errors.push(`LOD2 max non-zero bone weights ${maxNonZeroWeights} > 2`);
        }
        if (extras.singleColorOnly !== true || extras.atlasCompatible !== true) {
          errors.push(`LOD2 missing Mega Atlas metadata extras (singleColorOnly/atlasCompatible)`);
        }
      }
    } else if (lvl === 3) {
      if (tris !== 2) {
        errors.push(`LOD3 billboard tris ${tris} !== 2`);
      }
      if (!bcDims || bcDims.width < 128 * (Number(extras.impostorCols) || 1)) {
        errors.push(`LOD3 impostor atlas dimensions invalid: ${JSON.stringify(bcDims)}`);
      }
    }
  }

  for (const req of [0, 1, 2, 3]) {
    if (!levels[req]) errors.push(`Missing required LOD${req} mesh in ${path.basename(absPath)}`);
  }

  return {
    file: absPath,
    bytes: buf.length,
    levels,
    errors,
    ok: errors.length === 0,
  };
}

if (import.meta.url === `file:///${(process.argv[1] || '').replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify-character-lods.mjs')) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/verify-character-lods.mjs <file.glb> [...]');
    process.exit(2);
  }
  let allOk = true;
  for (const f of files) {
    const res = inspectAndVerifyCharacterGlb(f);
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) allOk = false;
  }
  if (!allOk) process.exit(1);
}

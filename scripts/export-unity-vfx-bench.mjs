#!/usr/bin/env node
/**
 * Batch exporter for the 8 audited Piloto Studio benchmark prefabs (`Piloto_Bench_8`).
 * Converts only the 8 selected prefabs, deduplicates textures (.png/.jpg + .tga->.png),
 * and converts referenced .fbx (via Blender headless) and .asset (Unity YAML Mesh)
 * directly to glTF 2.0 .glb in Three.js Right-Handed coordinates + bottom-left UVs.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { convertUnityPrefab } from './import-unity-vfx.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_UNITY_ROOT = process.env.HGAME_PILOTO_ROOT || '';
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'webasset/assets/vfx/piloto_bench_8');

export const PILOTO_BENCH_8 = [
  {
    id: 'charged_slam',
    name: 'Charged Slam',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Essentials Fire/Prefabs/Complex_VFXs/Charged_Slam/Charged_Slam.prefab',
  },
  {
    id: 'watermass_slash',
    name: 'WaterMass Slash',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Water FX/WaterMass_Slash.prefab',
  },
  {
    id: 'arcane_magic_shield',
    name: 'ARPG Arcane Magic Shield',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Arcane/ARPG_Arcane_Magic_Shield.prefab',
  },
  {
    id: 'blood_crystal_clusters',
    name: 'Blood Crystal Clusters',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Bloody/Complex/Blood_Crystal_Clusters.prefab',
  },
  {
    id: 'necroraybeam',
    name: 'NecroRayBeam',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Bonemist/NecroRayBeam.prefab',
  },
  {
    id: 'arcane_radial_projectiles',
    name: 'ARPG Arcane Radial Projectiles',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Arcane/ARPG_Arcane_Radial_Projectiles.prefab',
  },
  {
    id: 'groundslams_three_stage',
    name: 'ARPG GroundSlams ThreeStage',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic GroundSlams/ARPG_GroundSlams_ThreeStage_Attack.prefab',
  },
  {
    id: 'poison_arrow_rain',
    name: 'ARPG Poison Arrow Rain',
    relPath: 'Super Realistic FX Bundle/ARPG Realistic Poison/ARPG_Poison_Arrow_Rain.prefab',
  },
];

function normKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveBlenderPath() {
  const localCfg = path.join(REPO_ROOT, '.hgame.local.json');
  if (fs.existsSync(localCfg)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
      if (cfg.blenderPath && fs.existsSync(cfg.blenderPath)) return cfg.blenderPath;
    } catch {
      // ignore malformed local config
    }
  }
  if (process.env.HGAME_BLENDER_PATH && fs.existsSync(process.env.HGAME_BLENDER_PATH)) {
    return process.env.HGAME_BLENDER_PATH;
  }
  return 'blender';
}

function unpackBitVector(hexStr, bitSize, numItems) {
  const out = new Uint32Array(numItems);
  if (!hexStr || !bitSize || !numItems) return out;
  const clean = hexStr.trim();
  const bytes = Buffer.from(clean, 'hex');
  const mask = (1 << bitSize) - 1;
  let bitPos = 0;
  for (let i = 0; i < numItems; i++) {
    let val = 0;
    let remaining = bitSize;
    let shift = 0;
    while (remaining > 0) {
      const byteIdx = bitPos >> 3;
      const bitOffset = bitPos & 7;
      const take = Math.min(remaining, 8 - bitOffset);
      const b = byteIdx < bytes.length ? bytes[byteIdx] : 0;
      val |= ((b >> bitOffset) & ((1 << take) - 1)) << shift;
      bitPos += take;
      shift += take;
      remaining -= take;
    }
    out[i] = val & mask;
  }
  return out;
}

function dequantizePackedVector(vecBlock) {
  const numItems = Number((vecBlock.match(/m_NumItems:\s*(\d+)/) || [])[1] ?? 0);
  const range = Number((vecBlock.match(/m_Range:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const start = Number((vecBlock.match(/m_Start:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
  const bitSize = Number((vecBlock.match(/m_BitSize:\s*(\d+)/) || [])[1] ?? 0);
  const data = (vecBlock.match(/m_Data:\s*([0-9A-Fa-f]*)/) || [])[1] || '';
  if (!numItems || !bitSize || !data) return null;
  const raw = unpackBitVector(data, bitSize, numItems);
  const denom = Math.max(1, (1 << bitSize) - 1);
  const floats = new Float32Array(numItems);
  for (let i = 0; i < numItems; i++) {
    floats[i] = start + (raw[i] / denom) * range;
  }
  return floats;
}

/**
 * Parses a Unity YAML Mesh `.asset` file (`m_MeshCompression` 0 or 2) into RHS buffers.
 * Converts Unity LHS (`+X, +Y, +Z`) to Three.js RHS (`+X, +Y, -Z`) and reverses winding.
 */
export function parseUnityAssetMesh(txt) {
  const normTxt = txt.replace(/\r\n/g, '\n');
  const meshCompression = Number((normTxt.match(/^\s*m_MeshCompression:\s*(\d+)/m) || [])[1] ?? 0);
  const indexFormat = Number((normTxt.match(/^\s*m_IndexFormat:\s*(\d+)/m) || [])[1] ?? 0);

  let positions = null;
  let normals = null;
  let uv0 = null;
  let uv1 = null;
  let indices = null;

  if (meshCompression === 0) {
    const vtxCount = Number((normTxt.match(/m_VertexData:[\s\S]*?m_VertexCount:\s*(\d+)/) || [])[1] ?? 0);
    const dataSize = Number((normTxt.match(/m_VertexData:[\s\S]*?m_DataSize:\s*(\d+)/) || [])[1] ?? 0);
    const typelessHex = (normTxt.match(/_typelessdata:\s*([0-9A-Fa-f]+)/) || [])[1] || '';
    const idxHex = (normTxt.match(/m_IndexBuffer:\s*([0-9A-Fa-f]+)/) || [])[1] || '';
    const chSection = (normTxt.match(/m_Channels:\s*\n([\s\S]*?)\n\s*m_DataSize:/) || [])[1] || '';
    const channels = [];
    for (const cm of chSection.matchAll(/-\s*stream:\s*(\d+)\s*\n\s*offset:\s*(\d+)\s*\n\s*format:\s*(\d+)\s*\n\s*dimension:\s*(\d+)/g)) {
      channels.push({
        stream: Number(cm[1]),
        offset: Number(cm[2]),
        format: Number(cm[3]),
        dimension: Number(cm[4]),
      });
    }
    const vBuf = Buffer.from(typelessHex, 'hex');
    const stride = vtxCount > 0 ? Math.round(dataSize / vtxCount) : 0;
    const readChan = (chIdx, comps) => {
      const ch = channels[chIdx];
      if (!ch || ch.dimension === 0 || !vtxCount || !stride) return null;
      const out = new Float32Array(vtxCount * comps);
      for (let i = 0; i < vtxCount; i++) {
        const base = i * stride + ch.offset;
        for (let c = 0; c < Math.min(comps, ch.dimension); c++) {
          out[i * comps + c] = ch.format === 0 ? vBuf.readFloatLE(base + c * 4) : 0;
        }
      }
      return out;
    };
    positions = readChan(0, 3);
    normals = readChan(1, 3);
    uv0 = readChan(4, 2);
    uv1 = readChan(5, 2);

    const iBuf = Buffer.from(idxHex, 'hex');
    const step = indexFormat === 1 ? 4 : 2;
    const iCount = Math.floor(iBuf.length / step);
    indices = new Uint16Array(iCount);
    for (let i = 0; i < iCount; i++) {
      indices[i] = indexFormat === 1 ? iBuf.readUInt32LE(i * 4) : iBuf.readUInt16LE(i * 2);
    }
  } else {
    const compSec = normTxt.slice(normTxt.indexOf('m_CompressedMesh:'));
    const subSec = (name, nextName) => {
      const start = compSec.indexOf(`    ${name}:`);
      if (start < 0) return '';
      const end = nextName ? compSec.indexOf(`    ${nextName}:`, start) : compSec.length;
      return compSec.slice(start, end > start ? end : compSec.length);
    };
    positions = dequantizePackedVector(subSec('m_Vertices', 'm_UV'));
    const vCount = positions ? positions.length / 3 : 0;
    const allUvs = dequantizePackedVector(subSec('m_UV', 'm_Normals'));
    if (allUvs && vCount > 0) {
      uv0 = allUvs.slice(0, vCount * 2);
      if (allUvs.length >= vCount * 4) {
        uv1 = allUvs.slice(vCount * 2, vCount * 4);
      }
    }
    const normXY = dequantizePackedVector(subSec('m_Normals', 'm_Tangents'));
    const normSignsHex = (subSec('m_NormalSigns', 'm_TangentSigns').match(/m_Data:\s*([0-9A-Fa-f]*)/) || [])[1] || '';
    const normSigns = unpackBitVector(normSignsHex, 1, vCount);
    if (normXY && vCount > 0) {
      normals = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        const nx = normXY[i * 2];
        const ny = normXY[i * 2 + 1];
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * (normSigns[i] ? -1 : 1);
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
      }
    }
    const triBlk = subSec('m_Triangles', 'm_UVInfo');
    const triItems = Number((triBlk.match(/m_NumItems:\s*(\d+)/) || [])[1] ?? 0);
    const triBits = Number((triBlk.match(/m_BitSize:\s*(\d+)/) || [])[1] ?? 0);
    const triHex = (triBlk.match(/m_Data:\s*([0-9A-Fa-f]*)/) || [])[1] || '';
    const triRaw = unpackBitVector(triHex, triBits, triItems);
    indices = new Uint16Array(triRaw.length);
    for (let i = 0; i < triRaw.length; i++) indices[i] = triRaw[i];
  }

  if (!positions || !indices) {
    throw new Error('Failed to decode Unity .asset mesh geometry');
  }

  // LHS -> RHS: flip Z coordinates and reverse triangle winding.
  for (let i = 2; i < positions.length; i += 3) {
    positions[i] = positions[i] === 0 ? 0 : -positions[i];
  }
  if (normals) {
    for (let i = 2; i < normals.length; i += 3) {
      normals[i] = normals[i] === 0 ? 0 : -normals[i];
    }
  }
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tmp = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = tmp;
  }

  return { positions, normals, uv0, uv1, indices };
}

function pad4(buf) {
  const rem = buf.length & 3;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

/**
 * Serializes mesh buffers (`positions`, optional `normals`, `uv0`, `uv1`, `indices`)
 * into a self-contained binary glTF 2.0 `.glb` buffer.
 */
export function buildGlbBuffer({ positions, normals = null, uv0 = null, uv1 = null, indices }) {
  const vCount = positions.length / 3;
  const minPos = [Infinity, Infinity, Infinity];
  const maxPos = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minPos[0]) minPos[0] = x; if (x > maxPos[0]) maxPos[0] = x;
    if (y < minPos[1]) minPos[1] = y; if (y > maxPos[1]) maxPos[1] = y;
    if (z < minPos[2]) minPos[2] = z; if (z > maxPos[2]) maxPos[2] = z;
  }

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let offset = 0;

  const pushBuffer = (typedArr, target) => {
    const raw = Buffer.from(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
    const aligned = pad4(raw);
    chunks.push(aligned);
    const bvIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: raw.length,
      ...(target ? { target } : {}),
    });
    offset += aligned.length;
    return bvIdx;
  };

  const posView = pushBuffer(positions, 34962);
  const posAcc = accessors.length;
  accessors.push({ bufferView: posView, componentType: 5126, count: vCount, type: 'VEC3', min: minPos, max: maxPos });
  const attributes = { POSITION: posAcc };

  if (normals) {
    const nView = pushBuffer(normals, 34962);
    attributes.NORMAL = accessors.length;
    accessors.push({ bufferView: nView, componentType: 5126, count: vCount, type: 'VEC3' });
  }
  if (uv0) {
    const u0View = pushBuffer(uv0, 34962);
    attributes.TEXCOORD_0 = accessors.length;
    accessors.push({ bufferView: u0View, componentType: 5126, count: vCount, type: 'VEC2' });
  }
  if (uv1) {
    const u1View = pushBuffer(uv1, 34962);
    attributes.TEXCOORD_1 = accessors.length;
    accessors.push({ bufferView: u1View, componentType: 5126, count: vCount, type: 'VEC2' });
  }

  const idxView = pushBuffer(indices, 34963);
  const idxAcc = accessors.length;
  accessors.push({ bufferView: idxView, componentType: 5123, count: indices.length, type: 'SCALAR' });

  const binBuf = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'HGame-UnityVfxBenchExporter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes, indices: idxAcc, mode: 4 }] }],
    bufferViews,
    accessors,
    buffers: [{ byteLength: binBuf.length }],
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonRem = jsonRaw.length & 3;
  const jsonBuf = jsonRem === 0 ? jsonRaw : Buffer.concat([jsonRaw, Buffer.alloc(4 - jsonRem, 0x20)]);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  const binHdrOff = 20 + jsonBuf.length;
  out.writeUInt32LE(binBuf.length, binHdrOff);
  out.writeUInt32LE(0x004e4942, binHdrOff + 4);
  binBuf.copy(out, binHdrOff + 8);
  return out;
}

function collectMeshKeys(recipe, outMap, fbxBakedKeys) {
  for (const layer of recipe.layers) {
    if (layer.mesh && outMap.has(layer.mesh) && fbxBakedKeys.has(layer.mesh)) {
      delete layer.meshGlobalScale;
    }
    if (Array.isArray(layer.subEmitters)) {
      for (const s of layer.subEmitters) {
        if (s?.effect) collectMeshKeys(s.effect, outMap, fbxBakedKeys);
      }
    }
  }
}

export function exportPilotoBench8({
  unityRoot = DEFAULT_UNITY_ROOT,
  outDir = DEFAULT_OUT_DIR,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const texDir = path.join(outDir, 'textures');
  const meshDir = path.join(outDir, 'meshes');
  const recipeDir = path.join(outDir, 'recipes');
  fs.mkdirSync(texDir, { recursive: true });
  fs.mkdirSync(meshDir, { recursive: true });
  fs.mkdirSync(recipeDir, { recursive: true });

  const allTexByRel = new Map(); // relPath -> { relPath, fullPath, spriteKey }
  const spriteToRel = new Map(); // spriteKey -> relPath (detect collisions)
  const texFileByKey = {}; // spriteKey -> relative url e.g. 'textures/foo.png'

  const allMeshes = new Map(); // meshKey -> { relPath, fullPath, glbRel }
  const fbxJobs = []; // { meshKey, srcPath, dstPath }
  const fbxBakedKeys = new Set();

  const converted = [];

  for (const item of PILOTO_BENCH_8) {
    const prefabPath = path.join(unityRoot, item.relPath);
    const { recipe, dependencies } = convertUnityPrefab({
      unityRoot,
      prefabPath,
      id: item.id,
    });

    for (const tex of dependencies.textures) {
      allTexByRel.set(tex.relPath, tex);
    }

    const extractLayerMeshes = (lyr, matNameGuess) => {
      if (lyr.mesh && !['quad', 'cube', 'sphere', 'cylinder', 'crystal'].includes(lyr.mesh)) {
        for (const m of dependencies.meshes) {
          const base = normKey(path.basename(m.relPath, path.extname(m.relPath)).replace(/\([^)]*\)/g, ''));
          const rawBase = normKey(path.basename(m.relPath, path.extname(m.relPath)));
          if (lyr.mesh === rawBase || lyr.mesh.startsWith(`${base}_`) || lyr.mesh.startsWith(`${rawBase}__`)) {
            if (!allMeshes.has(lyr.mesh)) {
              const dstRel = `meshes/${lyr.mesh}.glb`;
              allMeshes.set(lyr.mesh, { ...m, meshKey: lyr.mesh, glbRel: dstRel });
              if (path.extname(m.fullPath).toLowerCase() === '.fbx') {
                fbxBakedKeys.add(lyr.mesh);
              }
            }
          }
        }
      }
      if (lyr.shape?.mesh && !allMeshes.has(lyr.shape.mesh)) {
        for (const m of dependencies.meshes) {
          const rawBase = normKey(path.basename(m.relPath, path.extname(m.relPath)));
          if (lyr.shape.mesh === rawBase) {
            const dstRel = `meshes/${lyr.shape.mesh}.glb`;
            allMeshes.set(lyr.shape.mesh, { ...m, meshKey: lyr.shape.mesh, glbRel: dstRel });
            if (path.extname(m.fullPath).toLowerCase() === '.fbx') {
              fbxBakedKeys.add(lyr.shape.mesh);
            }
          }
        }
      }
      if (Array.isArray(lyr.subEmitters)) {
        for (const sub of lyr.subEmitters) {
          if (sub?.effect?.layers) {
            for (const sl of sub.effect.layers) extractLayerMeshes(sl, matNameGuess);
          }
        }
      }
    };

    for (const layer of recipe.layers) {
      extractLayerMeshes(layer);
    }
    converted.push({ item, recipe });
  }

  // Deduplicate textures and convert any .tga -> .png in one PIL pass
  const tgaJobs = [];
  for (const tex of allTexByRel.values()) {
    const ext = path.extname(tex.relPath).toLowerCase();
    const baseKey = normKey(path.basename(tex.relPath, ext));
    let outName = `${baseKey}${ext === '.tga' ? '.png' : ext}`;
    if (spriteToRel.has(baseKey) && spriteToRel.get(baseKey) !== tex.relPath) {
      // Disambiguate rare collision using parent directory hash
      const parentKey = normKey(path.basename(path.dirname(tex.relPath)));
      outName = `${baseKey}_${parentKey}${ext === '.tga' ? '.png' : ext}`;
    } else {
      spriteToRel.set(baseKey, tex.relPath);
    }
    const dstPath = path.join(texDir, outName);
    texFileByKey[baseKey] = `textures/${outName}`;
    if (ext === '.tga') {
      tgaJobs.push({ src: tex.fullPath, dst: dstPath });
    } else {
      fs.copyFileSync(tex.fullPath, dstPath);
    }
  }

  if (tgaJobs.length > 0) {
    const pyLines = [
      'import json, sys',
      'from PIL import Image',
      `jobs = json.loads(${JSON.stringify(JSON.stringify(tgaJobs))})`,
      'for j in jobs:',
      '    Image.open(j["src"]).save(j["dst"])',
    ];
    execFileSync('python', ['-c', pyLines.join('\n')], { stdio: 'pipe' });
  }

  // Convert .asset meshes directly in JS & queue .fbx meshes for single-shot Blender batch
  for (const m of allMeshes.values()) {
    const ext = path.extname(m.fullPath).toLowerCase();
    const dstPath = path.join(outDir, m.glbRel);
    if (ext === '.asset') {
      const meshData = parseUnityAssetMesh(fs.readFileSync(m.fullPath, 'utf8'));
      const glbBuf = buildGlbBuffer(meshData);
      fs.writeFileSync(dstPath, glbBuf);
    } else if (ext === '.fbx') {
      fbxJobs.push({ meshKey: m.meshKey, src: m.fullPath, dst: dstPath });
    }
  }

  if (fbxJobs.length > 0) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-fbx-'));
    try {
      const jobJsonPath = path.join(tmpDir, 'jobs.json');
      const pyScriptPath = path.join(tmpDir, 'batch_fbx_to_glb.py');
      fs.writeFileSync(jobJsonPath, JSON.stringify(fbxJobs), 'utf8');
      fs.writeFileSync(
        pyScriptPath,
        [
          'import json, bpy, sys',
          `with open(${JSON.stringify(jobJsonPath)}, 'r', encoding='utf-8') as f:`,
          '    jobs = json.load(f)',
          'for job in jobs:',
          '    bpy.ops.wm.read_factory_settings(use_empty=True)',
          '    bpy.ops.import_scene.fbx(filepath=job["src"])',
          '    bpy.ops.object.select_all(action="DESELECT")',
          '    for obj in bpy.data.objects:',
          '        if obj.type == "MESH":',
          '            obj.select_set(True)',
          '            bpy.context.view_layer.objects.active = obj',
          '    if bpy.context.selected_objects:',
          '        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)',
          '        for obj in bpy.data.objects:',
          '            if obj.type == "MESH":',
          '                for uv_layer in obj.data.uv_layers:',
          '                    for loop_uv in uv_layer.data:',
          '                        loop_uv.uv.y = 1.0 - loop_uv.uv.y',
          '    bpy.ops.export_scene.gltf(',
          '        filepath=job["dst"],',
          '        export_format="GLB",',
          '        export_yup=True,',
          '        export_texcoords=True,',
          '        export_normals=True,',
          '        export_materials="NONE",',
          '    )',
        ].join('\n'),
        'utf8',
      );
      execFileSync(resolveBlenderPath(), ['--background', '--python', pyScriptPath], { stdio: 'pipe' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const meshFileByKey = {};
  for (const m of allMeshes.values()) {
    meshFileByKey[m.meshKey] = m.glbRel;
  }

  // Write recipes and catalog.json
  const catalogEffects = [];
  for (const { item, recipe } of converted) {
    collectMeshKeys(recipe, allMeshes, fbxBakedKeys);
    const recipeRel = `recipes/${item.id}.vfx.json`;
    fs.writeFileSync(path.join(outDir, recipeRel), JSON.stringify(recipe, null, 2) + '\n', 'utf8');
    catalogEffects.push({
      id: item.id,
      name: item.name,
      group: 'Piloto_Bench_8',
      recipeFile: recipeRel,
      layerCount: recipe.layers.length,
      duration: recipe.duration,
      loop: recipe.loop,
    });
  }

  const catalog = {
    schemaVersion: 1,
    group: 'Piloto_Bench_8',
    generatedAt: new Date().toISOString(),
    textures: texFileByKey,
    meshes: meshFileByKey,
    effects: catalogEffects,
  };
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');

  return {
    outDir,
    effectCount: catalogEffects.length,
    textureCount: Object.keys(texFileByKey).length,
    meshCount: Object.keys(meshFileByKey).length,
    catalog,
  };
}

if (process.argv[1] && (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('export-unity-vfx-bench.mjs'))) {
  const res = exportPilotoBench8();
  console.log(`Exported ${res.effectCount} effects, ${res.textureCount} deduplicated textures, ${res.meshCount} GLB meshes to ${res.outDir}`);
}

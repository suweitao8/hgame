import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { makeFriendlyName, makeFriendlyNameEn, PACK_ZH } from './zh-names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILT_MODELS_DIR = path.join(ROOT, 'built', 'models');

const WEAPON_PROP_ALLOWLIST = new Set([
  'PolygonFantasyKingdom__SM_Prop_Bow_01.glb',
  'PolygonFantasyKingdom__SM_Prop_Bow_02.glb',
  'PolygonFantasyKingdom__SM_Prop_Crossbow_01.glb',
  'PolygonBiomes__SM_Prop_Ice_Axe_01.glb',
  'PolygonExplorers__SM_Prop_IceAxe_01.glb',
]);

// Split energy/glow overlays in PolygonSciFiSpace are merged into their base weapon in shared local coordinates.
const MERGED_OVERLAYS = new Map([
  ['PolygonSciFiSpace__SM_Wep_Sword_01.glb', ['PolygonSciFiSpace__SM_Wep_Sword_Energy_01.glb']],
  ['PolygonSciFiSpace__SM_Wep_Sword_Double_01.glb', ['PolygonSciFiSpace__SM_Wep_Sword_Double_Energy_01.glb']],
  ['PolygonSciFiSpace__SM_Wep_Shield_Extended_01.glb', ['PolygonSciFiSpace__SM_Wep_Shield_Extended_Energy_01.glb']],
]);

const SKIP_ORPHAN_OVERLAYS = new Set([
  'PolygonSciFiSpace__SM_Wep_Sword_Energy_01.glb',
  'PolygonSciFiSpace__SM_Wep_Sword_Double_Energy_01.glb',
  'PolygonSciFiSpace__SM_Wep_Shield_Extended_Energy_01.glb',
]);

// Exclude modular parts, ammo, crosshairs, scopes, holsters, tripods, siege engines, wall/prop displays, and non-weapon props.
const NON_WEAPON_RE = /(_mod_|_attach_|attachment_|crosshair|bullet|ammo|shell|casing|cartridge|_mag_|^sm_wep_.*mag_|drummag|scope|sight|silencer|suppressor|muzzle|bipod|holster|quiver|sheath|scabbard|covered_01$|cylinderflip|revolver_hammer|_barrel_0|_clip_0|_charge_0|_light_0|_pump_0|_foregrip_0|_tube_0|_tripod_0|flamethrower_tanks|speargun.*_spear_|rpg_rocket_active|rocket_fireworks|rocket_ied|rocketlauncher_01_fireworks|_base_01$|siege_tower|catapult|trebuchet|ballista|rammer|hot_oil|cannon|mortar|_veh_|aagun|heavymachinegun|torpedo|bomb_gascan|bomb_propane|shield_riot_03|emergency_axe|cross_01$|crutch_01$|corkscrew_01$|rock_01$)/i;

function parseArgs(argv) {
  let srcDir = process.env.HGAME_UNREAL_EXPORT_ROOT || '';
  let limit = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src' && argv[i + 1]) srcDir = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[++i]) || 0;
  }
  return { srcDir, limit };
}

function isWeaponFile(filename) {
  if (!filename.endsWith('.glb')) return false;
  if (SKIP_ORPHAN_OVERLAYS.has(filename)) return false;
  const base = path.basename(filename, '.glb');
  const assetPart = base.includes('__') ? base.split('__').slice(1).join('__') : base;
  if (NON_WEAPON_RE.test(assetPart)) return false;
  if (/(?:^|_)(?:SM|SK)_Wep_/i.test(filename)) return true;
  return WEAPON_PROP_ALLOWLIST.has(filename);
}

function classifyWeaponGroup(pack, assetName) {
  const n = assetName.toLowerCase();
  if (/scifi/i.test(pack)) return 'wep_scifi';
  if (/(grenade|bomb|molotov|c4|mine|dynamite|smoke|flash|flare|rpg|rocket|launcher|machinegun|lmg|hmg|minigun|flamethrower|_heavy_01$)/i.test(n)
    && !/(submachinegun|pistol_heavy|sniper_heavy)/i.test(n)) {
    return 'wep_heavy';
  }
  if (/(sword|katana|blade|dagger|knife|wakizashi|tanto|machete|cleaver|shiv|saber|sabre|rapier|claymore|cutlass|axe|hatchet|hammer|mace|club|bat|spear|lance|halberd|pike|trident|glaive|scythe|flail|crowbar|wrench|spade|shovel|pickaxe|pitchfork|baton|pipe|plank|naginata|kanabo|sai|staff|wand|sceptre|scepter|bow|crossbow|shield|sheild|buckler|kunai|shuriken|ninjato|odachi|tonfa|jumonjiyari|chainsaw|trimmer|butcher|icepick|door_ram|pan_01|bayonet)/i.test(n)
    && !/(speargun)/i.test(n)) {
    return 'wep_melee';
  }
  return 'wep_firearm';
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function classifyColor(r, g, b, matName) {
  if (/glass/i.test(matName || '')) return 'glass';
  const { h, s, l } = rgbToHsl(r, g, b);
  if (h >= 15 && h <= 54 && s >= 0.14 && l < 0.72) return 'wood';
  if (s >= 0.22) return 'leather_accent';
  if (l < 0.36) return 'dark_metal';
  return 'bright_metal';
}

const SLOT_PRESETS = {
  bright_metal: {
    pbrSlot: 'metal_brushed_stainless',
    pbrTint: [1.06, 1.07, 1.10],
    uvScale: 1.5,
    previewFactor: [0.68, 0.70, 0.74, 1],
    metallic: 0.94,
    roughness: 0.36,
  },
  dark_metal: {
    pbrSlot: 'metal_matte_grey',
    pbrTint: [0.38, 0.39, 0.42],
    uvScale: 1.5,
    previewFactor: [0.24, 0.25, 0.28, 1],
    metallic: 0.88,
    roughness: 0.42,
  },
  wood: {
    pbrSlot: 'wood_floor_01',
    pbrTint: [0.55, 0.35, 0.22],
    // wood_floor_01 has material_table uvScale=0.5, so 4.0 * 0.5 = 2.0 repeats/m
    uvScale: 4.0,
    previewFactor: [0.42, 0.26, 0.15, 1],
    metallic: 0.0,
    roughness: 0.78,
  },
  leather_accent: {
    pbrSlot: 'leather_01',
    pbrTint: null,
    uvScale: 2.0,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.62,
  },
  glass: {
    pbrSlot: 'glass_clean',
    pbrTint: [1, 1, 1],
    uvScale: 2.0,
    previewFactor: [0.75, 0.88, 0.96, 0.45],
    metallic: 0.05,
    roughness: 0.08,
  },
  emissive: {
    pbrSlot: '__special_emissive__',
    pbrTint: [1, 1, 1],
    uvScale: 1.0,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.2,
  },
};

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const textureCache = new Map();
async function decodeTextureCached(tex) {
  if (!tex) return null;
  const bytes = tex.getImage();
  if (!bytes || !bytes.length) return null;
  const hash = createHash('sha1').update(bytes).digest('hex');
  if (textureCache.has(hash)) return textureCache.get(hash);
  const decoded = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
  textureCache.set(hash, entry);
  return entry;
}

function makeModelId(filename) {
  return 'wep_' + path.basename(filename, '.glb').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
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

async function processWeaponGlb({ srcFile, srcDir, io, catalogMeta }) {
  const inputFiles = [srcFile, ...(MERGED_OVERLAYS.get(srcFile) || [])]
    .filter((f) => existsSync(path.join(srcDir, 'static_models', f)));

  const rawTris = [];
  const vertFaces = new Map();
  const posKey = (pt) => `${Math.round(pt[0] * 2000)},${Math.round(pt[1] * 2000)},${Math.round(pt[2] * 2000)}`;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const partFile of inputFiles) {
    const srcDoc = await io.read(path.join(srcDir, 'static_models', partFile));
    for (const node of srcDoc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const worldMat = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      const uvAcc = prim.getAttribute('TEXCOORD_0');
      const idxAcc = prim.getIndices();
      const srcMat = prim.getMaterial();
      const matName = srcMat?.getName() || '';
      const isMatEnergy = /energy|emissive|glow|neon/i.test(matName);
      const texDecoded = await decodeTextureCached(srcMat?.getBaseColorTexture() || null);
      const emDecoded = await decodeTextureCached(srcMat?.getEmissiveTexture() || null);

      const sampleDecoded = (decoded, u, v) => {
        const cu = ((u % 1) + 1) % 1;
        const cv = ((v % 1) + 1) % 1;
        const px = Math.min(decoded.width - 1, Math.floor(cu * decoded.width));
        const py = Math.min(decoded.height - 1, Math.floor(cv * decoded.height));
        const off = (py * decoded.width + px) * 4;
        return [decoded.data[off], decoded.data[off + 1], decoded.data[off + 2]];
      };

      const triCount = idxAcc ? Math.floor(idxAcc.getCount() / 3) : Math.floor(posAcc.getCount() / 3);
      for (let t = 0; t < triCount; t++) {
        const i0 = idxAcc ? idxAcc.getScalar(t * 3) : t * 3;
        const i1 = idxAcc ? idxAcc.getScalar(t * 3 + 1) : t * 3 + 1;
        const i2 = idxAcc ? idxAcc.getScalar(t * 3 + 2) : t * 3 + 2;

        const p0 = transformPoint(worldMat, posAcc.getElement(i0, [0, 0, 0]));
        const p1 = transformPoint(worldMat, posAcc.getElement(i1, [0, 0, 0]));
        const p2 = transformPoint(worldMat, posAcc.getElement(i2, [0, 0, 0]));

        for (const pt of [p0, p1, p2]) {
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[2] < minZ) minZ = pt[2];
          if (pt[2] > maxZ) maxZ = pt[2];
        }

        let r = 140;
        let g = 144;
        let b = 148;
        let isEmissive = isMatEnergy;
        let er = 0;
        let eg = 255;
        let eb = 222;

        if (uvAcc) {
          const uv0 = uvAcc.getElement(i0, [0, 0]);
          const uv1 = uvAcc.getElement(i1, [0, 0]);
          const uv2 = uvAcc.getElement(i2, [0, 0]);
          const cu = (uv0[0] + uv1[0] + uv2[0]) / 3;
          const cv = (uv0[1] + uv1[1] + uv2[1]) / 3;

          if (texDecoded) {
            [r, g, b] = sampleDecoded(texDecoded, cu, cv);
          }
          if (emDecoded) {
            const [ceR, ceG, ceB] = sampleDecoded(emDecoded, cu, cv);
            if (ceR + ceG + ceB > 45) {
              isEmissive = true;
              er = ceR;
              eg = ceG;
              eb = ceB;
            }
          }
        }

        const slotKey = isEmissive ? 'emissive' : classifyColor(r, g, b, matName);
        rawTris.push({
          p0,
          p1,
          p2,
          r: isEmissive ? er : r,
          g: isEmissive ? eg : g,
          b: isEmissive ? eb : b,
          slotKey,
        });
      }
    }
    }
  }

  if (rawTris.length === 0) return null;

  // Ground minY to 0 and center X/Z so model sits cleanly on studio floor and passes origin audit
  const offX = (minX + maxX) * 0.5;
  const offY = minY;
  const offZ = (minZ + maxZ) * 0.5;

  for (const tri of rawTris) {
    for (const pt of [tri.p0, tri.p1, tri.p2]) {
      pt[0] -= offX;
      pt[1] -= offY;
      pt[2] -= offZ;
    }
    const ax = tri.p1[0] - tri.p0[0];
    const ay = tri.p1[1] - tri.p0[1];
    const az = tri.p1[2] - tri.p0[2];
    const bx = tri.p2[0] - tri.p0[0];
    const by = tri.p2[1] - tri.p0[1];
    const bz = tri.p2[2] - tri.p0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area2 = Math.hypot(cx, cy, cz);
    tri.fn = area2 > 1e-10 ? [cx / area2, cy / area2, cz / area2] : [0, 0, 1];
    tri.area2 = area2;
    tri.ks = [posKey(tri.p0), posKey(tri.p1), posKey(tri.p2)];
    for (const k of tri.ks) {
      let list = vertFaces.get(k);
      if (!list) {
        list = [];
        vertFaces.set(k, list);
      }
      list.push(tri);
    }
  }

  const COS_CREASE = Math.cos((64 * Math.PI) / 180);
  function smoothNormalForCorner(tri, cornerKey) {
    const neighbors = vertFaces.get(cornerKey);
    if (!neighbors || neighbors.length <= 1) return tri.fn;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const nb of neighbors) {
      const dot = tri.fn[0] * nb.fn[0] + tri.fn[1] * nb.fn[1] + tri.fn[2] * nb.fn[2];
      if (dot >= COS_CREASE) {
        const w = Math.max(nb.area2, 1e-8);
        sx += nb.fn[0] * w;
        sy += nb.fn[1] * w;
        sz += nb.fn[2] * w;
      }
    }
    const len = Math.hypot(sx, sy, sz);
    return len > 1e-10 ? [sx / len, sy / len, sz / len] : tri.fn;
  }

  // Group triangles by material slot (cap to <=4 submeshes per T_WEP)
  const buckets = new Map();
  for (const tri of rawTris) {
    let bkt = buckets.get(tri.slotKey);
    if (!bkt) {
      bkt = { pos: [], norm: [], uv: [], rSum: 0, gSum: 0, bSum: 0, count: 0 };
      buckets.set(tri.slotKey, bkt);
    }
    bkt.rSum += tri.r;
    bkt.gSum += tri.g;
    bkt.bSum += tri.b;
    bkt.count++;

    const preset = SLOT_PRESETS[tri.slotKey];
    const s = preset.uvScale;
    const anx = Math.abs(tri.fn[0]);
    const any = Math.abs(tri.fn[1]);
    const anz = Math.abs(tri.fn[2]);
    const project = (pt) => {
      if (anx >= any && anx >= anz) return [pt[2] * s, pt[1] * s];
      if (any >= anx && any >= anz) return [pt[0] * s, pt[2] * s];
      return [pt[0] * s, pt[1] * s];
    };

    const sn0 = smoothNormalForCorner(tri, tri.ks[0]);
    const sn1 = smoothNormalForCorner(tri, tri.ks[1]);
    const sn2 = smoothNormalForCorner(tri, tri.ks[2]);
    const tuv0 = project(tri.p0);
    const tuv1 = project(tri.p1);
    const tuv2 = project(tri.p2);

    bkt.pos.push(...tri.p0, ...tri.p1, ...tri.p2);
    bkt.norm.push(...sn0, ...sn1, ...sn2);
    bkt.uv.push(...tuv0, ...tuv1, ...tuv2);
  }

  // Merge smallest non-emissive bucket into dark_metal if > 5 submeshes
  while (buckets.size > 5) {
    const entries = [...buckets.entries()]
      .filter(([k]) => k !== 'emissive')
      .sort((a, b) => a[1].count - b[1].count);
    const [smallestKey, smallest] = entries[0];
    const targetKey = buckets.has('dark_metal') ? 'dark_metal' : entries[1][0];
    const dst = buckets.get(targetKey);
    dst.pos.push(...smallest.pos);
    dst.norm.push(...smallest.norm);
    dst.uv.push(...smallest.uv);
    dst.rSum += smallest.rSum;
    dst.gSum += smallest.gSum;
    dst.bSum += smallest.bSum;
    dst.count += smallest.count;
    buckets.delete(smallestKey);
  }

  const outDoc = new Document();
  const outBuf = outDoc.createBuffer();
  const outMesh = outDoc.createMesh('mesh_lod0');
  const outNode = outDoc.createNode('mesh_lod0').setMesh(outMesh).setExtras({ lodLevel: 0 });
  const outScene = outDoc.createScene('Scene').addChild(outNode);
  outDoc.getRoot().setDefaultScene(outScene);

  const slotMap = {};
  const emissiveSubmeshes = [];
  for (const [slotKey, bkt] of buckets.entries()) {
    const preset = SLOT_PRESETS[slotKey];
    let tint = preset.pbrTint;
    let previewFactor = preset.previewFactor;
    const avgR = bkt.rSum / bkt.count;
    const avgG = bkt.gSum / bkt.count;
    const avgB = bkt.bSum / bkt.count;

    let mat;
    if (slotKey === 'emissive') {
      const emCol = [
        +Math.max(0.02, Math.min(1, avgR / 255)).toFixed(3),
        +Math.max(0.02, Math.min(1, avgG / 255)).toFixed(3),
        +Math.max(0.02, Math.min(1, avgB / 255)).toFixed(3),
      ];
      mat = outDoc.createMaterial('emissive::weapon_glow')
        .setBaseColorFactor([...emCol, 1])
        .setEmissiveFactor(emCol)
        .setMetallicFactor(0.0)
        .setRoughnessFactor(0.2)
        .setExtras({
          emissivePure: true,
          pbrSlot: '__special_emissive__',
          pbrEmissiveColor: emCol,
          pbrEmissiveStrength: 3.4,
        });
      emissiveSubmeshes.push('emissive');
      slotMap[slotKey] = '__special_emissive__';
    } else {
      if (!tint) {
        const rLin = (avgR / 255) ** 2.2;
        const gLin = (avgG / 255) ** 2.2;
        const bLin = (avgB / 255) ** 2.2;
        const maxC = Math.max(rLin, gLin, bLin, 0.05);
        tint = [
          +Math.min(1.8, (rLin / maxC) * 1.15).toFixed(3),
          +Math.min(1.8, (gLin / maxC) * 1.15).toFixed(3),
          +Math.min(1.8, (bLin / maxC) * 1.15).toFixed(3),
        ];
        previewFactor = [
          +Math.min(1, avgR / 255).toFixed(3),
          +Math.min(1, avgG / 255).toFixed(3),
          +Math.min(1, avgB / 255).toFixed(3),
          1,
        ];
      }

      mat = outDoc.createMaterial(`slot::${preset.pbrSlot}`)
        .setBaseColorFactor(previewFactor)
        .setMetallicFactor(preset.metallic)
        .setRoughnessFactor(preset.roughness)
        .setExtras({ pbrSlot: preset.pbrSlot, pbrTint: tint });

      slotMap[slotKey] = preset.pbrSlot;
    }

    const posAcc = outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(bkt.pos)).setBuffer(outBuf);
    const normAcc = outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(bkt.norm)).setBuffer(outBuf);
    const uvAcc = outDoc.createAccessor().setType('VEC2').setArray(new Float32Array(bkt.uv)).setBuffer(outBuf);

    const prim = outDoc.createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setAttribute('TEXCOORD_0', uvAcc)
      .setMaterial(mat);
    outMesh.addPrimitive(prim);
  }

  outDoc.getRoot().setExtras({
    tier: 'T_WEP',
    textureMode: 'array_override',
    pbrSlotMap: slotMap,
  });

  await outDoc.transform(
    weld(),
    dedup(),
    prune({ keepAttributes: true }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  const pack = catalogMeta?.pack || srcFile.split('__')[0] || 'Weapon';
  const assetName = catalogMeta?.assetName || path.basename(srcFile, '.glb').split('__').slice(1).join('__') || path.basename(srcFile, '.glb');
  const group = classifyWeaponGroup(pack, assetName);
  const id = makeModelId(srcFile);

  const outGlb = path.join(BUILT_MODELS_DIR, group, `${id}.glb`);
  await mkdir(path.dirname(outGlb), { recursive: true });
  const glbBytes = await io.writeBinary(outDoc);
  await writeFile(outGlb, glbBytes);

  let gpuVerts = 0;
  let tris = 0;
  let submeshes = 0;
  for (const prim of outMesh.listPrimitives()) {
    submeshes++;
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    gpuVerts += pos ? pos.getCount() : 0;
    tris += idx ? Math.round(idx.getCount() / 3) : Math.round((pos ? pos.getCount() : 0) / 3);
  }

  const { bounds, collider } = computeBoundsWithSphere(outDoc);
  const relGlbPath = path.relative(path.join(ROOT, 'built'), outGlb).replaceAll('\\', '/');
  const fileKB = +(glbBytes.length / 1024).toFixed(2);

  const shortPack = pack.replace(/^Polygon_?/, '');
  const meta = {
    id,
    name: makeFriendlyName(pack, assetName),
    nameEn: makeFriendlyNameEn(pack, assetName),
    group,
    tier: 'T_WEP',
    kind: 'weapon',
    quadrants: [],
    tags: ['weapon', shortPack.toLowerCase(), PACK_ZH[shortPack] || '', group].filter(Boolean),
    materialMode: 'array_override',
    materialSlots: slotMap,
    hasComplexEmissive: false,
    bounds,
    collider,
    pivots: [],
    emissiveSubmeshes,
    sockets: [],
    path: relGlbPath,
    fileKB,
    lods: [
      {
        level: 0,
        node: 'mesh_lod0',
        tris,
        gpuVerts,
        submeshes,
        minScreenRatio: 0.005,
      },
    ],
    license: 'local-weapon-pbr',
  };

  await writeFile(outGlb.replace(/\.glb$/i, '.meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  const { srcDir, limit } = parseArgs(process.argv.slice(2));
  if (!srcDir || !existsSync(path.join(srcDir, 'static_models'))) {
    throw new Error('Missing --src <exportRoot> (or HGAME_UNREAL_EXPORT_ROOT) containing static_models/');
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const catalogPath = path.join(srcDir, 'catalog.json');
  const catalogById = new Map();
  if (existsSync(catalogPath)) {
    const cat = JSON.parse(await readFile(catalogPath, 'utf8'));
    for (const sm of cat.staticModels || []) {
      catalogById.set(`${sm.id}.glb`, sm);
    }
  }

  const files = (await readdir(path.join(srcDir, 'static_models')))
    .filter(isWeaponFile)
    .sort((a, b) => {
      // Prefer canonical names without _Preset/_Static/typo variants before duplicates
      const penalty = (f) => (/_(Preset|Static)\.glb$/i.test(f) ? 2 : 0) + (/Assult/i.test(f) ? 1 : 0);
      const pa = penalty(a);
      const pb = penalty(b);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
  const targetFiles = limit > 0 ? files.slice(0, limit) : files;

  let ok = 0;
  let skippedDup = 0;
  let totalBytes = 0;
  const groupCounts = {};
  const seenGeoSigs = new Set();
  for (let i = 0; i < targetFiles.length; i++) {
    const srcFile = targetFiles[i];
    const meta = await processWeaponGlb({
      srcFile,
      srcDir,
      io,
      catalogMeta: catalogById.get(srcFile) || null,
    });
    if (meta) {
      const sortedSize = [...meta.bounds.size].sort((a, b) => a - b).map((v) => Math.round(v * 100)).join(',');
      const geoSig = `${meta.lods[0].tris}|${sortedSize}`;
      if (seenGeoSigs.has(geoSig)) {
        // Remove duplicate GLB + meta just written
        const dupGlb = path.join(ROOT, 'built', meta.path);
        const { unlink } = await import('node:fs/promises');
        await unlink(dupGlb).catch(() => {});
        await unlink(dupGlb.replace(/\.glb$/i, '.meta.json')).catch(() => {});
        skippedDup++;
      } else {
        seenGeoSigs.add(geoSig);
        ok++;
        totalBytes += Math.round(meta.fileKB * 1024);
        groupCounts[meta.group] = (groupCounts[meta.group] || 0) + 1;
      }
    }
    if ((i + 1) % 100 === 0 || i + 1 === targetFiles.length) {
      console.log(`[weapons:ingest] ${i + 1}/${targetFiles.length} processed (${ok} kept, ${skippedDup} dupes skipped, ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
    }
  }
  console.log('[weapons:ingest] Groups:', groupCounts);
}

main().catch((err) => {
  console.error('[weapons:ingest] FAILED:', err);
  process.exit(1);
});

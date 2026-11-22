import * as THREE from 'three';
import { ensurePbrGeometryAttributes } from '../realistic-pcg.js';

export const MATERIAL_SLOT_ALIASES = Object.freeze({
  // Road & Ground
  road_asphalt_new: 'asphalt_fresh',
  road_asphalt_cracked: 'asphalt_road_01',
  road_concrete_aged: 'concrete_road_01',
  plaza_stone_slab: 'paving_stone_01',
  curb_granite: 'granite_paving_slabs',
  sidewalk_permeable_grey: 'sidewalk_tiles_01',
  sidewalk_permeable_red: 'ceramic_tiles_red',
  cn_tactile_dot: 'cn_tactile_yellow',
  cn_tactile_strip: 'cn_tactile_yellow',
  // Tile & Paving
  tile_polished_800: 'marble_tiles',
  tile_antislip: 'square_paving_tiles',
  floor_terrazzo_old: 'terrazzo_old',
  cn_exterior_tile_white: 'ceramic_tiles_white',
  cn_exterior_tile_blue: 'tokyo_wall_tiles',
  cn_washed_stone: 'stone_pavement',
  garage_epoxy_green: 'cn_epoxy_green',
  // Brick & Masonry
  rural_red_brick: 'red_brick_wall_01',
  // Concrete & Plaster
  concrete_fair_faced: 'concrete_wall_precast',
  cn_plaster_white: 'plaster_wall',
  cn_hallway_green_dado: 'plaster_wall',
  ceiling_gypsum: 'plaster_painted',
  ceiling_mineral_wool: 'stucco_wall',
  // Interior Stone
  facade_dry_hung_stone: 'marble_raw',
  // Metal
  metal_painted_steel: 'metal_painted_sheet',
  metal_galvanized: 'metal_frosted_fine',
  metal_aluminum: 'metal_matte_grey',
  metal_stainless_brushed: 'metal_brushed_stainless',
  metal_cast_iron: 'metal_cast_iron_dark',
  metal_rust_heavy: 'metal_rusty_sheet',
  cn_security_door_red: 'metal_painted_door',
  cn_shutter_door: 'metal_corrugated_01',
  // Wood
  wood_solid_door: 'wood_planks_01',
  wood_floor_light: 'wood_floor_01',
  wood_floor_dark: 'wood_floor_02',
  wood_preservative: 'wood_flaked_planks',
  // Nature
  nature_lawn_grass: 'nature_grass_cut',
  nature_farmland_wet: 'nature_mud_ground',
  nature_soil_dirt: 'nature_soil',
  nature_mud_road: 'nature_mud_ground',
  nature_mountain_rock: 'nature_granite_rock',
  // Special fallback slots rendered via native Three materials
  glass_clear: '__special_glass__',
  facade_curtain_glass: '__special_curtain_glass__',
  cn_greenhouse_film: '__special_film__',
  cn_luminous_diffuser: '__special_emissive__',
});

export const CATEGORY_LABELS = Object.freeze({
  // Material categories
  '1_road_ground': '道路与地坪 (Road & Ground)',
  '2_tile_paving': '瓷砖与铺装 (Tile & Paving)',
  '3_masonry_brick': '砖石与砌体 (Masonry & Brick)',
  '4_concrete_plaster': '混凝土与抹灰 (Concrete & Plaster)',
  '5_interior_stone': '石材与大理石 (Interior Stone)',
  '6_metal': '金属与锈蚀 (Metal)',
  '7_wood': '木材与地板 (Wood)',
  '8_fabric_leather': '织物与皮革 (Fabric & Leather)',
  '9_nature_terrain': '自然地表 (Nature Terrain)',
  '10_cn_procedural': '中式程序化专用 (CN Procedural)',
  // Model groups
  l1_arch: 'L1 建筑结构件 (Architecture)',
  l1_road: 'L1 道路与路网 (Roads)',
  l1_base: 'L1 市政与街具 (Street Props)',
  l1_wire: 'L1 架空线缆 (Overhead Wires)',
  l1_backdrop: 'L1 远景天际线壳体 (Skyline)',
  // Decal & foliage categories
  crack: '裂缝破损 (Crack)',
  leak: '墙面渗水污渍 (Leak)',
  stain: '地面油污青苔 (Stain)',
  manhole_drain: '井盖与排水箅子 (Drain)',
  litter: '落叶与杂物 (Litter)',
  combat_blood: '战斗血迹/溅射 (Blood)',
  grass: '草丛 (Grass)',
  fern: '蕨类 (Fern)',
  vine: '藤蔓 (Vine)',
  bamboo: '竹叶 (Bamboo)',
  broadleaf_branch: '阔叶树枝 (Broadleaf)',
  pine_branch: '松枝 (Pine)',
  tropical_branch: '热带棕榈叶 (Tropical)',
});

export function formatCategoryLabel(key) {
  return CATEGORY_LABELS[key] || key;
}

export function resolveMaterialSlot(rawSlot, registry, overrideMap = null) {
  const mapped = overrideMap?.[rawSlot] || rawSlot;
  if (mapped && registry.has(mapped)) return mapped;
  const alias = MATERIAL_SLOT_ALIASES[mapped];
  if (alias && alias.startsWith('__special_')) return alias;
  if (alias && registry.has(alias)) return alias;
  return '__missing__';
}

const SPECIAL_MATERIAL_CACHE = new Map();

function getSpecialMaterial(kind, wireframe = false) {
  const key = `${kind}:${wireframe ? 1 : 0}`;
  if (SPECIAL_MATERIAL_CACHE.has(key)) return SPECIAL_MATERIAL_CACHE.get(key);
  let mat;
  if (kind === '__special_emissive__') {
    mat = new THREE.MeshStandardMaterial({
      color: 0xfff6dc,
      emissive: new THREE.Color(0xffe4a0),
      emissiveIntensity: 1.6,
      roughness: 0.35,
      metalness: 0.05,
      wireframe,
    });
  } else if (kind === '__special_film__') {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0xd8eadf,
      roughness: 0.38,
      metalness: 0.0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe,
    });
  } else if (kind === '__special_curtain_glass__') {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0x6ba2c4,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      wireframe,
    });
  } else {
    mat = new THREE.MeshPhysicalMaterial({
      color: 0xcbe5f2,
      roughness: 0.06,
      metalness: 0.05,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      wireframe,
    });
  }
  mat.userData.sharedSpecial = true;
  SPECIAL_MATERIAL_CACHE.set(key, mat);
  return mat;
}

export function applyCatalogMaterialToObject(
  root,
  fallbackSlot,
  { texArray, worldMat, cutoutMat = null, glassMat = null, wireframe = false, slotOverrideMap = null } = {},
) {
  const registry = texArray.registry;
  if (worldMat?.material) worldMat.material.wireframe = Boolean(wireframe);
  if (cutoutMat?.material) cutoutMat.material.wireframe = Boolean(wireframe);
  if (glassMat?.material) glassMat.material.wireframe = Boolean(wireframe);

  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const resolveForMat = (m) => resolveMaterialSlot(m?.userData?.pbrSlot || fallbackSlot, registry, slotOverrideMap);

    const primarySlot = resolveForMat(srcMats[0]);
    const isSpecialPrimary = primarySlot.startsWith('__special_');
    const primaryLayer = isSpecialPrimary ? 0 : registry.getLayer(primarySlot);
    ensurePbrGeometryAttributes(obj.geometry, primaryLayer, [1, 1, 1], 1.0);

    if (Array.isArray(obj.material) && obj.geometry.groups?.length) {
      const idAttr = obj.geometry.getAttribute('aMaterialId');
      const idxAttr = obj.geometry.getIndex();
      let hasTranslucent = false;
      obj.material = obj.geometry.groups.map(grp => {
        const slot = resolveForMat(srcMats[grp.materialIndex]);
        if (slot.startsWith('__special_')) {
          if (slot !== '__special_emissive__') hasTranslucent = true;
          return getSpecialMaterial(slot, wireframe);
        }
        const lid = registry.getLayer(slot);
        const lmeta = registry.getMeta(slot);
        const end = grp.start + grp.count;
        for (let i = grp.start; i < end; i++) {
          const vi = idxAttr ? idxAttr.getX(i) : i;
          idAttr.setX(vi, lid);
        }
        if (lmeta.blendMode === 'translucent' && glassMat) {
          hasTranslucent = true;
          return glassMat.material;
        }
        if (lmeta.alphaCutout && cutoutMat) {
          return cutoutMat.material;
        }
        return worldMat.material;
      });
      idAttr.needsUpdate = true;
      if (hasTranslucent) obj.renderOrder = 2;
    } else if (isSpecialPrimary) {
      obj.material = getSpecialMaterial(primarySlot, wireframe);
      if (primarySlot !== '__special_emissive__') obj.renderOrder = 2;
    } else {
      const lmeta = registry.getMeta(primarySlot);
      if (lmeta.blendMode === 'translucent' && glassMat) {
        obj.material = glassMat.material;
        obj.renderOrder = 2;
      } else if (lmeta.alphaCutout && cutoutMat) {
        obj.material = cutoutMat.material;
      } else {
        obj.material = worldMat.material;
      }
    }
  });
}

export function createStudioFloor({
  width = 160,
  depth = 160,
  centerX = 0,
  centerZ = 0,
  y = -0.005,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1d221c';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle 1m minor grid (5 cells per 512 tile = 5m tile)
  ctx.strokeStyle = 'rgba(170, 192, 158, 0.08)';
  ctx.lineWidth = 2;
  const step = 512 / 5;
  for (let i = 1; i < 5; i++) {
    const p = Math.round(i * step);
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }
  // 5m major grid border
  ctx.strokeStyle = 'rgba(213, 228, 180, 0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(width / 5, depth / 5);
  tex.anisotropy = 4;

  const geo = new THREE.PlaneGeometry(width, depth);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(centerX, y, centerZ);
  mesh.receiveShadow = true;
  mesh.name = '__studio_floor__';
  return mesh;
}

export function createPlaqueMesh({
  title = '',
  subtitle = '',
  badge = '',
  width = 2.0,
  height = 0.56,
  accentHex = '#b7d484',
} = {}) {
  const cw = 512;
  const ch = Math.max(128, Math.round((cw * height) / width));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#121611';
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = 'rgba(213, 228, 180, 0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, cw - 4, ch - 4);
  ctx.fillStyle = accentHex;
  ctx.fillRect(2, 2, 10, ch - 4);

  if (badge) {
    ctx.font = 'bold 24px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.fillStyle = accentHex;
    ctx.textBaseline = 'top';
    ctx.fillText(badge, 24, 16);
  }

  ctx.font = 'bold 30px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#f1f5ea';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 24, badge ? 50 : 24, cw - 40);

  if (subtitle) {
    ctx.font = '22px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = '#a5b59c';
    ctx.fillText(subtitle, 24, badge ? 94 : 68, cw - 40);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

export function createSectionBannerMesh({
  title = '',
  subtitle = '',
  width = 5.4,
  height = 1.15,
  accentHex = '#cbe48e',
} = {}) {
  const cw = 768;
  const ch = 164;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#141a13';
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, cw - 6, ch - 6);
  ctx.fillStyle = accentHex;
  ctx.fillRect(3, 3, 16, ch - 6);

  ctx.font = 'bold 42px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#f5f8ef';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 36, 26, cw - 64);

  if (subtitle) {
    ctx.font = '26px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = '#b4c5aa';
    ctx.fillText(subtitle, 36, 94, cw - 64);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const group = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.set(0, height * 0.5 + 1.4, 0);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3129, roughness: 0.7, metalness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.45, 8);
  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-width * 0.42, 0.725, 0);
  const postR = new THREE.Mesh(postGeo, postMat);
  postR.position.set(width * 0.42, 0.725, 0);

  group.add(board, postL, postR);
  return group;
}

export function registerExhibit(exhibits, exhibit) {
  exhibits.push(exhibit);
  if (Array.isArray(exhibit.hitMeshes)) {
    for (const m of exhibit.hitMeshes) m.userData.exhibit = exhibit;
  } else if (exhibit.object) {
    exhibit.object.traverse(c => {
      if (c.isMesh) c.userData.exhibit = exhibit;
    });
  }
  return exhibit;
}

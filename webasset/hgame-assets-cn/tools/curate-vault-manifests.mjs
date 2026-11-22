import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CN_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(CN_ROOT, '..', '..');
const MANIFESTS_DIR = path.join(CN_ROOT, 'manifests');

function parseArgs(argv) {
  let vaultDir = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault' && argv[i + 1]) vaultDir = path.resolve(argv[++i]);
  }
  return { vaultDir };
}

async function resolveVaultDir(explicit) {
  if (explicit) return explicit;
  if (process.env.HGAME_VAULT_DIR?.trim()) return path.resolve(process.env.HGAME_VAULT_DIR.trim());
  const localCfgPath = path.join(REPO_ROOT, '.hgame.local.json');
  if (existsSync(localCfgPath)) {
    const cfg = JSON.parse(await readFile(localCfgPath, 'utf8'));
    if (typeof cfg?.vaultCacheDir === 'string' && cfg.vaultCacheDir.trim()) {
      return path.resolve(cfg.vaultCacheDir.trim());
    }
    if (typeof cfg?.fabLibraryDir === 'string' && cfg.fabLibraryDir.trim()) {
      return path.dirname(path.resolve(cfg.fabLibraryDir.trim()));
    }
  }
  throw new Error('Missing VaultCache root. Pass --vault <dir> or set HGAME_VAULT_DIR.');
}

async function inspectFabItem(fabRoot, dirName) {
  const full = path.join(fabRoot, dirName);
  if (!existsSync(full)) throw new Error(`Missing FabLibrary folder: ${dirName}`);
  const files = [];
  const walk = async (p) => {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (e.isDirectory()) await walk(fp);
      else files.push(fp);
    }
  };
  await walk(full);
  const texFiles = files.filter(
    (f) => /\.(jpg|jpeg|png|exr|tga|webp)$/i.test(f) && path.basename(f).toLowerCase() !== 'thumbnail.jpeg',
  );
  const jsonFile = files.find((f) => f.endsWith('.json') && !f.endsWith('metadata.json'));
  const meta = jsonFile ? JSON.parse(await readFile(jsonFile, 'utf8')) : {};
  const metaArr = Array.isArray(meta.meta) ? meta.meta : [];
  const getMeta = (k) => metaArr.find((x) => x.key === k)?.value ?? null;
  const baseColorFile = texFiles.find((f) => /_basecolor\./i.test(f) || /_albedo\./i.test(f)) || texFiles[0];
  let width = 0;
  let height = 0;
  if (baseColorFile) {
    const m = await sharp(baseColorFile).metadata();
    width = m.width || 0;
    height = m.height || 0;
  }
  const mapRoles = new Set();
  for (const f of texFiles) {
    const base = path.basename(f, path.extname(f));
    let suffix = base.split('_').pop();
    if (/^basecolor$/i.test(suffix)) suffix = 'BaseColor';
    mapRoles.add(suffix);
  }
  const scanArea = String(getMeta('scanArea') || '1x1 m');
  const mMatch = /([\d.]+)\s*x\s*([\d.]+)/i.exec(scanArea);
  const scanW = mMatch ? Number(mMatch[1]) : 1.0;
  const scanH = mMatch ? Number(mMatch[2]) : 1.0;
  const scanSizeMeters = scanW === scanH ? scanW : [scanW, scanH];
  const uvScale = Number((1 / Math.max(0.1, scanW)).toFixed(3));
  return {
    dirName,
    width,
    height,
    scanArea,
    scanSizeMeters,
    uvScale,
    hasNormal: mapRoles.has('Normal'),
    hasRoughness: mapRoles.has('Roughness'),
    hasMetalness: mapRoles.has('Metalness'),
    hasAo: mapRoles.has('AO'),
    hasOpacity: mapRoles.has('Opacity') || mapRoles.has('Alpha') || mapRoles.has('Mask'),
    tileable: getMeta('tileable') === true,
  };
}

// Curated opaque universal level-building materials (90 total: 85 real + 5 procedural derived)
const MATERIAL_PICKS = [
  // 1. Road & Paving (10)
  { id: 'asphalt_fresh', category: '1_road_ground', source: 'fab', dir: 'Asphalt_Fresh-d656c99c', surfaceType: 'asphalt' },
  { id: 'asphalt_road_01', category: '1_road_ground', source: 'fab', dir: 'Asphalt_Road-673d4ee4', surfaceType: 'asphalt' },
  { id: 'asphalt_road_02', category: '1_road_ground', source: 'fab', dir: 'Asphalt-eb97ec51', surfaceType: 'asphalt' },
  { id: 'concrete_pavement', category: '1_road_ground', source: 'fab', dir: 'Concrete_Pavement-95544273', surfaceType: 'concrete' },
  { id: 'concrete_road_01', category: '1_road_ground', source: 'fab', dir: 'Concrete_Road-03c95d86', surfaceType: 'concrete' },
  { id: 'granite_paving_slabs', category: '1_road_ground', source: 'fab', dir: 'Granite_Paving_Slabs-d60b7f69', surfaceType: 'tile' },
  { id: 'paving_stone_01', category: '1_road_ground', source: 'fab', dir: 'Paving_Stone-00b5c4c6', surfaceType: 'tile' },
  { id: 'paving_stone_02', category: '1_road_ground', source: 'fab', dir: 'Paving_Stone-5fabf08f', surfaceType: 'tile' },
  { id: 'shale_paving_slabs', category: '1_road_ground', source: 'fab', dir: 'Shale_Paving_Slabs-b4c5d7b5', surfaceType: 'tile' },
  { id: 'stone_pavement', category: '1_road_ground', source: 'fab', dir: 'Stone_Pavement-4b22725d', surfaceType: 'tile' },

  // 2. Sidewalk, Ceramic & Terrazzo Tiles (12)
  { id: 'sidewalk_tiles_01', category: '2_tile_paving', source: 'fab', dir: 'Sidewalk_Tiles-129dc017', surfaceType: 'tile' },
  { id: 'sidewalk_tiles_dirty', category: '2_tile_paving', source: 'fab', dir: 'Dirty_Sidewalk_Tiles-56e29fef', surfaceType: 'tile' },
  { id: 'square_paving_tiles', category: '2_tile_paving', source: 'fab', dir: 'Square_Paving_Tiles-e0076fa5', surfaceType: 'tile' },
  { id: 'terrazzo_old', category: '2_tile_paving', source: 'fab', dir: 'Old_Terrazzo_Tiles-ac944688', surfaceType: 'tile' },
  { id: 'ceramic_floor_beige', category: '2_tile_paving', source: 'fab', dir: 'Beige_Ceramic_Floor-c68b2c3f', surfaceType: 'tile' },
  { id: 'stone_tile_black', category: '2_tile_paving', source: 'fab', dir: 'Black_Stone_Tile-9945c238', surfaceType: 'tile' },
  { id: 'ceramic_tiles_checkered', category: '2_tile_paving', source: 'fab', dir: 'Checkered_Ceramic_Tiles-92cb6dad', surfaceType: 'tile' },
  { id: 'ceramic_tiles_white', category: '2_tile_paving', source: 'fab', dir: 'Clean_White_Tiles-dcacef7c', surfaceType: 'tile' },
  { id: 'ceramic_tile_old', category: '2_tile_paving', source: 'fab', dir: 'Old_Ceramic_Tile-441dd131', surfaceType: 'tile' },
  { id: 'ceramic_tiles_patterned', category: '2_tile_paving', source: 'fab', dir: 'Patterned_Ceramic_Tiles-ee5dc131', surfaceType: 'tile' },
  { id: 'ceramic_tiles_red', category: '2_tile_paving', source: 'fab', dir: 'Red_Ceramic_Tiles-09dab907', surfaceType: 'tile' },
  { id: 'tokyo_wall_tiles', category: '2_tile_paving', source: 'fab', dir: 'Tokyo_Wall_Tiles-aa2b5025', surfaceType: 'tile' },

  // 3. Masonry, Brick, Stone Wall & Roof Tiles (13)
  { id: 'brick_facade', category: '3_masonry_brick', source: 'fab', dir: 'Brick_Facade-0300d8e5', surfaceType: 'concrete' },
  { id: 'brick_mud', category: '3_masonry_brick', source: 'fab', dir: 'Brick_Mud-77db8506', surfaceType: 'concrete' },
  { id: 'brick_wall_01', category: '3_masonry_brick', source: 'fab', dir: 'Brick_Wall-c2061c4a', surfaceType: 'concrete' },
  { id: 'brick_wall_02', category: '3_masonry_brick', source: 'fab', dir: 'Brick_Wall-d146cec9', surfaceType: 'concrete' },
  { id: 'red_brick_facade', category: '3_masonry_brick', source: 'fab', dir: 'Red_Brick_Facade-fdb328fe', surfaceType: 'concrete' },
  { id: 'red_brick_wall_01', category: '3_masonry_brick', source: 'fab', dir: 'Red_Brick_Wall-05659426', surfaceType: 'concrete' },
  { id: 'red_brick_wall_02', category: '3_masonry_brick', source: 'fab', dir: 'Red_Brick_Wall-140bebb4', surfaceType: 'concrete' },
  { id: 'cinder_blocks_wall', category: '3_masonry_brick', source: 'fab', dir: 'Cinder_Blocks_Wall-e39a89dd', surfaceType: 'concrete' },
  { id: 'concrete_block_wall_01', category: '3_masonry_brick', source: 'fab', dir: 'Concrete_Block_Wall-16e14f07', surfaceType: 'concrete' },
  { id: 'concrete_block_wall_02', category: '3_masonry_brick', source: 'fab', dir: 'Concrete_Block_Wall-3365c78b', surfaceType: 'concrete' },
  { id: 'stone_wall_01', category: '3_masonry_brick', source: 'fab', dir: 'Stone_Wall-590fa9e2', surfaceType: 'concrete' },
  { id: 'stone_wall_02', category: '3_masonry_brick', source: 'fab', dir: 'Stone_Wall-77a952e0', surfaceType: 'concrete' },
  { id: 'roof_tiles_01', category: '3_masonry_brick', source: 'fab', dir: 'Roof_Tiles-0ab43fa3', surfaceType: 'tile' },

  // 4. Concrete, Plaster & Stucco (12)
  { id: 'concrete_wall_01', category: '4_concrete_plaster', source: 'fab', dir: 'Concrete___Wall-537a0cd0', surfaceType: 'concrete' },
  { id: 'concrete_wall_02', category: '4_concrete_plaster', source: 'fab', dir: 'Concrete_Wall-5fc74d73', surfaceType: 'concrete' },
  { id: 'concrete_wall_03', category: '4_concrete_plaster', source: 'fab', dir: 'Concrete_Wall-7e0c39bd', surfaceType: 'concrete' },
  { id: 'concrete_wall_damaged', category: '4_concrete_plaster', source: 'fab', dir: 'Damaged_Concrete_Wall-1c0dbf8b', surfaceType: 'concrete' },
  { id: 'concrete_floor_dusty', category: '4_concrete_plaster', source: 'fab', dir: 'Dusty_Concrete_Floor-52ca2331', surfaceType: 'concrete' },
  { id: 'concrete_wall_precast', category: '4_concrete_plaster', source: 'fab', dir: 'Precast_Concrete_Wall-55ea2ef8', surfaceType: 'concrete' },
  { id: 'plaster_construction', category: '4_concrete_plaster', source: 'fab', dir: 'Construction_Plaster-7c6374de', surfaceType: 'concrete' },
  { id: 'plaster_cracked', category: '4_concrete_plaster', source: 'fab', dir: 'Cracked_Wall_Plaster-24afd982', surfaceType: 'concrete' },
  { id: 'plaster_old', category: '4_concrete_plaster', source: 'fab', dir: 'Old_Plaster_Wall-1297b8b6', surfaceType: 'concrete' },
  { id: 'plaster_painted', category: '4_concrete_plaster', source: 'fab', dir: 'Painted_Plaster-c698e997', surfaceType: 'concrete' },
  { id: 'plaster_wall', category: '4_concrete_plaster', source: 'fab', dir: 'Plaster_Wall-bfc33074', surfaceType: 'concrete' },
  { id: 'stucco_wall', category: '4_concrete_plaster', source: 'fab', dir: 'Stucco_Wall-411c1e30', surfaceType: 'concrete' },

  // 5. Interior Marble & Travertine (5)
  { id: 'marble_tiles', category: '5_interior_stone', source: 'fab', dir: 'Marble_Tiles-cfaa9d77', surfaceType: 'tile' },
  { id: 'marble_tiles_rect', category: '5_interior_stone', source: 'fab', dir: 'Rectangular_Marble_Tiles-aa74e60d', surfaceType: 'tile' },
  { id: 'marble_raw', category: '5_interior_stone', source: 'fab', dir: 'Raw_Marble_Stone-31c6cc6b', surfaceType: 'concrete' },
  { id: 'marble_travertine', category: '5_interior_stone', source: 'fab', dir: 'Travertine_Marble-e2b83a19', surfaceType: 'concrete' },
  { id: 'marble_white_ziarat', category: '5_interior_stone', source: 'fab', dir: 'Ziarat_White_Marble-3a50ef74', surfaceType: 'concrete' },

  // 6. Architectural & Industrial Metals (12: 6 ambientCG + 6 FabLibrary)
  { id: 'metal_brushed_stainless', category: '6_metal', source: 'ambientcg', dir: 'Metal009', surfaceType: 'metal' },
  { id: 'metal_chrome_silver', category: '6_metal', source: 'ambientcg', dir: 'Metal049A', surfaceType: 'metal' },
  { id: 'metal_matte_grey', category: '6_metal', source: 'ambientcg', dir: 'Metal032', surfaceType: 'metal' },
  { id: 'metal_frosted_fine', category: '6_metal', source: 'ambientcg', dir: 'Metal034', surfaceType: 'metal' },
  { id: 'metal_scratched_steel', category: '6_metal', source: 'ambientcg', dir: 'Metal038', surfaceType: 'metal' },
  { id: 'metal_cast_iron_dark', category: '6_metal', source: 'ambientcg', dir: 'Metal046B', surfaceType: 'metal' },
  { id: 'metal_corrugated_01', category: '6_metal', source: 'fab', dir: 'Corrugated_Metal_Sheet-109b6f59', surfaceType: 'metal' },
  { id: 'metal_corrugated_02', category: '6_metal', source: 'fab', dir: 'Corrugated_Metal_Sheet-bb589248', surfaceType: 'metal' },
  { id: 'metal_painted_sheet', category: '6_metal', source: 'fab', dir: 'Painted_Metal_Sheet-0d9c3130', surfaceType: 'metal' },
  { id: 'metal_painted_door', category: '6_metal', source: 'fab', dir: 'Painted_Metal_Door-c9661075', surfaceType: 'metal', tileToSquare: true },
  { id: 'metal_corrugated_rust', category: '6_metal', source: 'fab', dir: 'Rusty_Corrugated_Metal-8def5dc1', surfaceType: 'metal' },
  { id: 'metal_rusty_sheet', category: '6_metal', source: 'fab', dir: 'Rusty_Metal_Sheet-04d29657', surfaceType: 'metal' },

  // 7. Wood & Floors (7)
  { id: 'wood_flaked_planks', category: '7_wood', source: 'fab', dir: 'Flaked_Wood_Planks-882a246b', surfaceType: 'wood' },
  { id: 'wood_floor_old_01', category: '7_wood', source: 'fab', dir: 'Old_Wooden_Floor-01d89ade', surfaceType: 'wood' },
  { id: 'wood_floor_old_02', category: '7_wood', source: 'fab', dir: 'Old_Wooden_Floor-6e60ce42', surfaceType: 'wood' },
  { id: 'wood_floor_01', category: '7_wood', source: 'fab', dir: 'Wooden_Floor-a516fdd3', surfaceType: 'wood' },
  { id: 'wood_floor_02', category: '7_wood', source: 'fab', dir: 'Wooden_Floor-dd4e55c7', surfaceType: 'wood' },
  { id: 'wood_planks_01', category: '7_wood', source: 'fab', dir: 'Wood_Planks-2f3201b4', surfaceType: 'wood' },
  { id: 'wood_planks_02', category: '7_wood', source: 'fab', dir: 'Wooden_Planks-277e2b85', surfaceType: 'wood' },

  // 8. Interior Fabric & Leather (6)
  { id: 'fabric_cotton_white', category: '8_fabric_leather', source: 'fab', dir: 'Fabric_Clothes_Cotton_Plain_Weave_White-5b36dee7', surfaceType: 'fabric' },
  { id: 'fabric_furniture_01', category: '8_fabric_leather', source: 'fab', dir: 'Furniture_Fabric-1208f247', surfaceType: 'fabric' },
  { id: 'fabric_furniture_02', category: '8_fabric_leather', source: 'fab', dir: 'Furniture_Fabric-2ad48ece', surfaceType: 'fabric' },
  { id: 'fabric_jute_weave', category: '8_fabric_leather', source: 'fab', dir: 'Fabric_Generic_Jute_Plain_Weave-60b9ca37', surfaceType: 'fabric', ignoreOpacity: true },
  { id: 'leather_01', category: '8_fabric_leather', source: 'fab', dir: 'Leather-948ae2b8', surfaceType: 'fabric' },
  { id: 'leather_02', category: '8_fabric_leather', source: 'fab', dir: 'Leather-afd2cf16', surfaceType: 'fabric' },

  // 9. Nature Terrain (8)
  { id: 'nature_grass_cut', category: '9_nature_terrain', source: 'fab', dir: 'Grass_Cut-25b144b3', surfaceType: 'grass' },
  { id: 'nature_grass_wild', category: '9_nature_terrain', source: 'fab', dir: 'Wild_Grass-459a98c9', surfaceType: 'grass' },
  { id: 'nature_soil', category: '9_nature_terrain', source: 'fab', dir: 'Soil-8ef38f43', surfaceType: 'dirt' },
  { id: 'nature_mud_ground', category: '9_nature_terrain', source: 'fab', dir: 'Mud_Ground-2926f16d', surfaceType: 'dirt' },
  { id: 'nature_desert_sand', category: '9_nature_terrain', source: 'fab', dir: 'Desert_Sand-f0fd5765', surfaceType: 'dirt' },
  { id: 'nature_ground_gravel', category: '9_nature_terrain', source: 'fab', dir: 'Ground_Gravel-5b295907', surfaceType: 'dirt' },
  { id: 'nature_granite_rock', category: '9_nature_terrain', source: 'fab', dir: 'Granite_Rock-67d78d30', surfaceType: 'concrete' },
  { id: 'nature_tree_bark', category: '9_nature_terrain', source: 'fab', dir: 'Tree_Bark-c61dd941', surfaceType: 'wood' },

  // 10. Procedural CN Derived Slots (3)
  { id: 'cn_corrugated_blue', category: '10_cn_procedural', source: 'procedural', derivedFrom: 'metal_corrugated_01', surfaceType: 'metal', scanSizeMeters: 2, uvScale: 0.5 },
  { id: 'cn_corrugated_red', category: '10_cn_procedural', source: 'procedural', derivedFrom: 'metal_corrugated_01', surfaceType: 'metal', scanSizeMeters: 2, uvScale: 0.5 },
  { id: 'cn_epoxy_green', category: '10_cn_procedural', source: 'procedural', derivedFrom: 'concrete_floor_dusty', surfaceType: 'concrete', scanSizeMeters: 2, uvScale: 0.5 },
];

const DECAL_PICKS = [
  // Cracks (8)
  { id: 'decal_asphalt_crack_01', category: 'crack', dir: 'Asphalt_Crack-347dea75' },
  { id: 'decal_asphalt_crack_02', category: 'crack', dir: 'Asphalt_Crack-a24c761c' },
  { id: 'decal_asphalt_crack_03', category: 'crack', dir: 'Asphalt_Crack-faf4ac0f' },
  { id: 'decal_concrete_crack_01', category: 'crack', dir: 'Concrete_Crack-1ed16adc' },
  { id: 'decal_concrete_crack_02', category: 'crack', dir: 'Concrete_Crack-7c33f0ba' },
  { id: 'decal_concrete_crack_03', category: 'crack', dir: 'Concrete_Crack-d901dc57' },
  { id: 'decal_wall_crack_01', category: 'crack', dir: 'Wall_Crack-47553167' },
  { id: 'decal_road_crack_01', category: 'crack', dir: 'Road_Crack-58ea4b71' },

  // Leaks (5)
  { id: 'decal_leak_industrial_01', category: 'leak', dir: 'Industrial_Decal_Leak_02-ff00c083', defaultRoughness: 0.30 },
  { id: 'decal_leak_industrial_02', category: 'leak', dir: 'Industrial_Decal_Leak_18-9dab0186', defaultRoughness: 0.30 },
  { id: 'decal_leak_01', category: 'leak', dir: 'Leakage-67af749b', defaultRoughness: 0.30 },
  { id: 'decal_leak_02', category: 'leak', dir: 'Leakage-69c2b00f', defaultRoughness: 0.30 },
  { id: 'decal_leak_03', category: 'leak', dir: 'Leakage-6b189208', defaultRoughness: 0.30 },

  // Oil & Mud stains (6)
  { id: 'decal_oil_patch', category: 'stain', dir: 'Asphalt_Patch_Oil-5762483a', defaultRoughness: 0.30 },
  { id: 'decal_oil_01', category: 'stain', dir: 'Oil_Stain-0bd89d5d', defaultRoughness: 0.30 },
  { id: 'decal_oil_02', category: 'stain', dir: 'Oil_Stain-b6fa708c', defaultRoughness: 0.30 },
  { id: 'decal_oil_03', category: 'stain', dir: 'Oil_Stain-d9a4fb01', defaultRoughness: 0.30 },
  { id: 'decal_oil_large', category: 'stain', dir: 'Large_Oil_Stain-8845f17c', defaultRoughness: 0.30 },
  { id: 'decal_mud_stain', category: 'stain', dir: 'Mud_Stain-0c20290d', defaultRoughness: 0.85 },

  // Manholes & Drains (6)
  { id: 'decal_manhole_01', category: 'manhole_drain', dir: 'Manhole_Cover-2a4f7615' },
  { id: 'decal_manhole_round_01', category: 'manhole_drain', dir: 'Round_Manhole_Cover-7a5c88a6' },
  { id: 'decal_manhole_square_01', category: 'manhole_drain', dir: 'Square_Manhole_Cover-71f26ec9' },
  { id: 'decal_manhole_concrete', category: 'manhole_drain', dir: 'Concrete_Manhole_Cover-f2dc0f1e' },
  { id: 'decal_drain_storm', category: 'manhole_drain', dir: 'Storm_Drain_Cover-b0e0d76c' },
  { id: 'decal_drain_metal', category: 'manhole_drain', dir: 'Metal_Drain_Cover-e442f6e9' },

  // Fallen litter & bark (5)
  { id: 'decal_fallen_leaves_01', category: 'litter', dir: 'Fallen_Leaves-b5f169f0' },
  { id: 'decal_fallen_leaves_02', category: 'litter', dir: 'Fallen_Leaves-e0c2a311' },
  { id: 'decal_fallen_branches', category: 'litter', dir: 'Fallen_Branches-f3e45675' },
  { id: 'decal_dried_bamboo', category: 'litter', dir: 'Dried_Bamboo_Pieces-af4aa8f4' },
  { id: 'decal_pine_bark_scatter', category: 'litter', dir: 'Pine_Bark-5f6f6a17' },

  // Blood stains (4)
  { id: 'decal_blood_01', category: 'combat_blood', dir: 'Blood_Stain-571bfffe', tintableGrayscale: true },
  { id: 'decal_blood_02', category: 'combat_blood', dir: 'Blood_Stain-6915fbf2', tintableGrayscale: true },
  { id: 'decal_blood_03', category: 'combat_blood', dir: 'Blood_Stain-765d43e1', tintableGrayscale: true },
  { id: 'decal_blood_04', category: 'combat_blood', dir: 'Blood_Stain-a84ea9a4', tintableGrayscale: true },
];

const FOLIAGE_PICKS = [
  { id: 'fol_buffalo_grass_01', category: 'grass', dir: 'Buffalo_Grass-6bec75a8' },
  { id: 'fol_buffalo_grass_02', category: 'grass', dir: 'Buffalo_Grass-d8d3267a' },
  { id: 'fol_lady_fern_01', category: 'fern', dir: 'Lady_Fern-cd2eaf9f' },
  { id: 'fol_lady_fern_02', category: 'fern', dir: 'Lady_Fern-e2fd3b6b' },
  { id: 'fol_scattered_ferns', category: 'fern', dir: 'Scattered_Ferns-2d315b51' },
  { id: 'fol_buckler_ferns', category: 'fern', dir: 'Scattered_Buckler_Ferns-3cfa5280' },
  { id: 'fol_vine_money_plant', category: 'vine', dir: 'Money_Plant_Vine-9fc58efb' },
  { id: 'fol_vine_swiss_cheese', category: 'vine', dir: 'Swiss_Cheese_Plant-431b21e6' },
  { id: 'fol_bamboo_leaf_01', category: 'bamboo', dir: 'Bamboo_Leaf-2b0a0351' },
  { id: 'fol_bamboo_leaf_02', category: 'bamboo', dir: 'Bamboo_Leaf-53d4c5ca' },
  { id: 'fol_bamboo_leaves_01', category: 'bamboo', dir: 'Bamboo_Leaves-739d9eeb' },
  { id: 'fol_bamboo_leaves_02', category: 'bamboo', dir: 'Bamboo_Leaves-abe1000a' },
  { id: 'fol_chestnut_branch_01', category: 'broadleaf_branch', dir: 'Chestnut_Branches-bbcc1f9a' },
  { id: 'fol_chestnut_thick', category: 'broadleaf_branch', dir: 'Thick_Chestnut_Branches-788880ff' },
  { id: 'fol_chestnut_thin', category: 'broadleaf_branch', dir: 'Thin_Chestnut_Branches-ebb0a820' },
  { id: 'fol_pine_branch_01', category: 'pine_branch', dir: 'Pine_Branches-120d4761' },
  { id: 'fol_pine_branch_02', category: 'pine_branch', dir: 'Pine_Branches-669fe587' },
  { id: 'fol_pine_patch_01', category: 'pine_branch', dir: 'Pine_Branch_Patches-2f017694' },
  { id: 'fol_pine_forest', category: 'pine_branch', dir: 'Pine_Forest_Branches-27da72a0' },
  { id: 'fol_tropical_cardamom', category: 'tropical_branch', dir: 'Huge_Cardamom_Tree_Branch-4060e45d' },
];

async function main() {
  const { vaultDir } = parseArgs(process.argv.slice(2));
  const vaultRoot = await resolveVaultDir(vaultDir);
  const fabRoot = path.join(vaultRoot, 'FabLibrary');
  const acgRoot = path.join(vaultRoot, 'ambientcg');

  // 1. Build materials.manifest.json
  const matRecords = [];
  for (const p of MATERIAL_PICKS) {
    if (p.source === 'fab') {
      const info = await inspectFabItem(fabRoot, p.dir);
      if (info.hasOpacity && !p.ignoreOpacity) {
        throw new Error(`Material ${p.dir} unexpectedly has Opacity`);
      }
      matRecords.push({
        id: p.id,
        category: p.category,
        sourcePath: `FabLibrary/${p.dir}`,
        surfaceType: p.surfaceType,
        scanSizeMeters: info.scanSizeMeters,
        uvScale: info.uvScale,
        ...(p.tileToSquare ? { tileToSquare: true } : {}),
        ...(p.ignoreOpacity ? { ignoreOpacity: true } : {}),
        hasMetalness: info.hasMetalness,
        resolution: `${info.width}x${info.height}`,
      });
    } else if (p.source === 'ambientcg') {
      const dir = path.join(acgRoot, p.dir);
      if (!existsSync(dir)) throw new Error(`Missing ambientCG folder: ${p.dir}`);
      matRecords.push({
        id: p.id,
        category: p.category,
        sourcePath: `ambientcg/${p.dir}`,
        surfaceType: p.surfaceType,
        scanSizeMeters: 1.0,
        uvScale: 1.0,
        hasMetalness: true,
        resolution: '1024x1024',
      });
    } else {
      matRecords.push({
        id: p.id,
        category: p.category,
        sourcePath: `procedural/${p.derivedFrom}`,
        derivedFrom: p.derivedFrom,
        surfaceType: p.surfaceType,
        scanSizeMeters: p.scanSizeMeters,
        uvScale: p.uvScale,
        hasMetalness: p.surfaceType === 'metal',
        resolution: '1024x1024',
      });
    }
  }

  const materialsManifest = {
    version: '5.0.0',
    resolutions: [1024, 512, 256],
    gameResolution: 512,
    gridCols: 8,
    normalConvention: 'OpenGL (+Y)',
    hdri: [
      { slot: 'cn_day_clear', source: 'polyhaven', assetId: 'kloofendal_48d_partly_cloudy_puresky' },
      { slot: 'cn_overcast_haze', source: 'polyhaven', assetId: 'cloudy_vondelpark' },
      { slot: 'cn_night_city', source: 'polyhaven', assetId: 'cobblestone_street_night' },
    ],
    waterNormal: { slot: 'water_normal', source: 'manual', size: 512 },
    materials: matRecords,
  };
  await writeFile(path.join(MANIFESTS_DIR, 'materials.manifest.json'), JSON.stringify(materialsManifest, null, 2) + '\n', 'utf8');

  // 2. Build decals.manifest.json (preserving existing atlases)
  const existingDecals = JSON.parse(await readFile(path.join(MANIFESTS_DIR, 'decals.manifest.json'), 'utf8'));
  const decalRecords = [];
  for (const d of DECAL_PICKS) {
    const info = await inspectFabItem(fabRoot, d.dir);
    decalRecords.push({
      id: d.id,
      category: d.category,
      sourcePath: `FabLibrary/${d.dir}`,
      scanSizeMeters: info.scanSizeMeters,
      uvScale: info.uvScale,
      resolution: `${info.width}x${info.height}`,
      ...(d.tintableGrayscale ? { tintableGrayscale: true } : {}),
      ...(!info.hasNormal ? { missingNormal: true, defaultNormal: [128, 128, 255] } : {}),
      ...(!info.hasRoughness ? { missingRoughness: true, defaultRoughness: d.defaultRoughness ?? 0.85 } : {}),
    });
  }
  existingDecals.pbrDecals = decalRecords;
  await writeFile(path.join(MANIFESTS_DIR, 'decals.manifest.json'), JSON.stringify(existingDecals, null, 2) + '\n', 'utf8');

  // 3. Build foliage.manifest.json (preserving existing slots)
  const existingFoliage = JSON.parse(await readFile(path.join(MANIFESTS_DIR, 'foliage.manifest.json'), 'utf8'));
  const foliageRecords = [];
  for (const f of FOLIAGE_PICKS) {
    const info = await inspectFabItem(fabRoot, f.dir);
    foliageRecords.push({
      id: f.id,
      category: f.category,
      sourcePath: `FabLibrary/${f.dir}`,
      scanSizeMeters: info.scanSizeMeters,
      resolution: `${info.width}x${info.height}`,
      ...(!info.hasNormal ? { missingNormal: true, defaultNormal: [128, 128, 255] } : {}),
      ...(!info.hasRoughness ? { missingRoughness: true, defaultRoughness: 0.65 } : {}),
    });
  }
  existingFoliage.pbrFoliage = foliageRecords;
  await writeFile(path.join(MANIFESTS_DIR, 'foliage.manifest.json'), JSON.stringify(existingFoliage, null, 2) + '\n', 'utf8');

  console.log('=== Curated Draft Manifests Summary ===');
  console.log('materials.manifest.json:', matRecords.length, 'items (limit <= 100)');
  console.log('decals.manifest.json pbrDecals:', decalRecords.length, 'items (missingNormal:', decalRecords.filter(x => x.missingNormal).length, ', missingRoughness:', decalRecords.filter(x => x.missingRoughness).length, ')');
  console.log('foliage.manifest.json pbrFoliage:', foliageRecords.length, 'items');
}

main().catch((err) => {
  console.error('[curate-vault] FAILED:', err);
  process.exit(1);
});

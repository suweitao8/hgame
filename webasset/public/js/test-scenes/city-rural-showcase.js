import * as THREE from 'three';
import { BucketedInstancedLodPool } from '../realistic-pcg.js';
import { applyCatalogMaterialToObject, registerExhibit } from './showcase-common.js';

function buildTrackATerrain(texArray, worldMat) {
  const geo = new THREE.PlaneGeometry(80, 80, 32, 32);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const reg = texArray.registry;
  const lawnId = reg.getLayer('nature_grass_cut');
  const plazaId = reg.getLayer('paving_stone_01');
  const dirtId = reg.getLayer('nature_mud_ground');
  const count = pos.count;
  const matIds = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const aos = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, x, z);
    if (x > 10 && z > -10) {
      matIds[i] = dirtId;
    } else if (x < 6 && z < 6) {
      matIds[i] = plazaId;
    } else {
      matIds[i] = lawnId;
    }
    tints[i * 3] = 1;
    tints[i * 3 + 1] = 1;
    tints[i * 3 + 2] = 1;
    aos[i] = 1;
  }
  geo.setAttribute('aMaterialId', new THREE.BufferAttribute(matIds, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  geo.setAttribute('aGeomAO', new THREE.BufferAttribute(aos, 1));

  const mesh = new THREE.Mesh(geo, worldMat.material);
  mesh.position.y = -0.01;
  mesh.receiveShadow = true;
  return mesh;
}

export async function buildCityRuralShowcaseScene({
  group,
  colliderGroup,
  cnCatalog,
  texArray,
  worldMat,
  cutoutMat,
  glassMat,
  backdropMat,
  shopSignMat,
  lightingRig,
  wireframe = false,
  loadGlbCached,
  token,
  getToken,
} = {}) {
  const lodPool = new BucketedInstancedLodPool({ hysteresis: 1.12, moveTriggerMeters: 0.5, rotTriggerDeg: 3.0 });
  const animatedPivots = [];
  const exhibits = [];
  const modelMap = new Map((cnCatalog?.models || []).map(m => [m.id, m]));

  const extractLodGeometry = async (id, overrideMap = null) => {
    const entry = modelMap.get(id);
    const relPath = entry?.path || entry?.lods?.[0]?.path;
    if (!entry || !relPath) return null;
    const obj = await loadGlbCached(`/assets/cn/${relPath}`);
    if (token !== getToken()) return null;
    applyCatalogMaterialToObject(obj, Object.values(entry.materialSlots || {})[0] || '__missing__', {
      texArray,
      worldMat,
      cutoutMat,
      glassMat,
      wireframe,
      slotOverrideMap: overrideMap,
    });
    const lodGeos = [null, null, null];
    obj.traverse(c => {
      if (!c.isMesh) return;
      const n = c.name || '';
      const lvl = n === 'mesh_lod1' || n.endsWith('_lod1') ? 1 : n === 'mesh_lod2' || n.endsWith('_lod2') ? 2 : 0;
      if (!lodGeos[lvl]) lodGeos[lvl] = c.geometry;
    });
    return { entry, lodGeos };
  };

  const place = async (id, pos = [0, 0, 0], rotY = 0, overrides = null) => {
    const entry = modelMap.get(id);
    const relPath = entry?.path || entry?.lods?.[0]?.path;
    if (!entry || !relPath) return null;
    const obj = await loadGlbCached(`/assets/cn/${relPath}`);
    if (token !== getToken()) return null;
    if (entry.materialMode === 'backdrop_atlas') {
      obj.traverse(c => { if (c.isMesh) c.material = backdropMat; });
    } else {
      applyCatalogMaterialToObject(obj, Object.values(entry.materialSlots || {})[0] || '__missing__', {
        texArray,
        worldMat,
        cutoutMat,
        glassMat,
        wireframe,
        slotOverrideMap: overrides,
      });
      obj.traverse(c => {
        const n = c.name || '';
        if (n === 'mesh_lod1' || n.endsWith('_lod1') || n === 'mesh_lod2' || n.endsWith('_lod2')) {
          c.visible = false;
        }
      });
    }
    obj.position.set(...pos);
    obj.rotation.y = rotY;
    group.add(obj);

    if (entry.bounds?.size && colliderGroup) {
      const [sx, sy, sz] = entry.bounds.size;
      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(boxGeo);
      const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x6ce57f }));
      wire.position.set(pos[0], pos[1] + sy * 0.5, pos[2]);
      wire.rotation.y = rotY;
      colliderGroup.add(wire);
    }

    const [sx, sy, sz] = entry.bounds?.size || [2, 2, 2];
    const radius = Math.max(2, Math.hypot(sx, sy, sz) * 0.6);
    registerExhibit(exhibits, {
      id: entry.id,
      workspace: 'models',
      kind: 'model',
      title: entry.id,
      subtitle: `${entry.group || 'l1'} · 场景摆件`,
      category: entry.group || 'l1',
      meta: {
        position: pos.map(v => v.toFixed(1)).join(', '),
        size: `${sx.toFixed(1)}×${sy.toFixed(1)}×${sz.toFixed(1)}m`,
      },
      object: obj,
      focusPos: [pos[0] + radius * 0.6, pos[1] + Math.max(1.8, sy * 0.8), pos[2] + radius * 1.6],
      focusTarget: [pos[0], pos[1] + sy * 0.4, pos[2]],
      focusRadius: radius,
    });
    return obj;
  };

  group.add(buildTrackATerrain(texArray, worldMat));

  await place('road_urban_2lane_cross', [0, 0, 0], 0);
  await place('road_urban_2lane_crosswalk', [-10, 0, 0], Math.PI / 2);
  await place('road_urban_2lane_straight', [0, 0, 10], 0);
  await place('road_rural_concrete_straight', [10, 0, 0], Math.PI / 2);
  await place('road_rural_dirt_transition', [20, 0, 0], Math.PI / 2);

  await place('bldg_wall_shutter_4m', [-6, 0, -5], 0);
  await place('bldg_wall_door_2m', [-9, 0, -5], 0);
  await place('bldg_wall_window_2m', [-6, 3, -5], 0, { cn_exterior_tile_white: 'tokyo_wall_tiles' });
  await place('bldg_wall_window_2m', [-9, 3, -5], 0, { cn_exterior_tile_white: 'tokyo_wall_tiles' });
  await place('bldg_interior_wall_2m', [-6, 0, -8], 0);
  await place('bldg_floor_slab_4x4', [-7, 3, -7], 0);
  await place('bldg_roof_flat_4x4', [-7, 6, -7], 0);
  await place('bldg_stairs_double_3m', [-10, 0, -7], 0);
  await place('window_security_grille', [-6, 3.9, -4.85], 0);

  const shutter = await place('door_shop_shutter', [-6, 0, -5], 0);
  const secDoor = await place('door_cn_security', [-9, 0, -5], 0);
  const boom = await place('barrier_garage_boom', [-3, 0, 5.2], 0);
  animatedPivots.push(
    { root: shutter, node: 'pivot_shutter', mode: 'slide_y', amp: 1.6 },
    { root: secDoor, node: 'pivot_door', mode: 'rot_y', amp: 1.2 },
    { root: boom, node: 'pivot_boom', mode: 'rot_z', amp: 1.1 },
  );

  const fenceAsset = await extractLodGeometry('bldg_rural_brick_fence_2m');
  if (fenceAsset) {
    const fenceTransforms = [];
    for (let i = 0; i < 10; i++) {
      fenceTransforms.push({ pos: [12 + i * 2.0, 0, -5], rot: [0, 0, 0] });
    }
    lodPool.addLodGroup(group, {
      id: 'bldg_rural_brick_fence_2m',
      geometries: fenceAsset.lodGeos,
      material: worldMat.material,
      transforms: fenceTransforms,
      boundingSphereRadius: fenceAsset.entry.bounds?.boundingSphereRadius || 1.4,
      thresholds: [0.18, 0.05],
      cullRatio: 0.005,
    });
  }

  const benchAsset = await extractLodGeometry('base_stone_bollard_bench');
  if (benchAsset) {
    const benchTransforms = [];
    for (let i = 0; i < 16; i++) {
      benchTransforms.push({ pos: [-14 + i * 2.5, 0, 6.2], rot: [0, 0, 0] });
    }
    lodPool.addLodGroup(group, {
      id: 'base_stone_bollard_bench',
      geometries: benchAsset.lodGeos,
      material: worldMat.material,
      transforms: benchTransforms,
      boundingSphereRadius: benchAsset.entry.bounds?.boundingSphereRadius || 1.0,
      thresholds: [0.18, 0.05],
      cullRatio: 0.005,
    });
  }

  const signGeo = new THREE.PlaneGeometry(3.4, 0.85);
  const uv = signGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / 8, 0.75 + uv.getY(i) / 4);
  }
  const signMesh = new THREE.Mesh(signGeo, shopSignMat);
  signMesh.position.set(-6, 2.75, -4.82);
  group.add(signMesh);

  await place('base_bus_shelter_frame', [-4, 0, 4.5], 0);
  await place('base_parcel_locker', [-1, 0, -5], 0);
  await place('bldg_roof_pitched_slope_4m', [13, 3, -7], 0);
  await place('bldg_greenhouse_arch_4m', [15, 0, 7], 0);
  await place('wire_catenary_8m', [-6, 5.2, 4], 0);

  await place('backdrop_cbd_tower_a', [-38, 0, -52], 0);
  await place('backdrop_cbd_tower_b', [18, 0, -58], 0.2);
  await place('backdrop_oldtown_block_a', [-10, 0, -44], 0);

  lightingRig.setPointLights([
    { position: [-6, 2.7, -4.2], color: [1.0, 0.82, 0.45], radius: 9.0, intensity: 2.8 },
    { position: [-4, 2.4, 4.5], color: [0.6, 0.85, 1.0], radius: 8.5, intensity: 2.4 },
    { position: [13, 2.2, -4.5], color: [1.0, 0.65, 0.28], radius: 7.5, intensity: 2.0 },
  ]);

  const viewpoints = {
    overview: { label: '城乡全景', pos: [24, 16, 26], target: [0, 2.2, 0] },
    crosswalk: { label: '城市路口与招牌', pos: [-9, 3.2, 12], target: [0, 2.2, -3] },
    shopfront: { label: '底商卷帘与防盗门', pos: [-4, 2.4, 2.5], target: [-6, 1.8, -5] },
    rooftop: { label: '老旧楼道与天台', pos: [11, 8.5, 6], target: [4, 4.5, -5] },
    yard: { label: '乡村砖院与水泥路', pos: [16, 5.5, 16], target: [8, 1.5, 4] },
  };

  return {
    exhibits,
    viewpoints,
    lodPool,
    animatedPivots,
    summaryText: '城乡双轨实景 · Track A + L1合批 + 门窗动画',
    dispose() {
      lodPool.dispose();
    },
  };
}

import * as THREE from 'three';
import { create2MapPbrMaterial, loadSingle2MapAssets } from '../hgame-shared.js';
import { buildBeveledBoxRaw, buildBufferGeometryFromRaw } from '../realistic-pcg.js';
import {
  createPlaqueMesh,
  createSectionBannerMesh,
  createStudioFloor,
  formatCategoryLabel,
  registerExhibit,
} from './showcase-common.js';

const BAY_X = 3.6;
const ROW_Z = 7.4;

function isWallDecal(item) {
  return item?.category === 'leak' || /(?:^|_)wall(?:_|$)/i.test(item?.id || '');
}

export async function buildDecalFoliageShowcaseScene({
  group,
  renderer,
  texArray,
  worldMat,
  token,
  getToken,
} = {}) {
  const [decalTable, foliageTable] = await Promise.all([
    fetch('/assets/cn/pbr_decals/pbr_decals_table.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { items: [] })),
    fetch('/assets/cn/pbr_foliage/pbr_foliage_table.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { items: [] })),
  ]);
  if (token !== getToken()) return { exhibits: [], viewpoints: {}, summaryText: '', dispose: () => {} };

  const decals = Array.isArray(decalTable?.items) ? decalTable.items : [];
  const foliage = Array.isArray(foliageTable?.items) ? foliageTable.items : [];

  const reg = texArray.registry;
  const concreteLayer = reg.getLayer('concrete_road_01');
  const asphaltLayer = reg.getLayer('asphalt_road_01');
  const wallLayer = reg.getLayer('concrete_wall_02');
  const soilLayer = reg.getLayer('nature_soil');

  const disposables = [];
  const exhibits = [];
  const viewpoints = {
    overview: {
      label: `贴花 (${decals.length}) + 植被 (${foliage.length}) 全景`,
      pos: [14, 15, 42],
      target: [14, 1.2, 16],
    },
  };

  // Group decals by category
  const decalGroups = new Map();
  for (const d of decals) {
    const cat = d.category || 'other';
    if (!decalGroups.has(cat)) decalGroups.set(cat, []);
    decalGroups.get(cat).push(d);
  }

  let cursorZ = 0;
  let maxUsedX = 36;

  // Load decal assets in small batches to stay fast and responsive
  async function loadItemAssets(baseUrl, list) {
    const results = new Array(list.length);
    const concurrency = 6;
    let idx = 0;
    async function worker() {
      while (idx < list.length) {
        const cur = idx++;
        if (token !== getToken()) return;
        try {
          results[cur] = await loadSingle2MapAssets(baseUrl, list[cur].id);
        } catch {
          results[cur] = null;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return results;
  }

  for (const [catKey, catItems] of decalGroups.entries()) {
    const catLabel = formatCategoryLabel(catKey);
    const banner = createSectionBannerMesh({
      title: `贴花 · ${catLabel}`,
      subtitle: `${catItems.length} 个 2-Texture PBR Decal`,
      width: 5.0,
      height: 1.05,
      accentHex: '#f5b67a',
    });
    banner.position.set(-4.6, 0, cursorZ + 0.5);
    group.add(banner);

    viewpoints[`decal:${catKey}`] = {
      label: `贴花 · ${catLabel} (${catItems.length})`,
      pos: [Math.min(8, (catItems.length - 1) * BAY_X * 0.35), 2.8, cursorZ + 5.8],
      target: [Math.min(8, (catItems.length - 1) * BAY_X * 0.35), 0.7, cursorZ],
    };

    const loaded = await loadItemAssets('/assets/cn/pbr_decals', catItems);
    if (token !== getToken()) return { exhibits, viewpoints, summaryText: '', dispose: () => {} };

    for (let i = 0; i < catItems.length; i++) {
      const item = catItems[i];
      const assets = loaded[i];
      const cx = i * BAY_X;
      const cz = cursorZ;
      maxUsedX = Math.max(maxUsedX, cx + BAY_X);

      const wallMode = isWallDecal(item);
      const baseLayer = wallMode
        ? wallLayer
        : (catKey === 'manhole_drain' || catKey === 'crack' ? asphaltLayer : concreteLayer);

      const bay = new THREE.Group();
      bay.position.set(cx, 0, cz);

      const hitMeshes = [];
      if (wallMode) {
        const wallGeo = buildBufferGeometryFromRaw(buildBeveledBoxRaw(2.7, 2.7, 0.24, 0, baseLayer));
        const wallMesh = new THREE.Mesh(wallGeo, worldMat.material);
        wallMesh.position.set(0, 1.35, -0.5);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        bay.add(wallMesh);
        hitMeshes.push(wallMesh);
      } else {
        const padGeo = buildBufferGeometryFromRaw(buildBeveledBoxRaw(2.8, 0.08, 2.8, 0, baseLayer));
        const padMesh = new THREE.Mesh(padGeo, worldMat.material);
        padMesh.position.set(0, 0.04, 0);
        padMesh.receiveShadow = true;
        bay.add(padMesh);
        hitMeshes.push(padMesh);
      }

      if (assets) {
        const built = create2MapPbrMaterial({
          mode: 'decal',
          assets,
          renderer,
          tintHex: item.tintableGrayscale ? 0x8b0c0c : 0xffffff,
          opacity: 1.0,
          polygonOffset: true,
        });
        disposables.push(built.material, built.colorTex, built.normRmTex);

        const imgW = assets.colorImg?.naturalWidth || 1;
        const imgH = assets.colorImg?.naturalHeight || 1;
        const aspect = imgW / Math.max(1, imgH);
        const w = aspect >= 1 ? 2.1 : 2.1 * aspect;
        const h = aspect >= 1 ? 2.1 / aspect : 2.1;

        const decalGeo = new THREE.PlaneGeometry(w, h);
        const decalMesh = new THREE.Mesh(decalGeo, built.material);
        decalMesh.renderOrder = 3;
        if (wallMode) {
          decalMesh.position.set(0, 1.38, -0.365);
        } else {
          decalMesh.rotation.x = -Math.PI * 0.5;
          decalMesh.position.set(0, 0.092, 0);
        }
        bay.add(decalMesh);
        hitMeshes.push(decalMesh);
      }

      const plaque = createPlaqueMesh({
        badge: `${wallMode ? 'WALL' : 'FLOOR'} · ${catKey}`,
        title: item.id,
        subtitle: `${item.width || 512}×${item.height || 512}${item.tintableGrayscale ? ' · 可染色' : ''}`,
        width: 2.25,
        height: 0.56,
        accentHex: '#f5b67a',
      });
      plaque.position.set(0, 0.36, 1.65);
      plaque.rotation.x = -0.52;
      bay.add(plaque);
      hitMeshes.push(plaque);

      group.add(bay);

      registerExhibit(exhibits, {
        id: item.id,
        workspace: 'decals',
        kind: 'cn_pbr',
        title: item.id,
        subtitle: `贴花 · ${catLabel}`,
        category: catKey,
        meta: {
          placement: wallMode ? '墙面 (Wall)' : '地面 (Floor)',
          resolution: `${item.width || 512}×${item.height || 512}`,
          tintable: item.tintableGrayscale ? '是 (灰度可染)' : '否',
          source: item.sourcePath || '-',
        },
        object: bay,
        hitMeshes,
        focusPos: [cx, wallMode ? 1.6 : 2.1, cz + 3.4],
        focusTarget: [cx, wallMode ? 1.35 : 0.15, cz - (wallMode ? 0.35 : 0)],
        focusRadius: 2.1,
      });
    }

    cursorZ += ROW_Z;
  }

  // Foliage Wing
  const foliageGroups = new Map();
  for (const f of foliage) {
    const cat = f.category || 'grass';
    if (!foliageGroups.has(cat)) foliageGroups.set(cat, []);
    foliageGroups.get(cat).push(f);
  }

  const foliageStartZ = cursorZ + 2.0;

  cursorZ = foliageStartZ;
  for (const [catKey, catItems] of foliageGroups.entries()) {
    const catLabel = formatCategoryLabel(catKey);
    const banner = createSectionBannerMesh({
      title: `植被 · ${catLabel}`,
      subtitle: `${catItems.length} 个 Alpha Cutout 2-Texture 植被卡片`,
      width: 5.0,
      height: 1.05,
      accentHex: '#84dc7d',
    });
    banner.position.set(-4.6, 0, cursorZ + 0.5);
    group.add(banner);

    const loaded = await loadItemAssets('/assets/cn/pbr_foliage', catItems);
    if (token !== getToken()) return { exhibits, viewpoints, summaryText: '', dispose: () => {} };

    for (let i = 0; i < catItems.length; i++) {
      const item = catItems[i];
      const assets = loaded[i];
      const cx = i * BAY_X;
      const cz = cursorZ;
      maxUsedX = Math.max(maxUsedX, cx + BAY_X);

      const bay = new THREE.Group();
      bay.position.set(cx, 0, cz);

      const bedGeo = buildBufferGeometryFromRaw(buildBeveledBoxRaw(2.5, 0.12, 2.5, 0, soilLayer));
      const bedMesh = new THREE.Mesh(bedGeo, worldMat.material);
      bedMesh.position.set(0, 0.06, 0);
      bedMesh.receiveShadow = true;
      bay.add(bedMesh);
      const hitMeshes = [bedMesh];

      if (assets) {
        const built = create2MapPbrMaterial({
          mode: 'foliage',
          assets,
          renderer,
        });
        disposables.push(built.material, built.colorTex, built.normRmTex);

        const imgW = assets.colorImg?.naturalWidth || 1;
        const imgH = assets.colorImg?.naturalHeight || 1;
        const aspect = imgW / Math.max(1, imgH);
        const h = 1.9;
        const w = h * aspect;

        const cardGeo = new THREE.PlaneGeometry(w, h);
        const cardA = new THREE.Mesh(cardGeo, built.material);
        cardA.position.set(0, 0.12 + h * 0.5, 0);
        cardA.castShadow = true;
        const cardB = new THREE.Mesh(cardGeo, built.material);
        cardB.position.set(0, 0.12 + h * 0.5, 0);
        cardB.rotation.y = Math.PI * 0.35;
        cardB.castShadow = true;
        const cardC = new THREE.Mesh(cardGeo, built.material);
        cardC.position.set(0, 0.12 + h * 0.5, 0);
        cardC.rotation.y = -Math.PI * 0.35;
        cardC.castShadow = true;

        bay.add(cardA, cardB, cardC);
        hitMeshes.push(cardA, cardB, cardC);
      }

      const plaque = createPlaqueMesh({
        badge: `FOLIAGE · ${catKey}`,
        title: item.id,
        subtitle: `${item.width || 512}×${item.height || 512} · Cutout`,
        width: 2.25,
        height: 0.56,
        accentHex: '#84dc7d',
      });
      plaque.position.set(0, 0.36, 1.55);
      plaque.rotation.x = -0.52;
      bay.add(plaque);
      hitMeshes.push(plaque);

      group.add(bay);

      registerExhibit(exhibits, {
        id: item.id,
        workspace: 'decals',
        kind: 'cn_foliage',
        title: item.id,
        subtitle: `植被卡片 · ${catLabel}`,
        category: catKey,
        meta: {
          mode: 'Alpha Cutout 双面交叉卡片',
          resolution: `${item.width || 512}×${item.height || 512}`,
          source: item.sourcePath || '-',
        },
        object: bay,
        hitMeshes,
        focusPos: [cx, 1.5, cz + 3.4],
        focusTarget: [cx, 1.0, cz],
        focusRadius: 2.0,
      });
    }

    cursorZ += ROW_Z;
  }

  const floorW = Math.max(60, maxUsedX + 20);
  const floorD = Math.max(60, cursorZ + 22);
  group.add(createStudioFloor({
    width: floorW,
    depth: floorD,
    centerX: maxUsedX * 0.45,
    centerZ: cursorZ * 0.45,
  }));

  viewpoints.foliage_wing = {
    label: `植被卡片展区 (${foliage.length})`,
    pos: [6, 5.2, cursorZ + 2.5],
    target: [6, 0.9, foliageStartZ + (cursorZ - foliageStartZ) * 0.4],
  };
  viewpoints.overview.pos = [maxUsedX * 0.45, 18, cursorZ + 12];
  viewpoints.overview.target = [maxUsedX * 0.45, 1.2, cursorZ * 0.45];

  return {
    exhibits,
    viewpoints,
    summaryText: `${decals.length} 个贴花 + ${foliage.length} 个植被卡片`,
    dispose() {
      for (const d of disposables) d?.dispose?.();
    },
  };
}

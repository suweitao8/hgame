import * as THREE from 'three';
import {
  buildBeveledBoxRaw,
  buildBufferGeometryFromRaw,
  ensurePbrGeometryAttributes,
} from '../realistic-pcg.js';
import {
  createPlaqueMesh,
  createSectionBannerMesh,
  createStudioFloor,
  formatCategoryLabel,
  registerExhibit,
} from './showcase-common.js';

const BAY_SPACING_X = 3.9;
const ROW_SPACING_Z = 9.6;

function createUnitSphereGeo(radius, layerId) {
  const geo = new THREE.SphereGeometry(radius, 28, 18);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * 2.0, uv.getY(i) * 1.0);
  }
  ensurePbrGeometryAttributes(geo, layerId, [1, 1, 1], 1.0);
  return geo;
}

export function buildMaterialShowcaseScene({
  group,
  texArray,
  worldMat,
  cutoutMat,
  glassMat,
} = {}) {
  const rawMaterials = Array.isArray(texArray?.table?.materials) ? texArray.table.materials : [];
  const items = rawMaterials.filter(m => m && m.slot && m.slot !== '__missing__');

  // Group materials by category preserving natural order
  const groupsMap = new Map();
  for (const m of items) {
    const cat = m.category || 'other';
    if (!groupsMap.has(cat)) groupsMap.set(cat, []);
    groupsMap.get(cat).push(m);
  }
  const categories = [...groupsMap.entries()];
  const maxCols = Math.max(1, ...categories.map(([, arr]) => arr.length));
  const rowCount = Math.max(1, categories.length);

  const worldWidth = Math.max(60, maxCols * BAY_SPACING_X + 28);
  const worldDepth = Math.max(60, rowCount * ROW_SPACING_Z + 28);
  const centerX = ((maxCols - 1) * BAY_SPACING_X) * 0.42;
  const centerZ = ((rowCount - 1) * ROW_SPACING_Z) * 0.5;

  group.add(createStudioFloor({
    width: worldWidth,
    depth: worldDepth,
    centerX,
    centerZ,
  }));

  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0x1e241e,
    roughness: 0.78,
    metalness: 0.25,
  });
  const pedestalGeo = new THREE.BoxGeometry(2.9, 0.14, 1.55);
  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8);

  const exhibits = [];
  const viewpoints = {
    overview: {
      label: `全部材质全景 (${items.length})`,
      pos: [centerX * 0.65, 22, centerZ + worldDepth * 0.44],
      target: [centerX * 0.65, 0.8, centerZ],
    },
    aisle_spine: {
      label: '分类走廊主通道',
      pos: [-7.5, 3.2, -3.5],
      target: [3.0, 1.6, 18.0],
    },
  };

  for (let rIdx = 0; rIdx < categories.length; rIdx++) {
    const [catKey, catItems] = categories[rIdx];
    const rowZ = rIdx * ROW_SPACING_Z;
    const catTitle = formatCategoryLabel(catKey);

    const banner = createSectionBannerMesh({
      title: catTitle,
      subtitle: `${catItems.length} 个 PBR 材质 · 立方体 / 球体 / 2.6m 样板砖`,
      width: 4.8,
      height: 1.05,
    });
    banner.position.set(-4.6, 0, rowZ + 0.4);
    group.add(banner);

    viewpoints[`cat:${catKey}`] = {
      label: `${catTitle} (${catItems.length})`,
      pos: [Math.min(3.9, (catItems.length - 1) * BAY_SPACING_X * 0.5), 2.8, rowZ + 6.4],
      target: [Math.min(3.9, (catItems.length - 1) * BAY_SPACING_X * 0.5), 0.75, rowZ],
    };

    for (let cIdx = 0; cIdx < catItems.length; cIdx++) {
      const entry = catItems[cIdx];
      const bx = cIdx * BAY_SPACING_X;
      const bz = rowZ;

      const booth = new THREE.Group();
      booth.position.set(bx, 0, bz);

      // Pedestal
      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      pedestal.position.set(0, 0.07, -0.85);
      pedestal.receiveShadow = true;
      pedestal.castShadow = true;
      booth.add(pedestal);

      const mat = entry.blendMode === 'translucent'
        ? glassMat.material
        : entry.alphaCutout
          ? cutoutMat.material
          : worldMat.material;

      // 1. 1.1m Cube (left)
      const cubeRaw = buildBeveledBoxRaw(1.1, 1.1, 1.1, 0, entry.layer);
      const cubeGeo = buildBufferGeometryFromRaw(cubeRaw);
      const cubeMesh = new THREE.Mesh(cubeGeo, mat);
      cubeMesh.position.set(-0.68, 0.14 + 0.55, -0.85);
      cubeMesh.castShadow = true;
      cubeMesh.receiveShadow = true;
      booth.add(cubeMesh);

      // 2. 0.52m Sphere (right)
      const sphereGeo = createUnitSphereGeo(0.52, entry.layer);
      const sphereMesh = new THREE.Mesh(sphereGeo, mat);
      sphereMesh.position.set(0.68, 0.14 + 0.54, -0.85);
      sphereMesh.castShadow = true;
      sphereMesh.receiveShadow = true;
      booth.add(sphereMesh);

      // 3. 2.6m x 2.4m Ground Swatch (front)
      const slabRaw = buildBeveledBoxRaw(2.6, 0.06, 2.4, 0, entry.layer);
      const slabGeo = buildBufferGeometryFromRaw(slabRaw);
      const slabMesh = new THREE.Mesh(slabGeo, mat);
      slabMesh.position.set(0, 0.03, 1.15);
      slabMesh.receiveShadow = true;
      booth.add(slabMesh);

      // 4. Front angled plaque
      const plaque = createPlaqueMesh({
        badge: `#${entry.layer} · ${entry.surfaceType || 'pbr'}`,
        title: entry.id,
        subtitle: `${entry.tiling || 'grid'} · uv×${entry.uvScale ?? 1} · ${entry.width || 1024}px`,
        width: 2.35,
        height: 0.62,
      });
      plaque.position.set(0, 0.44, 2.55);
      plaque.rotation.x = -0.52;
      const post = new THREE.Mesh(postGeo, pedestalMat);
      post.position.set(0, 0.22, 2.55);
      booth.add(plaque, post);

      group.add(booth);

      registerExhibit(exhibits, {
        id: entry.id,
        workspace: 'materials',
        kind: 'material',
        title: `${entry.id} (#${entry.layer})`,
        subtitle: `${formatCategoryLabel(catKey)} · ${entry.surfaceType || ''} · ${entry.tiling || 'grid'}`,
        category: catKey,
        meta: {
          layer: entry.layer,
          surfaceType: entry.surfaceType || '-',
          tiling: entry.tiling || 'grid',
          uvScale: entry.uvScale ?? 1,
          resolution: `${entry.width || 1024}×${entry.height || 1024}`,
          source: entry.sourcePath || entry.assetId || entry.source || '-',
        },
        object: booth,
        hitMeshes: [pedestal, cubeMesh, sphereMesh, slabMesh, plaque],
        focusPos: [bx, 2.05, bz + 4.3],
        focusTarget: [bx, 0.75, bz - 0.1],
        focusRadius: 2.4,
      });
    }
  }

  return {
    exhibits,
    viewpoints,
    summaryText: `${items.length} 个 PBR 材质 · ${categories.length} 个分类走廊`,
  };
}

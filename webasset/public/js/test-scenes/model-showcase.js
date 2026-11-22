import * as THREE from 'three';
import {
  applyCatalogMaterialToObject,
  createPlaqueMesh,
  createSectionBannerMesh,
  createStudioFloor,
  formatCategoryLabel,
  registerExhibit,
} from './showcase-common.js';

const MAX_ROW_WIDTH = 56;

export function detectMeshLodLevel(node) {
  if (typeof node?.userData?.lodLevel === 'number' && Number.isFinite(node.userData.lodLevel)) {
    return node.userData.lodLevel;
  }
  const n = String(node?.name || '');
  const m = /_lod([0-4])$/i.exec(n);
  return m ? Number(m[1]) : 0;
}

export function applyForcedLodToModel(root, lodMode = 'auto') {
  const target = lodMode === '1' ? 1 : lodMode === '2' ? 2 : lodMode === '3' ? 3 : 0;
  const meshes = [];
  const presentLevels = new Set();
  root.traverse(c => {
    if (!c.isMesh) return;
    const lvl = detectMeshLodLevel(c);
    meshes.push([c, lvl]);
    presentLevels.add(lvl);
  });
  let effectiveTarget = target;
  if (!presentLevels.has(effectiveTarget)) {
    let best = 0;
    for (const lvl of presentLevels) {
      if (lvl <= target && lvl > best) best = lvl;
    }
    effectiveTarget = presentLevels.has(best) ? best : ([...presentLevels][0] ?? 0);
  }
  for (const [c, lvl] of meshes) {
    c.visible = lvl === effectiveTarget;
  }
  return effectiveTarget;
}

export async function buildModelShowcaseScene({
  group,
  colliderGroup,
  cnCatalog,
  texArray,
  worldMat,
  cutoutMat,
  glassMat,
  backdropMat,
  wireframe = false,
  lodMode = 'auto',
  loadGlbCached,
  token,
  getToken,
} = {}) {
  const models = Array.isArray(cnCatalog?.models) ? cnCatalog.models : [];
  const groupsMap = new Map();
  for (const m of models) {
    const grp = m.group || 'l1_arch';
    if (!groupsMap.has(grp)) groupsMap.set(grp, []);
    groupsMap.get(grp).push(m);
  }

  const groupEntries = [...groupsMap.entries()];
  const exhibits = [];
  const modelRoots = [];
  const viewpoints = {
    overview: {
      label: `全部静态模型全景 (${models.length})`,
      pos: [24, 20, 48],
      target: [24, 2.0, 18],
    },
  };

  const padMat = new THREE.MeshStandardMaterial({ color: 0x20261f, roughness: 0.85, metalness: 0.2 });
  const colMat = new THREE.LineBasicMaterial({ color: 0x6ce57f });

  let cursorZ = 0;
  let maxUsedX = 48;

  for (const [grpKey, grpModels] of groupEntries) {
    const grpLabel = formatCategoryLabel(grpKey);
    const banner = createSectionBannerMesh({
      title: grpLabel,
      subtitle: `${grpModels.length} 个 GLB 资产 · L0/L1/L2 LOD 与包围盒检视`,
      width: 5.4,
      height: 1.1,
      accentHex: '#9fd7f9',
    });
    banner.position.set(-5.2, 0, cursorZ + 1.5);
    group.add(banner);

    viewpoints[`grp:${grpKey}`] = {
      label: `${grpLabel} (${grpModels.length})`,
      pos: [14, 5.5, cursorZ + 12.5],
      target: [14, 1.4, cursorZ],
    };

    let cursorX = 0;
    let subRowMaxDepth = 4;

    for (const entry of grpModels) {
      if (token !== getToken()) return { exhibits, viewpoints, modelRoots, summaryText: '' };
      const relPath = entry.path || entry.lods?.[0]?.path;
      if (!relPath) continue;

      const size = entry.bounds?.size || [2, 2, 2];
      const sx = Math.max(0.6, Number(size[0]) || 2);
      const sy = Math.max(0.6, Number(size[1]) || 2);
      const sz = Math.max(0.6, Number(size[2]) || 2);
      const cellW = Math.max(3.4, Math.min(26, sx + 2.2));
      const cellD = Math.max(3.6, Math.min(24, sz + 2.4));

      if (cursorX > 0 && cursorX + cellW > MAX_ROW_WIDTH) {
        cursorX = 0;
        cursorZ += subRowMaxDepth + 4.4;
        subRowMaxDepth = 4;
      }

      const cx = cursorX + cellW * 0.5;
      const cz = cursorZ;
      subRowMaxDepth = Math.max(subRowMaxDepth, cellD);
      cursorX += cellW + 1.2;
      maxUsedX = Math.max(maxUsedX, cursorX);

      let obj = null;
      try {
        obj = await loadGlbCached(`/assets/cn/${relPath}`);
      } catch {
        continue;
      }
      if (token !== getToken()) return { exhibits, viewpoints, modelRoots, summaryText: '' };

      if (entry.materialMode === 'backdrop_atlas' && backdropMat) {
        obj.traverse(c => {
          if (c.isMesh) {
            c.material = backdropMat;
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
      } else {
        applyCatalogMaterialToObject(obj, Object.values(entry.materialSlots || {})[0] || '__missing__', {
          texArray,
          worldMat,
          cutoutMat,
          glassMat,
          wireframe,
        });
        applyForcedLodToModel(obj, lodMode);
      }

      // Compute world bounding box at origin so model rests cleanly on plinth
      const box = new THREE.Box3().setFromObject(obj);
      const boxCenter = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      const minY = box.isEmpty() ? 0 : box.min.y;
      obj.position.set(cx - boxCenter.x, 0.06 - minY, cz - boxCenter.z);
      group.add(obj);
      modelRoots.push(obj);

      // Plinth pad
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(1.8, sx + 0.5), 0.06, Math.max(1.8, sz + 0.5)),
        padMat,
      );
      pad.position.set(cx, 0.03, cz);
      pad.receiveShadow = true;
      group.add(pad);

      // Collider wireframe
      if (colliderGroup) {
        const bSize = box.isEmpty() ? new THREE.Vector3(sx, sy, sz) : box.getSize(new THREE.Vector3());
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(bSize.x, bSize.y, bSize.z));
        const wire = new THREE.LineSegments(edges, colMat);
        wire.position.set(cx, 0.06 + bSize.y * 0.5, cz);
        colliderGroup.add(wire);
      }

      // Front plaque
      const lod0 = entry.lods?.[0] || {};
      const kb = entry.fileKB ?? lod0.fileKB ?? 0;
      const plaque = createPlaqueMesh({
        badge: `${entry.tier || grpKey} · ${lod0.tris || 0} tris`,
        title: entry.id,
        subtitle: `${sx.toFixed(1)}×${sy.toFixed(1)}×${sz.toFixed(1)}m · ${kb} KB`,
        width: 2.3,
        height: 0.6,
        accentHex: '#9fd7f9',
      });
      plaque.position.set(cx, 0.42, cz + Math.max(1.2, sz * 0.5 + 0.85));
      plaque.rotation.x = -0.5;
      group.add(plaque);

      const radius = Math.max(1.5, Math.hypot(sx, sy, sz) * 0.65);
      registerExhibit(exhibits, {
        id: entry.id,
        workspace: 'models',
        kind: 'model',
        title: entry.id,
        subtitle: `${grpLabel} · ${lod0.tris || 0} tris`,
        category: grpKey,
        meta: {
          tier: entry.tier || '-',
          tris: lod0.tris || 0,
          size: `${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)} m`,
          fileKB: `${kb} KB`,
          slots: Object.values(entry.materialSlots || {}).join(', ') || '-',
        },
        object: obj,
        hitMeshes: [...(() => {
          const ms = [pad, plaque];
          obj.traverse(c => { if (c.isMesh) ms.push(c); });
          return ms;
        })()],
        focusPos: [cx + radius * 0.55, Math.max(1.8, sy * 0.65 + radius * 0.45), cz + radius * 1.9],
        focusTarget: [cx, Math.max(0.5, sy * 0.45), cz],
        focusRadius: radius,
      });
    }

    cursorZ += subRowMaxDepth + 8.0;
  }

  const floorW = Math.max(70, maxUsedX + 26);
  const floorD = Math.max(70, cursorZ + 24);
  group.add(createStudioFloor({
    width: floorW,
    depth: floorD,
    centerX: maxUsedX * 0.45,
    centerZ: cursorZ * 0.45,
  }));

  viewpoints.overview.pos = [maxUsedX * 0.45, 22, cursorZ + 14];
  viewpoints.overview.target = [maxUsedX * 0.45, 2.0, cursorZ * 0.45];

  return {
    exhibits,
    viewpoints,
    modelRoots,
    summaryText: `${exhibits.length} 个静态 GLB · ${groupEntries.length} 个分类区`,
  };
}

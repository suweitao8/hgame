import * as THREE from 'three';
import {
  createPlaqueMesh,
  createSectionBannerMesh,
  createStudioFloor,
  registerExhibit,
} from './showcase-common.js';

const BAY_X = 3.8;
const ROW_Z = 7.2;
const COLS_PER_ROW = 8;
const MAX_SAFE_GLB_BYTES = 15 * 1024 * 1024;

function groundAndFitModel(root, targetHeight = 1.65) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return 1.0;
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(0.1, size.y);
  const scale = targetHeight / height;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = scaledBox.getCenter(new THREE.Vector3());
  root.position.set(-center.x, 0.14 - scaledBox.min.y, -center.z);
  return scaledBox.getSize(new THREE.Vector3()).y;
}

export async function buildCharacterShowcaseScene({
  group,
  gltfLoader,
  token,
  getToken,
} = {}) {
  const res = await fetch('/api/assets?category=characters:all&limit=120', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  if (token !== getToken()) return { exhibits: [], viewpoints: {}, mixers: [], summaryText: '', dispose: () => {} };

  const allChars = Array.isArray(payload.items) ? payload.items : [];
  const chars = allChars.filter(c => c?.models?.low?.url || c?.models?.high?.url || c?.assets?.[0]?.url);

  const rowCount = Math.max(1, Math.ceil(chars.length / COLS_PER_ROW));
  const usedCols = Math.min(COLS_PER_ROW, Math.max(1, chars.length));
  const centerX = ((usedCols - 1) * BAY_X) * 0.5;
  const centerZ = ((rowCount - 1) * ROW_Z) * 0.5;

  group.add(createStudioFloor({
    width: Math.max(48, usedCols * BAY_X + 24),
    depth: Math.max(48, rowCount * ROW_Z + 24),
    centerX,
    centerZ,
  }));

  const banner = createSectionBannerMesh({
    title: '角色展区',
    subtitle: `${chars.length} 个角色（低模实时 3D 动作 · 超大高模以参考立牌展示）`,
    width: 5.4,
    height: 1.05,
    accentHex: '#d5e4b4',
  });
  banner.position.set(-4.4, 0, 0);
  group.add(banner);

  const padMat = new THREE.MeshStandardMaterial({ color: 0x20261f, roughness: 0.82, metalness: 0.25 });
  const padGeo = new THREE.BoxGeometry(2.3, 0.14, 1.8);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x161a15, roughness: 0.75, metalness: 0.2 });
  const texLoader = new THREE.TextureLoader();

  const exhibits = [];
  const mixers = [];
  let loaded3dCount = 0;

  // Prefer low-poly GLB; allow high-poly only if compact (<= 15MB) to avoid OOM across many characters.
  await Promise.all(chars.map(async (ch, i) => {
    const col = i % COLS_PER_ROW;
    const row = Math.floor(i / COLS_PER_ROW);
    const cx = col * BAY_X;
    const cz = row * ROW_Z;

    const bay = new THREE.Group();
    bay.position.set(cx, 0, cz);

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, 0.07, 0);
    pad.receiveShadow = true;
    pad.castShadow = true;
    bay.add(pad);

    const hitMeshes = [pad];
    const lowModel = ch.models?.low;
    const highModel = ch.models?.high;
    const chosenModel = lowModel?.url
      ? { kind: 'LOW POLY', ...lowModel }
      : (highModel?.url && (!highModel.bytes || highModel.bytes <= MAX_SAFE_GLB_BYTES)
        ? { kind: 'HIGH POLY', ...highModel }
        : null);

    let modeLabel = chosenModel ? chosenModel.kind : (highModel?.url ? 'HIGH (点独立页检视)' : '参考图');

    if (chosenModel) {
      try {
        const gltf = await gltfLoader.loadAsync(chosenModel.url);
        if (token !== getToken()) return;
        const root = gltf.scene;
        root.traverse(n => {
          if (n.isMesh) {
            n.castShadow = true;
            n.receiveShadow = true;
            hitMeshes.push(n);
          }
        });
        groundAndFitModel(root, 1.65);
        bay.add(root);
        loaded3dCount += 1;

        if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations.find(c => /run/i.test(c.name)) || gltf.animations[0];
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
          mixers.push(mixer);
        }
      } catch {
        modeLabel = '加载失败';
      }
    } else {
      const thumbUrl = ch.generatedAssets?.[0]?.url || ch.assets?.[0]?.url || '';
      if (thumbUrl) {
        try {
          const tex = await texLoader.loadAsync(thumbUrl);
          if (token !== getToken()) return;
          tex.colorSpace = THREE.SRGBColorSpace;
          const aspect = (tex.image?.width || 1) / Math.max(1, tex.image?.height || 1);
          const h = 1.65;
          const w = Math.min(2.0, h * aspect);
          const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), frameMat);
          back.position.set(0, 0.14 + h * 0.5, -0.04);
          back.castShadow = true;
          const card = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ map: tex }),
          );
          card.position.set(0, 0.14 + h * 0.5, 0.0);
          bay.add(back, card);
          hitMeshes.push(back, card);
        } catch { /* ignore */ }
      }
    }

    if (token !== getToken()) return;

    const plaque = createPlaqueMesh({
      badge: modeLabel,
      title: ch.name || ch.id,
      subtitle: ch.id,
      width: 2.1,
      height: 0.54,
      accentHex: '#d5e4b4',
    });
    plaque.position.set(0, 0.36, 1.25);
    plaque.rotation.x = -0.5;
    bay.add(plaque);
    hitMeshes.push(plaque);

    group.add(bay);

    registerExhibit(exhibits, {
      id: ch.id,
      workspace: 'characters',
      kind: 'character',
      title: ch.name || ch.id,
      subtitle: `角色 · ${modeLabel}`,
      category: 'characters',
      meta: {
        id: ch.id,
        low: lowModel?.name || '无',
        high: highModel?.name || '无',
      },
      object: bay,
      hitMeshes,
      focusPos: [cx, 1.45, cz + 3.5],
      focusTarget: [cx, 0.95, cz],
      focusRadius: 2.0,
    });
  }));

  const viewpoints = {
    overview: {
      label: `全部角色全景 (${chars.length})`,
      pos: [centerX, 6.2, centerZ + rowCount * ROW_Z * 0.85 + 6],
      target: [centerX, 0.9, centerZ],
    },
    front_row: {
      label: '前排近景检视',
      pos: [Math.min(6, centerX), 2.1, 5.8],
      target: [Math.min(6, centerX), 1.0, 0],
    },
  };

  return {
    exhibits,
    viewpoints,
    mixers,
    summaryText: `${chars.length} 个角色 (${loaded3dCount} 个 3D 低模)`,
    dispose() {
      for (const m of mixers) m.stopAllAction();
    },
  };
}

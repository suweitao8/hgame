import * as THREE from 'three';
import {
  fitCharacterToIdentityScale,
  hideSecondaryLodNodes,
  resolveCharacterScaleSpec,
} from '../hgame-shared.js';
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
    subtitle: `${chars.length} 个角色 · 4档身高: 1.0m小动物 / 1.75m人 / 2.3m中型怪 / 3.0m大型怪`,
    width: 6.2,
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
    const charSpec = resolveCharacterScaleSpec(ch);
    const lowModel = ch.models?.low;
    const highModel = ch.models?.high;
    const chosenModel = lowModel?.url
      ? { kind: 'LOW POLY', ...lowModel }
      : (highModel?.url && (!highModel.bytes || highModel.bytes <= MAX_SAFE_GLB_BYTES)
        ? { kind: 'HIGH POLY', ...highModel }
        : null);

    let modeLabel = chosenModel ? chosenModel.kind : (highModel?.url ? 'HIGH (点独立页检视)' : '参考图');
    let fittedHeight = charSpec.height;

    if (chosenModel) {
      try {
        const gltf = await gltfLoader.loadAsync(chosenModel.url);
        if (token !== getToken()) return;
        const root = hideSecondaryLodNodes(gltf.scene);
        root.traverse(n => {
          if (n.isMesh && n.visible) {
            n.castShadow = true;
            n.receiveShadow = true;
            hitMeshes.push(n);
          }
        });
        const fitted = fitCharacterToIdentityScale(root, { ...ch, height: charSpec.height }, {
          groundY: 0.14,
          centerXZ: true,
        });
        fittedHeight = fitted.height;
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
          const h = charSpec.height;
          const w = Math.min(2.2, Math.max(0.32, h * aspect));
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

    const heightTag = `${fittedHeight.toFixed(2)}m`;
    const tierTag = `${charSpec.tierLabel} (${charSpec.tierHeight.toFixed(2)}m档)`;
    const plaque = createPlaqueMesh({
      badge: `${modeLabel} · ${charSpec.tierLabel} · ${heightTag}`,
      title: ch.name || ch.id,
      subtitle: `${charSpec.role} · ${ch.id}`,
      width: 1.95,
      height: 0.44,
      accentHex: '#d5e4b4',
    });
    plaque.position.set(0, 0.19, 1.24);
    plaque.rotation.x = -1.05;
    bay.add(plaque);
    hitMeshes.push(plaque);

    group.add(bay);

    const focusY = 0.14 + Math.max(0.28, fittedHeight * 0.55);
    const focusDist = Math.max(1.85, fittedHeight * 1.65 + 0.6);
    registerExhibit(exhibits, {
      id: ch.id,
      workspace: 'characters',
      kind: 'character',
      title: ch.name || ch.id,
      subtitle: `${tierTag} · ${heightTag} · ${modeLabel}`,
      category: 'characters',
      meta: {
        id: ch.id,
        体型档位: tierTag,
        身份定位: charSpec.role,
        标准身高: heightTag,
        low: lowModel?.name || '无',
        high: highModel?.name || '无',
      },
      object: bay,
      hitMeshes,
      focusPos: [cx, Math.max(0.95, fittedHeight * 0.9 + 0.35), cz + focusDist],
      focusTarget: [cx, focusY, cz],
      focusRadius: Math.max(1.15, fittedHeight * 1.1),
    });
  }));

  const viewpoints = {
    overview: {
      label: `全部角色全景 (${chars.length})`,
      pos: [centerX, 6.2, centerZ + rowCount * ROW_Z * 0.85 + 6],
      target: [centerX, 0.9, centerZ],
    },
    front_row: {
      label: '前排近景对比 (矮→高)',
      pos: [Math.min(5.7, centerX), 1.85, 6.4],
      target: [Math.min(5.7, centerX), 0.78, 0.1],
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

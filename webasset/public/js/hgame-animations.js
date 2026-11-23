import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  inspectModel3D,
  prepareAnimationClips,
} from '../runtime/hgame/integrations/model3d/helpers.js';
import {
  captureNodeTransforms,
  restoreNodeTransforms,
  retargetUnrealClips,
} from './hgame-retarget.js';
import {
  apiRequestJson,
  createSidebarSquareCard,
  createThreeViewport,
  hideSecondaryLodNodes,
  disposeObject3D,
  fetchAnim23Catalog,
  fetchHGameAssets,
  fetchUnrealCatalog,
  formatBytes,
  onHGameAssetsChanged,
  refreshHGameAssets,
} from './hgame-shared.js';

const ANIM_CATEGORY_ORDER = [
  '待机站姿',
  '步行与潜行',
  '跑步与冲刺',
  '跳跃与浮空',
  '闪避翻滚与滑步',
  '攀爬跑酷与游泳',
  '太刀与武士刀',
  '长剑与双刃',
  '长枪重锤与镰刀',
  '弓箭',
  '枪械射击',
  '法术与能量技',
  '拳击泰拳与咏春',
  '空手格斗招式',
  '高速连击 (Lucy)',
  '处决与暗杀',
  '格挡与防御',
  '受击与硬直',
  '死亡与倒地起身',
  '椅坐与吧台',
  '席地盘坐与台沿坐',
  '躺卧与睡眠',
  '生活劳作与职业行为',
  '拾取搬运与机关交互',
  '载具驾驶与上下车',
  '对话与社交情绪',
  '双人互动',
  '舞蹈与演唱',
  '怪物移动与爬行',
  '怪物攻击与受击',
  '怪物待机与行为',
  '其他动作',
];

const viewEl = document.querySelector('#animations-view');
const searchInput = document.querySelector('#hgame-anim-search');
const packFilterSelect = document.querySelector('#hgame-anim-pack-filter');
const addButton = document.querySelector('#hgame-anim-add-button');
const glbUploadInput = document.querySelector('#hgame-anim-glb-upload');
const listEl = document.querySelector('#hgame-anim-list');
const titleEl = document.querySelector('#hgame-anim-title');
const charDialogBtn = document.querySelector('#hgame-anim-character-dialog-button');
const deleteButton = document.querySelector('#hgame-anim-delete-button');

// 3D stage controls
const empty3d = document.querySelector('#hgame-anim-3d-empty');
const stage3d = document.querySelector('#hgame-anim-3d-stage');
const play3dBtn = document.querySelector('#hgame-anim-play-button');
const restart3dBtn = document.querySelector('#hgame-anim-restart-button');
const scrub3dInput = document.querySelector('#hgame-anim-scrub');
const speed3dSelect = document.querySelector('#hgame-anim-speed');
const loop3dInput = document.querySelector('#hgame-anim-loop');
const skeleton3dInput = document.querySelector('#hgame-anim-skeleton');
const rootLock3dInput = document.querySelector('#hgame-anim-root-lock');
const status3dEl = document.querySelector('#hgame-anim-3d-status');

// Character picker dialog
const characterDialog = document.querySelector('#hgame-character-picker-dialog');
const charDialogCloseBtn = document.querySelector('#hgame-char-dialog-close');
const charDialogSearchInput = document.querySelector('#hgame-char-dialog-search');
const charDialogPackSelect = document.querySelector('#hgame-char-dialog-pack');
const charDialogListEl = document.querySelector('#hgame-char-dialog-list');

let initialized = false;
let assetStore = { models: [] };
let selfCharacters = [];
let unrealCatalog = { available: false, animations: [] };
let active3dKind = '';
let active3dId = '';
let selectedCharacterId = '';
const ANIM_PAGE_SIZE = 200;
let animVisibleLimit = ANIM_PAGE_SIZE;

async function fetchSelfCharacters() {
  try {
    const res = await fetch('/api/assets?category=characters:all&limit=120');
    if (!res.ok) return [];
    const data = await res.json();
    const list = [];
    for (const ch of data.items || []) {
      const low = ch?.models?.low;
      if (low?.url) {
        list.push({
          id: `webasset:${ch.id}:low`,
          name: `${ch.name || ch.id}（低模）`,
          assetName: low.name || ch.id,
          pack: 'webasset',
          packLabel: '自建角色',
          url: low.url,
          isWebAsset: true,
        });
      }
    }
    return list;
  } catch {
    return [];
  }
}

function getAllStageCharacters() {
  return selfCharacters;
}

// 3D playback state
let viewport3d = null;
let loaded3dRoot = null;
let loadedStageKey = '';
let loadedRestTransforms = new Map();
let loadedStats = { boneCount: 0, meshCount: 0 };
let skeletonHelper = null;
let mixer = null;
let rawClips = [];
let activeUnrealAnimEntry = null;
let activeAction = null;
let activeClipIndex = 0;
let playing3d = true;
let load3dToken = 0;
const gltfLoader3d = new GLTFLoader();
const unrealClipCache = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getOrderedAnimCategories(anims) {
  const counts = new Map();
  for (const anim of anims) {
    const cat = anim.category || '其他动作';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const ordered = [];
  for (const cat of ANIM_CATEGORY_ORDER) {
    if (counts.has(cat)) {
      ordered.push({ category: cat, count: counts.get(cat) });
      counts.delete(cat);
    }
  }
  for (const [cat, count] of counts) {
    ordered.push({ category: cat, count });
  }
  return ordered;
}

function getOrderedAnimPacks(anims) {
  const counts = new Map();
  for (const anim of anims) {
    const pack = anim.pack || '其他动作包';
    counts.set(pack, (counts.get(pack) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([pack, count]) => ({ pack, count }))
    .sort((a, b) => a.pack.localeCompare(b.pack, 'en', { sensitivity: 'base' }));
}

function fillFilterSelect(selectEl, opts, fallback = 'all') {
  if (!selectEl) return;
  const prev = selectEl.value || fallback;
  selectEl.replaceChildren();
  for (const opt of opts) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    selectEl.append(el);
  }
  selectEl.value = opts.some(o => o.value === prev) ? prev : fallback;
}

function getCharacterPacks(chars) {
  const packs = new Map();
  for (const ch of chars) {
    const current = packs.get(ch.pack) || { pack: ch.pack, label: ch.packLabel || ch.pack, items: [] };
    current.items.push(ch);
    packs.set(ch.pack, current);
  }
  return [...packs.values()];
}

function ensureSelectedCharacter(chars) {
  if (!chars.some(c => c.id === selectedCharacterId)) {
    const preferred = chars.find(c => c.id === 'webasset:chouju:low') || chars[0];
    selectedCharacterId = preferred?.id || '';
  }
}

function populateAnimControls() {
  const unrealAnims = unrealCatalog.animations || [];
  const stageChars = getAllStageCharacters();
  const uploaded = assetStore.models || [];
  ensureSelectedCharacter(stageChars);

  const animPacks = getOrderedAnimPacks(unrealAnims);
  fillFilterSelect(packFilterSelect, [
    { value: 'all', label: `全部动作 (${unrealAnims.length + uploaded.length})` },
    ...getOrderedAnimCategories(unrealAnims).map(c => ({
      value: `cat:${c.category}`,
      label: `${c.category} (${c.count})`,
    })),
    ...animPacks.map(p => ({
      value: `pack:${p.pack}`,
      label: `动作包 · ${p.pack} (${p.count})`,
    })),
    { value: 'uploaded', label: `已上传 (${uploaded.length})` },
  ]);

  const packs = getCharacterPacks(stageChars);
  syncCharacterSwitchButtons();

  if (charDialogPackSelect) {
    const prevPack = charDialogPackSelect.value || 'all';
    charDialogPackSelect.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `全部角色包 (${stageChars.length})`;
    charDialogPackSelect.append(allOpt);
    for (const group of packs) {
      const opt = document.createElement('option');
      opt.value = group.pack;
      opt.textContent = `${group.label} (${group.items.length})`;
      charDialogPackSelect.append(opt);
    }
    charDialogPackSelect.value = packs.some(g => g.pack === prevPack) ? prevPack : 'all';
  }
}

function renderCharacterDialogList() {
  if (!charDialogListEl) return;
  const stageChars = getAllStageCharacters();
  const query = (charDialogSearchInput?.value || '').trim().toLowerCase();
  const packFilter = charDialogPackSelect?.value || 'all';

  const matches = stageChars.filter(ch => {
    if (packFilter !== 'all' && ch.pack !== packFilter) return false;
    if (!query) return true;
    return [ch.name, ch.assetName, ch.packLabel, ch.genre, ch.pack]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(query));
  });

  charDialogListEl.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = '没有匹配的角色';
    charDialogListEl.append(empty);
    return;
  }

  for (const ch of matches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item hgame-picker-card';
    btn.setAttribute('role', 'option');
    const isCurrent = ch.id === selectedCharacterId;
    btn.setAttribute('aria-selected', String(isCurrent));
    btn.setAttribute('aria-current', String(isCurrent));
    const subParts = [ch.packLabel || ch.pack];
    if (ch.boneCount) subParts.push(`${ch.boneCount} 骨`);
    btn.innerHTML = `
      <span class="hgame-item-thumb hgame-item-thumb-badge">自建</span>
      <span class="hgame-item-copy">
        <strong>${escapeHtml(ch.name)}</strong>
        <small>${escapeHtml(subParts.join(' · '))}</small>
      </span>
    `;
    btn.addEventListener('click', () => {
      applySelectedCharacter(ch.id);
      characterDialog?.close();
    });
    charDialogListEl.append(btn);
  }
}

const PREFERRED_DEFAULT_ANIM_ID = 'WudangSword_Animset__MM_Run_Fwd';

function syncCharacterSwitchButtons() {
  const stageChars = getAllStageCharacters();
  const disabled = active3dKind === 'uploaded' || stageChars.length <= 1;
  if (charDialogBtn) {
    const cur = stageChars.find(c => c.id === selectedCharacterId);
    charDialogBtn.disabled = stageChars.length === 0 || active3dKind === 'uploaded';
    charDialogBtn.textContent = cur ? cur.name : '角色';
    charDialogBtn.title = disabled ? '' : '点击选择角色（[ / ] 快切）';
  }
}

function getOrderedStageCharacterIds() {
  return getCharacterPacks(getAllStageCharacters()).flatMap(group => group.items.map(item => item.id));
}

function stepSelectedCharacter(delta) {
  const ids = getOrderedStageCharacterIds();
  if (ids.length <= 1) return;
  const currentIdx = ids.indexOf(selectedCharacterId);
  const baseIdx = currentIdx >= 0 ? currentIdx : 0;
  const nextIdx = (baseIdx + delta + ids.length) % ids.length;
  applySelectedCharacter(ids[nextIdx]);
}

function applySelectedCharacter(characterId) {
  if (!characterId) return;
  selectedCharacterId = characterId;
  syncCharacterSwitchButtons();
  if (active3dKind !== 'unreal' && (unrealCatalog.animations || []).length > 0) {
    const preferred = unrealCatalog.animations.find(a => a.id === PREFERRED_DEFAULT_ANIM_ID)
      || unrealCatalog.animations.find(a => a.id === 'MaleLocomotionSet__A_INP_Idle')
      || unrealCatalog.animations[0];
    active3dKind = 'unreal';
    active3dId = preferred.id;
    renderSidebarList();
  }
  void load3dAnimationAsset();
}

function openCharacterPickerDialog() {
  if (!characterDialog) return;
  renderCharacterDialogList();
  if (!characterDialog.open) characterDialog.showModal();
  const activeCard = charDialogListEl?.querySelector('[aria-current="true"]');
  if (activeCard) activeCard.scrollIntoView({ block: 'nearest' });
  charDialogSearchInput?.focus();
}

function resolveDefault3dSelection(unrealAnims, uploaded) {
  if (active3dKind === 'unreal' && unrealAnims.some(a => a.id === active3dId)) return;
  if (active3dKind === 'uploaded' && uploaded.some(u => u.id === active3dId)) return;
  if (unrealAnims.length > 0) {
    const preferred = unrealAnims.find(a => a.id === PREFERRED_DEFAULT_ANIM_ID)
      || unrealAnims.find(a => a.id === 'MaleLocomotionSet__A_INP_Idle')
      || unrealAnims[0];
    active3dKind = 'unreal';
    active3dId = preferred.id;
  } else if (uploaded.length > 0) {
    active3dKind = 'uploaded';
    active3dId = uploaded[0].id;
  } else {
    active3dKind = '';
    active3dId = '';
  }
}

function resetAnimListLimitAndRender() {
  animVisibleLimit = ANIM_PAGE_SIZE;
  renderSidebarList();
}

function renderSidebarList() {
  const query = searchInput.value.trim().toLowerCase();
  const filter = packFilterSelect?.value || 'all';
  const unrealAnims = unrealCatalog.animations || [];
  const uploaded = assetStore.models || [];
  resolveDefault3dSelection(unrealAnims, uploaded);

  const showUnreal = filter === 'all' || filter.startsWith('cat:') || filter.startsWith('pack:');
  const targetCategory = filter.startsWith('cat:') ? filter.slice('cat:'.length) : null;
  const targetPack = filter.startsWith('pack:') ? filter.slice('pack:'.length) : null;
  const showUploaded = filter === 'all' || filter === 'uploaded';

  const matchingUnreal = showUnreal
    ? unrealAnims.filter(item => {
        if (targetCategory && item.category !== targetCategory) return false;
        if (targetPack && (item.pack || '其他动作包') !== targetPack) return false;
        if (!query) return true;
        return [item.name, item.assetName, item.category, item.pack]
          .filter(Boolean)
          .some(v => v.toLowerCase().includes(query));
      })
    : [];
  const matchingUploaded = showUploaded
    ? uploaded.filter(item => !query || item.name.toLowerCase().includes(query))
    : [];

  listEl.innerHTML = '';
  if (matchingUnreal.length === 0 && matchingUploaded.length === 0) {
    listEl.innerHTML = `<p class="hgame-list-empty">没有匹配的 3D 动作，可切换分类、动作包或点击「＋」上传 GLB。</p>`;
    return;
  }

  if (matchingUnreal.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'hgame-list-heading';
    const baseHeading = unrealCatalog.rig === 'humanoid_23' ? '23 骨清洗动作库' : 'Unreal 动作库';
    const headingLabel = [targetCategory || baseHeading, targetPack].filter(Boolean).join(' · ');
    heading.textContent = `${headingLabel} (${matchingUnreal.length})`;
    listEl.append(heading);
    const visibleUnreal = matchingUnreal.slice(0, animVisibleLimit);
    const fragment = document.createDocumentFragment();
    for (const item of visibleUnreal) {
      const thumbLabel = item.rig === 'humanoid_23' ? '23' : 'UE';
      const { button } = createSidebarSquareCard({
        name: item.name,
        thumbUrl: item.thumb || item.thumbnail || '',
        badge: thumbLabel,
        active: active3dKind === 'unreal' && item.id === active3dId,
        onClick: () => {
          active3dKind = 'unreal';
          active3dId = item.id;
          renderSidebarList();
          void load3dAnimationAsset();
        },
      });
      fragment.append(button);
    }
    if (matchingUnreal.length > visibleUnreal.length) {
      const remaining = matchingUnreal.length - visibleUnreal.length;
      const nextStep = Math.min(ANIM_PAGE_SIZE, remaining);
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'hgame-list-more';
      moreBtn.textContent = `显示更多 (+${nextStep}，剩余 ${remaining})`;
      moreBtn.addEventListener('click', () => {
        animVisibleLimit += ANIM_PAGE_SIZE;
        renderSidebarList();
      });
      fragment.append(moreBtn);
    }
    listEl.append(fragment);
  }

  if (matchingUploaded.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'hgame-list-heading';
    heading.textContent = `已上传 GLB (${matchingUploaded.length})`;
    listEl.append(heading);
    for (const item of matchingUploaded) {
      const { button } = createSidebarSquareCard({
        name: item.name,
        badge: '3D',
        active: active3dKind === 'uploaded' && item.id === active3dId,
        onClick: () => {
          active3dKind = 'uploaded';
          active3dId = item.id;
          renderSidebarList();
          void load3dAnimationAsset();
        },
      });
      listEl.append(button);
    }
  }
}

function ensureViewport3d() {
  if (!viewport3d) {
    viewport3d = createThreeViewport(stage3d, { background: 0x161c15, grid: true, shadows: true });
  }
  return viewport3d;
}

function clear3dScene() {
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  activeAction = null;
  rawClips = [];
  activeUnrealAnimEntry = null;
  loadedStageKey = '';
  loadedRestTransforms = new Map();
  loadedStats = { boneCount: 0, meshCount: 0 };
  if (skeletonHelper) {
    viewport3d?.scene.remove(skeletonHelper);
    skeletonHelper.dispose?.();
    skeletonHelper = null;
  }
  if (loaded3dRoot) {
    viewport3d?.scene.remove(loaded3dRoot);
    disposeObject3D(loaded3dRoot);
    loaded3dRoot = null;
  }
}

function tick3d(dt) {
  if (mixer && playing3d) {
    mixer.update(dt * Number(speed3dSelect.value || 1));
    if (activeAction) {
      const dur = Math.max(activeAction.getClip().duration, 0.0001);
      scrub3dInput.value = ((activeAction.time % dur) / dur).toFixed(3);
    }
  }
}

function applyPreparedClip() {
  const sourceClips = active3dKind === 'unreal'
    ? (activeUnrealAnimEntry?.clips || [])
    : rawClips;

  if (!mixer || sourceClips.length === 0) {
    activeAction = null;
    scrub3dInput.value = '0';
    return;
  }

  const prepared = active3dKind === 'unreal'
    ? retargetUnrealClips(activeUnrealAnimEntry, loaded3dRoot, {
        targetRestSnapshot: loadedRestTransforms,
        stripRootMotion: rootLock3dInput.checked,
      })
    : prepareAnimationClips(THREE, sourceClips, {
        stripNamespace: true,
        stripRootMotion: rootLock3dInput.checked ? 'xz' : false,
      });

  if (prepared.length === 0) {
    activeAction = null;
    scrub3dInput.value = '0';
    return;
  }

  mixer.stopAllAction();
  restoreNodeTransforms(loaded3dRoot, loadedRestTransforms);
  const idx = Math.min(Math.max(activeClipIndex, 0), prepared.length - 1);
  activeClipIndex = idx;
  activeAction = mixer.clipAction(prepared[idx]);
  activeAction.setLoop(loop3dInput.checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  activeAction.clampWhenFinished = !loop3dInput.checked;
  activeAction.reset().play();
  play3dBtn.textContent = playing3d ? '暂停' : '播放';
}

async function fetchUnrealAnimEntry(animItem) {
  if (unrealClipCache.has(animItem.url)) {
    return unrealClipCache.get(animItem.url);
  }
  const gltf = await gltfLoader3d.loadAsync(animItem.url);
  const clips = Array.isArray(gltf.animations) ? gltf.animations : [];
  if (clips.length > 0 && clips[0]) {
    clips[0].name = animItem.name || clips[0].name;
  }
  gltf.scene.updateMatrixWorld(true);
  const entry = { scene: gltf.scene, clips };
  unrealClipCache.set(animItem.url, entry);
  return entry;
}

async function mountCharacterRoot(url, stageKey, vp, token) {
  const gltf = await gltfLoader3d.loadAsync(url);
  if (token !== load3dToken) {
    disposeObject3D(gltf.scene);
    return null;
  }
  clear3dScene();
  loaded3dRoot = hideSecondaryLodNodes(gltf.scene);
  loadedStageKey = stageKey;
  loadedRestTransforms = captureNodeTransforms(loaded3dRoot);
  vp.scene.add(loaded3dRoot);
  vp.frameObject(loaded3dRoot);

  const inspection = inspectModel3D(THREE, gltf);
  loadedStats = { boneCount: inspection.boneNames.length, meshCount: inspection.meshCount };
  if (inspection.boneNames.length > 0) {
    skeletonHelper = new THREE.SkeletonHelper(loaded3dRoot);
    skeletonHelper.visible = skeleton3dInput.checked;
    vp.scene.add(skeletonHelper);
  }
  mixer = new THREE.AnimationMixer(loaded3dRoot);
  return gltf;
}

async function load3dAnimationAsset() {
  const unrealAnims = unrealCatalog.animations || [];
  const stageChars = getAllStageCharacters();
  const uploaded = assetStore.models || [];
  resolveDefault3dSelection(unrealAnims, uploaded);

  if (active3dKind === 'unreal') {
    const animItem = unrealAnims.find(entry => entry.id === active3dId);
    const charItem = stageChars.find(entry => entry.id === selectedCharacterId) || stageChars[0];
    deleteButton.hidden = true;
    syncCharacterSwitchButtons();
    if (!animItem || !charItem) {
      clear3dScene();
      titleEl.textContent = '3D 动画';
      empty3d.hidden = false;
      stage3d.hidden = true;
      status3dEl.textContent = stageChars.length === 0 ? '暂无角色模型' : '暂无动画';
      return;
    }

    titleEl.textContent = `${charItem.name} × ${animItem.name}`;
    empty3d.hidden = true;
    stage3d.hidden = false;
    const vp = ensureViewport3d();
    const token = ++load3dToken;
    const targetStageKey = `char:${charItem.id}`;
    status3dEl.textContent = loadedStageKey === targetStageKey
      ? `正在套用动作「${animItem.name}」...`
      : `正在加载 ${charItem.name} 与动作「${animItem.name}」...`;

    try {
      const needsCharLoad = loadedStageKey !== targetStageKey || !loaded3dRoot || !mixer;
      const [, animEntry] = await Promise.all([
        needsCharLoad
          ? mountCharacterRoot(charItem.url, targetStageKey, vp, token)
          : Promise.resolve(true),
        fetchUnrealAnimEntry(animItem),
      ]);
      if (token !== load3dToken || !loaded3dRoot || !mixer) return;

      activeUnrealAnimEntry = animEntry;
      rawClips = animEntry.clips;
      activeClipIndex = 0;
      playing3d = true;
      applyPreparedClip();
      const dur = animEntry.clips[0]?.duration ? `${animEntry.clips[0].duration.toFixed(2)}s` : '';
      status3dEl.textContent = loadedStats.boneCount === 0
        ? `${charItem.name} 未含骨骼，无法套用动作`
        : `${charItem.packLabel || charItem.pack} · ${animItem.category}${dur ? ` · ${dur}` : ''} · ${loadedStats.boneCount} 骨 · ${loadedStats.meshCount} 网格`;

      if (!viewEl.hidden) {
        vp.start(tick3d);
        vp.resize();
      }
    } catch (error) {
      if (token !== load3dToken) return;
      status3dEl.textContent = error.message || '角色动作加载失败';
    }
    return;
  }

  const item = uploaded.find(entry => entry.id === active3dId);
  syncCharacterSwitchButtons();
  deleteButton.hidden = !item;
  if (!item) {
    clear3dScene();
    titleEl.textContent = '3D 动画';
    empty3d.hidden = false;
    stage3d.hidden = true;
    status3dEl.textContent = '';
    return;
  }

  titleEl.textContent = item.name;
  empty3d.hidden = true;
  stage3d.hidden = false;
  const vp = ensureViewport3d();
  const token = ++load3dToken;
  status3dEl.textContent = '正在加载 GLB 动画...';

  try {
    const gltf = await mountCharacterRoot(item.url, `uploaded:${item.id}`, vp, token);
    if (!gltf || token !== load3dToken) return;

    rawClips = Array.isArray(gltf.animations) ? gltf.animations : [];
    activeClipIndex = 0;
    if (rawClips.length > 0) {
      playing3d = true;
      applyPreparedClip();
      status3dEl.textContent = `${rawClips.length} 动画 · ${loadedStats.boneCount} 骨骼`;
    } else {
      mixer = null;
      status3dEl.textContent = `0 动画 · ${loadedStats.boneCount} 骨骼`;
    }

    if (!viewEl.hidden) {
      vp.start(tick3d);
      vp.resize();
    }
  } catch (error) {
    if (token !== load3dToken) return;
    status3dEl.textContent = error.message || 'GLB 动画加载失败';
  }
}

async function handleGlbUpload(file) {
  if (!file) return;
  status3dEl.textContent = `正在上传 ${file.name}...`;
  try {
    const query = new URLSearchParams({ name: file.name, kind: 'character' });
    const data = await apiRequestJson(`/api/hgame/models?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    active3dKind = 'uploaded';
    active3dId = data.item.id;
    await refreshHGameAssets();
    populateAnimControls();
    renderSidebarList();
    await load3dAnimationAsset();
  } catch (error) {
    status3dEl.textContent = error.message;
  }
}

async function deleteActiveAsset() {
  if (active3dKind !== 'uploaded' || !active3dId) return;
  await apiRequestJson(`/api/hgame/models/${encodeURIComponent(active3dId)}`, { method: 'DELETE' });
  active3dKind = '';
  active3dId = '';
  await refreshHGameAssets();
  populateAnimControls();
  renderSidebarList();
  await load3dAnimationAsset();
}

async function initAnimationsView() {
  if (!initialized) {
    initialized = true;

    searchInput.addEventListener('input', resetAnimListLimitAndRender);
    packFilterSelect?.addEventListener('change', resetAnimListLimitAndRender);
    addButton.addEventListener('click', () => glbUploadInput.click());
    glbUploadInput.addEventListener('change', () => {
      const file = glbUploadInput.files?.[0];
      glbUploadInput.value = '';
      void handleGlbUpload(file);
    });
    deleteButton.addEventListener('click', () => void deleteActiveAsset());

    window.addEventListener('webasset:step-anim-character', event => {
      if (!viewEl?.hidden) stepSelectedCharacter(event.detail?.delta || 1);
    });
    charDialogBtn?.addEventListener('click', openCharacterPickerDialog);
    charDialogCloseBtn?.addEventListener('click', () => characterDialog?.close());
    charDialogSearchInput?.addEventListener('input', renderCharacterDialogList);
    charDialogPackSelect?.addEventListener('change', renderCharacterDialogList);
    characterDialog?.addEventListener('click', event => {
      if (event.target === characterDialog) characterDialog.close();
    });

    play3dBtn.addEventListener('click', () => {
      playing3d = !playing3d;
      play3dBtn.textContent = playing3d ? '暂停' : '播放';
    });
    restart3dBtn.addEventListener('click', () => {
      if (activeAction) {
        activeAction.reset().play();
        playing3d = true;
        play3dBtn.textContent = '暂停';
      }
    });
    scrub3dInput.addEventListener('input', () => {
      if (!activeAction || !mixer) return;
      playing3d = false;
      play3dBtn.textContent = '播放';
      const dur = Math.max(activeAction.getClip().duration, 0.0001);
      activeAction.time = Number(scrub3dInput.value) * dur;
      mixer.update(0);
    });
    loop3dInput.addEventListener('change', applyPreparedClip);
    rootLock3dInput.addEventListener('change', applyPreparedClip);
    skeleton3dInput.addEventListener('change', () => {
      if (skeletonHelper) skeletonHelper.visible = skeleton3dInput.checked;
    });

    onHGameAssetsChanged(data => {
      assetStore = data;
      populateAnimControls();
      renderSidebarList();
    });
  }

  const [data, anim23Catalog, rawUnrealCatalog, webassetChars] = await Promise.all([
    fetchHGameAssets(),
    fetchAnim23Catalog(),
    fetchUnrealCatalog(),
    fetchSelfCharacters(),
  ]);
  assetStore = data;
  unrealCatalog = (anim23Catalog.available && anim23Catalog.animations.length > 0)
    ? anim23Catalog
    : rawUnrealCatalog;
  selfCharacters = webassetChars;
  populateAnimControls();
  renderSidebarList();
  await load3dAnimationAsset();
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'animations') {
    void initAnimationsView();
  } else {
    viewport3d?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  void initAnimationsView();
}

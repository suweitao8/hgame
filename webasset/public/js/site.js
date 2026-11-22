import { CharacterModelViewer } from './model-viewer.js';
import { createSidebarSquareCard } from './hgame-shared.js';

const ASSET_API = '';
const assetsView = document.querySelector('#assets-view');
const characterList = document.querySelector('#character-list');
const characterSearchInput = document.querySelector('#character-search');
const characterCreateButton = document.querySelector('#character-create-button');
const characterCreateDialog = document.querySelector('#character-create-dialog');
const characterCreateForm = document.querySelector('#character-create-form');
const characterCreateError = document.querySelector('#character-create-error');
const characterNameInput = characterCreateForm.elements.name;
const assetReferenceCount = document.querySelector('#asset-reference-count');
const assetResults = document.querySelector('#asset-results');
const assetSettings = document.querySelector('#asset-settings');
const assetEmpty = document.querySelector('#asset-empty');
const assetToast = document.querySelector('#asset-toast');
const assetAiResults = document.querySelector('#asset-ai-results');
const characterImageGenerateButton = document.querySelector('#character-image-generate-button');
const characterImageGeneratedAt = document.querySelector('#character-image-generated-at');
const characterModeTabs = [...document.querySelectorAll('.character-mode-tab')];
const assetModelTabs = [...document.querySelectorAll('.asset-model-tab')];
const assetModelUpload = document.querySelector('#asset-model-upload');
const assetModelUploadButton = document.querySelector('#asset-model-upload-button');
const assetModelFilename = document.querySelector('#asset-model-filename');
const assetModelEmpty = document.querySelector('#asset-model-empty');
const assetModelUvSource = document.querySelector('#asset-model-uv-source');
const assetModelUvSourceControls = document.querySelector('#asset-model-uv-source-controls');
const modelViewer = new CharacterModelViewer({
  stage: document.querySelector('#asset-model-stage'),
  uvCanvas: document.querySelector('#asset-model-uv-canvas'),
  uvSelect: document.querySelector('#asset-model-uv-mesh'),
  uvControls: document.querySelector('#asset-model-uv-controls'),
  runButton: document.querySelector('#asset-model-run'),
  status: document.querySelector('#asset-model-status'),
});

let characterLibraryLoaded = false;
let characterRequestVersion = 0;
let characters = [];
let activeCharacterId = null;
let assetToastTimer = 0;
let characterImageGenerationJob = null;
let characterImageGenerationPollTimer = 0;
let characterImageGenerationPollVersion = 0;
let selectedCharacterMode = 'default';
let selectedModelView = 'high';
let selectedUvSource = 'low';

assetModelUvSource.addEventListener('change', () => {
  selectedUvSource = assetModelUvSource.value;
  const character = characters.find(item => item.id === activeCharacterId);
  if (character && selectedModelView === 'uv') renderCharacterModels(character);
});

function selectModelView(view) {
  if (!['high', 'low', 'uv'].includes(view)) return;
  selectedModelView = view;
  for (const tab of assetModelTabs) {
    const selected = tab.dataset.modelView === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const character = characters.find(item => item.id === activeCharacterId);
  if (character) renderCharacterModels(character);
}

assetModelTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectModelView(tab.dataset.modelView));
  tab.addEventListener('keydown', event => {
    const count = assetModelTabs.length;
    const next = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index + count - 1) % count
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    assetModelTabs[next].focus();
    selectModelView(assetModelTabs[next].dataset.modelView);
  });
});

assetModelUploadButton.addEventListener('click', () => assetModelUpload.click());
assetModelUpload.addEventListener('change', async () => {
  const file = assetModelUpload.files?.[0];
  assetModelUpload.value = '';
  const id = activeCharacterId;
  const mode = selectedModelView;
  if (!file || !id || !['high', 'low'].includes(mode)) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showAssetToast('模型只支持 GLB 格式。请从建模工具导出包含贴图和动画的 .glb。');
    return;
  }
  if (file.size > 150 * 1024 * 1024) {
    showAssetToast('GLB 文件不能超过 150MB。');
    return;
  }
  assetModelUploadButton.disabled = true;
  assetModelUploadButton.textContent = '正在上传…';
  try {
    const params = new URLSearchParams({ characterId: id, mode, name: file.name });
    const response = await fetch('/api/character-models?' + params, {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf-binary' },
      body: file,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || '上传失败。');
    await loadCharacters();
    showAssetToast(`${mode === 'high' ? '高模' : '低模'}已保存：${file.name}`);
  } catch (error) {
    showAssetToast(error.message || '上传模型失败。');
  } finally {
    assetModelUploadButton.disabled = false;
    assetModelUploadButton.textContent = '上传 GLB';
  }
});

function renderCharacterModels(character) {
  const models = character.models || {};
  const mode = selectedModelView;
  const availableUvSources = ['low', 'high'].filter(key => models[key]);
  if (mode === 'uv' && !availableUvSources.includes(selectedUvSource)) {
    selectedUvSource = availableUvSources[0] || 'low';
  }
  assetModelUvSource.replaceChildren();
  for (const key of availableUvSources) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key === 'low' ? '低模' : '高模';
    assetModelUvSource.append(option);
  }
  assetModelUvSource.value = selectedUvSource;
  assetModelUvSourceControls.hidden = mode !== 'uv' || availableUvSources.length < 2;
  const model = mode === 'uv' ? models[selectedUvSource] : models[mode];
  assetModelUploadButton.hidden = mode === 'uv';
  assetModelFilename.textContent = model?.name || '';
  assetModelFilename.hidden = !model;
  if (model) {
    assetModelFilename.href = model.url;
    assetModelFilename.download = model.name;
  } else {
    assetModelFilename.removeAttribute('href');
  }
  modelViewer.clear();
  assetModelEmpty.hidden = Boolean(model);
  if (!model) {
    assetModelEmpty.textContent = mode === 'uv'
      ? '暂无模型，无法查看 UV。请先在「高模」或「低模」上传 GLB。'
      : `暂无${mode === 'high' ? '高模' : '低模'}。上传 GLB 后即可在这里查看。`;
    return;
  }
  void modelViewer.open(model.url, mode);
}

characterImageGenerateButton.addEventListener('click', () => {
  void startCharacterImageGeneration();
});

function currentGeneratedAsset(character) {
  return (Array.isArray(character?.generatedAssets) ? character.generatedAssets : [])
    .findLast(asset => (asset.mode === 'humanoid' ? 'humanoid' : 'default') === selectedCharacterMode);
}

function selectCharacterMode(mode) {
  if (!['default', 'humanoid'].includes(mode)) return;
  selectedCharacterMode = mode;
  for (const tab of characterModeTabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const character = characters.find(item => item.id === activeCharacterId);
  if (character) renderCharacterGeneratedAssets(character);
  renderCharacterGenerationControls();
}

characterModeTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectCharacterMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % characterModeTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + characterModeTabs.length - 1) % characterModeTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = characterModeTabs.length - 1;
    else return;
    event.preventDefault();
    characterModeTabs[nextIndex].focus();
    selectCharacterMode(characterModeTabs[nextIndex].dataset.mode);
  });
});

async function loadCharacters() {
  const requestVersion = ++characterRequestVersion;
  assetResults.replaceChildren();
  assetResults.classList.remove('asset-image-grid');
  assetEmpty.hidden = true;

  try {
    const params = new URLSearchParams({ category: 'characters:all', limit: '120' });
    const response = await fetch(ASSET_API + '/api/assets?' + params);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (requestVersion !== characterRequestVersion) return;

    characters = data.items || [];
    renderCharacterList();
    const initialCharacter = characters.find(character => character.id === activeCharacterId)
      || characters.find(character => character.id === 'chouju')
      || characters[0];
    if (initialCharacter) {
      selectCharacter(initialCharacter.id);
    } else {
      assetEmpty.textContent = '角色库中暂时没有可展示的图片。';
      assetEmpty.hidden = false;
    }
    characterLibraryLoaded = true;
  } catch (error) {
    if (requestVersion !== characterRequestVersion) return;
    characterList.replaceChildren();
    assetEmpty.textContent = '角色库暂时无法读取，请检查本地角色图片服务。';
    assetEmpty.hidden = false;
    console.error('Character library unavailable:', error);
  }
}

function renderCharacterList() {
  characterList.replaceChildren();
  const query = characterSearchInput.value.trim().toLocaleLowerCase();
  const filteredCharacters = query
    ? characters.filter(character => [character.id, character.name, ...(character.keywords || []), ...(character.aliases || [])]
      .some(value => String(value).toLocaleLowerCase().includes(query)))
    : characters;

  if (!filteredCharacters.length) {
    const empty = document.createElement('p');
    empty.className = 'asset-character-list-empty';
    empty.textContent = query ? '没有找到匹配的角色' : '还没有角色，点击上方新增';
    characterList.append(empty);
    return;
  }

  for (const character of filteredCharacters) {
    const thumbUrl = character.avatarUrl || character.assets?.[0]?.url || character.generatedAssets?.[0]?.url || '';
    const { button } = createSidebarSquareCard({
      name: character.name,
      thumbUrl,
      badge: character.name.slice(0, 2),
      active: character.id === activeCharacterId,
      className: 'asset-character-item',
      onClick: () => selectCharacter(character.id),
    });
    button.dataset.character = character.id;
    characterList.append(button);
  }
}

characterSearchInput.addEventListener('input', renderCharacterList);
characterCreateButton.addEventListener('click', () => {
  characterCreateForm.reset();
  characterCreateError.hidden = true;
  characterCreateError.textContent = '';
  characterCreateDialog.showModal();
  characterCreateForm.elements.name.focus();
});

characterCreateDialog.querySelector('[data-close-character-dialog]').addEventListener('click', () => {
  characterCreateDialog.close();
});
characterCreateDialog.addEventListener('click', event => {
  if (event.target === characterCreateDialog) characterCreateDialog.close();
});

characterCreateForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(characterCreateForm);
  const name = String(formData.get('name') || '').trim();

  characterCreateError.hidden = true;
  const submitButton = characterCreateForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '正在创建…';
  characterCreateButton.disabled = true;
  try {
    const response = await fetch(ASSET_API + '/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);

    activeCharacterId = result.character.id;
    characterSearchInput.value = '';
    characterCreateDialog.close();
    await loadCharacters();
    showAssetToast(`已新增角色：${result.character.name}`);
  } catch (error) {
    characterCreateError.textContent = error.message || '创建角色失败，请稍后重试。';
    characterCreateError.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '创建角色';
    characterCreateButton.disabled = false;
  }
});

function fitCharacterReferenceImage(image, frame) {
  const fit = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;

    const frameStyle = window.getComputedStyle(frame);
    const availableWidth = frame.clientWidth
      - Number.parseFloat(frameStyle.paddingLeft || 0)
      - Number.parseFloat(frameStyle.paddingRight || 0);
    const availableHeight = frame.clientHeight
      - Number.parseFloat(frameStyle.paddingTop || 0)
      - Number.parseFloat(frameStyle.paddingBottom || 0);
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const scale = Math.min(
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight,
    );
    image.style.width = `${Math.floor(image.naturalWidth * scale * 100) / 100}px`;
    image.style.height = `${Math.floor(image.naturalHeight * scale * 100) / 100}px`;
    image.dataset.fit = image.naturalHeight > image.naturalWidth ? 'portrait'
      : image.naturalWidth > image.naturalHeight ? 'landscape' : 'square';
  };

  image.addEventListener('load', fit);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    image.addEventListener('error', () => observer.disconnect(), { once: true });
  } else {
    window.addEventListener('resize', fit);
  }
  if (image.complete && image.naturalWidth) fit();
}

function selectCharacter(characterId) {
  const character = characters.find(item => item.id === characterId);
  if (!character) return;

  activeCharacterId = character.id;
  for (const button of characterList.querySelectorAll('.asset-character-item')) {
    button.setAttribute('aria-current', String(button.dataset.character === character.id));
  }

  const assets = (Array.isArray(character.assets) ? character.assets : []).slice(0, 4);
  assetReferenceCount.textContent = `${assets.length}/4 张`;
  assetResults.replaceChildren();
  assetSettings.replaceChildren();
  assetAiResults.replaceChildren();
  assetEmpty.hidden = true;

  for (const asset of assets) {
    const card = document.createElement('div');
    card.className = 'asset-character-card';

    const link = document.createElement('a');
    link.className = 'asset-character-image';
    link.href = ASSET_API + asset.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = asset.name;

    const image = document.createElement('img');
    image.alt = character.name + ' - ' + asset.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    fitCharacterReferenceImage(image, link);
    image.addEventListener('error', () => {
      card.remove();
      if (!assetResults.querySelector('.asset-character-image')) {
        assetEmpty.textContent = '该角色的参考图片暂时无法读取。';
        assetEmpty.hidden = false;
      }
    }, { once: true });
    image.src = ASSET_API + asset.url;

    link.append(image);
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'asset-character-delete';
    deleteButton.textContent = '×';
    deleteButton.title = `删除 ${asset.name}`;
    deleteButton.setAttribute('aria-label', `删除图片 ${asset.name}`);
    deleteButton.addEventListener('click', event => {
      event.stopPropagation();
      openAssetDeleteConfirmation(card, character, asset);
    });

    card.append(link, deleteButton);
    assetResults.append(card);
  }

  if (assets.length < 4) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'asset-character-add';
    addButton.textContent = '+';
    addButton.title = '粘贴参考图';
    addButton.setAttribute('aria-label', `为${character.name}粘贴参考图`);
    addButton.addEventListener('click', () => { void pasteCharacterImage(); });
    assetResults.append(addButton);
  }

  renderCharacterSettings(character);
  renderCharacterModels(character);
  renderCharacterGeneratedAssets(character);
  renderCharacterGenerationControls();
  void syncCharacterImageGenerationJob();

  if (!assets.length) {
    assetEmpty.textContent = '该角色还没有登记参考图片。';
    assetEmpty.hidden = false;
  }
}

function renderCharacterGeneratedAssets(character) {
  assetAiResults.replaceChildren();
  const asset = currentGeneratedAsset(character);
  if (!asset) {
    const empty = document.createElement('div');
    empty.className = 'asset-ai-form-empty';
    empty.textContent = selectedCharacterMode === 'humanoid'
      ? '暂无模型参考图。请先生成影视图，再以影视定稿为唯一标准生成模型前视图和侧视图。'
      : '暂无默认形态六视图，点击「AI 生图」生成角色设定稿。';
    assetAiResults.append(empty);
    return;
  }

  const card = document.createElement('article');
  card.className = 'asset-ai-card';

  const link = document.createElement('a');
  link.className = 'asset-ai-image-link';
  link.href = ASSET_API + asset.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = asset.name;

  const image = document.createElement('img');
  image.src = ASSET_API + asset.url;
  image.alt = `${character.name}${selectedCharacterMode === 'humanoid' ? '人形态双视图' : '默认形态六视图'}`;
  image.loading = 'lazy';
  image.decoding = 'async';
  link.append(image);

  card.append(link);
  assetAiResults.append(card);
}

function isCharacterImageGenerationActive(job) {
  return Boolean(job && ['queued', 'running'].includes(job.status));
}

function getCharacterImageGenerationPresentation(job, characterId) {
  const isActive = isCharacterImageGenerationActive(job);
  const isCurrentCharacterGenerating = Boolean(isActive && characterId && job.characterId === characterId);

  return {
    showStatus: isCurrentCharacterGenerating,
    disableGenerateButton: isActive,
    statusText: !isCurrentCharacterGenerating ? '' : job.status === 'queued' ? '排队中……' : '正在生成中……',
  };
}

function renderCharacterGenerationControls() {
  const job = characterImageGenerationJob;
  const generationPresentation = getCharacterImageGenerationPresentation(job, activeCharacterId);
  const character = characters.find(item => item.id === activeCharacterId);
  const generatedAsset = currentGeneratedAsset(character);
  const hasGeneratedImage = Boolean(generatedAsset);
  characterImageGeneratedAt.hidden = !generatedAsset?.createdAt;
  characterImageGeneratedAt.textContent = generatedAsset?.createdAt
    ? new Date(generatedAsset.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    : '';
  const requiresFilm = selectedCharacterMode === 'humanoid'
    && !(character?.generatedAssets || []).some(asset => asset.mode !== 'humanoid');
  characterImageGenerateButton.disabled = generationPresentation.disableGenerateButton || requiresFilm;
  characterImageGenerateButton.title = requiresFilm ? '请先生成「影视」AI 图' : '使用 Codex imagegen 生成当前视图';
  characterImageGenerateButton.textContent = generationPresentation.disableGenerateButton
    ? '正在生成…'
    : hasGeneratedImage ? '✦ 重新生图' : '✦ AI 生图';

  assetAiResults.querySelector('.asset-ai-generation-status')?.remove();
  if (generationPresentation.showStatus) {
    const status = document.createElement('div');
    status.className = 'asset-ai-generation-status';
    status.dataset.state = job.status;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = generationPresentation.statusText;
    assetAiResults.append(status);
  }
}

async function syncCharacterImageGenerationJob() {
  if (isCharacterImageGenerationActive(characterImageGenerationJob)) {
    renderCharacterGenerationControls();
    return;
  }
  try {
    const response = await fetch(ASSET_API + '/api/character-images/generate');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    if (result.job) {
      characterImageGenerationJob = result.job;
      renderCharacterGenerationControls();
      if (isCharacterImageGenerationActive(result.job)) {
        void pollCharacterImageGeneration(result.job.id);
      }
    } else {
      renderCharacterGenerationControls();
    }
  } catch (error) {
    console.warn('Unable to sync Codex image generation status:', error);
  }
}

async function startCharacterImageGeneration() {
  const character = characters.find(item => item.id === activeCharacterId);
  if (!character) {
    showAssetToast('请先选择一个角色。');
    return;
  }
  if (isCharacterImageGenerationActive(characterImageGenerationJob)) {
    showAssetToast('当前已有角色正在生图，请等待完成。');
    return;
  }

  characterImageGenerateButton.disabled = true;
  characterImageGenerateButton.textContent = '正在启动…';
  characterImageGenerationJob = {
    characterId: character.id,
    characterName: character.name,
    mode: selectedCharacterMode,
    status: 'queued',
    message: '正在准备角色参考图并启动 Codex imagegen……',
  };
  renderCharacterGenerationControls();

  try {
    const response = await fetch(ASSET_API + '/api/character-images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: character.id, mode: selectedCharacterMode }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409 && result.error === 'GENERATION_IN_PROGRESS') {
        const activeResponse = await fetch(ASSET_API + '/api/character-images/generate');
        const activeResult = await activeResponse.json().catch(() => ({}));
        if (activeResponse.ok && activeResult.job) {
          characterImageGenerationJob = activeResult.job;
          renderCharacterGenerationControls();
          await pollCharacterImageGeneration(activeResult.job.id);
          return;
        }
      }
      throw new Error(result.message || `HTTP ${response.status}`);
    }
    characterImageGenerationJob = result.job;
    renderCharacterGenerationControls();
    await pollCharacterImageGeneration(result.job.id);
  } catch (error) {
    characterImageGenerationJob = {
      characterId: character.id,
      characterName: character.name,
      status: 'failed',
      message: error.message || '无法启动 Codex 生图任务。',
    };
    renderCharacterGenerationControls();
    showAssetToast(`AI 生图启动失败：${error.message || error}`, 6000);
  }
}

async function pollCharacterImageGeneration(jobId) {
  const pollVersion = ++characterImageGenerationPollVersion;
  clearTimeout(characterImageGenerationPollTimer);

  const poll = async () => {
    if (pollVersion !== characterImageGenerationPollVersion) return;
    try {
      const params = new URLSearchParams({ jobId });
      const response = await fetch(ASSET_API + '/api/character-images/generate?' + params);
      const result = await response.json().catch(() => ({}));
      if (response.status === 404) {
        characterImageGenerationJob = {
          ...characterImageGenerationJob,
          status: 'failed',
          message: result.message || '本地生图任务已失效，请重新启动。',
        };
        renderCharacterGenerationControls();
        showAssetToast(characterImageGenerationJob.message, 6000);
        return;
      }
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (pollVersion !== characterImageGenerationPollVersion || !result.job) return;

      characterImageGenerationJob = result.job;
      renderCharacterGenerationControls();
      if (isCharacterImageGenerationActive(result.job)) {
        characterImageGenerationPollTimer = window.setTimeout(poll, 1800);
        return;
      }

      if (result.job.status === 'completed') {
        if (!activeCharacterId || activeCharacterId === result.job.characterId) {
          activeCharacterId = result.job.characterId;
        }
        await loadCharacters();
        showAssetToast(`「${result.job.characterName}」AI 形象已生成并保存。`, 5000);
      } else if (result.job.status === 'failed') {
        showAssetToast(`「${result.job.characterName}」生图失败：${result.job.error?.message || result.job.message}`, 7000);
      }
    } catch (error) {
      if (pollVersion !== characterImageGenerationPollVersion) return;
      if (characterImageGenerationJob) {
        characterImageGenerationJob.message = `读取生图进度失败：${error.message || error}；正在重试……`;
        renderCharacterGenerationControls();
      }
      characterImageGenerationPollTimer = window.setTimeout(poll, 3000);
    }
  };

  await poll();
}

function showAssetToast(message, duration = 3000) {
  assetToast.textContent = message;
  assetToast.hidden = false;
  clearTimeout(assetToastTimer);
  assetToastTimer = setTimeout(() => { assetToast.hidden = true; }, duration);
}

function openAssetDeleteConfirmation(card, character, asset) {
  assetResults.querySelectorAll('.asset-delete-confirmation').forEach(node => node.remove());
  const confirmation = document.createElement('div');
  confirmation.className = 'asset-delete-confirmation';
  const message = document.createElement('span');
  message.textContent = '删除角色库中的这张图片？旧项目原图不受影响。';
  const actions = document.createElement('div');
  actions.className = 'asset-delete-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'asset-delete-cancel';
  cancel.textContent = '取消';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'asset-delete-confirm';
  confirm.textContent = '删除';
  cancel.addEventListener('click', () => confirmation.remove());
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      const params = new URLSearchParams({ characterId: character.id, name: asset.name });
      const response = await fetch(ASSET_API + '/api/assets?' + params, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      activeCharacterId = character.id;
      await loadCharacters();
      showAssetToast(`已删除：${asset.name}`);
    } catch (error) {
      confirm.disabled = false;
      cancel.disabled = false;
      showAssetToast(`删除失败：${error.message || error}`);
    }
  });
  actions.append(cancel, confirm);
  confirmation.append(message, actions);
  card.append(confirmation);
}

async function uploadCharacterImages(characterId, files) {
  const picked = Array.from(files || []).filter(file => file && file.size > 0);
  if (!picked.length) return;
  const character = characters.find(item => item.id === characterId);
  if (!character) return;

  const availableSlots = Math.max(0, 4 - (Array.isArray(character.assets) ? character.assets.length : 0));
  if (availableSlots === 0) {
    showAssetToast('参考图最多 4 张，请先删除一张再添加。');
    return;
  }
  const accepted = picked.slice(0, availableSlots);
  if (accepted.length < picked.length) {
    showAssetToast(`参考图最多 4 张，本次只添加前 ${accepted.length} 张。`);
  }

  const addButton = assetResults.querySelector('.asset-character-add');
  if (addButton) addButton.disabled = true;
  let uploaded = 0;
  try {
    for (const file of accepted) {
      const params = new URLSearchParams({ characterId, name: file.name });
      const response = await fetch(ASSET_API + '/api/assets?' + params, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      uploaded += 1;
    }
    activeCharacterId = characterId;
    await loadCharacters();
    showAssetToast(`已添加 ${uploaded} 张图片`);
  } catch (error) {
    activeCharacterId = characterId;
    await loadCharacters();
    showAssetToast(`添加失败：${error.message || error}`);
  } finally {
    const selected = characters.find(item => item.id === activeCharacterId);
    const currentAddButton = assetResults.querySelector('.asset-character-add');
    if (currentAddButton) currentAddButton.disabled = !selected;
  }
}

async function readClipboardImageFiles(prefix) {
  if (!navigator.clipboard?.read) throw new Error('当前浏览器不支持读取图片剪贴板');
  const clipboardItems = await navigator.clipboard.read();
  const files = [];
  for (const item of clipboardItems) {
    const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value));
    if (!type) continue;
    const blob = await item.getType(type);
    const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
    files.push(new File([blob], `${prefix}-${Date.now()}-${files.length + 1}.${extension}`, { type }));
  }
  return files;
}

async function pasteCharacterImage() {
  if (!activeCharacterId) {
    showAssetToast('请先选择一个角色。');
    return;
  }
  try {
    const files = await readClipboardImageFiles('reference');
    if (!files.length) {
      showAssetToast('剪贴板里没有 PNG、JPG 或 WebP 图片。');
      return;
    }
    await uploadCharacterImages(activeCharacterId, files);
  } catch (error) {
    showAssetToast(`读取剪贴板失败：${error.message || error}。也可以直接 Ctrl+V。`, 5000);
  }
}

window.addEventListener('paste', event => {
  if (assetsView.hidden || !activeCharacterId) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const files = Array.from(event.clipboardData?.items || [])
    .filter(item => ['image/png', 'image/jpeg', 'image/webp'].includes(item.type))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  const stamp = Date.now();
  const namedFiles = files.map((file, index) => {
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
    return new File([file], `clipboard-${stamp}-${index + 1}.${extension}`, { type: file.type });
  });
  void uploadCharacterImages(activeCharacterId, namedFiles);
});

function renderCharacterSettings(character) {
  const settings = [
    { id: 'props', title: '道具', items: Array.isArray(character.props) ? character.props : [], empty: '暂无绑定道具' },
    { id: 'personality', title: '性格', items: Array.isArray(character.personality) ? character.personality : [], empty: '尚未设置性格' },
  ];
  const section = assetSettings.closest('.asset-settings-section');
  section.hidden = false;

  for (const setting of settings) {
    const card = document.createElement('article');
    card.className = `asset-setting-card asset-setting-card--${setting.id}`;

    const heading = document.createElement('div');
    heading.className = 'asset-setting-card-heading';
    const title = document.createElement('h3');
    title.textContent = setting.title;
    heading.append(title);

    const items = document.createElement('div');
    items.className = 'asset-setting-items asset-setting-tags';
    const values = setting.items
      .filter(item => typeof item === 'string' && item.trim())
      .map(item => item.trim());
    if (values.length) {
      for (const value of values) {
        const tag = document.createElement('span');
        tag.className = 'asset-setting-tag';
        tag.textContent = value;
        items.append(tag);
      }
    } else {
      const empty = document.createElement('span');
      empty.className = 'asset-setting-empty';
      empty.textContent = setting.empty;
      items.append(empty);
    }

    card.append(heading, items);
    assetSettings.append(card);
  }
}


window.addEventListener('webasset:open-asset', event => {
  const { workspace, id } = event.detail || {};
  if (workspace !== 'characters' || !id) return;
  activeCharacterId = id;
  if (characterLibraryLoaded) selectCharacter(id);
});

void loadCharacters();

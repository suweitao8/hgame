import { filterGames } from './game-search.mjs';
import { createGameHostBridge } from '../runtime/hgame/platform/engine.js';
import { createSidebarSquareCard } from './hgame-shared.js';

const WORKSPACE_VIEWS = {
  characters: document.querySelector('#assets-view'),
  games: document.querySelector('#games-view'),
  models: document.querySelector('#models-view'),
  animations: document.querySelector('#animations-view'),
  vfx: document.querySelector('#vfx-view'),
  materials: document.querySelector('#materials-view'),
  decals: document.querySelector('#decals-view'),
  audio: document.querySelector('#audio-view'),
  tests: document.querySelector('#tests-view'),
};
const navButtons = [...document.querySelectorAll('[data-workspace]')];
const gamesView = WORKSPACE_VIEWS.games;
const gameList = document.querySelector('#game-list');
const gameFrame = document.querySelector('#game-preview');
const gameSearch = document.querySelector('#game-search');
const gameStatus = document.querySelector('#game-status');
const gameHost = createGameHostBridge({
  frame: gameFrame,
  onMessage(message) {
    if (message.type === 'game:error') console.error('[WebAsset Game Runtime]', message.payload);
  },
});

let games = [];
let activeGameId = null;
let gamesLoaded = false;

function setStatus(message) {
  gameStatus.textContent = message || '';
}

function activeGame() {
  return games.find(game => game.id === activeGameId);
}

function workspaceFromHash() {
  const slug = location.hash.replace(/^#/, '');
  return Object.hasOwn(WORKSPACE_VIEWS, slug) ? slug : 'characters';
}

function setWorkspace(name) {
  const resolved = Object.hasOwn(WORKSPACE_VIEWS, name) ? name : 'characters';
  const showGames = resolved === 'games';
  for (const [key, element] of Object.entries(WORKSPACE_VIEWS)) {
    if (element) element.hidden = key !== resolved;
  }
  for (const button of navButtons) {
    const active = button.dataset.workspace === resolved;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (showGames) {
    if (!gamesLoaded) void loadGames();
    else if (activeGame()) openGame(activeGameId);
  } else {
    gameHost.stopSession();
    gameFrame.src = 'about:blank'; // Stop any running game and its audio.
  }
  window.dispatchEvent(new CustomEvent('webasset:workspace-change', { detail: { workspace: resolved } }));
}

navButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    const workspace = button.dataset.workspace;
    history.replaceState(null, '', workspace === 'characters' ? location.pathname + location.search : '#' + workspace);
    setWorkspace(workspace);
  });
  button.addEventListener('keydown', event => {
    const count = navButtons.length;
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index + count - 1) % count
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    navButtons[nextIndex].focus();
    navButtons[nextIndex].click();
  });
});
window.addEventListener('hashchange', () => setWorkspace(workspaceFromHash()));

function renderList() {
  gameList.replaceChildren();
  const visibleGames = filterGames(games, gameSearch.value);
  if (!visibleGames.length) {
    const message = document.createElement('span');
    message.className = 'game-list-empty';
    message.textContent = games.length ? '没有匹配的游戏' : '暂无游戏';
    gameList.append(message);
    return;
  }
  for (const game of visibleGames) {
    const { button } = createSidebarSquareCard({
      name: game.name,
      thumbUrl: game.thumbnail || game.icon || '',
      badge: game.name.slice(0, 2),
      active: game.id === activeGameId,
      className: 'game-item',
      onClick: () => openGame(game.id),
    });
    gameList.append(button);
  }
}
gameSearch.addEventListener('input', renderList);

function openGame(id) {
  activeGameId = id;
  const game = activeGame();
  renderList();
  gameFrame.hidden = !game;
  if (!game) {
    gameHost.stopSession();
    gameFrame.src = 'about:blank';
    return;
  }
  // Local HTML projects and uploaded games use the isolated game-only origin.
  const previewUrl = game.source === 'upload' || game.source === 'local'
    ? location.protocol + '//127.0.0.1:4175' + game.previewUrl
    : game.previewUrl;
  gameFrame.setAttribute('sandbox', game.source === 'upload' || game.source === 'local'
    ? 'allow-scripts allow-same-origin allow-pointer-lock allow-downloads'
    : 'allow-scripts allow-pointer-lock allow-downloads');
  if (game.runtimeId) {
    gameHost.startSession({ gameId: game.runtimeId, targetOrigin: new URL(previewUrl, location.href).origin });
  } else {
    gameHost.stopSession();
  }
  if (!gamesView.hidden) gameFrame.src = previewUrl;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || '操作失败（HTTP ' + response.status + '）');
  return data;
}

async function loadGames(preferredId) {
  try {
    const data = await jsonRequest('/api/games');
    games = data.items;
    gamesLoaded = true;
    const selection = games.some(game => game.id === preferredId) ? preferredId
      : games.some(game => game.id === activeGameId) ? activeGameId
        : games[0]?.id || null;
    openGame(selection);
  } catch (error) {
    setStatus('无法读取游戏：' + error.message);
  }
}

setWorkspace(workspaceFromHash());

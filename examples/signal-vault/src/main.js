import { loadRuntime, readGameJson, startPixiGame } from './engine/startPixiGame.js';
import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { createPuzzle } from './puzzle.js';
import { vaultFrames } from './art.js';

const keys = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
const frames = { '#': 'wall', '.': 'floor', closed: 'gate-closed', open: 'gate-open', a: 'socket-a', b: 'socket-b' };
const element = id => document.getElementById(id);

function setup({ app, renderer, Scene }, [{ TileMap }, rooms]) {
  const scene = app.scenes.add(new Scene('vault'));
  const save = app.services.save;
  const saved = save.get('room', 0);
  let index = Number.isInteger(saved) && saved >= 0 && saved < rooms.length ? saved : 0;
  let puzzle;
  let layer;
  let visibleCells = 0;
  let dirty = true;
  let gateOpen = false;
  let soundContext;
  let swipe;
  const listeners = new AbortController();
  const listener = { signal: listeners.signal };
  const canvas = renderer.app.canvas;
  renderer.grid.visible = false;

  function loadRoom() {
    swipe = null;
    layer?.dispose();
    puzzle = createPuzzle(TileMap, rooms[index]);
    for (const socket of puzzle.sockets) puzzle.map.set(socket.x, socket.y, socket.color);
    puzzle.map.set(puzzle.exit.x, puzzle.exit.y, 'closed');
    gateOpen = false;
    layer = renderer.createTilemapLayer(puzzle.map, { frames });
    const x = puzzle.map.width * puzzle.map.tileWidth / 2;
    const y = puzzle.map.height * puzzle.map.tileHeight / 2;
    renderer.camera.x = renderer.camera.targetX = x;
    renderer.camera.y = renderer.camera.targetY = y;
    dirty = true;
  }

  function draw() {
    const { width, height } = renderer.app.screen;
    renderer.camera.zoom = Math.min(1.24, (width - 22) / (puzzle.map.width * 64), (height - 96) / (puzzle.map.height * 64));
    renderer.camera.zoom = Math.max(0.1, renderer.camera.zoom);
    renderer.update(0);
    if (!dirty) return;
    dirty = false;
    const { state, map, exit } = puzzle;
    if (gateOpen !== state.open) {
      gateOpen = state.open;
      layer.setTile(exit.x, exit.y, gateOpen ? 'open' : 'closed');
    }
    renderer.syncEntity('operator', { ...map.tileToWorld(state.player.x, state.player.y), tex: 'operator', hasShadow: false });
    for (const [i, cell] of state.cells.entries()) {
      renderer.syncEntity('cell-' + i, { ...map.tileToWorld(cell.x, cell.y), tex: 'cell-' + cell.color, hasShadow: false });
    }
    for (let i = state.cells.length; i < visibleCells; i++) renderer.releaseEntity('cell-' + i);
    visibleCells = state.cells.length;
    element('room').textContent = String(index + 1).padStart(2, '0') + ' / ' + rooms.length;
    element('moves').textContent = '↗ ' + state.moves;
    element('undo').disabled = state.moves === 0;
    element('undo').hidden = state.won;
    element('hud').hidden = state.won;
    element('result').hidden = !state.won;
    if (state.won) {
      const last = index === rooms.length - 1;
      element('outcome').textContent = last ? '信号恢复' : '密室解锁';
      element('next').textContent = last ? '重开' : '下一关';
      element('next').focus();
    }
  }

  function unlockSound(event) {
    const audio = app.platform.audio;
    if (event.isTrusted && audio?.available && soundContext?.state !== 'running') {
      void audio.unlock().then(context => { soundContext = context; }).catch(() => {});
    }
  }

  function step(direction) {
    const wasOpen = puzzle.state.open;
    if (!puzzle.step(direction)) return;
    dirty = true;
    if (soundContext?.state === 'running') {
      app.platform.audio.playSynth(!wasOpen && puzzle.state.open ? 'powerup' : 'click', { volume: 0.25 });
    }
  }

  function undo() {
    if (!puzzle.state.won && puzzle.undo()) dirty = true;
  }

  window.addEventListener('keydown', event => {
    const direction = keys[event.code];
    if (!direction && event.code !== 'KeyZ') return;
    event.preventDefault();
    if (event.repeat) return;
    unlockSound(event);
    app.dispatch(direction ? { type: 'move', direction } : { type: 'undo' });
  }, listener);
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || swipe) return;
    canvas.setPointerCapture(event.pointerId);
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    unlockSound(event);
  }, listener);
  canvas.addEventListener('pointerup', event => {
    if (swipe?.id !== event.pointerId) return;
    const x = event.clientX - swipe.x;
    const y = event.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(x), Math.abs(y)) < 18) return;
    const direction = Math.abs(x) >= Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    app.dispatch({ type: 'move', direction });
  }, listener);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => { if (swipe?.id === event.pointerId) swipe = null; }, listener);
  }
  for (const type of ['undo', 'next']) {
    const button = element(type);
    let tapId;
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' && event.isPrimary) tapId = event.pointerId;
    }, listener);
    button.addEventListener('pointercancel', () => { tapId = undefined; }, listener);
    button.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch' || tapId !== event.pointerId) return;
      tapId = undefined;
      if (button.contains(document.elementFromPoint(event.clientX, event.clientY))) app.dispatch({ type });
    }, listener);
    button.addEventListener('click', event => {
      if (event.pointerType !== 'touch' && !event.sourceCapabilities?.firesTouchEvents) app.dispatch({ type });
    }, listener);
  }
  scene.onCommand = command => {
    if (command.type === 'move') step(command.direction);
    else if (command.type === 'undo') undo();
    else if (command.type === 'next' && puzzle.state.won) {
      index = (index + 1) % rooms.length;
      loadRoom();
      try { save.set('room', index); }
      catch (error) { console.warn('Could not save the current room:', error); }
    }
  };
  const stopDrawing = renderer.onBeforeRender(draw);
  scene.onDispose(() => { listeners.abort(); stopDrawing(); layer?.dispose(); });
  loadRoom();
  return {
    scene: scene.name,
    visibility: { resetInput: () => { swipe = null; } },
    state: () => ({ ...puzzle.state, room: index, rooms: rooms.length, backend: renderer.backend, frames: app.stats.frames }),
  };
}

await startPixiGame(setup, {
  createAtlas: () => createDefaultGameAtlas({ extraFrames: vaultFrames() }),
  loadResources: () => Promise.all([loadRuntime('world/tilemap.js'), readGameJson('./src/rooms.json')]),
});

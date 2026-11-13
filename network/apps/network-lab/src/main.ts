import { HGameLockstepChannel, HGameNetworkClient, type HGameRoomConnection } from '@hgame/network-client';
import { LockstepInputFlags } from '@hgame/network-protocol';
import { applyLinearMotionInput } from '@hgame/network-simulation';
import './style.css';

type Mode = 'state' | 'predicted' | 'lockstep';
type PlayerView = { slot: number; x?: number; y?: number; connected: boolean };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const endpointInput = $<HTMLInputElement>('endpoint');
const statusEl = $<HTMLDivElement>('connection-status');
const logEl = $<HTMLPreElement>('log');
const canvas = $<HTMLCanvasElement>('world');
const context = canvas.getContext('2d')!;
const emptyState = $<HTMLDivElement>('world-empty');
const modeTitle = $<HTMLHeadingElement>('mode-title');
const modeDescription = $<HTMLParagraphElement>('mode-description');
const connectButton = $<HTMLButtonElement>('connect');
const disconnectButton = $<HTMLButtonElement>('disconnect');

const network = () => new HGameNetworkClient({ endpoint: endpointInput.value.trim() });
let mode: Mode = 'state';
let connection: HGameRoomConnection | null = null;
let lockstep: HGameLockstepChannel | null = null;
let lockstepTimer: number | null = null;
let renderFrame = 0;
let axisX = 0;
let axisY = 0;
let nextLockstepTick = 1;
let predictedRoom: any = null;
let prediction: any = null;
let predictionInput: any = null;
let localPredictionAttached = false;
let currentPlayers: PlayerView[] = [];

function log(message: string): void {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent = `[${stamp}] ${message}\n${logEl.textContent}`.slice(0, 12000);
}

function setStatus(text: string, state: 'offline' | 'online' | 'error'): void {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function selectMode(next: Mode): void {
  mode = next;
  document.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === next);
  });
  $('state-controls').classList.toggle('hidden', next !== 'state');
  $('prediction-controls').classList.toggle('hidden', next !== 'predicted');
  $('lockstep-controls').classList.toggle('hidden', next !== 'lockstep');
  const copy = {
    state: ['A · 权威状态同步', '服务端维护状态，客户端只提交命令并接收权威 Schema 更新。'],
    predicted: ['B · 客户端预测同步', 'Colyseus 0.18 原生输入缓冲、预测、确认与回滚；服务端运行共享步进函数。'],
    lockstep: ['C · 确认帧同步', '客户端提交带序号和目标帧的二进制输入；服务器收齐当前玩家输入后才封帧。'],
  } as const;
  modeTitle.textContent = copy[next][0];
  modeDescription.textContent = copy[next][1];
}

function drawPlayers(players: PlayerView[]): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#26362c';
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 40) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 40) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
  }
  players.forEach((player) => {
    const x = canvas.width / 2 + (player.x ?? 0);
    const y = canvas.height / 2 + (player.y ?? 0);
    context.beginPath();
    context.arc(x, y, 10, 0, Math.PI * 2);
    context.fillStyle = player.connected ? '#8dc99b' : '#8a928c';
    context.fill();
    context.fillStyle = '#e8eee9';
    context.font = '12px sans-serif';
    context.fillText(String(player.slot), x + 14, y + 4);
  });
  emptyState.classList.toggle('hidden', players.length > 0);
}

function stopLocalLoops(): void {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  if (lockstepTimer !== null) window.clearInterval(lockstepTimer);
  lockstepTimer = null;
  lockstep?.dispose();
  lockstep = null;
  prediction = null;
  predictionInput = null;
  predictedRoom = null;
  localPredictionAttached = false;
  currentPlayers = [];
  drawPlayers([]);
}

async function disconnect(): Promise<void> {
  stopLocalLoops();
  if (connection) {
    try { await connection.leave(); } catch (error) { log(`断开时出现提示：${String(error)}`); }
  }
  connection = null;
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  $('increment').setAttribute('disabled', '');
  setStatus('未连接', 'offline');
  $('room-id').textContent = '未加入房间';
}

async function connectState(): Promise<void> {
  const conn = await network().joinOrCreate({ gameId: 'network-lab', roomName: 'lab_state_sync', resume: false });
  connection = conn;
  conn.onStateChange((state: any) => {
    $('counter').textContent = String(state.counter);
    $('revision').textContent = String(state.revision);
    $('state-players').textContent = String(state.players.size);
  });
  conn.onMessage('state:accepted', (payload: any) => log(`服务端接受命令：revision=${payload.revision}, counter=${payload.counter}`));
  conn.onMessage('state:rejected', (payload: any) => log(`命令被拒绝：${payload.reason}`));
  $('increment').removeAttribute('disabled');
  log(`已加入权威状态房间 ${conn.roomId}，Session=${conn.sessionId}`);
}

function attachPrediction(): void {
  if (!connection || !predictedRoom || !predictionInput || localPredictionAttached) return;
  const self = predictedRoom.state.players.get(predictedRoom.sessionId);
  if (!self) return;
  prediction.attachAll('players', { mode: 'lerp', fields: ['x', 'y'] });
  prediction.reconciler(self, {
    input: predictionInput,
    step: (ctx: { dt: number }, state: { x: number; y: number }, command: { moveX: number; moveY: number }) => {
      applyLinearMotionInput(state, command, ctx.dt);
    },
    smoothMs: 65,
  });
  localPredictionAttached = true;
  $('prediction-status').textContent = '已启动';
  log('预测控制器已绑定本地玩家；输入采样按服务器固定 Tick 执行。');
}

async function connectPredicted(): Promise<void> {
  const conn = await network().joinOrCreate({ gameId: 'network-lab', roomName: 'lab_predicted', resume: false });
  connection = conn;
  predictedRoom = conn.room;
  predictionInput = conn.input();
  if (!predictionInput) throw new Error('服务端没有声明 defineInput，无法启动预测');
  prediction = conn.prediction({ mode: 'lerp', delay: 100 });
  conn.onStateChange((state: any) => {
    $('server-tick').textContent = String(state.serverTick);
    attachPrediction();
    const players: PlayerView[] = [];
    for (const [sessionId, player] of state.players) {
      players.push({
        slot: player.slot,
        x: sessionId === predictedRoom.sessionId ? prediction.value(player, 'x') : prediction.value(player, 'x'),
        y: sessionId === predictedRoom.sessionId ? prediction.value(player, 'y') : prediction.value(player, 'y'),
        connected: player.connected,
      });
    }
    currentPlayers = players;
  });

  const frame = (now: number) => {
    if (connection !== conn) return;
    attachPrediction();
    if (localPredictionAttached) {
      const due = prediction.tick(now);
      for (let i = 0; i < due; i++) {
        predictionInput.data.moveX = axisX;
        predictionInput.data.moveY = axisY;
        predictionInput.send();
      }
    }
    drawPlayers(currentPlayers);
    renderFrame = requestAnimationFrame(frame);
  };
  renderFrame = requestAnimationFrame(frame);
  log(`已加入预测房间 ${conn.roomId}，使用 Colyseus 原生预测接口。`);
}

function encodeLabInput(x: number, y: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setInt8(0, x);
  view.setInt8(1, y);
  view.setUint16(2, 0, true);
  return bytes;
}

async function connectLockstep(): Promise<void> {
  const conn = await network().joinOrCreate({
    gameId: 'network-lab',
    roomName: 'lab_lockstep',
    roomOptions: { netHz: 20, maxClients: 16, reconnectSeconds: 0 },
    resume: false,
  });
  connection = conn;
  const roomState = conn.room.state as any;
  const player = await new Promise<any>((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error('等待服务器分配玩家槽位超时'));
    }, 5000);
    const check = () => {
      const assigned = roomState.players?.get(conn.sessionId);
      if (!assigned) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(assigned);
    };
    unsubscribe = conn.onStateChange(check);
    check();
  });
  const matchTag = roomState.matchTag as number;
  nextLockstepTick = (roomState.netTick as number) + 1;
  lockstep = new HGameLockstepChannel(conn, matchTag, nextLockstepTick);
  $('lockstep-slot').textContent = String(player.slot);
  lockstep.onFrame((frame) => {
    $('confirmed-tick').textContent = String(frame.netTick);
    $('frame-buffer').textContent = String(lockstep?.bufferedFrames ?? 0);
    currentPlayers = frame.inputs.map((input) => {
      const view = new DataView(input.payload.buffer, input.payload.byteOffset, input.payload.byteLength);
      return {
        slot: input.slot,
        x: view.byteLength >= 2 ? view.getInt8(0) * 35 : 0,
        y: view.byteLength >= 2 ? view.getInt8(1) * 35 : 0,
        connected: true,
      };
    });
    drawPlayers(currentPlayers);
  });
  conn.onMessage('lockstep:rejected', (payload: any) => log(`帧输入被拒绝：${payload.reason}`));
  conn.onMessage('lockstep:peer-desync', (payload: any) => log(`检测到客户端 Hash 不一致：Tick ${payload.netTick}（非权威诊断）`));
  conn.onStateChange((state: any) => {
    $('confirmed-tick').textContent = String(state.netTick);
    $('frame-buffer').textContent = String(lockstep?.bufferedFrames ?? 0);
  });

  lockstepTimer = window.setInterval(() => {
    if (!lockstep) return;
    const payload = encodeLabInput(axisX, axisY);
    if (axisX === 0 && axisY === 0) lockstep.sendNoOp(nextLockstepTick);
    else lockstep.sendInput(nextLockstepTick, payload, LockstepInputFlags.NONE);
    nextLockstepTick++;
  }, 50);
  log(`已加入确认帧房间 ${conn.roomId}，slot=${player.slot}，matchTag=${matchTag}。`);
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  try {
    await disconnect();
    connectButton.disabled = true;
    disconnectButton.disabled = false;
    setStatus('连接中…', 'offline');
    if (mode === 'state') await connectState();
    else if (mode === 'predicted') await connectPredicted();
    else await connectLockstep();
    setStatus('已连接', 'online');
    $('room-id').textContent = connection?.roomId ?? '—';
    disconnectButton.disabled = false;
  } catch (error) {
    connection = null;
    stopLocalLoops();
    setStatus('连接失败', 'error');
    log(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    connectButton.disabled = false;
    disconnectButton.disabled = true;
  }
});

disconnectButton.addEventListener('click', () => void disconnect());
$('increment').addEventListener('click', () => connection?.send('state:increment', { amount: 1 }));
$('clear-log').addEventListener('click', () => { logEl.textContent = ''; });
document.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((button) => {
  button.addEventListener('click', () => {
    if (connection) void disconnect();
    selectMode(button.dataset.mode as Mode);
  });
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyW' || event.code === 'ArrowUp') axisY = -1;
  if (event.code === 'KeyS' || event.code === 'ArrowDown') axisY = 1;
  if (event.code === 'KeyA' || event.code === 'ArrowLeft') axisX = -1;
  if (event.code === 'KeyD' || event.code === 'ArrowRight') axisX = 1;
});
window.addEventListener('keyup', (event) => {
  if ((event.code === 'KeyW' || event.code === 'ArrowUp') && axisY === -1) axisY = 0;
  if ((event.code === 'KeyS' || event.code === 'ArrowDown') && axisY === 1) axisY = 0;
  if ((event.code === 'KeyA' || event.code === 'ArrowLeft') && axisX === -1) axisX = 0;
  if ((event.code === 'KeyD' || event.code === 'ArrowRight') && axisX === 1) axisX = 0;
});
window.addEventListener('blur', () => { axisX = 0; axisY = 0; });
window.addEventListener('pagehide', () => { stopLocalLoops(); });

selectMode('state');
setStatus('未连接', 'offline');
log('验收页面已就绪。先启动服务端，再用两个浏览器标签页分别连接同一模式。');

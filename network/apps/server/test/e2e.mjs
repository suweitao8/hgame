import assert from 'node:assert/strict';
import { applyLinearMotionInput } from '@hgame/network-simulation';
import { HGameLockstepChannel, HGameNetworkClient } from '@hgame/network-client';

const endpoint = process.env.HGAME_NETWORK_URL ?? 'http://127.0.0.1:2567';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) return resolve(value);
        if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for network state'));
        setTimeout(poll, 20);
      } catch (error) { reject(error); }
    };
    poll();
  });
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const storageA = new MemoryStorage();
const storageB = new MemoryStorage();
const networkA = new HGameNetworkClient({ endpoint, storage: storageA });
const networkB = new HGameNetworkClient({ endpoint, storage: storageB });
const sessions = [];
const join = async (network, roomName, roomOptions = {}) => {
  const session = await network.joinOrCreate({
    gameId: 'network-e2e', roomName, roomOptions, resume: false,
  });
  sessions.push(session);
  return session;
};

try {
  // A — server-owned Schema state reaches both clients through the HGame client wrapper.
  const stateA = await join(networkA, 'lab_state_sync');
  const stateB = await join(networkB, 'lab_state_sync');
  await waitFor(() => stateA.room.state.players.size === 2 && stateB.room.state.players.size === 2);
  assert.ok(storageA.values.size > 0, 'room reconnection token should be namespaced and stored');
  let observedCounter = 0;
  let acceptedRevision = 0;
  stateB.onStateChange((state) => { observedCounter = state.counter; });
  stateA.onMessage('state:accepted', (payload) => { acceptedRevision = payload.revision; });
  stateB.onMessage('state:accepted', () => undefined);
  stateA.send('state:increment', { amount: 3 });
  await waitFor(() => observedCounter === 3 && acceptedRevision > 0);
  assert.equal(stateA.room.state.counter, 3);
  console.log('[e2e] A state sync + HGame client session: PASS');

  // B — native input buffering, Predict reconciler and shared step function.
  const predicted = await join(networkA, 'lab_predicted');
  await waitFor(() => predicted.room.state.players?.get(predicted.sessionId));
  const prediction = predicted.prediction({ mode: 'lerp', delay: 50 });
  const input = predicted.input();
  assert.ok(input, 'server should advertise defineInput');
  const self = predicted.room.state.players.get(predicted.sessionId);
  prediction.reconciler(self, {
    input,
    step: (ctx, state, command) => applyLinearMotionInput(state, command, ctx.dt),
    smoothMs: 0,
  });
  let elapsed = 0;
  while (elapsed < 1200 && self.x <= 0) {
    const due = prediction.tick(performance.now());
    for (let i = 0; i < due; i++) {
      input.data.moveX = 1;
      input.data.moveY = 0;
      input.send();
    }
    await wait(8);
    elapsed += 8;
  }
  await waitFor(() => predicted.room.state.players.get(predicted.sessionId)?.x > 0);
  assert.ok(self.x > 0);
  console.log('[e2e] B native prediction input + authoritative fixed step: PASS');

  // C — binary HGame channel; the server cannot seal until both slots submit.
  const lockOptions = { netHz: 20, maxClients: 16, reconnectSeconds: 0 };
  const lockA = await join(networkA, 'lab_lockstep', lockOptions);
  const lockB = await join(networkB, 'lab_lockstep', lockOptions);
  await waitFor(() => lockA.room.state.players.size === 2 && lockB.room.state.players.size === 2);
  const matchTag = lockA.room.state.matchTag;
  assert.equal(lockB.room.state.matchTag, matchTag);
  const targetNetTick = Math.max(lockA.room.state.netTick, lockB.room.state.netTick) + 1;
  const channelA = new HGameLockstepChannel(lockA, matchTag, targetNetTick);
  const channelB = new HGameLockstepChannel(lockB, matchTag, targetNetTick);
  const frameA = new Promise((resolve) => channelA.onFrame(resolve));
  const frameB = new Promise((resolve) => channelB.onFrame(resolve));

  channelA.sendInput(targetNetTick, new Uint8Array([1, 0]));
  await wait(80);
  assert.equal(lockA.room.state.netTick, targetNetTick - 1, "one player's input must not seal a frame");
  channelB.sendInput(targetNetTick, new Uint8Array([0, 1]));
  const [sealedA, sealedB] = await Promise.all([frameA, frameB]);
  assert.equal(sealedA.netTick, targetNetTick);
  assert.equal(sealedB.netTick, targetNetTick);
  assert.deepEqual(sealedA.inputs.map((item) => item.slot), [0, 1]);
  channelA.dispose();
  channelB.dispose();
  console.log('[e2e] C binary confirmed frame + HGame lockstep channel: PASS');

  await stateA.leave();
  assert.equal(storageA.values.has('hgame.network.v1:network-e2e:lab_state_sync'), false);
  console.log('HGame Network end-to-end checks passed.');
} finally {
  await Promise.all(sessions.map((session) => session.leave().catch(() => undefined)));
}

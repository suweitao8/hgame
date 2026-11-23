import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Client, CloseCode } from '@colyseus/sdk';
import {
  HGameLockstepChannel,
  HGameNetworkClient,
  HGameRoomConnection,
} from '@hgame/network-client';
import { hashInt32State } from '@hgame/network-protocol';
import { createConfirmedFrameScheduler } from '../../../../assets/runtime/lockstep/confirmed-frames.js';
import { createHGameNetworkServer } from '../dist/create-server.js';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function waitFor(predicate, timeoutMs = 6000, label = 'condition') {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`Timed out waiting for ${label}`)); return; }
      setTimeout(poll, 15);
    };
    poll();
  });
}

function createDeterministicLockstepWorld(playerIds = [0, 1]) {
  const state = new Int32Array([0, 0, 1234567, 0]); // [p0x, p1x, rng, logicTick]

  const computeHash = () => hashInt32State([state[0], state[1], state[2], state[3]]);

  const serialize = () => new Uint8Array(state.buffer.slice(0));

  const deserialize = (bytes) => {
    const view = new Int32Array(bytes.buffer, bytes.byteOffset, 4);
    state.set(view);
  };

  const scheduler = createConfirmedFrameScheduler({
    netHz: 20,
    logicHz: 40,
    playerIds,
    startBufferFrames: 1,
    maxBufferFrames: 64,
    maxReplayBufferFrames: 1024,
    simulate(inputs, info) {
      for (const input of inputs) {
        const idx = input.pid;
        state[idx] += (input.vx | 0) * 3 + ((input.buttons & 1) ? 10 : 0);
      }
      state[2] = (Math.imul(state[2], 1664525) + 1013904223) | 0;
      state[3] = info.logicTick;
    },
  });

  const decodeFrameForScheduler = (frame) => ({
    netTick: frame.netTick,
    inputs: frame.inputs.map((entry) => {
      const vx = entry.payload.byteLength >= 1 ? ((entry.payload[0] << 24) >> 24) : 0;
      const buttons = entry.payload.byteLength >= 2 ? entry.payload[1] : 0;
      return { pid: entry.slot, buttons, vx };
    }),
  });

  return { state, scheduler, computeHash, serialize, deserialize, decodeFrameForScheduler };
}

test('LockstepRoom allows zero-stall progress during short outage and cold reconnects with sequence & state parity', async () => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  await server.listen(port, '127.0.0.1');

  let connA = null;
  let connB = null;
  let chA = null;
  let chB = null;
  try {
    const clientA = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });
    const clientB = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });

    connA = await clientA.joinOrCreate({
      gameId: 'lockstep-commercial',
      roomName: 'lab_lockstep',
      roomOptions: {
        maxClients: 2,
        netHz: 20,
        reconnectSeconds: 15,
        frameDeadlineTicks: 0, // Even with deadline=0, disconnected slot must NOT stall online peer!
        maxHistoryFrames: 600,
      },
      resume: false,
    });
    connB = await clientB.joinById({
      gameId: 'lockstep-commercial',
      roomName: 'lab_lockstep',
      roomId: connA.roomId,
      resume: false,
    });

    await waitFor(
      () => connA.room.state?.matchTag > 0 && connA.room.state?.players?.size === 2 && connB.room.state?.players?.size === 2,
      4000,
      'room setup',
    );
    const matchTag = connA.room.state.matchTag;
    const reconnectTokenB = connB.reconnectionToken;

    const worldA = createDeterministicLockstepWorld([0, 1]);
    const worldB = createDeterministicLockstepWorld([0, 1]);

    const rejectedA = [];
    const rejectedB = [];
    connA.onMessage('lockstep:rejected', (r) => rejectedA.push(r));
    connB.onMessage('lockstep:rejected', (r) => rejectedB.push(r));

    chA = new HGameLockstepChannel(connA, matchTag, 1, 256, 1, { requestWelcomeOnStart: true });
    chB = new HGameLockstepChannel(connB, matchTag, 1, 256, 1, { requestWelcomeOnStart: true });

    chA.onFrame((frame) => {
      worldA.scheduler.enqueue(worldA.decodeFrameForScheduler(frame), { replay: true });
      worldA.scheduler.fastForward();
    });
    chB.onFrame((frame) => {
      worldB.scheduler.enqueue(worldB.decodeFrameForScheduler(frame), { replay: true });
      worldB.scheduler.fastForward();
    });

    // Ping/Pong RTT measurement check
    chA.ping();
    await waitFor(() => chA.recommendedLeadTicks >= 1 && chA.serverTick >= 0, 2000, 'pong telemetry');

    // Run 5 frames together
    for (let t = 1; t <= 5; t++) {
      chA.sendInput(t, new Uint8Array([1, 1]));
      chB.sendInput(t, new Uint8Array([255, 0])); // -1 int8
    }
    await waitFor(
      () => worldA.scheduler.expectedNetTick === 6 && worldB.scheduler.expectedNetTick === 6,
      4000,
      'initial 5 shared frames',
    );
    assert.equal(worldA.computeHash(), worldB.computeHash());

    // Simulate unconsented app crash / network drop of Peer B (without graceful leave)
    const droppedAtTickB = worldB.scheduler.expectedNetTick - 1; // 5
    chB.dispose();
    connB.room.connection.close(CloseCode.MAY_TRY_RECONNECT); // unconsented drop triggers onDrop with allowReconnection

    // Peer A submits frames 6..18 while Peer B is offline: must seal immediately without stalling!
    for (let t = 6; t <= 18; t++) {
      chA.sendInput(t, new Uint8Array([1, (t % 3 === 0) ? 1 : 0]));
    }
    await waitFor(
      () => worldA.scheduler.expectedNetTick >= 19,
      4000,
      'Peer A continues unblocked while B is offline',
    );

    // Cold reconnect for Peer B using reconnectionToken and a brand-new HGameLockstepChannel
    const sdkBCold = new Client(`http://127.0.0.1:${port}`);
    const reconnectedRoomB = await sdkBCold.reconnect(reconnectTokenB);
    connB = new HGameRoomConnection(sdkBCold, reconnectedRoomB, null, 'cold-b');
    connB.onMessage('lockstep:rejected', (r) => rejectedB.push(r));

    // Notice worldB replays from droppedAtTickB + 1 with a fresh channel starting at firstSequence=1
    chB = new HGameLockstepChannel(connB, matchTag, droppedAtTickB + 1, 512, 1, {
      requestWelcomeOnStart: true,
    });
    let welcomeSeen = false;
    chB.onWelcome((w) => {
      welcomeSeen = true;
      assert.ok(w.lastInputSequence >= 5);
    });
    chB.onFrame((frame) => {
      worldB.scheduler.enqueue(worldB.decodeFrameForScheduler(frame), { replay: true });
      worldB.scheduler.fastForward();
    });

    await waitFor(
      () => welcomeSeen && worldB.scheduler.expectedNetTick >= 19,
      5000,
      'cold-reconnected Peer B catches up all missed frames',
    );
    assert.equal(worldB.computeHash(), worldA.computeHash(), 'hashes must match after cold reconnect catch-up');

    // Both resume live input seamlessly with zero sequence/window rejections
    const liveTarget = Math.max(chA.recommendTargetNetTick(), chB.recommendTargetNetTick(), 22);
    for (let t = 19; t < liveTarget; t++) {
      chA.sendNoOp(t);
      chB.sendNoOp(t);
    }
    chA.sendInput(liveTarget, new Uint8Array([1, 1]));
    chB.sendInput(liveTarget, new Uint8Array([1, 0]));
    await waitFor(
      () => worldA.scheduler.expectedNetTick > liveTarget && worldB.scheduler.expectedNetTick > liveTarget,
      5000,
      'post-reconnect live frames sealed for both players',
    );

    assert.deepEqual(rejectedA, []);
    assert.deepEqual(rejectedB, []);
    assert.equal(worldA.computeHash(), worldB.computeHash());
  } finally {
    try { chA?.dispose(); } catch {}
    try { chB?.dispose(); } catch {}
    await Promise.allSettled([connA?.leave(), connB?.leave()]);
    await server.gracefullyShutdown(false);
  }
});

test('LockstepRoom recovers evicted long outages using consensus-verified HGCP checkpoints', async () => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  await server.listen(port, '127.0.0.1');

  let connA = null;
  let connB = null;
  let chA = null;
  let chB = null;
  try {
    const clientA = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });
    const clientB = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });

    connA = await clientA.joinOrCreate({
      gameId: 'lockstep-checkpoint',
      roomName: 'lab_lockstep',
      roomOptions: {
        maxClients: 2,
        netHz: 20,
        reconnectSeconds: 15,
        maxHistoryFrames: 16,
        checkpointIntervalFrames: 8,
      },
      resume: false,
    });
    connB = await clientB.joinById({
      gameId: 'lockstep-checkpoint',
      roomName: 'lab_lockstep',
      roomId: connA.roomId,
      resume: false,
    });

    await waitFor(
      () => connA.room.state?.matchTag > 0 && connA.room.state?.players?.size === 2 && connB.room.state?.players?.size === 2,
      4000,
      'checkpoint room setup',
    );
    const matchTag = connA.room.state.matchTag;
    const reconnectTokenB = connB.reconnectionToken;

    const worldA = createDeterministicLockstepWorld([0, 1]);
    const worldB = createDeterministicLockstepWorld([0, 1]);
    const checkpointsA = new Map();

    chA = new HGameLockstepChannel(connA, matchTag, 1, 256, 1, { requestWelcomeOnStart: true });
    chB = new HGameLockstepChannel(connB, matchTag, 1, 256, 1, { requestWelcomeOnStart: true });

    chA.setCheckpointProvider(({ netTick }) => checkpointsA.get(netTick) ?? null);
    chA.onFrame((frame) => {
      worldA.scheduler.enqueue(worldA.decodeFrameForScheduler(frame), { replay: true });
      worldA.scheduler.fastForward();
      if (frame.netTick % 8 === 0) {
        const hash = worldA.computeHash();
        checkpointsA.set(frame.netTick, worldA.serialize());
        chA.reportHash(frame.netTick, hash);
      }
    });
    chB.onFrame((frame) => {
      worldB.scheduler.enqueue(worldB.decodeFrameForScheduler(frame), { replay: true });
      worldB.scheduler.fastForward();
      if (frame.netTick % 8 === 0) {
        chB.reportHash(frame.netTick, worldB.computeHash());
      }
    });

    // Run 8 frames together so both reach consensus and store checkpoint at tick 8
    for (let t = 1; t <= 8; t++) {
      chA.sendInput(t, new Uint8Array([1, 1]));
      chB.sendInput(t, new Uint8Array([1, 0]));
    }
    await waitFor(
      () => worldA.scheduler.expectedNetTick === 9 && worldB.scheduler.expectedNetTick === 9,
      4000,
      'tick 8 consensus',
    );
    assert.equal(worldA.computeHash(), worldB.computeHash());

    // Peer B disconnects for a long outage (30 ticks > maxHistoryFrames=16)
    chB.dispose();
    connB.room.connection.close(CloseCode.MAY_TRY_RECONNECT);

    for (let t = 9; t <= 36; t++) {
      chA.sendInput(t, new Uint8Array([1, (t % 2 === 0) ? 1 : 0]));
      // Keep steady pace so checkpoints at 16, 24, 32 are requested and uploaded
      if (t % 8 === 0) await new Promise((r) => setTimeout(r, 80));
    }
    await waitFor(
      () => worldA.scheduler.expectedNetTick >= 37,
      6000,
      'Peer A advances past history eviction window',
    );

    // Cold-reconnect Peer B asking from tick 9 (which is already evicted from the 16-frame window!)
    const sdkBCold = new Client(`http://127.0.0.1:${port}`);
    const reconnectedRoomB = await sdkBCold.reconnect(reconnectTokenB);
    connB = new HGameRoomConnection(sdkBCold, reconnectedRoomB, null, 'cold-b-cp');
    chB = new HGameLockstepChannel(connB, matchTag, 9, 512, 1, { requestWelcomeOnStart: true });

    let restoredCheckpointTick = 0;
    chB.onCheckpoint((cp) => {
      worldB.deserialize(cp.payload);
      worldB.scheduler.restoreCheckpoint({ netTick: cp.netTick });
      restoredCheckpointTick = cp.netTick;
    });
    chB.onFrame((frame) => {
      worldB.scheduler.enqueue(worldB.decodeFrameForScheduler(frame), { replay: true });
      worldB.scheduler.fastForward();
    });

    await waitFor(
      () => restoredCheckpointTick >= 24 && worldB.scheduler.expectedNetTick >= 37,
      6000,
      'Peer B recovers via HGCP checkpoint + tail frames',
    );
    assert.equal(worldB.computeHash(), worldA.computeHash(), 'long-outage checkpoint recovery must converge bit-identically');
  } finally {
    try { chA?.dispose(); } catch {}
    try { chB?.dispose(); } catch {}
    await Promise.allSettled([connA?.leave(), connB?.leave()]);
    await server.gracefullyShutdown(false);
  }
});

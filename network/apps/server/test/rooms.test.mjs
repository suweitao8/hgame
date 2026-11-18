import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Client } from '@colyseus/sdk';
import { HGameLockstepChannel, HGameNetworkClient } from '@hgame/network-client';
import {
  LockstepInputFlags,
  decodeConfirmedFrame,
  encodeLockstepInput,
} from '@hgame/network-protocol';
import { createHGameNetworkServer } from '../dist/create-server.js';
import { LockstepRoom } from '../dist/rooms/LockstepRoom.js';

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

function waitFor(predicate, timeoutMs = 4000, label = 'condition') {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function createInterruptibleProxy(port) {
  const peers = new Set();
  let accepting = true;
  const server = net.createServer((client) => {
    if (!accepting) {
      client.destroy();
      return;
    }
    const remote = net.connect(port, '127.0.0.1');
    const disconnect = () => {
      peers.delete(disconnect);
      client.destroy();
      remote.destroy();
    };
    peers.add(disconnect);
    for (const socket of [client, remote]) {
      socket.on('error', disconnect);
      socket.once('close', disconnect);
    }
    client.pipe(remote).pipe(client);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const interrupt = () => {
    accepting = false;
    for (const disconnect of peers) disconnect();
  };
  return {
    port: server.address().port,
    interrupt,
    resume() { accepting = true; },
    async close() {
      interrupt();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('StateSyncRoom enforces per-session TokenBucketRateLimiter and rejects floods', async () => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  // Ensure clean test isolation
  await server.listen(port, '127.0.0.1');

  let room = null;
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    room = await client.joinOrCreate('lab_state_sync', {
      maxCommandsPerSecond: 5,
      commandBurst: 2,
    });

    const accepted = [];
    const rejected = [];
    room.onMessage('state:accepted', (msg) => accepted.push(msg));
    room.onMessage('state:rejected', (msg) => rejected.push(msg));

    for (let i = 0; i < 6; i++) {
      room.send('state:increment', { amount: 1 });
    }

    await waitFor(
      () => accepted.length === 2 && rejected.length >= 1,
      4000,
      'rate-limited responses',
    );

    assert.equal(accepted.length, 2);
    assert.equal(accepted[0].counter, 1);
    assert.equal(accepted[1].counter, 2);
    assert.ok(rejected.some((msg) => msg.reason === 'rate limit exceeded'));
  } finally {
    if (room) await room.leave().catch(() => {});
    await server.gracefullyShutdown(false);
  }
});

test('LockstepRoom drops a congested socket and retains ordered frames for replay', () => {
  const room = new LockstepRoom();
  room.maxClients = 2;
  room.state.matchTag = 1;

  const liveTicks = [];
  let terminations = 0;
  const healthy = {
    sessionId: 'healthy',
    ref: { bufferedAmount: 0 },
    send() {},
    sendBytes: (_type, bytes) => liveTicks.push(decodeConfirmedFrame(bytes).netTick),
  };
  const slow = {
    sessionId: 'slow',
    ref: { bufferedAmount: 1024 * 1024 - 1, terminate: () => { terminations++; } },
    sendBytes: () => assert.fail('A congested socket must not receive additional frames'),
  };

  for (const client of [healthy, slow]) {
    room.clients.push(client);
    room.onJoin(client);
    for (const tick of [1, 2]) {
      room.receiveInput(client, encodeLockstepInput({
        matchTag: 1,
        sequence: tick,
        targetNetTick: tick,
        payload: new Uint8Array(0),
      }));
    }
  }

  room.sealAvailableFrames();

  assert.equal(terminations, 1);
  assert.equal(room.state.players.get(slow.sessionId).connected, false);
  assert.equal(room.state.netTick, 2);
  assert.deepEqual(liveTicks, [1, 2]);

  liveTicks.length = 0;
  room.handleSyncRequest(healthy, { fromNetTick: 1 });
  assert.deepEqual(liveTicks, [1, 2]);
});

test('LockstepRoom reconnects after a TCP outage and recovers only retained history', async (t) => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  await server.listen(port, '127.0.0.1');
  try {
    for (const { label, maxHistoryFrames, evicted } of [
      { label: 'replays retained frames in order', maxHistoryFrames: 240, evicted: false },
      { label: 'reports an expired prefix once', maxHistoryFrames: 16, evicted: true },
    ]) {
      await t.test(label, async () => {
        const proxy = await createInterruptibleProxy(port);
        let host;
        let peer;
        let channel;
        try {
          const hostClient = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}` });
          const peerClient = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${proxy.port}` });
          const joinOptions = { gameId: 'lockstep-outage', roomName: 'lab_lockstep', resume: false };
          host = await hostClient.joinOrCreate({ ...joinOptions, roomOptions: {
            maxClients: 2, netHz: 30, frameDeadlineTicks: 1, maxHistoryFrames, reconnectSeconds: 10,
          } });
          host.onMessage('lockstep:frame', () => {});
          peer = await peerClient.joinById({ ...joinOptions, roomId: host.roomId });
          const sessionId = peer.sessionId;
          Object.assign(peer.room.reconnection, { minUptime: 0, minDelay: 200, maxDelay: 200, maxRetries: 40 });
          await waitFor(() => peer.room.state.players?.size === 2 && peer.room.state.matchTag > 0,
            4000, 'joined peers receive the initialized state');
          const initialTick = peer.room.state.netTick + 1;
          channel = new HGameLockstepChannel(peer, peer.room.state.matchTag, initialTick);
          const ticks = [];
          const statuses = [];
          channel.onFrame(frame => ticks.push(frame.netTick));
          channel.onSyncStatus(status => statuses.push(status));
          let firstMissing = 0;
          let reconnected = false;
          peer.onDrop(() => { firstMissing ||= channel.expectedNetTick; });
          peer.onReconnect(() => { reconnected = true; });
          await waitFor(() => ticks.length >= 2, 4000, 'live frames before outage');

          proxy.interrupt();
          await waitFor(() => firstMissing > 0 && !host.room.state.players.get(sessionId)?.connected,
            4000, 'server observes the dropped peer');
          await waitFor(() => host.room.state.netTick >= firstMissing + 20, 4000, 'frames sealed during outage');
          proxy.resume();
          await waitFor(() => reconnected && statuses.length > 0, 4000, 'reconnected peer receives sync status');
          assert.equal(peer.sessionId, sessionId);
          const [status] = statuses;
          assert.equal(status.fromNetTick, firstMissing);

          if (evicted) {
            assert.equal(status.ok, false);
            assert.equal(status.reason, 'history_evicted');
            assert.ok(status.oldestAvailableTick > firstMissing);
            const tick = host.room.state.netTick;
            await waitFor(() => host.room.state.netTick >= tick + 5, 4000, 'live frames after history expiry');
            assert.equal(channel.expectedNetTick, firstMissing);
            assert.equal(statuses.length, 1);
          } else {
            assert.equal(status.ok, true);
            assert.ok(status.sentFrames >= 20);
            await waitFor(() => channel.expectedNetTick > status.toNetTick + 1, 4000, 'replay and subsequent live frames');
            assert.deepEqual(ticks, Array.from({ length: ticks.length }, (_, index) => initialTick + index));
          }
        } finally {
          channel?.dispose();
          proxy.resume();
          await Promise.allSettled([peer?.leave(), host?.leave()]);
          await proxy.close();
        }
      });
    }
  } finally {
    await server.gracefullyShutdown(false);
  }
});

test('LockstepRoom synthesizes NO_OP after frameDeadlineTicks and replays bounded sync history', async () => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  await server.listen(port, '127.0.0.1');

  let roomA = null;
  let roomB = null;
  try {
    const clientA = new Client(`http://127.0.0.1:${port}`);
    const clientB = new Client(`http://127.0.0.1:${port}`);

    roomA = await clientA.joinOrCreate('lab_lockstep', {
      maxClients: 2,
      netHz: 25,
      frameDeadlineTicks: 4,
      maxHistoryFrames: 16,
      maxFramesPerTick: 16,
      maxFutureFrames: 32,
      maxInputsPerSecond: 300,
    });
    roomB = await clientB.joinById(roomA.roomId);

    const framesA = [];
    const syncStatusesA = [];
    roomA.onMessage('lockstep:frame', (bytes) => {
      framesA.push(decodeConfirmedFrame(new Uint8Array(bytes)));
    });
    roomA.onMessage('lockstep:sync-status', (status) => {
      syncStatusesA.push(status);
    });
    roomA.onMessage('lockstep:rejected', () => {});
    roomB.onMessage('lockstep:frame', () => {});
    roomB.onMessage('lockstep:rejected', () => {});

    await waitFor(
      () => (roomA.state?.matchTag ?? 0) > 0 && (roomB.state?.matchTag ?? 0) > 0 && (roomA.state?.players?.size ?? 0) === 2,
      4000,
      'lockstep room initialization with 2 players',
    );

    const matchTag = roomA.state.matchTag;
    const deadlineTargetTick = roomA.state.netTick + 1;
    let seqA = 1;
    let seqB = 1;

    // Only Player A submits input; Player B remains silent until frameDeadlineTicks triggers NO_OP synthesis.
    roomA.sendBytes(
      'lockstep:input',
      encodeLockstepInput({
        matchTag,
        sequence: seqA++,
        targetNetTick: deadlineTargetTick,
        payload: new Uint8Array([9, 1]),
      }),
    );

    await waitFor(
      () => framesA.some((f) => f.netTick === deadlineTargetTick),
      4000,
      'deadline-sealed lockstep frame',
    );

    const sealed = framesA.find((f) => f.netTick === deadlineTargetTick);
    assert.ok(sealed);
    assert.equal(sealed.inputs.length, 2);
    const inputA = sealed.inputs.find((entry) => entry.sequence === 1);
    const inputB = sealed.inputs.find((entry) => entry.flags === LockstepInputFlags.NO_OP);
    assert.ok(inputA, 'expected Player A input in sealed frame');
    assert.deepEqual([...inputA.payload], [9, 1]);
    assert.ok(inputB, 'expected synthesized NO_OP for silent Player B');
    assert.equal(inputB.sequence, 0);
    assert.equal(inputB.payload.length, 0);

    // Request lockstep:sync replay starting at deadlineTargetTick
    const beforeReplayCount = framesA.length;
    roomA.send('lockstep:sync', { fromNetTick: deadlineTargetTick });

    await waitFor(
      () => syncStatusesA.length >= 1 && framesA.length > beforeReplayCount,
      4000,
      'lockstep sync replay',
    );

    assert.equal(syncStatusesA[0].ok, true);
    assert.equal(syncStatusesA[0].fromNetTick, deadlineTargetTick);
    assert.ok(syncStatusesA[0].sentFrames >= 1);
    assert.ok(syncStatusesA[0].sentBytes > 0 && syncStatusesA[0].sentBytes <= 128 * 1024);
    assert.equal(syncStatusesA[0].hasMore, false);

    // Seal 18 more frames from both players to evict tick 1 from the 16-frame bounded history.
    const startBurstTick = roomA.state.netTick + 1;
    for (let i = 0; i < 18; i++) {
      const targetNetTick = startBurstTick + i;
      roomA.sendBytes(
        'lockstep:input',
        encodeLockstepInput({
          matchTag,
          sequence: seqA++,
          targetNetTick,
          payload: new Uint8Array([i & 0xff]),
        }),
      );
      roomB.sendBytes(
        'lockstep:input',
        encodeLockstepInput({
          matchTag,
          sequence: seqB++,
          targetNetTick,
          payload: new Uint8Array([0x80 | (i & 0x3f)]),
        }),
      );
    }

    const endBurstTick = startBurstTick + 17;
    await waitFor(
      () => framesA.some((f) => f.netTick >= endBurstTick),
      4000,
      '18 sealed frames to test history eviction',
    );

    roomA.send('lockstep:sync', { fromNetTick: 1 });
    await waitFor(
      () => syncStatusesA.length >= 2,
      4000,
      'history_evicted status',
    );

    const evicted = syncStatusesA[1];
    assert.equal(evicted.ok, false);
    assert.equal(evicted.reason, 'history_evicted');
    assert.ok(evicted.oldestAvailableTick > 1);
    assert.ok(evicted.currentNetTick >= endBurstTick);
  } finally {
    if (roomA) await roomA.leave().catch(() => {});
    if (roomB) await roomB.leave().catch(() => {});
    await server.gracefullyShutdown(false);
  }
});

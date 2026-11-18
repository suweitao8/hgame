import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Client } from '@colyseus/sdk';
import {
  LockstepInputFlags,
  decodeConfirmedFrame,
  encodeLockstepInput,
} from '@hgame/network-protocol';
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

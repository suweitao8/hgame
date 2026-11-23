import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  ClientPredictionController,
  HGameNetworkClient,
  HGameSnapshotChannel,
} from '@hgame/network-client';
import {
  createArenaMotionState,
  stepArenaMotion2D,
} from '@hgame/network-simulation';
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
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`Timed out waiting for ${label}`)); return; }
      setTimeout(poll, 15);
    };
    poll();
  });
}

test('AuthorityArenaRoom streams binary AOI deltas, reconciles local prediction, verifies lag-comp hits, and rebinds spectator AOI', async () => {
  const port = await getFreePort();
  const server = createHGameNetworkServer();
  await server.listen(port, '127.0.0.1');

  let connA = null;
  let connB = null;
  let snapA = null;
  let snapB = null;
  try {
    const clientA = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });
    const clientB = new HGameNetworkClient({ endpoint: `http://127.0.0.1:${port}`, storage: null });

    connA = await clientA.joinOrCreate({
      gameId: 'arena-test',
      roomName: 'lab_arena',
      roomOptions: { tickHz: 30, aoiEnterRadius: 450, reconnectSeconds: 0 },
      resume: false,
    });
    connB = await clientB.joinById({
      gameId: 'arena-test',
      roomName: 'lab_arena',
      roomId: connA.roomId,
      resume: false,
    });

    const updatesA = [];
    const acksA = [];
    const hitResultsA = [];
    snapA = new HGameSnapshotChannel(connA, { interpolationDelayMs: 30 });
    snapB = new HGameSnapshotChannel(connB, { interpolationDelayMs: 30 });
    snapA.onSnapshot((info) => updatesA.push(info));
    connA.onMessage('arena:self', (ack) => acksA.push(ack));
    connA.onMessage('arena:hit-result', (res) => hitResultsA.push(res));

    await waitFor(
      () => snapA.entityCount === 2 && snapB.entityCount === 2 && acksA.length > 0,
      4000,
      'initial AOI binary snapshot for both clients',
    );

    assert.equal(updatesA[0].kind, 'snapshot');

    const latestAck = acksA[acksA.length - 1];
    const motionConfig = {
      speed: 220,
      dashSpeed: 620,
      dashDuration: 0.14,
      dashCooldown: 0.7,
      radius: 14,
      bounds: { minX: -1200, minY: -1200, maxX: 1200, maxY: 1200 },
    };
    const predictor = new ClientPredictionController({
      initialState: createArenaMotionState(latestAck.x, latestAck.y, latestAck.yaw),
      cloneState: (s) => ({ ...s }),
    });

    const startX = latestAck.x;
    for (let i = 0; i < 4; i++) {
      const input = { moveX: 1, moveY: 0, dashPressed: i === 0 };
      const seq = predictor.predict(input, 1 / 30, (s, inp, dt) => stepArenaMotion2D(s, inp, dt, motionConfig));
      connA.send('arena:input', { seq, ...input });
    }

    await waitFor(
      () => acksA.some((ack) => ack.ackSeq >= 4 && ack.x > startX + 20),
      4000,
      'server reconciliation acks after movement and dash',
    );

    const reconciledAck = acksA[acksA.length - 1];
    predictor.reconcile(
      reconciledAck.ackSeq,
      {
        x: reconciledAck.x,
        y: reconciledAck.y,
        yaw: reconciledAck.yaw,
        dashTimer: reconciledAck.dashTimer,
        dashCooldown: reconciledAck.dashCooldown,
        dashDirX: reconciledAck.dashDirX,
        dashDirY: reconciledAck.dashDirY,
      },
      (s, inp, dt) => stepArenaMotion2D(s, inp, dt, motionConfig),
    );
    assert.ok(predictor.currentState.x > startX + 20);
    assert.ok(updatesA.some((u) => u.kind === 'delta'), 'expected incremental delta packets after initial snapshot');

    // Client B should see Client A moved in its decoded snapshot channel
    const bViewOfA = snapB.getEntity(reconciledAck.entityId);
    assert.ok(bViewOfA && bViewOfA.x > startX + 20);

    // Lag-compensated hit verification against Client B
    const bAck = connB.room.state.players.get(connB.sessionId);
    const bPose = snapA.getEntity(bAck.entityId);
    assert.ok(bPose);
    const dirX = bPose.x - reconciledAck.x;
    const dirY = bPose.y - reconciledAck.y;
    connA.send('arena:hit-check', {
      originX: reconciledAck.x,
      originY: reconciledAck.y,
      dirX,
      dirY,
      maxDistance: 1000,
    });
    await waitFor(() => hitResultsA.length === 1, 4000, 'lag-compensated hit verification');
    assert.equal(hitResultsA[0].hit, true);
    assert.equal(hitResultsA[0].actorId, String(bAck.entityId));

    // Spectator AOI rebinding emits a fresh snapshot anchored on target entity
    const countBeforeSpectate = updatesA.length;
    connA.send('arena:spectate', { targetEntityId: bAck.entityId });
    await waitFor(
      () => updatesA.slice(countBeforeSpectate).some((u) => u.kind === 'snapshot'),
      4000,
      'fresh snapshot after spectator target rebind',
    );
  } finally {
    snapA?.dispose();
    snapB?.dispose();
    await Promise.allSettled([connA?.leave(), connB?.leave()]);
    await server.gracefullyShutdown(false);
  }
});

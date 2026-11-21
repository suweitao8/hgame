import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTransformSnapshot,
  encodeTransformDelta,
} from '@hgame/network-protocol';
import {
  HGameSnapshotChannel,
  ClientPredictionController,
} from '../dist/index.js';

function createMockConnection() {
  const listeners = new Map();
  const sent = [];
  return {
    sent,
    onMessage(type, handler) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(handler);
      return () => set.delete(handler);
    },
    send(type, payload) {
      sent.push({ type, payload });
    },
    emit(type, payload) {
      for (const handler of listeners.get(type) ?? []) handler(payload);
    },
  };
}

test('HGameSnapshotChannel decodes snapshots and deltas, preserves exact flags, and requests resync on baseTick gap', () => {
  const conn = createMockConnection();
  let now = 1000;
  const channel = new HGameSnapshotChannel(conn, {
    interpolationDelayMs: 50,
    now: () => now,
  });

  const baseEntities = [
    { id: 1, x: 0, y: 0, z: 0, yaw: 0, flags: 1 },
    { id: 2, x: 100, y: 0, z: 0, yaw: 1.0, flags: 2 },
  ];
  conn.emit('arena:snapshot', encodeTransformSnapshot({ tick: 10, entities: baseEntities }));
  assert.equal(channel.lastTick, 10);
  assert.equal(channel.entityCount, 2);

  now = 1050;
  const nextEntities = [
    { id: 1, x: 10, y: 0, z: 0, yaw: 0.5, flags: 3 },
  ];
  conn.emit('arena:snapshot', encodeTransformDelta({
    tick: 11,
    baseTick: 10,
    prevEntities: baseEntities,
    nextEntities,
  }));
  assert.equal(channel.lastTick, 11);
  assert.equal(channel.entityCount, 1);

  // Sample midpoint (renderTime = 1075 - 50 = 1025) -> x should interpolate to ~5 while flags stay exact integer 3
  const sampled = channel.sample(1075);
  const e1 = sampled.get(1);
  assert.ok(e1);
  assert.ok(Math.abs(e1.x - 5) <= 0.05);
  assert.equal(e1.flags, 3);
  assert.equal(sampled.has(2), false);

  // Out-of-order/gapped delta triggers resync instead of corrupting baseline
  conn.emit('arena:snapshot', encodeTransformDelta({
    tick: 15,
    baseTick: 14,
    prevEntities: nextEntities,
    nextEntities,
  }));
  assert.equal(channel.lastTick, 11);
  assert.equal(conn.sent.length, 1);
  assert.equal(conn.sent[0].type, 'arena:resync');

  channel.dispose();
});

test('ClientPredictionController predicts locally, reconciles unconfirmed inputs, and smooths small errors', () => {
  const step = (state, input, dt) => {
    state.x += input.dx * 100 * dt;
    state.y += input.dy * 100 * dt;
  };
  const controller = new ClientPredictionController({
    initialState: { x: 0, y: 0 },
    cloneState: (s) => ({ ...s }),
    snapThreshold: 50,
  });

  const seq1 = controller.predict({ dx: 1, dy: 0 }, 0.1, step); // x = 10
  const seq2 = controller.predict({ dx: 1, dy: 0 }, 0.1, step); // x = 20
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  assert.equal(controller.currentState.x, 20);
  assert.equal(controller.pendingCount, 2);

  // Server acks seq1 with a slight correction (8 instead of 10)
  controller.reconcile(1, { x: 8, y: 0 }, step);
  assert.equal(controller.pendingCount, 1);
  // Replayed seq2 gives authoritative 8 + 10 = 18
  assert.equal(controller.currentState.x, 18);
  // Visual offset holds +2 so render stays at 20 before smooth decay
  assert.ok(Math.abs(controller.visualOffset.x - 2) < 1e-6);

  const smoothed = controller.decayVisualOffset(0.06, 60);
  assert.ok(smoothed.x > 18 && smoothed.x < 20);
});

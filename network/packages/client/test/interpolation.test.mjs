import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeConfirmedFrame,
  LockstepInputFlags,
} from '@hgame/network-protocol';
import {
  AdaptiveInputLeadController,
  HGameLockstepChannel,
  SnapshotInterpolationBuffer,
} from '../dist/index.js';

test('SnapshotInterpolationBuffer interpolates linearly, wraps shortest-arc angles, and bounds extrapolation', () => {
  const buffer = new SnapshotInterpolationBuffer({
    interpolationDelayMs: 100,
    maxSnapshots: 8,
    maxExtrapolationMs: 50,
    angleFields: ['yaw'],
  });

  assert.equal(buffer.sample(500).size, 0);

  const yawA = Math.PI - 0.1;
  const yawB = -Math.PI + 0.1; // +0.2 rad shortest arc across pi/-pi seam
  buffer.push(1000, {
    p1: { x: 0, y: 0, yaw: yawA },
  });
  buffer.push(1100, {
    p1: { x: 10, y: 20, yaw: yawB },
  });
  assert.equal(buffer.size, 2);

  // Sample at nowMs=1150 => renderTime=1050 (alpha=0.5 between t=1000 and t=1100)
  const mid = buffer.sample(1150).get('p1');
  assert.ok(mid);
  assert.ok(Math.abs(mid.x - 5) < 1e-6);
  assert.ok(Math.abs(mid.y - 10) < 1e-6);
  assert.ok(Math.abs(Math.abs(mid.yaw) - Math.PI) < 1e-6);

  // Sample at nowMs=1300 => renderTime=1200 -> extrapolated by capped maxExtrapolationMs=50ms (factor=0.5 of 100ms span)
  const ext = buffer.sample(1300).get('p1');
  assert.ok(ext);
  assert.ok(Math.abs(ext.x - 15) < 1e-6);
  assert.ok(Math.abs(ext.y - 30) < 1e-6);

  buffer.clear();
  assert.equal(buffer.size, 0);
});

test('AdaptiveInputLeadController tracks RTT and jitter to recommend bounded lockstep lead ticks', () => {
  const controller = new AdaptiveInputLeadController({
    minLeadTicks: 1,
    maxLeadTicks: 6,
    safetyMarginMs: 10,
    smoothing: 0.25,
  });

  // Before samples, defaults to minLeadTicks
  assert.equal(controller.recommendLeadTicks(20), 1);

  controller.recordRttSample(40);
  // First sample: srtt=40, jitter=0 -> budget = 20 + 0 + 10 = 30ms -> at 20Hz (50ms/tick) => ceil(30/50)=1
  assert.equal(controller.srttMs, 40);
  assert.equal(controller.jitterMs, 0);
  assert.equal(controller.recommendLeadTicks(20), 1);

  // Spike RTT repeatedly -> higher lead bounded by maxLeadTicks
  for (let i = 0; i < 6; i++) controller.recordRttSample(260);
  const recommended = controller.recommendLeadTicks(30); // tickMs ~33.3ms
  assert.ok(recommended >= 3 && recommended <= 6);

  // Extreme RTT clamps to maxLeadTicks=6
  for (let i = 0; i < 10; i++) controller.recordRttSample(2000);
  assert.equal(controller.recommendLeadTicks(60), 6);

  controller.reset();
  assert.equal(controller.samples, 0);
  assert.equal(controller.srttMs, 0);
  assert.equal(controller.jitterMs, 0);
});

test('HGameLockstepChannel requests sync on reconnect, chains hasMore batches, and cleans up on dispose', () => {
  const sentMessages = [];
  const listeners = new Map();
  let reconnectHandler = null;
  let reconnectUnsubscribed = false;

  const mockConnection = {
    send(type, payload) {
      sentMessages.push({ type, payload });
    },
    sendBytes() {},
    onMessage(type, handler) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
      return () => set.delete(handler);
    },
    onReconnect(handler) {
      reconnectHandler = handler;
      return () => {
        reconnectUnsubscribed = true;
        reconnectHandler = null;
      };
    },
  };

  const emitMessage = (type, payload) => {
    for (const handler of listeners.get(type) ?? []) handler(payload);
  };

  const channel = new HGameLockstepChannel(mockConnection, 0x11223344, 1, 32, 1, {
    autoSyncOnReconnect: true,
  });

  const receivedFrames = [];
  const syncStatuses = [];
  channel.onFrame((frame) => receivedFrames.push(frame));
  channel.onSyncStatus((status) => syncStatuses.push(status));

  // Simulate reconnect -> automatically requests sync from expectedNetTick (1)
  assert.ok(reconnectHandler);
  reconnectHandler();
  assert.deepEqual(sentMessages, [{ type: 'lockstep:sync', payload: { fromNetTick: 1 } }]);

  // Simulate server replaying tick 1 and reporting hasMore=true
  emitMessage(
    'lockstep:frame',
    encodeConfirmedFrame({
      matchTag: 0x11223344,
      netTick: 1,
      inputs: [{ slot: 0, sequence: 1, flags: LockstepInputFlags.NONE, payload: new Uint8Array([42]) }],
    }),
  );
  emitMessage('lockstep:sync-status', {
    ok: true,
    fromNetTick: 1,
    toNetTick: 1,
    sentFrames: 1,
    hasMore: true,
  });

  assert.equal(receivedFrames.length, 1);
  assert.equal(channel.expectedNetTick, 2);
  assert.equal(syncStatuses.length, 1);
  // Multi-batch continuation should request from toNetTick + 1 = 2
  assert.deepEqual(sentMessages[1], { type: 'lockstep:sync', payload: { fromNetTick: 2 } });

  // Clean up on dispose
  channel.dispose();
  assert.equal(reconnectUnsubscribed, true);
  assert.equal(listeners.get('lockstep:frame').size, 0);
  assert.equal(listeners.get('lockstep:sync-status').size, 0);
  channel.requestSync(3);
  assert.equal(sentMessages.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,
  Entity,
  createSeededRng,
  createNetworkStateSync,
  createSceneReplicator,
} from '../assets/runtime/index.js';

test('N1 binary codec produces compact Uint8Array deltas (< 40% of JSON snapshot) and roundtrips cleanly', () => {
  const net = createNetworkStateSync({ quantizePos: 100, quantizeRot: 1000 });
  const prev = {};
  const next = {};
  for (let i = 0; i < 16; i++) {
    prev['unit_' + i] = { x: i * 3.5, y: 0, z: i * 1.25, rotationY: 0.5, hp: 100 };
    next['unit_' + i] = { x: i * 3.5, y: 0, z: i * 1.25, rotationY: 0.5, hp: 100 };
  }
  // Only 2 entities move on this tick
  next.unit_2.x = 7.35;
  next.unit_2.rotationY = 1.234;
  next.unit_9.z = 12.88;

  const binaryDelta = net.encodeDeltaBinary(prev, next, { tick: 42, timestampMs: 1400 });
  assert.ok(binaryDelta instanceof Uint8Array);
  const fullJsonBytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
  assert.ok(
    binaryDelta.byteLength < fullJsonBytes * 0.25,
    `Binary incremental packet (${binaryDelta.byteLength}B) must be << 25% of full JSON (${fullJsonBytes}B)`,
  );

  const decoded = net.decodeDeltaBinary(prev, binaryDelta);
  assert.equal(decoded.tick, 42);
  assert.equal(decoded.timestampMs, 1400);
  assert.equal(decoded.changedCount, 2);
  assert.equal(decoded.state.unit_2.x, 7.35);
  assert.equal(decoded.state.unit_2.rotationY, 1.234);
  assert.equal(decoded.state.unit_9.z, 12.88);
  assert.equal(decoded.state.unit_0.hp, 100);
});

test('N1 SceneReplicator converges remote entities & reconciles local player over lossy, jittery, reordered binary transport', () => {
  const hostScene = new Scene('host-net');
  const clientScene = new Scene('client-net');

  const hHero = hostScene.add(new Entity({ name: 'hero', x: 0, y: 0, z: 0 }));
  const hNpc = hostScene.add(new Entity({ name: 'npc_1', x: 10, y: 0, z: 5 }));

  const cHero = clientScene.add(new Entity({ name: 'hero', x: 0, y: 0, z: 0 }));
  const cNpc = clientScene.add(new Entity({ name: 'npc_1', x: 0, y: 0, z: 0 }));

  const rng = createSeededRng(20261122);
  const clientListeners = new Set();
  const inFlight = [];

  const hostTransport = {
    send(bytes) {
      // Simulate 15% packet drop (never drop initial keyframe packet 0, or keep keyframes reliable) and 20-90ms jitter
      const isKeyframe = (bytes[3] & 1) !== 0;
      if (!isKeyframe && rng.next() < 0.15) return;
      const deliverAt = currentTimeMs + 20 + Math.floor(rng.next() * 70);
      inFlight.push({ deliverAt, bytes: bytes.slice() });
    },
  };
  const clientTransport = {
    send() {},
    onMessage(fn) { clientListeners.add(fn); return () => clientListeners.delete(fn); },
  };

  let currentTimeMs = 0;
  const hostSync = createNetworkStateSync({ interpolationDelayMs: 60 });
  const clientSync = createNetworkStateSync({ interpolationDelayMs: 60 });

  const hostRep = createSceneReplicator({
    scene: hostScene,
    stateSync: hostSync,
    transport: hostTransport,
    role: 'host',
  });
  const clientRep = createSceneReplicator({
    scene: clientScene,
    stateSync: clientSync,
    transport: clientTransport,
    role: 'client',
    localEntityId: 'hero',
    replayFn: (state, inp) => {
      if (state.hero) state.hero.x += inp.dx;
      return state;
    },
  });

  // Run 40 server ticks (25ms each -> 1000ms), flushing jittered packets + local predictions
  for (let tick = 0; tick < 40; tick++) {
    currentTimeMs = tick * 25;
    // Keyframe every 10 ticks so baseline recovers cleanly after simulated 15% UDP drops
    const isKeyframe = tick % 10 === 0;
    hHero.x += 0.5;
    hNpc.x = 10 + Math.sin(tick * 0.2) * 4;
    hNpc.z = 5 + tick * 0.25;
    clientSync.pushLocalInput(tick, { dx: 0.5 });

    hostRep.sendSnapshot(tick, currentTimeMs, { isKeyframe });

    // Deliver all packets whose jittered arrival time <= currentTimeMs (can arrive out of order)
    for (let i = inFlight.length - 1; i >= 0; i--) {
      if (inFlight[i].deliverAt <= currentTimeMs) {
        const pkt = inFlight.splice(i, 1)[0];
        for (const fn of clientListeners) fn(pkt.bytes);
      }
    }
    clientRep.stepClient(currentTimeMs);
  }

  // Drain any remaining jittered packets at t = 1150ms
  currentTimeMs = 1150;
  for (const pkt of inFlight) {
    for (const fn of clientListeners) fn(pkt.bytes);
  }
  clientRep.stepClient(currentTimeMs);

  const repStats = clientRep.getStats();
  assert.ok(repStats.packetsReceived >= 25);
  assert.ok(Math.abs(cHero.x - hHero.x) < 1.5, `Local hero prediction must reconcile near host (${cHero.x} vs ${hHero.x})`);
  assert.ok(Math.abs(cNpc.z - hNpc.z) < 0.8, `Remote NPC must interpolate near latest authoritative z (${cNpc.z} vs ${hNpc.z})`);

  hostRep.dispose();
  clientRep.dispose();
});

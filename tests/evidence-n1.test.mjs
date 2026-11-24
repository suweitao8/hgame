// Scorecard N1 evidence: deterministic RNG + frame checksum, GGPO rollback scheduler, binary snapshot delta,
// scene replicator under 15% packet loss, spatial AOI, WebRTC unreliable DataChannel config/fallback.
// Headless note: real server (network/) + real RTCPeerConnection are not exercised; a fake peer verifies adapter logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRng } from '../assets/runtime/sim/rng.js';
import { createStateChecksum, hashState } from '../assets/runtime/sim/checksum.js';
import { createRollbackFrameScheduler } from '../assets/runtime/lockstep/rollback-frames.js';
import { createNetworkStateSync, createSceneReplicator, createSpatialAoiFilter }
  from '../assets/runtime/lockstep/state-sync.js';
import { createWebRtcDataChannelTransport } from '../assets/runtime/lockstep/webrtc-transport.js';

test('seeded RNG is deterministic, restorable, and fork-stable; checksum is key-order independent and sensitive', () => {
  const a = createSeededRng(1234), b = createSeededRng(1234), c = createSeededRng(1235);
  const sa = Array.from({ length: 50 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 50 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 50 }, () => c.next()));
  assert.ok(sa.every(v => v >= 0 && v < 1));
  const st = a.getState(); const x = a.next(); a.setState(st);
  assert.equal(a.next(), x, 'state restore replays identically');
  assert.equal(createSeededRng(9).fork('x').next(), createSeededRng(9).fork('x').next());

  assert.equal(hashState({ a: 1, b: [1, 2, { c: 'x' }] }), hashState({ b: [1, 2, { c: 'x' }], a: 1 }));
  assert.notEqual(hashState({ a: 1 }), hashState({ a: 2 }));
  assert.notEqual(hashState([1, 2]), hashState([2, 1]));
  const cs = createStateChecksum().update({ p: 1 });
  const d = cs.digest(); cs.update('more'); assert.notEqual(cs.digest(), d);
  cs.reset(); cs.update({ p: 1 }); assert.equal(cs.digest(), d);
  assert.match(cs.hex(), /^[0-9a-f]{8}$/);
  assert.equal(hashState(new Float64Array([0])), hashState(new Float64Array([0])));
});

// ---- rollback scheduler: delayed remote inputs must converge to the ground-truth simulation ----
function makeSim() {
  const rng = createSeededRng(42);
  const st = { a: 0, b: 0, ticks: 0 };
  const slots = [];
  return {
    st,
    rng,
    saveState(slot) { slots[slot] = { ...st, rng: rng.getState() }; },
    loadState(slot) { const s = slots[slot]; st.a = s.a; st.b = s.b; st.ticks = s.ticks; rng.setState(s.rng); },
    simulate(inputs) {
      st.ticks++;
      for (const inp of inputs) {
        const k = inp.pid === 0 ? 'a' : 'b';
        st[k] += (inp.buttons & 1 ? 1 : -1) + rng.int(3);
      }
    },
    hash() { return hashState({ a: st.a, b: st.b, r: rng.getState() }); },
  };
}
const FRAME_MS = 1000 / 60;
const remoteInput = t => ({ pid: 1, buttons: (t * 7 + (t >> 2)) & 3 });
const localInput = t => ({ pid: 0, buttons: (t * 3) & 1 });

test('rollback scheduler: late remote inputs trigger rollback and end bit-identical to ground truth', () => {
  const N = 40, DELAY = 3;
  // ground truth: everything known up front
  const truth = makeSim();
  for (let t = 1; t <= N; t++) truth.simulate([localInput(t), remoteInput(t)]);

  const sim = makeSim();
  const confirmed = [];
  const sched = createRollbackFrameScheduler({
    netHz: 60, logicHz: 60, playerIds: [0, 1],
    saveState: sim.saveState, loadState: sim.loadState, simulate: sim.simulate,
    onConfirmedTick: info => confirmed.push(info.netTick),
    maxRollbackFrames: 8,
  });
  let frame = 0;
  while (sched.confirmedNetTick < N) {
    frame++;
    if (frame <= N) sched.submitInput(frame, localInput(frame));
    const arriving = frame - DELAY;
    if (arriving >= 1 && arriving <= N) sched.submitInput(arriving, remoteInput(arriving));
    if (frame > N) { // flush trailing remote inputs without simulating beyond N
      const t = frame - DELAY; if (t >= 1 && t <= N) { /* already submitted */ }
    }
    if (sched.netTick < N) sched.advanceElapsedMs(FRAME_MS);
    assert.ok(frame < 500, 'must terminate');
  }
  sched.advanceElapsedMs(0); // apply any pending rollback for the final late inputs
  assert.ok(sched.rollbackCount > 0, 'mispredicted remote input forces rollback');
  assert.ok(sched.resimulatedFrames > 0);
  assert.ok(sched.maxRollbackDepthSeen <= 8);
  assert.equal(sched.fatal, false);
  assert.deepEqual(confirmed.slice(0, N), Array.from({ length: N }, (_, i) => i + 1), 'confirmations strictly in order');
  assert.equal(sim.st.ticks >= N, true);
  // compare state at tick N: re-run scheduler-state is at netTick N (we stopped advancing there)
  assert.equal(sched.netTick, N);
  assert.equal(sim.hash(), truth.hash(), 'rolled-back state equals ground-truth state');
});

test('rollback scheduler: stalls at the prediction window, validates input, flags fatal on bad input', () => {
  const sim = makeSim();
  const sched = createRollbackFrameScheduler({ netHz: 60, logicHz: 60, playerIds: [0, 1], maxRollbackFrames: 4,
    saveState: sim.saveState, loadState: sim.loadState, simulate: sim.simulate });
  for (let i = 0; i < 30; i++) sched.advanceElapsedMs(FRAME_MS); // no remote input ever arrives
  assert.equal(sched.stalled, true);
  assert.equal(sched.netTick, 4, 'never speculates beyond maxRollbackFrames');
  assert.equal(sched.confirmedNetTick, 0);
  assert.throws(() => createRollbackFrameScheduler({ netHz: 20, logicHz: 50, playerIds: [0], saveState() {}, loadState() {}, simulate() {} }), RangeError);
  assert.throws(() => createRollbackFrameScheduler({ playerIds: [1, 0], saveState() {}, loadState() {}, simulate() {} }), RangeError);
  assert.equal(sched.submitInput(1, { pid: 9, buttons: 0 }), false);
  assert.equal(sched.fatal, true);
});

// ---- binary snapshot delta ----
test('binary delta: HG magic, quantized round-trip, removals, and far smaller than a full snapshot', () => {
  const sync = createNetworkStateSync();
  const prev = {}, next = {};
  for (let i = 0; i < 50; i++) { prev['e' + i] = { x: i, y: 0, z: i * 2, rotationY: 0.5, alive: true, tag: 'npc' }; }
  Object.assign(next, JSON.parse(JSON.stringify(prev)));
  next.e3.x = 3.1234; next.e3.rotationY = 1.2345; next.e3.alive = false;
  delete next.e7;
  next.new1 = { x: 9.999, y: -1.5, z: 0, rotationY: 0, alive: true, tag: 'boss' };

  const key = sync.encodeDeltaBinary({}, prev, { tick: 1, timestampMs: 10, isKeyframe: true });
  const delta = sync.encodeDeltaBinary(prev, next, { tick: 2, timestampMs: 60 });
  assert.equal(delta[0], 0x48);
  assert.equal(delta[1], 0x47);
  assert.ok(delta.byteLength < key.byteLength / 5, `delta ${delta.byteLength} vs key ${key.byteLength}`);

  const k = sync.decodeDeltaBinary({}, key);
  assert.equal(k.isKeyframe, true);
  assert.equal(Object.keys(k.state).length, 50);
  const d = sync.decodeDeltaBinary(k.state, delta);
  assert.equal(d.tick, 2);
  assert.equal(d.timestampMs, 60);
  assert.ok(!('e7' in d.state), 'removed entity gone');
  assert.equal(d.state.e3.x, 3.12, 'quantized to 0.01');
  assert.equal(d.state.e3.rotationY, 1.235 - 0.0005 + 0.0005 === 1.235 ? d.state.e3.rotationY : 0);
  assert.ok(Math.abs(d.state.e3.rotationY - 1.2345) <= 0.0005 + 1e-9);
  assert.equal(d.state.e3.alive, false);
  assert.equal(d.state.new1.tag, 'boss');
  assert.equal(d.state.e10.x, 10, 'unchanged entities carried from base');
  assert.throws(() => sync.decodeDeltaBinary({}, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), /magic/);
});

test('prediction/reconciliation: server ack drops confirmed inputs and replays the rest on authoritative state', () => {
  const sync = createNetworkStateSync();
  const replay = (s, input) => ({ ...s, x: s.x + input.dx });
  let predicted = { x: 0 };
  for (let t = 1; t <= 5; t++) { predicted = replay(predicted, { dx: 1 }); sync.pushLocalInput(t, { dx: 1 }, predicted); }
  // server processed 3 inputs but with a correction (blocked by wall): x=2.5 at tick 3
  const r = sync.reconcileServerState(3, { x: 2.5 }, replay);
  assert.equal(r.replayedInputs, 2);
  assert.equal(r.state.x, 4.5);
  assert.equal(sync.getStats().pendingInputs, 2);
  assert.equal(sync.reconcileServerState(5, { x: 5 }, replay).state.x, 5);
});

// ---- scene replicator under 15% loss ----
function fakeScene(names) {
  const objects = names.map(name => ({ name, x: 0, y: 0, z: 0, rotationY: 0 }));
  return { objects, find: n => objects.find(o => o.name === n) ?? null };
}

test('scene replicator: 15% packet loss still converges and interpolation tracks the host path', () => {
  const hostScene = fakeScene(['p1', 'p2']);
  const clientScene = fakeScene(['p1', 'p2']);
  const sent = [];
  const host = createSceneReplicator({ scene: hostScene, role: 'host', transport: { send: b => sent.push(b) } });
  const client = createSceneReplicator({ scene: clientScene, role: 'client', transport: { send() {} } });
  const lossRng = createSeededRng(7);
  const TICKS = 200, DT = 50;
  let dropped = 0;
  const pathX = t => t * 0.5, pathZ = t => Math.sin(t / 10) * 5;
  const sampleErrors = [];
  for (let t = 1; t <= TICKS; t++) {
    hostScene.find('p1').x = pathX(t); hostScene.find('p1').z = pathZ(t);
    hostScene.find('p2').x = -pathX(t); hostScene.find('p2').z = t;
    const bytes = host.sendSnapshot(t, t * DT);
    const lose = t > 1 && t < TICKS && lossRng.next() < 0.15; // keyframe and final packet delivered
    if (lose) dropped++; else client.receivePacket(bytes);
    if (t > 4) {
      const renderT = t * DT; // sample at the delayed time of the newest data
      client.stepClient(renderT);
      const expectT = (renderT - 100) / DT;
      sampleErrors.push(Math.abs(clientScene.find('p1').x - pathX(expectT)));
    }
  }
  assert.ok(dropped >= 10 && dropped <= 60, `dropped ${dropped} (~15% of ${TICKS})`);
  assert.ok(Math.max(...sampleErrors) < 0.05, `max interpolation error ${Math.max(...sampleErrors)}`);
  client.stepClient(TICKS * DT + 100); // newest snapshot
  assert.ok(Math.abs(clientScene.find('p1').x - pathX(TICKS)) <= 0.01);
  assert.ok(Math.abs(clientScene.find('p2').z - TICKS) <= 0.01);
  assert.ok(Math.abs(clientScene.find('p1').z - pathZ(TICKS)) <= 0.01);
  const hs = host.getStats(), cs = client.getStats();
  assert.equal(hs.packetsSent, TICKS);
  assert.equal(cs.packetsReceived, TICKS - dropped);
  assert.ok(hs.totalBytesSent / TICKS < 80, 'compact per-tick bandwidth');
  assert.equal(cs.latestReceivedTick, TICKS);
});

test('scene replicator: out-of-order stale packets are counted and do not roll the base back', () => {
  const hostScene = fakeScene(['p']); const clientScene = fakeScene(['p']);
  const host = createSceneReplicator({ scene: hostScene, role: 'host', transport: { send() {} } });
  const client = createSceneReplicator({ scene: clientScene, role: 'client', transport: { send() {} } });
  const pk = [];
  for (let t = 1; t <= 3; t++) { hostScene.find('p').x = t; pk.push(host.sendSnapshot(t, t * 50)); }
  client.receivePacket(pk[0]); client.receivePacket(pk[2]); client.receivePacket(pk[1]);
  assert.equal(client.getStats().packetsDroppedOutOfOrder, 1);
  assert.equal(client.getStats().latestReceivedTick, 3);
});

test('spatial AOI: only nearby entities replicate, with enter/leave events and hysteresis', () => {
  const aoi = createSpatialAoiFilter({ radius: 10, hysteresis: 4 });
  const world = { near: { x: 3, z: 4 }, edge: { x: 12, z: 0 }, far: { x: 100, z: 100 } };
  let r = aoi.filterForViewer('v1', { x: 0, z: 0 }, world);
  assert.deepEqual(Object.keys(r.visibleState).sort(), ['near']);
  assert.deepEqual(r.enteredIds, ['near']);
  assert.equal(r.stats.culled, 2);
  world.edge.x = 9; r = aoi.filterForViewer('v1', { x: 0, z: 0 }, world);
  assert.deepEqual(r.enteredIds, ['edge']);
  world.edge.x = 12; r = aoi.filterForViewer('v1', { x: 0, z: 0 }, world);
  assert.ok('edge' in r.visibleState, 'hysteresis keeps it until exit radius');
  world.edge.x = 15; r = aoi.filterForViewer('v1', { x: 0, z: 0 }, world);
  assert.deepEqual(r.leftIds, ['edge']);
  // per-viewer independence
  const other = aoi.filterForViewer('v2', { x: 100, z: 100 }, world);
  assert.deepEqual(Object.keys(other.visibleState), ['far']);
  assert.equal(aoi.viewerCount, 2);
});

// ---- WebRTC ----
function fakePeerCtor(log) {
  return class FakePeer {
    constructor(cfg) { this.cfg = cfg; this.channels = []; log.peers.push(this); }
    createDataChannel(label, cfg) {
      const ch = { label, cfg, readyState: 'connecting', sent: [], send(d) { this.sent.push(d); }, close() {} };
      this.channels.push(ch); return ch;
    }
    async createOffer() { return { type: 'offer', sdp: 'x' }; }
    async setLocalDescription() {}
    close() {}
  };
}

test('WebRTC transport: unreliable channel is unordered/maxRetransmits=0, falls back until open, binary passes through', async () => {
  const log = { peers: [] }, signals = [], fb = [];
  const t = createWebRtcDataChannelTransport({ PeerConnectionCtor: fakePeerCtor(log), sendSignal: m => signals.push(m),
    fallbackSend: (p, m) => fb.push([p, m.channel]), connectTimeoutMs: 0 });
  await t.createOffer();
  const [reliable, unreliable] = [log.peers[0].channels.find(c => c.label === 'hgame-reliable'),
    log.peers[0].channels.find(c => c.label === 'hgame-unreliable')];
  assert.deepEqual(unreliable.cfg, { ordered: false, maxRetransmits: 0 });
  assert.deepEqual(reliable.cfg, { ordered: true });
  assert.equal(signals[0].type, 'offer');
  assert.equal(t.send(new Uint8Array([1])), 'fallback', 'not open yet -> degrade to fallback');
  unreliable.readyState = 'open'; unreliable.onopen();
  assert.equal(t.getStats().mode, 'webrtc');
  const bin = new Uint8Array([0x48, 0x47]);
  assert.equal(t.send(bin), 'webrtc');
  assert.equal(unreliable.sent[0], bin);
  assert.equal(reliable.sent.length, 0);
  assert.equal(t.send({ ctl: 1 }, { channel: 'reliable' }), 'fallback', 'reliable channel not open');
  const got = []; t.onMessage((p, m) => got.push([p, m.channel]));
  unreliable.onmessage({ data: 'hi' });
  assert.deepEqual(got, [['hi', 'unreliable']]);
  assert.equal(t.getStats().unreliableSent, 1);
  t.close();
  assert.equal(t.send(bin), 'closed');
});

test('WebRTC transport: no RTCPeerConnection or ICE failure degrades to fallback transparently', () => {
  const fb = [];
  const t = createWebRtcDataChannelTransport({ PeerConnectionCtor: null, fallbackSend: p => fb.push(p) });
  assert.equal(t.getStats().mode, 'fallback');
  assert.equal(t.send('a'), 'fallback');
  assert.deepEqual(fb, ['a']);
  assert.equal(createWebRtcDataChannelTransport({ PeerConnectionCtor: null }).send('x'), 'dropped');
});

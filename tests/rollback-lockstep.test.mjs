import test from 'node:test';
import assert from 'node:assert/strict';
import { createRollbackFrameScheduler } from '../assets/runtime/lockstep/rollback-frames.js';

function makeSimHarness(maxRollbackFrames = 8) {
  const slots = Array.from({ length: maxRollbackFrames + 1 }, () => new Int32Array(4));
  const state = new Int32Array(4); // [p0x, p1x, rng, frameCount]
  const sfxLog = [];
  const confirmedHashes = [];

  const scheduler = createRollbackFrameScheduler({
    netHz: 20,
    logicHz: 40,
    playerIds: [0, 1],
    instantButtonMask: 1,
    maxRollbackFrames,
    saveState(slotIndex) {
      slots[slotIndex].set(state);
    },
    loadState(slotIndex) {
      state.set(slots[slotIndex]);
    },
    simulate(inputs, info) {
      state[0] += inputs[0].vx * 2 + ((inputs[0].buttons & 1) ? 5 : 0);
      state[1] += inputs[1].vx * 2 + ((inputs[1].buttons & 1) ? 5 : 0);
      state[2] = (Math.imul(state[2], 1664525) + 1013904223) | 0;
      state[3] = info.logicTick;
      if (!info.isResimulating && (inputs[0].buttons & 1)) {
        sfxLog.push(info.logicTick);
      }
    },
    onConfirmedTick(info) {
      const snap = slots[info.slotIndex];
      confirmedHashes.push({
        netTick: info.netTick,
        logicTick: info.logicTick,
        p0x: snap[0],
        p1x: snap[1],
        rng: snap[2],
      });
    },
  });

  return { scheduler, state, sfxLog, confirmedHashes };
}

test('rollback scheduler speculates ahead, rolls back silently on misprediction, and converges bit-identically with confirmed peer', () => {
  const peerA = makeSimHarness(8); // experiences delayed remote inputs for pid 1
  const peerB = makeSimHarness(8); // receives all inputs without delay

  const timeline = [
    [{ pid: 0, buttons: 1, vx: 1 }, { pid: 1, buttons: 0, vx: 1 }],
    [{ pid: 0, buttons: 0, vx: 1 }, { pid: 1, buttons: 0, vx: 1 }],
    [{ pid: 0, buttons: 0, vx: 1 }, { pid: 1, buttons: 1, vx: -1 }], // pid 1 reverses & attacks on tick 3!
    [{ pid: 0, buttons: 0, vx: 0 }, { pid: 1, buttons: 0, vx: -1 }],
    [{ pid: 0, buttons: 0, vx: 0 }, { pid: 1, buttons: 0, vx: 0 }],
  ];

  // Peer B runs strictly with all inputs known upfront
  for (let i = 0; i < timeline.length; i++) {
    peerB.scheduler.enqueueConfirmedFrame({ netTick: i + 1, inputs: timeline[i] });
    peerB.scheduler.advanceElapsedMs(50);
  }

  // Peer A only has pid 0 inputs immediately, while pid 1 inputs arrive 2 net frames late
  for (let i = 0; i < timeline.length; i++) {
    const netTick = i + 1;
    peerA.scheduler.submitInput(netTick, timeline[i][0]);
    if (i >= 2) {
      peerA.scheduler.submitInput(netTick - 2, timeline[i - 2][1]);
    }
    peerA.scheduler.advanceElapsedMs(50);
  }
  // Deliver final 2 late inputs for pid 1 and trigger rollback catch-up
  peerA.scheduler.submitInput(4, timeline[3][1]);
  peerA.scheduler.submitInput(5, timeline[4][1]);
  peerA.scheduler.advanceElapsedMs(0);

  assert.ok(peerA.scheduler.rollbackCount >= 1, 'misprediction on tick 3 must trigger rollback');
  assert.ok(peerA.scheduler.resimulatedFrames >= 1);
  assert.deepEqual(Array.from(peerA.state), Array.from(peerB.state), 'rolled-back state must match reference peer bit-identically');
  assert.deepEqual(peerA.confirmedHashes, peerB.confirmedHashes);
  assert.deepEqual(peerA.sfxLog, [1], 'resimulation must not replay transient instant SFX');
});

test('rollback scheduler enforces bounded speculative window and supports checkpoint restore & time scale pacing', () => {
  const h = makeSimHarness(3);
  for (let t = 1; t <= 6; t++) {
    h.scheduler.submitInput(t, { pid: 0, buttons: 0, vx: 1 });
    h.scheduler.advanceElapsedMs(50);
  }
  // Never confirmed tick 1 -> cannot speculate beyond confirmedNetTick(0) + maxRollbackFrames(3)
  assert.equal(h.scheduler.netTick, 3);
  assert.equal(h.scheduler.stalled, true);
  assert.ok(h.scheduler.recommendTimeScale(0) < 1);

  h.scheduler.restoreCheckpoint({ netTick: 10 });
  assert.equal(h.scheduler.confirmedNetTick, 10);
  assert.equal(h.scheduler.netTick, 10);
  assert.equal(h.scheduler.logicTick, 20);
  assert.equal(h.scheduler.stalled, false);
});

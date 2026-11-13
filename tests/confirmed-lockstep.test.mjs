import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmedFrameScheduler } from '../assets/runtime/lockstep/confirmed-frames.js';

const frame = (netTick, buttons = 3) => ({
  netTick,
  inputs: [
    { pid: 0, move: 1, buttons },
    { pid: 1, move: 0, buttons: 0 },
  ],
});

function fixture(options = {}) {
  const seen = [];
  const scheduler = createConfirmedFrameScheduler({
    netHz: 10, logicHz: 20, playerIds: [0, 1],
    instantButtonMask: 1,
    simulate(inputs, ctx) {
      seen.push({ tick: ctx.logicTick, netTick: ctx.netTick,
        substep: ctx.substep, buttons: inputs[0].buttons, move: inputs[0].move });
    },
    ...options,
  });
  return { seen, scheduler };
}

test('starts after contiguous buffered sealed frames; 10Hz frame advances two 20Hz ticks', () => {
  const { seen, scheduler: s } = fixture();
  assert.equal(s.enqueue(frame(2)), true);
  assert.equal(s.advanceElapsedMs(500), 0, 'frame 1 missing: authority cannot advance');
  assert.equal(s.enqueue(frame(1)), true);
  assert.equal(s.advanceElapsedMs(0), 0, 'buffer gate does not burst-run ticks');
  assert.equal(s.started, true);
  assert.equal(s.advanceElapsedMs(49), 0);
  assert.equal(s.advanceElapsedMs(1), 1);
  assert.equal(s.advanceElapsedMs(50), 1);
  assert.deepEqual(seen, [
    { tick: 1, netTick: 1, substep: 0, buttons: 3, move: 1 },
    { tick: 2, netTick: 1, substep: 1, buttons: 2, move: 1 },
  ]);
  assert.equal(s.logicTick, 2);
  assert.equal(s.expectedNetTick, 2);
  assert.equal(s.enqueue(frame(1)), false, 'stale frame not replayed');
  assert.equal(s.enqueue(frame(2)), false, 'buffered duplicate not overwritten');
});

test('inputs cannot mutate after enqueue and incoming PIDs must be valid and ordered', () => {
  const { seen, scheduler: s } = fixture();
  const { scheduler: invalid } = fixture();
  assert.equal(invalid.enqueue({ netTick: 1, inputs: [frame(1).inputs[1], frame(1).inputs[0]] }), false);
  assert.equal(invalid.fatal, true, 'malformed sealed authority must fail closed');
  const original = frame(1);
  assert.equal(s.enqueue(original), true);
  original.inputs[0].move = 99;
  original.inputs[0].buttons = 255;
  assert.equal(s.enqueue(frame(2)), true);
  s.advanceElapsedMs(0);
  s.advanceElapsedMs(100);
  assert.equal(seen[0].move, 1);
  assert.equal(seen[0].buttons, 3);
  assert.equal(seen[1].buttons, 2);
});

test('missing confirmed frame freezes without empty Tick and resumes precisely', () => {
  const { seen, scheduler: s } = fixture();
  s.enqueue(frame(1)); s.enqueue(frame(2));
  s.advanceElapsedMs(0);
  for (let i = 0; i < 4; i++) s.advanceElapsedMs(50);
  assert.equal(s.logicTick, 4);
  assert.equal(s.advanceElapsedMs(500), 0);
  assert.equal(s.stalled, true);
  assert.equal(s.logicTick, 4);
  assert.equal(s.stallEvents, 1);
  assert.equal(s.enqueue(frame(3)), true);
  assert.equal(s.advanceElapsedMs(50), 1);
  assert.equal(s.stalled, false);
  assert.equal(s.logicTick, 5);
  assert.deepEqual(seen.map(x => x.tick), [1, 2, 3, 4, 5]);
});

test('bounded catch-up does not skip authority; future-frame overflow fails closed', () => {
  const { seen, scheduler: s } = fixture();
  for (let n = 1; n <= 10; n++) s.enqueue(frame(n));
  s.advanceElapsedMs(0);
  assert.equal(s.advanceElapsedMs(1000), 4);
  assert.equal(s.logicTick, 4);
  assert.deepEqual(seen.map(x => x.tick), [1, 2, 3, 4]);
  const { scheduler: over } = fixture({ maxBufferFrames: 3 });
  over.enqueue(frame(1)); over.enqueue(frame(2)); over.enqueue(frame(3));
  assert.equal(over.enqueue(frame(4)), false);
  assert.equal(over.fatal, true);
  assert.equal(over.advanceElapsedMs(500), 0);
});

test('different display cadences retain identical confirmed authority', () => {
  const traces = [30, 60, 144].map(fps => {
    const { seen, scheduler: s } = fixture({ maxBufferFrames: 32 });
    for (let i = 1; i <= 12; i++) s.enqueue(frame(i));
    s.advanceElapsedMs(0);
    for (let i = 1; i <= fps * 1.01; i++) s.advanceElapsedMs(1000 / fps);
    return seen.slice(0, 20);
  });
  assert.deepEqual(traces[0], traces[1]);
  assert.deepEqual(traces[1], traces[2]);
});

test('a 20Hz network with 60Hz logic uses three substeps without requiring whole-millisecond ticks', () => {
  const { seen, scheduler: s } = fixture({ netHz: 20, logicHz: 60 });
  assert.equal(s.enqueue(frame(1)), true);
  assert.equal(s.enqueue(frame(2)), true);
  s.advanceElapsedMs(0);
  assert.equal(s.advanceElapsedMs(50), 3);
  assert.deepEqual(seen.map(x => x.substep), [0, 1, 2]);
  assert.deepEqual(seen.map(x => x.buttons), [3, 2, 2]);
  assert.equal(s.expectedNetTick, 2);
});

test('invalid configuration, malformed frames and simulation exceptions fail safely', () => {
  assert.throws(() => fixture({ logicHz: 25 }), /integer multiple|ratio/i);
  assert.throws(() => fixture({ playerIds: [1, 1] }), /duplicate|playerIds/i);
  const { scheduler: s } = fixture();
  assert.equal(s.enqueue({ netTick: 1, inputs: [{ pid: 0, buttons: 0 }] }), false);
  assert.equal(s.fatal, true);
  const { scheduler: thrower } = fixture({ simulate() { throw new Error('simulation failed'); } });
  thrower.enqueue(frame(1)); thrower.enqueue(frame(2));
  thrower.advanceElapsedMs(0);
  assert.throws(() => thrower.advanceElapsedMs(50), /simulation failed/);
  assert.equal(thrower.fatal, true);
  assert.equal(thrower.logicTick, 0);
});

test('terminal simulation never advances an extra substep after the winning Tick', () => {
  let ended = false;
  const { seen, scheduler: s } = fixture({
    simulate(inputs, ctx) {
      seen.push(ctx.logicTick);
      if (ctx.logicTick === 3) ended = true;
    },
    isEnded: () => ended,
  });
  for (let n = 1; n <= 5; n++) s.enqueue(frame(n));
  s.advanceElapsedMs(0);
  assert.equal(s.advanceElapsedMs(500), 3);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(s.advanceElapsedMs(500), 0);
  assert.equal(s.enqueue(frame(6)), false);
  assert.equal(s.fatal, false, 'normal terminal is not a DESYNC or fatal error');
});

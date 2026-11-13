import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfirmedFrameQueue,
  LockstepInputFlags,
  decodeConfirmedFrame,
  decodeLockstepInput,
  encodeConfirmedFrame,
  encodeLockstepInput,
} from '../dist/index.js';

test('lockstep input packet round-trips with explicit little-endian fields', () => {
  const packet = {
    matchTag: 0x12345678,
    sequence: 19,
    targetNetTick: 42,
    payload: new Uint8Array([1, 2, 255, 0]),
  };
  const encoded = encodeLockstepInput(packet);
  const decoded = decodeLockstepInput(encoded);
  assert.equal(decoded.matchTag, packet.matchTag);
  assert.equal(decoded.sequence, packet.sequence);
  assert.equal(decoded.targetNetTick, packet.targetNetTick);
  assert.deepEqual([...decoded.payload], [...packet.payload]);
  assert.equal(new DataView(encoded.buffer).getUint32(8, true), packet.matchTag);
});

test('no-op is explicit and cannot smuggle a payload', () => {
  const encoded = encodeLockstepInput({
    matchTag: 1,
    sequence: 1,
    targetNetTick: 1,
    flags: LockstepInputFlags.NO_OP,
    payload: new Uint8Array(),
  });
  assert.equal(decodeLockstepInput(encoded).flags, LockstepInputFlags.NO_OP);
  assert.throws(() => encodeLockstepInput({
    matchTag: 1, sequence: 1, targetNetTick: 1,
    flags: LockstepInputFlags.NO_OP, payload: new Uint8Array([1]),
  }), /empty payload/);
});

test('input decoder rejects truncated, overlong and wrong-version packets', () => {
  const encoded = encodeLockstepInput({ matchTag: 1, sequence: 1, targetNetTick: 1, payload: new Uint8Array([7]) });
  assert.throws(() => decodeLockstepInput(encoded.subarray(0, encoded.length - 1)), /length/);
  const wrongVersion = new Uint8Array(encoded);
  wrongVersion[4] = 99;
  assert.throws(() => decodeLockstepInput(wrongVersion), /version/);
});

test('confirmed frame round-trips sorted player records and owned payload copies', () => {
  const source = new Uint8Array([3, 4]);
  const encoded = encodeConfirmedFrame({
    matchTag: 9,
    netTick: 7,
    inputs: [
      { slot: 0, sequence: 12, flags: LockstepInputFlags.NONE, payload: source },
      { slot: 2, sequence: 0, flags: LockstepInputFlags.NO_OP, payload: new Uint8Array() },
    ],
  });
  source[0] = 99;
  const decoded = decodeConfirmedFrame(encoded);
  assert.equal(decoded.matchTag, 9);
  assert.equal(decoded.netTick, 7);
  assert.deepEqual(decoded.inputs.map((input) => input.slot), [0, 2]);
  assert.deepEqual([...decoded.inputs[0].payload], [3, 4]);
  assert.equal(decoded.inputs[1].flags, LockstepInputFlags.NO_OP);
});

test('confirmed frames reject duplicate or unsorted player slots', () => {
  assert.throws(() => encodeConfirmedFrame({ matchTag: 1, netTick: 1, inputs: [
    { slot: 1, sequence: 1, flags: 0, payload: new Uint8Array() },
    { slot: 1, sequence: 2, flags: 0, payload: new Uint8Array() },
  ] }), /sorted by slot/);
});

test('confirmed frame queue buffers reordering and drains only contiguous ticks', () => {
  const queue = new ConfirmedFrameQueue(7, 1, 8);
  const frame = (netTick) => ({
    matchTag: 7,
    netTick,
    inputs: [{ slot: 0, sequence: netTick, flags: 0, payload: new Uint8Array() }],
  });
  assert.equal(queue.push(frame(2)), true);
  assert.deepEqual(queue.drainContiguous(), []);
  assert.equal(queue.push(frame(1)), true);
  assert.deepEqual(queue.drainContiguous().map((item) => item.netTick), [1, 2]);
  assert.equal(queue.expectedNetTick, 3);
  assert.equal(queue.push(frame(2)), false);
  assert.throws(() => queue.push({ ...frame(3), matchTag: 8 }), /another match/);
});

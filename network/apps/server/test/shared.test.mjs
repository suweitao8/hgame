import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSlot, createMatchTag, validateMaxClients, validateReconnectSeconds } from '../dist/rooms/shared.js';

test('slot allocator returns the first free deterministic slot', () => {
  assert.equal(allocateSlot([{ slot: 0, connected: true }, { slot: 2, connected: true }], 4), 1);
  assert.equal(allocateSlot([], 4), 0);
  assert.throws(() => allocateSlot([{ slot: 0, connected: true }], 1), /No free/);
});

test('match tags are nonzero UInt32 values', () => {
  const tag = createMatchTag();
  assert.ok(Number.isInteger(tag) && tag > 0 && tag <= 0xffff_ffff);
});

test('room options reject unsafe capacities and reconnection windows', () => {
  assert.equal(validateMaxClients(undefined), 16);
  assert.equal(validateMaxClients(8), 8);
  assert.equal(validateReconnectSeconds(undefined), 45);
  assert.equal(validateReconnectSeconds(0, 0), 0);
  assert.throws(() => validateMaxClients(33), /1 to 32/);
  assert.throws(() => validateReconnectSeconds(-1), /0 to 300/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicRng, fpDiv, fpMul, hashInt32State, intSqrt, toFixedInt, toFloat } from '../dist/index.js';

test('fixed point operations use checked integer intermediates', () => {
  assert.equal(toFixedInt(1.25), 1250);
  assert.equal(toFloat(1250), 1.25);
  assert.equal(fpMul(1234, -567), -699);
  assert.equal(fpDiv(1000, 500), 2000);
  assert.throws(() => fpDiv(1, 0), /division by zero/);
  assert.throws(() => fpMul(2_000_000_000, 2_000_000_000), /range/);
});

test('integer square root returns floor and rejects invalid values', () => {
  assert.equal(intSqrt(0), 0);
  assert.equal(intSqrt(144), 12);
  assert.equal(intSqrt(145), 12);
  assert.throws(() => intSqrt(-1), /nonnegative/);
});

test('seeded RNG repeats exactly and exposes serializable state', () => {
  const a = new DeterministicRng(0x12345678);
  const b = new DeterministicRng(0x12345678);
  const valuesA = Array.from({ length: 100 }, () => a.nextUint32());
  const valuesB = Array.from({ length: 100 }, () => b.nextUint32());
  assert.deepEqual(valuesA, valuesB);
  const saved = a.getState();
  const expected = a.nextUint32();
  a.setState(saved);
  assert.equal(a.nextUint32(), expected);
  for (let i = 0; i < 100; i++) assert.ok(a.rangeInt(-4, 7) >= -4 && a.getState() <= 0xffff_ffff);
});

test('state hash serializes Int32 values in canonical little-endian order', () => {
  assert.equal(hashInt32State([1, -2, 3]), hashInt32State([1, -2, 3]));
  assert.notEqual(hashInt32State([1, -2, 3]), hashInt32State([1, 3, -2]));
  assert.throws(() => hashInt32State([1.5]), /Int32/);
});

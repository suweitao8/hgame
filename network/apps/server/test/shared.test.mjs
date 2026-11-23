import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TokenBucketRateLimiter,
  allocateSlot,
  createMatchTag,
  validateMaxClients,
  validateRateLimit,
  validateReconnectSeconds,
} from '../dist/rooms/shared.js';

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

test('validateRateLimit validates bounds and defaults cleanly', () => {
  assert.equal(validateRateLimit(undefined, 30), 30);
  assert.equal(validateRateLimit(60, 30, 1, 240, 'rateLimit'), 60);
  assert.throws(() => validateRateLimit(0, 30, 1, 240, 'rateLimit'), /rateLimit/);
  assert.throws(() => validateRateLimit(999, 30, 1, 240, 'rateLimit'), /rateLimit/);
});

test('TokenBucketRateLimiter enforces burst, refills deterministically over time, and cleans up sessions', () => {
  const limiter = new TokenBucketRateLimiter(3, 10);
  assert.equal(limiter.consume('s1', 1, 1000), true);
  assert.equal(limiter.consume('s1', 1, 1000), true);
  assert.equal(limiter.consume('s1', 1, 1000), true);
  assert.equal(limiter.consume('s1', 1, 1000), false);

  // Advance 250ms -> refills 2.5 tokens -> allows 2 consumes
  assert.equal(limiter.consume('s1', 1, 1250), true);
  assert.equal(limiter.consume('s1', 1, 1250), true);
  assert.equal(limiter.consume('s1', 1, 1250), false);

  // Independent session has full burst
  assert.equal(limiter.consume('s2', 1, 1250), true);

  // remove() resets session bucket; clear() resets all
  limiter.remove('s1');
  assert.equal(limiter.consume('s1', 3, 1250), true);
  limiter.clear();
  assert.equal(limiter.consume('s1', 3, 1250), true);
});

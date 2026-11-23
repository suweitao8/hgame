import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRng, createStateChecksum, hashState, runScripted, HGame } from '../assets/runtime/index.js';

test('seeded rng is deterministic and state is restorable', () => {
  const a = createSeededRng(42), b = createSeededRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  const s = a.getState();
  const x = a.next();
  a.setState(s);
  assert.equal(a.next(), x);
  assert.notEqual(createSeededRng(1).next(), createSeededRng(2).next());
});

test('rng helpers stay in range; shuffle is a permutation; fork is independent', () => {
  const r = createSeededRng('seed');
  for (let i = 0; i < 200; i++) {
    const n = r.int(5); assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
    const f = r.range(-2, 3); assert.ok(f >= -2 && f < 3);
  }
  assert.equal(r.pick([]), undefined);
  assert.ok(['a', 'b'].includes(r.pick(['a', 'b'])));
  const arr = [1, 2, 3, 4, 5, 6];
  assert.strictEqual(r.shuffle(arr), arr);
  assert.deepEqual([...arr].sort(), [1, 2, 3, 4, 5, 6]);
  const p1 = createSeededRng(7), p2 = createSeededRng(7);
  const c1 = p1.fork('x'), c2 = p2.fork('x');
  assert.equal(c1.next(), c2.next());
  assert.equal(p1.next(), p2.next());
  assert.notEqual(createSeededRng(7).fork('x').next(), createSeededRng(7).fork('y').next());
});

test('hashState is stable, key-order independent and type sensitive', () => {
  assert.equal(hashState({ a: 1, b: [1, 2] }), hashState({ b: [1, 2], a: 1 }));
  assert.notEqual(hashState({ a: 1 }), hashState({ a: 2 }));
  assert.notEqual(hashState(1), hashState('1'));
  assert.equal(hashState(-0), hashState(0));
  assert.equal(hashState(new Float32Array([1, 2, 3])), hashState(new Float32Array([1, 2, 3])));
  assert.notEqual(hashState(new Float32Array([1, 2, 3])), hashState(new Float32Array([1, 2, 4])));
  const c = createStateChecksum().update(1).updateNumber(2);
  assert.equal(c.hex().length, 8);
  assert.notEqual(c.digest(), c.reset().digest() ^ 1);
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => hashState(cyc), RangeError);
  assert.equal(typeof HGame.createSeededRng, 'function');
});

test('runScripted replays identically and detects divergence', () => {
  const run = (script) => {
    const rng = createSeededRng(9); const st = { x: 0, n: 0 };
    return runScripted({ script, step: (t, i) => { st.x += (i ?? 0) + rng.next(); st.n++; }, checksum: () => st, recordEvery: 2 });
  };
  const s = [1, 0, -1, 2];
  const a = run(s), b = run(s), c = run([1, 0, -1, 3]);
  assert.equal(a.checksum, b.checksum);
  assert.deepEqual(a.samples, b.samples);
  assert.equal(a.samples.length, 2);
  assert.notEqual(a.checksum, c.checksum);
  assert.equal(runScripted({ step() {}, script: (t) => t, ticks: 3 }).ticks, 3);
  assert.throws(() => runScripted({}), TypeError);
});

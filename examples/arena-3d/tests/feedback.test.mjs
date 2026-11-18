import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaCue } from '../src/feedback.js';

test('arena feedback distinguishes strikes, damage, progress and victory', () => {
  assert.equal(arenaCue({ type: 'player.spin', details: { hits: 0 } }, 2), 'slash');
  assert.equal(arenaCue({ type: 'player.spin', details: { hits: 2 } }, 2), 'hit');
  assert.equal(arenaCue({ type: 'player.damaged' }, 2), 'hurt');
  assert.equal(arenaCue({ type: 'beacon.charged', details: { chargedCount: 1 } }, 2), 'pickup');
  assert.equal(arenaCue({ type: 'beacon.charged', details: { chargedCount: 2 } }, 2), null);
  assert.equal(arenaCue({ type: 'exit.opened' }, 2), 'powerup');
  assert.equal(arenaCue({ type: 'run.finished', details: { outcome: 'victory' } }, 2).preset, 'powerup');
  assert.equal(arenaCue({ type: 'run.finished', details: { outcome: 'defeat' } }, 2), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScorecard, verifyBenchmarks, DEFAULT_SCORECARD_PATH } from '../scripts/score-engines.mjs';

test('verifyBenchmarks maps failing Node tests to the items citing them', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const res = verifyBenchmarks(data, { run: (rel) => ({ ok: !rel.includes('deterministic-physics'), output: '' }) });
  assert.ok(res.errors.some((e) => e.includes('deterministic-physics') && e.includes('S1')));
  assert.ok(res.results.some((r) => r.status === 'browserOnly'));
});

test('verifyBenchmarks covers all 20 scorecard items with Node-run evidence', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const res = verifyBenchmarks(data, { run: () => ({ ok: true, output: '' }) });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.browserOnlyItems, []);
});

test('verifyBenchmarks flags items lacking Node-run evidence when only browser scripts are present', () => {
  const data = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  data.items.find((i) => i.id === 'A1').hgame.benchmarkFiles = ['tests/browser-engine-v3-commercial-benchmark.mjs'];
  const res = verifyBenchmarks(data, { run: () => ({ ok: true, output: '' }) });
  assert.deepEqual(res.errors, []);
  assert.ok(res.browserOnlyItems.includes('A1'));
  assert.ok(!res.browserOnlyItems.includes('S1'));
});

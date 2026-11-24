import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScores, loadScorecard, validateScorecard, DEFAULT_REPO_ROOT, DEFAULT_SCORECARD_PATH } from '../scripts/score-engines.mjs';

test('T dimension (Toy readiness + tooling) is part of the 100-point scheme', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const t = data.dimensions.find((d) => d.id === 'T');
  assert.equal(t?.weight, 8);
  assert.equal(data.dimensions.reduce((s, d) => s + d.weight, 0), 100);
  assert.equal(data.items.filter((i) => i.dimension === 'T').reduce((s, i) => s + i.weight, 0), 8);
});

test('render+perf no longer dominate and every engine scores T', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const w = Object.fromEntries(data.dimensions.map((d) => [d.id, d.weight]));
  assert.ok(w.R + w.P <= 46);
  const computed = computeScores(data);
  for (const e of data.engines) assert.ok(computed.byEngine[e.id].dimensions.T.pct >= 0);
});

test('T items cite Node-runnable benchmark files and keep an honest unmet gap', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  for (const item of data.items.filter((i) => i.dimension === 'T')) {
    assert.ok(item.hgame.benchmarkFiles.length > 0, item.id);
    assert.ok(item.hgame.industrialChecklist.some((c) => c.met === false), `${item.id} should expose an open gap`);
    assert.ok(item.scores.hgame <= 8.5, `${item.id} self-score must stay conservative`);
  }
  assert.deepEqual(validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT }), []);
});

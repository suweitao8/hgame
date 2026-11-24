import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWarnings,
  checkMeasurementDrift,
  loadScorecard,
  validateScorecard,
  DEFAULT_REPO_ROOT,
  DEFAULT_SCORECARD_PATH
} from '../scripts/score-engines.mjs';
import { GAME_SCORE_WEIGHTS, scoreAcceptanceReport } from '../scripts/score-game.mjs';

const passed = { status: 'passed' };
const fullReport = () => ({
  gameId: 'demo',
  gates: {
    config: passed, syntax: passed, uiStatic: passed, tests: passed, designDocs: passed,
    visual: { status: 'passed', captures: {} },
    playtest: { status: 'passed', frameStats: { p95Ms: 16.8 } },
    doctor: passed,
    autoplay: { status: 'passed', skillDelta: 0.8, bot: { winRate: 0.7, timeoutRate: 0 } },
    webasset: passed, package: passed, taskManifest: passed
  }
});

test('game score weights sum to 100', () => {
  const sum = Object.values(GAME_SCORE_WEIGHTS).flatMap((g) => Object.values(g)).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('fully passing report scores 100 with full confidence', () => {
  const r = scoreAcceptanceReport(fullReport());
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 1);
  assert.equal(r.grade, 'A');
});

test('skipped gates lower confidence instead of counting as passed', () => {
  const rep = fullReport();
  rep.gates.package = { status: 'skipped' };
  rep.gates.webasset = { status: 'skipped' };
  const r = scoreAcceptanceReport(rep);
  assert.equal(r.score, 89);
  assert.equal(r.confidence, 0.89);
  assert.deepEqual(r.unverifiedGates.sort(), ['package', 'webasset']);
});

test('a failed gate forces grade F and earns zero for that gate', () => {
  const rep = fullReport();
  rep.gates.tests = { status: 'failed' };
  const r = scoreAcceptanceReport(rep);
  assert.equal(r.grade, 'F');
  assert.deepEqual(r.failedGates, ['tests']);
  assert.equal(r.score, 92);
});

test('trivially easy autoplay and long frames reduce quality factor', () => {
  const rep = fullReport();
  rep.gates.autoplay.bot.winRate = 1;
  rep.gates.playtest.frameStats.p95Ms = 40;
  const r = scoreAcceptanceReport(rep);
  assert.ok(r.score < 100);
});

test('scorecard rejects missing competitor basis and over-budget measurements', () => {
  const data = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  delete data.competitorBasis.unity;
  data.measurements.runtimeJsGzipMB = data.budgets.runtimeJsGzipMB + 1;
  const errors = validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(errors.some((e) => e.includes('competitorBasis.unity')));
  assert.ok(errors.some((e) => e.includes('exceeds budget')));
});

test('scorecard rejects non-existent benchmarkFiles and flags drift', () => {
  const data = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  data.items[0].hgame.benchmarkFiles = ['tests/does-not-exist.mjs'];
  assert.ok(validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT }).some((e) => e.includes('benchmarkFile does not exist')));
  const drift = checkMeasurementDrift(data, { runtimeJsGzipMB: data.measurements.runtimeJsGzipMB * 2 });
  assert.ok(drift.some((e) => e.includes('drifted')));
});

test('collectWarnings flags C3 items without benchmarks', () => {
  const data = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  data.items[0].hgame.benchmarkFiles = [];
  assert.ok(collectWarnings(data).some((w) => w.startsWith('A1') && w.includes('benchmarkFiles')));
});

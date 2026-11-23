import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_DOC_PATH,
  DEFAULT_REPO_ROOT,
  DEFAULT_SCORECARD_PATH,
  applySections,
  computeScores,
  loadScorecard,
  normalizeNewlines,
  renderSections,
  summarizeChecklist,
  validateScorecard
} from '../scripts/score-engines.mjs';

test('engine-scorecard.json passes strict v5.2 validation with zero errors', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const errors = validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT });
  assert.deepEqual(errors, []);
});

test('all engines runtime scores stay within 0..100 and respect capability caps & checklists', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const computed = computeScores(data);

  for (const eng of data.engines) {
    const row = computed.byEngine[eng.id];
    assert.ok(row.runtimeTotal >= 0 && row.runtimeTotal <= 100, `${eng.id} runtime out of range`);
  }

  for (const item of data.items) {
    const cap = data.evidenceLevels[item.hgame.evidence].cap;
    const { met, applicable } = summarizeChecklist(item);
    const maxAllowed = item.hgame.defaultPath ? 8 + (2 * met) / applicable : 7;
    assert.ok(item.scores.hgame <= cap, `${item.id} exceeds cap ${cap}`);
    assert.ok(item.scores.hgame <= maxAllowed + 1e-9, `${item.id} exceeds checklist maxAllowed ${maxAllowed}`);
  }
});

test('validator rejects capability cap / non-defaultPath violations', () => {
  const data = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  const a2 = data.items.find((it) => it.id === 'A2');
  assert.ok(a2);
  a2.hgame.evidence = 'C1';
  a2.hgame.defaultPath = false;
  a2.scores.hgame = 9;
  const errors = validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(errors.some((e) => e.includes('A2') && e.includes('cap')));
  assert.ok(errors.some((e) => e.includes('A2') && e.includes('defaultPath=false')));
});

test('validator enforces industrialChecklist maxAllowed and C3/C4 consistency', () => {
  const overMax = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  const a1 = overMax.items.find((it) => it.id === 'A1');
  a1.hgame.evidence = 'C4';
  a1.scores.hgame = 9.5;
  const overErrors = validateScorecard(overMax, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(overErrors.some((e) => e.includes('A1') && e.includes('C4 requires all')));
  assert.ok(overErrors.some((e) => e.includes('A1') && e.includes('industrialChecklist maxAllowed')));

  const badC3 = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  const s4 = badC3.items.find((it) => it.id === 'S4');
  s4.hgame.evidence = 'C3';
  for (const entry of s4.hgame.industrialChecklist) entry.met = false;
  s4.scores.hgame = 8.0;
  const c3Errors = validateScorecard(badC3, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(c3Errors.some((e) => e.includes('S4') && e.includes('C3 requires at least 1')));

  const emptyProof = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  emptyProof.items[0].hgame.industrialChecklist[0].proof = '  ';
  const proofErrors = validateScorecard(emptyProof, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(proofErrors.some((e) => e.includes('industrialChecklist[0].proof')));
});

test('validator rejects missing proofFiles and mismatched weights', () => {
  const missingProof = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  missingProof.items[0].hgame.proofFiles = ['assets/runtime/non-existent-file-check.js'];
  const proofErrors = validateScorecard(missingProof, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(proofErrors.some((e) => e.includes('proofFile does not exist')));

  const badWeight = structuredClone(loadScorecard(DEFAULT_SCORECARD_PATH));
  badWeight.items[0].weight += 1;
  const weightErrors = validateScorecard(badWeight, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(weightErrors.some((e) => e.includes('weight sum')));
});

test('ENGINE-SCORECARD.md generated sections are in sync with engine-scorecard.json', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const computed = computeScores(data);
  const sections = renderSections(data, computed);
  const currentDoc = normalizeNewlines(fs.readFileSync(DEFAULT_DOC_PATH, 'utf8'));
  const expectedDoc = applySections(currentDoc, sections);
  assert.equal(currentDoc, expectedDoc, 'Run "node scripts/score-engines.mjs --write" to sync markdown.');
});

test('exempt checklist entries leave the maturity tag and short-board column, and stay public', () => {
  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const r1 = data.items.find((it) => it.id === 'R1');
  const r1Counts = summarizeChecklist(r1);
  assert.equal(r1Counts.exempt, 1);
  assert.deepEqual([r1Counts.met, r1Counts.applicable], [3, 3]);

  const s1Counts = summarizeChecklist(data.items.find((it) => it.id === 'S1'));
  assert.deepEqual([s1Counts.met, s1Counts.applicable, s1Counts.exempt], [3, 4, 1]);

  const sections = renderSections(data);
  assert.ok(sections.items.includes('| R1 |') && sections.items.includes('C3 (3/3 · 豁免 1)'));
  assert.ok(!sections.items.includes('Spine / DragonBones 运行时支持'));
  for (const item of data.items) {
    for (const entry of item.hgame.industrialChecklist.filter((c) => c.exempt)) {
      assert.ok(sections.exemptions.includes(entry.point), `${item.id} exemption point not listed`);
      assert.ok(sections.exemptions.includes(entry.exemptReason), `${item.id} exemption reason not listed`);
    }
  }
});

test('exempt entries lift maxAllowed and the C4 gate only while the exemption stands', () => {
  const lifted = loadScorecard(DEFAULT_SCORECARD_PATH);
  const liftedR1 = lifted.items.find((it) => it.id === 'R1');
  liftedR1.hgame.evidence = 'C4';
  liftedR1.scores.hgame = 10;
  assert.deepEqual(validateScorecard(lifted, { repoRoot: DEFAULT_REPO_ROOT }), []);

  const revoked = structuredClone(lifted);
  revoked.items.find((it) => it.id === 'R1').hgame.industrialChecklist[2].exempt = false;
  const revokedErrors = validateScorecard(revoked, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(revokedErrors.some((e) => e.includes('R1') && e.includes('C4 requires all')));
  assert.ok(revokedErrors.some((e) => e.includes('R1') && e.includes('industrialChecklist maxAllowed')));
});

test('validator enforces exemption guardrails', () => {
  const metExempt = loadScorecard(DEFAULT_SCORECARD_PATH);
  metExempt.items.find((it) => it.id === 'R1').hgame.industrialChecklist[2].met = true;
  const metErrors = validateScorecard(metExempt, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(metErrors.some((e) => e.includes('R1') && e.includes('cannot also be met')));

  const noReason = loadScorecard(DEFAULT_SCORECARD_PATH);
  delete noReason.items.find((it) => it.id === 'R1').hgame.industrialChecklist[2].exemptReason;
  const reasonErrors = validateScorecard(noReason, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(reasonErrors.some((e) => e.includes('R1') && e.includes('exemptReason')));

  const hollow = loadScorecard(DEFAULT_SCORECARD_PATH);
  for (const entry of hollow.items.find((it) => it.id === 'A3').hgame.industrialChecklist) {
    entry.met = false;
    entry.exempt = true;
    entry.exemptReason = 'out of scope';
  }
  const hollowErrors = validateScorecard(hollow, { repoRoot: DEFAULT_REPO_ROOT });
  assert.ok(hollowErrors.some((e) => e.includes('A3') && e.includes('at least 3 non-exempt')));
});

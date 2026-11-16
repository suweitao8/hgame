import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('fixed-reference comparison passes identical output and rejects a deliberate visual regression', async t => {
  const { compareVisualScenarios } = await import('../scripts/check-visual-regression.mjs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hgame-visual-comparison-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const referenceRoot = path.join(dir, 'reference');
  const candidateRoot = path.join(dir, 'candidate');
  const page = color => `<!doctype html><canvas id="game" data-engine-ready="true" width="64" height="64"></canvas><script>
const g = document.getElementById('game').getContext('2d');
g.fillStyle = '#123'; g.fillRect(0, 0, 64, 64); g.fillStyle = '${color}'; g.fillRect(4, 4, 24, 24);
</script>`;
  const referenceFile = path.join(referenceRoot, 'examples/probe/index.html');
  const candidateFile = path.join(candidateRoot, 'examples/probe/index.html');
  mkdirSync(path.dirname(referenceFile), { recursive: true });
  mkdirSync(path.dirname(candidateFile), { recursive: true });
  writeFileSync(referenceFile, page('#fa0'));
  writeFileSync(candidateFile, page('#fa0'));
  const options = { referenceRoot, candidateRoot, outDir: path.join(dir, 'output'), viewport: '64x64',
    scenarios: [{ id: 'probe', steps: 0, keys: '', query: '', threshold: 0 }] };
  const identical = compareVisualScenarios(options);
  assert.equal(identical[0].ok, true, JSON.stringify(identical));
  assert.equal(identical[0].candidate.baseline.diffRatio, 0);
  const accepted = readFileSync(path.join(options.outDir, 'probe.reference.png'));
  writeFileSync(candidateFile, page('#0af'));
  const changed = compareVisualScenarios(options);
  assert.equal(changed[0].ok, false);
  assert.ok(changed[0].candidate.baseline.diffRatio > 0.1);
  assert.deepEqual(readFileSync(path.join(options.outDir, 'probe.reference.png')), accepted);
  assert.ok(changed[0].candidate.problems.some(problem => problem.includes('baseline')));
});

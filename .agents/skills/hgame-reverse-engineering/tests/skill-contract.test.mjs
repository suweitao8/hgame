import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reverseRoot = fileURLToPath(new URL('../', import.meta.url));
const htmlSkillRoot = path.resolve(reverseRoot, '..', 'hgame');
const hgameRepoRoot = path.resolve(reverseRoot, '..', '..', '..');

async function exists(file) {
  return (await stat(file)).isFile();
}

test('both reverse and HGame skills link to working tools, real API references, and engine bundles', async () => {
  const reverse = await readFile(path.join(reverseRoot, 'SKILL.md'), 'utf8');
  const html = await readFile(path.join(htmlSkillRoot, 'SKILL.md'), 'utf8');
  assert.match(reverse, /scripts\/start-research\.mjs/);
  assert.match(reverse, /scripts\/audit-coverage\.mjs/);
  assert.match(reverse, /references\/portable-workflow\.md/);
  assert.match(reverse, /plan-rebuild\.mjs/);
  assert.match(reverse, /UNITY-SOURCE-TO-HTML\.md/);
  assert.match(reverse, /createConfirmedFrameScheduler/);
  assert.match(reverse, /compare-tick-traces\.mjs/);
  assert.match(html, /hgame-reverse-engineering/);
  assert.match(html, /hgame-spec-forge/);

  for (const file of [
    path.join(reverseRoot, 'scripts', 'local-config.mjs'),
    path.join(reverseRoot, 'scripts', 'extract-fast.mjs'),
    path.join(reverseRoot, 'scripts', 'export-clean-spec.mjs'),
    path.join(reverseRoot, 'scripts', 'start-research.mjs'),
    path.join(reverseRoot, 'scripts', 'audit-coverage.mjs'),
    path.join(reverseRoot, 'tools', 'game-reverse-scanner', 'bin', 'game-reverse-scan.mjs'),
    path.join(reverseRoot, 'references', 'portable-workflow.md'),
    path.join(reverseRoot, 'references', 'playbooks', 'engine-playbooks.md'),
    path.join(reverseRoot, 'assets', 'coverage.template.csv'),
    path.join(reverseRoot, 'scripts', 'plan-rebuild.mjs'),
    path.join(reverseRoot, 'scripts', 'compare-tick-traces.mjs'),
    path.join(reverseRoot, 'scripts', 'analyze-data-tables.mjs'),
    path.join(reverseRoot, 'scripts', 'audit-function-index.mjs'),
    path.join(reverseRoot, 'scripts', 'compare-game-traces.mjs'),
    path.join(reverseRoot, 'references', 'evidence-pipeline.md'),
    path.join(reverseRoot, 'assets', 'function-index.template.json'),
    path.join(reverseRoot, 'assets', 'data-schema.template.json'),
    path.join(reverseRoot, 'assets', 'trace-map.template.json'),
    path.join(reverseRoot, 'references', 'UNITY-SOURCE-TO-HTML.md'),
    path.join(hgameRepoRoot, '.agents', 'skills', 'hgame-spec-forge', 'SKILL.md'),
    path.join(hgameRepoRoot, 'scripts', 'create-game.mjs'),
    path.join(hgameRepoRoot, 'scripts', 'preview.mjs'),
    path.join(hgameRepoRoot, 'assets', 'runtime', 'platform', 'engine.js'),
    path.join(hgameRepoRoot, 'assets', 'runtime', 'index.js'),
    path.join(hgameRepoRoot, 'assets', 'runtime', 'lockstep', 'confirmed-frames.js'),
    path.join(hgameRepoRoot, 'assets', 'profiles', '2d', 'main.js'),
    path.join(hgameRepoRoot, 'assets', 'profiles', '3d', 'main.js'),
    path.join(hgameRepoRoot, 'assets', 'profiles', 'ui', 'main.js'),
  ]) assert.equal(await exists(file), true, 'Missing installed Skill dependency: ' + file);
});

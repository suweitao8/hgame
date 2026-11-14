import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queryScript = path.join(root, 'scripts', 'query-api.mjs');

test('query-api supports --map, --recipe, --module, keyword, and --json cleanly', () => {
  const mapJson = JSON.parse(execFileSync(process.execPath, [queryScript, '--map', '--json'], { encoding: 'utf8' }));
  assert.ok(Array.isArray(mapJson) && mapJson.length >= 14);
  assert.ok(mapJson.some(row => row.module.includes('post2d.js')));
  assert.ok(mapJson.some(row => row.module.includes('terrain3d.js')));

  for (const recipe of ['2d', 'horde', '3d', 'ui', 'network']) {
    const out = JSON.parse(execFileSync(process.execPath, [queryScript, '--recipe', recipe, '--json'], { encoding: 'utf8' }));
    assert.equal(out.recipe, recipe);
    assert.ok(out.code.length > 40);
  }

  const modOut = JSON.parse(execFileSync(process.execPath, [queryScript, '--module', 'terrain3d', '--json'], { encoding: 'utf8' }));
  assert.equal(modOut.matches.length, 1);
  assert.ok(modOut.matches[0].exports.some(e => e.name === 'createHeightfieldTerrain3D'));
});

test('AI docs stay pure AI-native, conflict-free, and cover system cards 01..16', () => {
  const guide = readFileSync(path.join(root, 'docs', 'guides', 'USER-AND-AGENT-GUIDE.md'), 'utf8');
  assert.doesNotMatch(guide, /人类速查|mermaid|feat\/\*/i);
  assert.equal(existsSync(path.join(root, 'docs', 'guides', 'ENGINE-GAPS.md')), false);

  for (const card of [
    '13-ai-fsm-bt-navmesh.md',
    '14-post2d-terrain3d-props.md',
    '15-ui-kit-i18n-versioned-save.md',
    '16-procedural-bgm.md',
  ]) {
    const cardPath = path.join(root, 'docs', 'guides', 'systems', card);
    assert.equal(existsSync(cardPath), true, `Missing system card ${card}`);
    assert.match(guide, new RegExp(card));
  }
});

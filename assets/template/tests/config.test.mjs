import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBASSET_ALLOWLIST = new Set([
  'schemaVersion',
  'id',
  'name',
  'version',
  'entry',
  'renderer',
  'runtime',
  'standalone',
]);

test('game recipe matches the selected modular profile and retains the Host protocol', async () => {
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(await readFile(new URL('../game.config.json', import.meta.url), 'utf8'));
  const recipe = JSON.parse(await readFile(new URL('../engine.config.json', import.meta.url), 'utf8'));
  const entrySource = existsSync(path.join(projectDir, 'src', 'main.js'))
    ? new URL('../src/main.js', import.meta.url)
    : new URL('../src/bare.js', import.meta.url);
  const source = await readFile(entrySource, 'utf8');

  const extraKeys = Object.keys(config).filter(k => !WEBASSET_ALLOWLIST.has(k));
  assert.deepEqual(extraKeys, [], `game.config.json contains disallowed WebAsset keys: ${extraKeys.join(', ')}`);
  assert.equal(config.schemaVersion, 1);
  assert.match(config.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
  if (path.basename(projectDir) !== 'template') {
    assert.equal(config.id, path.basename(projectDir));
  }
  assert.equal(config.runtime, 'webasset-v1');
  assert.equal(config.renderer, recipe.renderer === 'webgl2d' ? 'webgl-custom' : recipe.renderer);
  assert.equal(config.entry, 'index.html');
  assert.equal(typeof config.standalone, 'boolean');
  assert.equal(recipe.configVersion, 1);
  assert.ok(['2d', '3d', 'ui'].includes(recipe.profile));
  assert.match(source, /hgame|startPixiGame/);

  for (const docName of ['GDD.md', 'ART-AND-AUDIO.md', 'UI-UX.md', 'LEVEL.md']) {
    const docPath = path.join(projectDir, 'docs', 'design', docName);
    assert.equal(existsSync(docPath), true, `Missing design doc: docs/design/${docName}`);
    const docText = await readFile(docPath, 'utf8');
    assert.ok(docText.trim().length >= 120, `docs/design/${docName} must be substantive`);
    assert.equal(/\b(?:TODO|FIXME|TBD)\b|待补充|请填写/.test(docText), false, `docs/design/${docName} contains unresolved placeholder`);
  }
});

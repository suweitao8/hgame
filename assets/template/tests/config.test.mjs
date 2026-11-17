import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('game recipe matches the selected modular profile and retains the Host protocol', async () => {
  const config = JSON.parse(await readFile(new URL('../game.config.json', import.meta.url), 'utf8'));
  const recipe = JSON.parse(await readFile(new URL('../engine.config.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(config.schemaVersion, 1);
  assert.match(config.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
  assert.equal(config.runtime, 'webasset-v1');
  assert.equal(config.renderer, recipe.renderer === 'webgl2d' ? 'webgl-custom' : recipe.renderer);
  assert.equal(config.entry, 'index.html');
  assert.equal(typeof config.standalone, 'boolean');
  assert.equal(recipe.configVersion, 1);
  assert.ok(['2d', '3d', 'ui'].includes(recipe.profile));
  assert.match(source, /hgame/);
  assert.match(source, /createApplication|createGameApplication/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('recipe matches the 2d/webgl2d profile and main.js wires the engine', async () => {
  const config = JSON.parse(await readFile(new URL('../game.config.json', import.meta.url), 'utf8'));
  const recipe = JSON.parse(await readFile(new URL('../engine.config.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(config.renderer, 'webgl-custom');
  assert.equal(recipe.renderer, 'webgl2d');
  assert.match(config.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
  for (const needle of ['createApplication', 'SpriteCrowd2D', 'createArcadeControls', 'createTouchControls', 'hgame']) {
    assert.ok(source.includes(needle), `main.js should use ${needle}`);
  }
});

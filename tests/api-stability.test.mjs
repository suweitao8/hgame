import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const index = JSON.parse(readFileSync(new URL('../docs/api/API-INDEX.json', import.meta.url), 'utf8'));
const find = (module, name) => index.modules[module].exports.find(entry => entry.name === name);

test('facade exports keep implementation stability and declaring modules', () => {
  assert.equal(find('index.js', 'createGameApplication').tier, 'stable');
  for (const module of ['index.js', 'world/open-world.js']) {
    const entry = find(module, 'createWorldPartition');
    assert.equal(entry.tier, 'experimental');
    assert.equal(entry.declaredIn, 'world/open-world.js');
  }
  assert.equal(find('index.js', 'createInputManager').tier, 'stable');
  assert.equal(index.modules['platform/input/manager.js'], undefined);
});

test('query results expose effective stability through root re-exports', () => {
  const script = fileURLToPath(new URL('../scripts/query-api.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [script, '--module', 'index.js', 'createWorldPartition', '--json'], { encoding: 'utf8' }));
  assert.equal(result.matches[0].exports[0].tier, 'experimental');
});

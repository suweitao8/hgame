import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('public declaration consumers infer values and reject invalid lifecycle, AI and save calls', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext',
    '--moduleResolution', 'nodenext', path.join(root, 'tests/type-contracts/public-api.ts')],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

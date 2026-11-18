import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
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

test('declaration generation follows internal imports from public modules', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hgame-type-entries-'));
  try {
    const runtime = path.join(fixture, 'assets', 'runtime');
    const internal = path.join(runtime, 'internal');
    const scripts = path.join(fixture, 'scripts');
    await mkdir(internal, { recursive: true });
    await mkdir(scripts);
    await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
    await copyFile(path.join(root, 'scripts', 'build-types.mjs'), path.join(scripts, 'build-types.mjs'));
    await writeFile(path.join(runtime, 'index.js'), "export { getState } from './internal/state.js';\n");
    await writeFile(path.join(internal, 'state.js'), 'export function getState() { return { ticks: 1 }; }\n');
    await writeFile(path.join(internal, 'draft.js'), 'export function draft() { return false; }\n');
    const build = spawnSync(process.execPath, [path.join(scripts, 'build-types.mjs')], { encoding: 'utf8', windowsHide: true });
    assert.ifError(build.error);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const types = path.join(fixture, 'types');
    assert.match(await readFile(path.join(types, 'index.d.ts'), 'utf8'), /getState/);
    assert.match(await readFile(path.join(types, 'internal', 'state.d.ts'), 'utf8'), /ticks: number/);
    assert.deepEqual(await readdir(path.join(types, 'internal')), ['state.d.ts']);
  } finally {
    await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

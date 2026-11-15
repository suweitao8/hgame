import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/inventory.mjs', import.meta.url));

test('reverse engineering inventory is read-only, bounded, and recognizes common engine evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-reverse-inventory-'));
  try {
    await mkdir(path.join(root, 'Demo_Data', 'Managed'), { recursive: true });
    await writeFile(path.join(root, 'Demo_Data', 'Managed', 'Assembly-CSharp.dll'), 'placeholder');
    await writeFile(path.join(root, 'GameAssembly.dll'), 'placeholder');
    await writeFile(path.join(root, 'Demo.exe'), 'placeholder');
    const before = (await readdir(root)).sort();
    const beforeInfo = await stat(path.join(root, 'GameAssembly.dll'));
    const run = spawnSync(process.execPath, [script, root, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.filesScanned, 3);
    assert.equal(result.truncated, false);
    assert.ok(result.likelyEngines.includes('Unity IL2CPP'));
    assert.ok(result.evidence.some(entry => entry.path.includes('Assembly-CSharp.dll')));
    assert.deepEqual((await readdir(root)).sort(), before);
    assert.equal((await stat(path.join(root, 'GameAssembly.dll'))).size, beforeInfo.size);
    const capped = spawnSync(process.execPath, [script, root, '--json', '--max-files', '1'], { encoding: 'utf8' });
    assert.equal(capped.status, 0, capped.stderr);
    assert.equal(JSON.parse(capped.stdout).truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

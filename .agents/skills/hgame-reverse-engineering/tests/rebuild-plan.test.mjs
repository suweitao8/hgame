import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/plan-rebuild.mjs', import.meta.url));

test('rebuild planner requires explicit camera/physics profile evidence and never infers dimension from Unity label', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unity-rebuild-plan-'));
  const source = path.join(root, 'original');
  const research = path.join(root, 'research');
  const target = path.join(root, 'html-project');
  try {
    await mkdir(source);
    await mkdir(path.join(research, 'production'), { recursive: true });
    await writeFile(path.join(research, 'baseline.json'), JSON.stringify({ gameId: 'original', sourcePath: source, scannerStatus: 'unreviewed' }));
    const run = (...argv) => spawnSync(process.execPath, [script, research, ...argv], { encoding: 'utf8' });
    assert.notEqual(run('--target', target).status, 0);
    assert.notEqual(run('--target', target, '--profile', '3d').status, 0);
    const first = run('--target', target, '--profile', '3d', '--evidence', 'runtime camera observed in scene', '--dry-run');
    assert.equal(first.status, 0, first.stderr);
    const dry = JSON.parse(first.stdout);
    assert.equal(dry.engineRecipe.renderer, 'threejs');
    assert.equal(dry.engineRecipe.physics, 'none');
    const built = run('--target', target, '--profile', '3d', '--evidence', 'runtime camera observed in scene');
    assert.equal(built.status, 0, built.stderr);
    const plan = JSON.parse(await readFile(path.join(research, 'production', 'rebuild-plan.json'), 'utf8'));
    assert.equal(plan.status, 'planned-not-implemented');
    assert.equal(plan.evidence[0].verified, false);
    assert.equal(plan.engineRecipe.profile, '3d');
    assert.notEqual(run('--target', target, '--profile', '3d', '--evidence', 'again').status, 0);
    assert.notEqual(run('--target', path.join(source, 'output'), '--profile', '2d', '--evidence', '2d collider').status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildExample, listExamples } from '../scripts/build-examples.mjs';

// Reference examples (examples/*): each must replay a 60 s scripted run bit-identically and package cleanly.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = await import(pathToFileURL(path.join(root, 'assets/runtime/index.js')).href);
const load = (id, rel) => import(pathToFileURL(path.join(root, 'examples', id, rel)).href);

const runs = {
  'survivor-2d': async () => {
    const { createSurvivorSim } = await load('survivor-2d', 'src/sim/survivor.js');
    const { runScript } = await load('survivor-2d', 'src/sim/script.js');
    const make = () => createSurvivorSim({ SpatialHash2D: runtime.SpatialHash2D, seed: 42 });
    const sim = make();
    return { a: runScript(sim, 60), b: runScript(make(), 60), enemies: sim.en.count, kills: sim.state.kills };
  },
  'arena-3d': async () => {
    const { createArenaSim } = await load('arena-3d', 'src/sim/arena.js');
    const { runScript } = await load('arena-3d', 'src/sim/script.js');
    const make = () => createArenaSim({ seed: 42, tier: 'high', godMode: true });
    const sim = make();
    return { a: runScript(sim, 60), b: runScript(make(), 60), enemies: sim.en.count, kills: sim.state.kills };
  },
};

test('every example is covered by this suite', async () => {
  assert.deepEqual((await listExamples()).sort(), Object.keys(runs).sort());
});

for (const id of Object.keys(runs)) {
  test(`examples/${id}: 60s scripted run twice -> identical state checksum`, async () => {
    const r = await runs[id]();
    assert.match(r.a, /^[0-9a-f]{8}$/);
    assert.equal(r.a, r.b);
    assert.ok(r.kills > 0, 'scripted run actually plays (kills > 0)');
    assert.ok(r.enemies > 0);
  });

  test(`examples/${id}: packages with scripts/package-game.mjs`, async () => {
    // vendor/ is generated and git-ignored: build it when missing (fresh clone / CI).
    if (!existsSync(path.join(root, 'examples', id, 'vendor', 'hgame', 'index.js'))) await buildExample(id);
    const out = await mkdtemp(path.join(os.tmpdir(), 'hgame-ex-pkg-'));
    try {
      const res = spawnSync(process.execPath, [path.join(root, 'scripts/package-game.mjs'), path.join(root, 'examples', id),
        '--version', '0.1.0', '--out-dir', out], { encoding: 'utf8' });
      assert.equal(res.status, 0, res.stderr || res.stdout);
      const report = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
      assert.ok(existsSync(path.join(report.outputDir, 'index.html')));
      assert.ok(existsSync(report.zipPath));
      const cfg = JSON.parse(await readFile(path.join(report.outputDir, 'game.config.json'), 'utf8'));
      assert.equal(cfg.id, id);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
}

#!/usr/bin/env node
// Optional browser acceptance: the snapshot tool must be deterministic and detect real change,
// for both 2D and 3D profiles. Usage: node tests/browser-snapshot.mjs [--chrome <path>]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const chrome = argv.includes('--chrome') ? ['--chrome', argv[argv.indexOf('--chrome') + 1]] : [];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-snaptest-'));
const run = (script, args) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });
const fail = msg => { console.error('FAIL ' + msg); process.exitCode = 1; };
try {
  for (const profile of ['2d', '3d']) {
    const game = path.join(tmp, profile);
    const gen = run('create-game.mjs', [game, '--profile', profile, '--no-git']);
    if (gen.status !== 0) throw new Error(gen.stderr);
    const base = path.join(tmp, `${profile}-base.png`);
    const common = [game, '--ready', '#game[data-engine-ready=true]', '--wait', '600', ...chrome];
    const a = run('snapshot.mjs', [...common, '--baseline', base, '--update-baseline']);
    const ra = JSON.parse(a.stdout);
    if (!ra.ok) { fail(`${profile}: first snapshot problems: ${ra.problems}`); continue; }
    // 3D animates continuously, so identical frames are only expected for 2D; 3D must stay within a small tolerance.
    const b = run('snapshot.mjs', [...common, '--baseline', base, '--threshold', profile === '2d' ? '0' : '0.05']);
    const rb = JSON.parse(b.stdout);
    if (!rb.ok) fail(`${profile}: repeat snapshot differs: ${JSON.stringify(rb.baseline)} ${rb.problems}`);
    const c = run('snapshot.mjs', [...common, '--keys', 'd:500', '--baseline', base, '--threshold', '0.0005']);
    const rc = JSON.parse(c.stdout);
    if (rc.ok) fail(`${profile}: moving the player did not register as a render change`);
    console.log(JSON.stringify({ profile, nonBlank: ra.stats.nonBlankRatio, repeatDiff: rb.baseline?.diffRatio, afterInputDiff: rc.baseline?.diffRatio }));
  }
} finally { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }

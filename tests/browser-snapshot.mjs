#!/usr/bin/env node
// Optional browser acceptance: the snapshot tool must be deterministic and detect real change,
// for both 2D and 3D profiles. Usage: node tests/browser-snapshot.mjs [--chrome <path>]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
    const gen = run('create-game.mjs', [
      game, '--profile', profile, ...(profile === '2d' ? ['--renderer', 'canvas2d'] : []), '--no-git',
    ]);
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
// Frozen-time + eval + state-hook determinism on a tiny page that is wall-clock driven.
{
  const game = path.join(tmp, 'clock');
  mkdirSync(game, { recursive: true });
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const c = document.getElementById('game').getContext('2d'); let frames = 0;
function loop(t) { frames++; c.fillStyle = '#123'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#fc0'; c.fillRect((t / 10) % 56, 20, 8, 8); c.fillStyle = '#0f8'; c.fillRect(0, 0, 4 + (Date.now() % 40), 4 + Math.floor(Math.random() * 50) * 0); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
window.__hgameState = () => ({ frames, now: performance.now() });
</script>`);
  const args = [game, '--freeze-time', '--steps', '30', '--eval', 'performance.now()', ...chrome];
  const r1 = JSON.parse(run('snapshot.mjs', [...args, '--out', path.join(tmp, 'c1.png')]).stdout);
  const r2 = JSON.parse(run('snapshot.mjs', [...args, '--out', path.join(tmp, 'c2.png')]).stdout);
  if (!r1.ok || !r2.ok) fail(`freeze-time: problems ${r1.problems} ${r2.problems}`);
  if (r1.sha256 !== r2.sha256) fail('freeze-time: two frozen runs differ in sha256');
  if (Math.abs(r1.eval - 30 * 1000 / 60) > 1e-6) fail(`freeze-time: eval gave ${r1.eval}, expected 500`);
  if (r1.state?.frames !== 30) fail(`state hook: frames ${r1.state?.frames}, expected 30`);
  const r3 = JSON.parse(run('snapshot.mjs', [game, '--freeze-time', '--steps', '45', '--eval', '({a:[1,2]})', ...chrome]).stdout);
  if (r3.state?.frames !== 45 || r3.eval?.a?.[1] !== 2) fail('freeze-time: --steps 45 / object eval not honoured');
  console.log(JSON.stringify({ freezeTime: r1.sha256 === r2.sha256, eval: r1.eval, state: r1.state }));
}} finally { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }

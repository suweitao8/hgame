import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('playtest reports a stall that overlaps the end of its requested measurement window', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-stall-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const g = document.getElementById('game').getContext('2d'); let ticks = 0;
function draw() { ticks++; g.fillStyle='#123'; g.fillRect(0,0,64,64); g.fillStyle='#fa0'; g.fillRect(ticks%40,4,20,20); requestAnimationFrame(draw); }
requestAnimationFrame(draw); window.__hgameState=()=>({ticks});
setTimeout(()=>{ const until=performance.now()+3500; while(performance.now()<until){} },1500);
</script>`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
    '--duration', '2500', '--actions', 'wait:2500', '--no-pointer', '--max-long-frames', '0'],
  { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1, JSON.stringify(report));
  assert.ok(report.frameStats.maxMs >= 3000, JSON.stringify(report));
  assert.ok(report.frameStats.longFrames >= 1);
  assert.ok(report.actualDurationMs >= 3000);
  assert.ok(report.problems.some(problem => problem.includes('long frames')));
});

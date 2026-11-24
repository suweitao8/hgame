import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('touch playtest counts only browser-generated touch presses during the measured scenario', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-touch-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<canvas id="game" width="64" height="64"></canvas><script>
document.querySelector('canvas').getContext('2d').fillRect(0, 0, 32, 32);
</script>`);
  const scenario = path.join(game, 'scenario.mjs');
  writeFileSync(scenario, `
export async function run({ page, measuringTouch }) {
  if (!measuringTouch) throw new Error('Touch context is missing');
  await page.evaluate(() => dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })));
  await page.mouse.click(20, 20);
  await page.touchscreen.tap(20, 20);
}
export async function verify({ page }) {
  await page.touchscreen.tap(20, 20);
}
`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
    '--viewport', '360x800', '--touch', '--scenario', scenario, '--allow-static'],
  { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.rendererEnvironment.touch, true);
  assert.equal(report.touchPresses, 1);
  assert.equal(report.peakTouchContacts, 1);
  assert.equal(report.multiTouchMoves, 0);
});

test('touch telemetry records trusted movement of overlapping contacts inside measurement', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-multitouch-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html { touch-action: none; }</style><canvas id="game" width="64" height="64"></canvas><script>
document.querySelector('canvas').getContext('2d').fillRect(0, 0, 32, 32);
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, event => {
    if (event.pointerType === 'touch') event.stopImmediatePropagation();
  }, true);
}
</script>`);
  const scenario = path.join(game, 'scenario.mjs');
  writeFileSync(scenario, `
export async function run({ page, checkpoint }) {
  await page.touchscreen.tap(20, 20);
  await page.touchscreen.tap(30, 20);
  await page.evaluate(() => {
    for (const pointerId of [8, 9]) dispatchEvent(new PointerEvent('pointerdown', { pointerId, pointerType: 'touch' }));
    dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, pointerType: 'touch', clientX: 90 }));
  });
  const cdp = await page.context().newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const stick = { x: 30, y: 60, id: 1 };
  const attack = { x: 220, y: 60, id: 2 };
  await send('touchStart', [stick]);
  await send('touchStart', [stick, attack]);
  await checkpoint('move while both fingers are held', () => send('touchMove', [{ ...stick, x: 65 }, attack]));
  await send('touchCancel', []);
  await page.touchscreen.tap(40, 20);
}
`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
    '--viewport', '360x800', '--touch', '--scenario', scenario, '--allow-static'],
  { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.touchPresses, 5);
  assert.equal(report.peakTouchContacts, 2);
  assert.equal(report.multiTouchMoves, 1);
  assert.deepEqual(report.measuredCheckpoints, [{
    name: 'move while both fingers are held', ok: true, multiTouchMoves: 1,
  }]);
});

test('renderer telemetry leaves the canvas free for a renderer that starts after input', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-renderer-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
addEventListener('keydown', () => {
  const ctx = document.querySelector('canvas').getContext('2d');
  ctx.fillStyle = '#f80';
  ctx.fillRect(0, 0, 32, 32);
});
</script>`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
    '--selector', 'css=#game', '--actions', 'd:400', '--no-pointer'],
  { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.rendererEnvironment.renderer, 'Canvas2D');
  assert.equal(report.rendererEnvironment.actualGpu, 'none');
});

test('playtest samples peak estimated GPU bytes inside the measurement window', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-render-memory-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const context = document.querySelector('canvas').getContext('2d');
context.fillRect(0, 0, 32, 32);
let bytes = 2048;
addEventListener('keydown', () => { bytes = 8192; });
addEventListener('keyup', () => { bytes = 1024; });
window.__hgameRenderMemory = () => bytes;
</script>`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
    '--actions', 'd:1300,wait:200', '--no-pointer', '--allow-static', '--sample-render-memory'],
  { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.renderMemory.peakEstimatedGpuBytes, 8192);
  assert.ok(report.renderMemory.samples >= 3);
});

test('playtest collects requested gameplay events and fails when the trace hook is missing', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-trace-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const events = { dropped: 2, events: [
    { tick: 18, type: 'beacon.blocked', subject: 'beacon:1', details: { enemy: 4 } },
  ] };
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const g=document.getElementById('game').getContext('2d');g.fillStyle='#f80';g.fillRect(0,0,32,32);
window.__trace=()=>(${JSON.stringify(events)});
</script>`);
  const run = hook => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
      '--duration', '400', '--actions', 'wait:100', '--no-pointer', '--allow-static', '--trace-hook', hook],
    { encoding: 'utf8', timeout: 25000, windowsHide: true });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  const present = run('__trace');
  assert.equal(present.status, 0, JSON.stringify(present.report));
  assert.deepEqual(present.report.trace, events);
  const missing = run('__absent');
  assert.equal(missing.status, 1);
  assert.ok(missing.report.problems.some(problem => problem.includes('trace hook __absent')));
});

test('playtest fails when a declared state hook throws or returns unserializable state', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-hook-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const body of ["throw new Error('broken hook')", 'return { value: 1n }']) {
    writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const g=document.getElementById('game').getContext('2d');g.fillStyle='#f80';g.fillRect(0,0,32,32);
window.__hgameState=()=>{${body}};
</script>`);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
      '--duration', '100', '--actions', 'wait:100', '--no-pointer', '--allow-static'],
    { encoding: 'utf8', timeout: 25000, windowsHide: true });
    assert.ifError(result.error);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 1, JSON.stringify(report));
    assert.ok(report.problems.some(problem => problem.includes('state hook')), JSON.stringify(report));
  }
});

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

test('playtest scenarios report named input and reload checks with a failing outcome', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = mkdtempSync(path.join(os.tmpdir(), 'hgame-playtest-scenario-'));
  t.after(() => rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><canvas id="game" width="64" height="64"></canvas><script>
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
function draw() {
  ctx.clearRect(0,0,64,64);
  ctx.fillStyle='#f80';
  ctx.fillRect(localStorage.score ? 32 : 0,0,32,32);
}
draw();
addEventListener('keydown', event => { if (event.code === 'KeyD') { localStorage.score = '1'; draw(); } });
window.__hgameState = () => ({ score: Number(localStorage.score ?? 0) });
</script>`);
  const scenario = path.join(game, 'scenario.mjs');
  writeFileSync(scenario, `import assert from 'node:assert/strict';
export async function run({ page, readState, checkpoint }) {
  await page.keyboard.press('d');
  await checkpoint('keyboard scores', async () => assert.equal((await readState()).score, 1));
  if (page.url().includes('blocked=1')) {
    await page.route('**/unreachable.png', route => route.abort('failed'));
    await page.evaluate(() => fetch('unreachable.png').catch(() => {}));
  }
  if (page.url().includes('false=1')) await checkpoint('explicit false', () => false);
  if (page.url().includes('navigate=1')) await page.reload();
}
export async function verify({ page, readState, checkpoint }) {
  await page.reload();
  await checkpoint('reload retains score', async () => {
    assert.equal((await readState()).score, page.url().includes('wrong=1') ? 2 : 1);
  });
}`);
  const run = (query = '') => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/playtest.mjs'), game,
      '--scenario', scenario, '--query', query], { encoding: 'utf8', timeout: 25000, windowsHide: true });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  const passed = run();
  assert.equal(passed.status, 0, JSON.stringify(passed.report));
  assert.deepEqual(passed.report.checkpoints.map(check => [check.name, check.ok]),
    [['keyboard scores', true], ['reload retains score', true]]);
  assert.equal(passed.report.stateBefore.score, 0);
  assert.equal(passed.report.stateAfter.score, 1);
  assert.ok(passed.report.frameStats.measuredMs > 0);

  const failed = run('wrong=1');
  assert.equal(failed.status, 1, JSON.stringify(failed.report));
  assert.equal(failed.report.checkpoints.at(-1).name, 'reload retains score');
  assert.equal(failed.report.checkpoints.at(-1).ok, false);
  assert.ok(failed.report.problems.some(problem => problem.includes('reload retains score')));
  assert.equal(failed.report.stateAfter.score, 1);

  const blocked = run('blocked=1');
  assert.equal(blocked.status, 1);
  assert.ok(blocked.report.httpErrors.some(error => /ERR_FAILED.*unreachable\.png/.test(error)));

  const returnedFalse = run('false=1');
  assert.equal(returnedFalse.status, 1);
  assert.deepEqual(returnedFalse.report.checkpoints.at(-1), {
    name: 'explicit false', ok: false, message: 'Checkpoint returned false',
  });

  const navigated = run('navigate=1');
  assert.equal(navigated.status, 1, JSON.stringify(navigated.report));
  assert.ok(navigated.report.problems.some(problem => /document.*verify/i.test(problem)));
  assert.equal(navigated.report.frameStats, undefined);
});

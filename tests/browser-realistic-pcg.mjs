#!/usr/bin/env node
// Real headless Chromium verification for demos/lookdev-realistic-3d/
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};

const { chromium } = createRequire(import.meta.url)(opt('--playwright', 'playwright-core'));
const chrome = opt('--chrome', undefined);
const shotsDir = path.resolve(opt('--shots-dir', path.join(root, 'build', 'lookdev-shots')));

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const port = await freePort();
const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), root, '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverStderr = '';
server.stderr.on('data', (d) => { serverStderr += d.toString(); });

let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  const demoUrl = `${origin}/demos/lookdev-realistic-3d/index.html`;
  let up = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(demoUrl)).ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!up) throw new Error('Preview server failed to start: ' + serverStderr);

  browser = await chromium.launch({
    headless: true,
    ...(chrome ? { executablePath: chrome } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    if (msg.type() === 'warning' && /THREE\.WebGLProgram|GLSL|Shader Error/i.test(msg.text())) {
      errors.push(`shader-warning: ${msg.text()}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto(demoUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__HGAME_LOOKDEV__?.isReady()), { timeout: 20000 });
  await page.waitForTimeout(300);

  const highMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log('HIGH metrics:', JSON.stringify(highMetrics));

  if (highMetrics.bakeTimeMs > 2000) {
    throw new Error(`HIGH bakeTimeMs (${highMetrics.bakeTimeMs}) > 2000ms budget`);
  }
  if (highMetrics.maxBakeSliceMs > 50) {
    throw new Error(`HIGH maxBakeSliceMs (${highMetrics.maxBakeSliceMs}) > 50ms stall budget`);
  }
  if (highMetrics.drawCalls > 15) {
    throw new Error(`drawCalls (${highMetrics.drawCalls}) > 15 budget`);
  }
  if (highMetrics.staticDrawCalls > 6) {
    throw new Error(`staticDrawCalls (${highMetrics.staticDrawCalls}) > 6 budget`);
  }
  if (highMetrics.materialCount !== 6) {
    throw new Error(`Expected 6 materials, got ${highMetrics.materialCount}`);
  }

  // Capture 4 camera presets
  await mkdir(shotsDir, { recursive: true });
  for (const preset of ['overview', 'brick_closeup', 'puddle', 'character']) {
    await page.evaluate((p) => window.__HGAME_LOOKDEV__.setCameraPreset(p), preset);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(shotsDir, `${preset}.png`) });
  }

  // Test lighting presets, wetness, and Tripo normalization toggle
  await page.evaluate(() => {
    window.__HGAME_LOOKDEV__.setCameraPreset('overview');
    window.__HGAME_LOOKDEV__.setLightingPreset('GOLDEN_HOUR');
    window.__HGAME_LOOKDEV__.setWetness(0.95);
    window.__HGAME_LOOKDEV__.setTripoNormalizationEnabled(false);
    window.__HGAME_LOOKDEV__.setTripoNormalizationEnabled(true);
    window.__HGAME_LOOKDEV__.setLightingPreset('OVERCAST_WET');
    window.__HGAME_LOOKDEV__.setWetness(0.55);
  });
  await page.waitForTimeout(120);

  // Test hotReloadMaterial
  const brickRecipe = JSON.parse(
    await readFile(path.join(root, 'assets/procedural/materials/wet_stone_brick.hmat.json'), 'utf8')
  );
  brickRecipe.nodes[8].args.stops[1][1] = '#7d5246';
  const beforeHotShot = await page.screenshot();
  await page.evaluate(async (r) => {
    await window.__HGAME_LOOKDEV__.hotReloadMaterial(r);
  }, brickRecipe);
  await page.waitForTimeout(120);
  const afterHotShot = await page.screenshot();
  if (Buffer.compare(beforeHotShot, afterHotShot) === 0) {
    throw new Error('hotReloadMaterial did not update rendered pixels');
  }

  // Test hotReloadMesh
  const wallRecipe = JSON.parse(
    await readFile(path.join(root, 'assets/procedural/meshes/beveled_wall.hmesh.json'), 'utf8')
  );
  wallRecipe.params.hasWindow = false;
  await page.evaluate((r) => window.__HGAME_LOOKDEV__.hotReloadMesh(r), wallRecipe);
  await page.waitForTimeout(120);

  // Test LOW preset memory budget (<= 24 MB)
  await page.evaluate(async () => {
    await window.__HGAME_LOOKDEV__.setQuality('LOW');
  });
  await page.waitForTimeout(150);
  const lowMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log('LOW metrics:', JSON.stringify(lowMetrics));
  if (lowMetrics.estimatedTextureMB > 24) {
    throw new Error(`LOW estimatedTextureMB (${lowMetrics.estimatedTextureMB}) > 24 MB`);
  }

  // Test disposeAndVerify
  const remaining = await page.evaluate(() => window.__HGAME_LOOKDEV__.disposeAndVerify());
  console.log('After disposeAndVerify:', JSON.stringify(remaining));
  if (remaining.remainingGeometries !== 0 || remaining.remainingTextures !== 0) {
    throw new Error(`GPU leak after dispose: ${JSON.stringify(remaining)}`);
  }

  if (errors.length > 0) {
    throw new Error(`Browser errors encountered:\n${errors.join('\n')}`);
  }

  console.log('ALL BROWSER LOOKDEV CHECKS PASSED!');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

#!/usr/bin/env node
// Real headless Chromium verification for demos/lookdev-realistic-3d/ using ephemeral test recipes
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const TEST_MATERIALS = {
  wet_stone_brick: {
    format: 'hgame.material', version: 1, id: 'wet_stone_brick',
    meta: { category: 'masonry', tileMeters: 2.0, seed: 1042 },
    nodes: [
      { id: 'bricks', op: 'brick_pattern', args: { rows: 8, cols: 4, stagger: 0.5, mortar: 0.045, bevel: 0.03, variation: 0.35 } },
      { id: 'grain', op: 'fbm', args: { scale: 12, octaves: 4, persistence: 0.52, seamless: true } },
      { id: 'h', op: 'blend', args: { mode: 'multiply', a: 'bricks.height', b: 'grain', strength: 0.3 } },
      { id: 'n', op: 'height_to_normal', args: { input: 'h', strength: 2.5 } },
      { id: 'col', op: 'color_ramp', args: { input: 'bricks.cellRand', stops: [[0, '#4a4642'], [1, '#7a7066']] } },
      { id: 'alb', op: 'mix_color', args: { a: '#3d3a36', b: 'col', mask: 'bricks.mask' } },
      { id: 'r', op: 'mix_scalar', args: { a: 0.88, b: 0.4, mask: 'bricks.mask' } },
    ],
    outputs: { albedo: 'alb', height: 'h', normal: 'n', ao: 'h', roughness: 'r', metalness: 0.0, porosity: 0.65 },
  },
  mossy_cobble: {
    format: 'hgame.material', version: 1, id: 'mossy_cobble',
    meta: { category: 'terrain', tileMeters: 2.0, seed: 6422 },
    nodes: [
      { id: 'c', op: 'worley', args: { scale: 7, mode: 'f2_minus_f1', jitter: 0.88, seamless: true } },
      { id: 'm', op: 'remap', args: { input: 'c.f2_minus_f1', inMin: 0.04, inMax: 0.18, outMin: 0, outMax: 1 } },
      { id: 'n', op: 'height_to_normal', args: { input: 'm', strength: 2.6 } },
      { id: 'sc', op: 'color_ramp', args: { input: 'c.cellRand', stops: [[0, '#504d47'], [1, '#7d776d']] } },
      { id: 'alb', op: 'mix_color', args: { a: '#3e4d31', b: 'sc', mask: 'm' } },
      { id: 'r', op: 'mix_scalar', args: { a: 0.92, b: 0.45, mask: 'm' } },
    ],
    outputs: { albedo: 'alb', height: 'm', normal: 'n', ao: 'm', roughness: 'r', metalness: 0.0, porosity: 0.68 },
  },
  grass_mud: {
    format: 'hgame.material', version: 1, id: 'grass_mud',
    meta: { category: 'terrain', tileMeters: 3.0, seed: 4201 },
    nodes: [
      { id: 'f', op: 'fbm', args: { scale: 8, octaves: 4, persistence: 0.55, seamless: true } },
      { id: 'n', op: 'height_to_normal', args: { input: 'f', strength: 2.2 } },
      { id: 'alb', op: 'color_ramp', args: { input: 'f', stops: [[0, '#413a32'], [0.6, '#52463a'], [1, '#58673e']] } },
      { id: 'r', op: 'remap', args: { input: 'f', inMin: 0, inMax: 1, outMin: 0.68, outMax: 0.94 } },
    ],
    outputs: { albedo: 'alb', height: 'f', normal: 'n', ao: 'f', roughness: 'r', metalness: 0.0, porosity: 0.85 },
  },
};

const TEST_MESHES = {
  beveled_wall: {
    format: 'hgame.mesh', version: 1, id: 'beveled_wall',
    meta: { unit: 'meter', collider: 'auto_boxes' },
    params: { width: 4.0, height: 3.0, thickness: 0.35, bevel: 0.02, hasWindow: true },
    materialSlots: { wall: 'wet_stone_brick' },
    parts: [
      {
        id: 'body', op: 'beveled_wall_opening', material: '$wall',
        args: { width: '$width', height: '$height', thickness: '$thickness', bevel: '$bevel', openings: [{ when: '$hasWindow', x: 0, y: 0.9, w: 1.1, h: 1.1 }] },
        vertexMeta: { edgeWear: 0.6 },
      },
    ],
  },
  guard_post: {
    format: 'hgame.mesh', version: 1, id: 'guard_post',
    meta: { unit: 'meter', collider: 'auto_boxes' },
    materialSlots: { wallMat: 'wet_stone_brick' },
    parts: [
      { id: 'back', op: 'ref', ref: 'beveled_wall', materialOverrides: { wall: '$wallMat' }, transform: { pos: [0, 0, -2.0] } },
      { id: 'front', op: 'beveled_wall_opening', material: '$wallMat', args: { width: 4.0, height: 3.0, thickness: 0.35, bevel: 0.02, openings: [{ x: 0, y: 0, w: 1.35, h: 2.25 }] }, transform: { pos: [0, 0, 2.0] } },
    ],
  },
  weathered_rock: {
    format: 'hgame.mesh', version: 1, id: 'weathered_rock',
    meta: { unit: 'meter', collider: 'trimesh' },
    params: { radius: 0.85, seed: 771 },
    materialSlots: { rock: 'mossy_cobble' },
    parts: [{ id: 'boulder', op: 'displaced_rock', material: '$rock', args: { radius: '$radius', detail: 2, seed: '$seed' } }],
  },
};

const TEST_MANIFEST = {
  format: 'hgame.manifest',
  version: 1,
  materials: Object.keys(TEST_MATERIALS).map((id) => ({ id, path: `materials/${id}.hmat.json` })),
  meshes: Object.keys(TEST_MESHES).map((id) => ({ id, path: `meshes/${id}.hmesh.json` })),
};

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
const errors = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  const baseDemoUrl = `${origin}/demos/lookdev-realistic-3d/index.html`;
  let up = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(baseDemoUrl)).ok) { up = true; break; }
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

  page.on('pageerror', (err) => { console.error('PAGEERROR:', err.message); errors.push(`pageerror: ${err.message}`); });
  page.on('console', (msg) => {
    if (msg.type() === 'error') { console.error('CONSOLE.ERROR:', msg.text()); errors.push(`console.error: ${msg.text()}`); }
    if (msg.type() === 'warning' && /THREE\.WebGLProgram|GLSL|Shader Error/i.test(msg.text())) {
      errors.push(`shader-warning: ${msg.text()}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) { console.error('HTTPERR:', res.status(), res.url()); errors.push(`HTTP ${res.status()} ${res.url()}`); }
  });

  // 1. Verify standalone empty Look-Dev stage (?manifest=) loads with 0 404s and 0 errors (HGame stores no assets)
  await page.goto(`${baseDemoUrl}?manifest=`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__HGAME_LOOKDEV__?.isReady()), { timeout: 20000 });
  const emptyMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log('Empty stage metrics:', JSON.stringify(emptyMetrics));

  // Resolve procedural recipes from external WebAsset assets/procedural (or ephemeral inline fixture)
  const webAssetProcDir = path.resolve(root, '..', 'WebAsset', 'assets', 'procedural');
  const hasWebAssetProc = existsSync(path.join(webAssetProcDir, 'manifest.json'));

  await page.route((url) => url.pathname.startsWith('/__ext_proc__/'), async (route) => {
    const rel = new URL(route.request().url()).pathname.slice('/__ext_proc__/'.length);
    if (hasWebAssetProc) {
      const target = path.resolve(webAssetProcDir, rel);
      if (target.startsWith(webAssetProcDir) && existsSync(target)) {
        return route.fulfill({ contentType: 'application/json', body: await readFile(target, 'utf8') });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    if (rel === 'manifest.json') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(TEST_MANIFEST) });
    }
    const matMatch = /^materials\/([^/]+)\.hmat\.json$/.exec(rel);
    if (matMatch && TEST_MATERIALS[matMatch[1]]) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(TEST_MATERIALS[matMatch[1]]) });
    }
    const meshMatch = /^meshes\/([^/]+)\.hmesh\.json$/.exec(rel);
    if (meshMatch && TEST_MESHES[meshMatch[1]]) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(TEST_MESHES[meshMatch[1]]) });
    }
    return route.fulfill({ status: 404, body: 'Not found' });
  });

  const extUrl = `${baseDemoUrl}?manifest=/__ext_proc__/manifest.json`;
  const expectedMatCount = hasWebAssetProc ? 13 : 3;

  // 2. Verify full WebAsset procedural manifest in GPU-first HIGH mode
  await page.goto(extUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__HGAME_LOOKDEV__?.isReady()), { timeout: 30000 });
  await page.waitForTimeout(350);

  const highMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log(`HIGH metrics (${expectedMatCount} mats):`, JSON.stringify(highMetrics));

  if (highMetrics.bakeTimeMs > 1800) throw new Error(`HIGH bakeTimeMs (${highMetrics.bakeTimeMs}) > 1800ms`);
  if (highMetrics.bakeBackend !== 'gpu') {
    throw new Error(`Expected GPU bake backend on Chromium WebGL2, got ${highMetrics.bakeBackend}`);
  }
  if (highMetrics.drawCalls > 18) throw new Error(`drawCalls (${highMetrics.drawCalls}) > 18`);
  if (highMetrics.staticDrawCalls > 8) throw new Error(`staticDrawCalls (${highMetrics.staticDrawCalls}) > 8`);
  if (hasWebAssetProc && (highMetrics.instancedPools !== 4 || highMetrics.instancedProps !== 60)) {
    throw new Error(`Expected 4 instanced pools / 60 props, got ${highMetrics.instancedPools} / ${highMetrics.instancedProps}`);
  }
  if (highMetrics.materialCount !== expectedMatCount) {
    throw new Error(`Expected ${expectedMatCount} materials, got ${highMetrics.materialCount}`);
  }

  // Execute 100x spawn -> updateTransform -> remove dynamic build/demolish stress test
  const stress = await page.evaluate(() => window.__HGAME_LOOKDEV__.stressTestInstancedPool(100));
  console.log('InstancedPool 100x stress result:', JSON.stringify(stress));
  if (hasWebAssetProc && stress.activeInstances !== 60) {
    throw new Error(`Expected activeInstances=60 after 100x stress test, got ${stress.activeInstances}`);
  }

  await mkdir(shotsDir, { recursive: true });
  for (const preset of ['overview', 'yard', 'brick_closeup', 'industrial', 'interior', 'plinths', 'puddle', 'character']) {
    await page.evaluate((p) => window.__HGAME_LOOKDEV__.setCameraPreset(p), preset);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(shotsDir, `${preset}.png`) });
  }

  // Test biome overlay switching (wet_moss -> desert_dust -> clean_indoor -> wet_moss)
  await page.evaluate(() => window.__HGAME_LOOKDEV__.setCameraPreset('overview'));
  await page.waitForTimeout(80);
  const shotWet = await page.screenshot();
  await page.evaluate(() => window.__HGAME_LOOKDEV__.setBiomeMode('desert_dust'));
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(shotsDir, 'biome_desert.png') });
  const shotDesert = await page.screenshot();
  if (Buffer.compare(shotWet, shotDesert) === 0) {
    throw new Error('setBiomeMode("desert_dust") did not change rendered pixels');
  }
  await page.evaluate(() => window.__HGAME_LOOKDEV__.setBiomeMode('clean_indoor'));
  await page.waitForTimeout(100);
  const shotIndoor = await page.screenshot();
  if (Buffer.compare(shotWet, shotIndoor) === 0 || Buffer.compare(shotDesert, shotIndoor) === 0) {
    throw new Error('setBiomeMode("clean_indoor") did not produce a distinct surface response');
  }
  await page.evaluate(() => window.__HGAME_LOOKDEV__.setBiomeMode('wet_moss'));

  // Hot-reload wet_stone_brick material & verify pixel delta
  await page.evaluate(() => window.__HGAME_LOOKDEV__.setCameraPreset('brick_closeup'));
  await page.waitForTimeout(80);
  const brickRecipe = hasWebAssetProc
    ? JSON.parse(await readFile(path.join(webAssetProcDir, 'materials', 'wet_stone_brick.hmat.json'), 'utf8'))
    : structuredClone(TEST_MATERIALS.wet_stone_brick);
  const colorNode = brickRecipe.nodes.find((n) => n.op === 'color_ramp');
  if (colorNode?.args?.stops?.[1]) colorNode.args.stops[1][1] = '#9a4f43';
  const beforeHotShot = await page.screenshot();
  await page.evaluate(async (r) => { await window.__HGAME_LOOKDEV__.hotReloadMaterial(r); }, brickRecipe);
  await page.waitForTimeout(100);
  const afterHotShot = await page.screenshot();
  if (Buffer.compare(beforeHotShot, afterHotShot) === 0) {
    throw new Error('hotReloadMaterial did not update rendered pixels');
  }

  // Hot-reload mesh
  if (hasWebAssetProc) {
    const contRecipe = JSON.parse(
      await readFile(path.join(webAssetProcDir, 'meshes', 'shipping_container.hmesh.json'), 'utf8')
    );
    contRecipe.params.doorOpen = false;
    await page.evaluate((r) => window.__HGAME_LOOKDEV__.hotReloadMesh(r), contRecipe);
  } else {
    const wallRecipe = structuredClone(TEST_MESHES.beveled_wall);
    wallRecipe.params.hasWindow = false;
    await page.evaluate((r) => window.__HGAME_LOOKDEV__.hotReloadMesh(r), wallRecipe);
  }

  // Check LOW memory budget
  await page.evaluate(async () => { await window.__HGAME_LOOKDEV__.setQuality('LOW'); });
  const lowMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log('LOW metrics:', JSON.stringify(lowMetrics));
  if (lowMetrics.estimatedTextureMB > 24) throw new Error(`LOW estimatedTextureMB (${lowMetrics.estimatedTextureMB}) > 24 MB`);

  // Check GPU resource disposal on main page
  const remaining = await page.evaluate(() => window.__HGAME_LOOKDEV__.disposeAndVerify());
  console.log('After disposeAndVerify:', JSON.stringify(remaining));
  if (remaining.remainingGeometries !== 0 || remaining.remainingTextures !== 0) {
    throw new Error(`GPU leak after dispose: ${JSON.stringify(remaining)}`);
  }

  // 3. Measure CPU bake baseline on HIGH (same external manifest)
  await page.goto(`${extUrl}&bakeMode=cpu`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__HGAME_LOOKDEV__?.isReady()), { timeout: 60000 });
  const cpuMetrics = await page.evaluate(() => window.__HGAME_LOOKDEV__.getMetrics());
  console.log(`CPU HIGH metrics (${expectedMatCount} mats, 512px):`, JSON.stringify(cpuMetrics));
  await page.evaluate(() => window.__HGAME_LOOKDEV__.disposeAndVerify());

  if (errors.length > 0) throw new Error(`Browser errors encountered:\n${errors.join('\n')}`);
  console.log('ALL BROWSER LOOKDEV CHECKS PASSED!');
} catch (err) {
  if (errors.length > 0) {
    console.error('Captured browser errors:\n' + errors.join('\n'));
  }
  throw err;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

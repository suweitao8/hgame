#!/usr/bin/env node
// Browser 3D STRESS benchmark: generates a 3d game, injects a heavy procedural scene built only from public
// runtime APIs (createInstancedBatch3D, createMegaLights3D, post3d pipeline, procedural sky, createCameraRig3D)
// and reports rAF frame stats + renderer draw calls/triangles as JSON. Also verifies the canvas is non-blank.
// Under CI software GL (SwiftShader) numbers are very pessimistic: only errors, a blank canvas, and a very
// generous p95 gate the result. Usage:
//   node benchmarks/render-bench-3d.mjs [--instances 2000] [--lights 64] [--frames 40] [--budget-p95 4000]
//        [--no-post] [--json out.json] [--png out.png] [--chrome path]
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const instances = Number(opt('--instances', 2000));
const lights = Number(opt('--lights', 64));
const frames = Number(opt('--frames', 40));
const budgetP95 = Number(opt('--budget-p95', 4000));
const usePost = !argv.includes('--no-post');
const chrome = opt('--chrome', process.env.HGAME_CHROME) || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const { chromium } = createRequire(import.meta.url)('playwright-core');

// Injected before `app.scenes.start(...)` in the generated 3D main.js.
const stress = `
const { createInstancedBatch3D } = await import(base + '/integrations/culling3d.js');
const { createMegaLights3D } = await import(base + '/integrations/lighting3d.js');
const { createProceduralSky3D } = await import(base + '/integrations/sky3d.js');
const { createCameraRig3D } = await import(base + '/integrations/camera3d.js');
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const N = ${instances}, L = ${lights};
const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
const mega = createMegaLights3D(THREE, { maxLights: Math.max(128, L * 2), samplesPerPixel: 4 });
mega.applyToMaterial(mat);
const batch = createInstancedBatch3D(THREE, { geometry: new THREE.BoxGeometry(1, 1, 1), material: mat,
  capacity: N + 16, perInstanceColor: true, cullRadius: 1.2 });
const ids = [];
for (let i = 0; i < N; i++) {
  const a = rnd() * Math.PI * 2, r = 6 + Math.sqrt(rnd()) * 60;
  ids.push(batch.alloc({ x: Math.cos(a) * r, y: 0.5 + rnd() * 3, z: Math.sin(a) * r, rotationY: rnd() * 6, scale: 0.6 + rnd() * 1.4,
    color: [0.3 + rnd() * 0.7, 0.3 + rnd() * 0.7, 0.3 + rnd() * 0.7] }));
}
world.add(batch.mesh);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat);
ground.rotation.x = -Math.PI / 2; world.add(ground);
for (let i = 0; i < L; i++) {
  const a = (i / L) * Math.PI * 2, r = 8 + (i % 8) * 7;
  mega.addLight({ type: 'point', x: Math.cos(a) * r, y: 2.5, z: Math.sin(a) * r, color: i % 2 ? 0xffaa44 : 0x55aaff, intensity: 6, range: 14 });
}
const sky = createProceduralSky3D(THREE, {});
renderer.setSky(sky);
const rig = createCameraRig3D({ THREE, camera: renderer.camera, mode: 'thirdPerson', baseFov: 65, thirdPerson: { armLength: 30, pitch: -0.45 } });
const stats = { calls: 0, triangles: 0, visible: 0, activeLights: 0 };
class StressDriver extends Component {
  update(dt) {
    this.t = (this.t || 0) + dt;
    const t = this.t;
    for (let i = 0; i < Math.min(300, ids.length); i++) batch.setRotation(ids[i], t + i, t * 0.7 + i, 0);
    stats.visible = batch.flush({ culler: renderer.culler3d }).visible;
    rig.update(dt, { x: Math.cos(t * 0.5) * 20, y: 0, z: Math.sin(t * 0.5) * 20 });
    stats.activeLights = mega.update(renderer.camera, dt, { width: 960, height: 540 });
  }
}
scene.add(new Entity({ name: 'stress-driver' })).addComponent(new StressDriver());
window.__stress = { instances: N, lights: L };
window.__frames = []; let last = performance.now();
const gl = renderer.renderer.getContext(); const px1 = new Uint8Array(4);
const tick = () => {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); const now = performance.now(); // a sync readPixels makes the sample include GPU/SwiftShader work, not just command submission
  window.__frames.push(now - last); last = now;
  const info = renderer.renderer?.info; info.autoReset = false;
  if (info.render.calls) { stats.calls = Math.max(stats.calls, info.render.calls); stats.triangles = Math.max(stats.triangles, info.render.triangles); }
  info.reset();
  if (window.__frames.length === ${frames + 9}) { renderer.render(scene, app); window.__shot = viewCanvas.toDataURL('image/png').split(',')[1]; }
  if (window.__frames.length < ${frames + 10}) requestAnimationFrame(tick); else { window.__stats = stats; window.__px1 = Array.from(px1); window.__done = true; app.dispose(); }
};
requestAnimationFrame(tick);
`;

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-rbench3d-'));
let browser, failed = false, result;
try {
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit'] });
  const game = path.join(tmp, 'stress3d');
  const gen = spawnSync(process.execPath, [path.join(root, 'scripts', 'create-game.mjs'), game, '--profile', '3d', '--quality', 'auto', '--no-git'], { encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(gen.stderr || gen.stdout);
  const mainPath = path.join(game, 'src', 'main.js');
  let src = readFileSync(mainPath, 'utf8');
  if (usePost) {
    if (!src.includes("toneMapping: 'ueFilmic',")) throw new Error('template changed: cannot enable post3d');
    src = src.replace("toneMapping: 'ueFilmic',", "toneMapping: 'ueFilmic',\n  post3d: true,");
  }
  if (!/app\.scenes\.start\('\w+'\);/.test(src)) throw new Error('template changed: scenes.start not found');
  src = src.replace(/app\.scenes\.start\('(\w+)'\);/, m => stress + '\n' + m);
  writeFileSync(mainPath, src);
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), game, '--port', String(port)], { stdio: 'ignore' });
  try {
    const url = `http://127.0.0.1:${port}/`;
    for (let i = 0; ; i++) { if (i > 100) throw new Error('preview failed'); try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 60)); }
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(url);
    await page.waitForFunction('window.__done === true || window.__frames?.length > 0 && false', null, { timeout: 240000, polling: 200 }).catch(e => errors.push('timeout: ' + e.message.split('\n')[0]));
    // Screenshot while the scene is still live, then measure how many pixels differ from the corner colour.
    const shot = await page.evaluate('window.__shot').catch(() => null); const png = shot ? Buffer.from(shot, 'base64') : null; if (!png) errors.push('no canvas capture');
    const f = ((await page.evaluate('window.__frames').catch(() => null)) || []).slice(10).sort((a, b) => a - b);
    const gs = (await page.evaluate('window.__stats').catch(() => null)) || {};
    const px = png ? await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
      const n = d.length / 4, colors = new Set(); let nb = 0, luma = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) nb++;
        luma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (colors.size < 5000) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return { nonBlankRatio: +(nb / n).toFixed(4), meanLuma: +(luma / n).toFixed(2), uniqueColors: colors.size };
    }, png.toString('base64')) : null;
    const pj = opt('--png'); if (pj && png) writeFileSync(pj, png);
    const mean = f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN;
    result = { scene: 'stress3d', instances, lights, post3d: usePost, frames: f.length, meanMs: +mean.toFixed(2),
      p50Ms: f.length ? +f[f.length >> 1].toFixed(2) : null, p95Ms: f.length ? +f[Math.floor(f.length * 0.95)].toFixed(2) : null, maxMs: f.length ? +f.at(-1).toFixed(2) : null,
      drawCalls: gs.calls ?? null, triangles: gs.triangles ?? null, visibleInstances: gs.visible ?? null, activeLights: gs.activeLights ?? null,
      pixels: px, centerProbe: await page.evaluate('window.__px1').catch(() => null), errors };
    const nonBlank = px && px.nonBlankRatio >= 0.05 && px.uniqueColors >= 16;
    result.ok = !errors.length && f.length >= frames && nonBlank && result.p95Ms <= budgetP95;
    failed = !result.ok;
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  stress3d ${instances} inst / ${lights} lights${usePost ? ' + post3d' : ''}  mean ${result.meanMs}ms  p95 ${result.p95Ms}ms  max ${result.maxMs}ms  (budget p95 ${budgetP95}ms)`
      + `\n      calls ${result.drawCalls} tris ${result.triangles} visible ${result.visibleInstances} lights ${result.activeLights}  nonBlank ${px?.nonBlankRatio} colors ${px?.uniqueColors}`
      + (errors.length ? '\n      errors: ' + errors.join(' | ') : '') + (!nonBlank ? '\n      canvas looks blank' : ''));
    await page.close();
  } finally { server.kill(); }
} finally { await browser?.close(); await new Promise(r => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
const j = argv.indexOf('--json'); if (j >= 0) writeFileSync(argv[j + 1], JSON.stringify({ node: process.version, results: [result] }, null, 2));
process.exit(failed ? 1 : 0);






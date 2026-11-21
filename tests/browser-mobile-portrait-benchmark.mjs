import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const modulePath = argv.indexOf('--playwright') >= 0 ? argv[argv.indexOf('--playwright') + 1] : 'playwright-core';
const executablePath = argv.indexOf('--chrome') >= 0 ? argv[argv.indexOf('--chrome') + 1] : undefined;
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const HARNESS_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: #020617; width: 390px; height: 844px; }
    #c3d { display: block; width: 390px; height: 844px; }
    #c2d { position: fixed; left: 0; top: 0; width: 390px; height: 844px; touch-action: none; }
  </style>
</head>
<body>
  <canvas id="c3d" width="390" height="844"></canvas>
  <canvas id="c2d" width="390" height="844"></canvas>
  <script type="module">
    import * as THREE from '/assets/optional/three/three.module.js';
    import {
      Scene,
      DEFAULT_THUMB_ARC_SPEC,
      computeThumbArcLayout,
      isInThumbComfortZone,
      createThumbArcHud,
    } from '/assets/runtime/index.js';
    import { createThreeAdapter } from '/assets/runtime/integrations/three.js';
    import { createInstancedFoliage3D } from '/assets/runtime/integrations/foliage3d.js';
    import { createMaterialBatchRegistry3D, createComposableMaterial3D } from '/assets/runtime/integrations/material-graph3d.js';
    import { MOBILE_PORTRAIT_PRESET, resolvePortraitViewport } from '/assets/runtime/integrations/quality3d.js';
    import { createDecalSystem3D } from '/assets/runtime/integrations/decal3d.js';

    function sampleGlPixels(gl, w, h) {
      if (!gl) return { uniqueColors: 0, nonBlackPixels: 0 };
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const colors = new Set();
      let nonBlack = 0;
      for (let i = 0; i < buf.length; i += 64) {
        const rgb = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
        colors.add(rgb);
        if (buf[i] > 5 || buf[i + 1] > 5 || buf[i + 2] > 5) nonBlack++;
      }
      return { uniqueColors: colors.size, nonBlackPixels: nonBlack };
    }

    window.__mobileState = {
      pressedActions: [],
      hud: null,
      layout: null,
    };

    window.__setupMobilePortrait = async () => {
      const portraitVp = resolvePortraitViewport({
        width: 390,
        height: 844,
        dpr: window.devicePixelRatio || 2,
        safeArea: { top: 44, bottom: 34, left: 0, right: 0 },
      });

      const c3d = document.getElementById('c3d');
      const cam = new THREE.PerspectiveCamera(58, portraitVp.cssWidth / portraitVp.cssHeight, 0.2, 120);
      cam.position.set(0, 4.8, 9.5);
      cam.lookAt(0, 0.8, -3.5);
      cam.updateMatrixWorld();

      const adapter = createThreeAdapter({
        THREE,
        canvas: c3d,
        camera: cam,
        pixelRatio: portraitVp.pixelRatio,
        quality: MOBILE_PORTRAIT_PRESET.tier,
        renderGraph: true,
        post3d: {
          bloom: MOBILE_PORTRAIT_PRESET.bloom,
          sharpness: MOBILE_PORTRAIT_PRESET.rcasSharpness,
          fxaa: true,
        },
        worldLighting: {
          ambient: { color: 0x334155, intensity: 0.7 },
          sun: {
            color: 0xfff3d6,
            intensity: 2.0,
            position: [10, 20, 8],
            cascades: {
              cascades: 3,
              maxFar: 80,
              mapSize: MOBILE_PORTRAIT_PRESET.shadowMapSize,
              pcss: MOBILE_PORTRAIT_PRESET.pcss,
            },
          },
        },
      });

      const scene = new Scene('mobile-portrait-3d');
      const csm = adapter.getCascadedShadowMap(scene);

      const batchRegistry = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.012 });
      const heroMat = createComposableMaterial3D(THREE, {
        color: 0x38bdf8,
        sharedBlock: batchRegistry.sharedBlock,
        windSway: { amplitude: 0.12, frequency: 2.2, minY: -0.5, maxY: 1.5 },
        fresnelRim: { color: 0x7dd3fc, power: 2.4, strength: 0.45 },
        specularAA: true,
      });
      batchRegistry.register(heroMat);
      csm.applyToMaterial(heroMat);

      const heroMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 1.4, 2, 6, 2), heroMat);
      heroMesh.position.set(0, 1.0, -3.2);
      heroMesh.castShadow = true;
      heroMesh.receiveShadow = true;
      adapter.add(scene, heroMesh);

      const floorMat = createComposableMaterial3D(THREE, {
        color: 0x1e293b,
        sharedBlock: batchRegistry.sharedBlock,
        roughness: 0.82,
      });
      batchRegistry.register(floorMat);
      csm.applyToMaterial(floorMat);

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
      floor.rotation.x = -Math.PI * 0.5;
      floor.receiveShadow = true;
      adapter.add(scene, floor);

      const foliage = createInstancedFoliage3D(THREE, { count: 300, areaSize: 16 });
      adapter.add(scene, foliage.mesh);

      // Soft-edge projected OBB decal rendered against separate pre-pass depth target
      const decals = createDecalSystem3D(THREE, { maxDecals: 4, mode: 'projected' });
      decals.spawn({
        position: [0, 0.2, -3.2],
        normal: [0, 1, 0],
        size: [2.6, 2.6, 1.6],
        color: 0xf97316,
        edgeSoftness: 0.3,
        roughnessTint: 0.5,
      });
      const prePassRT = new THREE.WebGLRenderTarget(195, 422, {
        depthTexture: new THREE.DepthTexture(195, 422, THREE.UnsignedIntType),
      });
      const decalOutRT = new THREE.WebGLRenderTarget(195, 422);
      adapter.renderer.setRenderTarget(prePassRT);
      adapter.renderer.clear(true, true, false);
      adapter.renderer.render(adapter.getWorld(scene), cam);
      const projDecalsRendered = decals.renderProjected(adapter.renderer, cam, prePassRT.depthTexture, 195, 422, decalOutRT);
      adapter.renderer.setRenderTarget(null);
      const decalStats = decals.getStats();

      const warmup = adapter.warmupShaders(scene, cam);

      // Step 8 portrait frames driving batch uniforms, foliage wind, and RenderGraph DAG
      for (let f = 0; f < 8; f++) {
        batchRegistry.updateFrame(0.016);
        foliage.update(f * 0.016, 1.1);
        heroMesh.rotation.y += 0.06;
        adapter.render(scene, cam);
      }

      const gl = adapter.renderer.getContext();
      const glError = gl.getError();
      const glPixels = sampleGlPixels(gl, c3d.width, c3d.height);
      const executedGraph = adapter.getExecutedRenderGraph();
      const vram = adapter.measureVram(scene);
      const batchStats = batchRegistry.getStats();

      // Portrait Bottom-Right Semi-Arc Thumb HUD overlay
      const c2d = document.getElementById('c2d');
      const ctx2d = c2d.getContext('2d');
      const actionItems = [
        { id: 'atk', label: 'Atk', icon: 'A', primary: true },
        { id: 'dash', label: 'Dash', icon: 'D', cooldownRatio: 0.25 },
        { id: 's1', label: 'S1', icon: '1' },
        { id: 's2', label: 'S2', icon: '2' },
        { id: 'ult', label: 'Ult', icon: 'U' },
      ];
      const hud = createThumbArcHud({
        items: actionItems,
        safeArea: portraitVp.safeArea,
        onAction(id) {
          window.__mobileState.pressedActions.push(id);
        },
      });
      c2d.addEventListener('pointerdown', (e) => {
        const rect = c2d.getBoundingClientRect();
        hud.pointerDown(e.clientX - rect.left, e.clientY - rect.top);
      });
      c2d.addEventListener('pointerup', (e) => {
        const rect = c2d.getBoundingClientRect();
        hud.pointerUp(e.clientX - rect.left, e.clientY - rect.top);
        ctx2d.clearRect(0, 0, c2d.width, c2d.height);
        hud.render(ctx2d, portraitVp.cssWidth, portraitVp.cssHeight);
      });

      const layout = hud.render(ctx2d, portraitVp.cssWidth, portraitVp.cssHeight);
      const directLayout = computeThumbArcLayout({
        viewportWidth: portraitVp.cssWidth,
        viewportHeight: portraitVp.cssHeight,
        items: actionItems,
        safeArea: portraitVp.safeArea,
      });

      window.__mobileState.hud = hud;
      window.__mobileState.layout = layout;

      const comfortBoundaryY = portraitVp.cssHeight * 0.52;
      const allInLowerHalf = layout.items.every((b) => b.cy >= comfortBoundaryY && isInThumbComfortZone({ x: b.cx, y: b.cy }, { width: portraitVp.cssWidth, height: portraitVp.cssHeight }).inLowerHalf);
      const minBtnSize = Math.min(...layout.items.map((b) => b.size));

      return {
        portraitVp,
        defaultSpecMinSize: DEFAULT_THUMB_ARC_SPEC.minButtonSize,
        glError,
        warmupFailed: warmup.failed || 0,
        executedGraph,
        glPixels,
        vramBytes: vram.totalBytes || vram.bytes || 0,
        foliageCount: foliage.count,
        projDecalsRendered,
        decalActive: decalStats.active,
        batchRegisteredMaterials: batchStats.registeredCount,
        allInLowerHalf,
        directAllInLowerHalf: directLayout.allInLowerHalf,
        minBtnSize,
        buttons: layout.items.map((b) => ({ id: b.id, cx: Math.round(b.cx), cy: Math.round(b.cy), size: b.size, ring: b.ring })),
      };
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/mobilebench.html') {
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
      res.end(HARNESS_HTML);
      return;
    }
    const rel = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ''));
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root))) { res.writeHead(403); res.end('Forbidden'); return; }
    const ext = path.extname(full).toLowerCase();
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err?.message || String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/mobilebench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Module load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__setupMobilePortrait());
  assert.deepEqual(errors, [], 'Runtime/WebGL errors: ' + errors.join(' | '));
  assert.equal(m.glError, 0, 'WebGL2 error must be 0');
  assert.equal(m.warmupFailed, 0, 'Shader warmup must succeed cleanly');
  assert.ok(m.executedGraph && m.executedGraph.executed.includes('opaque-scene'), 'RenderGraph must execute opaque-scene');
  assert.ok(m.executedGraph.executed.includes('post-composite'), 'RenderGraph must execute post-composite');
  assert.ok(m.glPixels.uniqueColors > 20 && m.glPixels.nonBlackPixels > 500, '390x844 portrait scene must render non-black pixels');
  assert.ok(m.vramBytes > 0, 'VRAM ledger must report active scene bytes');
  assert.equal(m.foliageCount, 300, 'Portrait foliage field must populate 300 blades');
  assert.equal(m.projDecalsRendered, 1, 'Projected soft-edge decal must render');
  assert.equal(m.decalActive, 1, 'Active decal count must be 1');
  assert.equal(m.batchRegisteredMaterials, 2, 'Material batch registry must track 2 materials');
  assert.equal(m.portraitVp.orientation, 'portrait');
  assert.equal(m.allInLowerHalf, true, 'All thumb-arc buttons must lie in cy >= 0.52 * viewportHeight');
  assert.equal(m.directAllInLowerHalf, true);
  assert.ok(m.minBtnSize >= 48, 'All thumb buttons must be >= 48px');

  // Perform real Playwright pointer clicks inside lower-half thumb comfort arc for 'atk' & 'dash'
  const atkBtn = m.buttons.find(b => b.id === 'atk');
  const dashBtn = m.buttons.find(b => b.id === 'dash');
  assert.ok(atkBtn && dashBtn, 'atk and dash buttons must exist in thumb layout');
  await page.mouse.click(atkBtn.cx, atkBtn.cy);
  await page.mouse.click(dashBtn.cx, dashBtn.cy);

  const pressedActions = await page.evaluate(() => window.__mobileState.pressedActions);
  assert.deepEqual(errors, [], 'Pointer interaction errors: ' + errors.join(' | '));
  assert.deepEqual(pressedActions, ['atk', 'dash'], 'Real pointer clicks on bottom-right thumb arc must fire atk and dash');

  console.log(JSON.stringify({
    status: 'PASS',
    viewport: '390x844',
    dpr: 2,
    metrics: {
      ...m,
      pressedActions,
    },
  }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

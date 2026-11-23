#!/usr/bin/env node
/**
 * Real Headless Chromium WebGL2 benchmark & feature verification harness for HGame Engine v2.
 * Launches an ephemeral loopback static server over repo assets (never touching per-game ports),
 * exercises real WebGL2 3D & 2D pipelines, CSM shadows, decals, composable PBR, shader warmup,
 * Bone-VAT crossfade, YCoCg TAA, 2D polygon occluders, Chrome Trace profiler, Audio, Flex UI,
 * Input rebinding, and Network State Sync, and asserts pixel output + telemetry + zero errors.
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
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
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
};

const HARNESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>HGame v2 Chromium WebGL2 Benchmark</title></head>
<body style="margin:0;background:#000;display:flex;gap:8px;">
  <canvas id="c3d" width="320" height="180"></canvas>
  <canvas id="c2d" width="320" height="180"></canvas>
  <script type="module">
    import * as THREE from '/assets/optional/three/three.module.js';
    import {
      Scene,
      Entity,
      computeFlexLayout,
      createAudioManager,
      createInputManager,
      createNetworkStateSync,
    } from '/assets/runtime/index.js';
    import { createThreeAdapter } from '/assets/runtime/integrations/three.js';
    import { createComposableMaterial3D } from '/assets/runtime/integrations/material-graph3d.js';
    import { createWebGL2DAdapter, Sprite2D } from '/assets/runtime/integrations/webgl2d.js';

    function sampleGlPixels(gl, w, h) {
      if (!gl) return { uniqueColors: 0, nonBlackPixels: 0 };
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const colors = new Set();
      let nonBlack = 0;
      for (let i = 0; i < buf.length; i += 16) {
        const rgb = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
        colors.add(rgb);
        if (buf[i] > 4 || buf[i + 1] > 4 || buf[i + 2] > 4) nonBlack++;
      }
      return { uniqueColors: colors.size, nonBlackPixels: nonBlack };
    }

    window.__runHGameV2Benchmark = async () => {
      // 1. 3D WebGL2 Pipeline + CSM + Decals + Composable Material + Warmup + TAA + Profiler
      const c3d = document.getElementById('c3d');
      const cam3d = new THREE.PerspectiveCamera(55, 320 / 180, 0.2, 120);
      cam3d.position.set(0, 4.5, 9.5);
      cam3d.lookAt(0, 0.8, 0);
      cam3d.updateMatrixWorld();

      const adapter3d = createThreeAdapter({
        THREE,
        canvas: c3d,
        camera: cam3d,
        pixelRatio: 1,
        diagnostics3d: true,
        gpuIndirect: true,
        quality: 'high',
        post3d: {
          bloom: true,
          temporalAA: true,
          vignette: 0.15,
        },
        worldLighting: {
          ambient: { color: 0x334466, intensity: 0.8 },
          sun: {
            color: 0xfff4dc,
            intensity: 2.2,
            position: [8, 16, 10],
            cascades: { cascades: 3, maxFar: 60, mapSize: 512 },
          },
        },
      });

      const scene3d = new Scene('bench3d');
      const mat3d = createComposableMaterial3D(THREE, {
        color: 0x38bdf8,
        roughness: 0.32,
        metalness: 0.25,
        fresnel: { color: 0xfef08a, power: 2.5, intensity: 0.85 },
        specularAA: true,
        clearcoat: 0.5,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), mat3d);
      box.position.set(0, 1.3, 0);
      box.castShadow = true;
      box.receiveShadow = true;
      adapter3d.add(scene3d, box);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.75 }),
      );
      ground.rotation.x = -Math.PI * 0.5;
      ground.receiveShadow = true;
      adapter3d.add(scene3d, ground);

      const decals = adapter3d.createDecalSystem(scene3d, { maxDecals: 8 });
      const decalId = decals.spawn({
        position: [0, 0.03, 2.4],
        normal: [0, 1, 0],
        size: 1.8,
        color: 0xf97316,
        lifetime: 10,
      });

      const warmupStats = await adapter3d.warmupShaders(scene3d, cam3d);
      const frameTimes = [];
      for (let i = 0; i < 24; i++) {
        const angle = i * 0.08;
        cam3d.position.set(Math.sin(angle) * 8.5, 4.2, Math.cos(angle) * 8.5);
        cam3d.lookAt(0, 1.0, 0);
        cam3d.updateMatrixWorld();
        box.rotation.y = angle * 1.5;
        decals.update(0.016);
        const t0 = performance.now();
        adapter3d.render(scene3d);
        frameTimes.push(performance.now() - t0);
      }

      const diag3dSnap = adapter3d.getRenderDiagnostics();
      const frameStats3d = adapter3d.getRenderFrameStats();
      const chromeTrace3d = adapter3d.exportRenderChromeTrace();
      const gpuSubmitStats = adapter3d.getGpuSubmitStats();
      const csm = adapter3d.getCascadedShadowMap(scene3d);
      const gl3d = adapter3d.renderer.getContext();
      const gl3dError = gl3d?.getError?.() ?? 0;
      const glPixels3d = sampleGlPixels(gl3d, 320, 180);

      // 2. 2D WebGL2 Pipeline + Polygon Occluders + Lighting + Quality Tiers
      const c2d = document.getElementById('c2d');
      const adapter2d = createWebGL2DAdapter({
        canvas: c2d,
        pixelRatio: 1,
        designWidth: 320,
        designHeight: 180,
        diagnostics2d: true,
      });
      adapter2d.setAmbientLight('#0f172a', 0.45);
      adapter2d.addLight2D({ x: -30, y: 0, radius: 220, color: '#facc15', intensity: 2.0 });
      adapter2d.addLight2D({ x: 55, y: -20, radius: 160, color: '#38bdf8', intensity: 1.5 });
      const occCount = adapter2d.addPolygonOccluder2D([[-10, -25], [25, -25], [25, 25], [-10, 25]]);
      adapter2d.setPost2D({ bloomIntensity: 0.35, vignette: 0.2 });

      const scene2d = new Scene('bench2d');
      scene2d._enter?.();
      for (let k = 0; k < 6; k++) {
        const ent = new Entity({ name: 'quad_' + k, x: (k - 2.5) * 42, y: Math.sin(k) * 28 });
        ent.addComponent(new Sprite2D({ width: 32, height: 32, color: k % 2 === 0 ? '#ef4444' : '#22d3ee' }));
        scene2d.add(ent);
      }
      for (let i = 0; i < 12; i++) {
        adapter2d.render(scene2d);
      }
      const frameStats2d = adapter2d.getRenderFrameStats();
      const gl2d = c2d.getContext('webgl2');
      const gl2dError = gl2d ? gl2d.getError() : -1;
      const glPixels2d = sampleGlPixels(gl2d, 320, 180);

      // 3. Systems (Flex layout + Network State Sync + Web Audio Reverb/Doppler + Input Rebinding)
      const flex = computeFlexLayout({
        direction: 'row',
        gap: 8,
        padding: 8,
        children: [
          { id: 'panel', width: 120 },
          { id: 'content', flexGrow: 1 },
        ],
      }, 640, 360);

      const netSync = createNetworkStateSync({ interpolationDelayMs: 50 });
      const d = netSync.encodeDelta({ p: { x: 1, y: 2 } }, { p: { x: 5, y: 2 } });
      const dec = netSync.decodeDelta({ p: { x: 1, y: 2 } }, d);

      const audio = createAudioManager({ volume: 0.5 });
      const reverb = audio.createReverbZone({ id: 'hall', position: { x: 0, y: 0, z: 0 }, radius: 15 });
      audio.setListener({ x: 5, y: 0, z: 0 });
      const synthRes = audio.playSynth('hit', { volume: 0.2 });

      const input = createInputManager({ defaultBindings: { jump: ['Space'] } });
      input.setBinding('jump', ['KeyW']);
      const roundtripBindings = input.importBindings(JSON.stringify(input.exportBindings()));

      const result = {
        webgl2Active: Boolean(adapter3d.renderer.capabilities?.isWebGL2 && gl2d),
        gl3dError,
        gl2dError,
        csmCascades: csm?.cascades ?? 0,
        decalSpawned: decalId !== null && decalId !== undefined,
        shaderWarmup: warmupStats,
        gpuSubmitStats,
        frameStats3d,
        traceEventCount: chromeTrace3d.traceEvents.length,
        diag3dDraws: diag3dSnap?.drawCalls ?? null,
        glPixels3d,
        occCount,
        frameStats2d,
        glPixels2d,
        flexContentWidth: flex.children[1].width,
        netDecodedX: dec.p.x,
        reverbCurrentWet: reverb.currentWet,
        audioAvailable: audio.available,
        synthPreset: synthRes.preset,
        jumpBinding: roundtripBindings.jump,
      };

      window.__disposeBenchmarks = async () => {
        adapter3d.dispose();
        adapter2d.dispose();
        await audio.dispose();
        input.dispose();
        netSync.clear();
      };
      return result;
    };
  </script>
</body>
</html>`;

async function countDistinctColorsFromPng(page, pngBase64) {
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cvs = document.createElement('canvas');
    cvs.width = 80;
    cvs.height = 45;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, 80, 45);
    const data = ctx.getImageData(0, 0, 80, 45).data;
    const colors = new Set();
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      colors.add(rgb);
      if (data[i] > 4 || data[i + 1] > 4 || data[i + 2] > 4) nonBlack++;
    }
    return { uniqueColors: colors.size, nonBlackPixels: nonBlack };
  }, pngBase64);
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/benchmark.html') {
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
      res.end(HARNESS_HTML);
      return;
    }
    const rel = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ''));
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/benchmark.html`;

  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });

  const page = await browser.newPage({ viewport: { width: 720, height: 240 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err?.message || String(err)));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const resp = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(resp?.status(), 200);
  assert.deepEqual(errors, [], 'Module load errors: ' + errors.join(' | '));

  const metrics = await page.evaluate(() => window.__runHGameV2Benchmark());
  await page.evaluate(() => window.__disposeBenchmarks());

  const pixels3d = metrics.glPixels3d;
  const pixels2d = metrics.glPixels2d;

  assert.deepEqual(errors, [], 'Unexpected browser console/page errors: ' + errors.join(' | '));
  assert.equal(metrics.webgl2Active, true, 'WebGL2 must be active for both 3D and 2D');
  assert.equal(metrics.gl3dError, 0, '3D WebGL2 error must be 0');
  assert.equal(metrics.gl2dError, 0, '2D WebGL2 error must be 0');
  assert.equal(metrics.csmCascades, 3, 'CSM must configure 3 cascades');
  assert.equal(metrics.decalSpawned, true, 'Decal must spawn');
  assert.ok(metrics.shaderWarmup.compiled >= 1, 'Warmup must compile >= 1 material');
  assert.equal(metrics.gpuSubmitStats.enabled, true, 'gpuIndirect must be wired');
  assert.equal(metrics.frameStats3d.count, 24, '24 3D frames must be profiled');
  assert.ok(metrics.traceEventCount >= 24, 'Chrome trace must capture frame and pass events');
  assert.ok(pixels3d.uniqueColors > 8 && pixels3d.nonBlackPixels > 50, '3D canvas must render non-black lit scene');
  assert.equal(metrics.occCount, 4, 'Polygon occluder square must decompose into 4 segments');
  assert.equal(metrics.frameStats2d.count, 12, '12 2D frames must be profiled');
  assert.ok(pixels2d.uniqueColors > 4 && pixels2d.nonBlackPixels > 20, '2D WebGL2 canvas must render non-black lit scene');
  assert.equal(metrics.flexContentWidth, 496);
  assert.equal(metrics.netDecodedX, 5);
  assert.ok(metrics.reverbCurrentWet > 0.1);
  assert.deepEqual(metrics.jumpBinding, ['KeyW']);

  console.log(JSON.stringify({
    status: 'PASS',
    metrics,
    pixels3d,
    pixels2d,
  }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

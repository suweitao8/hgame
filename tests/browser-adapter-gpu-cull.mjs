#!/usr/bin/env node
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
const requireWebGpu = argv.includes('--require-webgpu');
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
<head><meta charset="utf-8" /><link rel="icon" href="data:," /></head>
<body>
  <canvas id="c" width="320" height="240"></canvas>
  <script type="module">
    import * as THREE from '/assets/optional/three/three.module.js';
    import { Scene } from '/assets/runtime/core/scene.js';
    import { createThreeAdapter } from '/assets/runtime/integrations/three.js';
    import { createIndirectInstancedBatch3D } from '/assets/runtime/integrations/gpu-indirect3d.js';

    window.__runAdapterGpuCullBench = async () => {
      if (!navigator.gpu) {
        return { available: false, reason: 'navigator.gpu missing' };
      }
      const gpuAdapter = await navigator.gpu.requestAdapter();
      if (!gpuAdapter) {
        return { available: false, reason: 'requestAdapter returned null' };
      }

      const canvas = document.getElementById('c');
      // Default options: gpuIndirect defaults to 'auto'
      const adapter = createThreeAdapter({
        THREE,
        canvas,
        width: 320,
        height: 240,
        pixelRatio: 1,
        cameraPosition: [0, 0, 10],
        cameraTarget: [0, 0, 0],
        near: 0.5,
        far: 100,
      });

      const stateBefore = adapter.getGpuCullingState();
      const total = 4096;
      const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44cc88 });
      const batch = createIndirectInstancedBatch3D(THREE, { geometry: geo, material: mat, capacity: total });

      const m = new THREE.Matrix4();
      for (let i = 0; i < total; i++) {
        // 2048 in front of camera (z = -5), 2048 behind camera (z = +50)
        const inFront = i < 2048;
        const x = ((i % 32) - 15.5) * 0.6;
        const y = ((Math.floor(i / 32) % 32) - 15.5) * 0.4;
        const z = inFront ? -5 : 50;
        m.makeTranslation(x, y, z);
        batch.setInstanceMatrix(i, m);
        batch.setInstanceBounds(i, x, y, z, 0.4);
      }

      const scene = new Scene('adapter-gpu-cull');
      adapter.add(scene, batch.mesh);
      adapter.registerIndirectBatch('swarm', batch);

      let frames = 0;
      let stateNow = adapter.getGpuCullingState();
      let bStats = batch.getStats();

      while (frames < 120) {
        adapter.render(scene);
        await new Promise((r) => requestAnimationFrame(r));
        frames++;
        stateNow = adapter.getGpuCullingState();
        bStats = batch.getStats();
        if (stateNow.mode === 'webgpu-indirect' && bStats.source === 'gpu-readback') {
          break;
        }
      }

      const gl = adapter.renderer.getContext();
      const glError = gl.getError();
      const submitStats = adapter.getGpuSubmitStats();
      const initialMeshCount = batch.mesh.count;

      const ringCount = 256;
      batch.setCount(ringCount);
      const camera = adapter.camera;
      const centers = [];
      const indices = new Map();
      const key = (x, z) => x.toFixed(4) + ':' + z.toFixed(4);
      for (let i = 0; i < ringCount; i++) {
        const angle = i * 2 * Math.PI / ringCount;
        const center = new THREE.Vector3(
          camera.position.x + 18 * Math.sin(angle), camera.position.y, camera.position.z - 18 * Math.cos(angle),
        );
        centers.push(center);
        indices.set(key(center.x, center.z), i);
        batch.setInstanceMatrix(i, m.makeTranslation(center.x, center.y, center.z));
        batch.setInstanceBounds(i, center.x, center.y, center.z, 0.4);
      }
      const frustum = new THREE.Frustum();
      const clip = new THREE.Matrix4();
      let movingReadbacks = 0;
      let missing = 0;
      let movingVisible = 0;
      let cutSource;
      for (let frame = 0; frame < 36; frame++) {
        camera.rotation.set(0, THREE.MathUtils.degToRad(frame * 4 + (frame >= 18 ? 128 : 0)), 0);
        adapter.render(scene);
        frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const drawn = new Set();
        for (let i = 0; i < batch.mesh.count; i++) {
          batch.mesh.getMatrixAt(i, m);
          drawn.add(indices.get(key(m.elements[12], m.elements[14])));
        }
        for (let i = 0; i < ringCount; i++) {
          if (frustum.containsPoint(centers[i]) && !drawn.has(i)) missing++;
        }
        const source = batch.getStats().source;
        if (frame === 18) cutSource = source;
        if (source === 'gpu-readback') {
          movingReadbacks++;
          movingVisible = Math.max(movingVisible, batch.mesh.count);
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      // Different non-rigid views can decompose to identical rotations and scales.
      camera.fov = 60;
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      camera.matrixAutoUpdate = false;
      function setShear(skew) {
        camera.matrix.set(0.8, skew, 0, 0, skew, 0.8, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        camera.matrixWorldNeedsUpdate = true;
      }
      batch.setCount(1);
      batch.setInstanceMatrix(0, m.makeTranslation(2.8, -2.8, -5));
      batch.setInstanceBounds(0, 2.8, -2.8, -5, 0.02);
      setShear(0.6);
      for (let frame = 0; frame < 8; frame++) {
        adapter.render(scene);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const shearWasCulled = batch.getStats().source === 'gpu-readback' && batch.visibleCount === 0;
      setShear(-0.6);
      adapter.render(scene);
      const shearKeptVisible = batch.visibleCount === 1 && batch.getStats().source === 'cpu-fallback';
      const skew = 4.9401e-7;
      const diagonal = Math.sqrt(1 - skew * skew);
      let tinyShearReadbacks = 0;
      for (let frame = 0; frame < 10; frame++) {
        camera.matrix.set(diagonal, skew, 0, frame / 10, skew, diagonal, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        camera.matrixWorldNeedsUpdate = true;
        adapter.render(scene);
        if (batch.getStats().source === 'gpu-readback') tinyShearReadbacks++;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      batch.dispose();
      adapter.dispose();
      geo.dispose();
      mat.dispose();

      return {
        available: true,
        adapterVendor: gpuAdapter.info?.vendor ?? null,
        adapterArchitecture: gpuAdapter.info?.architecture ?? null,
        frames,
        enabledBeforeBatch: stateBefore.enabled,
        mode: stateNow.mode,
        fallbackReason: stateNow.fallbackReason,
        pending: stateNow.pending,
        source: bStats.source,
        visibleCount: bStats.visibleCount,
        meshCount: initialMeshCount,
        gpuReadbacks: bStats.gpuReadbacks,
        submitStatsMode: submitStats.mode,
        glError,
        movingReadbacks,
        movingVisible,
        missing,
        cutSource,
        shearWasCulled,
        shearKeptVisible,
        tinyShearReadbacks,
      };
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqPath = (req.url || '/').split('?')[0];
    if (reqPath === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (reqPath === '/adaptergpucull.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML);
      return;
    }
    const filePath = path.join(root, reqPath.replace(/^\/+/, ''));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const buf = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

let browser;
try {
  const launchOpts = {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    // Headless Chromium only exposes a WebGPU adapter with the D3D11 ANGLE backend.
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--disable-gpu-sandbox'],
  };
  try {
    browser = await chromium.launch({ ...launchOpts, ...(!executablePath ? { channel: 'msedge' } : {}) });
  } catch {
    browser = await chromium.launch(launchOpts);
  }

  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err?.message || String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/adaptergpucull.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Page load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runAdapterGpuCullBench());
  assert.deepEqual(errors, [], 'Adapter GPU cull errors: ' + errors.join(' | '));
  if (!m.available) {
    assert.equal(requireWebGpu, false, m.reason);
    console.log(JSON.stringify({ status: 'SKIP', reason: m.reason }));
  } else {
    assert.equal(m.enabledBeforeBatch, false);
    assert.equal(m.mode, 'webgpu-indirect');
    assert.equal(m.source, 'gpu-readback');
    assert.equal(m.visibleCount, 2048);
    assert.equal(m.meshCount, 2048);
    assert.equal(m.glError, 0);
    assert.equal(m.missing, 0, 'the registered batch must retain visible instances during turns and a cut');
    assert.ok(m.movingReadbacks >= 8, `expected GPU readbacks while turning, got ${m.movingReadbacks}`);
    assert.ok(m.movingVisible < 192, 'motion padding should still cull at least one quarter of the scene');
    assert.equal(m.cutSource, 'cpu-fallback', 'a camera cut culls against the current view on the CPU');
    assert.equal(m.shearWasCulled, true);
    assert.equal(m.shearKeptVisible, true, 'a changed non-rigid camera must use the current exact planes');
    assert.equal(m.tinyShearReadbacks, 0, 'a moving camera with subpixel shear must use exact planes');
    console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
  }
} finally {
  await browser?.close();
  server.close();
}

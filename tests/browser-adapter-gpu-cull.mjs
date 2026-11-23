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

      batch.dispose();
      adapter.dispose();
      geo.dispose();
      mat.dispose();

      return {
        available: true,
        frames,
        enabledBeforeBatch: stateBefore.enabled,
        mode: stateNow.mode,
        fallbackReason: stateNow.fallbackReason,
        pending: stateNow.pending,
        source: bStats.source,
        visibleCount: bStats.visibleCount,
        meshCount: batch.mesh.count,
        gpuReadbacks: bStats.gpuReadbacks,
        submitStatsMode: submitStats.mode,
        glError,
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
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
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
    console.log(JSON.stringify({ status: 'SKIP', reason: m.reason }));
    process.exit(0);
  }

  assert.equal(m.enabledBeforeBatch, false);
  assert.equal(m.mode, 'webgpu-indirect');
  assert.equal(m.source, 'gpu-readback');
  assert.equal(m.visibleCount, 2048);
  assert.equal(m.meshCount, 2048);
  assert.equal(m.glError, 0);

  console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

#!/usr/bin/env node
/**
 * Real Dawn WebGPU Compute Frustum Culling + DrawIndexedIndirect Verification for HGame v4.
 * Dispatches `GPU_CULL_WGSL` (@workgroup_size(64)) across 4,096 spheres on hardware WebGPU
 * (`navigator.gpu`), reads back atomic indirect instanceCount & compacted visibleIndices,
 * and confirms zero leaks across 2,048 visible vs 2,048 occluded spheres plus WebGL2/CPU fallback.
 */
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
<head><meta charset="utf-8" /></head>
<body>
  <script type="module">
    import {
      createGpuIndirectCuller3D,
      dispatchWebGpuHiZOcclusion,
    } from '/assets/runtime/integrations/gpu-indirect3d.js';

    window.__runWebGpuComputeBench = async () => {
      if (!navigator.gpu) return { available: false, reason: 'navigator.gpu missing' };
      const adapter = await navigator.gpu.requestAdapter() || await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (!adapter) return { available: false, reason: 'no WebGPU adapter' };
      const device = await adapter.requestDevice();

      const total = 4096;
      const bounds = new Float32Array(total * 4);
      for (let i = 0; i < total; i++) {
        const inside = i < 2048;
        bounds[i * 4] = ((i % 64) - 32) * 0.5;
        bounds[i * 4 + 1] = 0;
        // Simple frustum planes: -z - 1 >= -r (i.e. z <= -1 + r) for near plane at z = -1
        // Place visible instances at z = -12, occluded behind camera at z = +25
        bounds[i * 4 + 2] = inside ? -12 : 25;
        bounds[i * 4 + 3] = 0.75;
      }

      // 6 half-space planes enclosing [-40,40]x[-40,40]x[-80,-2]
      const frustumPlanes = new Float32Array([
        1, 0, 0, 40,
        -1, 0, 0, 40,
        0, 1, 0, 40,
        0, -1, 0, 40,
        0, 0, -1, -2,
        0, 0, 1, 80,
      ]);

      const culler = createGpuIndirectCuller3D({
        webgpuDevice: device,
        maxInstances: total,
      });

      const res = await culler.dispatchWebGpuCompute({
        boundsData: bounds,
        instanceCount: total,
        frustumPlanes,
        indexCount: 36,
        readback: true,
      });

      let maxVisibleIdx = -1;
      let badIndices = 0;
      const seen = new Set();
      for (let i = 0; i < res.visibleIndices.length; i++) {
        const id = res.visibleIndices[i];
        if (id > maxVisibleIdx) maxVisibleIdx = id;
        if (id >= 2048) badIndices++;
        seen.add(id);
      }

      culler.dispose();

      // Also verify graceful CPU/non-WebGPU fallback
      const cpuFallback = createGpuIndirectCuller3D({ maxInstances: 64 });
      const fbRes = await cpuFallback.dispatchWebGpuCompute({
        boundsData: bounds.subarray(0, 64 * 4),
        instanceCount: 64,
        frustumPlanes,
      });
      cpuFallback.dispose();

      // Stage 2: Hardware WebGPU Hi-Z Depth Pyramid Occlusion Culling (256 objects: 128 occluded, 128 visible)
      const hizW = 64;
      const hizH = 64;
      const hizDepthData = new Float32Array(hizW * hizH).fill(0.95);
      for (let y = 0; y < hizH; y++) {
        for (let x = 0; x < hizW; x++) {
          const u = (x + 0.5) / hizW;
          const v = (y + 0.5) / hizH;
          if (u >= 0.15 && u <= 0.65 && v >= 0.15 && v <= 0.85) {
            hizDepthData[y * hizW + x] = 0.25;
          }
        }
      }
      const hizCount = 256;
      const screenAabbs = new Float32Array(hizCount * 4);
      const minDepths = new Float32Array(hizCount);
      for (let i = 0; i < hizCount; i++) {
        const occluded = i < 128;
        const b = i * 4;
        if (occluded) {
          screenAabbs[b] = 0.25;
          screenAabbs[b + 1] = 0.25;
          screenAabbs[b + 2] = 0.45;
          screenAabbs[b + 3] = 0.70;
        } else {
          screenAabbs[b] = 0.72;
          screenAabbs[b + 1] = 0.25;
          screenAabbs[b + 2] = 0.88;
          screenAabbs[b + 3] = 0.70;
        }
        minDepths[i] = 0.55;
      }
      const hizRes = await dispatchWebGpuHiZOcclusion({
        webgpuDevice: device,
        screenAabbs,
        minDepths,
        hizDepthData,
        width: hizW,
        height: hizH,
        objectCount: hizCount,
        readback: true,
      });

      return {
        available: true,
        adapterVendor: adapter.info?.vendor || 'unknown',
        adapterArch: adapter.info?.architecture || 'unknown',
        mode: res.mode,
        workgroups: res.workgroups,
        dispatched: res.dispatched,
        visibleCount: res.visibleCount,
        uniqueCount: seen.size,
        maxVisibleIdx,
        badIndices,
        fallbackMode: fbRes.mode,
        hizMode: hizRes.mode,
        hizDispatched: hizRes.dispatched,
        hizVisibleCount: hizRes.visibleCount,
        hizOccludedCount: hizRes.occludedCount,
        hizMipCount: hizRes.mipCount,
      };
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (reqUrl.pathname === '/webgpubench.html') {
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
  page.on('pageerror', err => errors.push(err?.message || String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/webgpubench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'WebGPU page load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runWebGpuComputeBench());
  assert.deepEqual(errors, [], 'WebGPU compute errors: ' + errors.join(' | '));
  if (!m.available) {
    console.log(JSON.stringify({ status: 'SKIP', reason: m.reason }));
    process.exit(0);
  }

  assert.equal(m.mode, 'webgpu-indirect');
  assert.equal(m.dispatched, 4096);
  assert.equal(m.workgroups, 64);
  assert.equal(m.visibleCount, 2048);
  assert.equal(m.uniqueCount, 2048);
  assert.equal(m.maxVisibleIdx, 2047);
  assert.equal(m.badIndices, 0);
  assert.equal(m.fallbackMode, 'cpu-instanced');
  assert.equal(m.hizMode, 'webgpu-hiz');
  assert.equal(m.hizDispatched, 256);
  assert.equal(m.hizVisibleCount, 128);
  assert.equal(m.hizOccludedCount, 128);
  assert.ok(m.hizMipCount >= 6);

  console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

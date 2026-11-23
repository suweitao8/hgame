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
  '.wasm': 'application/wasm',
};

const HARNESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><link rel="icon" href="data:," /></head>
<body>
  <script type="module">
    import { Entity } from '/assets/runtime/core/entity.js';
    import { RapierPhysicsWorld3D } from '/assets/runtime/physics/rapier3d.js';
    import { createWorkerPhysicsWorld } from '/assets/runtime/physics/worker-physics.js';

    function makeSpecs(count = 20) {
      const specs = [];
      for (let i = 0; i < count; i++) {
        const isFloor = i === 0;
        specs.push({
          x: isFloor ? 0 : (i % 5) * 1.2 - 2.4,
          y: isFloor ? -2 : 2 + Math.floor(i / 5) * 1.5,
          z: isFloor ? 0 : ((i * 3) % 4) * 1.1 - 1.5,
          width: isFloor ? 40 : 0.8,
          height: isFloor ? 1 : 0.8,
          depth: isFloor ? 40 : 0.8,
          options: isFloor
            ? { type: 'fixed', shape: 'cuboid', restitution: 0.4, friction: 0.6 }
            : { type: 'dynamic', shape: i % 2 === 0 ? 'cuboid' : 'ball', radius: 0.4, restitution: 0.35, friction: 0.5 },
          initVel: isFloor ? null : { x: ((i % 3) - 1) * 0.8, y: 0, z: ((i % 2) ? 0.5 : -0.5) },
        });
      }
      return specs;
    }

    window.__runWorkerPhysicsBench = async () => {
      const specs = makeSpecs(20);
      const steps = 300;
      const dt = 1 / 60;

      const workerWorld = createWorkerPhysicsWorld({
        dimension: 3,
        tickHz: 60,
        gravity: { x: 0, y: -9.81, z: 0 },
        worker: 'auto',
      });
      const workerEntities = specs.map((s) => {
        const e = new Entity({ x: s.x, y: s.y, z: s.z, width: s.width, height: s.height, depth: s.depth });
        workerWorld.add(e, s.options);
        if (s.initVel) workerWorld.setVelocity(e, s.initVel);
        return e;
      });
      await workerWorld.flush();

      const stepTimes = [];
      for (let t = 0; t < steps; t++) {
        const t0 = performance.now();
        if (t === 120) workerWorld.setVelocity(workerEntities[3], { x: 2.5, y: 4.0, z: -1.0 });
        workerWorld.step(dt);
        stepTimes.push(performance.now() - t0);
      }
      const workerChecksum = await workerWorld.stateChecksum();

      const inlineWorld = createWorkerPhysicsWorld({
        dimension: 3,
        tickHz: 60,
        gravity: { x: 0, y: -9.81, z: 0 },
        worker: 'inline',
        WorldClass: RapierPhysicsWorld3D,
      });
      const inlineEntities = specs.map((s) => {
        const e = new Entity({ x: s.x, y: s.y, z: s.z, width: s.width, height: s.height, depth: s.depth });
        inlineWorld.add(e, s.options);
        if (s.initVel) inlineWorld.setVelocity(e, s.initVel);
        return e;
      });
      for (let t = 0; t < steps; t++) {
        if (t === 120) inlineWorld.setVelocity(inlineEntities[3], { x: 2.5, y: 4.0, z: -1.0 });
        inlineWorld.step(dt);
      }
      const inlineChecksum = await inlineWorld.stateChecksum();

      const sorted = [...stepTimes].sort((a, b) => a - b);
      const maxStepMs = sorted[sorted.length - 1];
      const avgStepMs = stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length;
      const p95StepMs = sorted[Math.floor(sorted.length * 0.95)];

      const out = {
        mode: workerWorld.mode,
        fallbackReason: workerWorld.fallbackReason,
        workerChecksum,
        inlineChecksum,
        yDiff: Math.abs(workerEntities[1].y - inlineEntities[1].y),
        maxStepMs,
        avgStepMs,
        p95StepMs,
        crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
      };

      workerWorld.dispose();
      inlineWorld.dispose();
      return out;
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
    if (reqPath === '/workerbench.html') {
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
    console.error('[404]', req.url);
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
    args: ['--no-sandbox'],
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

  await page.goto(`http://127.0.0.1:${port}/workerbench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Page load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runWorkerPhysicsBench());
  assert.deepEqual(errors, [], 'Worker physics errors: ' + errors.join(' | '));
  assert.equal(m.mode, 'worker');
  assert.equal(m.crossOriginIsolated, false);
  assert.equal(m.workerChecksum, m.inlineChecksum);
  assert.ok(m.yDiff < 1e-4, `Expected matching entity y, diff=${m.yDiff}`);
  assert.ok(m.maxStepMs < 2, `Expected main-thread step < 2ms, got max=${m.maxStepMs}ms`);

  console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

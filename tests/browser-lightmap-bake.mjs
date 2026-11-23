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
    import { applyBakedLightmap3D } from '/assets/runtime/integrations/lighting3d.js';
    import { createLightmapBaker3D } from '/assets/runtime/integrations/lightmap-bake3d.js';

    function sampleAtUv(pixels, res, u, v) {
      const x = Math.max(0, Math.min(res - 1, Math.floor(u * res)));
      const y = Math.max(0, Math.min(res - 1, Math.floor(v * res)));
      const idx = (y * res + x) * 4;
      return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / (3 * 255);
    }

    function avgRegion(groundMesh, pixels, res, predicate) {
      const pos = groundMesh.geometry.getAttribute('position');
      const uv1 = groundMesh.geometry.getAttribute('uv1');
      const v = new THREE.Vector3();
      let sum = 0;
      let count = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(groundMesh.matrixWorld);
        if (predicate(v.x, v.z)) {
          sum += sampleAtUv(pixels, res, uv1.getX(i), uv1.getY(i));
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    }

    window.__runLightmapBakeBench = async () => {
      const canvas = document.getElementById('c');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
      const gl = renderer.getContext();
      const res = 512;

      const groundGeo = new THREE.PlaneGeometry(12, 12, 24, 24);
      groundGeo.rotateX(-Math.PI / 2);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const ground = new THREE.Mesh(groundGeo, groundMat);

      const cubeGeo = new THREE.BoxGeometry(2, 2, 2);
      const cubeMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8 });
      const cube = new THREE.Mesh(cubeGeo, cubeMat);
      cube.position.set(0, 1, 0);

      const baker = createLightmapBaker3D(THREE, renderer, { resolution: res, shadowResolution: 256, padding: 2 });

      // 1. Sun + AO bake
      const combined = baker.bake({
        meshes: [ground, cube],
        sun: { direction: [0.7, 0.7, 0.0], color: 0xffffff, intensity: 1.0, softness: 0.06 },
        ambient: { color: [0.25, 0.28, 0.32], intensity: 1.0 },
        samples: 64,
        aoSamples: 64,
        aoDistance: 2.5,
      });
      const combinedPixels = baker.readPixels();

      const shadowAvg = avgRegion(ground, combinedPixels, res, (x, z) => x >= -2.5 && x <= -1.2 && Math.abs(z) <= 0.6);
      const litAvg = avgRegion(ground, combinedPixels, res, (x, z) => x >= 2.5 && x <= 4.5 && Math.abs(z) <= 0.6);

      // 2. AO-only bake to isolate contact darkening around the cube base
      baker.bake({
        meshes: [ground, cube],
        sun: { intensity: 0 },
        ambient: { color: [1, 1, 1], intensity: 1.0 },
        samples: 0,
        aoSamples: 64,
        aoDistance: 2.5,
      });
      const aoPixels = baker.readPixels();
      const junctionAoAvg = avgRegion(
        ground,
        aoPixels,
        res,
        (x, z) => Math.abs(x) <= 1.55 && Math.abs(z) <= 1.55 && (Math.abs(x) >= 0.95 || Math.abs(z) >= 0.95)
      );
      const openAoAvg = avgRegion(
        ground,
        aoPixels,
        res,
        (x, z) => {
          const r = Math.hypot(x, z);
          return r >= 4.0 && r <= 5.2;
        }
      );

      // 3. Re-bake combined and bind via applyBakedLightmap3D + render scene
      const finalRes = baker.bake({
        meshes: [ground, cube],
        sun: { direction: [0.7, 0.7, 0.0], color: 0xffffff, intensity: 1.0, softness: 0.06 },
        ambient: { color: [0.25, 0.28, 0.32], intensity: 1.0 },
        samples: 64,
        aoSamples: 64,
        aoDistance: 2.5,
      });
      applyBakedLightmap3D(groundMat, finalRes.texture, { intensity: 1.0 });
      applyBakedLightmap3D(cubeMat, finalRes.texture, { intensity: 1.0 });

      const scene = new THREE.Scene();
      scene.add(ground, cube);
      const cam = new THREE.PerspectiveCamera(50, 320 / 240, 0.1, 100);
      cam.position.set(5, 6, 7);
      cam.lookAt(0, 0.5, 0);
      renderer.render(scene, cam);
      const glError = gl.getError();

      // 4. Point light falloff + 1-bounce red-floor color bleeding on shadowed white wall
      const bounceBaker = createLightmapBaker3D(THREE, renderer, { resolution: 256, shadowResolution: 128, padding: 2 });
      const redFloorGeo = new THREE.PlaneGeometry(8, 8, 8, 8);
      redFloorGeo.rotateX(-Math.PI / 2);
      const redFloor = new THREE.Mesh(redFloorGeo, new THREE.MeshStandardMaterial({ color: 0xff1111 }));

      const whiteWallGeo = new THREE.PlaneGeometry(4, 3, 8, 8);
      const whiteWall = new THREE.Mesh(whiteWallGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
      whiteWall.position.set(0, 1.5, -1.6);

      // Point light falloff test
      bounceBaker.bake({
        meshes: [redFloor],
        sun: { intensity: 0 },
        ambient: { intensity: 0 },
        lights: [{ type: 'point', position: [0, 1.0, 0], color: 0xffffff, intensity: 4.5, distance: 6 }],
        samples: 0,
        aoSamples: 0,
        bounces: 0,
        dilationPasses: 4,
      });
      const ptPx = bounceBaker.readPixels();
      const pointLitAvg = avgRegion(redFloor, ptPx, 256, (x, z) => Math.hypot(x, z) <= 0.8);
      const pointFarAvg = avgRegion(redFloor, ptPx, 256, (x, z) => Math.hypot(x, z) >= 3.2);

      // 1-bounce color bleeding test (sun from behind wall hits red floor, wall front gets 0 direct light)
      const bleedRes = bounceBaker.bake({
        meshes: [redFloor, whiteWall],
        sun: { direction: [0, 0.9, -0.45], color: 0xffffff, intensity: 1.6, softness: 0.02 },
        ambient: { color: [0.05, 0.05, 0.05], intensity: 0.4 },
        samples: 8,
        aoSamples: 0,
        bounces: 1,
        bounceIntensity: 0.9,
        bounceSurfels: 128,
        dilationPasses: 4,
      });
      const bleedPx = bounceBaker.readPixels();
      let bleedRSum = 0, bleedBSum = 0, bleedCount = 0;
      {
        const pos = whiteWall.geometry.getAttribute('position');
        const uv1 = whiteWall.geometry.getAttribute('uv1');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(whiteWall.matrixWorld);
          if (Math.abs(v.x) <= 1.2 && v.y >= 0.4 && v.y <= 1.6) {
            const px = Math.max(0, Math.min(255, Math.floor(uv1.getX(i) * 256)));
            const py = Math.max(0, Math.min(255, Math.floor(uv1.getY(i) * 256)));
            const idx = (py * 256 + px) * 4;
            bleedRSum += bleedPx[idx];
            bleedBSum += bleedPx[idx + 2];
            bleedCount++;
          }
        }
      }
      const bleedR = bleedCount > 0 ? bleedRSum / (bleedCount * 255) : 0;
      const bleedB = bleedCount > 0 ? bleedBSum / (bleedCount * 255) : 0;
      const postBounceErr = gl.getError();

      bounceBaker.dispose();
      redFloorGeo.dispose();
      whiteWallGeo.dispose();
      redFloor.material.dispose();
      whiteWall.material.dispose();

      baker.dispose();
      groundGeo.dispose();
      cubeGeo.dispose();
      groundMat.dispose();
      cubeMat.dispose();
      renderer.dispose();

      return {
        bakeMs: combined.stats.ms,
        samples: combined.stats.samples,
        dilationPasses: combined.stats.dilationPasses,
        texels: combined.stats.texels,
        channel: finalRes.texture.channel,
        shadowAvg,
        litAvg,
        shadowRatio: litAvg > 0 ? shadowAvg / litAvg : 1,
        junctionAoAvg,
        openAoAvg,
        pointLitAvg,
        pointFarAvg,
        bleedR,
        bleedB,
        bounceSurfels: bleedRes.stats.bounceSurfels,
        glError: glError || postBounceErr,
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
    if (reqPath === '/lightmapbench.html') {
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
    args: ['--no-sandbox', '--ignore-gpu-blocklist'],
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

  await page.goto(`http://127.0.0.1:${port}/lightmapbench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Page load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runLightmapBakeBench());
  assert.deepEqual(errors, [], 'Lightmap bake errors: ' + errors.join(' | '));
  assert.equal(m.glError, 0);
  assert.equal(m.channel, 1);
  assert.ok(m.bakeMs < 5000, `Expected bake < 5000ms, got ${m.bakeMs}ms`);
  assert.ok(m.shadowAvg < m.litAvg * 0.6, `Expected shadowAvg (${m.shadowAvg}) < 0.6 * litAvg (${m.litAvg})`);
  assert.ok(m.junctionAoAvg < m.openAoAvg, `Expected junctionAoAvg (${m.junctionAoAvg}) < openAoAvg (${m.openAoAvg})`);
  assert.ok(m.pointLitAvg > m.pointFarAvg * 1.4, `Expected pointLitAvg (${m.pointLitAvg}) > 1.4 * pointFarAvg (${m.pointFarAvg})`);
  assert.ok(m.bleedR > m.bleedB * 1.12, `Expected 1-bounce red color bleeding R (${m.bleedR}) > 1.12 * B (${m.bleedB})`);
  assert.ok(m.bounceSurfels > 0, `Expected used bounce surfels > 0, got ${m.bounceSurfels}`);
  assert.equal(m.dilationPasses, 4);

  console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

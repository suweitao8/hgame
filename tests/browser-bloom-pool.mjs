import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { benchmarkBrowserOptions, readBrowserEnvironment } from '../scripts/lib/browser-benchmark.mjs';
import { launchChromium } from '../scripts/lib/playwright-resolve.mjs';

const { values: { gpu, chrome } } = parseArgs({
  options: { gpu: { type: 'string', default: 'software' }, chrome: { type: 'string' } },
});
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await launchChromium(chromium, benchmarkBrowserOptions(gpu, chrome));
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('http://hgame.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="game"></canvas>' });
    }
    if (!/^\/assets\/(runtime|optional\/three)\/(?:[\w.-]+\/)*[\w.-]+\.js$/.test(pathname)) {
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ contentType: 'text/javascript', path: path.join(root, pathname) });
  });
  await page.goto('http://hgame.test/');
  const sample = await page.evaluate(async () => {
    const THREE = await import('/assets/optional/three/three.module.js');
    const { createPostPipeline3D } = await import('/assets/runtime/integrations/post3d.js');
    const canvas = document.querySelector('#game');
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    const gl = renderer.getContext();
    const width = 1920;
    const height = 1080;
    renderer.setSize(width, height, false);
    const world = new THREE.Scene();
    world.background = new THREE.Color(0x111921);
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 40);
    camera.position.z = 5;
    const geometry = new THREE.SphereGeometry(0.75, 16, 12);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(5, 3, 0.8) });
    world.add(new THREE.Mesh(geometry, material));
    const post = createPostPipeline3D({
      THREE, renderer, width, height, bloomStrength: 0.8, bloomThreshold: 0.4, filmGrain: 0,
      preset: { bloom: true, ssao: false, volumetricSteps: 0, msaaSamples: 0, fxaa: false, sharpen: 0 },
    });
    const frame = () => post.render(world, camera);
    const readPixels = () => {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const size = () => ({
      bytes: post.estimateTargetBytes().scalableBytes,
      gpuTextures: renderer.info.memory.textures,
      bloomMips: post.targets.bloomMipCount,
    });
    const difference = (a, b) => a.reduce((count, value, index) => count + Number(value !== b[index]), 0);
    const fingerprint = pixels => pixels.reduce((hash, value) => Math.imul(hash ^ value, 0x01000193), 0x811c9dc5) >>> 0;
    try {
      frame();
      const on = size();
      const onPixels = readPixels();
      post.setState({ bloomStrength: 0 });
      frame();
      const idle = size();
      for (let i = 1; i < 5; i++) frame();
      const off = size();
      const offPixels = readPixels();
      post.setState({ bloomStrength: 0.8 });
      frame();
      const recovered = size();
      const recoveredPixels = readPixels();
      return {
        on, idle, off, recovered, bloomPixelDifference: difference(onPixels, offPixels),
        onPixelFingerprint: fingerprint(onPixels), offPixelFingerprint: fingerprint(offPixels),
        recoveryPixelDifference: difference(onPixels, recoveredPixels),
        executed: post.getLastExecutedGraph().filter(id => id.startsWith('bloom-')),
        glError: gl.getError(),
      };
    } finally {
      post.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    }
  });
  const environment = await readBrowserEnvironment(page, browser, gpu);
  console.log(JSON.stringify({ ...sample, environment }));
  assert.equal(environment.gpuModeMatches, true);
  assert.deepEqual(errors, []);
  assert.equal(sample.glError, 0);
  assert.equal(sample.on.bloomMips, 4);
  assert.equal(sample.executed.length, 7);
  assert.equal(sample.off.bloomMips, 0);
  assert.equal(sample.idle.bytes, sample.on.bytes, 'idle textures remain visible to the ledger');
  assert.equal(sample.idle.gpuTextures, sample.on.gpuTextures);
  assert.ok(sample.off.bytes < sample.on.bytes);
  assert.equal(sample.on.gpuTextures - sample.off.gpuTextures, 7);
  assert.deepEqual(sample.recovered, sample.on);
  assert.ok(sample.bloomPixelDifference > 0, 'Bloom changes the rendered image');
  assert.equal(sample.recoveryPixelDifference, 0, 're-enabling Bloom restores the original pixels');
} finally {
  await browser.close();
}

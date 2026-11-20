import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { benchmarkBrowserOptions } from '../scripts/lib/browser-benchmark.mjs';

const { values } = parseArgs({ options: { chrome: { type: 'string' } } });
const browser = await chromium.launch(benchmarkBrowserOptions('software', values.chrome ?? process.env.HGAME_CHROME));
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.route('http://hgame-vfx.test/**', async route => {
    const modulePath = new URL(route.request().url()).pathname;
    if (modulePath === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VFX pixel probe</title>' });
    if (!modulePath.startsWith('/assets/')) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(new URL('..' + modulePath, import.meta.url));
      await route.fulfill({ contentType: 'text/javascript', body });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto('http://hgame-vfx.test/');
  const captures = await page.evaluate(async () => {
    const THREE = await import('/assets/optional/three/three.module.js');
    const { createAtlasParticlePool, createMeshVfxPool, createVfxSystem } = await import('/assets/runtime/vfx/index.js');
    const dimensions = 64;
    const constantColor = rgba => [[0, rgba], [1, rgba]];
    const straight = constantColor([0.8, 0.4, 0.2, 0.5]);
    const premultiplied = constantColor([0.4, 0.2, 0.1, 0.5]);
    const rgba = new Uint8Array(4);
    const white = document.createElement('canvas');
    white.width = white.height = 2;
    const ctx = white.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 2, 2);
    const cases = [
      { blend: 'alpha', alphaCutoff: 0.45, colorCurve: straight },
      { blend: 'alpha', alphaCutoff: 0.6, colorCurve: straight },
      { blend: 'premultiply', alphaCutoff: 0.45, colorCurve: premultiplied },
      { blend: 'multiply', alphaCutoff: 0.45, colorCurve: straight },
    ];
    const result = {};
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = dimensions;
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
      const pool = createAtlasParticlePool({ mode: 'webgl2d', gl, maxParticles: 4 });
      pool.setAtlas(white);
      result.webgl2d = cases.map(options => {
        pool.reset();
        gl.clearColor(0.25, 0.25, 0.25, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        pool.emit({ ...options, sizeStart: 40, duration: 1 });
        pool.renderWebGL2({ x: 0, y: 0, zoom: 1 }, dimensions, dimensions);
        gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error');
        return Array.from(rgba.slice(0, 3));
      });
      pool.dispose();
    } catch (error) {
      result.webgl2dError = error.message;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(dimensions, dimensions);
    renderer.setClearColor(new THREE.Color().setRGB(0.25, 0.25, 0.25), 1);
    const target = new THREE.WebGLRenderTarget(dimensions, dimensions);
    renderer.setRenderTarget(target);
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    const scene = new THREE.Scene();
    const atlas = createAtlasParticlePool({ mode: '3d', THREE, scene, maxParticles: 4 });
    const mesh = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 1 });
    atlas.setAtlas(white);
    function capture(x = 32, y = 32, view = camera) {
      renderer.render(scene, view);
      renderer.readRenderTargetPixels(target, x, y, 1, 1, rgba);
      return Array.from(rgba.slice(0, 3));
    }
    result.atlas = cases.map(options => {
      atlas.reset();
      atlas.emit({ ...options, sizeStart: 2.5, duration: 1 });
      atlas.flushDirty();
      return capture();
    });
    const perspective = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    perspective.position.z = 5;
    perspective.updateMatrixWorld();
    const { near, far } = perspective;
    const depth = (far - near * far / 5.25) / (far - near);
    const sceneDepth = new THREE.DataTexture(new Float32Array([depth]), 1, 1, THREE.RedFormat, THREE.FloatType);
    sceneDepth.needsUpdate = true;
    atlas.reset();
    atlas.setDepthTexture(sceneDepth, { near, far, width: dimensions, height: dimensions, softFade: 0.5 });
    atlas.emit({ ...cases[0], sizeStart: 2.5, duration: 1 });
    atlas.flushDirty();
    result.atlasSoftFade = capture(32, 32, perspective);
    atlas.dispose();
    sceneDepth.dispose();
    result.mesh = cases.map(options => {
      mesh.reset();
      mesh.spawn({ ...options, mesh: 'quad', duration: 1 });
      return capture();
    });
    mesh.reset();
    mesh.spawn({ ...cases[0], mesh: 'quad', duration: 1, cameraFade: [4, 6] });
    result.meshFade = capture();
    mesh.reset();
    const premultipliedTexture = new THREE.DataTexture(new Uint8Array([102, 51, 26, 128]), 1, 1);
    premultipliedTexture.needsUpdate = true;
    mesh.spawn({ ...cases[2], mesh: 'quad', duration: 1, colorCurve: null, texture: premultipliedTexture });
    result.premultipliedTexture = capture();
    mesh.reset();
    mesh.spawn({ ...cases[0], mesh: 'quad', duration: 1, opaque: true });
    result.opaqueMesh = capture();
    mesh.dispose();
    premultipliedTexture.dispose();

    const sheet = document.createElement('canvas');
    sheet.width = 8;
    sheet.height = 4;
    const paint = sheet.getContext('2d');
    paint.fillStyle = '#f00';
    paint.fillRect(0, 0, 4, 4);
    paint.fillStyle = '#fff';
    paint.fillRect(4, 0, 2, 4);
    const sheetTexture = new THREE.CanvasTexture(sheet);
    sheetTexture.flipY = false;
    sheetTexture.magFilter = THREE.NearestFilter;
    const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, maxAtlasParticles: 4, maxMeshVfx: 1 });
    vfx.setAtlas(sheetTexture, { mask: [0.5, 0, 1, 1] });
    vfx.playEffect({
      schemaVersion: 1, id: 'mesh_atlas_cutout', duration: 1,
      layers: [{
        kind: 'mesh', mesh: 'quad', sprite: 'mask', alphaCutoff: 0.45,
        size: 2.5, life: 1, colorCurve: straight, bursts: [{ time: 0, count: 1 }],
      }],
    });
    vfx.update(0.01);
    result.recipeMesh = [capture(23), capture(41)];
    vfx.dispose();
    sheetTexture.dispose();
    target.dispose();
    renderer.dispose();
    return result;
  });
  console.log(JSON.stringify({ captures, consoleErrors }, null, 2));
  assert.equal(captures.webgl2dError, undefined);
  assert.deepEqual(consoleErrors, []);
  function near(actual, expected, label) {
    assert.ok(actual.every((p, i) => Math.abs(p - expected[i]) <= 3), label);
  }
  for (const path of ['webgl2d','atlas','mesh']) {
    const [alpha, clipped, premultiply, multiply] = captures[path];
    near(alpha, [134, 83, 57], path + ' retains alpha after cutoff');
    near(clipped, [64, 64, 64], path + ' discards below threshold');
    near(premultiply, alpha, path + ' consumes already-premultiplied RGB');
    near(multiply, [58, 45, 38], path + ' interpolates multiply toward white');
  }
  near(captures.meshFade, [99, 73, 61], 'alpha clip is evaluated before camera fade');
  near(captures.atlasSoftFade, [99, 73, 61], 'alpha clip is evaluated before soft depth fade');
  near(captures.premultipliedTexture, [134, 83, 58], 'premultiplied texture RGB is used directly');
  near(captures.opaqueMesh, [204, 102, 51], 'opaque cutout writes the covered pixel at full opacity');
  near(captures.recipeMesh[0], [134, 83, 57], 'mesh recipe uses the selected atlas region');
  near(captures.recipeMesh[1], [64, 64, 64], 'mesh recipe clips transparent texels in the region');
} finally {
  await browser.close();
}

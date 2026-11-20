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
    const nearParticle = {
      sprite: 'mask', opaque: true, alphaCutoff: 0.45, offset: [0, 0, 1],
      size: 2.5, life: 1, colorCurve: straight, bursts: [{ time: 0, count: 1 }],
    };
    const farMesh = {
      kind: 'mesh', mesh: 'quad', size: 2.5, life: 1,
      colorCurve: constantColor([0, 0, 1, 1]), bursts: [{ time: 0, count: 1 }],
    };
    function playCase(id, layers, steps = [0.01]) {
      vfx.reset();
      vfx.playEffect({ schemaVersion: 1, id, duration: 1, layers });
      for (const step of steps) vfx.update(step);
      return [capture(23), capture(41)];
    }
    result.atlasDepthWrite = playCase('atlas_write', [nearParticle, farMesh]);
    result.atlasNoDepthWrite = playCase('atlas_no_write', [{ ...nearParticle, depthWrite: false }, farMesh]);
    result.atlasWhiteBase = playCase('atlas_white_base', [{ ...nearParticle, sprite: undefined, useTexture: false }]);
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
    blocker.position.z = 1;
    scene.add(blocker);
    result.depthComparisons = {};
    for (const depthTest of ['less-equal', 'greater', 'always', 'disabled', 'never']) {
      result.depthComparisons[depthTest] = playCase('atlas_' + depthTest, [{ ...nearParticle, depthTest, offset: [0, 0, 0] }]);
    }
    result.meshDepthComparison = playCase('mesh_greater', [{ ...farMesh, depthTest: 'greater' }]);
    const blockerDepth = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
    blockerDepth.needsUpdate = true;
    vfx.setDepthTexture(blockerDepth, { width: dimensions, height: dimensions });
    const transparent = { ...nearParticle, opaque: false, depthTest: 'greater', offset: [0, 0, 0] };
    result.materialSoftDepth = [false, true].map(softParticles =>
      playCase('atlas_soft_' + softParticles, [{ ...transparent, softParticles }])[0]);
    vfx.setDepthTexture(null);
    blockerDepth.dispose();
    scene.remove(blocker);
    blocker.geometry.dispose();
    blocker.material.dispose();

    const grid = document.createElement('canvas');
    grid.width = grid.height = 8;
    const framePaint = grid.getContext('2d');
    framePaint.fillStyle = '#f0f';
    framePaint.fillRect(0, 0, 4, 8);
    for (const [i, color] of ['#f00', '#0f0', '#00f', '#fff'].entries()) {
      framePaint.fillStyle = color;
      framePaint.fillRect(4 + (i % 2) * 2, Math.floor(i / 2) * 4, 2, 4);
    }
    const gridTexture = new THREE.CanvasTexture(grid);
    gridTexture.magFilter = THREE.NearestFilter;
    vfx.setAtlas(gridTexture, { grid: [0.5, 0, 1, 1] });
    const sheetCases = [
      [{ blend: true }, 0],
      [{ blend: true }, 2],
      [{ blend: false }, 2],
      [{ blend: false }, 4],
      [{ rowMode: 'custom', rowIndex: 1 }, 0],
      [{ rowMode: 'custom', rowIndex: 1 }, 4],
      [{ cycles: 2 }, 8],
    ];
    result.flipbook = {};
    for (const kind of ['mesh', 'particle']) {
      result.flipbook[kind] = sheetCases.map(([options, steps], i) => playCase(kind + '_grid_' + i, [{
        kind, mesh: 'quad', size: 2.5, life: 1, colorCurve: constantColor([1, 1, 1, 1]),
        flipbook: { region: 'grid', cols: 2, rows: 2, ...options }, bursts: [{ time: 0, count: 1 }],
      }], steps ? Array(steps).fill(0.0625) : [0])[0]);
    }
    const embeddedGrid = document.createElement('canvas');
    embeddedGrid.width = embeddedGrid.height = 4;
    const embeddedPaint = embeddedGrid.getContext('2d');
    for (const [i, color] of ['#f00', '#0f0', '#00f', '#fff'].entries()) {
      embeddedPaint.fillStyle = color;
      embeddedPaint.fillRect((i % 2) * 2, Math.floor(i / 2) * 2, 2, 2);
    }
    const embeddedTexture = new THREE.CanvasTexture(embeddedGrid);
    embeddedTexture.flipY = false;
    embeddedTexture.magFilter = THREE.NearestFilter;
    const embeddedGeometry = new THREE.PlaneGeometry(1, 1);
    const embeddedUv = embeddedGeometry.getAttribute('uv');
    for (let i = 0; i < embeddedUv.count; i++) embeddedUv.setY(i, 1 - embeddedUv.getY(i));
    const embeddedMaterial = new THREE.MeshBasicMaterial({ map: embeddedTexture });
    vfx.registerMesh('embedded_sheet', new THREE.Mesh(embeddedGeometry, embeddedMaterial));
    playCase('embedded_flipbook', [{
      kind: 'mesh', mesh: 'embedded_sheet', size: 2.5, life: 1,
      colorCurve: constantColor([1, 1, 1, 1]), bursts: [{ time: 0, count: 1 }],
      flipbook: { region: 'unregistered', cols: 2, rows: 1, blend: false },
    }], [0]);
    result.embeddedFlipbook = [capture(32, 40), capture(32, 24)];
    vfx.dispose();
    embeddedGeometry.dispose();
    embeddedMaterial.dispose();
    embeddedTexture.dispose();
    gridTexture.dispose();
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
  near(captures.atlasDepthWrite[0], [204, 102, 51], 'opaque atlas particle blocks the farther fragment with a depth write');
  near(captures.atlasDepthWrite[1], [0, 0, 255], 'alpha-clipped texels leave the far mesh visible');
  near(captures.atlasNoDepthWrite[0], [0, 0, 255], 'an explicit depth-write override leaves the farther mesh visible');
  for (const pixel of captures.atlasWhiteBase) near(pixel, [204, 102, 51], 'white base ignores neighboring atlas regions');
  for (const depthTest of ['less-equal', 'never']) {
    near(captures.depthComparisons[depthTest][0], [0, 255, 0], depthTest + ' rejects the farther particle');
  }
  for (const depthTest of ['greater', 'always', 'disabled']) {
    near(captures.depthComparisons[depthTest][0], [204, 102, 51], depthTest + ' permits the farther particle');
  }
  near(captures.meshDepthComparison[0], [0, 0, 255], 'mesh recipe forwards the depth comparison');
  near(captures.materialSoftDepth[0], [102, 179, 26], 'soft particles can opt out of scene-depth fade when they pass the depth test');
  near(captures.materialSoftDepth[1], [0, 255, 0], 'enabled soft particles retain depth fade');
  const expectedFrames = [[255, 0, 0], [128, 128, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 255], [255, 0, 0]];
  for (const kind of ['mesh', 'particle']) {
    captures.flipbook[kind].forEach((pixel, i) => near(pixel, expectedFrames[i], kind + ' texture-sheet frame ' + i));
  }
  near(captures.embeddedFlipbook[0], [255, 0, 0], 'embedded glTF texture keeps the top of the frame');
  near(captures.embeddedFlipbook[1], [0, 0, 255], 'embedded glTF texture keeps the bottom of the frame');
} finally {
  await browser.close();
}

#!/usr/bin/env node
// Real Chromium/WebGL proof: adjacent meshes share WORLD-POSITION UVs.
// Checks GPU shader compilation (including instancing) and pixel continuity.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const choose = (name, fallback) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const { chromium } = createRequire(import.meta.url)(choose('--playwright', 'playwright-core'));
const chrome = choose('--chrome', undefined);
const temp = await mkdtemp(path.join(os.tmpdir(), 'world-aligned-'));
const game = path.join(temp, 'native-world');
let server, browser;
try {
  const created = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'create-game.mjs'), game,
    '--profile', '3d', '--no-git',
  ], { encoding: 'utf8' });
  if (created.status !== 0) throw new Error('Project creation failed: ' + created.stderr);
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  server = spawn(process.execPath, [
    path.join(root, 'scripts', 'preview.mjs'), game, '--port', String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const origin = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      ready = (await fetch(origin)).ok;
      if (ready) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  if (!ready) throw new Error('Local preview did not start');
  browser = await chromium.launch({
    headless: true, ...(chrome ? { executablePath: chrome } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 650 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text() + ' @' + msg.location().url);
  });
  page.on('response', r => {
    if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url());
  });
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForTimeout(750);
  const result = await page.evaluate(async () => {
    const THREE = await import('./assets/vendor/three/three.module.js');
    const { createWorldAlignedMaterial } =
      await import('./vendor/hgame/integrations/world-aligned-material.js');
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(256, 256, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const ctx = renderer.getContext();
    const camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 50);
    camera.position.set(0, 7, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#171b20');
    scene.add(new THREE.AmbientLight('#ffffff', 3));
    const mat = createWorldAlignedMaterial(THREE, {
      color: '#ffffff', pattern: 'stone', tileSize: 0.75, projection: 'planar',
    });
    const pixelBuffer = new Uint8Array(256 * 256 * 4);
    function renderIntoBuffer() {
      renderer.render(scene, camera);
      ctx.readPixels(0, 0, 256, 256, ctx.RGBA, ctx.UNSIGNED_BYTE, pixelBuffer);
      return Uint8Array.from(pixelBuffer);
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    const a = new THREE.Mesh(box, mat), b = new THREE.Mesh(box, mat);
    a.position.set(-0.5, 0.5, 0);
    b.position.set(0.5, 0.5, 0);
    scene.add(a, b);
    const twoBlocks = renderIntoBuffer();
    scene.remove(a, b);
    const merged = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), mat);
    merged.position.set(0, 0.5, 0);
    scene.add(merged);
    const mergedBlock = renderIntoBuffer();
    scene.remove(merged);

    const instanced = new THREE.InstancedMesh(box, mat, 2);
    const matrix = new THREE.Matrix4();
    instanced.setMatrixAt(0, matrix.makeTranslation(-0.5, 0.5, 0));
    instanced.setMatrixAt(1, matrix.makeTranslation(0.5, 0.5, 0));
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);
    const instancedBlocks = renderIntoBuffer();
    scene.remove(instanced);

    // The comparison measures per-pixel differences in the visible top face.
    // Small rasterization differences at shared triangle boundaries are
    // tolerated, but UV resets or object-space projection cause large errors.
    function diff(aPixels, bPixels) {
      let changed = 0, total = 0, max = 0, delta = 0;
      for (let y = 76; y < 180; y++) {
        for (let x = 46; x < 210; x++) {
          const offset = (y * 256 + x) * 4;
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(aPixels[offset + k] - bPixels[offset + k]);
            if (d > 4) changed++;
            max = Math.max(max, d);
            delta += d;
            total++;
          }
        }
      }
      return { changed, total, max, meanError: delta / total };
    }
    const regular = diff(twoBlocks, mergedBlock);
    const instances = diff(instancedBlocks, mergedBlock);
    // PBR detail pipeline: one packed RGBA texture supplies world normal,
    // roughness and AO. These must also agree across separate and instanced
    // geometry, not merely compile as a dormant shader branch.
    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(2, 6, 4);
    scene.add(light);
    const detailed = createWorldAlignedMaterial(THREE, {
      color: '#ffffff', pattern: 'stone', tileSize: 0.75,
      projection: 'triplanar', normalStrength: 1,
      roughnessVariation: 1, aoIntensity: 1, roughness: 0.7,
    });
    a.material = b.material = merged.material = instanced.material = detailed;
    scene.add(a, b);
    const detailSeparate = renderIntoBuffer();
    scene.remove(a, b);
    scene.add(merged);
    const detailMerged = renderIntoBuffer();
    scene.remove(merged);
    scene.add(instanced);
    const detailInstanced = renderIntoBuffer();
    scene.remove(instanced);
    const detailTopRegular = diff(detailSeparate, detailMerged);
    const detailTopInstanced = diff(detailInstanced, detailMerged);

    // Same projection on the FRONT and TOP faces, where the normal changes
    // from +Z to +Y. This catches incorrect world-axis normal reconstruction.
    camera.position.set(0, 3, 5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0.5, 0);
    camera.updateProjectionMatrix();
    scene.add(a, b);
    const detailSideSeparate = renderIntoBuffer();
    scene.remove(a, b);
    scene.add(merged);
    const detailSideMerged = renderIntoBuffer();
    scene.remove(merged);
    scene.add(instanced);
    const detailSideInstanced = renderIntoBuffer();
    scene.remove(instanced);
    const detailSideRegular = diff(detailSideSeparate, detailSideMerged);
    const detailSideInstances = diff(detailSideInstanced, detailSideMerged);
    // Same lighting, same material color/pattern and same map projection,
    // but NO detail: check that the new shading is observable on GPU.
    const plain = createWorldAlignedMaterial(THREE, {
      color: '#ffffff', pattern: 'stone', tileSize: 0.75,
      projection: 'triplanar', roughness: 0.7,
    });
    merged.material = plain;
    scene.add(merged);
    const noDetailImage = renderIntoBuffer();
    scene.remove(merged);
    const detailVisibleDifference = diff(detailSideMerged, noDetailImage);
    const channelDifferences = {};
    for (const feature of ['normalStrength', 'roughnessVariation', 'aoIntensity']) {
      const channelMaterial = createWorldAlignedMaterial(THREE, {
        color: '#ffffff', pattern: 'stone', tileSize: 0.75,
        projection: 'triplanar', roughness: 0.7, [feature]: 1,
      });
      merged.material = channelMaterial;
      scene.add(merged);
      const channelImage = renderIntoBuffer();
      scene.remove(merged);
      channelDifferences[feature] = diff(channelImage, noDetailImage);
      channelMaterial.userData.worldAligned.detailTexture.dispose();
      channelMaterial.userData.worldAligned.texture.dispose();
      channelMaterial.dispose();
    }

    const pixelVariety = new Set();
    for (let i = 0; i < mergedBlock.length; i += 4 * 41) {
      pixelVariety.add(mergedBlock[i]);
    }
    const glError = ctx.getError();
    renderer.dispose();
    box.dispose();
    merged.geometry.dispose();
    instanced.dispose();
    detailed.userData.worldAligned.detailTexture.dispose();
    detailed.userData.worldAligned.texture.dispose();
    detailed.dispose();
    plain.userData.worldAligned.texture.dispose();
    plain.dispose();
    mat.userData.worldAligned.texture.dispose();
    mat.dispose();
    return {
      regular, instances, glError,
      detailTopRegular, detailTopInstanced,
      detailSideRegular, detailSideInstances, detailVisibleDifference,
      channelDifferences,
      shaderPrograms: renderer.info.programs?.length ?? 0,
      imageHasVariation: pixelVariety.size > 2,
    };
  });
  console.log('WORLD_ALIGNED_BROWSER', JSON.stringify(result));
  if (errors.length) throw new Error('Shader/Browser errors: ' + errors.join(' | ').slice(0, 1800));
  if (result.glError !== 0 || !result.imageHasVariation ||
      result.regular.meanError > 2.5 || result.instances.meanError > 2.5 ||
      result.regular.changed / result.regular.total > 0.03 ||
      result.instances.changed / result.instances.total > 0.03 ||
      [result.detailTopRegular, result.detailTopInstanced,
        result.detailSideRegular, result.detailSideInstances].some(
        d => d.meanError > 2.5 || d.changed / d.total > 0.03) ||
      result.detailVisibleDifference.meanError < 0.15 ||
      Object.values(result.channelDifferences).some(d => d.meanError < 0.015)) {
    throw new Error('World-space texture seam or instancing mismatch');
  }
  console.log('WORLD_ALIGNED_SEAM_PASS adjacent Cubes = one wide Cube = 2 instanced Cubes');
  console.log('WORLD_PBR_DETAIL_GPU_PASS normals/roughness/AO projected continuously on top & side');
} finally {
  await browser?.close();
  if (server && !server.killed) server.kill();
  await new Promise(resolve => setTimeout(resolve, 300));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

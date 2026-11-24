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
      const executed = post.getLastExecutedGraph().filter(id => id.startsWith('bloom-'));
      post.setState({
        bloomStrength: 0, temporalAA: true, temporalUpsampling: true, temporalMotion: false, renderScale: 0.5,
      });
      const sceneTargets = new Set();
      let nativeTarget;
      let firstReducedTarget;
      let firstReducedPixels;
      for (const scale of [0.5, 1, 0.5, 1, 0.5, 1, 0.5]) {
        post.setState({ renderScale: scale });
        frame();
        const { target, depthTexture, width: w, height: h } = post.getMainTarget();
        if (!depthTexture || w !== width * scale || h !== height * scale) {
          throw new Error('Scene color and depth dimensions did not follow the internal render scale');
        }
        sceneTargets.add(target);
        if (scale === 1) nativeTarget = target;
        else {
          firstReducedTarget ??= target;
          firstReducedPixels ??= readPixels();
        }
      }
      const lastReducedPixels = readPixels();
      const nativeRetainedDuringGrace = post.getRenderTargets().includes(nativeTarget);
      for (let i = 0; i < 5; i++) frame();
      const scene = {
        distinctTargets: sceneTargets.size,
        reducedPixelDifference: difference(firstReducedPixels, lastReducedPixels),
        reducedPixelFingerprint: fingerprint(lastReducedPixels),
        nativeRetainedDuringGrace,
        nativeEvicted: !post.getRenderTargets().includes(nativeTarget),
        reducedReused: post.getMainTarget().target === firstReducedTarget,
      };
      post.setState({ temporalAA: false });
      post.setPreset({ msaaSamples: 4, bloom: false, ssao: false, volumetricSteps: 0, fxaa: false, sharpen: 0 });
      const probeTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
      const probeGeometry = new THREE.PlaneGeometry(2, 2);
      const probeMaterial = new THREE.ShaderMaterial({
        depthTest: false,
        uniforms: { sceneDepth: { value: null } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D sceneDepth;
          void main() { gl_FragColor = vec4(vec3(texture2D(sceneDepth, vec2(0.5)).r), 1.0); }
        `,
      });
      const probeScene = new THREE.Scene();
      const probeMesh = new THREE.Mesh(probeGeometry, probeMaterial);
      probeMesh.frustumCulled = false;
      probeScene.add(probeMesh);
      const depth = new Uint8Array(4);
      const samples = post.getMainTarget().target.samples;
      try {
        post.render(world, camera, { extraPasses: { afterWorld: [{
          id: 'depth-probe',
          reads: ['sceneDepth'],
          execute({ state }) {
            const previousTarget = renderer.getRenderTarget();
            probeMaterial.uniforms.sceneDepth.value = state.sceneRT.depthTexture;
            try {
              renderer.setRenderTarget(probeTarget);
              renderer.render(probeScene, camera);
              renderer.readRenderTargetPixels(probeTarget, 0, 0, 1, 1, depth);
            } finally {
              renderer.setRenderTarget(previousTarget);
            }
          },
        }] } });
      } finally {
        probeGeometry.dispose();
        probeMaterial.dispose();
        probeTarget.dispose();
      }
      return {
        on, idle, off, recovered, bloomPixelDifference: difference(onPixels, offPixels),
        onPixelFingerprint: fingerprint(onPixels), offPixelFingerprint: fingerprint(offPixels),
        recoveryPixelDifference: difference(onPixels, recoveredPixels),
        executed, scene, msaa: { samples, depthByte: depth[0] },
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
  const decals = await page.evaluate(async () => {
    const THREE = await import('/assets/optional/three/three.module.js');
    const { Scene } = await import('/assets/runtime/core/scene.js');
    const { createThreeAdapter } = await import('/assets/runtime/integrations/three.js');
    const width = 320;
    const height = 240;
    const adapter = createThreeAdapter({
      THREE, canvas: document.createElement('canvas'), width, height,
      cameraPosition: [0, 5, 4], gpuIndirect: false, post3d: { bloomStrength: 0, filmGrain: 0 },
    });
    const { renderer, postPipeline, camera } = adapter;
    const gl = renderer.getContext();
    const scene = new Scene('projected-decals');
    const world = adapter.getWorld(scene);
    scene._setActive(true);
    const geometry = new THREE.PlaneGeometry(16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0x444444 });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    world.add(ground);
    postPipeline.setPreset({ msaaSamples: 4, bloom: false, ssao: false, volumetricSteps: 0, fxaa: false, sharpen: 0 });
    const sampleFrame = () => {
      adapter.render(scene);
      const read = (x) => {
        const rgba = new Uint8Array(4);
        gl.readPixels(x, height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return Array.from(rgba);
      };
      const graph = adapter.getExecutedRenderGraph();
      return {
        center: read(width / 2), outside: read(15), stages: graph.executed,
        decalColor: graph.lifetimes.decalColor, sceneTarget: graph.lifetimes.sceneTarget,
      };
    };
    try {
      const empty = sampleFrame();
      const system = adapter.createDecalSystem(scene, { mode: 'surface', maxDecals: 2 });
      system.setMode('projected');
      const worldProjection = new THREE.Matrix4();
      const decalProjection = new THREE.Matrix4();
      world.onAfterRender = (_renderer, _world, activeCamera) => worldProjection.copy(activeCamera.projectionMatrix);
      system.projectedScene.onBeforeRender = (_renderer, _scene, activeCamera) => decalProjection.copy(activeCamera.projectionMatrix);
      system.spawn({ position: [0, 0, 0], normal: [0, 1, 0], size: [3, 3, 3], color: 0xff1111, opacity: 1 });
      const projected = sampleFrame();
      const samples = postPipeline.getMainTarget().target.samples;
      postPipeline.setState({ temporalAA: true, temporalUpsampling: true, temporalMotion: false, renderScale: 0.5 });
      const originalProjection = camera.projectionMatrix.clone();
      const originalInverse = camera.projectionMatrixInverse.clone();
      const temporal = sampleFrame();
      const temporalWidth = postPipeline.getMainTarget().target.width;
      const projectionMatches = worldProjection.equals(decalProjection) && !worldProjection.equals(originalProjection);
      const projectionRestored = originalProjection.equals(camera.projectionMatrix) && originalInverse.equals(camera.projectionMatrixInverse);
      postPipeline.setState({ temporalAA: false });
      postPipeline.setPreset({ msaaSamples: 0, bloom: false, ssao: false, volumetricSteps: 0, fxaa: false, sharpen: 0 });
      const viewGeometry = new THREE.PlaneGeometry(0.3, 0.3);
      const viewMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const viewObject = new THREE.Mesh(viewGeometry, viewMaterial);
      viewObject.position.z = -1;
      adapter.setViewCamera(new THREE.PerspectiveCamera(60, width / height, 0.1, 10));
      adapter.addView(scene, viewObject);
      let viewModel;
      try {
        viewModel = sampleFrame();
      } finally {
        adapter.removeView(scene, viewObject);
        adapter.setViewCamera(null);
        viewGeometry.dispose();
        viewMaterial.dispose();
      }
      system.clear();
      const cleared = sampleFrame();
      return { empty, projected, temporal, temporalWidth, samples, projectionMatches, projectionRestored, viewModel, cleared, glError: gl.getError() };
    } finally {
      adapter.dispose();
      geometry.dispose();
      material.dispose();
    }
  });
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
  assert.equal(sample.scene.distinctTargets, 2);
  assert.equal(sample.scene.reducedPixelDifference, 0);
  assert.equal(sample.scene.nativeRetainedDuringGrace, true);
  assert.equal(sample.scene.nativeEvicted, true);
  assert.equal(sample.scene.reducedReused, true);
  assert.ok(sample.msaa.samples > 0, 'the fixture uses multisampled world depth');
  assert.ok(sample.msaa.depthByte > 0 && sample.msaa.depthByte < 255, 'the hook samples resolved scene geometry');
  console.log(JSON.stringify({ decals }));
  assert.equal(decals.samples, 4);
  assert.ok(decals.projected.center[0] > 2 * decals.projected.center[1], 'the red decal reaches the final color instead of being overwritten');
  assert.deepEqual(decals.projected.outside, decals.empty.outside, 'the decal leaves pixels outside the volume unchanged');
  assert.equal(decals.projected.decalColor.lastRead, decals.projected.stages.indexOf('tone-mapping'));
  assert.notEqual(decals.projected.decalColor.slot, decals.projected.sceneTarget.slot);
  assert.equal(Boolean(decals.projected.decalColor.spec.depthBuffer), false, 'the decal target cannot attach the sampled depth');
  assert.ok(decals.temporal.center[0] > 2 * decals.temporal.center[1], 'the decal survives temporal upsampling');
  assert.equal(decals.temporalWidth, 160);
  assert.equal(decals.temporal.sceneTarget.spec.samples, 4);
  assert.equal(decals.projectionMatches, true, 'decals use the projection that wrote the scene depth');
  assert.equal(decals.projectionRestored, true, 'the original camera projection is restored');
  const [viewRed, viewGreen, viewBlue] = decals.viewModel.center;
  assert.ok(viewGreen > Math.max(viewRed, viewBlue) + 50, 'the first-person layer stays visible above the decal');
  assert.equal(decals.empty.stages.includes('projected-decals'), false);
  assert.equal(decals.cleared.stages.includes('projected-decals'), false);
  assert.deepEqual(decals.cleared.center, decals.empty.center);
  assert.equal(decals.glError, 0);
} finally {
  await browser.close();
}

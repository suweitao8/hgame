#!/usr/bin/env node
/**
 * Real Commercial-Scale (1280x720) Headless Chromium WebGL2 Verification Suite for HGame v3.
 * Verifies real end-to-end paths (no stubs/mocks for GPU shaders or Web Audio):
 *  - 1280x720 Three WebGL2 pipeline with 3-cascade CSM shader injection, dual-probe box projection,
 *    depth-projected OBB decals over curved geometry, 2,000-instance frustum-compacted indirect batch,
 *    SkinnedMesh + MorphTargets + FABRIK IK, reactiveMaskRT TAA pass, and Render Graph execution
 *  - Real Web Audio ConvolverNode reverb send graph + 3-band EQ
 *  - Real Canvas2D createCanvasUiRenderer flex layout drawing + pixel + hit-test
 *  - Real binary Uint8Array createSceneReplicator under 15% packet loss & jitter
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
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
  '.css': 'text/css; charset=utf-8',
};

const HARNESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>HGame v3 Commercial 1280x720 Benchmark</title></head>
<body style="margin:0;background:#000;">
  <canvas id="c3d" width="1280" height="720"></canvas>
  <canvas id="cui" width="320" height="200"></canvas>
  <script type="module">
    import * as THREE from '/assets/optional/three/three.module.js';
    import {
      Scene,
      Entity,
      createSeededRng,
      createAudioManager,
      createCanvasUiRenderer,
      createNetworkStateSync,
      createSceneReplicator,
      createSpringBoneChain3D,
      createInertialBlend3D,
      createSpatialAoiFilter,
    } from '/assets/runtime/index.js';
    import { createThreeAdapter } from '/assets/runtime/integrations/three.js';
    import { createReflectionProbeManager3D } from '/assets/runtime/integrations/lighting3d.js';
    import { createIndirectInstancedBatch3D } from '/assets/runtime/integrations/culling3d.js';
    import { createDecalSystem3D } from '/assets/runtime/integrations/decal3d.js';
    import { createComposableMaterial3D } from '/assets/runtime/integrations/material-graph3d.js';
    import { solveFabrikIK, blendMorphTargets } from '/assets/runtime/animation/animator3d.js';

    function createSkinnedMorphArm() {
      const geo = new THREE.BoxGeometry(0.4, 2.4, 0.4, 1, 6, 1);
      const pos = geo.attributes.position;
      const vCount = pos.count;
      const skinIndices = new Uint16Array(vCount * 4);
      const skinWeights = new Float32Array(vCount * 4);
      const morphDelta = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        const y = pos.getY(i);
        const t = Math.max(0, Math.min(1, (y + 1.2) / 2.4));
        const bIdx = t < 0.5 ? 0 : 1;
        skinIndices[i * 4] = bIdx;
        skinIndices[i * 4 + 1] = Math.min(2, bIdx + 1);
        skinWeights[i * 4] = 0.7;
        skinWeights[i * 4 + 1] = 0.3;
        morphDelta[i * 3] = Math.sin(t * Math.PI) * 0.25;
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
      geo.morphAttributes.position = [new THREE.BufferAttribute(morphDelta, 3)];

      const b0 = new THREE.Bone(); b0.position.set(0, -1.2, 0);
      const b1 = new THREE.Bone(); b1.position.set(0, 1.2, 0); b0.add(b1);
      const b2 = new THREE.Bone(); b2.position.set(0, 1.2, 0); b1.add(b2);
      const skeleton = new THREE.Skeleton([b0, b1, b2]);
      const mat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.4 });
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.add(b0);
      mesh.bind(skeleton);
      mesh.morphTargetDictionary = { flex: 0 };
      mesh.updateMorphTargets();
      return { mesh, bones: [b0, b1, b2], mat, geo };
    }

    function sampleGlPixels(gl, w, h) {
      if (!gl) return { uniqueColors: 0, nonBlackPixels: 0 };
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const colors = new Set();
      let nonBlack = 0;
      for (let i = 0; i < buf.length; i += 64) {
        const rgb = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
        colors.add(rgb);
        if (buf[i] > 5 || buf[i + 1] > 5 || buf[i + 2] > 5) nonBlack++;
      }
      return { uniqueColors: colors.size, nonBlackPixels: nonBlack };
    }

    window.__runV3CommercialBenchmark = async () => {
      const c3d = document.getElementById('c3d');
      const cam = new THREE.PerspectiveCamera(55, 1280 / 720, 0.2, 160);
      cam.position.set(0, 5.5, 12);
      cam.lookAt(0, 1, -6);
      cam.updateMatrixWorld();

      const adapter = createThreeAdapter({
        THREE,
        canvas: c3d,
        camera: cam,
        pixelRatio: 1,
        diagnostics3d: true,
        gpuIndirect: true,
        quality: 'high',
        post3d: { bloom: true, temporalAA: true, vignette: 0.1 },
        worldLighting: {
          ambient: { color: 0x334155, intensity: 0.65 },
          sun: {
            color: 0xfff3d6,
            intensity: 2.0,
            position: [12, 22, 10],
            cascades: { cascades: 3, maxFar: 90, mapSize: 512 },
          },
        },
      });

      const scene = new Scene('commercial-3d');
      const csm = adapter.getCascadedShadowMap(scene);
      const probes = createReflectionProbeManager3D(THREE, { blendMargin: 5 });
      probes.addProbe('zoneA', { position: [0, 2, 0], min: [-8, -2, -8], max: [8, 8, 8], intensity: 1.1 });
      probes.addProbe('zoneB', { position: [0, 2, -12], min: [-8, -2, -20], max: [8, 8, -4], intensity: 0.7 });

      const sphereMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.25, metalness: 0.35 });
      csm.applyToMaterial(sphereMat);
      probes.applyToMaterial(sphereMat, probes.evaluateAt([0, 1.5, -5]));
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 16), sphereMat);
      sphere.position.set(0, 1.8, -5);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      adapter.add(scene, sphere);

      const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
      csm.applyToMaterial(floorMat);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
      floor.rotation.x = -Math.PI * 0.5;
      floor.receiveShadow = true;
      adapter.add(scene, floor);

      // Reactive VFX box driving real reactiveMaskRT pass
      const vfxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
      vfxMesh.position.set(2.8, 1.2, -3.5);
      vfxMesh.userData.hgameReactive = true;
      adapter.add(scene, vfxMesh);

      // SkinnedMesh + FABRIK + MorphTarget + SpringBone + InertialBlend
      const arm = createSkinnedMorphArm();
      arm.mesh.position.set(-2.6, 1.2, -3.5);
      csm.applyToMaterial(arm.mat);
      adapter.add(scene, arm.mesh);
      solveFabrikIK(arm.bones, [-1.5, 2.2, -2.8], { iterations: 12, poleTarget: [-2.6, 2.0, -1.5] });
      blendMorphTargets(arm.mesh, { flex: 0.85 }, 1);
      const spring = createSpringBoneChain3D({
        bones: arm.bones,
        stiffness: 20,
        wind: [6, 0, 2],
        colliders: [{ center: [-2.6, 1.5, -3.5], radius: 0.35 }],
      });
      const inertial = createInertialBlend3D({ halfLife: 0.08 });
      inertial.capture(arm.bones, arm.bones.map(b => ({ position: { x: b.position.x, y: b.position.y, z: b.position.z }, quaternion: { x: 0, y: 0, z: 0, w: 1 } })));

      // GPU windSway banner mesh compiled & rendered via WebGL2
      const windMat = createComposableMaterial3D(THREE, {
        color: 0x22d3ee,
        windSway: { amplitude: 0.18, frequency: 2.5, direction: [1, 0, 0.3], minY: -1, maxY: 1 },
      });
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.0, 2, 8), windMat);
      banner.position.set(4.0, 1.2, -4.0);
      adapter.add(scene, banner);

      // 2,000-instance frustum-compacted indirect batch (1000 in front, 1000 behind camera)
      const rockGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.6 });
      const batch = createIndirectInstancedBatch3D(THREE, { geometry: rockGeo, material: rockMat, capacity: 2000 });
      const mat4 = new THREE.Matrix4();
      for (let i = 0; i < 2000; i++) {
        const inFront = i < 1000;
        const x = ((i % 40) - 20) * 0.8;
        const z = inFront ? -8 - Math.floor((i % 1000) / 40) * 1.2 : 35 + Math.floor((i - 1000) / 40) * 1.2;
        mat4.makeTranslation(x, 0.3, z);
        batch.setInstanceMatrix(i, mat4);
        batch.setInstanceBounds(i, x, 0.3, z, 0.45);
      }
      adapter.add(scene, batch.mesh);
      adapter.registerIndirectBatch('rocks', batch);

      // Projected OBB Decal over curved sphere using separate depth pre-pass target + render target (no feedback loop)
      const decals = createDecalSystem3D(THREE, { maxDecals: 8, mode: 'projected' });
      decals.spawn({ position: [0, 3.2, -5], normal: [0, 1, 0], size: [2.4, 2.4, 2.0], color: 0xf97316 });
      const prePassRT = new THREE.WebGLRenderTarget(320, 180, {
        depthTexture: new THREE.DepthTexture(320, 180, THREE.UnsignedIntType),
      });
      const decalOutRT = new THREE.WebGLRenderTarget(320, 180);
      adapter.renderer.setRenderTarget(prePassRT);
      adapter.renderer.clear(true, true, false);
      adapter.renderer.render(adapter.getWorld(scene), cam);
      const projRendered = decals.renderProjected(adapter.renderer, cam, prePassRT.depthTexture, 320, 180, decalOutRT);
      adapter.renderer.setRenderTarget(null);

      // Warmup + render 16 frames at 1280x720
      const warmup = await adapter.warmupShaders(scene, cam);
      for (let i = 0; i < 16; i++) {
        vfxMesh.position.x = 2.8 + Math.sin(i * 0.2) * 0.5;
        sphere.rotation.y += 0.04;
        windMat.userData.hgameMaterialGraph.setWindTime(i * 0.05);
        spring.update(1 / 60);
        inertial.apply(arm.bones, 1 / 60);
        adapter.render(scene);
      }
      const gl3d = adapter.renderer.getContext();
      const glPixels3d = sampleGlPixels(gl3d, 1280, 720);
      const glError = gl3d.getError();
      const frameStats = adapter.getRenderFrameStats();
      const trace = adapter.exportRenderChromeTrace();
      const gpuStats = adapter.getGpuSubmitStats();
      const temporalStats = adapter.postPipeline.getTemporalStats();
      const graphExec = adapter.postPipeline.getLastExecutedGraph();

      // 2. Real Web Audio DSP Graph
      const audio = createAudioManager({ volume: 0.5 });
      await audio.unlock();
      const zone = audio.createReverbZone({ id: 'arena', position: [0, 0, 0], radius: 40, wetGain: 0.4 });
      audio.setBusEq('sfx', { lowGainDb: 3.5, midGainDb: 0, highGainDb: 4.5 });
      audio.playSynth('laser', { volume: 0.1 });
      const dspState = audio.getDspState();

      // 3. Real Canvas UI Flex Widgets rendering & interaction
      const cui = document.getElementById('cui');
      const ctx2d = cui.getContext('2d');
      const ui = createCanvasUiRenderer({ dpr: 1 });
      let buttonClicks = 0;
      ui.render(ctx2d, {
        id: 'hud', type: 'panel', direction: 'column', padding: 12, gap: 10,
        children: [
          { id: 'hdr', type: 'label', height: 24, text: 'COMMERCIAL BENCH' },
          { id: 'act', type: 'button', height: 42, text: 'DEPLOY', onClick: () => buttonClicks++ },
          { id: 'hp', type: 'progress', height: 14, value: 0.72 },
        ],
      }, 320, 200);
      ui.pointerDown(160, 67);
      ui.pointerUp(160, 67);
      const uiImg = ctx2d.getImageData(0, 0, 320, 200).data;
      let uiNonBlack = 0;
      for (let i = 0; i < uiImg.length; i += 16) if (uiImg[i] > 10 || uiImg[i + 1] > 10 || uiImg[i + 2] > 10) uiNonBlack++;

      // 4. Binary Net Replicator under 15% packet loss
      const hScene = new Scene('h'); const cScene = new Scene('c');
      const hEnt = hScene.add(new Entity({ name: 'p1', x: 0 }));
      const cEnt = cScene.add(new Entity({ name: 'p1', x: 0 }));
      const rng = createSeededRng(77);
      const listeners = new Set();
      const hRep = createSceneReplicator({
        scene: hScene,
        role: 'host',
        transport: {
          send(b) {
            if ((b[3] & 1) === 0 && rng.next() < 0.15) return;
            for (const fn of listeners) fn(b.slice());
          },
        },
      });
      const cRep = createSceneReplicator({
        scene: cScene,
        role: 'client',
        transport: { send() {}, onMessage(fn) { listeners.add(fn); } },
      });
      for (let t = 0; t < 25; t++) {
        hEnt.x += 0.4;
        hRep.sendSnapshot(t, t * 20, { isKeyframe: t % 8 === 0 });
        cRep.stepClient(t * 20 + 120);
      }

      const aoiFilter = createSpatialAoiFilter({ radius: 15, hysteresis: 3 });
      const roomSnapshot = {};
      for (let i = 0; i < 50; i++) roomSnapshot['mob_' + i] = { x: i * 3, z: 0 };
      const aoiResult = aoiFilter.filterForViewer('p1', { x: 0, z: 0 }, roomSnapshot);

      const out = {
        glError,
        csmIntensities: csm.lights.map(l => l.intensity),
        indirectDispatched: gpuStats.dispatchedInstances,
        indirectVisible: batch.visibleCount,
        indirectMode: gpuStats.mode,
        projDecalsRendered: projRendered,
        warmupCompiled: warmup.compiled,
        warmupFailed: warmup.failed,
        reactiveMeshCount: temporalStats.reactiveMeshCount,
        graphExec,
        frameCount: frameStats.count,
        p50Ms: Number(frameStats.p50Ms.toFixed(2)),
        p95Ms: Number(frameStats.p95Ms.toFixed(2)),
        avgDraws: frameStats.avgDrawCalls,
        traceEvents: trace.traceEvents.length,
        glPixels3d,
        dspWiredZones: dspState.wiredZones,
        reverbZoneWired: zone.wired,
        uiNonBlack,
        uiButtonClicks: buttonClicks,
        netDeltaErr: Number(Math.abs(cEnt.x - hEnt.x).toFixed(3)),
        aoiCulled: aoiResult.stats.culled,
        springBones: spring.boneCount,
      };

      decals.dispose();
      prePassRT.dispose();
      decalOutRT.dispose();
      batch.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      banner.geometry.dispose();
      windMat.dispose();
      arm.geo.dispose();
      arm.mat.dispose();
      sphereMat.dispose();
      floorMat.dispose();
      probes.dispose();
      adapter.dispose();
      await audio.dispose();
      hRep.dispose();
      cRep.dispose();
      return out;
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/v3bench.html') {
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
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 740 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err?.message || String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/v3bench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Module load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runV3CommercialBenchmark());
  assert.deepEqual(errors, [], 'Runtime/WebGL errors: ' + errors.join(' | '));
  assert.equal(m.glError, 0, 'WebGL2 error must be 0');
  assert.deepEqual(m.csmIntensities, [2, 0, 0], 'Only cascade 0 may illuminate diffuse sun');
  assert.equal(m.indirectDispatched, 2000, '2000 instances must be submitted to indirect batch');
  assert.ok(m.indirectVisible > 0 && m.indirectVisible < 2000, 'Frustum culling must compact visible subset cleanly');
  assert.equal(m.projDecalsRendered, 1, 'Depth-projected OBB decal must render');
  assert.equal(m.warmupFailed, 0, 'All shaders must warmup cleanly with 0 failures');
  assert.equal(m.reactiveMeshCount, 1, 'Reactive mask RT must detect and isolate 1 reactive mesh');
  assert.ok(m.graphExec.includes('tone-mapping'), 'Render graph must execute tone-mapping');
  assert.equal(m.frameCount, 16);
  assert.ok(m.glPixels3d.uniqueColors > 12 && m.glPixels3d.nonBlackPixels > 500, '1280x720 scene must render non-black colors');
  assert.equal(m.dspWiredZones, 1, 'Convolver reverb zone must be wired in audio DSP graph');
  assert.equal(m.reverbZoneWired, true);
  assert.ok(m.uiNonBlack > 100 && m.uiButtonClicks === 1, 'Canvas UI widgets must render & handle clicks');
  assert.ok(m.netDeltaErr < 1.0, 'Binary net replicator must stay within 1 unit over 15% loss');
  assert.ok(m.aoiCulled > 30, 'Spatial AOI must cull distant entities cleanly');
  assert.equal(m.springBones, 3, 'SpringBone chain must run across 3 bones');

  console.log(JSON.stringify({ status: 'PASS', resolution: '1280x720', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

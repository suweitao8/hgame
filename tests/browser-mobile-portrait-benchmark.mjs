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
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: #020617; width: 390px; height: 844px; }
    #c3d { display: block; width: 390px; height: 844px; }
    #c2d { position: fixed; left: 0; top: 0; width: 390px; height: 844px; touch-action: none; }
  </style>
</head>
<body>
  <canvas id="c3d" width="390" height="844"></canvas>
  <canvas id="c2d" width="390" height="844"></canvas>
  <script type="module">
    import * as THREE from '/assets/optional/three/three.module.js';
    import {
      Scene,
      DEFAULT_THUMB_ARC_SPEC,
      computeThumbArcLayout,
      isInThumbComfortZone,
      createThumbArcHud,
      createColorLutTexture3D,
      detectCompressedTextureSupport,
      createShadowAtlas3D,
      createSkeleton2D,
      createVramMipGuard,
      mergeStaticMeshesByMaterial3D,
      createHiZOcclusionCuller3D,
      createPhysicalRenderTargetPool3D,
      quantizeBufferGeometry3D,
      captureResourceSnapshot,
      diffResourceSnapshots,
    } from '/assets/runtime/index.js';
    import { createThreeAdapter } from '/assets/runtime/integrations/three.js';
    import { compileRenderGraph, executeRenderGraph } from '/assets/runtime/integrations/post3d/render-graph.js';
    import { createInstancedFoliage3D } from '/assets/runtime/integrations/foliage3d.js';
    import { createMaterialBatchRegistry3D, createComposableMaterial3D } from '/assets/runtime/integrations/material-graph3d.js';
    import { MOBILE_PORTRAIT_PRESET, resolvePortraitViewport, createPortraitDrsController } from '/assets/runtime/integrations/quality3d.js';
    import { createDecalSystem3D } from '/assets/runtime/integrations/decal3d.js';

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

    window.__mobileState = {
      pressedActions: [],
      hud: null,
      layout: null,
    };

    window.__setupMobilePortrait = async () => {
      const portraitVp = resolvePortraitViewport({
        width: 390,
        height: 844,
        dpr: window.devicePixelRatio || 2,
        safeArea: { top: 44, bottom: 34, left: 0, right: 0 },
      });

      const c3d = document.getElementById('c3d');
      const cam = new THREE.PerspectiveCamera(58, portraitVp.cssWidth / portraitVp.cssHeight, 0.2, 120);
      cam.position.set(0, 4.8, 9.5);
      cam.lookAt(0, 0.8, -3.5);
      cam.updateMatrixWorld();

      const lutTex = createColorLutTexture3D(THREE, MOBILE_PORTRAIT_PRESET.colorLut, 16);

      const adapter = createThreeAdapter({
        THREE,
        canvas: c3d,
        width: 390,
        height: 844,
        camera: cam,
        pixelRatio: window.devicePixelRatio || 2,
        quality: MOBILE_PORTRAIT_PRESET.tier,
        renderGraph: true,
        mobilePortrait: {
          safeArea: { top: 44, bottom: 34, left: 0, right: 0 },
          colorLut: { texture: lutTex, intensity: 0.85, size: 16 },
          heightFog: { density: 0.012, color: 0x1e293b, baseHeight: 0, falloff: 0.25 },
        },
        worldLighting: {
          ambient: { color: 0x334155, intensity: 0.7 },
          sun: {
            color: 0xfff3d6,
            intensity: 2.0,
            position: [10, 20, 8],
            cascades: {
              cascades: 3,
              maxFar: 80,
              mapSize: MOBILE_PORTRAIT_PRESET.shadowMapSize,
              pcss: MOBILE_PORTRAIT_PRESET.pcss,
            },
          },
        },
      });

      const scene = new Scene('mobile-portrait-3d');
      const csm = adapter.getCascadedShadowMap(scene);

      // Static Geometry Batching: merge 24 static pillar boxes into 1 batched mesh
      const pillarGeo = new THREE.BoxGeometry(0.4, 1.2, 0.4);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
      csm.applyToMaterial(pillarMat);
      const staticProps = [];
      for (let i = 0; i < 24; i++) {
        const box = new THREE.Mesh(pillarGeo, pillarMat);
        const angle = (i / 24) * Math.PI * 2;
        box.position.set(Math.cos(angle) * 6, 0.6, -4 + Math.sin(angle) * 5);
        staticProps.push(box);
      }
      const staticMerged = mergeStaticMeshesByMaterial3D(THREE, staticProps, { disposeSources: false });
      for (const msh of staticMerged.meshes) adapter.add(scene, msh);

      const batchRegistry = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.012 }, { THREE });
      const heroMat = createComposableMaterial3D(THREE, {
        color: 0x38bdf8,
        sharedBlock: batchRegistry.sharedBlock,
        windSway: { amplitude: 0.12, frequency: 2.2, minY: -0.5, maxY: 1.5 },
        fresnelRim: { color: 0x7dd3fc, power: 2.4, strength: 0.45 },
        specularAA: true,
      });
      batchRegistry.register(heroMat);
      csm.applyToMaterial(heroMat);

      const heroMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 1.4, 2, 6, 2), heroMat);
      heroMesh.position.set(0, 1.0, -3.2);
      heroMesh.castShadow = true;
      heroMesh.receiveShadow = true;
      adapter.add(scene, heroMesh);

      const floorMat = createComposableMaterial3D(THREE, {
        color: 0x1e293b,
        sharedBlock: batchRegistry.sharedBlock,
        roughness: 0.82,
      });
      batchRegistry.register(floorMat);
      csm.applyToMaterial(floorMat);

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
      floor.rotation.x = -Math.PI * 0.5;
      floor.receiveShadow = true;
      adapter.add(scene, floor);

      const foliage = createInstancedFoliage3D(THREE, { count: 300, areaSize: 16 });
      adapter.add(scene, foliage.mesh);

      // Soft-edge projected OBB decal rendered against separate pre-pass depth target
      const decals = createDecalSystem3D(THREE, { maxDecals: 4, mode: 'projected' });
      decals.spawn({
        position: [0, 0.2, -3.2],
        normal: [0, 1, 0],
        size: [2.6, 2.6, 1.6],
        color: 0xf97316,
        edgeSoftness: 0.3,
        roughnessTint: 0.5,
      });
      const prePassRT = new THREE.WebGLRenderTarget(195, 422, {
        depthTexture: new THREE.DepthTexture(195, 422, THREE.UnsignedIntType),
      });
      const decalOutRT = new THREE.WebGLRenderTarget(195, 422);
      adapter.renderer.setRenderTarget(prePassRT);
      adapter.renderer.clear(true, true, false);
      adapter.renderer.render(adapter.getWorld(scene), cam);
      const projDecalsRendered = decals.renderProjected(adapter.renderer, cam, prePassRT.depthTexture, 195, 422, decalOutRT);
      adapter.renderer.setRenderTarget(null);
      const decalStats = decals.getStats();

      const warmup = adapter.warmupShaders(scene, cam);

      // Step 8 portrait frames driving batch uniforms, foliage wind, and RenderGraph DAG
      for (let f = 0; f < 8; f++) {
        batchRegistry.updateFrame(0.016);
        foliage.update(f * 0.016, 1.1);
        heroMesh.rotation.y += 0.06;
        adapter.render(scene, cam);
      }

      const gl = adapter.renderer.getContext();
      const shadowAtlas = createShadowAtlas3D(THREE, { atlasSize: 1024, tileSize: 256 });
      const spotCam = new THREE.PerspectiveCamera(60, 1, 0.5, 40);
      spotCam.position.set(4, 6, 4);
      spotCam.lookAt(0, 0.8, -3.2);
      spotCam.updateMatrixWorld();
      shadowAtlas.allocateTile('spot_l');
      shadowAtlas.allocateTile('spot_r');
      shadowAtlas.renderTile(adapter.renderer, adapter.getWorld(scene), spotCam, 'spot_l');
      shadowAtlas.renderTile(adapter.renderer, adapter.getWorld(scene), spotCam, 'spot_r');
      const atlasStats = shadowAtlas.getStats();

      const glErrPre = gl.getError();

      // Physical RenderTarget transient aliasing across 2-frame RenderGraph passes
      const rtPool = createPhysicalRenderTargetPool3D(THREE, { maxIdleFrames: 4 });
      const poolGraph = compileRenderGraph([
        {
          id: 'p1',
          writes: ['tA'],
          transientResources: { tA: { width: 256, height: 512 } },
          execute() {},
        },
        {
          id: 'p2',
          reads: ['tA'],
          writes: ['tB'],
          transientResources: { tB: { width: 256, height: 512 } },
          execute() {},
        },
        {
          id: 'p3',
          reads: ['tB'],
          execute() {},
        },
      ]);
      rtPool.beginFrame();
      executeRenderGraph(poolGraph, rtPool);
      rtPool.beginFrame();
      executeRenderGraph(poolGraph, rtPool);
      const rtPoolStats = rtPool.getStats();
      rtPool.dispose();

      // Vertex attribute quantization & Uint16 index compaction on live SphereGeometry
      const rawSphere = new THREE.SphereGeometry(0.6, 24, 18);
      const quantResult = quantizeBufferGeometry3D(THREE, rawSphere);
      const qMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 });
      const qMesh = new THREE.Mesh(quantResult.geometry, qMat);
      qMesh.position.set(0.8, 0.7, 0);
      adapter.getWorld(scene).add(qMesh);
      adapter.renderer.render(adapter.getWorld(scene), cam);
      adapter.getWorld(scene).remove(qMesh);
      rawSphere.dispose();
      quantResult.geometry.dispose();
      qMat.dispose();

      // Resource leak snapshot & diff verification
      const snap0 = captureResourceSnapshot(adapter.getWorld(scene), { label: 'base', THREE });
      const leakGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      const leakMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const leakMesh = new THREE.Mesh(leakGeo, leakMat);
      adapter.getWorld(scene).add(leakMesh);
      const snapLeaked = captureResourceSnapshot(adapter.getWorld(scene), { label: 'leaked', THREE });
      const leakDetectedDiff = diffResourceSnapshots(snap0, snapLeaked);
      adapter.getWorld(scene).remove(leakMesh);
      leakGeo.dispose();
      leakMat.dispose();
      const snapCleaned = captureResourceSnapshot(adapter.getWorld(scene), { label: 'clean', THREE });
      const leakCleanedDiff = diffResourceSnapshots(snap0, snapCleaned);

      const vramGuard = createVramMipGuard({ budgetBytes: 1024 * 1024 });
      const vramHard = vramGuard.step(960 * 1024);
      const vramRecovered = vramGuard.step(400 * 1024);

      const hizCuller = createHiZOcclusionCuller3D({ width: 64, height: 64 });
      const depthBuf = new Float32Array(64 * 64).fill(0.95);
      for (let y = 13; y <= 51; y++) {
        for (let x = 13; x <= 38; x++) depthBuf[y * 64 + x] = 0.25;
      }
      hizCuller.buildPyramid(depthBuf);
      const hiZCulledBehind = hizCuller.testScreenBounds(0.3, 0.35, 0.45, 0.65, 0.55) === false;
      const hiZVisibleAside = hizCuller.testScreenBounds(0.7, 0.35, 0.85, 0.6, 0.55) === true;

      const glError = gl.getError();
      const glPixels = sampleGlPixels(gl, c3d.width, c3d.height);
      const executedGraph = adapter.getExecutedRenderGraph();
      const vram = adapter.measureVram(scene);
      const mpStepRes = adapter.mobilePortrait.stepFrameBudget(16.6, vram.totalBytes || 4096);
      const batchStats = batchRegistry.getStats();
      const compressedSupport = detectCompressedTextureSupport(gl);

      const drs = createPortraitDrsController({ width: 390, height: 844, dpr: 2, windowFrames: 8 });
      let drsDropped = false;
      let drsRecovered = false;
      for (let i = 0; i < 16; i++) {
        const res = drs.sample(24.0);
        if (res.changed && res.scale < 1.0) drsDropped = true;
      }
      const drsDegradedScale = drs.getState().scale;
      for (let i = 0; i < 32; i++) {
        const res = drs.sample(11.0);
        if (res.changed && res.scale > drsDegradedScale) drsRecovered = true;
      }

      // Portrait Bottom-Right Semi-Arc Thumb HUD overlay + 2D Skeleton preview
      const c2d = document.getElementById('c2d');
      const ctx2d = c2d.getContext('2d');
      const skel2d = createSkeleton2D({
        bones: [
          { id: 'hip', x: 70, y: 740, angle: -Math.PI * 0.5, length: 28 },
          { id: 'upperArm', parent: 'hip', x: 28, y: 0, angle: 0.4, length: 26 },
          { id: 'foreArm', parent: 'upperArm', x: 26, y: 0, angle: 0.3, length: 22 },
        ],
        slots: [
          { id: 'arm', bone: 'upperArm', width: 26, height: 6, color: '#38bdf8' },
          { id: 'fore', bone: 'foreArm', width: 22, height: 5, color: '#facc15' },
        ],
      });
      skel2d.solveTwoBoneIk2D('upperArm', 'foreArm', 105, 695, 1);
      const skelSlots = skel2d.getRenderSlots();
      for (let i = 0; i < skelSlots.length; i++) {
        const s = skelSlots[i];
        ctx2d.strokeStyle = s.color;
        ctx2d.lineWidth = s.height;
        ctx2d.beginPath();
        ctx2d.moveTo(s.x, s.y);
        ctx2d.lineTo(s.tipX, s.tipY);
        ctx2d.stroke();
      }

      const actionItems = [
        { id: 'atk', label: 'Atk', icon: 'A', primary: true },
        { id: 'dash', label: 'Dash', icon: 'D', cooldownRatio: 0.25 },
        { id: 's1', label: 'S1', icon: '1' },
        { id: 's2', label: 'S2', icon: '2' },
        { id: 'ult', label: 'Ult', icon: 'U' },
      ];
      const hud = createThumbArcHud({
        items: actionItems,
        safeArea: portraitVp.safeArea,
        onAction(id) {
          window.__mobileState.pressedActions.push(id);
        },
      });
      c2d.addEventListener('pointerdown', (e) => {
        const rect = c2d.getBoundingClientRect();
        hud.pointerDown(e.clientX - rect.left, e.clientY - rect.top);
      });
      c2d.addEventListener('pointerup', (e) => {
        const rect = c2d.getBoundingClientRect();
        hud.pointerUp(e.clientX - rect.left, e.clientY - rect.top);
        ctx2d.clearRect(0, 0, c2d.width, c2d.height);
        hud.render(ctx2d, portraitVp.cssWidth, portraitVp.cssHeight);
      });

      const layout = hud.render(ctx2d, portraitVp.cssWidth, portraitVp.cssHeight);
      const directLayout = computeThumbArcLayout({
        viewportWidth: portraitVp.cssWidth,
        viewportHeight: portraitVp.cssHeight,
        items: actionItems,
        safeArea: portraitVp.safeArea,
      });

      window.__mobileState.hud = hud;
      window.__mobileState.layout = layout;
      shadowAtlas.dispose();

      const comfortBoundaryY = portraitVp.cssHeight * 0.52;
      const allInLowerHalf = layout.items.every((b) => b.cy >= comfortBoundaryY && isInThumbComfortZone({ x: b.cx, y: b.cy }, { width: portraitVp.cssWidth, height: portraitVp.cssHeight }).inLowerHalf);
      const minBtnSize = Math.min(...layout.items.map((b) => b.size));

      return {
        portraitVp,
        defaultSpecMinSize: DEFAULT_THUMB_ARC_SPEC.minButtonSize,
        glError,
        warmupFailed: warmup.failed || 0,
        executedGraph,
        glPixels,
        vramBytes: vram.totalBytes || vram.bytes || 0,
        foliageCount: foliage.count,
        projDecalsRendered,
        decalActive: decalStats.active,
        batchRegisteredMaterials: batchStats.registeredCount,
        uboEnabled: batchStats.uboEnabled,
        lutEnabled: Boolean(lutTex && lutTex.isDataTexture),
        atlasRenderedTiles: atlasStats.renderedTiles,
        glErrPre,
        rtPoolAllocations: rtPoolStats.allocations,
        rtPoolReuses: rtPoolStats.reuses,
        rtPoolSavedBytes: rtPoolStats.estimatedSavedBytes,
        quantizedReductionPct: quantResult.stats.reductionPct,
        leakDetected: leakDetectedDiff.hasLeak && leakDetectedDiff.leakedCount >= 2,
        leakCleaned: !leakCleanedDiff.hasLeak && leakCleanedDiff.leakedCount === 0,
        skel2dSlots: skelSlots.length,
        vramGuardOk: vramHard.mipBiasOffset === 2 && vramRecovered.mipBiasOffset === 0,
        turnkeyPortraitEnabled: Boolean(adapter.mobilePortrait?.enabled && mpStepRes?.drs && mpStepRes?.vram),
        staticInputCount: staticMerged.stats.inputMeshes,
        staticBatchCount: staticMerged.stats.outputBatches,
        hiZCullerOk: hiZCulledBehind && hiZVisibleAside,
        compressedSupport,
        drsDropped,
        drsRecovered,
        allInLowerHalf,
        directAllInLowerHalf: directLayout.allInLowerHalf,
        minBtnSize,
        buttons: layout.items.map((b) => ({ id: b.id, cx: Math.round(b.cx), cy: Math.round(b.cy), size: b.size, ring: b.ring })),
      };
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname === '/mobilebench.html') {
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err?.message || String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/mobilebench.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Module load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__setupMobilePortrait());
  assert.deepEqual(errors, [], 'Runtime/WebGL errors: ' + errors.join(' | '));
  assert.equal(m.glError, 0, `WebGL2 error must be 0 (pre=${m.glErrPre}, final=${m.glError})`);
  assert.equal(m.warmupFailed, 0, 'Shader warmup must succeed cleanly');
  assert.ok(m.executedGraph && m.executedGraph.executed.includes('world'), 'RenderGraph must execute world');
  assert.ok(m.executedGraph.executed.includes('tone-mapping'), 'RenderGraph must execute tone-mapping');
  assert.ok(m.glPixels.uniqueColors > 20 && m.glPixels.nonBlackPixels > 500, '390x844 portrait scene must render non-black pixels');
  assert.ok(m.vramBytes > 0, 'VRAM ledger must report active scene bytes');
  assert.equal(m.foliageCount, 300, 'Portrait foliage field must populate 300 blades');
  assert.equal(m.projDecalsRendered, 1, 'Projected soft-edge decal must render');
  assert.equal(m.decalActive, 1, 'Active decal count must be 1');
  assert.equal(m.batchRegisteredMaterials, 2, 'Material batch registry must track 2 materials');
  assert.equal(m.uboEnabled, true, 'WebGL2 UniformsGroup UBO batching must be active');
  assert.equal(m.lutEnabled, true, '3D strip Color LUT DataTexture must be bound');
  assert.equal(m.atlasRenderedTiles, 2, 'ShadowAtlas3D must render 2 local light tiles into single atlas');
  assert.ok(m.rtPoolReuses >= 2 && m.rtPoolSavedBytes > 0, 'RenderTarget pool must alias & reuse transient targets');
  assert.ok(m.quantizedReductionPct > 20, 'quantizeBufferGeometry3D must save >20% vertex/index bytes');
  assert.equal(m.leakDetected, true, 'captureResourceSnapshot + diff must detect temporary leaks');
  assert.equal(m.leakCleaned, true, 'captureResourceSnapshot + diff must confirm zero leaks after cleanup');
  assert.equal(m.skel2dSlots, 2, 'Skeleton2D must resolve 2 render slots after 2-bone IK');
  assert.equal(m.vramGuardOk, true, 'VramMipGuard must escalate & recover cleanly');
  assert.equal(m.turnkeyPortraitEnabled, true, 'Turnkey mobilePortrait adapter preset must wire DRS + VRAM guard');
  assert.equal(m.staticInputCount, 24, 'Static batcher must accept 24 input meshes');
  assert.equal(m.staticBatchCount, 1, 'Static batcher must merge 24 meshes into 1 draw call');
  assert.equal(m.hiZCullerOk, true, 'Hi-Z depth pyramid culler must cull occluded behind-wall targets');
  assert.ok(m.compressedSupport && typeof m.compressedSupport.preferred === 'string' && m.compressedSupport.preferred.length > 0, 'Compressed texture probing must report preferred format');
  assert.equal(m.drsDropped, true, 'Portrait DRS controller must scale down under overload');
  assert.equal(m.drsRecovered, true, 'Portrait DRS controller must recover under healthy frame times');
  assert.equal(m.portraitVp.orientation, 'portrait');
  assert.equal(m.allInLowerHalf, true, 'All thumb-arc buttons must lie in cy >= 0.52 * viewportHeight');
  assert.equal(m.directAllInLowerHalf, true);
  assert.ok(m.minBtnSize >= 48, 'All thumb buttons must be >= 48px');

  // Perform real Playwright pointer clicks inside lower-half thumb comfort arc for 'atk' & 'dash'
  const atkBtn = m.buttons.find(b => b.id === 'atk');
  const dashBtn = m.buttons.find(b => b.id === 'dash');
  assert.ok(atkBtn && dashBtn, 'atk and dash buttons must exist in thumb layout');
  await page.mouse.click(atkBtn.cx, atkBtn.cy);
  await page.mouse.click(dashBtn.cx, dashBtn.cy);

  const pressedActions = await page.evaluate(() => window.__mobileState.pressedActions);
  assert.deepEqual(errors, [], 'Pointer interaction errors: ' + errors.join(' | '));
  assert.deepEqual(pressedActions, ['atk', 'dash'], 'Real pointer clicks on bottom-right thumb arc must fire atk and dash');

  console.log(JSON.stringify({
    status: 'PASS',
    viewport: '390x844',
    dpr: 2,
    metrics: {
      ...m,
      pressedActions,
    },
  }, null, 2));
} finally {
  await browser?.close();
  server.close();
}

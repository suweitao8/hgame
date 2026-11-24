import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  Scene,
  Entity,
  createGameApplication,
  createSwarmSimulation,
  createLiveProfilerOverlay,
} from '../assets/runtime/index.js';
import { createVramLedger3D } from '../assets/runtime/integrations/quality3d/render-diagnostics.js';
import { createShaderWarmupQueue3D } from '../assets/runtime/integrations/quality3d/shader-warmup.js';

test('P3 createVramLedger3D counts deduplicated textures/geometries/RTs and fires pressure events', () => {
  const pressureAlerts = [];
  const ledger = createVramLedger3D(THREE, {
    softLimitMB: 0.5,
    hardLimitMB: 1.5,
    onPressure: r => pressureAlerts.push(r.pressure),
  });

  const tex = new THREE.DataTexture(new Uint8Array(512 * 512 * 4), 512, 512);
  tex.generateMipmaps = false; // 1MB exact
  const mat1 = new THREE.MeshStandardMaterial({ map: tex });
  const mat2 = new THREE.MeshStandardMaterial({ map: tex }); // shared texture deduplication!
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo, mat1));
  root.add(new THREE.Mesh(geo, mat2));
  const rt = new THREE.WebGLRenderTarget(512, 256);

  const report = ledger.scan({ roots: [root], targets: [rt] });
  assert.equal(report.textureCount, 1);
  assert.equal(report.geometryCount, 1);
  assert.equal(report.targetCount, 1);
  assert.ok(report.textureBytes >= 512 * 512 * 4);
  assert.ok(report.totalMB >= 1.5);
  assert.equal(report.pressure, 'hard');
  assert.deepEqual(pressureAlerts, ['hard']);

  rt.dispose();
  tex.dispose();
  mat1.dispose();
  mat2.dispose();
  geo.dispose();
});

test('VRAM estimates include cube maps, volume textures and shared render attachments once', () => {
  const ledger = createVramLedger3D(THREE);
  const scene = new THREE.Scene();
  const texture = new THREE.Data3DTexture(new Uint8Array(256), 4, 4, 4);
  const background = new THREE.CubeTexture(Array.from({ length: 6 }, () => ({ width: 4, height: 4 })));
  background.generateMipmaps = false;
  const shadow = new THREE.WebGLRenderTarget(64, 64);
  const light = new THREE.DirectionalLight();
  light.shadow.map = shadow;
  scene.background = background;
  scene.environment = texture;
  const material = new THREE.ShaderMaterial({ uniforms: { diffuse: { value: texture }, shadow: { value: shadow.texture } } });
  scene.add(light, new THREE.Mesh(new THREE.BoxGeometry(), material));
  const report = ledger.scan({ roots: [scene] });
  assert.equal(report.textureCount, 2);
  assert.equal(report.textureBytes, 256 + 384);
  assert.equal(report.targetCount, 1);
  assert.equal(report.targetBytes, 64 * 64 * 8);
  assert.equal(ledger.scan({ roots: [scene], targets: [shadow] }).targetCount, 1);
  const mrt = new THREE.WebGLRenderTarget(64, 64, { count: 2, depthBuffer: false });
  material.uniforms.attachment = { value: mrt.textures[1] };
  const multi = ledger.scan({ roots: [scene], targets: [mrt] });
  assert.equal(multi.textureCount, 2);
  assert.equal(multi.targetBytes, report.targetBytes + 64 * 64 * 8);
});

test('P3 createShaderWarmupQueue3D slices warmup within per-frame ms budget', () => {
  let simClockMs = 0;
  const compiled = [];
  const mockRenderer = {
    compile(obj) {
      compiled.push(obj.material.id ?? obj.material.uuid);
      simClockMs += 5; // Each compile costs 5ms
    },
  };
  const q = createShaderWarmupQueue3D(THREE, mockRenderer, {
    budgetMsPerFrame: 4,
    now: () => simClockMs,
  });
  const m1 = new THREE.MeshStandardMaterial();
  const m2 = new THREE.MeshStandardMaterial();
  const m3 = new THREE.MeshStandardMaterial();
  const cam = new THREE.PerspectiveCamera();
  assert.equal(q.enqueueMaterials([m1, m2, m3], cam), 3);

  const s1 = q.stepWarmupBudget(4);
  assert.equal(s1.compiled, 1);
  assert.equal(s1.remaining, 2);
  assert.equal(s1.done, false);

  const s2 = q.stepWarmupBudget(4);
  assert.equal(s2.compiled, 1);
  assert.equal(s2.remaining, 1);
  assert.equal(q.getStats().compiled, 2);

  const s3 = q.stepWarmupBudget(4);
  assert.equal(s3.compiled, 1);
  assert.equal(s3.done, true);
  assert.equal(q.getStats().compiled, 3);
  assert.equal(compiled.length, 3);
  m1.dispose(); m2.dispose(); m3.dispose();
  q.dispose();
});

test('P4 createLiveProfilerOverlay tracks P95/GC spikes and renders HUD sparkline', () => {
  const overlay = createLiveProfilerOverlay({ width: 220, height: 96, maxSamples: 30, budgetMs: 16.67 });
  for (let i = 0; i < 27; i++) {
    overlay.recordSample({ frameMs: 4 + (i % 5), drawCalls: 14, vramMB: 42.5 });
  }
  overlay.recordSample({ frameMs: 42, drawCalls: 18, vramMB: 42.5 });
  overlay.recordSample({ frameMs: 45, drawCalls: 18, vramMB: 42.5 });
  overlay.recordSample({ frameMs: 45, drawCalls: 18, vramMB: 42.5 });

  const fillCalls = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    save() {},
    restore() {},
    fillRect(x, y, w, h) { fillCalls.push([x, y, w, h]); },
    strokeRect() {},
    fillText() {},
  };
  const stats = overlay.render(ctx, 8, 8);
  assert.equal(stats.samples, 30);
  assert.equal(stats.gcSpikes, 3);
  assert.equal(stats.p95Ms, 42);
  assert.equal(stats.maxMs, 45);
  assert.equal(stats.drawCalls, 18);
  assert.ok(fillCalls.length >= 31); // 1 background + 30 bars
});

test('P4 60-second (3,600-tick @ 60Hz) deterministic soak test keeps bounded memory and zero NaN', () => {
  const app = createGameApplication({
    fixedStep: 1 / 60,
    renderer: { render() {} },
  });
  const scene = new Scene('soak');
  const player = scene.add(new Entity({ name: 'hero', x: 0, y: 0 }));
  const swarm = createSwarmSimulation({ capacity: 512, ecsSlots: 128 });
  for (let i = 0; i < 120; i++) {
    swarm.spawn({ x: (i % 12) * 3 - 18, y: Math.floor(i / 12) * 3 + 12, speed: 4, hp: 50 });
  }
  scene.fixedUpdate = dt => {
    player.x += Math.cos(player.y * 0.1) * dt * 2;
    player.y += Math.sin(player.x * 0.1) * dt * 2;
    swarm.step(dt, { heroX: player.x, heroY: player.y });
  };
  app.scenes.add(scene);
  app.scenes.start('soak');

  for (let tick = 0; tick < 3600; tick++) {
    app.step(1 / 60);
    if (tick % 120 === 0) {
      assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
      assert.equal(swarm.count, 120);
      assert.equal(scene.objects.length, 1);
    }
  }
  assert.equal(app.stats.ticks, 3600);
  app.dispose();
});

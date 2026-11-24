// Scorecard R2 evidence: CSM splits / texel-snapped frustum fit / shadow atlas / reflection-probe blend /
// baked lightmap wiring / lightmap UV2 chart packing. Headless (real THREE math, no GL context).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  computeCascadeSplits, fitDirectionalShadowFrustum, createCascadedShadowMap3D, createShadowAtlas3D,
} from '../assets/runtime/integrations/shadow3d.js';
import { createReflectionProbeManager3D, applyBakedLightmap3D } from '../assets/runtime/integrations/lighting3d.js';
import { generateLightmapUV3D } from '../assets/runtime/integrations/lightmap-bake3d.js';

test('R2 CSM: practical split scheme is monotonic, hits near/far, and lambda blends uniform<->log', () => {
  const s = computeCascadeSplits(0.1, 100, 4, 0.65);
  assert.equal(s.length, 5);
  assert.equal(s[0], 0.1);
  assert.equal(s[4], 100);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
  const uni = computeCascadeSplits(1, 101, 4, 0);
  assert.deepEqual(uni.map(v => Math.round(v * 1e6) / 1e6), [1, 26, 51, 76, 101]);
  const log = computeCascadeSplits(1, 100, 2, 1);
  assert.ok(Math.abs(log[1] - 10) < 1e-9);
  // cascade count clamped to 1..4
  assert.equal(computeCascadeSplits(0.1, 50, 9).length, 5);
  assert.equal(computeCascadeSplits(0.1, 50, 0).length, 2);
  // log-heavy blend puts more resolution near the camera than uniform
  const uni100 = computeCascadeSplits(0.1, 100, 4, 0);
  assert.ok(s[1] < uni100[1]);
});

test('R2 CSM: update() fits one growing frustum per cascade and sets per-cascade shadow state', () => {
  const csm = createCascadedShadowMap3D(THREE, { cascades: 3, maxFar: 90, mapSize: 1024, shadowBias: -0.0004, normalBias: 0.02 });
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.position.set(10, 5, 20);
  cam.updateMatrixWorld(true);
  const { splits, frustums } = csm.update(cam);
  assert.equal(frustums.length, 3);
  assert.equal(splits[3], 90, 'far clamped to maxFar');
  const widths = frustums.map(f => f.right - f.left);
  assert.ok(widths[0] < widths[1] && widths[1] < widths[2]);
  for (const light of csm.lights) {
    assert.equal(light.shadow.bias, -0.0004);
    assert.equal(light.shadow.normalBias, 0.02);
    assert.equal(light.shadow.mapSize.x, 1024);
  }
  assert.equal(csm.lights[1].intensity, 0); // only cascade 0 contributes lighting
  csm.dispose();
});

test('R2 CSM: texel snapping keeps the shadow-map grid world-stable under sub-texel camera motion', () => {
  const mk = () => {
    const l = new THREE.DirectionalLight(0xffffff, 1);
    l.shadow.mapSize.set(1024, 1024);
    return l;
  };
  const sun = [0.3, 0.8, 0.5];
  const fit = (light, dx, snap) => fitDirectionalShadowFrustum(THREE, light, { center: [dx, 0, 0], radius: 20 }, {
    sunDirection: sun, distance: 60, padding: 0, snapToTexels: snap,
  });
  // light-space right axis (same construction as the fit)
  const back = new THREE.Vector3(...sun).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const worldCenterU = (light, f) => (f.left + f.right) / 2 + light.position.dot(right);

  const results = [0, 0.001, 0.002].map(dx => {
    const l = mk();
    const f = fit(l, dx, true);
    return { l, f };
  });
  const texel = (results[0].f.right - results[0].f.left) / 1024;
  for (const { l, f } of results) {
    const c = worldCenterU(l, f) / texel;
    assert.ok(Math.abs(c - Math.round(c)) < 1e-6, `center not on texel lattice: ${c}`);
  }
  // sub-texel motion -> identical world-space window; unsnapped drifts
  const cs = results.map(r => worldCenterU(r.l, r.f));
  assert.ok(Math.abs(cs[0] - cs[1]) < 1e-9 && Math.abs(cs[1] - cs[2]) < 1e-9);
  const raw = [0, 0.002].map(dx => { const l = mk(); return worldCenterU(l, fit(l, dx, false)); });
  assert.ok(Math.abs(raw[0] - raw[1]) > 1e-4);
  // snapped window always contains the unsnapped one (no cropping)
  const l0 = mk(); const snapped = fit(l0, 0.0007, true);
  const l1 = mk(); const exact = fit(l1, 0.0007, false);
  assert.ok(snapped.right - snapped.left >= exact.right - exact.left);
  assert.throws(() => fitDirectionalShadowFrustum(THREE, mk(), {}, {}), TypeError);
});

test('R2 Shadow Atlas: tile grid allocation, UV rects, reuse and exhaustion', () => {
  const atlas = createShadowAtlas3D(null, { atlasSize: 1024, tileSize: 256 });
  assert.equal(atlas.getStats().capacity, 16);
  const a = atlas.allocateTile('spotA');
  const b = atlas.allocateTile('spotB');
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 256, 0]);
  assert.deepEqual([...b.uvRect], [0.25, 0, 0.25, 0.25]);
  assert.equal(atlas.allocateTile('spotA'), a, 'same light id re-uses its tile');
  assert.equal(atlas.releaseTile('spotA'), true);
  assert.equal(atlas.getTileUvRect('spotA'), null);
  assert.equal(atlas.allocateTile('spotC').index, 0, 'freed slot is recycled');
  for (let i = 0; i < 14; i++) assert.ok(atlas.allocateTile(`l${i}`));
  assert.equal(atlas.getStats().allocated, 16);
  assert.equal(atlas.allocateTile('overflow'), null);
  // row wrap
  assert.equal(atlas.allocateTile('spotB').row, 0);
  assert.equal(atlas.getTileUvRect('l1')[1] >= 0, true);
});

test('R2 Shadow Atlas: renderTile sets scissor/viewport to the tile and restores renderer state', () => {
  const atlas = createShadowAtlas3D(null, { atlasSize: 512, tileSize: 256 });
  const calls = [];
  const renderer = {
    autoClear: true,
    getRenderTarget: () => 'prev', getScissorTest: () => false,
    setRenderTarget: t => calls.push(['target', t]),
    setScissorTest: v => calls.push(['scissorTest', v]),
    setScissor: (...a) => calls.push(['scissor', ...a]),
    setViewport: (...a) => calls.push(['viewport', ...a]),
    clearDepth: () => calls.push(['clearDepth']),
    render: () => calls.push(['render']),
  };
  atlas.allocateTile('x');
  const rec = atlas.renderTile(renderer, {}, {}, 'y');
  assert.equal(rec.index, 1);
  assert.deepEqual(calls.find(c => c[0] === 'scissor'), ['scissor', 256, 0, 256, 256]);
  assert.ok(calls.some(c => c[0] === 'render'));
  assert.equal(renderer.autoClear, true);
  assert.deepEqual(calls.at(-1), ['target', 'prev']);
  assert.equal(atlas.getStats().renderedTiles, 1);
});

test('R2 dual reflection probes: box blend across seam, priority, material application', () => {
  const rpm = createReflectionProbeManager3D(THREE, { maxProbes: 4, blendMargin: 4 });
  const envA = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const envB = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  rpm.addProbe('A', { min: [0, 0, 0], max: [10, 6, 10], envMap: envA, intensity: 1, priority: 1 });
  rpm.addProbe('B', { min: [10, 0, 0], max: [20, 6, 10], envMap: envB, intensity: 0.4, priority: 0 });
  const seam = rpm.evaluateAt([10, 2, 5]);
  assert.equal(seam.active.length, 2);
  assert.equal(seam.primary.id, 'A');
  assert.equal(seam.secondary.id, 'B');
  assert.ok(Math.abs(seam.blendFactor - 0.5) < 1e-6);
  const deep = rpm.evaluateAt([2, 2, 5]);
  assert.equal(deep.primary.id, 'A');
  assert.equal(deep.active.length, 1);
  const mat = new THREE.MeshStandardMaterial();
  rpm.applyToMaterial(mat, seam);
  assert.equal(mat.envMap, envA);
  assert.ok(Math.abs(mat.envMapIntensity - 0.7) < 1e-6);
  assert.equal(mat.userData.reflectionProbe.boxProjection, true);
  rpm.dispose();
});

test('R2 baked lightmap: applyBakedLightmap3D wires lightMap on uv channel 1 and SH DC injection', () => {
  const mat = new THREE.MeshStandardMaterial();
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  assert.equal(applyBakedLightmap3D(mat, tex, { intensity: 1.5, shCoefficients: [0.5, 0.25, 0.1] }), true);
  assert.equal(mat.lightMap, tex);
  assert.equal(tex.channel, 1);
  assert.equal(mat.lightMapIntensity, 1.5);
  assert.deepEqual(mat.userData.hgameBakedShDc.value, [0.5, 0.25, 0.1]);
  const shader = {
    uniforms: {},
    fragmentShader: 'void main(){\n#include <lights_fragment_end>\n}',
  };
  mat.onBeforeCompile(shader, null);
  assert.ok(shader.uniforms.uBakedShDc);
  assert.match(shader.fragmentShader, /uBakedShDc \* 0\.282095/);
  assert.equal(applyBakedLightmap3D(null, tex), false);
});

test('R2 lightmap UV2: charts packed in [0,1] without overlap for a box', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const res = generateLightmapUV3D(box, { padding: 2, resolution: 512 });
  assert.equal(res.charts.length, 6);
  const uv1 = box.getAttribute('uv1');
  assert.equal(uv1.count, box.getAttribute('position').count);
  for (const v of uv1.array) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  for (let i = 0; i < res.charts.length; i++) for (let j = i + 1; j < res.charts.length; j++) {
    const a = res.charts[i], b = res.charts[j];
    const ov = a.uMax > b.uMin + 1e-6 && b.uMax > a.uMin + 1e-6 && a.vMax > b.vMin + 1e-6 && b.vMax > a.vMin + 1e-6;
    assert.ok(!ov);
  }
  assert.ok(res.utilization > 0.3);
});

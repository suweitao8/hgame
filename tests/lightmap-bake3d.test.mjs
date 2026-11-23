import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { applyBakedLightmap3D } from '../assets/runtime/integrations/lighting3d.js';
import { generateLightmapUV3D, createLightmapBaker3D } from '../assets/runtime/integrations/lightmap-bake3d.js';

function assertValidLightmapUVs(geometry, result) {
  const uv1 = geometry.getAttribute('uv1');
  assert.ok(uv1, 'expected uv1 attribute');
  assert.equal(uv1.itemSize, 2);
  for (let i = 0; i < uv1.array.length; i++) {
    const v = uv1.array[i];
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `uv1 out of [0,1]: ${v}`);
  }
  assert.ok(result.charts.length >= 1);
  assert.ok(result.utilization > 0.3, `expected utilization > 0.3, got ${result.utilization}`);

  // Verify disjoint chart bounding boxes
  for (let i = 0; i < result.charts.length; i++) {
    const a = result.charts[i];
    for (let j = i + 1; j < result.charts.length; j++) {
      const b = result.charts[j];
      const overlapU = a.uMax > b.uMin + 1e-6 && b.uMax > a.uMin + 1e-6;
      const overlapV = a.vMax > b.vMin + 1e-6 && b.vMax > a.vMin + 1e-6;
      assert.ok(!(overlapU && overlapV), `Chart ${a.id} overlaps chart ${b.id}`);
    }
  }
}

test('generateLightmapUV3D produces non-overlapping uv1 in [0,1] with >0.3 utilization on BoxGeometry, PlaneGeometry, and indexed SphereGeometry', () => {
  const box = new THREE.BoxGeometry(2, 2, 2);
  const boxRes = generateLightmapUV3D(box, { padding: 2, resolution: 512 });
  assert.equal(boxRes.charts.length, 6);
  assertValidLightmapUVs(box, boxRes);

  const plane = new THREE.PlaneGeometry(10, 10, 4, 4);
  const planeRes = generateLightmapUV3D(plane, { padding: 2, resolution: 512 });
  assert.equal(planeRes.charts.length, 1);
  assertValidLightmapUVs(plane, planeRes);

  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const sphereRes = generateLightmapUV3D(sphere, { padding: 2, resolution: 512 });
  assert.ok(sphereRes.charts.length >= 6);
  assertValidLightmapUVs(sphere, sphereRes);
});

test('applyBakedLightmap3D binds lightMap with channel = 1 for uv1', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  assert.equal(tex.channel, 0);
  const ok = applyBakedLightmap3D(mat, tex, { intensity: 1.2 });
  assert.equal(ok, true);
  assert.equal(mat.lightMap, tex);
  assert.equal(tex.channel, 1);
  assert.equal(mat.lightMapIntensity, 1.2);
});

test('createLightmapBaker3D validates inputs and supports mock renderer lifecycle', () => {
  assert.throws(() => createLightmapBaker3D(null, {}), /Three\.js/);
  assert.throws(() => createLightmapBaker3D(THREE, null), /WebGLRenderer/);

  const calls = [];
  const mockGl = { getExtension: () => ({}) };
  const mockRenderer = {
    getContext: () => mockGl,
    getRenderTarget: () => null,
    setRenderTarget: (rt) => calls.push(['setRenderTarget', Boolean(rt)]),
    setClearColor: () => {},
    getClearColor: (c) => c,
    getClearAlpha: () => 1,
    clear: () => calls.push(['clear']),
    render: () => calls.push(['render']),
    readRenderTargetPixels: (_rt, _x, _y, _w, _h, buf) => buf.fill(180),
    autoClear: true,
    toneMapping: THREE.NoToneMapping,
  };

  const baker = createLightmapBaker3D(THREE, mockRenderer, { resolution: 64, shadowResolution: 32 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const res = baker.bake({
    meshes: [mesh],
    sun: { direction: [0.5, 1, 0.3], intensity: 1.0 },
    lights: [
      { type: 'point', position: [0, 2, 0], color: 0xffddaa, intensity: 2.0, distance: 10 },
      { type: 'spot', position: [2, 3, 2], direction: [-1, -1, -1], angle: 0.5, intensity: 2.0 },
    ],
    samples: 2,
    aoSamples: 2,
    bounces: 1,
    dilationPasses: 4,
  });

  assert.equal(res.stats.samples, 4);
  assert.equal(res.stats.lights, 2);
  assert.equal(res.stats.dilationPasses, 4);
  assert.equal(res.stats.texels, 64 * 64);
  assert.ok(res.texture.channel === 1);
  assert.ok(calls.some((c) => c[0] === 'render'));

  const pixels = baker.readPixels();
  assert.equal(pixels.length, 64 * 64 * 4);
  assert.equal(pixels[0], 180);

  assert.equal(baker.dispose(), true);
  assert.equal(baker.dispose(), false);
  assert.throws(() => baker.bake({ meshes: [mesh] }), /disposed/);
});

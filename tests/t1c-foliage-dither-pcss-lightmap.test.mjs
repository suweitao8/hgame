import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { createInstancedFoliage3D } from '../assets/runtime/integrations/foliage3d.js';
import { injectDitherLodMaterial3D } from '../assets/runtime/integrations/model3d/lod.js';
import { createCascadedShadowMap3D } from '../assets/runtime/integrations/shadow3d.js';
import { applyBakedLightmap3D } from '../assets/runtime/integrations/lighting3d.js';

test('R5 createInstancedFoliage3D populates seeded blades, trampler bend uniforms, and Bayer fade shader', () => {
  const field = createInstancedFoliage3D(THREE, {
    count: 150,
    areaSize: 16,
    windAmp: 0.22,
    windFreq: 3.1,
    fadeNear: 12,
    fadeFar: 28,
    trampleRadius: 1.8,
  });

  assert.equal(field.count, 150);
  assert.equal(field.mesh.count, 150);
  assert.ok(field.material.customProgramCacheKey().includes('hgame-foliage3d'));

  field.update(0.1, [3, 0, -2]);
  assert.ok(Math.abs(field.uniforms.uFoliageTime.value - 0.1) < 1e-6);
  assert.equal(field.uniforms.uTramplePos.value.x, 3);
  assert.equal(field.uniforms.uTramplePos.value.z, -2);

  const mockShader = {
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: '#include <alphatest_fragment>',
  };
  field.material.onBeforeCompile(mockShader);
  assert.ok(mockShader.vertexShader.includes('uTramplePos') && mockShader.vertexShader.includes('uWindAmp'));
  assert.ok(mockShader.fragmentShader.includes('_bayer') && mockShader.fragmentShader.includes('uFadeFar'));
  field.dispose();
});

test('R5 injectDitherLodMaterial3D injects Bayer discard threshold and runtime fade toggle', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  assert.equal(injectDitherLodMaterial3D(THREE, mat, { fade: 0.5, invert: true }), true);
  assert.ok(mat.customProgramCacheKey().includes('hgame-dither-lod'));
  assert.equal(mat.userData.hgameLodDither.uniforms.uLodDitherFade.value, 0.5);
  assert.equal(mat.userData.hgameLodDither.uniforms.uLodDitherInvert.value, 1);

  const mockShader = {
    uniforms: {},
    vertexShader: '',
    fragmentShader: '#include <alphatest_fragment>',
  };
  mat.onBeforeCompile(mockShader);
  assert.ok(mockShader.fragmentShader.includes('uLodDitherFade') && mockShader.fragmentShader.includes('_lb'));

  mat.userData.hgameLodDither.setLodDitherFade(0.85, false);
  assert.equal(mat.userData.hgameLodDither.uniforms.uLodDitherFade.value, 0.85);
  assert.equal(mat.userData.hgameLodDither.uniforms.uLodDitherInvert.value, 0);
  mat.dispose();
});

test('R2 createCascadedShadowMap3D pcss option injects blocker-search + variable penumbra shader', () => {
  const csm = createCascadedShadowMap3D(THREE, { cascades: 3, pcss: true, lightSize: 0.05 });
  const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
  csm.applyToMaterial(mat);
  assert.ok(mat.customProgramCacheKey().includes('-pcss'));

  const mockShader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <lights_fragment_end>',
  };
  mat.onBeforeCompile(mockShader);
  assert.ok(mockShader.fragmentShader.includes('blockerSum') && mockShader.fragmentShader.includes('penumbra'));
  mat.dispose();
  csm.dispose();
});

test('R2 applyBakedLightmap3D binds lightMap, intensity, and optional L2 SH ambient term', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const tex = new THREE.DataTexture(new Uint8Array([255, 220, 180, 255]), 1, 1);
  assert.equal(applyBakedLightmap3D(mat, tex, { intensity: 1.4, shCoefficients: [0.8, 0.9, 1.0] }), true);
  assert.equal(mat.lightMap, tex);
  assert.equal(mat.lightMapIntensity, 1.4);

  const mockShader = {
    uniforms: {},
    vertexShader: '',
    fragmentShader: '#include <lights_fragment_end>',
  };
  mat.onBeforeCompile(mockShader);
  assert.ok(mockShader.fragmentShader.includes('uBakedShDc'));
  assert.ok(mockShader.uniforms.uBakedShDc);
  tex.dispose();
  mat.dispose();
});

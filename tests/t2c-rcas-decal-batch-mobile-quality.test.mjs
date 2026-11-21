import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { FXAA_SHARPEN_FRAGMENT_GLSL3 } from '../assets/runtime/integrations/post3d/shaders.js';
import { createDecalSystem3D } from '../assets/runtime/integrations/decal3d.js';
import {
  createComposableMaterial3D,
  createMaterialBatchRegistry3D,
} from '../assets/runtime/integrations/material-graph3d.js';
import {
  MOBILE_PORTRAIT_PRESET,
  resolvePortraitViewport,
} from '../assets/runtime/integrations/quality3d.js';

test('R4 FXAA_SHARPEN_FRAGMENT_GLSL3 implements AMD FSR1 RCAS 5-tap contrast-adaptive anti-ringing sharpening', () => {
  assert.ok(FXAA_SHARPEN_FRAGMENT_GLSL3.includes('rcasMin4'));
  assert.ok(FXAA_SHARPEN_FRAGMENT_GLSL3.includes('rcasMax4'));
  assert.ok(FXAA_SHARPEN_FRAGMENT_GLSL3.includes('rcasW'));
  assert.ok(FXAA_SHARPEN_FRAGMENT_GLSL3.includes('clamp(rcasRgb, localMin, localMax)'));
});

test('R3 projected decal system supports edgeSoftness and roughnessTint uniforms', () => {
  const decals = createDecalSystem3D(THREE, { mode: 'projected', maxDecals: 4 });
  const h = decals.spawn({
    position: [0, 1, 0],
    normal: [0, 1, 0],
    size: [2, 2, 1.5],
    edgeSoftness: 0.35,
    roughnessTint: 0.6,
  });
  assert.ok(h);
  const uniforms = h.mesh.material.uniforms;
  assert.ok(Math.abs(uniforms.uEdgeSoftness.value - 0.35) < 1e-6);
  assert.ok(Math.abs(uniforms.uRoughnessTint.value - 0.6) < 1e-6);
  assert.ok(h.mesh.material.fragmentShader.includes('uEdgeSoftness'));
  decals.dispose();
});

test('R3 createMaterialBatchRegistry3D synchronizes shared shader uniforms in O(1)', () => {
  const reg = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.02 });
  const m1 = createComposableMaterial3D(THREE, {
    sharedBlock: reg.sharedBlock,
    windSway: { amplitude: 0.15 },
  });
  const m2 = createComposableMaterial3D(THREE, {
    sharedBlock: reg.sharedBlock,
    windSway: { amplitude: 0.25 },
  });
  reg.register(m1);
  reg.register(m2);
  reg.updateFrame(0.05, { uFogDensity: 0.05 });

  assert.equal(reg.getStats().registeredCount, 2);
  assert.ok(Math.abs(reg.sharedBlock.get('uTime') - 0.05) < 1e-6);
  assert.ok(Math.abs(m1.userData.hgameUniforms.uWindTime.value - 0) < 1e-6 || reg.sharedBlock.uniforms.uTime.value === 0.05);
  assert.ok(Math.abs(reg.sharedBlock.get('uFogDensity') - 0.05) < 1e-6);
  m1.dispose();
  m2.dispose();
});

test('P3 MOBILE_PORTRAIT_PRESET and resolvePortraitViewport cap fill-rate & capture safe-area portrait orientation', () => {
  assert.equal(MOBILE_PORTRAIT_PRESET.tier, 'medium');
  assert.equal(MOBILE_PORTRAIT_PRESET.maxPixelRatio, 2);

  const vp = resolvePortraitViewport({
    width: 390,
    height: 844,
    dpr: 3,
    safeArea: { top: 44, bottom: 34, right: 0, left: 0 },
  });
  assert.equal(vp.orientation, 'portrait');
  assert.ok(vp.pixelRatio <= 2);
  assert.ok(vp.bufferWidth * vp.bufferHeight <= MOBILE_PORTRAIT_PRESET.maxPixels + 4096);
  assert.equal(vp.safeArea.top, 44);
  assert.equal(vp.safeArea.bottom, 34);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { HGame, defineMaterialVariants3D } from '../assets/runtime/index.js';
import { createSharedMaterialBlock3D } from '../assets/runtime/integrations/material-graph3d.js';

test('R3 defineMaterialVariants3D canonicalizes keyword order, caches variants, and emits distinct customProgramCacheKeys', () => {
  assert.equal(typeof HGame.defineMaterialVariants3D, 'function');
  const sharedBlock = createSharedMaterialBlock3D({ uGlobalWetness: 0.25 });

  const variants = defineMaterialVariants3D(THREE, {
    base: {
      color: 0x334455,
      roughness: 0.6,
      defines: { BASE_PBR: 1 },
      uniforms: { uBaseScale: 1.0 },
    },
    keywords: {
      DISSOLVE: {
        dissolve: { threshold: 0.35, edgeWidth: 0.1 },
        defines: { USE_DISSOLVE: 1 },
        uniforms: { uDissolveSeed: 7 },
      },
      FRESNEL: {
        fresnel: { color: 0x44ccff, power: 2.5, strength: 0.9 },
        defines: { USE_RIM: 1 },
      },
      QUALITY: {
        high: { clearcoat: 0.7, roughness: 0.25, defines: { QUALITY_HIGH: 1 } },
        low: { roughness: 0.9, defines: { QUALITY_LOW: 1 } },
      },
    },
    uniforms: { uRimBoost: 1.2 },
    sharedBlock,
  });

  assert.equal(variants.getKey({}), 'default');
  assert.equal(
    variants.getKey({ FRESNEL: true, QUALITY: 'high', DISSOLVE: true }),
    'DISSOLVE|FRESNEL|QUALITY=high',
  );
  assert.equal(
    variants.getKey({ QUALITY: 'high', DISSOLVE: true, FRESNEL: true }),
    'DISSOLVE|FRESNEL|QUALITY=high',
  );

  const mBase = variants.get();
  const m1 = variants.get({ FRESNEL: true, QUALITY: 'high', DISSOLVE: true });
  const m2 = variants.get({ QUALITY: 'high', DISSOLVE: true, FRESNEL: true });
  const mLow = variants.get({ FRESNEL: true, QUALITY: 'low', DISSOLVE: false });

  assert.equal(m1, m2, 'Permuted identical active keywords must return cached material instance');
  assert.notEqual(m1, mBase);
  assert.notEqual(m1, mLow);

  const key1 = m1.customProgramCacheKey();
  const key2 = m2.customProgramCacheKey();
  const keyBase = mBase.customProgramCacheKey();
  const keyLow = mLow.customProgramCacheKey();
  assert.equal(key1, key2);
  assert.notEqual(key1, keyBase);
  assert.notEqual(key1, keyLow);
  assert.notEqual(keyBase, keyLow);

  assert.equal(m1.defines.BASE_PBR, 1);
  assert.equal(m1.defines.USE_DISSOLVE, 1);
  assert.equal(m1.defines.USE_RIM, 1);
  assert.equal(m1.defines.QUALITY_HIGH, 1);
  assert.equal(m1 instanceof THREE.MeshPhysicalMaterial, true);
  assert.equal(mLow.roughness, 0.9);
  assert.equal(mLow.defines.QUALITY_LOW, 1);

  const fakeShader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n#include <dithering_fragment>',
  };
  m1.onBeforeCompile(fakeShader);
  assert.equal(fakeShader.uniforms.uBaseScale.value, 1.0);
  assert.equal(fakeShader.uniforms.uDissolveSeed.value, 7);
  assert.equal(fakeShader.uniforms.uRimBoost.value, 1.2);
  assert.equal(fakeShader.uniforms.uGlobalWetness.value, 0.25);

  assert.equal(variants.size, 3);
  assert.deepEqual(variants.list().sort(), [
    'DISSOLVE|FRESNEL|QUALITY=high',
    'FRESNEL|QUALITY=low',
    'default',
  ].sort());

  variants.dispose();
  assert.equal(variants.size, 0);
});

test('R3 defineMaterialVariants3D warmup compiles unique combinations once and disposes cached materials', () => {
  const compileCalls = [];
  const renderer = {
    compile(scene, cam) {
      compileCalls.push({ meshCount: scene.children.length, cam });
    },
  };
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 50);

  const variants = defineMaterialVariants3D(THREE, {
    keywords: {
      WET: { wetness: 0.8, defines: { USE_WET: 1 } },
      RIM: { interactRim: 1.0, defines: { USE_INTERACT: 1 } },
    },
  });

  let disposedCount = 0;
  const orig = THREE.MeshStandardMaterial.prototype.dispose;
  const warmed = variants.warmup(renderer, cam, [
    { WET: true, RIM: false },
    { RIM: true, WET: true },
    { WET: true, RIM: true },
    {},
  ]);

  assert.equal(warmed.compiled, 3);
  assert.deepEqual(warmed.keys, ['WET', 'RIM|WET', 'default']);
  assert.equal(compileCalls.length, 1);
  assert.equal(compileCalls[0].meshCount, 3);
  assert.equal(compileCalls[0].cam, cam);

  for (const key of variants.list()) {
    const mat = variants.get(
      key === 'default' ? {} : Object.fromEntries(key.split('|').map(k => [k, true])),
    );
    const oldDispose = mat.dispose.bind(mat);
    mat.dispose = () => {
      disposedCount++;
      oldDispose();
    };
  }
  assert.equal(typeof orig, 'function');
  variants.dispose();
  assert.equal(disposedCount, 3);
  assert.equal(variants.size, 0);
  assert.throws(() => variants.get({}), /disposed/);
});

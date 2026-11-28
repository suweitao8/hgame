import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';

import {
  VFX_COMMON_GLSL,
  VFX_CURVE_LUT_SAMPLES,
  compileCurveLut16,
  compileMinMaxCurve,
  evaluateMinMaxCurve,
  srgbToLinear,
  compileMinMaxGradient,
  evaluateMinMaxGradient,
  registerShaderProfile,
  getShaderProfile,
  listShaderProfiles,
  resolveThreeRenderState,
  createProfileMaterial,
  getCompiledShaderVariantCount,
  resetCompiledShaderVariantTracker,
  compileShurikenLayer,
  createShurikenKernel,
  createVfxSystem,
  ATLAS_PARTICLE_VERTEX_GLSL,
} from '../assets/runtime/vfx/index.js';
import { applyClampVelocityStep, hasClampVelocity } from '../assets/runtime/vfx/vfx-core.js';
import { convertUnityPrefab } from '../scripts/import-unity-vfx.mjs';
import { buildGlbBuffer, parseUnityAssetMesh } from '../scripts/export-unity-vfx-bench.mjs';
import { auditVfxPackParity } from '../scripts/export-vfx-bundle.mjs';

test('ShaderGraph OverrideReferenceName, DefaultReferenceName, m_Colors Vec2/4, vertexStreams, and TwoCurves parse cleanly in import-unity-vfx.mjs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-shuriken-imp-'));
  try {
    const texGuid = '11111111111111111111111111111111';
    const noiseGuid = '22222222222222222222222222222222';
    fs.writeFileSync(path.join(tmpDir, 'Main.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'Main.png.meta'), `fileFormatVersion: 2\nguid: ${texGuid}\n`);
    fs.writeFileSync(path.join(tmpDir, 'Noise.png'), '');
    fs.writeFileSync(path.join(tmpDir, 'Noise.png.meta'), `fileFormatVersion: 2\nguid: ${noiseGuid}\n`);

    const matGuid = '33333333333333333333333333333333';
    const uberShaderGuid = '7f11fe28133f1a74594785107b98f2fe';
    fs.writeFileSync(path.join(tmpDir, 'Uber.mat'), [
      '%YAML 1.1',
      'Material:',
      `  m_Shader: {fileID: 4800000, guid: ${uberShaderGuid}, type: 3}`,
      '  m_ValidKeywords:',
      '  - _USERAMP',
      '  - _FRESNEL',
      '  - _ALPHATEST_ON',
      '  m_SavedProperties:',
      '    m_TexEnvs:',
      '    - _MainTex:',
      `        m_Texture: {fileID: 2800000, guid: ${texGuid}, type: 3}`,
      '        m_Scale: {x: 2, y: 1}',
      '        m_Offset: {x: 0.25, y: 0.5}',
      '    - _DetailNoise:',
      `        m_Texture: {fileID: 2800000, guid: ${noiseGuid}, type: 3}`,
      '        m_Scale: {x: 1, y: 1}',
      '        m_Offset: {x: 0, y: 0}',
      '    m_Floats:',
      '    - _Surface: 1',
      '    - _Blend: 0',
      '    - _SrcBlend: 1',
      '    - _DstBlend: 10',
      '    - _Cull: 0',
      '    - _Desaturate: 0.8',
      '    - _Alpha_Clip_Threshold: 0.42',
      '    - _Invert_Fresnel: 1',
      '    - _Tint_Fresnel: 1',
      '    - _MiddlePointPos: 0.65',
      '    - _MiddlePointPos1: 0.2',
      '    m_Colors:',
      '    - _MainTextureChannel: {r: 1, g: 0, b: 0, a: 0}',
      '    - _Disolve_Fade_Range: {r: -0.35, g: 1.15, b: 0, a: 0}',
      '    - _WhiteColor: {r: 2, g: 1.5, b: 1, a: 1}',
      '    - _MidColor: {r: 1, g: 0.4, b: 0.1, a: 1}',
      '    - _LastColor: {r: 0.05, g: 0.02, b: 0.08, a: 1}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'Uber.mat.meta'), `fileFormatVersion: 2\nguid: ${matGuid}\n`);

    const prefabPath = path.join(tmpDir, 'TestUber.prefab');
    fs.writeFileSync(prefabPath, [
      '%YAML 1.1',
      '--- !u!1 &10',
      'GameObject:',
      '  m_Name: TestUber',
      '  m_IsActive: 1',
      '--- !u!4 &11',
      'Transform:',
      '  m_GameObject: {fileID: 10}',
      '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
      '  m_LocalPosition: {x: 0, y: 0, z: 3}',
      '  m_LocalScale: {x: 1, y: 1, z: 1}',
      '  m_Father: {fileID: 0}',
      '--- !u!198 &12',
      'ParticleSystem:',
      '  m_GameObject: {fileID: 10}',
      '  lengthInSec: 1',
      '  looping: 0',
      '  moveWithTransform: 1',
      '  InitialModule:',
      '    maxNumParticles: 32',
      '    startLifetime:',
      '      minMaxState: 0',
      '      scalar: 1',
      '    startSize:',
      '      minMaxState: 0',
      '      scalar: 1',
      '    size3D: 1',
      '    startSizeY:',
      '      minMaxState: 0',
      '      scalar: 2',
      '    startSizeZ:',
      '      minMaxState: 0',
      '      scalar: 3',
      '    startColor: {minMaxState: 0, maxColor: {r: 1, g: 1, b: 1, a: 1}}',
      '  EmissionModule:',
      '    enabled: 1',
      '    rateOverTime: {minMaxState: 0, scalar: 0}',
      '    m_BurstCount: 1',
      '    m_Bursts:',
      '    - serializedVersion: 2',
      '      time: 0',
      '      countCurve: {minMaxState: 0, scalar: 2, minScalar: 2}',
      '      cycleCount: 1',
      '      repeatInterval: 0.01',
      '  SizeModule:',
      '    enabled: 1',
      '    separateAxes: 1',
      '    x:',
      '      minMaxState: 2',
      '      scalar: 2',
      '      minScalar: 1',
      '      maxCurve:',
      '        serializedVersion: 2',
      '        m_Curve:',
      '        - time: 0',
      '          value: 0.5',
      '        - time: 1',
      '          value: 1',
      '      minCurve:',
      '        serializedVersion: 2',
      '        m_Curve:',
      '        - time: 0',
      '          value: 0.25',
      '        - time: 1',
      '          value: 0.5',
      '  CustomDataModule:',
      '    enabled: 1',
      '    mode0: 1',
      '    vector0_0:',
      '      minMaxState: 2',
      '      scalar: 4',
      '      minScalar: 2',
      '      maxCurve:',
      '        m_Curve:',
      '        - time: 0',
      '          value: 1',
      '        - time: 1',
      '          value: 0',
      '      minCurve:',
      '        m_Curve:',
      '        - time: 0',
      '          value: 0.5',
      '        - time: 1',
      '          value: 0',
      '  VelocityModule:',
      '    enabled: 1',
      '    x:',
      '      minMaxState: 0',
      '      scalar: 0',
      '    y:',
      '      minMaxState: 0',
      '      scalar: 0',
      '    z:',
      '      minMaxState: 0',
      '      scalar: 5',
      '--- !u!199 &13',
      'ParticleSystemRenderer:',
      '  m_GameObject: {fileID: 10}',
      '  m_Enabled: 1',
      '  m_RenderMode: 0',
      '  m_VertexStreams: 000103042223212605',
      '  m_Materials:',
      `  - {fileID: 2100000, guid: ${matGuid}, type: 2}`,
    ].join('\n'));

    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'test_uber' });
    assert.equal(recipe.layers.length, 1);
    const l = recipe.layers[0];
    assert.equal(l.material.shaderProfile, 'piloto_uber_fx');
    assert.equal(l.material.srcBlend, 1);
    assert.equal(l.material.dstBlend, 10);
    assert.equal(l.material.desaturate, 0.8);
    assert.equal(l.material.alphaClipThreshold, 0.42);
    assert.equal(l.material.invertFresnel, true);
    assert.equal(l.material.tintFresnel, true);
    assert.deepEqual(l.material.dissolveFadeRange, [-0.35, 1.15]);
    assert.deepEqual(l.vertexStreams, { custom1: true, custom2: true, agePercent: true, stableRandom: true, uv2: true });
    assert.equal(l.velocity.linear[2], -5, 'Velocity Z converted LHS -> RHS at import time');
    assert.equal(l.sizeZ, 3, '3D startSizeZ preserved');
    assert.equal(l.size3D.x.mode, 'twoCurves');
    assert.equal(l.customData.custom1.x.mode, 'twoCurves');
    assert.equal(l.customData.custom1.x.minScalar, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('16-point Float32Array MinMaxCurve TwoCurves LUT & Linear MinMaxGradient round-trip', () => {
  assert.equal(VFX_CURVE_LUT_SAMPLES, 16);
  const c = compileMinMaxCurve({
    mode: 'twoCurves',
    scalar: 4,
    minScalar: 2,
    curve: [[0, 0], [1, 1]],
    minCurve: [[0, 1], [1, 0]],
  });
  assert.equal(c.kind, 'lutRange');
  assert.equal(c.lutMin.length, 16);
  assert.equal(c.lutMax.length, 16);
  // t=0: min=2*1=2, max=4*0=0 -> seed=0.5 => 1.0
  assert.ok(Math.abs(evaluateMinMaxCurve(c, 0, 0) - 2.0) < 1e-4);
  assert.ok(Math.abs(evaluateMinMaxCurve(c, 0, 1) - 0.0) < 1e-4);
  assert.ok(Math.abs(evaluateMinMaxCurve(c, 0, 0.5) - 1.0) < 1e-4);
  assert.ok(Math.abs(evaluateMinMaxCurve(c, 1, 1) - 4.0) < 1e-4);

  const linMid = srgbToLinear(0.5);
  assert.ok(Math.abs(linMid - 0.214041) < 1e-4, 'sRGB 0.5 decodes cleanly to Linear ~0.214');
  const g = compileMinMaxGradient([[0, [0.5, 0, 1, 1]], [1, [1, 0.5, 0, 0]]], false);
  const out = [0, 0, 0, 0];
  evaluateMinMaxGradient(g, 0, 0.5, out);
  assert.ok(Math.abs(out[0] - linMid) < 1e-4);
});

test('Shader Profile Registry covers all 4 profiles with < 24 variants, premultiply _SrcBlend=1, and NaN-free safeSmoothstep', () => {
  resetCompiledShaderVariantTracker();
  const names = listShaderProfiles();
  for (const req of ['piloto_uber_fx', 'piloto_pbr_fx', 'piloto_warp', 'unity_standard']) {
    assert.ok(names.includes(req), `built-in profile ${req} registered`);
    assert.ok(getShaderProfile(req), `${req} retrievable`);
  }

  // safeSmoothstep NaN guard in GLSL
  assert.ok(VFX_COMMON_GLSL.includes('abs(d) < 1e-5'), 'safeSmoothstep guards e1 == e0 against 0/0 NaN');

  // Verify _SrcBlend=1 + _Blend=0/2 maps to CustomBlending(OneFactor, Dst) + premulAlpha = true
  const rsAlpha = resolveThreeRenderState(THREE, { shaderProfile: 'piloto_uber_fx', surface: 1, blend: 'alpha', srcBlend: 1, dstBlend: 10 });
  assert.equal(rsAlpha.blending, THREE.CustomBlending);
  assert.equal(rsAlpha.blendSrc, THREE.OneFactor);
  assert.equal(rsAlpha.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(rsAlpha.premulAlpha, true);

  const rsAdd = resolveThreeRenderState(THREE, { shaderProfile: 'piloto_uber_fx', surface: 1, blend: 'additive', srcBlend: 1, dstBlend: 1 });
  assert.equal(rsAdd.blendSrc, THREE.OneFactor);
  assert.equal(rsAdd.blendDst, THREE.OneFactor);
  assert.equal(rsAdd.premulAlpha, true);

  // Compile realistic combinations across all 4 profiles and assert variant budget < 24
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const shared = {
    uTime: { value: 0 },
    uSoftDepthTex: { value: null },
    uHasSoftDepth: { value: 0 },
    uSceneColor: { value: null },
    uHasSceneColor: { value: 0 },
    uInvViewport: { value: new THREE.Vector2(1 / 960, 1 / 540) },
    uCamNearFar: { value: new THREE.Vector2(0.1, 200) },
  };
  createProfileMaterial(THREE, { shaderProfile: 'piloto_uber_fx', keywords: [] }, { main: tex }, shared);
  createProfileMaterial(THREE, { shaderProfile: 'piloto_uber_fx', keywords: ['_USERAMP', '_FRESNEL'] }, { main: tex }, shared);
  createProfileMaterial(THREE, { shaderProfile: 'piloto_uber_fx', keywords: ['_USEALPHAOVERRIDE', '_USESOFTALPHA', '_ALPHATEST_ON'] }, { main: tex }, shared);
  createProfileMaterial(THREE, { shaderProfile: 'piloto_pbr_fx', keywords: ['_ISPARTICLE', '_FRESNEL'] }, { baseColor: tex }, shared);
  createProfileMaterial(THREE, { shaderProfile: 'piloto_warp', keywords: ['_USE_SOFT_ALPHA'] }, { distortion: tex }, shared);
  createProfileMaterial(THREE, { shaderProfile: 'unity_standard', keywords: [] }, { main: tex }, shared);
  assert.ok(getCompiledShaderVariantCount() < 24, `variant count (${getCompiledShaderVariantCount()}) < 24`);

  // Custom pluggable profile
  registerShaderProfile('custom_test_profile', {
    vertexShader: getShaderProfile('unity_standard').vertexShader,
    fragmentShader: getShaderProfile('unity_standard').fragmentShader,
    createUniforms: getShaderProfile('unity_standard').createUniforms,
  });
  const customMat = createProfileMaterial(THREE, { shaderProfile: 'custom_test_profile' }, {}, shared);
  assert.ok(customMat.material);
});

test('Shuriken Kernel supports ClampVelocity dampen, RotationBySpeed, InheritVelocity, Custom1/2 streams, RenderMode=none (0 DrawCalls), and QualityTiers', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  try {
    const driverRecipe = {
      schemaVersion: 1,
      id: 'shuriken_full_test',
      duration: 2.0,
      loop: false,
      layers: [
        {
          name: 'none_driver',
          kind: 'particle',
          renderMode: 'none',
          bursts: [{ time: 0, count: 1 }],
          life: 1.0,
          speed: 0,
          velocity: { linear: [10, 0, 0] },
          clampVelocity: { separateAxis: false, limit: 2, dampen: 1.0 },
          trail: { mode: 'particles', lifetime: 0.4, width: 0.2 },
        },
        {
          name: 'custom_fx',
          kind: 'particle',
          renderMode: 'billboard',
          bursts: [{ time: 0, count: 10 }],
          life: 1.0,
          speed: 4,
          shape: { type: 'point' },
          rotationBySpeed: { separateAxes: false, range: [0, 8], curve: [[0, 1], [1, 5]] },
          inheritVelocity: { mode: 'initial', multiplier: 0.5 },
          customData: {
            custom1: { mode: 'vector', x: { mode: 'curve', scalar: 3, curve: [[0, 1], [1, 0]] }, y: 0.75, z: 0.1, w: 0.2 },
            custom2: { mode: 'vector', x: 0.5, y: 0, z: 0, w: 0 },
          },
          vertexStreams: { custom1: true, custom2: true, agePercent: true, stableRandom: true },
          material: { shaderProfile: 'piloto_uber_fx', blend: 'alpha', srcBlend: 1, dstBlend: 10, keywords: [] },
        },
        {
          name: 'warp_wave',
          kind: 'particle',
          renderMode: 'billboard',
          bursts: [{ time: 0, count: 1 }],
          life: 1.0,
          size: 2,
          material: { shaderProfile: 'piloto_warp', distortionStrength: 0.2 },
        },
      ],
    };

    const handle = vfx.playEffect(driverRecipe, { x: 0, y: 0, z: 0 });
    assert.ok(handle.isActive());

    // Step 0.5s (5x0.1s since createVfxSystem clamps max dt per step to 0.1s)
    for (let s = 0; s < 5; s++) vfx.update(0.1);
    const noneMesh = scene.getObjectByName('ShurikenLayer_none_driver');
    assert.equal(noneMesh, undefined, 'renderMode="none" adds zero GPU mesh / 0 DrawCalls');
    assert.ok(vfx.trails.getStats().activeTrails >= 1, 'renderMode="none" still drives TrailModule');

    const fxMesh = scene.getObjectByName('ShurikenLayer_custom_fx');
    assert.ok(fxMesh, 'ShurikenLayer_custom_fx mounted');
    const c1 = fxMesh.geometry.getAttribute('aCustom1').array;
    const c2 = fxMesh.geometry.getAttribute('aCustom2').array;
    const meta = fxMesh.geometry.getAttribute('aMeta').array;
    assert.ok(Math.abs(c1[0] - 1.5) < 0.25, `aCustom1.x interpolated (~1.5, got ${c1[0]})`);
    assert.ok(Math.abs(c1[1] - 0.75) < 1e-3, 'aCustom1.y constant');
    assert.ok(Math.abs(c2[0] - 0.5) < 1e-3, 'aCustom2.x constant');
    assert.ok(meta[0] > 0.4 && meta[0] < 0.6, 'aMeta.x age01');
    assert.ok(meta[1] >= 0 && meta[1] <= 1, 'aMeta.y stableRandom');

    assert.equal(vfx.hasActiveWarp(), true);

    // Low quality tier: skips warp & halves emission
    vfx.setQualityTier('low');
    assert.equal(vfx.getQualityTier(), 'low');
    vfx.reset();
    vfx.playEffect(driverRecipe, { x: 0, y: 0, z: 0 });
    vfx.update(0.1);
    const lowStats = vfx.getStats();
    assert.equal(lowStats.shuriken.warpActive, 0, 'low quality tier skips piloto_warp layer');
    assert.equal(fxMesh.geometry.instanceCount, 5, 'low quality tier scales 10 particles -> 5');
  } finally {
    vfx.dispose();
  }
});

test('Unity .asset mesh LHS -> RHS + GLB binary builder produces valid glTF 2.0 headers', () => {
  const sampleBuf = buildGlbBuffer({
    positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
    uv1: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  });
  assert.equal(sampleBuf.readUInt32LE(0), 0x46546c67, 'valid glTF magic');
  assert.equal(sampleBuf.readUInt32LE(4), 2, 'glTF version 2');
  assert.equal(typeof parseUnityAssetMesh, 'function');
});

test('unity_standard mesh routes to meshVfx while useShurikenKernel resolves built-in sphere; birth subEmitter rateOverDistance array follows parent', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  try {
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'std_mesh_vs_shuriken',
      duration: 1.0,
      loop: false,
      layers: [
        {
          name: 'std_sphere',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'sphere',
          bursts: [{ time: 0, count: 1 }],
          life: 0.8,
          size: 1.0,
          transformRot: [0.70711, 0, 0, 0.70711],
          material: { shaderProfile: 'unity_standard', blend: 'additive' },
        },
        {
          name: 'forced_shuriken_sphere',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'sphere',
          useShurikenKernel: true,
          bursts: [{ time: 0, count: 1 }],
          life: 0.8,
          size: 1.0,
          material: { shaderProfile: 'unity_standard', blend: 'additive' },
        },
      ],
    });
    vfx.playEffect('std_mesh_vs_shuriken', { x: 0, y: 0, z: 0 });
    vfx.update(0.05);

    const stdLayerMesh = scene.getObjectByName('ShurikenLayer_std_sphere');
    assert.equal(stdLayerMesh, undefined, 'unity_standard mesh should route to meshVfx, not shurikenKernel');

    const shurikenLayerMesh = scene.getObjectByName('ShurikenLayer_forced_shuriken_sphere');
    assert.ok(shurikenLayerMesh, 'forced_shuriken_sphere should mount on shurikenKernel');
    assert.ok(shurikenLayerMesh.geometry.getAttribute('position').count > 12, 'built-in sphere geometry should not fall back to 4-vertex quad');

    const stats = vfx.getStats();
    assert.ok((stats.meshVfx?.activeCount ?? 0) >= 1, `expected stats.meshVfx.activeCount >= 1, got ${JSON.stringify(stats.meshVfx)}`);

    vfx.reset();
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'sub_range_rate_dist_test',
      duration: 1.2,
      loop: false,
      layers: [
        {
          name: 'carrier',
          kind: 'particle',
          renderMode: 'none',
          bursts: [{ time: 0, count: 1 }],
          life: 0.8,
          speed: 6.0,
          shape: { type: 'point', direction: [1, 0, 0] },
          subEmitters: [
            {
              trigger: 'birth',
              effect: {
                schemaVersion: 1,
                id: 'sub_range_child',
                duration: 0.8,
                loop: false,
                space: 'local',
                layers: [
                  {
                    name: 'trail_dots',
                    kind: 'particle',
                    renderMode: 'billboard',
                    rate: 0,
                    rateOverDistance: [3, 6],
                    life: 0.5,
                    size: 0.3,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    vfx.playEffect('sub_range_rate_dist_test', { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 6; i++) vfx.update(0.05);
    const subStats = vfx.getStats();
    assert.ok((subStats.atlasParticles?.normalTotal ?? 0) >= 1, `expected birth subEmitter with rateOverDistance array to follow & emit, got ${JSON.stringify(subStats.atlasParticles)}`);
  } finally {
    vfx.dispose();
  }
});

test('capability-gated usesShurikenKernel automatically falls back to meshVfx/atlasParticles on transformRot or collision without uberMat', () => {
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  try {
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'cap_gate_test',
      duration: 1.0,
      loop: false,
      layers: [
        {
          name: 'rot_mesh',
          kind: 'mesh',
          renderMode: 'mesh',
          mesh: 'quad',
          bursts: [{ time: 0, count: 1 }],
          life: 0.8,
          size: 1.0,
          transformRot: [0.70711, 0, 0, 0.70711],
          material: { shaderProfile: 'piloto_uber_fx', blend: 'additive' },
        },
        {
          name: 'collide_spark',
          kind: 'particle',
          renderMode: 'billboard',
          bursts: [{ time: 0, count: 2 }],
          life: 0.8,
          size: 0.3,
          collision: { bounce: 0.5 },
          material: { shaderProfile: 'piloto_uber_fx', blend: 'alpha' },
        },
      ],
    });
    vfx.playEffect('cap_gate_test', { x: 0, y: 0, z: 0 });
    vfx.update(0.05);
    assert.equal(scene.getObjectByName('ShurikenLayer_rot_mesh'), undefined, 'transformRot layer bypasses shurikenKernel');
    assert.equal(scene.getObjectByName('ShurikenLayer_collide_spark'), undefined, 'collision layer bypasses shurikenKernel');
    const stats = vfx.getStats();
    assert.ok((stats.meshVfx?.activeCount ?? 0) >= 1, 'transformRot mesh routed to meshVfx');
    assert.ok((stats.atlasParticles?.normalTotal ?? 0) >= 2, 'collision particle routed to atlasParticles');
  } finally {
    vfx.dispose();
  }
});

test('auditVfxPackParity catches all 5 defect classes and passes clean packs', () => {
  const cleanPrefab = [
    '--- !u!1 &10',
    'GameObject:',
    '  m_Name: Root',
    '  m_IsActive: 1',
    '--- !u!198 &20',
    'ParticleSystem:',
    '  m_GameObject: {fileID: 10}',
    '  EmissionModule:',
    '    enabled: 1',
  ].join('\n');

  const dirtyPrefab = [
    cleanPrefab,
    '--- !u!1 &30',
    'GameObject:',
    '  m_Name: Child',
    '  m_IsActive: 1',
    '--- !u!198 &40',
    'ParticleSystem:',
    '  m_GameObject: {fileID: 30}',
    '  EmissionModule:',
    '    enabled: 1',
  ].join('\n');

  const dirtyReport = auditVfxPackParity({
    prefabYamlById: new Map([['dirty_fx', dirtyPrefab]]),
    recipes: [
      {
        id: 'dirty_fx',
        layers: [
          {
            name: 'bad_layer',
            kind: 'mesh',
            renderMode: 'mesh',
            mesh: 'missing_custom_mesh',
            sprite: 'missing_tex',
            shaderProfile: 'piloto_uber_fx',
            transformRot: [0.70711, 0, 0, 0.70711],
            material: {
              shaderProfile: 'piloto_uber_fx',
              surface: 1,
              srcBlend: 1,
              dstBlend: 0,
              depthWrite: true,
              mainTexKey: 'missing_tex',
            },
          },
        ],
      },
    ],
    atlasRegions: { glow1: [0, 0, 0.5, 0.5] },
    meshIndex: { existing_mesh: { file: 'meshes/existing_mesh.glb' } },
    meshAliases: {},
  });

  assert.equal(dirtyReport.ok, false);
  assert.equal(dirtyReport.droppedPsCount, 1);
  assert.equal(dirtyReport.missingAtlasCount, 2);
  assert.equal(dirtyReport.missingMeshCount, 1);
  assert.equal(dirtyReport.staleBlendCount, 1);
  assert.equal(dirtyReport.routingMismatchCount, 1);

  const cleanReport = auditVfxPackParity({
    prefabYamlById: new Map([['clean_fx', cleanPrefab]]),
    recipes: [
      {
        id: 'clean_fx',
        layers: [
          {
            name: 'good_layer',
            kind: 'mesh',
            renderMode: 'mesh',
            mesh: 'quad',
            sprite: 'glow1',
            transformRot: [0.70711, 0, 0, 0.70711],
            material: {
              shaderProfile: 'unity_standard',
              surface: 1,
              srcBlend: 5,
              dstBlend: 1,
              depthWrite: false,
              mainTexKey: 'glow1',
            },
          },
        ],
      },
    ],
    atlasRegions: { glow1: [0, 0, 0.5, 0.5] },
    meshIndex: {},
    meshAliases: {},
  });

  assert.equal(cleanReport.ok, true);
  assert.equal(cleanReport.droppedPsCount, 0);
  assert.equal(cleanReport.missingAtlasCount, 0);
  assert.equal(cleanReport.missingMeshCount, 0);
  assert.equal(cleanReport.staleBlendCount, 0);
  assert.equal(cleanReport.routingMismatchCount, 0);
});

test('ATLAS_PARTICLE_VERTEX_GLSL preserves front-facing winding for negative lengthScale and URP Particles/Unlit exports unlit', () => {
  assert.ok(ATLAS_PARTICLE_VERTEX_GLSL.includes('float majorSign = major < 0.0 ? -1.0 : 1.0;'), 'stretched 3D shader preserves winding via majorSign');
  assert.ok(ATLAS_PARTICLE_VERTEX_GLSL.includes('vec3 effAxis3 = axis3 * majorSign;'), 'stretched 3D shader flips axis3 consistently with side3');
  assert.ok(ATLAS_PARTICLE_VERTEX_GLSL.includes('vec3 effSide3 = side3 * majorSign;'), 'stretched 3D shader flips side3 to preserve CCW winding');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-urp-unlit-'));
  try {
    const unlitMatGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const litMatGuid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const unlitMatPath = path.join(tmpDir, 'SolidUnlit.mat');
    const litMatPath = path.join(tmpDir, 'SolidLit.mat');
    fs.writeFileSync(unlitMatPath, [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: SolidUnlit',
      '  m_Shader: {fileID: 4800000, guid: 0406db5a14f94604a8c57ccfbc9f3b46, type: 3}',
      '  m_SavedProperties:',
      '    m_Floats:',
      '    - _Surface: 1',
      '    - _Blend: 0',
      '    m_Colors:',
      '    - _BaseColor: {r: 1, g: 1, b: 1, a: 1}',
    ].join('\n'));
    fs.writeFileSync(`${unlitMatPath}.meta`, `fileFormatVersion: 2\nguid: ${unlitMatGuid}\n`);
    fs.writeFileSync(litMatPath, [
      '%YAML 1.1',
      '--- !u!21 &2100000',
      'Material:',
      '  m_Name: SolidLit',
      '  m_Shader: {fileID: 4800000, guid: 933532a4fcc9baf4fa0491de14d08ed7, type: 3}',
      '  m_SavedProperties:',
      '    m_Floats:',
      '    - _Surface: 0',
      '    m_Colors:',
      '    - _BaseColor: {r: 1, g: 1, b: 1, a: 1}',
    ].join('\n'));
    fs.writeFileSync(`${litMatPath}.meta`, `fileFormatVersion: 2\nguid: ${litMatGuid}\n`);

    const prefabPath = path.join(tmpDir, 'UrpLitCheck.prefab');
    fs.writeFileSync(prefabPath, [
      '%YAML 1.1',
      '--- !u!1 &1',
      'GameObject:',
      '  m_Name: UnlitMesh',
      '  m_IsActive: 1',
      '--- !u!4 &2',
      'Transform:',
      '  m_GameObject: {fileID: 1}',
      '  m_LocalPosition: {x: 0, y: 0, z: 0}',
      '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
      '  m_LocalScale: {x: 1, y: 1, z: 1}',
      '  m_Father: {fileID: 0}',
      '--- !u!198 &3',
      'ParticleSystem:',
      '  m_GameObject: {fileID: 1}',
      '  EmissionModule:',
      '    enabled: 1',
      '    rateOverTime:',
      '      scalar: 0',
      '    m_BurstCount: 1',
      '    m_Bursts:',
      '    - serializedVersion: 2',
      '      time: 0',
      '      countCurve:',
      '        scalar: 1',
      '--- !u!199 &4',
      'ParticleSystemRenderer:',
      '  m_GameObject: {fileID: 1}',
      '  m_Enabled: 1',
      '  m_RenderMode: 4',
      '  m_Mesh: {fileID: 10207}',
      '  m_Materials:',
      `  - {fileID: 2100000, guid: ${unlitMatGuid}, type: 2}`,
      '--- !u!1 &11',
      'GameObject:',
      '  m_Name: LitMesh',
      '  m_IsActive: 1',
      '--- !u!4 &12',
      'Transform:',
      '  m_GameObject: {fileID: 11}',
      '  m_LocalPosition: {x: 0, y: 0, z: 0}',
      '  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}',
      '  m_LocalScale: {x: 1, y: 1, z: 1}',
      '  m_Father: {fileID: 2}',
      '--- !u!198 &13',
      'ParticleSystem:',
      '  m_GameObject: {fileID: 11}',
      '  EmissionModule:',
      '    enabled: 1',
      '    rateOverTime:',
      '      scalar: 0',
      '    m_BurstCount: 1',
      '    m_Bursts:',
      '    - serializedVersion: 2',
      '      time: 0',
      '      countCurve:',
      '        scalar: 1',
      '--- !u!199 &14',
      'ParticleSystemRenderer:',
      '  m_GameObject: {fileID: 11}',
      '  m_Enabled: 1',
      '  m_RenderMode: 4',
      '  m_Mesh: {fileID: 10207}',
      '  m_Materials:',
      `  - {fileID: 2100000, guid: ${litMatGuid}, type: 2}`,
    ].join('\n'));

    const { recipe } = convertUnityPrefab({ unityRoot: tmpDir, prefabPath, id: 'urp_lit_check' });
    const unlitLayer = recipe.layers.find((l) => l.name === 'unlitmesh');
    const litLayer = recipe.layers.find((l) => l.name === 'litmesh');
    assert.ok(unlitLayer && litLayer);
    assert.ok(!unlitLayer.lit, `URP/Particles/Unlit should not set lit=true, got ${unlitLayer.lit}`);
    assert.equal(litLayer.lit, true, 'URP/Lit should set lit=true');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hasClampVelocity and applyClampVelocityStep brake particles toward 0 when limit === 0 and dampen > 0, and static flipbook 0.4444 selects frame 4', () => {
  const clampCfg = { separateAxis: false, limit: 0, magnitude: 0, dampen: 0.25 };
  assert.equal(hasClampVelocity(clampCfg), true, 'limit=0 with dampen>0 is active air-braking');
  const target = { vx: 10, vy: 0, vz: 0 };
  applyClampVelocityStep(target, clampCfg, 1 / 60, 0.1, 0.5);
  assert.ok(Math.abs(target.vx - 10 * Math.sqrt(0.75)) < 1e-4, `expected Unity 30Hz dampen at 1/60s (~8.66), got ${target.vx}`);
  applyClampVelocityStep(target, clampCfg, 1 / 60, 0.1, 0.5);
  assert.ok(Math.abs(target.vx - 7.5) < 1e-4, `expected speed damped to 7.5 after 1/30s total, got ${target.vx}`);

  // Verify static 3x3 flipbook with startFrame=0.4444 maps to frame 4 (center cell: u in [1/3..2/3], v in [1/3..2/3]), not frame 3
  const scene = new THREE.Scene();
  const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });
  try {
    vfx.setAtlas(null, { fruitslices: [0, 0, 1, 1] });
    vfx.registerEffect({
      schemaVersion: 1,
      id: 'apple_frame4_test',
      duration: 1.0,
      loop: false,
      layers: [
        {
          name: 'gibs',
          kind: 'particle',
          renderMode: 'billboard',
          bursts: [{ time: 0, count: 1 }],
          life: 0.8,
          size: 0.5,
          flipbook: { region: 'fruitslices', cols: 3, rows: 3, cycles: 0, startFrame: 0.4444, blend: false },
          material: { shaderProfile: 'unity_standard', blend: 'alpha' },
        },
      ],
    });
    vfx.playEffect('apple_frame4_test', { x: 0, y: 0, z: 0 });
    vfx.update(0.02);
    const atlasMesh = scene.getObjectByName('HGameVfxAtlasNormal');
    assert.ok(atlasMesh, 'atlas normal batch mounted');
    const p4 = atlasMesh.geometry.getAttribute('aAtlasP4').array;
    const packed0 = Math.round(p4[0]);
    const packed1 = Math.round(p4[1]);
    // packUvPair encodes qu * 4096 + qv scaled by 3840
    const decU0 = Math.floor(packed0 / 4096) / 3840;
    const decV0 = (packed0 % 4096) / 3840;
    const decU1 = Math.floor(packed1 / 4096) / 3840;
    const decV1 = (packed1 % 4096) / 3840;
    assert.ok(Math.abs(decU0 - 1 / 3) < 0.01, `frame 4 col=1 starts at u=0.333, got ${decU0}`);
    assert.ok(Math.abs(decV0 - 1 / 3) < 0.01, `frame 4 row=1 starts at v=0.333, got ${decV0}`);
    assert.ok(Math.abs(decU1 - 2 / 3) < 0.01, `frame 4 col=1 ends at u=0.667, got ${decU1}`);
    assert.ok(Math.abs(decV1 - 2 / 3) < 0.01, `frame 4 row=1 ends at v=0.667, got ${decV1}`);
  } finally {
    vfx.dispose();
  }
});

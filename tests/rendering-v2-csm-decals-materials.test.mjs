import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Scene } from '../assets/runtime/index.js';
import { computeCascadeSplits, createCascadedShadowMap3D } from '../assets/runtime/integrations/sky3d.js';
import { createReflectionProbeManager3D } from '../assets/runtime/integrations/lighting3d.js';
import { createDecalSystem3D } from '../assets/runtime/integrations/decal3d.js';
import { createSharedMaterialBlock3D, createComposableMaterial3D } from '../assets/runtime/integrations/material-graph3d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import { TEMPORAL_AA_FRAGMENT_GLSL3 } from '../assets/runtime/integrations/post3d/shaders.js';
import { createPostPipeline3D } from '../assets/runtime/integrations/post3d.js';
import { bakeBoneVatData, createBoneVatCrowd3D, createModelLod3D } from '../assets/runtime/integrations/model3d.js';

function createMockThreeNamespace() {
  const gl = {
    getParameter: () => 2048,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_SAMPLES: 0x8d57,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    RENDERER: 0x1f01,
    getExtension: () => null,
  };
  const mockRenderer = {
    capabilities: { isWebGL2: true, maxSamples: 4, maxTextureSize: 2048 },
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    getContext: () => gl,
    getSize: target => target?.set?.(320, 180) ?? { width: 320, height: 180 },
    setSize() {},
    setPixelRatio() {},
    getPixelRatio: () => 1,
    setRenderTarget() {},
    getRenderTarget: () => null,
    clear() {},
    render() {},
    dispose() {},
  };
  return {
    mockRenderer,
    namespace: {
      ...THREE,
      WebGLRenderer: class { constructor() { return mockRenderer; } },
    },
  };
}

test('R2: computeCascadeSplits, createCascadedShadowMap3D, Three adapter sun.cascades, and ReflectionProbe blending', () => {
  const splits = computeCascadeSplits(0.1, 100, 3, 0.65);
  assert.equal(splits.length, 4);
  assert.equal(splits[0], 0.1);
  assert.equal(splits[3], 100);
  assert.ok(splits[1] < splits[2]);

  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  cam.position.set(10, 5, 20);
  cam.updateMatrixWorld(true);

  const csm = createCascadedShadowMap3D(THREE, { cascades: 3, maxFar: 90, mapSize: 1024 });
  assert.equal(csm.cascades, 3);
  assert.equal(csm.lights.length, 3);
  assert.equal(csm.lights[0].castShadow, true);
  assert.equal(csm.lights[1].intensity, 0);

  const fit1 = csm.update(cam);
  assert.equal(fit1.frustums.length, 3);
  assert.ok(fit1.frustums[0].right - fit1.frustums[0].left < fit1.frustums[2].right - fit1.frustums[2].left);
  csm.setDirection([0, 1, 0]);
  assert.ok(Math.abs(csm.direction[1] - 1) < 1e-6);
  csm.dispose();
  assert.equal(csm.lights.length, 0);

  // Three adapter integration with worldLighting.sun.cascades
  const { namespace } = createMockThreeNamespace();
  const scene = new Scene('csm-scene');
  const adapter = createThreeAdapter({
    THREE: namespace,
    canvas: { clientWidth: 320, clientHeight: 180 },
    pixelRatio: 1,
    post3d: false,
    worldLighting: {
      sun: { color: 0xffffff, intensity: 1.2, position: [10, 20, 10], cascades: 3, maxFar: 100 },
    },
  });
  adapter.render(scene);
  const sceneCsm = adapter.getCascadedShadowMap(scene);
  assert.ok(sceneCsm);
  assert.equal(sceneCsm.cascades, 3);
  scene.dispose();
  assert.equal(adapter.getCascadedShadowMap(scene), null);
  adapter.dispose();

  // Box-projected ReflectionProbe blending
  const rpm = createReflectionProbeManager3D(THREE, { maxProbes: 4, blendMargin: 4 });
  const envA = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const envB = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  rpm.addProbe('roomA', { min: [0, 0, 0], max: [10, 6, 10], envMap: envA, intensity: 1.0, priority: 1 });
  rpm.addProbe('roomB', { min: [10, 0, 0], max: [20, 6, 10], envMap: envB, intensity: 0.4, priority: 0 });

  const seam = rpm.evaluateAt([10, 2, 5]);
  assert.equal(seam.active.length, 2);
  assert.equal(seam.primary.id, 'roomA');
  assert.equal(seam.secondary.id, 'roomB');
  assert.ok(Math.abs(seam.blendFactor - 0.5) < 1e-6);

  const mat = new THREE.MeshStandardMaterial();
  rpm.applyToMaterial(mat, seam);
  assert.equal(mat.envMap, envA);
  assert.ok(Math.abs(mat.envMapIntensity - 0.7) < 1e-6);
  assert.equal(mat.userData.reflectionProbe.boxProjection, true);
  rpm.dispose();
});

test('R3: createDecalSystem3D and adapter.createDecalSystem recycle ring pool, align normals, and fade lifetimes', () => {
  const { namespace } = createMockThreeNamespace();
  const scene = new Scene('decal-scene');
  const adapter = createThreeAdapter({
    THREE: namespace,
    canvas: { clientWidth: 320, clientHeight: 180 },
    pixelRatio: 1,
    post3d: false,
  });
  const decals = adapter.createDecalSystem(scene, { maxDecals: 2, fadeSeconds: 1.0 });

  const d1 = decals.spawn({ position: [0, 0, 0], normal: [0, 1, 0], lifetime: 2.0 });
  const d2 = decals.spawn({ position: [2, 0, 0], normal: [1, 0, 0], lifetime: 4.0 });
  assert.equal(decals.getStats().active, 2);
  assert.equal(d1.mesh.material.polygonOffset, true);
  assert.equal(d1.mesh.material.depthWrite, false);

  // Spawning 3rd decal recycles oldest slot cleanly
  const d3 = decals.spawn({ position: [4, 0, 0], normal: [0, 0, 1], lifetime: 2.0 });
  assert.equal(decals.getStats().active, 2);
  assert.equal(decals.getStats().recycled, 1);
  assert.ok(d3);

  // Advance 1.5s -> fade kicks in on remaining 2.0s decal (0.5s remaining < 1.0s fadeSeconds)
  decals.update(1.5);
  assert.ok(d3.mesh.material.opacity < 0.6);
  decals.update(1.0);
  assert.equal(d3.mesh.visible, false);

  decals.dispose();
  adapter.dispose();
});

test('R3: createSharedMaterialBlock3D & createComposableMaterial3D share uniforms and compile modular shader chunks', () => {
  const shared = createSharedMaterialBlock3D({ uGlobalTime: 0, uWindStrength: 0.4 });
  shared.set('uGlobalTime', 1.25);
  assert.equal(shared.get('uGlobalTime'), 1.25);

  const mat = createComposableMaterial3D(THREE, {
    color: 0x336699,
    clearcoat: 0.7,
    fresnel: { color: 0xffffff, power: 2.5, strength: 1.2 },
    dissolve: { threshold: 0.35, edgeWidth: 0.05 },
    specularAA: true,
    sharedBlock: shared,
  });

  assert.equal(mat.isMeshPhysicalMaterial, true);
  assert.ok(mat.userData.hgameMaterialGraph.cacheKey.includes('phys:fresnel+dissolve+specularAA+sharedBlock'));
  assert.equal(mat.userData.hgameMaterialGraph.setFeatureParam('uDissolveThreshold', 0.6), true);

  const mockShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  mat.onBeforeCompile(mockShader, null);
  assert.equal(mockShader.uniforms.uGlobalTime, shared.uniforms.uGlobalTime);
  assert.match(mockShader.fragmentShader, /uFresnelColor/);
  assert.match(mockShader.fragmentShader, /uDissolveThreshold/);
  assert.match(mockShader.fragmentShader, /dFdx\(normal\)/);
  mat.dispose();
});

test('R4: TAA includes YCoCg variance clipping, Catmull-Rom sampling, and reactive mask uniform forwarding', () => {
  assert.match(TEMPORAL_AA_FRAGMENT_GLSL3, /rgbToYCoCg/);
  assert.match(TEMPORAL_AA_FRAGMENT_GLSL3, /yCoCgToRgb/);
  assert.match(TEMPORAL_AA_FRAGMENT_GLSL3, /sampleHistoryCatmullRom/);
  assert.match(TEMPORAL_AA_FRAGMENT_GLSL3, /tReactiveMask/);
  assert.match(TEMPORAL_AA_FRAGMENT_GLSL3, /uHasReactiveMask/);

  const { mockRenderer } = createMockThreeNamespace();
  let taaUniforms = null;
  mockRenderer.render = scene => {
    const u = scene.children?.[0]?.material?.uniforms;
    if (u && 'tReactiveMask' in u) taaUniforms = u;
  };
  const pipeline = createPostPipeline3D({ THREE, renderer: mockRenderer, width: 160, height: 90, temporalAA: true });
  const maskTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  pipeline.render(world, cam, { dt: 1 / 60, reactiveMask: maskTex });
  assert.equal(taaUniforms.uHasReactiveMask.value, true);
  assert.equal(taaUniforms.tReactiveMask.value, maskTex);
  maskTex.dispose();
  pipeline.dispose();
});

test('R5: createModelLod3D crossFadeSeconds & createBoneVatCrowd3D Bayer 4x4 dither crossfade', () => {
  const root = new THREE.Group();
  const rootBone = new THREE.Bone();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const posCount = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(posCount * 4), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from({ length: posCount * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  skinned.add(rootBone);
  skinned.bind(new THREE.Skeleton([rootBone]));
  root.add(skinned);
  const clip = new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack('.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);

  const vatData = bakeBoneVatData(THREE, { root, animations: [clip], sampleFps: 10 });
  const crowd = createBoneVatCrowd3D(THREE, { root, vatData, capacity: 4 });
  crowd.setCrossfade(0.45);
  assert.equal(crowd.crossfade, 0.45);

  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  crowd.lodMeshes[0].material.onBeforeCompile(shader, null);
  assert.match(shader.fragmentShader, /uCrowdCrossfade/);
  assert.match(shader.fragmentShader, /discard;/);

  const synced = [];
  const lod = createModelLod3D({
    crowd,
    crowdDistance: 10,
    farDistance: 30,
    hysteresis: 0,
    crossFadeSeconds: 0.4,
    near: () => ({ sync: st => synced.push({ tier: 'near', ...st }), dispose() {} }),
    far: () => ({ sync: st => synced.push({ tier: 'far', ...st }), dispose() {} }),
  });

  lod.update(5, { x: 0, y: 0, z: 0, rotationY: 0, clip: 'idle', time: 0.1, dt: 0.1 });
  assert.equal(lod.tier, 'near');
  lod.update(15, { x: 0, y: 0, z: 0, rotationY: 0, clip: 'idle', time: 0.2, dt: 0.1 });
  assert.equal(lod.tier, 'crowd');
  const fadeStart = lod.getCrossFadeState();
  assert.equal(fadeStart.active, true);
  assert.equal(fadeStart.fromTier, 'near');
  assert.equal(fadeStart.toTier, 'crowd');

  lod.update(15, { x: 0, y: 0, z: 0, rotationY: 0, clip: 'idle', time: 0.6, dt: 0.5 });
  assert.equal(lod.getCrossFadeState().active, false);
  assert.equal(lod.getCrossFadeState().alpha, 1);

  lod.dispose();
  crowd.dispose();
});

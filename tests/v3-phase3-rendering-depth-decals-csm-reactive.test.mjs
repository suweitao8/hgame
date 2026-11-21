import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { createDecalSystem3D } from '../assets/runtime/integrations/decal3d.js';
import { createCascadedShadowMap3D } from '../assets/runtime/integrations/shadow3d.js';
import { createReflectionProbeManager3D } from '../assets/runtime/integrations/lighting3d.js';
import { createPostPipeline3D } from '../assets/runtime/integrations/post3d.js';

function createMockWebGL2Renderer() {
  const renders = [];
  const gl = {
    MAX_SAMPLES: 0x8d57,
    MAX_TEXTURE_SIZE: 0x0d33,
    depthRange() {},
    getParameter(param) {
      if (param === 0x8d57) return 4;
      if (param === 0x0d33) return 8192;
      return 0;
    },
    getExtension(name) {
      if (name === 'EXT_color_buffer_float') return {};
      return null;
    },
  };
  const renderer = {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 },
    shadowMap: { enabled: true, type: 0 },
    autoClear: true,
    toneMapping: 0,
    info: { render: { calls: 0, triangles: 0 } },
    getContext: () => gl,
    setPixelRatio() {},
    setSize() {},
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    setRenderTarget() {},
    clear() {},
    clearDepth() {},
    render(scene, camera) {
      renders.push({ scene, camera, overrideMat: scene.overrideMaterial ?? null });
    },
    dispose() {},
  };
  return { renderer, renders };
}

test('R3 projected OBB decals reconstruct world position from depth and render onto separate target', () => {
  const { renderer, renders } = createMockWebGL2Renderer();
  const decals = createDecalSystem3D(THREE, { maxDecals: 8, mode: 'projected' });
  const h = decals.spawn({ position: [1, 2, 3], normal: [0, 1, 0], size: [2, 2, 1], color: 0xff5500 });
  assert.ok(h.id > 0);
  assert.equal(decals.getStats().mode, 'projected');
  assert.equal(h.mesh.material.glslVersion, THREE.GLSL3);

  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 5, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const fakeDepth = new THREE.DepthTexture(64, 64);
  const outCount = decals.renderProjected(renderer, cam, fakeDepth, 320, 180, null);
  assert.equal(outCount, 1);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].scene, decals.projectedScene);

  decals.dispose();
  fakeDepth.dispose();
});

test('R2 CSM uses single diffuse sun intensity and injects far-cascade shadow shader lookup + dual probe box-projection shader', () => {
  const scene = new THREE.Scene();
  const csm = createCascadedShadowMap3D(THREE, { cascades: 3, intensity: 2.0, scene });
  assert.equal(csm.lights[0].intensity, 2.0);
  assert.equal(csm.lights[1].intensity, 0);
  assert.equal(csm.lights[2].intensity, 0);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  csm.applyToMaterial(mat);
  assert.ok(mat.customProgramCacheKey().includes('hgame-csm-3'));

  const shaderStub = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <lights_fragment_end>',
  };
  mat.onBeforeCompile(shaderStub);
  assert.ok(shaderStub.vertexShader.includes('vCsmWorldPos'));
  assert.ok(shaderStub.fragmentShader.includes('hgameSampleCascadeShadow'));

  // Dual reflection probe shader box-projection
  const probes = createReflectionProbeManager3D(THREE, { blendMargin: 4 });
  probes.addProbe('roomA', { position: [0, 2, 0], min: [-5, 0, -5], max: [5, 4, 5], intensity: 1.0 });
  probes.addProbe('roomB', { position: [7, 2, 0], min: [4, 0, -5], max: [12, 4, 5], intensity: 0.6 });
  const evalMid = probes.evaluateAt([4.5, 2, 0]);
  const probeMat = new THREE.MeshStandardMaterial();
  probes.applyToMaterial(probeMat, evalMid);
  assert.equal(probeMat.userData._hgameProbeInjected, true);
  assert.ok(probeMat.userData._hgameProbeUniforms.uProbeBlendWeight.value > 0);

  const probeShader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <lights_fragment_maps>',
  };
  probeMat.onBeforeCompile(probeShader);
  assert.ok(probeShader.fragmentShader.includes('hgameBoxProjectDir'));

  csm.dispose();
  probes.dispose();
  mat.dispose();
  probeMat.dispose();
});

test('R4/A2 postPipeline renders auto reactiveMaskRT for hgameReactive meshes and executes compiled Render Graph', () => {
  const { renderer, renders } = createMockWebGL2Renderer();
  const pipeline = createPostPipeline3D({
    THREE,
    renderer,
    width: 320,
    height: 180,
    preset: { bloom: false, temporalAA: true },
    temporalAA: true,
    fxaa: true,
  });

  const world = new THREE.Scene();
  const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const vfx = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial());
  vfx.userData.hgameReactive = true;
  world.add(solid);
  world.add(vfx);

  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 2, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  pipeline.render(world, cam, { dt: 0.016 });
  assert.equal(pipeline.getTemporalStats().reactiveMeshCount, 1);
  // Reactive mask override render happened with solid hidden
  const maskDraw = renders.find(r => r.scene === world && r.overrideMat !== null);
  assert.ok(maskDraw, 'Reactive mask pass must render reactive meshes using overrideMaterial');
  assert.equal(solid.visible, true, 'Non-reactive mesh visibility must be restored');

  const execOrder = pipeline.getLastExecutedGraph();
  assert.ok(execOrder.includes('tone-mapping'), 'Tone-mapping pass must run via executeRenderGraph');

  pipeline.dispose();
});

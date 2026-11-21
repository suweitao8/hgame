import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  Scene,
  createStreamingResidencyPolicy,
  bindTextureMipStreaming,
  createCanvasUiRenderer,
} from '../assets/runtime/index.js';
import {
  createGpuIndirectCuller3D,
  createIndirectInstancedBatch3D,
} from '../assets/runtime/integrations/culling3d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import {
  solveFabrikIK,
  extractRootMotion,
  blendMorphTargets,
} from '../assets/runtime/animation/animator3d.js';

function createMockWebGL2Renderer() {
  const gl = {
    MAX_SAMPLES: 0x8d57,
    MAX_TEXTURE_SIZE: 0x0d33,
    depthRange() {},
    getParameter(p) { return p === 0x8d57 ? 4 : (p === 0x0d33 ? 8192 : 0); },
    getExtension(n) { return n === 'EXT_color_buffer_float' ? {} : null; },
  };
  return {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 },
    shadowMap: { enabled: false, type: 0 },
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
    render() {},
    dispose() {},
  };
}

test('P2 createIndirectInstancedBatch3D culls bounds, compacts matrices into InstancedMesh, and sets visible count', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 50);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  const renderer = createMockWebGL2Renderer();
  const namespace = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
  const adapter = createThreeAdapter({
    THREE: namespace,
    canvas: { clientWidth: 640, clientHeight: 360 },
    camera: cam,
    pixelRatio: 1,
    gpuIndirect: true,
  });

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x33aa66 });
  const batch = createIndirectInstancedBatch3D(THREE, { geometry: geo, material: mat, capacity: 100 });
  const m = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) {
    // 30 inside view in front of cam, 30 far behind cam at z = +40
    const z = i < 30 ? -5 : 40;
    const x = (i % 6) - 2.5;
    m.makeTranslation(x, 0, z);
    batch.setInstanceMatrix(i, m);
    batch.setInstanceBounds(i, x, 0, z, 0.8);
  }

  const scene = new Scene('indirect-test');
  adapter.add(scene, batch.mesh);
  adapter.registerIndirectBatch('crates', batch);
  adapter.render(scene);

  const bStats = batch.getStats();
  assert.equal(bStats.activeCount, 60);
  assert.equal(bStats.visibleCount, 30);
  assert.equal(bStats.culledOut, 30);
  assert.equal(batch.mesh.count, 30);
  assert.equal(adapter.getGpuSubmitStats().visibleCount, 30);
  assert.equal(adapter.getGpuSubmitStats().dispatchedInstances, 60);

  // Also test standalone culler + batch disposal
  const standaloneCuller = createGpuIndirectCuller3D({ maxInstances: 64 });
  assert.equal(standaloneCuller.dispose(), true);
  batch.dispose();
  adapter.dispose();
  geo.dispose();
  mat.dispose();
});

test('S2 solveFabrikIK reaches target across 4-bone chain, extractRootMotion tracks delta, blendMorphTargets interpolates weights', () => {
  const b0 = new THREE.Bone(); b0.position.set(0, 0, 0);
  const b1 = new THREE.Bone(); b1.position.set(0, 1, 0); b0.add(b1);
  const b2 = new THREE.Bone(); b2.position.set(0, 1, 0); b1.add(b2);
  const b3 = new THREE.Bone(); b3.position.set(0, 1, 0); b2.add(b3);
  b0.updateMatrixWorld(true);

  const target = { x: 1.5, y: 1.8, z: 0.4 };
  const solved = solveFabrikIK([b0, b1, b2, b3], target, {
    iterations: 20,
    tolerance: 0.002,
    poleTarget: [0, 1, 2],
  });
  assert.equal(solved, true);

  b0.updateMatrixWorld(true);
  const endPos = new THREE.Vector3();
  b3.getWorldPosition(endPos);
  const err = endPos.distanceTo(new THREE.Vector3(target.x, target.y, target.z));
  assert.ok(err < 0.05, `FABRIK 4-bone chain end effector must converge near target (err=${err})`);

  // Root motion delta extraction
  const root = new THREE.Object3D();
  const rmState = { x: 0, y: 0, z: 0, yaw: 0, initialized: false };
  root.position.set(1, 0, 2);
  extractRootMotion(root, rmState); // first sample initializes
  root.position.set(2.5, 0, 3.0);
  root.rotation.y = 0.25;
  const delta = extractRootMotion(root, rmState);
  assert.ok(Math.abs(delta.dx - 1.5) < 1e-6);
  assert.ok(Math.abs(delta.dz - 1.0) < 1e-6);
  assert.ok(Math.abs(delta.dyaw - 0.25) < 1e-3);

  // Morph targets
  const mesh = { morphTargetDictionary: { smile: 0, blink: 1 }, morphTargetInfluences: [0, 0.5] };
  assert.equal(blendMorphTargets(mesh, { smile: 1.0, blink: 0.0 }, 0.5), 2);
  assert.ok(Math.abs(mesh.morphTargetInfluences[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(mesh.morphTargetInfluences[1] - 0.25) < 1e-6);
});

test('S4 createCanvasUiRenderer lays out flex widgets, draws crisp outlined text, and handles click/slider/scroll hits', () => {
  let clicks = 0;
  let sliderVal = 0.2;
  const drawOps = [];
  const fakeCtx = {
    font: '', textAlign: '', textBaseline: '', lineWidth: 1, lineJoin: '', strokeStyle: '', fillStyle: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    roundRect() { drawOps.push('roundRect'); },
    fill() { drawOps.push('fill'); },
    stroke() { drawOps.push('stroke'); },
    strokeText(t) { drawOps.push(['strokeText', t]); },
    fillText(t) { drawOps.push(['fillText', t]); },
    arc() { drawOps.push('arc'); },
  };

  const ui = createCanvasUiRenderer({ dpr: 2 });
  const tree = {
    id: 'root',
    type: 'panel',
    direction: 'column',
    padding: 10,
    gap: 10,
    children: [
      { id: 'title', type: 'label', height: 24, text: 'HGAME' },
      { id: 'playBtn', type: 'button', height: 40, text: 'START', onClick: () => clicks++ },
      { id: 'volSlider', type: 'slider', height: 20, value: sliderVal, onChange: v => { sliderVal = v; } },
      { id: 'bagList', type: 'scrollList', height: 60, rowHeight: 30, items: ['A', 'B', 'C', 'D'] },
    ],
  };

  ui.render(fakeCtx, tree, 300, 240);
  assert.ok(drawOps.some(op => Array.isArray(op) && op[0] === 'strokeText' && op[1] === 'START'));

  // Click button at center (x=150, y=10+24+10+20 = 64)
  ui.pointerMove(150, 64);
  ui.pointerDown(150, 64);
  const clickedId = ui.pointerUp(150, 64);
  assert.equal(clickedId, 'playBtn');
  assert.equal(clicks, 1);

  // Drag slider at x=220 -> (220 - 10) / 280 = 0.75, y=10+24+10+40+10+10 = 104
  ui.pointerDown(220, 104);
  ui.pointerUp(220, 104);
  assert.ok(Math.abs(sliderVal - 0.75) < 0.02);

  // Scroll list (y = 10+24+10+40+10+20+10 + 10 = 134)
  const scrolled = ui.scroll(45, 150, 140);
  assert.equal(scrolled, 45);
});

test('A3 bindTextureMipStreaming swaps real texture image/anisotropy/needsUpdate on distance updates', () => {
  const policy = createStreamingResidencyPolicy({
    maxBytes: 16 * 1024 * 1024,
    nearDistance: 10,
    midDistance: 30,
    farDistance: 60,
  });
  const tex = { image: null, anisotropy: 1, needsUpdate: false, userData: {}, disposed: false, dispose() { this.disposed = true; } };
  const binding = bindTextureMipStreaming(policy, 'rock_albedo', tex, {
    position: { x: 0, y: 0, z: 0 },
    baseBytes: 4 * 1024 * 1024,
    mipSources: ['mip0_2048.png', 'mip1_1024.png', 'mip2_512.png', 'mip3_256.png'],
  });

  policy.update({ x: 5, y: 0, z: 0 }); // near -> mip 0
  assert.equal(tex.image, 'mip0_2048.png');
  assert.equal(tex.anisotropy, 16);
  assert.equal(tex.needsUpdate, true);
  assert.equal(binding.lastAppliedMip, 0);

  policy.update({ x: 45, y: 0, z: 0 }); // mid..far -> mip 2
  assert.equal(tex.image, 'mip2_512.png');
  assert.equal(tex.anisotropy, 4);
  assert.equal(binding.swaps, 2);

  binding.unbind();
  policy.dispose();
});

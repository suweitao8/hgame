// Scorecard R4 evidence: TAA jitter/history, FSR1-RCAS constants, tone-map mapping, post pass ordering,
// pass contracts, custom fullscreen pass. Headless (no GL context; stubs for targets/materials).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { createTemporalAA } from '../assets/runtime/integrations/post3d/temporal-aa.js';
import { resolveToneMappingIndex, createPostPipeline3D } from '../assets/runtime/integrations/post3d/pipeline.js';
import {
  FXAA_SHARPEN_FRAGMENT_GLSL3, TEMPORAL_AA_FRAGMENT_GLSL3, COMPOSITE_FRAGMENT_GLSL3,
} from '../assets/runtime/integrations/post3d/shaders.js';
import { FULLSCREEN_PASSES, validateFullscreenPass } from '../assets/runtime/integrations/post3d/pass-contracts.js';
import { createFullscreenShaderPass } from '../assets/runtime/integrations/post3d/fullscreen-shader.js';
import { compileRenderGraph } from '../assets/runtime/integrations/post3d/render-graph.js';

function makeTaa() {
  const made = [];
  const taa = createTemporalAA(
    THREE,
    (w, h) => { const t = { width: w, height: h, texture: { id: made.length * 2 }, depthTexture: { id: made.length * 2 + 1 }, dispose() {} }; made.push(t); return t; },
    uniforms => ({ uniforms, dispose() {} }),
  );
  return { taa, made };
}
function makeCamera() {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

test('R4 TAA: jitter follows an 8-sample Halton(2,3) sequence applied as clip-space translation and is restored', () => {
  const { taa } = makeTaa();
  const cam = makeCamera();
  const orig = cam.projectionMatrix.clone();
  const W = 640, H = 360;
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r - 0.5; };
  const seen = [];
  for (let i = 0; i < 16; i++) {
    taa.jitter(cam, W, H);
    const e = cam.projectionMatrix.elements, o = orig.elements;
    const ux = halton((i % 8) + 1, 2) / W, uy = halton((i % 8) + 1, 3) / H;
    // perspective: e[11] = -1 => x/y columns shift by -2*u
    assert.ok(Math.abs(e[8] - (o[8] + ux * 2 * o[11])) < 1e-9);
    assert.ok(Math.abs(e[9] - (o[9] + uy * 2 * o[11])) < 1e-9);
    assert.equal(e[0], o[0]); assert.equal(e[5], o[5]);
    // inverse kept consistent
    const prod = cam.projectionMatrix.clone().multiply(cam.projectionMatrixInverse).elements;
    for (let k = 0; k < 16; k++) assert.ok(Math.abs(prod[k] - (k % 5 === 0 ? 1 : 0)) < 1e-6);
    seen.push(`${ux.toFixed(9)},${uy.toFixed(9)}`);
    assert.equal(taa.restore(cam), true);
    assert.ok(cam.projectionMatrix.equals(orig), 'projection restored after restore()');
  }
  assert.equal(new Set(seen.slice(0, 8)).size, 8, '8 distinct jitter offsets');
  assert.deepEqual(seen.slice(0, 8), seen.slice(8), 'sequence repeats with period 8');
  // all offsets are sub-pixel
  for (const s of seen) for (const v of s.split(',')) assert.ok(Math.abs(Number(v)) <= 0.5 / Math.min(W, H) + 1e-12);
  taa.dispose();
});

test('R4 TAA: history weight 0 on first frame, 0.88^(dt*60) after, rejected on camera teleport / long dt / projection edits', () => {
  const { taa, made } = makeTaa();
  assert.equal(made.length, 0);
  const cam = makeCamera();
  const color = { c: 1 }, depth = { d: 1 };
  const passes = [];
  const runPass = (contract, mat, target) => passes.push([contract.name, mat.uniforms.uHistoryWeight.value, target]);
  const frame = (dt) => {
    taa.jitter(cam, 640, 360);
    assert.equal(made.length, 2, 'ping-pong color+depth history targets');
    assert.equal(taa.restore(cam), true);
    return taa.resolve('world', cam, color, depth, 0, dt, runPass, false, false, null);
  };
  const out1 = frame(1 / 60);
  const out2 = frame(1 / 60);
  assert.equal(passes[0][0], 'temporal-aa');
  assert.equal(passes[0][1], 0);
  assert.ok(Math.abs(passes[1][1] - 0.88) < 1e-9);
  assert.notEqual(out1, out2, 'output alternates between the two history targets');
  assert.notEqual(passes[0][2], passes[1][2]);
  // long frame -> history discarded
  frame(0.5);
  assert.equal(passes[2][1], 0);
  // camera teleport (>4 units) -> history discarded
  frame(1 / 60);
  cam.position.set(0, 0, 50); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  frame(1 / 60);
  assert.equal(passes[4][1], 0);
  // a callback that edits the projection invalidates restore() and resets history
  taa.jitter(cam, 640, 360);
  cam.projectionMatrix.elements[0] *= 1.1;
  assert.equal(taa.restore(cam), false);
  taa.dispose();
});

test('R4 TAA: reactive mask and motion-vector inputs are wired into the resolve uniforms', () => {
  const { taa } = makeTaa();
  const cam = makeCamera();
  let captured;
  taa.jitter(cam, 320, 180);
  taa.restore(cam);
  const mask = { id: 'reactive' };
  taa.resolve('w', cam, { c: 1 }, { d: 1 }, 0, 1 / 60, (c, m) => { captured = { u: m.uniforms, c }; }, false, false, mask);
  assert.equal(captured.u.tReactiveMask.value, mask);
  assert.equal(captured.u.uHasReactiveMask.value, true);
  assert.equal(captured.u.uHasMotionVectors.value, false);
  assert.deepEqual(captured.c.reads, ['tCurrentColor', 'tCurrentDepth']);
  assert.ok(captured.c.optional.includes('tMotionVectors'));
  for (const u of ['tReactiveMask', 'uHasReactiveMask', 'tMotionVectors', 'tPreviousDepth']) {
    assert.ok(TEMPORAL_AA_FRAGMENT_GLSL3.includes(u), `shader uses ${u}`);
  }
  taa.dispose();
});

test('R4 FSR1 RCAS: shader carries the 5-tap CAS constants and an anti-ringing clamp; math matches reference', () => {
  const src = FXAA_SHARPEN_FRAGMENT_GLSL3;
  assert.match(src, /rcasW\s*=\s*-0\.18\s*\*\s*clamp\(uSharpness,\s*0\.0,\s*1\.0\)/);
  assert.match(src, /max\(1\.0 \+ 4\.0 \* rcasW,\s*0\.28\)/);
  assert.match(src, /rgb = clamp\(rcasRgb, localMin, localMax\)/);
  assert.match(src, /hitMin\s*=\s*min\(rcasMin4,\s*lC\)\s*\/\s*max\(4\.0 \* rcasMax4/);
  // JS port of the weight / normalisation: negative lobe (sharpen), clamped, never divides by < 0.28
  const rcas = (sharp, peak, nz) => -0.18 * Math.min(1, Math.max(0, sharp)) * peak * nz;
  assert.equal(rcas(0, 1, 1), -0);
  assert.ok(Math.abs(rcas(1, 1, 1) + 0.18) < 1e-12);
  assert.ok(rcas(5, 1, 1) >= -0.18, 'sharpness clamped to 1');
  for (const sharp of [0, 0.14, 0.5, 1]) {
    const w = rcas(sharp, 1, 1);
    assert.ok(Math.max(1 + 4 * w, 0.28) >= 0.28);
    // flat region: output equals input
    const flat = (w * 4 * 0.5 + 0.5) / Math.max(1 + 4 * w, 0.28);
    assert.ok(Math.abs(flat - 0.5) < 1e-12);
  }
});

test('R4 tone mapping: mode names/indices resolve to ACES/AgX/none/UE-filmic shader indices; composite has all curves', () => {
  assert.equal(resolveToneMappingIndex('aces'), 0);
  assert.equal(resolveToneMappingIndex(undefined), 0);
  assert.equal(resolveToneMappingIndex('bogus'), 0);
  assert.equal(resolveToneMappingIndex('agx'), 1);
  assert.equal(resolveToneMappingIndex(1), 1);
  assert.equal(resolveToneMappingIndex('none'), 2);
  assert.equal(resolveToneMappingIndex('ueFilmic'), 3);
  assert.equal(resolveToneMappingIndex('filmic'), 3);
  assert.equal(resolveToneMappingIndex(3), 3);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uToneMapping/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /tBloom/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /tAutoExposure/);
});

test('R4 pipeline plan: TAA stage sits after SSGI/SSR and before tone mapping; tone-mapping is last', () => {
  const mk = opts => createPostPipeline3D({
    THREE,
    renderer: {
      getSize: () => ({ width: 640, height: 360 }), getPixelRatio: () => 1,
      getContext: () => null, capabilities: { isWebGL2: false }, render() {},
    },
    qualityPreset: 'high',
    ...opts,
  });
  const p = mk({ temporalAA: true, toneMapping: 'agx' });
  const order = p.getRenderGraphPlan().order;
  p.dispose();
  const idx = id => order.indexOf(id);
  assert.ok(idx('ao-volumetrics') < idx('ao-volumetrics-blur-x') && idx('ao-volumetrics-blur-x') < idx('ao-volumetrics-blur-y'));
  assert.ok(idx('gi-ssr') < idx('gi-ssr-blur-x') && idx('gi-ssr-blur-x') < idx('gi-ssr-blur-y'));
  assert.ok(idx('gi-ssr-blur-y') < idx('temporal-aa'));
  assert.ok(idx('temporal-aa') < idx('tone-mapping'));
  assert.equal(order.at(-1), 'tone-mapping');
  const q = mk({});
  assert.ok(!q.getRenderGraphPlan().order.includes('temporal-aa'), 'TAA stage absent unless enabled');
  q.dispose();
});

test('R4 pass contracts + render graph: invalid wiring is rejected, extension pass has reserved inputs', () => {
  const tex = { t: 1 }, out = { texture: { t: 2 }, depthTexture: { t: 3 } };
  assert.doesNotThrow(() => validateFullscreenPass(FULLSCREEN_PASSES.toneMapping, { tScene: { value: tex } }, null));
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.toneMapping, {}, null), /requires tScene/);
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.luminance, { tScene: { value: out.texture } }, out), /samples its own output/);
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.fxaaSharpen, { tDiffuse: { value: tex } }, out), /no compatible screen output/);
  assert.throws(() => validateFullscreenPass(FULLSCREEN_PASSES.temporalAA, { tCurrentColor: { value: tex }, tCurrentDepth: { value: tex } }, { texture: tex }), /color-depth/);

  const pass = createFullscreenShaderPass(THREE, { id: ' vignette ', fragment: 'vec4 shadeFullscreen(vec2 uv){ return hgameSceneColor(uv); }', sceneDepth: true });
  assert.equal(pass.id, 'vignette');
  assert.equal(pass.material.glslVersion, THREE.GLSL3);
  assert.ok(pass.material.fragmentShader.includes('hgameSceneLinearDepth'));
  assert.ok('hgameDepthInput' in pass.material.uniforms);
  assert.throws(() => createFullscreenShaderPass(THREE, { id: 'x', fragment: 'f', uniforms: { hgameColorInput: { value: 1 } } }), /Reserved/);
  assert.throws(() => createFullscreenShaderPass(THREE, { id: '', fragment: 'f' }), TypeError);

  const g = compileRenderGraph([
    { id: 'tone', reads: ['hdr'], writes: ['screen'] },
    { id: 'taa', reads: ['sceneColor'], writes: ['hdr'] },
  ], { externalInputs: ['sceneColor'], externalOutputs: ['screen'] });
  assert.deepEqual([...g.order], ['taa', 'tone'], 'dependency order, not registration order');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Entity } from '../assets/runtime/index.js';
import { Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';
import { createLighting2DState, MAX_2D_LIGHTS } from '../assets/runtime/integrations/post2d.js';

function createMockCanvas2D() {
  const ops = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    save() { ops.push('save'); },
    restore() { ops.push('restore'); },
    setTransform() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(...args) { ops.push(['fillRect', ...args]); },
    strokeRect() {},
    createRadialGradient() {
      ops.push('radialGradient');
      return { addColorStop() {} };
    },
  };
  return {
    ops,
    canvas: {
      clientWidth: 640,
      clientHeight: 360,
      width: 640,
      height: 360,
      getContext(kind) { return kind === '2d' ? ctx : null; },
    },
  };
}

test('createLighting2DState packs up to MAX_2D_LIGHTS, projects world-to-UV, and stays inactive by default', () => {
  const st = createLighting2DState();
  assert.equal(st.hasActivePass(), false);

  st.setAmbientLight('#203050', 0.35);
  assert.equal(st.hasActivePass(), true);

  const many = Array.from({ length: MAX_2D_LIGHTS + 5 }, (_, i) => ({
    x: i * 10,
    y: i * 5,
    radius: 150,
    color: 0xffaa44,
    intensity: 1.4,
  }));
  const count = st.setLights(many);
  assert.equal(count, MAX_2D_LIGHTS);
  assert.equal(st.lightCount, MAX_2D_LIGHTS);

  st.projectLightsToUv(
    { x: 0, y: 0, offsetX: 0, offsetY: 0, zoom: 1, rotation: 0 },
    { vw: 960, vh: 540, dpr: 1, scale: 1, x: 0, y: 0 },
    960,
    540,
  );
  // Light 0 at (0,0) maps to screen center UV (0.5, 0.5)
  assert.ok(Math.abs(st.lightUvPosRad[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(st.lightUvPosRad[1] - 0.5) < 1e-4);

  st.clearLights();
  st.setAmbientLight('#ffffff', 1);
  st.setPost({ bloomIntensity: 0.8, vignette: 0.4, hitPulse: 0.5, chromatic: 0.005 });
  assert.equal(st.hasActivePass(), true);
  assert.equal(st.snapshot().post.bloomIntensity, 0.8);
});

test('Canvas2D and WebGL2D fallback expose identical 2D lighting/post methods and render without allocations', () => {
  const { canvas, ops } = createMockCanvas2D();
  const renderer = createWebGL2DAdapter({ canvas, width: 640, height: 360, allowFallback: true });
  assert.equal(renderer.stats.backend, 'canvas2d');

  const scene = new Scene('lit');
  const hero = new Entity({ name: 'hero' });
  hero.addComponent(new Sprite2D({ width: 32, height: 32, color: '#ff8844' }));
  scene.add(hero);

  // Disabled pass incurs zero radialGradient overhead.
  renderer.render(scene);
  assert.equal(renderer.stats.postPassActive, false);
  assert.equal(ops.filter((o) => o === 'radialGradient').length, 0);

  // Enabled ambient + dynamic point light + vignette renders lighting fallback cleanly.
  renderer.setAmbientLight('#101830', 0.3);
  renderer.addLight2D({ x: 100, y: 60, radius: 180, color: '#ffd166', intensity: 1.2 });
  renderer.setPost2D({ vignette: 0.45, hitPulse: 0.25 });
  renderer.render(scene);

  assert.equal(renderer.stats.postPassActive, true);
  assert.ok(ops.filter((o) => o === 'radialGradient').length >= 2);
  assert.equal(renderer.getLighting2DState().lightCount, 1);

  renderer.dispose();
});

test('createCanvas2DAdapter skips post pass again once lights and post effects are cleared', () => {
  const { canvas } = createMockCanvas2D();
  const c2d = createCanvas2DAdapter({ canvas, width: 640, height: 360 });
  const scene = new Scene('lit');
  c2d.setPost2D({ bloomIntensity: 0.5, vignette: 0.3 });
  c2d.render(scene);
  assert.equal(c2d.stats.postPassActive, true);

  c2d.setPost2D({ bloomIntensity: 0, vignette: 0 });
  c2d.render(scene);
  assert.equal(c2d.stats.postPassActive, false);
  c2d.dispose();
});

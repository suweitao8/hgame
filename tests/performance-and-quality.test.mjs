import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from '../assets/optional/three/three.module.js';
import { defineProject, Entity, Scene } from '../assets/runtime/index.js';
import {
  Camera2D,
  Sprite2D,
  SpriteCrowd2D,
  createCanvas2DAdapter,
} from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';
import {
  QUALITY_TIERS,
  QUALITY2D_PRESETS,
  QUALITY3D_PRESETS,
  resolveQualityPreset,
} from '../assets/runtime/integrations/quality3d.js';
import {
  createFrustumCuller3D,
  createOcclusionCuller3D,
  createHardwareOcclusionPool,
  createSceneCuller3D,
  createInstancedBatch3D,
} from '../assets/runtime/integrations/culling3d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import { createModel3DProvider } from '../assets/runtime/integrations/model3d.js';
import { createWorldMaterialPalette } from '../assets/runtime/integrations/world-aligned-material.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function makeMockCanvas2D({ width = 960, height = 540 } = {}) {
  const ops = { fillRect: 0, drawImage: 0, arc: 0, fillText: 0, save: 0, sourceIn: 0 };
  const makeCtx = () => ({
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    font: '20px sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: true,
    save() { ops.save++; },
    restore() {},
    setTransform() {},
    transform() {},
    translate() {},
    rotate() {},
    scale() {},
    clearRect() {},
    beginPath() {},
    arc() { ops.arc++; },
    fill() {},
    fillRect() { ops.fillRect++; },
    drawImage() { ops.drawImage++; },
    fillText() { ops.fillText++; },
    measureText(t) { return { width: t.length * 10 }; },
  });
  const ctx = makeCtx();
  // Track source-in tint compositing calls cleanly via proxy setter
  const trackedCtx = new Proxy(ctx, {
    set(target, prop, value) {
      if (prop === 'globalCompositeOperation' && value === 'source-in') ops.sourceIn++;
      target[prop] = value;
      return true;
    },
  });
  return {
    ops,
    canvas: {
      clientWidth: width,
      clientHeight: height,
      width,
      height,
      getContext(type) {
        return type === '2d' ? trackedCtx : null;
      },
    },
  };
}

function makeMockBufferFactory() {
  const created = [];
  const createBufferCanvas = (w, h) => {
    const ops = { drawImage: 0, fillRect: 0, sourceIn: 0 };
    const ctx = {
      globalCompositeOperation: 'source-over',
      fillStyle: '#fff',
      font: '20px sans-serif',
      textAlign: 'center',
      textBaseline: 'middle',
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      drawImage() { ops.drawImage++; },
      fillRect() {
        if (this.globalCompositeOperation === 'source-in') ops.sourceIn++;
        ops.fillRect++;
      },
      fillText() {},
      measureText(t) { return { width: t.length * 10 }; },
    };
    const buf = {
      width: w,
      height: h,
      ops,
      getContext(type) { return type === '2d' ? ctx : null; },
    };
    created.push(buf);
    return buf;
  };
  return { created, createBufferCanvas };
}

function makeMockWebGL2Canvas({ width = 960, height = 540, renderer = 'Generic GPU' } = {}) {
  const listeners = new Map();
  const glCalls = {
    drawArraysInstanced: [],
    drawArrays: [],
    instanceUploads: [],
    texImage2D: 0,
    liveTextures: new Set(),
  };
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    RGBA32F: 0x8814,
    UNSIGNED_BYTE: 0x1401,
    SCISSOR_TEST: 0x0c11,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TEXTURE0: 0x84c0,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    getExtension(name) {
      return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
    },
    getParameter(parameter) { return parameter === 0x9246 ? renderer : null; },
    createShader(type) { return { type }; },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; },
    deleteShader() {},
    createProgram() { return { id: 1 }; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    getProgramInfoLog() { return ''; },
    deleteProgram() {},
    getUniformLocation(_p, name) { return { name }; },
    createVertexArray() { return { vao: true }; },
    bindVertexArray() {},
    deleteVertexArray() {},
    createBuffer() { return { buf: true }; },
    bindBuffer() {},
    bufferData() {},
    bufferSubData() {},
    deleteBuffer() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor() {},
    createTexture() {
      const texture = {};
      glCalls.liveTextures.add(texture);
      return texture;
    },
    bindTexture(_target, texture) {
      assert.ok(texture === null || glCalls.liveTextures.has(texture), 'cannot bind a deleted WebGL texture');
    },
    texParameteri() {},
    texImage2D() { glCalls.texImage2D++; },
    texSubImage2D(_target, _level, _x, _y, width, height, _format, type, data) {
      assert.equal(type, this.FLOAT);
      assert.ok(data.length >= width * height * 4);
      glCalls.instanceUploads.push({ width, height, x: data[4] });
    },
    deleteTexture(texture) { glCalls.liveTextures.delete(texture); },
    disable() {},
    enable() {},
    scissor() {},
    viewport() {},
    clearColor() {},
    clear() {},
    blendFunc() {},
    useProgram() {},
    activeTexture() {},
    uniform1i() {},
    uniform4f() {},
    drawArraysInstanced(mode, first, count, primcount) {
      glCalls.drawArraysInstanced.push({ mode, first, count, primcount });
    },
    drawArrays(mode, first, count) { glCalls.drawArrays.push({ mode, first, count }); },
  };

  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    getContext(type) { return type === 'webgl2' ? gl : null; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name, evt = {}) {
      const fn = listeners.get(name);
      if (fn) fn({ preventDefault() {}, ...evt });
    },
  };
  return { canvas, gl, glCalls };
}

test('Canvas2D sorts mixed depth items transitively and reuses an equal clip rectangle', () => {
  const { canvas } = makeMockCanvas2D({ width: 100, height: 100 });
  const ctx = canvas.getContext('2d');
  const trace = [];
  const stack = [];
  ctx.save = () => stack.push(ctx.globalCompositeOperation);
  ctx.restore = () => { ctx.globalCompositeOperation = stack.pop(); };
  ctx.rect = (...args) => trace.push(['clip-rect', ...args]);
  ctx.clip = () => {};
  ctx.fillRect = () => trace.push([ctx.fillStyle, ctx.globalCompositeOperation]);
  ctx.fillText = text => trace.push([text, ctx.globalCompositeOperation]);
  const adapter = createCanvas2DAdapter({ canvas, width: 100, height: 100, background: '#000000' });
  const scene = new Scene('draw-order');
  const sprites = [
    [30, new Sprite2D({ color: '#303030' })],
    [10, new Sprite2D({ shape: 'text', text: 'label', blendMode: 'add', clipRect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })],
    [20, new SpriteCrowd2D({ capacity: 1, ySort: true, color: '#202020', blendMode: 'add', clipRect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })],
  ];
  sprites[2][1].spawn({ x: 0, y: 0 });
  for (const [y, sprite] of sprites) scene.add(new Entity({ y })).addComponent(sprite);
  scene._setActive(true);
  adapter.render(scene);
  assert.deepEqual(trace, [
    ['#000000', 'source-over'], ['clip-rect', 25, 25, 50, 50],
    ['label', 'lighter'], ['#202020', 'lighter'], ['#303030', 'source-over'],
  ]);
  assert.equal(stack.length, 0);
  assert.equal(ctx.globalCompositeOperation, 'source-over');
  trace.length = 0;
  sprites[1][1].clipRect = { x: 0, y: 0, width: 1, height: 1 };
  adapter.render(scene);
  assert.deepEqual(trace[1], ['clip-rect', 0, 0, 100, 100]);
  sprites[1][1].customDraw = () => { throw new Error('drawing failed'); };
  assert.throws(() => adapter.render(scene), /drawing failed/);
  assert.equal(stack.length, 0);
  assert.equal(ctx.globalCompositeOperation, 'source-over');
  adapter.dispose();
});

test('WebGL2D batches adjacent compatible items without crossing blend or clip boundaries', () => {
  const { canvas, gl } = makeMockWebGL2Canvas({ width: 100, height: 100 });
  const adapter = createWebGL2DAdapter({ canvas, width: 100, height: 100, allowFallback: false });
  const scene = new Scene('batch-order');
  gl.ONE = 1;
  let clip, blend;
  const draws = [];
  gl.scissor = (...args) => { clip = args; };
  gl.blendFunc = (_src, dst) => { blend = dst; };
  gl.drawArraysInstanced = (_mode, _first, _count, instances) => draws.push({ clip, blend, instances });
  const rect = () => ({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
  for (const mode of [
    { blendMode: 'add', clipRect: rect() }, { blendMode: 'add', clipRect: rect() },
    {}, { blendMode: 'add', clipRect: rect() },
    { clipRect: { x: 0.25, y: 0, width: 0, height: 1 } },
  ]) scene.add(new Entity()).addComponent(new Sprite2D(mode));
  scene._setActive(true);
  adapter.render(scene);
  assert.deepEqual(draws, [
    { clip: [25, 50, 50, 40], blend: gl.ONE, instances: 2 },
    { clip: [0, 0, 100, 100], blend: gl.ONE_MINUS_SRC_ALPHA, instances: 1 },
    { clip: [25, 50, 50, 40], blend: gl.ONE, instances: 1 },
  ]);
  assert.equal(adapter.stats.drawCalls, 3);
  draws.length = 0;
  adapter.setViews([{ camera: adapter.camera, width: 0.5 }, { camera: adapter.camera, x: 0.5, width: 0.5 }]);
  adapter.render(scene);
  assert.deepEqual(draws.map(draw => draw.clip), [
    [13, 50, 25, 40], [0, 0, 50, 100], [13, 50, 25, 40],
    [63, 50, 25, 40], [50, 0, 50, 100], [63, 50, 25, 40],
  ]);
  adapter.dispose();
});

test('Pixi ordered draw groups share adjacent clips and keep a stable mixed draw order', async () => {
  const { createPixiDrawGroups, synchronizePixiCanvasBlend } = await import('../assets/profiles/pixi2d/src/engine/PixiDrawGroups.js');
  const order = await import('../assets/runtime/integrations/draw-order-2d.js');
  class Container {
    children = [];
    parent = null;
    addChild(child) { this.addChildAt(child, this.children.length); }
    addChildAt(child, index) { child.removeFromParent(); this.children.splice(index, 0, child); child.parent = this; }
    removeFromParent() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    destroy({ children } = {}) {
      this.removeFromParent();
      for (const child of [...this.children]) {
        child.removeFromParent();
        if (children) child.destroy();
      }
      this.destroyed = true;
    }
  }
  class Graphics extends Container {
    clear() { return this; }
    rect(...bounds) { this.bounds = bounds; return this; }
    fill() { return this; }
  }
  const root = new Container(), stage = new Container();
  const removed = [];
  const groups = createPixiDrawGroups({ root, stage, Container, Graphics, order,
    onRemove(container) { removed.push(container.children[0].name); },
  });
  const rect = () => ({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
  const sprite = groups.create({ y: 30 });
  const text = groups.create({ y: 10, clipRect: rect() });
  const swarm = groups.create({ y: 20, ySort: true, clipRect: rect(), blendMode: 'add' });
  const tiles = groups.create({ layer: -1 });
  for (const [name, group] of Object.entries({ sprite, text, swarm, tiles })) {
    const child = new Container();
    child.name = name;
    groups.getContainer(group).addChild(child);
  }
  const names = () => root.children.filter(run => run.visible).flatMap(run => run.children.map(group => group.children[0].name));
  groups.prepare(100, 100);
  assert.deepEqual(names(), ['tiles', 'text', 'swarm', 'sprite']);
  assert.equal(stage.children.length, 1);
  const mask = stage.children[0];
  assert.deepEqual(mask.bounds, [25, 10, 50, 40]);
  assert.equal(text.container.parent, swarm.container.parent);
  assert.equal(swarm.container.blendMode, 'add');
  groups.prepare(200, 150);
  assert.equal(stage.children[0], mask);
  assert.deepEqual(mask.bounds, [50, 15, 100, 60]);
  sprite.setOrder({ y: 15 });
  groups.prepare(200, 150);
  assert.deepEqual(names(), ['tiles', 'text', 'sprite', 'swarm']);
  assert.equal(stage.children.length, 2);
  assert.equal(swarm.dispose(), true);
  assert.deepEqual(removed, ['swarm']);
  groups.prepare(200, 150);
  assert.deepEqual(names(), ['tiles', 'sprite', 'text']);
  assert.throws(() => groups.getContainer(swarm), /active draw group/i);
  groups.dispose();
  assert.equal(stage.children.length, 0);
  assert.equal(root.destroyed, true);
  const ctx = { globalCompositeOperation: 'source-over' };
  const system = {
    activeContext: ctx, blendModes: { normal: 'source-over', add: 'lighter' }, current: 'normal',
    setBlendMode(mode) {
      if (this.current === mode) return;
      this.current = mode;
      ctx.globalCompositeOperation = this.blendModes[mode];
    },
  };
  const restoreBlend = synchronizePixiCanvasBlend(system);
  system.setBlendMode('add');
  ctx.globalCompositeOperation = 'source-over'; // A native mask restore bypasses Pixi's cache.
  system.setBlendMode('add');
  assert.equal(ctx.globalCompositeOperation, 'lighter');
  restoreBlend();
  ctx.globalCompositeOperation = 'source-over';
  system.setBlendMode('add');
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('repository carries Apache-2.0 LICENSE and consistent package metadata with third-party notices preserved', async () => {
  const licenseText = await readFile(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(licenseText, /Apache License/);
  assert.match(licenseText, /Version 2\.0/);

  const manifestPaths = [
    'package.json',
    'assets/template/package.json',
    'network/package.json',
    'network/packages/protocol/package.json',
    'network/packages/simulation/package.json',
    'network/packages/client/package.json',
    'network/apps/server/package.json',
    'network/apps/network-lab/package.json',
  ];
  for (const rel of manifestPaths) {
    const pkg = JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
    assert.equal(pkg.license, 'Apache-2.0', `${rel} should specify Apache-2.0`);
  }

  const rapierNotice = await readFile(path.join(ROOT, 'assets/runtime/vendor/LICENSE-rapier.txt'), 'utf8');
  assert.match(rapierNotice, /Apache License/i);
  const threeLicense = await readFile(path.join(ROOT, 'assets/optional/three/LICENSE'), 'utf8');
  assert.match(threeLicense, /MIT License/);
});

test('2D runtime scales to 5,000 Entity+Sprite2D & 10,000 SpriteCrowd2D without per-frame GC or uncached tint churn', () => {
  const glProject = defineProject({ profile: '2d', renderer: 'webgl2d' });
  assert.equal(glProject.renderer, 'webgl2d');
  assert.throws(() => defineProject({ profile: '2d', renderer: 'threejs' }), /profile|renderer/i);

  const { canvas } = makeMockCanvas2D({ width: 1280, height: 720 });
  const bufFactory = makeMockBufferFactory();
  const adapter = createCanvas2DAdapter({
    canvas,
    width: 1280,
    height: 720,
    createBufferCanvas: bufFactory.createBufferCanvas,
  });

  // 1) 5,000 standard Entity + Sprite2D inside camera frustum with monotonic layer order (sort skipped!)
  const scene5k = new Scene('horde-5k');
  const texImage = { width: 32, height: 32, naturalWidth: 32, naturalHeight: 32 };
  for (let i = 0; i < 5000; i++) {
    const e = scene5k.add(new Entity({
      x: (i % 100) * 10 - 500,
      y: Math.floor(i / 100) * 10 - 250,
    }));
    e.addComponent(new Sprite2D({
      shape: 'image',
      image: texImage,
      width: 16,
      height: 16,
      tint: '#ff4444',
      layer: 1,
      z: 0,
      ySort: false,
    }));
  }

  scene5k._setActive(true);
  scene5k._capturePreviousTransforms();
  scene5k._run('update', 1 / 60);
  adapter.render(scene5k);
  assert.equal(adapter.stats.drawnSprites, 5000);
  assert.equal(adapter.stats.sorted, false, 'Monotonic non-ySort batch should skip O(N log N) sort');
  // WeakMap tint cache reuses cached silhouette buffer across all 5,000 identically tinted sprites!
  assert.equal(bufFactory.created.length, 1);

  // Frame 2 reuses exact cached buffer without creating any new offscreen canvas
  adapter.render(scene5k);
  assert.equal(bufFactory.created.length, 1);

  // Changing tint on one sprite updates cleanly without uncached per-entity explosion
  scene5k.objects[0].components[0].tint = '#44ff88';
  const opsBefore = bufFactory.created[0].ops.sourceIn;
  adapter.render(scene5k);
  assert.ok(bufFactory.created.length <= 2);
  assert.ok(bufFactory.created.reduce((s, b) => s + b.ops.sourceIn, 0) >= opsBefore);

  // 2) 10,000 SpriteCrowd2D SoA horde with O(1) swap-back kill, hitFlash fadeout, and frustum culling
  const crowdScene = new Scene('crowd-10k');
  const crowdHost = crowdScene.add(new Entity({ x: 0, y: 0 }));
  const crowd = crowdHost.addComponent(new SpriteCrowd2D({
    capacity: 12000,
    width: 24,
    height: 24,
    image: texImage,
    groundShadow: true,
    layer: 2,
  }));
  crowdScene._setActive(true);

  const ids = [];
  for (let i = 0; i < 10000; i++) {
    // 8,000 inside viewport, 2,000 far off-screen
    const inView = i < 8000;
    ids.push(crowd.spawn({
      x: inView ? ((i % 80) * 12 - 480) : 5000,
      y: inView ? (Math.floor(i / 80) * 6 - 300) : 5000,
    }));
  }
  assert.equal(crowd.count, 10000);

  // Swap-back remove 500 active agents (in-view indices 0..499)
  for (let i = 0; i < 500; i++) {
    assert.equal(crowd.kill(ids[i]), true);
  }
  assert.equal(crowd.kill(ids[0]), false, 'Double-free is ignored safely');
  assert.equal(crowd.count, 9500);

  // Trigger hitFlash on agent 500, step time, verify flash decays cleanly
  assert.equal(crowd.hitFlash(ids[500], 0.1), true);
  assert.ok(crowd.flash[ids[500]] > 0.9);
  crowd.update(0.05);
  assert.ok(crowd.flash[ids[500]] > 0.4 && crowd.flash[ids[500]] < 0.6);
  crowd.update(0.06);
  assert.equal(crowd.flash[ids[500]], 0);

  adapter.render(crowdScene);
  assert.equal(adapter.stats.drawnCrowds, 1);
  assert.equal(adapter.stats.culled, 2000, '2,000 off-screen crowd instances culled before ctx draw');
  adapter.dispose();
});

test('WebGL2D adapter batches 3,000 textured sprites + ground shadows into 1 draw call and falls back to Canvas2D cleanly', () => {
  const { canvas, glCalls } = makeMockWebGL2Canvas({ width: 960, height: 540 });
  const adapter = createWebGL2DAdapter({ canvas, width: 960, height: 540, quality: 'high' });
  assert.equal(adapter.isWebGL2, true);
  assert.equal(adapter.stats.backend, 'webgl2');

  const scene = new Scene('webgl-3k');
  const tex = { width: 32, height: 32, naturalWidth: 32, naturalHeight: 32 };
  const host = scene.add(new Entity({ x: 0, y: 0 }));
  const crowd = host.addComponent(new SpriteCrowd2D({
    capacity: 4000,
    width: 32,
    height: 32,
    image: tex,
    groundShadow: true,
  }));
  scene._setActive(true);
  for (let i = 0; i < 3000; i++) {
    const id = crowd.spawn({ x: (i % 60) * 14 - 420, y: Math.floor(i / 60) * 9 - 225, tint: '#77ddff' });
    if (i % 10 === 0) crowd.hitFlash(id, 0.1);
  }

  adapter.render(scene);
  assert.equal(adapter.stats.drawCalls, 1, '3,000 shadows + 3,000 sprites share 1 instanced draw call');
  assert.equal(adapter.stats.instances, 6000);
  assert.equal(glCalls.drawArraysInstanced.length, 1);
  assert.deepEqual(glCalls.drawArraysInstanced[0], {
    mode: 0x0005, first: 0, count: 4, primcount: 6000,
  });

  // Context loss halts draws and restore rebuilds GPU state cleanly
  canvas.dispatch('webglcontextlost');
  assert.equal(adapter.contextLost, true);
  glCalls.drawArraysInstanced.length = 0;
  adapter.render(scene);
  assert.equal(glCalls.drawArraysInstanced.length, 0);

  canvas.dispatch('webglcontextrestored');
  assert.equal(adapter.contextLost, false);
  adapter.render(scene);
  assert.equal(glCalls.drawArraysInstanced.length, 1);
  assert.equal(glCalls.liveTextures.size, 2, 'both white and sprite textures were recreated');
  adapter.dispose();
  assert.equal(glCalls.liveTextures.size, 0);

  // Automatic fallback when WebGL2 context is null
  const { canvas: canvas2dOnly } = makeMockCanvas2D({ width: 960, height: 540 });
  const fallback = createWebGL2DAdapter({ canvas: canvas2dOnly, width: 960, height: 540 });
  assert.equal(Boolean(fallback.isWebGL2), false);
  assert.equal(fallback.stats.backend, 'canvas2d');
  fallback.dispose();
});

test('WebGL2D diagnostics include world and bloom submissions with unique attachment bytes', () => {
  const { canvas, gl } = makeMockWebGL2Canvas({ width: 320, height: 180 });
  // Enable the native post path on the test context.
  Object.assign(gl, { createFramebuffer: () => ({}), bindFramebuffer() {}, framebufferTexture2D() {},
    deleteFramebuffer() {}, uniform4fv() {}, uniform2f() {}, uniform1f() {}, drawArrays() {} });
  const adapter = createWebGL2DAdapter({ canvas, width: 320, height: 180, pixelRatio: 1, diagnostics2d: true });
  const scene = new Scene('gl-diagnostics');
  scene.add(new Entity()).addComponent(new Sprite2D({ width: 12, height: 12 }));
  scene._setActive(true);
  adapter.setPost2D({ bloomIntensity: 1 });
  const original = gl.drawArrays;
  adapter.render(scene);
  const snapshot = adapter.getRenderDiagnostics();
  assert.deepEqual(snapshot.passes.map(({ name, drawCalls }) => [name, drawCalls]), [
    ['world', 1], ['bloom-extract', 1], ['bloom-blur-x', 1], ['bloom-blur-y', 1], ['lighting-composite', 1],
  ]);
  assert.equal(snapshot.drawCalls, 5);
  assert.equal(snapshot.triangles, 6);
  assert.equal(snapshot.targets.length, 3);
  assert.equal(snapshot.estimatedTargetBytes, 320 * 180 * 4 + 2 * 160 * 90 * 4);
  assert.ok(snapshot.uploads.bufferBytes > 0);
  assert.equal(gl.drawArrays, original);
  canvas.dispatch('webglcontextlost');
  assert.equal(adapter.getRenderDiagnostics(), null);
  adapter.dispose();
});

test('WebGL2D fetches SwiftShader batch instances from a texture and restores that texture after context loss', () => {
  const { canvas, gl, glCalls } = makeMockWebGL2Canvas({ renderer: 'ANGLE (SwiftShader Device)' });
  const adapter = createWebGL2DAdapter({ canvas, maxBatchInstances: 129 });
  const scene = new Scene('software-batch');
  const crowd = scene.add(new Entity()).addComponent(new SpriteCrowd2D({ capacity: 130, width: 4, height: 4 }));
  scene._setActive(true);
  for (let i = 0; i < 130; i++) crowd.spawn({ x: i, y: 0 });

  adapter.render(scene);
  assert.equal(glCalls.drawArraysInstanced.length, 0);
  assert.deepEqual(glCalls.drawArrays.map(draw => draw.count), [129 * 6, 6]);
  assert.ok(glCalls.drawArrays.every(draw => draw.mode === gl.TRIANGLES && draw.first === 0));
  assert.deepEqual(glCalls.instanceUploads.map(upload => [upload.height, upload.x]), [[2, -2], [1, 127]]);
  assert.equal(adapter.stats.instances, 130);
  assert.equal(glCalls.liveTextures.size, 2);

  canvas.dispatch('webglcontextlost');
  adapter.render(scene);
  assert.equal(glCalls.drawArrays.length, 2);
  canvas.dispatch('webglcontextrestored');
  adapter.render(scene);
  assert.equal(glCalls.drawArrays.length, 3);
  assert.equal(glCalls.liveTextures.size, 2);
  adapter.dispose();
  assert.equal(glCalls.liveTextures.size, 0);
});

test('WebGL2D releases evicted text textures after drawing any queued use this frame', () => {
  const { canvas, glCalls } = makeMockWebGL2Canvas();
  const { createBufferCanvas } = makeMockBufferFactory();
  const adapter = createWebGL2DAdapter({ canvas, createBufferCanvas });
  const scene = new Scene('changing-text');
  const label = scene.add(new Entity()).addComponent(new Sprite2D({ shape: 'text' }));
  const next = scene.add(new Entity()).addComponent(new Sprite2D({ shape: 'text', visible: false }));
  scene._setActive(true);
  for (let i = 0; i < 128; i++) {
    label.text = `Score ${i}`;
    adapter.render(scene);
  }
  assert.equal(glCalls.liveTextures.size, 129);
  label.text = 'Score 0';
  next.text = 'Score 128';
  next.visible = true;
  adapter.render(scene);
  assert.equal(glCalls.liveTextures.size, 129, 'the oldest GPU texture was released');
  for (let i = 129; i < 400; i++) {
    next.text = `Score ${i}`;
    adapter.render(scene);
  }
  assert.equal(glCalls.liveTextures.size, 129, 'dynamic text has a bounded texture cache');
  adapter.dispose();
  assert.equal(glCalls.liveTextures.size, 0);
});

test('WebGL2D retries the same image after its first upload throws', () => {
  const { canvas, gl, glCalls } = makeMockWebGL2Canvas();
  const adapter = createWebGL2DAdapter({ canvas });
  const scene = new Scene('late-image');
  const image = { width: 32, height: 32 };
  scene.add(new Entity()).addComponent(new Sprite2D({ image }));
  scene._setActive(true);
  const upload = gl.texImage2D;
  let attempts = 0;
  gl.texImage2D = (...args) => {
    if (++attempts === 1) throw new Error('Image not ready');
    upload(...args);
  };
  assert.throws(() => adapter.render(scene), /Image not ready/);
  const retainedAfterFailure = glCalls.liveTextures.size;
  adapter.render(scene);
  assert.equal(attempts, 2, 'a failed upload was not cached');
  assert.equal(retainedAfterFailure, 1, 'only the white texture survived the failed upload');
  assert.equal(glCalls.liveTextures.size, 2);
  adapter.dispose();
  assert.equal(glCalls.liveTextures.size, 0);
});

test('WebGL2D customDraw reuses its upload resources while drawing fresh content every frame', () => {
  const { canvas, glCalls } = makeMockWebGL2Canvas();
  const { createBufferCanvas, created } = makeMockBufferFactory();
  const adapter = createWebGL2DAdapter({ canvas, createBufferCanvas });
  const scene = new Scene('custom-drawing');
  let calls = 0;
  const customDraw = ctx => { calls++; ctx.fillRect(0, 0, 16, 16); };
  const first = scene.add(new Entity()).addComponent(new Sprite2D({ width: 32, height: 32, customDraw }));
  scene.add(new Entity({ x: 128 })).addComponent(new Sprite2D({ width: 64, height: 48, customDraw }));
  scene._setActive(true);
  for (let i = 0; i < 180; i++) {
    first.width = 32 + i % 2;
    adapter.render(scene);
  }
  assert.equal(calls, 360);
  assert.equal(glCalls.drawArraysInstanced.length, 360, 'each upload is drawn before the next one overwrites it');
  assert.equal(glCalls.liveTextures.size, 2, 'only the white and scratch textures remain allocated');
  assert.equal(created.length, 1, 'the scratch canvas is reused');
  adapter.dispose();
  assert.equal(glCalls.liveTextures.size, 0);
});

test('3D frustum culling, convex-cone software occlusion, hardware occlusion queries, and InstancedBatch3D compaction', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 200);
  camera.position.set(0, 2, 15);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const mockQueries = {
    ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8d6a,
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    resultSamples: 0,
    createQuery() { return { id: 1 }; },
    beginQuery() {},
    endQuery() {},
    getQueryParameter(_q, pname) {
      if (pname === this.QUERY_RESULT_AVAILABLE) return true;
      if (pname === this.QUERY_RESULT) return this.resultSamples;
      return 0;
    },
    deleteQuery() {},
  };

  const culler = createSceneCuller3D({
    maxDistance: 60,
    occlusion: true,
    gl: mockQueries,
  });

  // Register opaque wall between camera (z=15) and far corridor (z<4)
  culler.addOccluderAABB({ min: [-6, 0, 4], max: [6, 6, 6] });
  culler.beginFrame(camera);

  // Frustum checks
  assert.equal(culler.testSphere(0, 2, 8, 1), true, 'In front of wall & inside frustum');
  assert.equal(culler.testSphere(0, 2, 25, 1), false, 'Behind camera');
  assert.equal(culler.testSphere(0, 2, -60, 1), false, 'Beyond maxDistance 60');

  // Convex-cone software occlusion checks
  assert.equal(culler.testSphere(0, 2, -5, 1), false, 'Completely hidden behind wall -> occluded');
  // Camera y=2, z=15 over wall top y=6 at z=4 projects top boundary to y=10.89 at z=-5;
  // center y=10.2 is behind the top ray, while top-tangent y+r=11.2 peeks above -> visible!
  assert.equal(culler.testSphere(0, 10.2, -5, 1), true, 'Peeking over top edge of wall -> visible');

  // Hardware occlusion pool graceFrames prevents 1-frame pop-out before confirming hidden
  const hw = culler.hardwarePool;
  assert.equal(hw.supported, true);
  for (let f = 0; f < 3; f++) {
    hw.beginQuery('wall-prop');
    hw.endQuery('wall-prop');
    const occluded = hw.poll('wall-prop');
    if (f < 2) assert.equal(occluded, false, 'Grace frames keep prop visible on early zero-sample frames');
    else assert.equal(occluded, true, 'Culled once consecutive hidden frames exceed graceFrames');
  }

  // Dynamic GPU InstancedBatch3D (alloc / free / frustum + occlusion flush)
  const batch = createInstancedBatch3D(THREE, {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshStandardMaterial(),
    capacity: 1000,
    useColor: true,
  });
  const ids = [];
  for (let i = 0; i < 600; i++) {
    const inFront = i < 300;
    const z = inFront ? 8 : -5; // behind wall gets occluded
    const x = (i % 15) * 0.25 - 1.75;
    ids.push(batch.alloc({ x, y: 2, z, radius: 0.4, color: 0xff8844 }));
  }
  // Free 50 of the visible front instances
  for (let i = 0; i < 50; i++) batch.free(ids[i]);
  assert.equal(batch.count, 550);

  culler.beginFrame(camera);
  const flushResult = batch.flush({ culler });
  assert.equal(flushResult.visible, 250);
  assert.equal(flushResult.culled, 300);
  assert.equal(batch.mesh.count, 250);
  assert.ok(batch.mesh.instanceMatrix.version > 0);

  batch.dispose();
  culler.dispose();
});

test('Model3D applies distance Animation LOD & shadow cutoff and bakes GPU-instanced VAT crowds', async () => {
  // Construct a tiny 2-bone skinned hero with a looping AnimationClip
  const geom = new THREE.BoxGeometry(1, 2, 1);
  const posAttr = geom.getAttribute('position');
  const vCount = posAttr.count;
  const skinIndices = new Uint16Array(vCount * 4);
  const skinWeights = new Float32Array(vCount * 4);
  for (let i = 0; i < vCount; i++) {
    const top = posAttr.getY(i) > 0;
    skinIndices[i * 4] = top ? 1 : 0;
    skinWeights[i * 4] = 1;
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const rootBone = new THREE.Bone();
  rootBone.name = 'pelvis';
  const upperBone = new THREE.Bone();
  upperBone.name = 'chest';
  upperBone.position.set(0, 1, 0);
  rootBone.add(upperBone);
  const skeleton = new THREE.Skeleton([rootBone, upperBone]);

  const skinned = new THREE.SkinnedMesh(geom, new THREE.MeshStandardMaterial());
  skinned.name = 'hero_mesh';
  skinned.castShadow = true;
  skinned.add(rootBone);
  skinned.bind(skeleton);

  const root = new THREE.Group();
  root.add(skinned);
  const clip = new THREE.AnimationClip('run', 1.0, [
    new THREE.QuaternionKeyframeTrack('chest.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 0.25, 0, 0.968, 0, 0, 0, 1]),
  ]);

  const provider = createModel3DProvider({
    THREE,
    loader: { loadAsync: async () => ({ scene: root, animations: [clip] }) },
  });

  // Part A: Single Model3D Animation LOD & shadow distance cutoff (bypassed during _pendingFinish)
  const scene = new Scene('lod-scene');
  const fakeCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  fakeCam.position.set(0, 0, 0);
  fakeCam.lookAt(0, 0, -10);
  fakeCam.updateMatrixWorld(true);
  fakeCam.updateProjectionMatrix();

  const added = [];
  scene.app = {
    renderer: {
      camera: fakeCam,
      qualityPreset: { shadowDistance: 30, animationLodScale: 1 },
      add(_s, obj) { added.push(obj); },
      remove() {},
    },
  };

  const loadedAsset = await provider.load('hero.glb');
  const npc = scene.add(new Entity({ x: 0, y: 0, z: -45 })); // beyond shadowDistance 30 & lodDistances[2] 40
  const modelComp = npc.addComponent(provider.createComponent({
    asset: loadedAsset,
    autoPlay: 'run',
    enableLod: true,
    lodDistances: [12, 25, 40],
    shadowDistance: 30,
  }));
  scene._setActive(true);
  modelComp.updateTransform();

  let mixerSteps = 0;
  const origUpdate = modelComp.mixer.update.bind(modelComp.mixer);
  let lastDtSeen = 0;
  modelComp.mixer.update = (dt) => {
    mixerSteps++;
    lastDtSeen = dt;
    return origUpdate(dt);
  };

  for (let f = 0; f < 8; f++) modelComp.update(1 / 60);
  const loadedSkinned = modelComp.modelRoot?.getObjectByProperty?.('isSkinnedMesh', true) ?? skinned;
  assert.equal(loadedSkinned.castShadow, false, 'Shadow casting cut off beyond shadowDistance');
  assert.equal(mixerSteps, 1, 'Far Model3D updates mixer every 8th frame and accumulates dt');
  assert.ok(Math.abs(lastDtSeen - 8 / 60) < 1e-6);

  // One-shot finish callback active -> never drop frames even at far range
  mixerSteps = 0;
  modelComp.play('run', { loop: false, onComplete: () => {} });
  for (let f = 0; f < 4; f++) modelComp.update(1 / 60);
  assert.equal(mixerSteps, 4);

  // Part B: GPU-Instanced 3D Animated Character Crowd via VAT baking
  const crowd = provider.createCrowd({
    asset: loadedAsset,
    capacity: 400,
    sampleFps: 15,
  });
  assert.ok(crowd.vatTexture, 'VAT RGBA32F texture baked cleanly');
  assert.ok(crowd.vatInfo.totalFrames >= 2);
  assert.deepEqual(crowd.getClipNames(), ['run']);

  const culler = createSceneCuller3D({ maxDistance: 100, occlusion: false });
  culler.beginFrame(fakeCam);

  const visibleIds = [];
  for (let i = 0; i < 300; i++) {
    const inFront = i < 200;
    const id = crowd.spawn({
      x: (i % 10) - 5,
      y: 0,
      z: inFront ? -12 - Math.floor(i / 10) : 25, // 100 behind camera
    });
    crowd.play(id, 'run', { randomizePhase: false });
    if (inFront && i === 0) crowd.hitFlash(id, 0.1);
    if (inFront) visibleIds.push(id);
  }

  const stats = crowd.update(1 / 60, { culler });
  assert.equal(stats.activeCount, 300);
  assert.equal(stats.visibleCount, 200);
  assert.equal(stats.culledCount, 100);
  assert.equal(stats.drawCalls, 1);

  const animAttr = crowd.mesh.geometry.getAttribute('aCrowdAnim');
  assert.ok(animAttr);
  assert.ok(animAttr.array[3] > 0.5, 'First visible agent preserves hitFlash intensity in aCrowdAnim.w');

  crowd.dispose();
  await provider.dispose();
});

test('Low / Medium / High unified quality system dynamically reconfigures 2D and 3D pipelines', () => {
  assert.deepEqual(QUALITY_TIERS, ['low', 'medium', 'high']);
  assert.deepEqual(Object.keys(QUALITY2D_PRESETS), ['low', 'medium', 'high', 'ultra']);
  assert.deepEqual(Object.keys(QUALITY3D_PRESETS), ['low', 'medium', 'high', 'ultra']);
  assert.equal(resolveQualityPreset('medium', '2d').groundShadows, true);
  assert.equal(resolveQualityPreset('low', '2d').groundShadows, false);
  assert.equal(resolveQualityPreset('low', '3d').shadowsEnabled, false);
  assert.equal(resolveQualityPreset('high', '3d').fxaa, true);

  // 2D adapter dynamic quality switch
  const { canvas: c2d } = makeMockCanvas2D({ width: 1280, height: 720 });
  const a2d = createCanvas2DAdapter({ canvas: c2d, width: 1280, height: 720, pixelRatio: 2, quality: 'high' });
  assert.equal(a2d.getQuality(), 'high');
  assert.equal(a2d.getViewport().dpr, 2);
  assert.equal(a2d.qualityPreset.groundShadows, true);

  a2d.setQuality('low');
  assert.equal(a2d.getQuality(), 'low');
  assert.equal(a2d.getViewport().dpr, 1, 'Low preset caps 2D DPR to 1.0');
  assert.equal(a2d.qualityPreset.groundShadows, false);
  assert.equal(a2d.qualityPreset.imageSmoothing, false);
  a2d.dispose();

  // 3D adapter dynamic quality switch (ThreeAdapter + culler3d + palette + directional light)
  const resizeCalls = [];
  const mockAnisoExt = { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff };
  const mockGl3d = {
    getExtension(name) {
      return name === 'EXT_texture_filter_anisotropic' || name === 'WEBKIT_EXT_texture_filter_anisotropic'
        ? mockAnisoExt
        : null;
    },
    getParameter(pname) {
      if (pname === mockAnisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) return 16;
      return 0;
    },
    getContextAttributes() { return {}; },
  };
  class MockWebGLRenderer {
    constructor() {
      this.shadowMap = { enabled: false, type: 0 };
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.capabilities = {
        isWebGL2: false,
        getMaxAnisotropy: () => 16,
      };
      this.domElement = { width: 1280, height: 720, addEventListener() {}, removeEventListener() {} };
    }
    setPixelRatio(pr) { resizeCalls.push(['pr', pr]); }
    setSize(w, h) { resizeCalls.push(['size', w, h]); }
    render() {}
    getContext() { return mockGl3d; }
    dispose() {}
  }

  const palette = createWorldMaterialPalette(THREE, { wall: { pattern: 'concrete' } });
  const anisotropyLog = [];
  const origSetAniso = palette.setAnisotropy.bind(palette);
  palette.setAnisotropy = (val) => {
    anisotropyLog.push(val);
    return origSetAniso(val);
  };
  const threePatched = { ...THREE, WebGLRenderer: MockWebGLRenderer };
  const c3d = { clientWidth: 1280, clientHeight: 720 };
  const a3d = createThreeAdapter({
    THREE: threePatched,
    canvas: c3d,
    width: 1280,
    height: 720,
    pixelRatio: 2,
    quality3d: { mode: 'high' },
    culling: { occlusion: true },
  });
  a3d.registerMaterialPalette(palette);

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const scene3 = new Scene('q3d-test');
  a3d.add(scene3, sun);
  a3d.setSunLight(sun);

  assert.equal(a3d.getQuality(), 'high');
  assert.equal(a3d.culler3d.occlusionEnabled, true);
  assert.equal(anisotropyLog.at(-1), 8);

  assert.equal(a3d.renderer.shadowMap.enabled, true);

  a3d.setQuality('low');
  assert.equal(a3d.getQuality(), 'low');
  assert.equal(a3d.culler3d.occlusionEnabled, QUALITY3D_PRESETS.low.occlusionCulling);
  assert.equal(a3d.culler3d.frustum.maxDistance, QUALITY3D_PRESETS.low.drawDistance);
  assert.equal(a3d.renderer.shadowMap.enabled, false, 'Low preset turns off expensive shadow maps cleanly');
  assert.equal(anisotropyLog.at(-1), QUALITY3D_PRESETS.low.anisotropy);

  a3d.setQuality('medium');
  assert.equal(a3d.getQuality(), 'medium');
  assert.equal(a3d.culler3d.occlusionEnabled, QUALITY3D_PRESETS.medium.occlusionCulling);
  assert.equal(a3d.culler3d.frustum.maxDistance, QUALITY3D_PRESETS.medium.drawDistance);
  assert.equal(a3d.renderer.shadowMap.enabled, true);
  assert.equal(sun.shadow.mapSize.x, QUALITY3D_PRESETS.medium.shadowMapSize);
  assert.equal(anisotropyLog.at(-1), QUALITY3D_PRESETS.medium.anisotropy);

  palette.dispose();
  a3d.dispose();
});

test('2D adapters cap the pixel ratio at maxPixelRatio, and a preset can only lower it', () => {
  const size = { width: 200, height: 100 };
  const make = (options) => {
    const { canvas } = makeMockCanvas2D(size);
    return { adapter: createCanvas2DAdapter({ canvas, ...size, pixelRatio: 3, ...options }), canvas };
  };

  // A 3x screen without a preset renders at 2x.
  const plain = make({});
  assert.equal(plain.adapter.getViewport().dpr, 2);
  assert.deepEqual([plain.canvas.width, plain.canvas.height], [400, 200]);
  plain.adapter.dispose();

  assert.equal(make({ maxPixelRatio: 3 }).adapter.getViewport().dpr, 3);
  assert.equal(make({ maxPixelRatio: 0 }).adapter.getViewport().dpr, 2, 'an unusable bound falls back to 2');
  assert.equal(make({ pixelRatio: 1 }).adapter.getViewport().dpr, 1, 'a 1x screen is never upscaled');

  // The lower of the option and the preset wins.
  assert.equal(make({ quality: 'low', maxPixelRatio: 3 }).adapter.getViewport().dpr, 1);
  assert.equal(make({ quality: 'ultra' }).adapter.getViewport().dpr, 2);
  assert.equal(make({ quality: 'ultra', maxPixelRatio: 3 }).adapter.getViewport().dpr, 3);

  const switched = make({ quality: 'low', maxPixelRatio: 3 });
  switched.adapter.setQuality('ultra');
  assert.equal(switched.adapter.getViewport().dpr, 3);
  switched.adapter.setQuality(null);
  assert.equal(switched.adapter.getViewport().dpr, 3, 'without a preset the option applies');
  switched.adapter.dispose();

  // The WebGL2 adapter and its Canvas2D fallback apply the same bound.
  const gl = createWebGL2DAdapter({ canvas: makeMockWebGL2Canvas(size).canvas, ...size, pixelRatio: 3 });
  assert.equal(gl.isWebGL2, true);
  assert.equal(gl.getViewport().dpr, 2);
  gl.dispose();
  const gl3 = createWebGL2DAdapter({ canvas: makeMockWebGL2Canvas(size).canvas, ...size, pixelRatio: 3, maxPixelRatio: 3 });
  assert.equal(gl3.getViewport().dpr, 3);
  gl3.dispose();
  const fallback = createWebGL2DAdapter({ canvas: makeMockCanvas2D(size).canvas, ...size, pixelRatio: 3, maxPixelRatio: 3 });
  assert.equal(fallback.isWebGL2, undefined);
  assert.equal(fallback.getViewport().dpr, 3, 'the Canvas2D fallback receives maxPixelRatio');
  fallback.dispose();
});

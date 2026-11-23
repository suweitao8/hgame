import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TileMap,
  applyAutoTileRules,
  createCanvasUiRenderer,
  renderSdfText,
  Entity,
  Scene,
} from '../assets/runtime/index.js';
import { MAX_2D_OCCLUDERS, createLighting2DState } from '../assets/runtime/integrations/post2d.js';
import { Sprite2D, Camera2D } from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';

function createMockWebGL2Context(uniformCalls) {
  let locId = 1;
  const locNames = new Map();
  return {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    RGBA32F: 0x8814,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    TRIANGLES: 0x0004,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    ONE: 1,
    ZERO: 0,
    getParameter() { return ''; },
    getExtension() { return null; },
    createShader() { return {}; },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return true; },
    createProgram() { return {}; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    deleteShader() {},
    deleteProgram() {},
    getUniformLocation(_, name) {
      const id = locId++;
      locNames.set(id, name);
      return { id, name };
    },
    uniform1i() {},
    uniform1f(loc, v) { uniformCalls.push([loc?.name, v]); },
    uniform4f(loc, x, y, z, w) { uniformCalls.push([loc?.name, x, y, z, w]); },
    createVertexArray() { return {}; },
    bindVertexArray() {},
    deleteVertexArray() {},
    createBuffer() { return {}; },
    bindBuffer() {},
    bufferData() {},
    bufferSubData() {},
    deleteBuffer() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor() {},
    createTexture() { return {}; },
    bindTexture() {},
    activeTexture() {},
    texParameteri() {},
    texImage2D() {},
    texSubImage2D() {},
    deleteTexture() {},
    useProgram() {},
    viewport() {},
    enable() {},
    disable() {},
    blendFunc() {},
    scissor() {},
    clearColor() {},
    clear() {},
    drawArrays() {},
    drawArraysInstanced() {},
  };
}

test('R1 MAX_2D_OCCLUDERS supports 128 simultaneous shadow segments', () => {
  assert.equal(MAX_2D_OCCLUDERS, 128);
  const state = createLighting2DState();
  for (let i = 0; i < 128; i++) {
    assert.equal(state.addOccluder({ x1: i, y1: 0, x2: i, y2: 10 }), true);
  }
  assert.equal(state.snapshot().occluderCount, 128);
  assert.equal(state.addOccluder({ x1: 200, y1: 0, x2: 200, y2: 10 }), false);
});

test('R1 applyAutoTileRules resolves 4-way and 8-way bitmasks onto TileMap', () => {
  const map = new TileMap({
    tiles: [
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
    solid: [1],
  });
  // Top-left (E+S = 2|4 = 6), Top-right (S+W = 4|8 = 12), Bottom-right (N+W = 1|8 = 9), Bottom-left (N+E = 1|2 = 3)
  const changed = applyAutoTileRules(map, {
    sourceTile: 1,
    rules: {
      6: 10,
      12: 11,
      9: 12,
      3: 13,
    },
    treatBorderAsMatched: false,
  });
  assert.equal(changed, 4);
  assert.equal(map.get(1, 1), 10);
  assert.equal(map.get(2, 1), 11);
  assert.equal(map.get(2, 2), 12);
  assert.equal(map.get(1, 2), 13);
});

test('R1 WebGL2D uploads per-sprite GPU shaderEffect uniforms cleanly on batch switch', () => {
  const uniformCalls = [];
  const gl = createMockWebGL2Context(uniformCalls);
  const canvas = {
    width: 320,
    height: 180,
    clientWidth: 320,
    clientHeight: 180,
    getContext: () => gl,
    addEventListener() {},
    removeEventListener() {},
  };
  const adapter = createWebGL2DAdapter({ canvas, camera: new Camera2D({ width: 320, height: 180 }) });
  const scene = new Scene('fx2d');
  const a = new Entity({ name: 'a', x: -40, y: 0 });
  a.addComponent(new Sprite2D({ width: 32, height: 32, color: '#ffffff' }));
  const b = new Entity({ name: 'b', x: 40, y: 0 });
  const bSprite = new Sprite2D({ width: 32, height: 32, color: '#38bdf8' });
  bSprite.shaderEffect = { outlineWidth: 0.04, outlineColor: '#facc15', dissolve: 0.25, waveAmp: 0.03, waveFreq: 10, time: 0.5 };
  b.addComponent(bSprite);
  scene.add(a);
  scene.add(b);
  scene._setActive(true);

  adapter.render(scene);
  const fxParamsCall = uniformCalls.find(c => c[0] === 'uSpriteFxParams' && c[1] > 0.03);
  assert.ok(fxParamsCall, 'uSpriteFxParams uniform must be uploaded for shaderEffect sprite');
  assert.ok(Math.abs(fxParamsCall[2] - 0.25) < 1e-4);
  assert.ok(uniformCalls.some(c => c[0] === 'uSpriteFxTime' && Math.abs(c[1] - 0.5) < 1e-4));
  adapter.dispose();
});

test('S4 renderSdfText supports atlas glyphs & outlined fallback; Canvas textInput handles focus, typing, backspace, submit', () => {
  const draws = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    drawImage(...args) { draws.push(['img', args]); },
    strokeText(t) { draws.push(['stroke', t]); },
    fillText(t) { draws.push(['fill', t]); },
    beginPath() {},
    roundRect() {},
    rect() {},
    fill() {},
    stroke() {},
  };

  const atlas = {
    image: { width: 64, height: 32 },
    glyphSize: 32,
    glyphs: { A: { x: 0, y: 0, w: 16, h: 32, advance: 18 }, B: { x: 16, y: 0, w: 16, h: 32, advance: 18 } },
  };
  assert.equal(renderSdfText(ctx, 'AB', 10, 20, { fontSize: 16, atlas }), true);
  assert.equal(draws.filter(d => d[0] === 'img').length, 2);

  draws.length = 0;
  assert.equal(renderSdfText(ctx, 'HI', 10, 20, { fontSize: 18, shadowColor: '#000' }), true);
  assert.deepEqual(draws, [['stroke', 'HI'], ['fill', 'HI']]);

  let submitted = null;
  const inputNode = { id: 'nameBox', type: 'textInput', height: 36, placeholder: 'NAME', value: '' };
  const ui = createCanvasUiRenderer({ dpr: 2 });
  ui.render(ctx, { id: 'root', type: 'panel', children: [inputNode] }, 240, 80);
  ui.pointerDown(40, 18);
  assert.equal(ui.getState().focusedId, 'nameBox');

  inputNode.onSubmit = val => { submitted = val; };
  ui.keyDown('H');
  ui.keyDown('I');
  ui.keyDown('!');
  ui.keyDown('Backspace');
  assert.equal(inputNode.value, 'HI');
  ui.keyDown('Enter');
  assert.equal(submitted, 'HI');
  ui.keyDown('Escape');
  assert.equal(ui.getState().focusedId, null);
});

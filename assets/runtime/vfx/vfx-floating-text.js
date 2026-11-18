import {
  VFX_RENDER_ORDERS,
  createVisualPrng,
  markAttributeRangeDirty,
  packRgb24,
  unpackRgb24Into,
} from './vfx-core.js';
import {
  DAMAGE_ATLAS_CHARS,
  DAMAGE_NUMBER_PRESETS,
  evaluateColorByNumber,
  evaluateScaleByNumber,
  formatDamageValue,
  getDamagePreset,
  lookupDamageGlyph,
} from './vfx-damage-presets.js';

export const GLYPH_CHARS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '-', '+', '!', '暴', '闪', '盾',
]);

const scratchDigits = new Int32Array(12);
const ATLAS_COLS = 16;
const ATLAS_ROWS = 4;

/**
 * Zero-string-allocation integer digit extractor into a pre-allocated Int32Array.
 * @param {number} intValue
 * @param {boolean} [isCrit=false]
 * @param {boolean} [isHeal=false]
 * @param {boolean} [isMiss=false]
 * @param {Int32Array} [outBuffer=scratchDigits]
 * @returns {number} Glyph count written into outBuffer
 */
export function extractGlyphIndices(
  intValue,
  isCrit = false,
  isHeal = false,
  isMiss = false,
  outBuffer = scratchDigits,
) {
  let count = 0;
  if (isMiss) {
    outBuffer[count++] = 14; // '闪'
    return count;
  }

  const raw = intValue | 0;
  const isNeg = raw < 0 && !isHeal;
  let v = Math.abs(raw);

  if (v === 0) {
    outBuffer[count++] = 0;
  } else {
    while (v > 0 && count < 9) {
      outBuffer[count++] = v % 10;
      v = (v / 10) | 0;
    }
  }

  for (let i = 0, j = count - 1; i < j; i++, j--) {
    const tmp = outBuffer[i];
    outBuffer[i] = outBuffer[j];
    outBuffer[j] = tmp;
  }

  if (isHeal) {
    for (let i = count; i > 0; i--) outBuffer[i] = outBuffer[i - 1];
    outBuffer[0] = 11; // '+'
    count++;
  } else if (isNeg) {
    for (let i = count; i > 0; i--) outBuffer[i] = outBuffer[i - 1];
    outBuffer[0] = 10; // '-'
    count++;
  }

  if (isCrit) {
    for (let i = count; i > 0; i--) outBuffer[i] = outBuffer[i - 1];
    outBuffer[0] = 13; // '暴'
    count++;
    outBuffer[count++] = 12; // '!'
  }

  return count;
}

/**
 * Bakes the 64-glyph (16x4) crisp outlined damage-number atlas canvas.
 * Indices 0..15 match `GLYPH_CHARS` for backward compatibility.
 * @returns {HTMLCanvasElement | null}
 */
export function bakeGlyphAtlasCanvas() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const cell = 64;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * cell;
  canvas.height = ATLAS_ROWS * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  for (let i = 0; i < DAMAGE_ATLAS_CHARS.length; i++) {
    const ch = DAMAGE_ATLAS_CHARS[i];
    const col = i % ATLAS_COLS;
    const row = (i / ATLAS_COLS) | 0;
    const cx = col * cell + cell * 0.5;
    const cy = row * cell + cell * 0.5;
    const isHanzi = ch.charCodeAt(0) > 127;
    ctx.font = isHanzi ? '900 38px sans-serif' : '900 44px monospace, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(10, 12, 18, 0.96)';
    ctx.strokeText(ch, cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ch, cx, cy);
  }
  return canvas;
}

export const FLOATING_TEXT_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 aTextP0; // x, y, z, alpha
attribute vec4 aTextP1; // rotRad, scaleX, scaleY, glyphIndex
attribute vec4 aTextP2; // rgb24, reserved, reserved, reserved

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uIs2D;

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlpha;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float alpha = aTextP0.w;
  if (alpha <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vAlpha = alpha;
  vColor = unpackRgb24(aTextP2.x);

  float idx = aTextP1.w;
  float col = mod(idx, 16.0);
  float row = floor(idx / 16.0);
  vAtlasUv = vec2((col + uv.x) / 16.0, (3.0 - row + uv.y) / 4.0);

  float c = cos(aTextP1.x);
  float s = sin(aTextP1.x);
  vec2 scaled = vec2(position.x * aTextP1.y, position.y * aTextP1.z);
  vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);

  if (uIs2D > 0.5) {
    vec2 p2 = aTextP0.xy + vec2(rotated.x, -rotated.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, aTextP0.z, 1.0);
  } else {
    vec4 mv = modelViewMatrix * vec4(aTextP0.xyz, 1.0);
    mv.xy += rotated;
    gl_Position = projectionMatrix * mv;
  }
}
`;

export const FLOATING_TEXT_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uGlyphAtlas;

varying vec2 vAtlasUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 tex = texture2D(uGlyphAtlas, vAtlasUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(tex.rgb * vColor, alpha);
}
`;

export const FLOATING_TEXT_WEBGL2_2D_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuadPos;
layout(location = 1) in vec4 aTextP0;
layout(location = 2) in vec4 aTextP1;
layout(location = 3) in vec4 aTextP2;

uniform vec2 uCamPos;
uniform float uCamZoom;
uniform vec2 uViewSize;

out vec2 vAtlasUv;
out vec3 vColor;
out float vAlpha;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float alpha = aTextP0.w;
  if (alpha <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vAlpha = alpha;
  vColor = unpackRgb24(aTextP2.x);

  float idx = aTextP1.w;
  float col = mod(idx, 16.0);
  float row = floor(idx / 16.0);
  vec2 uv = aQuadPos + 0.5;
  vAtlasUv = vec2((col + uv.x) / 16.0, (3.0 - row + uv.y) / 4.0);

  float c = cos(aTextP1.x);
  float s = sin(aTextP1.x);
  vec2 scaled = vec2(aQuadPos.x * aTextP1.y, aQuadPos.y * aTextP1.z);
  vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
  vec2 worldPos = aTextP0.xy + vec2(rotated.x, -rotated.y);

  vec2 screenPx = (worldPos - uCamPos) * uCamZoom + uViewSize * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,
    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const FLOATING_TEXT_WEBGL2_2D_FS = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uGlyphAtlas;

in vec2 vAtlasUv;
in vec3 vColor;
in float vAlpha;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uGlyphAtlas, vAtlasUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.02) discard;
  fragColor = vec4(tex.rgb * vColor, alpha);
}
`;

function compileWebGL2Program(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'FloatingText shader compile error';
      gl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'FloatingText program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

function encodeTextToGlyphs(str, outBuf, maxLen) {
  let count = 0;
  for (let i = 0; i < str.length && count < maxLen; i++) {
    const g = lookupDamageGlyph(str[i]);
    if (g >= 0) outBuf[count++] = g;
  }
  return count;
}

function createPopupSlot(index) {
  return {
    slot: index,
    active: false,
    id: 0,
    spawnOrder: 0,
    x: 0,
    y: 0,
    z: 0,
    renderX: 0,
    renderY: 0,
    renderZ: 0,
    baseScale: 1,
    numberScale: 1,
    comboPulse: 1,
    comboScaleFade: 12,
    scaleX: 1,
    scaleY: 1,
    alpha: 0,
    rotRad: 0,
    rotSpeed: 0,
    age: 0,
    lifetime: 0.7,
    baseLifetime: 0.7,
    permanent: false,
    unscaledTime: false,
    fadePhase: 0,
    durationFadeIn: 0.14,
    durationFadeOut: 0.22,
    isFadingOut: false,
    scaleFadeInX: 1.35,
    scaleFadeInY: 1.35,
    scaleFadeOutX: 1,
    scaleFadeOutY: 1,
    crossFadeInX: 1,
    crossFadeInY: 1,
    crossFadeOutX: 1,
    crossFadeOutY: 1,
    offsetFadeInX: 0,
    offsetFadeInY: 0,
    offsetFadeOutX: 0,
    offsetFadeOutY: 0,
    shakeFadeInX: 0,
    shakeFadeInY: 0,
    shakeFadeInFreq: 0,
    shakeFadeOutX: 0,
    shakeFadeOutY: 0,
    shakeFadeOutFreq: 0,
    // Movement
    hasLerp: false,
    lerpRemX: 0,
    lerpRemY: 0,
    lerpRemZ: 0,
    lerpSpeed: 6,
    hasVelocity: false,
    vx: 0,
    vy: 0,
    vz: 0,
    dragX: 0,
    dragY: 0,
    gravity: 0,
    shakeIdleX: 0,
    shakeIdleY: 0,
    shakeIdleFreq: 0,
    // Following
    followTarget: null,
    followSpeed: 10,
    followDrag: 0,
    followLastX: 0,
    followLastY: 0,
    followLastZ: 0,
    followOffX: 0,
    followOffY: 0,
    followOffZ: 0,
    // Distance scaling (3D)
    consistentScreenSize: false,
    distBase: 15,
    distClose: 5,
    distFar: 50,
    distCloseScale: 2,
    distFarScale: 0.5,
    // Formatting & Content
    enableNumber: true,
    value: 0,
    digitsCfg: null,
    leftText: '',
    rightText: '',
    topText: '',
    bottomText: '',
    mainText: '',
    mainRgb24: 0xffffff,
    leftRgb24: 0xffffff,
    rightRgb24: 0xffffff,
    topRgb24: 0xffffff,
    bottomRgb24: 0xffffff,
    hasCustomColor: false,
    colorByNumberCfg: null,
    scaleByNumberCfg: null,
    scaleOverTimeFn: null,
    topScale: 0.72,
    bottomScale: 0.72,
    // Spam control
    spamGroup: '',
    // Combination
    comboEnabled: false,
    comboMethod: 'absorbNew',
    comboMaxDist: 2,
    comboBonusLifetime: 0.5,
    comboSpawnDelay: 0.05,
    comboAbsorbDuration: 0.25,
    comboMoveToAbsorber: true,
    comboTeleportToAbsorber: false,
    comboInstantGain: false,
    comboAbsorberScaleFactor: 1.4,
    comboAbsorberScaleFade: 12,
    absorbingTargetSlot: -1,
    absorbingTargetId: 0,
    absorbElapsed: 0,
    absorbStartX: 0,
    absorbStartY: 0,
    absorbStartZ: 0,
    absorbedValueGiven: false,
    // Collision / Destruction
    collisionEnabled: false,
    collisionRadius: 0.45,
    collisionPushFactor: 1,
    collisionDirX: 0,
    collisionDirY: 0,
    collisionDirZ: 0,
    destructionEnabled: false,
    destructionMaxDist: 2,
    destructionSpawnDelay: 0.15,
    destructionDuration: 0.25,
    destroying: false,
    destroyElapsed: 0,
    destroyScale: 1,
    // Pre-allocated glyph buffers for GPU mode
    mainGlyphs: new Int32Array(24),
    mainGlyphCount: 0,
    topGlyphs: new Int32Array(16),
    topGlyphCount: 0,
    botGlyphs: new Int32Array(16),
    botGlyphCount: 0,
  };
}

function readFollowPos(target, out) {
  if (!target) return false;
  const src = typeof target === 'function' ? target() : target;
  if (!src) return false;
  out[0] = src.x ?? 0;
  out[1] = src.y ?? 0;
  out[2] = src.z ?? 0;
  return true;
}

/**
 * Creates a clean-room DamageNumbersPro-grade zero-GC floating damage number pool
 * supporting 3D billboards, WebGL2 2D instancing, Canvas2D rendering, and headless mode.
 */
export function createFloatingTextPool({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  gl = /** @type {WebGL2RenderingContext | null} */ (null),
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  maxFloatingGlyphs = mode === 'canvas2d' ? 2048 : 16384,
  maxPopups = mode === 'canvas2d' ? 256 : 512,
  renderThroughWalls = true,
  prng = createVisualPrng(0x517cc1b7),
} = {}) {
  const capacity = Math.max(16, maxFloatingGlyphs | 0);
  const popupCap = Math.max(8, maxPopups | 0);
  const p0 = new Float32Array(capacity * 4);
  const p1 = new Float32Array(capacity * 4);
  const p2 = new Float32Array(capacity * 4);

  const popups = Array.from({ length: popupCap }, (_, i) => createPopupSlot(i));
  const activeIndices = new Int32Array(popupCap);
  let activeCount = 0;
  let nextPopupId = 1;
  let nextSpawnOrder = 1;
  let totalEmitted = 0;
  let totalPopupsSpawned = 0;
  let totalCombined = 0;
  let simTime = 0;
  let unscaledTimeClock = 0;
  let activeGlyphCount = 0;
  let prevUploadedGlyphCount = 0;
  let disposed = false;

  const scratchRgb = new Float32Array(3);
  const scratchFollowPos = new Float32Array(3);
  const unitScale = is2D ? 42 : 1;

  // Three.js 3D resources
  let mesh = null;
  let geo = null;
  let attrs = null;
  let mat = null;
  let atlasTex = null;

  // WebGL2 2D resources
  let glProg = null;
  let glVao = null;
  let glQuadVbo = null;
  let glInstVbos = null;
  let glTex = null;
  let glUniforms = null;

  if (mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry && THREE.PlaneGeometry) {
    const atlasCanvas = bakeGlyphAtlasCanvas();
    if (atlasCanvas && THREE.CanvasTexture) {
      atlasTex = new THREE.CanvasTexture(atlasCanvas);
      atlasTex.needsUpdate = true;
    }

    const baseQuad = new THREE.PlaneGeometry(1, 1);
    geo = new THREE.InstancedBufferGeometry();
    geo.index = baseQuad.index;
    geo.attributes.position = baseQuad.attributes.position;
    geo.attributes.uv = baseQuad.attributes.uv;
    geo.instanceCount = 0;

    const a0 = new THREE.InstancedBufferAttribute(p0, 4);
    const a1 = new THREE.InstancedBufferAttribute(p1, 4);
    const a2 = new THREE.InstancedBufferAttribute(p2, 4);
    geo.setAttribute('aTextP0', a0);
    geo.setAttribute('aTextP1', a1);
    geo.setAttribute('aTextP2', a2);

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    mat = new MatCtor({
      vertexShader: FLOATING_TEXT_VERTEX_GLSL,
      fragmentShader: FLOATING_TEXT_FRAGMENT_GLSL,
      uniforms: {
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uGlyphAtlas: { value: atlasTex },
      },
      transparent: true,
      depthTest: !renderThroughWalls,
      depthWrite: false,
    });

    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.FLOATING_TEXT;
    mesh.name = 'HGameVfxFloatingText';
    scene.add(mesh);
    attrs = [a0, a1, a2];
  } else if (mode === 'webgl2d' && gl && typeof gl.createProgram === 'function') {
    glProg = compileWebGL2Program(gl, FLOATING_TEXT_WEBGL2_2D_VS, FLOATING_TEXT_WEBGL2_2D_FS);
    glUniforms = {
      uCamPos: gl.getUniformLocation(glProg, 'uCamPos'),
      uCamZoom: gl.getUniformLocation(glProg, 'uCamZoom'),
      uViewSize: gl.getUniformLocation(glProg, 'uViewSize'),
      uGlyphAtlas: gl.getUniformLocation(glProg, 'uGlyphAtlas'),
    };

    const atlasCanvas = bakeGlyphAtlasCanvas();
    if (atlasCanvas) {
      glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const quadVerts = new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
    ]);
    glQuadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    glVao = gl.createVertexArray();
    gl.bindVertexArray(glVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const instArrays = [p0, p1, p2];
    glInstVbos = [];
    for (let i = 0; i < 3; i++) {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, instArrays[i], gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(i + 1, 1);
      glInstVbos.push(vbo);
    }
    gl.bindVertexArray(null);
  }

  function refreshPopupFormatting(slot) {
    const numStr = slot.enableNumber ? formatDamageValue(slot.value, slot.digitsCfg || undefined) : '';
    slot.mainText = slot.leftText + numStr + slot.rightText;
    slot.mainGlyphCount = encodeTextToGlyphs(slot.mainText, slot.mainGlyphs, 24);
    slot.topGlyphCount = slot.topText ? encodeTextToGlyphs(slot.topText, slot.topGlyphs, 16) : 0;
    slot.botGlyphCount = slot.bottomText ? encodeTextToGlyphs(slot.bottomText, slot.botGlyphs, 16) : 0;

    if (!slot.hasCustomColor && slot.colorByNumberCfg) {
      slot.mainRgb24 = packRgb24(evaluateColorByNumber(slot.value, slot.colorByNumberCfg));
    }
    if (slot.scaleByNumberCfg) {
      slot.numberScale = evaluateScaleByNumber(slot.value, slot.scaleByNumberCfg);
    } else {
      slot.numberScale = 1;
    }
  }

  function allocateSlot() {
    for (let i = 0; i < popupCap; i++) {
      if (!popups[i].active) return popups[i];
    }
    // Recycle oldest active slot
    let oldest = popups[0];
    for (let i = 1; i < popupCap; i++) {
      if (popups[i].spawnOrder < oldest.spawnOrder) oldest = popups[i];
    }
    deactivateSlot(oldest.slot);
    return oldest;
  }

  function activateSlot(slotIdx) {
    activeIndices[activeCount++] = slotIdx;
  }

  function deactivateSlot(slotIdx) {
    const slot = popups[slotIdx];
    if (!slot.active) return;
    slot.active = false;
    slot.followTarget = null;
    for (let i = 0; i < activeCount; i++) {
      if (activeIndices[i] === slotIdx) {
        activeIndices[i] = activeIndices[activeCount - 1];
        activeCount--;
        break;
      }
    }
  }

  function distanceBetween(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (is2D) return Math.hypot(dx, dy);
    const dz = a.z - b.z;
    return Math.hypot(dx, dy, dz);
  }

  function transferAbsorbedValue(victim, absorber) {
    if (victim.absorbedValueGiven || !absorber.active) return;
    victim.absorbedValueGiven = true;
    absorber.value += victim.value;
    absorber.lifeRemaining = Math.max(absorber.lifeRemaining, absorber.baseLifetime) + victim.comboBonusLifetime;
    absorber.isFadingOut = false;
    absorber.comboPulse = Math.max(absorber.comboPulse, victim.comboAbsorberScaleFactor);
    absorber.comboScaleFade = victim.comboAbsorberScaleFade;
    refreshPopupFormatting(absorber);
    totalCombined += 1;
  }

  function applyCombinationPair(absorber, victim) {
    if (absorber === victim || !absorber.active || !victim.active) return;
    if (victim.absorbingTargetSlot >= 0 || victim.destroying || victim.isFadingOut) return;
    if (absorber.absorbingTargetSlot >= 0 || absorber.destroying || absorber.isFadingOut) return;

    if (victim.comboTeleportToAbsorber) {
      victim.x = absorber.x;
      victim.y = absorber.y;
      victim.z = absorber.z;
    }
    if (victim.comboInstantGain || victim.comboAbsorbDuration <= 0.001) {
      transferAbsorbedValue(victim, absorber);
      deactivateSlot(victim.slot);
      return;
    }
    victim.absorbingTargetSlot = absorber.slot;
    victim.absorbingTargetId = absorber.id;
    victim.absorbElapsed = 0;
    victim.absorbStartX = victim.x;
    victim.absorbStartY = victim.y;
    victim.absorbStartZ = victim.z;
  }

  function handleSpawnSpamControls(newSlot) {
    const grp = newSlot.spamGroup;
    if (!grp) return;

    // Push existing nearby popups
    if (newSlot.pushEnabled) {
      const r = newSlot.pushRadius;
      const pushOff = newSlot.pushOffset;
      for (let i = 0; i < activeCount; i++) {
        const other = popups[activeIndices[i]];
        if (other === newSlot || other.spamGroup !== grp) continue;
        const d = distanceBetween(newSlot, other);
        if (d <= r) {
          if (is2D) {
            other.y -= pushOff;
          } else {
            other.y += pushOff;
          }
        }
      }
    }

    // Destroy older overlapping popups
    if (newSlot.destructionEnabled) {
      const maxD = newSlot.destructionMaxDist;
      for (let i = 0; i < activeCount; i++) {
        const other = popups[activeIndices[i]];
        if (other === newSlot || other.spamGroup !== grp || other.destroying) continue;
        if (other.age < other.destructionSpawnDelay) continue;
        if (distanceBetween(newSlot, other) <= maxD) {
          other.destroying = true;
          other.destroyElapsed = 0;
        }
      }
    }

    // Combination on spawn
    if (newSlot.comboEnabled) {
      const method = newSlot.comboMethod;
      const maxD = newSlot.comboMaxDist;
      let best = null;
      let bestDist = Infinity;

      for (let i = 0; i < activeCount; i++) {
        const other = popups[activeIndices[i]];
        if (other === newSlot || other.spamGroup !== grp || !other.comboEnabled) continue;
        if (other.absorbingTargetSlot >= 0 || other.destroying || other.isFadingOut) continue;
        const d = distanceBetween(newSlot, other);
        if (d > maxD) continue;

        if (method === 'absorbNew') {
          if (other.age >= newSlot.comboSpawnDelay && other.comboMethod === 'absorbNew' && d < bestDist) {
            best = other;
            bestDist = d;
          }
        } else if (method === 'replaceOld') {
          if (other.age >= newSlot.comboSpawnDelay) {
            applyCombinationPair(newSlot, other);
          }
        } else if (method === 'alwaysAbsorber') {
          if (other.comboMethod === 'alwaysVictim' && other.age >= other.comboSpawnDelay) {
            applyCombinationPair(newSlot, other);
          }
        } else if (method === 'alwaysVictim') {
          if (other.comboMethod === 'alwaysAbsorber' && d < bestDist) {
            best = other;
            bestDist = d;
          }
        }
      }

      if (best) {
        if (method === 'absorbNew' || method === 'alwaysVictim') {
          applyCombinationPair(best, newSlot);
        }
      }
    }
  }

  /**
   * Spawns a floating damage/heal/status number popup.
   * Accepts both legacy short options (`value, isCrit, isHeal, isMiss, vx, vy, duration, scale, color`)
   * and rich DamageNumbersPro-style options (`preset, digits, lerp, velocity, shake, follow, combination, collision, push, destruction, ...`).
   * @param {object} [opts]
   * @returns {number} Number of glyphs in the main label (for backwards compatibility)
   */
  function popupNumber(opts = {}) {
    if (disposed) return 0;

    const presetName = opts.preset
      ?? (opts.isMiss ? 'miss' : opts.isHeal ? 'heal' : opts.isCrit ? 'crit' : null);
    const preset = presetName ? getDamagePreset(presetName) : null;
    const fromPreset = (key) => (opts[key] !== undefined ? opts[key] : preset?.[key]);

    const isCrit = Boolean(fromPreset('isCrit'));
    const isHeal = Boolean(fromPreset('isHeal'));
    const isMiss = Boolean(fromPreset('isMiss'));
    const enableNumber = fromPreset('enableNumber') ?? !isMiss;
    const value = opts.value ?? 0;

    const slot = allocateSlot();
    slot.active = true;
    slot.id = nextPopupId++;
    slot.spawnOrder = nextSpawnOrder++;
    slot.x = opts.x ?? 0;
    slot.y = opts.y ?? 0;
    slot.z = opts.z ?? 0;
    slot.renderX = slot.x;
    slot.renderY = slot.y;
    slot.renderZ = slot.z;

    const scaleMul = preset?.scaleMultiplier ?? 1;
    const defaultBaseScale = is2D ? 20 : 0.6;
    slot.baseScale = opts.scale ?? (defaultBaseScale * scaleMul);
    slot.comboPulse = 1;
    slot.destroyScale = 1;
    slot.age = 0;

    // Lifecycle & fading
    const legacyDuration = opts.duration;
    if (legacyDuration !== undefined && opts.lifetime === undefined) {
      slot.durationFadeIn = Math.min(0.12, legacyDuration * 0.2);
      slot.durationFadeOut = Math.min(0.25, legacyDuration * 0.35);
      slot.baseLifetime = Math.max(0.05, legacyDuration - slot.durationFadeOut);
    } else {
      slot.durationFadeIn = Math.max(0.01, opts.durationFadeIn ?? opts.fadeIn?.duration ?? preset?.durationFadeIn ?? 0.14);
      slot.durationFadeOut = Math.max(0.01, opts.durationFadeOut ?? opts.fadeOut?.duration ?? preset?.durationFadeOut ?? 0.22);
      slot.baseLifetime = Math.max(0.01, opts.lifetime ?? preset?.lifetime ?? 0.72);
    }
    slot.lifetime = slot.baseLifetime;
    slot.lifeRemaining = slot.baseLifetime;
    slot.permanent = Boolean(opts.permanent ?? preset?.permanent);
    slot.unscaledTime = Boolean(opts.unscaledTime ?? preset?.unscaledTime);
    slot.fadePhase = 0;
    slot.isFadingOut = false;

    const fiScale = opts.fadeIn?.scale ?? opts.scaleFadeIn ?? preset?.scaleFadeIn;
    slot.scaleFadeInX = Array.isArray(fiScale) ? fiScale[0] : (fiScale ?? 1.35);
    slot.scaleFadeInY = Array.isArray(fiScale) ? (fiScale[1] ?? fiScale[0]) : (fiScale ?? 1.35);
    const foScale = opts.fadeOut?.scale ?? opts.scaleFadeOut ?? preset?.scaleFadeOut;
    slot.scaleFadeOutX = Array.isArray(foScale) ? foScale[0] : (foScale ?? 1);
    slot.scaleFadeOutY = Array.isArray(foScale) ? (foScale[1] ?? foScale[0]) : (foScale ?? 1);

    const fiCross = opts.fadeIn?.crossScale ?? opts.crossScaleFadeIn ?? preset?.crossScaleFadeIn;
    slot.crossFadeInX = Array.isArray(fiCross) ? fiCross[0] : 1;
    slot.crossFadeInY = Array.isArray(fiCross) ? (fiCross[1] ?? 1) : 1;
    const foCross = opts.fadeOut?.crossScale ?? opts.crossScaleFadeOut ?? preset?.crossScaleFadeOut;
    slot.crossFadeOutX = Array.isArray(foCross) ? foCross[0] : 1;
    slot.crossFadeOutY = Array.isArray(foCross) ? (foCross[1] ?? 1) : 1;

    const fiOffScale = opts.offsetFadeIn || opts.fadeIn?.offset ? 1 : (preset?.offsetFadeIn ? unitScale : 1);
    const fiOff = opts.fadeIn?.offset ?? opts.offsetFadeIn ?? preset?.offsetFadeIn;
    slot.offsetFadeInX = (Array.isArray(fiOff) ? fiOff[0] : (fiOff?.x ?? 0)) * fiOffScale;
    slot.offsetFadeInY = (Array.isArray(fiOff) ? (fiOff[1] ?? 0) : (fiOff?.y ?? 0)) * fiOffScale;

    const foOffScale = opts.offsetFadeOut || opts.fadeOut?.offset ? 1 : (preset?.offsetFadeOut ? unitScale : 1);
    const foOff = opts.fadeOut?.offset ?? opts.offsetFadeOut ?? preset?.offsetFadeOut;
    slot.offsetFadeOutX = (Array.isArray(foOff) ? foOff[0] : (foOff?.x ?? 0)) * foOffScale;
    slot.offsetFadeOutY = (Array.isArray(foOff) ? (foOff[1] ?? 0) : (foOff?.y ?? 0)) * foOffScale;

    const fiShake = opts.fadeIn?.shake ?? opts.shakeFadeIn ?? preset?.shakeFadeIn;
    const fiShakeScale = opts.fadeIn?.shake || opts.shakeFadeIn ? 1 : (preset?.shakeFadeIn ? unitScale : 1);
    slot.shakeFadeInX = (fiShake?.offsetX ?? 0) * fiShakeScale;
    slot.shakeFadeInY = (fiShake?.offsetY ?? 0) * fiShakeScale;
    slot.shakeFadeInFreq = fiShake?.frequency ?? 0;

    const foShake = opts.fadeOut?.shake ?? opts.shakeFadeOut ?? preset?.shakeFadeOut;
    const foShakeScale = opts.fadeOut?.shake || opts.shakeFadeOut ? 1 : (preset?.shakeFadeOut ? unitScale : 1);
    slot.shakeFadeOutX = (foShake?.offsetX ?? 0) * foShakeScale;
    slot.shakeFadeOutY = (foShake?.offsetY ?? 0) * foShakeScale;
    slot.shakeFadeOutFreq = foShake?.frequency ?? 0;

    // Rotation
    const startRot = opts.startRotation ?? preset?.startRotation;
    if (Array.isArray(startRot)) {
      let deg = prng.range(startRot[0], startRot[1]);
      if (opts.rotationRandomFlip && prng.nextFloat() < 0.5) deg = -deg;
      slot.rotRad = (deg * Math.PI) / 180;
    } else if (typeof startRot === 'number') {
      slot.rotRad = (startRot * Math.PI) / 180;
    } else {
      slot.rotRad = 0;
    }
    const rotSpeed = opts.rotateOverTime ?? preset?.rotateOverTime;
    if (Array.isArray(rotSpeed)) {
      slot.rotSpeed = (prng.range(rotSpeed[0], rotSpeed[1]) * Math.PI) / 180;
    } else if (typeof rotSpeed === 'number') {
      slot.rotSpeed = (rotSpeed * Math.PI) / 180;
    } else {
      slot.rotSpeed = 0;
    }

    // Movement: explicit legacy vx/vy vs DamageNumbersPro lerp/velocity
    const hasLegacyVel = (opts.vx !== undefined || opts.vy !== undefined) && !opts.velocity && !opts.lerp;
    if (hasLegacyVel) {
      slot.hasLerp = false;
      slot.hasVelocity = true;
      slot.vx = opts.vx ?? 0;
      slot.vy = opts.vy ?? (is2D ? -85 : 3.4);
      slot.vz = 0;
      slot.dragX = 0;
      slot.dragY = 0;
      slot.gravity = is2D ? -240 : 9.0; // converted cleanly below: 2D subtracts -(-240) = +240 downward
    } else {
      const lerpOpt = opts.lerp !== undefined ? opts.lerp : (opts.velocity ? null : (preset?.lerp ?? DAMAGE_NUMBER_PRESETS.normal.lerp));
      const lerpScale = opts.lerp ? 1 : unitScale;
      if (lerpOpt && lerpOpt.enabled !== false) {
        slot.hasLerp = true;
        let lx = prng.range(lerpOpt.minX ?? -0.4, lerpOpt.maxX ?? 0.4) * lerpScale;
        if (lerpOpt.randomFlip && prng.nextFloat() < 0.5) lx = -lx;
        const ly = prng.range(lerpOpt.minY ?? 0.5, lerpOpt.maxY ?? 1.0) * lerpScale;
        slot.lerpRemX = lx;
        slot.lerpRemY = is2D ? -ly : ly;
        slot.lerpRemZ = 0;
        slot.lerpSpeed = lerpOpt.speed ?? 5.5;
      } else {
        slot.hasLerp = false;
      }

      const velOpt = opts.velocity !== undefined ? opts.velocity : preset?.velocity;
      const velScale = opts.velocity ? 1 : unitScale;
      if (velOpt && velOpt.enabled !== false) {
        slot.hasVelocity = true;
        let vx = prng.range(velOpt.minX ?? -1, velOpt.maxX ?? 1) * velScale;
        if (velOpt.randomFlip && prng.nextFloat() < 0.5) vx = -vx;
        const vy = prng.range(velOpt.minY ?? 2.5, velOpt.maxY ?? 4.0) * velScale;
        slot.vx = vx;
        slot.vy = is2D ? -vy : vy;
        slot.vz = 0;
        slot.dragX = velOpt.dragX ?? 0.1;
        slot.dragY = velOpt.dragY ?? 1.0;
        slot.gravity = (velOpt.gravity ?? 3.0) * velScale;
      } else {
        slot.hasVelocity = false;
      }
    }

    // Idle shake
    const shakeOpt = opts.shake !== undefined ? opts.shake : preset?.shake;
    const shakeScale = opts.shake ? 1 : unitScale;
    if (shakeOpt) {
      slot.shakeIdleX = (shakeOpt.offsetX ?? shakeOpt.x ?? 0) * shakeScale;
      slot.shakeIdleY = (shakeOpt.offsetY ?? shakeOpt.y ?? 0) * shakeScale;
      slot.shakeIdleFreq = shakeOpt.frequency ?? 50;
    } else {
      slot.shakeIdleX = 0;
      slot.shakeIdleY = 0;
      slot.shakeIdleFreq = 0;
    }

    // Following target
    const followOpt = opts.follow;
    if (followOpt && (followOpt.target || typeof followOpt === 'function' || followOpt.x !== undefined)) {
      slot.followTarget = followOpt.target ?? followOpt;
      slot.followSpeed = followOpt.speed ?? 10;
      slot.followDrag = followOpt.drag ?? 0;
      if (readFollowPos(slot.followTarget, scratchFollowPos)) {
        slot.followLastX = scratchFollowPos[0];
        slot.followLastY = scratchFollowPos[1];
        slot.followLastZ = scratchFollowPos[2];
      }
      slot.followOffX = 0;
      slot.followOffY = 0;
      slot.followOffZ = 0;
    } else {
      slot.followTarget = null;
    }

    // Distance scaling (3D)
    slot.consistentScreenSize = Boolean(opts.consistentScreenSize);
    const ds = opts.distanceScaling;
    slot.distBase = ds?.baseDistance ?? 15;
    slot.distClose = ds?.closeDistance ?? 5;
    slot.distFar = ds?.farDistance ?? 50;
    slot.distCloseScale = ds?.closeScale ?? 2;
    slot.distFarScale = ds?.farScale ?? 0.5;

    // Formatting & colors
    slot.enableNumber = enableNumber;
    slot.value = value;
    slot.digitsCfg = opts.digits ?? preset?.digits ?? null;

    if (opts.leftText !== undefined) {
      slot.leftText = String(opts.leftText);
    } else if (preset?.leftText !== undefined) {
      slot.leftText = preset.leftText;
    } else if (isCrit) {
      slot.leftText = '暴';
    } else if (isHeal) {
      slot.leftText = '+';
    } else {
      slot.leftText = '';
    }

    if (opts.rightText !== undefined) {
      slot.rightText = String(opts.rightText);
    } else if (preset?.rightText !== undefined) {
      slot.rightText = preset.rightText;
    } else if (isCrit) {
      slot.rightText = '!';
    } else {
      slot.rightText = '';
    }

    slot.topText = opts.topText !== undefined ? String(opts.topText) : (preset?.topText ?? '');
    slot.bottomText = opts.bottomText !== undefined ? String(opts.bottomText) : (preset?.bottomText ?? '');
    slot.topScale = opts.topScale ?? preset?.topScale ?? 0.72;
    slot.bottomScale = opts.bottomScale ?? preset?.bottomScale ?? 0.72;

    const defaultCol = isMiss ? 0x94a3b8 : isHeal ? 0x4ade80 : isCrit ? 0xfacc15 : 0xffffff;
    const explicitRgb = opts.rgb24 !== undefined ? opts.rgb24 : (opts.color !== undefined ? packRgb24(opts.color) : null);
    slot.hasCustomColor = explicitRgb !== null;
    const baseRgb = explicitRgb ?? packRgb24(preset?.color ?? defaultCol);
    slot.mainRgb24 = baseRgb;
    slot.leftRgb24 = opts.leftColor !== undefined ? packRgb24(opts.leftColor) : baseRgb;
    slot.rightRgb24 = opts.rightColor !== undefined ? packRgb24(opts.rightColor) : baseRgb;
    slot.topRgb24 = opts.topColor !== undefined ? packRgb24(opts.topColor) : packRgb24(preset?.topColor ?? baseRgb);
    slot.bottomRgb24 = opts.bottomColor !== undefined ? packRgb24(opts.bottomColor) : packRgb24(preset?.bottomColor ?? baseRgb);

    slot.colorByNumberCfg = opts.colorByNumber !== undefined ? opts.colorByNumber : (preset?.colorByNumber ?? null);
    slot.scaleByNumberCfg = opts.scaleByNumber !== undefined ? opts.scaleByNumber : (preset?.scaleByNumber ?? null);
    slot.scaleOverTimeFn = typeof opts.scaleOverTime === 'function' ? opts.scaleOverTime : null;

    refreshPopupFormatting(slot);

    // Spam control
    const comboOpt = opts.combination !== undefined ? opts.combination : preset?.combination;
    const colOpt = opts.collision !== undefined ? opts.collision : preset?.collision;
    const pushOpt = opts.push;
    const destOpt = opts.destruction;

    const hasSpamFeature = Boolean(
      (comboOpt && comboOpt.enabled !== false) ||
      (colOpt && colOpt.enabled !== false && opts.collision !== undefined) ||
      (pushOpt && pushOpt.enabled !== false) ||
      (destOpt && destOpt.enabled !== false)
    );
    slot.spamGroup = opts.spamGroup ?? (hasSpamFeature ? 'default' : '');

    if (comboOpt && comboOpt.enabled !== false) {
      const cScale = opts.combination ? 1 : unitScale;
      slot.comboEnabled = true;
      slot.comboMethod = comboOpt.method ?? 'absorbNew';
      slot.comboMaxDist = (comboOpt.maxDistance ?? 2.2) * cScale;
      slot.comboBonusLifetime = comboOpt.bonusLifetime ?? 0.45;
      slot.comboSpawnDelay = comboOpt.spawnDelay ?? 0.05;
      slot.comboAbsorbDuration = comboOpt.absorbDuration ?? 0.22;
      slot.comboMoveToAbsorber = comboOpt.moveToAbsorber ?? true;
      slot.comboTeleportToAbsorber = Boolean(comboOpt.teleportToAbsorber);
      slot.comboInstantGain = Boolean(comboOpt.instantGain);
      slot.comboAbsorberScaleFactor = comboOpt.absorberScaleFactor ?? 1.4;
      slot.comboAbsorberScaleFade = comboOpt.absorberScaleFade ?? 12;
    } else {
      slot.comboEnabled = false;
    }
    slot.absorbingTargetSlot = -1;
    slot.absorbingTargetId = 0;
    slot.absorbElapsed = 0;
    slot.absorbedValueGiven = false;

    if (colOpt && colOpt.enabled !== false && (opts.collision !== undefined || opts.spamGroup !== undefined)) {
      const colScale = opts.collision ? 1 : unitScale;
      slot.collisionEnabled = true;
      slot.collisionRadius = (colOpt.radius ?? 0.45) * colScale;
      slot.collisionPushFactor = colOpt.pushFactor ?? 1;
      slot.collisionDirX = colOpt.desiredDirection?.x ?? 0;
      slot.collisionDirY = is2D ? -(colOpt.desiredDirection?.y ?? 0) : (colOpt.desiredDirection?.y ?? 0);
      slot.collisionDirZ = colOpt.desiredDirection?.z ?? 0;
    } else {
      slot.collisionEnabled = false;
    }

    if (pushOpt && pushOpt.enabled !== false) {
      slot.pushEnabled = true;
      slot.pushRadius = pushOpt.radius ?? (4 * unitScale);
      slot.pushOffset = pushOpt.pushOffset ?? (0.8 * unitScale);
    } else {
      slot.pushEnabled = false;
    }

    if (destOpt && destOpt.enabled !== false) {
      slot.destructionEnabled = true;
      slot.destructionMaxDist = destOpt.maxDistance ?? (2 * unitScale);
      slot.destructionSpawnDelay = destOpt.spawnDelay ?? 0.15;
      slot.destructionDuration = Math.max(0.02, destOpt.duration ?? 0.25);
    } else {
      slot.destructionEnabled = false;
    }
    slot.destroying = false;
    slot.destroyElapsed = 0;

    activateSlot(slot.slot);
    handleSpawnSpamControls(slot);

    const emittedCount = slot.mainGlyphCount + slot.topGlyphCount + slot.botGlyphCount;
    totalEmitted += Math.max(1, emittedCount);
    totalPopupsSpawned += 1;
    return Math.max(slot.mainGlyphCount, slot.mainText.length);
  }

  function updateCollisionPass(dt) {
    for (let i = 0; i < activeCount; i++) {
      const a = popups[activeIndices[i]];
      if (!a.collisionEnabled || !a.spamGroup || a.absorbingTargetSlot >= 0) continue;
      for (let j = i + 1; j < activeCount; j++) {
        const b = popups[activeIndices[j]];
        if (!b.collisionEnabled || b.spamGroup !== a.spamGroup || b.absorbingTargetSlot >= 0) continue;
        const minDist = a.collisionRadius + b.collisionRadius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = is2D ? 0 : (b.z - a.z);
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        let nx = 0;
        let ny = is2D ? -1 : 1;
        let nz = 0;
        if (a.collisionDirX !== 0 || a.collisionDirY !== 0 || a.collisionDirZ !== 0) {
          const dl = Math.hypot(a.collisionDirX, a.collisionDirY, a.collisionDirZ) || 1;
          nx = a.collisionDirX / dl;
          ny = a.collisionDirY / dl;
          nz = a.collisionDirZ / dl;
        } else if (dist > 1e-4) {
          nx = dx / dist;
          ny = dy / dist;
          nz = dz / dist;
        }
        const push = overlap * 0.5 * a.collisionPushFactor * Math.min(1, dt * 12);
        a.x -= nx * push;
        a.y -= ny * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.y += ny * push;
        b.z += nz * push;
      }
    }
  }

  function packGpuGlyphBuffers(cameraPos) {
    let glyphCursor = 0;

    for (let i = 0; i < activeCount && glyphCursor < capacity; i++) {
      const s = popups[activeIndices[i]];
      if (s.alpha <= 0.002) continue;

      let distScale = 1;
      if (!is2D && s.consistentScreenSize && cameraPos) {
        const cdx = s.renderX - (cameraPos.x ?? 0);
        const cdy = s.renderY - (cameraPos.y ?? 0);
        const cdz = s.renderZ - (cameraPos.z ?? 0);
        const dist = Math.hypot(cdx, cdy, cdz);
        if (dist <= s.distBase) {
          const t = s.distBase > s.distClose ? Math.max(0, Math.min(1, (s.distBase - dist) / (s.distBase - s.distClose))) : 0;
          distScale = 1 + (s.distCloseScale - 1) * t;
        } else {
          const t = s.distFar > s.distBase ? Math.max(0, Math.min(1, (dist - s.distBase) / (s.distFar - s.distBase))) : 0;
          distScale = 1 + (s.distFarScale - 1) * t;
        }
      }

      const sx = s.scaleX * distScale;
      const sy = s.scaleY * distScale;
      const cosR = Math.cos(s.rotRad);
      const sinR = Math.sin(s.rotRad);
      const fadeProgress = s.isFadingOut ? (1 - s.fadePhase) : (1 - s.fadePhase);
      const splitOffX = s.isFadingOut ? s.offsetFadeOutX * (1 - s.fadePhase) : s.offsetFadeInX * (1 - s.fadePhase);
      const splitOffY = s.isFadingOut ? s.offsetFadeOutY * (1 - s.fadePhase) : s.offsetFadeInY * (1 - s.fadePhase);
      void fadeProgress;

      // Main line
      const count = s.mainGlyphCount;
      const stepX = sx * 0.58;
      const halfSpan = (count - 1) * stepX * 0.5;
      for (let g = 0; g < count && glyphCursor < capacity; g++) {
        const i4 = glyphCursor * 4;
        const sideSign = g < count * 0.5 ? -1 : 1;
        const lx = g * stepX - halfSpan + sideSign * splitOffX;
        const ly = sideSign * splitOffY;
        const wx = s.renderX + lx * cosR - ly * sinR;
        const wy = s.renderY + (is2D ? -(lx * sinR + ly * cosR) : (lx * sinR + ly * cosR));
        p0[i4] = wx;
        p0[i4 + 1] = wy;
        p0[i4 + 2] = s.renderZ;
        p0[i4 + 3] = s.alpha;

        p1[i4] = s.rotRad;
        p1[i4 + 1] = sx * 0.85;
        p1[i4 + 2] = sy * 1.15;
        p1[i4 + 3] = s.mainGlyphs[g];

        p2[i4] = s.mainRgb24;
        p2[i4 + 1] = 0;
        p2[i4 + 2] = 0;
        p2[i4 + 3] = 0;
        glyphCursor++;
      }

      // Top text
      if (s.topGlyphCount > 0) {
        const tsx = sx * s.topScale;
        const tsy = sy * s.topScale;
        const tStep = tsx * 0.58;
        const tHalf = (s.topGlyphCount - 1) * tStep * 0.5;
        const yOff = sy * 0.92;
        for (let g = 0; g < s.topGlyphCount && glyphCursor < capacity; g++) {
          const i4 = glyphCursor * 4;
          const lx = g * tStep - tHalf;
          const ly = yOff;
          p0[i4] = s.renderX + lx * cosR - ly * sinR;
          p0[i4 + 1] = s.renderY + (is2D ? -(lx * sinR + ly * cosR) : (lx * sinR + ly * cosR));
          p0[i4 + 2] = s.renderZ;
          p0[i4 + 3] = s.alpha;

          p1[i4] = s.rotRad;
          p1[i4 + 1] = tsx * 0.85;
          p1[i4 + 2] = tsy * 1.15;
          p1[i4 + 3] = s.topGlyphs[g];

          p2[i4] = s.topRgb24;
          glyphCursor++;
        }
      }

      // Bottom text
      if (s.botGlyphCount > 0) {
        const bsx = sx * s.bottomScale;
        const bsy = sy * s.bottomScale;
        const bStep = bsx * 0.58;
        const bHalf = (s.botGlyphCount - 1) * bStep * 0.5;
        const yOff = -sy * 0.92;
        for (let g = 0; g < s.botGlyphCount && glyphCursor < capacity; g++) {
          const i4 = glyphCursor * 4;
          const lx = g * bStep - bHalf;
          const ly = yOff;
          p0[i4] = s.renderX + lx * cosR - ly * sinR;
          p0[i4 + 1] = s.renderY + (is2D ? -(lx * sinR + ly * cosR) : (lx * sinR + ly * cosR));
          p0[i4 + 2] = s.renderZ;
          p0[i4 + 3] = s.alpha;

          p1[i4] = s.rotRad;
          p1[i4 + 1] = bsx * 0.85;
          p1[i4 + 2] = bsy * 1.15;
          p1[i4 + 3] = s.botGlyphs[g];

          p2[i4] = s.bottomRgb24;
          glyphCursor++;
        }
      }
    }

    activeGlyphCount = glyphCursor;
    if (geo) {
      geo.instanceCount = activeGlyphCount;
    }
    const uploadCount = Math.max(activeGlyphCount, prevUploadedGlyphCount);
    if (attrs && uploadCount > 0) {
      for (let i = 0; i < 3; i++) {
        markAttributeRangeDirty(attrs[i], 0, uploadCount * 4);
      }
    }
    if (gl && glInstVbos && activeGlyphCount > 0) {
      const arrays = [p0, p1, p2];
      for (let i = 0; i < 3; i++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, glInstVbos[i]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arrays[i].subarray(0, activeGlyphCount * 4));
      }
    }
    prevUploadedGlyphCount = activeGlyphCount;
  }

  /**
   * Advances all active damage number popups (fade, movement, follow, combination, collision, destruction).
   * @param {number} visualDt
   * @param {number | object | null} [rawDtOrCameraPos=visualDt]
   * @param {object | null} [maybeCameraPos=null]
   */
  function update(visualDt, rawDtOrCameraPos = visualDt, maybeCameraPos = null) {
    if (disposed) return;
    const vDt = Math.max(0, visualDt);
    const rDt = typeof rawDtOrCameraPos === 'number' ? Math.max(0, rawDtOrCameraPos) : vDt;
    const cameraPos = typeof rawDtOrCameraPos === 'object' ? rawDtOrCameraPos : maybeCameraPos;

    simTime += vDt;
    unscaledTimeClock += rDt;

    for (let i = activeCount - 1; i >= 0; i--) {
      const s = popups[activeIndices[i]];
      const dt = s.unscaledTime ? rDt : vDt;
      const clock = s.unscaledTime ? unscaledTimeClock : simTime;
      s.age += dt;

      // Lifetime & fade
      if (!s.permanent && !s.isFadingOut && s.absorbingTargetSlot < 0 && !s.destroying) {
        s.lifeRemaining -= dt;
        if (s.lifeRemaining <= 0) {
          s.isFadingOut = true;
        }
      }

      if (s.isFadingOut) {
        s.fadePhase = Math.max(0, s.fadePhase - dt / s.durationFadeOut);
        if (s.fadePhase <= 0) {
          deactivateSlot(s.slot);
          continue;
        }
      } else {
        s.fadePhase = Math.min(1, s.fadePhase + dt / s.durationFadeIn);
      }

      // Lerp movement
      if (s.hasLerp) {
        const factor = Math.min(1, s.lerpSpeed * dt);
        const mx = s.lerpRemX * factor;
        const my = s.lerpRemY * factor;
        const mz = s.lerpRemZ * factor;
        s.x += mx;
        s.y += my;
        s.z += mz;
        s.lerpRemX -= mx;
        s.lerpRemY -= my;
        s.lerpRemZ -= mz;
      }

      // Velocity + drag + gravity
      if (s.hasVelocity) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.vx *= Math.exp(-s.dragX * dt);
        s.vy *= Math.exp(-s.dragY * dt);
        s.vy += (is2D ? s.gravity : -s.gravity) * dt;
      }

      // Follow target
      if (s.followTarget && readFollowPos(s.followTarget, scratchFollowPos)) {
        s.followOffX += scratchFollowPos[0] - s.followLastX;
        s.followOffY += scratchFollowPos[1] - s.followLastY;
        s.followOffZ += scratchFollowPos[2] - s.followLastZ;
        s.followLastX = scratchFollowPos[0];
        s.followLastY = scratchFollowPos[1];
        s.followLastZ = scratchFollowPos[2];

        const fFactor = Math.min(1, s.followSpeed * dt);
        const fx = s.followOffX * fFactor;
        const fy = s.followOffY * fFactor;
        const fz = s.followOffZ * fFactor;
        s.x += fx;
        s.y += fy;
        s.z += fz;
        s.followOffX -= fx;
        s.followOffY -= fy;
        s.followOffZ -= fz;
        s.followSpeed = Math.max(0, s.followSpeed - s.followDrag * dt);
      }

      // Combination absorption animation
      let absorbAlpha = 1;
      let absorbScale = 1;
      if (s.absorbingTargetSlot >= 0) {
        const target = popups[s.absorbingTargetSlot];
        if (!target.active || target.id !== s.absorbingTargetId) {
          s.absorbingTargetSlot = -1;
          s.isFadingOut = true;
        } else {
          s.absorbElapsed += dt;
          const t = Math.min(1, s.absorbElapsed / Math.max(0.01, s.comboAbsorbDuration));
          if (s.comboMoveToAbsorber) {
            const ease = t * t;
            s.x = s.absorbStartX + (target.x - s.absorbStartX) * ease;
            s.y = s.absorbStartY + (target.y - s.absorbStartY) * ease;
            s.z = s.absorbStartZ + (target.z - s.absorbStartZ) * ease;
          }
          absorbScale = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          absorbAlpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
          if (t >= 1) {
            transferAbsorbedValue(s, target);
            deactivateSlot(s.slot);
            continue;
          }
        }
      }

      // Destruction animation
      let destroyAlpha = 1;
      if (s.destroying) {
        s.destroyElapsed += dt;
        const t = Math.min(1, s.destroyElapsed / s.destructionDuration);
        s.destroyScale = 1 - 0.5 * t;
        destroyAlpha = 1 - t;
        if (t >= 1) {
          deactivateSlot(s.slot);
          continue;
        }
      }

      // Rotation & combo scale pulse recovery
      if (s.rotSpeed !== 0) {
        s.rotRad += s.rotSpeed * dt;
      }
      if (s.comboPulse > 1) {
        s.comboPulse = Math.max(1, s.comboPulse - (s.comboPulse - 1) * Math.min(1, s.comboScaleFade * dt));
      }

      // Composite scale + fade-in/out juice
      const invFade = 1 - s.fadePhase;
      const fiScaleX = s.isFadingOut ? s.scaleFadeOutX : s.scaleFadeInX;
      const fiScaleY = s.isFadingOut ? s.scaleFadeOutY : s.scaleFadeInY;
      const csX = s.isFadingOut ? s.crossFadeOutX : s.crossFadeInX;
      const csY = s.isFadingOut ? s.crossFadeOutY : s.crossFadeInY;
      const fadeSX = (1 + (fiScaleX - 1) * invFade) * (1 + (csX - 1) * invFade);
      const fadeSY = (1 + (fiScaleY - 1) * invFade) * (1 + (csY - 1) * invFade);

      const timeScaleMul = s.scaleOverTimeFn ? s.scaleOverTimeFn(Math.min(1, s.age / Math.max(0.01, s.lifetime))) : 1;
      const totalMul = s.baseScale * s.numberScale * s.comboPulse * s.destroyScale * absorbScale * timeScaleMul;
      s.scaleX = totalMul * fadeSX;
      s.scaleY = totalMul * fadeSY;
      s.alpha = Math.max(0, Math.min(1, s.fadePhase * absorbAlpha * destroyAlpha));

      // Final render position with idle + fade shake
      let rx = s.x;
      let ry = s.y;
      if (s.shakeIdleFreq > 0) {
        rx += Math.sin(clock * s.shakeIdleFreq) * s.shakeIdleX;
        ry += Math.cos(clock * s.shakeIdleFreq * 1.17) * s.shakeIdleY;
      }
      const fShakeFreq = s.isFadingOut ? s.shakeFadeOutFreq : s.shakeFadeInFreq;
      if (fShakeFreq > 0 && invFade > 0.001) {
        const fShakeX = s.isFadingOut ? s.shakeFadeOutX : s.shakeFadeInX;
        const fShakeY = s.isFadingOut ? s.shakeFadeOutY : s.shakeFadeInY;
        rx += Math.sin(clock * fShakeFreq) * fShakeX * invFade;
        ry += Math.cos(clock * fShakeFreq) * fShakeY * invFade;
      }
      s.renderX = rx;
      s.renderY = ry;
      s.renderZ = s.z;
    }

    updateCollisionPass(vDt);

    if (mode === '3d' || mode === 'webgl2d') {
      packGpuGlyphBuffers(cameraPos);
    }
  }

  function renderWebGL2(camera, viewWidth, viewHeight) {
    if (!gl || !glProg || !glTex || disposed || activeGlyphCount <= 0) return;
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(glProg);
    gl.uniform2f(glUniforms.uCamPos, camera?.x ?? 0, camera?.y ?? 0);
    gl.uniform1f(glUniforms.uCamZoom, camera?.zoom ?? 1);
    gl.uniform2f(glUniforms.uViewSize, viewWidth, viewHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.uniform1i(glUniforms.uGlyphAtlas, 0);

    gl.bindVertexArray(glVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeGlyphCount);
    gl.bindVertexArray(null);

    if (!prevBlend) gl.disable(gl.BLEND);
    if (prevDepth) gl.enable(gl.DEPTH_TEST);
  }

  function drawCanvasPart(ctx, text, px, py, sizePx, rgb24, alpha) {
    if (!text) return;
    unpackRgb24Into(rgb24, scratchRgb);
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${Math.max(10, sizePx | 0)}px sans-serif`;
    ctx.lineWidth = Math.max(2, sizePx * 0.16);
    ctx.strokeStyle = 'rgba(10,12,18,0.92)';
    ctx.strokeText(text, px, py);
    ctx.fillStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
    ctx.fillText(text, px, py);
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed || activeCount <= 0) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (let i = 0; i < activeCount; i++) {
      const s = popups[activeIndices[i]];
      if (s.alpha <= 0.002) continue;
      const sx = (s.renderX - camX) * zoom + halfW;
      const sy = (s.renderY - camY) * zoom + halfH;
      const sizePx = Math.max(10, s.scaleY * zoom);
      const scaleRatioX = s.scaleY > 1e-4 ? s.scaleX / s.scaleY : 1;

      const splitX = (s.isFadingOut ? s.offsetFadeOutX : s.offsetFadeInX) * (1 - s.fadePhase) * zoom;
      const splitY = (s.isFadingOut ? s.offsetFadeOutY : s.offsetFadeInY) * (1 - s.fadePhase) * zoom;

      const hasTransform = typeof ctx.translate === 'function' && (s.rotRad !== 0 || Math.abs(scaleRatioX - 1) > 0.01);
      if (hasTransform) {
        ctx.save();
        ctx.translate(sx, sy);
        if (s.rotRad !== 0 && typeof ctx.rotate === 'function') ctx.rotate(s.rotRad);
        if (Math.abs(scaleRatioX - 1) > 0.01 && typeof ctx.scale === 'function') ctx.scale(scaleRatioX, 1);
      }

      const ox = hasTransform ? 0 : sx;
      const oy = hasTransform ? 0 : sy;

      if (Math.abs(splitX) > 0.5 && s.mainText.length > 1) {
        const mid = (s.mainText.length / 2) | 0;
        const leftHalf = s.mainText.slice(0, mid);
        const rightHalf = s.mainText.slice(mid);
        ctx.font = `900 ${Math.max(10, sizePx | 0)}px sans-serif`;
        const lw = ctx.measureText ? ctx.measureText(leftHalf).width : leftHalf.length * sizePx * 0.56;
        const rw = ctx.measureText ? ctx.measureText(rightHalf).width : rightHalf.length * sizePx * 0.56;
        const totalW = lw + rw;
        const leftCenter = ox - totalW * 0.5 + lw * 0.5 - splitX;
        const rightCenter = ox + totalW * 0.5 - rw * 0.5 + splitX;
        drawCanvasPart(ctx, leftHalf, leftCenter, oy - splitY, sizePx, s.mainRgb24, s.alpha);
        drawCanvasPart(ctx, rightHalf, rightCenter, oy + splitY, sizePx, s.mainRgb24, s.alpha);
      } else {
        drawCanvasPart(ctx, s.mainText, ox, oy, sizePx, s.mainRgb24, s.alpha);
      }

      if (s.topText) {
        drawCanvasPart(ctx, s.topText, ox, oy - sizePx * 0.92, sizePx * s.topScale, s.topRgb24, s.alpha);
      }
      if (s.bottomText) {
        drawCanvasPart(ctx, s.bottomText, ox, oy + sizePx * 0.92, sizePx * s.bottomScale, s.bottomRgb24, s.alpha);
      }

      if (hasTransform) ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Returns lightweight read-only snapshots of active popups (intended for tests & telemetry).
   */
  function getActivePopups() {
    const out = [];
    for (let i = 0; i < activeCount; i++) {
      const s = popups[activeIndices[i]];
      out.push({
        id: s.id,
        x: s.x,
        y: s.y,
        z: s.z,
        renderX: s.renderX,
        renderY: s.renderY,
        renderZ: s.renderZ,
        value: s.value,
        text: s.mainText,
        topText: s.topText,
        bottomText: s.bottomText,
        alpha: s.alpha,
        scaleX: s.scaleX,
        scaleY: s.scaleY,
        rotRad: s.rotRad,
        color: s.mainRgb24,
        spamGroup: s.spamGroup,
        destroying: s.destroying,
        absorbing: s.absorbingTargetSlot >= 0,
      });
    }
    return out;
  }

  function reset() {
    simTime = 0;
    unscaledTimeClock = 0;
    activeCount = 0;
    activeGlyphCount = 0;
    prevUploadedGlyphCount = 0;
    totalEmitted = 0;
    totalPopupsSpawned = 0;
    totalCombined = 0;
    for (let i = 0; i < popupCap; i++) {
      popups[i].active = false;
      popups[i].followTarget = null;
    }
    p0.fill(0);
    p1.fill(0);
    p2.fill(0);
    if (geo) geo.instanceCount = 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    reset();
    if (mesh) {
      scene?.remove?.(mesh);
      mesh.geometry?.dispose?.();
      mat?.dispose?.();
    }
    atlasTex?.dispose?.();
    if (gl) {
      if (glVao) gl.deleteVertexArray(glVao);
      if (glQuadVbo) gl.deleteBuffer(glQuadVbo);
      if (glInstVbos) {
        for (let i = 0; i < glInstVbos.length; i++) gl.deleteBuffer(glInstVbos[i]);
      }
      if (glTex) gl.deleteTexture(glTex);
      if (glProg) gl.deleteProgram(glProg);
    }
  }

  return {
    popupNumber,
    update,
    renderWebGL2,
    renderCanvas2D,
    getActivePopups,
    reset,
    dispose,
    getStats() {
      return {
        capacity,
        popupCapacity: popupCap,
        activePopups: activeCount,
        activeGlyphs: activeGlyphCount,
        totalEmitted,
        totalPopupsSpawned,
        totalCombined,
      };
    },
  };
}

import {
  Camera2D,
  Sprite2D,
  SpriteCrowd2D,
  createCanvas2DAdapter,
  parseColorRgba,
} from './canvas2d.js';
import { resolveQualityPreset } from './quality3d.js';
import { normalizeSplitViews, pickSplitView } from '../platform/input.js';
import { createLighting2DState, createWebGL2DPostPass } from './post2d.js';

export { Camera2D, Sprite2D, SpriteCrowd2D };

/** @typedef {import('./canvas2d.js').Canvas2DAdapter} Canvas2DAdapter */
/** @typedef {import('./canvas2d.js').Canvas2DAdapterOptions} Canvas2DAdapterOptions */
/** @typedef {import('./canvas2d.js').Renderer2DAdapter} Renderer2DAdapter */
/** @typedef {import('./canvas2d.js').Renderer2DStats} Renderer2DStats */

const SCRATCH_WORLD = new Float64Array(16);
const SCRATCH_RGBA = [1, 1, 1, 1];
const SCRATCH_FLASH = [1, 1, 1, 1];
const FLOATS_PER_INSTANCE = 20;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
const MAX_CAPACITY_CAP = 262144;
const BATCH_TEXTURES = 4;

const COMPACT_VERTEX_SHADER_GLSL3 = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aPacked2D;

uniform vec4 uViewX;
uniform vec4 uViewY;
uniform vec4 uEntityMat;
uniform vec4 uEntityTrans;
uniform vec4 uSpriteBox;
uniform vec4 uSpriteUvOrigin;
uniform vec4 uSpriteUvRect;
uniform vec4 uShadowBox;
uniform vec4 uGpuMeta;
uniform highp sampler2D uGpuSwarmTex;

out vec2 vQuad;
out vec2 vUv;
flat out float vMode;
out float vFlash;

void main() {
  vec4 inst = aPacked2D;
  if (uGpuMeta.x > 0.5) {
    int tw = max(1, int(uGpuMeta.y + 0.5));
    int row = gl_InstanceID / tw;
    int col = gl_InstanceID - row * tw;
    inst = texelFetch(uGpuSwarmTex, ivec2(col, row), 0);
  }
  vec2 pLocal;
  if (uShadowBox.x > 0.5) {
    pLocal = vec2(uShadowBox.z + aQuad.x * uShadowBox.x, uShadowBox.w + aQuad.y * uShadowBox.y);
    vMode = 1.0;
    vFlash = 0.0;
  } else {
    float rot = uGpuMeta.z > 0.5 ? inst.z : 0.0;
    float flipX = (uGpuMeta.z < 0.5 && uGpuMeta.w > 0.5 && sin(inst.z) < 0.0) ? -1.0 : 1.0;
    vec2 boxP = vec2((aQuad.x - uSpriteBox.z) * uSpriteBox.x * flipX, (aQuad.y - uSpriteBox.w) * uSpriteBox.y);
    float cr = cos(rot);
    float sr = sin(rot);
    pLocal = vec2(cr * boxP.x - sr * boxP.y, sr * boxP.x + cr * boxP.y);
    vMode = uEntityTrans.w;
    vFlash = inst.w < 0.0 ? 1.0 : 0.0;
  }
  vec2 lp = inst.xy * uEntityTrans.z + pLocal;
  vec2 worldPos = vec2(
    uEntityMat.x * lp.x + uEntityMat.z * lp.y + uEntityTrans.x,
    uEntityMat.y * lp.x + uEntityMat.w * lp.y + uEntityTrans.y
  );
  gl_Position = vec4(
    uViewX.x * worldPos.x + uViewX.y * worldPos.y + uViewX.z,
    uViewY.x * worldPos.x + uViewY.y * worldPos.y + uViewY.z,
    0.0,
    1.0
  );
  float frameIdx = floor(max(0.0, abs(inst.w) - 1.0));
  float fx = uSpriteUvOrigin.z > 1.5 ? mod(frameIdx, uSpriteUvOrigin.z) : 0.0;
  float fy = uSpriteUvOrigin.z > 1.5 ? floor(frameIdx / uSpriteUvOrigin.z) : 0.0;
  vUv = uSpriteUvOrigin.xy + vec2(fx * uSpriteUvRect.z, fy * uSpriteUvRect.w) + aQuad * uSpriteUvRect.xy;
  vQuad = aQuad;
}
`;

const COMPACT_FRAGMENT_SHADER_GLSL3 = `#version 300 es
precision mediump float;

uniform sampler2D uTex;
uniform vec4 uColor;
uniform vec4 uFlashColor;
uniform vec4 uShadowColor;

in vec2 vQuad;
in vec2 vUv;
flat in float vMode;
in float vFlash;

out vec4 fragColor;

void main() {
  if (vMode > 0.5 && vMode < 1.5) {
    vec2 d = vQuad * 2.0 - 1.0;
    float d2 = dot(d, d);
    if (d2 >= 1.0) discard;
    fragColor = vec4(uShadowColor.rgb, pow(1.0 - d2, 1.5) * uShadowColor.a);
    return;
  }
  if (vMode > 1.5 && vMode < 2.5) {
    vec3 rgb = mix(uColor.rgb, uFlashColor.rgb, vFlash);
    fragColor = vec4(rgb, uColor.a);
    return;
  }
  if (vMode > 2.5) {
    vec2 d = vQuad * 2.0 - 1.0;
    if (dot(d, d) > 1.0) discard;
    vec3 rgb = mix(uColor.rgb, uFlashColor.rgb, vFlash);
    fragColor = vec4(rgb, uColor.a);
    return;
  }
  vec4 tex = texture(uTex, vUv);
  if (tex.a <= 0.001) discard;
  vec3 rgb = mix(tex.rgb, uFlashColor.rgb, vFlash);
  fragColor = vec4(rgb, tex.a * uColor.a);
}
`;

const VERTEX_SHADER_GLSL3 = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 iMat;
layout(location = 2) in vec4 iTransUv;
layout(location = 3) in vec4 iUvSizeMode;
layout(location = 4) in vec4 iColor;
layout(location = 5) in vec4 iFlash;

uniform vec4 uViewX;
uniform vec4 uViewY;

out vec2 vQuad;
out vec2 vUv;
flat out float vMode;
flat out float vTintStrength;
out vec4 vColor;
out vec4 vFlash;

void main() {
  vec2 worldPos = vec2(
    iMat.x * aQuad.x + iMat.z * aQuad.y + iTransUv.x,
    iMat.y * aQuad.x + iMat.w * aQuad.y + iTransUv.y
  );
  float ndcX = uViewX.x * worldPos.x + uViewX.y * worldPos.y + uViewX.z;
  float ndcY = uViewY.x * worldPos.x + uViewY.y * worldPos.y + uViewY.z;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  vQuad = aQuad;
  vUv = iTransUv.zw + aQuad * iUvSizeMode.xy;
  vMode = iUvSizeMode.z;
  vTintStrength = iUvSizeMode.w;
  vColor = iColor;
  vFlash = iFlash;
}
`;

const FRAGMENT_SHADER_GLSL3 = `#version 300 es
precision mediump float;

uniform sampler2D uTex[${BATCH_TEXTURES}];

in vec2 vQuad;
in vec2 vUv;
flat in float vMode;
flat in float vTintStrength;
in vec4 vColor;
in vec4 vFlash;

out vec4 fragColor;

vec4 sampleSprite() {
  // GLSL ES 3.00 sampler arrays require constant indices.
  if (vMode == -1.0) return texture(uTex[1], vUv);
  if (vMode == -2.0) return texture(uTex[2], vUv);
  if (vMode == -3.0) return texture(uTex[3], vUv);
  return texture(uTex[0], vUv);
}

void main() {
  if (vMode > 0.5 && vMode < 1.5) {
    // Grounded elliptical soft shadow (mode == 1)
    vec2 d = vQuad * 2.0 - 1.0;
    float d2 = dot(d, d);
    if (d2 >= 1.0) discard;
    float alpha = pow(1.0 - d2, 1.5) * vColor.a;
    fragColor = vec4(vColor.rgb, alpha);
    return;
  }
  if (vMode > 1.5 && vMode < 2.5) {
    // Solid rectangle (mode == 2)
    vec3 rgb = mix(vColor.rgb, vFlash.rgb, vFlash.a);
    fragColor = vec4(rgb, vColor.a);
    return;
  }
  if (vMode > 2.5) {
    // Solid circle (mode == 3)
    vec2 d = vQuad * 2.0 - 1.0;
    if (dot(d, d) > 1.0) discard;
    vec3 rgb = mix(vColor.rgb, vFlash.rgb, vFlash.a);
    fragColor = vec4(rgb, vColor.a);
    return;
  }
  // Textured modes store the negated sampler slot.
  vec4 tex = sampleSprite();
  if (tex.a <= 0.001) discard;
  vec3 rgb = mix(tex.rgb, vColor.rgb, vTintStrength);
  rgb = mix(rgb, vFlash.rgb, vFlash.a);
  fragColor = vec4(rgb, tex.a * vColor.a);
}
`;

function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'Shader compile error';
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
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
    const log = gl.getProgramInfoLog(prog) || 'Program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

function isWebGL2Capable(gl) {
  return Boolean(
    gl &&
    typeof gl.createShader === 'function' &&
    typeof gl.createBuffer === 'function' &&
    typeof gl.createVertexArray === 'function' &&
    typeof gl.drawArraysInstanced === 'function' &&
    typeof gl.vertexAttribDivisor === 'function' &&
    typeof gl.createTexture === 'function'
  );
}

function compareDrawItems(lhs, rhs) {
  return (
    lhs.layer - rhs.layer ||
    lhs.z - rhs.z ||
    ((lhs.ySort || rhs.ySort) ? (lhs.f - rhs.f) : 0) ||
    lhs.order - rhs.order
  );
}

function canSortSkip(layer, z, ySort, prevLayer, prevZ, prevYSort) {
  return !(layer < prevLayer || (layer === prevLayer && z < prevZ) || ySort || prevYSort);
}

function boundsOverlap(sprite, entity, mat, viewBounds) {
  const w = Math.abs(sprite.width);
  const h = Math.abs(sprite.height);
  if ((sprite.shape === 'text' || sprite.customDraw) && !(w > 0 && h > 0)) return true;
  const ax = sprite.anchorX ?? entity.anchorX ?? 0.5;
  const ay = sprite.anchorY ?? entity.anchorY ?? 0.5;
  const shadowCfg = sprite.groundShadow
    ? (typeof sprite.groundShadow === 'object' ? sprite.groundShadow : {})
    : null;
  const shadowHalfW = shadowCfg ? (w * (shadowCfg.widthRatio ?? 0.72)) * 0.5 : 0;
  const lx0 = shadowCfg ? Math.min(-w * ax, -shadowHalfW + (shadowCfg.offsetX || 0)) : -w * ax;
  const lx1 = shadowCfg ? Math.max(-w * ax + w, shadowHalfW + (shadowCfg.offsetX || 0)) : (-w * ax + w);
  const ly0 = -h * ay;
  const shadowBottom = shadowCfg
    ? h * (1 - ay) - h * (shadowCfg.tuckRatio ?? 0.032) + (shadowCfg.offsetY || 0) + (h * (shadowCfg.heightRatio ?? 0.18)) * 0.5
    : ly0 + h;
  const ly1 = shadowCfg ? Math.max(ly0 + h, shadowBottom) : (ly0 + h);
  const a = mat[0], b = mat[1], c = mat[4], d = mat[5], e = mat[12], f = mat[13];
  const rot = sprite.rotation || 0;
  const cos = rot ? Math.cos(rot) : 1;
  const sin = rot ? Math.sin(rot) : 0;
  const sx = (sprite.flipX ? -1 : 1) * (sprite.scaleX ?? 1);
  const sy = (sprite.flipY ? -1 : 1) * (sprite.scaleY ?? 1);
  const ox = sprite.offsetX || 0;
  const oy = sprite.offsetY || 0;
  const m00 = a * (cos * sx) + c * (sin * sx);
  const m01 = b * (cos * sx) + d * (sin * sx);
  const m10 = a * (-sin * sy) + c * (cos * sy);
  const m11 = b * (-sin * sy) + d * (cos * sy);
  const tx = a * ox + c * oy + e;
  const ty = b * ox + d * oy + f;
  const x0 = m00 * lx0 + m10 * ly0 + tx, y0 = m01 * lx0 + m11 * ly0 + ty;
  const x1 = m00 * lx1 + m10 * ly0 + tx, y1 = m01 * lx1 + m11 * ly0 + ty;
  const x2 = m00 * lx1 + m10 * ly1 + tx, y2 = m01 * lx1 + m11 * ly1 + ty;
  const x3 = m00 * lx0 + m10 * ly1 + tx, y3 = m01 * lx0 + m11 * ly1 + ty;
  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  return !(maxX < viewBounds.minX || minX > viewBounds.maxX || maxY < viewBounds.minY || minY > viewBounds.maxY);
}

/**
 * Options of createWebGL2DAdapter: every Canvas2DAdapterOptions field plus the WebGL-specific ones below.
 * @typedef {Canvas2DAdapterOptions & WebGL2DAdapterExtraOptions} WebGL2DAdapterOptions
 */

/**
 * @typedef {object} WebGL2DAdapterExtraOptions
 * @property {number} [maxBatchInstances=16384] Instances per draw batch (integer 64..262144).
 * @property {boolean} [allowFallback=true] Fall back to the Canvas2D adapter when WebGL2 is unavailable; when false an Error is thrown instead.
 */

/**
 * Per-frame statistics of the WebGL2 backend.
 * @typedef {Renderer2DStats & { drawCalls: number, instances: number }} WebGL2DStats
 */

/**
 * WebGL2 adapter (the shared renderer API plus GL specifics).
 * @typedef {Renderer2DAdapter & WebGL2DAdapterMembers} WebGL2DAdapter
 */

/**
 * @typedef {object} WebGL2DAdapterMembers
 * @property {WebGL2RenderingContext} gl The WebGL2 context.
 * @property {true} isWebGL2 Always true for this adapter (getter); the fallback adapter has no such member.
 * @property {boolean} contextLost True while the GL context is lost (getter).
 * @property {WebGL2DStats} stats Copy of last-frame statistics including drawCalls/instances (getter).
 */

/**
 * Hardware-instanced WebGL2 2D renderer capable of 5,000-10,000+ sprites/sec
 * with shader-driven tint, silhouette hit-flash, and analytical ground shadows.
 * Falls back transparently to Canvas2D when WebGL2 is unavailable.
 * @param {WebGL2DAdapterOptions} options
 * @returns {WebGL2DAdapter | Canvas2DAdapter} A WebGL2 adapter, or the Canvas2D fallback (check stats.backend or 'gl' in adapter).
 */
export function createWebGL2DAdapter({
  canvas,
  width = 960,
  height = 540,
  background = '#101820',
  pixelRatio = globalThis.devicePixelRatio || 1,
  imageSmoothing = true,
  interpolate = false,
  cull = true,
  quality = null,
  maxBatchInstances = 16384,
  allowFallback = true,
  createBufferCanvas = null,
} = {}) {
  if (!canvas?.getContext) throw new TypeError('WebGL2D adapter needs a canvas');
  if (!Number.isInteger(maxBatchInstances) || maxBatchInstances < 64 || maxBatchInstances > MAX_CAPACITY_CAP) {
    throw new RangeError('maxBatchInstances must be an integer in 64..262144');
  }

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });

  if (!isWebGL2Capable(gl)) {
    if (!allowFallback) throw new Error('WebGL2 unavailable');
    return createCanvas2DAdapter({
      canvas,
      width,
      height,
      background,
      pixelRatio,
      imageSmoothing,
      interpolate,
      cull,
      quality,
      createBufferCanvas,
    });
  }

  const camera = new Camera2D();
  const bgRgba = parseColorRgba(background);
  let qualityTier = quality ? (resolveQualityPreset(quality, '2d'), quality) : null;
  let qualityPreset = qualityTier ? resolveQualityPreset(qualityTier, '2d') : null;
  let viewport = null;
  let activeViews = null;
  let contextLost = false;
  let disposed = false;

  let capacity = maxBatchInstances;
  let instanceData = new Float32Array(capacity * FLOATS_PER_INSTANCE);
  let instanceCount = 0;

  let program = null;
  let vao = null;
  let quadVbo = null;
  let instanceVbo = null;
  let whiteTex = null;
  let uViewXLoc = null;
  let uViewYLoc = null;

  let compactProgram = null;
  let compactVao = null;
  let compactVbo = null;
  let compactData = null;
  let compactCapacity = 0;
  let uCompactViewXLoc = null;
  let uCompactViewYLoc = null;
  let uCompactEntityMatLoc = null;
  let uCompactEntityTransLoc = null;
  let uCompactSpriteBoxLoc = null;
  let uCompactUvOriginLoc = null;
  let uCompactUvRectLoc = null;
  let uCompactShadowBoxLoc = null;
  let uCompactShadowColorLoc = null;
  let uCompactColorLoc = null;
  let uCompactFlashColorLoc = null;
  let uCompactGpuMetaLoc = null;
  let uCompactTexLoc = null;
  let uCompactGpuTexLoc = null;
  let curViewX0 = 0, curViewX1 = 0, curViewX2 = 0, curViewX3 = 0;
  let curViewY0 = 0, curViewY1 = 0, curViewY2 = 0, curViewY3 = 0;

  let textureCache = new WeakMap();
  const ownedTextures = new Set();
  const textCache = new Map();
  let customDrawCanvas = null;
  const drawPool = [];
  const sortQueue = [];
  let drawCount = 0;
  let needsSort = false;
  let prevLayer = -Infinity;
  let prevZ = -Infinity;
  let prevYSort = false;
  const batchTextures = [];
  const boundTextureUnits = new Array(BATCH_TEXTURES).fill(null);
  let lastSmoothingFlag = null;

  const stats = {
    drawnSprites: 0,
    drawnCrowds: 0,
    culled: 0,
    sorted: false,
    drawCalls: 0,
    instances: 0,
    postPassActive: false,
    backend: 'webgl2',
  };
  const lighting2D = createLighting2DState();
  const postPass = createWebGL2DPostPass(gl);

  const allocBuffer = createBufferCanvas ?? ((w, h) => {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    if (typeof globalThis.document?.createElement === 'function') {
      const el = globalThis.document.createElement('canvas');
      el.width = w;
      el.height = h;
      return el;
    }
    return null;
  });

  function initGlResources() {
    if (disposed || contextLost) return;
    program = compileProgram(gl, VERTEX_SHADER_GLSL3, FRAGMENT_SHADER_GLSL3);
    uViewXLoc = gl.getUniformLocation(program, 'uViewX');
    uViewYLoc = gl.getUniformLocation(program, 'uViewY');
    gl.useProgram(program);
    for (let unit = 0; unit < BATCH_TEXTURES; unit++) {
      gl.uniform1i(gl.getUniformLocation(program, `uTex[${unit}]`), unit);
    }

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    instanceVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

    for (let attr = 1; attr <= 5; attr++) {
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, (attr - 1) * 16);
      gl.vertexAttribDivisor(attr, 1);
    }

    gl.bindVertexArray(null);

    whiteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]),
    );
    ownedTextures.add(whiteTex);
    lastSmoothingFlag = null;
  }

  function destroyGlResources() {
    for (const texture of ownedTextures) gl.deleteTexture?.(texture);
    ownedTextures.clear();
    // The same image objects may outlive the GL context and need fresh uploads.
    textureCache = new WeakMap();
    if (customDrawCanvas) {
      customDrawCanvas.width = 0;
      customDrawCanvas.height = 0;
      customDrawCanvas = null;
    }
    for (const entry of textCache.values()) {
      if (entry.canvas) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      }
    }
    textCache.clear();
    if (quadVbo) gl.deleteBuffer?.(quadVbo);
    if (instanceVbo) gl.deleteBuffer?.(instanceVbo);
    if (vao) gl.deleteVertexArray?.(vao);
    if (program) gl.deleteProgram?.(program);
    if (compactVbo) gl.deleteBuffer?.(compactVbo);
    if (compactVao) gl.deleteVertexArray?.(compactVao);
    if (compactProgram) gl.deleteProgram?.(compactProgram);
    program = null;
    vao = null;
    quadVbo = null;
    instanceVbo = null;
    compactProgram = null;
    compactVao = null;
    compactVbo = null;
    compactData = null;
    compactCapacity = 0;
    whiteTex = null;
    batchTextures.length = 0;
    boundTextureUnits.fill(null);
    postPass.destroy();
  }

  function resize() {
    const vw = Math.max(1, canvas.clientWidth || width);
    const vh = Math.max(1, canvas.clientHeight || height);
    const maxPr = qualityPreset ? qualityPreset.maxPixelRatio : 3;
    const dpr = Math.max(1, Math.min(maxPr, pixelRatio));
    const targetW = Math.round(vw * dpr);
    const targetH = Math.round(vh * dpr);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    const scale = Math.min(vw / width, vh / height);
    viewport = {
      vw,
      vh,
      dpr,
      scale,
      x: (vw - width * scale) / 2,
      y: (vh - height * scale) / 2,
    };
  }

  function setQuality(nextTier) {
    if (nextTier === null || nextTier === undefined) {
      qualityTier = null;
      qualityPreset = null;
    } else {
      qualityPreset = resolveQualityPreset(nextTier, '2d');
      qualityTier = nextTier;
    }
    resize();
    return qualityPreset;
  }

  function getQuality() {
    return qualityTier;
  }

  function setViews(views, options = {}) {
    const res = normalizeSplitViews(views, options);
    activeViews = res.views;
    return getViews();
  }

  function getViews() {
    return activeViews ? activeViews.map(v => ({ ...v })) : null;
  }

  function screenToWorld(clientX, clientY, viewIndex = null) {
    if (!viewport) resize();
    const rect = canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: viewport.vw, height: viewport.vh };
    const elemX = (clientX - rect.left) * (viewport.vw / Math.max(1, rect.width || viewport.vw));
    const elemY = (clientY - rect.top) * (viewport.vh / Math.max(1, rect.height || viewport.vh));
    const lx = (elemX - viewport.x) / viewport.scale;
    const ly = (elemY - viewport.y) / viewport.scale;
    const targetView = activeViews ? pickSplitView(activeViews, lx / width, ly / height, viewIndex) : null;
    const cam = targetView ? targetView.camera : camera;
    const cx = targetView ? (targetView.x + targetView.width * 0.5) * width : width * 0.5;
    const cy = targetView ? (targetView.y + targetView.height * 0.5) * height : height * 0.5;
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    const rx = (lx - cx) / zoom;
    const ry = (ly - cy) / zoom;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
      x: cam.x + (cam.offsetX || 0) + (rx * cos - ry * sin),
      y: cam.y + (cam.offsetY || 0) + (rx * sin + ry * cos),
    };
  }

  function worldToScreen(worldX, worldY, viewIndex = 0) {
    if (!viewport) resize();
    const rect = canvas.getBoundingClientRect?.() ?? { left: 0, top: 0, width: viewport.vw, height: viewport.vh };
    const targetView = activeViews ? (activeViews[viewIndex] ?? activeViews[0]) : null;
    const cam = targetView ? targetView.camera : camera;
    const cx = targetView ? (targetView.x + targetView.width * 0.5) * width : width * 0.5;
    const cy = targetView ? (targetView.y + targetView.height * 0.5) * height : height * 0.5;
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    const dx = worldX - (cam.x + (cam.offsetX || 0));
    const dy = worldY - (cam.y + (cam.offsetY || 0));
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    const lx = cx + rx * zoom;
    const ly = cy + ry * zoom;
    const elemX = viewport.x + lx * viewport.scale;
    const elemY = viewport.y + ly * viewport.scale;
    return {
      x: rect.left + elemX * ((rect.width || viewport.vw) / viewport.vw),
      y: rect.top + elemY * ((rect.height || viewport.vh) / viewport.vh),
    };
  }

  function setTextureFilter(smooth) {
    const filter = smooth ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  }

  function uploadTexture(img, record) {
    const w = Math.max(1, Number(img.naturalWidth || img.width) || 1);
    const h = Math.max(1, Number(img.naturalHeight || img.height) || 1);
    if (img.data && img.data.length) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    record.w = w;
    record.h = h;
  }

  function getTextureRecord(img, smooth, refresh = false) {
    if (!img) return null;
    const cached = textureCache.get(img);
    if (cached) {
      if (refresh || cached.smooth !== smooth) {
        if (batchTextures.includes(cached)) flushBatch();
        gl.bindTexture(gl.TEXTURE_2D, cached.glTex);
        boundTextureUnits[0] = cached.glTex;
        if (cached.smooth !== smooth) {
          setTextureFilter(smooth);
          cached.smooth = smooth;
        }
        if (refresh) uploadTexture(img, cached);
      }
      return cached;
    }

    const glTex = gl.createTexture();
    const record = { glTex, w: 0, h: 0, smooth };
    try {
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      boundTextureUnits[0] = glTex;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      setTextureFilter(smooth);
      uploadTexture(img, record);
    } catch (error) {
      gl.deleteTexture?.(glTex);
      boundTextureUnits[0] = null;
      throw error;
    }
    ownedTextures.add(glTex);
    textureCache.set(img, record);
    return record;
  }

  function getTextTexture(text, font, color, smooth) {
    const key = `${text}|${font}|${color}`;
    let entry = textCache.get(key);
    if (entry) {
      getTextureRecord(entry.canvas, smooth);
      return entry;
    }
    const buf = allocBuffer(256, 64);
    const bctx = buf?.getContext?.('2d') ?? null;
    if (!buf || !bctx) return null;
    bctx.font = font;
    const measured = bctx.measureText?.(text);
    const w = Math.max(8, Math.ceil((measured?.width ?? text.length * 14) + 12));
    const h = Math.max(16, Math.ceil(parseInt(font, 10) * 1.5 || 32));
    buf.width = w;
    buf.height = h;
    bctx.clearRect(0, 0, w, h);
    bctx.font = font;
    bctx.fillStyle = color;
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillText(text, w * 0.5, h * 0.5);
    const rec = getTextureRecord(buf, smooth);
    if (textCache.size >= 128) {
      const oldestKey = textCache.keys().next().value;
      const oldest = textCache.get(oldestKey);
      textCache.delete(oldestKey);
      if (batchTextures.includes(oldest.rec)) flushBatch();
      gl.deleteTexture?.(oldest.rec.glTex);
      for (let unit = 0; unit < BATCH_TEXTURES; unit++) {
        if (boundTextureUnits[unit] === oldest.rec.glTex) boundTextureUnits[unit] = null;
      }
      ownedTextures.delete(oldest.rec.glTex);
      textureCache.delete(oldest.canvas);
      oldest.canvas.width = 0;
      oldest.canvas.height = 0;
    }
    entry = { rec, w, h, canvas: buf };
    textCache.set(key, entry);
    return entry;
  }

  function flushBatch() {
    if (instanceCount <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, instanceCount * FLOATS_PER_INSTANCE);
    for (let unit = BATCH_TEXTURES - 1; unit >= 0; unit--) {
      const texture = batchTextures[unit]?.glTex ?? whiteTex;
      if (boundTextureUnits[unit] !== texture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        boundTextureUnits[unit] = texture;
      }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
    stats.drawCalls++;
    stats.instances += instanceCount;
    instanceCount = 0;
    batchTextures.length = 0;
  }

  function ensureCapacity() {
    if (instanceCount >= capacity) {
      if (capacity < MAX_CAPACITY_CAP) {
        flushBatch();
        const nextCap = Math.min(MAX_CAPACITY_CAP, capacity * 2);
        const nextArr = new Float32Array(nextCap * FLOATS_PER_INSTANCE);
        capacity = nextCap;
        instanceData = nextArr;
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
        gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
      } else {
        flushBatch();
      }
    }
  }

  function pushInstance(
    m00, m01, m10, m11, tx, ty,
    uvX, uvY, uvW, uvH, mode, tintStrength,
    r, g, b, a,
    fr, fg, fb, fa,
    requiredTex = null,
  ) {
    ensureCapacity();
    if (requiredTex) {
      let unit = batchTextures.indexOf(requiredTex);
      if (unit === -1) {
        if (batchTextures.length === BATCH_TEXTURES) flushBatch();
        unit = batchTextures.length;
        batchTextures.push(requiredTex);
      }
      mode = -unit;
    }
    const base = instanceCount * FLOATS_PER_INSTANCE;
    instanceData[base]      = m00;
    instanceData[base + 1]  = m01;
    instanceData[base + 2]  = m10;
    instanceData[base + 3]  = m11;
    instanceData[base + 4]  = tx;
    instanceData[base + 5]  = ty;
    instanceData[base + 6]  = uvX;
    instanceData[base + 7]  = uvY;
    instanceData[base + 8]  = uvW;
    instanceData[base + 9]  = uvH;
    instanceData[base + 10] = mode;
    instanceData[base + 11] = tintStrength;
    instanceData[base + 12] = r;
    instanceData[base + 13] = g;
    instanceData[base + 14] = b;
    instanceData[base + 15] = a;
    instanceData[base + 16] = fr;
    instanceData[base + 17] = fg;
    instanceData[base + 18] = fb;
    instanceData[base + 19] = fa;
    instanceCount++;
  }

  function emitGroundShadow(a, b, c, d, e, f, w, h, ax, ay, offsetX, offsetY, baseAlpha, groundShadow) {
    const cfg = typeof groundShadow === 'object' ? groundShadow : {};
    const widthRatio = cfg.widthRatio ?? 0.72;
    const heightRatio = cfg.heightRatio ?? 0.18;
    const maxAlpha = cfg.alpha ?? 0.45;
    const tuckRatio = cfg.tuckRatio ?? 0.032;
    const jumpScale = cfg.jumpScale !== false;
    parseColorRgba(cfg.color || '#000000', SCRATCH_RGBA);
    const soleY = h * (1 - ay);
    const groundY = soleY - h * tuckRatio + (cfg.offsetY || 0);
    const groundX = (offsetX || 0) + (cfg.offsetX || 0);
    let scaleFactor = 1;
    let alphaFactor = 1;
    if (jumpScale && (offsetY || 0) < 0) {
      const lift = Math.min(0.6, Math.abs(offsetY) / Math.max(16, Math.abs(h)));
      scaleFactor = 1 - lift * 0.35;
      alphaFactor = 1 - lift * 0.45;
    }
    const sw = Math.max(2, Math.abs(w) * widthRatio * scaleFactor);
    const sh = Math.max(1, Math.abs(h) * heightRatio * scaleFactor);
    const finalAlpha = Math.max(0, Math.min(1, baseAlpha * maxAlpha * alphaFactor));
    if (!(finalAlpha > 0)) return;
    const gx0 = groundX - sw * 0.5;
    const gy0 = groundY - sh * 0.5;
    pushInstance(
      a * sw, b * sw,
      c * sh, d * sh,
      a * gx0 + c * gy0 + e,
      b * gx0 + d * gy0 + f,
      0, 0, 1, 1, 1, 0,
      SCRATCH_RGBA[0], SCRATCH_RGBA[1], SCRATCH_RGBA[2], finalAlpha,
      0, 0, 0, 0,
    );
  }

  function emitOrientedQuad(
    a, b, c, d, e, f,
    w, h, ax, ay, ox, oy, rot, sx, sy,
    uvX, uvY, uvW, uvH, mode, tintStrength,
    r, g, bCol, alpha, fr, fg, fb, fa,
    requiredTex,
  ) {
    const dx = -w * ax;
    const dy = -h * ay;
    const cos = rot ? Math.cos(rot) : 1;
    const sin = rot ? Math.sin(rot) : 0;
    const lx0 = ox + cos * sx * dx - sin * sy * dy;
    const ly0 = oy + sin * sx * dx + cos * sy * dy;
    const ux = cos * sx * w;
    const uy = sin * sx * w;
    const vx = -sin * sy * h;
    const vy = cos * sy * h;
    pushInstance(
      a * ux + c * uy,
      b * ux + d * uy,
      a * vx + c * vy,
      b * vx + d * vy,
      a * lx0 + c * ly0 + e,
      b * lx0 + d * ly0 + f,
      uvX, uvY, uvW, uvH, mode, tintStrength,
      r, g, bCol, alpha,
      fr, fg, fb, fa,
      requiredTex,
    );
  }

  function pushQueueItem(kind, entity, sprite, agentIndex, a, b, c, d, e, f, layer, z, ySort) {
    let slot;
    if (drawCount < drawPool.length) {
      slot = drawPool[drawCount];
    } else {
      slot = {
        kind: 0, entity: null, sprite: null, agentIndex: -1,
        a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
        layer: 0, z: 0, ySort: false, order: 0,
      };
      drawPool.push(slot);
    }
    slot.kind = kind;
    slot.entity = entity;
    slot.sprite = sprite;
    slot.agentIndex = agentIndex;
    slot.a = a; slot.b = b; slot.c = c; slot.d = d; slot.e = e; slot.f = f;
    slot.layer = layer;
    slot.z = z;
    slot.ySort = Boolean(ySort);
    slot.order = drawCount++;
    if (slot.order > 0 && !canSortSkip(layer, z, slot.ySort, prevLayer, prevZ, prevYSort)) {
      needsSort = true;
    }
    prevLayer = layer;
    prevZ = z;
    prevYSort = slot.ySort;
  }

  function collect(entity, alpha, viewBounds, useInterpolation) {
    if (!entity.active || entity.destroyed) return;
    const comps = entity.components;
    let computed = false;
    for (let ci = 0, cn = comps.length; ci < cn; ci++) {
      const comp = comps[ci];
      if (!comp._running || !comp.visible) continue;
      if (comp instanceof Sprite2D) {
        if (!(comp.opacity > 0)) continue;
        if (!computed) {
          if (useInterpolation || entity.interpolate) entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD);
          else entity.worldMatrixInto(SCRATCH_WORLD);
          computed = true;
        }
        if (cull && !boundsOverlap(comp, entity, SCRATCH_WORLD, viewBounds)) {
          stats.culled++;
          continue;
        }
        pushQueueItem(
          0, entity, comp, -1,
          SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
          SCRATCH_WORLD[5], SCRATCH_WORLD[12], SCRATCH_WORLD[13],
          comp.layer, comp.z, comp.ySort,
        );
      } else if (comp instanceof SpriteCrowd2D) {
        if (comp.count <= 0) continue;
        if (!computed) {
          if (useInterpolation || entity.interpolate) entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD);
          else entity.worldMatrixInto(SCRATCH_WORLD);
          computed = true;
        }
        if (!comp.ySort) {
          pushQueueItem(
            1, entity, comp, -1,
            SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
            SCRATCH_WORLD[5], SCRATCH_WORLD[12], SCRATCH_WORLD[13],
            comp.layer, comp.z, false,
          );
        } else {
          const halfPad = Math.max(Math.abs(comp.width), Math.abs(comp.height)) * 2;
          const baseTx = SCRATCH_WORLD[12];
          const baseTy = SCRATCH_WORLD[13];
          for (let i = 0; i < comp._activeCount; i++) {
            const idx = comp._activeIndices[i];
            if (!(comp.opacity[idx] > 0)) continue;
            const lx = comp.x[idx], ly = comp.y[idx];
            const wx = baseTx + SCRATCH_WORLD[0] * lx + SCRATCH_WORLD[4] * ly;
            const wy = baseTy + SCRATCH_WORLD[1] * lx + SCRATCH_WORLD[5] * ly;
            if (cull && (
              wx + halfPad < viewBounds.minX || wx - halfPad > viewBounds.maxX ||
              wy + halfPad < viewBounds.minY || wy - halfPad > viewBounds.maxY
            )) {
              stats.culled++;
              continue;
            }
            pushQueueItem(
              2, entity, comp, idx,
              SCRATCH_WORLD[0], SCRATCH_WORLD[1], SCRATCH_WORLD[4],
              SCRATCH_WORLD[5], wx, wy,
              comp.layer, comp.z, true,
            );
          }
        }
      }
    }
    const children = entity.children;
    for (let i = 0, n = children.length; i < n; i++) {
      collect(children[i], alpha, viewBounds, useInterpolation);
    }
  }

  function submitSprite(item, allowShadows, smooth) {
    const { entity, sprite } = item;
    const baseAlpha = Math.max(0, Math.min(1, sprite.opacity));
    const w = sprite.width;
    const h = sprite.height;
    const ax = sprite.anchorX ?? entity.anchorX ?? 0.5;
    const ay = sprite.anchorY ?? entity.anchorY ?? 0.5;

    let img = sprite.image ?? sprite.sheet?.image ?? null;
    let rect = sprite.sourceRect ?? (sprite.sheet
      ? sprite.sheet.frame(sprite.animation ? sprite.animation.frame : sprite.frame)
      : null);
    let drawW = w;
    let drawH = h;
    let mode = sprite.shape === 'circle' ? 3 : 2;
    let requiredTex = null;

    if (typeof sprite.customDraw === 'function') {
      const bw = Math.max(8, Math.ceil(Math.abs(w) || 64));
      const bh = Math.max(8, Math.ceil(Math.abs(h) || 64));
      const buf = (customDrawCanvas ??= allocBuffer(bw, bh));
      const bctx = buf?.getContext?.('2d') ?? null;
      if (buf && bctx) {
        if (buf.width !== bw || buf.height !== bh) {
          buf.width = bw;
          buf.height = bh;
        } else if (typeof bctx.reset === 'function') {
          bctx.reset();
        } else {
          // Assigning the width resets paths, clipping and saved states on older contexts.
          buf.width = bw;
        }
        bctx.save();
        try {
          bctx.translate(bw * ax, bh * ay);
          sprite.customDraw(bctx, entity, sprite);
        } finally {
          bctx.restore();
        }
        requiredTex = getTextureRecord(buf, smooth, true);
        mode = 0;
        drawW = bw;
        drawH = bh;
      } else {
        return;
      }
    } else if (img) {
      requiredTex = getTextureRecord(img, smooth);
      mode = 0;
    } else if (sprite.shape === 'text') {
      const entry = getTextTexture(sprite.text, sprite.font, sprite.tint ?? sprite.color, smooth);
      if (!entry?.rec) return;
      requiredTex = entry.rec;
      drawW = entry.w;
      drawH = entry.h;
      mode = 0;
    }

    if (allowShadows && sprite.groundShadow) {
      emitGroundShadow(
        item.a, item.b, item.c, item.d, item.e, item.f,
        w, h, ax, ay, sprite.offsetX, sprite.offsetY, baseAlpha, sprite.groundShadow,
      );
    }

    let uvX = 0, uvY = 0, uvW = 1, uvH = 1;
    if (requiredTex && rect) {
      uvX = rect.x / requiredTex.w;
      uvY = rect.y / requiredTex.h;
      uvW = rect.width / requiredTex.w;
      uvH = rect.height / requiredTex.h;
    }

    let r = 1, g = 1, b = 1, tintStrength = 0;
    if (mode === 0) {
      if (sprite.tint) {
        parseColorRgba(sprite.tint, SCRATCH_RGBA);
        r = SCRATCH_RGBA[0]; g = SCRATCH_RGBA[1]; b = SCRATCH_RGBA[2];
        tintStrength = 0.55;
      }
    } else {
      parseColorRgba(sprite.tint ?? sprite.color, SCRATCH_RGBA);
      r = SCRATCH_RGBA[0]; g = SCRATCH_RGBA[1]; b = SCRATCH_RGBA[2];
      tintStrength = 1;
    }

    const fa = sprite.flash > 0 ? Math.min(1, sprite.flash) : 0;
    if (fa > 0) parseColorRgba(sprite.flashColor || '#ffffff', SCRATCH_FLASH);
    else { SCRATCH_FLASH[0] = 0; SCRATCH_FLASH[1] = 0; SCRATCH_FLASH[2] = 0; }

    emitOrientedQuad(
      item.a, item.b, item.c, item.d, item.e, item.f,
      drawW, drawH, ax, ay, sprite.offsetX || 0, sprite.offsetY || 0,
      sprite.rotation || 0,
      (sprite.flipX ? -1 : 1) * (sprite.scaleX ?? 1),
      (sprite.flipY ? -1 : 1) * (sprite.scaleY ?? 1),
      uvX, uvY, uvW, uvH, mode, tintStrength,
      r, g, b, baseAlpha,
      SCRATCH_FLASH[0], SCRATCH_FLASH[1], SCRATCH_FLASH[2], fa,
      requiredTex,
    );
    stats.drawnSprites++;
  }

  function submitCrowdAgent(crowd, idx, a, b, c, d, baseTx, baseTy, w, h, ax, ay, imgRec, baseR, baseG, baseB, flashR, flashG, flashB, allowShadows, useDirectBase = false) {
    const op = crowd.opacity[idx];
    if (!(op > 0)) return;
    const wx = useDirectBase ? baseTx : (baseTx + a * crowd.x[idx] + c * crowd.y[idx]);
    const wy = useDirectBase ? baseTy : (baseTy + b * crowd.x[idx] + d * crowd.y[idx]);
    if (allowShadows && crowd.groundShadow) {
      emitGroundShadow(
        a, b, c, d, wx, wy,
        w, h, ax, ay, crowd.offsetX[idx], crowd.offsetY[idx], op, crowd.groundShadow,
      );
    }

    let uvX = 0, uvY = 0, uvW = 1, uvH = 1;
    if (imgRec) {
      const rect = crowd.sourceRect ?? (crowd.sheet ? crowd.sheet.frame(crowd.frame[idx]) : null);
      if (rect) {
        uvX = rect.x / imgRec.w;
        uvY = rect.y / imgRec.h;
        uvW = rect.width / imgRec.w;
        uvH = rect.height / imgRec.h;
      }
    }
    const mode = imgRec ? 0 : (crowd.shape === 'circle' ? 3 : 2);
    const hasCustomTint = crowd.hasTint[idx] === 1;
    const r = hasCustomTint ? crowd.tintR[idx] : (imgRec ? 1 : baseR);
    const g = hasCustomTint ? crowd.tintG[idx] : (imgRec ? 1 : baseG);
    const bCol = hasCustomTint ? crowd.tintB[idx] : (imgRec ? 1 : baseB);
    const tintStrength = imgRec ? (hasCustomTint ? 0.55 : 0) : 1;
    const fa = crowd.flash[idx] > 0 ? Math.min(1, crowd.flash[idx]) : 0;

    emitOrientedQuad(
      a, b, c, d, wx, wy,
      w, h, ax, ay, crowd.offsetX[idx], crowd.offsetY[idx],
      crowd.rotation[idx],
      (crowd.flipX[idx] ? -1 : 1) * crowd.scaleX[idx],
      crowd.scaleY[idx],
      uvX, uvY, uvW, uvH, mode, tintStrength,
      r, g, bCol, op,
      flashR, flashG, flashB, fa,
      imgRec,
    );
    stats.drawnSprites++;
  }

  function ensureCompactResources(neededCount) {
    if (!compactProgram) {
      compactProgram = compileProgram(gl, COMPACT_VERTEX_SHADER_GLSL3, COMPACT_FRAGMENT_SHADER_GLSL3);
      uCompactViewXLoc = gl.getUniformLocation(compactProgram, 'uViewX');
      uCompactViewYLoc = gl.getUniformLocation(compactProgram, 'uViewY');
      uCompactEntityMatLoc = gl.getUniformLocation(compactProgram, 'uEntityMat');
      uCompactEntityTransLoc = gl.getUniformLocation(compactProgram, 'uEntityTrans');
      uCompactSpriteBoxLoc = gl.getUniformLocation(compactProgram, 'uSpriteBox');
      uCompactUvOriginLoc = gl.getUniformLocation(compactProgram, 'uSpriteUvOrigin');
      uCompactUvRectLoc = gl.getUniformLocation(compactProgram, 'uSpriteUvRect');
      uCompactShadowBoxLoc = gl.getUniformLocation(compactProgram, 'uShadowBox');
      uCompactShadowColorLoc = gl.getUniformLocation(compactProgram, 'uShadowColor');
      uCompactColorLoc = gl.getUniformLocation(compactProgram, 'uColor');
      uCompactFlashColorLoc = gl.getUniformLocation(compactProgram, 'uFlashColor');
      uCompactGpuMetaLoc = gl.getUniformLocation(compactProgram, 'uGpuMeta');
      uCompactTexLoc = gl.getUniformLocation(compactProgram, 'uTex');
      uCompactGpuTexLoc = gl.getUniformLocation(compactProgram, 'uGpuSwarmTex');

      compactVao = gl.createVertexArray();
      gl.bindVertexArray(compactVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      compactCapacity = Math.max(capacity, neededCount, 1024);
      compactData = new Float32Array(compactCapacity * 4);
      compactVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, compactVbo);
      gl.bufferData(gl.ARRAY_BUFFER, compactData.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(vao);
    } else if (neededCount > compactCapacity) {
      compactCapacity = Math.min(MAX_CAPACITY_CAP, Math.max(neededCount, compactCapacity * 2));
      compactData = new Float32Array(compactCapacity * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, compactVbo);
      gl.bufferData(gl.ARRAY_BUFFER, compactData.byteLength, gl.DYNAMIC_DRAW);
    }
  }

  function submitCompactCrowdBatch(crowd, item, viewBounds, allowShadows, smooth) {
    const gpuSwarm = crowd._boundGpuSwarm;
    const swarm = crowd._boundSwarm;
    const opts = (gpuSwarm ? crowd._boundGpuSwarmOpts : crowd._boundSwarmOpts) || {};
    const ws = opts.worldScale || 1;
    const syncRot = opts.syncRotation ? 1 : 0;
    const flipByDir = opts.flipByDirection !== false ? 1 : 0;
    const fCount = opts.frameCount || 1;
    const fps = opts.animFps || 8;
    const maxCap = crowd.capacity;

    const useGpuTex = Boolean(gpuSwarm && gpuSwarm.glTexture);
    let drawCountCompact = 0;
    if (gpuSwarm) {
      drawCountCompact = Math.min(maxCap, gpuSwarm.count || 0);
      ensureCompactResources(useGpuTex ? 1 : drawCountCompact);
    } else if (swarm) {
      const w = crowd.width, h = crowd.height;
      const halfPad = Math.max(Math.abs(w), Math.abs(h)) * 2;
      const totalActive = Math.min(maxCap, swarm.count || 0);
      ensureCompactResources(totalActive);

      const sPosX = swarm.posX;
      const sPosY = swarm.posY;
      const sRot = swarm.rot;
      const sTime = swarm.animTime;
      const sClip = swarm.animClip;
      const sFlash = swarm.flash;
      const simpleMatrix = cull && item.a === 1 && item.d === 1 && item.b === 0 && item.c === 0;
      const invWs = 1 / ws;
      const padL = halfPad * invWs;
      const lMinX = (viewBounds.minX - item.e) * invWs - padL;
      const lMaxX = (viewBounds.maxX - item.e) * invWs + padL;
      const lMinY = (viewBounds.minY - item.f) * invWs - padL;
      const lMaxY = (viewBounds.maxY - item.f) * invWs + padL;
      const inMinX = (viewBounds.minX - item.e) * invWs + padL;
      const inMaxX = (viewBounds.maxX - item.e) * invWs - padL;
      const inMinY = (viewBounds.minY - item.f) * invWs + padL;
      const inMaxY = (viewBounds.maxY - item.f) * invWs - padL;

      if (typeof swarm.ensureChunks === 'function' && swarm.chunkHead) {
        swarm.ensureChunks();
        const cCount = swarm.chunkCount;
        const cHead = swarm.chunkHead;
        const cNext = swarm.chunkNext;
        const cMinX = swarm.chunkMinX;
        const cMaxX = swarm.chunkMaxX;
        const cMinY = swarm.chunkMinY;
        const cMaxY = swarm.chunkMaxY;

        for (let ck = 0, cn = cHead.length; ck < cn; ck++) {
          if (cCount[ck] === 0) continue;
          const ckMinX = cMinX[ck], ckMaxX = cMaxX[ck], ckMinY = cMinY[ck], ckMaxY = cMaxY[ck];
          if (simpleMatrix && (ckMaxX < lMinX || ckMinX > lMaxX || ckMaxY < lMinY || ckMinY > lMaxY)) {
            stats.culled += cCount[ck];
            continue;
          }
          const strictIn = !simpleMatrix || (ckMinX >= inMinX && ckMaxX <= inMaxX && ckMinY >= inMinY && ckMaxY <= inMaxY);
          let id = cHead[ck];
          if (strictIn) {
            while (id !== -1 && drawCountCompact < compactCapacity) {
              const fIdx = fCount > 1 ? ((sTime[id] * fps | 0) % fCount) : sClip[id];
              const off = drawCountCompact * 4;
              compactData[off] = sPosX[id];
              compactData[off + 1] = sPosY[id];
              compactData[off + 2] = sRot[id];
              compactData[off + 3] = sFlash[id] > 0 ? -(fIdx + 1) : (fIdx + 1);
              drawCountCompact++;
              id = cNext[id];
            }
          } else {
            while (id !== -1 && drawCountCompact < compactCapacity) {
              const px = sPosX[id], py = sPosY[id];
              if (px < lMinX || px > lMaxX || py < lMinY || py > lMaxY) {
                stats.culled++;
                id = cNext[id];
                continue;
              }
              const fIdx = fCount > 1 ? ((sTime[id] * fps | 0) % fCount) : sClip[id];
              const off = drawCountCompact * 4;
              compactData[off] = px;
              compactData[off + 1] = py;
              compactData[off + 2] = sRot[id];
              compactData[off + 3] = sFlash[id] > 0 ? -(fIdx + 1) : (fIdx + 1);
              drawCountCompact++;
              id = cNext[id];
            }
          }
        }
      } else {
        const ids = swarm.activeIds;
        for (let i = 0; i < totalActive && drawCountCompact < compactCapacity; i++) {
          const id = ids[i];
          const px = sPosX[id], py = sPosY[id];
          if (simpleMatrix && (px < lMinX || px > lMaxX || py < lMinY || py > lMaxY)) {
            stats.culled++;
            continue;
          }
          const fIdx = fCount > 1 ? ((sTime[id] * fps | 0) % fCount) : sClip[id];
          const off = drawCountCompact * 4;
          compactData[off] = px;
          compactData[off + 1] = py;
          compactData[off + 2] = sRot[id];
          compactData[off + 3] = sFlash[id] > 0 ? -(fIdx + 1) : (fIdx + 1);
          drawCountCompact++;
        }
      }
    }

    if (drawCountCompact <= 0) {
      stats.drawnCrowds++;
      return;
    }

    flushBatch();

    const w = crowd.width, h = crowd.height;
    const ax = crowd.anchorX ?? 0.5, ay = crowd.anchorY ?? 0.5;
    const img = crowd.image ?? crowd.sheet?.image ?? null;
    const imgRec = img ? getTextureRecord(img, smooth) : null;
    const mode = imgRec ? 0 : (crowd.shape === 'circle' ? 3 : 2);
    parseColorRgba(crowd.color, SCRATCH_RGBA);
    parseColorRgba(crowd.flashColor || '#ffffff', SCRATCH_FLASH);

    let oU = 0, oV = 0, colsUv = 1, cW = 1, cH = 1, sX = 0, sY = 0;
    if (imgRec) {
      if (crowd.sourceRect) {
        const sr = crowd.sourceRect;
        oU = sr.x / imgRec.w;
        oV = sr.y / imgRec.h;
        cW = sr.width / imgRec.w;
        cH = sr.height / imgRec.h;
      } else if (crowd.sheet) {
        const sh = crowd.sheet;
        colsUv = Math.max(1, sh.columns | 0);
        oU = (sh.margin + sh.inset) / imgRec.w;
        oV = (sh.margin + sh.inset) / imgRec.h;
        cW = (sh.frameWidth - 2 * sh.inset) / imgRec.w;
        cH = (sh.frameHeight - 2 * sh.inset) / imgRec.h;
        sX = (sh.frameWidth + sh.spacing) / imgRec.w;
        sY = (sh.frameHeight + sh.spacing) / imgRec.h;
      }
    }

    gl.useProgram(compactProgram);
    gl.bindVertexArray(compactVao);
    if (!useGpuTex) {
      gl.bindBuffer(gl.ARRAY_BUFFER, compactVbo);
      const srcBuf = gpuSwarm ? gpuSwarm.data : compactData;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, srcBuf.subarray(0, drawCountCompact * 4));
    }

    gl.uniform4f(uCompactViewXLoc, curViewX0, curViewX1, curViewX2, curViewX3);
    gl.uniform4f(uCompactViewYLoc, curViewY0, curViewY1, curViewY2, curViewY3);
    gl.uniform4f(uCompactEntityMatLoc, item.a, item.b, item.c, item.d);
    gl.uniform4f(uCompactEntityTransLoc, item.e, item.f, ws, mode);
    gl.uniform4f(uCompactSpriteBoxLoc, w, h, ax, ay);
    gl.uniform4f(uCompactUvOriginLoc, oU, oV, colsUv, 0);
    gl.uniform4f(uCompactUvRectLoc, cW, cH, sX, sY);
    gl.uniform4f(
      uCompactGpuMetaLoc,
      useGpuTex ? 1 : 0,
      useGpuTex ? Math.max(1, gpuSwarm.texWidth | 0) : 1,
      syncRot,
      flipByDir,
    );
    gl.uniform4f(uCompactColorLoc, imgRec ? 1 : SCRATCH_RGBA[0], imgRec ? 1 : SCRATCH_RGBA[1], imgRec ? 1 : SCRATCH_RGBA[2], SCRATCH_RGBA[3]);
    gl.uniform4f(uCompactFlashColorLoc, SCRATCH_FLASH[0], SCRATCH_FLASH[1], SCRATCH_FLASH[2], 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgRec ? imgRec.glTex : whiteTex);
    boundTextureUnits[0] = imgRec ? imgRec.glTex : whiteTex;
    gl.uniform1i(uCompactTexLoc, 0);

    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, useGpuTex ? gpuSwarm.glTexture : whiteTex);
    boundTextureUnits[1] = useGpuTex ? gpuSwarm.glTexture : whiteTex;
    gl.uniform1i(uCompactGpuTexLoc, 1);

    if (allowShadows && crowd.groundShadow) {
      const cfg = typeof crowd.groundShadow === 'object' ? crowd.groundShadow : {};
      const sw = Math.max(2, Math.abs(w) * (cfg.widthRatio ?? 0.72));
      const sh = Math.max(1, Math.abs(h) * (cfg.heightRatio ?? 0.18));
      const gx0 = (cfg.offsetX || 0) - sw * 0.5;
      const gy0 = h * (1 - ay) - h * (cfg.tuckRatio ?? 0.032) + (cfg.offsetY || 0) - sh * 0.5;
      const shCol = parseColorRgba(cfg.color || '#000000');
      gl.uniform4f(uCompactShadowColorLoc, shCol[0], shCol[1], shCol[2], cfg.alpha ?? 0.45);
      gl.uniform4f(uCompactShadowBoxLoc, sw, sh, gx0, gy0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCountCompact);
      stats.drawCalls++;
      stats.instances += drawCountCompact;
    }

    gl.uniform4f(uCompactShadowBoxLoc, 0, 0, 0, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCountCompact);
    stats.drawCalls++;
    stats.instances += drawCountCompact;
    stats.drawnSprites += drawCountCompact;
    stats.drawnCrowds++;

    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
  }

  function submitCrowdBatch(item, viewBounds, allowShadows, smooth) {
    const crowd = item.sprite;
    if (crowd._boundSwarm || crowd._boundGpuSwarm) {
      submitCompactCrowdBatch(crowd, item, viewBounds, allowShadows, smooth);
      return;
    }
    const w = crowd.width, h = crowd.height;
    const ax = crowd.anchorX ?? 0.5, ay = crowd.anchorY ?? 0.5;
    const img = crowd.image ?? crowd.sheet?.image ?? null;
    const imgRec = img ? getTextureRecord(img, smooth) : null;
    parseColorRgba(crowd.color, SCRATCH_RGBA);
    const baseR = SCRATCH_RGBA[0], baseG = SCRATCH_RGBA[1], baseB = SCRATCH_RGBA[2];
    parseColorRgba(crowd.flashColor || '#ffffff', SCRATCH_FLASH);
    const flashR = SCRATCH_FLASH[0], flashG = SCRATCH_FLASH[1], flashB = SCRATCH_FLASH[2];
    const halfPad = Math.max(Math.abs(w), Math.abs(h)) * 2;
    const simpleMatrix = cull && item.a === 1 && item.d === 1 && item.b === 0 && item.c === 0;

    for (let i = 0; i < crowd._activeCount; i++) {
      const idx = crowd._activeIndices[i];
      if (simpleMatrix) {
        const wx = item.e + crowd.x[idx];
        const wy = item.f + crowd.y[idx];
        if (wx + halfPad < viewBounds.minX || wx - halfPad > viewBounds.maxX ||
            wy + halfPad < viewBounds.minY || wy - halfPad > viewBounds.maxY) {
          stats.culled++;
          continue;
        }
      }
      submitCrowdAgent(
        crowd, idx, item.a, item.b, item.c, item.d, item.e, item.f,
        w, h, ax, ay, imgRec, baseR, baseG, baseB, flashR, flashG, flashB, allowShadows,
      );
    }
    stats.drawnCrowds++;
  }

  function renderCameraView(scene, alpha, cam, subW, subH, vx, vy, vwPx, vhPx, allowShadows, allowSmoothing) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vwPx, vhPx);
    gl.viewport(vx, vy, vwPx, vhPx);

    const rot = cam.rotation || 0;
    const zoom = cam.zoom || 1;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const camX = cam.x + (cam.offsetX || 0);
    const camY = cam.y + (cam.offsetY || 0);
    const ix = (2 * zoom) / subW;
    const iy = (-2 * zoom) / subH;
    curViewX0 = ix * cos;
    curViewX1 = ix * sin;
    curViewX2 = -ix * (camX * cos + camY * sin);
    curViewX3 = 0;
    curViewY0 = -iy * sin;
    curViewY1 = iy * cos;
    curViewY2 = -iy * (-camX * sin + camY * cos);
    curViewY3 = 0;
    gl.uniform4f(uViewXLoc, curViewX0, curViewX1, curViewX2, curViewX3);
    gl.uniform4f(uViewYLoc, curViewY0, curViewY1, curViewY2, curViewY3);

    drawCount = 0;
    needsSort = false;
    prevLayer = -Infinity;
    prevZ = -Infinity;
    prevYSort = false;
    batchTextures.length = 0;
    instanceCount = 0;

    const viewBounds = typeof cam.getViewBounds === 'function'
      ? cam.getViewBounds(subW, subH)
      : {
          minX: camX - subW / (2 * zoom),
          maxX: camX + subW / (2 * zoom),
          minY: camY - subH / (2 * zoom),
          maxY: camY + subH / (2 * zoom),
        };
    for (let i = 0, n = scene.objects.length; i < n; i++) {
      collect(scene.objects[i], alpha, viewBounds, interpolate);
    }

    let items = drawPool;
    if (needsSort && drawCount > 1) {
      stats.sorted = true;
      sortQueue.length = drawCount;
      for (let i = 0; i < drawCount; i++) sortQueue[i] = drawPool[i];
      sortQueue.sort(compareDrawItems);
      items = sortQueue;
    }

    for (let i = 0; i < drawCount; i++) {
      const item = items[i];
      if (item.kind === 0) {
        submitSprite(item, allowShadows, allowSmoothing);
      } else if (item.kind === 1) {
        submitCrowdBatch(item, viewBounds, allowShadows, allowSmoothing);
      } else {
        const crowd = item.sprite;
        const img = crowd.image ?? crowd.sheet?.image ?? null;
        const imgRec = img ? getTextureRecord(img, allowSmoothing) : null;
        parseColorRgba(crowd.color, SCRATCH_RGBA);
        parseColorRgba(crowd.flashColor || '#ffffff', SCRATCH_FLASH);
        submitCrowdAgent(
          crowd, item.agentIndex,
          item.a, item.b, item.c, item.d, item.e, item.f,
          crowd.width, crowd.height, crowd.anchorX ?? 0.5, crowd.anchorY ?? 0.5,
          imgRec, SCRATCH_RGBA[0], SCRATCH_RGBA[1], SCRATCH_RGBA[2],
          SCRATCH_FLASH[0], SCRATCH_FLASH[1], SCRATCH_FLASH[2], allowShadows, true,
        );
      }
      item.entity = null;
      item.sprite = null;
    }

    flushBatch();
    sortQueue.length = 0;
    drawCount = 0;
  }

  function render(scene, app = null) {
    if (contextLost || disposed || !program) return;
    if (!viewport) resize();
    const { vh, dpr, scale, x, y } = viewport;
    const allowSmoothing = qualityPreset ? qualityPreset.imageSmoothing : imageSmoothing;
    const allowShadows = qualityPreset ? qualityPreset.groundShadows : true;
    const usePost = lighting2D.hasActivePass() && postPass.beginScene(canvas.width, canvas.height);

    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(bgRgba[0], bgRgba[1], bgRgba[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    boundTextureUnits.fill(null);

    stats.drawnSprites = 0;
    stats.drawnCrowds = 0;
    stats.culled = 0;
    stats.sorted = false;
    stats.drawCalls = 0;
    stats.instances = 0;
    stats.postPassActive = Boolean(usePost);

    const smoothChanged = lastSmoothingFlag !== null && lastSmoothingFlag !== Boolean(allowSmoothing);
    lastSmoothingFlag = Boolean(allowSmoothing);
    void smoothChanged;

    const alpha = app?.renderAlpha ?? 1;
    if (activeViews && activeViews.length > 0) {
      for (let i = 0; i < activeViews.length; i++) {
        const v = activeViews[i];
        const subW = width * v.width;
        const subH = height * v.height;
        const cssX = x + v.x * width * scale;
        const cssY = y + v.y * height * scale;
        const cssW = subW * scale;
        const cssH = subH * scale;
        const vx = Math.round(cssX * dpr);
        const vy = Math.round((vh - cssY - cssH) * dpr);
        const vwPx = Math.max(1, Math.round(cssW * dpr));
        const vhPx = Math.max(1, Math.round(cssH * dpr));
        renderCameraView(scene, alpha, v.camera, subW, subH, vx, vy, vwPx, vhPx, allowShadows, Boolean(allowSmoothing));
      }
    } else {
      const vx = Math.round(x * dpr);
      const vy = Math.round((vh - y - height * scale) * dpr);
      const vwPx = Math.max(1, Math.round(width * scale * dpr));
      const vhPx = Math.max(1, Math.round(height * scale * dpr));
      renderCameraView(scene, alpha, camera, width, height, vx, vy, vwPx, vhPx, allowShadows, Boolean(allowSmoothing));
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    if (usePost) {
      const activeCam = (activeViews && activeViews.length > 0) ? activeViews[0].camera : camera;
      postPass.endAndComposite(canvas.width, canvas.height, lighting2D, activeCam, viewport, width, height);
    }
  }

  const onContextLost = (event) => {
    event?.preventDefault?.();
    contextLost = true;
    destroyGlResources();
  };
  const onContextRestored = () => {
    contextLost = false;
    initGlResources();
    resize();
  };
  canvas.addEventListener?.('webglcontextlost', onContextLost, false);
  canvas.addEventListener?.('webglcontextrestored', onContextRestored, false);

  initGlResources();
  resize();

  return {
    camera,
    gl,
    get isWebGL2() { return true; },
    get contextLost() { return contextLost; },
    render,
    resize,
    setViews,
    getViews,
    screenToWorld,
    worldToScreen,
    setQuality,
    getQuality,
    get qualityPreset() { return qualityPreset; },
    get stats() { return { ...stats }; },
    getViewport: () => ({ ...viewport }),
    setAmbientLight: lighting2D.setAmbientLight,
    addLight2D: lighting2D.addLight,
    setLights2D: lighting2D.setLights,
    clearLights2D: lighting2D.clearLights,
    setPost2D: lighting2D.setPost,
    getLighting2DState: lighting2D.snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener?.('webglcontextlost', onContextLost, false);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored, false);
      drawPool.length = 0;
      sortQueue.length = 0;
      destroyGlResources();
    },
  };
}

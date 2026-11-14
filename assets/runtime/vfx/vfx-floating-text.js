import {
  VFX_RENDER_ORDERS,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';

export const GLYPH_CHARS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '-', '+', '!', '暴', '闪', '盾',
]);

const scratchDigits = new Int32Array(12);

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

export function bakeGlyphAtlasCanvas() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, 512, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  for (let i = 0; i < GLYPH_CHARS.length; i++) {
    const ch = GLYPH_CHARS[i];
    const cx = i * 32 + 16;
    const cy = 64;
    ctx.font = i >= 13 ? '900 26px sans-serif' : '900 36px monospace, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10, 12, 18, 0.95)';
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
attribute vec4 aTextP0; // x, y, z, spawnTime
attribute vec4 aTextP1; // vx, vy, charOffsetPx, duration
attribute vec4 aTextP2; // glyphIndex, rgb24, scale, isCrit

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
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
  float age = uTime - aTextP0.w;
  float dur = aTextP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = age / dur;
  vAlpha = 1.0 - smoothstep(0.55, 1.0, t);
  vColor = unpackRgb24(aTextP2.y);

  float u0 = aTextP2.x / 16.0;
  vAtlasUv = vec2(u0 + uv.x / 16.0, uv.y);

  float pop = 1.0;
  if (aTextP2.w > 0.5 && age < 0.12) {
    float p = age / 0.12;
    pop = mix(1.65, 1.0, p * p);
  } else if (age < 0.08) {
    pop = mix(1.3, 1.0, age / 0.08);
  }

  float scale = aTextP2.z * pop;
  float grav = (uIs2D > 0.5) ? 240.0 : 9.0;
  vec3 worldCenter = aTextP0.xyz + vec3(aTextP1.x * age, aTextP1.y * age - 0.5 * grav * age * age * ((uIs2D > 0.5) ? -1.0 : 1.0), 0.0);

  if (uIs2D > 0.5) {
    vec2 p2 = worldCenter.xy + vec2(aTextP1.z * scale + position.x * scale * 0.65, position.y * scale * 1.3);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, worldCenter.z, 1.0);
  } else {
    vec4 mv = modelViewMatrix * vec4(worldCenter, 1.0);
    mv.x += aTextP1.z * scale + position.x * scale * 0.65;
    mv.y += position.y * scale * 1.3;
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

export function createFloatingTextPool({
  mode = 'headless',
  THREE = null,
  scene = null,
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  maxFloatingGlyphs = mode === 'canvas2d' ? 2048 : 16384,
} = {}) {
  const capacity = Math.max(16, maxFloatingGlyphs | 0);
  const p0 = new Float32Array(capacity * 4);
  const p1 = new Float32Array(capacity * 4);
  const p2 = new Float32Array(capacity * 4);

  let cursor = 0;
  let dirtyStart = 0;
  let dirtyCount = 0;
  let totalEmitted = 0;
  let simTime = 0;
  let disposed = false;
  const scratchRgb = new Float32Array(3);

  let mesh = null;
  let attrs = null;
  let mat = null;
  let atlasTex = null;

  if (mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry && THREE.PlaneGeometry) {
    const atlasCanvas = bakeGlyphAtlasCanvas();
    if (atlasCanvas && THREE.CanvasTexture) {
      atlasTex = new THREE.CanvasTexture(atlasCanvas);
      atlasTex.needsUpdate = true;
    }

    const baseQuad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseQuad.index;
    geo.attributes.position = baseQuad.attributes.position;
    geo.attributes.uv = baseQuad.attributes.uv;
    geo.instanceCount = capacity;

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
        uTime: { value: 0 },
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uGlyphAtlas: { value: atlasTex },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.FLOATING_TEXT;
    mesh.name = 'HGameVfxFloatingText';
    scene.add(mesh);
    attrs = [a0, a1, a2];
  }

  function popupNumber(opts = {}) {
    const isCrit = Boolean(opts.isCrit);
    const isHeal = Boolean(opts.isHeal);
    const isMiss = Boolean(opts.isMiss);
    const count = extractGlyphIndices(opts.value ?? 0, isCrit, isHeal, isMiss, scratchDigits);

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;
    const vx = opts.vx ?? 0;
    const vy = opts.vy ?? (is2D ? -85 : 3.4);
    const dur = opts.duration ?? (isCrit ? 0.85 : 0.65);
    const scale = opts.scale ?? (is2D ? (isCrit ? 26 : 19) : (isCrit ? 0.85 : 0.58));
    const defaultCol = isMiss ? 0x94a3b8 : isHeal ? 0x4ade80 : isCrit ? 0xfacc15 : 0xffffff;
    const rgb24 = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? defaultCol);
    const spacing = 0.56;
    const halfSpan = (count - 1) * spacing * 0.5;

    for (let i = 0; i < count; i++) {
      const slot = cursor;
      const i4 = slot * 4;
      p0[i4] = x;
      p0[i4 + 1] = y;
      p0[i4 + 2] = z;
      p0[i4 + 3] = simTime;

      p1[i4] = vx;
      p1[i4 + 1] = vy;
      p1[i4 + 2] = i * spacing - halfSpan;
      p1[i4 + 3] = dur;

      p2[i4] = scratchDigits[i];
      p2[i4 + 1] = rgb24;
      p2[i4 + 2] = scale;
      p2[i4 + 3] = isCrit ? 1.0 : 0.0;

      if (dirtyCount === 0) dirtyStart = slot;
      dirtyCount = Math.min(capacity, dirtyCount + 1);
      cursor = (slot + 1) % capacity;
      totalEmitted += 1;
    }
    return count;
  }

  function flushDirty() {
    if (dirtyCount <= 0) return;
    if (attrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(attrs[i], dirtyStart, dirtyCount, capacity, 4);
      }
    }
    dirtyCount = 0;
  }

  function update(visualDt) {
    simTime += Math.max(0, visualDt);
    flushDirty();
    if (mat) mat.uniforms.uTime.value = simTime;
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const count = Math.min(totalEmitted, capacity);
    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      const age = simTime - p0[i4 + 3];
      const dur = p1[i4 + 3];
      if (dur <= 0 || age < 0 || age >= dur) continue;
      const t = age / dur;
      const alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      const scale = p2[i4 + 2] * (p2[i4 + 3] > 0.5 && age < 0.12 ? 1.45 : 1.0) * zoom;
      const wx = p0[i4] + p1[i4] * age + p1[i4 + 2] * scale;
      const wy = p0[i4 + 1] + p1[i4 + 1] * age + 120 * age * age;
      const sx = (wx - camX) * zoom + halfW;
      const sy = (wy - camY) * zoom + halfH;

      const ch = GLYPH_CHARS[p2[i4] | 0] || '';
      unpackRgb24Into(p2[i4 + 1], scratchRgb);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = `900 ${Math.max(10, scale | 0)}px sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,12,18,0.9)';
      ctx.strokeText(ch, sx, sy);
      ctx.fillStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
      ctx.fillText(ch, sx, sy);
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    cursor = dirtyStart = dirtyCount = totalEmitted = 0;
    p1.fill(0);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (mesh) {
      scene?.remove?.(mesh);
      mesh.geometry?.dispose?.();
      mat?.dispose?.();
    }
    atlasTex?.dispose?.();
  }

  return {
    popupNumber,
    update,
    renderCanvas2D,
    reset,
    dispose,
    getStats() {
      return { capacity, totalEmitted, cursor };
    },
  };
}

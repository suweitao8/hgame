import {
  VFX_RENDER_ORDERS,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';

export const TELEGRAPH_SHAPE = Object.freeze({
  CIRCLE: 0,
  RING: 1,
  SECTOR: 2,
  LINE_BOX: 3,
  SHRINK_ZONE: 4,
});

export const TELEGRAPH_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 aTeleP0; // x, y, z, spawnTime
attribute vec4 aTeleP1; // yawRad, scaleX, scaleZ, duration
attribute vec4 aTeleP2; // shapeId, rgb24, paramA (angleHalf / innerRatio / boxRatio / bandRatio), paramB

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
uniform float uIs2D;

varying vec2 vLocal;
varying vec3 vColor;
varying float vShapeId;
varying float vProgress;
varying float vParamA;
varying float vParamB;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float age = uTime - aTeleP0.w;
  float dur = aTeleP1.w;
  if (dur <= 0.0 || age < 0.0 || (dur < 99990.0 && age >= dur)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vProgress = (dur >= 99990.0) ? 1.0 : clamp(age / dur, 0.0, 1.0);
  vLocal = uv - 0.5;
  vShapeId = aTeleP2.x;
  vColor = unpackRgb24(aTeleP2.y);
  vParamA = aTeleP2.z;
  vParamB = aTeleP2.w;

  float yaw = aTeleP1.x;
  float c = cos(yaw);
  float s = sin(yaw);
  vec2 scaled = position.xy * vec2(aTeleP1.y, aTeleP1.z);

  vec3 worldPos;
  if (uIs2D > 0.5) {
    worldPos = vec3(
      aTeleP0.x + scaled.x * c - scaled.y * s,
      aTeleP0.y + scaled.x * s + scaled.y * c,
      aTeleP0.z
    );
  } else {
    worldPos = vec3(
      aTeleP0.x + scaled.x * c - scaled.y * s,
      aTeleP0.y + 0.03,
      aTeleP0.z + scaled.x * s + scaled.y * c
    );
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

export const TELEGRAPH_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform float uTime;

varying vec2 vLocal;
varying vec3 vColor;
varying float vShapeId;
varying float vProgress;
varying float vParamA;
varying float vParamB;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdSector(vec2 p, float halfAng) {
  vec2 q = vec2(abs(p.x), p.y);
  vec2 c = vec2(sin(halfAng), cos(halfAng));
  float l = length(q) - 0.5;
  float m = length(q - c * clamp(dot(q, c), 0.0, 0.5));
  return max(l, m * sign(c.y * q.x - c.x * q.y));
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  if (vShapeId > 3.5) {
    // 4: SHRINK_ZONE (vParamA = safeNormRadius, vParamB = 2.5m / mapDiameter)
    float r = length(vLocal);
    if (r < vParamA) discard;
    float ang = atan(vLocal.y, vLocal.x);
    float flameWave = (0.35 * sin(ang * 14.0 + uTime * 4.5) + 0.22 * cos(ang * 23.0 - uTime * 6.2)) * vParamB;
    float distOut = r - vParamA;
    float edgeDist = distOut + flameWave;
    float band = max(0.004, vParamB);
    float innerFire = 1.0 - smoothstep(0.0, band * 0.45, abs(edgeDist));
    float outerDark = smoothstep(0.0, band, distOut);
    vec3 col = mix(vec3(0.95, 0.22, 0.12), vec3(0.08, 0.02, 0.14), outerDark);
    col = mix(col, vec3(0.02, 0.01, 0.03), smoothstep(band, band * 2.5, distOut));
    float alpha = clamp(innerFire * 0.95 + outerDark * 0.55, 0.0, 0.85);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
    return;
  }

  float d = 0.0;
  float fillMask = 0.0;
  vec2 p = vLocal;

  if (vShapeId < 0.5) {
    d = sdCircle(p, 0.5);
    float innerD = sdCircle(p, 0.5 * vProgress);
    fillMask = step(innerD, 0.0) * 0.26;
  } else if (vShapeId < 1.5) {
    float rMid = mix(0.25, 0.46, vParamA);
    float halfW = max(0.02, 0.5 - rMid);
    d = abs(length(p) - rMid) - halfW;
    fillMask = step(d, 0.0) * (0.14 + 0.22 * vProgress);
  } else if (vShapeId < 2.5) {
    float halfAng = clamp(vParamA, 0.05, 3.14159);
    d = sdSector(p, halfAng);
    float innerR = length(p) - 0.5 * vProgress;
    fillMask = step(d, 0.0) * (0.14 + 0.24 * step(innerR, 0.0));
  } else {
    vec2 b = vec2(clamp(vParamA, 0.05, 0.49), 0.48);
    d = sdBox(p, b);
    float chevron = smoothstep(0.55, 0.85, fract((p.y + 0.5) * 6.0 - uTime * 3.0 - abs(p.x) * 2.0));
    fillMask = step(d, 0.0) * (0.16 + 0.24 * chevron * vProgress);
  }

#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
  float aa = max(0.002, fwidth(d));
#else
  float aa = 0.006;
#endif
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.005) discard;

  float border = 1.0 - smoothstep(0.0, max(0.018, aa * 2.5), abs(d));
  float flash = (vProgress > 0.85) ? (0.65 + 0.35 * sin(uTime * 150.796)) : 1.0; // ~24Hz
  float alpha = clamp((fillMask + border * 0.85) * inside * flash, 0.0, 0.95);
  vec3 col = mix(vColor, vec3(1.0), border * 0.45);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createTelegraphSystem({
  mode = 'headless',
  THREE = null,
  scene = null,
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  maxTelegraphs = 512,
} = {}) {
  const capacity = Math.max(2, maxTelegraphs | 0);
  const shrinkSlot = capacity - 1;
  const ringCap = capacity - 1;

  const p0 = new Float32Array(capacity * 4);
  const p1 = new Float32Array(capacity * 4);
  const p2 = new Float32Array(capacity * 4);

  let cursor = 0;
  let dirtyStart = 0;
  let dirtyCount = 0;
  let totalSpawned = 0;
  let simTime = 0;
  let disposed = false;
  const scratchRgb = new Float32Array(3);

  let mesh = null;
  let attrs = null;
  let mat = null;

  if (mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry && THREE.PlaneGeometry) {
    const baseQuad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseQuad.index;
    geo.attributes.position = baseQuad.attributes.position;
    geo.attributes.uv = baseQuad.attributes.uv;
    geo.instanceCount = capacity;

    const a0 = new THREE.InstancedBufferAttribute(p0, 4);
    const a1 = new THREE.InstancedBufferAttribute(p1, 4);
    const a2 = new THREE.InstancedBufferAttribute(p2, 4);
    geo.setAttribute('aTeleP0', a0);
    geo.setAttribute('aTeleP1', a1);
    geo.setAttribute('aTeleP2', a2);

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    mat = new MatCtor({
      vertexShader: TELEGRAPH_VERTEX_GLSL,
      fragmentShader: TELEGRAPH_FRAGMENT_GLSL,
      uniforms: {
        uTime: { value: 0 },
        uIs2D: { value: is2D ? 1.0 : 0.0 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
    });

    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.TELEGRAPH;
    mesh.name = 'HGameVfxTelegraphs';
    scene.add(mesh);
    attrs = [a0, a1, a2];
  }

  function resolveShape(shape) {
    if (typeof shape === 'number') return shape;
    switch (shape) {
      case 'ring': return TELEGRAPH_SHAPE.RING;
      case 'sector': return TELEGRAPH_SHAPE.SECTOR;
      case 'line':
      case 'line_box':
      case 'box': return TELEGRAPH_SHAPE.LINE_BOX;
      case 'shrink':
      case 'shrink_zone': return TELEGRAPH_SHAPE.SHRINK_ZONE;
      default: return TELEGRAPH_SHAPE.CIRCLE;
    }
  }

  function writeSlot(slot, opts) {
    const i4 = slot * 4;
    const shapeId = resolveShape(opts.shape);
    const radius = opts.radius ?? 3.0;
    const width = opts.width ?? radius * 2;
    const length = opts.length ?? radius * 2;

    p0[i4] = opts.x ?? 0;
    p0[i4 + 1] = opts.y ?? 0;
    p0[i4 + 2] = opts.z ?? 0;
    p0[i4 + 3] = simTime;

    p1[i4] = opts.yawRad ?? opts.angle ?? 0;
    p1[i4 + 1] = shapeId === TELEGRAPH_SHAPE.LINE_BOX ? width : radius * 2;
    p1[i4 + 2] = shapeId === TELEGRAPH_SHAPE.LINE_BOX ? length : radius * 2;
    p1[i4 + 3] = opts.duration ?? 1.0;

    p2[i4] = shapeId;
    p2[i4 + 1] = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0xef4444);
    if (shapeId === TELEGRAPH_SHAPE.SECTOR) {
      p2[i4 + 2] = (opts.angleRad ?? Math.PI * 0.5) * 0.5;
    } else if (shapeId === TELEGRAPH_SHAPE.RING) {
      p2[i4 + 2] = opts.innerRatio ?? 0.65;
    } else if (shapeId === TELEGRAPH_SHAPE.LINE_BOX) {
      p2[i4 + 2] = Math.min(0.49, (width / Math.max(0.01, length)) * 0.5);
    } else {
      p2[i4 + 2] = opts.paramA ?? 0;
    }
    p2[i4 + 3] = opts.paramB ?? 0;
  }

  function spawnTelegraph(opts = {}) {
    const slot = cursor;
    writeSlot(slot, opts);
    if (dirtyCount === 0) dirtyStart = slot;
    dirtyCount = Math.min(ringCap, dirtyCount + 1);
    cursor = (slot + 1) % ringCap;
    totalSpawned += 1;
    return slot;
  }

  function updateTelegraph(slot, opts = {}) {
    if (slot < 0 || slot >= ringCap) return;
    writeSlot(slot, opts);
    if (attrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(attrs[i], slot, 1, capacity, 4);
      }
    }
  }

  function setShrinkZone({
    centerX = 0,
    centerY = 0,
    centerZ = 0,
    safeRadius = 40,
    mapRadius = 160,
    active = true,
  } = {}) {
    const i4 = shrinkSlot * 4;
    const totalR = Math.max(safeRadius + 5, mapRadius);
    p0[i4] = centerX;
    p0[i4 + 1] = centerY;
    p0[i4 + 2] = centerZ;
    p0[i4 + 3] = 0;

    p1[i4] = 0;
    p1[i4 + 1] = totalR * 2;
    p1[i4 + 2] = totalR * 2;
    p1[i4 + 3] = active ? 99999.0 : 0.0;

    p2[i4] = TELEGRAPH_SHAPE.SHRINK_ZONE;
    p2[i4 + 1] = 0xff2200;
    p2[i4 + 2] = Math.max(0.001, Math.min(0.49, (safeRadius / (totalR * 2))));
    p2[i4 + 3] = 2.5 / Math.max(1.0, totalR * 2);

    if (attrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(attrs[i], shrinkSlot, 1, capacity, 4);
      }
    }
  }

  function flushDirty() {
    if (dirtyCount <= 0) return;
    if (attrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(attrs[i], dirtyStart, dirtyCount, ringCap, 4);
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
    const count = Math.min(totalSpawned, ringCap);
    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      const dur = p1[i4 + 3];
      const age = simTime - p0[i4 + 3];
      if (dur <= 0 || age < 0 || age >= dur) continue;
      const prog = age / dur;
      const sx = (p0[i4] - camX) * zoom + halfW;
      const sy = (p0[i4 + 1] - camY) * zoom + halfH;
      const rad = p1[i4 + 1] * 0.5 * zoom;
      unpackRgb24Into(p2[i4 + 1], scratchRgb);
      const rgbStr = `${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0}`;

      ctx.strokeStyle = `rgba(${rgbStr},0.85)`;
      ctx.fillStyle = `rgba(${rgbStr},0.22)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (p2[i4] === TELEGRAPH_SHAPE.SECTOR) {
        const yaw = p1[i4];
        const halfA = p2[i4 + 2];
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, rad, yaw - halfA, yaw + halfA);
        ctx.closePath();
      } else {
        ctx.arc(sx, sy, rad, 0, 6.2831853);
      }
      ctx.fill();
      ctx.stroke();

      if (p2[i4] === TELEGRAPH_SHAPE.CIRCLE) {
        ctx.beginPath();
        ctx.arc(sx, sy, rad * prog, 0, 6.2831853);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    cursor = dirtyStart = dirtyCount = totalSpawned = 0;
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
  }

  return {
    spawnTelegraph,
    updateTelegraph,
    setShrinkZone,
    update,
    renderCanvas2D,
    reset,
    dispose,
    getStats() {
      return { capacity, totalSpawned };
    },
  };
}

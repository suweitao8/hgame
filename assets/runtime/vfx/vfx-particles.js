import {
  CHAMFERED_OCTAGON_TRIS_2D,
  VFX_RENDER_ORDERS,
  createChamferedOctagonGeometry,
  createVisualPrng,
  isMobileOrMiniGameEnv,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';

export const VFX_SHAPE = Object.freeze({
  GLOW_ORB: 0,
  HIT_SPARK: 1,
  SMOKE_PUFF: 2,
  SHOCK_RING: 3,
  SHARD_BLADE: 4,
});

export const PARTICLE_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 aVfxP0; // x0, y0, z0, spawnTime
attribute vec4 aVfxP1; // vx, vy, vz, duration
attribute vec4 aVfxP2; // sizeStart, sizeEnd, gravity, drag
attribute vec4 aVfxP3; // rgb24, shapeId, stretch, phase

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
uniform float uIs2D;

varying vec2 vUv;
varying vec3 vColor;
varying float vLifeRatio;
varying float vShapeId;
varying float vPhase;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float age = uTime - aVfxP0.w;
  float dur = aVfxP1.w;

  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = age / dur;
  vLifeRatio = t;
  vUv = uv * 2.0 - 1.0;
  vColor = unpackRgb24(aVfxP3.x);
  vShapeId = aVfxP3.y;
  vPhase = aVfxP3.w;

  float k = aVfxP2.w;
  float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
  float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;

  vec3 gVec = (uIs2D > 0.5) ? vec3(0.0, aVfxP2.z, 0.0) : vec3(0.0, -aVfxP2.z, 0.0);
  vec3 worldPos = aVfxP0.xyz + aVfxP1.xyz * dispFactor + 0.5 * gVec * (age * age);
  vec3 curVel = aVfxP1.xyz * velDecay + gVec * age;

  float curSize = mix(aVfxP2.x, aVfxP2.y, t);
  float stretch = aVfxP3.z;

  if (uIs2D > 0.5) {
    vec2 dir2 = vec2(1.0, 0.0);
    float spd2 = length(curVel.xy);
    if (spd2 > 0.001 && stretch > 0.01) {
      dir2 = curVel.xy / spd2;
    } else {
      float ang = vPhase * 6.2831853 + age * 3.0;
      dir2 = vec2(cos(ang), sin(ang));
    }
    vec2 perp2 = vec2(-dir2.y, dir2.x);
    float lenScale = curSize * (1.0 + stretch * min(spd2 * 0.015, 4.0));
    vec2 final2D = worldPos.xy + dir2 * (position.x * lenScale) + perp2 * (position.y * curSize);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(final2D, worldPos.z, 1.0);
  } else {
    vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);
    vec3 viewVel = mat3(modelViewMatrix) * curVel;
    float spd = length(viewVel.xy);
    vec2 rightAxis = vec2(1.0, 0.0);
    if (spd > 0.001 && stretch > 0.01) {
      rightAxis = viewVel.xy / spd;
    } else {
      float ang = vPhase * 6.2831853 + age * 2.5;
      rightAxis = vec2(cos(ang), sin(ang));
    }
    vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);
    float major = curSize * (1.0 + stretch * min(spd * 0.08, 4.5));
    mvCenter.xy += rightAxis * (position.x * major) + upAxis * (position.y * curSize);
    gl_Position = projectionMatrix * mvCenter;
  }
}
`;

export const PARTICLE_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vColor;
varying float vLifeRatio;
varying float vShapeId;
varying float vPhase;

void main() {
  float r = length(vUv);
  if (r > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float fade = 1.0 - smoothstep(0.65, 1.0, vLifeRatio);
  float alpha = 0.0;
  vec3 col = vColor;

  if (vShapeId < 0.5) {
    alpha = exp(-4.2 * r * r) * fade;
    col = mix(col, vec3(1.0), exp(-10.0 * r * r) * 0.65);
  } else if (vShapeId < 1.5) {
    float star = max(1.0 - (pow(abs(vUv.x), 0.45) + pow(abs(vUv.y), 0.45)), 0.0);
    alpha = max(star, exp(-8.0 * r * r)) * fade;
    col = mix(col, vec3(1.0), 0.5 * (1.0 - vLifeRatio));
  } else if (vShapeId < 2.5) {
    float ang = atan(vUv.y, vUv.x);
    float wobble = 0.14 * sin(ang * 5.0 + vPhase * 12.0) + 0.08 * cos(ang * 9.0 - vLifeRatio * 6.0);
    float edge = 0.82 + wobble - vLifeRatio * 0.25;
    alpha = (1.0 - smoothstep(edge - 0.18, edge, r)) * fade;
  } else if (vShapeId < 3.5) {
    float ringRadius = mix(0.25, 0.90, vLifeRatio);
    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;
  } else {
    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;
    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;
    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);
  }

  if (alpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = vec4(col, alpha);
}
`;

export const PARTICLE_WEBGL2_2D_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aQuadPos; // [-0.5, 0.5]
layout(location = 1) in vec4 aVfxP0;
layout(location = 2) in vec4 aVfxP1;
layout(location = 3) in vec4 aVfxP2;
layout(location = 4) in vec4 aVfxP3;

uniform float uTime;
uniform vec2 uCamPos;
uniform float uCamZoom;
uniform vec2 uViewSize;

out vec2 vUv;
out vec3 vColor;
out float vLifeRatio;
out float vShapeId;
out float vPhase;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float age = uTime - aVfxP0.w;
  float dur = aVfxP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = age / dur;
  vLifeRatio = t;
  vUv = aQuadPos * 2.0;
  vColor = unpackRgb24(aVfxP3.x);
  vShapeId = aVfxP3.y;
  vPhase = aVfxP3.w;

  float k = aVfxP2.w;
  float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;
  float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;

  vec2 gVec = vec2(0.0, aVfxP2.z);
  vec2 worldPos = aVfxP0.xy + aVfxP1.xy * dispFactor + 0.5 * gVec * (age * age);
  vec2 curVel = aVfxP1.xy * velDecay + gVec * age;

  float curSize = mix(aVfxP2.x, aVfxP2.y, t);
  float stretch = aVfxP3.z;
  float spd = length(curVel);
  vec2 dir2 = (spd > 0.001 && stretch > 0.01)
    ? (curVel / spd)
    : vec2(cos(vPhase * 6.2831853 + age * 3.0), sin(vPhase * 6.2831853 + age * 3.0));
  vec2 perp2 = vec2(-dir2.y, dir2.x);
  float lenScale = curSize * (1.0 + stretch * min(spd * 0.015, 4.0));
  vec2 p = worldPos + dir2 * (aQuadPos.x * lenScale) + perp2 * (aQuadPos.y * curSize);

  vec2 screenPx = (p - uCamPos) * uCamZoom + uViewSize * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,
    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const PARTICLE_WEBGL2_2D_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vLifeRatio;
in float vShapeId;
in float vPhase;

out vec4 fragColor;

void main() {
  float r = length(vUv);
  if (r > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  float fade = 1.0 - smoothstep(0.65, 1.0, vLifeRatio);
  float alpha = 0.0;
  vec3 col = vColor;

  if (vShapeId < 0.5) {
    alpha = exp(-4.2 * r * r) * fade;
    col = mix(col, vec3(1.0), exp(-10.0 * r * r) * 0.65);
  } else if (vShapeId < 1.5) {
    float star = max(1.0 - (pow(abs(vUv.x), 0.45) + pow(abs(vUv.y), 0.45)), 0.0);
    alpha = max(star, exp(-8.0 * r * r)) * fade;
    col = mix(col, vec3(1.0), 0.5 * (1.0 - vLifeRatio));
  } else if (vShapeId < 2.5) {
    float ang = atan(vUv.y, vUv.x);
    float wobble = 0.14 * sin(ang * 5.0 + vPhase * 12.0) + 0.08 * cos(ang * 9.0 - vLifeRatio * 6.0);
    float edge = 0.82 + wobble - vLifeRatio * 0.25;
    alpha = (1.0 - smoothstep(edge - 0.18, edge, r)) * fade;
  } else if (vShapeId < 3.5) {
    float ringRadius = mix(0.25, 0.90, vLifeRatio);
    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;
  } else {
    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;
    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;
    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);
  }

  if (alpha < 0.01) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = vec4(col, alpha);
}
`;

function createChannelPool(capacity, additive) {
  const p0 = new Float32Array(capacity * 4);
  const p1 = new Float32Array(capacity * 4);
  const p2 = new Float32Array(capacity * 4);
  const p3 = new Float32Array(capacity * 4);

  return {
    capacity,
    additive,
    p0,
    p1,
    p2,
    p3,
    cursor: 0,
    totalEmitted: 0,
    dirtyStart: 0,
    dirtyCount: 0,
    wrapCount: 0,
    latestDeath: -Infinity,
    chunkLatestDeath: new Float32Array(Math.ceil(capacity / 256)).fill(-Infinity),
    lastDirtyRanges: [],
    threeMesh: null,
    threeAttrs: null,
    threeMat: null,
    glVao: null,
    glVbos: null,
  };
}

function compileWebGL2Program(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'VFX shader compile error';
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
    const log = gl.getProgramInfoLog(prog) || 'VFX program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

/**
 * Creates a stateless analytical GPU particle pool (normal + additive channels)
 * with automatic fallback for Canvas2D and headless Node environments.
 */
export function createStatelessParticlePool({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  gl = /** @type {WebGL2RenderingContext | null} */ (null),
  mobile = isMobileOrMiniGameEnv(),
  maxParticles = mode === 'canvas2d' ? 1024 : (mobile ? 16384 : 65536),
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  prng = createVisualPrng(0x9e3779b9),
} = {}) {
  const capacity = Math.max(1, maxParticles | 0);
  const normalPool = createChannelPool(capacity, false);
  const additivePool = createChannelPool(capacity, true);
  const channels = [normalPool, additivePool];

  const scratchRgb = new Float32Array(3);
  let simTime = 0;
  let glProg = null;
  let glQuadVbo = null;
  let glUniforms = null;
  let disposed = false;

  function initThreeChannel(ch) {
    if (!THREE || !scene || !THREE.InstancedBufferGeometry || !THREE.BufferAttribute) return;
    const geo = createChamferedOctagonGeometry(THREE);
    geo.instanceCount = 0;

    const a0 = new THREE.InstancedBufferAttribute(ch.p0, 4);
    const a1 = new THREE.InstancedBufferAttribute(ch.p1, 4);
    const a2 = new THREE.InstancedBufferAttribute(ch.p2, 4);
    const a3 = new THREE.InstancedBufferAttribute(ch.p3, 4);
    if (THREE.DynamicDrawUsage) {
      a0.setUsage(THREE.DynamicDrawUsage);
      a1.setUsage(THREE.DynamicDrawUsage);
      a2.setUsage(THREE.DynamicDrawUsage);
      a3.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute('aVfxP0', a0);
    geo.setAttribute('aVfxP1', a1);
    geo.setAttribute('aVfxP2', a2);
    geo.setAttribute('aVfxP3', a3);

    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    const mat = new MatCtor({
      vertexShader: PARTICLE_VERTEX_GLSL,
      fragmentShader: PARTICLE_FRAGMENT_GLSL,
      uniforms: {
        uTime: { value: 0 },
        uIs2D: { value: is2D ? 1.0 : 0.0 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: ch.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.PARTICLES;
    mesh.name = ch.additive ? 'HGameVfxParticlesAdditive' : 'HGameVfxParticlesNormal';
    scene.add(mesh);

    ch.threeMesh = mesh;
    ch.threeAttrs = [a0, a1, a2, a3];
    ch.threeMat = mat;
  }

  function initWebGL2() {
    if (!gl || typeof gl.createVertexArray !== 'function') return;
    glProg = compileWebGL2Program(gl, PARTICLE_WEBGL2_2D_VS, PARTICLE_WEBGL2_2D_FS);
    glUniforms = {
      uTime: gl.getUniformLocation(glProg, 'uTime'),
      uCamPos: gl.getUniformLocation(glProg, 'uCamPos'),
      uCamZoom: gl.getUniformLocation(glProg, 'uCamZoom'),
      uViewSize: gl.getUniformLocation(glProg, 'uViewSize'),
    };
    glQuadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, CHAMFERED_OCTAGON_TRIS_2D, gl.STATIC_DRAW);

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, glQuadVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3];
      const vbos = [];
      for (let i = 0; i < 4; i++) {
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, dataArrs[i], gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(i + 1);
        gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(i + 1, 1);
        vbos.push(vbo);
      }
      ch.glVao = vao;
      ch.glVbos = vbos;
    }
    gl.bindVertexArray(null);
  }

  if (mode === '3d' && THREE && scene) {
    initThreeChannel(normalPool);
    initThreeChannel(additivePool);
  } else if (mode === 'webgl2d' && gl) {
    initWebGL2();
  }

  function emitOne(
    x, y, z,
    vx, vy, vz,
    sizeStart, sizeEnd,
    duration, gravity, drag,
    rgb24, shapeId, stretch,
    additive, phase,
  ) {
    const ch = additive ? additivePool : normalPool;
    const idx = ch.cursor;
    const i4 = idx * 4;

    ch.p0[i4] = x;
    ch.p0[i4 + 1] = y;
    ch.p0[i4 + 2] = z;
    ch.p0[i4 + 3] = simTime;

    ch.p1[i4] = vx;
    ch.p1[i4 + 1] = vy;
    ch.p1[i4 + 2] = vz;
    ch.p1[i4 + 3] = duration;

    ch.p2[i4] = sizeStart;
    ch.p2[i4 + 1] = sizeEnd;
    ch.p2[i4 + 2] = gravity;
    ch.p2[i4 + 3] = drag;

    ch.p3[i4] = rgb24;
    ch.p3[i4 + 1] = shapeId;
    ch.p3[i4 + 2] = stretch;
    ch.p3[i4 + 3] = phase;

    const death = simTime + duration;
    if (death > ch.latestDeath) ch.latestDeath = death;
    const chunk = idx >>> 8;
    if (death > ch.chunkLatestDeath[chunk]) ch.chunkLatestDeath[chunk] = death;

    if (ch.dirtyCount === 0) {
      ch.dirtyStart = idx;
    }
    ch.dirtyCount = Math.min(ch.capacity, ch.dirtyCount + 1);

    const next = idx + 1;
    if (next >= ch.capacity) {
      ch.cursor = 0;
      ch.wrapCount += 1;
    } else {
      ch.cursor = next;
    }
    ch.totalEmitted += 1;
  }

  function syncThreeChannelState(ch) {
    if (!ch.threeMesh) return;
    const now = Math.fround(simTime);
    const hasLive = ch.totalEmitted > 0 && now <= ch.latestDeath;
    if (!hasLive) {
      ch.threeMesh.geometry.instanceCount = 0;
      ch.threeMesh.visible = false;
      return;
    }
    let count = Math.min(ch.totalEmitted, ch.capacity);
    if (ch.totalEmitted <= ch.capacity) {
      let lastChunk = Math.ceil(count / 256) - 1;
      while (lastChunk >= 0 && now > ch.chunkLatestDeath[lastChunk]) lastChunk -= 1;
      count = lastChunk >= 0 ? Math.min(count, (lastChunk + 1) * 256) : 0;
    }
    ch.threeMesh.geometry.instanceCount = count;
    ch.threeMesh.visible = count > 0;
  }

  function flushChannel(ch) {
    if (ch.dirtyCount <= 0) {
      syncThreeChannelState(ch);
      return;
    }

    if (ch.threeAttrs) {
      for (let i = 0; i < 4; i++) {
        submitRingBufferRanges(
          ch.threeAttrs[i],
          ch.dirtyStart,
          ch.dirtyCount,
          ch.capacity,
          4,
          i === 0 ? ch.lastDirtyRanges : null,
        );
      }
    } else {
      submitRingBufferRanges(null, ch.dirtyStart, ch.dirtyCount, ch.capacity, 4, ch.lastDirtyRanges);
      if (gl && ch.glVbos) {
        const dataArrs = [ch.p0, ch.p1, ch.p2, ch.p3];
        for (let r = 0; r < ch.lastDirtyRanges.length; r++) {
          const range = ch.lastDirtyRanges[r];
          const byteOff = range.offset * 16;
          const floatStart = range.offset * 4;
          const floatEnd = floatStart + range.count * 4;
          for (let a = 0; a < 4; a++) {
            gl.bindBuffer(gl.ARRAY_BUFFER, ch.glVbos[a]);
            gl.bufferSubData(gl.ARRAY_BUFFER, byteOff, dataArrs[a].subarray(floatStart, floatEnd));
          }
        }
      }
    }

    syncThreeChannelState(ch);
    ch.dirtyCount = 0;
  }

  function flushDirty() {
    flushChannel(normalPool);
    flushChannel(additivePool);
  }

  function emit(opts) {
    const rgb24 = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0xffffff);
    const phase = opts.phase !== undefined ? opts.phase : prng.nextFloat();
    emitOne(
      opts.x ?? 0,
      opts.y ?? 0,
      opts.z ?? 0,
      opts.vx ?? 0,
      opts.vy ?? 0,
      opts.vz ?? 0,
      opts.sizeStart ?? 0.35,
      opts.sizeEnd ?? 0.05,
      opts.duration ?? 0.35,
      opts.gravity ?? 0,
      opts.drag ?? 2.0,
      rgb24,
      opts.shape ?? VFX_SHAPE.GLOW_ORB,
      opts.stretch ?? 0,
      Boolean(opts.additive),
      phase,
    );
  }

  function burst(opts = {}) {
    const count = Math.max(1, (opts.count ?? 12) | 0);
    const cx = opts.x ?? 0;
    const cy = opts.y ?? 0;
    const cz = opts.z ?? 0;
    const speedMin = opts.speedMin ?? 2.0;
    const speedMax = opts.speedMax ?? 8.0;
    const sizeStart = opts.sizeStart ?? 0.35;
    const sizeEnd = opts.sizeEnd ?? 0.04;
    const durationMin = opts.durationMin ?? (opts.duration ?? 0.25);
    const durationMax = opts.durationMax ?? (opts.duration ?? 0.45);
    const gravity = opts.gravity ?? 9.8;
    const drag = opts.drag ?? 3.5;
    const rgb24 = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0xffd166);
    const shape = opts.shape ?? VFX_SHAPE.HIT_SPARK;
    const stretch = opts.stretch ?? 0.8;
    const additive = opts.additive !== undefined ? Boolean(opts.additive) : true;
    const dirX = opts.dirX ?? 0;
    const dirY = opts.dirY ?? 0;
    const dirZ = opts.dirZ ?? 0;
    const dirBias = opts.dirBias ?? 0;

    for (let i = 0; i < count; i++) {
      const spd = prng.range(speedMin, speedMax);
      const dur = prng.range(durationMin, durationMax);
      const ang = prng.nextFloat() * 6.283185307179586;
      let vx, vy, vz;
      if (is2D) {
        vx = Math.cos(ang) * spd + dirX * dirBias;
        vy = Math.sin(ang) * spd + dirY * dirBias;
        vz = 0;
      } else {
        const elev = prng.range(-0.4, 0.95);
        const horiz = Math.sqrt(Math.max(0.05, 1.0 - elev * elev));
        vx = Math.cos(ang) * horiz * spd + dirX * dirBias;
        vy = elev * spd + dirY * dirBias;
        vz = Math.sin(ang) * horiz * spd + dirZ * dirBias;
      }
      emitOne(
        cx, cy, cz,
        vx, vy, vz,
        sizeStart, sizeEnd,
        dur, gravity, drag,
        rgb24, shape, stretch,
        additive, prng.nextFloat(),
      );
    }
  }

  function update(visualDt) {
    simTime += Math.max(0, visualDt);
    flushDirty();
    if (normalPool.threeMat) normalPool.threeMat.uniforms.uTime.value = simTime;
    if (additivePool.threeMat) additivePool.threeMat.uniforms.uTime.value = simTime;
  }

  function renderWebGL2(camera, viewWidth, viewHeight) {
    if (!gl || !glProg || disposed) return;
    flushDirty();

    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(glProg);
    gl.uniform1f(glUniforms.uTime, simTime);
    gl.uniform2f(glUniforms.uCamPos, camera?.x ?? 0, camera?.y ?? 0);
    gl.uniform1f(glUniforms.uCamZoom, camera?.zoom ?? 1);
    gl.uniform2f(glUniforms.uViewSize, viewWidth, viewHeight);

    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const activeCount = Math.min(ch.totalEmitted, ch.capacity);
      if (activeCount <= 0 || !ch.glVao || Math.fround(simTime) > ch.latestDeath) continue;
      if (ch.additive) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.bindVertexArray(ch.glVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, activeCount);
    }

    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (!prevBlend) gl.disable(gl.BLEND);
    if (prevDepth) gl.enable(gl.DEPTH_TEST);
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      const count = Math.min(ch.totalEmitted, ch.capacity);
      if (count <= 0 || Math.fround(simTime) > ch.latestDeath) continue;
      ctx.globalCompositeOperation = ch.additive ? 'lighter' : 'source-over';
      const chunks = Math.ceil(count / 256);
      for (let b = 0; b < chunks; b++) {
        if (Math.fround(simTime) > ch.chunkLatestDeath[b]) continue;
        const startIdx = b * 256;
        const endIdx = Math.min(count, startIdx + 256);
        for (let i = startIdx; i < endIdx; i++) {
          const i4 = i * 4;
          const age = simTime - ch.p0[i4 + 3];
          const dur = ch.p1[i4 + 3];
          if (dur <= 0 || age < 0 || age >= dur) continue;
          const t = age / dur;
          const k = ch.p2[i4 + 3];
          const disp = k > 0.001 ? (1 - Math.exp(-k * age)) / k : age;
          const g = ch.p2[i4 + 2];
          const wx = ch.p0[i4] + ch.p1[i4] * disp;
          const wy = ch.p0[i4 + 1] + ch.p1[i4 + 1] * disp + 0.5 * g * age * age;
          const sx = (wx - camX) * zoom + halfW;
          const sy = (wy - camY) * zoom + halfH;
          const size = (ch.p2[i4] + (ch.p2[i4 + 1] - ch.p2[i4]) * t) * zoom;
          if (size <= 0.25) continue;

          const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
          unpackRgb24Into(ch.p3[i4], scratchRgb);
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.fillStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
          ctx.beginPath();
          if (ch.p3[i4 + 1] === VFX_SHAPE.SHOCK_RING) {
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = Math.max(1.5, size * 0.14);
            ctx.arc(sx, sy, size * (0.25 + 0.65 * t), 0, 6.2831853);
            ctx.stroke();
          } else {
            ctx.arc(sx, sy, size * 0.5, 0, 6.2831853);
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      ch.cursor = 0;
      ch.totalEmitted = 0;
      ch.dirtyStart = 0;
      ch.dirtyCount = 0;
      ch.wrapCount = 0;
      ch.latestDeath = -Infinity;
      ch.chunkLatestDeath.fill(-Infinity);
      ch.lastDirtyRanges.length = 0;
      ch.p0.fill(0);
      ch.p1.fill(0);
      if (ch.threeMesh) {
        ch.threeMesh.geometry.instanceCount = 0;
        ch.threeMesh.visible = false;
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      if (ch.threeMesh) {
        scene?.remove?.(ch.threeMesh);
        ch.threeMesh.geometry?.dispose?.();
        ch.threeMat?.dispose?.();
      }
      if (gl && ch.glVao) {
        gl.deleteVertexArray(ch.glVao);
        for (let i = 0; i < ch.glVbos.length; i++) gl.deleteBuffer(ch.glVbos[i]);
      }
    }
    if (gl && glQuadVbo) gl.deleteBuffer(glQuadVbo);
    if (gl && glProg) gl.deleteProgram(glProg);
  }

  return {
    capacity,
    emit,
    burst,
    flushDirty,
    update,
    renderWebGL2,
    renderCanvas2D,
    reset,
    dispose,
    get time() { return simTime; },
    getStats() {
      return {
        capacity,
        normalCursor: normalPool.cursor,
        additiveCursor: additivePool.cursor,
        normalTotal: normalPool.totalEmitted,
        additiveTotal: additivePool.totalEmitted,
        normalWrapCount: normalPool.wrapCount,
        additiveWrapCount: additivePool.wrapCount,
        normalLastRanges: normalPool.lastDirtyRanges,
        additiveLastRanges: additivePool.lastDirtyRanges,
      };
    },
  };
}

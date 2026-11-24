/**
 * Stateful WebGL2 MRT Ping-Pong GPU Particle System (VFX-Graph tier).
 *
 * Updates up to 262,144 particles entirely inside GPU VRAM via dual-attachment
 * `RGBA32F` / `RGBA16F` Ping-Pong FBOs:
 *   - Attachment 0: vec4(posX, posY, posZ, age)  [age < 0.0 => inactive]
 *   - Attachment 1: vec4(velX, velY, velZ, life)
 *
 * Features:
 *   - Inline ring-spawn window: uploads only dirty rows of newly emitted particles
 *   - Zero CPU per-particle stepping & zero CPU->GPU uploads while particles live
 *   - 3D Curl Noise turbulence, Attractor & Vortex force fields, exponential drag, maxSpeed clamp
 *   - Ground plane bounce + optional Screen-Space Depth buffer collision
 *   - Zero-copy instanced vertex-shader `texelFetch` rendering (single draw call for normal + additive)
 *   - Lazy GPU allocation + automatic idle sleep (0 sim passes & 0 draw calls when all particles expire)
 *   - Deterministic zero-GC CPU fallback for Headless Node & Canvas2D environments
 */

import {
  CHAMFERED_OCTAGON_TRIS_2D,
  VFX_RENDER_ORDERS,
  createChamferedOctagonGeometry,
  createVisualPrng,
  isMobileOrMiniGameEnv,
  packRgb24,
  unpackRgb24Into,
} from './vfx-core.js';

const MAX_GPU_PARTICLES = 262144;
const HDR_LEVELS = [1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0];

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function packGpuMeta(drag, bounce, stretch, shapeId, additive, hdr) {
  const qDrag = Math.max(0, Math.min(255, Math.round((clamp(Number(drag) || 0, 0, 32) / 32) * 255)));
  const qBounce = Math.max(0, Math.min(31, Math.round((clamp(Number(bounce) || 0, 0, 1.5) / 1.5) * 31)));
  const qStretch = Math.max(0, Math.min(15, Math.round((clamp(Number(stretch) || 0, 0, 6) / 6) * 15)));
  const qShape = Math.max(0, Math.min(7, (Number(shapeId) || 0) | 0));
  const qAdd = additive ? 1 : 0;
  const hVal = Number(hdr) || 1;
  let qHdr = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < HDR_LEVELS.length; i++) {
    const d = Math.abs(HDR_LEVELS[i] - hVal);
    if (d < bestDiff) {
      bestDiff = d;
      qHdr = i;
    }
  }
  return qDrag + qBounce * 256 + qStretch * 8192 + qShape * 131072 + qAdd * 1048576 + qHdr * 2097152;
}

function evalCurlNoiseCpu(px, py, pz, freq, scrollTime, is2D, out) {
  const qx = px * freq + scrollTime;
  const qy = py * freq + scrollTime * 0.73;
  const qz = (is2D ? 0 : pz * freq) - scrollTime * 0.61;
  const sx = Math.sin(qy * 1.31 + Math.cos(qz * 1.17));
  const cx = Math.cos(qz * 1.23 - Math.sin(qy * 1.41));
  const sy = Math.sin(qz * 1.37 + Math.cos(qx * 1.13));
  const cy = Math.cos(qx * 1.29 - Math.sin(qz * 1.47));
  const sz = Math.sin(qx * 1.19 + Math.cos(qy * 1.33));
  const cz = Math.cos(qy * 1.43 - Math.sin(qx * 1.27));
  out[0] = sx - cx;
  out[1] = sy - cy;
  out[2] = is2D ? 0 : (sz - cz);
}

export const GPU_PARTICLE_SIM_VS = /* glsl */ `
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GPU_PARTICLE_SIM_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;

uniform highp sampler2D uStatePosTex;
uniform highp sampler2D uStateVelTex;
uniform highp sampler2D uInitPosTex;
uniform highp sampler2D uInitVelTex;
uniform highp sampler2D uSpawnMetaTex;
uniform highp sampler2D uDepthTex;

uniform int uTexWidth;
uniform int uCapacity;
uniform ivec2 uSpawnRange; // (start, count)
uniform float uDt;
uniform float uTime;
uniform float uIs2D;
uniform vec3 uGravity;
uniform vec4 uTurbulence;  // (strength, frequency, scrollSpeed, 0)
uniform vec4 uAttractor;   // (x, y, z, strength)
uniform vec4 uVortex;      // (axisX, axisY, axisZ, strength)
uniform vec4 uGround;      // (groundY, friction, enabled, 0)
uniform vec4 uLimits;      // (maxSpeed, killRadius, 0, 0)
uniform float uHasDepthCollision;
uniform mat4 uViewProjMatrix;
uniform vec2 uCamNearFar;

layout(location = 0) out vec4 outPosAge;
layout(location = 1) out vec4 outVelLife;

vec3 evalCurlNoise(vec3 p, float t) {
  vec3 q = p + vec3(t, t * 0.73, -t * 0.61);
  float sx = sin(q.y * 1.31 + cos(q.z * 1.17));
  float cx = cos(q.z * 1.23 - sin(q.y * 1.41));
  float sy = sin(q.z * 1.37 + cos(q.x * 1.13));
  float cy = cos(q.x * 1.29 - sin(q.z * 1.47));
  float sz = sin(q.x * 1.19 + cos(q.y * 1.33));
  float cz = cos(q.y * 1.43 - sin(q.x * 1.27));
  return vec3(sx - cx, sy - cy, sz - cz);
}

float linearizeDepth(float d, float nearZ, float farZ) {
  float zNdc = d * 2.0 - 1.0;
  return (2.0 * nearZ * farZ) / max(0.0001, farZ + nearZ - zNdc * (farZ - nearZ));
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int gid = coord.y * uTexWidth + coord.x;
  if (gid >= uCapacity) {
    outPosAge = vec4(0.0, 0.0, 0.0, -1.0);
    outVelLife = vec4(0.0);
    return;
  }

  bool inSpawn = false;
  if (uSpawnRange.y > 0) {
    int endIdx = uSpawnRange.x + uSpawnRange.y;
    if (endIdx <= uCapacity) {
      inSpawn = (gid >= uSpawnRange.x && gid < endIdx);
    } else {
      inSpawn = (gid >= uSpawnRange.x || gid < (endIdx - uCapacity));
    }
  }

  vec4 posAge = inSpawn ? texelFetch(uInitPosTex, coord, 0) : texelFetch(uStatePosTex, coord, 0);
  vec4 velLife = inSpawn ? texelFetch(uInitVelTex, coord, 0) : texelFetch(uStateVelTex, coord, 0);

  float age = posAge.w;
  float life = velLife.w;
  if (age < 0.0 || life <= 0.0 || age + uDt >= life) {
    outPosAge = vec4(0.0, 0.0, 0.0, -1.0);
    outVelLife = vec4(0.0);
    return;
  }

  vec3 pos = posAge.xyz;
  vec3 vel = velLife.xyz;

  if (uDt > 0.0) {
    vec4 meta = texelFetch(uSpawnMetaTex, coord, 0);
    float word = floor(meta.w + 0.5);
    float qDrag = mod(word, 256.0);
    float qBounce = mod(floor(word / 256.0), 32.0);
    float drag = (qDrag / 255.0) * 32.0;
    float bounce = (qBounce / 31.0) * 1.5;

    if (drag > 0.001) {
      vel *= exp(-drag * uDt);
    }
    vel += uGravity * uDt;

    if (uTurbulence.x > 0.0001) {
      vec3 cPos = pos * uTurbulence.y;
      if (uIs2D > 0.5) cPos.z = 0.0;
      vec3 curl = evalCurlNoise(cPos, uTime * uTurbulence.z);
      if (uIs2D > 0.5) curl.z = 0.0;
      vel += curl * uTurbulence.x * uDt;
    }

    if (abs(uAttractor.w) > 0.0001 || abs(uVortex.w) > 0.0001 || uLimits.y > 0.0) {
      vec3 toAttr = uAttractor.xyz - pos;
      if (uIs2D > 0.5) toAttr.z = 0.0;
      float distSq = dot(toAttr, toAttr);
      float dist = sqrt(max(distSq, 1e-6));
      if (uLimits.y > 0.0 && dist < uLimits.y) {
        outPosAge = vec4(0.0, 0.0, 0.0, -1.0);
        outVelLife = vec4(0.0);
        return;
      }
      vec3 dir = toAttr / dist;
      vel += dir * (uAttractor.w / max(0.25, distSq * 0.15 + 1.0)) * uDt;
      if (abs(uVortex.w) > 0.0001) {
        vec3 axis = length(uVortex.xyz) > 0.001 ? normalize(uVortex.xyz) : vec3(0.0, 1.0, 0.0);
        vec3 tangent = cross(axis, -toAttr);
        float tLen = length(tangent);
        if (tLen > 0.0001) {
          vel += (tangent / tLen) * uVortex.w * uDt;
        }
      }
    }

    if (uLimits.x > 0.0) {
      float spd = length(vel);
      if (spd > uLimits.x) {
        vel *= (uLimits.x / spd);
      }
    }

    vec3 nextPos = pos + vel * uDt;

    if (uGround.z > 0.5 && uIs2D < 0.5 && nextPos.y < uGround.x && vel.y < 0.0) {
      nextPos.y = uGround.x;
      vel.y = -vel.y * bounce;
      float fric = max(0.0, 1.0 - uGround.y);
      vel.x *= fric;
      vel.z *= fric;
    }

    if (uHasDepthCollision > 0.5 && uIs2D < 0.5) {
      vec4 clipPos = uViewProjMatrix * vec4(nextPos, 1.0);
      if (clipPos.w > 0.001) {
        vec3 ndc = clipPos.xyz / clipPos.w;
        if (abs(ndc.x) <= 1.0 && abs(ndc.y) <= 1.0 && ndc.z >= -1.0 && ndc.z <= 1.0) {
          vec2 suv = ndc.xy * 0.5 + 0.5;
          float rawD = texture(uDepthTex, suv).r;
          float sceneViewZ = linearizeDepth(rawD, uCamNearFar.x, uCamNearFar.y);
          float partViewZ = linearizeDepth(ndc.z * 0.5 + 0.5, uCamNearFar.x, uCamNearFar.y);
          float pen = partViewZ - sceneViewZ;
          if (pen > 0.02 && pen < 1.2) {
            nextPos = pos;
            vel.y = abs(vel.y) * max(0.25, bounce) + 0.35;
            vel.x *= 0.7;
            vel.z *= 0.7;
          }
        }
      }
    }

    pos = nextPos;
    age += uDt;
  }

  outPosAge = vec4(pos, age);
  outVelLife = vec4(vel, life);
}
`;

export const GPU_PARTICLE_RENDER_VS = /* glsl */ `
precision highp float;
precision highp sampler2D;

in vec3 position;
in vec2 uv;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform highp sampler2D uPosTex;
uniform highp sampler2D uVelTex;
uniform highp sampler2D uSpawnMetaTex;
uniform int uTexWidth;
uniform int uBaseInstance;
uniform int uCapacity;
uniform float uIs2D;

out vec2 vUv;
out vec3 vColor;
out float vLifeRatio;
out float vShapeId;
out float vAdditive;
out float vHdr;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

float decodeHdr(float qHdr) {
  if (qHdr < 0.5) return 1.0;
  if (qHdr < 1.5) return 1.5;
  if (qHdr < 2.5) return 2.0;
  if (qHdr < 3.5) return 3.0;
  if (qHdr < 4.5) return 4.0;
  if (qHdr < 5.5) return 6.0;
  if (qHdr < 6.5) return 8.0;
  return 12.0;
}

void main() {
  int gid = uBaseInstance + gl_InstanceID;
  if (gid >= uCapacity) gid -= uCapacity;
  ivec2 coord = ivec2(gid % uTexWidth, gid / uTexWidth);
  vec4 posAge = texelFetch(uPosTex, coord, 0);
  vec4 velLife = texelFetch(uVelTex, coord, 0);

  float age = posAge.w;
  float life = velLife.w;
  if (age < 0.0 || life <= 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 meta = texelFetch(uSpawnMetaTex, coord, 0);
  float t = clamp(age / life, 0.0, 1.0);
  vLifeRatio = t;
  vUv = uv * 2.0 - 1.0;
  vColor = unpackRgb24(meta.z);

  float word = floor(meta.w + 0.5);
  float qStretch = mod(floor(word / 8192.0), 16.0);
  float qShape = mod(floor(word / 131072.0), 8.0);
  float qAdd = mod(floor(word / 1048576.0), 2.0);
  float qHdr = floor(word / 2097152.0);
  float stretch = (qStretch / 15.0) * 6.0;

  vShapeId = qShape;
  vAdditive = qAdd;
  vHdr = decodeHdr(qHdr);

  float curSize = mix(meta.x, meta.y, t);
  vec3 worldPos = posAge.xyz;
  vec3 curVel = velLife.xyz;

  if (uIs2D > 0.5) {
    float spd2 = length(curVel.xy);
    vec2 dir2 = (spd2 > 0.001 && stretch > 0.01) ? (curVel.xy / spd2) : vec2(1.0, 0.0);
    vec2 perp2 = vec2(-dir2.y, dir2.x);
    float lenScale = curSize * (1.0 + stretch * min(spd2 * 0.015, 4.0));
    vec2 final2D = worldPos.xy + dir2 * (position.x * lenScale) + perp2 * (position.y * curSize);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(final2D, worldPos.z, 1.0);
  } else {
    vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);
    vec3 viewVel = mat3(modelViewMatrix) * curVel;
    float spd = length(viewVel.xy);
    vec2 rightAxis = (spd > 0.001 && stretch > 0.01) ? (viewVel.xy / spd) : vec2(1.0, 0.0);
    vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);
    float major = curSize * (1.0 + stretch * min(spd * 0.08, 4.5));
    mvCenter.xy += rightAxis * (position.x * major) + upAxis * (position.y * curSize);
    gl_Position = projectionMatrix * mvCenter;
  }
}
`;

export const GPU_PARTICLE_RENDER_FS = /* glsl */ `
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vLifeRatio;
in float vShapeId;
in float vAdditive;
in float vHdr;

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
    float edge = 0.72 + 0.16 * sin(ang * 5.0 + vLifeRatio * 4.0);
    alpha = (1.0 - smoothstep(edge * 0.55, edge, r)) * 0.58 * fade;
  } else if (vShapeId < 3.5) {
    float ringRadius = mix(0.25, 0.90, vLifeRatio);
    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;
  } else {
    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;
    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;
    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);
  }

  if (alpha < 0.005) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 premulRgb = col * (alpha * vHdr);
  float outAlpha = (vAdditive > 0.5) ? 0.0 : alpha;
  fragColor = vec4(premulRgb, outAlpha);
}
`;

export const GPU_PARTICLE_RENDER_2D_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aQuadPos;

uniform highp sampler2D uPosTex;
uniform highp sampler2D uVelTex;
uniform highp sampler2D uSpawnMetaTex;
uniform int uTexWidth;
uniform int uBaseInstance;
uniform int uCapacity;
uniform vec2 uCamPos;
uniform float uCamZoom;
uniform vec2 uViewSize;

out vec2 vUv;
out vec3 vColor;
out float vLifeRatio;
out float vShapeId;
out float vAdditive;
out float vHdr;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

float decodeHdr(float qHdr) {
  if (qHdr < 0.5) return 1.0;
  if (qHdr < 1.5) return 1.5;
  if (qHdr < 2.5) return 2.0;
  if (qHdr < 3.5) return 3.0;
  if (qHdr < 4.5) return 4.0;
  if (qHdr < 5.5) return 6.0;
  if (qHdr < 6.5) return 8.0;
  return 12.0;
}

void main() {
  int gid = uBaseInstance + gl_InstanceID;
  if (gid >= uCapacity) gid -= uCapacity;
  ivec2 coord = ivec2(gid % uTexWidth, gid / uTexWidth);
  vec4 posAge = texelFetch(uPosTex, coord, 0);
  vec4 velLife = texelFetch(uVelTex, coord, 0);

  float age = posAge.w;
  float life = velLife.w;
  if (age < 0.0 || life <= 0.0 || age >= life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 meta = texelFetch(uSpawnMetaTex, coord, 0);
  float t = clamp(age / life, 0.0, 1.0);
  vLifeRatio = t;
  vUv = aQuadPos * 2.0;
  vColor = unpackRgb24(meta.z);

  float word = floor(meta.w + 0.5);
  float qStretch = mod(floor(word / 8192.0), 16.0);
  float qShape = mod(floor(word / 131072.0), 8.0);
  float qAdd = mod(floor(word / 1048576.0), 2.0);
  float qHdr = floor(word / 2097152.0);
  float stretch = (qStretch / 15.0) * 6.0;

  vShapeId = qShape;
  vAdditive = qAdd;
  vHdr = decodeHdr(qHdr);

  float curSize = mix(meta.x, meta.y, t);
  vec2 curVel = velLife.xy;
  float spd = length(curVel);
  vec2 dir = (spd > 0.001 && stretch > 0.01) ? (curVel / spd) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float lenScale = curSize * (1.0 + stretch * min(spd * 0.015, 4.0));

  vec2 worldPos = posAge.xy + dir * (aQuadPos.x * lenScale) + perp * (aQuadPos.y * curSize);
  vec2 screenPx = (worldPos - uCamPos) * uCamZoom + uViewSize * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,
    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const GPU_PARTICLE_RENDER_2D_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vLifeRatio;
in float vShapeId;
in float vAdditive;
in float vHdr;

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
    float edge = 0.72 + 0.16 * sin(ang * 5.0 + vLifeRatio * 4.0);
    alpha = (1.0 - smoothstep(edge * 0.55, edge, r)) * 0.58 * fade;
  } else if (vShapeId < 3.5) {
    float ringRadius = mix(0.25, 0.90, vLifeRatio);
    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;
  } else {
    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;
    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;
    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);
  }

  if (alpha < 0.005) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 premulRgb = col * (alpha * vHdr);
  float outAlpha = (vAdditive > 0.5) ? 0.0 : alpha;
  fragColor = vec4(premulRgb, outAlpha);
}
`;

function compileGlProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'GpuParticle shader compile error';
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
    const log = gl.getProgramInfoLog(prog) || 'GpuParticle program link error';
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

/**
 * Creates a WebGL2 MRT Ping-Pong GPU Particle System with lazy allocation,
 * curl-noise turbulence, attractor/vortex fields, plane/depth collisions,
 * and zero-GC CPU fallback for headless & Canvas2D modes.
 */
export function createGpuParticleSystem({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  renderer = /** @type {object | null} */ (null),
  gl = /** @type {WebGL2RenderingContext | null} */ (null),
  mobile = isMobileOrMiniGameEnv(),
  precision = 'auto',
  maxParticles = mode === 'canvas2d' ? 2048 : (mobile ? 16384 : 65536),
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  prng = createVisualPrng(0x6c8e9f1b),
} = {}) {
  const capacity = Math.max(1, Math.min(MAX_GPU_PARTICLES, maxParticles | 0));
  const texWidth = Math.max(4, Math.ceil(Math.sqrt(capacity)));
  const texHeight = Math.ceil(capacity / texWidth);
  const texelCount = texWidth * texHeight;
  const chunkCount = Math.ceil(capacity / 256);
  const chunkLatestDeath = new Float32Array(chunkCount).fill(-Infinity);
  const chunkDeadPasses = new Uint8Array(chunkCount).fill(2);
  const preferFp16 = precision === 'fp16' || (precision === 'auto' && mobile);
  const GPU_QUALITY_SCALES = { high: 1.0, med: 0.75, medium: 0.75, low: 0.5 };
  let qualityTier = 'high';

  let initialized = false;
  let disposed = false;
  let simTime = 0;
  let cursor = 0;
  let totalEmitted = 0;
  let spawnStart = 0;
  let spawnCount = 0;
  let latestDeathTime = -Infinity;
  let simPasses = 0;
  let lastUploadedBytes = 0;
  let windowDirty = false;
  let activeBaseSlot = 0;
  let activeSpanCount = 0;
  let simBaseSlot = 0;
  let simSpanCount = 0;

  let activeRenderer = renderer || null;
  let gpuBootstrapped = false;
  let readIndex = 0;

  // Lazy-allocated staging / CPU simulation buffers
  /** @type {Float32Array | null} */
  let posAge = null;
  /** @type {Float32Array | null} */
  let velLife = null;
  /** @type {Float32Array | null} */
  let spawnMeta = null;
  /** @type {Float32Array | null} */
  let cpuDrag = null;
  /** @type {Float32Array | null} */
  let cpuBounce = null;
  /** @type {Float32Array | null} */
  let cpuShape = null;
  /** @type {Uint8Array | null} */
  let cpuAdditive = null;
  /** @type {Int32Array | null} */
  let cpuActiveIndices = null;
  /** @type {Int32Array | null} */
  let cpuSlotPos = null;
  let cpuActiveCount = 0;

  // Force fields & collision state
  const field = {
    gravity: [0, 0, 0],
    gravityLocked: false,
    turbulenceStrength: 0,
    turbulenceFreq: 0.5,
    turbulenceScroll: 1.0,
    attractorX: 0,
    attractorY: 0,
    attractorZ: 0,
    attractorStrength: 0,
    vortexAxisX: 0,
    vortexAxisY: 1,
    vortexAxisZ: 0,
    vortexStrength: 0,
    groundY: 0,
    groundFriction: 0.2,
    groundEnabled: false,
    maxSpeed: 0,
    killRadius: 0,
  };

  let depthTexRef = null;
  let depthCollisionEnabled = false;
  let camNear = 0.1;
  let camFar = 200;
  const viewProjArray = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);

  let threeRes = null;
  let rawRes = null;
  const scratchCurl = new Float32Array(3);
  const scratchRgb = new Float32Array(3);
  const scratchIdentityMat4 = THREE?.Matrix4 ? new THREE.Matrix4() : null;

  function detectThreeFloatTargetType(r) {
    if (!THREE) return null;
    const ctx = r?.getContext?.() || null;
    if (r?.capabilities?.isWebGL2 === false) return null;
    if (!ctx) return (preferFp16 && THREE.HalfFloatType) ? THREE.HalfFloatType : THREE.FloatType;
    const hasFloat = Boolean(ctx.getExtension?.('EXT_color_buffer_float'));
    const hasHalf = Boolean(ctx.getExtension?.('EXT_color_buffer_half_float') || hasFloat);
    if (preferFp16 && hasHalf && THREE.HalfFloatType) return THREE.HalfFloatType;
    if (hasFloat) return THREE.FloatType;
    if (hasHalf && THREE.HalfFloatType) return THREE.HalfFloatType;
    return null;
  }

  function detectRawFloatTargetFormat(ctx) {
    if (!ctx || typeof ctx.createFramebuffer !== 'function' || typeof ctx.drawBuffers !== 'function') return null;
    const hasFloat = Boolean(ctx.getExtension?.('EXT_color_buffer_float'));
    const hasHalf = Boolean(ctx.getExtension?.('EXT_color_buffer_half_float') || hasFloat);
    if (preferFp16 && hasHalf) {
      return { internalFormat: ctx.RGBA16F, type: ctx.HALF_FLOAT };
    }
    if (hasFloat) {
      return { internalFormat: ctx.RGBA32F, type: ctx.FLOAT };
    }
    if (hasHalf) {
      return { internalFormat: ctx.RGBA16F, type: ctx.HALF_FLOAT };
    }
    return null;
  }

  function computeChunkWindow(maxChunks, isChunkLive) {
    let bestGapStart = 0;
    let bestGapLen = 0;
    let curGapStart = 0;
    let curGapLen = 0;
    let anyLive = false;
    for (let k = 0; k < maxChunks * 2; k++) {
      const c = k % maxChunks;
      if (!isChunkLive(c)) {
        if (curGapLen === 0) curGapStart = k;
        curGapLen += 1;
        if (curGapLen >= maxChunks) return [0, 0];
        if (curGapLen > bestGapLen) {
          bestGapLen = curGapLen;
          bestGapStart = curGapStart;
        }
      } else {
        anyLive = true;
        curGapLen = 0;
      }
    }
    if (!anyLive) return [0, 0];
    if (bestGapLen === 0) return [0, Math.min(totalEmitted, capacity)];
    const startChunk = (bestGapStart + bestGapLen) % maxChunks;
    const liveChunks = maxChunks - bestGapLen;
    const baseSlot = startChunk * 256;
    const maxPossible = totalEmitted < capacity ? totalEmitted : capacity;
    if (totalEmitted < capacity && baseSlot + liveChunks * 256 >= totalEmitted) {
      return [baseSlot, Math.max(0, totalEmitted - baseSlot)];
    }
    return [baseSlot, Math.min(maxPossible, liveChunks * 256)];
  }

  function computeActiveWindow(simNow) {
    windowDirty = false;
    if (totalEmitted <= 0) {
      activeBaseSlot = 0;
      activeSpanCount = 0;
      simBaseSlot = 0;
      simSpanCount = 0;
      return;
    }
    const maxChunks = totalEmitted < capacity ? Math.ceil(totalEmitted / 256) : chunkCount;
    [activeBaseSlot, activeSpanCount] = computeChunkWindow(
      maxChunks,
      (c) => simNow < chunkLatestDeath[c] - 1e-6,
    );
    [simBaseSlot, simSpanCount] = computeChunkWindow(
      maxChunks,
      (c) => simNow < chunkLatestDeath[c] - 1e-6 || chunkDeadPasses[c] < 2,
    );
  }

  function ensureInitialized() {
    if (initialized || disposed) return;
    initialized = true;

    posAge = new Float32Array(texelCount * 4);
    velLife = new Float32Array(texelCount * 4);
    spawnMeta = new Float32Array(texelCount * 4);
    for (let i = 0; i < texelCount; i++) {
      posAge[i * 4 + 3] = -1;
    }

    cpuDrag = new Float32Array(capacity);
    cpuBounce = new Float32Array(capacity);
    cpuShape = new Float32Array(capacity);
    cpuAdditive = new Uint8Array(capacity);
    cpuActiveIndices = new Int32Array(capacity);
    cpuSlotPos = new Int32Array(capacity).fill(-1);

    if (mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry && THREE.BufferAttribute && THREE.DataTexture) {
      const makeDataTex = (arr) => {
        const t = new THREE.DataTexture(arr, texWidth, texHeight, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = false;
        t.flipY = false;
        t.needsUpdate = true;
        return t;
      };
      const initPosTex = makeDataTex(posAge);
      const initVelTex = makeDataTex(velLife);
      const spawnMetaTex = makeDataTex(spawnMeta);

      const geo = createChamferedOctagonGeometry(THREE);
      geo.instanceCount = 0;

      const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
      const renderMat = new MatCtor({
        glslVersion: THREE.GLSL3,
        vertexShader: GPU_PARTICLE_RENDER_VS,
        fragmentShader: GPU_PARTICLE_RENDER_FS,
        uniforms: {
          uPosTex: { value: initPosTex },
          uVelTex: { value: initVelTex },
          uSpawnMetaTex: { value: spawnMetaTex },
          uTexWidth: { value: texWidth },
          uBaseInstance: { value: 0 },
          uCapacity: { value: capacity },
          uIs2D: { value: is2D ? 1.0 : 0.0 },
        },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.CustomBlending ?? THREE.NormalBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });

      const mesh = new THREE.Mesh(geo, renderMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = VFX_RENDER_ORDERS.PARTICLES;
      mesh.name = 'HGameVfxGpuParticles';
      mesh.onBeforeRender = (r, _s, cam) => {
        if (r && !activeRenderer) activeRenderer = r;
        if (cam?.matrixWorldInverse && cam?.projectionMatrix && scratchIdentityMat4) {
          scratchIdentityMat4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
          viewProjArray.set(scratchIdentityMat4.elements);
          if (threeRes?.simMat) {
            threeRes.simMat.uniforms.uViewProjMatrix.value.fromArray(viewProjArray);
            if (Number.isFinite(cam.near) && Number.isFinite(cam.far)) {
              camNear = cam.near;
              camFar = cam.far;
              threeRes.simMat.uniforms.uCamNearFar.value.set(camNear, camFar);
            }
          }
        }
      };
      scene.add(mesh);

      threeRes = {
        initPosTex,
        initVelTex,
        spawnMetaTex,
        renderMat,
        mesh,
        rts: null,
        simScene: null,
        simCam: null,
        simMat: null,
        quadGeo: null,
        quadMesh: null,
        mrtSupported: null,
      };
      if (activeRenderer) ensureThreeMrt(activeRenderer);
    } else if (mode === 'webgl2d' && gl) {
      const fmt = detectRawFloatTargetFormat(gl);
      if (fmt) {
        initRawWebGL2(fmt);
      }
    }
  }

  function ensureThreeMrt(r) {
    if (!threeRes || threeRes.rts || threeRes.mrtSupported === false) return Boolean(threeRes?.rts);
    const targetType = detectThreeFloatTargetType(r);
    if (!targetType || !THREE.WebGLRenderTarget || !THREE.Scene || !THREE.OrthographicCamera) {
      threeRes.mrtSupported = false;
      return false;
    }
    const rtOpts = {
      count: 2,
      type: targetType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const rt0 = new THREE.WebGLRenderTarget(texWidth, texHeight, rtOpts);
    const rt1 = new THREE.WebGLRenderTarget(texWidth, texHeight, rtOpts);
    if (!rt0.textures || rt0.textures.length < 2 || !rt1.textures || rt1.textures.length < 2) {
      rt0.dispose?.();
      rt1.dispose?.();
      threeRes.mrtSupported = false;
      return false;
    }
    const simScene = new THREE.Scene();
    const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    const simMat = new MatCtor({
      glslVersion: THREE.GLSL3,
      vertexShader: GPU_PARTICLE_SIM_VS,
      fragmentShader: GPU_PARTICLE_SIM_FS,
      uniforms: {
        uStatePosTex: { value: rt0.textures[0] },
        uStateVelTex: { value: rt0.textures[1] },
        uInitPosTex: { value: threeRes.initPosTex },
        uInitVelTex: { value: threeRes.initVelTex },
        uSpawnMetaTex: { value: threeRes.spawnMetaTex },
        uDepthTex: { value: depthTexRef },
        uTexWidth: { value: texWidth },
        uCapacity: { value: capacity },
        uSpawnRange: { value: THREE.Vector2 ? new THREE.Vector2(0, 0) : [0, 0] },
        uDt: { value: 0 },
        uTime: { value: 0 },
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uGravity: { value: THREE.Vector3 ? new THREE.Vector3(...field.gravity) : [...field.gravity] },
        uTurbulence: { value: THREE.Vector4 ? new THREE.Vector4(field.turbulenceStrength, field.turbulenceFreq, field.turbulenceScroll, 0) : [0, 0.5, 1, 0] },
        uAttractor: { value: THREE.Vector4 ? new THREE.Vector4(field.attractorX, field.attractorY, field.attractorZ, field.attractorStrength) : [0, 0, 0, 0] },
        uVortex: { value: THREE.Vector4 ? new THREE.Vector4(field.vortexAxisX, field.vortexAxisY, field.vortexAxisZ, field.vortexStrength) : [0, 1, 0, 0] },
        uGround: { value: THREE.Vector4 ? new THREE.Vector4(field.groundY, field.groundFriction, field.groundEnabled ? 1 : 0, 0) : [0, 0.2, 0, 0] },
        uLimits: { value: THREE.Vector4 ? new THREE.Vector4(field.maxSpeed, field.killRadius, 0, 0) : [0, 0, 0, 0] },
        uHasDepthCollision: { value: (depthCollisionEnabled && depthTexRef) ? 1.0 : 0.0 },
        uViewProjMatrix: { value: THREE.Matrix4 ? new THREE.Matrix4().fromArray(viewProjArray) : viewProjArray },
        uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(camNear, camFar) : [camNear, camFar] },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quadMesh = new THREE.Mesh(quadGeo, simMat);
    quadMesh.frustumCulled = false;
    simScene.add(quadMesh);

    threeRes.rts = [rt0, rt1];
    threeRes.simScene = simScene;
    threeRes.simCam = simCam;
    threeRes.simMat = simMat;
    threeRes.quadGeo = quadGeo;
    threeRes.quadMesh = quadMesh;
    threeRes.mrtSupported = true;
    return true;
  }

  function initRawWebGL2(fmt) {
    const createFloatTex = (internalFormat, type, data) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, texWidth, texHeight, 0, gl.RGBA, type, data);
      return tex;
    };
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    const statePosTexs = [
      createFloatTex(fmt.internalFormat, fmt.type, null),
      createFloatTex(fmt.internalFormat, fmt.type, null),
    ];
    const stateVelTexs = [
      createFloatTex(fmt.internalFormat, fmt.type, null),
      createFloatTex(fmt.internalFormat, fmt.type, null),
    ];
    const initPosTex = createFloatTex(gl.RGBA32F, gl.FLOAT, posAge);
    const initVelTex = createFloatTex(gl.RGBA32F, gl.FLOAT, velLife);
    const spawnMetaTex = createFloatTex(gl.RGBA32F, gl.FLOAT, spawnMeta);

    const fbos = [gl.createFramebuffer(), gl.createFramebuffer()];
    let fboComplete = true;
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, statePosTexs[i], 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, stateVelTexs[i], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        fboComplete = false;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);

    if (!fboComplete) {
      for (let i = 0; i < 2; i++) {
        gl.deleteFramebuffer(fbos[i]);
        gl.deleteTexture(statePosTexs[i]);
        gl.deleteTexture(stateVelTexs[i]);
      }
      gl.deleteTexture(initPosTex);
      gl.deleteTexture(initVelTex);
      gl.deleteTexture(spawnMetaTex);
      return;
    }

    const simVs = '#version 300 es\n' + [
      'const vec2 TRI[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));',
      'void main() {',
      '  gl_Position = vec4(TRI[gl_VertexID], 0.0, 1.0);',
      '}',
    ].join('\n');
    const simProg = compileGlProgram(gl, simVs, '#version 300 es\n' + GPU_PARTICLE_SIM_FS);
    const renderProg = compileGlProgram(gl, GPU_PARTICLE_RENDER_2D_VS, GPU_PARTICLE_RENDER_2D_FS);
    const simVao = gl.createVertexArray();
    const renderVao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    gl.bindVertexArray(renderVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      CHAMFERED_OCTAGON_TRIS_2D,
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    rawRes = {
      statePosTexs,
      stateVelTexs,
      initPosTex,
      initVelTex,
      spawnMetaTex,
      fbos,
      simProg,
      renderProg,
      simVao,
      renderVao,
      quadVbo,
      simUniforms: {
        uStatePosTex: gl.getUniformLocation(simProg, 'uStatePosTex'),
        uStateVelTex: gl.getUniformLocation(simProg, 'uStateVelTex'),
        uInitPosTex: gl.getUniformLocation(simProg, 'uInitPosTex'),
        uInitVelTex: gl.getUniformLocation(simProg, 'uInitVelTex'),
        uSpawnMetaTex: gl.getUniformLocation(simProg, 'uSpawnMetaTex'),
        uDepthTex: gl.getUniformLocation(simProg, 'uDepthTex'),
        uTexWidth: gl.getUniformLocation(simProg, 'uTexWidth'),
        uCapacity: gl.getUniformLocation(simProg, 'uCapacity'),
        uSpawnRange: gl.getUniformLocation(simProg, 'uSpawnRange'),
        uDt: gl.getUniformLocation(simProg, 'uDt'),
        uTime: gl.getUniformLocation(simProg, 'uTime'),
        uIs2D: gl.getUniformLocation(simProg, 'uIs2D'),
        uGravity: gl.getUniformLocation(simProg, 'uGravity'),
        uTurbulence: gl.getUniformLocation(simProg, 'uTurbulence'),
        uAttractor: gl.getUniformLocation(simProg, 'uAttractor'),
        uVortex: gl.getUniformLocation(simProg, 'uVortex'),
        uGround: gl.getUniformLocation(simProg, 'uGround'),
        uLimits: gl.getUniformLocation(simProg, 'uLimits'),
        uHasDepthCollision: gl.getUniformLocation(simProg, 'uHasDepthCollision'),
      },
      renderUniforms: {
        uPosTex: gl.getUniformLocation(renderProg, 'uPosTex'),
        uVelTex: gl.getUniformLocation(renderProg, 'uVelTex'),
        uSpawnMetaTex: gl.getUniformLocation(renderProg, 'uSpawnMetaTex'),
        uTexWidth: gl.getUniformLocation(renderProg, 'uTexWidth'),
        uBaseInstance: gl.getUniformLocation(renderProg, 'uBaseInstance'),
        uCapacity: gl.getUniformLocation(renderProg, 'uCapacity'),
        uCamPos: gl.getUniformLocation(renderProg, 'uCamPos'),
        uCamZoom: gl.getUniformLocation(renderProg, 'uCamZoom'),
        uViewSize: gl.getUniformLocation(renderProg, 'uViewSize'),
      },
    };
  }

  function uploadRawRows(tex, data, startSlot, count, targetGl) {
    if (!tex || !data || count <= 0) return 0;
    const endSlot = startSlot + count;
    if (endSlot <= capacity) {
      const r0 = (startSlot / texWidth) | 0;
      const r1 = ((endSlot - 1) / texWidth) | 0;
      const rows = r1 - r0 + 1;
      const e0 = r0 * texWidth * 4;
      const e1 = (r0 + rows) * texWidth * 4;
      targetGl.bindTexture(targetGl.TEXTURE_2D, tex);
      targetGl.texSubImage2D(targetGl.TEXTURE_2D, 0, 0, r0, texWidth, rows, targetGl.RGBA, targetGl.FLOAT, data.subarray(e0, e1));
      return rows * texWidth * 16;
    }
    const c1 = capacity - startSlot;
    const c2 = count - c1;
    let bytes = uploadRawRows(tex, data, startSlot, c1, targetGl);
    if (c2 > 0) bytes += uploadRawRows(tex, data, 0, c2, targetGl);
    return bytes;
  }

  function uploadThreeDataTexRows(tex, data, startSlot, count) {
    if (!tex || count <= 0) return 0;
    const ctx = activeRenderer?.getContext?.() || null;
    if (ctx && typeof activeRenderer?.initTexture === 'function' && activeRenderer?.properties?.get) {
      activeRenderer.initTexture(tex);
      const glTex = activeRenderer.properties.get(tex)?.__webglTexture;
      if (glTex) {
        const prevTex = ctx.getParameter(ctx.TEXTURE_BINDING_2D);
        ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false);
        const bytes = uploadRawRows(glTex, data, startSlot, count, ctx);
        ctx.bindTexture(ctx.TEXTURE_2D, prevTex);
        return bytes;
      }
    }
    tex.needsUpdate = true;
    return data.byteLength;
  }

  function stepCpu(dt) {
    if (!posAge || cpuActiveCount === 0) return;
    const gX = field.gravity[0];
    const gY = field.gravity[1];
    const gZ = field.gravity[2];
    const turbStr = field.turbulenceStrength;
    const turbFreq = field.turbulenceFreq;
    const turbScroll = simTime * field.turbulenceScroll;
    const attrStr = field.attractorStrength;
    const vortStr = field.vortexStrength;
    const hasAttrOrVort = Math.abs(attrStr) > 0.0001 || Math.abs(vortStr) > 0.0001 || field.killRadius > 0;
    const killR = field.killRadius;
    const maxSpd = field.maxSpeed;
    const gEnabled = field.groundEnabled && !is2D;
    const gPlaneY = field.groundY;
    const gFric = Math.max(0, 1 - field.groundFriction);

    let axLen = Math.hypot(field.vortexAxisX, field.vortexAxisY, field.vortexAxisZ);
    const vAxX = axLen > 0.001 ? field.vortexAxisX / axLen : 0;
    const vAxY = axLen > 0.001 ? field.vortexAxisY / axLen : 1;
    const vAxZ = axLen > 0.001 ? field.vortexAxisZ / axLen : 0;

    for (let k = cpuActiveCount - 1; k >= 0; k--) {
      const idx = cpuActiveIndices[k];
      const i4 = idx * 4;
      const age = posAge[i4 + 3];
      const life = velLife[i4 + 3];
      if (age < 0 || life <= 0 || age + dt >= life) {
        posAge[i4 + 3] = -1;
        cpuSlotPos[idx] = -1;
        const lastIdx = cpuActiveIndices[--cpuActiveCount];
        if (k < cpuActiveCount) {
          cpuActiveIndices[k] = lastIdx;
          cpuSlotPos[lastIdx] = k;
        }
        continue;
      }
      if (dt > 0) {
        let px = posAge[i4];
        let py = posAge[i4 + 1];
        let pz = posAge[i4 + 2];
        let vx = velLife[i4];
        let vy = velLife[i4 + 1];
        let vz = velLife[i4 + 2];
        const drag = cpuDrag[idx];
        if (drag > 0.001) {
          const d = Math.exp(-drag * dt);
          vx *= d; vy *= d; vz *= d;
        }
        vx += gX * dt;
        vy += gY * dt;
        vz += gZ * dt;

        if (turbStr > 0.0001) {
          evalCurlNoiseCpu(px, py, pz, turbFreq, turbScroll, is2D, scratchCurl);
          vx += scratchCurl[0] * turbStr * dt;
          vy += scratchCurl[1] * turbStr * dt;
          vz += scratchCurl[2] * turbStr * dt;
        }

        if (hasAttrOrVort) {
          const dx = field.attractorX - px;
          const dy = field.attractorY - py;
          const dz = is2D ? 0 : (field.attractorZ - pz);
          const distSq = dx * dx + dy * dy + dz * dz;
          const dist = Math.sqrt(Math.max(distSq, 1e-6));
          if (killR > 0 && dist < killR) {
            posAge[i4 + 3] = -1;
            cpuSlotPos[idx] = -1;
            const lastIdx = cpuActiveIndices[--cpuActiveCount];
            if (k < cpuActiveCount) {
              cpuActiveIndices[k] = lastIdx;
              cpuSlotPos[lastIdx] = k;
            }
            continue;
          }
          const aPull = attrStr / Math.max(0.25, distSq * 0.15 + 1.0);
          vx += (dx / dist) * aPull * dt;
          vy += (dy / dist) * aPull * dt;
          vz += (dz / dist) * aPull * dt;
          if (Math.abs(vortStr) > 0.0001) {
            const tx = vAxY * (-dz) - vAxZ * (-dy);
            const ty = vAxZ * (-dx) - vAxX * (-dz);
            const tz = vAxX * (-dy) - vAxY * (-dx);
            const tLen = Math.hypot(tx, ty, tz);
            if (tLen > 0.0001) {
              vx += (tx / tLen) * vortStr * dt;
              vy += (ty / tLen) * vortStr * dt;
              vz += (tz / tLen) * vortStr * dt;
            }
          }
        }

        if (maxSpd > 0) {
          const spd = Math.hypot(vx, vy, vz);
          if (spd > maxSpd) {
            const sc = maxSpd / spd;
            vx *= sc; vy *= sc; vz *= sc;
          }
        }

        px += vx * dt;
        py += vy * dt;
        pz += vz * dt;

        if (gEnabled && py < gPlaneY && vy < 0) {
          py = gPlaneY;
          vy = -vy * cpuBounce[idx];
          vx *= gFric;
          vz *= gFric;
        }

        posAge[i4] = px;
        posAge[i4 + 1] = py;
        posAge[i4 + 2] = pz;
        velLife[i4] = vx;
        velLife[i4 + 1] = vy;
        velLife[i4 + 2] = vz;
        posAge[i4 + 3] = age + dt;
      }
    }
  }

  function emit(opts = {}) {
    if (disposed) return -1;
    ensureInitialized();

    const idx = cursor;
    const i4 = idx * 4;
    const dur = Math.max(0.01, Number(opts.duration ?? 0.6));
    const initAge = Math.min(dur - 0.001, Math.max(0, Number(opts.initialAge ?? 0)));

    if (!field.gravityLocked && opts.gravity !== undefined) {
      field.gravity[1] = is2D ? Number(opts.gravity) : -Number(opts.gravity);
      syncFieldUniforms();
    }

    posAge[i4] = Number(opts.x ?? 0);
    posAge[i4 + 1] = Number(opts.y ?? 0);
    posAge[i4 + 2] = Number(opts.z ?? 0);
    posAge[i4 + 3] = initAge;

    velLife[i4] = Number(opts.vx ?? 0);
    velLife[i4 + 1] = Number(opts.vy ?? 0);
    velLife[i4 + 2] = Number(opts.vz ?? 0);
    velLife[i4 + 3] = dur;

    const dragVal = Number(opts.drag ?? 0);
    const bounceVal = Number(opts.bounce ?? 0.45);
    const shapeId = Number(opts.shape ?? 0);
    const additive = opts.additive !== undefined ? Boolean(opts.additive) : true;
    const rgb24 = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0xffffff);

    spawnMeta[i4] = Number(opts.sizeStart ?? 0.35);
    spawnMeta[i4 + 1] = Number(opts.sizeEnd ?? 0.04);
    spawnMeta[i4 + 2] = rgb24;
    spawnMeta[i4 + 3] = packGpuMeta(dragVal, bounceVal, opts.stretch ?? 0, shapeId, additive, opts.hdr ?? 1);

    cpuDrag[idx] = dragVal;
    cpuBounce[idx] = bounceVal;
    cpuShape[idx] = shapeId;
    cpuAdditive[idx] = additive ? 1 : 0;

    if (!gpuBootstrapped && cpuSlotPos[idx] < 0) {
      cpuSlotPos[idx] = cpuActiveCount;
      cpuActiveIndices[cpuActiveCount++] = idx;
    }

    if (spawnCount === 0) spawnStart = idx;
    spawnCount = Math.min(capacity, spawnCount + 1);
    if (spawnCount >= capacity) spawnStart = 0;

    const deathTime = simTime + (dur - initAge);
    if (deathTime > latestDeathTime) latestDeathTime = deathTime;
    const chunk = idx >>> 8;
    if (deathTime > chunkLatestDeath[chunk]) chunkLatestDeath[chunk] = deathTime;
    chunkDeadPasses[chunk] = 0;
    windowDirty = true;

    cursor = (idx + 1) % capacity;
    totalEmitted += 1;
    return idx;
  }

  function burst(opts = {}) {
    const qScale = GPU_QUALITY_SCALES[qualityTier] ?? 1.0;
    const rawCount = (opts.count ?? 16) | 0;
    const scaled = rawCount > 0 ? Math.max(1, Math.round(rawCount * qScale)) : 0;
    const count = Math.max(0, Math.min(capacity, scaled));
    if (count === 0 || disposed) return;
    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;
    const speedMin = opts.speedMin ?? 2;
    const speedMax = opts.speedMax ?? 8;
    const sizeStart = opts.sizeStart ?? 0.35;
    const sizeEnd = opts.sizeEnd ?? 0.04;
    const durationMin = opts.durationMin ?? opts.duration ?? 0.3;
    const durationMax = opts.durationMax ?? opts.duration ?? 0.8;
    const drag = opts.drag ?? 1.5;
    const bounce = opts.bounce ?? 0.45;
    const stretch = opts.stretch ?? 0;
    const shape = opts.shape ?? 0;
    const additive = opts.additive !== undefined ? Boolean(opts.additive) : true;
    const hdr = opts.hdr ?? 1;
    const rgb24 = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0xffffff);
    const spreadRad = opts.spreadRad ?? Math.PI * 2;
    const dirX = opts.dirX ?? 0;
    const dirY = opts.dirY ?? 0;
    const dirZ = opts.dirZ ?? 0;
    const dirBias = opts.dirBias ?? 0;

    for (let i = 0; i < count; i++) {
      let vx; let vy; let vz;
      const spd = prng.range(speedMin, speedMax);
      if (is2D) {
        const ang = prng.nextFloat() * spreadRad;
        vx = (Math.cos(ang) * (1 - dirBias) + dirX * dirBias) * spd;
        vy = (Math.sin(ang) * (1 - dirBias) + dirY * dirBias) * spd;
        vz = 0;
      } else {
        const u = prng.nextFloat() * 2 - 1;
        const theta = prng.nextFloat() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        vx = (r * Math.cos(theta) * (1 - dirBias) + dirX * dirBias) * spd;
        vy = (u * (1 - dirBias) + dirY * dirBias) * spd;
        vz = (r * Math.sin(theta) * (1 - dirBias) + dirZ * dirBias) * spd;
      }
      emit({
        x, y, z, vx, vy, vz,
        sizeStart, sizeEnd,
        duration: prng.range(durationMin, durationMax),
        drag, bounce, stretch, shape, additive, hdr, rgb24,
        gravity: opts.gravity,
      });
    }
  }

  function syncFieldUniforms() {
    const simMat = threeRes?.simMat;
    if (simMat) {
      const u = simMat.uniforms;
      u.uGravity.value.set?.(field.gravity[0], field.gravity[1], field.gravity[2]);
      u.uTurbulence.value.set?.(field.turbulenceStrength, field.turbulenceFreq, field.turbulenceScroll, 0);
      u.uAttractor.value.set?.(field.attractorX, field.attractorY, field.attractorZ, field.attractorStrength);
      u.uVortex.value.set?.(field.vortexAxisX, field.vortexAxisY, field.vortexAxisZ, field.vortexStrength);
      u.uGround.value.set?.(field.groundY, field.groundFriction, field.groundEnabled ? 1 : 0, 0);
      u.uLimits.value.set?.(field.maxSpeed, field.killRadius, 0, 0);
    }
  }

  function setField(opts = {}) {
    if (!opts || typeof opts !== 'object') return;
    if (Array.isArray(opts.gravity)) {
      field.gravity[0] = Number(opts.gravity[0] ?? 0);
      field.gravity[1] = Number(opts.gravity[1] ?? 0);
      field.gravity[2] = Number(opts.gravity[2] ?? 0);
      field.gravityLocked = true;
    } else if (typeof opts.gravity === 'number') {
      field.gravity[0] = 0;
      field.gravity[1] = is2D ? opts.gravity : -opts.gravity;
      field.gravity[2] = 0;
      field.gravityLocked = true;
    }
    if (opts.turbulence) {
      if (opts.turbulence.strength !== undefined) field.turbulenceStrength = Number(opts.turbulence.strength) || 0;
      if (opts.turbulence.frequency !== undefined) field.turbulenceFreq = Math.max(0.01, Number(opts.turbulence.frequency) || 0.5);
      if (opts.turbulence.scroll !== undefined) field.turbulenceScroll = Number(opts.turbulence.scroll) || 0;
    }
    if (opts.attractor) {
      if (opts.attractor.x !== undefined) field.attractorX = Number(opts.attractor.x) || 0;
      if (opts.attractor.y !== undefined) field.attractorY = Number(opts.attractor.y) || 0;
      if (opts.attractor.z !== undefined) field.attractorZ = Number(opts.attractor.z) || 0;
      if (opts.attractor.strength !== undefined) field.attractorStrength = Number(opts.attractor.strength) || 0;
      if (opts.attractor.killRadius !== undefined) field.killRadius = Math.max(0, Number(opts.attractor.killRadius) || 0);
      if (opts.attractor.vortexStrength !== undefined) field.vortexStrength = Number(opts.attractor.vortexStrength) || 0;
    }
    if (opts.vortex) {
      if (Array.isArray(opts.vortex.axis)) {
        field.vortexAxisX = Number(opts.vortex.axis[0] ?? 0);
        field.vortexAxisY = Number(opts.vortex.axis[1] ?? 1);
        field.vortexAxisZ = Number(opts.vortex.axis[2] ?? 0);
      }
      if (opts.vortex.strength !== undefined) field.vortexStrength = Number(opts.vortex.strength) || 0;
    }
    if (opts.ground !== undefined) {
      if (typeof opts.ground === 'boolean') {
        field.groundEnabled = opts.ground;
      } else if (opts.ground && typeof opts.ground === 'object') {
        field.groundEnabled = opts.ground.enabled !== false;
        if (opts.ground.y !== undefined) field.groundY = Number(opts.ground.y) || 0;
        if (opts.ground.friction !== undefined) field.groundFriction = clamp(Number(opts.ground.friction) || 0, 0, 1);
      }
    }
    if (opts.maxSpeed !== undefined) field.maxSpeed = Math.max(0, Number(opts.maxSpeed) || 0);
    syncFieldUniforms();
  }

  function setQualityTier(tier = 'high') {
    qualityTier = GPU_QUALITY_SCALES[tier] !== undefined ? tier : 'high';
    if (threeRes?.simMat) {
      threeRes.simMat.uniforms.uHasDepthCollision.value =
        (depthCollisionEnabled && depthTexRef && qualityTier !== 'low') ? 1.0 : 0.0;
    }
  }

  function setDepthTexture(depthTex, { near = 0.1, far = 200, collision = false } = {}) {
    depthTexRef = depthTex || null;
    camNear = near;
    camFar = far;
    depthCollisionEnabled = Boolean(collision && depthTexRef);
    if (threeRes?.simMat) {
      threeRes.simMat.uniforms.uDepthTex.value = depthTexRef;
      threeRes.simMat.uniforms.uCamNearFar.value.set?.(camNear, camFar);
      threeRes.simMat.uniforms.uHasDepthCollision.value =
        (depthCollisionEnabled && qualityTier !== 'low') ? 1.0 : 0.0;
    }
  }

  function setCameraMatrices(viewProj, near = camNear, far = camFar) {
    if (viewProj && viewProj.length >= 16) viewProjArray.set(viewProj);
    else if (viewProj?.elements) viewProjArray.set(viewProj.elements);
    camNear = near;
    camFar = far;
    if (threeRes?.simMat) {
      threeRes.simMat.uniforms.uViewProjMatrix.value.fromArray(viewProjArray);
      threeRes.simMat.uniforms.uCamNearFar.value.set?.(camNear, camFar);
    }
  }

  function setRenderer(r) {
    activeRenderer = r || null;
    if (initialized && threeRes && activeRenderer && !threeRes.rts) {
      ensureThreeMrt(activeRenderer);
    }
  }

  function runThreeGpuStep(dt) {
    if (!threeRes || !activeRenderer) return false;
    if (!ensureThreeMrt(activeRenderer)) return false;

    const firstBootstrap = !gpuBootstrapped;
    let uploadStart = spawnStart;
    let uploadCount = spawnCount;
    if (firstBootstrap) {
      uploadStart = 0;
      uploadCount = Math.min(totalEmitted, capacity);
    }

    let bytes = 0;
    if (uploadCount > 0) {
      bytes += uploadThreeDataTexRows(threeRes.initPosTex, posAge, uploadStart, uploadCount);
      bytes += uploadThreeDataTexRows(threeRes.initVelTex, velLife, uploadStart, uploadCount);
      bytes += uploadThreeDataTexRows(threeRes.spawnMetaTex, spawnMeta, uploadStart, uploadCount);
    }
    lastUploadedBytes = bytes;

    const dstIndex = 1 - readIndex;
    const srcRt = threeRes.rts[readIndex];
    const dstRt = threeRes.rts[dstIndex];
    const u = threeRes.simMat.uniforms;
    u.uStatePosTex.value = srcRt.textures[0];
    u.uStateVelTex.value = srcRt.textures[1];
    u.uSpawnRange.value.set?.(uploadStart, uploadCount);
    u.uDt.value = dt;
    u.uTime.value = simTime;

    const prevTarget = activeRenderer.getRenderTarget();
    const prevAutoClear = activeRenderer.autoClear;
    if (!firstBootstrap && simSpanCount > 0 && simBaseSlot + simSpanCount <= capacity && dstRt.scissor) {
      const r0 = (simBaseSlot / texWidth) | 0;
      const r1 = Math.min(texHeight - 1, ((simBaseSlot + simSpanCount - 1) / texWidth) | 0);
      dstRt.scissor.set(0, r0, texWidth, r1 - r0 + 1);
      dstRt.scissorTest = true;
    } else {
      dstRt.scissorTest = false;
    }
    activeRenderer.autoClear = false;
    activeRenderer.setRenderTarget(dstRt);
    activeRenderer.render(threeRes.simScene, threeRes.simCam);
    activeRenderer.setRenderTarget(prevTarget);
    activeRenderer.autoClear = prevAutoClear;

    if (firstBootstrap || simSpanCount > 0) {
      for (let c = 0; c < chunkCount; c++) {
        if (simTime >= chunkLatestDeath[c] - 1e-6 && chunkDeadPasses[c] < 2) {
          chunkDeadPasses[c] += 1;
        }
      }
    }
    readIndex = dstIndex;
    gpuBootstrapped = true;
    cpuActiveCount = 0;
    spawnCount = 0;
    simPasses += 1;

    threeRes.renderMat.uniforms.uPosTex.value = dstRt.textures[0];
    threeRes.renderMat.uniforms.uVelTex.value = dstRt.textures[1];
    threeRes.renderMat.uniforms.uBaseInstance.value = activeBaseSlot;
    return true;
  }

  function runRawGpuStep(dt) {
    if (!rawRes || !gl) return false;
    const firstBootstrap = !gpuBootstrapped;
    const uploadStart = firstBootstrap ? 0 : spawnStart;
    const uploadCount = firstBootstrap ? Math.min(totalEmitted, capacity) : spawnCount;

    let bytes = 0;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    if (uploadCount > 0) {
      bytes += uploadRawRows(rawRes.initPosTex, posAge, uploadStart, uploadCount, gl);
      bytes += uploadRawRows(rawRes.initVelTex, velLife, uploadStart, uploadCount, gl);
      bytes += uploadRawRows(rawRes.spawnMetaTex, spawnMeta, uploadStart, uploadCount, gl);
    }
    lastUploadedBytes = bytes;

    const dstIndex = 1 - readIndex;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevViewport = gl.getParameter(gl.VIEWPORT);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    const prevScissor = gl.isEnabled(gl.SCISSOR_TEST);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rawRes.fbos[dstIndex]);
    gl.viewport(0, 0, texWidth, texHeight);
    if (!firstBootstrap && simSpanCount > 0 && simBaseSlot + simSpanCount <= capacity) {
      const r0 = (simBaseSlot / texWidth) | 0;
      const r1 = Math.min(texHeight - 1, ((simBaseSlot + simSpanCount - 1) / texWidth) | 0);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, r0, texWidth, r1 - r0 + 1);
    } else if (prevScissor) {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.useProgram(rawRes.simProg);

    const su = rawRes.simUniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.statePosTexs[readIndex]);
    gl.uniform1i(su.uStatePosTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.stateVelTexs[readIndex]);
    gl.uniform1i(su.uStateVelTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.initPosTex);
    gl.uniform1i(su.uInitPosTex, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.initVelTex);
    gl.uniform1i(su.uInitVelTex, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.spawnMetaTex);
    gl.uniform1i(su.uSpawnMetaTex, 4);

    gl.uniform1i(su.uTexWidth, texWidth);
    gl.uniform1i(su.uCapacity, capacity);
    gl.uniform2i(su.uSpawnRange, uploadStart, uploadCount);
    gl.uniform1f(su.uDt, dt);
    gl.uniform1f(su.uTime, simTime);
    gl.uniform1f(su.uIs2D, is2D ? 1.0 : 0.0);
    gl.uniform3f(su.uGravity, field.gravity[0], field.gravity[1], field.gravity[2]);
    gl.uniform4f(su.uTurbulence, field.turbulenceStrength, field.turbulenceFreq, field.turbulenceScroll, 0);
    gl.uniform4f(su.uAttractor, field.attractorX, field.attractorY, field.attractorZ, field.attractorStrength);
    gl.uniform4f(su.uVortex, field.vortexAxisX, field.vortexAxisY, field.vortexAxisZ, field.vortexStrength);
    gl.uniform4f(su.uGround, field.groundY, field.groundFriction, field.groundEnabled ? 1 : 0, 0);
    gl.uniform4f(su.uLimits, field.maxSpeed, field.killRadius, 0, 0);
    gl.uniform1f(su.uHasDepthCollision, 0.0);

    gl.bindVertexArray(rawRes.simVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    if (!prevScissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    gl.useProgram(prevProg);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevBlend) gl.enable(gl.BLEND);
    if (prevDepth) gl.enable(gl.DEPTH_TEST);

    if (firstBootstrap || simSpanCount > 0) {
      for (let c = 0; c < chunkCount; c++) {
        if (simTime >= chunkLatestDeath[c] - 1e-6 && chunkDeadPasses[c] < 2) {
          chunkDeadPasses[c] += 1;
        }
      }
    }
    readIndex = dstIndex;
    gpuBootstrapped = true;
    cpuActiveCount = 0;
    spawnCount = 0;
    simPasses += 1;
    return true;
  }

  function update(visualDt = 0.016) {
    if (disposed || !initialized) return;
    const dt = Math.max(0, visualDt);
    const hasLiveWindow = Math.fround(simTime) <= latestDeathTime + 1e-4;

    if (!hasLiveWindow && spawnCount === 0 && cpuActiveCount === 0) {
      simTime += dt;
      lastUploadedBytes = 0;
      windowDirty = false;
      activeBaseSlot = 0;
      activeSpanCount = 0;
      simBaseSlot = 0;
      simSpanCount = 0;
      if (threeRes) {
        threeRes.mesh.visible = false;
        threeRes.mesh.geometry.instanceCount = 0;
      }
      return;
    }

    simTime += dt;
    computeActiveWindow(simTime);

    if (threeRes && activeRenderer && runThreeGpuStep(dt)) {
      threeRes.mesh.geometry.instanceCount = activeSpanCount;
      threeRes.mesh.visible = activeSpanCount > 0;
      return;
    }

    if (rawRes && runRawGpuStep(dt)) {
      return;
    }

    // CPU fallback (Headless / Canvas2D / pre-capture Frame 1)
    lastUploadedBytes = 0;
    if (threeRes && spawnCount > 0) {
      lastUploadedBytes += uploadThreeDataTexRows(threeRes.initPosTex, posAge, spawnStart, spawnCount);
      lastUploadedBytes += uploadThreeDataTexRows(threeRes.initVelTex, velLife, spawnStart, spawnCount);
      lastUploadedBytes += uploadThreeDataTexRows(threeRes.spawnMetaTex, spawnMeta, spawnStart, spawnCount);
      spawnCount = 0;
    }
    stepCpu(dt);
    if (threeRes) {
      if (cpuActiveCount > 0) {
        threeRes.initPosTex.needsUpdate = true;
        threeRes.initVelTex.needsUpdate = true;
      }
      threeRes.renderMat.uniforms.uBaseInstance.value = activeBaseSlot;
      threeRes.mesh.geometry.instanceCount = cpuActiveCount > 0 ? activeSpanCount : 0;
      threeRes.mesh.visible = cpuActiveCount > 0 && activeSpanCount > 0;
    }
  }

  function renderWebGL2(camera, viewWidth, viewHeight) {
    if (disposed || !initialized || !rawRes || !gl) return;
    if (Math.fround(simTime) > latestDeathTime + 1e-4) return;
    if (windowDirty) computeActiveWindow(simTime);
    if (activeSpanCount <= 0) return;
    if (!gpuBootstrapped) runRawGpuStep(0);

    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(rawRes.renderProg);

    const ru = rawRes.renderUniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.statePosTexs[readIndex]);
    gl.uniform1i(ru.uPosTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.stateVelTexs[readIndex]);
    gl.uniform1i(ru.uVelTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, rawRes.spawnMetaTex);
    gl.uniform1i(ru.uSpawnMetaTex, 2);

    gl.uniform1i(ru.uTexWidth, texWidth);
    gl.uniform1i(ru.uBaseInstance, activeBaseSlot);
    gl.uniform1i(ru.uCapacity, capacity);
    gl.uniform2f(ru.uCamPos, camera?.x ?? 0, camera?.y ?? 0);
    gl.uniform1f(ru.uCamZoom, camera?.zoom ?? 1);
    gl.uniform2f(ru.uViewSize, viewWidth, viewHeight);

    gl.bindVertexArray(rawRes.renderVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, activeSpanCount);
    gl.bindVertexArray(null);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (!prevBlend) gl.disable(gl.BLEND);
    if (prevDepth) gl.enable(gl.DEPTH_TEST);
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed || !initialized || cpuActiveCount === 0) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    let lastAdd = -1;
    for (let k = 0; k < cpuActiveCount; k++) {
      const idx = cpuActiveIndices[k];
      const i4 = idx * 4;
      const age = posAge[i4 + 3];
      const life = velLife[i4 + 3];
      if (age < 0 || life <= 0 || age >= life) continue;
      const add = cpuAdditive[idx];
      if (add !== lastAdd) {
        ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
        lastAdd = add;
      }
      const t = age / life;
      const size = (spawnMeta[i4] + (spawnMeta[i4 + 1] - spawnMeta[i4]) * t) * zoom;
      if (size <= 0.25) continue;
      const sx = (posAge[i4] - camX) * zoom + halfW;
      const sy = (posAge[i4 + 1] - camY) * zoom + halfH;
      const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      unpackRgb24Into(spawnMeta[i4 + 2], scratchRgb);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.5, 0, 6.2831853);
      ctx.fill();
    }
    ctx.restore();
  }

  function readParticleSample(slotIdx, out = {}) {
    if (!initialized || slotIdx < 0 || slotIdx >= capacity) {
      out.active = false;
      return out;
    }
    const i4 = slotIdx * 4;
    out.x = posAge[i4];
    out.y = posAge[i4 + 1];
    out.z = posAge[i4 + 2];
    out.age = posAge[i4 + 3];
    out.vx = velLife[i4];
    out.vy = velLife[i4 + 1];
    out.vz = velLife[i4 + 2];
    out.life = velLife[i4 + 3];
    out.active = out.age >= 0 && out.life > 0 && out.age < out.life;
    return out;
  }

  function reset() {
    simTime = 0;
    cursor = 0;
    totalEmitted = 0;
    spawnStart = 0;
    spawnCount = 0;
    latestDeathTime = -Infinity;
    chunkLatestDeath.fill(-Infinity);
    chunkDeadPasses.fill(2);
    windowDirty = false;
    activeBaseSlot = 0;
    activeSpanCount = 0;
    simBaseSlot = 0;
    simSpanCount = 0;
    lastUploadedBytes = 0;
    gpuBootstrapped = false;
    cpuActiveCount = 0;
    if (initialized) {
      for (let i = 0; i < texelCount; i++) posAge[i * 4 + 3] = -1;
      velLife.fill(0);
      cpuSlotPos.fill(-1);
      if (threeRes) {
        threeRes.mesh.visible = false;
        threeRes.mesh.geometry.instanceCount = 0;
        threeRes.renderMat.uniforms.uPosTex.value = threeRes.initPosTex;
        threeRes.renderMat.uniforms.uVelTex.value = threeRes.initVelTex;
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (threeRes) {
      scene?.remove?.(threeRes.mesh);
      threeRes.mesh?.geometry?.dispose?.();
      threeRes.renderMat?.dispose?.();
      threeRes.initPosTex?.dispose?.();
      threeRes.initVelTex?.dispose?.();
      threeRes.spawnMetaTex?.dispose?.();
      if (threeRes.rts) {
        threeRes.rts[0]?.dispose?.();
        threeRes.rts[1]?.dispose?.();
      }
      threeRes.quadGeo?.dispose?.();
      threeRes.simMat?.dispose?.();
      threeRes = null;
    }
    if (rawRes && gl) {
      for (let i = 0; i < 2; i++) {
        gl.deleteFramebuffer(rawRes.fbos[i]);
        gl.deleteTexture(rawRes.statePosTexs[i]);
        gl.deleteTexture(rawRes.stateVelTexs[i]);
      }
      gl.deleteTexture(rawRes.initPosTex);
      gl.deleteTexture(rawRes.initVelTex);
      gl.deleteTexture(rawRes.spawnMetaTex);
      gl.deleteBuffer(rawRes.quadVbo);
      gl.deleteVertexArray(rawRes.simVao);
      gl.deleteVertexArray(rawRes.renderVao);
      gl.deleteProgram(rawRes.simProg);
      gl.deleteProgram(rawRes.renderProg);
      rawRes = null;
    }
    posAge = null;
    velLife = null;
    spawnMeta = null;
    cpuDrag = null;
    cpuBounce = null;
    cpuShape = null;
    cpuAdditive = null;
    cpuActiveIndices = null;
    cpuSlotPos = null;
  }

  return {
    capacity,
    texWidth,
    texHeight,
    emit,
    burst,
    setField,
    setQualityTier,
    setDepthTexture,
    setCameraMatrices,
    setRenderer,
    readParticleSample,
    update,
    renderWebGL2,
    renderCanvas2D,
    reset,
    dispose,
    get time() { return simTime; },
    getStats() {
      if (windowDirty) computeActiveWindow(simTime);
      const aliveWindow = Math.fround(simTime) <= latestDeathTime + 1e-4;
      const activeEstimate = !initialized || !aliveWindow
        ? 0
        : (gpuBootstrapped ? activeSpanCount : cpuActiveCount);
      return {
        capacity,
        mobile,
        precision: preferFp16 ? 'fp16' : 'fp32',
        qualityTier,
        initialized,
        activeEstimate,
        activeBaseSlot,
        activeSpanCount,
        totalEmitted,
        gpuAccelerated: Boolean((threeRes?.mrtSupported === true && gpuBootstrapped) || rawRes),
        simPasses,
        uploadedBytes: lastUploadedBytes,
      };
    },
  };
}

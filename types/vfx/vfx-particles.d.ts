/**
 * Creates a stateless analytical GPU particle pool (normal + additive channels)
 * with automatic fallback for Canvas2D and headless Node environments.
 */
export function createStatelessParticlePool({ mode, THREE, scene, gl, mobile, maxParticles, is2D, prng, }?: {
    mode?: string | undefined;
    THREE?: any;
    scene?: any;
    gl?: WebGL2RenderingContext | null | undefined;
    mobile?: boolean | undefined;
    maxParticles?: number | undefined;
    is2D?: boolean | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
}): {
    capacity: number;
    emit: (opts: any) => void;
    burst: (opts?: {}) => void;
    flushDirty: () => void;
    update: (visualDt: any) => void;
    renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
    renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
    reset: () => void;
    dispose: () => void;
    readonly time: number;
    getStats(): {
        capacity: number;
        normalCursor: number;
        additiveCursor: number;
        normalTotal: number;
        additiveTotal: number;
        normalWrapCount: number;
        additiveWrapCount: number;
        normalLastRanges: never[];
        additiveLastRanges: never[];
    };
};
export const VFX_SHAPE: Readonly<{
    GLOW_ORB: 0;
    HIT_SPARK: 1;
    SMOKE_PUFF: 2;
    SHOCK_RING: 3;
    SHARD_BLADE: 4;
}>;
export const PARTICLE_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec4 aVfxP0; // x0, y0, z0, spawnTime\nattribute vec4 aVfxP1; // vx, vy, vz, duration\nattribute vec4 aVfxP2; // sizeStart, sizeEnd, gravity, drag\nattribute vec4 aVfxP3; // rgb24, shapeId, stretch, phase\n\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform float uTime;\nuniform float uIs2D;\n\nvarying vec2 vUv;\nvarying vec3 vColor;\nvarying float vLifeRatio;\nvarying float vShapeId;\nvarying float vPhase;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float age = uTime - aVfxP0.w;\n  float dur = aVfxP1.w;\n\n  if (dur <= 0.0 || age < 0.0 || age >= dur) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  float t = age / dur;\n  vLifeRatio = t;\n  vUv = uv * 2.0 - 1.0;\n  vColor = unpackRgb24(aVfxP3.x);\n  vShapeId = aVfxP3.y;\n  vPhase = aVfxP3.w;\n\n  float k = aVfxP2.w;\n  float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;\n  float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;\n\n  vec3 gVec = (uIs2D > 0.5) ? vec3(0.0, aVfxP2.z, 0.0) : vec3(0.0, -aVfxP2.z, 0.0);\n  vec3 worldPos = aVfxP0.xyz + aVfxP1.xyz * dispFactor + 0.5 * gVec * (age * age);\n  vec3 curVel = aVfxP1.xyz * velDecay + gVec * age;\n\n  float curSize = mix(aVfxP2.x, aVfxP2.y, t);\n  float stretch = aVfxP3.z;\n\n  if (uIs2D > 0.5) {\n    vec2 dir2 = vec2(1.0, 0.0);\n    float spd2 = length(curVel.xy);\n    if (spd2 > 0.001 && stretch > 0.01) {\n      dir2 = curVel.xy / spd2;\n    } else {\n      float ang = vPhase * 6.2831853 + age * 3.0;\n      dir2 = vec2(cos(ang), sin(ang));\n    }\n    vec2 perp2 = vec2(-dir2.y, dir2.x);\n    float lenScale = curSize * (1.0 + stretch * min(spd2 * 0.015, 4.0));\n    vec2 final2D = worldPos.xy + dir2 * (position.x * lenScale) + perp2 * (position.y * curSize);\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(final2D, worldPos.z, 1.0);\n  } else {\n    vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);\n    vec3 viewVel = mat3(modelViewMatrix) * curVel;\n    float spd = length(viewVel.xy);\n    vec2 rightAxis = vec2(1.0, 0.0);\n    if (spd > 0.001 && stretch > 0.01) {\n      rightAxis = viewVel.xy / spd;\n    } else {\n      float ang = vPhase * 6.2831853 + age * 2.5;\n      rightAxis = vec2(cos(ang), sin(ang));\n    }\n    vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);\n    float major = curSize * (1.0 + stretch * min(spd * 0.08, 4.5));\n    mvCenter.xy += rightAxis * (position.x * major) + upAxis * (position.y * curSize);\n    gl_Position = projectionMatrix * mvCenter;\n  }\n}\n";
export const PARTICLE_FRAGMENT_GLSL: "\nprecision highp float;\n\nvarying vec2 vUv;\nvarying vec3 vColor;\nvarying float vLifeRatio;\nvarying float vShapeId;\nvarying float vPhase;\n\nvoid main() {\n  float r = length(vUv);\n  if (r > 1.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  float fade = 1.0 - smoothstep(0.65, 1.0, vLifeRatio);\n  float alpha = 0.0;\n  vec3 col = vColor;\n\n  if (vShapeId < 0.5) {\n    alpha = exp(-4.2 * r * r) * fade;\n    col = mix(col, vec3(1.0), exp(-10.0 * r * r) * 0.65);\n  } else if (vShapeId < 1.5) {\n    float star = max(1.0 - (pow(abs(vUv.x), 0.45) + pow(abs(vUv.y), 0.45)), 0.0);\n    alpha = max(star, exp(-8.0 * r * r)) * fade;\n    col = mix(col, vec3(1.0), 0.5 * (1.0 - vLifeRatio));\n  } else if (vShapeId < 2.5) {\n    float ang = atan(vUv.y, vUv.x);\n    float wobble = 0.14 * sin(ang * 5.0 + vPhase * 12.0) + 0.08 * cos(ang * 9.0 - vLifeRatio * 6.0);\n    float edge = 0.82 + wobble - vLifeRatio * 0.25;\n    alpha = (1.0 - smoothstep(edge - 0.18, edge, r)) * fade;\n  } else if (vShapeId < 3.5) {\n    float ringRadius = mix(0.25, 0.90, vLifeRatio);\n    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;\n  } else {\n    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;\n    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;\n    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);\n  }\n\n  if (alpha < 0.01) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n  gl_FragColor = vec4(col, alpha);\n}\n";
export const PARTICLE_WEBGL2_2D_VS: "#version 300 es\nprecision highp float;\n\nlayout(location = 0) in vec2 aQuadPos; // [-0.5, 0.5]\nlayout(location = 1) in vec4 aVfxP0;\nlayout(location = 2) in vec4 aVfxP1;\nlayout(location = 3) in vec4 aVfxP2;\nlayout(location = 4) in vec4 aVfxP3;\n\nuniform float uTime;\nuniform vec2 uCamPos;\nuniform float uCamZoom;\nuniform vec2 uViewSize;\n\nout vec2 vUv;\nout vec3 vColor;\nout float vLifeRatio;\nout float vShapeId;\nout float vPhase;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float age = uTime - aVfxP0.w;\n  float dur = aVfxP1.w;\n  if (dur <= 0.0 || age < 0.0 || age >= dur) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  float t = age / dur;\n  vLifeRatio = t;\n  vUv = aQuadPos * 2.0;\n  vColor = unpackRgb24(aVfxP3.x);\n  vShapeId = aVfxP3.y;\n  vPhase = aVfxP3.w;\n\n  float k = aVfxP2.w;\n  float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;\n  float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;\n\n  vec2 gVec = vec2(0.0, aVfxP2.z);\n  vec2 worldPos = aVfxP0.xy + aVfxP1.xy * dispFactor + 0.5 * gVec * (age * age);\n  vec2 curVel = aVfxP1.xy * velDecay + gVec * age;\n\n  float curSize = mix(aVfxP2.x, aVfxP2.y, t);\n  float stretch = aVfxP3.z;\n  float spd = length(curVel);\n  vec2 dir2 = (spd > 0.001 && stretch > 0.01)\n    ? (curVel / spd)\n    : vec2(cos(vPhase * 6.2831853 + age * 3.0), sin(vPhase * 6.2831853 + age * 3.0));\n  vec2 perp2 = vec2(-dir2.y, dir2.x);\n  float lenScale = curSize * (1.0 + stretch * min(spd * 0.015, 4.0));\n  vec2 p = worldPos + dir2 * (aQuadPos.x * lenScale) + perp2 * (aQuadPos.y * curSize);\n\n  vec2 screenPx = (p - uCamPos) * uCamZoom + uViewSize * 0.5;\n  vec2 ndc = vec2(\n    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,\n    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0\n  );\n  gl_Position = vec4(ndc, 0.0, 1.0);\n}\n";
export const PARTICLE_WEBGL2_2D_FS: "#version 300 es\nprecision highp float;\n\nin vec2 vUv;\nin vec3 vColor;\nin float vLifeRatio;\nin float vShapeId;\nin float vPhase;\n\nout vec4 fragColor;\n\nvoid main() {\n  float r = length(vUv);\n  if (r > 1.0) {\n    fragColor = vec4(0.0);\n    return;\n  }\n\n  float fade = 1.0 - smoothstep(0.65, 1.0, vLifeRatio);\n  float alpha = 0.0;\n  vec3 col = vColor;\n\n  if (vShapeId < 0.5) {\n    alpha = exp(-4.2 * r * r) * fade;\n    col = mix(col, vec3(1.0), exp(-10.0 * r * r) * 0.65);\n  } else if (vShapeId < 1.5) {\n    float star = max(1.0 - (pow(abs(vUv.x), 0.45) + pow(abs(vUv.y), 0.45)), 0.0);\n    alpha = max(star, exp(-8.0 * r * r)) * fade;\n    col = mix(col, vec3(1.0), 0.5 * (1.0 - vLifeRatio));\n  } else if (vShapeId < 2.5) {\n    float ang = atan(vUv.y, vUv.x);\n    float wobble = 0.14 * sin(ang * 5.0 + vPhase * 12.0) + 0.08 * cos(ang * 9.0 - vLifeRatio * 6.0);\n    float edge = 0.82 + wobble - vLifeRatio * 0.25;\n    alpha = (1.0 - smoothstep(edge - 0.18, edge, r)) * fade;\n  } else if (vShapeId < 3.5) {\n    float ringRadius = mix(0.25, 0.90, vLifeRatio);\n    alpha = (1.0 - smoothstep(0.0, 0.14, abs(r - ringRadius))) * fade;\n  } else {\n    float d = abs(vUv.x) * 0.65 + abs(vUv.y) * 1.65;\n    alpha = (1.0 - smoothstep(0.75, 0.92, d)) * fade;\n    col = mix(col, vec3(1.0), step(d, 0.35) * 0.45);\n  }\n\n  if (alpha < 0.01) {\n    fragColor = vec4(0.0);\n    return;\n  }\n  fragColor = vec4(col, alpha);\n}\n";

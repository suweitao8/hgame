export function createTelegraphSystem({ mode, THREE, scene, is2D, maxTelegraphs, }?: {
    mode?: string;
    THREE?: any;
    scene?: any;
    is2D?: boolean;
    maxTelegraphs?: number;
}): {
    spawnTelegraph: (opts?: {}) => number;
    updateTelegraph: (slot: any, opts?: {}) => void;
    setShrinkZone: ({ centerX, centerY, centerZ, safeRadius, mapRadius, active, }?: {
        centerX?: number;
        centerY?: number;
        centerZ?: number;
        safeRadius?: number;
        mapRadius?: number;
        active?: boolean;
    }) => void;
    update: (visualDt: any) => void;
    renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
    reset: () => void;
    dispose: () => void;
    getStats(): {
        capacity: number;
        totalSpawned: number;
    };
};
export const TELEGRAPH_SHAPE: Readonly<{
    CIRCLE: 0;
    RING: 1;
    SECTOR: 2;
    LINE_BOX: 3;
    SHRINK_ZONE: 4;
}>;
export const TELEGRAPH_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec4 aTeleP0; // x, y, z, spawnTime\nattribute vec4 aTeleP1; // yawRad, scaleX, scaleZ, duration\nattribute vec4 aTeleP2; // shapeId, rgb24, paramA (angleHalf / innerRatio / boxRatio / bandRatio), paramB\n\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform float uTime;\nuniform float uIs2D;\n\nvarying vec2 vLocal;\nvarying vec3 vColor;\nvarying float vShapeId;\nvarying float vProgress;\nvarying float vParamA;\nvarying float vParamB;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float age = uTime - aTeleP0.w;\n  float dur = aTeleP1.w;\n  if (dur <= 0.0 || age < 0.0 || (dur < 99990.0 && age >= dur)) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  vProgress = (dur >= 99990.0) ? 1.0 : clamp(age / dur, 0.0, 1.0);\n  vLocal = uv - 0.5;\n  vShapeId = aTeleP2.x;\n  vColor = unpackRgb24(aTeleP2.y);\n  vParamA = aTeleP2.z;\n  vParamB = aTeleP2.w;\n\n  float yaw = aTeleP1.x;\n  float c = cos(yaw);\n  float s = sin(yaw);\n  vec2 scaled = position.xy * vec2(aTeleP1.y, aTeleP1.z);\n\n  vec3 worldPos;\n  if (uIs2D > 0.5) {\n    worldPos = vec3(\n      aTeleP0.x + scaled.x * c - scaled.y * s,\n      aTeleP0.y + scaled.x * s + scaled.y * c,\n      aTeleP0.z\n    );\n  } else {\n    worldPos = vec3(\n      aTeleP0.x + scaled.x * c - scaled.y * s,\n      aTeleP0.y + 0.03,\n      aTeleP0.z + scaled.x * s + scaled.y * c\n    );\n  }\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);\n}\n";
export const TELEGRAPH_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform float uTime;\n\nvarying vec2 vLocal;\nvarying vec3 vColor;\nvarying float vShapeId;\nvarying float vProgress;\nvarying float vParamA;\nvarying float vParamB;\n\nfloat sdCircle(vec2 p, float r) {\n  return length(p) - r;\n}\n\nfloat sdSector(vec2 p, float halfAng) {\n  vec2 q = vec2(abs(p.x), p.y);\n  vec2 c = vec2(sin(halfAng), cos(halfAng));\n  float l = length(q) - 0.5;\n  float m = length(q - c * clamp(dot(q, c), 0.0, 0.5));\n  return max(l, m * sign(c.y * q.x - c.x * q.y));\n}\n\nfloat sdBox(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);\n}\n\nvoid main() {\n  if (vShapeId > 3.5) {\n    // 4: SHRINK_ZONE (vParamA = safeNormRadius, vParamB = 2.5m / mapDiameter)\n    float r = length(vLocal);\n    if (r < vParamA) discard;\n    float ang = atan(vLocal.y, vLocal.x);\n    float flameWave = (0.35 * sin(ang * 14.0 + uTime * 4.5) + 0.22 * cos(ang * 23.0 - uTime * 6.2)) * vParamB;\n    float distOut = r - vParamA;\n    float edgeDist = distOut + flameWave;\n    float band = max(0.004, vParamB);\n    float innerFire = 1.0 - smoothstep(0.0, band * 0.45, abs(edgeDist));\n    float outerDark = smoothstep(0.0, band, distOut);\n    vec3 col = mix(vec3(0.95, 0.22, 0.12), vec3(0.08, 0.02, 0.14), outerDark);\n    col = mix(col, vec3(0.02, 0.01, 0.03), smoothstep(band, band * 2.5, distOut));\n    float alpha = clamp(innerFire * 0.95 + outerDark * 0.55, 0.0, 0.85);\n    if (alpha < 0.01) discard;\n    gl_FragColor = vec4(col, alpha);\n    return;\n  }\n\n  float d = 0.0;\n  float fillMask = 0.0;\n  vec2 p = vLocal;\n\n  if (vShapeId < 0.5) {\n    d = sdCircle(p, 0.5);\n    float innerD = sdCircle(p, 0.5 * vProgress);\n    fillMask = step(innerD, 0.0) * 0.26;\n  } else if (vShapeId < 1.5) {\n    float rMid = mix(0.25, 0.46, vParamA);\n    float halfW = max(0.02, 0.5 - rMid);\n    d = abs(length(p) - rMid) - halfW;\n    fillMask = step(d, 0.0) * (0.14 + 0.22 * vProgress);\n  } else if (vShapeId < 2.5) {\n    float halfAng = clamp(vParamA, 0.05, 3.14159);\n    d = sdSector(p, halfAng);\n    float innerR = length(p) - 0.5 * vProgress;\n    fillMask = step(d, 0.0) * (0.14 + 0.24 * step(innerR, 0.0));\n  } else {\n    vec2 b = vec2(clamp(vParamA, 0.05, 0.49), 0.48);\n    d = sdBox(p, b);\n    float chevron = smoothstep(0.55, 0.85, fract((p.y + 0.5) * 6.0 - uTime * 3.0 - abs(p.x) * 2.0));\n    fillMask = step(d, 0.0) * (0.16 + 0.24 * chevron * vProgress);\n  }\n\n#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300\n  float aa = max(0.002, fwidth(d));\n#else\n  float aa = 0.006;\n#endif\n  float inside = 1.0 - smoothstep(-aa, aa, d);\n  if (inside <= 0.005) discard;\n\n  float border = 1.0 - smoothstep(0.0, max(0.018, aa * 2.5), abs(d));\n  float flash = (vProgress > 0.85) ? (0.65 + 0.35 * sin(uTime * 150.796)) : 1.0; // ~24Hz\n  float alpha = clamp((fillMask + border * 0.85) * inside * flash, 0.0, 0.95);\n  vec3 col = mix(vColor, vec3(1.0), border * 0.45);\n  gl_FragColor = vec4(col, alpha);\n}\n";

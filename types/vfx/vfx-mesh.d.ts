/**
 * Pooled 3D Mesh VFX renderer for `renderMode: 'mesh'` layers (shields, ice lances, shock domes).
 * Supports custom GLBs, built-in geometries, UV scrolling, Fresnel rim glow, and procedural dissolve.
 * @param {object} [options]
 * @param {string} [options.mode='headless']
 * @param {object | null} [options.THREE=null]
 * @param {object | null} [options.scene=null]
 * @param {number} [options.maxMeshes=64]
 */
export function createMeshVfxPool({ mode, THREE, scene, maxMeshes, }?: {
    mode?: string | undefined;
    THREE?: object | null;
    scene?: object | null;
    maxMeshes?: number | undefined;
} | undefined): {
    capacity: number;
    registerMesh: (id: string, geometryOrObject3D: object) => boolean;
    spawn: (opts?: object) => number;
    update: (visualDt: any) => void;
    reset: () => void;
    dispose: () => void;
    getStats(): {
        capacity: number;
        activeCount: number;
        totalSpawned: number;
        registeredMeshes: number;
    };
};
export const VFX_MESH_VERTEX_GLSL: "\nuniform vec2 uUvScroll;\nuniform float uTime;\n\nvarying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\nvarying vec3 vLocalPos;\n\nvoid main() {\n  vUv = uv + uUvScroll * uTime;\n  vLocalPos = position;\n  vNormalView = normalize(normalMatrix * normal);\n  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);\n  vViewPos = -mvPos.xyz;\n  gl_Position = projectionMatrix * mvPos;\n}\n";
export const VFX_MESH_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uTex;\nuniform float uHasTex;\nuniform vec3 uColor;\nuniform float uOpacity;\nuniform float uHdr;\nuniform float uLit;\nuniform vec3 uLightDirView;\nuniform vec3 uEmission;\nuniform vec2 uFresnel;     // power, intensity\nuniform vec3 uDissolve;    // progress [0..1], edgeWidth, enabled\nuniform vec3 uDissolveColor;\n\nvarying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\nvarying vec3 vLocalPos;\n\nfloat hash31(vec3 p) {\n  p = fract(p * 0.1031);\n  p += dot(p, p.yzx + 33.33);\n  return fract((p.x + p.y) * p.z);\n}\n\nfloat valueNoise3(vec3 x) {\n  vec3 i = floor(x);\n  vec3 f = fract(x);\n  f = f * f * (3.0 - 2.0 * f);\n  return mix(\n    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),\n        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),\n    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),\n        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),\n    f.z\n  );\n}\n\nvoid main() {\n  vec4 texCol = (uHasTex > 0.5) ? texture2D(uTex, fract(vUv)) : vec4(1.0);\n  float alpha = texCol.a * uOpacity;\n  vec3 baseCol = texCol.rgb * uColor * max(0.0, uHdr);\n\n  vec3 N = normalize(vNormalView);\n  vec3 V = normalize(vViewPos);\n  if (uLit > 0.5) {\n    vec3 L = normalize(uLightDirView);\n    float ndotl = max(dot(N, L), 0.0);\n    float hemi = 0.5 + 0.5 * N.y;\n    vec3 H = normalize(L + V);\n    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.45;\n    baseCol = baseCol * (0.35 + 0.45 * hemi + 0.65 * ndotl) + vec3(spec) * uColor;\n  }\n  baseCol += uEmission;\n\n  if (uFresnel.y > 0.001) {\n    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);\n    float rim = pow(1.0 - ndotv, max(0.25, uFresnel.x)) * uFresnel.y;\n    baseCol += uColor * (rim * max(1.0, uHdr));\n    alpha = clamp(alpha + rim * uOpacity, 0.0, 1.0);\n  }\n\n  if (uDissolve.z > 0.5) {\n    float n = valueNoise3(vLocalPos * 4.5 + vec3(0.0, vUv.y * 2.0, 0.0));\n    float cut = uDissolve.x;\n    if (n < cut) discard;\n    float edge = 1.0 - smoothstep(cut, cut + max(0.02, uDissolve.y), n);\n    baseCol = mix(baseCol, uDissolveColor * max(1.5, uHdr), edge);\n  }\n\n  if (alpha < 0.005) discard;\n  gl_FragColor = vec4(baseCol, alpha);\n}\n";

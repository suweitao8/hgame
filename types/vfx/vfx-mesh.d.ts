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
    getSurfaceSamples: (name: any) => any;
    spawn: (opts?: object) => number;
    readSlotMotion: (slotIdx: any, position: any, velocity: any) => void;
    updateSlot: (slotIdx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
    setWind: (wx?: number, wy?: number, wz?: number) => void;
    setEffectOffset: (slotIdx: any, x?: number, y?: number, z?: number) => void;
    setSceneTexture: (sceneTexture: any, { width, height }?: {
        width?: number | undefined;
        height?: number | undefined;
    }) => void;
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
export const VFX_MESH_VERTEX_GLSL: "\nuniform vec2 uUvScroll;\nuniform vec4 uUvST;\nuniform vec3 uPivot;\nuniform float uTime;\n\nvarying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\nvarying vec3 vLocalPos;\n\nvoid main() {\n  vUv = uv * uUvST.xy + uUvST.zw + uUvScroll * uTime;\n  vec3 shiftedPos = position - uPivot;\n  vLocalPos = shiftedPos;\n  vNormalView = normalize(normalMatrix * normal);\n  vec4 mvPos = modelViewMatrix * vec4(shiftedPos, 1.0);\n  vViewPos = -mvPos.xyz;\n  gl_Position = projectionMatrix * mvPos;\n}\n";
export const VFX_MESH_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uTex;\nuniform float uHasTex;\nuniform vec4 uTexRect;\nuniform float uAtlasUv;\nuniform float uFlipLocalV;\nuniform vec4 uFlipbook;\nuniform float uLifeRatio;\nuniform sampler2D uSceneTex;\nuniform float uHasSceneTex;\nuniform float uDistortion;\nuniform float uIsMultiply;\nuniform float uOpaque;\nuniform float uAlphaCutoff;\nuniform vec2 uCameraFade;\nuniform vec2 uInvViewport;\nuniform vec3 uColor;\nuniform float uOpacity;\nuniform float uHdr;\nuniform float uLit;\nuniform vec3 uLightDirView;\nuniform vec3 uEmission;\nuniform vec2 uFresnel;     // power, intensity\nuniform vec3 uDissolve;    // progress [0..1], edgeWidth, enabled\nuniform vec3 uDissolveColor;\n\nvarying vec2 vUv;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\nvarying vec3 vLocalPos;\n\nfloat hash31(vec3 p) {\n  p = fract(p * 0.1031);\n  p += dot(p, p.yzx + 33.33);\n  return fract((p.x + p.y) * p.z);\n}\n\nfloat valueNoise3(vec3 x) {\n  vec3 i = floor(x);\n  vec3 f = fract(x);\n  f = f * f * (3.0 - 2.0 * f);\n  return mix(\n    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),\n        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),\n    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),\n        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),\n    f.z\n  );\n}\n\n\nvec2 vfxFlipbookGrid(vec2 tiles) {\n  return max(vec2(1.0), floor(tiles + 0.5));\n}\n\nfloat vfxFlipbookFramePosition(float lifeRatio, vec2 grid, float cycles) {\n  float total = grid.x * grid.y;\n  cycles = max(0.01, cycles);\n  float phase = lifeRatio * cycles;\n  if (phase >= 1.0 && cycles <= 1.001) return total - 0.001;\n  return min(fract(phase), 0.9999) * total;\n}\n\nvec2 vfxFlipbookFrameUv(float frameIndex, vec2 localUv, vec2 grid) {\n  vec2 cell = vec2(mod(frameIndex, grid.x), floor(frameIndex / grid.x));\n  return (cell + localUv) / grid;\n}\n\n\nvec4 sampleAtlas(vec2 localUv) {\n  vec2 texUv = mix(uTexRect.xy, uTexRect.zw, localUv);\n  if (uAtlasUv > 1.5) texUv.y = 1.0 - texUv.y;\n  return texture2D(uTex, texUv);\n}\n\nvec4 sampleParticleTexture() {\n  if (uHasTex < 0.5) return vec4(1.0);\n  vec2 localUv = fract(vUv);\n  if (uAtlasUv < 0.5) return texture2D(uTex, localUv);\n  if (uFlipLocalV > 0.5) localUv.y = 1.0 - localUv.y;\n  if (uFlipbook.x < 1.5 && uFlipbook.y < 1.5) return sampleAtlas(localUv);\n\n  vec2 grid = vfxFlipbookGrid(uFlipbook.xy);\n  float frame = vfxFlipbookFramePosition(uLifeRatio, grid, uFlipbook.z);\n  float first = floor(frame);\n  vec4 color = sampleAtlas(vfxFlipbookFrameUv(first, localUv, grid));\n  if (uFlipbook.w > 0.5) {\n    float next = min(first + 1.0, grid.x * grid.y - 1.0);\n    color = mix(color, sampleAtlas(vfxFlipbookFrameUv(next, localUv, grid)), fract(frame));\n  }\n  return color;\n}\n\nvoid main() {\n  vec4 texCol = sampleParticleTexture();\n  vec3 N = normalize(vNormalView);\n  vec3 V = normalize(vViewPos);\n  float alpha = texCol.a * uOpacity;\n  if (uDistortion > 0.5) {\n    if (uHasSceneTex < 0.5 || alpha < uAlphaCutoff) discard;\n    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);\n    float dAlpha = alpha * smoothstep(0.0, 0.28, ndotv);\n    if (dAlpha < 0.005) discard;\n    vec2 nOff = (uHasTex > 0.5) ? (texCol.rg * 2.0 - 1.0) : (N.xy * ndotv);\n    vec2 screenUv = gl_FragCoord.xy * uInvViewport;\n    vec2 refrUv = clamp(screenUv + nOff * 0.038 * dAlpha, vec2(0.002), vec2(0.998));\n    gl_FragColor = vec4(texture2D(uSceneTex, refrUv).rgb, clamp(dAlpha, 0.0, 1.0));\n    return;\n  }\n\n  vec3 baseCol = texCol.rgb * uColor * max(0.0, uHdr);\n  if (uLit > 0.5) {\n    vec3 L = normalize(uLightDirView);\n    float ndotl = max(dot(N, L), 0.0);\n    float hemi = 0.5 + 0.5 * N.y;\n    vec3 H = normalize(L + V);\n    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.45;\n    baseCol = baseCol * (0.35 + 0.45 * hemi + 0.65 * ndotl) + vec3(spec) * uColor;\n  }\n  baseCol += texCol.rgb * uEmission;\n\n  if (uFresnel.y > 0.001) {\n    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);\n    float rim = pow(1.0 - ndotv, max(0.25, uFresnel.x)) * uFresnel.y;\n    baseCol += uColor * (rim * max(1.0, uHdr));\n    alpha = clamp(alpha + rim * uOpacity, 0.0, 1.0);\n  }\n\n  if (uDissolve.z > 0.5) {\n    float n = valueNoise3(vLocalPos * 4.5 + vec3(0.0, vUv.y * 2.0, 0.0));\n    float cut = uDissolve.x;\n    if (n < cut) discard;\n    float edge = 1.0 - smoothstep(cut, cut + max(0.02, uDissolve.y), n);\n    baseCol = mix(baseCol, uDissolveColor * max(1.5, uHdr), edge);\n  }\n\n  if (alpha < uAlphaCutoff) discard;\n  float camFade = (uCameraFade.y > uCameraFade.x + 0.001)\n    ? clamp((abs(vViewPos.z) - uCameraFade.x) / (uCameraFade.y - uCameraFade.x), 0.0, 1.0)\n    : 1.0;\n  alpha = uOpaque > 0.5 ? 1.0 : alpha * camFade;\n  if (alpha < 0.005) discard;\n  if (uIsMultiply > 0.5) {\n    gl_FragColor = vec4(mix(vec3(1.0), baseCol, clamp(alpha, 0.0, 1.0)), 1.0);\n    return;\n  }\n  gl_FragColor = vec4(baseCol, alpha);\n}\n";

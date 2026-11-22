/**
 * Generates raw RGBA8 data for the 256x64 1D gradient LUT atlas (Straight RGBA, flipY=false).
 * @returns {Uint8Array}
 */
export function buildVfxGradientLutBytes(): Uint8Array;
/**
 * Creates a Three.js DataTexture for the 256x64 1D gradient LUT atlas.
 * @param {object} THREE
 * @returns {object | null}
 */
export function createVfxGradientLutTexture(THREE: object): object | null;
/**
 * Generates procedural default test textures (4x4 fire/smoke flipbook, channel-packed noise, soft disc, slash arc)
 * so v2 benchmark presets run cleanly without external Unreal assets.
 * @param {object} THREE
 */
export function createVfxV2DefaultTextures(THREE: object): {
    textures: {
        fire_flipbook: any;
        noise_packed: any;
        soft_disc: any;
        slash_arc: any;
    };
    resolve(keyOrPath: any): any;
    dispose(): void;
} | null;
/**
 * Builds reusable low-poly VFX geometries for sprite/mesh emitters.
 * @param {object} THREE
 */
export function createVfxV2MeshGeometries(THREE: object): {
    get(kind: any): any;
    dispose(): void;
} | null;
/**
 * Computes active shader macro list for a material config & quality tier.
 * @param {object} [materialCfg]
 * @param {'high' | 'med' | 'low'} [qualityTier='high']
 */
export function getVfxMasterDefines(materialCfg?: object, qualityTier?: "high" | "low" | "med" | undefined): Record<string, number>;
/**
 * Instantiates a configured Three.js ShaderMaterial using VFX Master Shader v2.
 * @param {object} THREE
 * @param {object} materialCfg
 * @param {object} [options]
 */
export function createVfxMasterMaterial(THREE: object, materialCfg?: object, { qualityTier, mainTex, noiseTex, gradientLut, depthTex, avgLifetime, }?: object): {
    material: any;
    defines: Record<string, number>;
    variantKey: string;
};
export const VFX_V2_LUT_WIDTH: 256;
export const VFX_V2_LUT_ROWS: 64;
export const VFX_GRADIENT_LUT_NAMES: readonly string[];
export const VFX_COLOR_MODES: Readonly<{
    default: -1;
    fire: 0;
    smoke: 1;
    lightning: 2;
    blood: 3;
    orangeJuice: 4;
    limeJuice: 5;
    shield: 6;
    gold: 7;
}>;
export const VFX_MASTER_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec4 aCustom; // x=age01, y=seed, z=dissolve, w=additive\n\nuniform float uTime;\nuniform vec2 uUvScroll;\nuniform float uCameraOffset;\n\nvarying vec2 vUv;\nvarying vec4 vCustom;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\n\nvoid main() {\n  vCustom = aCustom;\n  vUv = uv + uUvScroll * uTime;\n\n  vec4 localPos = vec4(position, 1.0);\n  vec3 localNormal = normal;\n  #ifdef USE_INSTANCING\n    localPos = instanceMatrix * localPos;\n    localNormal = mat3(instanceMatrix) * localNormal;\n  #endif\n\n  vec4 mvPos = modelViewMatrix * localPos;\n  if (uCameraOffset > 0.0001) {\n    float viewLen = length(mvPos.xyz);\n    if (viewLen > 0.001) {\n      mvPos.xyz += (-mvPos.xyz / viewLen) * uCameraOffset;\n    }\n  }\n  vViewPos = -mvPos.xyz;\n  vNormalView = normalize(normalMatrix * localNormal);\n  gl_Position = projectionMatrix * mvPos;\n}\n";
export const VFX_MASTER_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uMainTex;\nuniform float uHasMainTex;\nuniform sampler2D uNoiseTex;\nuniform float uHasNoiseTex;\nuniform sampler2D uGradientLut;\nuniform sampler2D uDepthTex;\nuniform float uHasDepthTex;\n\nuniform float uTime;\nuniform vec2 uNoiseScroll;\nuniform float uDistortionStrength;\nuniform float uDissolveEdgeWidth;\nuniform vec3 uDissolveEdgeColor;\nuniform float uEmissiveBoost;\nuniform float uLutRow;\nuniform vec3 uTint;\nuniform float uFresnelPower;\nuniform float uSoftParticleDepth;\nuniform float uBlendMode; // 0=alpha, 1=additive, 2=pma\nuniform float uOpacityScale;\nuniform vec2 uInvViewport;\nuniform vec2 uCameraProj; // x=near, y=far\n\nuniform vec4 uFlipbook;      // x=cols, y=rows, z=fps, w=frameBlend\nuniform vec4 uFlipbookExtra; // x=randomStart, y=totalFrames, z=fpsCyclesScale, w=loop\n\nvarying vec2 vUv;\nvarying vec4 vCustom;\nvarying vec3 vNormalView;\nvarying vec3 vViewPos;\n\n#ifdef USE_FLIPBOOK\nvec2 computeFlipbookCellUv(float frameIdx, vec2 cellUv, float cols, float rows) {\n  float col = mod(frameIdx, cols);\n  float row = floor(frameIdx / cols);\n  return vec2(\n    (col + cellUv.x) / cols,\n    (rows - 1.0 - row + cellUv.y) / rows\n  );\n}\n\nvec4 sampleFlipbookMain(vec2 localUv) {\n  float cols = max(1.0, uFlipbook.x);\n  float rows = max(1.0, uFlipbook.y);\n  float total = max(1.0, uFlipbookExtra.y);\n  float startOff = uFlipbookExtra.x > 0.5 ? floor(vCustom.y * total) : 0.0;\n  float cycles = uFlipbookExtra.z > 0.0 ? uFlipbookExtra.z : total;\n  float rawFrame = vCustom.x * cycles + startOff;\n  float framePos = uFlipbookExtra.w > 0.5 ? mod(rawFrame, total) : clamp(rawFrame, 0.0, total - 1.0);\n  float f0 = floor(framePos);\n  vec4 c0 = texture2D(uMainTex, computeFlipbookCellUv(f0, localUv, cols, rows));\n  if (uFlipbook.w > 0.5) {\n    float f1 = uFlipbookExtra.w > 0.5 ? mod(f0 + 1.0, total) : min(f0 + 1.0, total - 1.0);\n    vec4 c1 = texture2D(uMainTex, computeFlipbookCellUv(f1, localUv, cols, rows));\n    return mix(c0, c1, fract(framePos));\n  }\n  return c0;\n}\n#endif\n\n#ifdef USE_SOFT_PARTICLES\nfloat linearizeViewDepth(float rawDepth) {\n  float zNdc = rawDepth * 2.0 - 1.0;\n  return (2.0 * uCameraProj.x * uCameraProj.y) /\n    max(0.0001, (uCameraProj.y + uCameraProj.x - zNdc * (uCameraProj.y - uCameraProj.x)));\n}\n#endif\n\nvoid main() {\n  vec2 mainUv = fract(vUv);\n  float auxMask = 1.0;\n  float dissolveNoise = 0.5;\n  float hotBand = 0.0;\n\n  #ifdef USE_NOISE_DISSOLVE\n    if (uHasNoiseTex > 0.5) {\n      vec2 nUv = vUv + uNoiseScroll * uTime + vec2(vCustom.y * 0.37, vCustom.y * 0.73);\n      vec4 nSample = texture2D(uNoiseTex, nUv);\n      auxMask = nSample.r;\n      dissolveNoise = nSample.g;\n      float distort = nSample.b - 0.5;\n      mainUv = clamp(mainUv + vec2(distort, nSample.g - 0.5) * uDistortionStrength, vec2(0.001), vec2(0.999));\n    }\n  #endif\n\n  vec4 texCol = vec4(1.0);\n  if (uHasMainTex > 0.5) {\n    #ifdef USE_FLIPBOOK\n      texCol = sampleFlipbookMain(mainUv);\n    #else\n      texCol = texture2D(uMainTex, mainUv);\n    #endif\n  }\n\n  vec3 baseRgb = texCol.rgb;\n  float alpha = texCol.a * uOpacityScale;\n\n  #ifdef USE_NOISE_DISSOLVE\n    alpha *= mix(1.0, auxMask, step(0.5, uHasNoiseTex) * 0.25);\n    float cut = clamp(vCustom.z, 0.0, 1.0);\n    if (cut > 0.001) {\n      float edgeW = max(0.015, uDissolveEdgeWidth);\n      float edgeMask = smoothstep(cut, cut + edgeW, dissolveNoise);\n      alpha *= edgeMask;\n      hotBand = edgeMask * (1.0 - smoothstep(cut + edgeW, cut + edgeW * 2.3, dissolveNoise));\n    }\n  #endif\n\n  #ifdef USE_GRADIENT_LUT\n    if (uLutRow >= -0.5) {\n      float lum = clamp(dot(texCol.rgb, vec3(0.299, 0.587, 0.114)), 0.002, 0.998);\n      float rowV = (uLutRow + 0.5) / 64.0;\n      baseRgb = texture2D(uGradientLut, vec2(lum, rowV)).rgb;\n    }\n  #endif\n\n  float emissiveScale = (uBlendMode > 1.5)\n    ? mix(1.0, max(1.0, uEmissiveBoost), clamp(vCustom.w, 0.0, 1.0))\n    : max(0.0, uEmissiveBoost);\n  vec3 finalRgb = baseRgb * uTint * emissiveScale;\n\n  #ifdef USE_NOISE_DISSOLVE\n    finalRgb += uDissolveEdgeColor * max(1.0, uEmissiveBoost) * hotBand;\n  #endif\n\n  #ifdef USE_MESH_FRESNEL\n    vec3 N = normalize(vNormalView);\n    vec3 V = normalize(vViewPos);\n    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);\n    float fresnel = pow(1.0 - ndotv, max(0.25, uFresnelPower));\n    finalRgb += uTint * (fresnel * max(1.0, uEmissiveBoost));\n    alpha = clamp(alpha * (0.2 + 0.8 * fresnel), 0.0, 1.0);\n  #endif\n\n  #ifdef USE_SOFT_PARTICLES\n    if (uHasDepthTex > 0.5 && uSoftParticleDepth > 0.001) {\n      vec2 screenUv = gl_FragCoord.xy * uInvViewport;\n      float rawDepth = texture2D(uDepthTex, screenUv).r;\n      if (rawDepth < 0.99999) {\n        float sceneZ = linearizeViewDepth(rawDepth);\n        float partZ = abs(vViewPos.z);\n        float softFade = clamp((sceneZ - partZ) / uSoftParticleDepth, 0.0, 1.0);\n        alpha *= softFade;\n      }\n    }\n  #endif\n\n  alpha = clamp(alpha, 0.0, 1.0);\n  if (alpha < 0.004) discard;\n\n  if (uBlendMode > 1.5) {\n    // PMA single-drawcall Fire(additive=1) -> Smoke(additive=0)\n    gl_FragColor = vec4(finalRgb * alpha, alpha * (1.0 - clamp(vCustom.w, 0.0, 1.0)));\n  } else if (uBlendMode > 0.5) {\n    gl_FragColor = vec4(finalRgb * alpha, alpha);\n  } else {\n    gl_FragColor = vec4(finalRgb, alpha);\n  }\n}\n";

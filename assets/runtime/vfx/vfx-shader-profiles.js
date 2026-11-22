/**
 * Pluggable Shader Profile Registry for HGame VFX.
 * Built-in profiles:
 *  - `piloto_uber_fx`: 1:1 UberFXSG.shadergraph parity
 *  - `piloto_pbr_fx`: 1:1 PBR FX.shadergraph parity
 *  - `piloto_warp`: 1:1 Piloto Warp.shadergraph refraction + single-pass scene grab
 *  - `unity_standard`: Unity Built-in/URP Standard Particles fallback
 */

import { VFX_DEPTH_TESTS, applyVfxDepthState, getVfxDepthTestIndex } from './vfx-depth-state.js';
import {
  VFX_COMMON_GLSL,
  VFX_VERTEX_BUS_ATTRS_GLSL,
  VFX_VERTEX_SHELL_GLSL,
} from './vfx-shader-chunks.js';

const profileRegistry = new Map();
const compiledVariantKeys = new Set();

function makeVec2(THREE, x = 0, y = 0) {
  return THREE?.Vector2 ? new THREE.Vector2(x, y) : { x, y, set(a, b) { this.x = a; this.y = b; } };
}

function makeVec3(THREE, x = 0, y = 0, z = 0) {
  return THREE?.Vector3 ? new THREE.Vector3(x, y, z) : { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
}

function makeVec4(THREE, x = 0, y = 0, z = 0, w = 0) {
  return THREE?.Vector4 ? new THREE.Vector4(x, y, z, w) : { x, y, z, w, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; } };
}

function arr4(v, d0 = 0, d1 = 0, d2 = 0, d3 = 0) {
  if (Array.isArray(v)) {
    return [
      Number.isFinite(v[0]) ? v[0] : d0,
      Number.isFinite(v[1]) ? v[1] : d1,
      Number.isFinite(v[2]) ? v[2] : d2,
      Number.isFinite(v[3]) ? v[3] : d3,
    ];
  }
  return [d0, d1, d2, d3];
}

function arr2(v, d0 = 0, d1 = 0) {
  if (Array.isArray(v)) {
    return [
      Number.isFinite(v[0]) ? v[0] : d0,
      Number.isFinite(v[1]) ? v[1] : d1,
    ];
  }
  return [d0, d1];
}

function mapUnityBlendFactor(THREE, factor) {
  if (!THREE) return undefined;
  switch (Number(factor)) {
    case 0: return THREE.ZeroFactor;
    case 1: return THREE.OneFactor;
    case 2: return THREE.DstColorFactor;
    case 3: return THREE.SrcColorFactor;
    case 4: return THREE.OneMinusDstColorFactor;
    case 5: return THREE.SrcAlphaFactor;
    case 6: return THREE.OneMinusSrcColorFactor;
    case 7: return THREE.DstAlphaFactor;
    case 8: return THREE.OneMinusDstAlphaFactor;
    case 9: return THREE.SrcAlphaSaturateFactor;
    case 10: return THREE.OneMinusSrcAlphaFactor;
    default: return undefined;
  }
}

/**
 * Resolves Unity Surface/Blend/SrcBlend/DstBlend/Cull/ZWrite/ZTest/AlphaClip
 * into Three.js Material state.
 */
export function resolveThreeRenderState(THREE, matSpec = {}) {
  const profile = matSpec.shaderProfile || 'unity_standard';
  const isWarp = profile === 'piloto_warp' || matSpec.blend === 'distortion';
  const opaque = !isWarp && Boolean(matSpec.opaque || matSpec.surface === 0);
  const blendName = isWarp ? 'distortion' : (matSpec.blend || 'alpha');
  const srcUnity = Number(matSpec.srcBlend);
  const dstUnity = Number(matSpec.dstBlend);

  let blending = THREE?.NormalBlending;
  let blendEquation = THREE?.AddEquation;
  let blendSrc = THREE?.SrcAlphaFactor;
  let blendDst = THREE?.OneMinusSrcAlphaFactor;
  let blendSrcAlpha = THREE?.OneFactor;
  let blendDstAlpha = THREE?.OneMinusSrcAlphaFactor;
  let premulAlpha = false;

  if (opaque) {
    blending = THREE?.NoBlending;
  } else if (isWarp) {
    blending = THREE?.NormalBlending;
  } else if (blendName === 'multiply') {
    blending = THREE?.CustomBlending;
    blendSrc = THREE?.DstColorFactor;
    blendDst = THREE?.ZeroFactor;
    blendSrcAlpha = THREE?.ZeroFactor;
    blendDstAlpha = THREE?.OneFactor;
  } else if (Number.isFinite(srcUnity) && Number.isFinite(dstUnity) && THREE?.CustomBlending) {
    blending = THREE.CustomBlending;
    blendSrc = mapUnityBlendFactor(THREE, srcUnity) ?? THREE.SrcAlphaFactor;
    blendDst = mapUnityBlendFactor(THREE, dstUnity) ?? THREE.OneMinusSrcAlphaFactor;
    premulAlpha = srcUnity === 1;
    if (blendName === 'additive' || dstUnity === 1) {
      blendSrcAlpha = srcUnity === 1 ? THREE.OneFactor : THREE.SrcAlphaFactor;
      blendDstAlpha = THREE.OneFactor;
    }
  } else if (blendName === 'premultiply' && THREE?.CustomBlending) {
    blending = THREE.CustomBlending;
    blendSrc = THREE.OneFactor;
    blendDst = THREE.OneMinusSrcAlphaFactor;
    premulAlpha = true;
  } else if (blendName === 'additive') {
    blending = THREE?.AdditiveBlending;
  }

  let side = THREE?.DoubleSide;
  if (matSpec.cullMode === 'front' || matSpec.cull === 1) side = THREE?.BackSide;
  else if (matSpec.cullMode === 'back' || matSpec.cull === 2) side = THREE?.FrontSide;

  const depthTestName = typeof matSpec.depthTest === 'number'
    ? VFX_DEPTH_TESTS[matSpec.depthTest]
    : matSpec.depthTest;
  const depthTestIdx = getVfxDepthTestIndex(depthTestName);
  const depthWrite = isWarp
    ? false
    : (depthTestIdx !== 0 && (matSpec.depthWrite !== undefined ? Boolean(matSpec.depthWrite) : opaque));

  return {
    transparent: !opaque,
    opaque,
    isWarp,
    premulAlpha,
    blending,
    blendEquation,
    blendSrc,
    blendDst,
    blendSrcAlpha,
    blendDstAlpha,
    side,
    depthTestIdx,
    depthWrite,
    renderOrder: isWarp ? 3050 : (opaque ? 10 : 20),
  };
}

const SHARED_VERTEX_PREAMBLE = /* glsl */ `
precision highp float;
${VFX_VERTEX_BUS_ATTRS_GLSL}
${VFX_COMMON_GLSL}
${VFX_VERTEX_SHELL_GLSL}
`;

const PILOTO_UBER_VERTEX_SHADER = /* glsl */ `
${SHARED_VERTEX_PREAMBLE}
uniform sampler2D uDetailNoise;
uniform float uHasDetailNoise;
uniform vec4 uDetailST;
uniform vec2 uDetailPan;
uniform vec4 uDetailVertexOffsetChannel;
uniform float uUseDetailVertexOffset;

vec3 evalVertexOffset(VfxVertIn vin) {
  if (uUseDetailVertexOffset < 0.5 || uHasDetailNoise < 0.5 || abs(vin.custom2.x) < 1e-5) {
    return vin.pos;
  }
  vec2 detUv = vin.uv0 * uDetailST.xy + uDetailST.zw + uDetailPan * uTime;
  vec4 nSamp = texture2D(uDetailNoise, detUv);
  float disp = vfxChannelPickerClamped(nSamp, uDetailVertexOffsetChannel);
  return vin.pos + vin.normal * (vin.custom2.x * disp);
}

void main() {
  vfxExecuteVertexShell(position, normal, uv, uv1);
}
`;

const PILOTO_UBER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${VFX_COMMON_GLSL}

uniform sampler2D uMainTex;
uniform sampler2D uDetailNoise;
uniform sampler2D uAlphaOverride;
uniform sampler2D uSoftDepthTex;

uniform float uTime;
uniform float uHasMainTex;
uniform float uHasDetailNoise;
uniform float uHasAlphaOverride;
uniform float uHasSoftDepth;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;

uniform vec4 uMainST;
uniform vec2 uMainPan;
uniform vec4 uDetailST;
uniform vec2 uDetailPan;
uniform vec4 uAlphaOvST;
uniform vec2 uAlphaOvPan;

uniform vec4 uMainTextureChannel;
uniform vec4 uMainAlphaChannel;
uniform vec4 uAlphaOverrideChannel;
uniform vec4 uDetailDistortionChannel;
uniform vec4 uDetailMultiplyChannel;
uniform vec4 uDetailAdditiveChannel;
uniform vec4 uDetailDisolveChannel;

uniform float uDesaturate;
uniform float uDistortionIntensity;
uniform float uMultiplyNoiseDesaturation;
uniform float uSoftFadeFactor;
uniform vec2 uDissolveRange;
uniform float uAlphaClipThreshold;

uniform vec3 uWhiteColor;
uniform vec3 uMidColor;
uniform vec3 uLastColor;
uniform float uMiddlePointPos;
uniform float uMiddlePointPos1;

uniform vec3 uFresnelColor;
uniform float uFresnelPower;
uniform float uFresnelScale;
uniform float uInvertFresnel;
uniform float uTintFresnel;

uniform float uDoubleSided;
uniform float uDisableErosion;
uniform float uUseUvOffset;
uniform float uUseMultiply;
uniform float uUseAdditive;
uniform float uPremulAlpha;
uniform float uOpaque;
uniform vec4 uFlipbookGrid;

varying vec2 vUv0;
varying vec2 vUv0Blend;
varying vec2 vUv2;
varying vec4 vColor;
varying vec4 vCustom1;
varying vec4 vCustom2;
varying vec4 vMeta;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec4 vScreenPos;
varying float vEyeZ;

void main() {
  if (uDoubleSided < 0.5 && !gl_FrontFacing) discard;

  vec4 detailSamp = vec4(1.0);
  if (uHasDetailNoise > 0.5) {
    vec2 detUv = vUv0 * uDetailST.xy + uDetailST.zw + uDetailPan * uTime;
    detailSamp = texture2D(uDetailNoise, detUv);
  }

  float distort = vfxChannelPickerClamped(detailSamp, uDetailDistortionChannel) * uDistortionIntensity;
  vec2 uvOff = uUseUvOffset > 0.5 ? vCustom1.zw : vec2(0.0);
  vec2 mainUv = (vUv0 + uvOff + vec2(distort)) * uMainST.xy + uMainST.zw + uMainPan * uTime;

  vec4 mainTex = vec4(1.0);
  if (uHasMainTex > 0.5) {
    mainTex = texture2D(uMainTex, mainUv);
    if (uFlipbookGrid.z > 0.5 && vMeta.w > 0.001) {
      vec2 mainUvB = (vUv0Blend + uvOff + vec2(distort)) * uMainST.xy + uMainST.zw + uMainPan * uTime;
      mainTex = mix(mainTex, texture2D(uMainTex, mainUvB), vMeta.w);
    }
  } else {
    float r = length(vUv0 * 2.0 - 1.0);
    if (r > 1.0) discard;
    mainTex = vec4(1.0, 1.0, 1.0, exp(-3.6 * r * r));
  }

  vec3 mainCol = vfxDesaturate((mainTex * uMainTextureChannel).rgb, uDesaturate);

  vec3 baseCol;
#ifdef _USERAMP
  baseCol = vfxEvalUberRamp(
    mainCol,
    uLastColor,
    uMidColor,
    uWhiteColor,
    uMiddlePointPos,
    uMiddlePointPos1
  );
#else
  vec3 mulFactor = vec3(1.0);
  if (uUseMultiply > 0.5) {
    vec3 mulRgb = vfxChannelPicker(detailSamp, uDetailMultiplyChannel).rgb;
    mulFactor = mix(mulRgb, vec3(vfxChannelPickerAdd(detailSamp, uDetailMultiplyChannel)), clamp(uMultiplyNoiseDesaturation, 0.0, 1.0));
  }
  float addFactor = uUseAdditive > 0.5
    ? dot(detailSamp * uDetailAdditiveChannel, vec4(1.0))
    : 0.0;
  baseCol = mainCol * mulFactor + vec3(addFactor);
#endif

  vec3 litCol = baseCol * vColor.rgb * max(0.0, vCustom1.x + 1.0);

  float erosion = 1.0;
  if (uDisableErosion < 0.5) {
    float edge1 = mix(uDissolveRange.x, uDissolveRange.y, vCustom1.y - 1.0);
    float edge2 = edge1 - uDissolveRange.x;
    float dissNoise = vfxChannelPickerClamped(detailSamp, uDetailDisolveChannel);
    erosion = vfxSafeSmoothstep(edge1, edge2, dissNoise);
  }

  float alphaOv = 1.0;
#ifdef _USEALPHAOVERRIDE
  if (uHasAlphaOverride > 0.5) {
    vec2 ovUv = vUv0 * uAlphaOvST.xy + uAlphaOvST.zw + uAlphaOvPan * uTime;
    alphaOv = vfxChannelPickerAdd(texture2D(uAlphaOverride, ovUv), uAlphaOverrideChannel);
  }
#endif

  float soft = 1.0;
#ifdef _USESOFTALPHA
  if (uHasSoftDepth > 0.5 && uSoftFadeFactor > 0.0001) {
    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;
    float sceneEyeZ = vfxLinearizeDepth(sceneDepthRaw, uCamNearFar);
    soft = clamp((sceneEyeZ - vEyeZ) / max(1e-4, uSoftFadeFactor), 0.0, 1.0);
  }
#endif

  float mainA = uHasMainTex > 0.5 ? vfxChannelPickerAdd(mainTex, uMainAlphaChannel) : mainTex.a;
  float finalAlpha = clamp(erosion * soft * alphaOv * mainA * vColor.a, 0.0, 1.0);

#ifdef _ALPHATEST_ON
  if (finalAlpha < uAlphaClipThreshold) discard;
#endif

#ifdef _FRESNEL
  if (gl_FrontFacing) {
    float ndv = clamp(dot(normalize(vNormalW), normalize(vViewDirW)), 0.0, 1.0);
    float fres = pow(max(0.0, 1.0 - ndv), max(0.05, uFresnelPower));
    if (uInvertFresnel > 0.5) fres = 1.0 - fres;
    fres = clamp(fres, 0.0, 1.0) * uFresnelScale;
    vec3 fCol = uFresnelColor * (uTintFresnel > 0.5 ? vColor.rgb : vec3(1.0));
    litCol = mix(litCol, fCol, clamp(fres, 0.0, 1.0));
  }
#endif

  if (uOpaque < 0.5 && finalAlpha < 0.0005) discard;
  vec3 outRgb = (uPremulAlpha > 0.5 && uOpaque < 0.5) ? (litCol * finalAlpha) : litCol;
  gl_FragColor = vec4(outRgb, uOpaque > 0.5 ? 1.0 : finalAlpha);
}
`;

const PILOTO_PBR_VERTEX_SHADER = /* glsl */ `
${SHARED_VERTEX_PREAMBLE}
uniform sampler2D uDetailMap;
uniform float uHasDetailMap;
uniform vec4 uDetailST;
uniform vec2 uDetailPan;
uniform vec4 uDetailVertexOffsetChannel;
uniform float uUseDetailVertexOffset;

vec3 evalVertexOffset(VfxVertIn vin) {
  if (uUseDetailVertexOffset < 0.5 || uHasDetailMap < 0.5 || abs(vin.custom2.x) < 1e-5) {
    return vin.pos;
  }
  vec2 duv = vin.uv0 * uDetailST.xy + uDetailST.zw + uDetailPan * uTime;
  float disp = vfxChannelPickerClamped(texture2D(uDetailMap, duv), uDetailVertexOffsetChannel);
  return vin.pos + vin.normal * (vin.custom2.x * disp);
}

void main() {
  vfxExecuteVertexShell(position, normal, uv, uv1);
}
`;

const PILOTO_PBR_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${VFX_COMMON_GLSL}

uniform sampler2D uBaseColorMap;
uniform sampler2D uNormalMap;
uniform sampler2D uOrmMap;
uniform sampler2D uEmissionMap;
uniform sampler2D uDetailMap;
uniform sampler2D uDissolveMap;

uniform float uTime;
uniform float uHasBaseColorMap;
uniform float uHasNormalMap;
uniform float uHasOrmMap;
uniform float uHasEmissionMap;
uniform float uHasDetailMap;
uniform float uHasDissolveMap;

uniform vec4 uBaseST;
uniform vec2 uBasePan;
uniform vec4 uNormalST;
uniform vec2 uNormalPan;
uniform vec4 uOrmST;
uniform vec2 uOrmPan;
uniform vec4 uEmissionST;
uniform vec2 uEmissionPan;
uniform vec4 uDetailST;
uniform vec2 uDetailPan;
uniform vec4 uDissolveST;

uniform vec4 uBaseColorTint;
uniform vec3 uEmissiveTint;
uniform float uIntensity;
uniform float uSelfIllumination;
uniform float uNormalScale;
uniform float uUseBaseAsNormal;
uniform float uBaseNormalStrength;
uniform float uOcclusionScale;
uniform float uSmoothnessScale;
uniform float uMetallicScale;

uniform vec4 uDetailDistortionChannel;
uniform vec4 uDetailDissolveChannel;
uniform float uDistortionBaseIntensity;
uniform float uDistortionNormalIntensity;
uniform float uDistortionDissolveIntensity;
uniform vec2 uDissolveFadeRange;
uniform float uDissolveAmount;
uniform float uAlphaClipping;
uniform float uDisableErosion;
uniform float uUseUvOffset;
uniform float uDoubleSided;
uniform float uOpaque;
uniform float uPremulAlpha;

uniform vec3 uFresnelColor;
uniform float uFresnelPower;
uniform float uFresnelIntensity;
uniform float uInvertFresnel;
uniform float uTintFresnel;
uniform vec3 uLightDirW;

varying vec2 vUv0;
varying vec2 vUv0Blend;
varying vec2 vUv2;
varying vec4 vColor;
varying vec4 vCustom1;
varying vec4 vCustom2;
varying vec4 vMeta;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec4 vScreenPos;
varying float vEyeZ;

void main() {
  if (uDoubleSided < 0.5 && !gl_FrontFacing) discard;

  vec4 detSamp = vec4(1.0);
  if (uHasDetailMap > 0.5) {
    vec2 duv = vUv0 * uDetailST.xy + uDetailST.zw + uDetailPan * uTime;
    detSamp = texture2D(uDetailMap, duv);
  }
  float distVal = vfxChannelPickerClamped(detSamp, uDetailDistortionChannel);
  vec2 uvOff = uUseUvOffset > 0.5 ? vCustom1.zw : vec2(0.0);

  vec2 baseUv = (vUv0 + uvOff + vec2(distVal * uDistortionBaseIntensity)) * uBaseST.xy + uBaseST.zw + uBasePan * uTime;
  vec4 albedoSamp = uHasBaseColorMap > 0.5 ? texture2D(uBaseColorMap, baseUv) : vec4(1.0);
  vec3 albedo = albedoSamp.rgb * uBaseColorTint.rgb * vColor.rgb;
  float alpha = albedoSamp.a * uBaseColorTint.a * vColor.a;

  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  if (uHasNormalMap > 0.5) {
    vec2 nUv = (vUv0 + vec2(distVal * uDistortionNormalIntensity)) * uNormalST.xy + uNormalST.zw + uNormalPan * uTime;
    vec3 nm = texture2D(uNormalMap, nUv).xyz * 2.0 - 1.0;
    N = normalize(T * (nm.x * uNormalScale) + B * (nm.y * uNormalScale) + N * max(0.05, nm.z));
  } else if (uUseBaseAsNormal > 0.5 && uHasBaseColorMap > 0.5) {
    vec2 eps = vec2(0.004, 0.0);
    float hL = texture2D(uBaseColorMap, baseUv - eps.xy).r;
    float hR = texture2D(uBaseColorMap, baseUv + eps.xy).r;
    float hD = texture2D(uBaseColorMap, baseUv - eps.yx).r;
    float hU = texture2D(uBaseColorMap, baseUv + eps.yx).r;
    N = normalize(N + (T * (hL - hR) + B * (hD - hU)) * uBaseNormalStrength * 2.0);
  }

  float ao = 1.0;
  float roughness = clamp(1.0 - uSmoothnessScale, 0.05, 1.0);
  float metallic = clamp(uMetallicScale, 0.0, 1.0);
  if (uHasOrmMap > 0.5) {
    vec2 ormUv = vUv0 * uOrmST.xy + uOrmST.zw + uOrmPan * uTime;
    vec4 orm = texture2D(uOrmMap, ormUv);
    ao = mix(1.0, orm.r, clamp(uOcclusionScale, 0.0, 1.0));
    roughness = clamp(1.0 - clamp(1.0 - orm.g, 0.0, 1.0) * uSmoothnessScale, 0.06, 1.0);
    metallic = clamp(orm.b * uMetallicScale, 0.0, 1.0);
  }

  vec3 L = normalize(uLightDirW);
  vec3 V = normalize(vViewDirW);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 diffCol = albedo * (1.0 - metallic * 0.85);
  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  float shininess = mix(96.0, 6.0, roughness * roughness);
  vec3 specCol = F0 * pow(ndh, shininess) * mix(1.6, 0.25, roughness);
  vec3 litCol = (diffCol * (0.30 + 0.42 * hemi + 0.85 * ndl) + specCol * (0.35 + ndl)) * ao;

  float hdrMul = max(0.0, vCustom1.x + 1.0);
  vec3 emission = albedo * uSelfIllumination;
  if (uHasEmissionMap > 0.5) {
    vec2 eUv = vUv0 * uEmissionST.xy + uEmissionST.zw + uEmissionPan * uTime;
    emission += texture2D(uEmissionMap, eUv).rgb * uEmissiveTint * uIntensity;
  } else {
    emission += uEmissiveTint * uIntensity;
  }
  litCol = litCol * hdrMul + emission * hdrMul;

#ifdef _FRESNEL
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(max(0.0, 1.0 - ndv), max(0.05, uFresnelPower));
  if (uInvertFresnel > 0.5) fres = 1.0 - fres;
  fres = clamp(fres, 0.0, 1.0) * uFresnelIntensity;
  vec3 fCol = uFresnelColor * (uTintFresnel > 0.5 ? vColor.rgb : vec3(1.0));
  litCol += fCol * fres * hdrMul;
#endif

  float erosion = 1.0;
  if (uDisableErosion < 0.5) {
#ifdef _ISPARTICLE
    float dissAmt = vCustom1.y - 1.0;
#else
    float dissAmt = uDissolveAmount;
#endif
    float edge1 = mix(uDissolveFadeRange.x, uDissolveFadeRange.y, dissAmt);
    float edge2 = edge1 - uDissolveFadeRange.x;
    float dissVal = uHasDissolveMap > 0.5
      ? vfxChannelPickerClamped(texture2D(uDissolveMap, (vUv0 + vec2(distVal * uDistortionDissolveIntensity)) * uDissolveST.xy + uDissolveST.zw), uDetailDissolveChannel)
      : vfxChannelPickerClamped(detSamp, uDetailDissolveChannel);
    erosion = vfxSafeSmoothstep(edge1, edge2, dissVal);
  }

  float finalAlpha = clamp(alpha * erosion, 0.0, 1.0);
#ifdef _ALPHATEST_ON
  if (finalAlpha < uAlphaClipping) discard;
#endif
  if (uOpaque < 0.5 && finalAlpha < 0.0005) discard;
  vec3 outRgb = (uPremulAlpha > 0.5 && uOpaque < 0.5) ? (litCol * finalAlpha) : litCol;
  gl_FragColor = vec4(outRgb, uOpaque > 0.5 ? 1.0 : finalAlpha);
}
`;

const PILOTO_WARP_VERTEX_SHADER = /* glsl */ `
${SHARED_VERTEX_PREAMBLE}
vec3 evalVertexOffset(VfxVertIn vin) {
  return vin.pos;
}
void main() {
  vfxExecuteVertexShell(position, normal, uv, uv1);
}
`;

const PILOTO_WARP_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${VFX_COMMON_GLSL}

uniform sampler2D uDistortionTex;
uniform sampler2D uAlphaTex;
uniform sampler2D uSceneColor;
uniform sampler2D uSoftDepthTex;

uniform float uTime;
uniform float uHasDistortionTex;
uniform float uHasAlphaTex;
uniform float uHasSceneColor;
uniform float uHasSoftDepth;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;

uniform vec4 uDistortionST;
uniform vec2 uDistortionPan;
uniform vec4 uAlphaST;
uniform vec2 uAlphaPan;
uniform vec4 uAlphaChannelPicker;
uniform float uDistortionStrength;
uniform float uPolarCoordinates;
uniform float uUnpackNormals;
uniform float uSoftFadeFactor;

varying vec2 vUv0;
varying vec2 vUv0Blend;
varying vec2 vUv2;
varying vec4 vColor;
varying vec4 vCustom1;
varying vec4 vCustom2;
varying vec4 vMeta;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec4 vScreenPos;
varying float vEyeZ;

void main() {
  if (uHasSceneColor < 0.5) discard;

  vec2 baseCoord = uPolarCoordinates > 0.5 ? vfxPolarCoords(vUv0, vec2(0.5)) : vUv0;

  vec2 alphaUv = baseCoord * uAlphaST.xy + uAlphaST.zw + uAlphaPan * uTime;
  float maskA = 1.0;
  if (uHasAlphaTex > 0.5) {
    maskA = vfxChannelPickerAdd(texture2D(uAlphaTex, alphaUv), uAlphaChannelPicker);
  } else {
    float r = length(vUv0 * 2.0 - 1.0);
    maskA = smoothstep(1.0, 0.15, r);
  }

  float softFade = 1.0;
#ifdef _USE_SOFT_ALPHA
  if (uHasSoftDepth > 0.5 && uSoftFadeFactor > 0.0001) {
    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;
    float sceneEyeZ = vfxLinearizeDepth(sceneDepthRaw, uCamNearFar);
    softFade = clamp((sceneEyeZ - vEyeZ) / max(1e-4, uSoftFadeFactor), 0.0, 1.0);
  }
#endif

  float alpha = clamp(maskA * clamp(vColor.a, 0.0, 1.0) * softFade, 0.0, 1.0);
  if (alpha < 0.01) discard;

  vec2 distUv = baseCoord * uDistortionST.xy + uDistortionST.zw + uDistortionPan * uTime;
  vec2 nOffset = vec2(0.0);
  if (uHasDistortionTex > 0.5) {
    vec4 nSamp = texture2D(uDistortionTex, distUv);
    nOffset = uUnpackNormals > 0.5 ? (nSamp.xy * 2.0 - 1.0) : (nSamp.xy - vec2(0.5));
  } else {
    nOffset = (vUv0 - vec2(0.5)) * maskA;
  }

  float S = uDistortionStrength * clamp(vColor.a, 0.0, 1.0) * softFade;
  vec2 screenUv = gl_FragCoord.xy * uInvViewport;
  vec2 refrUv = clamp(screenUv + nOffset * S * maskA, vec2(0.002), vec2(0.998));
  vec3 sceneCol = texture2D(uSceneColor, refrUv).rgb;
  gl_FragColor = vec4(sceneCol, alpha);
}
`;

const UNITY_STANDARD_VERTEX_SHADER = /* glsl */ `
${SHARED_VERTEX_PREAMBLE}
vec3 evalVertexOffset(VfxVertIn vin) {
  return vin.pos;
}
void main() {
  vfxExecuteVertexShell(position, normal, uv, uv1);
}
`;

const UNITY_STANDARD_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${VFX_COMMON_GLSL}

uniform sampler2D uMainTex;
uniform sampler2D uSoftDepthTex;
uniform float uTime;
uniform float uHasMainTex;
uniform float uHasSoftDepth;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;
uniform vec4 uMainST;
uniform vec2 uMainPan;
uniform vec4 uTintColor;
uniform vec3 uEmissionColor;
uniform float uHdr;
uniform float uSoftFadeFactor;
uniform float uAlphaClipThreshold;
uniform float uIsMultiply;
uniform float uPremulAlpha;
uniform float uOpaque;
uniform float uDoubleSided;
uniform vec4 uFlipbookGrid;

varying vec2 vUv0;
varying vec2 vUv0Blend;
varying vec2 vUv2;
varying vec4 vColor;
varying vec4 vCustom1;
varying vec4 vCustom2;
varying vec4 vMeta;
varying vec3 vNormalW;
varying vec3 vViewDirW;
varying vec4 vScreenPos;
varying float vEyeZ;

void main() {
  if (uDoubleSided < 0.5 && !gl_FrontFacing) discard;

  vec2 mainUv = vUv0 * uMainST.xy + uMainST.zw + uMainPan * uTime;
  vec4 texCol = vec4(1.0);
  if (uHasMainTex > 0.5) {
    texCol = texture2D(uMainTex, mainUv);
    if (uFlipbookGrid.z > 0.5 && vMeta.w > 0.001) {
      vec2 mainUvB = vUv0Blend * uMainST.xy + uMainST.zw + uMainPan * uTime;
      texCol = mix(texCol, texture2D(uMainTex, mainUvB), vMeta.w);
    }
  } else {
    float r = length(vUv0 * 2.0 - 1.0);
    if (r > 1.0) discard;
    texCol.a = exp(-3.6 * r * r);
  }

  float soft = 1.0;
  if (uHasSoftDepth > 0.5 && uSoftFadeFactor > 0.0001) {
    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;
    float sceneEyeZ = vfxLinearizeDepth(sceneDepthRaw, uCamNearFar);
    soft = clamp((sceneEyeZ - vEyeZ) / max(1e-4, uSoftFadeFactor), 0.0, 1.0);
  }

  float alpha = clamp(texCol.a * uTintColor.a * vColor.a * soft, 0.0, 1.0);
#ifdef _ALPHATEST_ON
  if (alpha < uAlphaClipThreshold) discard;
#endif
  if (uOpaque < 0.5 && alpha < 0.0005) discard;

  vec3 rgb = texCol.rgb * uTintColor.rgb * vColor.rgb * max(0.0, uHdr) * max(0.0, vCustom1.x + 1.0) + texCol.rgb * uEmissionColor;
  if (uIsMultiply > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), rgb, alpha), 1.0);
    return;
  }
  vec3 outRgb = (uPremulAlpha > 0.5 && uOpaque < 0.5) ? (rgb * alpha) : rgb;
  gl_FragColor = vec4(outRgb, uOpaque > 0.5 ? 1.0 : alpha);
}
`;

/**
 * Registers a shader profile into the global registry.
 */
export function registerShaderProfile(name, profileDef) {
  if (!name || typeof profileDef !== 'object') return;
  profileRegistry.set(String(name), profileDef);
}

/**
 * Retrieves a registered shader profile definition.
 */
export function getShaderProfile(name) {
  return profileRegistry.get(String(name || 'unity_standard')) || profileRegistry.get('unity_standard') || null;
}

/**
 * Lists all registered shader profile names.
 */
export function listShaderProfiles() {
  return [...profileRegistry.keys()];
}

/**
 * Returns total unique compiled `(profile, defines)` shader variant count tracked this session.
 */
export function getCompiledShaderVariantCount() {
  return compiledVariantKeys.size;
}

export function resetCompiledShaderVariantTracker() {
  compiledVariantKeys.clear();
}

function buildUberDefines(matSpec, renderState) {
  const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
  const defines = {};
  if (matSpec.useAlphaOverride || kw.has('_USEALPHAOVERRIDE')) defines._USEALPHAOVERRIDE = 1;
  if (matSpec.useSoftAlpha || matSpec.softParticles || kw.has('_USESOFTALPHA') || kw.has('_USE_SOFT_ALPHA')) defines._USESOFTALPHA = 1;
  if (matSpec.useRamp || kw.has('_USERAMP')) defines._USERAMP = 1;
  if (matSpec.useFresnel || kw.has('_FRESNEL')) defines._FRESNEL = 1;
  if (matSpec.alphaClip || matSpec.alphaTest || kw.has('_ALPHATEST_ON')) defines._ALPHATEST_ON = 1;
  if (renderState?.opaque) defines._OPAQUE = 1;
  return defines;
}

// Register 4 built-in profiles
registerShaderProfile('piloto_uber_fx', {
  name: 'piloto_uber_fx',
  vertexShader: PILOTO_UBER_VERTEX_SHADER,
  fragmentShader: PILOTO_UBER_FRAGMENT_SHADER,
  getDefines: buildUberDefines,
  createUniforms(THREE, matSpec, textures, shared, renderState) {
    const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
    const detMul = arr4(matSpec.detailMultiplyChannel, 0, 0, 0, 0);
    const detAdd = arr4(matSpec.detailAdditiveChannel, 0, 0, 0, 0);
    const detVtx = arr4(matSpec.detailVertexOffsetChannel, 0, 0, 0, 0);
    const mainTex = textures?.main || null;
    const detTex = textures?.detail || null;
    const ovTex = textures?.alphaOverride || null;
    return {
      uTime: shared.uTime,
      uRenderMode: { value: shared.renderModeId ?? 0 },
      uFlipbookGrid: { value: makeVec4(THREE, shared.cols ?? 1, shared.rows ?? 1, shared.flipbookBlend ? 1 : 0, 0) },
      uPivot2D: { value: makeVec2(THREE, shared.pivot?.[0] ?? 0, shared.pivot?.[1] ?? 0) },
      uHasUv2: { value: shared.hasUv2 ? 1.0 : 0.0 },
      uMainTex: { value: mainTex },
      uDetailNoise: { value: detTex },
      uAlphaOverride: { value: ovTex },
      uSoftDepthTex: shared.uSoftDepthTex,
      uHasMainTex: { value: mainTex ? 1.0 : 0.0 },
      uHasDetailNoise: { value: detTex ? 1.0 : 0.0 },
      uHasAlphaOverride: { value: ovTex ? 1.0 : 0.0 },
      uHasSoftDepth: shared.uHasSoftDepth,
      uInvViewport: shared.uInvViewport,
      uCamNearFar: shared.uCamNearFar,
      uMainST: { value: makeVec4(THREE, ...arr4(matSpec.mainTexST, 1, 1, 0, 0)) },
      uMainPan: { value: makeVec2(THREE, ...arr2(matSpec.mainTexPanning, 0, 0)) },
      uDetailST: { value: makeVec4(THREE, ...arr4(matSpec.detailNoiseST, 1, 1, 0, 0)) },
      uDetailPan: { value: makeVec2(THREE, ...arr2(matSpec.detailNoisePanning, 0, 0)) },
      uAlphaOvST: { value: makeVec4(THREE, ...arr4(matSpec.alphaOverrideST, 1, 1, 0, 0)) },
      uAlphaOvPan: { value: makeVec2(THREE, ...arr2(matSpec.alphaOverridePanning, 0, 0)) },
      uMainTextureChannel: { value: makeVec4(THREE, ...arr4(matSpec.mainTextureChannel, 1, 1, 1, 0)) },
      uMainAlphaChannel: { value: makeVec4(THREE, ...arr4(matSpec.mainAlphaChannel, 0, 0, 0, 1)) },
      uAlphaOverrideChannel: { value: makeVec4(THREE, ...arr4(matSpec.alphaOverrideChannel, 1, 0, 0, 0)) },
      uDetailDistortionChannel: { value: makeVec4(THREE, ...arr4(matSpec.detailDistortionChannel, 0, 0, 0, 0)) },
      uDetailMultiplyChannel: { value: makeVec4(THREE, ...detMul) },
      uDetailAdditiveChannel: { value: makeVec4(THREE, ...detAdd) },
      uDetailDisolveChannel: { value: makeVec4(THREE, ...arr4(matSpec.detailDissolveChannel, 1, 0, 0, 0)) },
      uDetailVertexOffsetChannel: { value: makeVec4(THREE, ...detVtx) },
      uUseDetailVertexOffset: { value: (detVtx[0] + detVtx[1] + detVtx[2] + detVtx[3] > 0.0001) ? 1.0 : 0.0 },
      uDesaturate: { value: Number(matSpec.desaturate ?? 0) },
      uDistortionIntensity: { value: Number(matSpec.distortionIntensity ?? 0) },
      uMultiplyNoiseDesaturation: { value: Number(matSpec.multiplyNoiseDesaturation ?? 0) },
      uSoftFadeFactor: { value: Number(matSpec.softFadeFactor ?? 0.1) },
      uDissolveRange: { value: makeVec2(THREE, ...arr2(matSpec.dissolveFadeRange, -0.25, 1.0)) },
      uAlphaClipThreshold: { value: Number(matSpec.alphaClipThreshold ?? matSpec.cutoff ?? 0.5) },
      uWhiteColor: { value: makeVec3(THREE, ...arr4(matSpec.whiteColor, 1, 1, 1, 1).slice(0, 3)) },
      uMidColor: { value: makeVec3(THREE, ...arr4(matSpec.midColor, 0.5, 0.5, 0.5, 1).slice(0, 3)) },
      uLastColor: { value: makeVec3(THREE, ...arr4(matSpec.lastColor, 0, 0, 0, 1).slice(0, 3)) },
      uMiddlePointPos: { value: Number(matSpec.middlePointPos ?? 0.5) },
      uMiddlePointPos1: { value: Number(matSpec.middlePointPos1 ?? 0.5) },
      uFresnelColor: { value: makeVec3(THREE, ...arr4(matSpec.fresnelColor, 1, 1, 1, 1).slice(0, 3)) },
      uFresnelPower: { value: Number(matSpec.fresnelPower ?? 1.0) },
      uFresnelScale: { value: Number(matSpec.fresnelScale ?? 1.0) },
      uInvertFresnel: { value: matSpec.invertFresnel ? 1.0 : 0.0 },
      uTintFresnel: { value: matSpec.tintFresnel ? 1.0 : 0.0 },
      uDoubleSided: { value: renderState.side === THREE?.DoubleSide ? 1.0 : 0.0 },
      uDisableErosion: { value: (matSpec.disableErosion || kw.has('_DISABLEEROSION')) ? 1.0 : 0.0 },
      uUseUvOffset: { value: (matSpec.useUvOffset || kw.has('_USEUVOFFSET')) ? 1.0 : 0.0 },
      uUseMultiply: { value: (detMul[0] + detMul[1] + detMul[2] + detMul[3] > 0.0001) ? 1.0 : 0.0 },
      uUseAdditive: { value: (detAdd[0] + detAdd[1] + detAdd[2] + detAdd[3] > 0.0001) ? 1.0 : 0.0 },
      uPremulAlpha: { value: renderState.premulAlpha ? 1.0 : 0.0 },
      uOpaque: { value: renderState.opaque ? 1.0 : 0.0 },
    };
  },
});

registerShaderProfile('piloto_pbr_fx', {
  name: 'piloto_pbr_fx',
  vertexShader: PILOTO_PBR_VERTEX_SHADER,
  fragmentShader: PILOTO_PBR_FRAGMENT_SHADER,
  getDefines(matSpec) {
    const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
    const defines = {};
    if (matSpec.isParticle || kw.has('_ISPARTICLE')) defines._ISPARTICLE = 1;
    if (matSpec.useFresnel || kw.has('_FRESNEL')) defines._FRESNEL = 1;
    if (matSpec.alphaClip || matSpec.alphaTest || kw.has('_ALPHATEST_ON')) defines._ALPHATEST_ON = 1;
    return defines;
  },
  createUniforms(THREE, matSpec, textures, shared, renderState) {
    const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
    const detVtx = arr4(matSpec.detailVertexOffsetChannel, 0, 0, 0, 0);
    const baseTex = textures?.baseColor || textures?.main || null;
    const normTex = textures?.normal || null;
    const ormTex = textures?.orm || null;
    const emTex = textures?.emission || null;
    const detTex = textures?.detail || null;
    const dissTex = textures?.dissolve || null;
    return {
      uTime: shared.uTime,
      uRenderMode: { value: shared.renderModeId ?? 3 },
      uFlipbookGrid: { value: makeVec4(THREE, shared.cols ?? 1, shared.rows ?? 1, shared.flipbookBlend ? 1 : 0, 0) },
      uPivot2D: { value: makeVec2(THREE, shared.pivot?.[0] ?? 0, shared.pivot?.[1] ?? 0) },
      uHasUv2: { value: shared.hasUv2 ? 1.0 : 0.0 },
      uBaseColorMap: { value: baseTex },
      uNormalMap: { value: normTex },
      uOrmMap: { value: ormTex },
      uEmissionMap: { value: emTex },
      uDetailMap: { value: detTex },
      uDissolveMap: { value: dissTex },
      uHasBaseColorMap: { value: baseTex ? 1.0 : 0.0 },
      uHasNormalMap: { value: normTex ? 1.0 : 0.0 },
      uHasOrmMap: { value: ormTex ? 1.0 : 0.0 },
      uHasEmissionMap: { value: emTex ? 1.0 : 0.0 },
      uHasDetailMap: { value: detTex ? 1.0 : 0.0 },
      uHasDissolveMap: { value: dissTex ? 1.0 : 0.0 },
      uBaseST: { value: makeVec4(THREE, ...arr4(matSpec.baseColorMapST || matSpec.mainTexST, 1, 1, 0, 0)) },
      uBasePan: { value: makeVec2(THREE, ...arr2(matSpec.baseColorMapPanning || matSpec.mainTexPanning, 0, 0)) },
      uNormalST: { value: makeVec4(THREE, ...arr4(matSpec.normalMapST, 1, 1, 0, 0)) },
      uNormalPan: { value: makeVec2(THREE, ...arr2(matSpec.normalPanning, 0, 0)) },
      uOrmST: { value: makeVec4(THREE, ...arr4(matSpec.ormMapST, 1, 1, 0, 0)) },
      uOrmPan: { value: makeVec2(THREE, ...arr2(matSpec.pbrMaskPanning, 0, 0)) },
      uEmissionST: { value: makeVec4(THREE, ...arr4(matSpec.emissionMapST, 1, 1, 0, 0)) },
      uEmissionPan: { value: makeVec2(THREE, ...arr2(matSpec.emissionPanning, 0, 0)) },
      uDetailST: { value: makeVec4(THREE, ...arr4(matSpec.detailMapST || matSpec.detailNoiseST, 1, 1, 0, 0)) },
      uDetailPan: { value: makeVec2(THREE, ...arr2(matSpec.detailMapPanning || matSpec.detailNoisePanning, 0, 0)) },
      uDissolveST: { value: makeVec4(THREE, ...arr4(matSpec.dissolveMapST, 1, 1, 0, 0)) },
      uBaseColorTint: { value: makeVec4(THREE, ...arr4(matSpec.baseColorTint, 1, 1, 1, 1)) },
      uEmissiveTint: { value: makeVec3(THREE, ...arr4(matSpec.emissiveTint, 0, 0, 0, 1).slice(0, 3)) },
      uIntensity: { value: Number(matSpec.intensity ?? 0) },
      uSelfIllumination: { value: Number(matSpec.selfIlluminationIntensity ?? 0) },
      uNormalScale: { value: Number(matSpec.normalScale ?? 1.0) },
      uUseBaseAsNormal: { value: matSpec.useBaseAsNormal ? 1.0 : 0.0 },
      uBaseNormalStrength: { value: Number(matSpec.baseNormalStrength ?? 0.1) },
      uOcclusionScale: { value: Number(matSpec.occlusionScale ?? 1.0) },
      uSmoothnessScale: { value: Number(matSpec.smoothnessScale ?? 1.0) },
      uMetallicScale: { value: Number(matSpec.metallicScale ?? 1.0) },
      uDetailDistortionChannel: { value: makeVec4(THREE, ...arr4(matSpec.detailDistortionChannel, 0.5, 0, 0, 0)) },
      uDetailDissolveChannel: { value: makeVec4(THREE, ...arr4(matSpec.detailDissolveChannel, 1, 0, 0, 0)) },
      uDetailVertexOffsetChannel: { value: makeVec4(THREE, ...detVtx) },
      uUseDetailVertexOffset: { value: (detVtx[0] + detVtx[1] + detVtx[2] + detVtx[3] > 0.0001) ? 1.0 : 0.0 },
      uDistortionBaseIntensity: { value: Number(matSpec.distortionBaseIntensity ?? 0) },
      uDistortionNormalIntensity: { value: Number(matSpec.distortionNormalIntensity ?? 0) },
      uDistortionDissolveIntensity: { value: Number(matSpec.distortionDissolveIntensity ?? 0) },
      uDissolveFadeRange: { value: makeVec2(THREE, ...arr2(matSpec.dissolveFadeRange, 0.1, 1.1)) },
      uDissolveAmount: { value: Number(matSpec.dissolveAmount ?? 0) },
      uAlphaClipping: { value: Number(matSpec.alphaClipThreshold ?? matSpec.cutoff ?? 0.5) },
      uDisableErosion: { value: (matSpec.disableErosion || kw.has('_DISABLEEROSION')) ? 1.0 : 0.0 },
      uUseUvOffset: { value: (matSpec.useUvOffset || kw.has('_USEUVOFFSET')) ? 1.0 : 0.0 },
      uDoubleSided: { value: renderState.side === THREE?.DoubleSide ? 1.0 : 0.0 },
      uOpaque: { value: renderState.opaque ? 1.0 : 0.0 },
      uPremulAlpha: { value: renderState.premulAlpha ? 1.0 : 0.0 },
      uFresnelColor: { value: makeVec3(THREE, ...arr4(matSpec.fresnelColor, 0, 0, 0, 1).slice(0, 3)) },
      uFresnelPower: { value: Number(matSpec.fresnelPower ?? 5.0) },
      uFresnelIntensity: { value: Number(matSpec.fresnelIntensity ?? 2.0) },
      uInvertFresnel: { value: matSpec.invertFresnel ? 1.0 : 0.0 },
      uTintFresnel: { value: matSpec.tintFresnel ? 1.0 : 0.0 },
      uLightDirW: { value: makeVec3(THREE, 0.45, 0.85, 0.45) },
    };
  },
});

registerShaderProfile('piloto_warp', {
  name: 'piloto_warp',
  vertexShader: PILOTO_WARP_VERTEX_SHADER,
  fragmentShader: PILOTO_WARP_FRAGMENT_SHADER,
  getDefines(matSpec) {
    const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
    return (matSpec.useSoftAlpha || matSpec.softParticles || kw.has('_USE_SOFT_ALPHA'))
      ? { _USE_SOFT_ALPHA: 1 }
      : {};
  },
  createUniforms(THREE, matSpec, textures, shared) {
    const distTex = textures?.distortion || textures?.main || null;
    const alphaTex = textures?.alpha || textures?.alphaOverride || textures?.detail || null;
    return {
      uTime: shared.uTime,
      uRenderMode: { value: shared.renderModeId ?? 0 },
      uFlipbookGrid: { value: makeVec4(THREE, shared.cols ?? 1, shared.rows ?? 1, shared.flipbookBlend ? 1 : 0, 0) },
      uPivot2D: { value: makeVec2(THREE, shared.pivot?.[0] ?? 0, shared.pivot?.[1] ?? 0) },
      uHasUv2: { value: shared.hasUv2 ? 1.0 : 0.0 },
      uDistortionTex: { value: distTex },
      uAlphaTex: { value: alphaTex },
      uSceneColor: shared.uSceneColor,
      uSoftDepthTex: shared.uSoftDepthTex,
      uHasDistortionTex: { value: distTex ? 1.0 : 0.0 },
      uHasAlphaTex: { value: alphaTex ? 1.0 : 0.0 },
      uHasSceneColor: shared.uHasSceneColor,
      uHasSoftDepth: shared.uHasSoftDepth,
      uInvViewport: shared.uInvViewport,
      uCamNearFar: shared.uCamNearFar,
      uDistortionST: { value: makeVec4(THREE, ...arr4(matSpec.distortionTextureST || matSpec.mainTexST, 1, 1, 0, 0)) },
      uDistortionPan: { value: makeVec2(THREE, ...arr2(matSpec.distortionPanning, 0, 0)) },
      uAlphaST: { value: makeVec4(THREE, ...arr4(matSpec.alphaTextureST, 1, 1, 0, 0)) },
      uAlphaPan: { value: makeVec2(THREE, ...arr2(matSpec.alphaPanning, 0, 0)) },
      uAlphaChannelPicker: { value: makeVec4(THREE, ...arr4(matSpec.alphaChannelPicker, 0, 0, 0, 1)) },
      uDistortionStrength: { value: Number(matSpec.distortionStrength ?? 0.25) },
      uPolarCoordinates: { value: matSpec.polarCoordinates ? 1.0 : 0.0 },
      uUnpackNormals: { value: matSpec.unpackNormals !== false ? 1.0 : 0.0 },
      uSoftFadeFactor: { value: Number(matSpec.softFadeFactor ?? 0.1) },
    };
  },
});

registerShaderProfile('unity_standard', {
  name: 'unity_standard',
  vertexShader: UNITY_STANDARD_VERTEX_SHADER,
  fragmentShader: UNITY_STANDARD_FRAGMENT_SHADER,
  getDefines(matSpec) {
    const kw = new Set(Array.isArray(matSpec.keywords) ? matSpec.keywords : []);
    return (matSpec.alphaClip || matSpec.alphaTest || kw.has('_ALPHATEST_ON')) ? { _ALPHATEST_ON: 1 } : {};
  },
  createUniforms(THREE, matSpec, textures, shared, renderState) {
    const mainTex = textures?.main || null;
    return {
      uTime: shared.uTime,
      uRenderMode: { value: shared.renderModeId ?? 0 },
      uFlipbookGrid: { value: makeVec4(THREE, shared.cols ?? 1, shared.rows ?? 1, shared.flipbookBlend ? 1 : 0, 0) },
      uPivot2D: { value: makeVec2(THREE, shared.pivot?.[0] ?? 0, shared.pivot?.[1] ?? 0) },
      uHasUv2: { value: shared.hasUv2 ? 1.0 : 0.0 },
      uMainTex: { value: mainTex },
      uSoftDepthTex: shared.uSoftDepthTex,
      uHasMainTex: { value: mainTex ? 1.0 : 0.0 },
      uHasSoftDepth: shared.uHasSoftDepth,
      uInvViewport: shared.uInvViewport,
      uCamNearFar: shared.uCamNearFar,
      uMainST: { value: makeVec4(THREE, ...arr4(matSpec.mainTexST, 1, 1, 0, 0)) },
      uMainPan: { value: makeVec2(THREE, ...arr2(matSpec.mainTexPanning, 0, 0)) },
      uTintColor: { value: makeVec4(THREE, ...arr4(matSpec.tintColor, 1, 1, 1, 1)) },
      uEmissionColor: { value: makeVec3(THREE, ...arr4(matSpec.emission, 0, 0, 0, 1).slice(0, 3)) },
      uHdr: { value: Number(matSpec.hdr ?? 1.0) },
      uSoftFadeFactor: { value: Number(matSpec.softFadeFactor ?? 0.1) },
      uAlphaClipThreshold: { value: Number(matSpec.alphaClipThreshold ?? matSpec.cutoff ?? 0.5) },
      uIsMultiply: { value: matSpec.blend === 'multiply' ? 1.0 : 0.0 },
      uPremulAlpha: { value: renderState.premulAlpha ? 1.0 : 0.0 },
      uOpaque: { value: renderState.opaque ? 1.0 : 0.0 },
      uDoubleSided: { value: renderState.side === THREE?.DoubleSide ? 1.0 : 0.0 },
    };
  },
});

/**
 * Compiles/instantiates a Three.js `ShaderMaterial` for the requested Shader Profile + MaterialSpec.
 */
export function createProfileMaterial(THREE, matSpec = {}, textures = {}, shared = {}) {
  const profileName = matSpec.shaderProfile || 'unity_standard';
  const profile = getShaderProfile(profileName);
  const renderState = resolveThreeRenderState(THREE, matSpec);
  const defines = profile.getDefines ? profile.getDefines(matSpec, renderState) : {};
  const variantKey = `${profile.name}:${Object.keys(defines).sort().join(',')}`;
  compiledVariantKeys.add(variantKey);

  const uniforms = profile.createUniforms(THREE, matSpec, textures, shared, renderState);
  const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
  const matOpts = {
    vertexShader: profile.vertexShader,
    fragmentShader: profile.fragmentShader,
    uniforms,
    defines,
    transparent: renderState.transparent,
    side: renderState.side,
    blending: renderState.blending,
  };
  if (renderState.blending === THREE.CustomBlending) {
    matOpts.blendEquation = renderState.blendEquation;
    matOpts.blendSrc = renderState.blendSrc;
    matOpts.blendDst = renderState.blendDst;
    matOpts.blendSrcAlpha = renderState.blendSrcAlpha;
    matOpts.blendDstAlpha = renderState.blendDstAlpha;
  }
  const mat = new MatCtor(matOpts);
  applyVfxDepthState(mat, THREE, renderState.depthTestIdx, renderState.depthWrite);
  mat.userData.vfxProfileVariant = variantKey;
  mat.userData.vfxRenderOrder = renderState.renderOrder;
  mat.userData.isWarp = renderState.isWarp;
  return { material: mat, renderState, variantKey };
}

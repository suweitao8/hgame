/**
 * Clean-room WebGL2 HDR post-processing pipeline driven by QUALITY3D_PRESETS:
 *   - Multisampled HalfFloat HDR scene target + DepthTexture
 *   - Edge-aware half-resolution depth-reconstructed SSAO + volumetric sun shafts
 *   - Half-resolution HDR Screen-Space Global Illumination (SSGI) + Screen-Space
 *     Reflections (SSR) with depth-guided bilateral denoising
 *   - Optional GPU-only Eye Adaptation / Auto-Exposure pyramid
 *   - Multi-mip Karis-average Bloom pyramid
 *   - Full-res screen-space contact shadows, chromatic aberration, white balance,
 *     ASC-CDL color grading, UE-style parametric Filmic / ACES / AgX tone mapping,
 *     film grain, FXAA + edge-attenuated unsharp mask + IGN dither
 *   - Spatial priority-blended PostProcessVolumeStack
 *   - Optional secondary viewmodel camera pass + safe context/fallback handling
 *
 * The Three.js namespace is injected by callers so non-3D projects load nothing.
 */
import { chooseInitial3dQuality, QUALITY3D_PRESETS } from './quality3d.js';

const FULLSCREEN_VERTEX_GLSL3 = `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HALF_AO_VOL_FRAGMENT_GLSL3 = `
uniform sampler2D tDepth;
uniform sampler2D tSunShadow;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform mat4 uCamToShadow;
uniform vec3 uSunViewDir;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uSsaoEnabled;
uniform float uSsaoRadius;
uniform float uSsaoBias;
uniform float uVolumetricSteps;
uniform float uHasSunShadow;
uniform float uTime;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  return view.xyz / max(abs(view.w), 1e-5);
}

vec3 reconstructEdgeAwareNormal(vec2 uv, vec3 viewPos, float depthC) {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 uvL = clamp(uv - vec2(texel.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvR = clamp(uv + vec2(texel.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvD = clamp(uv - vec2(0.0, texel.y), vec2(0.001), vec2(0.999));
  vec2 uvU = clamp(uv + vec2(0.0, texel.y), vec2(0.001), vec2(0.999));

  float dL = texture(tDepth, uvL).r;
  float dR = texture(tDepth, uvR).r;
  float dD = texture(tDepth, uvD).r;
  float dU = texture(tDepth, uvU).r;

  vec3 dPdx = abs(dR - depthC) < abs(depthC - dL)
    ? (reconstructViewPos(uvR, dR) - viewPos)
    : (viewPos - reconstructViewPos(uvL, dL));
  vec3 dPdy = abs(dU - depthC) < abs(depthC - dD)
    ? (reconstructViewPos(uvU, dU) - viewPos)
    : (viewPos - reconstructViewPos(uvD, dD));

  vec3 n = cross(dPdx, dPdy);
  float lenSq = dot(n, n);
  if (lenSq < 1e-10) return vec3(0.0, 0.0, 1.0);
  n *= inversesqrt(lenSq);
  if (n.z < 0.0) n = -n;
  return n;
}

float linearizeDepth01(float depth) {
  float zNdc = depth * 2.0 - 1.0;
  float linearZ = (2.0 * uNear * uFar) / max(1e-4, uFar + uNear - zNdc * (uFar - uNear));
  return clamp((linearZ - uNear) / max(1.0, uFar - uNear), 0.0, 1.0);
}

void main() {
  float depth = texture(tDepth, vUv).r;
  vec3 viewPos = reconstructViewPos(vUv, depth);
  float linDepth = depth >= 0.9999 ? 1.0 : linearizeDepth01(depth);
  float ao = 1.0;

  if (uSsaoEnabled > 0.5 && depth < 0.9999) {
    vec3 viewNormal = reconstructEdgeAwareNormal(vUv, viewPos, depth);
    vec3 tangent = normalize(abs(viewNormal.z) < 0.99 ? cross(viewNormal, vec3(0.0, 0.0, 1.0)) : cross(viewNormal, vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(viewNormal, tangent);

    float angle = ign(gl_FragCoord.xy) * 6.2831853;
    float ca = cos(angle), sa = sin(angle);
    mat2 rot = mat2(ca, -sa, sa, ca);

    float occlusion = 0.0;
    float weightSum = 0.0;
    const vec2 KERNEL[8] = vec2[8](
      vec2(0.14, 0.08), vec2(-0.22, 0.16), vec2(0.11, -0.31), vec2(-0.36, -0.21),
      vec2(0.49, 0.19), vec2(-0.26, 0.54), vec2(0.57, -0.44), vec2(-0.68, -0.35)
    );
    float radius = clamp(uSsaoRadius, 0.08, 3.0);
    for (int i = 0; i < 8; i++) {
      vec2 k2 = rot * KERNEL[i];
      float zOff = 0.12 + float(i) * 0.1;
      vec3 hemi = tangent * k2.x + bitangent * k2.y + viewNormal * zOff;
      vec3 samplePos = viewPos + normalize(hemi) * (radius * (0.25 + float(i) * 0.095));
      vec4 proj = uProj * vec4(samplePos, 1.0);
      vec2 sUv = (proj.xy / max(abs(proj.w), 1e-5)) * 0.5 + 0.5;
      if (sUv.x >= 0.0 && sUv.x <= 1.0 && sUv.y >= 0.0 && sUv.y <= 1.0) {
        float sDepth = texture(tDepth, sUv).r;
        vec3 sView = reconstructViewPos(sUv, sDepth);
        float rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(viewPos.z - sView.z), 0.001));
        if (sView.z >= samplePos.z + uSsaoBias && sDepth < 0.9999) {
          occlusion += rangeCheck;
        }
        weightSum += 1.0;
      }
    }
    ao = 1.0 - clamp(occlusion / max(weightSum, 1.0), 0.0, 1.0);
  }

  float vol = 0.0;
  if (uVolumetricSteps > 0.5 && uHasSunShadow > 0.5) {
    int steps = int(clamp(uVolumetricSteps, 1.0, 32.0));
    vec3 rayDir = normalize(viewPos);
    float hitDist = depth >= 0.9999 ? 48.0 : min(length(viewPos), 48.0);
    float jitter = ign(gl_FragCoord.xy + vec2(fract(uTime) * 37.0, 11.0));
    float cosTheta = dot(rayDir, normalize(uSunViewDir));
    float g = 0.65;
    float phase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(0.01, 1.0 + g * g - 2.0 * g * cosTheta), 1.5));
    float stepLen = hitDist / float(steps);
    float accum = 0.0;
    for (int s = 0; s < 32; s++) {
      if (s >= steps) break;
      float t = (float(s) + jitter) * stepLen;
      vec3 pView = rayDir * t;
      vec4 shadowClip = uCamToShadow * vec4(pView, 1.0);
      vec3 sc = (shadowClip.xyz / max(abs(shadowClip.w), 1e-5)) * 0.5 + 0.5;
      if (sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0) {
        float mapZ = texture(tSunShadow, sc.xy).r;
        if (sc.z - 0.0025 <= mapZ) accum += 1.0;
      }
    }
    vol = (accum / float(steps)) * clamp(phase * 1.4, 0.05, 1.25) * clamp(hitDist / 24.0, 0.0, 1.0);
  }

  fragColor = vec4(ao, vol, linDepth, 1.0);
}
`;

const HALF_GI_SSR_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uSsgiEnabled;
uniform float uSsrEnabled;
uniform float uGiRadius;
uniform float uGiIntensity;
uniform float uSsrIntensity;
uniform float uSsrMaxDist;
uniform float uSsrThickness;
uniform float uTime;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  return view.xyz / max(abs(view.w), 1e-5);
}

vec3 reconstructEdgeAwareNormal(vec2 uv, vec3 viewPos, float depthC) {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 uvL = clamp(uv - vec2(texel.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvR = clamp(uv + vec2(texel.x, 0.0), vec2(0.001), vec2(0.999));
  vec2 uvD = clamp(uv - vec2(0.0, texel.y), vec2(0.001), vec2(0.999));
  vec2 uvU = clamp(uv + vec2(0.0, texel.y), vec2(0.001), vec2(0.999));

  float dL = texture(tDepth, uvL).r;
  float dR = texture(tDepth, uvR).r;
  float dD = texture(tDepth, uvD).r;
  float dU = texture(tDepth, uvU).r;

  vec3 dPdx = abs(dR - depthC) < abs(depthC - dL)
    ? (reconstructViewPos(uvR, dR) - viewPos)
    : (viewPos - reconstructViewPos(uvL, dL));
  vec3 dPdy = abs(dU - depthC) < abs(depthC - dD)
    ? (reconstructViewPos(uvU, dU) - viewPos)
    : (viewPos - reconstructViewPos(uvD, dD));

  vec3 n = cross(dPdx, dPdy);
  float lenSq = dot(n, n);
  if (lenSq < 1e-10) return vec3(0.0, 0.0, 1.0);
  n *= inversesqrt(lenSq);
  if (n.z < 0.0) n = -n;
  return n;
}

float linearizeDepth01(float depth) {
  float zNdc = depth * 2.0 - 1.0;
  float linearZ = (2.0 * uNear * uFar) / max(1e-4, uFar + uNear - zNdc * (uFar - uNear));
  return clamp((linearZ - uNear) / max(1.0, uFar - uNear), 0.0, 1.0);
}

void main() {
  float depth = texture(tDepth, vUv).r;
  float linDepth = depth >= 0.9999 ? 1.0 : linearizeDepth01(depth);
  if (depth >= 0.9999) {
    fragColor = vec4(0.0, 0.0, 0.0, linDepth);
    return;
  }

  vec3 viewPos = reconstructViewPos(vUv, depth);
  vec3 viewNormal = reconstructEdgeAwareNormal(vUv, viewPos, depth);
  vec3 viewDir = normalize(-viewPos);
  vec3 giAccum = vec3(0.0);
  vec3 ssrColor = vec3(0.0);

  if (uSsgiEnabled > 0.5 && uGiIntensity > 0.001) {
    vec3 tangent = normalize(abs(viewNormal.z) < 0.99 ? cross(viewNormal, vec3(0.0, 0.0, 1.0)) : cross(viewNormal, vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(viewNormal, tangent);
    float phi = ign(gl_FragCoord.xy + vec2(fract(uTime) * 19.0, 7.0)) * 6.2831853;
    float radius = clamp(uGiRadius, 0.5, 8.0);
    float wSum = 0.0;

    for (int i = 0; i < 6; i++) {
      float a = phi + float(i) * 1.04719755;
      float rFrac = 0.28 + 0.14 * float(i);
      float elev = 0.25 + 0.1 * float((i * 3) % 5);
      vec3 sampleDir = normalize(tangent * cos(a) * (1.0 - elev * 0.4) + bitangent * sin(a) * (1.0 - elev * 0.4) + viewNormal * elev);
      vec3 probePos = viewPos + sampleDir * (radius * rFrac);
      vec4 clip = uProj * vec4(probePos, 1.0);
      vec2 sUv = (clip.xy / max(abs(clip.w), 1e-5)) * 0.5 + 0.5;
      if (sUv.x > 0.01 && sUv.x < 0.99 && sUv.y > 0.01 && sUv.y < 0.99) {
        float sDepth = texture(tDepth, sUv).r;
        if (sDepth < 0.9999) {
          vec3 sView = reconstructViewPos(sUv, sDepth);
          vec3 delta = sView - viewPos;
          float dist2 = max(0.08, dot(delta, delta));
          float dist = sqrt(dist2);
          if (dist < radius * 1.45) {
            vec3 dirToS = delta / dist;
            float nDot = max(0.0, dot(viewNormal, dirToS));
            vec3 sRad = min(max(vec3(0.0), texture(tScene, sUv).rgb), vec3(6.0));
            float distFade = 1.0 - smoothstep(radius * 0.45, radius * 1.45, dist);
            float w = nDot * distFade / (0.35 + dist2);
            giAccum += sRad * w;
            wSum += w;
          }
        }
      }
      wSum += 0.25;
    }
    giAccum = (giAccum / max(wSum, 1e-3)) * 0.65;
  }

  if (uSsrEnabled > 0.5 && uSsrIntensity > 0.001) {
    vec3 reflDir = reflect(-viewDir, viewNormal);
    if (reflDir.z < 0.35) {
      float maxDist = clamp(uSsrMaxDist, 4.0, 64.0);
      float thickness = clamp(uSsrThickness, 0.05, 1.5);
      float jitter = ign(gl_FragCoord.xy + vec2(3.0, fract(uTime) * 23.0));
      float stepLen = maxDist / 12.0;
      float prevT = 0.05;
      bool hit = false;
      vec2 hitUv = vec2(0.0);

      for (int s = 0; s < 12; s++) {
        float t = (float(s) + jitter + 0.35) * stepLen;
        vec3 pView = viewPos + reflDir * t;
        if (pView.z > -0.05) break;
        vec4 clip = uProj * vec4(pView, 1.0);
        vec2 rUv = (clip.xy / max(abs(clip.w), 1e-5)) * 0.5 + 0.5;
        if (rUv.x < 0.0 || rUv.x > 1.0 || rUv.y < 0.0 || rUv.y > 1.0) break;
        float sDepth = texture(tDepth, rUv).r;
        if (sDepth < 0.9999) {
          float sceneZ = reconstructViewPos(rUv, sDepth).z;
          float dz = sceneZ - pView.z;
          if (dz > 0.0 && dz < thickness + t * 0.04) {
            float lo = prevT;
            float hi = t;
            for (int r = 0; r < 2; r++) {
              float mid = 0.5 * (lo + hi);
              vec3 mp = viewPos + reflDir * mid;
              vec4 mc = uProj * vec4(mp, 1.0);
              vec2 mUv = (mc.xy / max(abs(mc.w), 1e-5)) * 0.5 + 0.5;
              float md = texture(tDepth, clamp(mUv, vec2(0.0), vec2(1.0))).r;
              float mz = reconstructViewPos(clamp(mUv, vec2(0.0), vec2(1.0)), md).z;
              if (mz - mp.z > 0.0) {
                hi = mid;
                rUv = mUv;
              } else {
                lo = mid;
              }
            }
            hit = true;
            hitUv = rUv;
            break;
          }
        }
        prevT = t;
      }

      if (hit) {
        vec2 edge = smoothstep(vec2(0.0), vec2(0.12), hitUv) * smoothstep(vec2(1.0), vec2(0.88), hitUv);
        float edgeFade = edge.x * edge.y;
        float dirFade = 1.0 - smoothstep(0.0, 0.35, reflDir.z);
        float fresnel = mix(0.08, 0.92, pow(1.0 - max(0.0, dot(viewNormal, viewDir)), 4.0));
        vec3 reflCol = min(max(vec3(0.0), texture(tScene, hitUv).rgb), vec3(8.0));
        ssrColor = reflCol * (edgeFade * dirFade * fresnel);
      }
    }
  }

  fragColor = vec4(giAccum * uGiIntensity + ssrColor * uSsrIntensity, linDepth);
}
`;

const BILATERAL_RGBA_BLUR_FRAGMENT_GLSL3 = `
uniform sampler2D tInput;
uniform vec2 uTexelStep;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 center = texture(tInput, vUv);
  float centerDepth = center.a;
  const float W[3] = float[3](0.4026, 0.2442, 0.0545);
  vec3 accum = center.rgb * W[0];
  float wSum = W[0];
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    int idx = i < 0 ? -i : i;
    vec4 s = texture(tInput, clamp(vUv + uTexelStep * float(i), vec2(0.001), vec2(0.999)));
    float depthWeight = exp(-abs(s.a - centerDepth) * 90.0);
    float w = W[idx] * depthWeight;
    accum += s.rgb * w;
    wSum += w;
  }
  fragColor = vec4(accum / max(wSum, 1e-4), centerDepth);
}
`;

const LUMA_EXTRACT_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec3 hdr = max(vec3(0.0), texture(tScene, vUv).rgb);
  float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  vec2 c = vUv * 2.0 - 1.0;
  float meterWeight = clamp(1.15 - 0.55 * dot(c, c), 0.25, 1.15);
  float logLuma = log2(max(luma * meterWeight, 1e-4));
  fragColor = vec4(logLuma, logLuma, logLuma, 1.0);
}
`;

const BOX4_DOWNSAMPLE_FRAGMENT_GLSL3 = `
uniform sampler2D tSource;
uniform vec2 uTexelSize;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 d = uTexelSize * 0.5;
  float v0 = texture(tSource, vUv + vec2(-d.x, -d.y)).r;
  float v1 = texture(tSource, vUv + vec2( d.x, -d.y)).r;
  float v2 = texture(tSource, vUv + vec2(-d.x,  d.y)).r;
  float v3 = texture(tSource, vUv + vec2( d.x,  d.y)).r;
  float avg = 0.25 * (v0 + v1 + v2 + v3);
  fragColor = vec4(avg, avg, avg, 1.0);
}
`;

const EYE_ADAPT_FRAGMENT_GLSL3 = `
uniform sampler2D tAvgLogLuma;
uniform sampler2D tPrevAdapt;
uniform float uDt;
uniform float uKeyValue;
uniform float uExposureComp;
uniform float uMinExposure;
uniform float uMaxExposure;
uniform float uAdaptSpeedUp;
uniform float uAdaptSpeedDown;
uniform float uResetAdapt;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  float avgLog = texture(tAvgLogLuma, vec2(0.5)).r;
  float avgLuma = clamp(exp2(avgLog), 1e-4, 1e4);
  float targetExp = clamp((uKeyValue / avgLuma) * uExposureComp, uMinExposure, uMaxExposure);
  float prevExp = uResetAdapt > 0.5 ? targetExp : clamp(texture(tPrevAdapt, vec2(0.5)).r, uMinExposure, uMaxExposure);
  float speed = targetExp > prevExp ? uAdaptSpeedDown : uAdaptSpeedUp;
  float alpha = 1.0 - exp(-max(0.0, uDt) * max(0.05, speed));
  float nextExp = prevExp + (targetExp - prevExp) * alpha;
  fragColor = vec4(nextExp, avgLuma, targetExp, 1.0);
}
`;

const BILATERAL_BLUR_FRAGMENT_GLSL3 = `
uniform sampler2D tInput;
uniform vec2 uTexelStep;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 center = texture(tInput, vUv);
  float centerDepth = center.b;
  const float W[3] = float[3](0.4026, 0.2442, 0.0545);
  vec2 accum = center.rg * W[0];
  float wSum = W[0];
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    int idx = i < 0 ? -i : i;
    vec4 s = texture(tInput, clamp(vUv + uTexelStep * float(i), vec2(0.001), vec2(0.999)));
    float depthWeight = exp(-abs(s.b - centerDepth) * 90.0);
    float w = W[idx] * depthWeight;
    accum += s.rg * w;
    wSum += w;
  }
  fragColor = vec4(accum / max(wSum, 1e-4), centerDepth, 1.0);
}
`;

const BLOOM_PREFILTER_FRAGMENT_GLSL3 = `
uniform sampler2D tSource;
uniform vec2 uTexelSize;
uniform float uThreshold;
uniform float uSoftKnee;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float karisLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleKaris(vec2 uv) {
  vec3 c = max(vec3(0.0), texture(tSource, uv).rgb);
  return c;
}

void main() {
  vec2 d = uTexelSize * 0.5;
  vec3 c0 = sampleKaris(vUv);
  vec3 c1 = sampleKaris(vUv + vec2(-d.x, -d.y));
  vec3 c2 = sampleKaris(vUv + vec2( d.x, -d.y));
  vec3 c3 = sampleKaris(vUv + vec2(-d.x,  d.y));
  vec3 c4 = sampleKaris(vUv + vec2( d.x,  d.y));

  float w0 = 1.0 / (1.0 + karisLuma(c0));
  float w1 = 1.0 / (1.0 + karisLuma(c1));
  float w2 = 1.0 / (1.0 + karisLuma(c2));
  float w3 = 1.0 / (1.0 + karisLuma(c3));
  float w4 = 1.0 / (1.0 + karisLuma(c4));
  vec3 avg = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / max(1e-4, w0 + w1 + w2 + w3 + w4);

  float br = max(avg.r, max(avg.g, avg.b));
  float knee = uThreshold * uSoftKnee + 1e-4;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = (soft * soft) / (4.0 * knee);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  fragColor = vec4(avg * max(0.0, contrib), 1.0);
}
`;

const BLOOM_DOWNSAMPLE_FRAGMENT_GLSL3 = `
uniform sampler2D tSource;
uniform vec2 uTexelSize;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 d = uTexelSize;
  vec3 a = texture(tSource, vUv + vec2(-2.0 * d.x,  2.0 * d.y)).rgb;
  vec3 b = texture(tSource, vUv + vec2( 0.0,        2.0 * d.y)).rgb;
  vec3 c = texture(tSource, vUv + vec2( 2.0 * d.x,  2.0 * d.y)).rgb;
  vec3 d0 = texture(tSource, vUv + vec2(-d.x,       d.y)).rgb;
  vec3 e = texture(tSource, vUv + vec2( d.x,        d.y)).rgb;
  vec3 f = texture(tSource, vUv + vec2(-2.0 * d.x,  0.0)).rgb;
  vec3 g = texture(tSource, vUv).rgb;
  vec3 h = texture(tSource, vUv + vec2( 2.0 * d.x,  0.0)).rgb;
  vec3 i = texture(tSource, vUv + vec2(-d.x,      -d.y)).rgb;
  vec3 j = texture(tSource, vUv + vec2( d.x,      -d.y)).rgb;
  vec3 k = texture(tSource, vUv + vec2(-2.0 * d.x, -2.0 * d.y)).rgb;
  vec3 l = texture(tSource, vUv + vec2( 0.0,       -2.0 * d.y)).rgb;
  vec3 m = texture(tSource, vUv + vec2( 2.0 * d.x, -2.0 * d.y)).rgb;

  vec3 res = g * 0.125;
  res += (d0 + e + i + j) * 0.125;
  res += (a + b + f + g + b + c + g + h + f + g + k + l + g + h + l + m) * (0.5 / 16.0);
  fragColor = vec4(res, 1.0);
}
`;

const BLOOM_UPSAMPLE_FRAGMENT_GLSL3 = `
uniform sampler2D tLower;
uniform sampler2D tUpper;
uniform vec2 uTexelSize;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 d = uTexelSize;
  vec3 tent =
    texture(tLower, vUv + vec2(-d.x, -d.y)).rgb * 1.0 +
    texture(tLower, vUv + vec2( 0.0, -d.y)).rgb * 2.0 +
    texture(tLower, vUv + vec2( d.x, -d.y)).rgb * 1.0 +
    texture(tLower, vUv + vec2(-d.x,  0.0)).rgb * 2.0 +
    texture(tLower, vUv).rgb * 4.0 +
    texture(tLower, vUv + vec2( d.x,  0.0)).rgb * 2.0 +
    texture(tLower, vUv + vec2(-d.x,  d.y)).rgb * 1.0 +
    texture(tLower, vUv + vec2( 0.0,  d.y)).rgb * 2.0 +
    texture(tLower, vUv + vec2( d.x,  d.y)).rgb * 1.0;
  vec3 up = texture(tUpper, vUv).rgb;
  fragColor = vec4(up + tent / 16.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAoVol;
uniform sampler2D tGiSsr;
uniform sampler2D tBloom;
uniform sampler2D tAutoExposure;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec3 uSunViewDir;
uniform vec3 uSunColor;
uniform vec3 uWhiteBalance;
uniform vec3 uColorLift;
uniform vec3 uColorGamma;
uniform vec3 uColorGain;
uniform float uUseAo;
uniform float uUseVolumetric;
uniform float uUseGiSsr;
uniform float uUseBloom;
uniform float uUseAutoExposure;
uniform float uHasSunDir;
uniform float uContactShadows;
uniform float uContactShadowLength;
uniform float uContactShadowThickness;
uniform float uSsaoIntensity;
uniform float uVolumetricIntensity;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uChromaticAberration;
uniform float uFilmGrain;
uniform float uFilmSlope;
uniform float uFilmToe;
uniform float uFilmShoulder;
uniform float uFilmBlackClip;
uniform float uFilmWhiteClip;
uniform float uVignette;
uniform float uDamage;
uniform float uLowHealth;
uniform float uFocus;
uniform float uFlash;
uniform float uFade;
uniform float uTime;
uniform int uToneMapping;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float compIgn(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 compReconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  return view.xyz / max(abs(view.w), 1e-5);
}

vec3 acesFilmic(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 agxApproximation(vec3 val) {
  const mat3 agxInset = mat3(
    0.84247906, 0.04232824, 0.04237565,
    0.07843360, 0.87846864, 0.07843360,
    0.07922375, 0.07916613, 0.87914297
  );
  const mat3 agxOutset = mat3(
     1.19687900, -0.05289685, -0.05297163,
    -0.09802088,  1.15190313, -0.09804345,
    -0.09902974, -0.09896118,  1.15107368
  );
  vec3 x = max(val, vec3(1e-6));
  x = agxInset * x;
  x = clamp((log2(x) - (-12.47393)) / (4.026069 - (-12.47393)), 0.0, 1.0);
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  vec3 curve = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return clamp(agxOutset * curve, 0.0, 1.0);
}

float ueFilmicChannel(float lin, float slope, float toe, float shoulder, float blackClip, float whiteClip) {
  if (lin <= 0.0) return 0.0;
  float xScaled = lin / 0.18;
  float contrastPow = 0.55 + max(0.05, slope) * 0.65;
  float toeClamp = clamp(toe, 0.0, 1.0);
  float shoulderClamp = clamp(shoulder, 0.0, 1.0);
  float blackClamp = clamp(blackClip, 0.0, 0.5);
  float whiteClamp = clamp(whiteClip, 0.0, 0.5);
  float shapedScale = xScaled < 1.0
    ? pow(xScaled, contrastPow * (1.0 + toeClamp * 0.45 * (1.0 - xScaled)))
    : pow(xScaled, contrastPow);
  float h = 0.18 * shapedScale;
  float whitePt = 1.0 + whiteClamp * 0.85;
  float u = h * (1.0 + shoulderClamp * 0.5);
  float mapped = (u * whitePt) / (u + 0.82 + shoulderClamp * 0.35);
  if (blackClamp > 0.0) {
    float floorPt = blackClamp * 0.06;
    mapped = max(0.0, mapped - floorPt) / max(1e-4, 1.0 - floorPt);
  }
  return clamp(mapped, 0.0, 1.0);
}

vec3 ueFilmicCurve(vec3 hdr) {
  float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  float highlightDesat = smoothstep(0.5, 4.0, luma) * 0.22 + 0.05;
  vec3 work = mix(hdr, vec3(luma), highlightDesat);
  return vec3(
    ueFilmicChannel(work.r, uFilmSlope, uFilmToe, uFilmShoulder, uFilmBlackClip, uFilmWhiteClip),
    ueFilmicChannel(work.g, uFilmSlope, uFilmToe, uFilmShoulder, uFilmBlackClip, uFilmWhiteClip),
    ueFilmicChannel(work.b, uFilmSlope, uFilmToe, uFilmShoulder, uFilmBlackClip, uFilmWhiteClip)
  );
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 centered = vUv * 2.0 - 1.0;
  vec3 hdr;
  if (uChromaticAberration > 0.0005) {
    vec2 caShift = centered * (uChromaticAberration * 0.012);
    float r = texture(tScene, clamp(vUv - caShift, vec2(0.001), vec2(0.999))).r;
    float g = texture(tScene, vUv).g;
    float b = texture(tScene, clamp(vUv + caShift, vec2(0.001), vec2(0.999))).b;
    hdr = max(vec3(0.0), vec3(r, g, b));
  } else {
    hdr = max(vec3(0.0), texture(tScene, vUv).rgb);
  }

  float lumaHdr = dot(hdr, vec3(0.2126, 0.7152, 0.0722));

  if (uUseGiSsr > 0.5) {
    vec3 giSsr = max(vec3(0.0), texture(tGiSsr, vUv).rgb);
    hdr += giSsr;
  }

  if (uContactShadows > 0.001 && uHasSunDir > 0.5) {
    float cDepth = texture(tDepth, vUv).r;
    if (cDepth < 0.9999) {
      vec3 vPos = compReconstructViewPos(vUv, cDepth);
      float jitter = compIgn(gl_FragCoord.xy + vec2(fract(uTime) * 13.0, 5.0));
      float rayLen = clamp(uContactShadowLength, 0.05, 1.5);
      float thickness = clamp(uContactShadowThickness, 0.01, 0.4);
      vec3 rayStep = uSunViewDir * (rayLen / 8.0);
      float occ = 0.0;
      for (int i = 0; i < 8; i++) {
        vec3 p = vPos + rayStep * (float(i) + jitter + 0.25);
        vec4 clip = uProj * vec4(p, 1.0);
        vec2 sUv = (clip.xy / max(abs(clip.w), 1e-5)) * 0.5 + 0.5;
        if (sUv.x >= 0.0 && sUv.x <= 1.0 && sUv.y >= 0.0 && sUv.y <= 1.0) {
          float sD = texture(tDepth, sUv).r;
          if (sD < 0.9999) {
            float sceneZ = compReconstructViewPos(sUv, sD).z;
            float dz = sceneZ - p.z;
            if (dz > 0.008 && dz < thickness) {
              occ = max(occ, 1.0 - float(i) / 8.0);
            }
          }
        }
      }
      hdr *= (1.0 - occ * clamp(uContactShadows, 0.0, 1.0));
    }
  }

  if (uUseAo > 0.5 || uUseVolumetric > 0.5) {
    vec2 aoVol = texture(tAoVol, vUv).rg;
    if (uUseAo > 0.5) {
      float aoStrength = uSsaoIntensity * (1.0 - smoothstep(0.6, 2.4, lumaHdr) * 0.65);
      hdr *= mix(1.0, aoVol.r, clamp(aoStrength, 0.0, 1.0));
    }
    if (uUseVolumetric > 0.5) {
      hdr += uSunColor * (aoVol.g * uVolumetricIntensity);
    }
  }

  if (uUseBloom > 0.5) {
    hdr += texture(tBloom, vUv).rgb * uBloomStrength;
  }

  hdr += vec3(uFlash);
  float adapted = uUseAutoExposure > 0.5 ? texture(tAutoExposure, vec2(0.5)).r : 1.0;
  hdr *= uExposure * adapted;
  hdr *= uWhiteBalance;

  // Working-space linear contrast pivoted on 18% gray + ASC-CDL lift/gamma/gain.
  hdr = max(vec3(0.0), 0.18 * pow(max(hdr / 0.18, vec3(1e-5)), vec3(max(0.25, uContrast))));
  hdr = max(vec3(0.0), hdr * uColorGain + uColorLift * 0.08);
  hdr = pow(hdr, vec3(1.0) / max(uColorGamma, vec3(0.25)));

  vec3 mapped = hdr;
  if (uToneMapping == 0) mapped = acesFilmic(hdr);
  else if (uToneMapping == 1) mapped = agxApproximation(hdr);
  else if (uToneMapping == 3) mapped = ueFilmicCurve(hdr);
  else mapped = clamp(hdr, 0.0, 1.0);

  float gray = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  float sat = uSaturation * (1.0 - clamp(uLowHealth, 0.0, 1.0) * 0.55);
  mapped = clamp(mix(vec3(gray), mapped, sat), 0.0, 1.0);

  float distSq = dot(centered, centered);
  float vig = 1.0 - distSq * (uVignette + uFocus * 0.22 + uLowHealth * 0.25);
  mapped *= clamp(vig, 0.15, 1.0);

  float edgePulse = smoothstep(0.35, 1.35, distSq) * clamp(uDamage + uLowHealth * 0.5, 0.0, 1.0);
  mapped = mix(mapped, vec3(0.85, 0.07, 0.05), edgePulse * 0.52);
  if (uFilmGrain > 0.0005) {
    float g = (compIgn(gl_FragCoord.xy + vec2(fract(uTime * 17.3) * 191.0, fract(uTime * 7.1) * 89.0)) - 0.5);
    mapped = clamp(mapped + g * uFilmGrain * 0.08, 0.0, 1.0);
  }
  mapped *= (1.0 - clamp(uFade, 0.0, 1.0));

  vec3 srgb = clamp(linearToSrgb(mapped), 0.0, 1.0);
  float perceptualLuma = dot(srgb, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(srgb, perceptualLuma);
}
`;

const FXAA_SHARPEN_FRAGMENT_GLSL3 = `
uniform sampler2D tDiffuse;
uniform vec2 uTexelSize;
uniform float uSharpness;
uniform float uFxaaEnabled;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float ignDither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 center = texture(tDiffuse, vUv);
  vec3 rgb = center.rgb;
  vec2 e = uTexelSize;

  float lC = center.a;
  float lN = texture(tDiffuse, vUv + vec2( 0.0,  e.y)).a;
  float lS = texture(tDiffuse, vUv + vec2( 0.0, -e.y)).a;
  float lE = texture(tDiffuse, vUv + vec2( e.x,  0.0)).a;
  float lW = texture(tDiffuse, vUv + vec2(-e.x,  0.0)).a;
  float lMin = min(lC, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lC, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;

  if (uFxaaEnabled > 0.5 && range >= max(0.0312, lMax * 0.125)) {
    float lNW = texture(tDiffuse, vUv + vec2(-e.x,  e.y)).a;
    float lNE = texture(tDiffuse, vUv + vec2( e.x,  e.y)).a;
    float lSW = texture(tDiffuse, vUv + vec2(-e.x, -e.y)).a;
    float lSE = texture(tDiffuse, vUv + vec2( e.x, -e.y)).a;

    float lNS = lN + lS;
    float lEW = lW + lE;
    float subpix = clamp(abs(((2.0 * (lNS + lEW) + (lNW + lNE + lSW + lSE)) / 12.0) - lC) / max(range, 1e-4), 0.0, 1.0);
    subpix = smoothstep(0.0, 1.0, subpix);
    subpix = subpix * subpix * 0.65;

    bool horzSpan = (abs((lNW + lNE) - 2.0 * lN) + 2.0 * abs(lEW - 2.0 * lC) + abs((lSW + lSE) - 2.0 * lS)) >=
                    (abs((lNW + lSW) - 2.0 * lW) + 2.0 * abs(lNS - 2.0 * lC) + abs((lNE + lSE) - 2.0 * lE));
    float lPos = horzSpan ? lN : lE;
    float lNeg = horzSpan ? lS : lW;
    vec2 stepNorm = horzSpan ? vec2(0.0, e.y) : vec2(e.x, 0.0);
    float gradPos = abs(lPos - lC);
    float gradNeg = abs(lNeg - lC);
    if (gradNeg >= gradPos) stepNorm = -stepNorm;

    vec2 tanStep = horzSpan ? vec2(e.x, 0.0) : vec2(0.0, e.y);
    float refLuma = 0.5 * (lC + (gradNeg >= gradPos ? lNeg : lPos));
    float gradThresh = 0.25 * max(gradPos, gradNeg);

    float distPos = 4.0;
    float distNeg = 4.0;
    bool endPos = false;
    bool endNeg = false;
    for (int i = 1; i <= 4; i++) {
      if (!endPos) {
        float l = texture(tDiffuse, vUv + stepNorm * 0.5 + tanStep * float(i)).a - refLuma;
        if (abs(l) >= gradThresh) { distPos = float(i); endPos = true; }
      }
      if (!endNeg) {
        float l = texture(tDiffuse, vUv + stepNorm * 0.5 - tanStep * float(i)).a - refLuma;
        if (abs(l) >= gradThresh) { distNeg = float(i); endNeg = true; }
      }
    }
    float edgeBlend = max(subpix, 0.5 - min(distPos, distNeg) / max(distPos + distNeg, 1.0));
    rgb = texture(tDiffuse, vUv + stepNorm * clamp(edgeBlend, 0.0, 0.75)).rgb;
  }

  if (uSharpness > 0.001) {
    vec3 blur = 0.25 * (
      texture(tDiffuse, vUv + vec2( 0.0,  e.y)).rgb +
      texture(tDiffuse, vUv + vec2( 0.0, -e.y)).rgb +
      texture(tDiffuse, vUv + vec2( e.x,  0.0)).rgb +
      texture(tDiffuse, vUv + vec2(-e.x,  0.0)).rgb
    );
    float edgeAtten = 1.0 - smoothstep(0.06, 0.32, range);
    rgb = clamp(rgb + (rgb - blur) * (uSharpness * edgeAtten), 0.0, 1.0);
  }

  float dither = (ignDither(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(rgb + dither, 0.0, 1.0), 1.0);
}
`;

function createFullscreenTriangle(THREE) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Inspects GPU capabilities from an existing WebGLRenderer without creating
 * a second throwaway WebGL context.
 */
export function inspectWebGLCapabilities(renderer) {
  const fallback = Object.freeze({
    isWebGL2: false,
    maxSamples: 0,
    maxTextureSize: 2048,
    maxAnisotropy: 1,
    rendererName: '',
    halfFloatRenderable: false,
  });
  const gl = renderer?.getContext?.();
  if (!gl) return fallback;

  const isWebGL2 = Boolean(
    renderer?.capabilities?.isWebGL2 ||
    (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)
  );
  let maxSamples = 0;
  if (isWebGL2 && 'MAX_SAMPLES' in gl && typeof gl.getParameter === 'function') {
    maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
  }
  const maxTextureSize = typeof gl.getParameter === 'function' && 'MAX_TEXTURE_SIZE' in gl
    ? (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048)
    : 2048;
  const maxAnisotropy = Math.max(1, Number(renderer?.capabilities?.getMaxAnisotropy?.() ?? 1) || 1);

  let rendererName = '';
  try {
    const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
    if (debugInfo && typeof gl.getParameter === 'function') {
      rendererName = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch {
    rendererName = '';
  }

  const halfFloatRenderable = Boolean(
    isWebGL2 && gl.getExtension?.('EXT_color_buffer_float')
  );

  return Object.freeze({
    isWebGL2,
    maxSamples,
    maxTextureSize,
    maxAnisotropy,
    rendererName,
    halfFloatRenderable,
  });
}

/**
 * Combines an existing WebGL context's capabilities with the 3D quality presets.
 */
export function refineQualityWithContext(qualityController, renderer, deviceHints = {}) {
  const capabilities = inspectWebGLCapabilities(renderer);
  const recommendedTier = chooseInitial3dQuality({
    ...deviceHints,
    rendererName: capabilities.rendererName || deviceHints.rendererName || '',
  });
  const activePreset = qualityController?.state?.preset ?? QUALITY3D_PRESETS[recommendedTier];
  return Object.freeze({
    capabilities,
    recommendedTier,
    clampedMsaaSamples: Math.min(activePreset.msaaSamples ?? 0, capabilities.maxSamples),
    clampedAnisotropy: Math.min(activePreset.anisotropy ?? 1, capabilities.maxAnisotropy),
  });
}

function clampRange(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function ciePlanckianLinearRgb(tempK) {
  const t = clampRange(Number.isFinite(tempK) ? tempK : 6500, 1667, 25000);
  const invT = 1 / t;
  const invT2 = invT * invT;
  const invT3 = invT2 * invT;
  const x = t <= 4000
    ? (-0.2661239e9 * invT3 - 0.2343589e6 * invT2 + 0.8776956e3 * invT + 0.179910)
    : (-3.0258469e9 * invT3 + 2.1070379e6 * invT2 + 0.2226347e3 * invT + 0.240390);
  const x2 = x * x;
  const x3 = x2 * x;
  const y = t <= 2222
    ? (-1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683)
    : (t <= 4000
      ? (-0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867)
      : (3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483));
  const Y = 1;
  const X = x / Math.max(1e-4, y);
  const Z = Math.max(0, 1 - x - y) / Math.max(1e-4, y);
  return [
    Math.max(1e-4, 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    Math.max(1e-4, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z),
    Math.max(1e-4, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  ];
}

const D65_PLANCKIAN_REF = ciePlanckianLinearRgb(6500);

/**
 * Computes luminance-preserving camera white-balance RGB multipliers relative
 * to 6500K neutral daylight (`whiteTemp > 6500` warms, `< 6500` cools).
 */
export function computeWhiteBalanceRGB(whiteTemp = 6500, whiteTint = 0, out = [1, 1, 1]) {
  const temp = clampRange(Number.isFinite(whiteTemp) ? whiteTemp : 6500, 1667, 25000);
  const tint = clampRange(Number.isFinite(whiteTint) ? whiteTint : 0, -1, 1);
  if (temp === 6500 && tint === 0) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  const src = ciePlanckianLinearRgb(temp);
  let r = D65_PLANCKIAN_REF[0] / src[0];
  let g = (D65_PLANCKIAN_REF[1] / src[1]) * Math.exp(-tint * 0.25);
  let b = D65_PLANCKIAN_REF[2] / src[2];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const invLuma = luma > 1e-6 ? 1 / luma : 1;
  out[0] = r * invLuma;
  out[1] = g * invLuma;
  out[2] = b * invLuma;
  return out;
}

/**
 * Clean-room monotonic parametric filmic tone curve for a single linear HDR channel.
 */
export function evaluateFilmicCurveChannel(x, {
  slope = 0.88,
  toe = 0.55,
  shoulder = 0.26,
  blackClip = 0.0,
  whiteClip = 0.04,
} = {}) {
  const lin = Math.max(0, Number.isFinite(x) ? x : 0);
  if (lin <= 0) return 0;
  const xScaled = lin / 0.18;
  const contrastPow = 0.55 + Math.max(0.05, Number.isFinite(slope) ? slope : 0.88) * 0.65;
  const toeClamp = clampRange(Number.isFinite(toe) ? toe : 0.55, 0, 1);
  const shoulderClamp = clampRange(Number.isFinite(shoulder) ? shoulder : 0.26, 0, 1);
  const blackClamp = clampRange(Number.isFinite(blackClip) ? blackClip : 0, 0, 0.5);
  const whiteClamp = clampRange(Number.isFinite(whiteClip) ? whiteClip : 0.04, 0, 0.5);

  const shapedScale = xScaled < 1
    ? Math.pow(xScaled, contrastPow * (1 + toeClamp * 0.45 * (1 - xScaled)))
    : Math.pow(xScaled, contrastPow);
  const h = 0.18 * shapedScale;
  const whitePt = 1.0 + whiteClamp * 0.85;
  const u = h * (1.0 + shoulderClamp * 0.5);
  let mapped = (u * whitePt) / (u + 0.82 + shoulderClamp * 0.35);
  if (blackClamp > 0) {
    const floorPt = blackClamp * 0.06;
    mapped = Math.max(0, mapped - floorPt) / Math.max(1e-4, 1.0 - floorPt);
  }
  return clampRange(mapped, 0, 1);
}

/** Evaluates the parametric filmic curve with subtle highlight crosstalk desaturation. */
export function evaluateFilmicCurveRGB(rgb, params = {}, out = [0, 0, 0]) {
  const r = Math.max(0, Number(rgb[0]) || 0);
  const g = Math.max(0, Number(rgb[1]) || 0);
  const b = Math.max(0, Number(rgb[2]) || 0);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.max(0, Math.min(1, (luma - 0.5) / 3.5));
  const smooth = t * t * (3 - 2 * t);
  const desat = smooth * 0.22 + 0.05;
  out[0] = evaluateFilmicCurveChannel(r + (luma - r) * desat, params);
  out[1] = evaluateFilmicCurveChannel(g + (luma - g) * desat, params);
  out[2] = evaluateFilmicCurveChannel(b + (luma - b) * desat, params);
  return out;
}

/**
 * Computes one asymmetric temporal eye-adaptation step from scene average luminance.
 */
export function stepEyeAdaptation(currentExposure, avgLuminance, {
  keyValue = 0.18,
  minExposure = 0.35,
  maxExposure = 2.6,
  adaptSpeedUp = 3.0,
  adaptSpeedDown = 1.4,
  exposureCompensation = 1.0,
} = {}, dt = 1 / 60) {
  const cur = Number.isFinite(currentExposure) ? clampRange(currentExposure, minExposure, maxExposure) : 1.0;
  const luma = clampRange(Number.isFinite(avgLuminance) ? avgLuminance : 0.18, 1e-4, 1e4);
  const target = clampRange((keyValue / luma) * exposureCompensation, minExposure, maxExposure);
  const speed = target > cur ? adaptSpeedDown : adaptSpeedUp;
  const alpha = 1 - Math.exp(-Math.max(0, Number.isFinite(dt) ? dt : 0) * Math.max(0.05, speed));
  return cur + (target - cur) * alpha;
}

const POST_SCALAR_KEYS = [
  'exposure', 'bloomStrength', 'bloomThreshold', 'bloomSoftKnee',
  'ssaoRadius', 'ssaoBias', 'ssaoIntensity', 'volumetricIntensity',
  'giIntensity', 'ssrIntensity', 'contactShadows', 'contactShadowLength',
  'whiteTemp', 'whiteTint', 'contrast', 'saturation', 'vignette',
  'chromaticAberration', 'filmGrain', 'filmSlope', 'filmToe',
  'filmShoulder', 'filmBlackClip', 'filmWhiteClip',
  'damage', 'lowHealth', 'focus', 'flash', 'fade',
];

const POST_VEC3_KEYS = ['colorLift', 'colorGamma', 'colorGain'];

const DEFAULT_POST_VOLUME_BASE = Object.freeze({
  toneMapping: 'ueFilmic',
  exposure: 1.0,
  bloomStrength: 0.28,
  bloomThreshold: 0.85,
  bloomSoftKnee: 0.5,
  ssaoRadius: 0.5,
  ssaoBias: 0.025,
  ssaoIntensity: 0.42,
  volumetricIntensity: 0.18,
  giIntensity: 0.55,
  ssrIntensity: 0.35,
  contactShadows: 0.65,
  contactShadowLength: 0.32,
  whiteTemp: 6500,
  whiteTint: 0,
  contrast: 1.0,
  saturation: 1.05,
  vignette: 0.18,
  chromaticAberration: 0,
  filmGrain: 0,
  filmSlope: 0.88,
  filmToe: 0.55,
  filmShoulder: 0.26,
  filmBlackClip: 0.0,
  filmWhiteClip: 0.04,
  colorLift: [0, 0, 0],
  colorGamma: [1, 1, 1],
  colorGain: [1, 1, 1],
  damage: 0,
  lowHealth: 0,
  focus: 0,
  flash: 0,
  fade: 0,
});

function volumeSignedDistance(vol, pos) {
  const cx = vol.center[0];
  const cy = vol.center[1];
  const cz = vol.center[2];
  let dx = (pos?.x ?? pos?.[0] ?? 0) - cx;
  const dy = (pos?.y ?? pos?.[1] ?? 0) - cy;
  let dz = (pos?.z ?? pos?.[2] ?? 0) - cz;

  if (vol.shape === 'sphere') {
    return Math.hypot(dx, dy, dz) - vol.radius;
  }
  if (vol.yaw !== 0) {
    const c = Math.cos(-vol.yaw);
    const s = Math.sin(-vol.yaw);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    dx = rx;
    dz = rz;
  }
  const qx = Math.abs(dx) - vol.extents[0];
  const qy = Math.abs(dy) - vol.extents[1];
  const qz = Math.abs(dz) - vol.extents[2];
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inDist = Math.min(Math.max(qx, qy, qz), 0);
  return outDist + inDist;
}

/**
 * Spatial priority-sorted post-processing volume evaluator (unbound globals
 * plus smooth distance-feathered box/sphere zones).
 */
export function createPostProcessVolumeStack(initialVolumes = []) {
  const volumes = new Map();

  function normalizeVolume(input) {
    if (!input || typeof input !== 'object' || !input.id) {
      throw new TypeError('Post-process volume requires an id');
    }
    const center = Array.isArray(input.center) ? input.center : [input.center?.x ?? 0, input.center?.y ?? 0, input.center?.z ?? 0];
    const extents = Array.isArray(input.extents) ? input.extents : [10, 10, 10];
    return {
      id: String(input.id),
      priority: Number.isFinite(input.priority) ? input.priority : 0,
      unbound: Boolean(input.unbound),
      shape: input.shape === 'sphere' ? 'sphere' : 'box',
      center: [Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0],
      extents: [Math.max(0.01, Number(extents[0]) || 10), Math.max(0.01, Number(extents[1]) || 10), Math.max(0.01, Number(extents[2]) || 10)],
      radius: Math.max(0.01, Number(input.radius) || 10),
      yaw: Number.isFinite(input.yaw) ? input.yaw : 0,
      blendRadius: Math.max(0, Number.isFinite(input.blendRadius) ? input.blendRadius : 4),
      blendWeight: clampRange(Number.isFinite(input.blendWeight) ? input.blendWeight : 1, 0, 1),
      enabled: input.enabled !== false,
      settings: input.settings && typeof input.settings === 'object' ? { ...input.settings } : {},
    };
  }

  function addVolume(vol) {
    const normalized = normalizeVolume(vol);
    volumes.set(normalized.id, normalized);
    return normalized.id;
  }

  function updateVolume(id, patch = {}) {
    const existing = volumes.get(String(id));
    if (!existing) return false;
    volumes.set(existing.id, normalizeVolume({
      ...existing,
      ...patch,
      id: existing.id,
      settings: patch.settings ? { ...existing.settings, ...patch.settings } : existing.settings,
    }));
    return true;
  }

  function removeVolume(id) {
    return volumes.delete(String(id));
  }

  function getVolume(id) {
    return volumes.get(String(id)) ?? null;
  }

  function clear() {
    volumes.clear();
  }

  function computeWeight(vol, position) {
    if (!vol.enabled || vol.blendWeight <= 0) return 0;
    if (vol.unbound) return vol.blendWeight;
    const sd = volumeSignedDistance(vol, position);
    if (sd <= 0) return vol.blendWeight;
    if (vol.blendRadius <= 1e-5 || sd >= vol.blendRadius) return 0;
    const u = 1 - sd / vol.blendRadius;
    const smooth = u * u * (3 - 2 * u);
    return smooth * vol.blendWeight;
  }

  function evaluate(position = [0, 0, 0], baseState = {}) {
    const out = {
      ...DEFAULT_POST_VOLUME_BASE,
      ...baseState,
      colorLift: [...(baseState.colorLift ?? DEFAULT_POST_VOLUME_BASE.colorLift)],
      colorGamma: [...(baseState.colorGamma ?? DEFAULT_POST_VOLUME_BASE.colorGamma)],
      colorGain: [...(baseState.colorGain ?? DEFAULT_POST_VOLUME_BASE.colorGain)],
    };

    const sorted = [...volumes.values()].sort((a, b) => a.priority - b.priority);
    for (const vol of sorted) {
      const w = computeWeight(vol, position);
      if (w <= 0) continue;
      const s = vol.settings;
      for (const key of POST_SCALAR_KEYS) {
        if (Number.isFinite(s[key]) && Number.isFinite(out[key])) {
          out[key] = out[key] + (s[key] - out[key]) * w;
        }
      }
      for (const key of POST_VEC3_KEYS) {
        if (Array.isArray(s[key]) && s[key].length >= 3) {
          for (let c = 0; c < 3; c++) {
            const target = Number(s[key][c]);
            if (Number.isFinite(target)) {
              out[key][c] = out[key][c] + (target - out[key][c]) * w;
            }
          }
        }
      }
      if (s.toneMapping !== undefined && w >= 0.5) out.toneMapping = s.toneMapping;
      if (s.fxaa !== undefined && w >= 0.5) out.fxaa = Boolean(s.fxaa);
    }
    return out;
  }

  function applyToPipeline(pipeline, position, baseState = {}) {
    if (!pipeline?.setState) return null;
    const evaluated = evaluate(position, baseState);
    pipeline.setState(evaluated);
    return evaluated;
  }

  for (const v of initialVolumes) addVolume(v);

  return {
    get size() { return volumes.size; },
    addVolume,
    updateVolume,
    removeVolume,
    getVolume,
    clear,
    evaluate,
    applyToPipeline,
  };
}

function resolveToneMappingIndex(mode) {
  if (mode === 'agx' || mode === 1) return 1;
  if (mode === 'none' || mode === 2) return 2;
  if (mode === 'ueFilmic' || mode === 'filmic' || mode === 3) return 3;
  return 0;
}

/**
 * Creates a clean-room WebGL2 HDR post-processing composer with automatic
 * fallback to forward rendering on non-WebGL2 or mock renderers.
 */
export function createPostPipeline3D(options = {}) {
  const {
    THREE,
    renderer,
    width = 960,
    height = 540,
    preset = QUALITY3D_PRESETS.medium,
    toneMapping = 'aces',
    exposure = 1.0,
    bloomStrength = 0.28,
    bloomThreshold = 0.85,
    bloomSoftKnee = 0.5,
    ssaoRadius = 0.5,
    ssaoBias = 0.025,
    ssaoIntensity = 0.42,
    volumetricIntensity = 0.18,
    giIntensity = 0.55,
    giRadius = 2.4,
    ssrIntensity = 0.35,
    ssrMaxDist = 28.0,
    ssrThickness = 0.35,
    contactShadows,
    contactShadowLength = 0.32,
    contactShadowThickness = 0.08,
    autoExposure = false,
    minExposure = 0.35,
    maxExposure = 2.6,
    adaptSpeedUp = 3.0,
    adaptSpeedDown = 1.4,
    keyValue = 0.18,
    exposureCompensation = 1.0,
    whiteTemp = 6500,
    whiteTint = 0,
    contrast = 1.0,
    colorLift = [0, 0, 0],
    colorGamma = [1, 1, 1],
    colorGain = [1, 1, 1],
    chromaticAberration = 0,
    filmGrain = 0,
    filmSlope = 0.88,
    filmToe = 0.55,
    filmShoulder = 0.26,
    filmBlackClip = 0.0,
    filmWhiteClip = 0.04,
    sharpness,
    vignette = 0.18,
    saturation = 1.05,
    fxaa,
  } = options;
  if (!THREE || !renderer) {
    throw new TypeError('createPostPipeline3D requires THREE and renderer');
  }
  const explicitFxaa = fxaa !== undefined;
  const explicitSharpness = sharpness !== undefined;
  const explicitContactShadows = contactShadows !== undefined;
  const capabilities = inspectWebGLCapabilities(renderer);
  const supported = Boolean(
    capabilities.isWebGL2 &&
    THREE.WebGLRenderTarget &&
    THREE.DepthTexture &&
    THREE.ShaderMaterial &&
    THREE.GLSL3 &&
    THREE.OrthographicCamera &&
    THREE.Scene &&
    THREE.Mesh &&
    THREE.BufferGeometry &&
    THREE.BufferAttribute &&
    typeof renderer.setRenderTarget === 'function'
  );

  let activePreset = preset ? { ...QUALITY3D_PRESETS.medium, ...preset } : { ...QUALITY3D_PRESETS.medium };
  let bufferWidth = Math.max(1, Math.floor(width));
  let bufferHeight = Math.max(1, Math.floor(height));
  let disposed = false;
  let elapsed = 0;
  let adaptIndex = 0;
  let adaptNeedsReset = true;

  const initialWb = computeWhiteBalanceRGB(whiteTemp, whiteTint, [1, 1, 1]);
  const state = {
    toneMapping: resolveToneMappingIndex(toneMapping),
    exposure,
    bloomStrength,
    bloomThreshold,
    bloomSoftKnee,
    ssaoRadius,
    ssaoBias,
    ssaoIntensity,
    volumetricIntensity,
    giIntensity,
    giRadius,
    ssrIntensity,
    ssrMaxDist,
    ssrThickness,
    contactShadows: explicitContactShadows ? contactShadows : (activePreset.contactShadows ? 0.65 : 0),
    contactShadowLength,
    contactShadowThickness,
    autoExposure: Boolean(autoExposure),
    minExposure,
    maxExposure,
    adaptSpeedUp,
    adaptSpeedDown,
    keyValue,
    exposureCompensation,
    whiteTemp,
    whiteTint,
    contrast,
    colorLift: [...colorLift],
    colorGamma: [...colorGamma],
    colorGain: [...colorGain],
    chromaticAberration,
    filmGrain,
    filmSlope,
    filmToe,
    filmShoulder,
    filmBlackClip,
    filmWhiteClip,
    sharpness: explicitSharpness && Number.isFinite(sharpness) ? sharpness : (activePreset.sharpen ?? 0.14),
    vignette,
    saturation,
    fxaa: explicitFxaa ? Boolean(fxaa) : (activePreset.fxaa ?? true),
    damage: 0,
    lowHealth: 0,
    focus: 0,
    flash: 0,
    fade: 0,
    sunColor: THREE.Color ? new THREE.Color(0xfff1d6) : null,
    whiteBalanceVec: THREE.Vector3 ? new THREE.Vector3(initialWb[0], initialWb[1], initialWb[2]) : null,
    liftVec: THREE.Vector3 ? new THREE.Vector3(...colorLift) : null,
    gammaVec: THREE.Vector3 ? new THREE.Vector3(...colorGamma) : null,
    gainVec: THREE.Vector3 ? new THREE.Vector3(...colorGain) : null,
  };

  let sceneRT = null;
  let halfRT = null;
  let halfBlurRT = null;
  let giSsrRT = null;
  let giSsrBlurRT = null;
  let lumaMips = [];
  let adaptRT = [];
  let ldrRT = null;
  let bloomMips = [];
  let postCamera = null;
  let postScene = null;
  let quadGeom = null;
  let quadMesh = null;
  let mats = null;
  let scratchInvProj = null;
  let scratchCamToShadow = null;
  let scratchSunView = null;

  function makeColorTarget(w, h, { type, samples = 0, depthTexture = null } = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type,
      samples,
      depthBuffer: Boolean(depthTexture),
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    if (depthTexture) rt.depthTexture = depthTexture;
    return rt;
  }

  function disposeTargets() {
    sceneRT?.depthTexture?.dispose?.();
    sceneRT?.dispose?.();
    halfRT?.dispose?.();
    halfBlurRT?.dispose?.();
    giSsrRT?.dispose?.();
    giSsrBlurRT?.dispose?.();
    ldrRT?.dispose?.();
    for (const mip of lumaMips) mip.rt?.dispose?.();
    for (const rt of adaptRT) rt?.dispose?.();
    for (const mip of bloomMips) {
      mip.down?.dispose?.();
      mip.up?.dispose?.();
    }
    sceneRT = null;
    halfRT = null;
    halfBlurRT = null;
    giSsrRT = null;
    giSsrBlurRT = null;
    lumaMips = [];
    adaptRT = [];
    ldrRT = null;
    bloomMips = [];
  }

  function buildTargets() {
    if (!supported || disposed) return;
    disposeTargets();
    const hdrType = capabilities.halfFloatRenderable && THREE.HalfFloatType
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    const msaa = Math.min(Math.max(0, activePreset.msaaSamples ?? 0), capabilities.maxSamples);
    const depthTex = new THREE.DepthTexture(bufferWidth, bufferHeight, THREE.UnsignedIntType);
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    depthTex.generateMipmaps = false;

    sceneRT = makeColorTarget(bufferWidth, bufferHeight, {
      type: hdrType,
      samples: msaa,
      depthTexture: depthTex,
    });

    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);
    if (activePreset.ssao || (activePreset.volumetricSteps ?? 0) > 0) {
      halfRT = makeColorTarget(hw, hh, { type: THREE.UnsignedByteType });
      halfBlurRT = makeColorTarget(hw, hh, { type: THREE.UnsignedByteType });
    }

    if ((activePreset.ssgi || activePreset.ssr) && (state.giIntensity > 0.001 || state.ssrIntensity > 0.001)) {
      giSsrRT = makeColorTarget(hw, hh, { type: hdrType });
      giSsrBlurRT = makeColorTarget(hw, hh, { type: hdrType });
    }

    if (state.autoExposure) {
      for (const dim of [64, 16, 4, 1]) {
        lumaMips.push({ size: dim, rt: makeColorTarget(dim, dim, { type: hdrType }) });
      }
      adaptRT = [
        makeColorTarget(1, 1, { type: hdrType }),
        makeColorTarget(1, 1, { type: hdrType }),
      ];
      adaptNeedsReset = true;
    }

    if (activePreset.bloom) {
      let mw = hw;
      let mh = hh;
      for (let i = 0; i < 4; i++) {
        const down = makeColorTarget(mw, mh, { type: hdrType });
        const up = makeColorTarget(mw, mh, { type: hdrType });
        bloomMips.push({ w: mw, h: mh, down, up });
        if (mw === 1 && mh === 1) break;
        mw = Math.max(1, mw >> 1);
        mh = Math.max(1, mh >> 1);
      }
    }

    if (state.fxaa || state.sharpness > 0.001) {
      ldrRT = makeColorTarget(bufferWidth, bufferHeight, { type: THREE.UnsignedByteType });
    }
  }

  function initMaterials() {
    if (!supported) return;
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    quadGeom = createFullscreenTriangle(THREE);

    const makeShader = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX_GLSL3,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    scratchInvProj = new THREE.Matrix4();
    scratchCamToShadow = new THREE.Matrix4();
    scratchSunView = new THREE.Vector3(0, 1, 0);

    mats = {
      aoVol: makeShader(HALF_AO_VOL_FRAGMENT_GLSL3, {
        tDepth: { value: null },
        tSunShadow: { value: null },
        uInvProj: { value: scratchInvProj },
        uProj: { value: new THREE.Matrix4() },
        uCamToShadow: { value: scratchCamToShadow },
        uSunViewDir: { value: scratchSunView },
        uResolution: { value: new THREE.Vector2(bufferWidth, bufferHeight) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uSsaoEnabled: { value: 0 },
        uSsaoRadius: { value: state.ssaoRadius },
        uSsaoBias: { value: state.ssaoBias },
        uVolumetricSteps: { value: 0 },
        uHasSunShadow: { value: 0 },
        uTime: { value: 0 },
      }),
      blur: makeShader(BILATERAL_BLUR_FRAGMENT_GLSL3, {
        tInput: { value: null },
        uTexelStep: { value: new THREE.Vector2(1 / bufferWidth, 0) },
      }),
      giSsr: makeShader(HALF_GI_SSR_FRAGMENT_GLSL3, {
        tScene: { value: null },
        tDepth: { value: null },
        uInvProj: { value: scratchInvProj },
        uProj: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(bufferWidth, bufferHeight) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uSsgiEnabled: { value: 0 },
        uSsrEnabled: { value: 0 },
        uGiRadius: { value: state.giRadius },
        uGiIntensity: { value: state.giIntensity },
        uSsrIntensity: { value: state.ssrIntensity },
        uSsrMaxDist: { value: state.ssrMaxDist },
        uSsrThickness: { value: state.ssrThickness },
        uTime: { value: 0 },
      }),
      blurRgba: makeShader(BILATERAL_RGBA_BLUR_FRAGMENT_GLSL3, {
        tInput: { value: null },
        uTexelStep: { value: new THREE.Vector2(1 / bufferWidth, 0) },
      }),
      lumaExtract: makeShader(LUMA_EXTRACT_FRAGMENT_GLSL3, {
        tScene: { value: null },
      }),
      boxDown: makeShader(BOX4_DOWNSAMPLE_FRAGMENT_GLSL3, {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / 64, 1 / 64) },
      }),
      eyeAdapt: makeShader(EYE_ADAPT_FRAGMENT_GLSL3, {
        tAvgLogLuma: { value: null },
        tPrevAdapt: { value: null },
        uDt: { value: 1 / 60 },
        uKeyValue: { value: state.keyValue },
        uExposureComp: { value: state.exposureCompensation },
        uMinExposure: { value: state.minExposure },
        uMaxExposure: { value: state.maxExposure },
        uAdaptSpeedUp: { value: state.adaptSpeedUp },
        uAdaptSpeedDown: { value: state.adaptSpeedDown },
        uResetAdapt: { value: 1 },
      }),
      prefilter: makeShader(BLOOM_PREFILTER_FRAGMENT_GLSL3, {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
        uThreshold: { value: state.bloomThreshold },
        uSoftKnee: { value: state.bloomSoftKnee },
      }),
      downsample: makeShader(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL3, {
        tSource: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
      }),
      upsample: makeShader(BLOOM_UPSAMPLE_FRAGMENT_GLSL3, {
        tLower: { value: null },
        tUpper: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
      }),
      composite: makeShader(COMPOSITE_FRAGMENT_GLSL3, {
        tScene: { value: null },
        tDepth: { value: null },
        tAoVol: { value: null },
        tGiSsr: { value: null },
        tBloom: { value: null },
        tAutoExposure: { value: null },
        uInvProj: { value: scratchInvProj },
        uProj: { value: new THREE.Matrix4() },
        uSunViewDir: { value: scratchSunView },
        uSunColor: { value: state.sunColor },
        uWhiteBalance: { value: state.whiteBalanceVec },
        uColorLift: { value: state.liftVec },
        uColorGamma: { value: state.gammaVec },
        uColorGain: { value: state.gainVec },
        uUseAo: { value: 0 },
        uUseVolumetric: { value: 0 },
        uUseGiSsr: { value: 0 },
        uUseBloom: { value: 0 },
        uUseAutoExposure: { value: 0 },
        uHasSunDir: { value: 0 },
        uContactShadows: { value: state.contactShadows },
        uContactShadowLength: { value: state.contactShadowLength },
        uContactShadowThickness: { value: state.contactShadowThickness },
        uSsaoIntensity: { value: state.ssaoIntensity },
        uVolumetricIntensity: { value: state.volumetricIntensity },
        uBloomStrength: { value: state.bloomStrength },
        uExposure: { value: state.exposure },
        uContrast: { value: state.contrast },
        uSaturation: { value: state.saturation },
        uChromaticAberration: { value: state.chromaticAberration },
        uFilmGrain: { value: state.filmGrain },
        uFilmSlope: { value: state.filmSlope },
        uFilmToe: { value: state.filmToe },
        uFilmShoulder: { value: state.filmShoulder },
        uFilmBlackClip: { value: state.filmBlackClip },
        uFilmWhiteClip: { value: state.filmWhiteClip },
        uVignette: { value: state.vignette },
        uDamage: { value: 0 },
        uLowHealth: { value: 0 },
        uFocus: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 0 },
        uTime: { value: 0 },
        uToneMapping: { value: state.toneMapping },
      }),
      fxaaSharpen: makeShader(FXAA_SHARPEN_FRAGMENT_GLSL3, {
        tDiffuse: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight) },
        uSharpness: { value: state.sharpness },
        uFxaaEnabled: { value: state.fxaa ? 1 : 0 },
      }),
    };

    quadMesh = new THREE.Mesh(quadGeom, mats.composite);
    quadMesh.frustumCulled = false;
    postScene.add(quadMesh);
    buildTargets();
  }

  initMaterials();

  function runPass(material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCamera);
  }

  function resize(w, h) {
    if (disposed) return;
    const nw = Math.max(1, Math.floor(w));
    const nh = Math.max(1, Math.floor(h));
    if (nw === bufferWidth && nh === bufferHeight && sceneRT) return;
    bufferWidth = nw;
    bufferHeight = nh;
    buildTargets();
  }

  function setPreset(nextPreset) {
    if (disposed || !nextPreset) return;
    activePreset = { ...QUALITY3D_PRESETS.medium, ...nextPreset };
    if (!explicitFxaa && 'fxaa' in activePreset) {
      state.fxaa = Boolean(activePreset.fxaa);
    }
    if (!explicitSharpness && Number.isFinite(activePreset.sharpen)) {
      state.sharpness = activePreset.sharpen;
    }
    if (!explicitContactShadows && 'contactShadows' in activePreset) {
      state.contactShadows = activePreset.contactShadows ? 0.65 : 0;
    }
    buildTargets();
  }

  function setState(patch = {}) {
    if (disposed || !patch || typeof patch !== 'object') return;
    let needTargetRebuild = false;
    if ('fxaa' in patch) {
      const nextFxaa = Boolean(patch.fxaa);
      if (nextFxaa !== state.fxaa) needTargetRebuild = true;
      state.fxaa = nextFxaa;
    }
    if ('autoExposure' in patch) {
      const nextAuto = Boolean(patch.autoExposure);
      if (nextAuto !== state.autoExposure) needTargetRebuild = true;
      state.autoExposure = nextAuto;
    }
    if ('toneMapping' in patch) {
      state.toneMapping = resolveToneMappingIndex(patch.toneMapping);
    }
    if (patch.sunColor !== undefined && state.sunColor?.set) state.sunColor.set(patch.sunColor);

    if (Array.isArray(patch.colorLift) && patch.colorLift.length >= 3) {
      state.colorLift[0] = patch.colorLift[0];
      state.colorLift[1] = patch.colorLift[1];
      state.colorLift[2] = patch.colorLift[2];
      state.liftVec?.set(state.colorLift[0], state.colorLift[1], state.colorLift[2]);
    }
    if (Array.isArray(patch.colorGamma) && patch.colorGamma.length >= 3) {
      state.colorGamma[0] = patch.colorGamma[0];
      state.colorGamma[1] = patch.colorGamma[1];
      state.colorGamma[2] = patch.colorGamma[2];
      state.gammaVec?.set(state.colorGamma[0], state.colorGamma[1], state.colorGamma[2]);
    }
    if (Array.isArray(patch.colorGain) && patch.colorGain.length >= 3) {
      state.colorGain[0] = patch.colorGain[0];
      state.colorGain[1] = patch.colorGain[1];
      state.colorGain[2] = patch.colorGain[2];
      state.gainVec?.set(state.colorGain[0], state.colorGain[1], state.colorGain[2]);
    }

    for (const key of [
      'exposure', 'bloomStrength', 'bloomThreshold', 'bloomSoftKnee',
      'ssaoRadius', 'ssaoBias', 'ssaoIntensity', 'volumetricIntensity',
      'giIntensity', 'giRadius', 'ssrIntensity', 'ssrMaxDist', 'ssrThickness',
      'contactShadows', 'contactShadowLength', 'contactShadowThickness',
      'minExposure', 'maxExposure', 'adaptSpeedUp', 'adaptSpeedDown', 'keyValue', 'exposureCompensation',
      'whiteTemp', 'whiteTint', 'contrast', 'chromaticAberration', 'filmGrain',
      'filmSlope', 'filmToe', 'filmShoulder', 'filmBlackClip', 'filmWhiteClip',
      'sharpness', 'vignette', 'saturation', 'damage', 'lowHealth',
      'focus', 'flash', 'fade',
    ]) {
      if (Number.isFinite(patch[key])) {
        if (key === 'sharpness' && ((state.sharpness > 0.001) !== (patch.sharpness > 0.001))) {
          needTargetRebuild = true;
        }
        if ((key === 'giIntensity' || key === 'ssrIntensity') && (activePreset.ssgi || activePreset.ssr)) {
          const hadGi = state.giIntensity > 0.001 || state.ssrIntensity > 0.001;
          state[key] = patch[key];
          const hasGi = state.giIntensity > 0.001 || state.ssrIntensity > 0.001;
          if (hadGi !== hasGi) needTargetRebuild = true;
          continue;
        }
        state[key] = patch[key];
      }
    }

    if ('whiteTemp' in patch || 'whiteTint' in patch) {
      const wb = computeWhiteBalanceRGB(state.whiteTemp, state.whiteTint, [1, 1, 1]);
      state.whiteBalanceVec?.set(wb[0], wb[1], wb[2]);
    }

    if (needTargetRebuild) buildTargets();
  }

  function renderForwardWithViewmodel(world, camera, viewScene, viewCamera) {
    const prevAutoClear = renderer.autoClear;
    const gl = renderer.getContext?.();
    try {
      renderer.render(world, camera);
      if (viewScene && viewCamera) {
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        renderer.render(viewScene, viewCamera);
      }
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.autoClear = prevAutoClear;
    }
  }

  function render(world, camera, { viewScene = null, viewCamera = null, sunLight = null, dt = 0 } = {}) {
    if (disposed) return;
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (stepDt > 0) elapsed += stepDt;
    if (!supported || !sceneRT) {
      renderForwardWithViewmodel(world, camera, viewScene, viewCamera);
      return;
    }

    const gl = renderer.getContext?.();
    const prevAutoClear = renderer.autoClear;
    const prevToneMapping = renderer.toneMapping;
    const hw = Math.max(1, bufferWidth >> 1);
    const hh = Math.max(1, bufferHeight >> 1);

    try {
      renderer.setRenderTarget(sceneRT);
      renderer.autoClear = true;
      renderer.clear(true, true, false);
      renderer.render(world, camera);

      if (viewScene && viewCamera) {
        renderer.autoClear = false;
        renderer.clearDepth?.();
        gl?.depthRange?.(0, 0.05);
        renderer.render(viewScene, viewCamera);
        gl?.depthRange?.(0, 1);
      }

      camera.updateMatrixWorld?.();
      scratchInvProj.copy(camera.projectionMatrixInverse);
      const hasSunDir = Boolean(sunLight?.position);
      if (hasSunDir) {
        scratchSunView.set(
          sunLight.position.x - (sunLight.target?.position?.x ?? 0),
          sunLight.position.y - (sunLight.target?.position?.y ?? 0),
          sunLight.position.z - (sunLight.target?.position?.z ?? 0),
        ).normalize().transformDirection(camera.matrixWorldInverse);
        if (sunLight.color && state.sunColor) state.sunColor.copy(sunLight.color);
      }

      // 1. Half-res SSAO + Volumetric sun shafts + separable bilateral blur
      const useAo = Boolean(activePreset.ssao && halfRT && halfBlurRT);
      const volSteps = activePreset.volumetricSteps ?? 0;
      const sunShadowTex = sunLight?.shadow?.map?.texture ?? null;
      const useVolumetric = Boolean(volSteps > 0 && sunShadowTex && halfRT && halfBlurRT);

      renderer.autoClear = false;
      if (useAo || useVolumetric) {
        mats.aoVol.uniforms.tDepth.value = sceneRT.depthTexture;
        mats.aoVol.uniforms.uProj.value.copy(camera.projectionMatrix);
        mats.aoVol.uniforms.uResolution.value.set(hw, hh);
        mats.aoVol.uniforms.uNear.value = camera.near ?? 0.1;
        mats.aoVol.uniforms.uFar.value = camera.far ?? 1000;
        mats.aoVol.uniforms.uSsaoEnabled.value = useAo ? 1 : 0;
        mats.aoVol.uniforms.uSsaoRadius.value = state.ssaoRadius;
        mats.aoVol.uniforms.uSsaoBias.value = state.ssaoBias;
        mats.aoVol.uniforms.uVolumetricSteps.value = useVolumetric ? volSteps : 0;
        mats.aoVol.uniforms.uTime.value = elapsed;

        if (useVolumetric && sunLight?.shadow?.matrix) {
          scratchCamToShadow.multiplyMatrices(sunLight.shadow.matrix, camera.matrixWorld);
          mats.aoVol.uniforms.tSunShadow.value = sunShadowTex;
          mats.aoVol.uniforms.uHasSunShadow.value = 1;
        } else {
          mats.aoVol.uniforms.tSunShadow.value = null;
          mats.aoVol.uniforms.uHasSunShadow.value = 0;
        }

        runPass(mats.aoVol, halfRT);

        mats.blur.uniforms.tInput.value = halfRT.texture;
        mats.blur.uniforms.uTexelStep.value.set(1 / hw, 0);
        runPass(mats.blur, halfBlurRT);

        mats.blur.uniforms.tInput.value = halfBlurRT.texture;
        mats.blur.uniforms.uTexelStep.value.set(0, 1 / hh);
        runPass(mats.blur, halfRT);
      }

      // 1b. Half-res HDR SSGI + SSR bounce reflections + depth-guided bilateral denoise
      const useGiSsr = Boolean(
        (activePreset.ssgi || activePreset.ssr) &&
        giSsrRT &&
        giSsrBlurRT &&
        (state.giIntensity > 0.001 || state.ssrIntensity > 0.001),
      );
      if (useGiSsr) {
        const giU = mats.giSsr.uniforms;
        giU.tScene.value = sceneRT.texture;
        giU.tDepth.value = sceneRT.depthTexture;
        giU.uProj.value.copy(camera.projectionMatrix);
        giU.uResolution.value.set(hw, hh);
        giU.uNear.value = camera.near ?? 0.1;
        giU.uFar.value = camera.far ?? 1000;
        giU.uSsgiEnabled.value = activePreset.ssgi ? 1 : 0;
        giU.uSsrEnabled.value = activePreset.ssr ? 1 : 0;
        giU.uGiRadius.value = state.giRadius;
        giU.uGiIntensity.value = state.giIntensity;
        giU.uSsrIntensity.value = state.ssrIntensity;
        giU.uSsrMaxDist.value = state.ssrMaxDist;
        giU.uSsrThickness.value = state.ssrThickness;
        giU.uTime.value = elapsed;
        runPass(mats.giSsr, giSsrRT);

        mats.blurRgba.uniforms.tInput.value = giSsrRT.texture;
        mats.blurRgba.uniforms.uTexelStep.value.set(1 / hw, 0);
        runPass(mats.blurRgba, giSsrBlurRT);

        mats.blurRgba.uniforms.tInput.value = giSsrBlurRT.texture;
        mats.blurRgba.uniforms.uTexelStep.value.set(0, 1 / hh);
        runPass(mats.blurRgba, giSsrRT);
      }

      // 1c. GPU Eye Adaptation / Auto-Exposure pyramid
      const useAutoExposure = Boolean(state.autoExposure && lumaMips.length > 0 && adaptRT.length === 2);
      if (useAutoExposure) {
        mats.lumaExtract.uniforms.tScene.value = sceneRT.texture;
        runPass(mats.lumaExtract, lumaMips[0].rt);
        for (let i = 1; i < lumaMips.length; i++) {
          const prev = lumaMips[i - 1];
          const curr = lumaMips[i];
          mats.boxDown.uniforms.tSource.value = prev.rt.texture;
          mats.boxDown.uniforms.uTexelSize.value.set(1 / prev.size, 1 / prev.size);
          runPass(mats.boxDown, curr.rt);
        }
        const prevAdapt = adaptRT[adaptIndex];
        const nextAdapt = adaptRT[adaptIndex ^ 1];
        const adaptU = mats.eyeAdapt.uniforms;
        adaptU.tAvgLogLuma.value = lumaMips[lumaMips.length - 1].rt.texture;
        adaptU.tPrevAdapt.value = prevAdapt.texture;
        adaptU.uDt.value = stepDt > 0 ? stepDt : 1 / 60;
        adaptU.uKeyValue.value = state.keyValue;
        adaptU.uExposureComp.value = state.exposureCompensation;
        adaptU.uMinExposure.value = state.minExposure;
        adaptU.uMaxExposure.value = state.maxExposure;
        adaptU.uAdaptSpeedUp.value = state.adaptSpeedUp;
        adaptU.uAdaptSpeedDown.value = state.adaptSpeedDown;
        adaptU.uResetAdapt.value = adaptNeedsReset ? 1 : 0;
        runPass(mats.eyeAdapt, nextAdapt);
        adaptIndex ^= 1;
        adaptNeedsReset = false;
      }

      // 2. Multi-mip Karis-average Bloom pyramid
      const useBloom = Boolean(activePreset.bloom && bloomMips.length > 0);
      if (useBloom) {
        mats.prefilter.uniforms.tSource.value = sceneRT.texture;
        mats.prefilter.uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
        mats.prefilter.uniforms.uThreshold.value = state.bloomThreshold;
        mats.prefilter.uniforms.uSoftKnee.value = state.bloomSoftKnee;
        runPass(mats.prefilter, bloomMips[0].down);

        for (let i = 1; i < bloomMips.length; i++) {
          const prev = bloomMips[i - 1];
          const curr = bloomMips[i];
          mats.downsample.uniforms.tSource.value = prev.down.texture;
          mats.downsample.uniforms.uTexelSize.value.set(1 / prev.w, 1 / prev.h);
          runPass(mats.downsample, curr.down);
        }

        let accumTex = bloomMips[bloomMips.length - 1].down.texture;
        let accumW = bloomMips[bloomMips.length - 1].w;
        let accumH = bloomMips[bloomMips.length - 1].h;
        for (let i = bloomMips.length - 2; i >= 0; i--) {
          const curr = bloomMips[i];
          mats.upsample.uniforms.tLower.value = accumTex;
          mats.upsample.uniforms.tUpper.value = curr.down.texture;
          mats.upsample.uniforms.uTexelSize.value.set(1 / accumW, 1 / accumH);
          runPass(mats.upsample, curr.up);
          accumTex = curr.up.texture;
          accumW = curr.w;
          accumH = curr.h;
        }
      }

      // 3. Composite HDR + contact shadows + GI/SSR + grading + UE Filmic/ACES/AgX tone mapping
      const useFinalFxaaPass = Boolean(ldrRT && (state.fxaa || state.sharpness > 0.001));
      const compU = mats.composite.uniforms;
      compU.tScene.value = sceneRT.texture;
      compU.tDepth.value = sceneRT.depthTexture;
      compU.tAoVol.value = (useAo || useVolumetric) ? halfRT.texture : null;
      compU.tGiSsr.value = useGiSsr ? giSsrRT.texture : null;
      compU.tBloom.value = useBloom
        ? (bloomMips.length > 1 ? bloomMips[0].up.texture : bloomMips[0].down.texture)
        : null;
      compU.tAutoExposure.value = useAutoExposure ? adaptRT[adaptIndex].texture : null;
      compU.uProj.value.copy(camera.projectionMatrix);
      compU.uUseAo.value = useAo ? 1 : 0;
      compU.uUseVolumetric.value = useVolumetric ? 1 : 0;
      compU.uUseGiSsr.value = useGiSsr ? 1 : 0;
      compU.uUseBloom.value = useBloom ? 1 : 0;
      compU.uUseAutoExposure.value = useAutoExposure ? 1 : 0;
      compU.uHasSunDir.value = hasSunDir ? 1 : 0;
      compU.uContactShadows.value = state.contactShadows;
      compU.uContactShadowLength.value = state.contactShadowLength;
      compU.uContactShadowThickness.value = state.contactShadowThickness;
      compU.uSsaoIntensity.value = state.ssaoIntensity;
      compU.uVolumetricIntensity.value = state.volumetricIntensity;
      compU.uBloomStrength.value = state.bloomStrength;
      compU.uExposure.value = state.exposure;
      compU.uContrast.value = state.contrast;
      compU.uSaturation.value = state.saturation;
      compU.uChromaticAberration.value = state.chromaticAberration;
      compU.uFilmGrain.value = state.filmGrain;
      compU.uFilmSlope.value = state.filmSlope;
      compU.uFilmToe.value = state.filmToe;
      compU.uFilmShoulder.value = state.filmShoulder;
      compU.uFilmBlackClip.value = state.filmBlackClip;
      compU.uFilmWhiteClip.value = state.filmWhiteClip;
      compU.uVignette.value = state.vignette;
      compU.uDamage.value = state.damage;
      compU.uLowHealth.value = state.lowHealth;
      compU.uFocus.value = state.focus;
      compU.uFlash.value = state.flash;
      compU.uFade.value = state.fade;
      compU.uTime.value = elapsed;
      compU.uToneMapping.value = state.toneMapping;
      runPass(mats.composite, useFinalFxaaPass ? ldrRT : null);

      // 4. FXAA + edge-attenuated unsharp mask + IGN dither
      if (useFinalFxaaPass) {
        mats.fxaaSharpen.uniforms.tDiffuse.value = ldrRT.texture;
        mats.fxaaSharpen.uniforms.uTexelSize.value.set(1 / bufferWidth, 1 / bufferHeight);
        mats.fxaaSharpen.uniforms.uSharpness.value = state.sharpness;
        mats.fxaaSharpen.uniforms.uFxaaEnabled.value = state.fxaa ? 1 : 0;
        runPass(mats.fxaaSharpen, null);
      }
    } finally {
      gl?.depthRange?.(0, 1);
      renderer.setRenderTarget(null);
      renderer.autoClear = prevAutoClear;
      if (prevToneMapping !== undefined) renderer.toneMapping = prevToneMapping;
    }
  }

  function handleContextLost() {
    disposeTargets();
  }

  function handleContextRestored() {
    if (!disposed && supported) buildTargets();
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    disposeTargets();
    quadGeom?.dispose?.();
    if (mats) for (const mat of Object.values(mats)) mat.dispose?.();
    mats = null;
    quadGeom = null;
    quadMesh = null;
    postScene = null;
    postCamera = null;
    return true;
  }

  return {
    get supported() { return supported; },
    get capabilities() { return capabilities; },
    get preset() { return activePreset; },
    get state() { return { ...state }; },
    get targets() {
      return {
        bufferWidth,
        bufferHeight,
        hasSceneRT: Boolean(sceneRT),
        hasHalfRT: Boolean(halfRT),
        hasGiSsrRT: Boolean(giSsrRT),
        hasAutoExposureRT: Boolean(lumaMips.length > 0 && adaptRT.length === 2),
        bloomMipCount: bloomMips.length,
        hasLdrRT: Boolean(ldrRT),
      };
    },
    resize,
    setPreset,
    setState,
    render,
    handleContextLost,
    handleContextRestored,
    dispose,
  };
}

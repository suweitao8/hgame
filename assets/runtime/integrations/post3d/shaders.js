/** GLSL3 shader sources for the post-processing pipeline. */
export const FULLSCREEN_VERTEX_GLSL3 = `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DEPTH_GUIDE_GLSL3 = `
// Reserve 1 for the sky. Log depth preserves nearby separation with 8-bit storage.
float encodeDepthGuide(float depth, float viewZ) {
  if (depth >= 1.0) return 1.0;
  return min(log2(1.0 + max(0.0, -viewZ)) / 16.0, 254.0 / 255.0);
}

vec2 packDepthGuide(float guide) {
  float scaled = guide * 255.0;
  return vec2(floor(scaled) / 255.0, fract(scaled));
}

float unpackDepthGuide(vec2 channels) {
  return channels.x + channels.y / 255.0;
}

float depthGuideWeight(float sampleGuide, float centerGuide, float quantization) {
  if (sampleGuide == 1.0 || centerGuide == 1.0) {
    return sampleGuide == centerGuide ? 1.0 : 0.0;
  }
  float delta = max(0.0, abs(sampleGuide - centerGuide) - quantization);
  return 1.0 - smoothstep(0.0015, 0.009, delta);
}

#ifdef HGAME_BYTE_GI_DEPTH
const float GI_DEPTH_PRECISION = 1.0 / 255.0;
#else
const float GI_DEPTH_PRECISION = 0.0005;
#endif
const float AO_DEPTH_PRECISION = 0.00002;
`;

export const HALF_AO_VOL_FRAGMENT_GLSL3 = `
uniform sampler2D tDepth;
#ifdef HGAME_SHADOW_COMPARE
uniform highp sampler2DShadow tSunShadow;
#else
uniform sampler2D tSunShadow;
#endif
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform mat4 uCamToShadow;
uniform vec3 uSunViewDir;
uniform vec2 uResolution;
uniform float uSsaoEnabled;
uniform float uSsaoRadius;
uniform float uSsaoBias;
uniform float uVolumetricSteps;
uniform float uShadowDepthSign;
uniform float uTime;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

${DEPTH_GUIDE_GLSL3}

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

void main() {
  float depth = texture(tDepth, vUv).r;
  vec3 viewPos = reconstructViewPos(vUv, depth);
  float ao = 1.0;

  if (uSsaoEnabled > 0.5 && depth < 1.0) {
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
        if (sView.z >= samplePos.z + uSsaoBias && sDepth < 1.0) {
          occlusion += rangeCheck;
        }
        weightSum += 1.0;
      }
    }
    ao = 1.0 - clamp(occlusion / max(weightSum, 1.0), 0.0, 1.0);
  }

  float vol = 0.0;
  if (uVolumetricSteps > 0.5) {
    int steps = int(clamp(uVolumetricSteps, 1.0, 32.0));
    vec3 rayDir = normalize(viewPos);
    float hitDist = depth >= 1.0 ? 48.0 : min(length(viewPos), 48.0);
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
      vec4 shadowCoord = uCamToShadow * vec4(pView, 1.0);
      if (shadowCoord.w <= 0.0) continue;
      // Three.js's shadow matrix already maps into texture coordinates.
      vec3 sc = shadowCoord.xyz / shadowCoord.w;
      if (all(greaterThanEqual(sc, vec3(0.0))) && all(lessThanEqual(sc, vec3(1.0)))) {
        float receiverDepth = sc.z - 0.0025 * uShadowDepthSign;
        #ifdef HGAME_SHADOW_COMPARE
          accum += texture(tSunShadow, vec3(sc.xy, receiverDepth));
        #else
          float mapDepth = texture(tSunShadow, sc.xy).r;
          accum += step(0.0, (mapDepth - receiverDepth) * uShadowDepthSign);
        #endif
      }
    }
    vol = (accum / float(steps)) * clamp(phase * 1.4, 0.05, 1.25) * clamp(hitDist / 24.0, 0.0, 1.0);
  }

  fragColor = vec4(ao, vol, packDepthGuide(encodeDepthGuide(depth, viewPos.z)));
}
`;

export const HALF_GI_SSR_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec2 uResolution;
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

${DEPTH_GUIDE_GLSL3}

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

void main() {
  float depth = texture(tDepth, vUv).r;
  if (depth >= 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
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
        if (sDepth < 1.0) {
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
        if (sDepth < 1.0) {
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

  fragColor = vec4(giAccum * uGiIntensity + ssrColor * uSsrIntensity, encodeDepthGuide(depth, viewPos.z));
}
`;

export const BILATERAL_BLUR_FRAGMENT_GLSL3 = `
uniform sampler2D tInput;
uniform ivec2 uAxis;

layout(location = 0) out vec4 fragColor;

${DEPTH_GUIDE_GLSL3}

float blurGuide(vec4 value) {
#ifdef HGAME_BLUR_GI
  return value.a;
#else
  return unpackDepthGuide(value.ba);
#endif
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(tInput, 0) - ivec2(1);
  vec4 center = texelFetch(tInput, pixel, 0);
  float centerGuide = blurGuide(center);
#ifdef HGAME_BLUR_GI
  const float quantization = GI_DEPTH_PRECISION;
#else
  const float quantization = AO_DEPTH_PRECISION;
#endif
  const float W[3] = float[3](0.4026, 0.2442, 0.0545);
  vec3 accum = center.rgb * W[0];
  float wSum = W[0];
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    int idx = i < 0 ? -i : i;
    vec4 s = texelFetch(tInput, clamp(pixel + uAxis * i, ivec2(0), last), 0);
    float w = W[idx] * depthGuideWeight(blurGuide(s), centerGuide, quantization);
    accum += s.rgb * w;
    wSum += w;
  }
  vec3 blurred = accum / wSum;
#ifdef HGAME_BLUR_GI
  fragColor = vec4(blurred, center.a);
#else
  fragColor = vec4(blurred.rg, center.ba);
#endif
}
`;

const EXPOSURE_PACKING_GLSL3 = `
#ifdef HGAME_EXPOSURE_UNORM
const vec2 LOG_LUMA_RANGE = vec2(-14.0, 14.0);

vec2 packExposureScalar(float value, vec2 range) {
  float span = range.y - range.x;
  float scaled = span > 0.0 ? clamp((value - range.x) / span, 0.0, 1.0) * 255.0 : 0.0;
  return vec2(floor(scaled) / 255.0, fract(scaled));
}

float unpackExposureScalar(vec2 encoded, vec2 range) {
  return mix(range.x, range.y, encoded.x + encoded.y / 255.0);
}
#endif
`;

const LUMA_REDUCTION_GLSL3 = `
float reduceLogLuma(sampler2D source, vec2 uv) {
  // Four bilinear reads cover the four 2x2 quadrants of a 4x4 block.
  vec2 d = 1.0 / vec2(textureSize(source, 0));
  vec2 avg = 0.25 * (
    texture(source, uv + vec2(-d.x, -d.y)).rg +
    texture(source, uv + vec2( d.x, -d.y)).rg +
    texture(source, uv + vec2(-d.x,  d.y)).rg +
    texture(source, uv + vec2( d.x,  d.y)).rg
  );
#ifdef HGAME_EXPOSURE_UNORM
  return unpackExposureScalar(avg, LOG_LUMA_RANGE);
#else
  return avg.r;
#endif
}
`;

export const LUMA_EXTRACT_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

${EXPOSURE_PACKING_GLSL3}

void main() {
  vec3 hdr = max(vec3(0.0), texture(tScene, vUv).rgb);
  float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  vec2 c = vUv * 2.0 - 1.0;
  float meterWeight = clamp(1.15 - 0.55 * dot(c, c), 0.25, 1.15);
  float logLuma = log2(max(luma * meterWeight, 1e-4));
#ifdef HGAME_EXPOSURE_UNORM
  fragColor = vec4(packExposureScalar(logLuma, LOG_LUMA_RANGE), 0.0, 1.0);
#else
  fragColor = vec4(logLuma, logLuma, logLuma, 1.0);
#endif
}
`;

export const LUMA_DOWNSAMPLE_FRAGMENT_GLSL3 = `
uniform sampler2D tSource;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

${EXPOSURE_PACKING_GLSL3}
${LUMA_REDUCTION_GLSL3}

void main() {
  float avg = reduceLogLuma(tSource, vUv);
#ifdef HGAME_EXPOSURE_UNORM
  fragColor = vec4(packExposureScalar(avg, LOG_LUMA_RANGE), 0.0, 1.0);
#else
  fragColor = vec4(avg, avg, avg, 1.0);
#endif
}
`;

export const EYE_ADAPT_FRAGMENT_GLSL3 = `
uniform sampler2D tLogLuma;
uniform sampler2D tPrevAdapt;
#ifdef HGAME_EXPOSURE_UNORM
uniform vec2 uStoredExposureRange;
#endif
uniform float uDt;
uniform float uKeyValue;
uniform float uExposureComp;
uniform float uMinExposure;
uniform float uMaxExposure;
uniform float uAdaptSpeedUp;
uniform float uAdaptSpeedDown;
uniform float uResetAdapt;

layout(location = 0) out vec4 fragColor;

${EXPOSURE_PACKING_GLSL3}
${LUMA_REDUCTION_GLSL3}

void main() {
  float avgLog = reduceLogLuma(tLogLuma, vec2(0.5));
  float avgLuma = clamp(exp2(avgLog), 1e-4, 1e4);
  float targetExp = clamp((uKeyValue / avgLuma) * uExposureComp, uMinExposure, uMaxExposure);
  float prevExp = targetExp;
  if (uResetAdapt < 0.5) {
    vec2 stored = texelFetch(tPrevAdapt, ivec2(0), 0).rg;
#ifdef HGAME_EXPOSURE_UNORM
    prevExp = unpackExposureScalar(stored, uStoredExposureRange);
#else
    prevExp = stored.r;
#endif
    prevExp = clamp(prevExp, uMinExposure, uMaxExposure);
  }
  float speed = targetExp > prevExp ? uAdaptSpeedDown : uAdaptSpeedUp;
  float alpha = 1.0 - exp(-max(0.0, uDt) * max(0.05, speed));
  float nextExp = prevExp + (targetExp - prevExp) * alpha;
#ifdef HGAME_EXPOSURE_UNORM
  fragColor = vec4(packExposureScalar(nextExp, vec2(uMinExposure, uMaxExposure)), 0.0, 1.0);
#else
  fragColor = vec4(nextExp, avgLuma, targetExp, 1.0);
#endif
}
`;

export const BLOOM_PREFILTER_FRAGMENT_GLSL3 = `
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

export const BLOOM_DOWNSAMPLE_FRAGMENT_GLSL3 = `
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

export const BLOOM_UPSAMPLE_FRAGMENT_GLSL3 = `
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

export const COMPOSITE_FRAGMENT_GLSL3 = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAoVol;
uniform sampler2D tGiSsr;
uniform sampler2D tBloom;
uniform sampler2D tAutoExposure;
#ifdef HGAME_EXPOSURE_UNORM
uniform vec2 uStoredExposureRange;
#endif
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

${EXPOSURE_PACKING_GLSL3}
${DEPTH_GUIDE_GLSL3}

float compIgn(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 compReconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  return view.xyz / max(abs(view.w), 1e-5);
}

vec3 upsampleHalfLighting(sampler2D effect, float centerGuide, bool packedGuide) {
  ivec2 size = textureSize(effect, 0);
  vec2 halfPixel = vUv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(halfPixel));
  vec2 fraction = fract(halfPixel);
  vec3 neutral = packedGuide ? vec3(1.0, 0.0, 0.0) : vec3(0.0);
  float quantization = packedGuide ? AO_DEPTH_PRECISION : GI_DEPTH_PRECISION;
  vec3 accum = vec3(0.0);
  float weightSum = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 corner = ivec2(i & 1, i >> 1);
    vec2 axisWeight = mix(1.0 - fraction, fraction, vec2(corner));
    ivec2 pixel = clamp(base + corner, ivec2(0), size - ivec2(1));
    vec4 tap = texelFetch(effect, pixel, 0);
    float guide = packedGuide ? unpackDepthGuide(tap.ba) : tap.a;
    float weight = axisWeight.x * axisWeight.y * depthGuideWeight(guide, centerGuide, quantization);
    accum += (tap.rgb - neutral) * weight;
    weightSum += weight;
  }
  // An isolated full-resolution surface may have no matching half-resolution texel.
  return neutral + accum / max(weightSum, 0.0625);
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

vec3 applyWorldLighting(vec3 hdr) {
  float lumaHdr = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  bool useAoVol = uUseAo > 0.5 || uUseVolumetric > 0.5;
  bool useGiSsr = uUseGiSsr > 0.5;
  bool useContact = uContactShadows > 0.001 && uHasSunDir > 0.5;
  float depth = (useAoVol || useGiSsr || useContact) ? texture(tDepth, vUv).r : 1.0;
  vec3 viewPos = depth < 1.0 ? compReconstructViewPos(vUv, depth) : vec3(0.0);
  float guide = (useAoVol || useGiSsr) ? encodeDepthGuide(depth, viewPos.z) : 1.0;

  if (useGiSsr && depth < 1.0) {
    vec3 giSsr = max(vec3(0.0), upsampleHalfLighting(tGiSsr, guide, false));
    hdr += giSsr;
  }

  if (useContact && depth < 1.0) {
    float jitter = compIgn(gl_FragCoord.xy + vec2(fract(uTime) * 13.0, 5.0));
    float rayLen = clamp(uContactShadowLength, 0.05, 1.5);
    float thickness = clamp(uContactShadowThickness, 0.01, 0.4);
    vec3 rayStep = uSunViewDir * (rayLen / 8.0);
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      vec3 p = viewPos + rayStep * (float(i) + jitter + 0.25);
      vec4 clip = uProj * vec4(p, 1.0);
      vec2 sUv = (clip.xy / max(abs(clip.w), 1e-5)) * 0.5 + 0.5;
      if (sUv.x >= 0.0 && sUv.x <= 1.0 && sUv.y >= 0.0 && sUv.y <= 1.0) {
        float sD = texture(tDepth, sUv).r;
        if (sD < 1.0) {
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

  if (useAoVol && (depth < 1.0 || uUseVolumetric > 0.5)) {
    vec2 aoVol = upsampleHalfLighting(tAoVol, guide, true).rg;
    if (uUseAo > 0.5 && depth < 1.0) {
      float aoStrength = uSsaoIntensity * (1.0 - smoothstep(0.6, 2.4, lumaHdr) * 0.65);
      hdr *= mix(1.0, aoVol.r, clamp(aoStrength, 0.0, 1.0));
    }
    if (uUseVolumetric > 0.5) {
      hdr += uSunColor * (aoVol.g * uVolumetricIntensity);
    }
  }
  return hdr;
}

void main() {
#ifdef HGAME_WORLD_LIGHTING_ONLY
  vec4 sceneColor = texture(tScene, vUv);
  fragColor = vec4(applyWorldLighting(max(vec3(0.0), sceneColor.rgb)), sceneColor.a);
#else
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
  hdr = applyWorldLighting(hdr);

  if (uUseBloom > 0.5) {
    hdr += texture(tBloom, vUv).rgb * uBloomStrength;
  }

  hdr += vec3(uFlash);
  float adapted = 1.0;
  if (uUseAutoExposure > 0.5) {
    vec2 stored = texelFetch(tAutoExposure, ivec2(0), 0).rg;
#ifdef HGAME_EXPOSURE_UNORM
    adapted = unpackExposureScalar(stored, uStoredExposureRange);
#else
    adapted = stored.r;
#endif
  }
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
#endif
}
`;

export const FXAA_SHARPEN_FRAGMENT_GLSL3 = `
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


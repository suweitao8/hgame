/** Maximum simultaneous dynamic 2D point lights evaluated per pass. */
export const MAX_2D_LIGHTS = 32;
/** Maximum simultaneous 2D shadow occluder segments evaluated per pass. */
export const MAX_2D_OCCLUDERS = 32;

/**
 * 2D lighting, shadow occlusion, sprite material/normal, and post-processing quality presets.
 * Explicitly declares which effects are retained at `'low'`, `'medium'`, and `'high'` tiers.
 */
export const QUALITY2D_LIGHTING_PRESETS = Object.freeze({
  low: Object.freeze({
    tier: 'low',
    maxLights: 8,
    ambient: true,
    pointLights: true,
    occluderShadows: false,
    softShadows: false,
    normalMaps: false,
    bloom: false,
    colorGrading: false,
    vignette: true,
    hitPulse: true,
    retainedEffects: Object.freeze(['ambient', 'pointLights<=8', 'vignette', 'hitPulse']),
  }),
  medium: Object.freeze({
    tier: 'medium',
    maxLights: 16,
    ambient: true,
    pointLights: true,
    occluderShadows: true,
    softShadows: false,
    normalMaps: false,
    bloom: true,
    colorGrading: true,
    vignette: true,
    hitPulse: true,
    retainedEffects: Object.freeze(['ambient', 'pointLights<=16', 'occluderShadows', 'bloom', 'colorGrading', 'vignette', 'hitPulse']),
  }),
  high: Object.freeze({
    tier: 'high',
    maxLights: 32,
    ambient: true,
    pointLights: true,
    occluderShadows: true,
    softShadows: true,
    normalMaps: true,
    bloom: true,
    colorGrading: true,
    vignette: true,
    hitPulse: true,
    retainedEffects: Object.freeze(['ambient', 'pointLights<=32', 'occluderShadows', 'softShadows', 'normalMaps', 'bloom', 'colorGrading', 'vignette', 'hitPulse']),
  }),
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function parseColorRgb(color, out, offset = 0) {
  if (typeof color === 'number' && Number.isFinite(color)) {
    const n = color >>> 0;
    out[offset] = ((n >> 16) & 0xff) / 255;
    out[offset + 1] = ((n >> 8) & 0xff) / 255;
    out[offset + 2] = (n & 0xff) / 255;
    return;
  }
  if (typeof color === 'string') {
    const s = color.trim();
    if (s.startsWith('#')) {
      const hex = s.slice(1);
      if (hex.length === 3) {
        out[offset] = parseInt(hex[0] + hex[0], 16) / 255;
        out[offset + 1] = parseInt(hex[1] + hex[1], 16) / 255;
        out[offset + 2] = parseInt(hex[2] + hex[2], 16) / 255;
        return;
      }
      if (hex.length >= 6) {
        out[offset] = parseInt(hex.slice(0, 2), 16) / 255;
        out[offset + 1] = parseInt(hex.slice(2, 4), 16) / 255;
        out[offset + 2] = parseInt(hex.slice(4, 6), 16) / 255;
        return;
      }
    }
  }
  out[offset] = 1;
  out[offset + 1] = 1;
  out[offset + 2] = 1;
}

/**
 * Zero-allocation state container for 2D ambient lighting, up to 32 point lights,
 * and 2D screen-space post-processing (bloom, vignette, hitPulse, chromatic, color grade).
 */
export function createLighting2DState() {
  const ambientRgb = new Float32Array([1, 1, 1]);
  let ambientIntensity = 1;
  let lightCount = 0;

  // Packed world lights: [x, y, radius, intensity, r, g, b, pad] * MAX_2D_LIGHTS
  const lightWorld = new Float32Array(MAX_2D_LIGHTS * 8);
  const lightUvPosRad = new Float32Array(MAX_2D_LIGHTS * 4);
  const lightUvColorInt = new Float32Array(MAX_2D_LIGHTS * 4);

  // Packed 2D shadow occluders: [x1, y1, x2, y2] * MAX_2D_OCCLUDERS
  let occluderCount = 0;
  const occluderWorld = new Float32Array(MAX_2D_OCCLUDERS * 4);
  const occluderUv = new Float32Array(MAX_2D_OCCLUDERS * 4);
  let normalMapSource = null;
  let normalStrength = 1.0;
  let qualityTier = 'high';
  let qualityPolicy = QUALITY2D_LIGHTING_PRESETS.high;

  const post = {
    bloomIntensity: 0,
    bloomThreshold: 0.72,
    vignette: 0,
    hitPulse: 0,
    chromatic: 0,
    saturation: 1,
    contrast: 1,
  };

  function setAmbientLight(color = '#ffffff', intensity = 1) {
    parseColorRgb(color, ambientRgb, 0);
    ambientIntensity = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
  }

  function clearLights() {
    lightCount = 0;
  }

  function addLight(light) {
    if (!light || lightCount >= MAX_2D_LIGHTS) return false;
    const base = lightCount * 8;
    lightWorld[base] = Number(light.x) || 0;
    lightWorld[base + 1] = Number(light.y) || 0;
    lightWorld[base + 2] = Math.max(1, Number(light.radius) || 120);
    lightWorld[base + 3] = clamp(Number.isFinite(light.intensity) ? light.intensity : 1, 0, 8);
    parseColorRgb(light.color ?? 0xffffff, lightWorld, base + 4);
    lightCount++;
    return true;
  }

  function setLights(lights) {
    lightCount = 0;
    if (!Array.isArray(lights)) return 0;
    for (let i = 0; i < lights.length && lightCount < MAX_2D_LIGHTS; i++) {
      addLight(lights[i]);
    }
    return lightCount;
  }

  function setPost(cfg = {}) {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.bloomIntensity !== undefined) post.bloomIntensity = clamp(Number(cfg.bloomIntensity) || 0, 0, 4);
    if (cfg.bloomThreshold !== undefined) post.bloomThreshold = clamp(Number(cfg.bloomThreshold) || 0.72, 0.05, 1);
    if (cfg.vignette !== undefined) post.vignette = clamp(Number(cfg.vignette) || 0, 0, 1.5);
    if (cfg.hitPulse !== undefined) post.hitPulse = clamp(Number(cfg.hitPulse) || 0, 0, 1);
    if (cfg.chromatic !== undefined) post.chromatic = clamp(Number(cfg.chromatic) || 0, 0, 0.03);
    if (cfg.saturation !== undefined) post.saturation = clamp(Number.isFinite(cfg.saturation) ? cfg.saturation : 1, 0, 2);
    if (cfg.contrast !== undefined) post.contrast = clamp(Number.isFinite(cfg.contrast) ? cfg.contrast : 1, 0.2, 2);
  }

  function clearOccluders() {
    occluderCount = 0;
  }

  function addOccluder(segment) {
    if (!segment || occluderCount >= MAX_2D_OCCLUDERS) return false;
    const base = occluderCount * 4;
    occluderWorld[base] = Number(segment.x1) || 0;
    occluderWorld[base + 1] = Number(segment.y1) || 0;
    occluderWorld[base + 2] = Number(segment.x2) || 0;
    occluderWorld[base + 3] = Number(segment.y2) || 0;
    occluderCount++;
    return true;
  }

  function setOccluders(segments) {
    occluderCount = 0;
    if (!Array.isArray(segments)) return 0;
    for (let i = 0; i < segments.length && occluderCount < MAX_2D_OCCLUDERS; i++) {
      addOccluder(segments[i]);
    }
    return occluderCount;
  }

  function setNormalLighting({ normalMap = null, strength = 1.0 } = {}) {
    normalMapSource = normalMap ?? null;
    normalStrength = clamp(Number.isFinite(strength) ? strength : 1.0, 0, 2);
  }

  function setQuality(tier = 'high') {
    const key = tier === 'ultra' ? 'high' : tier;
    if (!key || !Object.hasOwn(QUALITY2D_LIGHTING_PRESETS, key)) {
      qualityTier = 'high';
      qualityPolicy = QUALITY2D_LIGHTING_PRESETS.high;
    } else {
      qualityTier = key;
      qualityPolicy = QUALITY2D_LIGHTING_PRESETS[key];
    }
    return qualityPolicy;
  }

  function hasLighting() {
    return (
      (qualityPolicy.pointLights && lightCount > 0) ||
      (qualityPolicy.ambient && (
        ambientIntensity < 0.999 ||
        ambientRgb[0] < 0.999 ||
        ambientRgb[1] < 0.999 ||
        ambientRgb[2] < 0.999
      ))
    );
  }

  function hasActivePass() {
    if (hasLighting()) return true;
    return (
      (qualityPolicy.bloom && post.bloomIntensity > 0.001) ||
      (qualityPolicy.vignette && post.vignette > 0.001) ||
      (qualityPolicy.hitPulse && post.hitPulse > 0.001) ||
      (qualityPolicy.colorGrading && (
        post.chromatic > 0.0001 ||
        Math.abs(post.saturation - 1) > 0.005 ||
        Math.abs(post.contrast - 1) > 0.005
      ))
    );
  }

  function projectWorldPointToUv(wx, wy, camX, camY, zoom, cos, sin, designW, designH, scale, x0, y0, vw, vh) {
    const dx = wx - camX;
    const dy = wy - camY;
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    const vx = designW * 0.5 + rx * zoom;
    const vy = designH * 0.5 + ry * zoom;
    const cssX = x0 + vx * scale;
    const cssY = y0 + vy * scale;
    return [cssX / vw, 1 - cssY / vh];
  }

  function projectLightsToUv(cam, viewport, designW, designH) {
    const camX = cam.x + (cam.offsetX || 0);
    const camY = cam.y + (cam.offsetY || 0);
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const vw = Math.max(1, viewport.vw);
    const vh = Math.max(1, viewport.vh);
    const scale = viewport.scale || 1;
    const x0 = viewport.x || 0;
    const y0 = viewport.y || 0;

    const effectiveLights = Math.min(lightCount, qualityPolicy.maxLights);
    for (let i = 0; i < effectiveLights; i++) {
      const wIdx = i * 8;
      const [u, v] = projectWorldPointToUv(
        lightWorld[wIdx], lightWorld[wIdx + 1],
        camX, camY, zoom, cos, sin, designW, designH, scale, x0, y0, vw, vh,
      );

      const uIdx = i * 4;
      lightUvPosRad[uIdx] = u;
      lightUvPosRad[uIdx + 1] = v;
      lightUvPosRad[uIdx + 2] = Math.max(1e-4, (lightWorld[wIdx + 2] * zoom * scale) / vw);
      lightUvPosRad[uIdx + 3] = Math.max(1e-4, (lightWorld[wIdx + 2] * zoom * scale) / vh);

      lightUvColorInt[uIdx] = lightWorld[wIdx + 4];
      lightUvColorInt[uIdx + 1] = lightWorld[wIdx + 5];
      lightUvColorInt[uIdx + 2] = lightWorld[wIdx + 6];
      lightUvColorInt[uIdx + 3] = lightWorld[wIdx + 3];
    }

    for (let i = 0; i < occluderCount; i++) {
      const base = i * 4;
      const [u1, v1] = projectWorldPointToUv(
        occluderWorld[base], occluderWorld[base + 1],
        camX, camY, zoom, cos, sin, designW, designH, scale, x0, y0, vw, vh,
      );
      const [u2, v2] = projectWorldPointToUv(
        occluderWorld[base + 2], occluderWorld[base + 3],
        camX, camY, zoom, cos, sin, designW, designH, scale, x0, y0, vw, vh,
      );
      occluderUv[base] = u1;
      occluderUv[base + 1] = v1;
      occluderUv[base + 2] = u2;
      occluderUv[base + 3] = v2;
    }
  }

  return Object.freeze({
    ambientRgb,
    get ambientIntensity() { return ambientIntensity; },
    get lightCount() { return Math.min(lightCount, qualityPolicy.maxLights); },
    get rawLightCount() { return lightCount; },
    get occluderCount() { return qualityPolicy.occluderShadows ? occluderCount : 0; },
    get rawOccluderCount() { return occluderCount; },
    get qualityTier() { return qualityTier; },
    get normalMap() { return qualityPolicy.normalMaps ? normalMapSource : null; },
    get normalStrength() { return normalStrength; },
    lightWorld,
    lightUvPosRad,
    lightUvColorInt,
    occluderWorld,
    occluderUv,
    post,
    setAmbientLight,
    addLight,
    setLights,
    clearLights,
    addOccluder,
    setOccluders,
    clearOccluders,
    setNormalLighting,
    setQuality,
    getQualityPolicy: () => qualityPolicy,
    setPost,
    hasLighting,
    hasActivePass,
    projectLightsToUv,
    snapshot() {
      return {
        ambient: { r: ambientRgb[0], g: ambientRgb[1], b: ambientRgb[2], intensity: ambientIntensity },
        lightCount: Math.min(lightCount, qualityPolicy.maxLights),
        occluderCount: qualityPolicy.occluderShadows ? occluderCount : 0,
        qualityTier,
        qualityPolicy,
        hasNormalMap: Boolean(qualityPolicy.normalMaps && normalMapSource),
        post: { ...post },
      };
    },
  });
}

/**
 * Canvas2D atmospheric lighting and screen-space fallback pass.
 */
export function renderCanvas2DPostPass(ctx, width, height, cam, state, subX = 0, subY = 0, subW = width, subH = height) {
  if (!state || !state.hasActivePass() || typeof ctx.save !== 'function') return;
  ctx.save();
  if (typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
    ctx.beginPath();
    ctx.rect(subX, subY, subW, subH);
    ctx.clip();
  }

  const policy = state.getQualityPolicy?.() ?? QUALITY2D_LIGHTING_PRESETS.high;

  // Ambient darkening tint over rendered scene.
  const ambInt = state.ambientIntensity;
  const r = Math.round(state.ambientRgb[0] * 255);
  const g = Math.round(state.ambientRgb[1] * 255);
  const b = Math.round(state.ambientRgb[2] * 255);
  if (policy.ambient && ambInt < 0.999) {
    ctx.fillStyle = `rgba(${Math.round(r * ambInt)},${Math.round(g * ambInt)},${Math.round(b * ambInt)},${(1 - ambInt).toFixed(3)})`;
    ctx.fillRect(subX, subY, subW, subH);
  }

  // Additive radial point lights in world space (with optional occluder shadow wedges).
  if (policy.pointLights && state.lightCount > 0 && typeof ctx.createRadialGradient === 'function') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(subX + subW * 0.5, subY + subH * 0.5);
    const zoom = cam.zoom || 1;
    const rot = cam.rotation || 0;
    if (zoom !== 1) ctx.scale(zoom, zoom);
    if (rot !== 0) ctx.rotate(-rot);
    ctx.translate(-(cam.x + (cam.offsetX || 0)), -(cam.y + (cam.offsetY || 0)));

    for (let i = 0; i < state.lightCount; i++) {
      const idx = i * 8;
      const lx = state.lightWorld[idx];
      const ly = state.lightWorld[idx + 1];
      const rad = state.lightWorld[idx + 2];
      const lInt = clamp(state.lightWorld[idx + 3], 0, 1.5);
      const lr = Math.round(state.lightWorld[idx + 4] * 255);
      const lg = Math.round(state.lightWorld[idx + 5] * 255);
      const lb = Math.round(state.lightWorld[idx + 6] * 255);
      ctx.save();
      if (policy.occluderShadows && state.occluderCount > 0 && typeof ctx.lineTo === 'function' && typeof ctx.clip === 'function') {
        ctx.beginPath();
        ctx.rect(lx - rad, ly - rad, rad * 2, rad * 2);
        for (let o = 0; o < state.occluderCount; o++) {
          const ob = o * 4;
          const x1 = state.occluderWorld[ob];
          const y1 = state.occluderWorld[ob + 1];
          const x2 = state.occluderWorld[ob + 2];
          const y2 = state.occluderWorld[ob + 3];
          const d1x = x1 - lx, d1y = y1 - ly;
          const d2x = x2 - lx, d2y = y2 - ly;
          const l1 = Math.hypot(d1x, d1y);
          const l2 = Math.hypot(d2x, d2y);
          if (l1 > 1e-4 && l2 > 1e-4 && (l1 <= rad || l2 <= rad)) {
            const reach = rad * 2.5;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x2 + (d2x / l2) * reach, y2 + (d2y / l2) * reach);
            ctx.lineTo(x1 + (d1x / l1) * reach, y1 + (d1y / l1) * reach);
            ctx.closePath();
          }
        }
        ctx.clip('evenodd');
      }
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
      grad.addColorStop(0, `rgba(${lr},${lg},${lb},${Math.min(1, lInt * 0.65).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${lr},${lg},${lb},${(lInt * 0.22).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  // Hit-pulse flash tint and vignette border.
  if (policy.hitPulse && state.post.hitPulse > 0.001) {
    ctx.fillStyle = `rgba(255,48,48,${(state.post.hitPulse * 0.35).toFixed(3)})`;
    ctx.fillRect(subX, subY, subW, subH);
  }
  if (policy.vignette && state.post.vignette > 0.001 && typeof ctx.createRadialGradient === 'function') {
    const cx = subX + subW * 0.5;
    const cy = subY + subH * 0.5;
    const outerR = Math.hypot(subW, subH) * 0.55;
    const vig = ctx.createRadialGradient(cx, cy, outerR * 0.42, cx, cy, outerR);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${clamp(state.post.vignette * 0.75, 0, 0.92).toFixed(3)})`);
    ctx.fillStyle = vig;
    ctx.fillRect(subX, subY, subW, subH);
  }

  ctx.restore();
}

const FULLSCREEN_VS = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision mediump float;
uniform sampler2D uScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 col = texture(uScene, vUv).rgb;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp((lum - uThreshold) / max(0.05, 1.0 - uThreshold), 0.0, 1.0);
  fragColor = vec4(col * soft, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uStep * 1.384615).rgb * 0.316216;
  c += texture(uTex, vUv - uStep * 1.384615).rgb * 0.316216;
  c += texture(uTex, vUv + uStep * 3.230769).rgb * 0.070270;
  c += texture(uTex, vUv - uStep * 3.230769).rgb * 0.070270;
  fragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uNormalMap;
uniform vec4 uAmbient;
uniform int uLightCount;
uniform vec4 uLightsPosRad[${MAX_2D_LIGHTS}];
uniform vec4 uLightsColorInt[${MAX_2D_LIGHTS}];
uniform int uOccluderCount;
uniform vec4 uOccludersUv[${MAX_2D_OCCLUDERS}];
uniform int uShadowFlags; // bit0=occluderShadows, bit1=softShadows, bit2=normalMaps, bit3=colorGrading
uniform float uNormalStrength;
uniform vec4 uPost0; // bloomIntensity, vignette, hitPulse, chromatic
uniform vec2 uPost1; // saturation, contrast
in vec2 vUv;
out vec4 fragColor;

bool rayHitsSegment2D(vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 ab = b - a;
  vec2 cd = d - c;
  float denom = ab.x * cd.y - ab.y * cd.x;
  if (abs(denom) < 1e-6) return false;
  vec2 ac = c - a;
  float t = (ac.x * cd.y - ac.y * cd.x) / denom;
  float u = (ac.x * ab.y - ac.y * ab.x) / denom;
  return t > 0.002 && t < 0.998 && u >= 0.0 && u <= 1.0;
}

float evalLightShadow2D(vec2 uv, vec2 lightPos, int count, bool soft) {
  if (count <= 0) return 1.0;
  float lit = 1.0;
  for (int o = 0; o < ${MAX_2D_OCCLUDERS}; o++) {
    if (o >= count) break;
    vec4 seg = uOccludersUv[o];
    if (rayHitsSegment2D(uv, lightPos, seg.xy, seg.zw)) {
      if (!soft) return 0.0;
      lit -= 0.45;
    }
    if (soft) {
      vec2 perp = vec2(-(lightPos.y - uv.y), lightPos.x - uv.x);
      float len = max(length(perp), 1e-4);
      vec2 jitter = (perp / len) * 0.004;
      if (rayHitsSegment2D(uv, lightPos + jitter, seg.xy, seg.zw)) lit -= 0.275;
      if (rayHitsSegment2D(uv, lightPos - jitter, seg.xy, seg.zw)) lit -= 0.275;
    }
    if (lit <= 0.0) return 0.0;
  }
  return clamp(lit, 0.0, 1.0);
}

void main() {
  float chrom = (uShadowFlags & 8) != 0 ? uPost0.w : 0.0;
  vec3 sceneCol;
  if (chrom > 0.00005) {
    vec2 dir = (vUv - 0.5) * chrom;
    sceneCol.r = texture(uScene, vUv + dir).r;
    sceneCol.g = texture(uScene, vUv).g;
    sceneCol.b = texture(uScene, vUv - dir).b;
  } else {
    sceneCol = texture(uScene, vUv).rgb;
  }

  vec3 surfNormal = vec3(0.0, 0.0, 1.0);
  bool useNormal = (uShadowFlags & 4) != 0;
  if (useNormal) {
    vec3 sampledN = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
    surfNormal = normalize(mix(vec3(0.0, 0.0, 1.0), sampledN, clamp(uNormalStrength, 0.0, 2.0)));
  }

  bool useShadows = (uShadowFlags & 1) != 0;
  bool softShadows = (uShadowFlags & 2) != 0;
  vec3 lightAccum = uAmbient.rgb * uAmbient.a;
  for (int i = 0; i < ${MAX_2D_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 pr = uLightsPosRad[i];
    vec4 ci = uLightsColorInt[i];
    vec2 d = (vUv - pr.xy) / max(pr.zw, vec2(0.0001));
    float distSq = dot(d, d);
    if (distSq < 1.0) {
      float falloff = 1.0 - distSq;
      falloff *= falloff;
      float shadow = useShadows ? evalLightShadow2D(vUv, pr.xy, uOccluderCount, softShadows) : 1.0;
      float ndotl = 1.0;
      if (useNormal) {
        vec3 lDir = normalize(vec3(pr.xy - vUv, 0.35));
        ndotl = clamp(dot(surfNormal, lDir), 0.2, 1.25);
      }
      lightAccum += ci.rgb * (ci.a * falloff * shadow * ndotl);
    }
  }

  vec3 color = sceneCol * lightAccum;
  if (uPost0.x > 0.001) {
    color += texture(uBloom, vUv).rgb * uPost0.x;
  }

  // Saturation and contrast grade.
  if ((uShadowFlags & 8) != 0) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, uPost1.x);
    color = (color - 0.5) * uPost1.y + 0.5;
  }

  // Hit-pulse edge/screen flash + vignette.
  color = mix(color, vec3(1.0, 0.16, 0.14), clamp(uPost0.z * 0.35, 0.0, 0.6));
  if (uPost0.y > 0.001) {
    vec2 vigD = vUv - 0.5;
    float vig = smoothstep(0.32, 0.78, length(vigD));
    color *= 1.0 - vig * clamp(uPost0.y * 0.85, 0.0, 0.95);
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`WebGL2D post shader error: ${log}`);
  }
  return s;
}

function createProg(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`WebGL2D post link error: ${log}`);
  }
  return p;
}

function createRenderTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

/**
 * WebGL2 offscreen scene capture + 2D lighting + half-res Bloom + composite pass.
 * Safely no-ops if running against a minimal mock `gl` without FBO support.
 * @param {WebGL2RenderingContext} gl
 */
export function createWebGL2DPostPass(gl) {
  const supported = Boolean(
    gl &&
    typeof gl.createFramebuffer === 'function' &&
    typeof gl.createVertexArray === 'function' &&
    typeof gl.uniform4fv === 'function',
  );
  if (!supported) {
    return {
      supported: false,
      beginScene: () => false,
      endAndComposite: () => {},
      reclaimTargets: () => 0,
      getTargetBytes: () => 0,
      destroy: () => {},
    };
  }

  let quadVao = null;
  let brightProg = null;
  let blurProg = null;
  let compProg = null;
  let uBright = null;
  let uBlur = null;
  let uComp = null;
  let sceneRt = null;
  let bloomA = null;
  let bloomB = null;
  let blackTex = null;
  let flatNormalTex = null;

  function ensurePrograms() {
    if (compProg) return;
    quadVao = gl.createVertexArray();
    brightProg = createProg(gl, FULLSCREEN_VS, BRIGHT_FS);
    blurProg = createProg(gl, FULLSCREEN_VS, BLUR_FS);
    compProg = createProg(gl, FULLSCREEN_VS, COMPOSITE_FS);

    uBright = {
      scene: gl.getUniformLocation(brightProg, 'uScene'),
      threshold: gl.getUniformLocation(brightProg, 'uThreshold'),
    };
    uBlur = {
      tex: gl.getUniformLocation(blurProg, 'uTex'),
      step: gl.getUniformLocation(blurProg, 'uStep'),
    };
    uComp = {
      scene: gl.getUniformLocation(compProg, 'uScene'),
      bloom: gl.getUniformLocation(compProg, 'uBloom'),
      normalMap: gl.getUniformLocation(compProg, 'uNormalMap'),
      ambient: gl.getUniformLocation(compProg, 'uAmbient'),
      lightCount: gl.getUniformLocation(compProg, 'uLightCount'),
      lightsPosRad: gl.getUniformLocation(compProg, 'uLightsPosRad'),
      lightsColorInt: gl.getUniformLocation(compProg, 'uLightsColorInt'),
      occluderCount: gl.getUniformLocation(compProg, 'uOccluderCount'),
      occludersUv: gl.getUniformLocation(compProg, 'uOccludersUv'),
      shadowFlags: gl.getUniformLocation(compProg, 'uShadowFlags'),
      normalStrength: gl.getUniformLocation(compProg, 'uNormalStrength'),
      post0: gl.getUniformLocation(compProg, 'uPost0'),
      post1: gl.getUniformLocation(compProg, 'uPost1'),
    };

    blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    flatNormalTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, flatNormalTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 255]));
  }

  function ensureTargets(w, h) {
    const bw = Math.max(2, w >> 1);
    const bh = Math.max(2, h >> 1);
    if (!sceneRt || sceneRt.w !== w || sceneRt.h !== h) {
      if (sceneRt) {
        gl.deleteFramebuffer(sceneRt.fbo);
        gl.deleteTexture(sceneRt.tex);
      }
      sceneRt = createRenderTarget(gl, w, h);
    }
    if (!bloomA || bloomA.w !== bw || bloomA.h !== bh) {
      if (bloomA) {
        gl.deleteFramebuffer(bloomA.fbo);
        gl.deleteTexture(bloomA.tex);
      }
      if (bloomB) {
        gl.deleteFramebuffer(bloomB.fbo);
        gl.deleteTexture(bloomB.tex);
      }
      bloomA = createRenderTarget(gl, bw, bh);
      bloomB = createRenderTarget(gl, bw, bh);
    }
  }

  function beginScene(w, h) {
    ensurePrograms();
    ensureTargets(Math.max(1, w), Math.max(1, h));
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRt.fbo);
    return true;
  }

  function endAndComposite(w, h, state, cam, viewport, designW, designH, report = null) {
    if (!sceneRt || !compProg) return;
    let finish;
    try {
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(quadVao);

      const policy = state.getQualityPolicy?.() ?? QUALITY2D_LIGHTING_PRESETS.high;
      let bloomTex = blackTex;
      if (policy.bloom && state.post.bloomIntensity > 0.001 && bloomA && bloomB) {
        finish = report?.beginPass('bloom-extract', bloomA);
        // 1. Bright extract -> bloomA
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
        gl.viewport(0, 0, bloomA.w, bloomA.h);
        gl.useProgram(brightProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneRt.tex);
        gl.uniform1i(uBright.scene, 0);
        gl.uniform1f(uBright.threshold, state.post.bloomThreshold);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        finish?.();
        finish = report?.beginPass('bloom-blur-x', bloomB);
        // 2. Horizontal blur -> bloomB
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
        gl.useProgram(blurProg);
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
        gl.uniform1i(uBlur.tex, 0);
        gl.uniform2f(uBlur.step, 1 / bloomA.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        finish?.();
        finish = report?.beginPass('bloom-blur-y', bloomA);
        // 3. Vertical blur -> bloomA
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
        gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
        gl.uniform2f(uBlur.step, 0, 1 / bloomA.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        bloomTex = bloomA.tex;
      }

      finish?.();
      finish = report?.beginPass('lighting-composite', null);
      // Composite to default framebuffer.
      state.projectLightsToUv(cam, viewport, designW, designH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(compProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneRt.tex);
      gl.uniform1i(uComp.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTex);
      gl.uniform1i(uComp.bloom, 1);

      gl.uniform4f(uComp.ambient, state.ambientRgb[0], state.ambientRgb[1], state.ambientRgb[2], policy.ambient ? state.ambientIntensity : 1);
      gl.uniform1i(uComp.lightCount, policy.pointLights ? state.lightCount : 0);
      gl.uniform4fv(uComp.lightsPosRad, state.lightUvPosRad);
      gl.uniform4fv(uComp.lightsColorInt, state.lightUvColorInt);
      if (uComp.occluderCount) gl.uniform1i(uComp.occluderCount, state.occluderCount ?? 0);
      if (uComp.occludersUv) gl.uniform4fv(uComp.occludersUv, state.occluderUv);
      const shadowFlags =
        (policy.occluderShadows && (state.occluderCount ?? 0) > 0 ? 1 : 0) |
        (policy.softShadows ? 2 : 0) |
        (policy.normalMaps && state.normalMap ? 4 : 0) |
        (policy.colorGrading ? 8 : 0);
      if (uComp.shadowFlags) gl.uniform1i(uComp.shadowFlags, shadowFlags);
      if (uComp.normalStrength) gl.uniform1f(uComp.normalStrength, state.normalStrength ?? 1);
      if (uComp.normalMap) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, flatNormalTex);
        gl.uniform1i(uComp.normalMap, 2);
      }
      gl.uniform4f(
        uComp.post0,
        policy.bloom ? state.post.bloomIntensity : 0,
        policy.vignette ? state.post.vignette : 0,
        policy.hitPulse ? state.post.hitPulse : 0,
        policy.colorGrading ? state.post.chromatic : 0,
      );
      gl.uniform2f(uComp.post1, state.post.saturation, state.post.contrast);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
    } finally { finish?.(); }
  }

  function getTargetBytes() {
    let bytes = 0;
    for (const rt of [sceneRt, bloomA, bloomB]) {
      if (rt) bytes += rt.w * rt.h * 4;
    }
    return bytes;
  }

  function reclaimTargets() {
    const freed = getTargetBytes();
    for (const rt of [sceneRt, bloomA, bloomB]) {
      if (!rt) continue;
      gl.deleteFramebuffer?.(rt.fbo);
      gl.deleteTexture?.(rt.tex);
    }
    sceneRt = null;
    bloomA = null;
    bloomB = null;
    return freed;
  }

  function destroy() {
    reclaimTargets();
    if (blackTex) gl.deleteTexture?.(blackTex);
    blackTex = null;
    if (flatNormalTex) gl.deleteTexture?.(flatNormalTex);
    flatNormalTex = null;
    if (quadVao) gl.deleteVertexArray?.(quadVao);
    quadVao = null;
    for (const p of [brightProg, blurProg, compProg]) {
      if (p) gl.deleteProgram?.(p);
    }
    brightProg = null;
    blurProg = null;
    compProg = null;
  }

  return {
    supported: true,
    get sceneTarget() { return sceneRt; },
    recordTargets(report) {
      report.recordTarget(sceneRt);
      report.recordTarget(bloomA);
      report.recordTarget(bloomB);
    },
    beginScene,
    endAndComposite,
    reclaimTargets,
    getTargetBytes,
    destroy,
  };
}

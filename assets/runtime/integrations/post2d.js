/** Maximum simultaneous dynamic 2D point lights evaluated per pass. */
export const MAX_2D_LIGHTS = 32;

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

  function hasLighting() {
    return (
      lightCount > 0 ||
      ambientIntensity < 0.999 ||
      ambientRgb[0] < 0.999 ||
      ambientRgb[1] < 0.999 ||
      ambientRgb[2] < 0.999
    );
  }

  function hasActivePass() {
    if (hasLighting()) return true;
    return (
      post.bloomIntensity > 0.001 ||
      post.vignette > 0.001 ||
      post.hitPulse > 0.001 ||
      post.chromatic > 0.0001 ||
      Math.abs(post.saturation - 1) > 0.005 ||
      Math.abs(post.contrast - 1) > 0.005
    );
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

    for (let i = 0; i < lightCount; i++) {
      const wIdx = i * 8;
      const dx = lightWorld[wIdx] - camX;
      const dy = lightWorld[wIdx + 1] - camY;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      const vx = designW * 0.5 + rx * zoom;
      const vy = designH * 0.5 + ry * zoom;
      const cssX = x0 + vx * scale;
      const cssY = y0 + vy * scale;

      const uIdx = i * 4;
      lightUvPosRad[uIdx] = cssX / vw;
      lightUvPosRad[uIdx + 1] = 1 - cssY / vh;
      lightUvPosRad[uIdx + 2] = Math.max(1e-4, (lightWorld[wIdx + 2] * zoom * scale) / vw);
      lightUvPosRad[uIdx + 3] = Math.max(1e-4, (lightWorld[wIdx + 2] * zoom * scale) / vh);

      lightUvColorInt[uIdx] = lightWorld[wIdx + 4];
      lightUvColorInt[uIdx + 1] = lightWorld[wIdx + 5];
      lightUvColorInt[uIdx + 2] = lightWorld[wIdx + 6];
      lightUvColorInt[uIdx + 3] = lightWorld[wIdx + 3];
    }
  }

  return Object.freeze({
    ambientRgb,
    get ambientIntensity() { return ambientIntensity; },
    get lightCount() { return lightCount; },
    lightWorld,
    lightUvPosRad,
    lightUvColorInt,
    post,
    setAmbientLight,
    addLight,
    setLights,
    clearLights,
    setPost,
    hasLighting,
    hasActivePass,
    projectLightsToUv,
    snapshot() {
      return {
        ambient: { r: ambientRgb[0], g: ambientRgb[1], b: ambientRgb[2], intensity: ambientIntensity },
        lightCount,
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

  // Ambient darkening tint over rendered scene.
  const ambInt = state.ambientIntensity;
  const r = Math.round(state.ambientRgb[0] * 255);
  const g = Math.round(state.ambientRgb[1] * 255);
  const b = Math.round(state.ambientRgb[2] * 255);
  if (ambInt < 0.999) {
    ctx.fillStyle = `rgba(${Math.round(r * ambInt)},${Math.round(g * ambInt)},${Math.round(b * ambInt)},${(1 - ambInt).toFixed(3)})`;
    ctx.fillRect(subX, subY, subW, subH);
  }

  // Additive radial point lights in world space.
  if (state.lightCount > 0 && typeof ctx.createRadialGradient === 'function') {
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
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
      grad.addColorStop(0, `rgba(${lr},${lg},${lb},${Math.min(1, lInt * 0.65).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${lr},${lg},${lb},${(lInt * 0.22).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  // Hit-pulse flash tint and vignette border.
  if (state.post.hitPulse > 0.001) {
    ctx.fillStyle = `rgba(255,48,48,${(state.post.hitPulse * 0.35).toFixed(3)})`;
    ctx.fillRect(subX, subY, subW, subH);
  }
  if (state.post.vignette > 0.001 && typeof ctx.createRadialGradient === 'function') {
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
uniform vec4 uAmbient;
uniform int uLightCount;
uniform vec4 uLightsPosRad[${MAX_2D_LIGHTS}];
uniform vec4 uLightsColorInt[${MAX_2D_LIGHTS}];
uniform vec4 uPost0; // bloomIntensity, vignette, hitPulse, chromatic
uniform vec2 uPost1; // saturation, contrast
in vec2 vUv;
out vec4 fragColor;
void main() {
  float chrom = uPost0.w;
  vec3 sceneCol;
  if (chrom > 0.00005) {
    vec2 dir = (vUv - 0.5) * chrom;
    sceneCol.r = texture(uScene, vUv + dir).r;
    sceneCol.g = texture(uScene, vUv).g;
    sceneCol.b = texture(uScene, vUv - dir).b;
  } else {
    sceneCol = texture(uScene, vUv).rgb;
  }

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
      lightAccum += ci.rgb * (ci.a * falloff);
    }
  }

  vec3 color = sceneCol * lightAccum;
  if (uPost0.x > 0.001) {
    color += texture(uBloom, vUv).rgb * uPost0.x;
  }

  // Saturation and contrast grade.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uPost1.x);
  color = (color - 0.5) * uPost1.y + 0.5;

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
      ambient: gl.getUniformLocation(compProg, 'uAmbient'),
      lightCount: gl.getUniformLocation(compProg, 'uLightCount'),
      lightsPosRad: gl.getUniformLocation(compProg, 'uLightsPosRad'),
      lightsColorInt: gl.getUniformLocation(compProg, 'uLightsColorInt'),
      post0: gl.getUniformLocation(compProg, 'uPost0'),
      post1: gl.getUniformLocation(compProg, 'uPost1'),
    };

    blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
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

  function endAndComposite(w, h, state, cam, viewport, designW, designH) {
    if (!sceneRt || !compProg) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVao);

    let bloomTex = blackTex;
    if (state.post.bloomIntensity > 0.001 && bloomA && bloomB) {
      // 1. Bright extract -> bloomA
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
      gl.viewport(0, 0, bloomA.w, bloomA.h);
      gl.useProgram(brightProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneRt.tex);
      gl.uniform1i(uBright.scene, 0);
      gl.uniform1f(uBright.threshold, state.post.bloomThreshold);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Horizontal blur -> bloomB
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
      gl.useProgram(blurProg);
      gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.uniform1i(uBlur.tex, 0);
      gl.uniform2f(uBlur.step, 1 / bloomA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 3. Vertical blur -> bloomA
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
      gl.uniform2f(uBlur.step, 0, 1 / bloomA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bloomTex = bloomA.tex;
    }

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

    gl.uniform4f(uComp.ambient, state.ambientRgb[0], state.ambientRgb[1], state.ambientRgb[2], state.ambientIntensity);
    gl.uniform1i(uComp.lightCount, state.lightCount);
    gl.uniform4fv(uComp.lightsPosRad, state.lightUvPosRad);
    gl.uniform4fv(uComp.lightsColorInt, state.lightUvColorInt);
    gl.uniform4f(uComp.post0, state.post.bloomIntensity, state.post.vignette, state.post.hitPulse, state.post.chromatic);
    gl.uniform2f(uComp.post1, state.post.saturation, state.post.contrast);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  function destroy() {
    for (const rt of [sceneRt, bloomA, bloomB]) {
      if (!rt) continue;
      gl.deleteFramebuffer?.(rt.fbo);
      gl.deleteTexture?.(rt.tex);
    }
    sceneRt = null;
    bloomA = null;
    bloomB = null;
    if (blackTex) gl.deleteTexture?.(blackTex);
    blackTex = null;
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
    beginScene,
    endAndComposite,
    destroy,
  };
}

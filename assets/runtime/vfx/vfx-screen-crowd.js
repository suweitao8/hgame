import { VFX_RENDER_ORDERS, packRgb24, unpackRgb24Into } from './vfx-core.js';

export const CROWD_STATUS = Object.freeze({
  NORMAL: 0,
  FLASH_25: 1,
  FLASH_50: 2,
  FLASH_75: 3,
  FLASH_92: 4,
  FROZEN: 5,
  POISON: 6,
  BURN: 7,
});

/**
 * Losslessly packs animation frameRow [0..16382] and statusCode [0..15] into a single float32.
 * Preserves backward compatibility with bone-vat.js (statusCode=0 -> frameRow+1.0; negative -> flash).
 * @param {number} frameRow
 * @param {number} [statusCode=0]
 * @returns {number}
 */
export function packCrowdAnimStatus(frameRow, statusCode = 0) {
  const f = Math.max(0, Math.min(16382, frameRow));
  const s = Math.max(0, Math.min(15, statusCode | 0));
  return s * 16384.0 + (f + 1.0);
}

/**
 * Decodes packed crowd W component back into { frameRow, statusCode }.
 * @param {number} packedW
 * @param {{frameRow:number,statusCode:number}} [out]
 */
export function unpackCrowdAnimStatus(packedW, out = { frameRow: 0, statusCode: 0 }) {
  const absW = Math.abs(packedW);
  let statusCode = Math.floor(absW / 16384.0);
  const frameRow = Math.max(0, (absW - statusCode * 16384.0) - 1.0);
  if (packedW < 0 && statusCode === 0) {
    statusCode = CROWD_STATUS.FLASH_92;
  }
  out.frameRow = frameRow;
  out.statusCode = statusCode;
  return out;
}

export const SCREEN_FEEDBACK_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

varying vec2 vNdc;
varying vec2 vUv;

void main() {
  vUv = uv;
  vNdc = position.xy * 2.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}
`;

export const SCREEN_FEEDBACK_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uLowHp;
uniform float uSpeedLines;
uniform vec4 uPulse;      // ndcX, ndcY, progress [0..1], strength
uniform vec3 uPulseColor;

varying vec2 vNdc;
varying vec2 vUv;

void main() {
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // 1. Low-HP heartbeat vignette
  if (uLowHp > 0.005) {
    float edgeDist = length(vNdc * vec2(0.85, 1.0));
    float vig = smoothstep(0.65, 1.38, edgeDist);
    float beat = 0.65 + 0.35 * sin(uTime * 6.5);
    float aVig = vig * uLowHp * beat * 0.65;
    col += vec3(0.85, 0.06, 0.08) * aVig;
    alpha += aVig;
  }

  // 2. Speed lines (radial edge streaks)
  if (uSpeedLines > 0.005) {
    float r = length(vNdc);
    float ang = atan(vNdc.y, vNdc.x);
    float rays = pow(abs(sin(ang * 36.0 + floor(uTime * 24.0) * 1.7)), 10.0);
    float mask = smoothstep(0.58, 1.15, r) * rays * uSpeedLines * 0.45;
    col += vec3(0.92, 0.96, 1.0) * mask;
    alpha += mask;
  }

  // 3. Shockwave pulse ring
  if (uPulse.w > 0.005 && uPulse.z > 0.0 && uPulse.z < 1.0) {
    float dist = length(vNdc - uPulse.xy);
    float ringR = mix(0.04, 1.65, uPulse.z);
    float ring = (1.0 - smoothstep(0.0, 0.14, abs(dist - ringR))) * (1.0 - uPulse.z) * uPulse.w;
    col += uPulseColor * ring;
    alpha += ring * 0.85;
  }

  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col / max(0.001, alpha), clamp(alpha, 0.0, 0.9));
}
`;

export function createScreenFeedbackPass({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
} = {}) {
  let simTime = 0;
  let lowHpIntensity = 0;
  let speedLinesIntensity = 0;
  let pulseNdcX = 0;
  let pulseNdcY = 0;
  let pulseAge = 0;
  let pulseDur = 0;
  let pulseStrength = 0;
  let pulseRgb = packRgb24(0xffffff);
  let disposed = false;

  const scratchRgb = new Float32Array(3);
  let mesh = null;
  let mat = null;

  if (mode === '3d' && THREE && scene && THREE.PlaneGeometry) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;
    mat = new MatCtor({
      vertexShader: SCREEN_FEEDBACK_VERTEX_GLSL,
      fragmentShader: SCREEN_FEEDBACK_FRAGMENT_GLSL,
      uniforms: {
        uTime: { value: 0 },
        uLowHp: { value: 0 },
        uSpeedLines: { value: 0 },
        uPulse: { value: new THREE.Vector4(0, 0, 0, 0) },
        uPulseColor: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = VFX_RENDER_ORDERS.SCREEN;
    mesh.name = 'HGameVfxScreenFeedback';
    scene.add(mesh);
  }

  function syncVisibility() {
    if (mesh) {
      mesh.visible = lowHpIntensity > 0.001 || speedLinesIntensity > 0.001 || pulseStrength > 0.001;
    }
  }

  function screenPulse({
    ndcX = 0,
    ndcY = 0,
    strength = 0.8,
    duration = 0.35,
    color = 0xffffff,
  } = {}) {
    pulseNdcX = ndcX;
    pulseNdcY = ndcY;
    pulseStrength = Math.max(0, Math.min(1, strength));
    pulseDur = Math.max(0.05, duration);
    pulseAge = 0;
    pulseRgb = packRgb24(color);
    if (mat) {
      unpackRgb24Into(pulseRgb, scratchRgb);
      mat.uniforms.uPulseColor.value.setRGB(scratchRgb[0], scratchRgb[1], scratchRgb[2]);
    }
    syncVisibility();
  }

  function setLowHpIntensity(intensity) {
    lowHpIntensity = Math.max(0, Math.min(1, intensity));
    syncVisibility();
  }

  function setSpeedLines(intensity) {
    speedLinesIntensity = Math.max(0, Math.min(1, intensity));
    syncVisibility();
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);
    simTime += dt;
    if (pulseStrength > 0 && pulseDur > 0) {
      pulseAge += dt;
      if (pulseAge >= pulseDur) {
        pulseStrength = 0;
        pulseAge = 0;
      }
    }
    if (mat) {
      mat.uniforms.uTime.value = simTime;
      mat.uniforms.uLowHp.value = lowHpIntensity;
      mat.uniforms.uSpeedLines.value = speedLinesIntensity;
      const prog = pulseDur > 0 ? Math.min(1, pulseAge / pulseDur) : 0;
      mat.uniforms.uPulse.value.set(pulseNdcX, pulseNdcY, prog, pulseStrength);
    }
    syncVisibility();
  }

  function renderCanvas2D(ctx, viewWidth, viewHeight) {
    if (!ctx || disposed) return;
    if (lowHpIntensity <= 0.005 && pulseStrength <= 0.005) return;
    ctx.save();
    if (lowHpIntensity > 0.005) {
      const beat = 0.65 + 0.35 * Math.sin(simTime * 6.5);
      const a = lowHpIntensity * beat * 0.45;
      ctx.strokeStyle = `rgba(220, 20, 30, ${a.toFixed(3)})`;
      ctx.lineWidth = Math.max(12, Math.min(viewWidth, viewHeight) * 0.06);
      ctx.strokeRect(0, 0, viewWidth, viewHeight);
    }
    if (pulseStrength > 0.005 && pulseDur > 0) {
      const prog = Math.min(1, pulseAge / pulseDur);
      const cx = (pulseNdcX * 0.5 + 0.5) * viewWidth;
      const cy = (-pulseNdcY * 0.5 + 0.5) * viewHeight;
      const maxR = Math.hypot(viewWidth, viewHeight) * 0.55;
      ctx.strokeStyle = `rgba(255,255,255,${((1 - prog) * pulseStrength * 0.7).toFixed(3)})`;
      ctx.lineWidth = 6 * (1 - prog * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * prog, 0, 6.2831853);
      ctx.stroke();
    }
    ctx.restore();
  }

  function reset() {
    simTime = 0;
    lowHpIntensity = 0;
    speedLinesIntensity = 0;
    pulseStrength = 0;
    pulseAge = 0;
    if (mesh) mesh.visible = false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (mesh) {
      scene?.remove?.(mesh);
      mesh.geometry?.dispose?.();
      mat?.dispose?.();
    }
  }

  return {
    screenPulse,
    setLowHpIntensity,
    setSpeedLines,
    update,
    renderCanvas2D,
    reset,
    dispose,
  };
}

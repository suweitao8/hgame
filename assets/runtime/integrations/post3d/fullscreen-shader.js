import { FULLSCREEN_VERTEX_GLSL3, RECONSTRUCT_VIEW_POSITION_GLSL3 } from './shaders.js';

const COLOR = 'hgameColorInput';
const DEPTH = 'hgameDepthInput';
const DEPTH_VIEW = Object.freeze({
  inverseProjection: 'hgameInverseProjection',
  clipDepthMode: 'hgameClipDepthMode',
  far: 'hgameCameraFar',
});
const RESERVED_UNIFORMS = [COLOR, DEPTH, ...Object.values(DEPTH_VIEW)];

const DEPTH_GLSL = `
uniform sampler2D ${DEPTH};
uniform mat4 ${DEPTH_VIEW.inverseProjection};
uniform int ${DEPTH_VIEW.clipDepthMode};
uniform float ${DEPTH_VIEW.far};

${RECONSTRUCT_VIEW_POSITION_GLSL3}

float hgameSceneDepthRaw(vec2 uv) { return texture(${DEPTH}, uv).r; }
vec3 hgameSceneViewPosition(vec2 uv) {
  return hgameViewPositionFromDepth(uv, hgameSceneDepthRaw(uv), ${DEPTH_VIEW.inverseProjection}, ${DEPTH_VIEW.clipDepthMode});
}
float hgameSceneEyeDepth(vec2 uv) { return -hgameSceneViewPosition(uv).z; }
float hgameSceneLinearDepth(vec2 uv) {
  return clamp(hgameSceneEyeDepth(uv) / max(${DEPTH_VIEW.far}, 0.0001), 0.0, 1.0);
}
`;

/**
 * Creates a Three HDR pass from GLSL3 defining `vec4 shadeFullscreen(vec2 uv)`.
 * The caller owns the returned material and can update its custom uniforms.
 * @param {object} THREE Three.js namespace.
 * @param {object} options
 * @param {string} options.id Unique HDR pass id.
 * @param {string} options.fragment GLSL3 declarations and shadeFullscreen implementation.
 * @param {Record<string, {value: unknown}>} [options.uniforms] Caller-defined shader uniforms.
 * @param {boolean} [options.sceneDepth=false] Request original world depth and camera projection.
 * @param {boolean} [options.enabled=true] Whether this pass runs.
 */
export function createFullscreenShaderPass(THREE, { id, fragment, uniforms = {}, sceneDepth = false, enabled = true } = {}) {
  if (typeof id !== 'string' || !id.trim() || typeof fragment !== 'string' || !fragment.trim()) {
    throw new TypeError('A fullscreen shader pass requires an id and fragment source');
  }
  if (typeof sceneDepth !== 'boolean' || typeof enabled !== 'boolean' || !uniforms || typeof uniforms !== 'object' || Array.isArray(uniforms)) {
    throw new TypeError('Invalid uniforms or flags for fullscreen shader pass');
  }
  for (const name of RESERVED_UNIFORMS) {
    if (Object.prototype.hasOwnProperty.call(uniforms, name)) throw new TypeError(`Reserved fullscreen shader uniform: ${name}`);
  }

  const inputs = sceneDepth ? { color: COLOR, depth: DEPTH, depthView: DEPTH_VIEW } : { color: COLOR };
  const inputUniforms = { [COLOR]: { value: null } };
  if (sceneDepth) {
    inputUniforms[DEPTH] = { value: null };
    inputUniforms[DEPTH_VIEW.inverseProjection] = { value: null };
    inputUniforms[DEPTH_VIEW.clipDepthMode] = { value: 0 };
    inputUniforms[DEPTH_VIEW.far] = { value: 1 };
  }
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX_GLSL3,
    fragmentShader: `
in vec2 vUv;
out vec4 hgameOutput;
uniform sampler2D ${COLOR};

vec2 hgameScreenUV() { return vUv; }
vec2 hgameScreenSize() { return vec2(textureSize(${COLOR}, 0)); }
vec2 hgameScreenPixels() { return vUv * hgameScreenSize(); }
vec4 hgameSceneColor(vec2 uv) { return texture(${COLOR}, uv); }

${sceneDepth ? DEPTH_GLSL : ''}
${fragment}

void main() { hgameOutput = shadeFullscreen(hgameScreenUV()); }
`,
    uniforms: { ...uniforms, ...inputUniforms },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  return { id: id.trim(), material, inputs, enabled };
}

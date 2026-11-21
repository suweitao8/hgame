/**
 * Clean-room WebGL2 Many-Light ("MegaLights"-style Clustered + Stochastic
 * Importance Sampling) and World-Space SH L1 Irradiance Probe Volume GI.
 *
 * Original Apache-2.0 JavaScript/GLSL implementation based on published
 * real-time rendering algorithms (clustered frustum binning, stratified
 * weighted importance sampling, and Ramamoorthi L1 Spherical Harmonics).
 *
 * Never imports 'three' directly; callers pass { THREE } by dependency injection.
 */
import { createFloatTextureUpdates } from './lighting3d/texture-updates.js';
export {
  createBakedProbeGrid,
  getVisibleBakedProbeGrid,
  createStreamedProbeVolumeManager3D,
} from './lighting3d/baked-probe-grid.js';
export {
  generateLightmapUV3D,
  createLightmapBaker3D,
} from './lightmap-bake3d.js';

/**
 * @typedef {[number, number, number]} LightingRGB Linear RGB triple.
 * @typedef {object} LightingColorLike Three.js-like Color.
 * @property {boolean} [isColor]
 * @property {number} [r]
 * @property {number} [g]
 * @property {number} [b]
 * @typedef {number | string | readonly number[] | LightingColorLike} LightColorInput
 * Hex number (`0xrrggbb`), CSS string (Three.js only), `[r,g,b]` array, or Color.
 * @typedef {readonly number[] | {x?: number, y?: number, z?: number}} LightingVec3Input `[x,y,z]` or `{x,y,z}`.
 * @typedef {object} LightingVec2Like
 * @property {number} x
 * @property {number} y
 * @property {(x: number, y: number) => unknown} set
 * @typedef {object} LightingVec3Like
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {(x: number, y: number, z: number) => unknown} [set]
 * @typedef {object} LightingVec4Like
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} w
 * @property {(x: number, y: number, z: number, w: number) => unknown} set
 * @typedef {object} LightingTextureLike Three.js DataTexture subset (or headless stand-in).
 * @property {boolean} needsUpdate
 * @property {() => void} [dispose]
 * @property {{data: Float32Array, width: number, height: number}} [image]
 * @typedef {object} LightingThreeLike Subset of the Three.js namespace used by lighting3d (all optional; headless plain objects are used when absent).
 * @property {new (value?: LightColorInput) => LightingColorLike & {getRGB?: (target: {r: number, g: number, b: number}) => unknown, clone: () => LightingColorLike}} [Color]
 * @property {new (data: Float32Array, width: number, height: number, format?: number, type?: number) => LightingTextureLike & Record<string, unknown>} [DataTexture]
 * @property {new (x?: number, y?: number) => LightingVec2Like} [Vector2]
 * @property {new (x?: number, y?: number, z?: number) => LightingVec3Like & {set: (x: number, y: number, z: number) => unknown}} [Vector3]
 * @property {new (x?: number, y?: number, z?: number, w?: number) => LightingVec4Like} [Vector4]
 * @property {number} [RGBAFormat]
 * @property {number} [FloatType]
 * @property {number} [NearestFilter]
 * @property {number} [ClampToEdgeWrapping]
 * @property {boolean} [HGAME_FULL_DATA_TEXTURE_INITIAL_UPLOAD] New GPU backing always initializes the whole DataTexture before range updates.
 * @typedef {object} LightingShaderLike Three.js `onBeforeCompile` shader parameter.
 * @property {string} fragmentShader
 * @property {string} [vertexShader]
 * @property {Record<string, {value: unknown}>} uniforms
 * @typedef {object} LightingMaterialLike Three.js material subset patched by `applyToMaterial`.
 * @property {Record<string, unknown>} [userData]
 * @property {(shader: LightingShaderLike, renderer?: object) => void} [onBeforeCompile]
 * @property {() => string} [customProgramCacheKey]
 * @property {boolean} [needsUpdate]
 * @typedef {object} LightingCameraLike Three.js perspective camera subset read by `update`.
 * @property {number} [near]
 * @property {number} [far]
 * @property {number} [aspect]
 * @property {number} [fov] Vertical FOV, degrees.
 * @property {(force?: boolean) => void} [updateMatrixWorld]
 * @property {{elements: ArrayLike<number>, copy: (m: object) => {invert?: () => unknown}}} [matrixWorldInverse]
 * @property {object} [matrixWorld]
 */
const CLUSTER_TILES_X = 16;
const CLUSTER_TILES_Y = 8;
const CLUSTER_SLICES_Z = 16;
const CLUSTER_TOTAL = CLUSTER_TILES_X * CLUSTER_TILES_Y * CLUSTER_SLICES_Z; // 2048
const CLUSTER_MAX_LIGHTS = 31;
const CLUSTER_TEXELS_PER_CLUSTER = 8; // 32 floats (1 count + 31 light indices) = 8 RGBA texels
const CLUSTER_COMPONENTS = CLUSTER_TEXELS_PER_CLUSTER * 4;
const CLUSTER_TEX_WIDTH = 128; // 16 clusters per row -> zero row wrapping
const CLUSTER_TEX_HEIGHT = (CLUSTER_TOTAL * CLUSTER_TEXELS_PER_CLUSTER) / CLUSTER_TEX_WIDTH; // 128

const SH_Y0 = 0.28209479177387814; // 1 / (2 * sqrt(PI))
const SH_Y1 = 0.4886025119029199;  // sqrt(3 / (4 * PI))
const SH_A0 = Math.PI;
const SH_A1 = (2 * Math.PI) / 3;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function colorToLinearRGB(THREE, input, fallback = 0xffffff) {
  if (THREE?.Color) {
    const c = input?.isColor ? input.clone() : new THREE.Color(input ?? fallback);
    if (typeof c.getRGB === 'function') {
      const out = { r: 1, g: 1, b: 1 };
      c.getRGB(out);
      return [out.r, out.g, out.b];
    }
    return [c.r ?? 1, c.g ?? 1, c.b ?? 1];
  }
  if (Array.isArray(input) && input.length >= 3) {
    return [Number(input[0]) || 0, Number(input[1]) || 0, Number(input[2]) || 0];
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    const r = ((input >> 16) & 255) / 255;
    const g = ((input >> 8) & 255) / 255;
    const b = (input & 255) / 255;
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  }
  return [1, 1, 1];
}

function normalizeVec3Array(dir, fallback = [0, -1, 0]) {
  const x = Number(Array.isArray(dir) ? dir[0] : dir?.x);
  const y = Number(Array.isArray(dir) ? dir[1] : dir?.y);
  const z = Number(Array.isArray(dir) ? dir[2] : dir?.z);
  const vx = Number.isFinite(x) ? x : fallback[0];
  const vy = Number.isFinite(y) ? y : fallback[1];
  const vz = Number.isFinite(z) ? z : fallback[2];
  const len = Math.hypot(vx, vy, vz);
  return len > 1e-8 ? [vx / len, vy / len, vz / len] : [...fallback];
}

function makeFloatDataTexture(THREE, data, width, height) {
  if (THREE?.DataTexture) {
    const tex = new THREE.DataTexture(
      data,
      width,
      height,
      THREE.RGBAFormat ?? 1023,
      THREE.FloatType ?? 1015,
    );
    tex.minFilter = THREE.NearestFilter ?? 1003;
    tex.magFilter = THREE.NearestFilter ?? 1003;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping ?? 1001;
    tex.wrapT = THREE.ClampToEdgeWrapping ?? 1001;
    tex.needsUpdate = true;
    return tex;
  }
  return {
    image: { data, width, height },
    needsUpdate: true,
    dispose() {},
  };
}

/**
 * Light candidate for CPU stochastic sampling.
 * @typedef {object} StochasticLightCandidate
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {number} [range] Influence radius, world units (min 0.1). Default `10`.
 * @property {number} [luminance] Radiant weight (min 0.01); falls back to `intensity`.
 * @property {number} [intensity] Fallback weight. Default `1`.
 */
/**
 * Result of {@link computeStochasticLightSample}.
 * @typedef {object} StochasticLightSample
 * @property {number} index Chosen candidate index.
 * @property {StochasticLightCandidate} candidate Chosen candidate.
 * @property {number} pdf Selection probability.
 * @property {number} weight Importance weight of the chosen light.
 * @property {number} totalWeight Sum of all weights.
 * @property {number} unbiasedScale `1 / pdf` (0 when pdf is 0).
 */
/**
 * Computes CPU-side normalized importance weights and draws one stochastic
 * sample index from candidates using `random01` in `[0, 1)`. Useful for
 * offline validation and Monte Carlo unbiasedness verification.
 * @param {readonly StochasticLightCandidate[]} candidates
 * @param {LightingVec3Input} [surfacePos] Surface position, world units.
 * @param {LightingVec3Input} [surfaceNormal] Surface normal (default up).
 * @param {number} [random01] Uniform random in [0, 1). Default `0.5`.
 * @returns {StochasticLightSample | null} `null` when no light contributes.
 */export function computeStochasticLightSample(candidates, surfacePos, surfaceNormal, random01 = 0.5) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const px = surfacePos?.[0] ?? surfacePos?.x ?? 0;
  const py = surfacePos?.[1] ?? surfacePos?.y ?? 0;
  const pz = surfacePos?.[2] ?? surfacePos?.z ?? 0;
  const nx = surfaceNormal?.[0] ?? surfaceNormal?.x ?? 0;
  const ny = surfaceNormal?.[1] ?? surfaceNormal?.y ?? 1;
  const nz = surfaceNormal?.[2] ?? surfaceNormal?.z ?? 0;

  const weights = new Float64Array(candidates.length);
  let totalW = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const lx = (c.x ?? 0) - px;
    const ly = (c.y ?? 0) - py;
    const lz = (c.z ?? 0) - pz;
    const distSq = lx * lx + ly * ly + lz * lz;
    const range = Math.max(0.1, c.range ?? 10);
    if (distSq >= range * range) continue;
    const dist = Math.sqrt(Math.max(1e-6, distSq));
    const dirX = lx / dist;
    const dirY = ly / dist;
    const dirZ = lz / dist;
    const ratio = clamp(dist / range, 0, 1);
    const smoothAtten = (1 - ratio * ratio);
    const windowAtten = smoothAtten * smoothAtten;
    const invSq = 1 / (1 + distSq * 0.25);
    const nDotL = Math.max(0.08, nx * dirX + ny * dirY + nz * dirZ);
    const lum = Math.max(0.01, c.luminance ?? (c.intensity ?? 1));
    const w = lum * windowAtten * invSq * nDotL;
    weights[i] = w;
    totalW += w;
  }

  if (totalW <= 1e-12) return null;
  const target = clamp(random01, 0, 0.9999999) * totalW;
  let accum = 0;
  let chosenIndex = candidates.length - 1;
  for (let i = 0; i < candidates.length; i++) {
    accum += weights[i];
    if (accum >= target && weights[i] > 0) {
      chosenIndex = i;
      break;
    }
  }
  const pdf = weights[chosenIndex] / totalW;
  return {
    index: chosenIndex,
    candidate: candidates[chosenIndex],
    pdf,
    weight: weights[chosenIndex],
    totalWeight: totalW,
    unbiasedScale: pdf > 0 ? 1 / pdf : 0,
  };
}

/**
 * @typedef {object} MegaLights3DOptions
 * @property {number} [maxLights] Integer capacity 1..1024. Default `256`.
 * @property {number} [samplesPerPixel] Stochastic samples 0..8. Default `3`.
 * @property {number} [activeBudget] Max lights binned per frame (1..maxLights). Default `maxLights`.
 * @typedef {object} MegaLightDescriptor
 * @property {number | string} [id] Explicit id; auto-incremented integer when omitted.
 * @property {'point'|'spot'} [type] Default `'point'`.
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {LightColorInput} [color] Default `0xffffff`.
 * @property {number} [intensity] Radiant intensity (>= 0). Default `4`.
 * @property {number} [range] Influence radius, world units (min 0.25). Default `12`.
 * @property {number} [radius] Soft source radius, world units 0.02..4. Default `0.15`.
 * @property {LightingVec3Input} [direction] Spot direction (normalised). Default `[0,-1,0]`.
 * @property {number} [innerAngle] Spot inner cone half-angle, radians. Default `0.65 * outerAngle`.
 * @property {number} [outerAngle] Spot outer cone half-angle, radians (0.02..0.49π). Default `π/4`.
 * @property {boolean} [enabled] Default `true`.
 * @property {boolean} [transient] Fade out and auto-remove after `duration`. Default `false`.
 * @property {number} [duration] Transient lifetime, seconds. Default `0`.
 * @typedef {object} MegaLightPatch Mutable light fields for `updateLight`.
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {LightColorInput} [color]
 * @property {number} [intensity]
 * @property {number} [range]
 * @property {number} [radius]
 * @property {LightingVec3Input} [direction]
 * @property {boolean} [enabled]
 * @property {'point'|'spot'} [type]
 * @typedef {object} MegaLightFlashOptions
 * @property {number} [x] Default `0`.
 * @property {number} [y] Default `0`.
 * @property {number} [z] Default `0`.
 * @property {LightColorInput} [color] Default `0xffb36b`.
 * @property {number} [intensity] Default `6`.
 * @property {number} [range] World units. Default `10`.
 * @property {number} [radius] World units. Default `0.2`.
 * @property {number} [duration] Seconds. Default `0.14`.
 * @typedef {object} MegaLightsQualityPreset
 * @property {number} [megaLightsSamples] Integer samples per pixel 0..8.
 * @property {number} [maxClusteredLights] Integer active-light budget.
 * @typedef {object} MegaLightsViewport
 * @property {number} width Pixels.
 * @property {number} height Pixels.
 * @typedef {object} MegaLightsClusterInfo
 * @property {number} clusterIndex Flat cluster index.
 * @property {number} cx Tile X.
 * @property {number} cy Tile Y.
 * @property {number} cz Depth slice.
 * @property {number} count Lights in the cluster.
 * @property {number[]} indices Light slot indices in the cluster.
 * @typedef {object} MegaLightsUniforms Shared shader uniforms.
 * @property {{value: LightingTextureLike}} uMegaLightData
 * @property {{value: LightingTextureLike}} uMegaClusterTex
 * @property {{value: number}} uMegaDataHeight
 * @property {{value: LightingVec2Like}} uMegaResolution
 * @property {{value: LightingVec4Like}} uMegaZParams
 * @property {{value: number}} uMegaActiveCount
 * @property {{value: number}} uMegaSamplesPerPixel
 * @property {{value: number}} uMegaTime
 * @typedef {object} MegaLights3D
 * @property {number} count Registered light count (read-only).
 * @property {number} activeCount Lights binned last update (read-only).
 * @property {number} maxLights Capacity (read-only).
 * @property {number} samplesPerPixel Current sample budget (read-only).
 * @property {number} activeBudget Current active-light budget (read-only).
 * @property {number[]} clusterDims `[tilesX, tilesY, slicesZ]` (read-only).
 * @property {LightingTextureLike} lightDataTexture (read-only)
 * @property {LightingTextureLike} clusterTexture (read-only)
 * @property {{light: import('./lighting3d/texture-updates.js').FloatTextureUploadStats, cluster: import('./lighting3d/texture-updates.js').FloatTextureUploadStats}} uploadStats Pending texture payload in bytes, excluding backing allocation and driver overhead.
 * @property {MegaLightsUniforms} uniforms (read-only)
 * @property {(desc?: MegaLightDescriptor) => number | string} addLight Returns the light id.
 * @property {(id: number | string, patch?: MegaLightPatch) => boolean} updateLight False when unknown id.
 * @property {(id: number | string) => boolean} removeLight
 * @property {(options?: MegaLightFlashOptions) => number | string} flash Transient point light; returns id.
 * @property {() => void} clear
 * @property {(preset: MegaLightsQualityPreset) => void} setQualityPreset
 * @property {(width: number, height: number) => void} setViewportSize Pixels.
 * @property {(camera?: LightingCameraLike | null, dt?: number, viewport?: MegaLightsViewport | null) => number} update Bin lights; `dt` seconds; returns active count.
 * @property {(vx: number, vy: number, vz: number, ndcX?: number, ndcY?: number) => MegaLightsClusterInfo} evaluateClusterAtViewPos Debug cluster lookup (view-space position, NDC -1..1).
 * @property {<M extends LightingMaterialLike>(material: M) => M} applyToMaterial Patch a material shader (idempotent).
 * @property {() => boolean} dispose False when already disposed.
 */
/**
 * Creates a GPU DataTexture-backed Clustered + Stochastic Many-Light manager
 * ("MegaLights"-grade for WebGL2): supports hundreds of dynamic point/spot lights
 * with zero scene-graph Three.js PointLight bloat and zero shader recompilations.
 * @param {LightingThreeLike | null | undefined} THREE Injected Three.js namespace subset (or null for headless).
 * @param {MegaLights3DOptions} [options]
 * @returns {MegaLights3D}
 */export function createMegaLights3D(THREE, options = {}) {
  const {
    maxLights = 256,
    samplesPerPixel = 3,
    activeBudget = maxLights,
  } = options;

  if (!Number.isInteger(maxLights) || maxLights < 1 || maxLights > 1024) {
    throw new RangeError('maxLights must be an integer between 1 and 1024');
  }

  let nextId = 1;
  const lights = new Map();
  const transientIds = new Set();
  let sampleBudget = clamp(Math.floor(samplesPerPixel), 0, 8);
  let lightBudget = clamp(Math.floor(activeBudget), 1, maxLights);
  let activeCount = 0;
  let frameTime = 0;
  let disposed = false;
  let packingDirty = true;

  // 4 RGBA texels per light = 16 floats per light row
  const lightTextureData = new Float32Array(16 * maxLights);
  const clusterTextureData = new Float32Array(CLUSTER_TEX_WIDTH * CLUSTER_TEX_HEIGHT * 4);
  const lightDataTex = makeFloatDataTexture(THREE, lightTextureData, 4, maxLights);
  const clusterTex = makeFloatDataTexture(THREE, clusterTextureData, CLUSTER_TEX_WIDTH, CLUSTER_TEX_HEIGHT);
  const partial = THREE?.HGAME_FULL_DATA_TEXTURE_INITIAL_UPLOAD === true;
  const lightUpload = createFloatTextureUpdates(lightDataTex, lightTextureData, 4, maxLights, partial);
  const clusterUpload = createFloatTextureUpdates(clusterTex, clusterTextureData, CLUSTER_TEX_WIDTH, CLUSTER_TEX_HEIGHT, partial);
  const lightData = lightUpload.packed;
  const clusterData = clusterUpload.packed;
  const occupiedClusters = new Uint16Array(CLUSTER_TOTAL);
  const touchedRowStarts = new Uint16Array(CLUSTER_TEX_HEIGHT);
  const touchedRowEnds = new Uint16Array(CLUSTER_TEX_HEIGHT);
  let occupiedClusterCount = 0;

  const visibleScratch = [];
  const packedViewMatrix = new Float64Array(16);
  let hasPackedView = false;
  let cachedNear = 0.1;
  let cachedFar = 1000;
  let cachedAspect = 16 / 9;
  let cachedTanY = Math.tan((60 * Math.PI) / 360);

  const uniformsShared = {
    uMegaLightData: { value: lightDataTex },
    uMegaClusterTex: { value: clusterTex },
    uMegaDataHeight: { value: maxLights },
    uMegaResolution: { value: THREE?.Vector2 ? new THREE.Vector2(960, 540) : { x: 960, y: 540, set(w, h) { this.x = w; this.y = h; } } },
    uMegaZParams: { value: THREE?.Vector4 ? new THREE.Vector4(0.1, 1000, 1, 0) : { x: 0.1, y: 1000, z: 1, w: 0, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; } } },
    uMegaActiveCount: { value: 0 },
    uMegaSamplesPerPixel: { value: sampleBudget },
    uMegaTime: { value: 0 },
  };

  function addLight(desc = {}) {
    if (disposed) throw new Error('MegaLights3D is disposed');
    const id = desc.id ?? nextId++;
    const rgb = colorToLinearRGB(THREE, desc.color ?? 0xffffff, 0xffffff);
    const dir = normalizeVec3Array(desc.direction, [0, -1, 0]);
    const outerAngle = Number.isFinite(desc.outerAngle) ? clamp(desc.outerAngle, 0.02, Math.PI * 0.49) : Math.PI / 4;
    const innerAngle = Number.isFinite(desc.innerAngle) ? clamp(desc.innerAngle, 0.01, outerAngle) : outerAngle * 0.65;
    const record = {
      id,
      type: desc.type === 'spot' ? 'spot' : 'point',
      x: Number(desc.x) || 0,
      y: Number(desc.y) || 0,
      z: Number(desc.z) || 0,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      intensity: Number.isFinite(desc.intensity) ? Math.max(0, desc.intensity) : 4.0,
      range: Number.isFinite(desc.range) ? Math.max(0.25, desc.range) : 12.0,
      radius: Number.isFinite(desc.radius) ? clamp(desc.radius, 0.02, 4.0) : 0.15,
      dirX: dir[0],
      dirY: dir[1],
      dirZ: dir[2],
      innerCos: Math.cos(innerAngle),
      outerCos: Math.cos(outerAngle),
      enabled: desc.enabled !== false,
      transient: Boolean(desc.transient),
      duration: Number.isFinite(desc.duration) ? Math.max(0.01, desc.duration) : 0,
      age: 0,
      peakIntensity: Number.isFinite(desc.intensity) ? Math.max(0, desc.intensity) : 4.0,
    };
    lights.set(id, record);
    if (record.transient) transientIds.add(id);
    else transientIds.delete(id);
    packingDirty = true;
    return id;
  }

  function updateLight(id, patch = {}) {
    const rec = lights.get(id);
    if (!rec || !patch) return false;
    if (patch.x !== undefined) rec.x = Number(patch.x) || 0;
    if (patch.y !== undefined) rec.y = Number(patch.y) || 0;
    if (patch.z !== undefined) rec.z = Number(patch.z) || 0;
    if (patch.color !== undefined) {
      const rgb = colorToLinearRGB(THREE, patch.color, 0xffffff);
      rec.r = rgb[0];
      rec.g = rgb[1];
      rec.b = rgb[2];
    }
    if (Number.isFinite(patch.intensity)) {
      rec.intensity = Math.max(0, patch.intensity);
      rec.peakIntensity = rec.intensity;
    }
    if (Number.isFinite(patch.range)) rec.range = Math.max(0.25, patch.range);
    if (Number.isFinite(patch.radius)) rec.radius = clamp(patch.radius, 0.02, 4.0);
    if (patch.direction !== undefined) {
      const dir = normalizeVec3Array(patch.direction, [rec.dirX, rec.dirY, rec.dirZ]);
      rec.dirX = dir[0];
      rec.dirY = dir[1];
      rec.dirZ = dir[2];
    }
    if (patch.enabled !== undefined) rec.enabled = Boolean(patch.enabled);
    if (patch.type === 'spot' || patch.type === 'point') rec.type = patch.type;
    packingDirty = true;
    return true;
  }

  function removeLight(id) {
    if (!lights.delete(id)) return false;
    transientIds.delete(id);
    packingDirty = true;
    return true;
  }

  function flash({
    x = 0, y = 0, z = 0,
    color = 0xffb36b,
    intensity = 6.0,
    range = 10.0,
    radius = 0.2,
    duration = 0.14,
  } = {}) {
    return addLight({
      type: 'point',
      x, y, z,
      color,
      intensity,
      range,
      radius,
      transient: true,
      duration,
    });
  }

  function clear() {
    lights.clear();
    transientIds.clear();
    visibleScratch.length = 0;
    activeCount = 0;
    occupiedClusterCount = 0;
    lightData.fill(0);
    clusterData.fill(0);
    uniformsShared.uMegaActiveCount.value = 0;
    lightUpload.publish();
    clusterUpload.publish();
  }

  function setQualityPreset(preset) {
    if (!preset || typeof preset !== 'object') return;
    if (Number.isInteger(preset.megaLightsSamples)) {
      sampleBudget = clamp(preset.megaLightsSamples, 0, 8);
      uniformsShared.uMegaSamplesPerPixel.value = sampleBudget;
    }
    if (Number.isInteger(preset.maxClusteredLights)) {
      const nextBudget = clamp(preset.maxClusteredLights, 1, maxLights);
      packingDirty ||= nextBudget !== lightBudget;
      lightBudget = nextBudget;
    }
  }

  function setViewportSize(width, height) {
    uniformsShared.uMegaResolution.value.set(Math.max(1, width), Math.max(1, height));
  }

  function computeSphereClusterBounds(vx, vy, vz, range, zLogScale, zLogBias) {
    const viewDepth = -vz;
    const zMin = Math.max(cachedNear, viewDepth - range);
    const zMax = Math.min(cachedFar, viewDepth + range);
    if (zMax < cachedNear || zMin > cachedFar) return null;

    const tz0 = clamp(Math.floor(Math.log(Math.max(cachedNear, zMin)) * zLogScale + zLogBias), 0, CLUSTER_SLICES_Z - 1);
    const tz1 = clamp(Math.floor(Math.log(Math.max(cachedNear, zMax)) * zLogScale + zLogBias), 0, CLUSTER_SLICES_Z - 1);

    let ndcMinX = -1, ndcMaxX = 1;
    let ndcMinY = -1, ndcMaxY = 1;

    if (viewDepth - range > cachedNear) {
      const p00 = 1 / (cachedAspect * cachedTanY);
      const p11 = 1 / cachedTanY;

      const dXZ = Math.hypot(vx, viewDepth);
      if (dXZ > range) {
        const ax = Math.atan2(vx, viewDepth);
        const bx = Math.asin(clamp(range / dXZ, 0, 1));
        ndcMinX = ax - bx <= -Math.PI * 0.495 ? -1 : clamp(Math.tan(ax - bx) * p00, -1, 1);
        ndcMaxX = ax + bx >= Math.PI * 0.495 ? 1 : clamp(Math.tan(ax + bx) * p00, -1, 1);
      }

      const dYZ = Math.hypot(vy, viewDepth);
      if (dYZ > range) {
        const ay = Math.atan2(vy, viewDepth);
        const by = Math.asin(clamp(range / dYZ, 0, 1));
        ndcMinY = ay - by <= -Math.PI * 0.495 ? -1 : clamp(Math.tan(ay - by) * p11, -1, 1);
        ndcMaxY = ay + by >= Math.PI * 0.495 ? 1 : clamp(Math.tan(ay + by) * p11, -1, 1);
      }
    }

    if (ndcMaxX < -1 || ndcMinX > 1 || ndcMaxY < -1 || ndcMinY > 1) return null;

    const tx0 = clamp(Math.floor((ndcMinX * 0.5 + 0.5) * CLUSTER_TILES_X), 0, CLUSTER_TILES_X - 1);
    const tx1 = clamp(Math.floor((ndcMaxX * 0.5 + 0.5) * CLUSTER_TILES_X), 0, CLUSTER_TILES_X - 1);
    const ty0 = clamp(Math.floor((ndcMinY * 0.5 + 0.5) * CLUSTER_TILES_Y), 0, CLUSTER_TILES_Y - 1);
    const ty1 = clamp(Math.floor((ndcMaxY * 0.5 + 0.5) * CLUSTER_TILES_Y), 0, CLUSTER_TILES_Y - 1);
    return { tx0, tx1, ty0, ty1, tz0, tz1 };
  }

  function touchCluster(index) {
    const row = index >> 4;
    const start = (index & 15) * CLUSTER_COMPONENTS;
    touchedRowStarts[row] = Math.min(touchedRowStarts[row], start);
    touchedRowEnds[row] = Math.max(touchedRowEnds[row], start + CLUSTER_COMPONENTS);
  }

  function update(camera = null, dt = 0, viewport = null) {
    if (disposed) return 0;
    const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    frameTime += stepDt;
    uniformsShared.uMegaTime.value = frameTime;

    if (viewport?.width > 0 && viewport?.height > 0) {
      setViewportSize(viewport.width, viewport.height);
    }

    // 1. Advance transient flash lights & prune expired
    if (stepDt > 0 && transientIds.size) {
      packingDirty = true;
      for (const id of transientIds) {
        const rec = lights.get(id);
        rec.age += stepDt;
        if (rec.age >= rec.duration) {
          removeLight(id);
        } else {
          const u = 1 - rec.age / rec.duration;
          rec.intensity = rec.peakIntensity * (u * u);
        }
      }
    }

    if (camera) {
      camera.updateMatrixWorld?.(true);
      if (camera.matrixWorldInverse && camera.matrixWorld) {
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert?.();
      }
      const near = Math.max(0.01, camera.near ?? 0.1);
      const far = Math.max(near + 1, camera.far ?? 1000);
      const aspect = Math.max(0.1, camera.aspect ?? 16 / 9);
      const tanY = Math.tan(((camera.fov ?? 60) * Math.PI) / 360);
      packingDirty ||= near !== cachedNear || far !== cachedFar || aspect !== cachedAspect || tanY !== cachedTanY;
      cachedNear = near;
      cachedFar = far;
      cachedAspect = aspect;
      cachedTanY = tanY;
    }

    const m = camera?.matrixWorldInverse?.elements;
    packingDirty ||= Boolean(m) !== hasPackedView;
    if (m) {
      for (let i = 0; i < 16; i++) {
        if (packedViewMatrix[i] !== m[i]) packingDirty = true;
        packedViewMatrix[i] = m[i];
      }
    }
    hasPackedView = Boolean(m);
    if (!packingDirty) return activeCount;

    const logRange = Math.log(cachedFar / cachedNear);
    const zLogScale = CLUSTER_SLICES_Z / Math.max(1e-4, logRange);
    const zLogBias = -(CLUSTER_SLICES_Z * Math.log(cachedNear)) / Math.max(1e-4, logRange);
    uniformsShared.uMegaZParams.value.set(cachedNear, cachedFar, zLogScale, zLogBias);

    if (lights.size === 0 && activeCount === 0) {
      packingDirty = false;
      return 0;
    }

    visibleScratch.length = 0;

    for (const rec of lights.values()) {
      if (!rec.enabled || rec.intensity <= 1e-4) continue;
      let vx, vy, vz, svx, svy, svz;
      if (m) {
        vx = m[0] * rec.x + m[4] * rec.y + m[8] * rec.z + m[12];
        vy = m[1] * rec.x + m[5] * rec.y + m[9] * rec.z + m[13];
        vz = m[2] * rec.x + m[6] * rec.y + m[10] * rec.z + m[14];
        svx = m[0] * rec.dirX + m[4] * rec.dirY + m[8] * rec.dirZ;
        svy = m[1] * rec.dirX + m[5] * rec.dirY + m[9] * rec.dirZ;
        svz = m[2] * rec.dirX + m[6] * rec.dirY + m[10] * rec.dirZ;
      } else {
        vx = rec.x;
        vy = rec.y;
        vz = rec.z;
        svx = rec.dirX;
        svy = rec.dirY;
        svz = rec.dirZ;
      }

      const bounds = computeSphereClusterBounds(vx, vy, vz, rec.range, zLogScale, zLogBias);
      if (!bounds) continue;

      const distSq = vx * vx + vy * vy + vz * vz;
      const lum = Math.max(0.01, (0.2126 * rec.r + 0.7152 * rec.g + 0.0722 * rec.b) * rec.intensity);
      const importance = (lum * rec.range * rec.range) / Math.max(1.0, distSq);
      visibleScratch.push({
        rec,
        vx,
        vy,
        vz,
        svx,
        svy,
        svz,
        lum,
        importance,
        bounds,
      });
    }

    if (visibleScratch.length > lightBudget) {
      visibleScratch.sort((a, b) => b.importance - a.importance);
      visibleScratch.length = lightBudget;
    }

    const previousActiveCount = activeCount;
    activeCount = visibleScratch.length;
    uniformsShared.uMegaActiveCount.value = activeCount;

    // Track the union of the previously and currently occupied cluster windows.
    touchedRowStarts.fill(CLUSTER_TEX_WIDTH * 4);
    touchedRowEnds.fill(0);
    for (let i = 0; i < occupiedClusterCount; i++) {
      const cluster = occupiedClusters[i];
      clusterData[cluster * CLUSTER_COMPONENTS] = 0;
      touchCluster(cluster);
    }
    occupiedClusterCount = 0;

    // Pack visible lights into lightData + clusterData
    for (let i = 0; i < activeCount; i++) {
      const item = visibleScratch[i];
      const rec = item.rec;
      const rowBase = i * 16; // 4 texels * 4 floats

      // Texel 0: viewPos.xyz, 1/range
      lightData[rowBase] = item.vx;
      lightData[rowBase + 1] = item.vy;
      lightData[rowBase + 2] = item.vz;
      lightData[rowBase + 3] = 1 / rec.range;

      // Texel 1: linearRGB * intensity, sourceRadius
      lightData[rowBase + 4] = rec.r * rec.intensity;
      lightData[rowBase + 5] = rec.g * rec.intensity;
      lightData[rowBase + 6] = rec.b * rec.intensity;
      lightData[rowBase + 7] = rec.radius;

      // Texel 2: spotDirView.xyz, outerCos (-2 for point)
      const isSpot = rec.type === 'spot';
      lightData[rowBase + 8] = item.svx;
      lightData[rowBase + 9] = item.svy;
      lightData[rowBase + 10] = item.svz;
      lightData[rowBase + 11] = isSpot ? rec.outerCos : -2.0;

      // Texel 3: invCosDiff, luminance, range, 0
      const cosDiff = Math.max(1e-4, rec.innerCos - rec.outerCos);
      lightData[rowBase + 12] = isSpot ? (1 / cosDiff) : 1.0;
      lightData[rowBase + 13] = item.lum;
      lightData[rowBase + 14] = rec.range;
      lightData[rowBase + 15] = 0;

      const { tx0, tx1, ty0, ty1, tz0, tz1 } = item.bounds;
      for (let cz = tz0; cz <= tz1; cz++) {
        for (let cy = ty0; cy <= ty1; cy++) {
          for (let cx = tx0; cx <= tx1; cx++) {
            const c = (cz * CLUSTER_TILES_Y + cy) * CLUSTER_TILES_X + cx;
            const headOffset = c * CLUSTER_COMPONENTS;
            const count = clusterData[headOffset] | 0;
            if (count < CLUSTER_MAX_LIGHTS) {
              if (count === 0) {
                occupiedClusters[occupiedClusterCount++] = c;
                touchCluster(c);
              }
              const slot = count + 1;
              clusterData[headOffset] = slot;
              clusterData[headOffset + slot] = i;
            }
          }
        }
      }
    }

    if (previousActiveCount > activeCount) lightData.fill(0, activeCount * 16, previousActiveCount * 16);
    lightUpload.publish(Math.max(activeCount, previousActiveCount));
    clusterUpload.publish(CLUSTER_TEX_HEIGHT, touchedRowStarts, touchedRowEnds);
    packingDirty = false;
    return activeCount;
  }

  function evaluateClusterAtViewPos(vx, vy, vz, ndcX = 0, ndcY = 0) {
    const z = Math.max(cachedNear, -vz);
    const cz = clamp(
      Math.floor(Math.log(z) * uniformsShared.uMegaZParams.value.z + uniformsShared.uMegaZParams.value.w),
      0,
      CLUSTER_SLICES_Z - 1,
    );
    const cx = clamp(Math.floor((ndcX * 0.5 + 0.5) * CLUSTER_TILES_X), 0, CLUSTER_TILES_X - 1);
    const cy = clamp(Math.floor((ndcY * 0.5 + 0.5) * CLUSTER_TILES_Y), 0, CLUSTER_TILES_Y - 1);
    const c = (cz * CLUSTER_TILES_Y + cy) * CLUSTER_TILES_X + cx;
    const cRow = c >> 4;
    const cCol = (c & 15) * CLUSTER_TEXELS_PER_CLUSTER;
    const count = clusterData[(cRow * CLUSTER_TEX_WIDTH + cCol) * 4] | 0;
    const indices = [];
    for (let slot = 1; slot <= count; slot++) {
      const texelSlot = slot >> 2;
      const comp = slot & 3;
      indices.push(clusterData[(cRow * CLUSTER_TEX_WIDTH + cCol + texelSlot) * 4 + comp] | 0);
    }
    return { clusterIndex: c, cx, cy, cz, count, indices };
  }

  function applyToMaterial(material) {
    if (!material || typeof material !== 'object') {
      throw new TypeError('applyToMaterial requires a Three.js material');
    }
    material.userData ??= {};
    if (material.userData.megaLightsApplied) return material;

    const prevCompile = material.onBeforeCompile;
    const prevCacheKey = typeof material.customProgramCacheKey === 'function'
      ? material.customProgramCacheKey.bind(material)
      : () => '';

    material.customProgramCacheKey = () => {
      const base = prevCacheKey();
      return base ? base + ':megalights' : 'megalights';
    };

    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniformsShared);

      const marker = '#include <lights_fragment_end>';
      if (!shader.fragmentShader.includes(marker)) {
        throw new Error('Three.js lights_fragment_end shader chunk missing');
      }

      const decls = `
        uniform sampler2D uMegaLightData;
        uniform sampler2D uMegaClusterTex;
        uniform float uMegaDataHeight;
        uniform vec2 uMegaResolution;
        uniform vec4 uMegaZParams;
        uniform float uMegaActiveCount;
        uniform float uMegaSamplesPerPixel;
        uniform float uMegaTime;

        float megaIgn(vec2 p) {
          return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
        }

        float megaClusterComp(int x0, int y0, int slot) {
          int texOff = slot / 4;
          int comp = slot - texOff * 4;
          vec4 v = texture2D(uMegaClusterTex, vec2((float(x0 + texOff) + 0.5) / ${CLUSTER_TEX_WIDTH}.0, (float(y0) + 0.5) / ${CLUSTER_TEX_HEIGHT}.0));
          if (comp == 0) return v.r;
          if (comp == 1) return v.g;
          if (comp == 2) return v.b;
          return v.a;
        }

        vec4 megaFetchLightTexel(int lightIdx, int col) {
          return texture2D(uMegaLightData, vec2((float(col) + 0.5) / 4.0, (float(lightIdx) + 0.5) / max(1.0, uMegaDataHeight)));
        }

        float megaLightWeight(int lightIdx, vec3 viewPos, vec3 viewN, out vec3 outDir, out float outAtten) {
          vec4 t0 = megaFetchLightTexel(lightIdx, 0);
          vec4 t2 = megaFetchLightTexel(lightIdx, 2);
          vec4 t3 = megaFetchLightTexel(lightIdx, 3);
          vec3 delta = t0.xyz - viewPos;
          float distSq = dot(delta, delta);
          float invRange = t0.w;
          float dist = sqrt(max(1e-6, distSq));
          outDir = delta / dist;
          float r = clamp(dist * invRange, 0.0, 1.0);
          float win = (1.0 - r * r);
          win = win * win;
          outAtten = (win / (1.0 + distSq * 0.25));
          if (t2.w > -1.5) {
            float spotCos = dot(-outDir, normalize(t2.xyz));
            outAtten *= clamp((spotCos - t2.w) * t3.x, 0.0, 1.0);
          }
          float ndl = max(0.08, dot(viewN, outDir));
          return max(0.0, t3.y * outAtten * ndl);
        }
      `;

      const evalBody = `
        #if defined( RE_Direct )
        if (uMegaActiveCount > 0.5) {
          float megaViewZ = max(uMegaZParams.x, -geometryPosition.z);
          if (megaViewZ >= uMegaZParams.x && megaViewZ <= uMegaZParams.y) {
            int mCx = clamp(int(floor((gl_FragCoord.x / max(1.0, uMegaResolution.x)) * ${CLUSTER_TILES_X}.0)), 0, ${CLUSTER_TILES_X - 1});
            int mCy = clamp(int(floor((gl_FragCoord.y / max(1.0, uMegaResolution.y)) * ${CLUSTER_TILES_Y}.0)), 0, ${CLUSTER_TILES_Y - 1});
            int mCz = clamp(int(floor(log(megaViewZ) * uMegaZParams.z + uMegaZParams.w)), 0, ${CLUSTER_SLICES_Z - 1});
            int mCluster = (mCz * ${CLUSTER_TILES_Y} + mCy) * ${CLUSTER_TILES_X} + mCx;
            int mRow = mCluster / 16;
            int mCol = (mCluster - mRow * 16) * ${CLUSTER_TEXELS_PER_CLUSTER};
            int mCount = clamp(int(megaClusterComp(mCol, mRow, 0) + 0.5), 0, ${CLUSTER_MAX_LIGHTS});
            int mSamples = int(uMegaSamplesPerPixel + 0.5);

            if (mCount > 0) {
              if (mSamples <= 0 || mCount <= mSamples) {
                for (int k = 1; k <= ${CLUSTER_MAX_LIGHTS}; k++) {
                  if (k > mCount) break;
                  int li = int(megaClusterComp(mCol, mRow, k) + 0.5);
                  vec3 lDir;
                  float lAtten;
                  float w = megaLightWeight(li, geometryPosition, geometryNormal, lDir, lAtten);
                  if (lAtten > 1e-4) {
                    vec4 t1 = megaFetchLightTexel(li, 1);
                    directLight.direction = lDir;
                    directLight.color = t1.rgb * lAtten;
                    directLight.visible = true;
                    RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                  }
                }
              } else {
                float totalW = 0.0;
                for (int k = 1; k <= ${CLUSTER_MAX_LIGHTS}; k++) {
                  if (k > mCount) break;
                  int li = int(megaClusterComp(mCol, mRow, k) + 0.5);
                  vec3 lDir;
                  float lAtten;
                  totalW += megaLightWeight(li, geometryPosition, geometryNormal, lDir, lAtten);
                }
                if (totalW > 1e-6) {
                  float seed = megaIgn(gl_FragCoord.xy + vec2(fract(uMegaTime * 19.7) * 97.0, 31.0));
                  for (int s = 0; s < 8; s++) {
                    if (s >= mSamples) break;
                    float target = fract(seed + float(s) / float(mSamples)) * totalW;
                    float accum = 0.0;
                    for (int k = 1; k <= ${CLUSTER_MAX_LIGHTS}; k++) {
                      if (k > mCount) break;
                      int li = int(megaClusterComp(mCol, mRow, k) + 0.5);
                      vec3 lDir;
                      float lAtten;
                      float wk = megaLightWeight(li, geometryPosition, geometryNormal, lDir, lAtten);
                      accum += wk;
                      if (accum >= target && wk > 1e-6) {
                        vec4 t1 = megaFetchLightTexel(li, 1);
                        float invPdf = totalW / (float(mSamples) * wk);
                        directLight.direction = lDir;
                        directLight.color = t1.rgb * (lAtten * invPdf);
                        directLight.visible = true;
                        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
        #endif
      `;

      shader.fragmentShader = decls + shader.fragmentShader.replace(marker, evalBody + '\n' + marker);
    };

    material.userData.megaLightsApplied = true;
    material.needsUpdate = true;
    return material;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    lights.clear();
    transientIds.clear();
    visibleScratch.length = 0;
    lightDataTex.dispose?.();
    clusterTex.dispose?.();
    return true;
  }

  return {
    get count() { return lights.size; },
    get activeCount() { return activeCount; },
    get maxLights() { return maxLights; },
    get samplesPerPixel() { return sampleBudget; },
    get activeBudget() { return lightBudget; },
    get clusterDims() { return [CLUSTER_TILES_X, CLUSTER_TILES_Y, CLUSTER_SLICES_Z]; },
    get lightDataTexture() { return lightDataTex; },
    get clusterTexture() { return clusterTex; },
    get uploadStats() { return { light: lightUpload.stats(), cluster: clusterUpload.stats() }; },
    get uniforms() { return uniformsShared; },
    addLight,
    updateLight,
    removeLight,
    flash,
    clear,
    setQualityPreset,
    setViewportSize,
    update,
    evaluateClusterAtViewPos,
    applyToMaterial,
    dispose,
  };
}

/**
 * @typedef {object} IrradianceProbeVolume3DOptions
 * @property {readonly number[]} [min] Volume minimum corner `[x,y,z]`, world units. Default `[-32,0,-32]`.
 * @property {readonly number[]} [max] Volume maximum corner. Default `[32,16,32]`.
 * @property {readonly number[]} [resolution] Probe counts `[nx,ny,nz]` (each >= 2). Default `[8,4,8]`.
 * @property {number} [intensity] Global intensity multiplier (>= 0). Default `1`.
 * @typedef {object} HemisphereInjection
 * @property {LightColorInput} [skyColor] Default `0x8bb7f0`.
 * @property {LightColorInput} [groundColor] Default `0x3a332a`.
 * @property {number} [intensity] Default `1`.
 * @typedef {object} DirectionalBounceInjection
 * @property {LightingVec3Input} [direction] Light travel/sun direction. Default `[0.46,0.72,0.52]`.
 * @property {LightColorInput} [color] Default `0xfff1d6`.
 * @property {number} [intensity] Default `1`.
 * @property {number} [groundAlbedo] Ground reflectance 0..1. Default `0.35`.
 * @typedef {object} PointLightBounceInjection
 * @property {number} [x] World X. Default `0`.
 * @property {number} [y] World Y. Default `0`.
 * @property {number} [z] World Z. Default `0`.
 * @property {LightColorInput} [color] Default `0xffffff`.
 * @property {number} [intensity] Default `1`.
 * @property {number} [range] World units (min 0.5). Default `12`.
 * @property {number} [bounceRatio] Default `0.35`.
 * @typedef {object} ProbeBakeSky Sky-like object (e.g. from sky3d).
 * @property {Record<string, {value?: LightColorInput | number}>} [uniforms]
 * @property {LightingVec3Input} [sunDirection]
 * @typedef {object} ProbeBakeOptions
 * @property {ProbeBakeSky | null} [sky] Default `null`.
 * @property {readonly PointLightBounceInjection[]} [lights] Point lights to inject. Default `[]`.
 * @property {number} [ambientIntensity] Default `0.55`.
 * @property {number} [bounceIntensity] Ground albedo of sun bounce. Default `0.4`.
 * @typedef {object} ProbeVolumeMaterialOptions
 * @property {number | null} [intensity] Optional new global intensity. Default `null`.
 * @typedef {object} IrradianceProbeVolume3D
 * @property {{min: number[], max: number[]}} bounds Volume corners (copy; read-only).
 * @property {number[]} resolution Probe counts `[nx,ny,nz]` (copy; read-only).
 * @property {number} probeCount Total probes (read-only).
 * @property {LightingTextureLike} texture SH data texture (read-only).
 * @property {number} intensity Global intensity (read-only).
 * @property {() => void} clear Zero all probes.
 * @property {(options?: HemisphereInjection) => void} injectHemisphere
 * @property {(options?: DirectionalBounceInjection) => void} injectDirectionalBounce
 * @property {(options?: PointLightBounceInjection) => void} injectPointLightBounce
 * @property {(options?: ProbeBakeOptions) => void} bakeFromScene Clears then re-bakes.
 * @property {(x: number, y: number, z: number, normalX?: number, normalY?: number, normalZ?: number, out?: number[]) => number[]} sampleIrradiance Trilinear linear-RGB irradiance at a world position (default normal up).
 * @property {(dx?: number, dy?: number, dz?: number) => void} shiftOrigin Floating-origin shift, world units.
 * @property {(value: number) => void} setIntensity Ignored unless finite and >= 0.
 * @property {<M extends LightingMaterialLike>(material: M, options?: ProbeVolumeMaterialOptions) => M} applyToMaterial
 * @property {() => boolean} dispose
 */
/**
 * Creates a world-space Spherical Harmonics (SH L1) Irradiance Probe Volume
 * storing multi-bounce diffuse indirect illumination on a 3D lattice with
 * CPU trilinear sampling, Floating-Origin shifting, and composable PBR injection.
 * @param {LightingThreeLike | null | undefined} THREE Injected Three.js namespace subset (or null for headless).
 * @param {IrradianceProbeVolume3DOptions} [options]
 * @returns {IrradianceProbeVolume3D}
 */export function createIrradianceProbeVolume3D(THREE, options = {}) {
  const min = options.min ? [...options.min] : [-32, 0, -32];
  const max = options.max ? [...options.max] : [32, 16, 32];
  const resolution = options.resolution ? options.resolution.map(n => Math.max(2, Math.floor(n))) : [8, 4, 8];
  const [nx, ny, nz] = resolution;
  const totalProbes = nx * ny * nz;
  const probeSH = new Float32Array(totalProbes * 12); // 3 channels * 4 SH L1 coeffs
  const texWidth = nx * 3;
  const texHeight = ny * nz;
  const probeDataTex = makeFloatDataTexture(THREE, probeSH, texWidth, texHeight);

  let disposed = false;
  const volumeIntensity = Number.isFinite(options.intensity) ? Math.max(0, options.intensity) : 1.0;

  const uniformsShared = {
    uProbeVolumeTex: { value: probeDataTex },
    uProbeVolumeMin: { value: THREE?.Vector3 ? new THREE.Vector3(...min) : { x: min[0], y: min[1], z: min[2], set(a, b, c) { this.x = a; this.y = b; this.z = c; } } },
    uProbeVolumeInvSize: {
      value: THREE?.Vector3
        ? new THREE.Vector3(1 / Math.max(1e-4, max[0] - min[0]), 1 / Math.max(1e-4, max[1] - min[1]), 1 / Math.max(1e-4, max[2] - min[2]))
        : { x: 1, y: 1, z: 1, set(a, b, c) { this.x = a; this.y = b; this.z = c; } },
    },
    uProbeVolumeRes: { value: THREE?.Vector3 ? new THREE.Vector3(nx, ny, nz) : { x: nx, y: ny, z: nz } },
    uProbeVolumeIntensity: { value: volumeIntensity },
  };

  function probeCoords(ix, iy, iz) {
    const sx = (max[0] - min[0]) / Math.max(1, nx - 1);
    const sy = (max[1] - min[1]) / Math.max(1, ny - 1);
    const sz = (max[2] - min[2]) / Math.max(1, nz - 1);
    return [min[0] + ix * sx, min[1] + iy * sy, min[2] + iz * sz];
  }

  function probeBase(ix, iy, iz) {
    return ((iz * ny + iy) * nx + ix) * 12;
  }

  function clear() {
    probeSH.fill(0);
    probeDataTex.needsUpdate = true;
  }

  function addDirectionalToProbe(base, dx, dy, dz, r, g, b) {
    const [nxD, nyD, nzD] = normalizeVec3Array([dx, dy, dz], [0, 1, 0]);
    const w0 = SH_Y0;
    const wx = SH_Y1 * nxD;
    const wy = SH_Y1 * nyD;
    const wz = SH_Y1 * nzD;

    probeSH[base] += r * w0;
    probeSH[base + 1] += r * wx;
    probeSH[base + 2] += r * wy;
    probeSH[base + 3] += r * wz;

    probeSH[base + 4] += g * w0;
    probeSH[base + 5] += g * wx;
    probeSH[base + 6] += g * wy;
    probeSH[base + 7] += g * wz;

    probeSH[base + 8] += b * w0;
    probeSH[base + 9] += b * wx;
    probeSH[base + 10] += b * wy;
    probeSH[base + 11] += b * wz;
  }

  function injectHemisphere({
    skyColor = 0x8bb7f0,
    groundColor = 0x3a332a,
    intensity = 1.0,
  } = {}) {
    const sky = colorToLinearRGB(THREE, skyColor, 0x8bb7f0);
    const gnd = colorToLinearRGB(THREE, groundColor, 0x3a332a);
    const scale = Math.max(0, intensity);
    // Analytic upper + lower hemisphere SH projection:
    // c0 = (sky + gnd) * 0.5 / SH_Y0 * (4*PI / 4*PI) => E(up) = PI * sky when gnd = 0
    const k0 = 0.5 / SH_Y0;
    const ky = (0.5 / (SH_A1 * SH_Y1)) * Math.PI;
    for (let i = 0; i < totalProbes; i++) {
      const b = i * 12;
      for (let c = 0; c < 3; c++) {
        probeSH[b + c * 4] += (sky[c] + gnd[c]) * k0 * scale;
        probeSH[b + c * 4 + 2] += (sky[c] - gnd[c]) * ky * scale;
      }
    }
    probeDataTex.needsUpdate = true;
  }

  function injectDirectionalBounce({
    direction = [0.46, 0.72, 0.52],
    color = 0xfff1d6,
    intensity = 1.0,
    groundAlbedo = 0.35,
  } = {}) {
    const col = colorToLinearRGB(THREE, color, 0xfff1d6);
    const [dx, dy, dz] = normalizeVec3Array(direction, [0.46, 0.72, 0.52]);
    // Sunlight hitting horizontal ground scatters predominantly upward (+Y, tilted opposite sunXZ).
    const bDir = normalizeVec3Array([-dx * 0.25, Math.max(0.45, dy), -dz * 0.25], [0, 1, 0]);
    const bounceScale = Math.max(0, intensity * groundAlbedo);
    const r = col[0] * bounceScale;
    const g = col[1] * bounceScale;
    const b = col[2] * bounceScale;
    for (let i = 0; i < totalProbes; i++) {
      addDirectionalToProbe(i * 12, bDir[0], bDir[1], bDir[2], r, g, b);
    }
    probeDataTex.needsUpdate = true;
  }

  function injectPointLightBounce({
    x = 0, y = 0, z = 0,
    color = 0xffffff,
    intensity = 1.0,
    range = 12,
    bounceRatio = 0.35,
  } = {}) {
    const col = colorToLinearRGB(THREE, color, 0xffffff);
    const rMax = Math.max(0.5, range);
    const strength = Math.max(0, intensity * bounceRatio);
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const [px, py, pz] = probeCoords(ix, iy, iz);
          const dx = x - px;
          const dy = y - py;
          const dz = z - pz;
          const dist = Math.hypot(dx, dy, dz);
          if (dist >= rMax) continue;
          const ratio = dist / rMax;
          const falloff = (1 - ratio * ratio) * (1 - ratio * ratio) / (1 + dist * dist * 0.15);
          const base = probeBase(ix, iy, iz);
          const dir = dist > 1e-4 ? [dx / dist, dy / dist, dz / dist] : [0, 1, 0];
          addDirectionalToProbe(base, dir[0], dir[1], dir[2], col[0] * strength * falloff, col[1] * strength * falloff, col[2] * strength * falloff);
        }
      }
    }
    probeDataTex.needsUpdate = true;
  }

  function bakeFromScene({ sky = null, lights = [], ambientIntensity = 0.55, bounceIntensity = 0.4 } = {}) {
    clear();
    if (sky?.uniforms) {
      injectHemisphere({
        skyColor: sky.uniforms.uZenithColor?.value ?? 0x8bb7f0,
        groundColor: sky.uniforms.uGroundColor?.value ?? 0x3a332a,
        intensity: ambientIntensity,
      });
      if (sky.sunDirection) {
        injectDirectionalBounce({
          direction: sky.sunDirection,
          color: sky.uniforms.uSunColor?.value ?? 0xfff1d6,
          intensity: sky.uniforms.uSunIntensity?.value ?? 1.0,
          groundAlbedo: bounceIntensity,
        });
      }
    } else {
      injectHemisphere({ intensity: ambientIntensity });
    }
    for (const light of lights) {
      injectPointLightBounce(light);
    }
  }

  function evalSingleProbe(ix, iy, iz, nX, nY, nZ, out) {
    const b = probeBase(ix, iy, iz);
    out[0] = Math.max(0, SH_A0 * SH_Y0 * probeSH[b] + SH_A1 * SH_Y1 * (probeSH[b + 1] * nX + probeSH[b + 2] * nY + probeSH[b + 3] * nZ));
    out[1] = Math.max(0, SH_A0 * SH_Y0 * probeSH[b + 4] + SH_A1 * SH_Y1 * (probeSH[b + 5] * nX + probeSH[b + 6] * nY + probeSH[b + 7] * nZ));
    out[2] = Math.max(0, SH_A0 * SH_Y0 * probeSH[b + 8] + SH_A1 * SH_Y1 * (probeSH[b + 9] * nX + probeSH[b + 10] * nY + probeSH[b + 11] * nZ));
  }

  function sampleIrradiance(x, y, z, normalX = 0, normalY = 1, normalZ = 0, out = [0, 0, 0]) {
    const [nX, nY, nZ] = normalizeVec3Array([normalX, normalY, normalZ], [0, 1, 0]);
    const fx = clamp((x - min[0]) / Math.max(1e-4, max[0] - min[0]), 0, 1) * (nx - 1);
    const fy = clamp((y - min[1]) / Math.max(1e-4, max[1] - min[1]), 0, 1) * (ny - 1);
    const fz = clamp((z - min[2]) / Math.max(1e-4, max[2] - min[2]), 0, 1) * (nz - 1);

    const x0 = Math.min(nx - 2, Math.floor(fx));
    const y0 = Math.min(ny - 2, Math.floor(fy));
    const z0 = Math.min(nz - 2, Math.floor(fz));
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;

    const c000 = [0, 0, 0], c100 = [0, 0, 0], c010 = [0, 0, 0], c110 = [0, 0, 0];
    const c001 = [0, 0, 0], c101 = [0, 0, 0], c011 = [0, 0, 0], c111 = [0, 0, 0];
    evalSingleProbe(x0, y0, z0, nX, nY, nZ, c000);
    evalSingleProbe(x1, y0, z0, nX, nY, nZ, c100);
    evalSingleProbe(x0, y1, z0, nX, nY, nZ, c010);
    evalSingleProbe(x1, y1, z0, nX, nY, nZ, c110);
    evalSingleProbe(x0, y0, z1, nX, nY, nZ, c001);
    evalSingleProbe(x1, y0, z1, nX, nY, nZ, c101);
    evalSingleProbe(x0, y1, z1, nX, nY, nZ, c011);
    evalSingleProbe(x1, y1, z1, nX, nY, nZ, c111);

    for (let k = 0; k < 3; k++) {
      const c00 = c000[k] * (1 - tx) + c100[k] * tx;
      const c10 = c010[k] * (1 - tx) + c110[k] * tx;
      const c01 = c001[k] * (1 - tx) + c101[k] * tx;
      const c11 = c011[k] * (1 - tx) + c111[k] * tx;
      const c0 = c00 * (1 - ty) + c10 * ty;
      const c1 = c01 * (1 - ty) + c11 * ty;
      out[k] = (c0 * (1 - tz) + c1 * tz) * uniformsShared.uProbeVolumeIntensity.value;
    }
    return out;
  }

  function shiftOrigin(dx = 0, dy = 0, dz = 0) {
    min[0] += dx; min[1] += dy; min[2] += dz;
    max[0] += dx; max[1] += dy; max[2] += dz;
    uniformsShared.uProbeVolumeMin.value.set(min[0], min[1], min[2]);
  }

  function setIntensity(value) {
    if (Number.isFinite(value) && value >= 0) {
      uniformsShared.uProbeVolumeIntensity.value = value;
    }
  }

  function applyToMaterial(material, { intensity = null } = {}) {
    if (!material || typeof material !== 'object') {
      throw new TypeError('applyToMaterial requires a Three.js material');
    }
    if (Number.isFinite(intensity) && intensity >= 0) {
      setIntensity(intensity);
    }
    material.userData ??= {};
    if (material.userData.shProbeVolumeApplied) return material;

    const prevCompile = material.onBeforeCompile;
    const prevCacheKey = typeof material.customProgramCacheKey === 'function'
      ? material.customProgramCacheKey.bind(material)
      : () => '';

    material.customProgramCacheKey = () => {
      const base = prevCacheKey();
      return base ? base + ':shprobes' : 'shprobes';
    };

    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniformsShared);

      const vMarker = '#include <project_vertex>';
      const fMarker = '#include <lights_fragment_end>';
      if (!shader.vertexShader.includes(vMarker) || !shader.fragmentShader.includes(fMarker)) {
        throw new Error('Three.js shader chunk missing for SH Probe Volume');
      }

      shader.vertexShader = `
        varying vec3 vShProbeWorldPos;
      ` + shader.vertexShader.replace(vMarker, vMarker + `
        vec4 shWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          shWorld = instanceMatrix * shWorld;
        #endif
        #ifdef USE_BATCHING
          shWorld = batchingMatrix * shWorld;
        #endif
        vShProbeWorldPos = (modelMatrix * shWorld).xyz;
      `);

      const fragDecls = `
        uniform sampler2D uProbeVolumeTex;
        uniform vec3 uProbeVolumeMin;
        uniform vec3 uProbeVolumeInvSize;
        uniform vec3 uProbeVolumeRes;
        uniform float uProbeVolumeIntensity;
        varying vec3 vShProbeWorldPos;

        vec3 evalSingleShProbe(int ix, int iy, int iz, vec3 wn) {
          int nxI = int(uProbeVolumeRes.x + 0.5);
          int nyI = int(uProbeVolumeRes.y + 0.5);
          float texW = float(nxI * 3);
          float texH = float(nyI) * uProbeVolumeRes.z;
          float rowY = (float(iz * nyI + iy) + 0.5) / texH;
          vec4 cR = texture2D(uProbeVolumeTex, vec2((float(ix * 3) + 0.5) / texW, rowY));
          vec4 cG = texture2D(uProbeVolumeTex, vec2((float(ix * 3 + 1) + 0.5) / texW, rowY));
          vec4 cB = texture2D(uProbeVolumeTex, vec2((float(ix * 3 + 2) + 0.5) / texW, rowY));
          vec4 basis = vec4(${SH_A0 * SH_Y0}, ${SH_A1 * SH_Y1} * wn.x, ${SH_A1 * SH_Y1} * wn.y, ${SH_A1 * SH_Y1} * wn.z);
          return max(vec3(0.0), vec3(dot(cR, basis), dot(cG, basis), dot(cB, basis)));
        }

        vec3 sampleShProbeVolume(vec3 worldPos, vec3 wn) {
          vec3 grid = clamp((worldPos - uProbeVolumeMin) * uProbeVolumeInvSize, vec3(0.0), vec3(1.0)) * (uProbeVolumeRes - vec3(1.0));
          ivec3 i0 = min(ivec3(uProbeVolumeRes) - ivec3(2), ivec3(floor(grid)));
          ivec3 i1 = i0 + ivec3(1);
          vec3 f = clamp(grid - vec3(i0), vec3(0.0), vec3(1.0));
          vec3 c00 = mix(evalSingleShProbe(i0.x, i0.y, i0.z, wn), evalSingleShProbe(i1.x, i0.y, i0.z, wn), f.x);
          vec3 c10 = mix(evalSingleShProbe(i0.x, i1.y, i0.z, wn), evalSingleShProbe(i1.x, i1.y, i0.z, wn), f.x);
          vec3 c01 = mix(evalSingleShProbe(i0.x, i0.y, i1.z, wn), evalSingleShProbe(i1.x, i0.y, i1.z, wn), f.x);
          vec3 c11 = mix(evalSingleShProbe(i0.x, i1.y, i1.z, wn), evalSingleShProbe(i1.x, i1.y, i1.z, wn), f.x);
          return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
        }
      `;

      const injectBody = `
        #if defined( RE_IndirectDiffuse )
        if (uProbeVolumeIntensity > 0.001) {
          vec3 probeWorldN = normalize(vec3(
            dot(viewMatrix[0].xyz, geometryNormal),
            dot(viewMatrix[1].xyz, geometryNormal),
            dot(viewMatrix[2].xyz, geometryNormal)
          ));
          irradiance += sampleShProbeVolume(vShProbeWorldPos, probeWorldN) * uProbeVolumeIntensity;
        }
        #endif
      `;

      shader.fragmentShader = fragDecls + shader.fragmentShader.replace(fMarker, injectBody + '\n' + fMarker);
    };

    material.userData.shProbeVolumeApplied = true;
    material.needsUpdate = true;
    return material;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    probeDataTex.dispose?.();
    return true;
  }

  return {
    get bounds() { return { min: [...min], max: [...max] }; },
    get resolution() { return [...resolution]; },
    get probeCount() { return totalProbes; },
    get texture() { return probeDataTex; },
    get intensity() { return uniformsShared.uProbeVolumeIntensity.value; },
    clear,
    injectHemisphere,
    injectDirectionalBounce,
    injectPointLightBounce,
    bakeFromScene,
    sampleIrradiance,
    shiftOrigin,
    setIntensity,
    applyToMaterial,
    dispose,
  };
}

/**
 * Local Box-Projected Reflection Probe manager supporting priority sorting and smooth exterior
 * distance blending between overlapping IBL volumes.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.maxProbes=8] Maximum resident local reflection probes.
 * @param {number} [options.blendMargin=3] Exterior transition blend distance in world units.
 */
export function createReflectionProbeManager3D(THREE, { maxProbes = 8, blendMargin = 3 } = {}) {
  const cap = Math.max(1, Math.floor(maxProbes) || 8);
  const margin = Math.max(0, Number(blendMargin) || 0);
  const probes = new Map();
  let tick = 0;

  function addProbe(id, {
    position = [0, 0, 0],
    min = [-10, -5, -10],
    max = [10, 5, 10],
    envMap = null,
    intensity = 1,
    boxProjection = true,
    priority = 0,
  } = {}) {
    const key = String(id);
    if (!probes.has(key) && probes.size >= cap) {
      let oldest = null;
      for (const p of probes.values()) {
        if (!oldest || p.tick < oldest.tick) oldest = p;
      }
      if (oldest) probes.delete(oldest.id);
    }
    const pMin = [Number(min[0]) || 0, Number(min[1]) || 0, Number(min[2]) || 0];
    const pMax = [Number(max[0]) || 0, Number(max[1]) || 0, Number(max[2]) || 0];
    const pos = Array.isArray(position)
      ? [Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0]
      : [Number(position?.x) || 0, Number(position?.y) || 0, Number(position?.z) || 0];
    const entry = {
      id: key,
      position: pos,
      min: pMin,
      max: pMax,
      envMap,
      intensity: Math.max(0, Number(intensity) || 0),
      boxProjection: Boolean(boxProjection),
      priority: Number(priority) || 0,
      tick: ++tick,
    };
    probes.set(key, entry);
    return entry;
  }

  function removeProbe(id) {
    return probes.delete(String(id));
  }

  function evaluateAt(position = [0, 0, 0]) {
    const px = Array.isArray(position) ? (Number(position[0]) || 0) : (Number(position?.x) || 0);
    const py = Array.isArray(position) ? (Number(position[1]) || 0) : (Number(position?.y) || 0);
    const pz = Array.isArray(position) ? (Number(position[2]) || 0) : (Number(position?.z) || 0);

    const candidates = [];
    for (const p of probes.values()) {
      const dx = px < p.min[0] ? p.min[0] - px : (px > p.max[0] ? px - p.max[0] : 0);
      const dy = py < p.min[1] ? p.min[1] - py : (py > p.max[1] ? py - p.max[1] : 0);
      const dz = pz < p.min[2] ? p.min[2] - pz : (pz > p.max[2] ? pz - p.max[2] : 0);
      const dOut = Math.hypot(dx, dy, dz);
      let spatial = 0;
      if (dOut <= 0) {
        spatial = 1;
      } else if (margin > 0 && dOut < margin) {
        const t = 1 - dOut / margin;
        spatial = t * t * (3 - 2 * t);
      }
      if (spatial > 0) {
        p.tick = ++tick;
        candidates.push({ entry: p, spatial, dOut });
      }
    }

    candidates.sort((a, b) => (b.entry.priority - a.entry.priority) || (b.spatial - a.spatial) || (a.dOut - b.dOut));
    const sumSpatial = candidates.reduce((s, c) => s + c.spatial, 0);
    const norm = sumSpatial > 1 ? 1 / sumSpatial : 1;
    const active = candidates.map(c => ({
      id: c.entry.id,
      weight: c.spatial * norm,
      envMap: c.entry.envMap,
      intensity: c.entry.intensity,
      boxMin: c.entry.min,
      boxMax: c.entry.max,
      boxProjection: c.entry.boxProjection,
      probePosition: c.entry.position,
    }));

    const primary = active[0] ?? null;
    const secondary = active[1] ?? null;
    const blendFactor = primary && secondary
      ? secondary.weight / Math.max(1e-6, primary.weight + secondary.weight)
      : 0;
    return { primary, secondary, blendFactor, active };
  }

  function injectBoxProjectedBlending(material) {
    if (!material || typeof material !== 'object') return false;
    if (material.userData?._hgameProbeInjected) return true;
    if (!THREE?.Vector3) return false;
    const uniforms = {
      uProbeBoxEnabled: { value: 0 },
      uProbeBlendWeight: { value: 0 },
      uProbeMinA: { value: new THREE.Vector3(-10, -5, -10) },
      uProbeMaxA: { value: new THREE.Vector3(10, 5, 10) },
      uProbePosA: { value: new THREE.Vector3(0, 0, 0) },
      uProbeMinB: { value: new THREE.Vector3(-10, -5, -10) },
      uProbeMaxB: { value: new THREE.Vector3(10, 5, 10) },
      uProbePosB: { value: new THREE.Vector3(0, 0, 0) },
      uProbeIntensityA: { value: 1 },
      uProbeIntensityB: { value: 1 },
    };
    material.userData = { ...(material.userData || {}), _hgameProbeInjected: true, _hgameProbeUniforms: uniforms };
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => {
      const base = typeof prevKey === 'function' ? prevKey.call(material) : '';
      return `${base}:hgame-rprobe-box`;
    };
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      if (shader.vertexShader.includes('#include <project_vertex>')) {
        shader.vertexShader = 'varying vec3 vHgameProbeWorldPos;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n{\n  vec4 _rpWp = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n    _rpWp = instanceMatrix * _rpWp;\n  #endif\n  vHgameProbeWorldPos = (modelMatrix * _rpWp).xyz;\n}',
        );
      }
      if (shader.fragmentShader.includes('#include <lights_fragment_maps>')) {
        const fragDecls = [
          'varying vec3 vHgameProbeWorldPos;',
          'uniform float uProbeBoxEnabled;',
          'uniform float uProbeBlendWeight;',
          'uniform vec3 uProbeMinA;',
          'uniform vec3 uProbeMaxA;',
          'uniform vec3 uProbePosA;',
          'uniform vec3 uProbeMinB;',
          'uniform vec3 uProbeMaxB;',
          'uniform vec3 uProbePosB;',
          'uniform float uProbeIntensityA;',
          'uniform float uProbeIntensityB;',
          'vec3 hgameBoxProjectDir(vec3 dir, vec3 wp, vec3 bmin, vec3 bmax, vec3 ppos) {',
          '  vec3 invD = 1.0 / max(abs(dir), vec3(1e-5)) * sign(dir + vec3(1e-6));',
          '  vec3 t0 = (bmax - wp) * invD;',
          '  vec3 t1 = (bmin - wp) * invD;',
          '  vec3 tmax = max(t0, t1);',
          '  float hit = min(min(tmax.x, tmax.y), tmax.z);',
          '  return normalize((wp + dir * hit) - ppos);',
          '}',
        ].join('\n');
        const fragPatch = [
          '#include <lights_fragment_maps>',
          'if (uProbeBoxEnabled > 0.5) {',
          '  vec3 _reflW = reflect(-geometryViewDir, geometryNormal);',
          '  vec3 _dirA = hgameBoxProjectDir(_reflW, vHgameProbeWorldPos, uProbeMinA, uProbeMaxA, uProbePosA);',
          '  vec3 _dirB = hgameBoxProjectDir(_reflW, vHgameProbeWorldPos, uProbeMinB, uProbeMaxB, uProbePosB);',
          '  float _boxAlign = mix(max(0.0, dot(_dirA, _reflW)), max(0.0, dot(_dirB, _reflW)), uProbeBlendWeight);',
          '  float _probeScale = mix(uProbeIntensityA, uProbeIntensityB, uProbeBlendWeight) * (0.75 + 0.25 * _boxAlign);',
          '  radiance *= _probeScale;',
          '}',
        ].join('\n');
        shader.fragmentShader = fragDecls + '\n' + shader.fragmentShader.replace('#include <lights_fragment_maps>', fragPatch);
      }
    };
    material.needsUpdate = true;
    return true;
  }

  function applyToMaterial(material, evalResult) {
    if (!material || !evalResult?.primary) return false;
    const { primary, secondary, blendFactor } = evalResult;
    if ('envMap' in material && primary.envMap !== undefined) {
      material.envMap = primary.envMap;
    }
    const blendedIntensity = secondary
      ? primary.intensity * (1 - blendFactor) + secondary.intensity * blendFactor
      : primary.intensity;
    if ('envMapIntensity' in material) {
      material.envMapIntensity = blendedIntensity;
    }
    if (typeof material.onBeforeCompile === 'function' || THREE?.Vector3) {
      injectBoxProjectedBlending(material);
      const u = material.userData?._hgameProbeUniforms;
      if (u) {
        u.uProbeBoxEnabled.value = primary.boxProjection ? 1 : 0;
        u.uProbeBlendWeight.value = secondary ? blendFactor : 0;
        u.uProbeMinA.value.set(primary.boxMin[0], primary.boxMin[1], primary.boxMin[2]);
        u.uProbeMaxA.value.set(primary.boxMax[0], primary.boxMax[1], primary.boxMax[2]);
        u.uProbePosA.value.set(primary.probePosition[0], primary.probePosition[1], primary.probePosition[2]);
        u.uProbeIntensityA.value = primary.intensity;
        const sb = secondary ?? primary;
        u.uProbeMinB.value.set(sb.boxMin[0], sb.boxMin[1], sb.boxMin[2]);
        u.uProbeMaxB.value.set(sb.boxMax[0], sb.boxMax[1], sb.boxMax[2]);
        u.uProbePosB.value.set(sb.probePosition[0], sb.probePosition[1], sb.probePosition[2]);
        u.uProbeIntensityB.value = sb.intensity;
      }
    }
    material.userData = {
      ...(material.userData || {}),
      reflectionProbe: {
        primaryId: primary.id,
        secondaryId: secondary?.id ?? null,
        blendFactor,
        boxProjection: primary.boxProjection,
        boxMin: primary.boxMin,
        boxMax: primary.boxMax,
      },
    };
    return true;
  }

  function getStats() {
    return { count: probes.size, maxProbes: cap, blendMargin: margin };
  }

  function dispose() {
    probes.clear();
  }

  return {
    THREE,
    addProbe,
    removeProbe,
    evaluateAt,
    injectBoxProjectedBlending,
    applyToMaterial,
    getStats,
    dispose,
  };
}

/**
 * Bind a Blender-baked lightmap texture (`uv1` / `lightMap`) and optional L2 spherical harmonics
 * irradiance coefficients (`27` floats `[r0,g0,b0, ...]`) cleanly onto a Three.js PBR material.
 *
 * @param {any} material
 * @param {any} lightmapTexture
 * @param {object} [options]
 * @param {number} [options.intensity=1]
 * @param {number[] | Float32Array | null} [options.shCoefficients=null] Optional 27-float L2 SH irradiance array.
 */
export function applyBakedLightmap3D(material, lightmapTexture, {
  intensity = 1,
  shCoefficients = null,
} = {}) {
  if (!material || typeof material !== 'object') return false;
  if ('lightMap' in material) {
    if (lightmapTexture && typeof lightmapTexture === 'object' && 'channel' in lightmapTexture) {
      lightmapTexture.channel = 1;
    }
    material.lightMap = lightmapTexture ?? null;
  }
  if ('lightMapIntensity' in material) material.lightMapIntensity = Math.max(0, Number(intensity) || 1);

  if (shCoefficients && shCoefficients.length >= 3) {
    const c0 = [Number(shCoefficients[0]) || 0, Number(shCoefficients[1]) || 0, Number(shCoefficients[2]) || 0];
    const uShDc = { value: c0 };
    material.userData = { ...(material.userData || {}), hgameBakedShDc: uShDc };
    const prevCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
      shader.uniforms.uBakedShDc = uShDc;
      if (shader.fragmentShader.includes('#include <lights_fragment_end>')) {
        shader.fragmentShader = 'uniform vec3 uBakedShDc;\n' + shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * uBakedShDc * 0.282095;',
        );
      }
    };
  }
  material.needsUpdate = true;
  return true;
}

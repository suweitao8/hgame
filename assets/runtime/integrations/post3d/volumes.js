/** Spatial post-process volume stack. */
import { clampRange } from './color.js';

/**
 * Post-process parameter set (all optional when used as a volume override).
 * @typedef {object} PostSettings
 * @property {string} [toneMapping] Tone mapping mode (default `'ueFilmic'`).
 * @property {boolean} [fxaa] FXAA toggle (volumes switch at blend weight >= 0.5).
 * @property {number} [exposure] Exposure multiplier (default 1).
 * @property {number} [bloomStrength] Default 0.28.
 * @property {number} [bloomThreshold] Default 0.85.
 * @property {number} [bloomSoftKnee] Default 0.5.
 * @property {number} [ssaoRadius] World units, default 0.5.
 * @property {number} [ssaoBias] World units, default 0.025.
 * @property {number} [ssaoIntensity] Default 0.42.
 * @property {number} [volumetricIntensity] Default 0.18.
 * @property {number} [giIntensity] Default 0.55.
 * @property {number} [ssrIntensity] Default 0.35.
 * @property {number} [contactShadows] Default 0.65.
 * @property {number} [contactShadowLength] World units, default 0.32.
 * @property {number} [whiteTemp] Kelvin, default 6500.
 * @property {number} [whiteTint] -1..1, default 0.
 * @property {number} [contrast] Default 1.
 * @property {number} [saturation] Default 1.05.
 * @property {number} [vignette] Default 0.18.
 * @property {number} [chromaticAberration] Default 0.
 * @property {number} [filmGrain] Default 0.
 * @property {number} [filmSlope] Default 0.88.
 * @property {number} [filmToe] Default 0.55.
 * @property {number} [filmShoulder] Default 0.26.
 * @property {number} [filmBlackClip] Default 0.
 * @property {number} [filmWhiteClip] Default 0.04.
 * @property {import('./color.js').RGBTuple} [colorLift] Default [0,0,0].
 * @property {import('./color.js').RGBTuple} [colorGamma] Default [1,1,1].
 * @property {import('./color.js').RGBTuple} [colorGain] Default [1,1,1].
 * @property {number} [damage] Damage overlay 0..1.
 * @property {number} [lowHealth] Low-health overlay 0..1.
 * @property {number} [focus] Focus effect 0..1.
 * @property {number} [flash] Flash overlay 0..1.
 * @property {number} [fade] Fade-to-black 0..1.
 */

/**
 * Position accepted by volume queries.
 * @typedef {{x?: number, y?: number, z?: number} | ArrayLike<number>} PostVolumePosition
 */

/**
 * Volume definition accepted by add/update.
 * @typedef {object} PostVolumeInput
 * @property {string | number} id Unique id (required).
 * @property {number} [priority=0] Higher priority blends later (wins).
 * @property {boolean} [unbound=false] Global volume (applies everywhere).
 * @property {'box' | 'sphere'} [shape='box']
 * @property {PostVolumePosition} [center] World-space center, default [0,0,0].
 * @property {[number, number, number]} [extents] Box half-extents in world units, default [10,10,10].
 * @property {number} [radius=10] Sphere radius in world units.
 * @property {number} [yaw=0] Box rotation around Y in radians.
 * @property {number} [blendRadius=4] Feather distance outside the volume in world units.
 * @property {number} [blendWeight=1] Max influence 0..1.
 * @property {boolean} [enabled=true]
 * @property {PostSettings} [settings] Overridden post settings.
 */

/**
 * Normalized volume as stored in the stack.
 * @typedef {object} PostVolume
 * @property {string} id
 * @property {number} priority
 * @property {boolean} unbound
 * @property {'box' | 'sphere'} shape
 * @property {[number, number, number]} center
 * @property {[number, number, number]} extents
 * @property {number} radius
 * @property {number} yaw
 * @property {number} blendRadius
 * @property {number} blendWeight
 * @property {boolean} enabled
 * @property {PostSettings} settings
 */

/**
 * Evaluated post state (defaults merged with volume blends).
 * @typedef {PostSettings & {toneMapping: string}} PostEvaluatedState
 */

/**
 * Pipeline accepting an evaluated state.
 * @typedef {object} PostPipelineStateTarget
 * @property {(state: PostEvaluatedState) => unknown} setState
 */

/**
 * @typedef {object} PostProcessVolumeStack
 * @property {number} size Number of registered volumes (getter).
 * @property {(vol: PostVolumeInput) => string} addVolume Adds/replaces a volume; returns its id.
 * @property {(id: string | number, patch?: Partial<PostVolumeInput>) => boolean} updateVolume Merges a patch; false if unknown id.
 * @property {(id: string | number) => boolean} removeVolume True if removed.
 * @property {(id: string | number) => PostVolume | null} getVolume
 * @property {() => void} clear Removes all volumes.
 * @property {(position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState} evaluate Blends volumes at `position` over `baseState`.
 * @property {(pipeline: PostPipelineStateTarget | null | undefined, position?: PostVolumePosition, baseState?: PostSettings) => PostEvaluatedState | null} applyToPipeline Evaluates and calls `pipeline.setState`; null if no setState.
 */
/** Numeric post-setting keys blended by volumes. */
export const POST_SCALAR_KEYS = [
  'exposure', 'bloomStrength', 'bloomThreshold', 'bloomSoftKnee',
  'ssaoRadius', 'ssaoBias', 'ssaoIntensity', 'volumetricIntensity',
  'giIntensity', 'ssrIntensity', 'contactShadows', 'contactShadowLength',
  'whiteTemp', 'whiteTint', 'contrast', 'saturation', 'vignette',
  'chromaticAberration', 'filmGrain', 'filmSlope', 'filmToe',
  'filmShoulder', 'filmBlackClip', 'filmWhiteClip',
  'damage', 'lowHealth', 'focus', 'flash', 'fade',
];

export const POST_VEC3_KEYS = ['colorLift', 'colorGamma', 'colorGain'];

export const DEFAULT_POST_VOLUME_BASE = Object.freeze({
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

/**
 * Signed distance from a position to a volume surface (negative inside).
 * @param {Pick<PostVolume, 'center' | 'shape' | 'radius' | 'yaw' | 'extents'>} vol
 * @param {PostVolumePosition} pos
 * @returns {number} World units.
 */
export function volumeSignedDistance(vol, pos) {
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
 * @param {PostVolumeInput[]} [initialVolumes=[]]
 * @returns {PostProcessVolumeStack}
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


// Universal cross-2D/3D/UI Art Direction presets and canonical asset standards.

/**
 * Canonical cross-discipline art rules enforced across HGame templates.
 */
export const STANDARD_ART_SPEC = Object.freeze({
  unitScale: '1 unit = 1 meter (3D), 1 px = logical design unit (2D)',
  groundPivot: 'bottom-center',
  actor2dBackground: '#FFFFFF',
  actor2dShadowFree: true,
  // Unified T5 character asset standard (asset-side single tier; runtime dynamically sets priority/minLod)
  character3dMaxTris: 6000,
  character3dMaxVertices: 7500,
  character3dHardMaxTris: 8000,
  character3dHardMaxVertices: 10000,
  character3dLod0MaxWeights: 4,
  character3dLod1TargetTris: 1600,
  character3dLod1MaxTris: 1800,
  character3dLod1MaxWeights: 2,
  character3dLod2TargetTris: 350,
  character3dLod2MaxTris: 450,
  character3dLod2MaxWeights: 1,
  character3dLod3TightTris: 8,
  character3dScreenThresholds: Object.freeze({ lod1: 0.16, lod2: 0.07, lod3: 0.025, lod4: 0.012 }),
  lodHysteresis: 1.12,
  maxGpuVertsHardCap: 65535,
  texelDensityPxPerMeter: 512,
  character3dHandPose: 'semi-clenched-grip',
  toneMapping: 'ueFilmic',
});

/**
 * Canonical LoL-inspired top-down lighting & shadow preset:
 * top-left overhead sun `[-24, 44, -18]` casting cool deep slate shadows bottom-right,
 * low olive-free ground bounce, and subtle opposite cool fill.
 */
export const TOPDOWN_LIGHTING_PRESET = Object.freeze({
  cameraFov: 42,
  cameraPosition: Object.freeze([0, 25.0, 17.5]),
  cameraTarget: Object.freeze([0, 0.5, -0.4]),
  background: '#0c111b',
  hemisphere: Object.freeze({ sky: '#b6d0f2', ground: '#171f2e', intensity: 0.38 }),
  sun: Object.freeze({
    color: '#fff5e6',
    intensity: 2.45,
    position: Object.freeze([-24, 44, -18]),
    shadow: Object.freeze({ extent: 32, near: 1, far: 105, mapSize: 1024, bias: -0.00025, normalBias: 0.035, adaptiveExtent: true }),
  }),
  fill: Object.freeze({ color: '#6d8ec4', intensity: 0.24, position: Object.freeze([22, 18, 16]) }),
});

/**
 * @typedef {object} ArtThemePreset
 * @property {string} id
 * @property {'scifi' | 'arcane' | 'arcade' | 'cyber'} uiTheme
 * @property {'cyber' | 'dungeon' | 'adventure' | 'chill'} audioMood
 * @property {{ bg: string, surface: string, primary: string, secondary: string, accent: string, player: string, enemy: string, projectile: string, danger: string, heal: string, gold: string }} palette
 * @property {{ ambient: string, ambientIntensity: number, bloomStrength: number, vignette: number }} lighting2d
 * @property {{ background: string, skyPreset: 'day' | 'goldenHour' | 'overcast' | 'dusk' | 'night', toneMapping: 'ueFilmic', exposure: number, fog: { near: number, far: number }, hemisphere: { sky: string, ground: string, intensity: number }, sun: { color: string, intensity: number } }} presentation3d
 * @property {{ hitColor: string, slashColor: string, pickupColor: string, damagePreset: string }} vfx
 * @property {{ hitStopMs: number, traumaMax: number }} camera
 */

/** @type {Record<string, ArtThemePreset>} */
export const ART_THEMES = Object.freeze({
  scifi: Object.freeze({
    id: 'scifi',
    uiTheme: 'scifi',
    audioMood: 'cyber',
    palette: Object.freeze({
      bg: '#09111e',
      surface: '#102033',
      primary: '#38bdf8',
      secondary: '#818cf8',
      accent: '#34d399',
      player: '#38bdf8',
      enemy: '#fb7185',
      projectile: '#67e8f9',
      danger: '#f43f5e',
      heal: '#34d399',
      gold: '#facc15',
    }),
    lighting2d: Object.freeze({ ambient: '#1e3a5f', ambientIntensity: 0.72, bloomStrength: 0.35, vignette: 0.25 }),
    presentation3d: Object.freeze({
      background: '#0d1b2a',
      skyPreset: 'night',
      toneMapping: 'ueFilmic',
      exposure: 1.12,
      fog: Object.freeze({ near: 20, far: 64 }),
      hemisphere: Object.freeze({ sky: '#60a5fa', ground: '#1e293b', intensity: 1.6 }),
      sun: Object.freeze({ color: '#bae6fd', intensity: 2.3 }),
    }),
    vfx: Object.freeze({
      hitColor: '#67e8f9',
      slashColor: '#38bdf8',
      pickupColor: '#34d399',
      damagePreset: 'normal',
    }),
    camera: Object.freeze({ hitStopMs: 36, traumaMax: 0.55 }),
  }),
  arcane: Object.freeze({
    id: 'arcane',
    uiTheme: 'arcane',
    audioMood: 'dungeon',
    palette: Object.freeze({
      bg: '#130e1d',
      surface: '#211832',
      primary: '#f59e0b',
      secondary: '#a855f7',
      accent: '#fde68a',
      player: '#fbbf24',
      enemy: '#e11d48',
      projectile: '#c084fc',
      danger: '#fb7185',
      heal: '#86efac',
      gold: '#fbbf24',
    }),
    lighting2d: Object.freeze({ ambient: '#2d1b4e', ambientIntensity: 0.65, bloomStrength: 0.42, vignette: 0.32 }),
    presentation3d: Object.freeze({
      background: '#1e162e',
      skyPreset: 'dusk',
      toneMapping: 'ueFilmic',
      exposure: 1.15,
      fog: Object.freeze({ near: 16, far: 54 }),
      hemisphere: Object.freeze({ sky: '#c084fc', ground: '#2e1f3d', intensity: 1.7 }),
      sun: Object.freeze({ color: '#fed7aa', intensity: 2.5 }),
    }),
    vfx: Object.freeze({
      hitColor: '#fbbf24',
      slashColor: '#c084fc',
      pickupColor: '#fde68a',
      damagePreset: 'crit',
    }),
    camera: Object.freeze({ hitStopMs: 44, traumaMax: 0.65 }),
  }),
  arcade: Object.freeze({
    id: 'arcade',
    uiTheme: 'arcade',
    audioMood: 'adventure',
    palette: Object.freeze({
      bg: '#111827',
      surface: '#1f2937',
      primary: '#facc15',
      secondary: '#ef4444',
      accent: '#4ade80',
      player: '#4ade80',
      enemy: '#f87171',
      projectile: '#fde047',
      danger: '#ef4444',
      heal: '#4ade80',
      gold: '#facc15',
    }),
    lighting2d: Object.freeze({ ambient: '#374151', ambientIntensity: 0.85, bloomStrength: 0.28, vignette: 0.18 }),
    presentation3d: Object.freeze({
      background: '#8eafc2',
      skyPreset: 'goldenHour',
      toneMapping: 'ueFilmic',
      exposure: 1.15,
      fog: Object.freeze({ near: 18, far: 56 }),
      hemisphere: Object.freeze({ sky: '#ffffff', ground: '#61707b', intensity: 2.0 }),
      sun: Object.freeze({ color: '#fff3dd', intensity: 2.6 }),
    }),
    vfx: Object.freeze({
      hitColor: '#fde047',
      slashColor: '#facc15',
      pickupColor: '#4ade80',
      damagePreset: 'normal',
    }),
    camera: Object.freeze({ hitStopMs: 32, traumaMax: 0.5 }),
  }),
  cyber: Object.freeze({
    id: 'cyber',
    uiTheme: 'cyber',
    audioMood: 'cyber',
    palette: Object.freeze({
      bg: '#0c0717',
      surface: '#1b1130',
      primary: '#e879f9',
      secondary: '#22d3ee',
      accent: '#2dd4bf',
      player: '#22d3ee',
      enemy: '#f43f5e',
      projectile: '#e879f9',
      danger: '#fb7185',
      heal: '#2dd4bf',
      gold: '#facc15',
    }),
    lighting2d: Object.freeze({ ambient: '#2e1065', ambientIntensity: 0.62, bloomStrength: 0.5, vignette: 0.3 }),
    presentation3d: Object.freeze({
      background: '#130b24',
      skyPreset: 'night',
      toneMapping: 'ueFilmic',
      exposure: 1.18,
      fog: Object.freeze({ near: 18, far: 58 }),
      hemisphere: Object.freeze({ sky: '#e879f9', ground: '#1e1b4b', intensity: 1.6 }),
      sun: Object.freeze({ color: '#67e8f9', intensity: 2.4 }),
    }),
    vfx: Object.freeze({
      hitColor: '#e879f9',
      slashColor: '#22d3ee',
      pickupColor: '#2dd4bf',
      damagePreset: 'crit',
    }),
    camera: Object.freeze({ hitStopMs: 40, traumaMax: 0.6 }),
  }),
  cozy: Object.freeze({
    id: 'cozy',
    uiTheme: 'arcane',
    audioMood: 'chill',
    palette: Object.freeze({
      bg: '#1c2621',
      surface: '#2a3830',
      primary: '#86efac',
      secondary: '#fdba74',
      accent: '#fde68a',
      player: '#86efac',
      enemy: '#fda4af',
      projectile: '#fde68a',
      danger: '#fda4af',
      heal: '#86efac',
      gold: '#fcd34d',
    }),
    lighting2d: Object.freeze({ ambient: '#3f574a', ambientIntensity: 0.9, bloomStrength: 0.18, vignette: 0.14 }),
    presentation3d: Object.freeze({
      background: '#a7c4b5',
      skyPreset: 'day',
      toneMapping: 'ueFilmic',
      exposure: 1.08,
      fog: Object.freeze({ near: 22, far: 68 }),
      hemisphere: Object.freeze({ sky: '#fef3c7', ground: '#4d6b57', intensity: 2.1 }),
      sun: Object.freeze({ color: '#fffbeb', intensity: 2.4 }),
    }),
    vfx: Object.freeze({
      hitColor: '#fde68a',
      slashColor: '#86efac',
      pickupColor: '#fcd34d',
      damagePreset: 'heal',
    }),
    camera: Object.freeze({ hitStopMs: 20, traumaMax: 0.3 }),
  }),
  ink: Object.freeze({
    id: 'ink',
    uiTheme: 'arcane',
    audioMood: 'dungeon',
    palette: Object.freeze({
      bg: '#141312',
      surface: '#24211e',
      primary: '#e7e5e4',
      secondary: '#dc2626',
      accent: '#f59e0b',
      player: '#f5f5f4',
      enemy: '#dc2626',
      projectile: '#fbbf24',
      danger: '#dc2626',
      heal: '#86efac',
      gold: '#f59e0b',
    }),
    lighting2d: Object.freeze({ ambient: '#44403c', ambientIntensity: 0.78, bloomStrength: 0.22, vignette: 0.35 }),
    presentation3d: Object.freeze({
      background: '#b8b2a6',
      skyPreset: 'overcast',
      toneMapping: 'ueFilmic',
      exposure: 1.05,
      fog: Object.freeze({ near: 15, far: 48 }),
      hemisphere: Object.freeze({ sky: '#e7e5e4', ground: '#44403c', intensity: 1.8 }),
      sun: Object.freeze({ color: '#fef2f2', intensity: 2.2 }),
    }),
    vfx: Object.freeze({
      hitColor: '#dc2626',
      slashColor: '#f5f5f4',
      pickupColor: '#f59e0b',
      damagePreset: 'crit',
    }),
    camera: Object.freeze({ hitStopMs: 48, traumaMax: 0.65 }),
  }),
});

/**
 * List available art theme IDs.
 * @returns {string[]}
 */
export function listArtThemes() {
  return Object.keys(ART_THEMES);
}

/**
 * Resolve an art theme preset by ID (falls back to `'scifi'` when omitted).
 * @param {string} [themeId='scifi']
 * @returns {ArtThemePreset}
 */
export function getArtTheme(themeId = 'scifi') {
  if (typeof themeId !== 'string' || !Object.prototype.hasOwnProperty.call(ART_THEMES, themeId)) {
    throw new Error(`Unknown art theme "${themeId}". Available: ${listArtThemes().join(', ')}`);
  }
  return ART_THEMES[themeId];
}

/**
 * Build a ready-to-use `presentation.json` object for 2D, 3D, or top-down starters from an art theme.
 * @param {string} [themeId='scifi']
 * @param {'2d' | '3d' | 'topdown' | 'ui'} [perspective='2d']
 * @param {string} [quality='auto']
 */
export function resolvePresentationPreset(themeId = 'scifi', perspective = '2d', quality = 'auto') {
  const theme = getArtTheme(themeId);
  if (perspective === 'topdown') {
    return {
      quality,
      theme: theme.id,
      sky: null,
      chunkCells: 16,
      startupModelSlots: [],
      renderer: {
        cameraFov: TOPDOWN_LIGHTING_PRESET.cameraFov,
        cameraPosition: [...TOPDOWN_LIGHTING_PRESET.cameraPosition],
        cameraTarget: [...TOPDOWN_LIGHTING_PRESET.cameraTarget],
        limitCameraDrawDistance: true,
        background: TOPDOWN_LIGHTING_PRESET.background,
        toneMapping: theme.presentation3d.toneMapping,
        exposure: theme.presentation3d.exposure,
        shadows: true,
        worldLighting: {
          fog: { near: 62, far: 152 },
          hemisphere: { ...TOPDOWN_LIGHTING_PRESET.hemisphere },
          sun: {
            color: TOPDOWN_LIGHTING_PRESET.sun.color,
            intensity: TOPDOWN_LIGHTING_PRESET.sun.intensity,
            position: [...TOPDOWN_LIGHTING_PRESET.sun.position],
            shadow: { ...TOPDOWN_LIGHTING_PRESET.sun.shadow },
          },
          fill: {
            color: TOPDOWN_LIGHTING_PRESET.fill.color,
            intensity: TOPDOWN_LIGHTING_PRESET.fill.intensity,
            position: [...TOPDOWN_LIGHTING_PRESET.fill.position],
          },
        },
      },
    };
  }
  if (perspective === '3d') {
    return {
      quality,
      theme: theme.id,
      sky: { preset: theme.presentation3d.skyPreset, environment: false },
      chunkCells: 16,
      startupModelSlots: [],
      renderer: {
        cameraPosition: [9, 8.5, 12],
        cameraTarget: [0, 1, 0],
        limitCameraDrawDistance: true,
        background: theme.presentation3d.background,
        toneMapping: theme.presentation3d.toneMapping,
        exposure: theme.presentation3d.exposure,
        shadows: true,
        worldLighting: {
          fog: { ...theme.presentation3d.fog },
          hemisphere: { ...theme.presentation3d.hemisphere },
          sun: {
            color: theme.presentation3d.sun.color,
            intensity: theme.presentation3d.sun.intensity,
            position: [-12, 22, -9],
            shadow: { extent: 13, near: 0.5, far: 45, mapSize: 1024, bias: -0.00025, normalBias: 0.035, adaptiveExtent: true },
          },
        },
      },
    };
  }
  return {
    quality,
    theme: theme.id,
    backend: 'auto',
    background: theme.palette.bg,
    lighting2d: { ...theme.lighting2d },
    palette: { ...theme.palette },
  };
}

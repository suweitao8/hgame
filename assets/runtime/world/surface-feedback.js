/**
 * SurfaceType-driven feedback router connecting collision/raycast surface hits
 * to VFX particles/recipes, 3D decals, and 3D spatial audio cues.
 */
import { VFX_SHAPE } from '../vfx/vfx-particles.js';

export const SURFACE_TYPES = Object.freeze([
  'asphalt',
  'concrete',
  'tile',
  'wood',
  'metal',
  'glass',
  'dirt',
  'grass',
  'water',
  'fabric',
]);

export const DEFAULT_SURFACE_FEEDBACK_TABLE = Object.freeze({
  asphalt: Object.freeze({
    recipe: 'impact_concrete',
    particle: Object.freeze({ shape: VFX_SHAPE.SMOKE_PUFF, color: 0x4b5563, count: 8, speedMin: 1.8, speedMax: 5.2, sizeStart: 0.28, sizeEnd: 0.55, durationMin: 0.22, durationMax: 0.4, gravity: 6.0, drag: 3.5, additive: false }),
    decalColor: 0x1f2937,
    decalSize: [0.22, 0.22, 0.14],
    decalOpacity: 0.82,
  }),
  concrete: Object.freeze({
    recipe: 'impact_concrete',
    particle: Object.freeze({ shape: VFX_SHAPE.SMOKE_PUFF, color: 0x9ca3af, count: 10, speedMin: 2.0, speedMax: 5.8, sizeStart: 0.3, sizeEnd: 0.6, durationMin: 0.25, durationMax: 0.45, gravity: 7.5, drag: 3.5, additive: false }),
    decalColor: 0x374151,
    decalSize: [0.24, 0.24, 0.14],
    decalOpacity: 0.85,
  }),
  tile: Object.freeze({
    recipe: 'impact_concrete',
    particle: Object.freeze({ shape: VFX_SHAPE.SHARD_BLADE, color: 0xe5e7eb, count: 9, speedMin: 2.5, speedMax: 6.5, sizeStart: 0.22, sizeEnd: 0.04, durationMin: 0.2, durationMax: 0.36, gravity: 11.0, drag: 2.8, additive: false }),
    decalColor: 0x4b5563,
    decalSize: [0.18, 0.18, 0.12],
    decalOpacity: 0.8,
  }),
  wood: Object.freeze({
    recipe: 'impact_wood',
    particle: Object.freeze({ shape: VFX_SHAPE.SHARD_BLADE, color: 0xb45309, count: 9, speedMin: 2.2, speedMax: 6.0, sizeStart: 0.24, sizeEnd: 0.05, durationMin: 0.22, durationMax: 0.38, gravity: 10.0, drag: 3.0, additive: false }),
    decalColor: 0x451a03,
    decalSize: [0.2, 0.2, 0.12],
    decalOpacity: 0.82,
  }),
  metal: Object.freeze({
    recipe: 'impact_metal',
    particle: Object.freeze({ shape: VFX_SHAPE.HIT_SPARK, color: 0xffd166, count: 14, speedMin: 4.5, speedMax: 11.5, sizeStart: 0.26, sizeEnd: 0.03, durationMin: 0.14, durationMax: 0.28, gravity: 12.0, drag: 3.2, stretch: 1.35, additive: true }),
    decalColor: 0x111827,
    decalSize: [0.16, 0.16, 0.1],
    decalOpacity: 0.85,
  }),
  glass: Object.freeze({
    recipe: 'impact_glass',
    particle: Object.freeze({ shape: VFX_SHAPE.SHARD_BLADE, color: 0xe0f2fe, count: 12, speedMin: 3.0, speedMax: 8.5, sizeStart: 0.24, sizeEnd: 0.04, durationMin: 0.22, durationMax: 0.4, gravity: 12.0, drag: 2.4, additive: true }),
    decalColor: 0xcbd5e1,
    decalSize: [0.26, 0.26, 0.08],
    decalOpacity: 0.72,
  }),
  dirt: Object.freeze({
    recipe: 'impact_dirt',
    particle: Object.freeze({ shape: VFX_SHAPE.SMOKE_PUFF, color: 0x78350f, count: 10, speedMin: 1.8, speedMax: 5.0, sizeStart: 0.32, sizeEnd: 0.65, durationMin: 0.28, durationMax: 0.5, gravity: 8.5, drag: 3.6, additive: false }),
    decalColor: 0x3b2314,
    decalSize: [0.28, 0.28, 0.14],
    decalOpacity: 0.78,
  }),
  grass: Object.freeze({
    recipe: 'impact_grass',
    particle: Object.freeze({ shape: VFX_SHAPE.SHARD_BLADE, color: 0x4d7c0f, count: 9, speedMin: 2.0, speedMax: 5.2, sizeStart: 0.24, sizeEnd: 0.06, durationMin: 0.25, durationMax: 0.45, gravity: 9.0, drag: 3.4, additive: false }),
    decalColor: 0x365314,
    decalSize: [0.26, 0.26, 0.12],
    decalOpacity: 0.65,
  }),
  water: Object.freeze({
    recipe: 'impact_water',
    particle: Object.freeze({ shape: VFX_SHAPE.SHOCK_RING, color: 0xbae6fd, count: 8, speedMin: 1.5, speedMax: 4.5, sizeStart: 0.35, sizeEnd: 0.85, durationMin: 0.24, durationMax: 0.42, gravity: 8.0, drag: 3.2, additive: true }),
    decalColor: null,
    decalSize: null,
    decalOpacity: 0,
  }),
  fabric: Object.freeze({
    recipe: 'impact_fabric',
    particle: Object.freeze({ shape: VFX_SHAPE.SMOKE_PUFF, color: 0xd1d5db, count: 6, speedMin: 1.0, speedMax: 3.0, sizeStart: 0.22, sizeEnd: 0.42, durationMin: 0.2, durationMax: 0.36, gravity: 2.5, drag: 4.2, additive: false }),
    decalColor: 0x1f2937,
    decalSize: [0.18, 0.18, 0.08],
    decalOpacity: 0.55,
  }),
});

function readVec3(v, fx = 0, fy = 0, fz = 0) {
  if (Array.isArray(v)) return [Number(v[0]) || fx, Number(v[1]) || fy, Number(v[2]) || fz];
  if (v && typeof v === 'object') return [Number(v.x) || fx, Number(v.y) || fy, Number(v.z) || fz];
  return [fx, fy, fz];
}

/**
 * Routes collision/raycast `surfaceType` hits to matching VFX recipes/particles,
 * decals, and 3D spatial audio cues.
 * @param {Record<string, any>} [options]
 */
export function createSurfaceFeedbackRouter({
  vfx = null,
  decals = null,
  audio = null,
  table = DEFAULT_SURFACE_FEEDBACK_TABLE,
} = {}) {
  const customTable = { ...DEFAULT_SURFACE_FEEDBACK_TABLE, ...(table || {}) };

  function resolveEntry(surfaceType) {
    const key = String(surfaceType || 'concrete').toLowerCase();
    return customTable[key] || customTable.concrete || DEFAULT_SURFACE_FEEDBACK_TABLE.concrete;
  }

  function triggerImpact({
    pos = [0, 0, 0],
    normal = [0, 1, 0],
    surfaceType = 'concrete',
    intensity = 1.0,
    decal = null,
    decalMap = null,
    hitstopSec = 0,
    shakeIntensity = 0,
    playSound = true,
  } = {}) {
    const surf = String(surfaceType || 'concrete').toLowerCase();
    const entry = resolveEntry(surf);
    const scale = Math.max(0.1, Number(intensity) || 1.0);
    const p = readVec3(pos, 0, 0, 0);
    const n = readVec3(normal, 0, 1, 0);

    let vfxMode = 'none';
    if (vfx) {
      const hasRecipe = Boolean(entry.recipe && vfx.effects?.hasEffect?.(entry.recipe));
      if (hasRecipe && typeof vfx.playEffect === 'function') {
        vfx.playEffect(entry.recipe, { x: p[0], y: p[1], z: p[2], scale });
        vfxMode = 'recipe';
      } else if (typeof vfx.burstParticles === 'function') {
        vfx.burstParticles({
          ...entry.particle,
          x: p[0],
          y: p[1],
          z: p[2],
          dirX: n[0],
          dirY: n[1],
          dirZ: n[2],
          dirBias: 2.2,
          count: Math.max(1, Math.round(entry.particle.count * scale)),
          speedMax: entry.particle.speedMax * Math.min(2, 0.7 + 0.3 * scale),
        });
        vfxMode = 'particles';
      }
      if (hitstopSec > 0) vfx.hitstop?.trigger?.(hitstopSec, 0.05);
      if (shakeIntensity > 0) vfx.shake?.impulse?.(shakeIntensity, n[0], n[1], n[2]);
    }

    let decalHandle = null;
    if (decals && typeof decals.spawn === 'function' && decal !== false && entry.decalColor !== null) {
      const decalScale = decal && typeof decal === 'object' && decal.size ? decal.size : entry.decalSize;
      decalHandle = decals.spawn({
        position: p,
        normal: n,
        color: decal && typeof decal === 'object' && decal.color !== undefined ? decal.color : entry.decalColor,
        map: decalMap ?? (decal && typeof decal === 'object' ? decal.map ?? null : null),
        size: decalScale,
        opacity: entry.decalOpacity * Math.min(1, 0.6 + 0.4 * scale),
      });
    }

    let audioPromise = null;
    if (playSound && audio && typeof audio.playSurfaceCue === 'function') {
      audioPromise = audio.playSurfaceCue(surf, 'impact', {
        position: { x: p[0], y: p[1], z: p[2] },
        volume: Math.min(1.5, scale),
      });
    }

    return {
      surfaceType: surf,
      vfxMode,
      decalHandle,
      audioPromise,
    };
  }

  function playFootstep(surfaceType = 'concrete', {
    pos = null,
    intensity = 0.8,
    isRunning = false,
  } = {}) {
    const surf = String(surfaceType || 'concrete').toLowerCase();
    const vol = Math.max(0.1, Math.min(1.5, Number(intensity) || (isRunning ? 1.0 : 0.65)));
    if (vfx && pos && (surf === 'water' || surf === 'dirt' || surf === 'grass')) {
      const p = readVec3(pos, 0, 0, 0);
      const entry = resolveEntry(surf);
      vfx.burstParticles?.({
        ...entry.particle,
        x: p[0],
        y: p[1],
        z: p[2],
        count: isRunning ? 4 : 2,
        sizeStart: entry.particle.sizeStart * 0.6,
        sizeEnd: entry.particle.sizeEnd * 0.6,
      });
    }
    if (audio && typeof audio.playSurfaceCue === 'function') {
      return audio.playSurfaceCue(surf, 'footstep', {
        ...(pos ? { position: readVec3(pos, 0, 0, 0) } : {}),
        volume: vol,
      });
    }
    return Promise.resolve(null);
  }

  return Object.freeze({
    surfaceTypes: SURFACE_TYPES,
    triggerImpact,
    playFootstep,
    resolveEntry,
  });
}

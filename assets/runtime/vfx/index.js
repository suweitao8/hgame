import {
  VFX_EASING,
  VFX_RENDER_ORDERS,
  createCameraShake,
  createHitstopClock,
  createVisualPrng,
  markAttributeRangeDirty,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';
import {
  VFX_SHAPE,
  PARTICLE_VERTEX_GLSL,
  PARTICLE_FRAGMENT_GLSL,
  PARTICLE_WEBGL2_2D_VS,
  PARTICLE_WEBGL2_2D_FS,
  createStatelessParticlePool,
} from './vfx-particles.js';
import {
  SLASH_VERTEX_GLSL,
  SLASH_FRAGMENT_GLSL,
  LIGHTNING_VERTEX_GLSL,
  LIGHTNING_FRAGMENT_GLSL,
  RIBBON_VERTEX_GLSL,
  RIBBON_FRAGMENT_GLSL,
  createTrailsSystem,
} from './vfx-trails.js';
import {
  TELEGRAPH_SHAPE,
  TELEGRAPH_VERTEX_GLSL,
  TELEGRAPH_FRAGMENT_GLSL,
  createTelegraphSystem,
} from './vfx-telegraph.js';
import {
  GLYPH_CHARS,
  extractGlyphIndices,
  bakeGlyphAtlasCanvas,
  FLOATING_TEXT_VERTEX_GLSL,
  FLOATING_TEXT_FRAGMENT_GLSL,
  FLOATING_TEXT_WEBGL2_2D_VS,
  FLOATING_TEXT_WEBGL2_2D_FS,
  createFloatingTextPool,
} from './vfx-floating-text.js';
import {
  DAMAGE_ATLAS_CHARS,
  DAMAGE_NUMBER_PRESETS,
  evaluateColorByNumber,
  evaluateScaleByNumber,
  formatDamageValue,
  getDamagePreset,
  registerDamagePreset,
} from './vfx-damage-presets.js';
import {
  CROWD_STATUS,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  SCREEN_FEEDBACK_VERTEX_GLSL,
  SCREEN_FEEDBACK_FRAGMENT_GLSL,
  createScreenFeedbackPass,
} from './vfx-screen-crowd.js';
import {
  VFX_RENDER_MODE,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  ATLAS_PARTICLE_VERTEX_GLSL,
  ATLAS_PARTICLE_FRAGMENT_GLSL,
  ATLAS_PARTICLE_DISTORTION_FS,
  ATLAS_PARTICLE_WEBGL2_2D_VS,
  ATLAS_PARTICLE_WEBGL2_2D_FS,
  evaluateColorCurve,
  evaluateSizeCurve,
  createCurveLutTable,
  createProceduralVfxAtlas,
  evaluateAtlasParticlePosition,
  createAtlasParticlePool,
} from './vfx-atlas-particles.js';
import {
  VFX_MESH_VERTEX_GLSL,
  VFX_MESH_FRAGMENT_GLSL,
  createMeshVfxPool,
} from './vfx-mesh.js';
import {
  validateVfxRecipe,
  createEffectPlayer,
} from './vfx-recipes.js';

export {
  VFX_EASING,
  VFX_RENDER_ORDERS,
  createVisualPrng,
  packRgb24,
  unpackRgb24Into,
  markAttributeRangeDirty,
  submitRingBufferRanges,
  createHitstopClock,
  createCameraShake,
  VFX_SHAPE,
  PARTICLE_VERTEX_GLSL,
  PARTICLE_FRAGMENT_GLSL,
  PARTICLE_WEBGL2_2D_VS,
  PARTICLE_WEBGL2_2D_FS,
  createStatelessParticlePool,
  SLASH_VERTEX_GLSL,
  SLASH_FRAGMENT_GLSL,
  LIGHTNING_VERTEX_GLSL,
  LIGHTNING_FRAGMENT_GLSL,
  RIBBON_VERTEX_GLSL,
  RIBBON_FRAGMENT_GLSL,
  createTrailsSystem,
  TELEGRAPH_SHAPE,
  TELEGRAPH_VERTEX_GLSL,
  TELEGRAPH_FRAGMENT_GLSL,
  createTelegraphSystem,
  GLYPH_CHARS,
  DAMAGE_ATLAS_CHARS,
  DAMAGE_NUMBER_PRESETS,
  registerDamagePreset,
  getDamagePreset,
  formatDamageValue,
  evaluateColorByNumber,
  evaluateScaleByNumber,
  extractGlyphIndices,
  bakeGlyphAtlasCanvas,
  FLOATING_TEXT_VERTEX_GLSL,
  FLOATING_TEXT_FRAGMENT_GLSL,
  FLOATING_TEXT_WEBGL2_2D_VS,
  FLOATING_TEXT_WEBGL2_2D_FS,
  createFloatingTextPool,
  CROWD_STATUS,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  SCREEN_FEEDBACK_VERTEX_GLSL,
  SCREEN_FEEDBACK_FRAGMENT_GLSL,
  createScreenFeedbackPass,
  VFX_RENDER_MODE,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  ATLAS_PARTICLE_VERTEX_GLSL,
  ATLAS_PARTICLE_FRAGMENT_GLSL,
  ATLAS_PARTICLE_DISTORTION_FS,
  ATLAS_PARTICLE_WEBGL2_2D_VS,
  ATLAS_PARTICLE_WEBGL2_2D_FS,
  evaluateColorCurve,
  evaluateSizeCurve,
  createCurveLutTable,
  createProceduralVfxAtlas,
  evaluateAtlasParticlePosition,
  createAtlasParticlePool,
  VFX_MESH_VERTEX_GLSL,
  VFX_MESH_FRAGMENT_GLSL,
  createMeshVfxPool,
  validateVfxRecipe,
  createEffectPlayer,
};

export const VFX_PRESETS = Object.freeze({
  physical: Object.freeze({
    color: 0xffd166,
    shape: VFX_SHAPE.HIT_SPARK,
    count: 10,
    speedMin: 3.5,
    speedMax: 9.0,
    sizeStart: 0.35,
    sizeEnd: 0.04,
    durationMin: 0.18,
    durationMax: 0.32,
    gravity: 12.0,
    drag: 4.0,
    stretch: 1.0,
    additive: true,
  }),
  fire: Object.freeze({
    color: 0xf97316,
    shape: VFX_SHAPE.GLOW_ORB,
    count: 14,
    speedMin: 2.5,
    speedMax: 7.5,
    sizeStart: 0.45,
    sizeEnd: 0.06,
    durationMin: 0.25,
    durationMax: 0.48,
    gravity: -4.0,
    drag: 2.8,
    stretch: 0.4,
    additive: true,
  }),
  ice: Object.freeze({
    color: 0x38bdf8,
    shape: VFX_SHAPE.SHARD_BLADE,
    count: 12,
    speedMin: 3.0,
    speedMax: 8.5,
    sizeStart: 0.38,
    sizeEnd: 0.05,
    durationMin: 0.24,
    durationMax: 0.42,
    gravity: 10.0,
    drag: 3.2,
    stretch: 0.9,
    additive: true,
  }),
  poison: Object.freeze({
    color: 0x4ade80,
    shape: VFX_SHAPE.SMOKE_PUFF,
    count: 10,
    speedMin: 1.5,
    speedMax: 4.5,
    sizeStart: 0.5,
    sizeEnd: 0.9,
    durationMin: 0.35,
    durationMax: 0.6,
    gravity: -2.5,
    drag: 3.0,
    stretch: 0.0,
    additive: false,
  }),
  lightning: Object.freeze({
    color: 0x60a5fa,
    shape: VFX_SHAPE.HIT_SPARK,
    count: 14,
    speedMin: 5.0,
    speedMax: 12.0,
    sizeStart: 0.34,
    sizeEnd: 0.03,
    durationMin: 0.14,
    durationMax: 0.26,
    gravity: 4.0,
    drag: 5.0,
    stretch: 1.4,
    additive: true,
  }),
});

function detectMode(modeOpt, sceneOrAdapter, THREE) {
  if (modeOpt) return modeOpt;
  if (sceneOrAdapter?.isWebGL2) return 'webgl2d';
  if (sceneOrAdapter?.isScene || THREE) return '3d';
  if (sceneOrAdapter && (typeof sceneOrAdapter.save === 'function' || sceneOrAdapter.ctx)) {
    return 'canvas2d';
  }
  return 'headless';
}

/**
 * Unified 2D/3D/Headless zero-GC VFX & game-feel facade.
 * @param {object} [options]
 * @param {'headless' | 'canvas2d' | 'webgl2d' | '3d' | null} [options.mode=null]
 * @param {object | null} [options.sceneOrAdapter=null] Renderer adapter, scene or 2D context.
 * @param {object | null} [options.THREE] Three.js namespace for 3D rendering.
 * @param {number} [options.maxParticles]
 * @param {number} [options.maxAtlasParticles]
 * @param {number} [options.maxMeshVfx]
 * @param {number} [options.trailNodes]
 * @param {number} [options.maxFloatingGlyphs]
 * @param {number} [options.maxPopups]
 * @param {object | null} [options.atlasTexture=null]
 * @param {Record<string, readonly number[]> | null} [options.atlasRegions=null]
 * @param {boolean} [options.renderThroughWalls=true]
 * @param {number} [options.seed=0x9e3779b9]
 */
export function createVfxSystem({
  mode = null,
  sceneOrAdapter = null,
  THREE = globalThis.THREE ?? null,
  maxParticles,
  maxAtlasParticles,
  maxMeshVfx,
  trailNodes,
  maxFloatingGlyphs,
  maxPopups,
  atlasTexture = null,
  atlasRegions = null,
  renderThroughWalls = true,
  seed = 0x9e3779b9,
} = {}) {
  const resolvedMode = detectMode(mode, sceneOrAdapter, THREE);
  const is2D = resolvedMode === 'webgl2d' || resolvedMode === 'canvas2d';
  const scene = resolvedMode === '3d' ? (sceneOrAdapter?.scene ?? sceneOrAdapter) : null;
  const gl = resolvedMode === 'webgl2d' ? (sceneOrAdapter?.gl ?? sceneOrAdapter) : null;

  const prng = createVisualPrng(seed);
  const hitstop = createHitstopClock();
  const shake = createCameraShake();

  const particles = createStatelessParticlePool({
    mode: resolvedMode,
    THREE,
    scene,
    gl,
    maxParticles,
    is2D,
    prng,
  });
  const atlasParticles = createAtlasParticlePool({
    mode: resolvedMode,
    THREE,
    scene,
    gl,
    maxParticles: maxAtlasParticles,
    is2D,
    prng,
    atlasTexture,
    atlasRegions,
  });
  const meshVfx = createMeshVfxPool({
    mode: resolvedMode,
    THREE,
    scene,
    maxMeshes: maxMeshVfx,
  });
  const trails = createTrailsSystem({
    mode: resolvedMode,
    THREE,
    scene,
    is2D,
    trailNodes,
    atlasRegions,
    prng,
  });
  const telegraphs = createTelegraphSystem({
    mode: resolvedMode,
    THREE,
    scene,
    is2D,
  });
  const floatingText = createFloatingTextPool({
    mode: resolvedMode,
    THREE,
    scene,
    gl,
    is2D,
    maxFloatingGlyphs,
    maxPopups,
    renderThroughWalls,
    prng,
  });
  const screenFeedback = createScreenFeedbackPass({
    mode: resolvedMode,
    THREE,
    scene,
  });
  const effects = createEffectPlayer({
    atlasParticles,
    meshVfx,
    trails,
    telegraphs,
    hitstop,
    shake,
    screenFeedback,
    scene,
    THREE,
    is2D,
    prng,
  });

  const updateOut = { visualDt: 0, cameraOffset: shake.offset };
  const burstScratch = {
    x: 0,
    y: 0,
    z: 0,
    count: 10,
    color: 0xffd166,
    shape: VFX_SHAPE.HIT_SPARK,
    speedMin: 3,
    speedMax: 9,
    sizeStart: 0.35,
    sizeEnd: 0.04,
    durationMin: 0.18,
    durationMax: 0.32,
    gravity: 10,
    drag: 4,
    stretch: 1,
    additive: true,
    dirX: 0,
    dirY: 0,
    dirZ: 0,
    dirBias: 0,
  };
  const slashScratch = {
    x: 0,
    y: 0,
    z: 0,
    yawRad: 0,
    sweepRad: 1.8,
    radius: 1.9,
    color: 0xffd166,
    duration: 0.14,
  };
  const popupScratch = {
    x: 0,
    y: 0,
    z: 0,
    value: 0,
    isCrit: false,
    isHeal: false,
    isMiss: false,
    preset: undefined,
    spamGroup: undefined,
    follow: undefined,
    combination: undefined,
  };

  function burstParticles(presetOrConfig) {
    if (typeof presetOrConfig === 'string') {
      const p = VFX_PRESETS[presetOrConfig] || VFX_PRESETS.physical;
      particles.burst(p);
    } else {
      particles.burst(presetOrConfig);
    }
  }

  /**
   * @param {object} [options]
   * @param {number} [options.x=0]
   * @param {number} [options.y=0]
   * @param {number} [options.z=0]
   * @param {number} [options.damage=0]
   * @param {boolean} [options.isCrit=false]
   * @param {boolean} [options.isHeal=false]
   * @param {boolean} [options.isMiss=false]
   * @param {number} [options.dirX=0]
   * @param {number} [options.dirY=0]
   * @param {number} [options.dirZ=0]
   * @param {string} [options.element='physical']
   * @param {string} [options.numberPreset]
   * @param {string} [options.spamGroup]
   * @param {object} [options.follow]
   * @param {object} [options.combination]
   * @param {number} [options.hitstopSec]
   * @param {number} [options.shakeIntensity]
   */
  function emitHitImpact({
    x = 0,
    y = 0,
    z = 0,
    damage = 0,
    isCrit = false,
    isHeal = false,
    isMiss = false,
    dirX = 0,
    dirY = 0,
    dirZ = 0,
    element = 'physical',
    numberPreset,
    spamGroup,
    follow,
    combination,
    hitstopSec,
    shakeIntensity,
  } = {}) {
    const preset = VFX_PRESETS[element] || VFX_PRESETS.physical;
    burstScratch.x = x;
    burstScratch.y = y;
    burstScratch.z = z;
    burstScratch.count = isCrit ? Math.round(preset.count * 1.6) : preset.count;
    burstScratch.color = preset.color;
    burstScratch.shape = preset.shape;
    burstScratch.speedMin = preset.speedMin;
    burstScratch.speedMax = isCrit ? preset.speedMax * 1.35 : preset.speedMax;
    burstScratch.sizeStart = is2D ? preset.sizeStart * 24 : preset.sizeStart;
    burstScratch.sizeEnd = is2D ? preset.sizeEnd * 24 : preset.sizeEnd;
    burstScratch.durationMin = preset.durationMin;
    burstScratch.durationMax = preset.durationMax;
    burstScratch.gravity = is2D ? preset.gravity * 30 : preset.gravity;
    burstScratch.drag = preset.drag;
    burstScratch.stretch = preset.stretch;
    burstScratch.additive = preset.additive;
    burstScratch.dirX = dirX;
    burstScratch.dirY = dirY;
    burstScratch.dirZ = dirZ;
    burstScratch.dirBias = is2D ? 80 : 2.5;
    particles.burst(burstScratch);

    if (isCrit) {
      slashScratch.x = x;
      slashScratch.y = y;
      slashScratch.z = z;
      slashScratch.yawRad = Math.atan2(dirZ || dirY, dirX || 1);
      slashScratch.radius = is2D ? 48 : 2.1;
      slashScratch.color = preset.color;
      trails.slashArc(slashScratch);
    }

    if (damage !== 0 || isMiss) {
      popupScratch.x = x;
      popupScratch.y = y + (is2D ? -12 : 0.8);
      popupScratch.z = z;
      popupScratch.value = damage;
      popupScratch.isCrit = isCrit;
      popupScratch.isHeal = isHeal;
      popupScratch.isMiss = isMiss;
      popupScratch.preset = numberPreset
        ?? (isCrit ? 'crit' : isHeal ? 'heal' : isMiss ? 'miss' : (element !== 'physical' ? element : 'normal'));
      popupScratch.spamGroup = spamGroup;
      popupScratch.follow = follow;
      popupScratch.combination = combination;
      floatingText.popupNumber(popupScratch);
    }

    if (!isMiss) {
      hitstop.trigger(hitstopSec ?? (isCrit ? 0.05 : 0.028), 0.05);
      shake.impulse(shakeIntensity ?? (isCrit ? 0.45 : 0.18), dirX, dirY, dirZ);
    }
  }

  function update(rawDt = 0.016, cameraPos = null) {
    const clampedRaw = Math.min(Math.max(rawDt, 0), 0.1);
    const visualDt = hitstop.step(rawDt);
    shake.update(rawDt);
    effects.update(visualDt);
    particles.update(visualDt);
    atlasParticles.update(visualDt);
    meshVfx.update(visualDt);
    trails.update(visualDt);
    telegraphs.update(visualDt);
    floatingText.update(visualDt, clampedRaw, cameraPos);
    screenFeedback.update(visualDt);
    updateOut.visualDt = visualDt;
    updateOut.cameraOffset = shake.offset;
    return updateOut;
  }

  function render(ctxOrCamera, cameraOrWidth, widthOrHeight, maybeHeight) {
    if (resolvedMode === 'webgl2d') {
      const cam = ctxOrCamera ?? sceneOrAdapter?.camera;
      const vp = sceneOrAdapter?.getViewport?.();
      const w = cameraOrWidth ?? vp?.width ?? 960;
      const h = widthOrHeight ?? vp?.height ?? 540;
      particles.renderWebGL2(cam, w, h);
      atlasParticles.renderWebGL2(cam, w, h);
      floatingText.renderWebGL2(cam, w, h);
    } else if (resolvedMode === 'canvas2d') {
      const ctx = ctxOrCamera?.save ? ctxOrCamera : sceneOrAdapter?.ctx;
      const cam = ctxOrCamera?.save ? cameraOrWidth : (ctxOrCamera ?? sceneOrAdapter?.camera);
      const vp = sceneOrAdapter?.getViewport?.();
      const w = (ctxOrCamera?.save ? widthOrHeight : cameraOrWidth) ?? vp?.width ?? 960;
      const h = (ctxOrCamera?.save ? maybeHeight : widthOrHeight) ?? vp?.height ?? 540;
      telegraphs.renderCanvas2D(ctx, cam, w, h);
      particles.renderCanvas2D(ctx, cam, w, h);
      atlasParticles.renderCanvas2D(ctx, cam, w, h);
      trails.renderCanvas2D(ctx, cam, w, h);
      floatingText.renderCanvas2D(ctx, cam, w, h);
      screenFeedback.renderCanvas2D(ctx, w, h);
    }
  }

  function reset() {
    prng.reset(seed);
    hitstop.reset();
    shake.reset();
    effects.reset();
    particles.reset();
    atlasParticles.reset();
    meshVfx.reset();
    trails.reset();
    telegraphs.reset();
    floatingText.reset();
    screenFeedback.reset();
  }

  function dispose() {
    effects.dispose();
    particles.dispose();
    atlasParticles.dispose();
    meshVfx.dispose();
    trails.dispose();
    telegraphs.dispose();
    floatingText.dispose();
    screenFeedback.dispose();
  }

  return {
    mode: resolvedMode,
    prng,
    hitstop,
    shake,
    particles,
    atlasParticles,
    meshVfx,
    effects,
    trails,
    telegraphs,
    floatingText,
    screenFeedback,
    setAtlas: atlasParticles.setAtlas,
    setDepthTexture: atlasParticles.setDepthTexture,
    setSceneTexture(tex, opts) {
      atlasParticles.setSceneTexture(tex, opts);
      meshVfx.setSceneTexture(tex, opts);
    },
    setWind(wx = 0, wy = 0, wz = 0) {
      atlasParticles.setWind(wx, wy, wz);
      meshVfx.setWind(wx, wy, wz);
    },
    setCollisionResolver: effects.setCollisionResolver,
    setTrailTexture: trails.setTrailTexture,
    registerMesh: meshVfx.registerMesh,
    registerEffect: effects.registerEffect,
    playEffect: effects.playEffect,
    stopAllEffects: effects.stopAll,
    emitHitImpact,
    burstParticles,
    slashArc: trails.slashArc,
    lightningBolt: trails.lightningBolt,
    allocTrail: trails.allocTrail,
    pushTrailPoint: trails.pushTrailPoint,
    freeTrail: trails.freeTrail,
    spawnTelegraph: telegraphs.spawnTelegraph,
    updateTelegraph: telegraphs.updateTelegraph,
    setShrinkZone: telegraphs.setShrinkZone,
    popupNumber: floatingText.popupNumber,
    screenPulse: screenFeedback.screenPulse,
    setLowHpIntensity: screenFeedback.setLowHpIntensity,
    setSpeedLines: screenFeedback.setSpeedLines,
    update,
    render,
    reset,
    dispose,
    getStats() {
      return {
        mode: resolvedMode,
        particles: particles.getStats(),
        atlasParticles: atlasParticles.getStats(),
        meshVfx: meshVfx.getStats(),
        effects: effects.getStats(),
        trails: trails.getStats(),
        telegraphs: telegraphs.getStats(),
        floatingText: floatingText.getStats(),
      };
    },
  };
}

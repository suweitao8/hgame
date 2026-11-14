export const HGAME_VERSION = '1.0.0';
export { defineProject, resolveFeatureGraph, PROJECT_PROFILES, OPTIONAL_FEATURES,
  DETERMINISTIC_PHYSICS_BACKENDS } from './core/config.js';
export { Component } from './core/component.js';
export { Entity } from './core/entity.js';
export { Scene, SceneManager } from './core/scene.js';
export { PrefabRegistry } from './core/prefab.js';
export {
  normalizeGameplayTag,
  isValidGameplayTag,
  tagMatchesHierarchy,
  splitTagAncestors,
  createTagRegistry,
  GLOBAL_TAG_REGISTRY,
  createTagContainer,
  matchGameplayTags,
} from './core/tags.js';
export { createGameApplication } from './core/application.js';
export { createGameEngine, PLATFORM_VERSION, GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION,
  createAssetLoader, createSaveStore, createInputManager, defineInputContext, createInputActionRouter,
  ARCADE_SLOTS, PLAYER_KEYMAPS, createArcadeControls, computeSplitScreenViews,
  createAudioManager, analyzeAudioBuffer, normalizeVariantSet,
  SYNTH_PRESETS, synthesizeSfxPcm, createSynthSfx,
  createDiagnostics,
  createGameBridge, createGameHostBridge } from './platform/engine.js';
export {
  EASING,
  TweenManager,
  LN2_CRIT,
  damp,
  dampAngle,
  stepSpring1D,
  SpringDamper1D,
  SpringDamper2D,
  SpringDamper3D,
} from './time/tween.js';
export { AnimationPlayer } from './animation/player.js';
export { SpriteSheet } from './animation/spritesheet.js';
export { TileMap, findGridPath } from './world/tilemap.js';
export { ObjectPool, SpatialHash2D } from './world/spatial2d.js';
export {
  SWARM_UNIT_FLAGS,
  ECS_SLOT_FLAGS,
  FlatSpatialHash2D,
  createFlatSpatialHash2D,
  FlowField2D,
  createFlowField2D,
  FlatCombatECS,
  createSwarmSimulation,
} from './world/swarm-ecs.js';
export { createGpuSwarmWebGL2 } from './world/gpu-swarm-webgl2.js';
export { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
export { createTraceRecorder } from './integrations/trace.js';
export { createSeededRng, createStateChecksum, hashState, runScripted } from './sim/index.js';
export { createSpringArmRayProbe, cameraRelativeMove } from './integrations/camera3d.js';
export {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
} from './ui/red-dot.js';
export {
  VFX_EASING,
  VFX_RENDER_ORDERS,
  VFX_SHAPE,
  TELEGRAPH_SHAPE,
  CROWD_STATUS,
  VFX_PRESETS,
  createVisualPrng,
  packRgb24,
  unpackRgb24Into,
  markAttributeRangeDirty,
  submitRingBufferRanges,
  createHitstopClock,
  createCameraShake,
  createStatelessParticlePool,
  createTrailsSystem,
  createTelegraphSystem,
  extractGlyphIndices,
  createFloatingTextPool,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createScreenFeedbackPass,
  createVfxSystem,
} from './vfx/index.js';

import { defineProject, resolveFeatureGraph } from './core/config.js';
import { Component } from './core/component.js';
import { Entity } from './core/entity.js';
import { Scene, SceneManager } from './core/scene.js';
import { PrefabRegistry } from './core/prefab.js';
import { createTagContainer, createTagRegistry, GLOBAL_TAG_REGISTRY, matchGameplayTags } from './core/tags.js';
import { createGameApplication } from './core/application.js';
import { createTraceRecorder } from './integrations/trace.js';
import { createSeededRng, createStateChecksum, hashState, runScripted } from './sim/index.js';
import { createSpringArmRayProbe, cameraRelativeMove } from './integrations/camera3d.js';
import { ObjectPool, SpatialHash2D } from './world/spatial2d.js';
import {
  SWARM_UNIT_FLAGS,
  ECS_SLOT_FLAGS,
  FlatSpatialHash2D,
  createFlatSpatialHash2D,
  FlowField2D,
  createFlowField2D,
  FlatCombatECS,
  createSwarmSimulation,
} from './world/swarm-ecs.js';
import { createGpuSwarmWebGL2 } from './world/gpu-swarm-webgl2.js';
import { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
import {
  defineInputContext,
  createInputActionRouter,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createArcadeControls,
  computeSplitScreenViews,
  SYNTH_PRESETS,
  synthesizeSfxPcm,
  createSynthSfx,
} from './platform/engine.js';
import { damp, dampAngle, stepSpring1D, SpringDamper1D, SpringDamper2D, SpringDamper3D } from './time/tween.js';
import {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
} from './ui/red-dot.js';
import {
  VFX_SHAPE,
  TELEGRAPH_SHAPE,
  CROWD_STATUS,
  VFX_PRESETS,
  createVisualPrng,
  packRgb24,
  createHitstopClock,
  createCameraShake,
  extractGlyphIndices,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createVfxSystem,
} from './vfx/index.js';

/** Public HGame facade. Physics providers stay lazy and load only when selected. */
export const HGame = Object.freeze({
  name: 'HGame',
  version: HGAME_VERSION,
  physicsBackends: Object.freeze({ '2d': 'rapier2d', '3d': 'rapier3d' }),
  defineProject,
  resolveFeatureGraph,
  createApplication: createGameApplication,
  createTraceRecorder,
  createSeededRng,
  createStateChecksum,
  hashState,
  runScripted,
  createSpringArmRayProbe,
  cameraRelativeMove,
  defineInputContext,
  createInputActionRouter,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createArcadeControls,
  computeSplitScreenViews,
  SYNTH_PRESETS,
  synthesizeSfxPcm,
  createSynthSfx,
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
  createTagRegistry,
  createTagContainer,
  matchGameplayTags,
  GLOBAL_TAG_REGISTRY,
  damp,
  dampAngle,
  stepSpring1D,
  SpringDamper1D,
  SpringDamper2D,
  SpringDamper3D,
  ObjectPool,
  SpatialHash2D,
  SWARM_UNIT_FLAGS,
  ECS_SLOT_FLAGS,
  FlatSpatialHash2D,
  createFlatSpatialHash2D,
  FlowField2D,
  createFlowField2D,
  FlatCombatECS,
  createSwarmSimulation,
  createGpuSwarmWebGL2,
  createWorldPartition,
  createHLODProxyGroup3D,
  createFloatingOrigin,
  VFX_SHAPE,
  TELEGRAPH_SHAPE,
  CROWD_STATUS,
  VFX_PRESETS,
  createVisualPrng,
  packRgb24,
  createHitstopClock,
  createCameraShake,
  extractGlyphIndices,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createVfxSystem,
  Component,
  Entity,
  Scene,
  SceneManager,
  PrefabRegistry,
});

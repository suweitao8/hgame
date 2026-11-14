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
  createAudioManager, analyzeAudioBuffer, normalizeVariantSet, createDiagnostics,
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
export { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
export { createTraceRecorder } from './integrations/trace.js';
export {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
} from './ui/red-dot.js';

import { defineProject, resolveFeatureGraph } from './core/config.js';
import { Component } from './core/component.js';
import { Entity } from './core/entity.js';
import { Scene, SceneManager } from './core/scene.js';
import { PrefabRegistry } from './core/prefab.js';
import { createTagContainer, createTagRegistry, GLOBAL_TAG_REGISTRY, matchGameplayTags } from './core/tags.js';
import { createGameApplication } from './core/application.js';
import { createTraceRecorder } from './integrations/trace.js';
import { ObjectPool, SpatialHash2D } from './world/spatial2d.js';
import { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
import {
  defineInputContext,
  createInputActionRouter,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createArcadeControls,
  computeSplitScreenViews,
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

/** Public HGame facade. Physics providers stay lazy and load only when selected. */
export const HGame = Object.freeze({
  name: 'HGame',
  version: HGAME_VERSION,
  physicsBackends: Object.freeze({ '2d': 'rapier2d', '3d': 'rapier3d' }),
  defineProject,
  resolveFeatureGraph,
  createApplication: createGameApplication,
  createTraceRecorder,
  defineInputContext,
  createInputActionRouter,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createArcadeControls,
  computeSplitScreenViews,
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
  createWorldPartition,
  createHLODProxyGroup3D,
  createFloatingOrigin,
  Component,
  Entity,
  Scene,
  SceneManager,
  PrefabRegistry,
});

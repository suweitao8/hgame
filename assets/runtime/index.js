export const HGAME_VERSION = '1.0.0';
export { defineProject, resolveFeatureGraph, PROJECT_PROFILES, OPTIONAL_FEATURES,
  DETERMINISTIC_PHYSICS_BACKENDS } from './core/config.js';
export { Component } from './core/component.js';
export { Entity } from './core/entity.js';
export { Scene, SceneManager } from './core/scene.js';
export { PrefabRegistry } from './core/prefab.js';
export { createGameApplication } from './core/application.js';
export { createGameEngine, PLATFORM_VERSION, GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION,
  createAssetLoader, createSaveStore, createInputManager, createAudioManager, createDiagnostics,
  createGameBridge, createGameHostBridge } from './platform/engine.js';
export { TweenManager } from './time/tween.js';
export { AnimationPlayer } from './animation/player.js';
export { SpriteSheet } from './animation/spritesheet.js';
export { TileMap, findGridPath } from './world/tilemap.js';
export { createTraceRecorder } from './integrations/trace.js';

import { defineProject, resolveFeatureGraph } from './core/config.js';
import { Component } from './core/component.js';
import { Entity } from './core/entity.js';
import { Scene, SceneManager } from './core/scene.js';
import { PrefabRegistry } from './core/prefab.js';
import { createGameApplication } from './core/application.js';
import { createTraceRecorder } from './integrations/trace.js';

/** Public HGame facade. Physics providers stay lazy and load only when selected. */
export const HGame = Object.freeze({
  name: 'HGame',
  version: HGAME_VERSION,
  physicsBackends: Object.freeze({ '2d': 'rapier2d', '3d': 'rapier3d' }),
  defineProject,
  resolveFeatureGraph,
  createApplication: createGameApplication,
  createTraceRecorder,
  Component,
  Entity,
  Scene,
  SceneManager,
  PrefabRegistry,
});

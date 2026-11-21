export const HGAME_VERSION = '1.0.0';
export { defineProject, resolveFeatureGraph, PROJECT_PROFILES, OPTIONAL_FEATURES,
  DETERMINISTIC_PHYSICS_BACKENDS } from './core/config.js';
export { Component } from './core/component.js';
export { Entity } from './core/entity.js';
export { Scene, SceneManager, createHotReloadController } from './core/scene.js';
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
  createAssetLoader, createSaveStore, createVersionedStore, createInputManager, defineInputContext, createInputActionRouter,
  ARCADE_SLOTS, PLAYER_KEYMAPS, createArcadeControls, computeSplitScreenViews,
  createAudioManager, analyzeAudioBuffer, normalizeVariantSet,
  SYNTH_PRESETS, synthesizeSfxPcm, createSynthSfx,
  BGM_MOODS, midiToHz, generateBgmStep, createProceduralBgm,
  createDiagnostics,
  createGameBridge, createGameHostBridge } from './platform/engine.js';
export {
  createAssetCatalog,
  createStreamingResidencyPolicy,
  bindTextureMipStreaming,
  createVramMipGuard,
  createProgressiveBootLoader,
} from './platform/asset-catalog.js';
import {
  createAssetCatalog,
  createStreamingResidencyPolicy,
  bindTextureMipStreaming,
  createVramMipGuard,
  createProgressiveBootLoader,
} from './platform/asset-catalog.js';
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
export { createSkeleton2D } from './animation/skeleton2d.js';
export { SpriteSheet } from './animation/spritesheet.js';
export { createShadowAtlas3D } from './integrations/shadow3d.js';
export {
  mergeStaticMeshesByMaterial3D,
  GPU_HIZ_OCCLUSION_WGSL,
  createHiZOcclusionCuller3D,
  dispatchWebGpuHiZOcclusion,
  quantizeBufferGeometry3D,
} from './integrations/culling3d.js';
export { createPhysicalRenderTargetPool3D } from './integrations/post3d/render-graph.js';
export { captureResourceSnapshot, diffResourceSnapshots } from './integrations/quality3d/render-diagnostics.js';
export { MRT_OUTLINE_FRAGMENT_GLSL3, createMrtOutlinePass3D } from './integrations/post3d/mrt-outline.js';
import { createSkeleton2D } from './animation/skeleton2d.js';
import { createShadowAtlas3D } from './integrations/shadow3d.js';
import {
  mergeStaticMeshesByMaterial3D,
  GPU_HIZ_OCCLUSION_WGSL,
  createHiZOcclusionCuller3D,
  dispatchWebGpuHiZOcclusion,
  quantizeBufferGeometry3D,
} from './integrations/culling3d.js';
import { createPhysicalRenderTargetPool3D } from './integrations/post3d/render-graph.js';
import { captureResourceSnapshot, diffResourceSnapshots } from './integrations/quality3d/render-diagnostics.js';
import { MRT_OUTLINE_FRAGMENT_GLSL3, createMrtOutlinePass3D } from './integrations/post3d/mrt-outline.js';
export { TileMap, findGridPath, createGridPathWork, applyAutoTileRules } from './world/tilemap.js';
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
export { createNavMesh3D } from './world/navmesh3d.js';
export { fbmNoise2D, createHeightfieldTerrain3D } from './world/terrain3d.js';
export { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
export {
  FOG_FADE_TYPE,
  FOG_QUALITY,
  extractTileMapObstacles,
  createFogOfWarWorld,
} from './world/fog-of-war.js';
export {
  SURFACE_TYPES,
  DEFAULT_SURFACE_FEEDBACK_TABLE,
  createSurfaceFeedbackRouter,
} from './world/surface-feedback.js';
export {
  ATMOSPHERE_PRESETS_CN,
  createAtmosphere3D,
} from './world/atmosphere3d.js';
export {
  QUALITY3D_PROFILES,
  resolveQuality3DProfile,
} from './integrations/quality3d.js';
export {
  createRealisticWater3D,
  createRealisticGlassMaterial3D,
} from './integrations/water3d.js';
export {
  createTwoMapWorldPbrMaterial,
} from './integrations/pbr-material-library.js';
export {
  createStateMachine,
  BT_STATUS,
  sequence,
  selector,
  parallel,
  inverter,
  repeater,
  cooldown,
  condition,
  action,
  wait,
  createBehaviorTree,
} from './ai/index.js';
export { createTraceRecorder } from './integrations/trace.js';
export { COLOR_LUT_PRESETS, createColorLutTexture3D } from './integrations/post3d/color.js';
export {
  KTX2_MAGIC,
  detectCompressedTextureSupport,
  parseKtx2Header,
  selectOptimalTextureVariant,
  createCompressedTextureFromMipData,
} from './integrations/ktx2.js';
export { createSeededRng, createStateChecksum, hashState, runScripted, createSimulationWorkBudget, createSimWorkerRunner, measureHotLoopAllocations } from './sim/index.js';
export { RENDER_RESOURCE_TYPES_2D, createRenderBudgetController } from './integrations/render-budget-2d.js';
export { createSpringArmRayProbe, cameraRelativeMove } from './integrations/camera3d.js';
export {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
  createPanelStack,
  applyAriaToElement,
  computeFlexLayout,
  createCanvasUiRenderer,
  renderSdfText,
  createLiveProfilerOverlay,
  DEFAULT_THUMB_ARC_SPEC,
  computeThumbArcLayout,
  isInThumbComfortZone,
  createThumbArcHud,
  createVirtualList,
  createI18n,
  computeStaggerProgress,
  createUiSurfaceSpring,
  createUiMotionGroup,
  UI_PHASES,
  UI_UX_CUES,
  createUiDirector,
} from './ui/index.js';
export { createNetworkStateSync, createSceneReplicator, createSpatialAoiFilter } from './lockstep/state-sync.js';
import { createNetworkStateSync, createSceneReplicator, createSpatialAoiFilter } from './lockstep/state-sync.js';
export { createSpringBoneChain3D, createInertialBlend3D } from './animation/animator3d.js';
import { createSpringBoneChain3D, createInertialBlend3D } from './animation/animator3d.js';
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
  DAMAGE_NUMBER_PRESETS,
  registerDamagePreset,
  getDamagePreset,
  formatDamageValue,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createScreenFeedbackPass,
  createVfxSystem,
  VFX_RENDER_MODE,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  createProceduralVfxAtlas,
  createAtlasParticlePool,
  createMeshVfxPool,
  validateVfxRecipe,
  createEffectPlayer,
} from './vfx/index.js';

import { defineProject, resolveFeatureGraph } from './core/config.js';
import { Component } from './core/component.js';
import { Entity } from './core/entity.js';
import { Scene, SceneManager, createHotReloadController } from './core/scene.js';
import { PrefabRegistry } from './core/prefab.js';
import { createTagContainer, createTagRegistry, GLOBAL_TAG_REGISTRY, matchGameplayTags } from './core/tags.js';
import { createGameApplication } from './core/application.js';
import { createTraceRecorder } from './integrations/trace.js';
import { COLOR_LUT_PRESETS, createColorLutTexture3D } from './integrations/post3d/color.js';
import {
  KTX2_MAGIC,
  detectCompressedTextureSupport,
  parseKtx2Header,
  selectOptimalTextureVariant,
  createCompressedTextureFromMipData,
} from './integrations/ktx2.js';
import { createSeededRng, createStateChecksum, hashState, runScripted, createSimulationWorkBudget, createSimWorkerRunner, measureHotLoopAllocations } from './sim/index.js';
import { RENDER_RESOURCE_TYPES_2D, createRenderBudgetController } from './integrations/render-budget-2d.js';
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
import { createNavMesh3D } from './world/navmesh3d.js';
import { fbmNoise2D, createHeightfieldTerrain3D } from './world/terrain3d.js';
import { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from './world/open-world.js';
import {
  FOG_FADE_TYPE,
  FOG_QUALITY,
  extractTileMapObstacles,
  createFogOfWarWorld,
} from './world/fog-of-war.js';
import {
  SURFACE_TYPES,
  DEFAULT_SURFACE_FEEDBACK_TABLE,
  createSurfaceFeedbackRouter,
} from './world/surface-feedback.js';
import {
  ATMOSPHERE_PRESETS_CN,
  createAtmosphere3D,
} from './world/atmosphere3d.js';
import {
  QUALITY3D_PROFILES,
  resolveQuality3DProfile,
} from './integrations/quality3d.js';
import {
  createRealisticWater3D,
  createRealisticGlassMaterial3D,
} from './integrations/water3d.js';
import {
  createTwoMapWorldPbrMaterial,
} from './integrations/pbr-material-library.js';
import {
  createStateMachine,
  BT_STATUS,
  sequence,
  selector,
  parallel,
  inverter,
  repeater,
  cooldown,
  condition,
  action,
  wait,
  createBehaviorTree,
} from './ai/index.js';
import {
  createVersionedStore,
  defineInputContext,
  createInputActionRouter,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createArcadeControls,
  computeSplitScreenViews,
  SYNTH_PRESETS,
  synthesizeSfxPcm,
  createSynthSfx,
  BGM_MOODS,
  midiToHz,
  generateBgmStep,
  createProceduralBgm,
} from './platform/engine.js';
import { damp, dampAngle, stepSpring1D, SpringDamper1D, SpringDamper2D, SpringDamper3D } from './time/tween.js';
import {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
  createPanelStack,
  applyAriaToElement,
  computeFlexLayout,
  createCanvasUiRenderer,
  renderSdfText,
  createLiveProfilerOverlay,
  DEFAULT_THUMB_ARC_SPEC,
  computeThumbArcLayout,
  isInThumbComfortZone,
  createThumbArcHud,
  createVirtualList,
  createI18n,
  computeStaggerProgress,
  createUiSurfaceSpring,
  createUiMotionGroup,
  UI_PHASES,
  UI_UX_CUES,
  createUiDirector,
} from './ui/index.js';
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
  DAMAGE_NUMBER_PRESETS,
  registerDamagePreset,
  getDamagePreset,
  formatDamageValue,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createVfxSystem,
  VFX_RENDER_MODE,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  createProceduralVfxAtlas,
  validateVfxRecipe,
} from './vfx/index.js';
export {
  STANDARD_ART_SPEC,
  ART_THEMES,
  listArtThemes,
  getArtTheme,
  resolvePresentationPreset,
  GAME_AUDIO_EVENTS,
  DEFAULT_AUDIO_MATRIX,
  AUDIO_PROFILES,
  createAudioDirector,
  GENRE_ARCHETYPES,
  listGenreArchetypes,
  defineGameBlueprint,
  evaluateBlueprintBalance,
  createBlueprintFromIdea,
  createGameSession,
  mountGameShell,
  REQUIRED_DESIGN_DOCS,
  renderGameDesignDocs,
} from './kit/index.js';
import {
  STANDARD_ART_SPEC,
  ART_THEMES,
  listArtThemes,
  getArtTheme,
  resolvePresentationPreset,
  GAME_AUDIO_EVENTS,
  DEFAULT_AUDIO_MATRIX,
  AUDIO_PROFILES,
  createAudioDirector,
  GENRE_ARCHETYPES,
  listGenreArchetypes,
  defineGameBlueprint,
  evaluateBlueprintBalance,
  createBlueprintFromIdea,
  createGameSession,
  mountGameShell,
  REQUIRED_DESIGN_DOCS,
  renderGameDesignDocs,
} from './kit/index.js';

/** Public HGame facade. Physics providers stay lazy and load only when selected. */
export const HGame = Object.freeze({
  name: 'HGame',
  version: HGAME_VERSION,
  physicsBackends: Object.freeze({ '2d': 'rapier2d', '3d': 'rapier3d' }),
  defineProject,
  resolveFeatureGraph,
  createApplication: createGameApplication,
  createVersionedStore,
  createTraceRecorder,
  COLOR_LUT_PRESETS,
  createColorLutTexture3D,
  KTX2_MAGIC,
  detectCompressedTextureSupport,
  parseKtx2Header,
  selectOptimalTextureVariant,
  createCompressedTextureFromMipData,
  createSeededRng,
  createStateChecksum,
  hashState,
  runScripted,
  createSimulationWorkBudget,
  createSimWorkerRunner,
  measureHotLoopAllocations,
  RENDER_RESOURCE_TYPES_2D,
  createRenderBudgetController,
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
  BGM_MOODS,
  midiToHz,
  generateBgmStep,
  createProceduralBgm,
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
  createPanelStack,
  applyAriaToElement,
  computeFlexLayout,
  createCanvasUiRenderer,
  renderSdfText,
  createLiveProfilerOverlay,
  DEFAULT_THUMB_ARC_SPEC,
  computeThumbArcLayout,
  isInThumbComfortZone,
  createThumbArcHud,
  createVirtualList,
  createI18n,
  computeStaggerProgress,
  createUiSurfaceSpring,
  createUiMotionGroup,
  UI_PHASES,
  UI_UX_CUES,
  createUiDirector,
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
  createNavMesh3D,
  fbmNoise2D,
  createHeightfieldTerrain3D,
  createWorldPartition,
  createHLODProxyGroup3D,
  createFloatingOrigin,
  FOG_FADE_TYPE,
  FOG_QUALITY,
  extractTileMapObstacles,
  createFogOfWarWorld,
  SURFACE_TYPES,
  DEFAULT_SURFACE_FEEDBACK_TABLE,
  createSurfaceFeedbackRouter,
  ATMOSPHERE_PRESETS_CN,
  createAtmosphere3D,
  QUALITY3D_PROFILES,
  resolveQuality3DProfile,
  createRealisticWater3D,
  createRealisticGlassMaterial3D,
  createTwoMapWorldPbrMaterial,
  createStateMachine,
  BT_STATUS,
  sequence,
  selector,
  parallel,
  inverter,
  repeater,
  cooldown,
  condition,
  action,
  wait,
  createBehaviorTree,
  VFX_SHAPE,
  TELEGRAPH_SHAPE,
  CROWD_STATUS,
  VFX_PRESETS,
  createVisualPrng,
  packRgb24,
  createHitstopClock,
  createCameraShake,
  extractGlyphIndices,
  DAMAGE_NUMBER_PRESETS,
  registerDamagePreset,
  getDamagePreset,
  formatDamageValue,
  packCrowdAnimStatus,
  unpackCrowdAnimStatus,
  createVfxSystem,
  VFX_RENDER_MODE,
  PROCEDURAL_VFX_ATLAS_REGIONS,
  createProceduralVfxAtlas,
  validateVfxRecipe,
  Component,
  Entity,
  Scene,
  SceneManager,
  PrefabRegistry,
  STANDARD_ART_SPEC,
  ART_THEMES,
  listArtThemes,
  getArtTheme,
  resolvePresentationPreset,
  GAME_AUDIO_EVENTS,
  DEFAULT_AUDIO_MATRIX,
  AUDIO_PROFILES,
  createAudioDirector,
  GENRE_ARCHETYPES,
  listGenreArchetypes,
  defineGameBlueprint,
  evaluateBlueprintBalance,
  createBlueprintFromIdea,
  createGameSession,
  mountGameShell,
  REQUIRED_DESIGN_DOCS,
  renderGameDesignDocs,
  createAssetCatalog,
  createStreamingResidencyPolicy,
  bindTextureMipStreaming,
  createVramMipGuard,
  createProgressiveBootLoader,
  createNetworkStateSync,
  createSceneReplicator,
  createSpatialAoiFilter,
  createSpringBoneChain3D,
  createInertialBlend3D,
  createShadowAtlas3D,
  mergeStaticMeshesByMaterial3D,
  GPU_HIZ_OCCLUSION_WGSL,
  createHiZOcclusionCuller3D,
  dispatchWebGpuHiZOcclusion,
  quantizeBufferGeometry3D,
  MRT_OUTLINE_FRAGMENT_GLSL3,
  createMrtOutlinePass3D,
  createPhysicalRenderTargetPool3D,
  captureResourceSnapshot,
  diffResourceSnapshots,
  createHotReloadController,
  createSkeleton2D,
});

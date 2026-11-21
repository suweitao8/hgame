import { createAssetCatalog, createStreamingResidencyPolicy, bindTextureMipStreaming, createVramMipGuard, createProgressiveBootLoader } from "./platform/asset-catalog.js";
import { createRemoteBundleLoader, toCatalogLoader } from "./platform/remote-bundle.js";
import { createSkeleton2D } from "./animation/skeleton2d.js";
import { createWorkerPhysicsWorld } from "./physics/worker-physics.js";
import { createShadowAtlas3D } from "./integrations/shadow3d.js";
import { generateLightmapUV3D, createLightmapBaker3D } from "./integrations/lightmap-bake3d.js";
import { mergeStaticMeshesByMaterial3D, quantizeBufferGeometry3D } from "./integrations/culling3d.js";
import { createPhysicalRenderTargetPool3D } from "./integrations/post3d/render-graph.js";
import { captureResourceSnapshot, diffResourceSnapshots } from "./integrations/quality3d/render-diagnostics.js";
import { createMrtOutlinePass3D } from "./integrations/post3d/mrt-outline.js";
import { createNetworkStateSync, createSceneReplicator, createSpatialAoiFilter } from "./lockstep/state-sync.js";
import { createWebRtcDataChannelTransport } from "./lockstep/webrtc-transport.js";
import { createSpringBoneChain3D, createInertialBlend3D } from "./animation/animator3d.js";
import { createBoneMap3D, retargetClip3D } from "./animation/retarget3d.js";
import { defineProject, resolveFeatureGraph } from "./core/config.js";
import { Component } from "./core/component.js";
import { Entity } from "./core/entity.js";
import { Scene, SceneManager, createHotReloadController } from "./core/scene.js";
import { PrefabRegistry } from "./core/prefab.js";
import { createTagContainer, createTagRegistry, matchGameplayTags } from "./core/tags.js";
import { createGameApplication } from "./core/application.js";
import { createTraceRecorder } from "./integrations/trace.js";
import { createColorLutTexture3D } from "./integrations/post3d/color.js";
import { detectCompressedTextureSupport, parseKtx2Header, selectOptimalTextureVariant, createCompressedTextureFromMipData } from "./integrations/ktx2.js";
import { createRenderBudgetController } from "./integrations/render-budget-2d.js";
import { createSpringArmRayProbe, cameraRelativeMove } from "./integrations/camera3d.js";
import { ObjectPool, SpatialHash2D } from "./world/spatial2d.js";
import { FlatSpatialHash2D, createFlatSpatialHash2D, FlowField2D, createFlowField2D, FlatCombatECS, createSwarmSimulation } from "./world/swarm-ecs.js";
import { createGpuSwarmWebGL2 } from "./world/gpu-swarm-webgl2.js";
import { createNavMesh3D } from "./world/navmesh3d.js";
import { fbmNoise2D, createHeightfieldTerrain3D } from "./world/terrain3d.js";
import { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from "./world/open-world.js";
import { extractTileMapObstacles, createFogOfWarWorld } from "./world/fog-of-war.js";
import { createSurfaceFeedbackRouter } from "./world/surface-feedback.js";
import { createAtmosphere3D } from "./world/atmosphere3d.js";
import { resolveQuality3DProfile } from "./integrations/quality3d.js";
import { createRealisticWater3D, createRealisticGlassMaterial3D } from "./integrations/water3d.js";
import { createTwoMapWorldPbrMaterial } from "./integrations/pbr-material-library.js";
import { defineMaterialVariants3D } from "./integrations/material-graph3d.js";
import { damp, dampAngle, stepSpring1D, SpringDamper1D, SpringDamper2D, SpringDamper3D } from "./time/tween.js";
import { createVfxSystem } from "./vfx/index.js";
export const HGAME_VERSION: "1.0.0";
export { Component } from "./core/component.js";
export { Entity } from "./core/entity.js";
export { PrefabRegistry } from "./core/prefab.js";
export { createGameApplication } from "./core/application.js";
export { AnimationPlayer } from "./animation/player.js";
export { createSkeleton2D } from "./animation/skeleton2d.js";
export { createWorkerPhysicsWorld } from "./physics/worker-physics.js";
export { SpriteSheet } from "./animation/spritesheet.js";
export { createShadowAtlas3D } from "./integrations/shadow3d.js";
export { createPhysicalRenderTargetPool3D } from "./integrations/post3d/render-graph.js";
export { createGpuSwarmWebGL2 } from "./world/gpu-swarm-webgl2.js";
export { createNavMesh3D } from "./world/navmesh3d.js";
export { createTwoMapWorldPbrMaterial } from "./integrations/pbr-material-library.js";
export { defineMaterialVariants3D } from "./integrations/material-graph3d.js";
export { createTraceRecorder } from "./integrations/trace.js";
export { createWebRtcDataChannelTransport } from "./lockstep/webrtc-transport.js";
/** Public HGame facade. Physics providers stay lazy and load only when selected. */
export const HGame: Readonly<{
    name: "HGame";
    version: "1.0.0";
    physicsBackends: Readonly<{
        '2d': "rapier2d";
        '3d': "rapier3d";
    }>;
    defineProject: typeof defineProject;
    resolveFeatureGraph: typeof resolveFeatureGraph;
    createApplication: typeof createGameApplication;
    createVersionedStore: typeof createVersionedStore;
    createTraceRecorder: typeof createTraceRecorder;
    COLOR_LUT_PRESETS: readonly string[];
    createColorLutTexture3D: typeof createColorLutTexture3D;
    KTX2_MAGIC: Uint8Array;
    detectCompressedTextureSupport: typeof detectCompressedTextureSupport;
    parseKtx2Header: typeof parseKtx2Header;
    selectOptimalTextureVariant: typeof selectOptimalTextureVariant;
    createCompressedTextureFromMipData: typeof createCompressedTextureFromMipData;
    createSeededRng: typeof createSeededRng;
    createStateChecksum: typeof createStateChecksum;
    hashState: typeof hashState;
    runScripted: typeof runScripted;
    createSimulationWorkBudget: typeof createSimulationWorkBudget;
    createSimWorkerRunner: typeof createSimWorkerRunner;
    measureHotLoopAllocations: typeof measureHotLoopAllocations;
    RENDER_RESOURCE_TYPES_2D: readonly string[];
    createRenderBudgetController: typeof createRenderBudgetController;
    createSpringArmRayProbe: typeof createSpringArmRayProbe;
    cameraRelativeMove: typeof cameraRelativeMove;
    defineInputContext: typeof defineInputContext;
    createInputActionRouter: typeof createInputActionRouter;
    ARCADE_SLOTS: Readonly<{
        primary: readonly import("./platform/input/arcade.js").ArcadeSlot[];
        extra: readonly import("./platform/input/arcade.js").ArcadeSlot[];
        all: readonly import("./platform/input/arcade.js").ArcadeSlot[];
    }>;
    PLAYER_KEYMAPS: Readonly<{
        p1: import("./platform/input/arcade.js").ArcadeKeymap;
        p2: import("./platform/input/arcade.js").ArcadeKeymap;
    }>;
    createArcadeControls: typeof createArcadeControls;
    computeSplitScreenViews: typeof computeSplitScreenViews;
    SYNTH_PRESETS: Readonly<{
        hit: Readonly<{
            wave: "triangle";
            freqStart: 190;
            freqEnd: 46;
            duration: 0.095;
            gain: 0.65;
            noiseMix: 0.45;
            filterType: "bandpass";
            filterStartHz: 1100;
            filterEndHz: 320;
            attack: 0.002;
        }>;
        slash: Readonly<{
            wave: "sine";
            freqStart: 420;
            freqEnd: 150;
            duration: 0.13;
            gain: 0.45;
            noiseMix: 0.85;
            filterType: "bandpass";
            filterStartHz: 2400;
            filterEndHz: 480;
            attack: 0.004;
        }>;
        shoot: Readonly<{
            wave: "square";
            freqStart: 560;
            freqEnd: 120;
            duration: 0.11;
            gain: 0.42;
            noiseMix: 0.35;
            filterType: "lowpass";
            filterStartHz: 3200;
            filterEndHz: 600;
            attack: 0.002;
        }>;
        explosion: Readonly<{
            wave: "sawtooth";
            freqStart: 115;
            freqEnd: 24;
            duration: 0.42;
            gain: 0.75;
            noiseMix: 0.8;
            filterType: "lowpass";
            filterStartHz: 1200;
            filterEndHz: 120;
            attack: 0.004;
        }>;
        pickup: Readonly<{
            wave: "triangle";
            freqStart: 660;
            freqEnd: 990;
            steps: number[];
            duration: 0.14;
            gain: 0.45;
            noiseMix: 0;
            filterType: "lowpass";
            filterStartHz: 6000;
            filterEndHz: 6000;
            attack: 0.003;
        }>;
        powerup: Readonly<{
            wave: "triangle";
            freqStart: 440;
            freqEnd: 880;
            steps: number[];
            duration: 0.32;
            gain: 0.5;
            noiseMix: 0.05;
            filterType: "lowpass";
            filterStartHz: 7000;
            filterEndHz: 7000;
            attack: 0.005;
        }>;
        click: Readonly<{
            wave: "sine";
            freqStart: 1150;
            freqEnd: 620;
            duration: 0.032;
            gain: 0.35;
            noiseMix: 0.15;
            filterType: "highpass";
            filterStartHz: 500;
            filterEndHz: 500;
            attack: 0.001;
        }>;
        hurt: Readonly<{
            wave: "sawtooth";
            freqStart: 250;
            freqEnd: 70;
            duration: 0.18;
            gain: 0.55;
            noiseMix: 0.4;
            filterType: "lowpass";
            filterStartHz: 1800;
            filterEndHz: 260;
            attack: 0.002;
        }>;
        laser: Readonly<{
            wave: "sawtooth";
            freqStart: 940;
            freqEnd: 170;
            duration: 0.16;
            gain: 0.4;
            noiseMix: 0.1;
            filterType: "bandpass";
            filterStartHz: 2600;
            filterEndHz: 520;
            attack: 0.002;
        }>;
        jump: Readonly<{
            wave: "sine";
            freqStart: 210;
            freqEnd: 540;
            duration: 0.14;
            gain: 0.45;
            noiseMix: 0;
            filterType: "lowpass";
            filterStartHz: 4000;
            filterEndHz: 4000;
            attack: 0.004;
        }>;
    }>;
    synthesizeSfxPcm: typeof synthesizeSfxPcm;
    createSynthSfx: typeof createSynthSfx;
    BGM_MOODS: Readonly<{
        dungeon: Readonly<{
            bpm: 108;
            rootMidi: 45;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "triangle";
            leadWave: "sine";
            leadCutoffHz: 1400;
            arpSteps: readonly number[];
        }>;
        cyber: Readonly<{
            bpm: 128;
            rootMidi: 40;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "sawtooth";
            leadWave: "square";
            leadCutoffHz: 2400;
            arpSteps: readonly number[];
        }>;
        boss: Readonly<{
            bpm: 152;
            rootMidi: 38;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "sawtooth";
            leadWave: "sawtooth";
            leadCutoffHz: 3000;
            arpSteps: readonly number[];
        }>;
        chill: Readonly<{
            bpm: 88;
            rootMidi: 48;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "sine";
            leadWave: "triangle";
            leadCutoffHz: 1100;
            arpSteps: readonly number[];
        }>;
        adventure: Readonly<{
            bpm: 120;
            rootMidi: 43;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "triangle";
            leadWave: "triangle";
            leadCutoffHz: 1900;
            arpSteps: readonly number[];
        }>;
        victory: Readonly<{
            bpm: 132;
            rootMidi: 48;
            scale: readonly number[];
            chords: readonly number[];
            bassWave: "triangle";
            leadWave: "square";
            leadCutoffHz: 2600;
            arpSteps: readonly number[];
        }>;
    }>;
    midiToHz: typeof midiToHz;
    generateBgmStep: typeof generateBgmStep;
    createProceduralBgm: typeof createProceduralBgm;
    RED_DOT_STYLES: Readonly<{
        NONE: "none";
        QUIET: "quiet";
        DOT: "dot";
        NEW: "new";
        NUMBER: "number";
    }>;
    normalizeRedDotPath: typeof normalizeRedDotPath;
    splitRedDotAncestors: typeof splitRedDotAncestors;
    computeCommercialDayKey: typeof computeCommercialDayKey;
    formatRedDotBadge: typeof formatRedDotBadge;
    createRedDotSystem: typeof createRedDotSystem;
    createPanelStack: typeof createPanelStack;
    applyAriaToElement: typeof applyAriaToElement;
    computeFlexLayout: typeof computeFlexLayout;
    createCanvasUiRenderer: typeof createCanvasUiRenderer;
    renderSdfText: typeof renderSdfText;
    layoutRichTextLines: typeof layoutRichTextLines;
    createCanvasAriaBridge: typeof createCanvasAriaBridge;
    createLiveProfilerOverlay: typeof createLiveProfilerOverlay;
    DEFAULT_THUMB_ARC_SPEC: Readonly<{
        anchor: "bottom-right";
        minCenterYRatio: 0.52;
        minButtonSize: 48;
        primarySize: 68;
        secondarySize: 52;
        arcRadius: 108;
        outerArcRadius: 172;
        startAngleDeg: 185;
        endAngleDeg: 265;
        cornerMarginRight: 18;
        cornerMarginBottom: 18;
    }>;
    computeThumbArcLayout: typeof computeThumbArcLayout;
    isInThumbComfortZone: typeof isInThumbComfortZone;
    createThumbArcHud: typeof createThumbArcHud;
    createVirtualList: typeof createVirtualList;
    createI18n: typeof createI18n;
    computeStaggerProgress: typeof computeStaggerProgress;
    createUiSurfaceSpring: typeof createUiSurfaceSpring;
    createUiMotionGroup: typeof createUiMotionGroup;
    UI_PHASES: Readonly<{
        TITLE: "title";
        PLAYING: "playing";
        PAUSED: "paused";
        CHOICE: "choice";
        RESULT: "result";
    }>;
    UI_UX_CUES: Readonly<{
        HOVER: "hover";
        PRESS: "press";
        CONFIRM: "confirm";
        CANCEL: "cancel";
        OPEN: "open";
        CLOSE: "close";
        REWARD: "reward";
        ERROR: "error";
        METRIC_UP: "metricUp";
        METRIC_DOWN: "metricDown";
    }>;
    createUiDirector: typeof createUiDirector;
    createTagRegistry: typeof createTagRegistry;
    createTagContainer: typeof createTagContainer;
    matchGameplayTags: typeof matchGameplayTags;
    GLOBAL_TAG_REGISTRY: import("./core/tags.js").TagRegistry;
    damp: typeof damp;
    dampAngle: typeof dampAngle;
    stepSpring1D: typeof stepSpring1D;
    SpringDamper1D: typeof SpringDamper1D;
    SpringDamper2D: typeof SpringDamper2D;
    SpringDamper3D: typeof SpringDamper3D;
    ObjectPool: typeof ObjectPool;
    SpatialHash2D: typeof SpatialHash2D;
    SWARM_UNIT_FLAGS: Readonly<{
        NONE: 0;
        ALIVE: number;
        ECS_CLAIMED: number;
        FLASHING: number;
    }>;
    ECS_SLOT_FLAGS: Readonly<{
        NONE: 0;
        ACTIVE: number;
        DEAD: number;
        FROZEN: number;
        KNOCKBACK: number;
        DIRTY: number;
    }>;
    FlatSpatialHash2D: typeof FlatSpatialHash2D;
    createFlatSpatialHash2D: typeof createFlatSpatialHash2D;
    FlowField2D: typeof FlowField2D;
    createFlowField2D: typeof createFlowField2D;
    FlatCombatECS: typeof FlatCombatECS;
    createSwarmSimulation: typeof createSwarmSimulation;
    createGpuSwarmWebGL2: typeof createGpuSwarmWebGL2;
    createNavMesh3D: typeof createNavMesh3D;
    fbmNoise2D: typeof fbmNoise2D;
    createHeightfieldTerrain3D: typeof createHeightfieldTerrain3D;
    createWorldPartition: typeof createWorldPartition;
    createHLODProxyGroup3D: typeof createHLODProxyGroup3D;
    createFloatingOrigin: typeof createFloatingOrigin;
    FOG_FADE_TYPE: Readonly<{
        LINEAR: "linear";
        SMOOTH: "smooth";
        SMOOTHER: "smoother";
        SMOOTHSTEP: "smoothstep";
        EXPONENTIAL: "exponential";
    }>;
    FOG_QUALITY: Readonly<{
        LOW: 64;
        MEDIUM: 128;
        HIGH: 256;
        ULTRA: 360;
    }>;
    TOPDOWN_FOG_DEFAULTS: Readonly<{
        plane: "xz";
        resolution: 256;
        useMemory: false;
        exploredAlpha: 0;
        fadeInSpeed: 12;
        fadeOutSpeed: 6.5;
        blurPasses: 2;
        sightExtra: 0.35;
        edgeSoften: 0.65;
        viewRadius: 23.25;
        softenDistance: 4;
        unobscuredRadius: 2.5;
        unobscuredSoften: 1;
        rayCount: 256;
        visibilityThreshold: 0.3;
        transitionRange: readonly number[];
        fogColor: readonly number[];
        minimapFogRgba: readonly number[];
    }>;
    extractTileMapObstacles: typeof extractTileMapObstacles;
    createFogOfWarWorld: typeof createFogOfWarWorld;
    SURFACE_TYPES: readonly string[];
    DEFAULT_SURFACE_FEEDBACK_TABLE: Readonly<{
        asphalt: Readonly<{
            recipe: "impact_concrete";
            particle: Readonly<{
                shape: 2;
                color: 4937059;
                count: 8;
                speedMin: 1.8;
                speedMax: 5.2;
                sizeStart: 0.28;
                sizeEnd: 0.55;
                durationMin: 0.22;
                durationMax: 0.4;
                gravity: 6;
                drag: 3.5;
                additive: false;
            }>;
            decalColor: 2042167;
            decalSize: number[];
            decalOpacity: 0.82;
        }>;
        concrete: Readonly<{
            recipe: "impact_concrete";
            particle: Readonly<{
                shape: 2;
                color: 10265519;
                count: 10;
                speedMin: 2;
                speedMax: 5.8;
                sizeStart: 0.3;
                sizeEnd: 0.6;
                durationMin: 0.25;
                durationMax: 0.45;
                gravity: 7.5;
                drag: 3.5;
                additive: false;
            }>;
            decalColor: 3621201;
            decalSize: number[];
            decalOpacity: 0.85;
        }>;
        tile: Readonly<{
            recipe: "impact_concrete";
            particle: Readonly<{
                shape: 4;
                color: 15067115;
                count: 9;
                speedMin: 2.5;
                speedMax: 6.5;
                sizeStart: 0.22;
                sizeEnd: 0.04;
                durationMin: 0.2;
                durationMax: 0.36;
                gravity: 11;
                drag: 2.8;
                additive: false;
            }>;
            decalColor: 4937059;
            decalSize: number[];
            decalOpacity: 0.8;
        }>;
        wood: Readonly<{
            recipe: "impact_wood";
            particle: Readonly<{
                shape: 4;
                color: 11817737;
                count: 9;
                speedMin: 2.2;
                speedMax: 6;
                sizeStart: 0.24;
                sizeEnd: 0.05;
                durationMin: 0.22;
                durationMax: 0.38;
                gravity: 10;
                drag: 3;
                additive: false;
            }>;
            decalColor: 4528643;
            decalSize: number[];
            decalOpacity: 0.82;
        }>;
        metal: Readonly<{
            recipe: "impact_metal";
            particle: Readonly<{
                shape: 1;
                color: 16765286;
                count: 14;
                speedMin: 4.5;
                speedMax: 11.5;
                sizeStart: 0.26;
                sizeEnd: 0.03;
                durationMin: 0.14;
                durationMax: 0.28;
                gravity: 12;
                drag: 3.2;
                stretch: 1.35;
                additive: true;
            }>;
            decalColor: 1120295;
            decalSize: number[];
            decalOpacity: 0.85;
        }>;
        glass: Readonly<{
            recipe: "impact_glass";
            particle: Readonly<{
                shape: 4;
                color: 14742270;
                count: 12;
                speedMin: 3;
                speedMax: 8.5;
                sizeStart: 0.24;
                sizeEnd: 0.04;
                durationMin: 0.22;
                durationMax: 0.4;
                gravity: 12;
                drag: 2.4;
                additive: true;
            }>;
            decalColor: 13358561;
            decalSize: number[];
            decalOpacity: 0.72;
        }>;
        dirt: Readonly<{
            recipe: "impact_dirt";
            particle: Readonly<{
                shape: 2;
                color: 7877903;
                count: 10;
                speedMin: 1.8;
                speedMax: 5;
                sizeStart: 0.32;
                sizeEnd: 0.65;
                durationMin: 0.28;
                durationMax: 0.5;
                gravity: 8.5;
                drag: 3.6;
                additive: false;
            }>;
            decalColor: 3875604;
            decalSize: number[];
            decalOpacity: 0.78;
        }>;
        grass: Readonly<{
            recipe: "impact_grass";
            particle: Readonly<{
                shape: 4;
                color: 5078031;
                count: 9;
                speedMin: 2;
                speedMax: 5.2;
                sizeStart: 0.24;
                sizeEnd: 0.06;
                durationMin: 0.25;
                durationMax: 0.45;
                gravity: 9;
                drag: 3.4;
                additive: false;
            }>;
            decalColor: 3560212;
            decalSize: number[];
            decalOpacity: 0.65;
        }>;
        water: Readonly<{
            recipe: "impact_water";
            particle: Readonly<{
                shape: 3;
                color: 12248829;
                count: 8;
                speedMin: 1.5;
                speedMax: 4.5;
                sizeStart: 0.35;
                sizeEnd: 0.85;
                durationMin: 0.24;
                durationMax: 0.42;
                gravity: 8;
                drag: 3.2;
                additive: true;
            }>;
            decalColor: null;
            decalSize: null;
            decalOpacity: 0;
        }>;
        fabric: Readonly<{
            recipe: "impact_fabric";
            particle: Readonly<{
                shape: 2;
                color: 13751771;
                count: 6;
                speedMin: 1;
                speedMax: 3;
                sizeStart: 0.22;
                sizeEnd: 0.42;
                durationMin: 0.2;
                durationMax: 0.36;
                gravity: 2.5;
                drag: 4.2;
                additive: false;
            }>;
            decalColor: 2042167;
            decalSize: number[];
            decalOpacity: 0.55;
        }>;
    }>;
    createSurfaceFeedbackRouter: typeof createSurfaceFeedbackRouter;
    ATMOSPHERE_PRESETS_CN: Readonly<{
        cn_cbd_day: Readonly<{
            id: "cn_cbd_day";
            skyPreset: "day";
            sunColor: 16775406;
            sunIntensity: 1.25;
            sunDirection: readonly number[];
            exposure: 1.05;
            bloomStrength: 0.22;
            contrast: 1.06;
            saturation: 1.04;
            vignette: 0.14;
        }>;
        cn_old_town_dusk: Readonly<{
            id: "cn_old_town_dusk";
            skyPreset: "goldenHour";
            sunColor: 16755302;
            sunIntensity: 1.1;
            sunDirection: readonly number[];
            exposure: 1.02;
            bloomStrength: 0.34;
            contrast: 1.08;
            saturation: 1.12;
            vignette: 0.22;
            colorGain: readonly number[];
        }>;
        cn_horror_night: Readonly<{
            id: "cn_horror_night";
            skyPreset: "night";
            sunColor: 8034754;
            sunIntensity: 0.38;
            sunDirection: readonly number[];
            exposure: 0.92;
            bloomStrength: 0.52;
            contrast: 1.12;
            saturation: 0.92;
            vignette: 0.34;
            colorLift: readonly number[];
        }>;
        cn_rural_morning: Readonly<{
            id: "cn_rural_morning";
            skyPreset: "day";
            sunColor: 16772050;
            sunIntensity: 0.95;
            sunDirection: readonly number[];
            exposure: 1;
            bloomStrength: 0.28;
            contrast: 1;
            saturation: 1.05;
            vignette: 0.16;
        }>;
    }>;
    createAtmosphere3D: typeof createAtmosphere3D;
    QUALITY3D_PROFILES: Readonly<{
        mobile_low: Readonly<{
            profile: "mobile_low";
            baseTier: "low";
            shadowMapSize: 1024;
            shadowsEnabled: true;
            shadowCascades: 1;
            maxDynamicLights: 4;
            bloom: false;
            ssao: false;
            ssgi: false;
            ssr: false;
            contactShadows: false;
            volumetricSteps: 0;
            temporalAA: false;
            fxaa: false;
            foliageBayerDither: false;
            decalMode: "surface";
            /**
             * Hard physical-pixel budget.
             */
            maxPixels: number;
            /**
             * Max device pixel ratio.
             */
            maxPixelRatio: number;
            /**
             * World units.
             */
            shadowDistance: number;
            msaaSamples: number;
            anisotropy: number;
            sharpen: number;
            /**
             * World units.
             */
            drawDistance: number;
            occlusionCulling: boolean;
            animationLodScale: number;
            particleScale: number;
            megaLightsSamples: number;
            maxClusteredLights: number;
        }>;
        mobile_high: Readonly<{
            profile: "mobile_high";
            baseTier: "medium";
            shadowMapSize: 1024;
            shadowsEnabled: true;
            shadowCascades: 1;
            maxDynamicLights: 8;
            bloom: true;
            ssao: false;
            ssgi: false;
            ssr: false;
            contactShadows: false;
            volumetricSteps: 0;
            temporalAA: false;
            fxaa: true;
            foliageBayerDither: true;
            decalMode: "projected";
            /**
             * Hard physical-pixel budget.
             */
            maxPixels: number;
            /**
             * Max device pixel ratio.
             */
            maxPixelRatio: number;
            /**
             * World units.
             */
            shadowDistance: number;
            msaaSamples: number;
            anisotropy: number;
            sharpen: number;
            /**
             * World units.
             */
            drawDistance: number;
            occlusionCulling: boolean;
            animationLodScale: number;
            particleScale: number;
            megaLightsSamples: number;
            maxClusteredLights: number;
        }>;
        pc_ultra: Readonly<{
            profile: "pc_ultra";
            baseTier: "ultra";
            shadowMapSize: 2048;
            shadowsEnabled: true;
            shadowCascades: 3;
            maxDynamicLights: 16;
            bloom: true;
            ssao: true;
            ssgi: true;
            ssr: true;
            contactShadows: true;
            volumetricSteps: 16;
            temporalAA: true;
            fxaa: true;
            foliageBayerDither: true;
            decalMode: "projected";
            /**
             * Hard physical-pixel budget.
             */
            maxPixels: number;
            /**
             * Max device pixel ratio.
             */
            maxPixelRatio: number;
            /**
             * World units.
             */
            shadowDistance: number;
            msaaSamples: number;
            anisotropy: number;
            sharpen: number;
            /**
             * World units.
             */
            drawDistance: number;
            occlusionCulling: boolean;
            animationLodScale: number;
            particleScale: number;
            megaLightsSamples: number;
            maxClusteredLights: number;
        }>;
    }>;
    resolveQuality3DProfile: typeof resolveQuality3DProfile;
    createRealisticWater3D: typeof createRealisticWater3D;
    createRealisticGlassMaterial3D: typeof createRealisticGlassMaterial3D;
    createTwoMapWorldPbrMaterial: typeof createTwoMapWorldPbrMaterial;
    defineMaterialVariants3D: typeof defineMaterialVariants3D;
    createStateMachine: typeof createStateMachine;
    BT_STATUS: Readonly<{
        SUCCESS: "success";
        FAILURE: "failure";
        RUNNING: "running";
    }>;
    sequence: typeof sequence;
    selector: typeof selector;
    parallel: typeof parallel;
    inverter: typeof inverter;
    repeater: typeof repeater;
    cooldown: typeof cooldown;
    condition: typeof condition;
    action: typeof action;
    wait: typeof wait;
    createBehaviorTree: typeof createBehaviorTree;
    VFX_SHAPE: Readonly<{
        GLOW_ORB: 0;
        HIT_SPARK: 1;
        SMOKE_PUFF: 2;
        SHOCK_RING: 3;
        SHARD_BLADE: 4;
    }>;
    TELEGRAPH_SHAPE: Readonly<{
        CIRCLE: 0;
        RING: 1;
        SECTOR: 2;
        LINE_BOX: 3;
        SHRINK_ZONE: 4;
    }>;
    CROWD_STATUS: Readonly<{
        NORMAL: 0;
        FLASH_25: 1;
        FLASH_50: 2;
        FLASH_75: 3;
        FLASH_92: 4;
        FROZEN: 5;
        POISON: 6;
        BURN: 7;
    }>;
    VFX_PRESETS: Readonly<{
        physical: Readonly<{
            color: 16765286;
            shape: 1;
            count: 10;
            speedMin: 3.5;
            speedMax: 9;
            sizeStart: 0.35;
            sizeEnd: 0.04;
            durationMin: 0.18;
            durationMax: 0.32;
            gravity: 12;
            drag: 4;
            stretch: 1;
            additive: true;
        }>;
        fire: Readonly<{
            color: 16347926;
            shape: 0;
            count: 14;
            speedMin: 2.5;
            speedMax: 7.5;
            sizeStart: 0.45;
            sizeEnd: 0.06;
            durationMin: 0.25;
            durationMax: 0.48;
            gravity: -4;
            drag: 2.8;
            stretch: 0.4;
            additive: true;
        }>;
        ice: Readonly<{
            color: 3718648;
            shape: 4;
            count: 12;
            speedMin: 3;
            speedMax: 8.5;
            sizeStart: 0.38;
            sizeEnd: 0.05;
            durationMin: 0.24;
            durationMax: 0.42;
            gravity: 10;
            drag: 3.2;
            stretch: 0.9;
            additive: true;
        }>;
        poison: Readonly<{
            color: 4906624;
            shape: 2;
            count: 10;
            speedMin: 1.5;
            speedMax: 4.5;
            sizeStart: 0.5;
            sizeEnd: 0.9;
            durationMin: 0.35;
            durationMax: 0.6;
            gravity: -2.5;
            drag: 3;
            stretch: 0;
            additive: false;
        }>;
        lightning: Readonly<{
            color: 6333946;
            shape: 1;
            count: 14;
            speedMin: 5;
            speedMax: 12;
            sizeStart: 0.34;
            sizeEnd: 0.03;
            durationMin: 0.14;
            durationMax: 0.26;
            gravity: 4;
            drag: 5;
            stretch: 1.4;
            additive: true;
        }>;
    }>;
    createVisualPrng: typeof createVisualPrng;
    packRgb24: typeof packRgb24;
    createHitstopClock: typeof createHitstopClock;
    createCameraShake: typeof createCameraShake;
    extractGlyphIndices: typeof extractGlyphIndices;
    DAMAGE_NUMBER_PRESETS: Readonly<{
        normal: Readonly<{
            color: 16777215;
            lifetime: 0.7;
            durationFadeIn: 0.14;
            durationFadeOut: 0.22;
            scaleFadeIn: readonly number[];
            offsetFadeIn: readonly number[];
            offsetFadeOut: readonly number[];
            lerp: Readonly<{
                minX: -0.45;
                maxX: 0.45;
                minY: 0.55;
                maxY: 1;
                speed: 6.5;
            }>;
            collision: Readonly<{
                radius: 0.45;
                pushFactor: 1;
            }>;
        }>;
        crit: Readonly<{
            color: 16436245;
            isCrit: true;
            scaleMultiplier: 1.38;
            lifetime: 0.92;
            durationFadeIn: 0.16;
            durationFadeOut: 0.24;
            scaleFadeIn: readonly number[];
            crossScaleFadeIn: readonly number[];
            offsetFadeIn: readonly number[];
            offsetFadeOut: readonly number[];
            lerp: Readonly<{
                minX: 0.3;
                maxX: 0.75;
                minY: 0.75;
                maxY: 1.25;
                speed: 5.5;
                randomFlip: true;
            }>;
            shake: Readonly<{
                offsetX: 0.04;
                offsetY: 0.04;
                frequency: 52;
            }>;
            startRotation: readonly number[];
            colorByNumber: Readonly<{
                fromNumber: 150;
                toNumber: 2500;
                fromColor: 16436245;
                toColor: 16726832;
            }>;
            scaleByNumber: Readonly<{
                fromNumber: 150;
                toNumber: 2500;
                fromScale: 1;
                toScale: 1.5;
            }>;
            collision: Readonly<{
                radius: 0.55;
                pushFactor: 1.15;
            }>;
        }>;
        heal: Readonly<{
            color: 4906624;
            isHeal: true;
            leftText: "+";
            lifetime: 0.85;
            durationFadeIn: 0.16;
            durationFadeOut: 0.26;
            scaleFadeIn: readonly number[];
            offsetFadeIn: readonly number[];
            lerp: Readonly<{
                minX: -0.25;
                maxX: 0.25;
                minY: 0.95;
                maxY: 1.35;
                speed: 3.8;
            }>;
        }>;
        miss: Readonly<{
            color: 9741240;
            isMiss: true;
            enableNumber: false;
            leftText: "MISS";
            lifetime: 0.65;
            durationFadeIn: 0.12;
            durationFadeOut: 0.2;
            scaleFadeIn: readonly number[];
            lerp: Readonly<{
                minX: 0.35;
                maxX: 0.65;
                minY: 0.35;
                maxY: 0.65;
                speed: 6;
                randomFlip: true;
            }>;
        }>;
        block: Readonly<{
            color: 6333946;
            enableNumber: false;
            leftText: "格挡";
            lifetime: 0.72;
            durationFadeIn: 0.12;
            durationFadeOut: 0.22;
            scaleFadeIn: readonly number[];
            shakeFadeIn: Readonly<{
                offsetX: 0.18;
                offsetY: 0;
                frequency: 28;
            }>;
            lerp: Readonly<{
                minX: -0.2;
                maxX: 0.2;
                minY: 0.55;
                maxY: 0.85;
                speed: 5;
            }>;
        }>;
        immune: Readonly<{
            color: 13358561;
            enableNumber: false;
            leftText: "免疫";
            lifetime: 0.7;
            durationFadeIn: 0.12;
            durationFadeOut: 0.22;
            scaleFadeIn: readonly number[];
            lerp: Readonly<{
                minX: -0.15;
                maxX: 0.15;
                minY: 0.6;
                maxY: 0.85;
                speed: 4.5;
            }>;
        }>;
        combo: Readonly<{
            color: 16486972;
            topText: "连击";
            topColor: 16707722;
            topScale: 0.68;
            scaleMultiplier: 1.22;
            lifetime: 1.05;
            durationFadeIn: 0.14;
            durationFadeOut: 0.25;
            scaleFadeIn: readonly number[];
            lerp: Readonly<{
                minX: -0.18;
                maxX: 0.18;
                minY: 0.75;
                maxY: 1;
                speed: 4;
            }>;
            combination: Readonly<{
                method: "absorbNew";
                maxDistance: 2.2;
                bonusLifetime: 0.45;
                spawnDelay: 0.05;
                absorbDuration: 0.22;
                moveToAbsorber: true;
                instantGain: false;
                absorberScaleFactor: 1.42;
                absorberScaleFade: 12;
            }>;
            colorByNumber: Readonly<{
                fromNumber: 100;
                toNumber: 5000;
                fromColor: 16486972;
                toColor: 15680580;
            }>;
            scaleByNumber: Readonly<{
                fromNumber: 100;
                toNumber: 5000;
                fromScale: 1;
                toScale: 1.45;
            }>;
        }>;
        fire: Readonly<{
            color: 16347926;
            lifetime: 0.75;
            durationFadeIn: 0.1;
            durationFadeOut: 0.22;
            velocity: Readonly<{
                minX: 0.45;
                maxX: 1.15;
                minY: 2.4;
                maxY: 3.4;
                randomFlip: true;
                dragX: 0.4;
                dragY: 0.8;
                gravity: 5.5;
            }>;
            shake: Readonly<{
                offsetX: 0.025;
                offsetY: 0.025;
                frequency: 44;
            }>;
        }>;
        ice: Readonly<{
            color: 3718648;
            lifetime: 0.78;
            durationFadeIn: 0.12;
            durationFadeOut: 0.22;
            scaleFadeIn: readonly number[];
            lerp: Readonly<{
                minX: 0.35;
                maxX: 0.75;
                minY: 0.5;
                maxY: 0.9;
                speed: 5.2;
                randomFlip: true;
            }>;
        }>;
        lightning: Readonly<{
            color: 10875900;
            lifetime: 0.7;
            durationFadeIn: 0.08;
            durationFadeOut: 0.18;
            scaleFadeIn: readonly number[];
            shake: Readonly<{
                offsetX: 0.055;
                offsetY: 0.035;
                frequency: 65;
            }>;
            lerp: Readonly<{
                minX: -0.5;
                maxX: 0.5;
                minY: 0.65;
                maxY: 1.15;
                speed: 7.5;
            }>;
        }>;
        poison: Readonly<{
            color: 8702998;
            scaleMultiplier: 0.88;
            lifetime: 0.88;
            durationFadeIn: 0.15;
            durationFadeOut: 0.28;
            lerp: Readonly<{
                minX: -0.25;
                maxX: 0.25;
                minY: 0.85;
                maxY: 1.25;
                speed: 2.8;
            }>;
        }>;
        gold: Readonly<{
            color: 16498468;
            leftText: "+";
            rightText: "G";
            digits: Readonly<{
                suffixShorten: true;
            }>;
            lifetime: 0.95;
            durationFadeIn: 0.14;
            durationFadeOut: 0.25;
            lerp: Readonly<{
                minX: -0.2;
                maxX: 0.2;
                minY: 0.9;
                maxY: 1.25;
                speed: 4;
            }>;
        }>;
        xp: Readonly<{
            color: 12616956;
            leftText: "+";
            rightText: "XP";
            digits: Readonly<{
                suffixShorten: true;
            }>;
            lifetime: 0.95;
            durationFadeIn: 0.14;
            durationFadeOut: 0.25;
            lerp: Readonly<{
                minX: -0.2;
                maxX: 0.2;
                minY: 0.9;
                maxY: 1.25;
                speed: 4;
            }>;
        }>;
    }>;
    registerDamagePreset: typeof registerDamagePreset;
    getDamagePreset: typeof getDamagePreset;
    formatDamageValue: typeof formatDamageValue;
    packCrowdAnimStatus: typeof packCrowdAnimStatus;
    unpackCrowdAnimStatus: typeof unpackCrowdAnimStatus;
    createVfxSystem: typeof createVfxSystem;
    VFX_RENDER_MODE: Readonly<{
        BILLBOARD: 0;
        HORIZONTAL: 1;
        STRETCHED: 2;
        MESH: 3;
        VERTICAL: 4;
    }>;
    PROCEDURAL_VFX_ATLAS_REGIONS: Readonly<{
        glow: readonly number[];
        spark: readonly number[];
        ring: readonly number[];
        wave: readonly number[];
        smoke: readonly number[];
        shard: readonly number[];
        rune_ring: readonly number[];
        trail: readonly number[];
        fireball_flipbook: readonly number[];
        shield_hex: readonly number[];
        snowflake: readonly number[];
    }>;
    createProceduralVfxAtlas: typeof createProceduralVfxAtlas;
    validateVfxRecipe: typeof validateVfxRecipe;
    Component: typeof Component;
    Entity: typeof Entity;
    Scene: typeof Scene;
    SceneManager: typeof SceneManager;
    PrefabRegistry: typeof PrefabRegistry;
    STANDARD_ART_SPEC: Readonly<{
        unitScale: "1 unit = 1 meter (3D), 1 px = logical design unit (2D)";
        groundPivot: "bottom-center";
        actor2dBackground: "#FFFFFF";
        actor2dShadowFree: true;
        character3dMaxVertices: 3000;
        character3dHandPose: "semi-clenched-grip";
        toneMapping: "ueFilmic";
    }>;
    TOPDOWN_LIGHTING_PRESET: Readonly<{
        cameraFov: 42;
        cameraPosition: readonly number[];
        cameraTarget: readonly number[];
        background: "#0c111b";
        hemisphere: Readonly<{
            sky: "#b6d0f2";
            ground: "#171f2e";
            intensity: 0.38;
        }>;
        sun: Readonly<{
            color: "#fff5e6";
            intensity: 2.45;
            position: readonly number[];
            shadow: Readonly<{
                extent: 32;
                near: 1;
                far: 105;
                mapSize: 1024;
                bias: -0.00025;
                normalBias: 0.035;
                adaptiveExtent: true;
            }>;
        }>;
        fill: Readonly<{
            color: "#6d8ec4";
            intensity: 0.24;
            position: readonly number[];
        }>;
    }>;
    TOPDOWN_CAMERA_PRESET: Readonly<{
        fov: 42;
        height: 25;
        zOffset: 17.5;
        armLength: 30.5;
        minArmLength: 12;
        lookY: 0.5;
        lookZOffset: -0.4;
        pitch: number;
        yaw: 0;
        lagHalfLife: 0.1;
    }>;
    ART_THEMES: Record<string, import("./kit/art-themes.js").ArtThemePreset>;
    listArtThemes: typeof listArtThemes;
    getArtTheme: typeof getArtTheme;
    resolvePresentationPreset: typeof resolvePresentationPreset;
    GAME_AUDIO_EVENTS: Readonly<{
        ATTACK: "attack";
        HIT: "hit";
        CRIT: "crit";
        KILL: "kill";
        DASH: "dash";
        HURT: "hurt";
        PICKUP: "pickup";
        LEVEL_UP: "levelup";
        WAVE_START: "waveStart";
        BOSS_SPAWN: "bossSpawn";
        VICTORY: "victory";
        DEFEAT: "defeat";
        INTERACT: "interact";
        UI_HOVER: "uiHover";
        UI_PRESS: "uiPress";
        UI_CONFIRM: "uiConfirm";
        UI_CANCEL: "uiCancel";
        UI_OPEN: "uiOpen";
        UI_CLOSE: "uiClose";
        UI_REWARD: "uiReward";
        UI_ERROR: "uiError";
    }>;
    DEFAULT_AUDIO_MATRIX: Readonly<{
        attack: Readonly<{
            preset: "slash";
            volume: 0.42;
            pitchJitter: 0.08;
            cooldownMs: 55;
        }>;
        hit: Readonly<{
            preset: "hit";
            volume: 0.38;
            pitchJitter: 0.12;
            cooldownMs: 45;
        }>;
        crit: Readonly<{
            preset: "explosion";
            volume: 0.48;
            pitchJitter: 0.08;
            cooldownMs: 90;
        }>;
        kill: Readonly<{
            preset: "pickup";
            volume: 0.36;
            pitchJitter: 0.14;
            cooldownMs: 55;
        }>;
        dash: Readonly<{
            preset: "laser";
            volume: 0.38;
            pitchJitter: 0.06;
            cooldownMs: 120;
        }>;
        hurt: Readonly<{
            preset: "hurt";
            volume: 0.56;
            pitchJitter: 0.04;
            cooldownMs: 140;
        }>;
        pickup: Readonly<{
            preset: "pickup";
            volume: 0.32;
            pitchJitter: 0.15;
            cooldownMs: 40;
        }>;
        levelup: Readonly<{
            preset: "powerup";
            volume: 0.58;
            pitchJitter: 0.02;
            cooldownMs: 250;
        }>;
        waveStart: Readonly<{
            preset: "powerup";
            volume: 0.45;
            pitchJitter: 0.02;
            cooldownMs: 300;
        }>;
        bossSpawn: Readonly<{
            preset: "explosion";
            volume: 0.65;
            pitchJitter: 0.02;
            cooldownMs: 500;
        }>;
        victory: Readonly<{
            preset: "powerup";
            volume: 0.64;
            pitchJitter: 0;
            cooldownMs: 300;
        }>;
        defeat: Readonly<{
            preset: "hurt";
            volume: 0.62;
            pitchJitter: 0;
            cooldownMs: 300;
        }>;
        interact: Readonly<{
            preset: "click";
            volume: 0.36;
            pitchJitter: 0.04;
            cooldownMs: 60;
        }>;
        uiHover: Readonly<{
            preset: "click";
            volume: 0.12;
            pitchJitter: 0.05;
            cooldownMs: 45;
        }>;
        uiPress: Readonly<{
            preset: "click";
            volume: 0.22;
            pitchJitter: 0.04;
            cooldownMs: 30;
        }>;
        uiConfirm: Readonly<{
            preset: "pickup";
            volume: 0.28;
            pitchJitter: 0.03;
            cooldownMs: 60;
        }>;
        uiCancel: Readonly<{
            preset: "hit";
            volume: 0.22;
            pitchJitter: 0.03;
            cooldownMs: 60;
        }>;
        uiOpen: Readonly<{
            preset: "pickup";
            volume: 0.24;
            pitchJitter: 0.03;
            cooldownMs: 80;
        }>;
        uiClose: Readonly<{
            preset: "click";
            volume: 0.2;
            pitchJitter: 0.03;
            cooldownMs: 80;
        }>;
        uiReward: Readonly<{
            preset: "powerup";
            volume: 0.34;
            pitchJitter: 0.02;
            cooldownMs: 120;
        }>;
        uiError: Readonly<{
            preset: "hurt";
            volume: 0.25;
            pitchJitter: 0.02;
            cooldownMs: 120;
        }>;
    }>;
    AUDIO_PROFILES: Readonly<{
        action: Readonly<{
            bgmVolume: 0.36;
            baseIntensity: 0.55;
            combatIntensity: 0.78;
        }>;
        arcade: Readonly<{
            bgmVolume: 0.38;
            baseIntensity: 0.62;
            combatIntensity: 0.85;
        }>;
        tactical: Readonly<{
            bgmVolume: 0.3;
            baseIntensity: 0.38;
            combatIntensity: 0.65;
        }>;
        cozy: Readonly<{
            bgmVolume: 0.32;
            baseIntensity: 0.28;
            combatIntensity: 0.48;
        }>;
    }>;
    createAudioDirector: typeof createAudioDirector;
    GENRE_ARCHETYPES: Readonly<{
        'action-2d': Readonly<{
            id: "action-2d";
            perspective: "2d";
            preset: "2d";
            renderer: "webgl2d";
            tickHz: 60;
            defaultTheme: "scifi";
            audioProfile: "action";
            feel: Readonly<{
                playerSpeed: 6.5;
                playerRadius: 0.45;
                dashSpeed: 16;
                dashCooldownSec: 1.4;
                hitStopMs: 36;
                traumaMax: 0.55;
            }>;
            balance: Readonly<{
                playerHp: 100;
                gruntHp: 30;
                gruntDamage: 12;
                weaponDps: 28;
                arenaSpan: 48;
                waveDurationSec: 60;
                maxUpgrades: 5;
            }>;
            ui: Readonly<{
                hudMetrics: string[];
                hudBars: string[];
                maxTitleButtons: 1;
                maxInGameButtons: 1;
                maxResultButtons: 2;
                cardChoices: 3;
                hudMaxAreaRatio: 0.1;
            }>;
        }>;
        'horde-2d': Readonly<{
            id: "horde-2d";
            perspective: "2d";
            preset: "horde";
            renderer: "webgl2d";
            tickHz: 60;
            defaultTheme: "cyber";
            audioProfile: "arcade";
            feel: Readonly<{
                playerSpeed: 7.2;
                playerRadius: 0.45;
                dashSpeed: 18;
                dashCooldownSec: 1.2;
                hitStopMs: 24;
                traumaMax: 0.5;
            }>;
            balance: Readonly<{
                playerHp: 120;
                gruntHp: 20;
                gruntDamage: 10;
                weaponDps: 36;
                arenaSpan: 64;
                waveDurationSec: 60;
                maxUpgrades: 5;
            }>;
            ui: Readonly<{
                hudMetrics: string[];
                hudBars: string[];
                maxTitleButtons: 1;
                maxInGameButtons: 1;
                maxResultButtons: 2;
                cardChoices: 3;
                hudMaxAreaRatio: 0.1;
            }>;
        }>;
        'arena-3d': Readonly<{
            id: "arena-3d";
            perspective: "3d";
            preset: "3d";
            renderer: "threejs";
            tickHz: 60;
            defaultTheme: "arcane";
            audioProfile: "action";
            feel: Readonly<{
                playerSpeed: 7;
                playerRadius: 0.5;
                dashSpeed: 16;
                dashCooldownSec: 1.5;
                hitStopMs: 42;
                traumaMax: 0.6;
            }>;
            balance: Readonly<{
                playerHp: 100;
                gruntHp: 40;
                gruntDamage: 15;
                weaponDps: 32;
                arenaSpan: 52;
                waveDurationSec: 60;
                maxUpgrades: 5;
            }>;
            ui: Readonly<{
                hudMetrics: string[];
                hudBars: string[];
                maxTitleButtons: 1;
                maxInGameButtons: 1;
                maxResultButtons: 2;
                cardChoices: 3;
                hudMaxAreaRatio: 0.1;
            }>;
        }>;
        'card-ui': Readonly<{
            id: "card-ui";
            perspective: "ui";
            preset: "ui";
            renderer: "dom";
            tickHz: 0;
            defaultTheme: "arcane";
            audioProfile: "tactical";
            feel: Readonly<{
                playerSpeed: 0;
                playerRadius: 0.5;
                dashSpeed: 0;
                dashCooldownSec: 0;
                hitStopMs: 0;
                traumaMax: 0.2;
            }>;
            balance: Readonly<{
                playerHp: 40;
                gruntHp: 18;
                gruntDamage: 5;
                weaponDps: 10;
                arenaSpan: 0;
                waveDurationSec: 120;
                maxUpgrades: 5;
            }>;
            ui: Readonly<{
                hudMetrics: string[];
                hudBars: string[];
                maxTitleButtons: 1;
                maxInGameButtons: 1;
                maxResultButtons: 2;
                cardChoices: 3;
                hudMaxAreaRatio: 0.1;
            }>;
        }>;
    }>;
    listGenreArchetypes: typeof listGenreArchetypes;
    defineGameBlueprint: typeof defineGameBlueprint;
    evaluateBlueprintBalance: typeof evaluateBlueprintBalance;
    createBlueprintFromIdea: typeof createBlueprintFromIdea;
    createGameSession: typeof createGameSession;
    mountGameShell: typeof mountGameShell;
    REQUIRED_DESIGN_DOCS: readonly string[];
    renderGameDesignDocs: typeof renderGameDesignDocs;
    createAssetCatalog: typeof createAssetCatalog;
    createStreamingResidencyPolicy: typeof createStreamingResidencyPolicy;
    bindTextureMipStreaming: typeof bindTextureMipStreaming;
    createVramMipGuard: typeof createVramMipGuard;
    createProgressiveBootLoader: typeof createProgressiveBootLoader;
    createRemoteBundleLoader: typeof createRemoteBundleLoader;
    toCatalogLoader: typeof toCatalogLoader;
    createNetworkStateSync: typeof createNetworkStateSync;
    createSceneReplicator: typeof createSceneReplicator;
    createSpatialAoiFilter: typeof createSpatialAoiFilter;
    createWebRtcDataChannelTransport: typeof createWebRtcDataChannelTransport;
    createSpringBoneChain3D: typeof createSpringBoneChain3D;
    createInertialBlend3D: typeof createInertialBlend3D;
    createBoneMap3D: typeof createBoneMap3D;
    retargetClip3D: typeof retargetClip3D;
    createShadowAtlas3D: typeof createShadowAtlas3D;
    generateLightmapUV3D: typeof generateLightmapUV3D;
    createLightmapBaker3D: typeof createLightmapBaker3D;
    mergeStaticMeshesByMaterial3D: typeof mergeStaticMeshesByMaterial3D;
    GPU_HIZ_OCCLUSION_WGSL: "\nstruct HiZParams {\n  screenSize: vec2<f32>,\n  mipCount: u32,\n  objectCount: u32,\n};\n\n@group(0) @binding(0) var<uniform> uHiZ: HiZParams;\n@group(0) @binding(1) var<storage, read> bScreenAabbs: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read> bMinDepths: array<f32>;\n@group(0) @binding(3) var tHiZ: texture_2d<f32>;\n@group(0) @binding(4) var<storage, read_write> bVisibility: array<u32>;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uHiZ.objectCount) { return; }\n  let aabb = bScreenAabbs[idx];\n  let span = max((aabb.z - aabb.x) * uHiZ.screenSize.x, (aabb.w - aabb.y) * uHiZ.screenSize.y);\n  let mip = min(uHiZ.mipCount - 1u, u32(ceil(log2(max(1.0, span * 0.5)))));\n  let dim = vec2<i32>(max(vec2<f32>(1.0), floor(uHiZ.screenSize / f32(1u << mip))));\n  let fdim = vec2<f32>(dim);\n  let t0 = clamp(vec2<i32>(floor(aabb.xy * fdim)), vec2<i32>(0), dim - vec2<i32>(1));\n  let t1 = clamp(vec2<i32>(floor((aabb.zw - vec2<f32>(1e-4)) * fdim)), t0, dim - vec2<i32>(1));\n  let d00 = textureLoad(tHiZ, t0, i32(mip)).r;\n  let d10 = textureLoad(tHiZ, vec2<i32>(t1.x, t0.y), i32(mip)).r;\n  let d01 = textureLoad(tHiZ, vec2<i32>(t0.x, t1.y), i32(mip)).r;\n  let d11 = textureLoad(tHiZ, t1, i32(mip)).r;\n  let maxOccDepth = max(max(d00, d10), max(d01, d11));\n  bVisibility[idx] = select(0u, 1u, bMinDepths[idx] <= maxOccDepth + 1e-4);\n}\n";
    createHiZOcclusionCuller3D: typeof createHiZOcclusionCuller3D;
    dispatchWebGpuHiZOcclusion: typeof dispatchWebGpuHiZOcclusion;
    quantizeBufferGeometry3D: typeof quantizeBufferGeometry3D;
    MRT_OUTLINE_FRAGMENT_GLSL3: "\nuniform sampler2D tColor;\nuniform sampler2D tNormalId;\nuniform vec2 uTexelSize;\nuniform vec3 uOutlineColor;\nuniform float uOutlineThickness;\nuniform float uOutlineThreshold;\n\nin vec2 vUv;\nlayout(location = 0) out vec4 fragColor;\n\nvoid main() {\n  vec4 base = texture(tColor, vUv);\n  vec2 stepUv = uTexelSize * max(0.5, uOutlineThickness);\n\n  vec4 nTL = texture(tNormalId, vUv + vec2(-stepUv.x,  stepUv.y));\n  vec4 nTR = texture(tNormalId, vUv + vec2( stepUv.x,  stepUv.y));\n  vec4 nBL = texture(tNormalId, vUv + vec2(-stepUv.x, -stepUv.y));\n  vec4 nBR = texture(tNormalId, vUv + vec2( stepUv.x, -stepUv.y));\n\n  vec3 gx = (nTR.rgb + nBR.rgb) - (nTL.rgb + nBL.rgb);\n  vec3 gy = (nTL.rgb + nTR.rgb) - (nBL.rgb + nBR.rgb);\n  float normalEdge = length(gx) + length(gy);\n  float idEdge = abs(nTR.a - nBL.a) + abs(nTL.a - nBR.a);\n  float edge = clamp(smoothstep(uOutlineThreshold, uOutlineThreshold + 0.35, normalEdge + idEdge * 4.0), 0.0, 1.0);\n\n  fragColor = vec4(mix(base.rgb, uOutlineColor, edge * 0.88), base.a);\n}\n";
    createMrtOutlinePass3D: typeof createMrtOutlinePass3D;
    createPhysicalRenderTargetPool3D: typeof createPhysicalRenderTargetPool3D;
    captureResourceSnapshot: typeof captureResourceSnapshot;
    diffResourceSnapshots: typeof diffResourceSnapshots;
    createHotReloadController: typeof createHotReloadController;
    createSkeleton2D: typeof createSkeleton2D;
    createWorkerPhysicsWorld: typeof createWorkerPhysicsWorld;
}>;
import { createVersionedStore } from './platform/engine.js';
import { createSeededRng } from './sim/index.js';
import { createStateChecksum } from './sim/index.js';
import { hashState } from './sim/index.js';
import { runScripted } from './sim/index.js';
import { createSimulationWorkBudget } from './sim/index.js';
import { createSimWorkerRunner } from './sim/index.js';
import { measureHotLoopAllocations } from './sim/index.js';
import { defineInputContext } from './platform/engine.js';
import { createInputActionRouter } from './platform/engine.js';
import { createArcadeControls } from './platform/engine.js';
import { computeSplitScreenViews } from './platform/engine.js';
import { synthesizeSfxPcm } from './platform/engine.js';
import { createSynthSfx } from './platform/engine.js';
import { midiToHz } from './platform/engine.js';
import { generateBgmStep } from './platform/engine.js';
import { createProceduralBgm } from './platform/engine.js';
import { normalizeRedDotPath } from './ui/index.js';
import { splitRedDotAncestors } from './ui/index.js';
import { computeCommercialDayKey } from './ui/index.js';
import { formatRedDotBadge } from './ui/index.js';
import { createRedDotSystem } from './ui/index.js';
import { createPanelStack } from './ui/index.js';
import { applyAriaToElement } from './ui/index.js';
import { computeFlexLayout } from './ui/index.js';
import { createCanvasUiRenderer } from './ui/index.js';
import { renderSdfText } from './ui/index.js';
import { layoutRichTextLines } from './ui/index.js';
import { createCanvasAriaBridge } from './ui/index.js';
import { createLiveProfilerOverlay } from './ui/index.js';
import { computeThumbArcLayout } from './ui/index.js';
import { isInThumbComfortZone } from './ui/index.js';
import { createThumbArcHud } from './ui/index.js';
import { createVirtualList } from './ui/index.js';
import { createI18n } from './ui/index.js';
import { computeStaggerProgress } from './ui/index.js';
import { createUiSurfaceSpring } from './ui/index.js';
import { createUiMotionGroup } from './ui/index.js';
import { createUiDirector } from './ui/index.js';
import { createStateMachine } from './ai/index.js';
import { sequence } from './ai/index.js';
import { selector } from './ai/index.js';
import { parallel } from './ai/index.js';
import { inverter } from './ai/index.js';
import { repeater } from './ai/index.js';
import { cooldown } from './ai/index.js';
import { condition } from './ai/index.js';
import { action } from './ai/index.js';
import { wait } from './ai/index.js';
import { createBehaviorTree } from './ai/index.js';
import { createVisualPrng } from './vfx/index.js';
import { packRgb24 } from './vfx/index.js';
import { createHitstopClock } from './vfx/index.js';
import { createCameraShake } from './vfx/index.js';
import { extractGlyphIndices } from './vfx/index.js';
import { registerDamagePreset } from './vfx/index.js';
import { getDamagePreset } from './vfx/index.js';
import { formatDamageValue } from './vfx/index.js';
import { packCrowdAnimStatus } from './vfx/index.js';
import { unpackCrowdAnimStatus } from './vfx/index.js';
import { createProceduralVfxAtlas } from './vfx/index.js';
import { validateVfxRecipe } from './vfx/index.js';
import { listArtThemes } from './kit/index.js';
import { getArtTheme } from './kit/index.js';
import { resolvePresentationPreset } from './kit/index.js';
import { createAudioDirector } from './kit/index.js';
import { listGenreArchetypes } from './kit/index.js';
import { defineGameBlueprint } from './kit/index.js';
import { evaluateBlueprintBalance } from './kit/index.js';
import { createBlueprintFromIdea } from './kit/index.js';
import { createGameSession } from './kit/index.js';
import { mountGameShell } from './kit/index.js';
import { renderGameDesignDocs } from './kit/index.js';
import { createHiZOcclusionCuller3D } from './integrations/culling3d.js';
import { dispatchWebGpuHiZOcclusion } from './integrations/culling3d.js';
export { defineProject, resolveFeatureGraph, PROJECT_PROFILES, OPTIONAL_FEATURES, DETERMINISTIC_PHYSICS_BACKENDS } from "./core/config.js";
export { Scene, SceneManager, createHotReloadController } from "./core/scene.js";
export { normalizeGameplayTag, isValidGameplayTag, tagMatchesHierarchy, splitTagAncestors, createTagRegistry, GLOBAL_TAG_REGISTRY, createTagContainer, matchGameplayTags } from "./core/tags.js";
export { createGameEngine, PLATFORM_VERSION, GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION, createAssetLoader, createSaveStore, createVersionedStore, createInputManager, defineInputContext, createInputActionRouter, ARCADE_SLOTS, PLAYER_KEYMAPS, createArcadeControls, computeSplitScreenViews, createAudioManager, analyzeAudioBuffer, normalizeVariantSet, SYNTH_PRESETS, synthesizeSfxPcm, createSynthSfx, BGM_MOODS, midiToHz, generateBgmStep, createProceduralBgm, createDiagnostics, createGameBridge, createGameHostBridge } from "./platform/engine.js";
export { createAssetCatalog, createStreamingResidencyPolicy, bindTextureMipStreaming, createVramMipGuard, createProgressiveBootLoader } from "./platform/asset-catalog.js";
export { createRemoteBundleLoader, toCatalogLoader } from "./platform/remote-bundle.js";
export { EASING, TweenManager, LN2_CRIT, damp, dampAngle, stepSpring1D, SpringDamper1D, SpringDamper2D, SpringDamper3D } from "./time/tween.js";
export { generateLightmapUV3D, createLightmapBaker3D } from "./integrations/lightmap-bake3d.js";
export { mergeStaticMeshesByMaterial3D, GPU_HIZ_OCCLUSION_WGSL, createHiZOcclusionCuller3D, dispatchWebGpuHiZOcclusion, quantizeBufferGeometry3D } from "./integrations/culling3d.js";
export { captureResourceSnapshot, diffResourceSnapshots } from "./integrations/quality3d/render-diagnostics.js";
export { MRT_OUTLINE_FRAGMENT_GLSL3, createMrtOutlinePass3D } from "./integrations/post3d/mrt-outline.js";
export { TileMap, findGridPath, createGridPathWork, applyAutoTileRules } from "./world/tilemap.js";
export { ObjectPool, SpatialHash2D } from "./world/spatial2d.js";
export { SWARM_UNIT_FLAGS, ECS_SLOT_FLAGS, FlatSpatialHash2D, createFlatSpatialHash2D, FlowField2D, createFlowField2D, FlatCombatECS, createSwarmSimulation } from "./world/swarm-ecs.js";
export { fbmNoise2D, createHeightfieldTerrain3D } from "./world/terrain3d.js";
export { createWorldPartition, createHLODProxyGroup3D, createFloatingOrigin } from "./world/open-world.js";
export { FOG_FADE_TYPE, FOG_QUALITY, TOPDOWN_FOG_DEFAULTS, extractTileMapObstacles, createFogOfWarWorld } from "./world/fog-of-war.js";
export { SURFACE_TYPES, DEFAULT_SURFACE_FEEDBACK_TABLE, createSurfaceFeedbackRouter } from "./world/surface-feedback.js";
export { ATMOSPHERE_PRESETS_CN, createAtmosphere3D } from "./world/atmosphere3d.js";
export { QUALITY3D_PROFILES, resolveQuality3DProfile } from "./integrations/quality3d.js";
export { createRealisticWater3D, createRealisticGlassMaterial3D } from "./integrations/water3d.js";
export { createStateMachine, BT_STATUS, sequence, selector, parallel, inverter, repeater, cooldown, condition, action, wait, createBehaviorTree } from "./ai/index.js";
export { COLOR_LUT_PRESETS, createColorLutTexture3D } from "./integrations/post3d/color.js";
export { KTX2_MAGIC, detectCompressedTextureSupport, parseKtx2Header, selectOptimalTextureVariant, createCompressedTextureFromMipData } from "./integrations/ktx2.js";
export { createSeededRng, createStateChecksum, hashState, runScripted, createSimulationWorkBudget, createSimWorkerRunner, measureHotLoopAllocations } from "./sim/index.js";
export { RENDER_RESOURCE_TYPES_2D, createRenderBudgetController } from "./integrations/render-budget-2d.js";
export { TOPDOWN_CAMERA_PRESET, createSpringArmRayProbe, cameraRelativeMove } from "./integrations/camera3d.js";
export { RED_DOT_STYLES, normalizeRedDotPath, splitRedDotAncestors, computeCommercialDayKey, formatRedDotBadge, createRedDotSystem, createPanelStack, applyAriaToElement, computeFlexLayout, createCanvasUiRenderer, renderSdfText, layoutRichTextLines, createCanvasAriaBridge, createLiveProfilerOverlay, DEFAULT_THUMB_ARC_SPEC, computeThumbArcLayout, isInThumbComfortZone, createThumbArcHud, createVirtualList, createI18n, computeStaggerProgress, createUiSurfaceSpring, createUiMotionGroup, UI_PHASES, UI_UX_CUES, createUiDirector } from "./ui/index.js";
export { createNetworkStateSync, createSceneReplicator, createSpatialAoiFilter } from "./lockstep/state-sync.js";
export { createSpringBoneChain3D, createInertialBlend3D } from "./animation/animator3d.js";
export { createBoneMap3D, retargetClip3D } from "./animation/retarget3d.js";
export { VFX_EASING, VFX_RENDER_ORDERS, VFX_SHAPE, TELEGRAPH_SHAPE, CROWD_STATUS, VFX_PRESETS, createVisualPrng, packRgb24, unpackRgb24Into, markAttributeRangeDirty, submitRingBufferRanges, createHitstopClock, createCameraShake, createStatelessParticlePool, createTrailsSystem, createTelegraphSystem, extractGlyphIndices, createFloatingTextPool, DAMAGE_NUMBER_PRESETS, registerDamagePreset, getDamagePreset, formatDamageValue, packCrowdAnimStatus, unpackCrowdAnimStatus, createScreenFeedbackPass, createVfxSystem, VFX_RENDER_MODE, PROCEDURAL_VFX_ATLAS_REGIONS, createProceduralVfxAtlas, createAtlasParticlePool, createMeshVfxPool, validateVfxRecipe, createEffectPlayer } from "./vfx/index.js";
export { STANDARD_ART_SPEC, TOPDOWN_LIGHTING_PRESET, ART_THEMES, listArtThemes, getArtTheme, resolvePresentationPreset, GAME_AUDIO_EVENTS, DEFAULT_AUDIO_MATRIX, AUDIO_PROFILES, createAudioDirector, GENRE_ARCHETYPES, listGenreArchetypes, defineGameBlueprint, evaluateBlueprintBalance, createBlueprintFromIdea, createGameSession, mountGameShell, REQUIRED_DESIGN_DOCS, renderGameDesignDocs } from "./kit/index.js";

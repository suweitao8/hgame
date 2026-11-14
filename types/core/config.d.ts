/**
 * Validate a project recipe and return the normalized, frozen config.
 * Throws on unknown fields, incompatible renderer/physics/feature combinations.
 * @param {ProjectOptions} [options]
 * @returns {Readonly<ProjectConfig>}
 */
export function defineProject(options?: ProjectOptions): Readonly<ProjectConfig>;
/** Topological ordering of only the explicitly requested features + dependencies. */
/**
 * @param {readonly string[]} requested Feature names.
 * @param {FeatureCatalog} catalog
 * @returns {string[]} Dependencies-first order.
 */
export function resolveFeatureGraph(requested: readonly string[], catalog: FeatureCatalog): string[];
/** @type {readonly ProjectProfile[]} */
export const PROJECT_PROFILES: readonly ProjectProfile[];
/** @type {readonly ('rapier2d' | 'rapier3d')[]} */
export const DETERMINISTIC_PHYSICS_BACKENDS: readonly ("rapier2d" | "rapier3d")[];
/** @type {readonly FeatureName[]} */
export const OPTIONAL_FEATURES: readonly FeatureName[];
export type ProjectProfile = "2d" | "3d" | "ui";
export type ProjectRenderer = "canvas2d" | "webgl2d" | "threejs" | "dom";
export type PhysicsBackend = "none" | "rapier2d" | "rapier3d";
export type FeatureName = "scene" | "input" | "assets" | "audio" | "save" | "diagnostics" | "physics2d" | "animation2d" | "tilemap2d" | "pathfinding2d" | "physics3d" | "model3d" | "adaptiveQuality3d";
/**
 * Project recipe accepted by {@link defineProject}.
 */
export type ProjectOptions = {
    /**
     * Only version 1 exists.
     */
    configVersion?: 1;
    profile?: ProjectProfile;
    /**
     * Default depends on profile (`canvas2d` / `threejs` / `dom`).
     */
    renderer?: ProjectRenderer;
    /**
     * Deterministic backend; must match the physics feature.
     */
    physics?: PhysicsBackend;
    /**
     * Fixed ticks per second, integer 1..240 (`0` only for the `ui` profile, default 60 / 0).
     */
    tickHz?: number;
    /**
     * Optional modules to load (default `['scene','input']`, `['scene']` for ui).
     */
    features?: readonly FeatureName[];
};
/**
 * Normalized, frozen project configuration.
 */
export type ProjectConfig = {
    configVersion: 1;
    profile: ProjectProfile;
    renderer: ProjectRenderer;
    physics: PhysicsBackend;
    /**
     * Fixed ticks per second (0 = no fixed loop).
     */
    tickHz: number;
    /**
     * De-duplicated feature list.
     */
    features: readonly FeatureName[];
};
/**
 * Feature name -> dependency declaration used by {@link resolveFeatureGraph}.
 */
export type FeatureCatalog = Readonly<Record<string, {
    depends?: readonly string[];
}>>;

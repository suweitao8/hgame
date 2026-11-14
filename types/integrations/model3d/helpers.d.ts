/**
 * Strips a `ns|` or `ns:` namespace prefix from a node name.
 * @param {string} name Node name.
 * @returns {string} Name without namespace (`''` for non-strings).
 */
export function stripNodeNamespace(name: string): string;
/**
 * Splits a track name into node and property parts.
 * @param {string} trackName Track name such as `Hips.position`.
 * @returns {{nodePart: string, propPart: string, propName: string}} Parsed parts.
 */
export function parseTrackName(trackName: string): {
    nodePart: string;
    propPart: string;
    propName: string;
};
/**
 * Builds a lowercase set of namespace-stripped root bone names.
 * @param {string[]|null|undefined} rootBoneNames Names; defaults are used when empty.
 * @returns {Set<string>} Normalized names.
 */
export function makeRootBoneSet(rootBoneNames: string[] | null | undefined): Set<string>;
/**
 * Tests whether a track is a root-bone position track.
 * @param {string} trackName Track name.
 * @param {Set<string>} rootBoneSet Set from {@link makeRootBoneSet}.
 * @returns {boolean} True for root position tracks.
 */
export function isRootPositionTrack(trackName: string, rootBoneSet: Set<string>): boolean;
/**
 * Validates a safe relative project asset path and optionally resolves it against a base URL.
 * @param {string} rawUrl Relative path (no scheme, backslash, leading slash, or traversal).
 * @param {string|URL|null} [projectBaseUrl=null] Base URL used for `resolved`.
 * @returns {{key: string, resolved: string}} Normalized key and resolved URL/path.
 */
export function resolveRelativeAssetPath(rawUrl: string, projectBaseUrl?: string | URL | null): {
    key: string;
    resolved: string;
};
/**
 * Maps each node of a hierarchy to the structurally identical node of another hierarchy.
 * @param {Model3DObject} source Source root.
 * @param {Model3DObject} target Target root.
 * @param {Map<Model3DObject, Model3DObject>} [map] Map to fill.
 * @returns {Map<Model3DObject, Model3DObject>} The filled map.
 */
export function buildLockstepNodeMap(source: Model3DObject, target: Model3DObject, map?: Map<Model3DObject, Model3DObject>): Map<Model3DObject, Model3DObject>;
/**
 * Dependency-injected deep clone of a Three.js Object3D hierarchy that rebinds
 * SkinnedMesh instances to cloned Skeleton bone nodes so animations remain isolated.
 * @param {Model3DThree} THREE Three.js namespace (uses `Skeleton` when available).
 * @param {Model3DObject} source Object to clone.
 * @returns {Model3DObject} Cloned hierarchy.
 */
export function cloneObject3DWithSkins(THREE: Model3DThree, source: Model3DObject): Model3DObject;
/**
 * Computes world-space bounds for an object hierarchy.
 * @param {Model3DThree} THREE Three.js namespace (uses `Box3` / `Vector3`).
 * @param {Model3DObject} root Root object.
 * @returns {Model3DBounds} Bounds (all zeros when empty).
 */
export function computeRootBounds(THREE: Model3DThree, root: Model3DObject): Model3DBounds;
/**
 * Extracts structured geometry, skeleton, and clip metadata so AI-driven game code
 * can inspect bounds, bone names, clip durations, and root-motion presence offline.
 * @param {Model3DThree} THREE Three.js namespace.
 * @param {Model3DAsset|Model3DObject} assetOrRoot Loaded asset (`scene` + `animations`) or root object.
 * @param {Model3DClip[]|null} [explicitAnimations=null] Clips overriding the asset's animations.
 * @returns {Model3DInspection} Inspection summary.
 */
export function inspectModel3D(THREE: Model3DThree, assetOrRoot: Model3DAsset | Model3DObject, explicitAnimations?: Model3DClip[] | null): Model3DInspection;
/**
 * Clones and normalizes external skeletal AnimationClips (e.g. Unreal GLB exports),
 * stripping namespace prefixes, renaming bones, and optionally locking root motion.
 * @param {Model3DThree} THREE Three.js namespace (uses `AnimationClip` when available).
 * @param {Model3DClip[]} clips Source clips.
 * @param {PrepareAnimationClipsOptions} [options] Preparation options.
 * @returns {Model3DClip[]} New clips; sources are not mutated.
 */
export function prepareAnimationClips(THREE: Model3DThree, clips: Model3DClip[], { stripNamespace, stripRootMotion, rootBoneNames, renameMap, }?: PrepareAnimationClipsOptions): Model3DClip[];
/**
 * Disposes geometries, materials, and material textures under a root.
 * @param {Model3DObject|null|undefined} root Root object.
 * @returns {void}
 */
export function disposeObjectResources(root: Model3DObject | null | undefined): void;
/**
 * Loads a URL with a promise- or callback-style loader.
 * @param {Model3DLoader} loader Loader.
 * @param {string} resolvedUrl URL to load.
 * @returns {Promise<unknown>} Loader result.
 */
export function loadWithLoader(loader: Model3DLoader, resolvedUrl: string): Promise<unknown>;
/** Model3D shared helpers (clone, inspect, clip preparation). */
/**
 * Minimal structural view of a Three.js Object3D (or Mesh/Bone/SkinnedMesh) used by the model3d helpers.
 * Additional Three.js members are reachable through the index signature.
 * @typedef {object} Model3DObject
 * @property {string} [name] Node name.
 * @property {string} [type] Three.js type string (e.g. `'Bone'`).
 * @property {Model3DObject[]} [children] Child nodes.
 * @property {(callback: (node: Model3DObject) => void) => void} [traverse] Depth-first visitor.
 * @property {(recursive?: boolean) => Model3DObject} [clone] Deep/shallow clone.
 * @property {(force?: boolean) => void} [updateMatrixWorld] Refresh world matrices.
 * @property {boolean} [isMesh] True for meshes.
 * @property {boolean} [isSkinnedMesh] True for skinned meshes.
 * @property {boolean} [isBone] True for bones.
 * @property {boolean} [visible] Visibility flag.
 * @property {{x: number, y: number, z: number}} [position] Local position.
 */
/**
 * Minimal structural view of a loaded asset (e.g. a GLTF result).
 * @typedef {object} Model3DAsset
 * @property {Model3DObject} [scene] Root scene graph.
 * @property {Model3DClip[]} [animations] Animation clips.
 */
/**
 * Minimal structural view of a Three.js keyframe track.
 * @typedef {object} Model3DTrack
 * @property {string} name Track name (`node.property`).
 * @property {ArrayLike<number>} [values] Keyframe values.
 * @property {() => Model3DTrack} [clone] Clone the track.
 */
/**
 * Minimal structural view of a Three.js AnimationClip.
 * @typedef {object} Model3DClip
 * @property {string} [name] Clip name.
 * @property {number} [duration] Clip duration in seconds.
 * @property {Model3DTrack[]} [tracks] Keyframe tracks.
 * @property {number} [blendMode] Three.js blend mode constant.
 */
/**
 * Three.js namespace subset used by model3d (constructors such as `Box3`, `Vector3`, `Skeleton`,
 * `AnimationClip`, `AnimationMixer`, `DataTexture`, `InstancedMesh`). Only the constructors a call needs
 * must be present.
 * @typedef {{ [constructorName: string]: unknown }} Model3DThree
 */
/**
 * Axis-aligned bounds with plain vector members (world units).
 * @typedef {object} Model3DBounds
 * @property {{x: number, y: number, z: number}} min Minimum corner.
 * @property {{x: number, y: number, z: number}} max Maximum corner.
 * @property {{x: number, y: number, z: number}} size Extents (max - min).
 * @property {{x: number, y: number, z: number}} center Box center.
 */
/**
 * Summary of one animation clip.
 * @typedef {object} Model3DClipInfo
 * @property {string} name Clip name (`''` when missing).
 * @property {number} duration Duration in seconds (0 when unknown).
 * @property {number} trackCount Number of tracks.
 * @property {boolean} hasRootMotion True when a root/pelvis/hips/armature position track exists.
 */
/**
 * Result of {@link inspectModel3D}.
 * @typedef {object} Model3DInspection
 * @property {Model3DBounds} bounds World-space bounds of the model.
 * @property {string[]} boneNames Unique bone names in traversal order.
 * @property {number} meshCount Number of meshes.
 * @property {number} skinnedMeshCount Number of skinned meshes.
 * @property {Model3DClipInfo[]} clips Clip summaries.
 */
/**
 * Options for {@link prepareAnimationClips}.
 * @typedef {object} PrepareAnimationClipsOptions
 * @property {boolean} [stripNamespace=true] Strip `ns|` / `ns:` prefixes from track node names.
 * @property {boolean|'xz'|'xyz'} [stripRootMotion=false] Lock root position tracks (`true`/`'xz'` lock X/Z, `'xyz'` also locks Y).
 * @property {string[]} [rootBoneNames] Root bone names (case-insensitive). Defaults to root, pelvis, hips, armature.
 * @property {Record<string, string>|null} [renameMap=null] Node name remapping applied to track names.
 */
/**
 * Minimal GLTF-loader contract: either `loadAsync(url)` or callback-style `load(...)`.
 * @typedef {object} Model3DLoader
 * @property {(url: string) => Promise<unknown>} [loadAsync] Promise loader.
 * @property {(url: string, onLoad: (result: unknown) => void, onProgress?: ((event: unknown) => void) | undefined, onError?: (error: unknown) => void) => void} [load] Callback loader.
 */
/** Shared scratch 4x4 matrix buffer. */
export const SCRATCH_WORLD_MAT: Float64Array;
export const FORBIDDEN_SCHEME_RE: RegExp;
export const DEFAULT_ROOT_BONE_NAMES: readonly string[];
/**
 * Minimal structural view of a Three.js Object3D (or Mesh/Bone/SkinnedMesh) used by the model3d helpers.
 * Additional Three.js members are reachable through the index signature.
 */
export type Model3DObject = {
    /**
     * Node name.
     */
    name?: string;
    /**
     * Three.js type string (e.g. `'Bone'`).
     */
    type?: string;
    /**
     * Child nodes.
     */
    children?: Model3DObject[];
    /**
     * Depth-first visitor.
     */
    traverse?: (callback: (node: Model3DObject) => void) => void;
    /**
     * Deep/shallow clone.
     */
    clone?: (recursive?: boolean) => Model3DObject;
    /**
     * Refresh world matrices.
     */
    updateMatrixWorld?: (force?: boolean) => void;
    /**
     * True for meshes.
     */
    isMesh?: boolean;
    /**
     * True for skinned meshes.
     */
    isSkinnedMesh?: boolean;
    /**
     * True for bones.
     */
    isBone?: boolean;
    /**
     * Visibility flag.
     */
    visible?: boolean;
    /**
     * Local position.
     */
    position?: {
        x: number;
        y: number;
        z: number;
    };
};
/**
 * Minimal structural view of a loaded asset (e.g. a GLTF result).
 */
export type Model3DAsset = {
    /**
     * Root scene graph.
     */
    scene?: Model3DObject;
    /**
     * Animation clips.
     */
    animations?: Model3DClip[];
};
/**
 * Minimal structural view of a Three.js keyframe track.
 */
export type Model3DTrack = {
    /**
     * Track name (`node.property`).
     */
    name: string;
    /**
     * Keyframe values.
     */
    values?: ArrayLike<number>;
    /**
     * Clone the track.
     */
    clone?: () => Model3DTrack;
};
/**
 * Minimal structural view of a Three.js AnimationClip.
 */
export type Model3DClip = {
    /**
     * Clip name.
     */
    name?: string;
    /**
     * Clip duration in seconds.
     */
    duration?: number;
    /**
     * Keyframe tracks.
     */
    tracks?: Model3DTrack[];
    /**
     * Three.js blend mode constant.
     */
    blendMode?: number;
};
/**
 * Three.js namespace subset used by model3d (constructors such as `Box3`, `Vector3`, `Skeleton`,
 * `AnimationClip`, `AnimationMixer`, `DataTexture`, `InstancedMesh`). Only the constructors a call needs
 * must be present.
 */
export type Model3DThree = {
    [constructorName: string]: unknown;
};
/**
 * Axis-aligned bounds with plain vector members (world units).
 */
export type Model3DBounds = {
    /**
     * Minimum corner.
     */
    min: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Maximum corner.
     */
    max: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Extents (max - min).
     */
    size: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Box center.
     */
    center: {
        x: number;
        y: number;
        z: number;
    };
};
/**
 * Summary of one animation clip.
 */
export type Model3DClipInfo = {
    /**
     * Clip name (`''` when missing).
     */
    name: string;
    /**
     * Duration in seconds (0 when unknown).
     */
    duration: number;
    /**
     * Number of tracks.
     */
    trackCount: number;
    /**
     * True when a root/pelvis/hips/armature position track exists.
     */
    hasRootMotion: boolean;
};
/**
 * Result of {@link inspectModel3D}.
 */
export type Model3DInspection = {
    /**
     * World-space bounds of the model.
     */
    bounds: Model3DBounds;
    /**
     * Unique bone names in traversal order.
     */
    boneNames: string[];
    /**
     * Number of meshes.
     */
    meshCount: number;
    /**
     * Number of skinned meshes.
     */
    skinnedMeshCount: number;
    /**
     * Clip summaries.
     */
    clips: Model3DClipInfo[];
};
/**
 * Options for {@link prepareAnimationClips}.
 */
export type PrepareAnimationClipsOptions = {
    /**
     * Strip `ns|` / `ns:` prefixes from track node names.
     */
    stripNamespace?: boolean;
    /**
     * Lock root position tracks (`true`/`'xz'` lock X/Z, `'xyz'` also locks Y).
     */
    stripRootMotion?: boolean | "xz" | "xyz";
    /**
     * Root bone names (case-insensitive). Defaults to root, pelvis, hips, armature.
     */
    rootBoneNames?: string[];
    /**
     * Node name remapping applied to track names.
     */
    renameMap?: Record<string, string> | null;
};
/**
 * Minimal GLTF-loader contract: either `loadAsync(url)` or callback-style `load(...)`.
 */
export type Model3DLoader = {
    /**
     * Promise loader.
     */
    loadAsync?: (url: string) => Promise<unknown>;
    /**
     * Callback loader.
     */
    load?: (url: string, onLoad: (result: unknown) => void, onProgress?: ((event: unknown) => void) | undefined, onError?: (error: unknown) => void) => void;
};

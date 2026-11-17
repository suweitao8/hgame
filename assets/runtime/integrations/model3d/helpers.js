/** Model3D shared helpers (clone, inspect, clip preparation). */

import { cleanupAll } from '../../internal/cleanup.js';

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
export const SCRATCH_WORLD_MAT = new Float64Array(16);
export const FORBIDDEN_SCHEME_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
export const DEFAULT_ROOT_BONE_NAMES = Object.freeze(['root', 'pelvis', 'hips', 'armature']);

/**
 * Strips a `ns|` or `ns:` namespace prefix from a node name.
 * @param {string} name Node name.
 * @returns {string} Name without namespace (`''` for non-strings).
 */
export function stripNodeNamespace(name) {
  if (typeof name !== 'string') return '';
  const cut = Math.max(name.lastIndexOf('|'), name.lastIndexOf(':'));
  return cut >= 0 ? name.slice(cut + 1) : name;
}

/**
 * Splits a track name into node and property parts.
 * @param {string} trackName Track name such as `Hips.position`.
 * @returns {{nodePart: string, propPart: string, propName: string}} Parsed parts.
 */
export function parseTrackName(trackName) {
  if (typeof trackName !== 'string') return { nodePart: '', propPart: '', propName: '' };
  const known = /^(.*?)\.(position|quaternion|rotation|scale|morphTargetInfluences)(.*)$/.exec(trackName);
  if (known) {
    return {
      nodePart: known[1],
      propPart: '.' + known[2] + known[3],
      propName: known[2],
    };
  }
  const dot = trackName.lastIndexOf('.');
  if (dot <= 0) return { nodePart: trackName, propPart: '', propName: '' };
  return {
    nodePart: trackName.slice(0, dot),
    propPart: trackName.slice(dot),
    propName: trackName.slice(dot + 1),
  };
}

/**
 * Builds a lowercase set of namespace-stripped root bone names.
 * @param {string[]|null|undefined} rootBoneNames Names; defaults are used when empty.
 * @returns {Set<string>} Normalized names.
 */
export function makeRootBoneSet(rootBoneNames) {
  const list = Array.isArray(rootBoneNames) && rootBoneNames.length > 0
    ? rootBoneNames
    : DEFAULT_ROOT_BONE_NAMES;
  const set = new Set();
  for (const name of list) {
    if (typeof name === 'string' && name.trim()) {
      set.add(stripNodeNamespace(name.trim()).toLowerCase());
    }
  }
  return set;
}

/**
 * Tests whether a track is a root-bone position track.
 * @param {string} trackName Track name.
 * @param {Set<string>} rootBoneSet Set from {@link makeRootBoneSet}.
 * @returns {boolean} True for root position tracks.
 */
export function isRootPositionTrack(trackName, rootBoneSet) {
  const { nodePart, propName } = parseTrackName(trackName);
  if (propName !== 'position') return false;
  const clean = stripNodeNamespace(nodePart).toLowerCase();
  return rootBoneSet.has(clean);
}

/**
 * Validates a safe relative project asset path and optionally resolves it against a base URL.
 * @param {string} rawUrl Relative path (no scheme, backslash, leading slash, or traversal).
 * @param {string|URL|null} [projectBaseUrl=null] Base URL used for `resolved`.
 * @returns {{key: string, resolved: string}} Normalized key and resolved URL/path.
 */
export function resolveRelativeAssetPath(rawUrl, projectBaseUrl = null) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new TypeError('Model asset path must be a non-empty relative string');
  }
  let clean = rawUrl.trim();
  if (clean.includes('\\') || clean.startsWith('/') || FORBIDDEN_SCHEME_RE.test(clean)) {
    throw new Error('Model asset path must be a safe relative project path');
  }
  while (clean.startsWith('./')) clean = clean.slice(2);
  if (!clean) throw new TypeError('Model asset path must be a non-empty relative string');
  const segments = clean.split('/');
  if (segments.some(seg => !seg || seg === '.' || seg === '..')) {
    throw new Error('Model asset path must not contain traversal or empty segments');
  }
  const normalized = segments.join('/');
  const resolved = projectBaseUrl ? new URL(normalized, projectBaseUrl).href : normalized;
  return { key: normalized, resolved };
}

/**
 * Maps each node of a hierarchy to the structurally identical node of another hierarchy.
 * @param {Model3DObject} source Source root.
 * @param {Model3DObject} target Target root.
 * @param {Map<Model3DObject, Model3DObject>} [map] Map to fill.
 * @returns {Map<Model3DObject, Model3DObject>} The filled map.
 */
export function buildLockstepNodeMap(source, target, map = new Map()) {
  map.set(source, target);
  const srcChildren = source.children ?? [];
  const dstChildren = target.children ?? [];
  const count = Math.min(srcChildren.length, dstChildren.length);
  for (let i = 0; i < count; i++) {
    buildLockstepNodeMap(srcChildren[i], dstChildren[i], map);
  }
  return map;
}

/**
 * Dependency-injected deep clone of a Three.js Object3D hierarchy that rebinds
 * SkinnedMesh instances to cloned Skeleton bone nodes so animations remain isolated.
 * @param {Model3DThree} THREE Three.js namespace (uses `Skeleton` when available).
 * @param {Model3DObject} source Object to clone.
 * @returns {Model3DObject} Cloned hierarchy.
 */
export function cloneObject3DWithSkins(THREE, source) {
  if (!THREE || !source || typeof source.clone !== 'function') {
    throw new TypeError('cloneObject3DWithSkins requires THREE and a cloneable Object3D');
  }
  const clonedRoot = source.clone(true);
  const nodeMap = buildLockstepNodeMap(source, clonedRoot);

  for (const [srcNode, dstNode] of nodeMap) {
    if (!dstNode.isSkinnedMesh || !srcNode.skeleton) continue;
    const srcBones = srcNode.skeleton.bones ?? [];
    const dstBones = srcBones.map(bone => nodeMap.get(bone) ?? bone);
    const srcInverses = srcNode.skeleton.boneInverses ?? [];
    const dstInverses = srcInverses.map(inv => (typeof inv?.clone === 'function' ? inv.clone() : inv));

    if (typeof THREE.Skeleton === 'function' && typeof dstNode.bind === 'function') {
      const clonedSkeleton = new THREE.Skeleton(dstBones, dstInverses);
      const bindMatrix = typeof dstNode.bindMatrix?.clone === 'function'
        ? dstNode.bindMatrix.clone()
        : undefined;
      dstNode.bind(clonedSkeleton, bindMatrix);
    } else {
      dstNode.skeleton = {
        ...srcNode.skeleton,
        bones: dstBones,
        boneInverses: dstInverses,
      };
    }
  }
  return clonedRoot;
}

/**
 * Computes world-space bounds for an object hierarchy.
 * @param {Model3DThree} THREE Three.js namespace (uses `Box3` / `Vector3`).
 * @param {Model3DObject} root Root object.
 * @returns {Model3DBounds} Bounds (all zeros when empty).
 */
export function computeRootBounds(THREE, root) {
  root?.updateMatrixWorld?.(true);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  if (typeof THREE.Box3 === 'function') {
    try {
      const box = new THREE.Box3();
      box.setFromObject(root);
      if (typeof box.isEmpty === 'function' ? !box.isEmpty() : Number.isFinite(box.min?.x)) {
        minX = box.min.x; minY = box.min.y; minZ = box.min.z;
        maxX = box.max.x; maxY = box.max.y; maxZ = box.max.z;
      }
    } catch {
      // Fall back to per-mesh geometry boxes below for partially mocked scenes.
    }
  }

  if (minX === Infinity && typeof THREE.Vector3 === 'function') {
    const corner = new THREE.Vector3();
    root?.traverse?.((node) => {
      const geom = node.isMesh ? node.geometry : null;
      if (!geom) return;
      if (!geom.boundingBox) geom.computeBoundingBox?.();
      const b = geom.boundingBox;
      if (!b) return;
      for (let ix = 0; ix < 2; ix++) {
        for (let iy = 0; iy < 2; iy++) {
          for (let iz = 0; iz < 2; iz++) {
            corner.set(ix ? b.max.x : b.min.x, iy ? b.max.y : b.min.y, iz ? b.max.z : b.min.z);
            if (node.matrixWorld) corner.applyMatrix4(node.matrixWorld);
            if (corner.x < minX) minX = corner.x;
            if (corner.y < minY) minY = corner.y;
            if (corner.z < minZ) minZ = corner.z;
            if (corner.x > maxX) maxX = corner.x;
            if (corner.y > maxY) maxY = corner.y;
            if (corner.z > maxZ) maxZ = corner.z;
          }
        }
      }
    });
  }

  if (minX === Infinity) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
    };
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    center: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, z: (minZ + maxZ) * 0.5 },
  };
}

/**
 * Extracts structured geometry, skeleton, and clip metadata so AI-driven game code
 * can inspect bounds, bone names, clip durations, and root-motion presence offline.
 * @param {Model3DThree} THREE Three.js namespace.
 * @param {Model3DAsset|Model3DObject} assetOrRoot Loaded asset (`scene` + `animations`) or root object.
 * @param {Model3DClip[]|null} [explicitAnimations=null] Clips overriding the asset's animations.
 * @returns {Model3DInspection} Inspection summary.
 */
export function inspectModel3D(THREE, assetOrRoot, explicitAnimations = null) {
  if (!THREE) throw new TypeError('inspectModel3D requires THREE');
  const root = assetOrRoot?.scene ?? assetOrRoot;
  if (!root || typeof root.traverse !== 'function') {
    throw new TypeError('inspectModel3D requires an asset object or Object3D root');
  }
  const animations = Array.isArray(explicitAnimations)
    ? explicitAnimations
    : (Array.isArray(assetOrRoot?.animations) ? assetOrRoot.animations : []);

  const bounds = computeRootBounds(THREE, root);
  const boneNames = [];
  const seenBones = new Set();
  let meshCount = 0;
  let skinnedMeshCount = 0;

  root.traverse((node) => {
    if (node.isMesh) meshCount++;
    if (node.isSkinnedMesh) skinnedMeshCount++;
    if ((node.isBone || node.type === 'Bone') && node.name && !seenBones.has(node.name)) {
      seenBones.add(node.name);
      boneNames.push(node.name);
    }
  });

  const rootBoneSet = makeRootBoneSet(DEFAULT_ROOT_BONE_NAMES);
  const clips = animations.map(clip => {
    const tracks = Array.isArray(clip?.tracks) ? clip.tracks : [];
    return {
      name: clip?.name ?? '',
      duration: Number.isFinite(clip?.duration) ? clip.duration : 0,
      trackCount: tracks.length,
      hasRootMotion: tracks.some(t => isRootPositionTrack(t?.name, rootBoneSet)),
    };
  });

  return { bounds, boneNames, meshCount, skinnedMeshCount, clips };
}

/**
 * Clones and normalizes external skeletal AnimationClips (e.g. Unreal GLB exports),
 * stripping namespace prefixes, renaming bones, and optionally locking root motion.
 * @param {Model3DThree} THREE Three.js namespace (uses `AnimationClip` when available).
 * @param {Model3DClip[]} clips Source clips.
 * @param {PrepareAnimationClipsOptions} [options] Preparation options.
 * @returns {Model3DClip[]} New clips; sources are not mutated.
 */
export function prepareAnimationClips(THREE, clips, {
  stripNamespace = true,
  stripRootMotion = false,
  rootBoneNames = DEFAULT_ROOT_BONE_NAMES,
  renameMap = null,
} = {}) {
  if (!THREE) throw new TypeError('prepareAnimationClips requires THREE');
  if (!Array.isArray(clips)) throw new TypeError('prepareAnimationClips requires an array of clips');

  const rootBoneSet = makeRootBoneSet(rootBoneNames);
  const lockRoot = stripRootMotion === true || stripRootMotion === 'xz' || stripRootMotion === 'xyz';
  const lockY = stripRootMotion === 'xyz';

  return clips.map((clip) => {
    const srcTracks = Array.isArray(clip?.tracks) ? clip.tracks : [];
    const nextTracks = srcTracks.map((track) => {
      const cloned = typeof track.clone === 'function' ? track.clone() : track;
      const { nodePart, propPart, propName } = parseTrackName(cloned.name);
      const stripped = stripNamespace ? stripNodeNamespace(nodePart) : nodePart;
      const mapped = (renameMap && (renameMap[nodePart] ?? renameMap[stripped])) || stripped;
      const nextName = mapped + propPart;
      if (cloned.name !== nextName) cloned.name = nextName;

      if (lockRoot && propName === 'position') {
        const cleanRoot = stripNodeNamespace(mapped).toLowerCase();
        if (rootBoneSet.has(cleanRoot) && cloned.values && cloned.values.length >= 3) {
          const vals = new Float32Array(cloned.values.length);
          vals.set(cloned.values);
          const x0 = vals[0];
          const y0 = vals[1];
          const z0 = vals[2];
          for (let i = 0; i + 2 < vals.length; i += 3) {
            vals[i] = x0;
            if (lockY) vals[i + 1] = y0;
            vals[i + 2] = z0;
          }
          cloned.values = vals;
        }
      }
      return cloned;
    });

    if (typeof THREE.AnimationClip === 'function') {
      return new THREE.AnimationClip(clip.name, clip.duration, nextTracks, clip.blendMode);
    }
    return { ...clip, tracks: nextTracks };
  });
}

/**
 * Disposes each owned geometry, material, texture and skeleton once across all roots.
 * @param {Iterable<Model3DObject>} roots Owned source roots.
 * @param {WeakSet<object>} [released] Shared across batches when outstanding models are still loading.
 * @returns {void}
 */
export function disposeObjectResources(roots, released = new WeakSet()) {
  const actions = [];
  const collect = (resource, dispose = null) => {
    if (typeof resource?.dispose !== 'function' || released.has(resource)) return;
    released.add(resource);
    actions.push(dispose ?? (() => resource.dispose()));
  };
  const collectMaterial = material => {
    if (!material || released.has(material)) return;
    for (const value of Object.values(material)) {
      if (value?.isTexture) collect(value);
    }
    collect(material);
  };
  const collectSkeleton = skeleton => {
    if (!skeleton || released.has(skeleton)) return;
    const texture = skeleton.boneTexture;
    if (texture?.isTexture) {
      // Three's Skeleton.dispose() normally disposes this texture itself. Route it
      // through the shared set because another skeleton or material may reference it.
      collect(texture);
      collect(skeleton, () => {
        if (skeleton.boneTexture === texture) skeleton.boneTexture = null;
        skeleton.dispose();
      });
    } else {
      collect(skeleton);
    }
  };
  for (const root of roots) {
    root.traverse?.(node => {
      collect(node.geometry);
      if (node.isSkinnedMesh) collectSkeleton(node.skeleton);
      if (Array.isArray(node.material)) {
        for (const material of node.material) collectMaterial(material);
      } else {
        collectMaterial(node.material);
      }
    });
  }
  cleanupAll(actions, 'Model3D resource disposal failed');
}

/**
 * Loads a URL with a promise- or callback-style loader.
 * @param {Model3DLoader} loader Loader.
 * @param {string} resolvedUrl URL to load.
 * @returns {Promise<unknown>} Loader result.
 */
export function loadWithLoader(loader, resolvedUrl) {
  if (typeof loader.loadAsync === 'function') {
    return Promise.resolve(loader.loadAsync(resolvedUrl));
  }
  if (typeof loader.load === 'function') {
    return new Promise((resolve, reject) => {
      loader.load(resolvedUrl, resolve, undefined, reject);
    });
  }
  return Promise.reject(new TypeError('GLTF loader must implement loadAsync(url) or load(url, onLoad, onProgress, onError)'));
}


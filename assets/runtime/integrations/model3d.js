import { Component } from '../core/component.js';
import { createInstancedBatch3D } from './culling3d.js';

const SCRATCH_WORLD_MAT = new Float64Array(16);
const FORBIDDEN_SCHEME_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const DEFAULT_ROOT_BONE_NAMES = Object.freeze(['root', 'pelvis', 'hips', 'armature']);

function stripNodeNamespace(name) {
  if (typeof name !== 'string') return '';
  const cut = Math.max(name.lastIndexOf('|'), name.lastIndexOf(':'));
  return cut >= 0 ? name.slice(cut + 1) : name;
}

function parseTrackName(trackName) {
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

function makeRootBoneSet(rootBoneNames) {
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

function isRootPositionTrack(trackName, rootBoneSet) {
  const { nodePart, propName } = parseTrackName(trackName);
  if (propName !== 'position') return false;
  const clean = stripNodeNamespace(nodePart).toLowerCase();
  return rootBoneSet.has(clean);
}

function resolveRelativeAssetPath(rawUrl, projectBaseUrl = null) {
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

function buildLockstepNodeMap(source, target, map = new Map()) {
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

function computeRootBounds(THREE, root) {
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

function disposeObjectResources(root) {
  const disposeMat = (material) => {
    if (!material) return;
    for (const value of Object.values(material)) {
      if (value?.isTexture) value.dispose?.();
    }
    material.dispose?.();
  };
  root?.traverse?.((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) {
      for (const material of node.material) disposeMat(material);
    } else if (node.material) {
      disposeMat(node.material);
    }
  });
}

function loadWithLoader(loader, resolvedUrl) {
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

/**
 * Creates a clean-room GLTF / skinned-model & animation provider compatible with
 * `app.installFeatures({ model3d })`.
 */
export function createModel3DProvider({
  THREE,
  GLTFLoader = null,
  loader = null,
  cloneSkeleton = null,
  projectBaseUrl = null,
} = {}) {
  if (!THREE) {
    throw new TypeError('createModel3DProvider requires THREE');
  }
  if (cloneSkeleton !== null && typeof cloneSkeleton !== 'function') {
    throw new TypeError('cloneSkeleton must be a function when provided');
  }

  let activeLoader = loader;
  const cache = new Map();
  const clipCache = new Map();
  let disposed = false;

  function ensureActive() {
    if (disposed) throw new Error('Model3D provider has been disposed');
  }

  function getLoader() {
    if (!activeLoader) {
      if (typeof GLTFLoader !== 'function') {
        throw new Error('createModel3DProvider requires GLTFLoader or loader to fetch external GLTF assets');
      }
      activeLoader = new GLTFLoader();
    }
    return activeLoader;
  }

  function cloneHierarchy(source) {
    return cloneSkeleton ? cloneSkeleton(source) : cloneObject3DWithSkins(THREE, source);
  }

  async function load(url) {
    ensureActive();
    const { key, resolved } = resolveRelativeAssetPath(url, projectBaseUrl);
    if (!cache.has(key)) {
      const request = Promise.resolve().then(async () => {
        const gltf = await loadWithLoader(getLoader(), resolved);
        if (!gltf || !gltf.scene) {
          throw new Error('Loaded GLTF asset contains no scene: ' + key);
        }
        return {
          key,
          scene: gltf.scene,
          animations: Array.isArray(gltf.animations) ? gltf.animations : [],
          gltf,
          owned: true,
        };
      });
      cache.set(key, request);
      request.catch(() => {
        if (cache.get(key) === request) cache.delete(key);
      });
    }
    return cache.get(key);
  }

  async function loadClips(url, {
    clipName = null,
    stripNamespace = true,
    stripRootMotion = false,
    rootBoneNames = DEFAULT_ROOT_BONE_NAMES,
    renameMap = null,
  } = {}) {
    ensureActive();
    const { key, resolved } = resolveRelativeAssetPath(url, projectBaseUrl);
    if (!clipCache.has(key)) {
      const request = Promise.resolve().then(async () => {
        const gltf = await loadWithLoader(getLoader(), resolved);
        return Array.isArray(gltf?.animations) ? gltf.animations : [];
      });
      clipCache.set(key, request);
      request.catch(() => {
        if (clipCache.get(key) === request) clipCache.delete(key);
      });
    }
    const rawClips = await clipCache.get(key);
    const prepared = prepareAnimationClips(THREE, rawClips, {
      stripNamespace,
      stripRootMotion,
      rootBoneNames,
      renameMap,
    });
    if (clipName && prepared.length === 1) {
      prepared[0].name = clipName;
    }
    return prepared;
  }

  function registerAsset(urlOrKey, { scene, animations = [], owned = false } = {}) {
    ensureActive();
    if (!scene || typeof scene.clone !== 'function') {
      throw new TypeError('registerAsset requires a cloneable scene Object3D');
    }
    const { key } = resolveRelativeAssetPath(urlOrKey);
    const entry = {
      key,
      scene,
      animations: Array.isArray(animations) ? [...animations] : [],
      gltf: null,
      owned: Boolean(owned),
    };
    cache.set(key, Promise.resolve(entry));
    return entry;
  }

  async function instantiate(urlOrKey) {
    ensureActive();
    const asset = await load(urlOrKey);
    return {
      root: cloneHierarchy(asset.scene),
      animations: asset.animations,
    };
  }

  function inspect(assetOrRoot, explicitAnimations = null) {
    ensureActive();
    return inspectModel3D(THREE, assetOrRoot, explicitAnimations);
  }

  function createComponent({
    asset = null,
    root = null,
    animations = null,
    clip = null,
    loop = true,
    timeScale = 1,
    crossFadeSeconds = 0.18,
    castShadow = false,
    receiveShadow = false,
    offsetY = 0,
    scale = 1,
    targetHeight = null,
    alignGround = false,
    rotationY = 0,
    stripNamespace = false,
    stripRootMotion = false,
    rootBoneNames = DEFAULT_ROOT_BONE_NAMES,
    renameMap = null,
    interpolate = false,
    enableLod = true,
    lodDistances = [20, 42, 75],
    cull = false,
    cullRadius = null,
    shadowDistance = null,
    notifies = null,
    onNotify = null,
  } = {}) {
    ensureActive();
    if (!asset && !root) {
      throw new TypeError('createComponent requires asset or root');
    }
    if (asset && !asset.scene) {
      throw new TypeError('asset passed to createComponent must contain scene');
    }

    const defaultLoop = Boolean(loop);
    const defaultTimeScale = Number.isFinite(timeScale) ? timeScale : 1;
    const defaultCrossFade = Math.max(0, Number.isFinite(crossFadeSeconds) ? crossFadeSeconds : 0.18);
    const rawClips = Array.isArray(animations)
      ? animations
      : (Array.isArray(asset?.animations) ? asset.animations : []);
    const clipList = (stripNamespace || stripRootMotion || renameMap)
      ? prepareAnimationClips(THREE, rawClips, {
          stripNamespace,
          stripRootMotion,
          rootBoneNames,
          renameMap,
        })
      : rawClips;

    class Model3DComponent extends Component {
      awake() {
        const modelRoot = root ?? cloneHierarchy(asset.scene);
        const meshes = [];
        modelRoot.traverse?.((node) => {
          if (node.isMesh) {
            node.castShadow = Boolean(castShadow);
            node.receiveShadow = Boolean(receiveShadow);
            meshes.push(node);
          }
          if ((stripNamespace || renameMap) && node.name && (node.isBone || node.type === 'Bone')) {
            const rawName = node.name;
            const cleanName = stripNamespace ? stripNodeNamespace(rawName) : rawName;
            node.name = (renameMap && (renameMap[rawName] ?? renameMap[cleanName])) || cleanName;
          }
        });

        const bounds = computeRootBounds(THREE, modelRoot);
        const autoScale = (targetHeight !== null && Number.isFinite(targetHeight) && targetHeight > 0 && bounds.size.y > 1e-4)
          ? (targetHeight / bounds.size.y)
          : 1;
        const finalScale = scale * autoScale;
        const groundShift = alignGround ? (-bounds.min.y * finalScale) : 0;
        const needsWrapper = (
          offsetY !== 0 || finalScale !== 1 || alignGround || rotationY !== 0
        ) && typeof THREE.Group === 'function';

        if (needsWrapper) {
          const wrapper = new THREE.Group();
          modelRoot.position?.set?.(0, offsetY + groundShift, 0);
          if (finalScale !== 1) modelRoot.scale?.set?.(finalScale, finalScale, finalScale);
          if (rotationY !== 0 && modelRoot.rotation) modelRoot.rotation.y = rotationY;
          wrapper.add(modelRoot);
          this.object3d = wrapper;
        } else {
          if (rotationY !== 0 && modelRoot.rotation) modelRoot.rotation.y = rotationY;
          this.object3d = modelRoot;
        }
        modelRoot.updateMatrixWorld?.(true);
        this.modelRoot = modelRoot;
        this._meshes = meshes;
        this._cullRadius = Number.isFinite(cullRadius) && cullRadius > 0
          ? cullRadius
          : Math.max(0.75, Math.hypot(bounds.size.x, bounds.size.y, bounds.size.z) * 0.5 * finalScale);
        this._lodFrameCounter = 0;
        this._lodAccumDt = 0;
        this._lastCastShadow = Boolean(castShadow);
        this._scratchMat4 = THREE.Matrix4 ? new THREE.Matrix4() : null;
        this._currentAction = null;
        this._currentClipName = null;
        this._currentClipLoop = defaultLoop;
        this._mainNotifyCursor = { unwrappedTime: 0, started: false };
        this._pendingFinish = null;
        this._overlayAction = null;
        this._overlayName = null;
        this._overlayLoop = false;
        this._overlayNotifyCursor = { unwrappedTime: 0, started: false };
        this._overlayOnComplete = null;
        this._overlayFadeOut = 0.15;
        this._notifies = new Map();
        this._notifyNextId = 1;
        this._defaultOnNotify = typeof onNotify === 'function' ? onNotify : null;
        this._budgetManaged = false;
        this._attachments = [];
        this.mixer = THREE.AnimationMixer && clipList.length > 0
          ? new THREE.AnimationMixer(modelRoot)
          : null;

        if (notifies) {
          if (Array.isArray(notifies)) {
            for (const entry of notifies) {
              if (entry?.clipName) this.addNotify(entry.clipName, entry);
            }
          } else if (typeof notifies === 'object') {
            for (const [clipKey, list] of Object.entries(notifies)) {
              if (!Array.isArray(list)) continue;
              for (const entry of list) this.addNotify(clipKey, entry);
            }
          }
        }

        this._finishedListener = (event) => {
          const action = event?.action;
          if (!action) return;
          if (this._pendingFinish && this._pendingFinish.action === action) {
            const { name, callback } = this._pendingFinish;
            this._pendingFinish = null;
            callback?.(name);
          }
          if (this._overlayAction === action) {
            const overlayName = this._overlayName;
            const cb = this._overlayOnComplete;
            const fade = this._overlayFadeOut;
            this._overlayAction = null;
            this._overlayName = null;
            this._overlayOnComplete = null;
            if (fade > 0 && typeof action.fadeOut === 'function') action.fadeOut(fade);
            else action.stop?.();
            cb?.(overlayName);
          }
        };
        this.mixer?.addEventListener?.('finished', this._finishedListener);

        this.updateTransform();
        if (clip) {
          this.play(clip, {
            loop: defaultLoop,
            crossFadeSeconds: 0,
            timeScale: defaultTimeScale,
          });
        }
      }

      getClipNames() {
        return clipList.map(c => c?.name).filter(Boolean);
      }

      addNotify(clipName, {
        id = null,
        name = 'Notify',
        time = undefined,
        normalizedTime = undefined,
        callback = null,
        data = undefined,
      } = {}) {
        if (typeof clipName !== 'string' || !clipName) {
          throw new TypeError('addNotify requires a non-empty clipName string');
        }
        const targetClip = this._findClip(clipName);
        const clipDuration = Number(targetClip?.duration);
        let resolvedTime = Number.isFinite(time) ? Math.max(0, time) : null;
        let resolvedNorm = Number.isFinite(normalizedTime) ? Math.max(0, Math.min(1, normalizedTime)) : null;
        if (resolvedTime === null && resolvedNorm === null) {
          throw new TypeError('addNotify requires numeric time or normalizedTime');
        }
        if (resolvedTime === null && Number.isFinite(clipDuration) && clipDuration > 0) {
          resolvedTime = resolvedNorm * clipDuration;
        }
        const notifyId = id ?? `notify_${this._notifyNextId++}`;
        let list = this._notifies.get(clipName);
        if (!list) {
          list = [];
          this._notifies.set(clipName, list);
        }
        const existingIdx = list.findIndex(item => item.id === notifyId);
        const record = {
          id: notifyId,
          name: String(name || 'Notify'),
          time: resolvedTime,
          normalizedTime: resolvedNorm,
          callback: typeof callback === 'function' ? callback : null,
          data,
        };
        if (existingIdx !== -1) list[existingIdx] = record;
        else list.push(record);
        return notifyId;
      }

      removeNotify(clipName, idOrName) {
        const list = this._notifies.get(clipName);
        if (!list) return false;
        const idx = list.findIndex(item => item.id === idOrName || item.name === idOrName);
        if (idx === -1) return false;
        list.splice(idx, 1);
        if (list.length === 0) this._notifies.delete(clipName);
        return true;
      }

      clearNotifies(clipName = null) {
        if (clipName) {
          return this._notifies.delete(clipName);
        }
        this._notifies.clear();
        return true;
      }

      _collectNotifiesForTrack(clipName, action, isLoop, cursor, stepDt, pendingEvents) {
        if (!clipName || !action || stepDt <= 0) return;
        const list = this._notifies.get(clipName);
        if (!list || list.length === 0) {
          const clip = this._findClip(clipName);
          const d = Number(clip?.duration) || 0;
          const speed = (action.timeScale ?? 1) * (this.mixer?.timeScale ?? 1);
          if (d > 0 && speed > 0) {
            cursor.unwrappedTime += stepDt * speed;
            cursor.started = true;
          }
          return;
        }
        const clip = this._findClip(clipName);
        const duration = Number(clip?.duration) || 0;
        const speed = (action.timeScale ?? 1) * (this.mixer?.timeScale ?? 1);
        if (!(duration > 0) || speed <= 0) return;

        const t0 = cursor.unwrappedTime;
        const rawEnd = t0 + stepDt * speed;
        const t1 = isLoop ? rawEnd : Math.min(duration, rawEnd);
        const wasStarted = cursor.started;
        cursor.unwrappedTime = t1;
        cursor.started = true;

        if (t1 < t0 || (t1 === t0 && wasStarted)) return;

        const minLap = Math.max(0, Math.floor(t0 / duration));
        const maxLap = Math.min(minLap + 32, Math.floor(t1 / duration));

        for (let i = 0; i < list.length; i++) {
          const rec = list[i];
          let tau = rec.time !== null ? Math.min(duration, rec.time) : (rec.normalizedTime * duration);
          if (!Number.isFinite(tau) || tau < 0) tau = 0;

          if (!isLoop) {
            const matched = (tau === 0 && t0 === 0 && !wasStarted)
              ? (t1 >= 0)
              : (tau > t0 && tau <= t1);
            if (matched) {
              pendingEvents.push({
                sortKey: tau,
                order: i,
                record: rec,
                clipName,
                duration,
                time: tau,
                normalizedTime: tau / duration,
                loopCount: 0,
              });
            }
            continue;
          }

          if (tau === duration) {
            // End-of-cycle markers fire once per full lap boundary: D, 2D, 3D, ...
            for (let lap = minLap; lap <= maxLap; lap++) {
              const boundary = (lap + 1) * duration;
              if (boundary > t0 && boundary <= t1) {
                pendingEvents.push({
                  sortKey: boundary,
                  order: i,
                  record: rec,
                  clipName,
                  duration,
                  time: duration,
                  normalizedTime: 1,
                  loopCount: lap,
                });
              }
            }
          } else {
            for (let lap = minLap; lap <= maxLap; lap++) {
              const eventTime = lap * duration + tau;
              const matched = (tau === 0 && lap === 0 && t0 === 0 && !wasStarted)
                ? (eventTime <= t1)
                : (eventTime > t0 && eventTime <= t1);
              if (matched) {
                pendingEvents.push({
                  sortKey: eventTime,
                  order: i,
                  record: rec,
                  clipName,
                  duration,
                  time: tau,
                  normalizedTime: tau / duration,
                  loopCount: lap,
                });
              }
            }
          }
        }
      }

      _stepMixerWithNotifies(stepDt) {
        if (!this.mixer || !(stepDt > 0)) return;
        const pendingEvents = [];
        if (this._currentAction && this._currentClipName) {
          this._collectNotifiesForTrack(
            this._currentClipName,
            this._currentAction,
            this._currentClipLoop,
            this._mainNotifyCursor,
            stepDt,
            pendingEvents,
          );
        }
        if (this._overlayAction && this._overlayName) {
          this._collectNotifiesForTrack(
            this._overlayName,
            this._overlayAction,
            this._overlayLoop,
            this._overlayNotifyCursor,
            stepDt,
            pendingEvents,
          );
        }

        this.mixer.update(stepDt);

        if (pendingEvents.length > 0) {
          pendingEvents.sort((a, b) => (a.sortKey - b.sortKey) || (a.order - b.order));
          for (let i = 0; i < pendingEvents.length; i++) {
            const evt = pendingEvents[i];
            const payload = {
              id: evt.record.id,
              name: evt.record.name,
              clipName: evt.clipName,
              time: evt.time,
              normalizedTime: evt.normalizedTime,
              duration: evt.duration,
              loopCount: evt.loopCount,
              data: evt.record.data,
              component: this,
            };
            evt.record.callback?.(payload);
            this._defaultOnNotify?.(payload);
          }
        }
      }

      _setBudgetManaged(flag) {
        this._budgetManaged = Boolean(flag);
      }

      _stepBudgeted(stepDt) {
        if (!this.mixer || !(stepDt > 0)) return;
        this._lodAccumDt = 0;
        this._stepMixerWithNotifies(stepDt);
      }

      findBone(boneName) {
        if (!this.modelRoot || typeof boneName !== 'string' || !boneName) return null;
        const targetNorm = stripNodeNamespace(boneName).toLowerCase();
        let exact = null;
        let strippedExact = null;
        let fuzzy = null;
        const strippedTarget = stripNodeNamespace(boneName);

        this.modelRoot.traverse?.((node) => {
          if (exact) return;
          if (!(node.isBone || node.type === 'Bone')) return;
          if (node.name === boneName) {
            exact = node;
            return;
          }
          const clean = stripNodeNamespace(node.name);
          if (!strippedExact && clean === strippedTarget) strippedExact = node;
          if (!fuzzy && clean.toLowerCase() === targetNorm) fuzzy = node;
        });
        return exact ?? strippedExact ?? fuzzy;
      }

      attachToBone(boneName, childObject3D, { position = null, rotation = null, scale: childScale = null } = {}) {
        if (!childObject3D || typeof childObject3D !== 'object') {
          throw new TypeError('attachToBone requires a Three.js Object3D');
        }
        const bone = this.findBone(boneName);
        if (!bone) throw new Error('Bone not found: ' + boneName);

        if (position) childObject3D.position?.set?.(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        if (rotation) childObject3D.rotation?.set?.(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
        if (typeof childScale === 'number') childObject3D.scale?.set?.(childScale, childScale, childScale);
        else if (childScale) childObject3D.scale?.set?.(childScale.x ?? 1, childScale.y ?? 1, childScale.z ?? 1);

        bone.add?.(childObject3D);
        bone.updateMatrixWorld?.(true);
        const record = { bone, child: childObject3D };
        this._attachments.push(record);
        return {
          bone,
          object: childObject3D,
          detach: () => {
            bone.remove?.(childObject3D);
            const at = this._attachments.indexOf(record);
            if (at !== -1) this._attachments.splice(at, 1);
          },
        };
      }

      _findClip(name) {
        return (typeof THREE.AnimationClip?.findByName === 'function'
          ? THREE.AnimationClip.findByName(clipList, name)
          : null) ?? clipList.find(c => c?.name === name) ?? null;
      }

      play(name, {
        loop: playLoop = defaultLoop,
        crossFadeSeconds: fade = defaultCrossFade,
        timeScale: speed = defaultTimeScale,
        onComplete = null,
      } = {}) {
        if (!this.mixer || !name) return false;
        const targetClip = this._findClip(name);
        if (!targetClip) return false;

        const nextAction = this.mixer.clipAction(targetClip);
        if (!nextAction) return false;

        this._pendingFinish = null;
        if (THREE.LoopRepeat !== undefined && THREE.LoopOnce !== undefined) {
          nextAction.setLoop?.(playLoop ? THREE.LoopRepeat : THREE.LoopOnce, playLoop ? Infinity : 1);
        }
        nextAction.clampWhenFinished = !playLoop;
        nextAction.timeScale = speed;

        const prevAction = this._currentAction;
        if (prevAction && prevAction !== nextAction) {
          nextAction.reset?.();
          if (fade > 0 && typeof prevAction.crossFadeTo === 'function') {
            nextAction.play?.();
            prevAction.crossFadeTo(nextAction, fade, true);
          } else {
            prevAction.stop?.();
            nextAction.play?.();
          }
        } else {
          nextAction.reset?.();
          nextAction.play?.();
        }
        this._currentAction = nextAction;
        this._currentClipName = name;
        this._currentClipLoop = Boolean(playLoop);
        this._mainNotifyCursor.unwrappedTime = 0;
        this._mainNotifyCursor.started = false;
        if (!playLoop && typeof onComplete === 'function') {
          this._pendingFinish = { action: nextAction, name, callback: onComplete };
        }
        return true;
      }

      playOverlay(name, {
        weight = 0.85,
        loop: overlayLoop = false,
        fadeIn = 0.1,
        fadeOut = 0.15,
        timeScale: speed = defaultTimeScale,
        onComplete = null,
      } = {}) {
        if (!this.mixer || !name) return false;
        const targetClip = this._findClip(name);
        if (!targetClip) return false;

        const action = this.mixer.clipAction(targetClip);
        if (!action) return false;
        if (this._overlayAction && this._overlayAction !== action) {
          this._overlayAction.stop?.();
        }
        if (THREE.LoopRepeat !== undefined && THREE.LoopOnce !== undefined) {
          action.setLoop?.(overlayLoop ? THREE.LoopRepeat : THREE.LoopOnce, overlayLoop ? Infinity : 1);
        }
        action.clampWhenFinished = false;
        action.timeScale = speed;
        action.reset?.();
        action.setEffectiveWeight?.(weight);
        if (fadeIn > 0) action.fadeIn?.(fadeIn);
        action.play?.();

        this._overlayAction = action;
        this._overlayName = name;
        this._overlayLoop = Boolean(overlayLoop);
        this._overlayNotifyCursor.unwrappedTime = 0;
        this._overlayNotifyCursor.started = false;
        this._overlayOnComplete = overlayLoop ? null : onComplete;
        this._overlayFadeOut = Math.max(0, fadeOut);
        return true;
      }

      stopOverlay(fadeOut = 0.15) {
        const act = this._overlayAction;
        if (!act) return false;
        this._overlayAction = null;
        this._overlayName = null;
        this._overlayOnComplete = null;
        if (fadeOut > 0 && typeof act.fadeOut === 'function') act.fadeOut(fadeOut);
        else act.stop?.();
        return true;
      }

      stop() {
        this._pendingFinish = null;
        this._overlayAction = null;
        this._overlayName = null;
        this._overlayOnComplete = null;
        this.mixer?.stopAllAction?.();
        this._currentAction = null;
        this._currentClipName = null;
        this._mainNotifyCursor.unwrappedTime = 0;
        this._mainNotifyCursor.started = false;
        this._overlayNotifyCursor.unwrappedTime = 0;
        this._overlayNotifyCursor.started = false;
      }

      updateTransform() {
        if (!this.object3d || !this.entity) return;
        const app = this.scene?.app;
        const useInterp = Boolean((interpolate || this.entity.interpolate) && app?.renderAlpha !== undefined);
        const alpha = app?.renderAlpha ?? 1;

        if (this._scratchMat4 && this.object3d.quaternion && this.object3d.position && this.object3d.scale) {
          const mat = useInterp
            ? this.entity.interpolatedWorldMatrixInto(alpha, SCRATCH_WORLD_MAT)
            : this.entity.worldMatrixInto(SCRATCH_WORLD_MAT);
          this._scratchMat4.fromArray(mat).decompose(
            this.object3d.position,
            this.object3d.quaternion,
            this.object3d.scale,
          );
          return;
        }
        const pos = useInterp
          ? this.entity.interpolatedWorldPosition(alpha)
          : this.entity.worldPosition();
        this.object3d.position?.set?.(pos.x, pos.y, pos.z);
        this.object3d.rotation?.set?.(this.entity.rotationX, this.entity.rotationY, this.entity.rotationZ);
        this.object3d.scale?.set?.(this.entity.scaleX, this.entity.scaleY, this.entity.scaleZ);
      }

      onEnable() {
        this.scene?.app?.renderer?.add(this.scene, this.object3d);
      }

      start() {
        this.updateTransform();
      }

      update(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const renderer = this.scene?.app?.renderer;
        const cam = renderer?.camera;
        let visible = true;

        if (cam?.position && this.object3d?.position) {
          const px = this.object3d.position.x ?? 0;
          const py = this.object3d.position.y ?? 0;
          const pz = this.object3d.position.z ?? 0;
          const dx = px - (cam.position.x ?? 0);
          const dy = py - (cam.position.y ?? 0);
          const dz = pz - (cam.position.z ?? 0);
          const dist = Math.hypot(dx, dy, dz);

          if (castShadow && this._meshes.length > 0) {
            const maxShDist = shadowDistance ?? renderer?.qualityPreset?.shadowDistance ?? Infinity;
            const castNow = maxShDist === Infinity ? true : dist <= maxShDist;
            if (castNow !== this._lastCastShadow) {
              this._lastCastShadow = castNow;
              for (let i = 0; i < this._meshes.length; i++) this._meshes[i].castShadow = castNow;
            }
          }

          if (cull && renderer?.culler3d?.frustum?.hasPlanes) {
            visible = renderer.culler3d.testSphere(px, py, pz, this._cullRadius);
            this.object3d.visible = visible;
          }

          if (this.mixer && !this._budgetManaged) {
            const hasBlockingCallback = Boolean(this._pendingFinish || this._overlayAction);
            if (!visible && !hasBlockingCallback) {
              this._lodAccumDt = Math.min(2.0, this._lodAccumDt + dt);
              return;
            }
            if (enableLod && !hasBlockingCallback && Array.isArray(lodDistances) && lodDistances.length >= 3) {
              const lodScale = renderer?.qualityPreset?.animationLodScale ?? 1;
              const d0 = lodDistances[0] * lodScale;
              const d1 = lodDistances[1] * lodScale;
              const d2 = lodDistances[2] * lodScale;
              const stride = dist <= d0 ? 1 : (dist <= d1 ? 2 : (dist <= d2 ? 4 : 8));
              if (stride > 1) {
                this._lodAccumDt += dt;
                this._lodFrameCounter++;
                if ((this._lodFrameCounter % stride) !== 0) return;
                const stepDt = this._lodAccumDt;
                this._lodAccumDt = 0;
                this._stepMixerWithNotifies(stepDt);
                return;
              }
            }
            const totalDt = dt + this._lodAccumDt;
            this._lodAccumDt = 0;
            this._stepMixerWithNotifies(totalDt);
          }
          return;
        }

        if (this.mixer && !this._budgetManaged) {
          const totalDt = dt + this._lodAccumDt;
          this._lodAccumDt = 0;
          this._stepMixerWithNotifies(totalDt);
        }
      }

      lateUpdate() {
        this.updateTransform();
      }

      onDisable() {
        this.scene?.app?.renderer?.remove(this.scene, this.object3d);
      }

      onDestroy() {
        this._pendingFinish = null;
        this._overlayAction = null;
        this._overlayOnComplete = null;
        for (const { bone, child } of this._attachments) bone.remove?.(child);
        this._attachments.length = 0;
        if (this._finishedListener) {
          this.mixer?.removeEventListener?.('finished', this._finishedListener);
          this._finishedListener = null;
        }
        this.mixer?.stopAllAction?.();
        if (this.modelRoot) this.mixer?.uncacheRoot?.(this.modelRoot);
        this._currentAction = null;
        this._currentClipName = null;
        this._budgetManaged = false;
        this._notifies?.clear();
        this.mixer = null;
      }
    }

    return new Model3DComponent();
  }

  async function dispose() {
    if (disposed) return false;
    disposed = true;
    const entries = await Promise.allSettled(cache.values());
    for (const outcome of entries) {
      if (outcome.status === 'fulfilled' && outcome.value?.owned) {
        disposeObjectResources(outcome.value.scene);
      }
    }
    cache.clear();
    clipCache.clear();
    return true;
  }

  function createCrowd(options = {}) {
    ensureActive();
    return createInstancedCrowd3D(THREE, options);
  }

  function createBudgetAllocator(options = {}) {
    ensureActive();
    return createAnimationBudgetAllocator(options);
  }

  return {
    THREE,
    load,
    loadClips,
    registerAsset,
    instantiate,
    inspect,
    createComponent,
    createCrowd,
    createBudgetAllocator,
    dispose,
  };
}

/**
 * Coordinates a shared CPU budget across many animated 3D characters,
 * assigning full / half / quarter / eighth tick strides by visibility, priority,
 * camera distance, and accumulated starvation debt.
 */
export function createAnimationBudgetAllocator({
  maxFullRateCount = 16,
  maxHalfRateCount = 32,
  maxQuarterRateCount = 48,
  offscreenTickInterval = 0.5,
  maxUpdateBudgetPerFrame = Infinity,
  maxAccumulatedDt = 2.0,
  priorityWeight = 10,
  starvationWeight = 25,
  distancePenalty = 1,
} = {}) {
  let nextSlot = 0;
  let frameCounter = 0;
  /** @type {Map<any, any>} */
  const entries = new Map();
  const visibleQueue = [];
  const offscreenQueue = [];

  function register(target, {
    priority = 0,
    getPosition = null,
    getVisible = null,
    onStep = null,
  } = {}) {
    if (!target) throw new TypeError('register requires an animation component or target object');
    const existing = entries.get(target);
    if (existing) {
      existing.priority = Number(priority) || 0;
      if (typeof getPosition === 'function') existing.getPosition = getPosition;
      if (typeof getVisible === 'function') existing.getVisible = getVisible;
      if (typeof onStep === 'function') existing.onStep = onStep;
      return existing;
    }

    target._setBudgetManaged?.(true);
    const entry = {
      target,
      slot: nextSlot++,
      priority: Number(priority) || 0,
      getPosition: typeof getPosition === 'function' ? getPosition : null,
      getVisible: typeof getVisible === 'function' ? getVisible : null,
      onStep: typeof onStep === 'function' ? onStep : null,
      accumDt: 0,
      tickCount: 0,
      score: 0,
      lastDist: 0,
      lastStride: 1,
    };
    entries.set(target, entry);
    return entry;
  }

  function unregister(target) {
    const entry = entries.get(target);
    if (!entry) return false;
    target._setBudgetManaged?.(false);
    entries.delete(target);
    return true;
  }

  function setPriority(target, priority) {
    const entry = entries.get(target);
    if (!entry) return false;
    entry.priority = Number(priority) || 0;
    return true;
  }

  function readTargetPosition(entry) {
    if (entry.getPosition) return entry.getPosition(entry.target);
    const objPos = entry.target?.object3d?.position ?? entry.target?.position;
    if (objPos) return objPos;
    const ent = entry.target?.entity;
    if (ent) return { x: ent.x ?? 0, y: ent.y ?? 0, z: ent.z ?? 0 };
    return null;
  }

  function readTargetVisible(entry) {
    if (entry.getVisible) return Boolean(entry.getVisible(entry.target));
    if (entry.target?.object3d?.visible !== undefined) return Boolean(entry.target.object3d.visible);
    if (entry.target?.visible !== undefined) return Boolean(entry.target.visible);
    return true;
  }

  function invokeEntryStep(entry, dt) {
    if (entry.onStep) {
      entry.onStep(dt, entry.target);
    } else if (typeof entry.target?._stepBudgeted === 'function') {
      entry.target._stepBudgeted(dt);
    } else if (typeof entry.target?.update === 'function') {
      entry.target.update(dt);
    } else if (typeof entry.target === 'function') {
      entry.target(dt);
    }
    entry.accumDt = 0;
    entry.tickCount++;
  }

  function update(dt = 0, cameraOrPos = null) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    frameCounter++;

    const camPos = cameraOrPos?.position ?? cameraOrPos;
    const hasCamPos = camPos && Number.isFinite(camPos.x);
    const cx = hasCamPos ? (Number(camPos.x) || 0) : 0;
    const cy = hasCamPos ? (Number(camPos.y) || 0) : 0;
    const cz = hasCamPos ? (Number(camPos.z) || 0) : 0;

    visibleQueue.length = 0;
    offscreenQueue.length = 0;

    for (const [target, entry] of entries.entries()) {
      if (target?.entity?.destroyed || target?._destroyed) {
        entries.delete(target);
        continue;
      }
      entry.accumDt = Math.min(maxAccumulatedDt, entry.accumDt + delta);

      const pos = readTargetPosition(entry);
      const dist = (hasCamPos && pos && Number.isFinite(pos.x))
        ? Math.hypot((Number(pos.x) || 0) - cx, (Number(pos.y) || 0) - cy, (Number(pos.z) || 0) - cz)
        : 0;
      entry.lastDist = dist;

      const visible = readTargetVisible(entry);
      entry.score =
        entry.priority * priorityWeight +
        entry.accumDt * starvationWeight -
        dist * distancePenalty;

      if (visible) {
        visibleQueue.push(entry);
      } else {
        offscreenQueue.push(entry);
      }
    }

    visibleQueue.sort((a, b) => (b.score - a.score) || (a.slot - b.slot));
    offscreenQueue.sort((a, b) => (b.accumDt - a.accumDt) || (b.score - a.score));

    const budget = Number.isFinite(maxUpdateBudgetPerFrame) && maxUpdateBudgetPerFrame >= 0
      ? Math.floor(maxUpdateBudgetPerFrame)
      : Infinity;

    let updated = 0;
    let fullRate = 0;
    let throttled = 0;
    let deferred = 0;
    let offscreenSkipped = 0;

    const halfEnd = maxFullRateCount + maxHalfRateCount;
    const quarterEnd = halfEnd + maxQuarterRateCount;

    for (let i = 0; i < visibleQueue.length; i++) {
      const entry = visibleQueue[i];
      let stride = 8;
      if (i < maxFullRateCount) stride = 1;
      else if (i < halfEnd) stride = 2;
      else if (i < quarterEnd) stride = 4;
      entry.lastStride = stride;

      const wantsTick = stride === 1 || ((frameCounter + entry.slot) % stride) === 0;
      if (!wantsTick) {
        deferred++;
        continue;
      }
      if (updated >= budget) {
        deferred++;
        continue;
      }

      if (entry.accumDt > 0) {
        invokeEntryStep(entry, entry.accumDt);
        updated++;
        if (stride === 1) fullRate++;
        else throttled++;
      }
    }

    for (let i = 0; i < offscreenQueue.length; i++) {
      const entry = offscreenQueue[i];
      entry.lastStride = 0;
      if (updated < budget && entry.accumDt >= offscreenTickInterval && entry.accumDt > 0) {
        invokeEntryStep(entry, entry.accumDt);
        updated++;
        throttled++;
      } else {
        offscreenSkipped++;
      }
    }

    const total = visibleQueue.length + offscreenQueue.length;
    visibleQueue.length = 0;
    offscreenQueue.length = 0;

    return {
      total,
      updated,
      fullRate,
      throttled,
      deferred,
      offscreenSkipped,
    };
  }

  function clear() {
    for (const target of entries.keys()) {
      target._setBudgetManaged?.(false);
    }
    entries.clear();
  }

  return Object.freeze({
    get size() { return entries.size; },
    register,
    unregister,
    setPriority,
    update,
    clear,
  });
}

/**
 * Bakes Skeletal AnimationClips into a Vertex Animation Texture (VAT) RGBA Float DataTexture
 * and wraps geometry+material into a single-draw-call GPU InstancedMesh crowd.
 */
export function createInstancedCrowd3D(THREE, {
  asset = null,
  root = null,
  animations = null,
  capacity = 1024,
  sampleFps = 15,
  castShadow = false,
  receiveShadow = true,
  perInstanceColor = false,
  cullRadius = 1.2,
  scale = 1,
} = {}) {
  if (!THREE?.InstancedMesh || !THREE?.BufferGeometry) {
    throw new TypeError('createInstancedCrowd3D requires THREE.InstancedMesh and BufferGeometry');
  }
  const sourceRoot = root ?? asset?.scene;
  if (!sourceRoot || typeof sourceRoot.traverse !== 'function') {
    throw new TypeError('createInstancedCrowd3D requires asset or root Object3D');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    throw new RangeError('createInstancedCrowd3D capacity must be an integer in 1..100000');
  }

  const clipList = Array.isArray(animations)
    ? animations
    : (Array.isArray(asset?.animations) ? asset.animations : []);

  const clonedRoot = cloneObject3DWithSkins(THREE, sourceRoot);
  clonedRoot.position?.set?.(0, 0, 0);
  clonedRoot.updateMatrixWorld?.(true);

  let srcMesh = null;
  clonedRoot.traverse((node) => {
    if (!srcMesh && (node.isSkinnedMesh || node.isMesh)) srcMesh = node;
  });
  if (!srcMesh?.geometry?.attributes?.position) {
    throw new Error('createInstancedCrowd3D could not find a Mesh with position attribute');
  }

  const bakedGeometry = srcMesh.geometry.clone();
  bakedGeometry.deleteAttribute?.('skinIndex');
  bakedGeometry.deleteAttribute?.('skinWeight');

  const srcMat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
  const crowdMaterial = srcMat?.clone ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });

  const clipMeta = new Map();
  let vatTexture = null;
  let vatMeta = null;

  const canBakeVat = Boolean(
    srcMesh.isSkinnedMesh &&
    typeof srcMesh.applyBoneTransform === 'function' &&
    THREE.AnimationMixer &&
    THREE.DataTexture &&
    THREE.RGBAFormat &&
    THREE.FloatType &&
    THREE.InstancedBufferAttribute &&
    clipList.length > 0
  );

  if (canBakeVat) {
    const posAttr = srcMesh.geometry.attributes.position;
    const vertCount = posAttr.count;
    const stride = Math.min(2048, Math.max(1, vertCount));
    const rowsPerFrame = Math.ceil(vertCount / stride);
    const fps = Math.max(4, Math.min(60, sampleFps));

    let totalFrameSlices = 0;
    const ranges = [];
    for (const clip of clipList) {
      const duration = Math.max(1 / fps, Number(clip?.duration) || 1);
      const frames = Math.max(2, Math.ceil(duration * fps) + 1);
      ranges.push({ clip, name: clip.name || `clip_${ranges.length}`, duration, frames, startFrame: totalFrameSlices });
      clipMeta.set(clip.name || `clip_${ranges.length - 1}`, {
        startFrame: totalFrameSlices,
        frames,
        duration,
      });
      totalFrameSlices += frames;
    }

    const texWidth = stride;
    const texHeight = Math.max(1, totalFrameSlices * rowsPerFrame);
    const pixels = new Float32Array(texWidth * texHeight * 4);
    const mixer = new THREE.AnimationMixer(clonedRoot);
    const v = new THREE.Vector3();

    for (const r of ranges) {
      const action = mixer.clipAction(r.clip);
      action.reset();
      action.play();
      for (let f = 0; f < r.frames; f++) {
        const t = r.frames > 1 ? (f / (r.frames - 1)) * r.duration : 0;
        mixer.setTime(t);
        clonedRoot.updateMatrixWorld(true);
        srcMesh.skeleton?.update?.();
        const globalFrame = r.startFrame + f;
        for (let vi = 0; vi < vertCount; vi++) {
          v.fromBufferAttribute(posAttr, vi);
          srcMesh.applyBoneTransform(vi, v);
          const tx = vi % stride;
          const ty = globalFrame * rowsPerFrame + Math.floor(vi / stride);
          const pIdx = (ty * texWidth + tx) * 4;
          pixels[pIdx] = v.x;
          pixels[pIdx + 1] = v.y;
          pixels[pIdx + 2] = v.z;
          pixels[pIdx + 3] = 1;
        }
      }
      action.stop();
    }
    mixer.stopAllAction?.();
    mixer.uncacheRoot?.(clonedRoot);

    vatTexture = new THREE.DataTexture(pixels, texWidth, texHeight, THREE.RGBAFormat, THREE.FloatType);
    vatTexture.minFilter = THREE.NearestFilter;
    vatTexture.magFilter = THREE.NearestFilter;
    if (THREE.NoColorSpace !== undefined) vatTexture.colorSpace = THREE.NoColorSpace;
    vatTexture.needsUpdate = true;

    vatMeta = { width: texWidth, height: texHeight, stride, rowsPerFrame, totalFrames: totalFrameSlices };

    crowdMaterial.customProgramCacheKey = () => `hgame-vat-crowd-v1:${stride}:${rowsPerFrame}`;
    const prevOnBeforeCompile = crowdMaterial.onBeforeCompile;
    crowdMaterial.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.(shader, renderer);
      shader.uniforms.uCrowdVat = { value: vatTexture };
      shader.uniforms.uCrowdVatStride = { value: stride };
      shader.uniforms.uCrowdRowsPerFrame = { value: rowsPerFrame };

      shader.vertexShader = [
        'attribute vec4 aCrowdAnim;',
        'uniform sampler2D uCrowdVat;',
        'uniform int uCrowdVatStride;',
        'uniform int uCrowdRowsPerFrame;',
        'varying float vCrowdFlash;',
        'vec3 hgameFetchVatPos(int frameIdx) {',
        '  int vid = gl_VertexID;',
        '  int tx = vid % uCrowdVatStride;',
        '  int ty = frameIdx * uCrowdRowsPerFrame + (vid / uCrowdVatStride);',
        '  return texelFetch(uCrowdVat, ivec2(tx, ty), 0).xyz;',
        '}',
      ].join('\n') + '\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  vec3 vatA = hgameFetchVatPos(int(aCrowdAnim.x));',
          '  vec3 vatB = hgameFetchVatPos(int(aCrowdAnim.y));',
          '  transformed = mix(vatA, vatB, aCrowdAnim.z);',
          '  vCrowdFlash = aCrowdAnim.w;',
          '}',
        ].join('\n'),
      );

      shader.fragmentShader = 'varying float vCrowdFlash;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(vCrowdFlash, 0.0, 1.0));',
        ].join('\n'),
      );
    };
  }

  let animAttr = null;
  if (THREE.InstancedBufferAttribute) {
    animAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    bakedGeometry.setAttribute('aCrowdAnim', animAttr);
  }

  const batch = createInstancedBatch3D(THREE, {
    geometry: bakedGeometry,
    material: crowdMaterial,
    capacity,
    castShadow,
    receiveShadow,
    perInstanceColor,
    cullRadius,
  });

  const agentClip = new Array(capacity).fill(null);
  const agentTime = new Float32Array(capacity);
  const agentSpeed = new Float32Array(capacity).fill(1);
  const agentFlash = new Float32Array(capacity);
  const agentFlashRate = new Float32Array(capacity);
  const defaultClipName = clipMeta.size > 0 ? clipMeta.keys().next().value : null;
  const activeSet = new Set();

  function spawn({
    x = 0, y = 0, z = 0,
    rotationY = 0, scale: agentScale = scale,
    clip = defaultClipName, time = 0, speed = 1,
    color = null,
  } = {}) {
    const idx = batch.alloc({ x, y, z, rotationY, scale: agentScale, radius: cullRadius * agentScale, color });
    if (idx < 0) return -1;
    agentClip[idx] = clip && clipMeta.has(clip) ? clipMeta.get(clip) : (defaultClipName ? clipMeta.get(defaultClipName) : null);
    agentTime[idx] = time;
    agentSpeed[idx] = speed;
    agentFlash[idx] = 0;
    agentFlashRate[idx] = 0;
    activeSet.add(idx);
    return idx;
  }

  function play(idx, clipName, { speed = 1, randomizePhase = false, phase = 0 } = {}) {
    const meta = clipMeta.get(clipName);
    if (!meta || idx < 0 || idx >= capacity) return false;
    agentClip[idx] = meta;
    agentSpeed[idx] = speed;
    agentTime[idx] = randomizePhase ? (phase * meta.duration) : 0;
    return true;
  }

  function hitFlash(idx, duration = 0.08) {
    if (idx < 0 || idx >= capacity || !activeSet.has(idx)) return false;
    if (!(duration > 0)) {
      agentFlash[idx] = 0;
      agentFlashRate[idx] = 0;
      return true;
    }
    agentFlash[idx] = 1;
    agentFlashRate[idx] = 1 / duration;
    return true;
  }

  function kill(idx) {
    const ok = batch.free(idx);
    if (ok) {
      agentClip[idx] = null;
      activeSet.delete(idx);
    }
    return ok;
  }

  function update(dt = 0, { culler = null } = {}) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const animArr = animAttr?.array ?? null;
    if (step > 0) {
      for (const idx of activeSet) {
        agentTime[idx] += step * agentSpeed[idx];
        if (agentFlashRate[idx] > 0) {
          const next = agentFlash[idx] - agentFlashRate[idx] * step;
          if (next <= 0) {
            agentFlash[idx] = 0;
            agentFlashRate[idx] = 0;
          } else {
            agentFlash[idx] = next;
          }
        }
      }
    }

    const flushStats = batch.flush({
      culler,
      onVisible: animArr
        ? (outSlot, idx) => {
            const meta = agentClip[idx];
            const base = outSlot * 4;
            if (meta && meta.frames > 0 && meta.duration > 0) {
              const norm = ((agentTime[idx] % meta.duration) + meta.duration) % meta.duration;
              const maxF = Math.max(0, meta.frames - 1);
              const framePos = maxF > 0 ? (norm / meta.duration) * maxF : 0;
              const f0 = Math.min(maxF, Math.floor(framePos));
              const f1 = f0 + 1 < meta.frames ? f0 + 1 : f0;
              animArr[base]     = meta.startFrame + f0;
              animArr[base + 1] = meta.startFrame + f1;
              animArr[base + 2] = framePos - f0;
            } else {
              const f = meta?.startFrame ?? 0;
              animArr[base] = f; animArr[base + 1] = f; animArr[base + 2] = 0;
            }
            animArr[base + 3] = agentFlash[idx] ?? 0;
          }
        : null,
    });
    if (animAttr) animAttr.needsUpdate = true;
    return {
      activeCount: flushStats.totalActive,
      visibleCount: flushStats.visible,
      culledCount: flushStats.culled,
      drawCalls: flushStats.visible > 0 ? 1 : 0,
    };
  }

  function dispose() {
    activeSet.clear();
    batch.dispose();
    bakedGeometry.dispose?.();
    crowdMaterial.dispose?.();
    vatTexture?.dispose?.();
    vatTexture = null;
  }

  return {
    mesh: batch.mesh,
    capacity,
    get vatTexture() { return vatTexture; },
    get vatInfo() { return vatMeta ? { ...vatMeta } : null; },
    get count() { return batch.count; },
    getClipNames: () => [...clipMeta.keys()],
    spawn,
    setTransform: batch.setTransform,
    setRotation: batch.setRotation,
    setColor: batch.setColor,
    play,
    hitFlash,
    kill,
    clear: () => {
      batch.clear();
      activeSet.clear();
    },
    update,
    dispose,
  };
}

/** GLTF / skinned-model provider. */

import { cleanupAll } from '../../internal/cleanup.js';

/**
 * Options for {@link createModel3DProvider}.
 * @typedef {object} Model3DProviderOptions
 * @property {import('./helpers.js').Model3DThree} THREE Three.js namespace (required).
 * @property {(new () => import('./helpers.js').Model3DLoader) | null} [GLTFLoader=null] GLTFLoader constructor used when `loader` is not given.
 * @property {import('./helpers.js').Model3DLoader | null} [loader=null] Loader instance.
 * @property {((source: import('./helpers.js').Model3DObject) => import('./helpers.js').Model3DObject) | null} [cloneSkeleton=null] Custom hierarchy cloner (e.g. SkeletonUtils.clone).
 * @property {string | URL | null} [projectBaseUrl=null] Base URL that relative asset paths resolve against.
 */

/**
 * A loaded or registered model asset.
 * @typedef {object} Model3DAssetEntry
 * @property {string} key Normalized relative asset key.
 * @property {import('./helpers.js').Model3DObject} scene Source scene graph.
 * @property {import('./helpers.js').Model3DClip[]} animations Animation clips.
 * @property {unknown} gltf Raw loader result, or null for registered assets.
 * @property {boolean} owned True when the provider disposes the resources on `dispose()`.
 */

/**
 * Options for {@link Model3DProvider.loadClips}.
 * @typedef {import('./helpers.js').PrepareAnimationClipsOptions & { clipName?: string | null }} Model3DLoadClipsOptions
 * Extra property `clipName` renames the clip when the file holds exactly one clip (default `null`).
 */

/**
 * Options for {@link Model3DProvider.registerAsset}.
 * @typedef {object} Model3DRegisterAssetOptions
 * @property {import('./helpers.js').Model3DObject} scene Cloneable scene root.
 * @property {import('./helpers.js').Model3DClip[]} [animations=[]] Animation clips.
 * @property {boolean} [owned=false] Dispose resources on provider `dispose()`.
 */

/**
 * A cloned model instance.
 * @typedef {object} Model3DInstance
 * @property {import('./helpers.js').Model3DObject} root Cloned hierarchy.
 * @property {import('./helpers.js').Model3DClip[]} animations Source clips.
 */

/**
 * Animation notify definition.
 * @typedef {object} Model3DNotifyOptions
 * @property {string | null} [id=null] Stable id (auto-generated when null; same id replaces).
 * @property {string} [name='Notify'] Display name.
 * @property {number} [time] Trigger time in seconds (takes precedence over `normalizedTime`).
 * @property {number} [normalizedTime] Trigger position 0..1 of the clip duration.
 * @property {((event: Model3DNotifyEvent) => void) | null} [callback=null] Per-notify callback.
 * @property {unknown} [data] User payload forwarded to the event.
 * @property {string} [clipName] Clip name (array form of `notifies` only).
 */

/**
 * Event passed to notify callbacks.
 * @typedef {object} Model3DNotifyEvent
 * @property {string} id Notify id.
 * @property {string} name Notify name.
 * @property {string} clipName Clip that fired it.
 * @property {number} time Trigger time in seconds.
 * @property {number} normalizedTime Trigger position 0..1.
 * @property {number} duration Clip duration in seconds.
 * @property {number} loopCount Loop lap index (0 for non-looping).
 * @property {unknown} data User payload.
 * @property {Model3DComponent} component Owning component.
 */

/**
 * Options for {@link Model3DProvider.createComponent}.
 * @typedef {object} Model3DComponentOptions
 * @property {import('./helpers.js').Model3DAsset | null} [asset=null] Loaded asset (requires `scene`).
 * @property {import('./helpers.js').Model3DObject | null} [root=null] Pre-built root (alternative to `asset`; not cloned).
 * @property {import('./helpers.js').Model3DClip[] | null} [animations=null] Clips overriding `asset.animations`.
 * @property {string | null} [clip=null] Clip to play on awake.
 * @property {boolean} [loop=true] Default loop flag.
 * @property {number} [timeScale=1] Default playback speed multiplier.
 * @property {number} [crossFadeSeconds=0.18] Default cross-fade duration in seconds.
 * @property {boolean} [castShadow=false] Meshes cast shadows.
 * @property {boolean} [receiveShadow=false] Meshes receive shadows.
 * @property {number} [offsetY=0] Vertical offset in world units.
 * @property {number} [scale=1] Uniform scale.
 * @property {number | null} [targetHeight=null] Auto-scale so the model is this tall (world units).
 * @property {boolean} [alignGround=false] Shift so the bounds minimum sits at y=0.
 * @property {number} [rotationY=0] Model yaw in radians.
 * @property {boolean} [stripNamespace=false] Strip namespace prefixes from bone/track names.
 * @property {boolean|'xz'|'xyz'} [stripRootMotion=false] Lock root-bone position tracks.
 * @property {string[]} [rootBoneNames] Root bone names (defaults to root, pelvis, hips, armature).
 * @property {Record<string, string> | null} [renameMap=null] Bone/track rename map.
 * @property {boolean} [interpolate=false] Use render-alpha interpolated transforms.
 * @property {boolean} [enableLod=true] Distance-based animation tick throttling.
 * @property {number[]} [lodDistances=[20,42,75]] Three world-unit distances for 1/2, 1/4, 1/8 tick rates.
 * @property {boolean} [cull=false] Frustum-cull the model each update.
 * @property {number | null} [cullRadius=null] Cull sphere radius in world units (auto when null).
 * @property {number | null} [shadowDistance=null] Max world distance for casting shadows (renderer preset when null).
 * @property {Model3DNotifyOptions[] | Record<string, Model3DNotifyOptions[]> | null} [notifies=null] Initial notifies (array with `clipName`, or map of clip name to list).
 * @property {((event: Model3DNotifyEvent) => void) | null} [onNotify=null] Fires for every notify.
 */

/**
 * Options for {@link Model3DComponent.play}.
 * @typedef {object} Model3DPlayOptions
 * @property {boolean} [loop] Loop flag (defaults to the component default).
 * @property {number} [crossFadeSeconds] Cross-fade seconds (defaults to the component default).
 * @property {number} [timeScale] Speed multiplier (defaults to the component default).
 * @property {((clipName: string) => void) | null} [onComplete=null] Called when a non-looping clip finishes.
 */

/**
 * Options for {@link Model3DComponent.playOverlay}.
 * @typedef {object} Model3DOverlayOptions
 * @property {number} [weight=0.85] Effective blend weight 0..1.
 * @property {boolean} [loop=false] Loop the overlay.
 * @property {number} [fadeIn=0.1] Fade-in seconds.
 * @property {number} [fadeOut=0.15] Fade-out seconds.
 * @property {number} [timeScale] Speed multiplier (defaults to the component default).
 * @property {((clipName: string) => void) | null} [onComplete=null] Called when a non-looping overlay finishes.
 */

/**
 * Options for {@link Model3DComponent.attachToBone}.
 * @typedef {object} Model3DAttachOptions
 * @property {{x?: number, y?: number, z?: number} | null} [position=null] Local position (world units).
 * @property {{x?: number, y?: number, z?: number} | null} [rotation=null] Local Euler rotation in radians.
 * @property {number | {x?: number, y?: number, z?: number} | null} [scale=null] Uniform or per-axis scale.
 */

/**
 * Handle returned by {@link Model3DComponent.attachToBone}.
 * @typedef {object} Model3DAttachment
 * @property {import('./helpers.js').Model3DObject} bone Bone the child is attached to.
 * @property {import('./helpers.js').Model3DObject} object Attached child.
 * @property {() => void} detach Removes the child from the bone.
 */

/**
 * Component created by {@link Model3DProvider.createComponent} (extends the core `Component`).
 * @typedef {import('../../core/component.js').Component & {
 *   object3d: import('./helpers.js').Model3DObject,
 *   modelRoot: import('./helpers.js').Model3DObject,
 *   mixer: { [member: string]: unknown } | null,
 *   getClipNames(): string[],
 *   addNotify(clipName: string, options?: Model3DNotifyOptions): string,
 *   removeNotify(clipName: string, idOrName: string): boolean,
 *   clearNotifies(clipName?: string | null): boolean,
 *   findBone(boneName: string): import('./helpers.js').Model3DObject | null,
 *   attachToBone(boneName: string, child: import('./helpers.js').Model3DObject, options?: Model3DAttachOptions): Model3DAttachment,
 *   play(name: string, options?: Model3DPlayOptions): boolean,
 *   playOverlay(name: string, options?: Model3DOverlayOptions): boolean,
 *   stopOverlay(fadeOut?: number): boolean,
 *   stop(): void,
 *   updateTransform(): void,
 * }} Model3DComponent
 */

/**
 * Provider API returned by {@link createModel3DProvider}.
 * @typedef {object} Model3DProvider
 * @property {import('./helpers.js').Model3DThree} THREE The Three.js namespace passed in.
 * @property {(url: string) => Promise<Model3DAssetEntry>} load Loads (and caches) a GLTF by relative path.
 * @property {(url: string, options?: Model3DLoadClipsOptions) => Promise<import('./helpers.js').Model3DClip[]>} loadClips Loads and prepares animation clips from a file.
 * @property {(urlOrKey: string, options: Model3DRegisterAssetOptions) => Model3DAssetEntry} registerAsset Registers an in-memory asset.
 * @property {(urlOrKey: string) => Promise<Model3DInstance>} instantiate Loads and clones an asset.
 * @property {(assetOrRoot: import('./helpers.js').Model3DAsset | import('./helpers.js').Model3DObject, explicitAnimations?: import('./helpers.js').Model3DClip[] | null) => import('./helpers.js').Model3DInspection} inspect Inspects bounds, bones, and clips.
 * @property {(options?: Model3DComponentOptions) => Model3DComponent} createComponent Creates an animated model component.
 * @property {(options?: import('./crowd.js').InstancedCrowd3DOptions) => import('./crowd.js').InstancedCrowd3D} createCrowd Creates a VAT instanced crowd.
 * @property {(options?: import('./budget.js').AnimationBudgetAllocatorOptions) => import('./budget.js').AnimationBudgetAllocator} createBudgetAllocator Creates an animation budget allocator.
 * @property {() => Promise<boolean>} dispose Disposes owned resources; false when already disposed.
 */
import { SCRATCH_WORLD_MAT, DEFAULT_ROOT_BONE_NAMES, stripNodeNamespace, resolveRelativeAssetPath, cloneObject3DWithSkins, computeRootBounds, inspectModel3D, prepareAnimationClips, disposeObjectResources, loadWithLoader } from './helpers.js';
import { createAnimationBudgetAllocator } from './budget.js';
import { createInstancedCrowd3D } from './crowd.js';
import { Component } from '../../core/component.js';

/**
 * Creates a clean-room GLTF / skinned-model & animation provider compatible with
 * `app.installFeatures({ model3d })`.
 * @param {Model3DProviderOptions} options Provider options.
 * @returns {Model3DProvider} Provider API.
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
  const inFlightGltf = new Map();
  const ownedRoots = new Set();
  const pendingLoads = new Set();
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

  // Model and animation callers share only concurrent requests. The model and
  // clip caches retain their existing ownership and independent retry behavior.
  function loadSharedGltf(key, resolved) {
    let request = inFlightGltf.get(key);
    if (!request) {
      request = Promise.resolve().then(() => {
        ensureActive();
        return loadWithLoader(getLoader(), resolved);
      });
      inFlightGltf.set(key, request);
      const clear = () => { if (inFlightGltf.get(key) === request) inFlightGltf.delete(key); };
      request.then(clear, clear);
    }
    return request;
  }

  async function load(url) {
    ensureActive();
    const { key, resolved } = resolveRelativeAssetPath(url, projectBaseUrl);
    if (!cache.has(key)) {
      const request = Promise.resolve().then(async () => {
        ensureActive();
        const gltf = await loadSharedGltf(key, resolved);
        if (!gltf || !gltf.scene) {
          throw new Error('Loaded GLTF asset contains no scene: ' + key);
        }
        // A replaced key can still have live clones using its original resources.
        ownedRoots.add(gltf.scene);
        ensureActive();
        return {
          key,
          scene: gltf.scene,
          animations: Array.isArray(gltf.animations) ? gltf.animations : [],
          gltf,
          owned: true,
        };
      });
      cache.set(key, request);
      pendingLoads.add(request);
      request.then(() => pendingLoads.delete(request), () => {
        pendingLoads.delete(request);
        if (cache.get(key) === request) cache.delete(key);
      });
    }
    const asset = await cache.get(key);
    ensureActive();
    return asset;
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
        ensureActive();
        const gltf = await loadSharedGltf(key, resolved);
        // Animation-only files can still allocate meshes, materials and textures.
        // Track the root even if disposal began while the loader was in flight.
        if (gltf?.scene) ownedRoots.add(gltf.scene);
        ensureActive();
        return Array.isArray(gltf?.animations) ? gltf.animations : [];
      });
      clipCache.set(key, request);
      pendingLoads.add(request);
      request.then(() => pendingLoads.delete(request), () => {
        pendingLoads.delete(request);
        if (clipCache.get(key) === request) clipCache.delete(key);
      });
    }
    const rawClips = await clipCache.get(key);
    ensureActive();
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
    if (entry.owned) ownedRoots.add(scene);
    cache.set(key, Promise.resolve(entry));
    return entry;
  }

  async function instantiate(urlOrKey) {
    ensureActive();
    const asset = await load(urlOrKey);
    ensureActive();
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
        // Only the built-in clone is known to create private Three skeletons.
        const ownsSkeletons = !root && !cloneSkeleton && typeof THREE.Skeleton === 'function';
        modelRoot.traverse?.((node) => {
          if (ownsSkeletons && node.isSkinnedMesh && typeof node.bind === 'function' && node.skeleton) {
            (this._ownedSkeletons ??= new Set()).add(node.skeleton);
          }
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
        const skeletons = [...(this._ownedSkeletons ?? [])];
        this._ownedSkeletons?.clear();
        cleanupAll([
          () => {
            this._pendingFinish = null;
            this._overlayAction = null;
            this._overlayOnComplete = null;
            for (const { bone, child } of this._attachments ?? []) bone.remove?.(child);
            if (this._attachments) this._attachments.length = 0;
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
          },
          ...skeletons.map(skeleton => () => skeleton.dispose?.()),
        ], 'Model3D component disposal failed');
      }
    }

    return /** @type {Model3DComponent} */ (/** @type {unknown} */ (new Model3DComponent()));
  }

  async function dispose() {
    if (disposed) return false;
    disposed = true;
    cache.clear();
    clipCache.clear();
    inFlightGltf.clear();
    const released = new WeakSet();
    const errors = [];
    const releaseReady = () => {
      const roots = [...ownedRoots];
      ownedRoots.clear();
      try { disposeObjectResources(roots, released); }
      catch (error) { errors.push(error); }
    };
    releaseReady();
    await Promise.allSettled(pendingLoads);
    releaseReady();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Model3D disposal failed');
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


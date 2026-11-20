/**
 * Clean non-pixel construction shapes for modular 3D scenes.
 * All objects are bottom-centered and share world-space PBR materials.
 * Explicit level colliders, never these meshes, define gameplay physics.
 *
 * The logical slot IDs remain stable even when replaced by authored GLBs.
 */
import { cleanupAll } from '../internal/cleanup.js';

/**
 * @typedef {object} ProceduralObject3D Minimal structural Three.js Object3D.
 * @property {string} name
 * @property {(recursive?: boolean) => ProceduralObject3D} clone
 * @property {(force?: boolean) => void} updateMatrixWorld
 * @property {(callback: (object: object) => void) => void} traverse
 */
/**
 * @typedef {object} ProceduralModelThree The subset of the THREE namespace used for procedural shapes.
 * @property {new () => ProceduralObject3D} Group
 * @property {new (width: number, height: number, depth: number) => { dispose(): void }} BoxGeometry
 * @property {new (radiusTop: number, radiusBottom: number, height: number, radialSegments: number) => { dispose(): void }} CylinderGeometry
 * @property {new (radius: number, detail: number) => { dispose(): void }} IcosahedronGeometry
 * @property {new (geometry: object, material: object|object[]) => ProceduralObject3D} Mesh
 * @property {new (geometry: object, material: object|object[], count: number) => ProceduralObject3D} InstancedMesh
 * @property {new () => object} Object3D
 * @property {new () => object} Matrix4
 */
/** @typedef {'box'|'slab'|'stair'|'column'|'foliage'|'fence'|'door'|'window'|'bench'|'lantern'|'arch'|'crate'|'barrel'|'crystal'|'rock'|'pine'|'turret'} ProceduralShape */
/**
 * @typedef {object} ProceduralSlotDefinition
 * @property {ProceduralShape} shape
 * @property {string} material Material-palette name.
 * @property {string} [accent] Accent palette name; defaults to `material`.
 * @property {string} [topMaterial] Palette name for the top face of 'box'.
 * @property {[number, number, number]} [size=[1,1,1]] Width, height, depth in world units (each 0..100].
 * @property {string|null} [replacement=null] Relative `assets/models/<name>.glb` replacement.
 * @property {string} [replacementAsset] Logical ID of a static model in the project asset catalog.
 * @property {boolean} [castShadow] Override shadow casting for instantiated meshes.
 * @property {boolean} [receiveShadow] Override shadow receiving for instantiated meshes.
 */
/**
 * @typedef {object} ProceduralSlotSpec
 * @property {ProceduralShape} shape
 * @property {string} material
 * @property {string} accent
 * @property {string|null} topMaterial
 * @property {[number, number, number]} size
 * @property {string|null} replacement
 * @property {string} [replacementAsset]
 * @property {boolean} [castShadow]
 * @property {boolean} [receiveShadow]
 */
/**
 * @typedef {object} ProceduralModelOptions
 * @property {ProceduralModelThree} THREE
 * @property {Record<string, ProceduralSlotDefinition>} slots Keys match `group.name` (lowercase dotted ids).
 * @property {{ get(name: string): object }} materialPalette e.g. from createWorldMaterialPalette.
 * @property {Pick<ReturnType<typeof import('../platform/asset-catalog.js').createAssetCatalog>, 'get'|'url'> | null} [assetCatalog] Resolves model IDs from replacementAsset.
 * @property {(new () => { loadAsync(url: string): Promise<{ scene: ProceduralObject3D, animations?: unknown[] }> })} [GLTFLoader] Only needed if a replacement is configured.
 * @property {(url: string) => Promise<{scene: ProceduralObject3D, animations?: unknown[]}>} [loadGLTF] Optional lazy loader for replacement assets.
 * @property {(path: string, options: {signal: AbortSignal, resolvedUrl: string}) => Promise<{asset: {scene: ProceduralObject3D, animations?: unknown[]}, release: () => void}>} [acquireGLTF] Optional shared model acquisition for the slot library lifetime.
 * @property {(root: ProceduralObject3D) => ProceduralObject3D | Promise<ProceduralObject3D>} [cloneSkeleton] Skeleton-aware Three.js clone for skinned model replacements.
 * @property {string} [projectBaseUrl='http://localhost/'] Base for resolving replacement URLs.
 * @property {boolean} [instanceStaticModels=false] Instance eligible multi-mesh model replacements as well as procedural props.
 * @property {Iterable<string>} [deferredReplacements] Slot IDs that use their procedural geometry until replacements are enabled.
 */
/**
 * @typedef {object} ProceduralPlacement
 * @property {number} [x=0] World units.
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {number} [rotationY=0] Radians.
 * @property {number} [scale=1] Uniform scale, > 0.
 */
/**
 * @typedef {object} ProceduralModelSlots
 * @property {(id: string) => ProceduralSlotSpec} get Copy of a slot definition.
 * @property {(id: string) => Promise<ProceduralObject3D>} prototype Shared, cached prototype.
 * @property {(id: string) => Promise<ProceduralObject3D>} instantiate Deep clone of the prototype.
 * @property {(root: ProceduralObject3D) => void} releaseInstance Release skeletons owned by a cloned instance without disposing shared geometry or materials.
 * @property {(id: string, placements: readonly (ProceduralPlacement|{ isMatrix4: true })[]) => Promise<ProceduralObject3D>} instantiateBatch 1..20000 placements; one instance batch per eligible mesh.
 * @property {(id: string, url: string|null) => void} setReplacement
 * @property {() => boolean} enableDeferredReplacements Enable the configured replacements for subsequent builds.
 * @property {() => Promise<void>} dispose
 */

const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SHAPES = new Set(['box', 'slab', 'stair', 'column', 'foliage', 'fence', 'door',
  'window', 'bench', 'lantern', 'arch', 'crate', 'barrel', 'crystal', 'rock', 'pine', 'turret']);
const GLB = /^assets\/models\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.glb$/i;
const validateSize = (size = [1, 1, 1]) => {
  if (!Array.isArray(size) || size.length !== 3 ||
      !size.every(x => Number.isFinite(x) && x > 0 && x <= 100)) {
    throw new Error('Model size must be positive [x,y,z]');
  }
  return [...size];
};
const placement = item => {
  if (!item || typeof item !== 'object' ||
      ![item.x ?? 0, item.y ?? 0, item.z ?? 0,
        item.rotationY ?? 0, item.scale ?? 1].every(Number.isFinite) ||
      (item.scale ?? 1) <= 0) throw new Error('Invalid scene model placement');
};
const replacementPath = url => {
  if (url === null) return null;
  if (typeof url !== 'string' || !GLB.test(url)) {
    throw new Error('Replacement must be relative assets/models/<name>.glb');
  }
  return url;
};

/**
 * @param {ProceduralModelOptions} options
 * @returns {ProceduralModelSlots}
 */
export function createProceduralModelSlots({
  THREE, slots, materialPalette, assetCatalog = null, GLTFLoader, loadGLTF, acquireGLTF, cloneSkeleton, projectBaseUrl,
  instanceStaticModels = false,
  deferredReplacements = [],
} = {}) {
  if (!THREE?.Group || !THREE?.BoxGeometry || !THREE?.InstancedMesh ||
      !slots || typeof slots !== 'object' || Array.isArray(slots) ||
      typeof materialPalette?.get !== 'function') {
    throw new TypeError('THREE, slot definitions, and materialPalette are required');
  }
  if (cloneSkeleton !== undefined && typeof cloneSkeleton !== 'function') throw new TypeError('cloneSkeleton must be a function');
  const definitions = new Map();
  const skinnedRoots = new WeakMap();
  const ownedSkeletons = new Set();
  function hasSkinnedMesh(root) {
    if (skinnedRoots.has(root)) return skinnedRoots.get(root);
    let skinned = false;
    root.traverse(obj => { if (obj.isSkinnedMesh) skinned = true; });
    skinnedRoots.set(root, skinned);
    return skinned;
  }
  async function cloneModel(root) {
    if (!hasSkinnedMesh(root)) return root.clone(true);
    if (!cloneSkeleton) throw new Error('Skinned model slot requires a skeleton-aware cloneSkeleton function; use Three.js SkeletonUtils.clone');
    const sourceSkeletons = new Set();
    root.traverse(obj => { if (obj.isSkinnedMesh && obj.skeleton) sourceSkeletons.add(obj.skeleton); });
    const clone = await cloneSkeleton(root);
    clone.traverse(obj => {
      if (obj.isSkinnedMesh && obj.skeleton && !sourceSkeletons.has(obj.skeleton)) ownedSkeletons.add(obj.skeleton);
    });
    if (disposed) {
      releaseInstance(clone);
      throw new Error('Procedural model library disposed during cloning');
    }
    return clone;
  }
  function releaseInstance(root) {
    root?.traverse(obj => {
      const skeleton = obj.isSkinnedMesh ? obj.skeleton : null;
      if (skeleton && ownedSkeletons.delete(skeleton)) skeleton.dispose?.();
    });
  }
  for (const [id, raw] of Object.entries(slots)) {
    if (!ID.test(id) || !raw || typeof raw !== 'object' ||
        !SHAPES.has(raw.shape) || typeof raw.material !== 'string') {
      throw new Error('Invalid geometry definition ' + id);
    }
    const replacement = replacementPath(raw.replacement ?? null);
    if ((raw.castShadow !== undefined && typeof raw.castShadow !== 'boolean') ||
        (raw.receiveShadow !== undefined && typeof raw.receiveShadow !== 'boolean')) {
      throw new TypeError('Model slot shadow settings must be boolean: ' + id);
    }
    const replacementAsset = raw.replacementAsset;
    if (replacementAsset !== undefined) {
      if (replacement || typeof replacementAsset !== 'string' || !replacementAsset.trim()) {
        throw new Error('Expected one replacement path or catalog ID for model slot ' + id);
      }
      if (!assetCatalog) throw new Error('Model slot ' + id + ' requires an asset catalog');
      const entry = assetCatalog.get(replacementAsset);
      if (entry.kind !== 'model' || !/\.gl(?:b|tf)$/i.test(entry.path)) {
        throw new Error('Model slot ' + id + ' requires a GLB or glTF catalog model: ' + replacementAsset);
      }
    }
    // Check references eagerly, before building scene objects.
    materialPalette.get(raw.material);
    if (raw.accent) materialPalette.get(raw.accent);
    if (raw.topMaterial) materialPalette.get(raw.topMaterial);
    definitions.set(id, {
      shape: raw.shape, material: raw.material, accent: raw.accent ?? raw.material,
      topMaterial: raw.topMaterial ?? null,
      size: validateSize(raw.size),
      replacement,
      ...(replacementAsset === undefined ? {} : { replacementAsset }),
      ...(raw.castShadow === undefined ? {} : { castShadow: raw.castShadow }),
      ...(raw.receiveShadow === undefined ? {} : { receiveShadow: raw.receiveShadow }),
    });
  }
  const deferred = new Set(deferredReplacements);
  for (const id of deferred) {
    if (!definitions.has(id)) throw new Error('Unknown deferred model slot: ' + id);
  }
  const prototypes = new Map();
  const replacementCache = new Map();
  const replacementLifetime = new AbortController();
  const releaseReplacements = new Set();
  const geometries = new Set();
  const importedResources = new Set();
  let disposed = false;

  function get(id) {
    const spec = definitions.get(id);
    if (!spec) throw new Error('Unknown procedural model slot: ' + id);
    return { ...spec, size: [...spec.size] };
  }
  function makeMesh(geometry, name, x, y, z) {
    geometries.add(geometry);
    const o = new THREE.Mesh(geometry, materialPalette.get(name));
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }
  function box(parent, name, w, h, d, x, y, z, topMaterial) {
    const shape = new THREE.BoxGeometry(w, h, d);
    geometries.add(shape);
    let material = materialPalette.get(name);
    if (topMaterial) {
      const top = materialPalette.get(topMaterial);
      // BoxGeometry material order: right left top bottom front back.
      material = [material, material, top, material, material, material];
    }
    const o = new THREE.Mesh(shape, material);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
  }
  function build(id) {
    const spec = definitions.get(id);
    const [w, h, d] = spec.size;
    const m = spec.material, a = spec.accent;
    const root = new THREE.Group();
    root.name = id;
    switch (spec.shape) {
      case 'box':
        box(root, m, w, h, d, 0, h * 0.5, 0, spec.topMaterial);
        break;
      case 'slab':
        box(root, m, w, h * 0.5, d, 0, h * 0.25, 0);
        break;
      case 'stair':
        box(root, m, w, h * 0.5, d, 0, h * 0.25, 0);
        box(root, m, w, h * 0.5, d * 0.5, 0, h * 0.75, -d * 0.25);
        break;
      case 'column':
        root.add(makeMesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, h, 12),
          m, 0, h * 0.5, 0));
        break;
      case 'foliage':
        root.add(makeMesh(new THREE.IcosahedronGeometry(Math.min(w, h, d) * 0.56, 1),
          m, 0, h * 0.56, 0));
        root.children[0].scale.set(
          w / Math.min(w, h, d),
          h / Math.min(w, h, d),
          d / Math.min(w, h, d),
        );
        break;
      case 'fence':
        box(root, m, w * 0.14, h, d * 0.14, 0, h * 0.5, 0);
        box(root, a, w, h * 0.13, d * 0.15, 0, h * 0.76, 0);
        box(root, a, w, h * 0.13, d * 0.15, 0, h * 0.34, 0);
        break;
      case 'door':
        box(root, m, w * 0.8, h, d * 0.17, 0, h * 0.5, 0);
        box(root, a, w * 0.1, h * 0.07, d * 0.28,
          w * 0.2, h * 0.55, 0);
        break;
      case 'window':
        box(root, m, w, h, d * 0.11, 0, h * 0.5, 0);
        box(root, a, w * 0.09, h, d * 0.18, 0, h * 0.5, 0);
        box(root, a, w, h * 0.1, d * 0.18, 0, h * 0.5, 0);
        break;
      case 'bench':
        box(root, m, w, h * 0.14, d * 0.65, 0, h * 0.53, 0);
        box(root, m, w, h * 0.4, d * 0.12, 0, h * 0.78, -d * 0.28);
        for (const x of [-w * 0.35, w * 0.35]) {
          box(root, a, w * 0.12, h * 0.5, d * 0.14, x, h * 0.25, -d * 0.2);
          box(root, a, w * 0.12, h * 0.5, d * 0.14, x, h * 0.25, d * 0.2);
        }
        break;
      case 'lantern':
        root.add(makeMesh(new THREE.CylinderGeometry(w * 0.27, w * 0.3, h * 0.57, 8),
          a, 0, h * 0.5, 0));
        box(root, m, w * 0.72, h * 0.12, d * 0.72, 0, h * 0.16, 0);
        box(root, m, w * 0.72, h * 0.12, d * 0.72, 0, h * 0.83, 0);
        break;
      case 'arch': {
        const pillarW = w * 0.2;
        const pillarH = h * 0.76;
        box(root, m, pillarW, pillarH, d, -w * 0.4, pillarH * 0.5, 0);
        box(root, m, pillarW, pillarH, d, w * 0.4, pillarH * 0.5, 0);
        box(root, m, w, h * 0.24, d * 1.04, 0, h * 0.88, 0, spec.topMaterial);
        box(root, a, w * 0.22, h * 0.3, d * 1.1, 0, h * 0.85, 0);
        break;
      }
      case 'crate':
        box(root, m, w * 0.92, h * 0.92, d * 0.92, 0, h * 0.5, 0, spec.topMaterial);
        box(root, a, w, h * 0.12, d, 0, h * 0.12, 0);
        box(root, a, w, h * 0.12, d, 0, h * 0.88, 0);
        box(root, a, w * 0.14, h * 0.76, d * 0.98, 0, h * 0.5, 0);
        break;
      case 'barrel': {
        const r = Math.min(w, d) * 0.45;
        root.add(makeMesh(new THREE.CylinderGeometry(r * 0.92, r, h, 12), m, 0, h * 0.5, 0));
        root.add(makeMesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, h * 0.1, 12), a, 0, h * 0.24, 0));
        root.add(makeMesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, h * 0.1, 12), a, 0, h * 0.76, 0));
        break;
      }
      case 'crystal': {
        const r = Math.min(w, d) * 0.36;
        root.add(makeMesh(new THREE.ConeGeometry(r, h, 6), m, 0, h * 0.5, 0));
        const shard1 = makeMesh(new THREE.ConeGeometry(r * 0.55, h * 0.62, 5), a, -r * 0.65, h * 0.28, r * 0.35);
        shard1.rotation.z = 0.38;
        root.add(shard1);
        const shard2 = makeMesh(new THREE.ConeGeometry(r * 0.48, h * 0.54, 5), a, r * 0.6, h * 0.24, -r * 0.3);
        shard2.rotation.z = -0.34;
        root.add(shard2);
        break;
      }
      case 'rock': {
        const baseR = Math.min(w, h, d) * 0.52;
        const boulder = makeMesh(new THREE.DodecahedronGeometry(baseR, 0), m, 0, h * 0.42, 0);
        boulder.scale.set(w / (baseR * 2), (h * 0.84) / (baseR * 2), d / (baseR * 2));
        root.add(boulder);
        break;
      }
      case 'pine': {
        const trunkR = Math.min(w, d) * 0.12;
        root.add(makeMesh(new THREE.CylinderGeometry(trunkR * 0.75, trunkR, h * 0.32, 8), a, 0, h * 0.16, 0));
        const crownR = Math.min(w, d) * 0.5;
        root.add(makeMesh(new THREE.ConeGeometry(crownR, h * 0.36, 7), m, 0, h * 0.44, 0));
        root.add(makeMesh(new THREE.ConeGeometry(crownR * 0.78, h * 0.32, 7), m, 0, h * 0.65, 0));
        root.add(makeMesh(new THREE.ConeGeometry(crownR * 0.52, h * 0.28, 7), m, 0, h * 0.86, 0));
        break;
      }
      case 'turret': {
        const baseR = Math.min(w, d) * 0.44;
        root.add(makeMesh(new THREE.CylinderGeometry(baseR * 0.8, baseR, h * 0.42, 10), m, 0, h * 0.21, 0));
        box(root, a, w * 0.56, h * 0.34, d * 0.62, 0, h * 0.62, -d * 0.04);
        const barrel = makeMesh(new THREE.CylinderGeometry(w * 0.08, w * 0.09, d * 0.64, 8), a, 0, h * 0.62, d * 0.38);
        barrel.rotation.x = Math.PI * 0.5;
        root.add(barrel);
        break;
      }
    }
    root.updateMatrixWorld(true);
    return root;
  }
  async function prototype(id) {
    if (disposed) throw new Error('Procedural model library disposed');
    const spec = get(id);
    if (deferred.has(id) || (!spec.replacement && !spec.replacementAsset)) {
      if (!prototypes.has(id)) prototypes.set(id, build(id));
      return prototypes.get(id);
    }
    if (!acquireGLTF && !loadGLTF && typeof GLTFLoader !== 'function') {
      throw new Error('GLTFLoader required only if a custom GLB replacement is configured');
    }
    const url = spec.replacementAsset
      ? assetCatalog.url(spec.replacementAsset)
      : new URL(spec.replacement, projectBaseUrl ?? 'http://localhost/').href;
    if (!replacementCache.has(url)) {
      const request = Promise.resolve().then(async () => {
        if (acquireGLTF) {
          const path = spec.replacementAsset ? 'assets/' + assetCatalog.get(spec.replacementAsset).path : spec.replacement;
          const signal = replacementLifetime.signal;
          const { asset, release } = await acquireGLTF(path, { signal, resolvedUrl: url });
          if (signal.aborted || !asset?.scene || asset.animations?.length) {
            release();
            signal.throwIfAborted();
            throw new Error('Only static unanimated model replacements supported');
          }
          releaseReplacements.add(release);
          return asset.scene;
        }
        const gltf = await (loadGLTF ? loadGLTF(url) : new GLTFLoader().loadAsync(url));
        if (!gltf?.scene || gltf.animations?.length) {
          throw new Error('Only static unanimated model replacements supported');
        }
        gltf.scene.traverse(obj => {
          if (!obj.isMesh) return;
          if (obj.geometry) importedResources.add(obj.geometry);
          for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
            if (mat) importedResources.add(mat);
          }
        });
        return gltf.scene;
      });
      replacementCache.set(url, request);
      request.catch(() => replacementCache.delete(url));
    }
    return replacementCache.get(url);
  }
  async function instantiate(id) {
    const root = await cloneModel(await prototype(id));
    applyShadowOverrides(root, definitions.get(id));
    return root;
  }
  function applyShadowOverrides(root, spec) {
    if (spec.castShadow === undefined && spec.receiveShadow === undefined) return;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      if (spec.castShadow !== undefined) obj.castShadow = spec.castShadow;
      if (spec.receiveShadow !== undefined) obj.receiveShadow = spec.receiveShadow;
    });
  }
  async function instantiateBatch(id, placements) {
    if (!Array.isArray(placements) || placements.length < 1 || placements.length > 20000) {
      throw new RangeError('A batch needs 1–20,000 placements');
    }
    const spec = definitions.get(id);
    const isProcedural = deferred.has(id) || (!spec?.replacement && !spec?.replacementAsset);
    const root = await prototype(id);
    const skinned = hasSkinnedMesh(root);
    root.updateMatrixWorld(true);
    const meshes = [];
    const rootMatrix = root.matrix?.elements;
    let flattenSafe = !rootMatrix || rootMatrix.every((value, index) => value === (index % 5 === 0 ? 1 : 0));
    root.traverse(obj => {
      if (obj.isMesh) meshes.push(obj);
      if (isProcedural || !instanceStaticModels) return;
      if (obj.isLight || obj.isCamera || obj.isLine || obj.isPoints || obj.isSprite ||
          obj.visible === false || obj.frustumCulled === false || obj.renderOrder ||
          (obj.layers && obj.layers.mask !== 1)) {
        flattenSafe = false;
      }
      if (obj.isMesh && (
        obj.isInstancedMesh || obj.isBatchedMesh || obj.morphTargetInfluences?.length ||
        obj.matrixWorld?.determinant?.() <= 0 ||
        (Array.isArray(obj.material) ? obj.material : [obj.material]).some(material =>
          !material || material.transparent || material.transmission > 0 ||
          (THREE.NormalBlending !== undefined && material.blending !== THREE.NormalBlending))
      )) flattenSafe = false;
    });
    // The static model path keeps per-part transforms and material assignment.
    // Hierarchies with special rendering state retain their normal clone path.
    const opaqueProcedural = isProcedural && meshes.every(mesh =>
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every(material => !material?.transparent));
    const legacySingle = meshes.length === 1 && (isProcedural || !instanceStaticModels);
    if (!skinned && (legacySingle || (meshes.length > 0 && (opaqueProcedural || (!isProcedural && instanceStaticModels && flattenSafe))))) {
      for (const item of placements) {
        if (!item?.isMatrix4) placement(item);
      }
      const tmp = new THREE.Object3D();
      const matrix = new THREE.Matrix4();
      const batches = [];
      try {
        for (const mesh of meshes) batches.push(new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length));
        const identityParts = meshes.map(mesh => {
          const elements = mesh.matrixWorld.elements;
          return elements.every((value, index) => value === (index % 5 === 0 ? 1 : 0));
        });
        for (let i = 0; i < placements.length; i++) {
          const item = placements[i];
          if (!item.isMatrix4) {
            tmp.position.set(item.x ?? 0, item.y ?? 0, item.z ?? 0);
            tmp.rotation.set(0, item.rotationY ?? 0, 0);
            tmp.scale.setScalar(item.scale ?? 1);
            tmp.updateMatrix();
          }
          const placementMatrix = item.isMatrix4 ? item : tmp.matrix;
          for (let part = 0; part < meshes.length; part++) {
            if (identityParts[part]) {
              batches[part].setMatrixAt(i, placementMatrix);
            } else {
              matrix.multiplyMatrices(placementMatrix, meshes[part].matrixWorld);
              batches[part].setMatrixAt(i, matrix);
            }
          }
        }
        for (let part = 0; part < batches.length; part++) {
          const batch = batches[part];
          batch.instanceMatrix.needsUpdate = true;
          batch.name = meshes[part].name;
          batch.castShadow = spec.castShadow ?? meshes[part].castShadow;
          batch.receiveShadow = spec.receiveShadow ?? meshes[part].receiveShadow;
          batch.computeBoundingSphere();
        }
        if (batches.length === 1) return batches[0];
        const group = new THREE.Group();
        group.add(...batches);
        return group;
      } catch (error) {
        const failures = [error];
        for (const batch of batches) {
          try { batch.dispose?.(); } catch (cleanupError) { failures.push(cleanupError); }
        }
        if (failures.length > 1) throw new AggregateError(failures, 'Model batch creation and cleanup failed');
        throw error;
      }
    }
    const group = new THREE.Group();
    group.userData.instancingFallback = 'multi-mesh';
    try {
      for (const item of placements) {
        if (!item?.isMatrix4) placement(item);
        const obj = await cloneModel(root);
        // Keep the prototype's root transform intact, as the instanced path
        // does when it composes placement * mesh.matrixWorld.
        const placed = new THREE.Group();
        group.add(placed);
        placed.add(obj);
        applyShadowOverrides(obj, spec);
        if (item.isMatrix4) {
          placed.matrix.copy(item);
          placed.matrixAutoUpdate = false;
        } else {
          placed.position.set(item.x ?? 0, item.y ?? 0, item.z ?? 0);
          placed.rotation.y = item.rotationY ?? 0;
          placed.scale.setScalar(item.scale ?? 1);
        }
      }
    } catch (error) {
      releaseInstance(group);
      throw error;
    }
    return group;
  }
  function setReplacement(id, url) {
    if (disposed) throw new Error('Procedural model library disposed');
    const spec = definitions.get(id);
    if (!spec) throw new Error('Unknown procedural model slot: ' + id);
    spec.replacement = replacementPath(url);
    delete spec.replacementAsset;
    deferred.delete(id);
  }
  function enableDeferredReplacements() {
    if (disposed || !deferred.size) return false;
    deferred.clear();
    return true;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    replacementLifetime.abort();
    await Promise.allSettled(replacementCache.values());
    for (const resource of importedResources) {
      if (resource.isMaterial) {
        for (const tex of Object.values(resource)) {
          if (tex?.isTexture) importedResources.add(tex);
        }
      }
    }
    try {
      cleanupAll([
        ...[...ownedSkeletons, ...geometries, ...importedResources].map(resource => () => resource.dispose?.()),
        ...releaseReplacements,
      ], 'Procedural model disposal failed');
    } finally {
      ownedSkeletons.clear();
      geometries.clear();
      importedResources.clear();
      releaseReplacements.clear();
      prototypes.clear();
      replacementCache.clear();
      deferred.clear();
    }
  }
  return { get, prototype, instantiate, instantiateBatch, releaseInstance, setReplacement, enableDeferredReplacements, dispose };
}

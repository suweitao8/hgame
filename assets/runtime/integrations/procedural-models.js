/**
 * Clean non-pixel construction shapes for modular 3D scenes.
 * All objects are bottom-centered and share world-space PBR materials.
 * Explicit level colliders, never these meshes, define gameplay physics.
 *
 * The logical slot IDs remain stable even when replaced by authored GLBs.
 */
const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SHAPES = new Set(['box', 'slab', 'stair', 'column', 'foliage', 'fence', 'door',
  'window', 'bench', 'lantern']);
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

export function createProceduralModelSlots({
  THREE, slots, materialPalette, GLTFLoader, projectBaseUrl,
} = {}) {
  if (!THREE?.Group || !THREE?.BoxGeometry || !THREE?.InstancedMesh ||
      !slots || typeof slots !== 'object' || Array.isArray(slots) ||
      typeof materialPalette?.get !== 'function') {
    throw new TypeError('THREE, slot definitions, and materialPalette are required');
  }
  const definitions = new Map();
  for (const [id, raw] of Object.entries(slots)) {
    if (!ID.test(id) || !raw || typeof raw !== 'object' ||
        !SHAPES.has(raw.shape) || typeof raw.material !== 'string') {
      throw new Error('Invalid geometry definition ' + id);
    }
    // Check references eagerly, before building scene objects.
    materialPalette.get(raw.material);
    if (raw.accent) materialPalette.get(raw.accent);
    if (raw.topMaterial) materialPalette.get(raw.topMaterial);
    definitions.set(id, {
      shape: raw.shape, material: raw.material, accent: raw.accent ?? raw.material,
      topMaterial: raw.topMaterial ?? null,
      size: validateSize(raw.size),
      replacement: replacementPath(raw.replacement ?? null),
    });
  }
  const prototypes = new Map();
  const replacementCache = new Map();
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
    }
    root.updateMatrixWorld(true);
    return root;
  }
  async function prototype(id) {
    if (disposed) throw new Error('Procedural model library disposed');
    const spec = get(id);
    if (!spec.replacement) {
      if (!prototypes.has(id)) prototypes.set(id, build(id));
      return prototypes.get(id);
    }
    if (typeof GLTFLoader !== 'function') {
      throw new Error('GLTFLoader required only if a custom GLB replacement is configured');
    }
    const url = new URL(spec.replacement, projectBaseUrl ?? 'http://localhost/').href;
    if (!replacementCache.has(url)) {
      const loader = new GLTFLoader();
      const request = Promise.resolve(loader.loadAsync(url)).then(gltf => {
        if (!gltf?.scene || gltf.animations?.length) {
          throw new Error('Only static unanimated GLB replacements supported');
        }
        gltf.scene.traverse(obj => {
          if (obj.isSkinnedMesh) throw new Error('Static scene replacement cannot contain a character rig');
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
    return (await prototype(id)).clone(true);
  }
  async function instantiateBatch(id, placements) {
    if (!Array.isArray(placements) || placements.length < 1 || placements.length > 20000) {
      throw new RangeError('A batch needs 1–20,000 placements');
    }
    const root = await prototype(id);
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
    // Three.js InstancedMesh supports multi-material BoxGeometry groups, so
    // top/sides can use distinct PBR materials without cloning 81 cubes.
    if (meshes.length === 1) {
      const src = meshes[0];
      const out = new THREE.InstancedMesh(src.geometry, src.material, placements.length);
      const tmp = new THREE.Object3D();
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < placements.length; i++) {
        const item = placements[i];
        if (item?.isMatrix4) matrix.multiplyMatrices(item, src.matrixWorld);
        else {
          placement(item);
          tmp.position.set(item.x ?? 0, item.y ?? 0, item.z ?? 0);
          tmp.rotation.set(0, item.rotationY ?? 0, 0);
          tmp.scale.setScalar(item.scale ?? 1);
          tmp.updateMatrix();
          matrix.multiplyMatrices(tmp.matrix, src.matrixWorld);
        }
        out.setMatrixAt(i, matrix);
      }
      out.instanceMatrix.needsUpdate = true;
      out.castShadow = true;
      out.receiveShadow = true;
      out.computeBoundingSphere();
      return out;
    }
    // More than one mesh: keep shared geometry/materials via clone, rather
    // than merging by changing the source mesh's shape or UV.
    const group = new THREE.Group();
    group.userData.instancingFallback = 'multi-mesh';
    for (const item of placements) {
      placement(item);
      const obj = root.clone(true);
      obj.position.set(item.x ?? 0, item.y ?? 0, item.z ?? 0);
      obj.rotation.y = item.rotationY ?? 0;
      obj.scale.setScalar(item.scale ?? 1);
      group.add(obj);
    }
    return group;
  }
  function setReplacement(id, url) {
    if (disposed) throw new Error('Procedural model library disposed');
    if (!definitions.has(id)) throw new Error('Unknown procedural model slot: ' + id);
    definitions.get(id).replacement = replacementPath(url);
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await Promise.allSettled(replacementCache.values());
    for (const geo of geometries) geo.dispose();
    for (const resource of importedResources) {
      if (resource.isMaterial) {
        for (const tex of Object.values(resource)) {
          if (tex?.isTexture) importedResources.add(tex);
        }
      }
      resource.dispose?.();
    }
    geometries.clear();
    importedResources.clear();
    prototypes.clear();
    replacementCache.clear();
  }
  return { get, prototype, instantiate, instantiateBatch, setReplacement, dispose };
}

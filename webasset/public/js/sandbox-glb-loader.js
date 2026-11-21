import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ensurePbrGeometryAttributes } from './pbr-runtime.js';
import { applyUnifiedWorldLighting } from './unified-lighting.js';

export class SandboxModelLoader {
  #gltfLoader = new GLTFLoader();
  #manifest = null;
  #cache = new Map();

  constructor(options = {}) {
    this.manifestUrl = options.manifestUrl || '/assets/models/model_manifest.json';
    this.#gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  async loadManifest() {
    if (this.#manifest) return this.#manifest;
    const res = await fetch(this.manifestUrl);
    if (!res.ok) throw new Error(`Model manifest HTTP ${res.status}`);
    this.#manifest = await res.json();
    return this.#manifest;
  }

  getEntry(id) {
    return this.#manifest?.models?.find(m => m.id === id) || null;
  }

  listEntries() {
    return this.#manifest?.models || [];
  }

  async instantiate(id, { registry = null, opaqueMat = null, cutoutMat = null, lightingRig = null, useLod1 = false } = {}) {
    await this.loadManifest();
    const meta = this.getEntry(id);
    if (!meta) throw new Error(`Unknown ingested model "${id}"`);
    const url = (useLod1 && meta.lod1Url) ? meta.lod1Url : meta.url;

    let gltf = this.#cache.get(url);
    if (!gltf) {
      gltf = await this.#gltfLoader.loadAsync(url);
      this.#cache.set(url, gltf);
    }

    const root = gltf.scene.clone(true);
    root.name = `glb:${id}`;

    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const hasBoundSlots = srcMats.some(m => m?.userData?.pbrLayerSlot);
      if (hasBoundSlots && registry && (opaqueMat || cutoutMat)) {
        const defaultSlot = srcMats.find(m => m?.userData?.pbrLayerSlot)?.userData?.pbrLayerSlot || '';
        const defaultLayer = registry.resolveLayer(defaultSlot, id);
        ensurePbrGeometryAttributes(obj.geometry, defaultLayer, [1, 1, 1], 1.0);
        if (Array.isArray(obj.material) && obj.geometry.groups?.length) {
          const idAttr = obj.geometry.getAttribute('aMaterialId');
          const idxAttr = obj.geometry.getIndex();
          obj.material = obj.geometry.groups.map(grp => {
            const m = srcMats[grp.materialIndex];
            const slot = m?.userData?.pbrLayerSlot;
            const lid = slot ? registry.resolveLayer(slot, id) : defaultLayer;
            const lmeta = slot ? registry.getMeta(slot) : null;
            const end = grp.start + grp.count;
            for (let i = grp.start; i < end; i++) {
              const vi = idxAttr ? idxAttr.getX(i) : i;
              idAttr.setX(vi, lid);
            }
            return (lmeta?.alphaCutout && cutoutMat) ? cutoutMat : (opaqueMat || cutoutMat);
          });
          idAttr.needsUpdate = true;
        } else {
          const slot = srcMats[0]?.userData?.pbrLayerSlot;
          const layerMeta = registry.getMeta(slot);
          obj.material = (layerMeta?.alphaCutout && cutoutMat) ? cutoutMat : (opaqueMat || cutoutMat);
        }
      } else if (lightingRig) {
        for (const m of srcMats) {
          if (m && m.isMeshStandardMaterial) {
            applyUnifiedWorldLighting(m, lightingRig);
          }
        }
      }
    });

    return { root, meta };
  }
}

export function animateHingeNode(root, meta, openAmount = 0) {
  if (!root || !meta?.hinge) return;
  const target = root.getObjectByName(meta.hinge.node);
  if (!target) return;
  const rad = THREE.MathUtils.degToRad((meta.hinge.openAngleDeg || 90) * openAmount);
  if (meta.hinge.axis === 'x') target.rotation.x = rad;
  else if (meta.hinge.axis === 'y') target.rotation.y = rad;
  else if (meta.hinge.axis === 'z') target.rotation.z = rad;
}

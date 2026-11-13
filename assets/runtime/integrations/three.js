import { Component } from '../core/component.js';
import { createAdaptiveQualityController } from './quality3d.js';

/** The Three.js namespace is injected; this module never imports Three itself. */
export function createThreeAdapter({ THREE, canvas, width = 960, height = 540,
  pixelRatio = globalThis.devicePixelRatio || 1, cameraFov = 60, background = 0x101820,
  quality3d = null } = {}) {
  if (!THREE?.Scene || !THREE?.PerspectiveCamera || !THREE?.WebGLRenderer) {
    throw new TypeError('A complete Three.js namespace is required');
  }
  if (!canvas) throw new TypeError('Three adapter requires a canvas');
  const qualityController = quality3d === null ? null :
    createAdaptiveQualityController(quality3d);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const camera = new THREE.PerspectiveCamera(cameraFov, width / height, 0.1, 1000);
  camera.position.set(0, 4, 11);
  camera.lookAt?.(0, 0, 0);
  const worlds = new WeakMap();
  function getWorld(scene) {
    if (!worlds.has(scene)) {
      const world = new THREE.Scene();
      if (THREE.Color && 'background' in world) world.background = new THREE.Color(background);
      worlds.set(scene, world);
    }
    return worlds.get(scene);
  }
  function resize() {
    const w = Math.max(1, canvas.clientWidth || width), h = Math.max(1, canvas.clientHeight || height);
    const ratio = qualityController ?
      qualityController.planViewport(w, h, pixelRatio).pixelRatio :
      Math.max(1, Math.min(3, pixelRatio));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  return {
    THREE, renderer, camera, qualityController,
    getWorld,
    add(scene, object) { getWorld(scene).add(object); },
    remove(scene, object) { if (scene && worlds.has(scene)) getWorld(scene).remove(object); },
    render(scene) { renderer.render(getWorld(scene), camera); },
    resize,
    recordFrameInterval(ms) {
      if (qualityController?.sampleFrame(ms)) resize();
    },
    dispose() { renderer.dispose(); },
  };
}

/** Minimal renderer-owned 3D mesh component (not a physics body). */
export function createThreeMeshComponent(THREE, { type = 'box', color = 0x67d9ba, size = 1 } = {}) {
  if (!THREE?.Mesh || !THREE?.BoxGeometry || !THREE?.MeshStandardMaterial) {
    throw new TypeError('Three mesh component requires Mesh, BoxGeometry, MeshStandardMaterial');
  }
  class Mesh3D extends Component {
    awake() {
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshStandardMaterial({ color });
      this.mesh = new THREE.Mesh(geometry, material);
      this.updateTransform();
    }
    onEnable() { this.scene?.app?.renderer?.add(this.scene, this.mesh); }
    start() { this.updateTransform(); }
    update() { this.updateTransform(); }
    updateTransform() {
      if (!this.mesh || !this.entity) return;
      if (THREE.Matrix4 && this.mesh.quaternion && this.mesh.position && this.mesh.scale) {
        // Parent transforms are baked into a display matrix: meshes currently
        // live directly in the Three Scene, not the parent's Object3D node.
        // Sheared matrices (nonuniform scale with rotated descendants) cannot
        // be represented exactly by an independent Object3D's TRS.
        new THREE.Matrix4().fromArray(this.entity.worldMatrix())
          .decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
        return;
      }
      const pos = this.entity.worldPosition();
      this.mesh.position.set(pos.x, pos.y, pos.z);
      this.mesh.rotation.set(this.entity.rotationX, this.entity.rotationY, this.entity.rotationZ);
      this.mesh.scale.set(this.entity.scaleX, this.entity.scaleY, this.entity.scaleZ);
    }
    onDisable() { this.scene?.app?.renderer?.remove(this.scene, this.mesh); }
    onDestroy() {
      this.mesh?.geometry?.dispose?.();
      if (Array.isArray(this.mesh?.material)) for (const material of this.mesh.material) material.dispose?.();
      else this.mesh?.material?.dispose?.();
    }
  }
  return new Mesh3D();
}

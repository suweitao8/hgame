import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { QualityTier } from '../core/quality-presets.js';
import { createDummyHumanoid } from './dummy-humanoid.js';
import type { SkeletalAuditReport, TripoNormalizerHandle } from './tripo-normalizer.js';

export interface LoadedSkeletalActor {
  wrapper: THREE.Group;
  modelRoot: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clipNames: string[];
  audit: SkeletalAuditReport;
  playClip(name?: string): void;
  update(dt: number): void;
  dispose(): void;
}

function disposeObjectResources(root: THREE.Object3D): void {
  const disposedGeoms = new Set<THREE.BufferGeometry>();
  const disposedMats = new Set<THREE.Material>();
  const disposedTexs = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry && !disposedGeoms.has(mesh.geometry)) {
        mesh.geometry.dispose();
        disposedGeoms.add(mesh.geometry);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || disposedMats.has(m)) continue;
        disposedMats.add(m);
        const std = m as THREE.MeshStandardMaterial;
        for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) {
          if (tex && !disposedTexs.has(tex)) {
            tex.dispose();
            disposedTexs.add(tex);
          }
        }
        m.dispose();
      }
    }
  });
}

function wrapLoadedScene(
  modelRoot: THREE.Object3D,
  animations: THREE.AnimationClip[],
  normalizer: TripoNormalizerHandle,
  quality: QualityTier,
  targetHeightMeters: number
): LoadedSkeletalActor {
  const wrapper = new THREE.Group();
  wrapper.name = 'SkeletalActorWrapper';
  wrapper.add(modelRoot);

  const audit = normalizer.applyToObject(modelRoot, {
    targetHeightMeters,
    quality,
  });

  const mixer = new THREE.AnimationMixer(modelRoot);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  const clipNames = animations.map((c) => c.name);
  let activeAction: THREE.AnimationAction | null = null;

  const playClip = (name?: string) => {
    const targetName = name && actions.has(name) ? name : clipNames[0];
    if (!targetName) return;
    const next = actions.get(targetName)!;
    if (activeAction === next) return;
    if (activeAction) {
      activeAction.crossFadeTo(next, 0.25, true);
    }
    next.reset().play();
    activeAction = next;
  };

  if (clipNames.length > 0) {
    playClip(clipNames[0]);
  }

  return {
    wrapper,
    modelRoot,
    mixer,
    clipNames,
    audit,
    playClip,
    update(dt: number): void {
      mixer.update(dt);
    },
    dispose(): void {
      mixer.stopAllAction();
      mixer.uncacheRoot(modelRoot);
      disposeObjectResources(modelRoot);
      wrapper.clear();
    },
  };
}

export async function loadSkeletalFromGlbBuffer(
  buffer: ArrayBuffer,
  normalizer: TripoNormalizerHandle,
  options: { quality?: QualityTier; targetHeightMeters?: number } = {}
): Promise<LoadedSkeletalActor> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    }
  );
  return wrapLoadedScene(
    gltf.scene,
    gltf.animations ?? [],
    normalizer,
    options.quality ?? 'HIGH',
    options.targetHeightMeters ?? 1.75
  );
}

export async function loadSkeletalFromUrl(
  url: string,
  normalizer: TripoNormalizerHandle,
  options: { quality?: QualityTier; targetHeightMeters?: number } = {}
): Promise<LoadedSkeletalActor> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  return wrapLoadedScene(
    gltf.scene,
    gltf.animations ?? [],
    normalizer,
    options.quality ?? 'HIGH',
    options.targetHeightMeters ?? 1.75
  );
}

export function createNormalizedDummyActor(
  normalizer: TripoNormalizerHandle,
  options: { quality?: QualityTier; targetHeightMeters?: number } = {}
): LoadedSkeletalActor {
  const { root, animations } = createDummyHumanoid();
  return wrapLoadedScene(
    root,
    animations,
    normalizer,
    options.quality ?? 'HIGH',
    options.targetHeightMeters ?? 1.75
  );
}

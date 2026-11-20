declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { AnimationClip, Group } from 'three';

  export interface GLTF {
    scene: Group;
    scenes: Group[];
    animations: AnimationClip[];
  }

  export class GLTFLoader {
    loadAsync(url: string): Promise<GLTF>;
    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (err: unknown) => void
    ): void;
  }
}

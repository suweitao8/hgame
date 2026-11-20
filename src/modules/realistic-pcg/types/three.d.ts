// Minimal structural TypeScript declarations for Three.js r187 used by realistic-pcg.
declare module 'three' {
  export const REVISION: string;

  export const SRGBColorSpace: string;
  export const NoColorSpace: string;
  export const LinearSRGBColorSpace: string;

  export const RepeatWrapping: number;
  export const ClampToEdgeWrapping: number;
  export const LinearFilter: number;
  export const NearestFilter: number;
  export const LinearMipmapLinearFilter: number;
  export const RGBAFormat: number;
  export const UnsignedByteType: number;
  export const HalfFloatType: number;
  export const GLSL3: string;

  export const FrontSide: number;
  export const BackSide: number;
  export const DoubleSide: number;

  export const ACESFilmicToneMapping: number;
  export const NoToneMapping: number;
  export const PCFSoftShadowMap: number;
  export const BasicShadowMap: number;
  export const PCFShadowMap: number;

  export class Vector2 {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
    set(x: number, y: number): this;
    copy(v: Vector2): this;
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    normalize(): this;
    length(): number;
    distanceTo(v: Vector3): number;
    clone(): Vector3;
    cross(v: Vector3): this;
    crossVectors(a: Vector3, b: Vector3): this;
    dot(v: Vector3): number;
    applyEuler(e: Euler): this;
    applyMatrix4(m: Matrix4): this;
    setFromMatrixPosition(m: Matrix4): this;
    setFromSphericalCoords(radius: number, phi: number, theta: number): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    order: string;
    constructor(x?: number, y?: number, z?: number, order?: string);
    set(x: number, y: number, z: number, order?: string): this;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    setFromEuler(euler: Euler): this;
    copy(q: Quaternion): this;
  }

  export class Matrix4 {
    elements: number[];
    compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
    makeTranslation(x: number, y: number, z: number): this;
    makeRotationY(theta: number): this;
    multiply(m: Matrix4): this;
    identity(): this;
  }

  export class Box3 {
    min: Vector3;
    max: Vector3;
    constructor(min?: Vector3, max?: Vector3);
    setFromObject(object: Object3D): this;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
    isEmpty(): boolean;
    makeEmpty(): this;
    expandByPoint(p: Vector3): this;
  }

  export class Color {
    r: number;
    g: number;
    b: number;
    constructor(color?: string | number | Color);
    set(color: string | number | Color): this;
    setHex(hex: number): this;
    setRGB(r: number, g: number, b: number, colorSpace?: string): this;
    copy(c: Color): this;
    clone(): Color;
  }

  export class BufferAttribute {
    array: ArrayLike<number>;
    itemSize: number;
    count: number;
    needsUpdate: boolean;
    constructor(array: ArrayLike<number>, itemSize: number, normalized?: boolean);
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
    setXYZ(index: number, x: number, y: number, z: number): this;
  }

  export class Float32BufferAttribute extends BufferAttribute {
    constructor(array: Float32Array | number[], itemSize: number, normalized?: boolean);
  }

  export class Uint32BufferAttribute extends BufferAttribute {
    constructor(array: Uint32Array | number[], itemSize: number, normalized?: boolean);
  }

  export class Uint16BufferAttribute extends BufferAttribute {
    constructor(array: Uint16Array | number[], itemSize: number, normalized?: boolean);
  }

  export class BufferGeometry {
    attributes: Record<string, BufferAttribute>;
    index: BufferAttribute | null;
    boundingBox: Box3 | null;
    setAttribute(name: string, attribute: BufferAttribute): this;
    getAttribute(name: string): BufferAttribute | undefined;
    setIndex(index: BufferAttribute | number[] | null): this;
    getIndex(): BufferAttribute | null;
    computeVertexNormals(): void;
    computeBoundingBox(): void;
    computeBoundingSphere(): void;
    translate(x: number, y: number, z: number): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    scale(x: number, y: number, z: number): this;
    clone(): BufferGeometry;
    dispose(): void;
  }

  export class BoxGeometry extends BufferGeometry {
    constructor(w?: number, h?: number, d?: number);
  }

  export class SphereGeometry extends BufferGeometry {
    constructor(r?: number, ws?: number, hs?: number);
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(rt?: number, rb?: number, h?: number, rs?: number, hs?: number);
  }

  export class PlaneGeometry extends BufferGeometry {
    constructor(w?: number, h?: number, ws?: number, hs?: number);
  }

  export class Texture {
    isTexture: boolean;
    image: { data?: Uint8Array; width: number; height: number; depth?: number } | HTMLImageElement | HTMLCanvasElement | undefined;
    format: number;
    type: number;
    colorSpace: string;
    wrapS: number;
    wrapT: number;
    minFilter: number;
    magFilter: number;
    anisotropy: number;
    generateMipmaps: boolean;
    needsUpdate: boolean;
    flipY: boolean;
    dispose(): void;
  }

  export class DataArrayTexture extends Texture {
    constructor(data?: Uint8Array | null, width?: number, height?: number, depth?: number);
  }

  export class Material {
    name: string;
    side: number;
    transparent: boolean;
    opacity: number;
    vertexColors: boolean;
    toneMapped: boolean;
    depthWrite: boolean;
    needsUpdate: boolean;
    userData: Record<string, unknown>;
    onBeforeCompile: (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;
    customProgramCacheKey(): string;
    dispose(): void;
  }

  export interface WebGLProgramParametersWithUniforms {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  }

  export class MeshStandardMaterial extends Material {
    color: Color;
    roughness: number;
    metalness: number;
    envMapIntensity: number;
    map: Texture | null;
    normalMap: Texture | null;
    normalScale: Vector2;
    roughnessMap: Texture | null;
    metalnessMap: Texture | null;
    aoMap: Texture | null;
    aoMapIntensity: number;
    emissive: Color;
    emissiveIntensity: number;
    constructor(parameters?: Record<string, unknown>);
    clone(): this;
  }

  export class ShaderMaterial extends Material {
    uniforms: Record<string, { value: unknown }>;
    constructor(parameters?: Record<string, unknown>);
  }

  export class Object3D {
    name: string;
    position: Vector3;
    rotation: Euler;
    quaternion: Quaternion;
    scale: Vector3;
    matrixWorld: Matrix4;
    children: Object3D[];
    parent: Object3D | null;
    visible: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    frustumCulled: boolean;
    renderOrder: number;
    userData: Record<string, unknown>;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    clear(): this;
    traverse(callback: (object: Object3D) => void): void;
    lookAt(x: number | Vector3, y?: number, z?: number): void;
    updateMatrixWorld(force?: boolean): void;
  }

  export class Group extends Object3D {}

  export class Bone extends Object3D {}

  export class Skeleton {
    bones: Bone[];
    constructor(bones: Bone[], boneInverses?: Matrix4[]);
    dispose(): void;
  }

  export class Mesh extends Object3D {
    isMesh: boolean;
    geometry: BufferGeometry;
    material: Material | Material[];
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
  }

  export class SkinnedMesh extends Mesh {
    isSkinnedMesh: boolean;
    skeleton: Skeleton;
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    bind(skeleton: Skeleton, bindMatrix?: Matrix4): void;
  }

  export class Light extends Object3D {
    color: Color;
    intensity: number;
  }

  export class HemisphereLight extends Light {
    groundColor: Color;
    constructor(skyColor?: string | number | Color, groundColor?: string | number | Color, intensity?: number);
  }

  export class DirectionalLight extends Light {
    target: Object3D;
    shadow: {
      mapSize: Vector2;
      camera: OrthographicCamera;
      bias: number;
      normalBias: number;
      radius: number;
      map: { dispose(): void } | null;
    };
    constructor(color?: string | number | Color, intensity?: number);
  }

  export class Camera extends Object3D {
    updateMatrixWorld(force?: boolean): void;
  }

  export class PerspectiveCamera extends Camera {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    updateProjectionMatrix(): void;
  }

  export class OrthographicCamera extends Camera {
    left: number;
    right: number;
    top: number;
    bottom: number;
    near: number;
    far: number;
    constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
    updateProjectionMatrix(): void;
  }

  export class FogExp2 {
    color: Color;
    density: number;
    constructor(color: string | number | Color, density?: number);
  }

  export class Scene extends Object3D {
    background: Color | Texture | null;
    environment: Texture | null;
    fog: FogExp2 | null;
  }

  export class RenderTarget {
    texture: Texture;
    dispose(): void;
  }

  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer);
    fromScene(scene: Scene, sigma?: number, near?: number, far?: number): RenderTarget;
    compileEquirectangularShader(): void;
    dispose(): void;
  }

  export class AnimationClip {
    name: string;
    duration: number;
    tracks: unknown[];
    constructor(name?: string, duration?: number, tracks?: unknown[]);
  }

  export class KeyframeTrack {}
  export class VectorKeyframeTrack extends KeyframeTrack {
    constructor(name: string, times: number[], values: number[]);
  }
  export class QuaternionKeyframeTrack extends KeyframeTrack {
    constructor(name: string, times: number[], values: number[]);
  }

  export class AnimationAction {
    play(): this;
    stop(): this;
    reset(): this;
    fadeIn(duration: number): this;
    crossFadeTo(action: AnimationAction, duration: number, warp?: boolean): this;
    setLoop(mode: number, repetitions: number): this;
    clampWhenFinished: boolean;
  }

  export class AnimationMixer {
    constructor(root: Object3D);
    clipAction(clip: AnimationClip): AnimationAction;
    update(deltaTime: number): this;
    stopAllAction(): this;
    uncacheRoot(root: Object3D): void;
  }

  export class WebGLRenderTarget extends RenderTarget {
    width: number;
    height: number;
    textures: Texture[];
    constructor(width: number, height: number, options?: Record<string, unknown>);
  }

  export class WebGLRenderer {
    domElement: HTMLCanvasElement;
    shadowMap: { enabled: boolean; type: number; autoUpdate: boolean };
    toneMapping: number;
    toneMappingExposure: number;
    outputColorSpace: string;
    info: {
      render: { calls: number; triangles: number; frame: number; lines: number; points: number };
      memory: { geometries: number; textures: number };
    };
    capabilities: {
      isWebGL2: boolean;
      getMaxAnisotropy(): number;
      maxTextureSize: number;
    };
    properties: {
      get(object: unknown): Record<string, unknown>;
    };
    constructor(parameters?: Record<string, unknown>);
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio(value: number): void;
    getRenderTarget(): RenderTarget | null;
    setRenderTarget(target: RenderTarget | null): void;
    readRenderTargetPixels(
      renderTarget: RenderTarget,
      x: number,
      y: number,
      width: number,
      height: number,
      buffer: Uint8Array | Float32Array,
      activeCubeFaceIndex?: number,
      textureIndex?: number
    ): void;
    render(scene: Scene, camera: Camera): void;
    getContext(): WebGL2RenderingContext;
    dispose(): void;
  }
}

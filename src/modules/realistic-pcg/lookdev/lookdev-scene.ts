import * as THREE from 'three';
import { getQualityPreset, type QualityTier } from '../core/quality-presets.js';
import { extractMergedBoxes } from '../geometry/collider-exporter.js';
import { buildBeveledBoxRaw, buildBufferGeometryFromRaw } from '../geometry/metric-uv.js';
import { InstancedPropPool, type PropInstanceHandle } from '../geometry/instanced-prop-pool.js';
import { createVoxelChunk, type VoxelChunkData } from '../geometry/voxel-chunk-mesher.js';
import { createAtmospherePipeline, type AtmospherePipelineHandle } from '../lighting/atmosphere-pipeline.js';
import type { LightingPresetName } from '../lighting/procedural-ibl.js';
import type { BakeMode } from '../materials/texture-array-baker.js';
import {
  createWorldPbrMaterial,
  type BiomeOverlayMode,
  type WorldPbrMaterialHandle,
} from '../materials/world-pbr-shader.js';
import { ProceduralAssetLoader } from '../recipes/procedural-asset-loader.js';
import type { MaterialRecipe, MeshRecipe } from '../recipes/schema-types.js';
import { validateMaterialRecipe, validateMeshRecipe } from '../recipes/schema-validator.js';
import {
  createNormalizedDummyActor,
  loadSkeletalFromGlbBuffer,
  type LoadedSkeletalActor,
} from '../skeletal/skeletal-loader.js';
import { createTripoMaterialNormalizer, type TripoNormalizerHandle } from '../skeletal/tripo-normalizer.js';

export type CameraPresetName =
  | 'overview'
  | 'brick_closeup'
  | 'puddle'
  | 'character'
  | 'industrial'
  | 'interior'
  | 'plinths'
  | 'yard';

export interface LookDevMetrics {
  bakeTimeMs: number;
  maxBakeSliceMs: number;
  bakeBackend: 'gpu' | 'cpu';
  fps: number;
  drawCalls: number;
  staticDrawCalls: number;
  instancedPools: number;
  instancedProps: number;
  triangles: number;
  estimatedTextureMB: number;
  materialCount: number;
  cachedMeshCount: number;
  qualityTier: QualityTier;
  lightingPreset: LightingPresetName;
  biomeMode: BiomeOverlayMode;
  wetness: number;
  tripoNormalizationEnabled: boolean;
}

export interface HGameLookDevAPI {
  isReady(): boolean;
  getMetrics(): LookDevMetrics;
  setCameraPreset(name: CameraPresetName): void;
  setLightingPreset(name: LightingPresetName): void;
  setBiomeMode(mode: BiomeOverlayMode): void;
  setBakeMode(mode: BakeMode): Promise<void>;
  setQuality(tier: QualityTier): Promise<void>;
  setWetness(value: number): void;
  setTripoNormalizationEnabled(enabled: boolean): void;
  hotReloadMaterial(recipe: unknown): Promise<void>;
  hotReloadMesh(recipe: unknown): void;
  loadCharacterGlb(buffer: ArrayBuffer): Promise<void>;
  stressTestInstancedPool(iterations?: number): {
    iterations: number;
    poolCount: number;
    activeInstances: number;
  };
  disposeAndVerify(): { remainingGeometries: number; remainingTextures: number };
}

interface MergedPiece {
  geometry: THREE.BufferGeometry;
  pos?: [number, number, number];
  rotY?: number;
  overrideMaterialId?: number;
  disposeSource?: boolean;
}

function mergeStaticGeometries(pieces: MergedPiece[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const matIds: number[] = [];
  const indices: number[] = [];

  for (const piece of pieces) {
    const g = piece.geometry;
    const posAttr = g.getAttribute('position');
    const nrmAttr = g.getAttribute('normal');
    const uvAttr = g.getAttribute('uv');
    const colAttr = g.getAttribute('color');
    const matAttr = g.getAttribute('aMaterialId');
    const idxAttr = g.getIndex();
    if (!posAttr || !nrmAttr) continue;

    const [px, py, pz] = piece.pos ?? [0, 0, 0];
    const ry = piece.rotY ?? 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const baseVert = positions.length / 3;

    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const lz = posAttr.getZ(i);
      const rx = lx * cos + lz * sin + px;
      const rz = -lx * sin + lz * cos + pz;
      positions.push(rx, ly + py, rz);

      const nx = nrmAttr.getX(i);
      const ny = nrmAttr.getY(i);
      const nz = nrmAttr.getZ(i);
      normals.push(nx * cos + nz * sin, ny, -nx * sin + nz * cos);

      uvs.push(uvAttr ? uvAttr.getX(i) : 0, uvAttr ? uvAttr.getY(i) : 0);
      colors.push(
        colAttr ? colAttr.getX(i) : 1.0,
        colAttr ? colAttr.getY(i) : 0.25,
        colAttr ? colAttr.getZ(i) : 0.0
      );
      matIds.push(
        piece.overrideMaterialId !== undefined
          ? piece.overrideMaterialId
          : matAttr
          ? matAttr.getX(i)
          : 0
      );
    }

    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        indices.push((idxAttr.array[i] ?? 0) + baseVert);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(baseVert + i);
      }
    }

    if (piece.disposeSource) {
      g.dispose();
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normals), 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
  out.setAttribute('aMaterialId', new THREE.Float32BufferAttribute(new Float32Array(matIds), 1));
  out.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(indices), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const CAMERA_PRESETS: Record<
  CameraPresetName,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  overview: { pos: [13.5, 9.5, 15.0], target: [-0.8, 1.4, -2.0] },
  brick_closeup: { pos: [-5.8, 2.0, 0.1], target: [-6.1, 1.6, -3.5] },
  puddle: { pos: [-0.8, 0.85, 7.9], target: [-0.8, 0.35, 1.5] },
  character: { pos: [2.6, 1.45, 2.9], target: [0.9, 1.0, 0.3] },
  industrial: { pos: [-3.4, 2.9, -6.0], target: [-8.4, 1.35, -10.2] },
  interior: { pos: [3.2, 2.0, -7.6], target: [6.4, 0.9, -10.2] },
  plinths: { pos: [12.5, 4.8, 12.8], target: [6.8, 0.5, 6.2] },
  yard: { pos: [-14.8, 6.0, 14.6], target: [-8.0, 1.5, 3.0] },
};

export interface LookDevSceneController {
  api: HGameLookDevAPI;
  onStatusChange?: (metrics: LookDevMetrics) => void;
  start(): void;
  resize(width: number, height: number): void;
}

export interface CreateLookDevSceneOptions {
  canvas: HTMLCanvasElement;
  manifestUrl?: string | null;
  bundle?: {
    materials: MaterialRecipe[];
    meshes: MeshRecipe[];
  };
  initialQuality?: QualityTier;
  initialLighting?: LightingPresetName;
  initialBiome?: BiomeOverlayMode;
  initialBakeMode?: BakeMode;
  onMetricsUpdate?: (metrics: LookDevMetrics) => void;
  onAuditMessage?: (msg: string) => void;
}

export async function createLookDevScene(
  options: CreateLookDevSceneOptions
): Promise<LookDevSceneController> {
  const { canvas } = options;
  const manifestUrl = options.manifestUrl ?? null;
  let qualityTier: QualityTier = options.initialQuality ?? 'HIGH';
  let lightingPreset: LightingPresetName = options.initialLighting ?? 'OVERCAST_WET';
  let biomeMode: BiomeOverlayMode = options.initialBiome ?? 'wet_moss';
  let wetness = 0.55;
  let disposed = false;
  let ready = false;
  let rafId = 0;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const applyRendererViewport = (w: number, h: number) => {
    const preset = getQualityPreset(qualityTier);
    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 400);
  applyRendererViewport(canvas.clientWidth || 1280, canvas.clientHeight || 720);

  // Orbit camera state
  const camTarget = new THREE.Vector3(...CAMERA_PRESETS.overview.target);
  const camOffset = new THREE.Vector3(...CAMERA_PRESETS.overview.pos).sub(camTarget);
  let camRadius = camOffset.length();
  let camTheta = Math.atan2(camOffset.x, camOffset.z);
  let camPhi = Math.acos(Math.max(-0.99, Math.min(0.99, camOffset.y / camRadius)));

  const syncCamera = () => {
    const sinPhi = Math.sin(camPhi);
    camera.position.set(
      camTarget.x + camRadius * sinPhi * Math.sin(camTheta),
      camTarget.y + camRadius * Math.cos(camPhi),
      camTarget.z + camRadius * sinPhi * Math.cos(camTheta)
    );
    camera.lookAt(camTarget);
  };
  syncCamera();

  // Lightweight pointer orbit & wheel zoom
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camTheta -= dx * 0.006;
    camPhi = Math.max(0.15, Math.min(Math.PI * 0.48, camPhi - dy * 0.006));
    syncCamera();
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camRadius = Math.max(1.8, Math.min(36, camRadius * (1 + e.deltaY * 0.001)));
    syncCamera();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Atmosphere & IBL
  const atmosphere: AtmospherePipelineHandle = createAtmospherePipeline(renderer, scene, {
    initialPreset: lightingPreset,
    quality: qualityTier,
    sceneHalfExtent: 20,
  });

  // Load recipes & bake Texture2DArray asynchronously (from external manifestUrl, inline bundle, or empty drop-ready stage)
  const loader = new ProceduralAssetLoader({
    quality: qualityTier,
    renderer,
    bakeMode: options.initialBakeMode ?? 'auto',
  });
  if (options.bundle) {
    await loader.loadFromRecipes(options.bundle.materials, options.bundle.meshes);
  } else if (manifestUrl) {
    try {
      await loader.loadManifest(manifestUrl);
    } catch {
      await loader.loadFromRecipes([], []);
      options.onAuditMessage?.(`External manifest unavailable (${manifestUrl}); drop recipes to hot-reload`);
    }
  } else {
    await loader.loadFromRecipes([], []);
  }

  const texArray = loader.getTextureArray()!;
  const worldMat: WorldPbrMaterialHandle = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: false,
    globalWetness: wetness,
    groundHeight: 0,
    biomeMode,
  });
  const rockMat: WorldPbrMaterialHandle = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: getQualityPreset(qualityTier).enableTriplanar,
    globalWetness: wetness,
    groundHeight: 0,
    biomeMode,
  });

  // 1. Build 32m x 32m voxel terrain from 4 16x16x16 chunks
  const voxelChunks: VoxelChunkData[] = [];
  let terrainMesh: THREE.Mesh | null = null;
  let guardPostMesh: THREE.Mesh | null = null;
  let showcaseMesh: THREE.Mesh | null = null;
  let rockMesh: THREE.Mesh | null = null;
  let hotPreviewMesh: THREE.Mesh | null = null;

  function buildTerrain(): void {
    for (const c of voxelChunks) c.dispose();
    voxelChunks.length = 0;
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh = null;
    }

    const firstMat = loader.listMaterialIds()[0];
    const grassMatId = loader.hasMaterial('grass_mud')
      ? loader.getMaterialId('grass_mud')
      : firstMat
      ? loader.getMaterialId(firstMat)
      : 0;
    const cobbleMatId = loader.hasMaterial('mossy_cobble')
      ? loader.getMaterialId('mossy_cobble')
      : grassMatId;
    const wetConcMatId = loader.hasMaterial('wet_industrial_concrete')
      ? loader.getMaterialId('wet_industrial_concrete')
      : cobbleMatId;
    const oakFloorMatId = loader.hasMaterial('oak_plank_floor')
      ? loader.getMaterialId('oak_plank_floor')
      : cobbleMatId;
    const chunkOffsets: Array<[number, number]> = [
      [-16, -16],
      [0, -16],
      [-16, 0],
      [0, 0],
    ];
    const chunkPieces: MergedPiece[] = [];

    for (const [ox, oz] of chunkOffsets) {
      const chunk = createVoxelChunk({
        sizeX: 16,
        sizeY: 8,
        sizeZ: 16,
        voxelSize: 1.0,
        origin: [ox, -2, oz],
      });

      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const wx = ox + x + 0.5;
          const wz = oz + z + 0.5;

          // Base ground voxel at y=1 (top surface at world y = 0)
          chunk.setVoxel(x, 0, z, grassMatId, 0.1);

          // Puddle basin around (-1, 3.5) with radius ~3.8m
          const dPuddle = Math.hypot(wx + 0.8, wz - 3.6);
          const inPuddle = dPuddle < 3.6;

          // Industrial concrete dock pad (NW quadrant) & oak indoor pad (NE quadrant)
          const inIndustrialYard = wx < -3.0 && wx > -13.5 && wz < -5.5 && wz > -13.5;
          const inIndoorFloor = wx > 3.2 && wx < 9.8 && wz < -6.8 && wz > -12.8;

          // Cobble walkway leading from puddle to guard post entrance and plinths
          const onPath =
            (Math.abs(wx) < 3.5 && wz > -2.5 && wz < 8.5) ||
            (wx > 3.0 && wx < 11.5 && wz > 2.5 && wz < 10.5);
          const isBorderBerm = Math.abs(wx) > 13.5 || Math.abs(wz) > 13.5;

          if (inPuddle) {
            const wetStrength = Math.max(0.45, 1.0 - (dPuddle / 3.6) * 0.4);
            chunk.setVoxel(x, 1, z, cobbleMatId, wetStrength);
          } else if (inIndustrialYard) {
            chunk.setVoxel(x, 1, z, wetConcMatId, 0.55);
          } else if (inIndoorFloor) {
            chunk.setVoxel(x, 1, z, oakFloorMatId, 0.05);
          } else if (onPath) {
            chunk.setVoxel(x, 1, z, cobbleMatId, 0.35);
          } else {
            chunk.setVoxel(x, 1, z, grassMatId, 0.2);
          }

          // Raised voxel embankments at outer edges & puddle rim to verify 4-neighbor AO
          if (isBorderBerm) {
            chunk.setVoxel(x, 2, z, grassMatId, 0.15);
            if (Math.abs(wx) > 14.5 && Math.abs(wz) > 14.5) {
              chunk.setVoxel(x, 3, z, cobbleMatId, 0.25);
            }
          } else if (Math.abs(wx + 3.8) < 1.2 && wz > 1.5 && wz < 5.5) {
            // Low cobble curb beside puddle for crisp 4-neighbor corner AO
            chunk.setVoxel(x, 2, z, cobbleMatId, 0.45);
          }
        }
      }

      // Exercise greedy AABB collider extraction per chunk
      extractMergedBoxes(chunk);
      const chunkGeo = chunk.buildMeshGeometry();
      chunkPieces.push({ geometry: chunkGeo, disposeSource: false });
      voxelChunks.push(chunk);
    }

    const mergedTerrain = mergeStaticGeometries(chunkPieces);
    terrainMesh = new THREE.Mesh(mergedTerrain, worldMat.material);
    terrainMesh.name = 'VoxelTerrain32m';
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    scene.add(terrainMesh);
  }

  // 2. Main Guard Post merged into StaticShowcaseBatch to minimize DrawCalls
  function rebuildGuardPost(): void {
    if (guardPostMesh) {
      scene.remove(guardPostMesh);
      guardPostMesh = null;
    }
  }

  // 3. Static Showcase Batch (1 DrawCall):
  //    - Main guard_post + 1m stone brick pillar + 4m beveled brick wall
  //    - Reskinned concrete guard_post + industrial dock + interior vignette
  //    - Calibration plinths (sphere + beveled cube per registered .hmat.json)
  function rebuildShowcase(): void {
    if (showcaseMesh) {
      scene.remove(showcaseMesh);
      showcaseMesh.geometry.dispose();
      showcaseMesh = null;
    }
    const pieces: MergedPiece[] = [];

    if (loader.hasMesh('guard_post')) {
      const gpAsset = loader.instantiateMesh('guard_post');
      pieces.push({ geometry: gpAsset.geometry, pos: [0, 0, -3.5] });
    }

    if (loader.hasMesh('beveled_wall')) {
      const pillarAsset = loader.instantiateMesh('beveled_wall', {
        params: { width: 1.0, height: 3.0, thickness: 1.0, hasWindow: false },
      });
      pieces.push({ geometry: pillarAsset.geometry, pos: [-4.2, 0, -3.5] });

      const wallAsset = loader.instantiateMesh('beveled_wall', {
        params: { width: 4.0, height: 3.0, thickness: 0.35, hasWindow: true },
      });
      pieces.push({ geometry: wallAsset.geometry, pos: [-7.6, 0, -3.5] });
    }

    if (
      loader.hasMesh('guard_post') &&
      loader.hasMaterial('concrete_weathered') &&
      loader.hasMaterial('rusted_iron') &&
      loader.hasMaterial('mossy_cobble')
    ) {
      const reskinAsset = loader.instantiateMesh('guard_post', {
        materialOverrides: {
          wallMat: 'concrete_weathered',
          woodMat: 'rusted_iron',
          baseMat: 'mossy_cobble',
        },
      });
      pieces.push({ geometry: reskinAsset.geometry, pos: [8.5, 0, -4.5], rotY: -0.35 });
    }

    // Industrial Dock & Pipeline Showcase (NW zone)
    if (loader.hasMesh('shipping_container')) {
      const containerAsset = loader.instantiateMesh('shipping_container', {
        params: { doorOpen: true },
      });
      pieces.push({ geometry: containerAsset.geometry, pos: [-8.2, 0, -11.0], rotY: 0.0 });
    }
    if (loader.hasMesh('industrial_pillar')) {
      const pilA = loader.instantiateMesh('industrial_pillar', { params: { height: 3.4 } });
      pieces.push({ geometry: pilA.geometry, pos: [-4.2, 0, -8.2] });
      const pilB = loader.instantiateMesh('industrial_pillar', { params: { height: 3.4 } });
      pieces.push({ geometry: pilB.geometry, pos: [-11.8, 0, -8.2] });
    }
    if (loader.hasMesh('utility_pipe_segment')) {
      const pipeAsset = loader.instantiateMesh('utility_pipe_segment', {
        params: { length: 7.6, radius: 0.14 },
      });
      pieces.push({ geometry: pipeAsset.geometry, pos: [-8.0, 2.6, -8.2] });
    }
    if (loader.hasMesh('heavy_crate')) {
      const crateLarge = loader.instantiateMesh('heavy_crate', { params: { size: 1.1 } });
      pieces.push({ geometry: crateLarge.geometry, pos: [-4.8, 0, -6.2], rotY: 0.25 });
      const crateSmall = loader.instantiateMesh('heavy_crate', { params: { size: 0.72 } });
      pieces.push({ geometry: crateSmall.geometry, pos: [-3.5, 0, -6.5], rotY: -0.4 });
    }

    // Interior Furniture & Matte Plaster Wall Showcase (NE zone)
    if (loader.hasMesh('beveled_wall') && loader.hasMaterial('matte_plaster_wall')) {
      const plasterWall = loader.instantiateMesh('beveled_wall', {
        params: { width: 5.0, height: 2.8, thickness: 0.28, hasWindow: true },
        materialOverrides: {
          wall: 'matte_plaster_wall',
          trim: 'oak_plank_floor',
        },
      });
      pieces.push({ geometry: plasterWall.geometry, pos: [6.4, 0, -11.4] });
    }
    if (loader.hasMesh('wooden_table_chair')) {
      const tableChair = loader.instantiateMesh('wooden_table_chair');
      pieces.push({ geometry: tableChair.geometry, pos: [6.2, 0, -9.5], rotY: -0.2 });
    }

    // Material Calibration Plinths for all registered .hmat.json recipes (4 per row)
    const matIds = loader.listMaterialIds();
    for (let i = 0; i < matIds.length; i++) {
      const mName = matIds[i]!;
      const layerId = loader.getMaterialId(mName);
      const px = 3.8 + (i % 4) * 2.1;
      const pz = 3.6 + Math.floor(i / 4) * 2.2;

      const cubeRaw = buildBeveledBoxRaw(0.75, 0.75, 0.75, 0.03, layerId, 0.85, 1.0, 0.0);
      const cubeGeo = buildBufferGeometryFromRaw(cubeRaw);
      pieces.push({ geometry: cubeGeo, pos: [px - 0.42, 0.375, pz], disposeSource: true });

      const sphereGeo = new THREE.SphereGeometry(0.38, 20, 14);
      pieces.push({
        geometry: sphereGeo,
        pos: [px + 0.45, 0.42, pz],
        overrideMaterialId: layerId,
        disposeSource: true,
      });
    }

    if (pieces.length === 0) return;
    const merged = mergeStaticGeometries(pieces);
    showcaseMesh = new THREE.Mesh(merged, worldMat.material);
    showcaseMesh.name = 'StaticShowcaseBatch';
    showcaseMesh.castShadow = true;
    showcaseMesh.receiveShadow = true;
    scene.add(showcaseMesh);
  }

  // 4. Triplanar weathered rocks cluster (1 DrawCall when present)
  function rebuildRocks(): void {
    if (rockMesh) {
      scene.remove(rockMesh);
      rockMesh.geometry.dispose();
      rockMesh = null;
    }
    if (!loader.hasMesh('weathered_rock')) return;
    const rockA = loader.instantiateMesh('weathered_rock', { params: { radius: 0.95, seed: 771 } });
    const rockB = loader.instantiateMesh('weathered_rock', { params: { radius: 0.65, seed: 912 } });
    const rockC = loader.instantiateMesh('weathered_rock', { params: { radius: 1.15, seed: 1031 } });
    const merged = mergeStaticGeometries([
      { geometry: rockA.geometry, pos: [-3.9, 0, 2.2], rotY: 0.4 },
      { geometry: rockB.geometry, pos: [-4.6, 0, 3.4], rotY: 1.7 },
      { geometry: rockC.geometry, pos: [4.2, 0, 1.5], rotY: -0.9 },
    ]);
    rockMesh = new THREE.Mesh(merged, rockMat.material);
    rockMesh.name = 'TriplanarRocksBatch';
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    scene.add(rockMesh);
  }

  buildTerrain();
  rebuildGuardPost();
  rebuildShowcase();
  rebuildRocks();

  // 4B. Track B InstancedPropPool — Saltline Yard 60-instance batch (4 DrawCalls total)
  const propPool = new InstancedPropPool({
    loader,
    material: worldMat.material,
    parent: scene,
  });
  const yardHandles: PropInstanceHandle[] = [];

  function rebuildInstancedYard(): void {
    for (const h of yardHandles) propPool.remove(h);
    yardHandles.length = 0;

    if (loader.hasMesh('shipping_container')) {
      const containerSpots: Array<{ pos: [number, number, number]; rotY: number }> = [
        // West dock double-stacked shipping containers
        { pos: [-11.5, 0, 1.6], rotY: Math.PI * 0.5 },
        { pos: [-11.5, 2.59, 1.6], rotY: Math.PI * 0.5 + 0.04 },
        { pos: [-11.5, 0, 8.4], rotY: Math.PI * 0.5 - 0.03 },
        { pos: [-11.5, 2.59, 8.4], rotY: Math.PI * 0.5 + 0.02 },
        { pos: [-8.2, 0, 2.0], rotY: Math.PI * 0.5 + 0.05 },
        { pos: [-8.2, 2.59, 2.0], rotY: Math.PI * 0.5 - 0.02 },
        { pos: [-8.2, 0, 8.8], rotY: Math.PI * 0.5 },
        // South-west & North dock containers
        { pos: [-3.2, 0, 11.4], rotY: 0.03 },
        { pos: [-3.2, 2.59, 11.4], rotY: -0.04 },
        { pos: [-0.8, 0, -11.2], rotY: 0.06 },
        { pos: [-0.8, 2.59, -11.2], rotY: -0.02 },
        { pos: [2.8, 0, -11.4], rotY: Math.PI * 0.5 - 0.05 },
      ];
      for (let i = 0; i < containerSpots.length; i++) {
        const s = containerSpots[i]!;
        yardHandles.push(
          propPool.spawn(
            'shipping_container',
            {
              position: s.pos,
              rotation: [0, s.rotY, 0],
              tintJitter: ((i % 5) - 2) * 0.06,
              wearBias: (i % 4) * 0.22,
              wetnessBias: s.pos[1] < 0.1 ? 0.35 : -0.15,
            },
            { params: { doorOpen: false } }
          )
        );
      }
    }

    if (loader.hasMesh('heavy_crate')) {
      for (let i = 0; i < 20; i++) {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const stacked = i >= 15;
        const x = stacked ? -5.8 - (i - 15) * 1.15 : -5.6 - col * 1.15;
        const z = stacked ? 5.6 : 4.2 + row * 1.35;
        const y = stacked ? 1.0 : 0.0;
        yardHandles.push(
          propPool.spawn(
            'heavy_crate',
            {
              position: [x, y, z],
              rotation: [0, ((i * 37) % 10) * 0.08 - 0.35, 0],
              tintJitter: ((i % 7) - 3) * 0.045,
              wearBias: ((i * 3) % 5) * 0.2,
              wetnessBias: stacked ? -0.1 : 0.3,
            },
            { params: { size: 1.0 } }
          )
        );
      }
    }

    if (loader.hasMesh('industrial_pillar')) {
      const pillarCoords: Array<[number, number]> = [
        [-13.0, -11.5], [-13.0, -5.0], [-13.0, 2.0], [-13.0, 9.5],
        [-9.5, -13.0], [-3.5, -13.0], [3.5, -13.0], [9.5, -13.0],
        [-9.5, 12.8], [-3.0, 12.8], [3.5, 12.8], [10.0, 12.8],
        [12.6, -9.5], [12.6, -2.5], [12.6, 4.5], [12.6, 11.0],
      ];
      for (let i = 0; i < pillarCoords.length; i++) {
        const [px, pz] = pillarCoords[i]!;
        yardHandles.push(
          propPool.spawn(
            'industrial_pillar',
            {
              position: [px, 0, pz],
              rotation: [0, (i % 4) * (Math.PI * 0.5), 0],
              tintJitter: ((i % 3) - 1) * 0.07,
              wearBias: (i % 5) * 0.18,
              wetnessBias: 0.25,
            },
            { params: { height: 3.0 } }
          )
        );
      }
    }

    if (loader.hasMesh('weathered_rock')) {
      const rockCoords: Array<[number, number, number]> = [
        [-6.2, 0, -1.2], [-6.8, 0, 1.2], [-5.5, 0, 9.8], [-10.2, 0, -4.5],
        [11.8, 0, -12.2], [11.5, 0, 2.2], [11.8, 0, 11.8], [2.4, 0, 11.4],
        [-12.4, 0, -12.4], [-1.5, 0, -12.6], [6.5, 0, 12.2], [-7.2, 0, 12.6],
      ];
      for (let i = 0; i < rockCoords.length; i++) {
        const [rx, ry, rz] = rockCoords[i]!;
        const sc = 0.72 + (i % 4) * 0.14;
        yardHandles.push(
          propPool.spawn(
            'weathered_rock',
            {
              position: [rx, ry, rz],
              rotation: [0, i * 0.65, 0],
              scale: [sc, sc, sc],
              tintJitter: ((i % 5) - 2) * 0.05,
              wearBias: (i % 3) * 0.3,
              wetnessBias: 0.35,
            },
            { castShadow: false }
          )
        );
      }
    }

    propPool.flush();
  }
  rebuildInstancedYard();

  // 5. Dynamic Skeletal Character at guard post threshold / sun-shadow edge
  const normalizer: TripoNormalizerHandle = createTripoMaterialNormalizer();
  let actor: LoadedSkeletalActor = createNormalizedDummyActor(normalizer, {
    quality: qualityTier,
    targetHeightMeters: 1.75,
  });
  actor.wrapper.position.set(0.9, 0, 0.3);
  scene.add(actor.wrapper);
  options.onAuditMessage?.(
    `Dummy character: ${actor.audit.triangles} tris, ${actor.audit.boneCount} bones`
  );

  // Metrics & RAF state
  let fpsSmooth = 60;
  let lastTime = performance.now();
  let startTime = lastTime;
  let lastHudTime = 0;

  function computeMetrics(): LookDevMetrics {
    const tex = loader.getTextureArray();
    let staticDrawCalls = 0;
    if (terrainMesh) staticDrawCalls++;
    if (guardPostMesh) staticDrawCalls++;
    if (showcaseMesh) staticDrawCalls++;
    if (rockMesh) staticDrawCalls++;
    if (hotPreviewMesh) staticDrawCalls++;

    const poolStats = propPool.getStats();
    return {
      bakeTimeMs: Math.round((tex?.bakeTimeMs ?? 0) * 10) / 10,
      maxBakeSliceMs: Math.round((tex?.maxSliceMs ?? 0) * 10) / 10,
      bakeBackend: tex?.bakeBackend ?? 'cpu',
      fps: Math.round(fpsSmooth * 10) / 10,
      drawCalls: renderer.info.render.calls,
      staticDrawCalls,
      instancedPools: poolStats.poolCount,
      instancedProps: poolStats.totalInstances,
      triangles: renderer.info.render.triangles,
      estimatedTextureMB: Math.round((tex?.estimatedMemoryMB ?? 0) * 100) / 100,
      materialCount: tex?.layers.size ?? 0,
      cachedMeshCount: loader.getCachedMeshCount(),
      qualityTier,
      lightingPreset,
      biomeMode,
      wetness,
      tripoNormalizationEnabled: normalizer.isEnabled(),
    };
  }

  const renderFrame = () => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) * 0.001));
    lastTime = now;
    fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;

    const elapsed = (now - startTime) * 0.001;
    worldMat.setTime(elapsed);
    rockMat.setTime(elapsed);
    actor.update(dt);
    atmosphere.update(elapsed, camera.position);
    renderer.render(scene, camera);

    if (now - lastHudTime > 200) {
      lastHudTime = now;
      options.onMetricsUpdate?.(computeMetrics());
    }
    rafId = requestAnimationFrame(renderFrame);
  };

  const api: HGameLookDevAPI = {
    isReady: () => ready && !disposed,
    getMetrics: () => computeMetrics(),

    setCameraPreset(name: CameraPresetName): void {
      const p = CAMERA_PRESETS[name];
      if (!p) throw new Error(`Unknown camera preset "${name}"`);
      camTarget.set(...p.target);
      const off = new THREE.Vector3(...p.pos).sub(camTarget);
      camRadius = off.length();
      camTheta = Math.atan2(off.x, off.z);
      camPhi = Math.acos(Math.max(-0.99, Math.min(0.99, off.y / camRadius)));
      syncCamera();
      renderer.render(scene, camera);
    },

    setLightingPreset(name: LightingPresetName): void {
      lightingPreset = name;
      atmosphere.setPreset(name);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    setBiomeMode(mode: BiomeOverlayMode): void {
      biomeMode = mode;
      worldMat.setBiomeMode(mode);
      rockMat.setBiomeMode(mode);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    async setBakeMode(mode: BakeMode): Promise<void> {
      const updatedTex = await loader.setBakeMode(mode);
      worldMat.syncTextureArray(updatedTex);
      rockMat.syncTextureArray(updatedTex);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    async setQuality(tier: QualityTier): Promise<void> {
      qualityTier = tier;
      applyRendererViewport(canvas.clientWidth || 1280, canvas.clientHeight || 720);
      atmosphere.setQuality(tier);
      const updatedTex = await loader.setQuality(tier);
      worldMat.syncTextureArray(updatedTex);
      rockMat.syncTextureArray(updatedTex);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    setWetness(value: number): void {
      wetness = Math.max(0, Math.min(1, value));
      worldMat.setWetness(wetness);
      rockMat.setWetness(wetness);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    setTripoNormalizationEnabled(enabled: boolean): void {
      normalizer.setEnabled(enabled);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    async hotReloadMaterial(recipeRaw: unknown): Promise<void> {
      const issues = validateMaterialRecipe(recipeRaw);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new Error(`Material validation failed: ${errors.map((e) => e.message).join('; ')}`);
      }
      const recipe = recipeRaw as MaterialRecipe;
      const isNew = !loader.getMaterialRecipe(recipe.id);
      await loader.registerMaterialRecipe(recipe);
      const activeTex = loader.getTextureArray()!;
      worldMat.syncTextureArray(activeTex);
      rockMat.syncTextureArray(activeTex);
      if (isNew) {
        buildTerrain();
        rebuildShowcase();
      }
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    hotReloadMesh(recipeRaw: unknown): void {
      const knownMats = new Set(loader.listMaterialIds());
      const recipe = recipeRaw as MeshRecipe;
      const knownMeshes = new Set(loader.listMeshIds());
      if (recipe?.id) knownMeshes.add(recipe.id);
      const issues = validateMeshRecipe(recipeRaw, knownMats, knownMeshes);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new Error(`Mesh validation failed: ${errors.map((e) => e.message).join('; ')}`);
      }
      loader.registerMeshRecipe(recipe);
      if (recipe.id === 'guard_post') {
        rebuildGuardPost();
        rebuildShowcase();
      } else if (
        recipe.id === 'beveled_wall' ||
        recipe.id === 'shipping_container' ||
        recipe.id === 'industrial_pillar' ||
        recipe.id === 'utility_pipe_segment' ||
        recipe.id === 'heavy_crate' ||
        recipe.id === 'wooden_table_chair'
      ) {
        rebuildGuardPost();
        rebuildShowcase();
      } else if (recipe.id === 'weathered_rock') {
        rebuildRocks();
      } else {
        if (hotPreviewMesh) {
          scene.remove(hotPreviewMesh);
          hotPreviewMesh = null;
        }
        const asset = loader.instantiateMesh(recipe.id);
        hotPreviewMesh = new THREE.Mesh(asset.geometry, worldMat.material);
        hotPreviewMesh.name = `HotPreview_${recipe.id}`;
        hotPreviewMesh.position.set(-1.5, 0, 6.2);
        hotPreviewMesh.castShadow = true;
        hotPreviewMesh.receiveShadow = true;
        scene.add(hotPreviewMesh);
      }
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },

    async loadCharacterGlb(buffer: ArrayBuffer): Promise<void> {
      const nextActor = await loadSkeletalFromGlbBuffer(buffer, normalizer, {
        quality: qualityTier,
        targetHeightMeters: 1.75,
      });
      scene.remove(actor.wrapper);
      actor.dispose();
      actor = nextActor;
      actor.wrapper.position.set(0.9, 0, 0.3);
      scene.add(actor.wrapper);
      const warnText = actor.audit.warnings.length ? ` | WARN: ${actor.audit.warnings.join(', ')}` : '';
      options.onAuditMessage?.(
        `GLB loaded: ${actor.audit.triangles} tris, ${actor.audit.boneCount} bones, maxTex ${actor.audit.maxTextureSize}px${warnText}`
      );
      renderer.render(scene, camera);
    },

    stressTestInstancedPool(iterations = 100) {
      if (!loader.hasMesh('heavy_crate')) {
        const s = propPool.getStats();
        return { iterations: 0, poolCount: s.poolCount, activeInstances: s.totalInstances };
      }
      const handles: PropInstanceHandle[] = [];
      for (let i = 0; i < iterations; i++) {
        const h = propPool.spawn(
          'heavy_crate',
          {
            position: [-6.0 - (i % 5) * 1.1, 2.0 + (i % 3) * 0.2, 6.0],
            rotation: [0, i * 0.2, 0],
            tintJitter: ((i % 5) - 2) * 0.05,
            wearBias: 0.4,
            wetnessBias: 0.2,
          },
          { params: { size: 1.0 } }
        );
        propPool.updateTransform(h, {
          position: [-6.0 - (i % 5) * 1.1, 2.1, 6.2],
          rotation: [0, i * 0.35, 0],
        });
        handles.push(h);
        if (handles.length > 8) {
          propPool.remove(handles.shift()!);
        }
        propPool.flush();
      }
      while (handles.length > 0) {
        propPool.remove(handles.shift()!);
      }
      propPool.flush();
      renderer.render(scene, camera);
      const stats = propPool.getStats();
      options.onMetricsUpdate?.(computeMetrics());
      return {
        iterations,
        poolCount: stats.poolCount,
        activeInstances: stats.totalInstances,
      };
    },

    disposeAndVerify(): { remainingGeometries: number; remainingTextures: number } {
      if (!disposed) {
        disposed = true;
        ready = false;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);

        for (const c of voxelChunks) c.dispose();
        voxelChunks.length = 0;

        if (terrainMesh) {
          scene.remove(terrainMesh);
          terrainMesh.geometry.dispose();
          terrainMesh = null;
        }
        if (guardPostMesh) {
          scene.remove(guardPostMesh);
          guardPostMesh = null;
        }
        if (showcaseMesh) {
          scene.remove(showcaseMesh);
          showcaseMesh.geometry.dispose();
          showcaseMesh = null;
        }
        if (rockMesh) {
          scene.remove(rockMesh);
          rockMesh.geometry.dispose();
          rockMesh = null;
        }
        if (hotPreviewMesh) {
          scene.remove(hotPreviewMesh);
          hotPreviewMesh = null;
        }

        scene.remove(actor.wrapper);
        actor.dispose();

        propPool.dispose();
        worldMat.dispose();
        rockMat.dispose();
        atmosphere.dispose();
        loader.dispose();
        renderer.dispose();
      }
      return {
        remainingGeometries: renderer.info.memory.geometries,
        remainingTextures: renderer.info.memory.textures,
      };
    },
  };

  (window as unknown as { __HGAME_LOOKDEV__?: HGameLookDevAPI }).__HGAME_LOOKDEV__ = api;
  // Render initial frame so DrawCalls and pixels are populated immediately
  renderer.render(scene, camera);
  ready = true;
  options.onMetricsUpdate?.(computeMetrics());

  return {
    api,
    start(): void {
      if (!disposed && !rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(renderFrame);
      }
    },
    resize(width: number, height: number): void {
      if (!disposed) {
        applyRendererViewport(width, height);
        renderer.render(scene, camera);
      }
    },
  };
}

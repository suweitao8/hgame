import * as THREE from 'three';
import { getQualityPreset, type QualityTier } from '../core/quality-presets.js';
import { extractMergedBoxes } from '../geometry/collider-exporter.js';
import { buildBeveledBoxRaw, buildBufferGeometryFromRaw } from '../geometry/metric-uv.js';
import { createVoxelChunk, type VoxelChunkData } from '../geometry/voxel-chunk-mesher.js';
import { createAtmospherePipeline, type AtmospherePipelineHandle } from '../lighting/atmosphere-pipeline.js';
import type { LightingPresetName } from '../lighting/procedural-ibl.js';
import { createWorldPbrMaterial, type WorldPbrMaterialHandle } from '../materials/world-pbr-shader.js';
import { ProceduralAssetLoader } from '../recipes/procedural-asset-loader.js';
import type { MaterialRecipe, MeshRecipe } from '../recipes/schema-types.js';
import { validateMaterialRecipe, validateMeshRecipe } from '../recipes/schema-validator.js';
import {
  createNormalizedDummyActor,
  loadSkeletalFromGlbBuffer,
  type LoadedSkeletalActor,
} from '../skeletal/skeletal-loader.js';
import { createTripoMaterialNormalizer, type TripoNormalizerHandle } from '../skeletal/tripo-normalizer.js';

export type CameraPresetName = 'overview' | 'brick_closeup' | 'puddle' | 'character';

export interface LookDevMetrics {
  bakeTimeMs: number;
  maxBakeSliceMs: number;
  fps: number;
  drawCalls: number;
  staticDrawCalls: number;
  triangles: number;
  estimatedTextureMB: number;
  materialCount: number;
  cachedMeshCount: number;
  qualityTier: QualityTier;
  lightingPreset: LightingPresetName;
  wetness: number;
  tripoNormalizationEnabled: boolean;
}

export interface HGameLookDevAPI {
  isReady(): boolean;
  getMetrics(): LookDevMetrics;
  setCameraPreset(name: CameraPresetName): void;
  setLightingPreset(name: LightingPresetName): void;
  setQuality(tier: QualityTier): Promise<void>;
  setWetness(value: number): void;
  setTripoNormalizationEnabled(enabled: boolean): void;
  hotReloadMaterial(recipe: unknown): Promise<void>;
  hotReloadMesh(recipe: unknown): void;
  loadCharacterGlb(buffer: ArrayBuffer): Promise<void>;
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
  overview: { pos: [12.5, 9.0, 14.5], target: [0.0, 1.4, -1.5] },
  brick_closeup: { pos: [-5.8, 2.0, 0.1], target: [-6.1, 1.6, -3.5] },
  puddle: { pos: [-0.8, 0.85, 7.9], target: [-0.8, 0.35, 1.5] },
  character: { pos: [2.6, 1.45, 2.9], target: [0.9, 1.0, 0.3] },
};

export interface LookDevSceneController {
  api: HGameLookDevAPI;
  onStatusChange?: (metrics: LookDevMetrics) => void;
  start(): void;
  resize(width: number, height: number): void;
}

export interface CreateLookDevSceneOptions {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  initialQuality?: QualityTier;
  initialLighting?: LightingPresetName;
  onMetricsUpdate?: (metrics: LookDevMetrics) => void;
  onAuditMessage?: (msg: string) => void;
}

export async function createLookDevScene(
  options: CreateLookDevSceneOptions
): Promise<LookDevSceneController> {
  const { canvas } = options;
  const manifestUrl = options.manifestUrl ?? '../../assets/procedural/manifest.json';
  let qualityTier: QualityTier = options.initialQuality ?? 'HIGH';
  let lightingPreset: LightingPresetName = options.initialLighting ?? 'OVERCAST_WET';
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

  // Load recipes & bake Texture2DArray asynchronously
  const loader = new ProceduralAssetLoader({
    quality: qualityTier,
    renderer,
  });
  await loader.loadManifest(manifestUrl);

  const texArray = loader.getTextureArray()!;
  const worldMat: WorldPbrMaterialHandle = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: false,
    globalWetness: wetness,
    groundHeight: 0,
  });
  const rockMat: WorldPbrMaterialHandle = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: getQualityPreset(qualityTier).enableTriplanar,
    globalWetness: wetness,
    groundHeight: 0,
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

    const grassMatId = loader.getMaterialId('grass_mud');
    const cobbleMatId = loader.getMaterialId('mossy_cobble');
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

          // Cobble walkway leading from puddle to guard post entrance and plinths
          const onPath =
            (Math.abs(wx) < 3.5 && wz > -2.5 && wz < 8.5) ||
            (wx > 3.0 && wx < 10.5 && wz > 2.5 && wz < 8.5);
          const isBorderBerm = Math.abs(wx) > 13.5 || Math.abs(wz) > 13.5;

          if (inPuddle) {
            const wetStrength = Math.max(0.45, 1.0 - (dPuddle / 3.6) * 0.4);
            chunk.setVoxel(x, 1, z, cobbleMatId, wetStrength);
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

  // 2. Main Guard Post mesh (1 DrawCall, hot-reloadable)
  function rebuildGuardPost(): void {
    if (guardPostMesh) {
      scene.remove(guardPostMesh);
      guardPostMesh = null;
    }
    const gpAsset = loader.instantiateMesh('guard_post');
    guardPostMesh = new THREE.Mesh(gpAsset.geometry, worldMat.material);
    guardPostMesh.name = 'GuardPostMain';
    guardPostMesh.position.set(0, 0, -3.5);
    guardPostMesh.castShadow = true;
    guardPostMesh.receiveShadow = true;
    scene.add(guardPostMesh);
  }

  // 3. Static Showcase Batch (1 DrawCall):
  //    - 1m stone brick pillar + 4m beveled brick wall (metric UV comparison)
  //    - Reskinned concrete guard_post (materialOverrides)
  //    - 6 material calibration plinths (sphere + beveled cube per .hmat.json)
  function rebuildShowcase(): void {
    if (showcaseMesh) {
      scene.remove(showcaseMesh);
      showcaseMesh.geometry.dispose();
      showcaseMesh = null;
    }
    const pieces: MergedPiece[] = [];

    // 1m standalone brick pillar at (-4.2, 0, -3.5)
    const pillarAsset = loader.instantiateMesh('beveled_wall', {
      params: { width: 1.0, height: 3.0, thickness: 1.0, hasWindow: false },
    });
    pieces.push({ geometry: pillarAsset.geometry, pos: [-4.2, 0, -3.5] });

    // 4m standalone brick wall at (-7.6, 0, -3.5)
    const wallAsset = loader.instantiateMesh('beveled_wall', {
      params: { width: 4.0, height: 3.0, thickness: 0.35, hasWindow: true },
    });
    pieces.push({ geometry: wallAsset.geometry, pos: [-7.6, 0, -3.5] });

    // Reskinned concrete guard post at (8.5, 0, -4.5)
    const reskinAsset = loader.instantiateMesh('guard_post', {
      materialOverrides: {
        wallMat: 'concrete_weathered',
        woodMat: 'rusted_iron',
        baseMat: 'mossy_cobble',
      },
    });
    pieces.push({ geometry: reskinAsset.geometry, pos: [8.5, 0, -4.5], rotY: -0.35 });

    // 6-Material Calibration Plinths at (4.5..10.5, 0, 5.5)
    const matIds = loader.listMaterialIds();
    for (let i = 0; i < matIds.length; i++) {
      const mName = matIds[i]!;
      const layerId = loader.getMaterialId(mName);
      const px = 4.2 + (i % 3) * 2.2;
      const pz = 4.2 + Math.floor(i / 3) * 2.4;

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

    const merged = mergeStaticGeometries(pieces);
    showcaseMesh = new THREE.Mesh(merged, worldMat.material);
    showcaseMesh.name = 'StaticShowcaseBatch';
    showcaseMesh.castShadow = true;
    showcaseMesh.receiveShadow = true;
    scene.add(showcaseMesh);
  }

  // 4. Triplanar weathered rocks cluster (1 DrawCall)
  function rebuildRocks(): void {
    if (rockMesh) {
      scene.remove(rockMesh);
      rockMesh.geometry.dispose();
      rockMesh = null;
    }
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

    return {
      bakeTimeMs: Math.round((tex?.bakeTimeMs ?? 0) * 10) / 10,
      maxBakeSliceMs: Math.round((tex?.maxSliceMs ?? 0) * 10) / 10,
      fps: Math.round(fpsSmooth * 10) / 10,
      drawCalls: renderer.info.render.calls,
      staticDrawCalls,
      triangles: renderer.info.render.triangles,
      estimatedTextureMB: Math.round((tex?.estimatedMemoryMB ?? 0) * 100) / 100,
      materialCount: tex?.layers.size ?? 0,
      cachedMeshCount: loader.getCachedMeshCount(),
      qualityTier,
      lightingPreset,
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

    actor.update(dt);
    atmosphere.update((now - startTime) * 0.001, camera.position);
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
      } else if (recipe.id === 'beveled_wall') {
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
